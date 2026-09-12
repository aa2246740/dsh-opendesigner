import { writeFileNoFollow } from "./fileBytes.ts";
export type ApplyJournalPhase = "prepared" | "applying" | "committed" | "blocked";
export interface ApplyJournalOp {
    kind: "write" | "delete";
    rel: string;
    mode?: number | null;
    beforeHash?: string | null;
    afterHash?: string | null;
}
export interface ApplyJournalBackup {
    rel: string;
    backupRel: string | null;
    beforeHash?: string | null;
    afterHash?: string | null;
}
export interface ApplyJournalEntry {
    workspaceId: string;
    batchId: string;
    phase: ApplyJournalPhase;
    planned: ApplyJournalOp[];
    backups: ApplyJournalBackup[];
    error?: string;
    updatedAt: string;
}
export declare class ApplyJournalBlockedError extends Error {
    readonly code = "BATCH_RECOVERY_BLOCKED";
    constructor(message: string);
}
export declare class ApplyJournal {
    private readonly projectRoot;
    private readonly workspaceId;
    private readonly filePath;
    constructor(projectRoot: string, workspaceId: string, filePath: string);
    load(): Promise<ApplyJournalEntry | null>;
    parseEntry(raw: unknown): ApplyJournalEntry;
    recover(): Promise<{
        recovered: boolean;
        blocked?: boolean;
    }>;
    private block;
    begin(batchId: string, planned: ApplyJournalOp[]): Promise<ApplyJournalEntry>;
    recordBackup(entry: ApplyJournalEntry, rel: string, backupRel: string | null, hashes?: {
        beforeHash?: string | null;
        afterHash?: string | null;
    }): Promise<void>;
    commit(entry: ApplyJournalEntry): Promise<void>;
    clear(): Promise<void>;
    stagingDir(batchId: string): string;
    backupFile(staging: string, rel: string, from: string): Promise<string>;
    private assertJailedRel;
}
export { writeFileNoFollow };
//# sourceMappingURL=applyJournal.d.ts.map