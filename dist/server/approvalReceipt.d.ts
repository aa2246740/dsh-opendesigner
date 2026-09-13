import { ApprovalRequiredError } from "./approval.ts";
export declare const APPROVAL_TTL_MS: number;
export declare class ApprovalDeniedError extends Error {
    readonly code = "DENIED";
    constructor(message: string);
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
export declare function hashDiffPayload(parts: Array<string | Buffer>): string;
export declare class ApprovalLedger {
    private receipts;
    private readonly filePath;
    constructor(filePath: string);
    load(): Promise<void>;
    persist(): Promise<void>;
    issue(input: {
        projectId: string;
        revision: number;
        diffHash: string;
        tool: string;
        ttlMs?: number;
    }): Promise<ApprovalReceipt>;
    consume(input: {
        receiptId: unknown;
        projectId: string;
        revision: number;
        diffHash: string;
        tool: string;
    }): Promise<ApprovalReceipt>;
}
export { ApprovalRequiredError };
//# sourceMappingURL=approvalReceipt.d.ts.map