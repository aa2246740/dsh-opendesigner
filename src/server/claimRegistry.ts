import { randomUUID, createHash } from "node:crypto";

export type ClaimStatus = "IDLE" | "CLAIMED" | "MUTATED" | "VERIFIED" | "RELEASED" | "EXPIRED";

export interface ClaimRecord {
  claimId: string;
  elementId: string;
  coveringHash: string;
  holder: string;
  createdAt: number;
  expiresAt: number;
  status: ClaimStatus;
  mutated: boolean;
  verified: boolean;
}

export interface ClaimOptions {
  ttlMs?: number;
  holder?: string;
  expectedHash?: string;
  isRelated?: (lockedElementId: string, requestedElementId: string) => boolean;
}

export class ClaimRegistry {
  private claimsById: Map<string, ClaimRecord> = new Map();
  private activeClaimByElementId: Map<string, string> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 300_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  public static computeCoveringHash(content: unknown): string {
    const raw = typeof content === "string" ? content : JSON.stringify(content);
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  private isLive(record: ClaimRecord, now = Date.now()): boolean {
    if (record.status === "RELEASED" || record.status === "EXPIRED") return false;
    if (now > record.expiresAt) {
      record.status = "EXPIRED";
      return false;
    }
    return true;
  }

  public claim(
    elementId: string,
    coveringHash: string,
    options: ClaimOptions = {}
  ): { success: boolean; claimId?: string; error?: string } {
    const now = Date.now();

    if (options.expectedHash && coveringHash && options.expectedHash !== coveringHash) {
      return {
        success: false,
        error: `STALE_READ: Covering hash mismatch on element ${elementId}. Current is ${options.expectedHash}, but claim requested ${coveringHash}`
      };
    }

    for (const [lockedId, existingClaimId] of this.activeClaimByElementId) {
      const existing = this.claimsById.get(existingClaimId);
      if (!existing || !this.isLive(existing, now)) {
        if (existing && existing.status === "EXPIRED") {
          this.activeClaimByElementId.delete(lockedId);
        }
        continue;
      }
      const sameNode = lockedId === elementId;
      const overlapping = options.isRelated?.(lockedId, elementId) === true;
      if (sameNode || overlapping) {
        return {
          success: false,
          error: `CONFLICT: Element ${elementId} overlaps live claim ${existingClaimId} on ${lockedId} (${existing.holder})`
        };
      }
    }

    const ttl = options.ttlMs ?? this.defaultTtlMs;
    const claimId = randomUUID();
    const record: ClaimRecord = {
      claimId,
      elementId,
      coveringHash,
      holder: options.holder || "default-agent",
      createdAt: now,
      expiresAt: now + ttl,
      status: "CLAIMED",
      mutated: false,
      verified: false
    };

    this.claimsById.set(claimId, record);
    this.activeClaimByElementId.set(elementId, claimId);

    return {
      success: true,
      claimId
    };
  }

  public recordMutation(claimId: string): { success: boolean; error?: string } {
    const record = this.claimsById.get(claimId);
    if (!record) {
      return { success: false, error: `Claim ${claimId} not found` };
    }

    if (!this.isLive(record)) {
      return { success: false, error: `Claim ${claimId} has expired` };
    }

    record.mutated = true;
    record.verified = false;
    record.status = "MUTATED";
    return { success: true };
  }

  public recordVerification(targetIdOrClaimId: string): { success: boolean; error?: string } {
    let claimId = this.activeClaimByElementId.get(targetIdOrClaimId);
    if (!claimId && this.claimsById.has(targetIdOrClaimId)) {
      claimId = targetIdOrClaimId;
    }

    if (!claimId) {
      return { success: true };
    }

    const record = this.claimsById.get(claimId);
    if (record && this.isLive(record)) {
      record.verified = true;
      if (record.status === "MUTATED") {
        record.status = "VERIFIED";
      }
    }

    return { success: true };
  }

  public release(claimId: string): { success: boolean; error?: string } {
    const record = this.claimsById.get(claimId);
    if (!record) {
      return { success: false, error: `Claim ${claimId} not found` };
    }

    if (record.status === "RELEASED") {
      return { success: true };
    }

    if (record.mutated && !record.verified && this.isLive(record)) {
      return {
        success: false,
        error: "VERIFICATION_REQUIRED: Cannot release claim on mutated element without visual inspection. Call take_screenshot first."
      };
    }

    record.status = "RELEASED";
    if (this.activeClaimByElementId.get(record.elementId) === claimId) {
      this.activeClaimByElementId.delete(record.elementId);
    }
    return { success: true };
  }

  public getClaim(claimId: string): ClaimRecord | undefined {
    return this.claimsById.get(claimId);
  }

  public validateClaim(
    claimId: string,
    elementId?: string,
    isAllowedDescendant?: (ancestorId: string, targetId: string) => boolean
  ): { valid: boolean; error?: string } {
    const record = this.claimsById.get(claimId);
    if (!record) {
      return { valid: false, error: `Claim ${claimId} does not exist` };
    }

    if (!this.isLive(record)) {
      return { valid: false, error: `Claim ${claimId} has expired (TTL exceeded)` };
    }

    if (record.status === "RELEASED") {
      return { valid: false, error: `Claim ${claimId} has already been released` };
    }

    if (elementId && record.elementId !== elementId) {
      if (isAllowedDescendant && isAllowedDescendant(record.elementId, elementId)) {
        return { valid: true };
      }
      return { valid: false, error: `Claim ${claimId} locks element ${record.elementId}, not ${elementId}` };
    }

    return { valid: true };
  }
}
