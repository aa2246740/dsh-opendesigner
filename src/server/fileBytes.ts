import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { PathJailError, assertManagedPath } from "./pathJail.ts";

export type FilePresence =
  | { kind: "absent" }
  | { kind: "bytes"; bytes: Buffer }
  | { kind: "unreadable"; code: string; message: string };

export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function presenceEqual(a: FilePresence, b: FilePresence): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "bytes" && b.kind === "bytes") return a.bytes.equals(b.bytes);
  return a.kind === b.kind;
}

export async function readPresence(filePath: string): Promise<FilePresence> {
  let st: fsSync.Stats;
  try {
    st = await fs.lstat(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code || "UNKNOWN";
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", code, message: err instanceof Error ? err.message : String(err) };
  }
  if (st.isSymbolicLink()) {
    return { kind: "unreadable", code: "PATH_JAIL", message: "symlinks and junctions are not allowed on managed paths" };
  }
  if (st.isDirectory()) {
    return { kind: "unreadable", code: "EISDIR", message: `is a directory: ${filePath}` };
  }
  try {
    const bytes = await fs.readFile(filePath);
    return { kind: "bytes", bytes };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code || "UNKNOWN";
    return { kind: "unreadable", code, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function readFileNoFollow(abs: string): Promise<Buffer> {
  assertManagedPath(abs);
  const flags = fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(abs, flags);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new PathJailError("symlinks and junctions are not allowed on managed paths", code);
    }
    throw err;
  }
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readTextNoFollow(abs: string): Promise<string> {
  return (await readFileNoFollow(abs)).toString("utf8");
}

export async function writeFileNoFollow(abs: string, contents: string | Buffer): Promise<void> {
  assertManagedPath(abs);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  assertManagedPath(path.dirname(abs));
  const flags = fsSync.constants.O_WRONLY | fsSync.constants.O_CREAT | fsSync.constants.O_TRUNC | fsSync.constants.O_NOFOLLOW;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(abs, flags, 0o644);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EEXIST") {
      throw new PathJailError("symlinks and junctions are not allowed on managed paths", code);
    }
    throw err;
  }
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
}

export async function copyFileNoFollow(from: string, to: string): Promise<void> {
  assertManagedPath(from);
  const presence = await readPresence(from);
  if (presence.kind !== "bytes") {
    throw new Error(presence.kind === "absent" ? `ENOENT: ${from}` : presence.message);
  }
  await writeFileNoFollow(to, presence.bytes);
}

export async function unlinkNoFollow(abs: string): Promise<void> {
  let st: fsSync.Stats;
  try {
    st = await fs.lstat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new PathJailError("symlinks and junctions are not allowed on managed paths");
  }
  if (st.isDirectory()) {
    throw new PathJailError(`cannot delete directory as a file: ${abs}`);
  }
  await fs.unlink(abs);
}
