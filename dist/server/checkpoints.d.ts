import { type SourceOverlay } from "./sourceOverlay.ts";
export declare const MAX_CHECKPOINTS = 50;
export type CheckpointKind = "canvas" | "source" | "session";
export interface CheckpointSnapshot {
    byId: Record<string, unknown>;
    childrenByParent: Record<string, unknown>;
    parentByChild: Record<string, unknown>;
    pages: unknown[];
    activePageId: string;
}
export type { SourceOverlay };
export interface Checkpoint {
    id: string;
    createdAt: string;
    label: string;
    kind: CheckpointKind;
    store: CheckpointSnapshot;
    sourceFiles?: SourceOverlay;
}
export interface CheckpointSummary {
    id: string;
    createdAt: string;
    label: string;
    kind: CheckpointKind;
}
export interface RewindPlan {
    index: number;
    truncate: boolean;
    checkpoint: Checkpoint;
}
export declare class CheckpointLog {
    entries: Checkpoint[];
    cursor: number;
    private filePath;
    private maxEntries;
    constructor(filePath: string, maxEntries?: number);
    current(): Checkpoint | undefined;
    list(): CheckpointSummary[];
    load(): Promise<void>;
    persist(): Promise<void>;
    push(input: {
        label: string;
        kind: CheckpointKind;
        store: CheckpointSnapshot;
        sourceFiles?: SourceOverlay;
    }): Promise<Checkpoint>;
    planRewind(): RewindPlan;
    planRewindTo(id: string): RewindPlan;
    commitRewind(plan: RewindPlan): Promise<Checkpoint>;
    rewind(): Promise<Checkpoint>;
    rewindTo(id: string): Promise<Checkpoint>;
}
//# sourceMappingURL=checkpoints.d.ts.map