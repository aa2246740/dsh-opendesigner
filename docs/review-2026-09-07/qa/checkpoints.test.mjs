import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadSrc, makeTempDir, el } from "./helpers.mjs";

const { CheckpointLog } = await loadSrc("server/checkpoints.ts");
const { FlatStore } = await loadSrc("store/flatStore.ts");

describe("R02 checkpoint deep-copy", () => {
  it("stored checkpoint must not change when the live node is mutated", async () => {
    const dir = await makeTempDir("od-r02-");
    const log = new CheckpointLog(path.join(dir, "checkpoints.json"));
    const store = new FlatStore();
    store.setElement(el("hero", { props: { className: "bg-slate-900" } }));

    await log.push({
      label: "seed",
      kind: "canvas",
      store: store.toJSON()
    });

    const live = store.getElement("hero");
    live.props.className = "bg-emerald-600";
    store.setElement(live);

    const stored = log.entries[0].store.byId.hero;
    assert.equal(stored.props.className, "bg-slate-900");
  });
});

describe("R03 fromJSON must not alias the checkpoint", () => {
  it("mutating the object passed to fromJSON must not mutate the store", () => {
    const store = new FlatStore();
    const payload = {
      byId: {
        hero: el("hero", { props: { className: "rounded-xl" } })
      },
      childrenByParent: {},
      parentByChild: {},
      pages: [{ id: "p1", name: "Home", isLoaded: true, rootElementId: "hero" }],
      activePageId: "p1"
    };

    store.fromJSON(payload);
    payload.byId.hero.props.className = "rounded-none";
    payload.pages[0].name = "Mutated";
    payload.activePageId = "other";

    assert.equal(store.getElement("hero").props.className, "rounded-xl");
    assert.equal(store.getPages()[0].name, "Home");
    assert.equal(store.getActivePageId(), "p1");
  });
});
