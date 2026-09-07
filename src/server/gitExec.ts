import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GIT_ISOLATED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  XDG_CONFIG_HOME: "/dev/null"
};

export async function git(
  cwd: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync("git", args, {
    cwd,
    env: { ...GIT_ISOLATED_ENV, ...extraEnv },
    maxBuffer: 16 * 1024 * 1024
  });
}

export async function gitBytes(
  cwd: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return await execFileAsync("git", args, {
    cwd,
    encoding: "buffer",
    env: { ...GIT_ISOLATED_ENV, ...extraEnv },
    maxBuffer: 16 * 1024 * 1024
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return await isGitRoot(cwd);
}

export async function isGitRoot(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);
    return path.resolve(stdout.trim()) === path.resolve(cwd);
  } catch {
    return false;
  }
}

export async function gitHead(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await git(cwd, ["rev-parse", "HEAD"]);
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

export async function gitShowBytes(
  cwd: string,
  ref: string,
  rel: string
): Promise<{ kind: "absent" } | { kind: "bytes"; bytes: Buffer } | { kind: "unreadable"; code: string; message: string }> {
  try {
    const { stdout } = await gitBytes(cwd, ["show", `${ref}:${rel}`]);
    return { kind: "bytes", bytes: stdout };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = typeof (err as { stderr?: Buffer | string }).stderr === "string"
      ? (err as { stderr: string }).stderr
      : Buffer.isBuffer((err as { stderr?: Buffer }).stderr)
        ? (err as { stderr: Buffer }).stderr.toString("utf8")
        : message;
    const combined = `${message}\n${stderr}`;
    if (
      /does not exist|exists on disk, but not in|bad revision|is outside repository|not in the/i.test(
        combined
      )
    ) {
      return { kind: "absent" };
    }
    return { kind: "unreadable", code: "GIT_SHOW_FAILED", message: combined.slice(0, 400) };
  }
}
