import * as fs from "node:fs";
import * as path from "node:path";

export class PathJailError extends Error {
  readonly code = "PATH_JAIL";
  readonly causeCode?: string;

  constructor(message: string, causeCode?: string) {
    super(message);
    this.name = "PathJailError";
    this.causeCode = causeCode;
  }
}

function lstatComponent(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code === "ENOTDIR") {
      throw new PathJailError(`path is not a directory: ${target}`, code);
    }
    throw new PathJailError(`cannot inspect path (${code ?? "error"}): ${target}`, code);
  }
}

function assertNotLink(st: fs.Stats, target: string): void {
  if (st.isSymbolicLink()) {
    throw new PathJailError("symlinks and junctions are not allowed on managed paths", "SYMLINK");
  }
}

export function resolveProjectRoot(projectRoot: string): string {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new PathJailError("project root is required");
  }
  const resolved = path.resolve(projectRoot);
  const st = lstatComponent(resolved);
  if (st === null) return resolved;
  assertNotLink(st, resolved);
  if (!st.isDirectory()) {
    throw new PathJailError("project root is not a directory");
  }
  return resolved;
}

export function resolveProjectPath(projectRoot: string, requested: unknown): string {
  if (typeof requested !== "string" || requested.length === 0) {
    throw new PathJailError("path is required");
  }
  if (requested.includes("\0")) {
    throw new PathJailError("path contains a null byte");
  }
  if (path.isAbsolute(requested)) {
    throw new PathJailError("absolute paths are not allowed");
  }

  const root = resolveProjectRoot(projectRoot);
  const candidate = path.resolve(root, requested);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathJailError("path escapes project root");
  }
  if (rel === "") return root;

  const parts = rel.split(path.sep).filter((part) => part.length > 0 && part !== ".");
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const st = lstatComponent(cursor);
    if (st === null) continue;
    assertNotLink(st, cursor);
  }
  return cursor;
}

export function assertManagedPath(abs: string): void {
  const st = lstatComponent(abs);
  if (st === null) return;
  assertNotLink(st, abs);
}
