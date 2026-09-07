import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { loadSrc, makeTempDir } from "./helpers.mjs";

const { wrapSandboxSrcdoc, CANVAS_TRUSTED_CSS } = await loadSrc("client/sandbox.ts");

const PROBE_CSS = `.probe{background-color:rgb(16, 185, 129);border-radius:12px;box-shadow:rgb(0, 0, 0) 0px 8px 16px 0px;width:80px;height:40px;}`;

function waitFor(stream, regex, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${regex}: ${buf.slice(-400)}`)), timeoutMs);
    const onData = (chunk) => {
      buf += chunk;
      const match = buf.match(regex);
      if (match) {
        clearTimeout(timer);
        stream.off("data", onData);
        resolve(match);
      }
    };
    stream.on("data", onData);
  });
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (!msg.id || !pending.has(msg.id)) return;
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
      else res(msg.result);
    });
  });
}

async function chromeComputedStyle(url, userDataDir) {
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
      "--remote-debugging-port=0",
      url
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  try {
    const match = await waitFor(proc.stderr, /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/, 10000);
    const browserWs = match[1];
    const port = new URL(browserWs).port;
    let pageWs;
    for (let i = 0; i < 40; i += 1) {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
      const page = targets.find(
        (row) =>
          row.type === "page" &&
          row.webSocketDebuggerUrl &&
          typeof row.url === "string" &&
          row.url.includes("127.0.0.1") &&
          row.url !== "about:blank"
      );
      if (page) {
        pageWs = page.webSocketDebuggerUrl;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!pageWs) throw new Error("chrome page target not found");
    const session = await cdpSession(pageWs);
    try {
      await session.send("Page.enable");
      await session.send("Runtime.enable");
      let dumped;
      for (let i = 0; i < 20; i += 1) {
        try {
          const evaluated = await session.send("Runtime.evaluate", {
            expression: `new Promise((resolve) => {
              const check = () => {
                const title = document.title;
                if (title === "CSS_IFRAME_PASS" || title === "CSS_IFRAME_FAIL") {
                  resolve({
                    title,
                    result: document.getElementById("result")?.textContent || ""
                  });
                  return;
                }
                setTimeout(check, 50);
              };
              check();
            })`,
            awaitPromise: true,
            returnByValue: true
          });
          dumped = evaluated.result.value;
          break;
        } catch (err) {
          if (!String(err).includes("Execution context was destroyed") || i === 19) throw err;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      return dumped;
    } finally {
      session.close();
    }
  } finally {
    proc.kill("SIGKILL");
  }
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
function wait() {
  const childDoc = frame.contentDocument;
  if (childDoc && childDoc.getElementById("child-probe")) report();
  else setTimeout(wait, 20);
}
wait();
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
      const dumped = await chromeComputedStyle(`http://127.0.0.1:${port}/`, userData);
      assert.equal(dumped.title, "CSS_IFRAME_PASS", dumped.result);
      assert.match(dumped.result, /"sheets":[1-9]/);
    } finally {
      server.close();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
