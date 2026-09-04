import * as path from "node:path";

export class PathJailError extends Error {
  readonly code = "PATH_JAIL";

  constructor(message: string) {
    super(message);
    this.name = "PathJailError";
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

  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, requested);
  const rel = path.relative(root, resolved);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathJailError("path escapes project root");
  }

  return resolved;
}
