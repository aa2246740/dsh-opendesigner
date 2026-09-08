import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomicWrite.ts";
import { git, gitHead, gitShowBytes, isGitRepo } from "./gitExec.ts";
import { resolveProjectPath } from "./pathJail.ts";
import {
  type FilePresence,
  contentHash,
  presenceEqual,
  readPresence,
  managedReplace,
  managedUnlink
} from "./fileBytes.ts";
import { ApplyJournal, type ApplyJournalOp } from "./applyJournal.ts";
import {
  cloneFrozenChangeset,
  fileModeOf,
  fingerprintPresence,
  hashFrozenChangeset,
  type FrozenChangeset,
  type FrozenOp
} from "./frozenChangeset.ts";

export class GitRequiredError extends Error {
  readonly code = "GIT_REQUIRED";

  constructor(message = "Agent-batch worktrees need a git repository. Canvas checkpoints, working-copy autosave, Save/Apply, and the path jail still work without git.") {
    super(message);
    this.name = "GitRequiredError";
  }
}

export class BatchError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "BatchError";
    this.code = code;
  }
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
  conflicts?: { rel: string; reason: string }[];
}

const BATCH_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function assertBatchId(batchId: string): void {
  if (!BATCH_ID_RE.test(batchId)) {
    throw new BatchError("batchId must match [a-zA-Z0-9_-]+", "INVALID_BATCH_ID");
  }
}

function worktreeRelPath(batchId: string): string {
  return path.join(".designer", "worktrees", batchId);
}

function skipRel(rel: string): boolean {
  const normalized = rel.replace(/\\/g, "/");
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".designer" ||
    normalized.startsWith(".designer/")
  );
}

function splitNul(raw: string | Buffer): string[] {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  return text.split("\0").filter((part) => part.length > 0);
}

function parseDiffNameStatus(raw: string): WorktreeChange[] {
  const parts = splitNul(raw);
  const changes: WorktreeChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i++];
    if (!status) continue;
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = parts[i++] || "";
      const newPath = parts[i++] || "";
      if (oldPath) changes.push({ kind: "delete", rel: oldPath.replace(/\\/g, "/") });
      if (newPath) changes.push({ kind: "write", rel: newPath.replace(/\\/g, "/") });
    } else if (code === "D") {
      const rel = (parts[i++] || "").replace(/\\/g, "/");
      if (rel) changes.push({ kind: "delete", rel });
    } else {
      const rel = (parts[i++] || "").replace(/\\/g, "/");
      if (rel) changes.push({ kind: "write", rel });
    }
  }
  return changes;
}

function parsePorcelainZ(raw: string): string[] {
  const parts = splitNul(raw);
  const rels: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const entry = parts[i++];
    if (entry.length < 3) continue;
    const xy0 = entry[0];
    const rel = entry.slice(3).replace(/\\/g, "/");
    if (xy0 === "R" || xy0 === "C") {
      const orig = (parts[i++] || "").replace(/\\/g, "/");
      if (rel) rels.push(rel);
      if (orig) rels.push(orig);
    } else if (rel) {
      rels.push(rel);
    }
  }
  return rels;
}

function workspaceIdOf(projectRoot: string): string {
  return createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 12);
}

export function detectThreeWayConflict(input: {
  kind: "write" | "delete";
  base: FilePresence;
  current: FilePresence;
  candidate: FilePresence;
}): string | null {
  if (input.base.kind === "unreadable") {
    return `base blob unreadable (${input.base.code})`;
  }
  if (input.current.kind === "unreadable") {
    return `current file unreadable (${input.current.code})`;
  }
  if (input.kind === "write" && input.candidate.kind === "unreadable") {
    return `candidate unreadable (${input.candidate.code})`;
  }

  if (input.kind === "delete") {
    if (input.current.kind === "absent") return null;
    if (
      input.base.kind === "bytes" &&
      input.current.kind === "bytes" &&
      !input.base.bytes.equals(input.current.bytes)
    ) {
      return "user modified a file the batch deletes";
    }
    return null;
  }

  if (presenceEqual(input.current, input.candidate)) return null;

  if (input.current.kind === "absent") {
    if (input.base.kind === "bytes") {
      return "user deleted a file the batch modifies";
    }
    return null;
  }

  if (input.base.kind === "absent") {
    return "user created a different file at this path";
  }
  if (
    input.base.kind === "bytes" &&
    input.current.kind === "bytes" &&
    input.candidate.kind === "bytes" &&
    !input.base.bytes.equals(input.current.bytes) &&
    !input.current.bytes.equals(input.candidate.bytes)
  ) {
    return "user modified this file concurrently";
  }
  return null;
}

