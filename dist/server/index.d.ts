import { FlatStore, type FlatStoreJson } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import type { ScreenshotMode } from "./mcpTools.ts";
import { AIGateway, type AIGatewayConfig, type AIProvider } from "./aiGateway.ts";
import { type ApprovalChannel } from "./approval.ts";
import { ApprovalLedger } from "./approvalReceipt.ts";
import { CheckpointLog, type CheckpointKind, type SourceOverlay } from "./checkpoints.ts";
import { AgentBatchRegistry, type BatchApplyResult } from "./agentBatch.ts";
export interface OpenDesignerConfig {
    projectRoot?: string;
    autoApprove?: boolean;
    ttlMs?: number;
    screenshotMode?: ScreenshotMode;
    modelProvider?: AIProvider;
    aiConfig?: Partial<AIGatewayConfig>;
}
export interface GitSyncStatus {
    isGitRepo: boolean;
    branch?: string;
    clean: boolean;
    modifiedFiles: string[];
    canvasTracked: boolean;
}
export interface ExecuteToolOptions {
    approvalChannel?: ApprovalChannel;
}
export declare class StaleHydrateError extends Error {
    readonly code = "STALE_HYDRATE";
    constructor(message?: string);
}
export declare class ProjectMismatchError extends Error {
    readonly code = "PROJECT_MISMATCH";
    constructor(message?: string);
}
export declare class OpenDesignerService {
    static readonly serviceName = "openDesigner";
    projectRoot: string;
    readonly projectId: string;
    storeVersion: number;
    autoApprove: boolean;
    screenshotMode: ScreenshotMode;
    store: FlatStore;
    claimRegistry: ClaimRegistry;
    aiGateway: AIGateway;
    checkpoints: CheckpointLog;
    batches: AgentBatchRegistry;
    approvals: ApprovalLedger;
    sessionTouched: Set<string>;
    private sourceBaselines;
    private pendingProposal;
    private approvedChangeset;
    private saveChain;
    private commandChain;
    private runtimeLock;
    private initPromise;
    private canvasFilePath;
    private designerDir;
    private appliedFilePath;
    private isInitialized;
    private lastAutosaveAt;
    private lastAppliedAt;
    constructor(config?: OpenDesignerConfig);
    fileIoRoot(): string;
    worktreeKey(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    init(): Promise<void>;
    private doInit;
    status(): Record<string, unknown>;
    loadCanvas(): Promise<boolean>;
    hydrateStore(data: unknown): void;
    canvasPayload(): FlatStoreJson & {
        projectId: string;
        version: number;
        savedAt?: string;
    };
    bumpStoreVersion(): void;
    saveCanvas(localEditId?: number): Promise<{
        savedAt: string;
        ackRevision: number;
        localEditId?: number;
    }>;
    private writeCanvas;
    captureSourceFiles(): Promise<SourceOverlay>;
    restoreSourceFiles(files?: SourceOverlay): Promise<void>;
    private rememberSourceBaselines;
    pushCheckpoint(input: {
        label: string;
        kind?: CheckpointKind;
    }): Promise<unknown>;
    rewind(checkpointId?: string): Promise<unknown>;
    applyToProject(): Promise<unknown>;
    applyOpenBatchFiles(batchId: string): Promise<BatchApplyResult>;
    getGitStatus(): Promise<GitSyncStatus>;
    syncGitWorkspace(options?: {
        stageCanvas?: boolean;
    }): Promise<GitSyncStatus>;
    executeTool(toolName: string, args?: Record<string, any>, options?: ExecuteToolOptions): Promise<any>;
    private enqueueCommand;
    private executeToolUngated;
    issueHostReceipt(tool: string, args?: Record<string, unknown>): Promise<unknown>;
    private issueHostReceiptUngated;
    proposeSourcePatch(input: {
        elementId: string;
        instruction: string;
        live?: boolean;
    }): Promise<unknown>;
    acceptSourcePatch(input?: {
        proposalId?: string;
    }): Promise<unknown>;
    rejectSourcePatch(): Promise<unknown>;
    private reprojectSourceFile;
    private importProjectSource;
    private toolDiffHash;
    private pathFingerprint;
    private assertReceipt;
    private executePersistTool;
    private trackSessionWrites;
}
export * from "./claimRegistry.ts";
export * from "./mcpTools.ts";
export * from "./aiGateway.ts";
export * from "./pathJail.ts";
export * from "./approval.ts";
export * from "./approvalReceipt.ts";
export * from "./applyJournal.ts";
export * from "./checkpoints.ts";
export * from "./agentBatch.ts";
export * from "./persistenceTools.ts";
export * from "./atomicWrite.ts";
export * from "./runtimeLock.ts";
export * from "./frozenChangeset.ts";
export { GraphError } from "../store/flatStore.ts";
//# sourceMappingURL=index.d.ts.map