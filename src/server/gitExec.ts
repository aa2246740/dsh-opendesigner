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

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
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