export class AgentBatchRegistry {
  public batches: AgentBatch[] = [];
  private projectRoot: string;
  private filePath: string;
  private workspaceId: string;
  private journal: ApplyJournal;
  private writeChain: Promise<unknown> = Promise.resolve();
  public beforeManagedWrite?: (abs: string) => Promise<void>;

  constructor(projectRoot: string, filePath: string, workspaceId?: string) {
    this.projectRoot = projectRoot;
    this.filePath = filePath;
    this.workspaceId = workspaceId ?? workspaceIdOf(projectRoot);
    this.journal = new ApplyJournal(
      projectRoot,
      this.workspaceId,
      path.join(path.dirname(filePath), "apply-journal.json")
    );
  }

  public openBatch(): AgentBatch | undefined {
    return this.batches.find((batch) => batch.status === "open");
  }

  public get(batchId: string): AgentBatch | undefined {
    return this.batches.find((batch) => batch.batchId === batchId);
  }

  public async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as { batches?: AgentBatch[] };
      this.batches = Array.isArray(data.batches) ? data.batches : [];
    } catch {
      this.batches = [];
    }
    await this.journal.recover();
  }

  public async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, { batches: this.batches });
  }

  public async create(label?: string): Promise<AgentBatch> {
    if (this.openBatch()) {
      throw new BatchError("An agent batch is already open", "BATCH_OPEN");
    }
    if (!(await isGitRepo(this.projectRoot))) {
      throw new GitRequiredError();
    }
    const head = await gitHead(this.projectRoot);
    if (!head) {
      throw new GitRequiredError("Agent-batch worktrees need a git commit (HEAD). Canvas checkpoints still work.");
    }
    await assertNoDirtyProject(this.projectRoot);

    const batchId = randomUUID();
    const rel = worktreeRelPath(batchId);
    const abs = resolveProjectPath(this.projectRoot, rel);
    const branch = `opendesigner/batch-${batchId.slice(0, 8)}`;

    await fs.mkdir(path.dirname(abs), { recursive: true });
    try {
      await git(this.projectRoot, ["worktree", "add", "-b", branch, abs, "HEAD"]);
    } catch (err) {
      await fs.rm(abs, { recursive: true, force: true }).catch(() => undefined);
      const detail = err instanceof Error ? err.message : String(err);
      throw new BatchError(`Failed to create jailed worktree: ${detail}`, "WORKTREE_CREATE_FAILED");
    }

    const batch: AgentBatch = {
      batchId,
      status: "open",
      worktreeRelPath: rel,
      branch,
      baseRef: head,
      createdAt: new Date().toISOString(),
      label,
      isolation: "worktree"
    };
    this.batches.push(batch);
    await this.persist();
    return batch;
  }

  public async discard(batchId: string): Promise<AgentBatch> {
    const batch = this.requireOpen(batchId);
    await this.removeWorktree(batch);
    batch.status = "discarded";
    await this.persist();
    return batch;
  }

  public async captureFrozen(batchId: string): Promise<FrozenChangeset> {
    const batch = this.requireOpen(batchId);
    const worktreeAbs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
    const planned = (await listWorktreeChanges(worktreeAbs, batch.baseRef)).filter((change) => !skipRel(change.rel));
    const ops: FrozenOp[] = [];
    const afterBytes: Record<string, Buffer> = {};

    for (const change of planned) {
      resolveProjectPath(this.projectRoot, change.rel);
      resolveProjectPath(worktreeAbs, change.rel);
      const mainPath = resolveProjectPath(this.projectRoot, change.rel);
      const wtPath = resolveProjectPath(worktreeAbs, change.rel);
      const current = await readPresence(mainPath);
      const candidate = change.kind === "delete" ? ({ kind: "absent" } as const) : await readPresence(wtPath);
      if (change.kind === "write" && candidate.kind !== "bytes") {
        throw new BatchError(`Candidate missing for ${change.rel}`, "APPLY_FAILED");
      }
      const op: FrozenOp = {
        kind: change.kind,
        rel: change.rel,
        mode: change.kind === "write" ? fileModeOf(wtPath) : fileModeOf(mainPath),
        beforeHash: fingerprintPresence(current),
        afterHash: fingerprintPresence(candidate)
      };
      ops.push(op);
      if (candidate.kind === "bytes") afterBytes[change.rel] = Buffer.from(candidate.bytes);
    }

    const frozen: FrozenChangeset = {
      projectId: this.workspaceId,
      worktreeRelPath: batch.worktreeRelPath,
      batchId: batch.batchId,
      baseVersion: batch.baseRef,
      ops,
      afterBytes
    };
    return cloneFrozenChangeset(frozen);
  }

  public async prepareApply(batchId: string): Promise<FrozenChangeset> {
    await this.journal.recover();
    this.requireOpen(batchId);
    const frozen = await this.captureFrozen(batchId);
    await this.assertFrozenConflicts(batchId, frozen);
    return frozen;
  }

  public async commitPrepared(frozen: FrozenChangeset): Promise<BatchApplyResult> {
    return this.enqueueWrite(() => this.commitPreparedInner(frozen));
  }

  public async apply(batchId: string): Promise<BatchApplyResult> {
    return this.enqueueWrite(async () => {
      await this.journal.recover();
      const frozen = await this.captureFrozen(batchId);
      return await this.commitPreparedInner(frozen);
    });
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async commitPreparedInner(frozen: FrozenChangeset): Promise<BatchApplyResult> {
    await this.journal.recover();
    const batch = this.requireOpen(frozen.batchId);
    if (frozen.projectId !== this.workspaceId) {
      throw new BatchError("Frozen changeset project does not match this workspace.", "BATCH_CONFLICT");
    }
    if (frozen.batchId !== batch.batchId || frozen.worktreeRelPath !== batch.worktreeRelPath) {
      throw new BatchError("Frozen changeset does not match the open batch.", "BATCH_CONFLICT");
    }
    if (frozen.baseVersion !== batch.baseRef) {
      throw new BatchError("Frozen changeset baseVersion does not match the batch baseRef.", "BATCH_CONFLICT");
    }
    await this.assertFrozenConflicts(batch.batchId, frozen);
    const copied: string[] = [];
    const deleted: string[] = [];
    const staging = this.journal.stagingDir(batch.batchId);
    await fs.mkdir(staging, { recursive: true });
    const planned: ApplyJournalOp[] = frozen.ops.map((op) => ({
      kind: op.kind,
      rel: op.rel,
      mode: op.mode,
      beforeHash: op.beforeHash,
      afterHash: op.afterHash
    }));
    const entry = await this.journal.begin(batch.batchId, planned);

    try {
      for (const op of frozen.ops) {
        const to = resolveProjectPath(this.projectRoot, op.rel);
        const current = await readPresence(to);
        const nowHash = fingerprintPresence(current);
        if (nowHash !== op.beforeHash) {
          throw new BatchError(
            `Refusing apply: ${op.rel} changed after preflight (expected-before mismatch)`,
            "BATCH_CONFLICT"
          );
        }
        let backupRel: string | null = null;
        if (current.kind === "bytes") {
          backupRel = await this.journal.backupFile(staging, op.rel, to);
        } else if (current.kind === "unreadable") {
          throw new BatchError(`Cannot apply over ${op.rel}: ${current.message}`, "APPLY_FAILED");
        }
        await this.journal.recordBackup(entry, op.rel, backupRel, {
          beforeHash: op.beforeHash,
          afterHash: op.afterHash
        });

        if (this.beforeManagedWrite) {
          await this.beforeManagedWrite(to);
        }

        try {
          if (op.kind === "delete") {
            await managedUnlink(to, op.beforeHash);
            deleted.push(op.rel);
            continue;
          }
          const bytes = frozen.afterBytes[op.rel];
          if (!bytes) {
            throw new BatchError(`Frozen candidate missing for ${op.rel}`, "APPLY_FAILED");
          }
          const pinnedBytes = Buffer.from(bytes);
          if (op.afterHash && contentHash(pinnedBytes) !== op.afterHash) {
            throw new BatchError(`Frozen candidate hash mismatch for ${op.rel}`, "APPLY_FAILED");
          }
          await managedReplace(to, op.beforeHash, pinnedBytes);
          if (typeof op.mode === "number") {
            await fs.chmod(to, op.mode);
          }
          copied.push(op.rel);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith("BATCH_CONFLICT:")) {
            throw new BatchError(
              `Refusing apply: ${op.rel} changed after preflight (expected-before mismatch)`,
              "BATCH_CONFLICT"
            );
          }
          throw err;
        }
      }
    } catch (err) {
      try {
        await this.journal.recover();
      } catch (recErr) {
        if (err instanceof BatchError && err.code === "BATCH_CONFLICT") throw err;
        throw recErr;
      }
      throw err;
    }

    await this.journal.commit(entry);
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await this.removeWorktree(batch);
    batch.status = "applied";
    await this.persist();
    return { batchId: frozen.batchId, status: batch.status, copied, deleted };
  }

  private async assertFrozenConflicts(batchId: string, frozen: FrozenChangeset): Promise<void> {
    const batch = this.requireOpen(batchId);
    const conflicts: { rel: string; reason: string }[] = [];
    for (const op of frozen.ops) {
      const mainPath = resolveProjectPath(this.projectRoot, op.rel);
      const current = await readPresence(mainPath);
      const base = await gitShowBytes(this.projectRoot, batch.baseRef, op.rel);
      const candidate: FilePresence =
        op.kind === "delete"
          ? { kind: "absent" }
          : frozen.afterBytes[op.rel]
            ? { kind: "bytes", bytes: frozen.afterBytes[op.rel] }
            : { kind: "absent" };
      const reason = detectThreeWayConflict({
        kind: op.kind,
        base,
        current,
        candidate
      });
      if (reason) conflicts.push({ rel: op.rel, reason });
    }
    if (conflicts.length > 0) {
      throw new BatchError(
        `Refusing apply: ${conflicts.length} conflict(s): ${conflicts.map((c) => `${c.rel} (${c.reason})`).join(", ")}`,
        "BATCH_CONFLICT"
      );
    }
  }

  public async previewDiffs(batchId: string): Promise<{ rel: string; kind: "write" | "delete" }[]> {
    const batch = this.requireOpen(batchId);
    const worktreeAbs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
    return (await listWorktreeChanges(worktreeAbs, batch.baseRef)).filter((change) => !skipRel(change.rel));
  }

  public worktreeAbs(batch: AgentBatch): string {
    return resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
  }

  public async diffHash(batchId: string): Promise<string> {
    const frozen = await this.captureFrozen(batchId);
    return hashFrozenChangeset(frozen);
  }

  private requireOpen(batchId: string): AgentBatch {
    assertBatchId(batchId);
    const batch = this.get(batchId);
    if (!batch) {
      throw new BatchError(`Agent batch ${batchId} not found`, "BATCH_NOT_FOUND");
    }
    if (batch.status !== "open") {
      throw new BatchError(`Agent batch ${batchId} is ${batch.status}`, "BATCH_NOT_OPEN");
    }
    return batch;
  }

  private async removeWorktree(batch: AgentBatch): Promise<void> {
    const abs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
    try {
      await git(this.projectRoot, ["worktree", "remove", "--force", abs]);
    } catch {
      await fs.rm(abs, { recursive: true, force: true });
      await git(this.projectRoot, ["worktree", "prune"]).catch(() => undefined);
    }
    await git(this.projectRoot, ["branch", "-D", batch.branch]).catch(() => undefined);
  }
}

