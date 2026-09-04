import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OpenDesignerService, ClaimRegistry, OPEN_DESIGNER_TOOLS } from "../src/server/index.ts";

const TEST_DIR = path.resolve(process.cwd(), "test-fixtures/server-test");

describe("Server - OpenDesignerService & Persistence", () => {
  before(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should have all 38 tools defined", () => {
    assert.equal(OPEN_DESIGNER_TOOLS.length, 38);
    const categories = new Set(OPEN_DESIGNER_TOOLS.map((t) => t.category));
    assert.deepEqual(Array.from(categories).sort(), ["canvas", "design", "local", "project", "skills"]);
  });

  it("should atomically save and reload canvas store", async () => {
    const service = new OpenDesignerService({ projectRoot: TEST_DIR });
    service.store.setElement({
      id: "node_save_test",
      type: "element",
      tag: "header",
      props: { className: "bg-slate-900 text-white" }
    });
    service.store.addPage({
      id: "page_save_test",
      name: "Persistence Test",
      isLoaded: true,
      rootElementId: "node_save_test"
    });

    await service.saveCanvas();

    // Verify file exists on disk
    const canvasFile = path.join(TEST_DIR, ".designer/canvas.json");
    const exists = await fs.stat(canvasFile).then(() => true).catch(() => false);
    assert.equal(exists, true);

    // Create fresh service and load
    const freshService = new OpenDesignerService({ projectRoot: TEST_DIR });
    const loaded = await freshService.loadCanvas();
    assert.equal(loaded, true);
    assert.equal(freshService.store.getElement("node_save_test")?.tag, "header");
  });

  it("should instantiate and expose AIGateway with configured provider", () => {
    const service = new OpenDesignerService({
      modelProvider: "deepseek",
      aiConfig: { mockMode: true }
    });
    assert.ok(service.aiGateway);
    assert.equal(service.aiGateway.provider, "deepseek");
    assert.equal(service.aiGateway.model, "deepseek-chat");
    assert.equal(service.aiGateway.mockMode, true);
  });
});

describe("Server - ClaimRegistry Concurrency Lock Engine", () => {
  it("should support 4-state lifecycle and block release without visual verification", () => {
    const registry = new ClaimRegistry(10_000);
    const elementId = "btn-lock-test";
    const coveringHash = "abcd1234efgh5678";

    // 1. Claim
    const claimRes = registry.claim(elementId, coveringHash, { holder: "Agent-A" });
    assert.equal(claimRes.success, true);
    const claimId = claimRes.claimId!;

    let claim = registry.getClaim(claimId);
    assert.equal(claim?.status, "CLAIMED");
    assert.equal(claim?.mutated, false);
    assert.equal(claim?.verified, false);

    // 2. Conflict rejection for second agent
    const conflictRes = registry.claim(elementId, coveringHash, { holder: "Agent-B" });
    assert.equal(conflictRes.success, false);
    assert.ok(conflictRes.error?.includes("CONFLICT"));

    // 3. Mutation
    const mutateRes = registry.recordMutation(claimId);
    assert.equal(mutateRes.success, true);
    claim = registry.getClaim(claimId);
    assert.equal(claim?.status, "MUTATED");
    assert.equal(claim?.mutated, true);
    assert.equal(claim?.verified, false);

    // 4. Release WITHOUT take_screenshot MUST BE REJECTED
    const blockedRelease = registry.release(claimId);
    assert.equal(blockedRelease.success, false);
    assert.ok(blockedRelease.error?.includes("VERIFICATION_REQUIRED"));
    assert.equal(claim?.status, "MUTATED");

    // 5. Visual verification (take_screenshot)
    const verifyRes = registry.recordVerification(elementId);
    assert.equal(verifyRes.success, true);
    claim = registry.getClaim(claimId);
    assert.equal(claim?.status, "VERIFIED");
    assert.equal(claim?.verified, true);

    // 6. Release allowed after verification
    const allowedRelease = registry.release(claimId);
    assert.equal(allowedRelease.success, true);
    claim = registry.getClaim(claimId);
    assert.equal(claim?.status, "RELEASED");
  });
});

