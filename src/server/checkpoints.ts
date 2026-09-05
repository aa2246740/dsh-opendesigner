import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomicWrite.ts";

export const MAX_CHECKPOINTS = 50;

export type CheckpointKind = "canvas" | "source" | "session";

export interface CheckpointSnapshot {
  byId: Record<string, unknown>;
  childrenByParent: Record<string, unknown>;
  parentByChild: Record<string, unknown>;
  pages: unknown[];
  activePageId: string;
}

export interface Checkpoint {
  id: string;
  createdAt: string;
  label: string;
  kind: CheckpointKind;
  store: CheckpointSnapshot;
  sourceFiles?: Record<string, string>;
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  label: string;
  kind: CheckpointKind;
}

interface CheckpointLogFile {
  entries: Checkpoint[];
  cursor: number;
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
      this.entries = Array.isArray(data.entries) ? data.entries : [];
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
    sourceFiles?: Record<string, string>;
  }): Promise<Checkpoint> {
    if (this.cursor >= 0 && this.cursor < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.cursor + 1);
    }
    const checkpoint: Checkpoint = {
      id: `cp_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      label: input.label,
      kind: input.kind,
      store: input.store,
      sourceFiles: input.sourceFiles
    };
    this.entries.push(checkpoint);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }
    this.cursor = this.entries.length - 1;
    await this.persist();
    return checkpoint;
  }

  public async rewind(): Promise<Checkpoint> {
    if (this.cursor <= 0) {
      const error = new Error("Nothing to rewind");
      (error as Error & { code: string }).code = "NOTHING_TO_REWIND";
      throw error;
    }
    this.cursor -= 1;
    await this.persist();
    return this.entries[this.cursor]!;
  }

  public async rewindTo(id: string): Promise<Checkpoint> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      const error = new Error(`Checkpoint ${id} not found`);
      (error as Error & { code: string }).code = "CHECKPOINT_NOT_FOUND";
      throw error;
    }
    this.cursor = index;
    this.entries = this.entries.slice(0, index + 1);
    await this.persist();
    return this.entries[this.cursor]!;
  }
}