interface WorktreeChange {
  kind: "write" | "delete";
  rel: string;
}

async function assertNoDirtyProject(cwd: string): Promise<void> {
  const { stdout } = await git(cwd, ["status", "-z", "--porcelain=v1"]);
  const dirty = parsePorcelainZ(stdout).filter((rel) => !skipRel(rel));
  if (dirty.length > 0) {
    throw new BatchError(
      `Project has uncommitted changes (${dirty.slice(0, 8).join(", ")}). Commit or stash them before creating an agent batch.`,
      "DIRTY_WORKTREE"
    );
  }
}

export async function listWorktreeChanges(worktreeAbs: string, baseRef: string): Promise<WorktreeChange[]> {
  const byRel = new Map<string, WorktreeChange>();

  const { stdout: diffOut } = await git(worktreeAbs, [
    "diff",
    "-z",
    "--name-status",
    "--find-renames",
    baseRef
  ]);
  for (const change of parseDiffNameStatus(diffOut)) {
    byRel.set(`${change.kind}:${change.rel}`, change);
  }

  const { stdout: untracked } = await git(worktreeAbs, ["ls-files", "-z", "--others", "--exclude-standard"]);
  for (const rel of splitNul(untracked)) {
    const normalized = rel.replace(/\\/g, "/");
    if (!normalized || skipRel(normalized)) continue;
    byRel.set(`write:${normalized}`, { kind: "write", rel: normalized });
  }

  const merged = new Map<string, WorktreeChange>();
  for (const change of byRel.values()) {
    merged.set(`${change.kind}:${change.rel}`, change);
  }
  return [...merged.values()];
}
