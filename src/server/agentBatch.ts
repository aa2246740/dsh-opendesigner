import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomicWrite.ts";
import { git, gitHead, isGitRepo } from "./gitExec.ts";
import { resolveProjectPath } from "./pathJail.ts";

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

export class AgentBatchRegistry {
  public batches: AgentBatch[] = [];
  private projectRoot: string;
  private filePath: string;

  constructor(projectRoot: string, filePath: string) {
    this.projectRoot = projectRoot;
    this.filePath = filePath;
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

  public async apply(batchId: string): Promise<BatchApplyResult> {
    const batch = this.requireOpen(batchId);
    const worktreeAbs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
    const copied: string[] = [];
    const deleted: string[] = [];
    const planned = (await listWorktreeChanges(worktreeAbs, batch.baseRef)).filter((change) => !skipRel(change.rel));

    for (const change of planned) {
      resolveProjectPath(this.projectRoot, change.rel);
      resolveProjectPath(worktreeAbs, change.rel);
    }

    const conflicts: { rel: string; reason: string }[] = [];
    for (const change of planned) {
      const reason = await detectConflict({
        projectRoot: this.projectRoot,
        worktreeAbs,
        baseRef: batch.baseRef,
        change
      });
      if (reason) conflicts.push({ rel: change.rel, reason });
    }
    if (conflicts.length > 0) {
      throw new BatchError(
        `Refusing apply: ${conflicts.length} conflict(s): ${conflicts.map((c) => c.rel).join(", ")}`,
        "BATCH_CONFLICT"
      );
    }

    const staging = path.join(this.projectRoot, ".designer", "apply-staging", batch.batchId);
    await fs.mkdir(staging, { recursive: true });
    const backups: { rel: string; backup: string | null }[] = [];

    try {
      for (const change of planned) {
        const to = path.join(this.projectRoot, change.rel);
        let backup: string | null = null;
        try {
          const st = await fs.lstat(to);
          if (st.isDirectory()) {
            throw new BatchError(`Cannot overwrite directory: ${change.rel}`, "APPLY_FAILED");
          }
          backup = path.join(staging, change.rel);
          await fs.mkdir(path.dirname(backup), { recursive: true });
          await fs.copyFile(to, backup);
        } catch (err) {
          if (err instanceof BatchError) throw err;
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        backups.push({ rel: change.rel, backup });

        if (change.kind === "delete") {
          await fs.rm(to, { force: true });
          deleted.push(change.rel);
          continue;
        }
        const from = path.join(worktreeAbs, change.rel);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        copied.push(change.rel);
      }
    } catch (err) {
      for (const item of [...backups].reverse()) {
        const to = path.join(this.projectRoot, item.rel);
        if (item.backup) {
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.copyFile(item.backup, to);
        } else {
          await fs.rm(to, { force: true });
        }
      }
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }

    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await this.removeWorktree(batch);
    batch.status = "applied";
    await this.persist();
    return { batchId, status: batch.status, copied, deleted };
  }

  public async previewDiffs(batchId: string): Promise<{ rel: string; kind: "write" | "delete" }[]> {
    const batch = this.requireOpen(batchId);
    const worktreeAbs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
    return (await listWorktreeChanges(worktreeAbs, batch.baseRef)).filter((change) => !skipRel(change.rel));
  }

  public worktreeAbs(batch: AgentBatch): string {
    return resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
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

async function readOptional(filePath: string): Promise<string | null> {
  try {
    const st = await fs.lstat(filePath);
    if (st.isDirectory()) return null;
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function gitShow(cwd: string, ref: string, rel: string): Promise<string | null> {
  try {
    const { stdout } = await git(cwd, ["show", `${ref}:${rel}`]);
    return stdout;
  } catch {
    return null;
  }
}

async function detectConflict(input: {
  projectRoot: string;
  worktreeAbs: string;
  baseRef: string;
  change: WorktreeChange;
}): Promise<string | null> {
  const mainPath = path.join(input.projectRoot, input.change.rel);
  const wtPath = path.join(input.worktreeAbs, input.change.rel);
  const base = await gitShow(input.projectRoot, input.baseRef, input.change.rel);
  const main = await readOptional(mainPath);

  if (input.change.kind === "delete") {
    if (main === null) return null;
    if (base !== null && main !== base) {
      return "user modified a file the batch deletes";
    }
    return null;
  }

  const wt = await readOptional(wtPath);
  if (main === wt) return null;
  if (main === null) return null;
  if (base === null && main !== wt) {
    return "user created a different file at this path";
  }
  if (base !== null && main !== base && main !== wt) {
    return "user modified this file concurrently";
  }
  return null;
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
