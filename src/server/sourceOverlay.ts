import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveProjectPath } from "./pathJail.ts";
import { bytesFromBaseline, readBaselinePresence, type BaselinePresence } from "./sourceBaseline.ts";
import { contentHash, managedReplace, managedUnlink, readPresence } from "./fileBytes.ts";
import { ApplyJournal, type ApplyJournalOp } from "./applyJournal.ts";
import { fingerprintPresence } from "./frozenChangeset.ts";

export type OverlayFile = BaselinePresence;

export type SourceOverlay = {
  workspaceId: string;
  worktreeKey: string;
  files: Record<string, OverlayFile>;
};

export type LegacySourceOverlay = Record<string, string | null>;

export type RestorePlanStep = { rel: string; abs: string; bytes: Buffer | null };

export function isV2Overlay(value: unknown): value is SourceOverlay {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SourceOverlay).workspaceId === "string" &&
    typeof (value as SourceOverlay).worktreeKey === "string" &&
    !!(value as SourceOverlay).files &&
    typeof (value as SourceOverlay).files === "object" &&
    !Array.isArray((value as SourceOverlay).files)
  );
}

export function migrateOverlay(raw: unknown): SourceOverlay | null {
  if (!raw) return null;
  if (isV2Overlay(raw)) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const files: Record<string, OverlayFile> = {};
  for (const [rel, value] of Object.entries(raw as LegacySourceOverlay)) {
    if (value === null) files[rel] = { kind: "absent" };
    else if (typeof value === "string") files[rel] = { kind: "text", text: value };
  }
  return { workspaceId: "", worktreeKey: "", files };
}

export function overlayRoot(projectRoot: string, worktreeKey: string): string {
  const key = worktreeKey && worktreeKey.length > 0 ? worktreeKey : ".";
  return resolveProjectPath(projectRoot, key);
}

export async function captureOverlayFiles(
  srcDir: string,
  relPaths: Iterable<string>
): Promise<Record<string, OverlayFile>> {
  const files: Record<string, OverlayFile> = {};
  for (const rel of relPaths) {
    const abs = resolveProjectPath(srcDir, rel);
    files[rel] = await readBaselinePresence(abs);
  }
  return files;
}

export function materializeOverlayEntry(
  srcDir: string,
  rel: string,
  entry: OverlayFile
): RestorePlanStep {
  const abs = resolveProjectPath(srcDir, rel);
  if (entry.kind === "absent") return { rel, abs, bytes: null };
  if (entry.kind === "unreadable") {
    const error = new Error(`CHECKPOINT_UNREADABLE:${rel}:${entry.message}`);
    (error as Error & { code: string }).code = "CHECKPOINT_UNREADABLE";
    throw error;
  }
  if (entry.kind === "binary") {
    const bytes = Buffer.from(entry.base64, "base64");
    if (contentHash(bytes) !== entry.hash) {
      const error = new Error(`CHECKPOINT_HASH_MISMATCH:${rel}`);
      (error as Error & { code: string }).code = "CHECKPOINT_HASH_MISMATCH";
      throw error;
    }
    return { rel, abs, bytes };
  }
  return { rel, abs, bytes: Buffer.from(entry.text, "utf8") };
}

export function materializeRestorePlan(srcDir: string, overlay: SourceOverlay): RestorePlanStep[] {
  return Object.entries(overlay.files).map(([rel, entry]) => materializeOverlayEntry(srcDir, rel, entry));
}

export function restoreJournalPath(srcDir: string): string {
  return path.join(srcDir, ".designer", "restore-journal.json");
}

export function workspaceIdOf(root: string): string {
  return createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);
}

