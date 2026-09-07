import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteJson } from "./atomicWrite.ts";
import { copyFileNoFollow, unlinkNoFollow, writeFileNoFollow } from "./fileBytes.ts";

export type ApplyJournalPhase = "prepared" | "applying" | "committed" | "blocked";

export interface ApplyJournalEntry {
  workspaceId: string;
  batchId: string;
  phase: ApplyJournalPhase;
  planned: { kind: "write" | "delete"; rel: string }[];
  backups: { rel: string; backupRel: string | null }[];
  error?: string;
  updatedAt: string;
}

export class ApplyJournalBlockedError extends Error {
  readonly code = "BATCH_RECOVERY_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "ApplyJournalBlockedError";
  }
}

export class ApplyJournal {
  private readonly projectRoot: string;
  private readonly workspaceId: string;
  private readonly filePath: string;

  constructor(projectRoot: string, workspaceId: string, filePath: string) {
    this.projectRoot = projectRoot;
    this.workspaceId = workspaceId;
    this.filePath = filePath;
  }

  public async load(): Promise<ApplyJournalEntry | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf-8")) as ApplyJournalEntry;
      if (raw.workspaceId !== this.workspaceId) return null;
      return raw;
    } catch {
      return null;
    }
  }

  public async recover(): Promise<{ recovered: boolean; blocked?: boolean }> {
    const journal = await this.load();
    if (!journal) return { recovered: false };
    if (journal.phase === "committed") {
      await this.clear();
      return { recovered: false };
    }
    if (journal.phase === "blocked") {
      throw new ApplyJournalBlockedError(
        journal.error || "Apply recovery is blocked. Inspect .designer/apply-journal.json."
      );
    }
    try {
      for (const item of [...journal.backups].reverse()) {
        const to = path.join(this.projectRoot, item.rel);
        if (item.backupRel) {
          const backupAbs = path.join(this.projectRoot, item.backupRel);
          await fs.mkdir(path.dirname(to), { recursive: true });
          await copyFileNoFollow(backupAbs, to);
        } else {
          await unlinkNoFollow(to);
        }
      }
      await this.clear();
      return { recovered: true };
    } catch (err) {
      journal.phase = "blocked";
      journal.error = err instanceof Error ? err.message : String(err);
      journal.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.filePath, journal);
      throw new ApplyJournalBlockedError(journal.error);
    }
  }

  public async begin(batchId: string, planned: { kind: "write" | "delete"; rel: string }[]): Promise<ApplyJournalEntry> {
    const entry: ApplyJournalEntry = {
      workspaceId: this.workspaceId,
      batchId,
      phase: "prepared",
      planned,
      backups: [],
      updatedAt: new Date().toISOString()
    };
    await atomicWriteJson(this.filePath, entry);
    return entry;
  }

  public async recordBackup(entry: ApplyJournalEntry, rel: string, backupRel: string | null): Promise<void> {
    entry.phase = "applying";
    entry.backups.push({ rel, backupRel });
    entry.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.filePath, entry);
  }

  public async commit(entry: ApplyJournalEntry): Promise<void> {
    entry.phase = "committed";
    entry.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.filePath, entry);
    await this.clear();
  }

  public async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }

  public stagingDir(batchId: string): string {
    return path.join(this.projectRoot, ".designer", "apply-staging", batchId);
  }

  public async backupFile(staging: string, rel: string, from: string): Promise<string> {
    const backupRel = path.join(".designer", "apply-staging", path.basename(staging), rel);
    const backupAbs = path.join(this.projectRoot, backupRel);
    await fs.mkdir(path.dirname(backupAbs), { recursive: true });
    await copyFileNoFollow(from, backupAbs);
    return backupRel;
  }
}

export { writeFileNoFollow };
