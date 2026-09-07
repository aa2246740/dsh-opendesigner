import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadSrc, el } from "./helpers.mjs";

const { FlatStore } = await loadSrc("store/flatStore.ts");
const { mergeTailwindTokens } = await loadSrc("compiler/tailwindMerge.ts");

describe("R04 attach absent parent", () => {
  it("fails without corrupting the tree", () => {
    const store = new FlatStore();
    store.setElement(el("child"));

    assert.throws(() => store.attachChild("missing-parent", "child"));

    assert.equal(store.getParent("child"), undefined);
    const json = store.toJSON();
    assert.equal(json.childrenByParent["missing-parent"], undefined);
    assert.equal(json.parentByChild.child, undefined);
    assert.ok(store.getElement("child"));
  });
});

describe("R05 grow vs shrink-0", () => {
  it("adding grow preserves independent shrink-0", () => {
    const merged = mergeTailwindTokens("flex shrink-0 w-8", "grow");
    assert.match(merged, /\bshrink-0\b/);
    assert.match(merged, /\bgrow\b/);
    assert.match(merged, /\bflex\b/);
  });
});

describe("R06 corner radii", () => {
  it("upper-left and upper-right radius coexist", () => {
    const merged = mergeTailwindTokens("rounded-tl-md", "rounded-tr-xl");
    assert.match(merged, /\brounded-tl-md\b/);
    assert.match(merged, /\brounded-tr-xl\b/);
  });
});

describe("R07 left and right border colors", () => {
  it("left-border color survives a right-border color edit", () => {
    const merged = mergeTailwindTokens("border-l-red-500", "border-r-blue-500");
    assert.match(merged, /\bborder-l-red-500\b/);
    assert.match(merged, /\bborder-r-blue-500\b/);
  });
});

describe("R15 hydrate cyclic graph", () => {
  it("rejects cyclic graph input before traversal", () => {
    const store = new FlatStore();
    const cyclic = {
      byId: {
        a: el("a"),
        b: el("b")
      },
      childrenByParent: { a: ["b"], b: ["a"] },
      parentByChild: { a: "b", b: "a" },
      pages: [],
      activePageId: ""
    };

    assert.throws(() => store.fromJSON(cyclic));
    assert.equal(store.getElement("a"), undefined);
    assert.deepEqual(store.getRootIds(), []);
  });
});

describe("R16 delete page root", () => {
  it("does not leave dangling page metadata", () => {
    const store = new FlatStore();
    store.setElement(el("root"));
    store.setElement(el("child"));
    store.attachChild("root", "child");
    store.addPage({ id: "page-home", name: "Home", isLoaded: true, rootElementId: "root" });
    store.setActivePage("page-home");

    store.removeElement("root");

    assert.equal(store.getElement("root"), undefined);
    assert.equal(store.getElement("child"), undefined);
    assert.equal(store.getPages().some((page) => page.id === "page-home"), false);
    assert.equal(
      store.getPages().some((page) => page.rootElementId === "root"),
      false
    );
  });
});
