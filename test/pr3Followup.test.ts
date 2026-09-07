import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { OpenDesignerService } from "../src/server/index.ts";
import { PathJailError, resolveProjectPath } from "../src/server/pathJail.ts";
import { FlatStore } from "../src/store/flatStore.ts";
import { ApplyJournal } from "../src/server/applyJournal.ts";
import { writeFileNoFollow } from "../src/server/fileBytes.ts";

async function tmp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("PR3-01 parent-dir symlink", () => {
  it("denies a parent directory that is a symlink out of the project", async () => {
    const root = await tmp("pr3-parent-link-");
    const outside = await tmp("pr3-parent-out-");
    await fs.mkdir(path.join(root, "keep"));
    await fs.symlink(outside, path.join(root, "src"));
    assert.throws(() => resolveProjectPath(root, "src/app.tsx"), PathJailError);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
});

describe("PR3-05/06 source patches", () => {
  it("propose/accept writes App.tsx and reject leaves no residue; stale hash refuses", async () => {
    const dir = await tmp("pr3-srcpatch-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return <button className="px-4 bg-indigo-600">Pay now</button>;\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);

    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    assert.ok(button);

    const rejected = await service.executeTool("propose_source_patch", {
      elementId: button!.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(rejected.success, true);
    assert.match(String(rejected.proposal.preview), /App\.tsx/);
    const drop = await service.executeTool("reject_source_patch");
    assert.equal(drop.success, true);
    assert.equal(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), source);

    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button!.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(proposed.success, true);
    const accepted = await service.executeTool("accept_source_patch", {
      proposalId: proposed.proposal.id
    });
    assert.equal(accepted.success, true);
    const after = await fs.readFile(path.join(dir, "src/App.tsx"), "utf8");
    assert.match(after, /bg-emerald-600/);
    assert.doesNotMatch(after, /<button className="px-4 bg-indigo-600">Pay now<\/button>\nexport default/);

    const stalePropose = await service.executeTool("propose_source_patch", {
      elementId: button!.id,
      instruction: "rounded xl",
      live: false
    });
    assert.equal(stalePropose.success, true);
    await fs.writeFile(path.join(dir, "src/App.tsx"), after + "\n");
    const staleAccept = await service.executeTool("accept_source_patch", {
      proposalId: stalePropose.proposal.id
    });
    assert.equal(staleAccept.success, false);
    assert.equal(staleAccept.code, "STALE_PROPOSAL");

    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR3-10 source baselines survive restart", () => {
  it("rewinds a write after constructing a new service on the same root", async () => {
    const dir = await tmp("pr3-baseline-");
    const first = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await first.init();
    const seed = await first.executeTool("checkpoint", { label: "pre" });
    const write = await first.executeTool("project_write", {
      path: "src/keep.tsx",
      content: "created\n"
    });
    assert.equal(write.success, true);

    const second = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await second.init();
    const rewind = await second.executeTool("rewind", { checkpointId: seed.checkpoint.id });
    assert.equal(rewind.success, true);
    const exists = await fs.stat(path.join(dir, "src/keep.tsx")).then(() => true).catch(() => false);
    assert.equal(exists, false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR3-05 rewind after accept", () => {
  it("rewinds the source file after accept", async () => {
    const dir = await tmp("pr3-rewind-accept-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return <button className="px-4 bg-indigo-600">Pay now</button>;\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);
    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    assert.ok(button);
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button!.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(proposed.success, true);
    const accepted = await service.executeTool("accept_source_patch", {
      proposalId: proposed.proposal.id
    });
    assert.equal(accepted.success, true);
    assert.match(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), /bg-emerald-600/);
    const rewind = await service.executeTool("rewind");
    assert.equal(rewind.success, true);
    assert.equal(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), source);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR3-11 apply journal recovery", () => {
  it("restores files from a leftover applying journal", async () => {
    const dir = await tmp("pr3-journal-");
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src/first.txt"), "orig-first\n");
    const workspaceId = "testworkspace";
    const journal = new ApplyJournal(dir, workspaceId, path.join(dir, ".designer", "apply-journal.json"));
    const staging = journal.stagingDir("batch1");
    await fs.mkdir(path.join(staging, "src"), { recursive: true });
    await writeFileNoFollow(path.join(staging, "src/first.txt"), "orig-first\n");
    const entry = await journal.begin("batch1", [{ kind: "write", rel: "src/first.txt" }]);
    await journal.recordBackup(entry, "src/first.txt", path.join(".designer", "apply-staging", "batch1", "src/first.txt"));
    await fs.writeFile(path.join(dir, "src/first.txt"), "partial-new\n");
    const recovered = await journal.recover();
    assert.equal(recovered.recovered, true);
    assert.equal(await fs.readFile(path.join(dir, "src/first.txt"), "utf8"), "orig-first\n");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("PR3-13 FlatStore single parent and active page", () => {
  it("rejects two parents and a missing active page", () => {
    const store = new FlatStore();
    assert.throws(() => {
      store.fromJSON({
        byId: {
          a: { id: "a", type: "element", tag: "div", props: {} },
          b: { id: "b", type: "element", tag: "div", props: {} },
          c: { id: "c", type: "element", tag: "div", props: {} }
        },
        childrenByParent: { a: ["c"], b: ["c"] },
        parentByChild: { c: "a" },
        pages: [],
        activePageId: ""
      });
    });

    store.setElement({ id: "root", type: "element", tag: "div", props: {} });
    store.addPage({ id: "page-home", name: "Home", isLoaded: true, rootElementId: "root" });
    store.setActivePage("page-home");
    assert.throws(() => store.setActivePage("missing"));
  });
});
