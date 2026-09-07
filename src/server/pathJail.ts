import * as fs from "node:fs";
import * as path from "node:path";

export class PathJailError extends Error {
  readonly code = "PATH_JAIL";

  constructor(message: string) {
    super(message);
    this.name = "PathJailError";
  }
}

function tryRealpath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function realExistingPrefix(target: string): { existing: string; missing: string[] } {
  const missing: string[] = [];
  let cursor = path.resolve(target);
  while (true) {
    const real = tryRealpath(cursor);
    if (real) {
      return { existing: real, missing };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return { existing: cursor, missing };
    }
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
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

  const rootResolved = path.resolve(projectRoot);
  const root = tryRealpath(rootResolved) ?? rootResolved;
  const candidate = path.resolve(root, requested);
  const { existing, missing } = realExistingPrefix(candidate);
  const resolved = path.resolve(existing, ...missing);
  const rel = path.relative(root, resolved);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathJailError("path escapes project root");
  }

  return resolved;
}
