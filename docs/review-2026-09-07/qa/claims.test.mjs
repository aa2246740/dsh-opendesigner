import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadSrc } from "./helpers.mjs";

const { ClaimRegistry } = await loadSrc("server/claimRegistry.ts");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("CONTROL live claim", () => {
  it("rejects a second live claim on the exact same element", () => {
    const registry = new ClaimRegistry(30_000);
    const first = registry.claim("node-a", "hash-a", { holder: "agent-1" });
    assert.equal(first.success, true);
    const second = registry.claim("node-a", "hash-a", { holder: "agent-2" });
    assert.equal(second.success, false);
    assert.match(String(second.error), /CONFLICT/);
    assert.equal(registry.getClaim(first.claimId).status, "CLAIMED");
  });
});

describe("R13 expired release vs newer lock", () => {
  it("releasing an expired claim must not erase a newer live lock", async () => {
    const registry = new ClaimRegistry(20);
    const oldClaim = registry.claim("node-a", "hash-a", { holder: "agent-old", ttlMs: 20 });
    assert.equal(oldClaim.success, true);

    await sleep(40);

    const newer = registry.claim("node-a", "hash-a", { holder: "agent-new", ttlMs: 30_000 });
    assert.equal(newer.success, true, newer.error);

    const released = registry.release(oldClaim.claimId);
    assert.equal(released.success, true);

    const live = registry.getClaim(newer.claimId);
    assert.ok(live);
    assert.notEqual(live.status, "RELEASED");
    const third = registry.claim("node-a", "hash-a", { holder: "agent-third" });
    assert.equal(third.success, false);
    assert.match(String(third.error), /CONFLICT/);
  });
});

describe("R14 ancestor and descendant claims", () => {
  it("does not allow two owners to claim overlapping ancestor and descendant nodes", () => {
    const related = new Set([
      "parent:child",
      "child:parent",
      "parent:parent",
      "child:child"
    ]);
    const registry = new ClaimRegistry(30_000);
    const parent = registry.claim("parent", "hp", {
      holder: "owner-a",
      isRelated: (a, b) => related.has(`${a}:${b}`) || a === b
    });
    assert.equal(parent.success, true);

    const child = registry.claim("child", "hc", {
      holder: "owner-b",
      isRelated: (a, b) => related.has(`${a}:${b}`) || a === b
    });
    assert.equal(child.success, false);
    assert.match(String(child.error), /CONFLICT/);
  });
});
