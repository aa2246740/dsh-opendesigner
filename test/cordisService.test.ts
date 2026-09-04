import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  OpenDesignerService,
  Context,
  apply,
  name as pluginName,
  inject as pluginInject
} from "../src/server/index.ts";
import type { CordisToolDef } from "../src/server/cordis.ts";

const CORDIS_TEST_DIR = path.resolve(process.cwd(), "test-fixtures/cordis-test");

describe("Server - Cordis Microkernel Service & Tools Injection", () => {
  before(async () => {
    await fs.mkdir(CORDIS_TEST_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(CORDIS_TEST_DIR, { recursive: true, force: true });
  });

  it("should conform to DSH plugin form specification (apply, name, inject)", () => {
    assert.equal(pluginName, "dsh-opendesigner");
    assert.deepEqual(pluginInject, ["tools"]);
    assert.equal(typeof apply, "function");
    assert.equal(OpenDesignerService.serviceName, "openDesigner");
    assert.deepEqual(OpenDesignerService.inject, ["tools"]);
  });

  it("should mount all 38 tools into DSH tools service on instantiation", async () => {
    const registeredTools = new Map<string, CordisToolDef>();

    const mockToolsService = {
      defineTool: (tool: CordisToolDef) => {
        registeredTools.set(tool.name, tool);
      },
      getTool: (name: string) => registeredTools.get(name),
      listTools: () => Array.from(registeredTools.values())
    };

    const ctx = new Context({ tools: mockToolsService });
    const service = new OpenDesignerService(ctx, { projectRoot: CORDIS_TEST_DIR });

    // Verify all 38 tools are mounted into DSH tools service
    assert.equal(registeredTools.size, 38);
    assert.ok(registeredTools.has("canvas_claim"));
    assert.ok(registeredTools.has("canvas_read"));
    assert.ok(registeredTools.has("take_screenshot"));
    assert.ok(registeredTools.has("project_write"));

    // Execute tool directly through DSH Cordis tool executor
    const listTool = registeredTools.get("canvas_list");
    assert.ok(listTool);
    const listRes = await listTool.execute({});
    assert.ok(Array.isArray(listRes.pages));
  });

  it("should support Cordis lifecycle hooks (start and stop)", async () => {
    const ctx = new Context();
    const service = new OpenDesignerService(ctx, { projectRoot: CORDIS_TEST_DIR });

    service.store.setElement({
      id: "lifecycle_node",
      type: "element",
      tag: "main",
      props: { className: "bg-slate-900" }
    });

    // Start lifecycle
    await service.start();

    // Stop lifecycle -> saves to .designer/canvas.json
    await service.stop();

    const canvasFile = path.join(CORDIS_TEST_DIR, ".designer/canvas.json");
    const exists = await fs.stat(canvasFile).then(() => true).catch(() => false);
    assert.equal(exists, true);

    const content = JSON.parse(await fs.readFile(canvasFile, "utf-8"));
    assert.equal(content.byId["lifecycle_node"].tag, "main");
  });

  it("should mount via ctx.plugin and emit/listen to events", () => {
    const ctx = new Context();
    let eventPayload: any = null;

    ctx.on("designer:element-selected", (data) => {
      eventPayload = data;
    });

    const service = ctx.plugin(OpenDesignerService, { projectRoot: CORDIS_TEST_DIR });
    assert.ok(service instanceof OpenDesignerService);
    assert.equal(ctx["openDesigner"], service);

    ctx.emit("designer:element-selected", { elementId: "node_123" });
    assert.deepEqual(eventPayload, { elementId: "node_123" });
  });

  it("should safely inspect Git status and stage canvas with GIT_CONFIG_GLOBAL=/dev/null", async () => {
    // Test within current git repository root
    const service = new OpenDesignerService({ projectRoot: process.cwd() });
    const status = await service.getGitStatus();

    assert.equal(status.isGitRepo, true);
    assert.ok(status.branch); // e.g. "main"

    // Sync workspace (stages canvas without error)
    const syncStatus = await service.syncGitWorkspace({ stageCanvas: true });
    assert.equal(syncStatus.isGitRepo, true);
  });
});
