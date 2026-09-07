import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpenDesignerService, ProjectMismatchError, StaleHydrateError } from "../src/server/index.ts";
import { detectAiConfigFromEnv, generateAndApplyLive } from "../src/server/aiGateway.ts";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const defaultProject = path.join(root, "examples/programmer-page");
const projectRoot = path.resolve(process.env.OPENDESIGNER_PROJECT_ROOT || defaultProject);
await fs.mkdir(projectRoot, { recursive: true });

async function ensurePreviewGit(dir) {
  try {
    await fs.stat(path.join(dir, ".git"));
    return;
  } catch {
    // Create a git root for the preview project.
  }
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
  await execFileAsync(
    "git",
    ["-c", "user.email=preview@local", "-c", "user.name=OpenDesigner", "add", "-A"],
    { cwd: dir }
  );
  await execFileAsync(
    "git",
    ["-c", "user.email=preview@local", "-c", "user.name=OpenDesigner", "commit", "--allow-empty", "-m", "preview project"],
    { cwd: dir }
  );
}

await ensurePreviewGit(projectRoot);

const service = new OpenDesignerService({
  projectRoot,
  autoApprove: false,
  screenshotMode: "html-render",
  aiConfig: {
    ...detectAiConfigFromEnv(),
    mockMode: process.env.OPENDESIGNER_FORCE_MOCK === "1" ? true : undefined
  }
});
await service.init();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const CSP =
  "default-src 'self'; script-src 'self' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'";

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function isPublicFile(resolved) {
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (resolved === path.join(root, "preview.html")) return true;
  if (rel === "preview" || rel.startsWith(`preview${path.sep}`)) return true;
  if (rel === "lib" || rel.startsWith(`lib${path.sep}`)) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (url.pathname === "/api/status") {
    send(res, 200, JSON.stringify(service.status()), MIME[".json"]);
    return;
  }

  if (url.pathname === "/api/canvas" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    try {
      service.hydrateStore(payload);
      send(
        res,
        200,
        JSON.stringify({
          success: true,
          projectId: service.projectId,
          version: service.storeVersion
        }),
        MIME[".json"]
      );
    } catch (err) {
      const code =
        err instanceof StaleHydrateError || err instanceof ProjectMismatchError
          ? err.code
          : err && typeof err === "object" && "code" in err
            ? err.code
            : "HYDRATE_FAILED";
      send(
        res,
        409,
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
          code,
          projectId: service.projectId,
          version: service.storeVersion
        }),
        MIME[".json"]
      );
    }
    return;
  }

  if (url.pathname === "/api/canvas") {
    send(res, 200, JSON.stringify(service.canvasPayload()), MIME[".json"]);
    return;
  }

  if (url.pathname === "/api/tool" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    try {
      const result = await service.executeTool(payload.tool, payload.args || {}, {
        approvalChannel: "host"
      });
      send(res, 200, JSON.stringify(result), MIME[".json"]);
    } catch (err) {
      send(
        res,
        200,
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err)
        }),
        MIME[".json"]
      );
    }
    return;
  }

  if (url.pathname === "/api/ai-merge" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const forceMock = process.env.OPENDESIGNER_FORCE_MOCK === "1";
    const result = forceMock
      ? await service.aiGateway.generateAndApply(
          {
            sourceCode: payload.sourceCode,
            instruction: payload.instruction
          },
          { fallbackToMock: true }
        )
      : await generateAndApplyLive(
          {
            sourceCode: payload.sourceCode,
            instruction: payload.instruction
          },
          { fallbackToMock: false, timeoutMs: 90_000, maxRetriesPerProvider: 1 }
        );
    send(
      res,
      200,
      JSON.stringify({
        success: result.success,
        mergedCode: result.mergedCode,
        model: result.model,
        provider: result.provider || null,
        error: result.error,
        mockMode: forceMock || result.fallback === true,
        fallback: result.fallback === true,
        liveError: result.liveError || null,
        attemptsLog: result.attemptsLog || []
      }),
      MIME[".json"]
    );
    return;
  }

  let filePath = url.pathname === "/" ? path.join(root, "preview.html") : path.join(root, decodeURIComponent(url.pathname));
  const resolved = path.resolve(filePath);
  if (!isPublicFile(resolved)) {
    send(res, 403, "forbidden");
    return;
  }
  try {
    const body = await fs.readFile(resolved);
    const ext = path.extname(resolved);
    send(res, 200, body, MIME[ext] || "application/octet-stream");
  } catch {
    send(res, 404, "not found");
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`OpenDesigner preview http://127.0.0.1:${port}/`);
  console.log(`projectRoot ${projectRoot}`);
  console.log(`status ${JSON.stringify(service.status())}`);
});
