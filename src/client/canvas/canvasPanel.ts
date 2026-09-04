/**
 * Web Client 视觉交互视口组件与面板 (CanvasPanel)
 * 依据 docs/05 与 docs/08 规约：
 * 打通 2D 仿射变换、手柄缩放与 6 线吸附，集成 FlatStore 与 ComponentSandbox
 */

import { FlatStore } from "../../store/flatStore.ts";
import type { FEElement } from "../../store/flatStore.ts";
import type { Point, Rect, ResizeHandle } from "../geometry.ts";
import type { SnapGuide } from "../snapping.ts";
import { SelectionManager } from "../selection.ts";
import { ComponentSandbox } from "../sandbox.ts";
import { StylesPanelManager } from "../stylesPanel.ts";
import { InfiniteCanvasViewport } from "./viewport.ts";
import { SelectionOverlayRenderer } from "./overlay.ts";
import { CanvasInteractionController, type InteractionMode } from "./interaction.ts";

export interface CanvasPanelOptions {
  initialZoom?: number;
  initialPan?: Point;
  snapThreshold?: number;
  store?: FlatStore;
}

export class CanvasPanel {
  public viewport: InfiniteCanvasViewport;
  public selection: SelectionManager;
  public controller: CanvasInteractionController;
  public overlay: SelectionOverlayRenderer;
  public sandbox: ComponentSandbox;
  public stylesPanel: StylesPanelManager;
  public store: FlatStore;
  public snapThreshold: number;

  private elementRects: Map<string, Rect> = new Map();

  constructor(options: CanvasPanelOptions = {}) {
    this.viewport = new InfiniteCanvasViewport({
      zoom: options.initialZoom ?? 1.0,
      panX: options.initialPan?.x ?? 0,
      panY: options.initialPan?.y ?? 0
    });
    this.selection = new SelectionManager();
    this.controller = new CanvasInteractionController(this.viewport, this.selection);
    this.overlay = new SelectionOverlayRenderer();
    this.sandbox = new ComponentSandbox();
    this.stylesPanel = new StylesPanelManager();
    this.store = options.store || new FlatStore();
    this.snapThreshold = options.snapThreshold ?? 5;
  }

  /**
   * 同步或注册图元世界几何矩形
   */
  public registerElement(id: string, rect: Rect, element?: FEElement): void {
    this.elementRects.set(id, { ...rect });
    if (element) {
      if (!element.canvasRect) {
        element.canvasRect = { ...rect };
      }
      this.store.setElement(element);
    }
    this.syncSelectionManager();
  }

  /**
   * 移除指定图元
   */
  public unregisterElement(id: string): void {
    this.elementRects.delete(id);
    this.store.removeElement(id);
    this.syncSelectionManager();
  }

  public clearRegisteredRects(): void {
    this.elementRects.clear();
    this.syncSelectionManager();
  }

  /**
   * 同步所有元素矩形至 SelectionManager
   */
  private syncSelectionManager(): void {
    const list: { id: string; rect: Rect }[] = [];
    for (const [id, rect] of this.elementRects.entries()) {
      list.push({ id, rect: { ...rect } });
    }
    this.selection.setElements(list);
  }

  /**
   * 获取除了已选中元素之外的所有候选对齐矩形
   */
  public getAlignmentCandidates(): Rect[] {
    const selected = new Set(this.selection.getSelectedIds());
    const candidates: Rect[] = [];
    for (const [id, rect] of this.elementRects.entries()) {
      if (!selected.has(id)) {
        candidates.push({ ...rect });
      }
    }
    return candidates;
  }

  /**
   * 选中图元
   */
  public select(ids: string[]): void {
    this.selection.select(ids);
  }

  /**
   * 获取当前选区合并包围盒
   */
  public getSelectedBoundingBox(): Rect | null {
    return this.selection.getBoundingBox();
  }

  public getElementRect(id: string): Rect | undefined {
    const r = this.elementRects.get(id);
    return r ? { ...r } : undefined;
  }

  public getAllElementRects(): Map<string, Rect> {
    return new Map(this.elementRects);
  }

  /**
   * 执行拖拽移动 (打通 6 线智能吸附)
   */
  public moveSelected(screenPoint: Point): {
    newBox: Rect;
    updatedElements: { id: string; rect: Rect }[];
    guides: SnapGuide[];
    snapped: boolean;
  } | null {
    const candidates = this.getAlignmentCandidates();
    const res = this.controller.updateDrag(screenPoint, {
      candidates,
      snapThreshold: this.snapThreshold,
      enableSnapping: true
    });

    if (res && res.updatedElements) {
      for (const item of res.updatedElements) {
        this.elementRects.set(item.id, { ...item.rect });
        const el = this.store.getElement(item.id);
        if (el) {
          el.canvasRect = { ...item.rect };
        }
      }
    }

    return res;
  }

  /**
   * 执行 8 向手柄缩放 (打通伴随几何与 6 线吸附)
   */
  public resizeSelected(screenPoint: Point): {
    newBox: Rect;
    updatedElements: { id: string; rect: Rect }[];
    guides: SnapGuide[];
    snapped: boolean;
  } | null {
    const candidates = this.getAlignmentCandidates();
    const res = this.controller.updateResize(screenPoint, {
      candidates,
      snapThreshold: this.snapThreshold,
      enableSnapping: true
    });

    if (res && res.updatedElements) {
      for (const item of res.updatedElements) {
        this.elementRects.set(item.id, { ...item.rect });
        const el = this.store.getElement(item.id);
        if (el) {
          el.canvasRect = { ...item.rect };
        }
      }
    }

    return res;
  }

  /**
   * 渲染完整画布 HTML/SVG 标记
   */
  public renderHtml(): string {
    const transformStyle = this.viewport.getCssTransform();
    const box = this.selection.getBoundingBox();
    const guides = this.controller.getGuides();

    // 渲染世界层图元
    const elementsHtml: string[] = [];
    const rootIds = this.store.getRootIds();
    for (const rid of rootIds) {
      elementsHtml.push(this.sandbox.renderToHtml(this.store, rid));
    }

    // 渲染选区与吸附导引 SVG
    const overlaySvg = this.overlay.renderSvgOverlay(box, guides);

    return [
      `<div class="opendesigner-canvas-container" style="position:relative;width:100%;height:100%;overflow:hidden;background:#0f172a;">`,
      `  <div class="canvas-viewport-layer" style="transform-origin:0 0;transform:${transformStyle};position:absolute;top:0;left:0;">`,
      `    ${elementsHtml.join("\n    ")}`,
      `    ${overlaySvg}`,
      `  </div>`,
      `</div>`
    ].join("\n");
  }
}
