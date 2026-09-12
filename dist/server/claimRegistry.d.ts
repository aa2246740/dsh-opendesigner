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
export declare class ClaimRegistry {
    private claimsById;
    private activeClaimByElementId;
    private defaultTtlMs;
    constructor(defaultTtlMs?: number);
    static computeCoveringHash(content: unknown): string;
    private isLive;
    claim(elementId: string, coveringHash: string, options?: ClaimOptions): {
        success: boolean;
        claimId?: string;
        error?: string;
    };
    recordMutation(claimId: string): {
        success: boolean;
        error?: string;
    };
    recordVerification(targetIdOrClaimId: string): {
        success: boolean;
        error?: string;
    };
    release(claimId: string): {
        success: boolean;
        error?: string;
    };
    getClaim(claimId: string): ClaimRecord | undefined;
    validateClaim(claimId: string, elementId?: string, isAllowedDescendant?: (ancestorId: string, targetId: string) => boolean): {
        valid: boolean;
        error?: string;
    };
}
//# sourceMappingURL=claimRegistry.d.ts.map