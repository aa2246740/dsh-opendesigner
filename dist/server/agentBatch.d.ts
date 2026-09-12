import { type FilePresence } from "./fileBytes.ts";
import { type FrozenChangeset } from "./frozenChangeset.ts";
export declare class GitRequiredError extends Error {
    readonly code = "GIT_REQUIRED";
    constructor(message?: string);
}
export declare class BatchError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export type AgentBatchStatus = "open" | "applied" | "discarded";
export interface AgentBatch {
    batchId: string;
    status: AgentBatchStatus;
    worktreeRelPath: string;
    branch: string;
    baseRef: string;
    createdAt: string;
    label?: string;
    isolation: "worktree";
}
export interface BatchApplyResult {
    batchId: string;
    status: AgentBatchStatus;
    copied: string[];
    deleted: string[];
    conflicts?: {
        rel: string;
        reason: string;
    }[];
}
export declare function assertBatchId(batchId: string): void;
export declare function detectThreeWayConflict(input: {
    kind: "write" | "delete";
    base: FilePresence;
    current: FilePresence;
    candidate: FilePresence;
}): string | null;
export declare class AgentBatchRegistry {
    batches: AgentBatch[];
    private projectRoot;
    private filePath;
    private workspaceId;
    private journal;
    private writeChain;
    beforeManagedWrite?: (abs: string) => Promise<void>;
    constructor(projectRoot: string, filePath: string, workspaceId?: string);
    openBatch(): AgentBatch | undefined;
    get(batchId: string): AgentBatch | undefined;
    load(): Promise<void>;
    persist(): Promise<void>;
    create(label?: string): Promise<AgentBatch>;
    discard(batchId: string): Promise<AgentBatch>;
    captureFrozen(batchId: string): Promise<FrozenChangeset>;
    prepareApply(batchId: string): Promise<FrozenChangeset>;
    commitPrepared(frozen: FrozenChangeset): Promise<BatchApplyResult>;
    apply(batchId: string): Promise<BatchApplyResult>;
    private enqueueWrite;
    private commitPreparedInner;
    private assertFrozenConflicts;
    previewDiffs(batchId: string): Promise<{
        rel: string;
        kind: "write" | "delete";
    }[]>;
    worktreeAbs(batch: AgentBatch): string;
    diffHash(batchId: string): Promise<string>;
    private requireOpen;
    private removeWorktree;
}
interface WorktreeChange {
    kind: "write" | "delete";
    rel: string;
}
export declare function listWorktreeChanges(worktreeAbs: string, baseRef: string): Promise<WorktreeChange[]>;
export {};
//# sourceMappingURL=agentBatch.d.ts.map