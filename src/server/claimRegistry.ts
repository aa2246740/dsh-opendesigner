/**
 * 并发控制与锁生命周期状态机 (The Claim-Lock State Machine)
 * 四态状态机：IDLE -> CLAIMED -> MUTATED -> VERIFIED -> RELEASED
 * 严格执行：改动后未经过 take_screenshot 视觉自检，严禁释放锁
 */

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
  ttlMs?: number; // 默认 300,000ms (300s)
  holder?: string;
}

export class ClaimRegistry {
  private claimsById: Map<string, ClaimRecord> = new Map();
  private activeClaimByElementId: Map<string, string> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 300_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * 计算节点与其子树的 covering_hash
   */
  public static computeCoveringHash(content: unknown): string {
    const raw = typeof content === "string" ? content : JSON.stringify(content);
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  /**
   * 申请排他并发锁 (canvas_claim)
   */
  public claim(
    elementId: string,
    coveringHash: string,
    options: ClaimOptions = {}
  ): { success: boolean; claimId?: string; error?: string } {
    const now = Date.now();
    const existingClaimId = this.activeClaimByElementId.get(elementId);

    if (existingClaimId) {
      const existing = this.claimsById.get(existingClaimId);
      if (existing && existing.expiresAt > now && existing.status !== "RELEASED" && existing.status !== "EXPIRED") {
        return {
          success: false,
          error: `CONFLICT: Element ${elementId} is already locked by claim ${existingClaimId} (${existing.holder})`
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

  /**
   * 记录节点已被修改 (canvas_edit / canvas_update / canvas_insert / canvas_delete)
   */
  public recordMutation(claimId: string): { success: boolean; error?: string } {
    const record = this.claimsById.get(claimId);
    if (!record) {
      return { success: false, error: `Claim ${claimId} not found` };
    }

    if (Date.now() > record.expiresAt) {
      record.status = "EXPIRED";
      return { success: false, error: `Claim ${claimId} has expired` };
    }

    record.mutated = true;
    record.verified = false;
    record.status = "MUTATED";
    return { success: true };
  }

  /**
   * 记录视觉自检验收 (take_screenshot)
   */
  public recordVerification(elementId: string): { success: boolean; error?: string } {
    const claimId = this.activeClaimByElementId.get(elementId);
    if (!claimId) {
      return { success: true }; // 无锁状态下截图亦允许
    }

    const record = this.claimsById.get(claimId);
    if (record) {
      record.verified = true;
      if (record.status === "MUTATED") {
        record.status = "VERIFIED";
      }
    }

    return { success: true };
  }

  /**
   * 释放排他锁 (canvas_release)
   * 严格拦截：若元素发生过修改但未调用 take_screenshot 自检，拒绝释放！
   */
  public release(claimId: string): { success: boolean; error?: string } {
    const record = this.claimsById.get(claimId);
    if (!record) {
      return { success: false, error: `Claim ${claimId} not found` };
    }

    if (record.status === "RELEASED") {
      return { success: true };
    }

    // 严苛红线：修改后未经视觉验收直接释放，予以拦截
    if (record.mutated && !record.verified) {
      return {
        success: false,
        error: "VERIFICATION_REQUIRED: Cannot release claim on mutated element without visual inspection. Call take_screenshot first."
      };
    }

    record.status = "RELEASED";
    this.activeClaimByElementId.delete(record.elementId);
    return { success: true };
  }

  /**
   * 查询锁详情
   */
  public getClaim(claimId: string): ClaimRecord | undefined {
    return this.claimsById.get(claimId);
  }

  /**
   * 校验特定锁是否有效且持有
   */
  public validateClaim(claimId: string, elementId?: string): { valid: boolean; error?: string } {
    const record = this.claimsById.get(claimId);
    if (!record) {
      return { valid: false, error: `Claim ${claimId} does not exist` };
    }

    if (Date.now() > record.expiresAt) {
      record.status = "EXPIRED";
      return { valid: false, error: `Claim ${claimId} has expired (TTL exceeded)` };
    }

    if (record.status === "RELEASED") {
      return { valid: false, error: `Claim ${claimId} has already been released` };
    }

    if (elementId && record.elementId !== elementId) {
      return { valid: false, error: `Claim ${claimId} locks element ${record.elementId}, not ${elementId}` };
    }

    return { valid: true };
  }
}
