import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { atomicWriteJson } from "./atomicWrite.ts";
import { ApprovalRequiredError } from "./approval.ts";

export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export class ApprovalDeniedError extends Error {
  readonly code = "DENIED";
  constructor(message: string) {
    super(message);
    this.name = "ApprovalDeniedError";
  }
}

export interface ApprovalReceipt {
  id: string;
  projectId: string;
  revision: number;
  diffHash: string;
  tool: string;
  expiresAt: number;
  consumedAt: number | null;
}

interface ReceiptFile {
  receipts: ApprovalReceipt[];
}

export function hashDiffPayload(parts: Array<string | Buffer>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(typeof part === "string" ? part : part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export class ApprovalLedger {
  private receipts: ApprovalReceipt[] = [];
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf-8")) as ReceiptFile;
      this.receipts = Array.isArray(data.receipts) ? data.receipts : [];
    } catch {
      this.receipts = [];
    }
  }

  public async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, { receipts: this.receipts } satisfies ReceiptFile);
  }

  public async issue(input: {
    projectId: string;
    revision: number;
    diffHash: string;
    tool: string;
    ttlMs?: number;
  }): Promise<ApprovalReceipt> {
    const now = Date.now();
    this.receipts = this.receipts.filter((row) => row.consumedAt === null && row.expiresAt > now);
    const receipt: ApprovalReceipt = {
      id: `apr_${randomUUID()}`,
      projectId: input.projectId,
      revision: input.revision,
      diffHash: input.diffHash,
      tool: input.tool,
      expiresAt: now + (input.ttlMs ?? APPROVAL_TTL_MS),
      consumedAt: null
    };
    this.receipts.push(receipt);
    await this.persist();
    return receipt;
  }

  public async consume(input: {
    receiptId: unknown;
    projectId: string;
    revision: number;
    diffHash: string;
    tool: string;
  }): Promise<ApprovalReceipt> {
    if (typeof input.receiptId !== "string" || input.receiptId.length === 0) {
      throw new ApprovalDeniedError("Destructive tool requires a host approval receipt. approve:true is not authorization.");
    }
    const now = Date.now();
    const receipt = this.receipts.find((row) => row.id === input.receiptId);
    if (!receipt) {
      throw new ApprovalDeniedError("approval receipt not found");
    }
    if (receipt.consumedAt !== null) {
      throw new ApprovalDeniedError("approval receipt already consumed");
    }
    if (receipt.expiresAt <= now) {
      throw new ApprovalDeniedError("approval receipt expired");
    }
    if (receipt.projectId !== input.projectId) {
      throw new ApprovalDeniedError("approval receipt project mismatch");
    }
    if (receipt.revision !== input.revision) {
      throw new ApprovalDeniedError("approval receipt revision mismatch");
    }
    if (receipt.diffHash !== input.diffHash) {
      throw new ApprovalDeniedError("approval receipt diff hash mismatch");
    }
    if (receipt.tool !== input.tool) {
      throw new ApprovalDeniedError("approval receipt tool mismatch");
    }
    receipt.consumedAt = now;
    await this.persist();
    return receipt;
  }
}

export { ApprovalRequiredError };
