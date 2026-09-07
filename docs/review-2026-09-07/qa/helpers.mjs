import { pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function sourceRoot() {
  return process.env.REVIEW_SOURCE_ROOT
    ? path.resolve(process.env.REVIEW_SOURCE_ROOT)
    : path.resolve(import.meta.dirname, "../../../src");
}

export function srcHref(rel) {
  return pathToFileURL(path.join(sourceRoot(), rel)).href;
}

export async function loadSrc(rel) {
  return await import(srcHref(rel));
}

export async function makeTempDir(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function git(cwd, args) {
  return await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      XDG_CONFIG_HOME: "/dev/null"
    }
  });
}

export async function initGitRepo(dir) {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ["init", "-b", "main"]);
  await git(dir, ["-c", "user.email=od@test", "-c", "user.name=OpenDesigner", "commit", "--allow-empty", "-m", "init"]);
}

export async function writeAndCommit(dir, rel, contents, message) {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents);
  await git(dir, ["add", "--", rel]);
  await git(dir, ["-c", "user.email=od@test", "-c", "user.name=OpenDesigner", "commit", "-m", message]);
}

export function el(id, extra = {}) {
  return {
    id,
    type: "element",
    tag: extra.tag || "div",
    props: extra.props || {},
    textContent: extra.textContent,
    canvasRect: extra.canvasRect
  };
}
