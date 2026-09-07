import * as fs from "node:fs/promises";
import { atomicWriteJson } from "./atomicWrite.ts";
import type { SourceOverlay } from "./checkpoints.ts";

export interface SourceBaselineFile {
  workspaceId: string;
  files: SourceOverlay;
}

export class SourceBaselineStore {
  public files: SourceOverlay = {};
  private readonly filePath: string;
  private readonly workspaceId: string;

  constructor(filePath: string, workspaceId: string) {
    this.filePath = filePath;
    this.workspaceId = workspaceId;
  }

  public async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf-8")) as SourceBaselineFile;
      if (data.workspaceId !== this.workspaceId) {
        this.files = {};
        return;
      }
      this.files = data.files && typeof data.files === "object" ? data.files : {};
    } catch {
      this.files = {};
    }
  }

  public async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, {
      workspaceId: this.workspaceId,
      files: this.files
    } satisfies SourceBaselineFile);
  }

  public remember(rel: string, content: string | null): void {
    if (Object.prototype.hasOwnProperty.call(this.files, rel)) return;
    this.files[rel] = content;
  }

  public overlay(): SourceOverlay {
    return { ...this.files };
  }
}
