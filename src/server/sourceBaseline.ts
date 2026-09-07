import * as fs from "node:fs/promises";
import { atomicWriteJson } from "./atomicWrite.ts";
import { contentHash, readPresence } from "./fileBytes.ts";

export type BaselinePresence =
  | { kind: "text"; text: string }
  | { kind: "binary"; hash: string; base64: string }
  | { kind: "absent" }
  | { kind: "unreadable"; code: string; message: string };

export interface SourceBaselineFile {
  workspaceId: string;
  worktrees: Record<string, Record<string, BaselinePresence>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function presenceFromBytes(bytes: Buffer): BaselinePresence {
  if (bytes.includes(0)) {
    return { kind: "binary", hash: contentHash(bytes), base64: bytes.toString("base64") };
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    return { kind: "binary", hash: contentHash(bytes), base64: bytes.toString("base64") };
  }
  return { kind: "text", text };
}

export async function readBaselinePresence(abs: string): Promise<BaselinePresence> {
  const presence = await readPresence(abs);
  if (presence.kind === "absent") return { kind: "absent" };
  if (presence.kind === "unreadable") {
    return { kind: "unreadable", code: presence.code, message: presence.message };
  }
  return presenceFromBytes(presence.bytes);
}

export function bytesFromBaseline(row: BaselinePresence): Buffer | null {
  if (row.kind === "text") return Buffer.from(row.text, "utf8");
  if (row.kind === "binary") return Buffer.from(row.base64, "base64");
  return null;
}

export class SourceBaselineStore {
  public worktrees: Record<string, Record<string, BaselinePresence>> = {};
  private readonly filePath: string;
  private readonly workspaceId: string;

  constructor(filePath: string, workspaceId: string) {
    this.filePath = filePath;
    this.workspaceId = workspaceId;
  }

  public get files(): Record<string, string | null> {
    const main = this.worktrees["."] || {};
    const out: Record<string, string | null> = {};
    for (const [rel, row] of Object.entries(main)) {
      if (row.kind === "text") out[rel] = row.text;
      else if (row.kind === "absent") out[rel] = null;
    }
    return out;
  }

  public async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf-8")) as Record<string, unknown>;
      if (data.workspaceId !== this.workspaceId) {
        this.worktrees = {};
        return;
      }
      if (isRecord(data.worktrees)) {
        this.worktrees = data.worktrees as SourceBaselineFile["worktrees"];
        return;
      }
      if (isRecord(data.files)) {
        const migrated: Record<string, BaselinePresence> = {};
        for (const [rel, value] of Object.entries(data.files)) {
          if (typeof value === "string") migrated[rel] = { kind: "text", text: value };
          else if (value === null) migrated[rel] = { kind: "absent" };
        }
        this.worktrees = { ".": migrated };
        return;
      }
      this.worktrees = {};
    } catch {
      this.worktrees = {};
    }
  }

  public async persist(): Promise<void> {
    await atomicWriteJson(this.filePath, {
      workspaceId: this.workspaceId,
      worktrees: this.worktrees
    } satisfies SourceBaselineFile);
  }

  public remember(worktreeKey: string, rel: string, presence: BaselinePresence): void {
    const bucket = this.worktrees[worktreeKey] ?? (this.worktrees[worktreeKey] = {});
    if (Object.prototype.hasOwnProperty.call(bucket, rel)) return;
    bucket[rel] = presence;
  }

  public overlay(worktreeKey: string): Record<string, BaselinePresence> {
    return { ...(this.worktrees[worktreeKey] || {}) };
  }
}
