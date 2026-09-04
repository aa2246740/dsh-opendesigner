import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InfiniteCanvasViewport,
  SelectionManager,
  SnappingOverlayRenderer,
  StylesPanelManager,
  ComponentSandbox
} from "../src/client/index.ts";
import { FlatStore } from "../src/store/flatStore.ts";

describe("Client - Infinite Canvas Viewport & Transforms", () => {
  it("should pan, zoom at cursor, and clamp zoom levels", () => {
    const viewport = new InfiniteCanvasViewport({ minZoom: 0.2, maxZoom: 4.0 });

    // 1. Initial state
    assert.equal(viewport.getZoom(), 1.0);
    assert.deepEqual(viewport.getPan(), { x: 0, y: 0 });

    // 2. Pan
    viewport.pan(100, 50);
    assert.deepEqual(viewport.getPan(), { x: 100, y: 50 });

    // 3. Zoom at cursor point
    const cursor = { x: 200, y: 150 };
    const worldBefore = viewport.toWorld(cursor);

    viewport.zoomAt(cursor, 1.5);
    assert.equal(viewport.getZoom(), 1.5);

    const worldAfter = viewport.toWorld(cursor);
    assert.ok(Math.abs(worldBefore.x - worldAfter.x) < 0.001);
    assert.ok(Math.abs(worldBefore.y - worldAfter.y) < 0.001);

    // 4. Clamping
    viewport.zoomAt(cursor, 10);
    assert.equal(viewport.getZoom(), 4.0);

    viewport.zoomAt(cursor, 0.01);
    assert.equal(viewport.getZoom(), 0.2);

    // 5. Reset
    viewport.reset();
    assert.equal(viewport.getZoom(), 1.0);
    assert.deepEqual(viewport.getPan(), { x: 0, y: 0 });
    assert.equal(viewport.getCssTransform(), "matrix(1, 0, 0, 1, 0, 0)");
  });

  it("should handle wheel events for panning and pinch zooming", () => {
    const viewport = new InfiniteCanvasViewport();

    // Normal wheel -> Pan
    viewport.handleWheel({ deltaX: 20, deltaY: 30, clientX: 100, clientY: 100 });
    assert.deepEqual(viewport.getPan(), { x: -20, y: -30 });

    // Ctrl + wheel -> Pinch Zoom
    viewport.handleWheel({ deltaX: 0, deltaY: -50, clientX: 100, clientY: 100, ctrlKey: true });
    assert.ok(viewport.getZoom() > 1.0);
  });

  it("should accurately convert between screen and world rects", () => {
    const viewport = new InfiniteCanvasViewport({ zoom: 2.0, panX: 50, panY: 50 });
    const screenRect = { left: 150, top: 150, width: 200, height: 100 };

    const worldRect = viewport.screenRectToWorld(screenRect);
    assert.equal(worldRect.left, 50);
    assert.equal(worldRect.top, 50);
    assert.equal(worldRect.width, 100);
    assert.equal(worldRect.height, 50);

    const backScreen = viewport.worldRectToScreen(worldRect);
    assert.deepEqual(backScreen, screenRect);
  });
});

describe("Client - Selection & 8-Direction Handles Engine", () => {
  it("should compute merged bounding box and 8-direction handles", () => {
    const selection = new SelectionManager();
    selection.setElements([
      { id: "el1", rect: { left: 100, top: 100, width: 200, height: 100 } },
      { id: "el2", rect: { left: 250, top: 150, width: 150, height: 150 } }
    ]);

    selection.select(["el1", "el2"]);
    const box = selection.getBoundingBox();
    assert.ok(box);
    assert.equal(box.left, 100);
    assert.equal(box.top, 100);
    assert.equal(box.width, 300);  // 400 - 100
    assert.equal(box.height, 200); // 300 - 100

    const handles = selection.getHandles(box);
    assert.equal(handles.length, 8);
    const handleMap = Object.fromEntries(handles.map((h) => [h.handle, h.point]));

    assert.deepEqual(handleMap.nw, { x: 100, y: 100 });
    assert.deepEqual(handleMap.n, { x: 250, y: 100 });
    assert.deepEqual(handleMap.ne, { x: 400, y: 100 });
    assert.deepEqual(handleMap.e, { x: 400, y: 200 });
    assert.deepEqual(handleMap.se, { x: 400, y: 300 });
    assert.deepEqual(handleMap.s, { x: 250, y: 300 });
    assert.deepEqual(handleMap.sw, { x: 100, y: 300 });
    assert.deepEqual(handleMap.w, { x: 100, y: 200 });
  });

  it("should resize with 8-direction handles and snapping alignment", () => {
    const selection = new SelectionManager();
    selection.setElements([
      { id: "active_btn", rect: { left: 50, top: 50, width: 100, height: 40 } }
    ]);
    selection.select(["active_btn"]);

    // Start resize from East handle
    const started = selection.startResize("e", { x: 150, y: 70 });
    assert.equal(started, true);

    // Update with snapping candidate at x = 180 (within snap threshold)
    const snapCandidate = { left: 180, top: 0, width: 100, height: 200 };
    const res = selection.updateResize(
      { x: 178, y: 70 }, // deltaX = +28 -> width 128 -> right edge 178, snaps to 180!
      { candidates: [snapCandidate], snapThreshold: 5, enableSnapping: true }
    );

    assert.ok(res);
    assert.equal(res.snapped, true);
    assert.equal(res.newBox.left + res.newBox.width, 180);
    assert.equal(res.guides.length, 1);
    assert.equal(res.guides[0].coordinate, 180);

    selection.endResize();
  });
});

