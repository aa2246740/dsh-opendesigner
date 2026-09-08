import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export class RuntimeBusyError extends Error {
  readonly code = "RUNTIME_BUSY";
  constructor(message = "Another OpenDesigner runtime already holds this project.") {
    super(message);
    this.name = "RuntimeBusyError";
  }
}

interface LockPayload {
  pid: number;
  acquiredAt: string;
  token: string;
  lockId: string;
}

type LockInspection =
  | { kind: "missing" }
  | { kind: "creating" }
  | { kind: "corrupt" }
  | { kind: "undecidable" }
  | { kind: "held"; payload: LockPayload }
  | { kind: "dead"; payload: LockPayload };

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLockPayload(value: unknown): value is LockPayload {
  if (!isRecord(value)) return false;
  if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) return false;
  if (typeof value.acquiredAt !== "string" || value.acquiredAt.length === 0) return false;
  if (typeof value.token !== "string" || value.token.length === 0) return false;
  if (typeof value.lockId !== "string" || value.lockId.length === 0) return false;
  return true;
}

export class RuntimeLock {
  private readonly filePath: string;
  private held = false;
  private token: string | null = null;
  private lockId: string | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async acquire(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await this.createExclusive();
      this.held = true;
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    const existing = await this.inspect();
    if (existing.kind === "missing") {
      await this.createExclusive();
      this.held = true;
      return;
    }
    if (existing.kind === "dead") {
      await this.reclaimDead(existing.payload);
      this.held = true;
      return;
    }
    throw new RuntimeBusyError(this.busyMessage(existing));
  }

  public async release(): Promise<void> {
    if (!this.held) return;
    const token = this.token;
    const lockId = this.lockId;
    this.held = false;
    this.token = null;
    this.lockId = null;
    if (!token || !lockId) return;
    const existing = await this.inspect();
    if (existing.kind !== "held" && existing.kind !== "dead") return;
    if (existing.payload.token !== token || existing.payload.lockId !== lockId) return;
    await fs.rm(this.filePath, { force: true });
  }

  private async createExclusive(): Promise<void> {
    const token = randomUUID();
    const lockId = randomUUID();
    const payload: LockPayload = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      token,
      lockId
    };
    const handle = await fs.open(this.filePath, "wx");
    try {
      this.token = token;
      this.lockId = lockId;
      await handle.writeFile(`${JSON.stringify(payload)}\n`);
    } finally {
      await handle.close();
    }
  }

  private async reclaimDead(payload: LockPayload): Promise<void> {
    const again = await this.inspect();
    if (again.kind !== "dead") {
      throw new RuntimeBusyError(this.busyMessage(again));
    }
    if (again.payload.token !== payload.token || again.payload.lockId !== payload.lockId) {
      throw new RuntimeBusyError("Lock identity changed while reclaiming a dead writer.");
    }
    await fs.rm(this.filePath, { force: true });
    try {
      await this.createExclusive();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        throw new RuntimeBusyError("Another runtime acquired the lock during reclaim.");
      }
      throw err;
    }
  }

  private async inspect(): Promise<LockInspection> {
    let st;
    try {
      st = await fs.lstat(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      return { kind: "undecidable" };
    }
    if (st.isSymbolicLink() || st.isDirectory()) return { kind: "corrupt" };

    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return { kind: "undecidable" };
    }
    if (raw.trim().length === 0) return { kind: "creating" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: "corrupt" };
    }
    if (!isLockPayload(parsed)) return { kind: "corrupt" };
    if (pidAlive(parsed.pid)) return { kind: "held", payload: parsed };
    return { kind: "dead", payload: parsed };
  }

  private busyMessage(state: LockInspection): string {
    if (state.kind === "held") {
      return `Project already has a writer (pid ${state.payload.pid}). Stop that runtime before starting another.`;
    }
    if (state.kind === "creating") {
      return "A runtime lock is still being created for this project. Wait for that writer or, if no OpenDesigner process is running, delete .designer/runtime.lock.";
    }
    if (state.kind === "corrupt") {
      return "The runtime lock file is corrupt. If no OpenDesigner process is running, delete .designer/runtime.lock and retry.";
    }
    if (state.kind === "undecidable") {
      return "The runtime lock file cannot be inspected. If no OpenDesigner process is running, delete .designer/runtime.lock and retry.";
    }
    return "Another OpenDesigner runtime already holds this project.";
  }
}
