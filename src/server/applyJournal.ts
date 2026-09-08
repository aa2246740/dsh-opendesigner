import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteJson } from "./atomicWrite.ts";
import { PathJailError, resolveProjectPath } from "./pathJail.ts";
import { copyFileNoFollow, unlinkNoFollow, writeFileNoFollow, readPresence } from "./fileBytes.ts";
import { fingerprintPresence } from "./frozenChangeset.ts";

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

const PHASES = new Set<ApplyJournalPhase>(["prepared", "applying", "committed", "blocked"]);

export class ApplyJournalBlockedError extends Error {
  readonly code = "BATCH_RECOVERY_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "ApplyJournalBlockedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    let rawText: string;
    try {
      rawText = await fs.readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new ApplyJournalBlockedError(
        `Apply journal unreadable (${(err as NodeJS.ErrnoException).code || "error"}). Recovery blocked.`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new ApplyJournalBlockedError("Apply journal JSON is corrupt. Recovery blocked.");
    }
    return this.parseEntry(parsed);
  }

  public parseEntry(raw: unknown): ApplyJournalEntry {
    if (!isRecord(raw)) {
      throw new ApplyJournalBlockedError("Apply journal schema is invalid. Recovery blocked.");
    }
    if (raw.workspaceId !== this.workspaceId) {
      throw new ApplyJournalBlockedError("Apply journal workspace identity mismatch. Recovery blocked.");
    }
    if (typeof raw.batchId !== "string" || raw.batchId.length === 0) {
      throw new ApplyJournalBlockedError("Apply journal batchId is invalid. Recovery blocked.");
    }
    if (typeof raw.phase !== "string" || !PHASES.has(raw.phase as ApplyJournalPhase)) {
      throw new ApplyJournalBlockedError("Apply journal phase is invalid. Recovery blocked.");
    }
    if (!Array.isArray(raw.planned) || !Array.isArray(raw.backups)) {
      throw new ApplyJournalBlockedError("Apply journal planned/backups must be arrays. Recovery blocked.");
    }

    const planned: ApplyJournalOp[] = [];
    for (const item of raw.planned) {
      if (!isRecord(item) || (item.kind !== "write" && item.kind !== "delete") || typeof item.rel !== "string") {
        throw new ApplyJournalBlockedError("Apply journal planned op is invalid. Recovery blocked.");
      }
      this.assertJailedRel(item.rel);
      planned.push({
        kind: item.kind,
        rel: item.rel,
        mode: typeof item.mode === "number" ? item.mode : item.mode === null ? null : undefined,
        beforeHash: typeof item.beforeHash === "string" || item.beforeHash === null ? item.beforeHash : undefined,
        afterHash: typeof item.afterHash === "string" || item.afterHash === null ? item.afterHash : undefined
      });
    }

    const backups: ApplyJournalBackup[] = [];
    for (const item of raw.backups) {
      if (!isRecord(item) || typeof item.rel !== "string") {
        throw new ApplyJournalBlockedError("Apply journal backup is invalid. Recovery blocked.");
      }
      this.assertJailedRel(item.rel);
      if (item.backupRel !== null && item.backupRel !== undefined) {
        if (typeof item.backupRel !== "string") {
          throw new ApplyJournalBlockedError("Apply journal backupRel is invalid. Recovery blocked.");
        }
        this.assertJailedRel(item.backupRel);
      }
      backups.push({
        rel: item.rel,
        backupRel: typeof item.backupRel === "string" ? item.backupRel : null,
        beforeHash: typeof item.beforeHash === "string" || item.beforeHash === null ? item.beforeHash : undefined,
        afterHash: typeof item.afterHash === "string" || item.afterHash === null ? item.afterHash : undefined
      });
    }

    return {
      workspaceId: this.workspaceId,
      batchId: raw.batchId,
      phase: raw.phase as ApplyJournalPhase,
      planned,
      backups,
      error: typeof raw.error === "string" ? raw.error : undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
    };
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
    if (journal.backups.length === 0) {
      await this.clear();
      return { recovered: false };
    }
    try {
      const plannedByRel = new Map(journal.planned.map((op) => [op.rel, op]));
      const classified: Array<{
        rel: string;
        beforeHash: string | null | undefined;
        afterHash: string | null | undefined;
        backupRel: string | null;
      }> = [];
      const seen = new Set<string>();
      for (const item of journal.backups) {
        const planned = plannedByRel.get(item.rel);
        classified.push({
          rel: item.rel,
          beforeHash: hashField(item.beforeHash) ? item.beforeHash : planned?.beforeHash,
          afterHash: hashField(item.afterHash) ? item.afterHash : planned?.afterHash,
          backupRel: item.backupRel
        });
        seen.add(item.rel);
      }
      for (const op of journal.planned) {
        if (seen.has(op.rel)) continue;
        classified.push({
          rel: op.rel,
          beforeHash: op.beforeHash,
          afterHash: op.afterHash,
          backupRel: null
        });
      }

      for (const item of classified) {
        if (!hashField(item.beforeHash) || !hashField(item.afterHash)) {
          await this.block(journal, `Recovery blocked: journal for ${item.rel} is missing before/after hashes.`);
        }
      }

      for (const item of classified) {
        const planned = plannedByRel.get(item.rel);
        await this.assertBackupIntact(journal, item, planned);
      }

      for (const item of classified) {
        const current = await readPresence(resolveProjectPath(this.projectRoot, item.rel));
        const now = fingerprintPresence(current);
        if (now === item.afterHash || now === item.beforeHash) continue;
        await this.block(
          journal,
          `Recovery blocked: ${item.rel} matches neither beforeHash nor afterHash. File, journal, and backups retained.`
        );
      }

      for (const item of [...journal.backups].reverse()) {
        const to = resolveProjectPath(this.projectRoot, item.rel);
        if (item.backupRel) {
          const backupAbs = resolveProjectPath(this.projectRoot, item.backupRel);
          await fs.mkdir(path.dirname(to), { recursive: true });
          await copyFileNoFollow(backupAbs, to);
        } else {
          await unlinkNoFollow(to);
        }
      }

      for (const item of journal.backups) {
        const planned = plannedByRel.get(item.rel);
        const beforeHash = hashField(item.beforeHash) ? item.beforeHash : planned?.beforeHash;
        const current = await readPresence(resolveProjectPath(this.projectRoot, item.rel));
        const now = fingerprintPresence(current);
        const expected = item.backupRel ? beforeHash : null;
        if (now !== expected) {
          await this.block(
            journal,
            `Recovery blocked: read-back of ${item.rel} does not match beforeHash after restore.`
          );
        }
      }

      await this.clear();
      return { recovered: true };
    } catch (err) {
      if (err instanceof ApplyJournalBlockedError) throw err;
      journal.phase = "blocked";
      journal.error = err instanceof Error ? err.message : String(err);
      journal.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.filePath, journal);
      throw new ApplyJournalBlockedError(journal.error);
    }
  }

  private async assertBackupIntact(
    journal: ApplyJournalEntry,
    item: { rel: string; backupRel: string | null; beforeHash?: string | null },
    planned: ApplyJournalOp | undefined
  ): Promise<void> {
    const beforeHash = hashField(item.beforeHash) ? item.beforeHash : planned?.beforeHash;
    if (!item.backupRel) {
      if (beforeHash === null) return;
      return;
    }
    if (beforeHash === null) {
      await this.block(
        journal,
        `Recovery blocked: backup for ${item.rel} exists but beforeHash is absent.`
      );
    }
    if (!hashField(beforeHash)) {
      await this.block(journal, `Recovery blocked: journal for ${item.rel} is missing beforeHash.`);
    }
    const backupAbs = resolveProjectPath(this.projectRoot, item.backupRel);
    const presence = await readPresence(backupAbs);
    if (presence.kind !== "bytes") {
      await this.block(
        journal,
        `Recovery blocked: backup for ${item.rel} is missing or not a regular file.`
      );
    }
    if (fingerprintPresence(presence) !== beforeHash) {
      await this.block(
        journal,
        `Recovery blocked: backup for ${item.rel} does not match beforeHash. File, journal, and backups retained.`
      );
    }
    if (typeof planned?.mode === "number") {
      try {
        const st = await fs.lstat(backupAbs);
        if ((Number(st.mode) & 0o777) !== planned.mode) {
          await this.block(journal, `Recovery blocked: backup mode mismatch for ${item.rel}.`);
        }
      } catch (err) {
        if (err instanceof ApplyJournalBlockedError) throw err;
        await this.block(
          journal,
          `Recovery blocked: backup for ${item.rel} is unreadable (${(err as NodeJS.ErrnoException).code || "error"}).`
        );
      }
    }
  }

  private async block(journal: ApplyJournalEntry, message: string): Promise<never> {
    journal.phase = "blocked";
    journal.error = message;
    journal.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.filePath, journal);
    throw new ApplyJournalBlockedError(message);
  }

  public async begin(batchId: string, planned: ApplyJournalOp[]): Promise<ApplyJournalEntry> {
    for (const op of planned) this.assertJailedRel(op.rel);
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

  public async recordBackup(
    entry: ApplyJournalEntry,
    rel: string,
    backupRel: string | null,
    hashes?: { beforeHash?: string | null; afterHash?: string | null }
  ): Promise<void> {
    this.assertJailedRel(rel);
    if (backupRel) this.assertJailedRel(backupRel);
    entry.phase = "applying";
    entry.backups.push({
      rel,
      backupRel,
      beforeHash: hashes?.beforeHash,
      afterHash: hashes?.afterHash
    });
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
    this.assertJailedRel(rel);
    const backupRel = path.join(".designer", "apply-staging", path.basename(staging), rel);
    this.assertJailedRel(backupRel);
    const backupAbs = resolveProjectPath(this.projectRoot, backupRel);
    await fs.mkdir(path.dirname(backupAbs), { recursive: true });
    await copyFileNoFollow(from, backupAbs);
    return backupRel.replace(/\\/g, "/");
  }

  private assertJailedRel(rel: string): void {
    try {
      resolveProjectPath(this.projectRoot, rel);
    } catch (err) {
      if (err instanceof PathJailError) {
        throw new ApplyJournalBlockedError(`Apply journal path escapes the project (${rel}). Recovery blocked.`);
      }
      throw err;
    }
  }

}

function hashField(value: string | null | undefined): value is string | null {
  return typeof value === "string" || value === null;
}

export { writeFileNoFollow };