export function inferRestoreSourceDir(plan: RestorePlanStep[]): string {
  if (plan.length === 0) return "";
  const dirs = plan.map((step) => {
    const rel = step.rel.replace(/\\/g, "/");
    const abs = step.abs.replace(/\\/g, "/");
    if (!abs.endsWith(rel)) {
      const error = new Error(`RESTORE_PLAN_ROOT:${step.rel}`);
      (error as Error & { code: string }).code = "RESTORE_PLAN_ROOT";
      throw error;
    }
    const prefix = abs.slice(0, abs.length - rel.length).replace(/\/+$/, "");
    return prefix.length > 0 ? prefix : "/";
  });
  const first = dirs[0]!;
  if (dirs.some((dir) => dir !== first)) {
    const error = new Error("RESTORE_PLAN_ROOT_MISMATCH");
    (error as Error & { code: string }).code = "RESTORE_PLAN_ROOT_MISMATCH";
    throw error;
  }
  return first;
}

export async function recoverRestoreJournal(srcDir: string, workspaceId?: string): Promise<void> {
  const journal = new ApplyJournal(
    srcDir,
    workspaceId ?? workspaceIdOf(srcDir),
    restoreJournalPath(srcDir)
  );
  await journal.recover();
}

export async function applyRestorePlan(plan: RestorePlanStep[]): Promise<void> {
  if (plan.length === 0) return;
  await preflightRestorePlan(plan);
  const srcDir = inferRestoreSourceDir(plan);
  const workspaceId = workspaceIdOf(srcDir);
  const journal = new ApplyJournal(srcDir, workspaceId, restoreJournalPath(srcDir));
  await journal.recover();

  const planned: ApplyJournalOp[] = [];
  for (const step of plan) {
    const current = await readPresence(step.abs);
    if (current.kind === "unreadable") {
      const error = new Error(current.message);
      (error as Error & { code: string }).code = current.code;
      throw error;
    }
    planned.push({
      kind: step.bytes === null ? "delete" : "write",
      rel: step.rel,
      beforeHash: fingerprintPresence(current),
      afterHash: step.bytes === null ? null : contentHash(step.bytes)
    });
  }

  const batchId = `restore-${randomUUID()}`;
  const staging = journal.stagingDir(batchId);
  await fs.mkdir(staging, { recursive: true });
  const entry = await journal.begin(batchId, planned);

  try {
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i]!;
      const op = planned[i]!;
      const current = await readPresence(step.abs);
      let backupRel: string | null = null;
      if (current.kind === "bytes") {
        backupRel = await journal.backupFile(staging, step.rel, step.abs);
      } else if (current.kind === "unreadable") {
        const error = new Error(current.message);
        (error as Error & { code: string }).code = current.code;
        throw error;
      }
      await journal.recordBackup(entry, step.rel, backupRel, {
        beforeHash: op.beforeHash,
        afterHash: op.afterHash
      });
      if (step.bytes === null) {
        await managedUnlink(step.abs, op.beforeHash ?? null);
      } else {
        await managedReplace(step.abs, op.beforeHash ?? null, step.bytes);
      }
    }

    for (const step of plan) {
      const current = await readPresence(step.abs);
      const expected = step.bytes === null ? null : contentHash(step.bytes);
      if (fingerprintPresence(current) !== expected) {
        const error = new Error(`RESTORE_VERIFY:${step.rel}`);
        (error as Error & { code: string }).code = "RESTORE_VERIFY";
        throw error;
      }
    }

    await journal.commit(entry);
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  } catch (err) {
    try {
      await journal.recover();
    } catch (recErr) {
      throw recErr;
    }
    throw err;
  }
}

async function preflightRestorePlan(plan: RestorePlanStep[]): Promise<void> {
  for (const step of plan) {
    let st;
    try {
      st = await fs.lstat(step.abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (st.isSymbolicLink()) {
      const error = new Error(`PATH_JAIL: symlink at restore target ${step.abs}`);
      (error as Error & { code: string }).code = "PATH_JAIL";
      throw error;
    }
    if (st.isDirectory()) {
      const error = new Error(`EISDIR: ${step.abs}`);
      (error as Error & { code: string }).code = "EISDIR";
      throw error;
    }
  }
}

export function bytesFromOverlay(entry: OverlayFile): Buffer | null {
  return bytesFromBaseline(entry);
}