describe("Server - 38 MCP Tools Dispatcher Execution", () => {
  let service: OpenDesignerService;

  before(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    service = new OpenDesignerService({ projectRoot: TEST_DIR });
    await service.init();
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should dispatch project tools (write, read, edit)", async () => {
    // project_write
    const writeRes = await service.executeTool("project_write", {
      path: "src/sample.tsx",
      content: "export const A = 1;\nexport const B = 2;"
    });
    assert.equal(writeRes.success, true);

    // project_read
    const readRes = await service.executeTool("project_read", {
      path: "src/sample.tsx"
    });
    assert.equal(readRes.totalLines, 2);
    assert.ok(readRes.content.includes("A = 1"));

    // project_edit
    const editRes = await service.executeTool("project_edit", {
      path: "src/sample.tsx",
      old_string: "A = 1",
      new_string: "A = 100"
    });
    assert.equal(editRes.success, true);

    // verify updated content
    const updated = await service.executeTool("project_read", { path: "src/sample.tsx" });
    assert.ok(updated.content.includes("A = 100"));
  });

  it("should dispatch canvas tools with strict claim and screenshot workflow", async () => {
    // 1. Create page
    const pageRes = await service.executeTool("canvas_create_page", { name: "Dashboard" });
    assert.equal(pageRes.success, true);
    const rootId = pageRes.rootElementId;

    // 2. Read canvas
    const readRes = await service.executeTool("canvas_read", { elementId: rootId });
    assert.ok(readRes.covering_hash);
    const coveringHash = readRes.covering_hash;

    // 3. Claim lock
    const claimRes = await service.executeTool("canvas_claim", {
      elementId: rootId,
      covering_hash: coveringHash
    });
    assert.equal(claimRes.success, true);
    const claimId = claimRes.claimId;

    // 4. Update canvas element
    const updateRes = await service.executeTool("canvas_update", {
      claim_id: claimId,
      elementId: rootId,
      props: { className: "bg-blue-600 text-white" }
    });
    assert.equal(updateRes.success, true);

    // 5. Try release directly -> MUST FAIL
    const unverifiedRelease = await service.executeTool("canvas_release", { claim_id: claimId });
    assert.equal(unverifiedRelease.success, false);
    assert.ok(unverifiedRelease.error?.includes("VERIFICATION_REQUIRED"));

    // 6. Screenshot inspection
    const shotRes = await service.executeTool("take_screenshot", { elementId: rootId });
    assert.equal(shotRes.success, true);
    assert.ok(shotRes.screenshotDataUrl.startsWith("data:image/png"));

    // 7. Release now succeeds
    const verifiedRelease = await service.executeTool("canvas_release", { claim_id: claimId });
    assert.equal(verifiedRelease.success, true);
  });

  it("should enforce optimistic concurrency with STALE_READ rejection on covering_hash mismatch", async () => {
    const pageRes = await service.executeTool("canvas_create_page", { name: "OCC Test" });
    const rootId = pageRes.rootElementId;

    // Read to get real hash
    const readRes = await service.executeTool("canvas_read", { elementId: rootId });
    assert.ok(readRes.covering_hash);

    // Try claim with stale/bogus hash -> MUST FAIL
    const staleClaim = await service.executeTool("canvas_claim", {
      elementId: rootId,
      covering_hash: "stale_hash_from_past_version"
    });
    assert.equal(staleClaim.success, false);
    assert.ok(staleClaim.error?.includes("STALE_READ"));

    // Claim with correct hash -> SUCСEEDS
    const goodClaim = await service.executeTool("canvas_claim", {
      elementId: rootId,
      covering_hash: readRes.covering_hash
    });
    assert.equal(goodClaim.success, true);
    await service.executeTool("canvas_release", { claim_id: goodClaim.claimId });
  });

  it("should allow canvas_delete of child element when claim is held on parent container", async () => {
    const parentRes = await service.executeTool("canvas_add", { tag: "section", props: { id: "p-sec" } });
    const parentId = parentRes.elementId;
    const childRes = await service.executeTool("canvas_add", { tag: "button", parentId });
    const childId = childRes.elementId;

    // Claim lock on parent
    const readParent = await service.executeTool("canvas_read", { elementId: parentId });
    const parentClaim = await service.executeTool("canvas_claim", {
      elementId: parentId,
      covering_hash: readParent.covering_hash
    });
    assert.equal(parentClaim.success, true);

    // Delete child using parent claim
    const delRes = await service.executeTool("canvas_delete", {
      claim_id: parentClaim.claimId,
      elementId: childId
    });
    assert.equal(delRes.success, true);
    assert.equal(service.store.getElement(childId), undefined);

    // Verify and release
    await service.executeTool("take_screenshot", { elementId: parentId });
    const relRes = await service.executeTool("canvas_release", { claim_id: parentClaim.claimId });
    assert.equal(relRes.success, true);
  });

  it("should reject canvas_edit when old_string is not found in element", async () => {
    const btnRes = await service.executeTool("canvas_add", { tag: "button", textContent: "Submit" });
    const btnId = btnRes.elementId;

    const readRes = await service.executeTool("canvas_read", { elementId: btnId });
    const claimRes = await service.executeTool("canvas_claim", {
      elementId: btnId,
      covering_hash: readRes.covering_hash
    });

    const editRes = await service.executeTool("canvas_edit", {
      claim_id: claimRes.claimId,
      elementId: btnId,
      old_string: "DefinitelyNotFoundText",
      new_string: "Cancel"
    });

    assert.equal(editRes.success, false);
    assert.ok(editRes.error?.includes("not found"));

    await service.executeTool("canvas_release", { claim_id: claimRes.claimId });
  });

  it("should dispatch design and skills tools", async () => {
    const theme = await service.executeTool("get_theme");
    assert.ok(theme.colors.primary);

    const context = await service.executeTool("get_design_context");
    assert.ok(context.theme);
    assert.ok(context.activeCanvas);

    const skills = await service.executeTool("list_skills");
    assert.equal(skills.skills.length, 3);

    const skillDoc = await service.executeTool("read_skill", { name: "lunagraph-design" });
    assert.ok(skillDoc.content.includes("lunagraph-design"));
  });
});
