import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FlatStore } from "../src/store/flatStore.ts";
import type { FEElement } from "../src/store/flatStore.ts";

describe("FlatStore - Hierarchical AST Management", () => {
  it("should set, get, and remove elements", () => {
    const store = new FlatStore();
    const el: FEElement = {
      id: "el-1",
      type: "element",
      tag: "div",
      props: { className: "container" }
    };

    store.setElement(el);
    assert.deepEqual(store.getElement("el-1"), el);

    store.removeElement("el-1");
    assert.equal(store.getElement("el-1"), undefined);
  });

  it("should attach children and query subtree", () => {
    const store = new FlatStore();
    store.setElement({ id: "root", type: "element", tag: "main", props: {} });
    store.setElement({ id: "header", type: "element", tag: "header", props: {} });
    store.setElement({ id: "nav", type: "element", tag: "nav", props: {} });

    store.attachChild("root", "header");
    store.attachChild("header", "nav");

    const subtree = store.getSubtree("root");
    assert.equal(subtree.length, 3);
    assert.deepEqual(
      subtree.map((e) => e.id),
      ["root", "header", "nav"]
    );
    assert.equal(store.getParent("nav")?.id, "header");
    assert.equal(store.getParent("header")?.id, "root");
  });

  it("should successfully move element to new parent", () => {
    const store = new FlatStore();
    store.setElement({ id: "root", type: "element", tag: "div", props: {} });
    store.setElement({ id: "col1", type: "element", tag: "div", props: {} });
    store.setElement({ id: "col2", type: "element", tag: "div", props: {} });
    store.setElement({ id: "btn", type: "element", tag: "button", props: {} });

    store.attachChild("root", "col1");
    store.attachChild("root", "col2");
    store.attachChild("col1", "btn");

    assert.equal(store.getChildren("col1").length, 1);
    assert.equal(store.getChildren("col2").length, 0);

    // Move btn from col1 to col2
    const moved = store.moveElement("btn", "col2");
    assert.equal(moved, true);
    assert.equal(store.getChildren("col1").length, 0);
    assert.equal(store.getChildren("col2").length, 1);
    assert.equal(store.getParent("btn")?.id, "col2");
  });

  it("should block cycle creation when moving an element into its descendant", () => {
    const store = new FlatStore();
    store.setElement({ id: "a", type: "element", tag: "div", props: {} });
    store.setElement({ id: "b", type: "element", tag: "div", props: {} });
    store.setElement({ id: "c", type: "element", tag: "div", props: {} });

    store.attachChild("a", "b");
    store.attachChild("b", "c");

    // Moving 'a' into its grandchild 'c' would create a cycle: a -> b -> c -> a
    assert.throws(
      () => {
        store.moveElement("a", "c");
      },
      /Cycle detected/
    );

    // Moving 'a' into itself
    assert.throws(
      () => {
        store.moveElement("a", "a");
      },
      /Cycle detected/
    );
  });

  it("should clone subtree with fresh IDs and intact relative structure", () => {
    const store = new FlatStore();
    store.setElement({ id: "card", type: "element", tag: "div", props: { role: "card" } });
    store.setElement({ id: "title", type: "text", tag: "h2", props: {}, textContent: "Card Title" });
    store.setElement({ id: "desc", type: "text", tag: "p", props: {}, textContent: "Card Body" });

    store.attachChild("card", "title");
    store.attachChild("card", "desc");

    const { rootId: clonedCardId, clonedElements } = store.cloneSubtree("card", (id) => `${id}_copy`);

    assert.equal(clonedCardId, "card_copy");
    assert.equal(clonedElements.length, 3);

    const clonedChildren = store.getChildren(clonedCardId);
    assert.equal(clonedChildren.length, 2);
    assert.deepEqual(
      clonedChildren.map((c) => c.id),
      ["title_copy", "desc_copy"]
    );
    assert.equal(store.getElement("title_copy")?.textContent, "Card Title");
    assert.equal(store.getParent("title_copy")?.id, "card_copy");
  });

  it("should round-trip toJSON and fromJSON accurately", () => {
    const store1 = new FlatStore();
    store1.setElement({ id: "node-1", type: "element", tag: "section", props: { id: "sec" } });
    store1.addPage({ id: "page-1", name: "Home", isLoaded: true, rootElementId: "node-1" });
    store1.setActivePage("page-1");

    const json = store1.toJSON();
    const serialized = JSON.stringify(json);

    const store2 = new FlatStore();
    store2.fromJSON(JSON.parse(serialized));

    assert.equal(store2.getActivePageId(), "page-1");
    assert.equal(store2.getPages().length, 1);
    assert.deepEqual(store2.getElement("node-1"), store1.getElement("node-1"));
  });
});
