import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomicWrite.ts";
import { migrateOverlay, type SourceOverlay } from "./sourceOverlay.ts";

export const MAX_CHECKPOINTS = 50;

export type CheckpointKind = "canvas" | "source" | "session";

export interface CheckpointSnapshot {
  byId: Record<string, unknown>;
  childrenByParent: Record<string, unknown>;
  parentByChild: Record<string, unknown>;
  pages: unknown[];
  activePageId: string;
}

export type { SourceOverlay };

export interface Checkpoint {
  id: string;
  createdAt: string;
  label: string;
  kind: CheckpointKind;
  store: CheckpointSnapshot;
  sourceFiles?: SourceOverlay;
  workspaceId?: string;
  worktreeKey?: string;
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  label: string;
  kind: CheckpointKind;
}

export interface RewindPlan {
  index: number;
  truncate: boolean;
  checkpoint: Checkpoint;
}

interface CheckpointLogFile {
  entries: Checkpoint[];
  cursor: number;
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

function nothingToRewind(): Error {
  const error = new Error("Nothing to rewind");
  (error as Error & { code: string }).code = "NOTHING_TO_REWIND";
  return error;
}

function checkpointNotFound(id: string): Error {
  const error = new Error(`Checkpoint ${id} not found`);
  (error as Error & { code: string }).code = "CHECKPOINT_NOT_FOUND";
  return error;
}

export class CheckpointLog {
  public entries: Checkpoint[] = [];
  public cursor = -1;
  private filePath: string;
  private maxEntries: number;

  constructor(filePath: string, maxEntries = MAX_CHECKPOINTS) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
  }

  public current(): Checkpoint | undefined {
    if (this.cursor < 0 || this.cursor >= this.entries.length) return undefined;
    return this.entries[this.cursor];
  }

  public list(): CheckpointSummary[] {
    return this.entries.map(({ id, createdAt, label, kind }) => ({
      id,
      createdAt,
      label,
      kind
    }));
  }

  public async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as CheckpointLogFile;
      const entries = Array.isArray(data.entries) ? cloneSnapshot(data.entries) : [];
      this.entries = entries.map((entry) => {
        const overlay = migrateOverlay(entry.sourceFiles);
        return overlay ? { ...entry, sourceFiles: overlay } : { ...entry, sourceFiles: undefined };
      });
      this.cursor = Number.isInteger(data.cursor) ? data.cursor : this.entries.length - 1;
      if (this.cursor >= this.entries.length) this.cursor = this.entries.length - 1;
    } catch {
      this.entries = [];
      this.cursor = -1;
    }
  }

  public async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, {
      entries: this.entries,
      cursor: this.cursor
    } satisfies CheckpointLogFile);
  }

  public async push(input: {
    label: string;
    kind: CheckpointKind;
    store: CheckpointSnapshot;
    sourceFiles?: SourceOverlay;
    workspaceId?: string;
    worktreeKey?: string;
  }): Promise<Checkpoint> {
    if (this.cursor >= 0 && this.cursor < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.cursor + 1);
    }
    const overlay = migrateOverlay(input.sourceFiles) ?? input.sourceFiles;
    const worktreeKey = overlay?.worktreeKey || input.worktreeKey || ".";
    const workspaceId = overlay?.workspaceId || input.workspaceId;
    const checkpoint: Checkpoint = {
      id: `cp_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      label: input.label,
      kind: input.kind,
      store: cloneSnapshot(input.store),
      sourceFiles: overlay ? cloneSnapshot(overlay) : undefined,
      workspaceId,
      worktreeKey
    };
    this.entries.push(checkpoint);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
    this.cursor = this.entries.length - 1;
    await this.persist();
    return checkpoint;
  }

  public planRewind(): RewindPlan {
    if (this.cursor <= 0) throw nothingToRewind();
    const index = this.cursor - 1;
    return {
      index,
      truncate: false,
      checkpoint: cloneSnapshot(this.entries[index]!)
    };
  }

  public planRewindTo(id: string): RewindPlan {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw checkpointNotFound(id);
    return {
      index,
      truncate: true,
      checkpoint: cloneSnapshot(this.entries[index]!)
    };
  }

  public async commitRewind(plan: RewindPlan): Promise<Checkpoint> {
    this.cursor = plan.index;
    if (plan.truncate) {
      this.entries = this.entries.slice(0, plan.index + 1);
    }
    await this.persist();
    return cloneSnapshot(this.entries[this.cursor]!);
  }

  public async rewind(): Promise<Checkpoint> {
    const plan = this.planRewind();
    return await this.commitRewind(plan);
  }

  public async rewindTo(id: string): Promise<Checkpoint> {
    const plan = this.planRewindTo(id);
    return await this.commitRewind(plan);
  }
}
