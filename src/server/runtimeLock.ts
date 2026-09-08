import * as fs from "node:fs/promises";
import * as path from "node:path";

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
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class RuntimeLock {
  private readonly filePath: string;
  private held = false;

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
    const existing = await this.readPayload();
    if (existing && pidAlive(existing.pid)) {
      throw new RuntimeBusyError(
        `Project already has a writer (pid ${existing.pid}). Stop that runtime before starting another.`
      );
    }
    await fs.rm(this.filePath, { force: true });
    await this.createExclusive();
    this.held = true;
  }

  public async release(): Promise<void> {
    if (!this.held) return;
    this.held = false;
    await fs.rm(this.filePath, { force: true });
  }

  private async createExclusive(): Promise<void> {
    const handle = await fs.open(this.filePath, "wx");
    try {
      const payload: LockPayload = { pid: process.pid, acquiredAt: new Date().toISOString() };
      await handle.writeFile(`${JSON.stringify(payload)}\n`);
    } finally {
      await handle.close();
    }
  }

  private async readPayload(): Promise<LockPayload | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as LockPayload;
      if (typeof raw.pid !== "number") return null;
      return raw;
    } catch {
      return null;
    }
  }
}
