import { createHash } from "node:crypto";
import * as fsSync from "node:fs";
import { contentHash, type FilePresence } from "./fileBytes.ts";

export interface FrozenOp {
  kind: "write" | "delete";
  rel: string;
  mode: number | null;
  beforeHash: string | null;
  afterHash: string | null;
}

export interface FrozenChangeset {
  projectId: string;
  worktreeRelPath: string;
  batchId: string;
  baseVersion: string;
  ops: FrozenOp[];
  afterBytes: Record<string, Buffer>;
}

export function fileModeOf(abs: string): number | null {
  try {
    const st = fsSync.lstatSync(abs);
    if (st.isSymbolicLink() || st.isDirectory()) return null;
    return st.mode & 0o777;
  } catch {
    return null;
  }
}

export function fingerprintPresence(presence: FilePresence): string | null {
  if (presence.kind === "absent") return null;
  if (presence.kind === "unreadable") return `unreadable:${presence.code}`;
  return contentHash(presence.bytes);
}

export function hashFrozenChangeset(changeset: FrozenChangeset): string {
  const hash = createHash("sha256");
  hash.update("frozen-changeset-v1");
  hash.update("\0");
  hash.update(changeset.projectId);
  hash.update("\0");
  hash.update(changeset.worktreeRelPath);
  hash.update("\0");
  hash.update(changeset.batchId);
  hash.update("\0");
  hash.update(changeset.baseVersion);
  hash.update("\0");
  const ops = [...changeset.ops].sort((a, b) => a.rel.localeCompare(b.rel) || a.kind.localeCompare(b.kind));
  for (const op of ops) {
    hash.update(op.kind);
    hash.update("\0");
    hash.update(op.rel);
    hash.update("\0");
    hash.update(op.mode === null ? "mode:none" : `mode:${op.mode}`);
    hash.update("\0");
    hash.update(op.beforeHash ?? "before:none");
    hash.update("\0");
    hash.update(op.afterHash ?? "after:none");
    hash.update("\0");
  }
  const rels = Object.keys(changeset.afterBytes).sort();
  for (const rel of rels) {
    hash.update(rel);
    hash.update("\0");
    hash.update(contentHash(changeset.afterBytes[rel]));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function cloneFrozenChangeset(changeset: FrozenChangeset): FrozenChangeset {
  const afterBytes: Record<string, Buffer> = {};
  for (const [rel, buf] of Object.entries(changeset.afterBytes)) {
    afterBytes[rel] = Buffer.from(buf);
  }
  return {
    projectId: changeset.projectId,
    worktreeRelPath: changeset.worktreeRelPath,
    batchId: changeset.batchId,
    baseVersion: changeset.baseVersion,
    ops: changeset.ops.map((op) => ({
      kind: op.kind,
      rel: op.rel,
      mode: op.mode,
      beforeHash: op.beforeHash,
      afterHash: op.afterHash
    })),
    afterBytes
  };
}
