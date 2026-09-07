import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { loadSrc, makeTempDir } from "./helpers.mjs";

const { wrapSandboxSrcdoc, CANVAS_TRUSTED_CSS } = await loadSrc("client/sandbox.ts");

const PROBE_CSS = `.probe{background-color:rgb(16, 185, 129);border-radius:12px;box-shadow:rgb(0, 0, 0) 0px 8px 16px 0px;width:80px;height:40px;}`;

function chromeDump(url, userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--no-first-run",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=2000",
        "--timeout=10000",
        "--dump-dom",
        url
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`chrome timed out: ${err.slice(-400)}`));
    }, 15000);
    proc.stdout.on("data", (chunk) => {
      out += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      err += chunk;
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

describe("CSS iframe fixture", () => {
  it("srcdoc carries trusted CSS so iframe styleSheets are not empty", () => {
    const html = wrapSandboxSrcdoc('<div id="probe" class="probe">x</div>', { css: PROBE_CSS });
    assert.match(html, /border-radius:\s*12px/);
    assert.match(html, /background-color:\s*rgb\(16,\s*185,\s*129\)/);
    assert.match(html, /style-src 'unsafe-inline'/);
    assert.ok(typeof CANVAS_TRUSTED_CSS === "string" && CANVAS_TRUSTED_CSS.length > 0);
  });

  it("iframe getComputedStyle matches parent for background, radius, and shadow", async () => {
    const srcdoc = wrapSandboxSrcdoc('<div id="child-probe" class="probe">child</div>', { css: PROBE_CSS });
    const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${PROBE_CSS}</style></head>
<body>
<div id="parent-probe" class="probe">parent</div>
<iframe id="sandbox" sandbox="allow-same-origin" srcdoc="${srcdoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>
<pre id="result">pending</pre>
<script>
function report() {
  const parent = getComputedStyle(document.getElementById("parent-probe"));
  const childDoc = document.getElementById("sandbox").contentDocument;
  const sheets = childDoc ? childDoc.styleSheets.length : 0;
  const childEl = childDoc && childDoc.getElementById("child-probe");
  const child = childEl ? getComputedStyle(childEl) : null;
  const ok = Boolean(child) && sheets > 0
    && parent.backgroundColor === child.backgroundColor
    && parent.borderRadius === child.borderRadius
    && parent.boxShadow === child.boxShadow;
  document.title = ok ? "CSS_IFRAME_PASS" : "CSS_IFRAME_FAIL";
  document.getElementById("result").textContent = JSON.stringify({
    ok, sheets,
    parent: { backgroundColor: parent.backgroundColor, borderRadius: parent.borderRadius, boxShadow: parent.boxShadow },
    child: child ? { backgroundColor: child.backgroundColor, borderRadius: child.borderRadius, boxShadow: child.boxShadow } : null
  });
}
const frame = document.getElementById("sandbox");
if (frame.contentDocument && frame.contentDocument.readyState === "complete") report();
else frame.addEventListener("load", report);
</script>
</body></html>`;

    const dir = await makeTempDir("pr3-css-");
    const file = path.join(dir, "page.html");
    const userData = path.join(dir, "chrome-profile");
    await fs.writeFile(file, page);
    await fs.mkdir(userData);

    const server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await fs.readFile(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      const dumped = await chromeDump(`http://127.0.0.1:${port}/`, userData);
      assert.match(dumped.out, /CSS_IFRAME_PASS/);
      assert.match(dumped.out, /"sheets":[1-9]/);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
