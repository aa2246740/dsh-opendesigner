import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CanvasPanel,
  InfiniteCanvasViewport,
  SelectionOverlayRenderer,
  CanvasInteractionController
} from "../src/client/canvas/index.ts";
import { FlatStore } from "../src/store/flatStore.ts";

describe("Client - CanvasPanel & Unified Visual Viewport Engine", () => {
  it("should initialize CanvasPanel with viewport, selection, and store", () => {
    const store = new FlatStore();
    const panel = new CanvasPanel({
      initialZoom: 1.25,
      initialPan: { x: 50, y: 100 },
      snapThreshold: 6,
      store
    });

    assert.equal(panel.viewport.getZoom(), 1.25);
    assert.deepEqual(panel.viewport.getPan(), { x: 50, y: 100 });
    assert.equal(panel.snapThreshold, 6);
    assert.equal(panel.store, store);
  });

  it("should register elements and calculate bounding box accurately", () => {
    const panel = new CanvasPanel();
    panel.registerElement("btn_1", { left: 40, top: 40, width: 100, height: 50 }, {
      id: "btn_1",
      type: "element",
      tag: "button",
      props: { className: "btn-primary" },
      textContent: "Submit"
    });
    panel.registerElement("input_1", { left: 160, top: 40, width: 140, height: 50 }, {
      id: "input_1",
      type: "element",
      tag: "input",
      props: { className: "border rounded" }
    });

    // 单选测试
    panel.select(["btn_1"]);
    const box1 = panel.getSelectedBoundingBox();
    assert.ok(box1);
    assert.equal(box1.left, 40);
    assert.equal(box1.top, 40);
    assert.equal(box1.width, 100);
    assert.equal(box1.height, 50);

    // 多选合并包围盒测试
    panel.select(["btn_1", "input_1"]);
    const mergedBox = panel.getSelectedBoundingBox();
    assert.ok(mergedBox);
    assert.equal(mergedBox.left, 40);
    assert.equal(mergedBox.top, 40);
    assert.equal(mergedBox.width, 260); // 160 + 140 - 40 = 260
    assert.equal(mergedBox.height, 50);
  });

  it("should support selection move with 6-line smart snapping against non-selected candidates", () => {
    const panel = new CanvasPanel({ snapThreshold: 5 });

    // 候选静态图元 (世界坐标 x: 200, y: 40)
    panel.registerElement("static_box", { left: 200, top: 40, width: 100, height: 60 });
    // 活动图元 (世界坐标 x: 40, y: 40)
    panel.registerElement("active_box", { left: 40, top: 40, width: 80, height: 60 });

    panel.select(["active_box"]);

    // 启动拖拽会话并移动
    const started = panel.controller.startDrag({ x: 40, y: 40 });
    assert.equal(started, true);
    assert.equal(panel.controller.getMode(), "dragging");

    // 拖动使 active_box 的右边缘 (40 + 80 = 120) 移动向 198 (靠近 static_box.left 200，相差 2px <= 5px 阈值)
    // dx = 78 -> 目标右边缘 198
    const moveRes = panel.moveSelected({ x: 40 + 78, y: 40 });

    assert.ok(moveRes);
    assert.equal(moveRes.snapped, true);
    // 吸附后：右边缘精确对齐到 static_box.left (200)，因此 left 应为 200 - 80 = 120
    assert.equal(moveRes.newBox.left, 120);
    assert.equal(moveRes.newBox.width, 80); // 宽高保持不变
    assert.equal(moveRes.newBox.height, 60);

    // 包含辅助导引线
    assert.ok(moveRes.guides.length > 0);
    assert.equal(moveRes.guides[0].orientation, "vertical");
    assert.equal(moveRes.guides[0].coordinate, 200);

    panel.controller.endDrag();
    assert.equal(panel.controller.getMode(), "idle");
  });

  it("should resize with 8-direction handles and companion geometry keeping opposite edges fixed", () => {
    const panel = new CanvasPanel({ snapThreshold: 5 });
    panel.registerElement("box_scale", { left: 100, top: 100, width: 120, height: 80 });
    panel.select(["box_scale"]);

    // 1. 拖拽东侧手柄 ("e")：左侧固定在 100，宽度增加 50 -> 170
    panel.controller.startResize("e", { x: 220, y: 140 });
    assert.equal(panel.controller.getMode(), "resizing");

    const eastRes = panel.resizeSelected({ x: 270, y: 140 });
    assert.ok(eastRes);
    assert.equal(eastRes.newBox.left, 100);
    assert.equal(eastRes.newBox.width, 170);
    assert.equal(eastRes.newBox.height, 80);
    panel.controller.endResize();

    // 2. 拖拽西侧手柄 ("w")：右边缘固定在 270，左边缘向左延伸 30 -> 70，宽度 -> 200
    panel.controller.startResize("w", { x: 100, y: 140 });
    const westRes = panel.resizeSelected({ x: 70, y: 140 });
    assert.ok(westRes);
    assert.equal(westRes.newBox.left, 70);
    assert.equal(westRes.newBox.left + westRes.newBox.width, 270);
    panel.controller.endResize();
  });

  it("should manage CanvasInteractionController mode transitions and event subscriptions", () => {
    const viewport = new InfiniteCanvasViewport();
    const selection = new panelSelectionStub();
    const controller = new CanvasInteractionController(viewport, selection as any);

    const modeHistory: string[] = [];
    const unsubscribe = controller.onModeChange((m) => modeHistory.push(m));

    // Panning
    controller.startPan({ x: 100, y: 100 });
    assert.equal(controller.getMode(), "panning");
    controller.updatePan({ x: 150, y: 120 });
    assert.equal(viewport.getPan().x, 50);
    assert.equal(viewport.getPan().y, 20);
    controller.endPan();
    assert.equal(controller.getMode(), "idle");

    assert.deepEqual(modeHistory, ["panning", "idle"]);
    unsubscribe();
  });

  it("should render full HTML container, CSS matrix layer, and overlay SVG markup via renderHtml", () => {
    const panel = new CanvasPanel({ initialZoom: 1.5, initialPan: { x: 30, y: 60 } });
    panel.registerElement("hero", { left: 0, top: 0, width: 200, height: 100 }, {
      id: "hero",
      type: "element",
      tag: "div",
      props: { className: "p-4 bg-slate-900 text-white" },
      textContent: "Hero Content"
    });
    panel.select(["hero"]);

    const html = panel.renderHtml();
    assert.ok(html.includes("opendesigner-canvas-container"));
    assert.ok(html.includes("canvas-viewport-layer"));
    assert.ok(html.includes("matrix(1.5, 0, 0, 1.5, 30, 60)"));
    assert.ok(html.includes("canvas-selection-overlay"));
    assert.ok(html.includes("handle-nw"));
    assert.ok(html.includes("handle-se"));
    assert.ok(html.includes("Hero Content"));
  });
});

class panelSelectionStub {
  getBoundingBox() {
    return { left: 10, top: 10, width: 50, height: 50 };
  }
  startResize() {
    return true;
  }
  updateResize() {
    return {
      newBox: { left: 10, top: 10, width: 60, height: 50 },
      guides: [],
      snapped: false
    };
  }
  moveSelection() {
    return {
      newBox: { left: 20, top: 10, width: 50, height: 50 },
      guides: [],
      snapped: false
    };
  }
  endResize() {}
}
