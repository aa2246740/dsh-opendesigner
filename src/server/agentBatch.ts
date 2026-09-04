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

    for (const change of await listWorktreeChanges(worktreeAbs)) {
      if (skipRel(change.rel)) continue;
      resolveProjectPath(this.projectRoot, change.rel);
      resolveProjectPath(worktreeAbs, change.rel);
      const from = path.join(worktreeAbs, change.rel);
      const to = path.join(this.projectRoot, change.rel);
      if (change.kind === "delete") {
        await fs.rm(to, { force: true });
        deleted.push(change.rel);
        continue;
      }
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      copied.push(change.rel);
    }

    await this.removeWorktree(batch);
    batch.status = "applied";
    await this.persist();
    return { batchId, status: batch.status, copied, deleted };
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

async function listWorktreeChanges(worktreeAbs: string): Promise<WorktreeChange[]> {
  const { stdout } = await git(worktreeAbs, ["status", "--porcelain", "-uall"]);
  const changes: WorktreeChange[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    let rel = line.slice(3).trim();
    if (rel.startsWith('"') && rel.endsWith('"')) {
      rel = JSON.parse(rel) as string;
    }
    if (status.includes("R") || status.includes("C")) {
      const parts = rel.split(" -> ");
      rel = parts[parts.length - 1] ?? rel;
    }
    if (status.includes("D") && !status.includes("?")) {
      changes.push({ kind: "delete", rel });
    } else {
      changes.push({ kind: "write", rel });
    }
  }
  return changes;
}
