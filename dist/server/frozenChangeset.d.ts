import { type FilePresence } from "./fileBytes.ts";
export interface FrozenOp {
    kind: "write" | "delete";
    rel: string;
    mode: number | null;
    beforeHash: string | null;
    afterHash: string | null;
}
export interface FrozenChangeset {
    projectId: string;
    worktreeRelPath: string;
    batchId: string;
    baseVersion: string;
    ops: FrozenOp[];
    afterBytes: Record<string, Buffer>;
}
export declare function fileModeOf(abs: string): number | null;
export declare function fingerprintPresence(presence: FilePresence): string | null;
export declare function hashFrozenChangeset(changeset: FrozenChangeset): string;
export declare function cloneFrozenChangeset(changeset: FrozenChangeset): FrozenChangeset;
//# sourceMappingURL=frozenChangeset.d.ts.map