describe("Client - Snapping Overlay & Guide Lines Renderer", () => {
  it("should generate renderable guide line objects and SVG markup", () => {
    const guides = [
      { orientation: "vertical" as const, coordinate: 240, start: 100, end: 400 },
      { orientation: "horizontal" as const, coordinate: 180, start: 50, end: 350 }
    ];

    const lines = SnappingOverlayRenderer.toRenderableLines(guides, { dashed: true });
    assert.equal(lines.length, 2);
    assert.equal(lines[0].label, "X: 240px");
    assert.equal(lines[0].strokeDasharray, "4,4");
    assert.equal(lines[1].label, "Y: 180px");

    const svg = SnappingOverlayRenderer.renderSvgOverlay(guides);
    assert.ok(svg.includes("<line"));
    assert.ok(svg.includes('stroke="#ec4899"'));
    assert.ok(svg.includes('x1="240"'));
    assert.ok(svg.includes('y1="180"'));
  });
});

describe("Client - StylesPanel Inspector & Token Mutation", () => {
  it("should parse Tailwind v4 class categories accurately", () => {
    const classes = "flex flex-col items-center justify-between gap-4 p-6 bg-blue-600 text-white rounded-xl shadow-lg border border-blue-400 text-lg font-bold";
    const styles = StylesPanelManager.parseClasses(classes);

    assert.equal(styles.display, "flex");
    assert.equal(styles.flexDirection, "col");
    assert.equal(styles.alignItems, "center");
    assert.equal(styles.justifyContent, "between");
    assert.equal(styles.gap, "4");
    assert.equal(styles.padding, "6");
    assert.equal(styles.backgroundColor, "blue-600");
    assert.equal(styles.textColor, "white");
    assert.equal(styles.borderRadius, "xl");
    assert.equal(styles.shadow, "lg");
    assert.equal(styles.borderWidth, "1");
    assert.equal(styles.borderColor, "blue-400");
    assert.equal(styles.textSize, "lg");
    assert.equal(styles.fontWeight, "bold");
  });

  it("should mutate properties atomically without class collision", () => {
    let classes = "bg-red-500 p-4 text-sm font-normal rounded-md";

    // Change background color
    classes = StylesPanelManager.applyPropertyChange(classes, "backgroundColor", "emerald-600");
    assert.ok(classes.includes("bg-emerald-600"));
    assert.ok(!classes.includes("bg-red-500"));

    // Change corner radius
    classes = StylesPanelManager.applyPropertyChange(classes, "borderRadius", "full");
    assert.ok(classes.includes("rounded-full"));
    assert.ok(!classes.includes("rounded-md"));

    // Change font size
    classes = StylesPanelManager.applyPropertyChange(classes, "textSize", "2xl");
    assert.ok(classes.includes("text-2xl"));
    assert.ok(!classes.includes("text-sm"));
  });

  it("should build structured inspector panel sections", () => {
    const sections = StylesPanelManager.buildPanelSections("flex flex-row gap-2 bg-white p-4");
    assert.equal(sections.length, 5);
    const sectionIds = sections.map((s) => s.id);
    assert.deepEqual(sectionIds, ["layout", "spacing", "typography", "appearance", "borders"]);
  });
});

describe("Client - ComponentSandbox & Next.js Runtime Shims", () => {
  it("should safely render FlatStore elements with next/image and next/link shims into HTML", () => {
    const store = new FlatStore();
    store.setElement({
      id: "root_box",
      type: "element",
      tag: "div",
      props: { className: "p-4 bg-gray-50" }
    });
    store.setElement({
      id: "img_node",
      type: "element",
      tag: "Image",
      props: { src: "/avatar.png", alt: "User Avatar", width: 64, height: 64, className: "rounded-full" }
    });
    store.setElement({
      id: "link_node",
      type: "element",
      tag: "Link",
      props: { href: "/dashboard", className: "text-blue-500" },
      textContent: "Go to Dashboard"
    });

    store.attachChild("root_box", "img_node");
    store.attachChild("root_box", "link_node");

    const sandbox = new ComponentSandbox();
    const html = sandbox.renderToHtml(store, "root_box");

    assert.ok(html.includes('<div class="p-4 bg-gray-50">'));
    // Image shim replaces Image with img and data-next-image
    assert.ok(html.includes('<img'));
    assert.ok(html.includes('src="/avatar.png"'));
    assert.ok(html.includes('data-next-image="true"'));
    // Link shim replaces Link with a and data-next-link
    assert.ok(html.includes('<a'));
    assert.ok(html.includes('href="/dashboard"'));
    assert.ok(html.includes('data-next-link="true"'));
    assert.ok(html.includes("Go to Dashboard"));
  });
});
