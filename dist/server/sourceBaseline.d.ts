export type BaselinePresence = {
    kind: "text";
    text: string;
} | {
    kind: "binary";
    hash: string;
    base64: string;
} | {
    kind: "absent";
} | {
    kind: "unreadable";
    code: string;
    message: string;
};
export interface SourceBaselineFile {
    workspaceId: string;
    worktrees: Record<string, Record<string, BaselinePresence>>;
}
export declare function presenceFromBytes(bytes: Buffer): BaselinePresence;
export declare function readBaselinePresence(abs: string): Promise<BaselinePresence>;
export declare function bytesFromBaseline(row: BaselinePresence): Buffer | null;
export declare class SourceBaselineStore {
    worktrees: Record<string, Record<string, BaselinePresence>>;
    private readonly filePath;
    private readonly workspaceId;
    constructor(filePath: string, workspaceId: string);
    get files(): Record<string, string | null>;
    load(): Promise<void>;
    persist(): Promise<void>;
    remember(worktreeKey: string, rel: string, presence: BaselinePresence): void;
    overlay(worktreeKey: string): Record<string, BaselinePresence>;
}
//# sourceMappingURL=sourceBaseline.d.ts.map