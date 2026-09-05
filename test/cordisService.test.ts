import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { apply, name as pluginName, inject as pluginInject } from "../src/plugin.ts";
import { OpenDesignerService } from "../src/server/index.ts";
import { JSON_OUTPUT, REQUIRED_DSH_RELEASE } from "../src/server/dshAdapter.ts";
import type { CordisToolDef } from "../src/server/cordis.ts";
import { assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";

const CORDIS_TEST_DIR = path.resolve(process.cwd(), "test-fixtures/cordis-test");

describe("Server - DSH plugin form", () => {
  before(async () => {
    await fs.mkdir(CORDIS_TEST_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(CORDIS_TEST_DIR, { recursive: true, force: true });
  });

  it("exports named apply, name, and inject", () => {
    assert.equal(pluginName, "dsh-opendesigner");
    assert.deepEqual(pluginInject, ["tools"]);
    assert.equal(typeof apply, "function");
    assert.equal(OpenDesignerService.serviceName, "openDesigner");
  });

  it("pins DeepSeek Harness 0.1.2-rc.1 in package.json and status()", async () => {
    const pkg = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8"));
    assert.equal(REQUIRED_DSH_RELEASE, "0.1.2-rc.1");
    assert.equal(pkg.peerDependencies["@deepseek-ai/dsh-tools"], REQUIRED_DSH_RELEASE);
    assert.equal(pkg.optionalDependencies["@deepseek-ai/dsh-tools"], REQUIRED_DSH_RELEASE);
    assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "^4.0.2");
    assert.equal(pkg.dsh?.bundle?.patch, "./cordis.patch.yml");
    assert.equal(pkg.dsh?.client, undefined);

    const service = new OpenDesignerService({ projectRoot: CORDIS_TEST_DIR });
    assert.equal(service.status().requiredDsh, REQUIRED_DSH_RELEASE);
  });

  it("registers tools through ctx.tools.register", async () => {
    const registeredTools = new Map<string, CordisToolDef>();
    const mockToolsService = {
      register: (tool: CordisToolDef) => {
        registeredTools.set(tool.name, tool);
      },
      getTool: (name: string) => registeredTools.get(name),
      listTools: () => Array.from(registeredTools.values())
    };

    const service = apply({ tools: mockToolsService }, { projectRoot: CORDIS_TEST_DIR, autoApprove: true });
    assert.ok(service instanceof OpenDesignerService);
    assert.ok(registeredTools.has("opendesigner_canvas_claim"));
    assert.ok(registeredTools.has("opendesigner_status"));
    assert.ok(registeredTools.has("opendesigner_rewind"));
    assert.ok(registeredTools.has("opendesigner_batch_create"));

    const listTool = registeredTools.get("opendesigner_canvas_list");
    assert.ok(listTool);
    const listRes = await listTool.execute({});
    assert.ok(Array.isArray(listRes.pages));

    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => listTool.execute({}, { signal: ac.signal }),
      /aborted/
    );
  });

  it("wraps tools with defineTool so output.schema is JSON Schema", async () => {
    const registeredTools = new Map<string, any>();
    apply(
      {
        tools: {
          register: (tool: any) => {
            registeredTools.set(tool.name, tool);
          }
        }
      },
      { projectRoot: CORDIS_TEST_DIR, autoApprove: true }
    );
    const status = registeredTools.get("opendesigner_status");
    assert.ok(status);
    assert.notEqual(status.output?.schema?.type, "json");
    assert.doesNotThrow(() => assertSupportedJsonSchema(status.output.schema));
    assert.doesNotThrow(() => assertSupportedJsonSchema(JSON_OUTPUT.schema));
    const write = registeredTools.get("opendesigner_project_write");
    assert.equal(write.parameters?.type, "object");
    assert.doesNotThrow(() => assertSupportedJsonSchema(write.parameters));
    assert.doesNotThrow(() => assertSupportedJsonSchema(write.output.schema));
  });

  it("saves canvas on stop", async () => {
    const service = new OpenDesignerService({ projectRoot: CORDIS_TEST_DIR });
    service.store.setElement({
      id: "lifecycle_node",
      type: "element",
      tag: "main",
      props: { className: "bg-slate-900" }
    });
    await service.start();
    await service.stop();

    const canvasFile = path.join(CORDIS_TEST_DIR, ".designer/canvas.json");
    const exists = await fs.stat(canvasFile).then(() => true).catch(() => false);
    assert.equal(exists, true);
    const content = JSON.parse(await fs.readFile(canvasFile, "utf-8"));
    assert.equal(content.byId["lifecycle_node"].tag, "main");
  });

  it("inspects git status inside the project root", async () => {
    const service = new OpenDesignerService({ projectRoot: CORDIS_TEST_DIR });
    const status = await service.getGitStatus();
    assert.equal(typeof status.isGitRepo, "boolean");
  });
});
