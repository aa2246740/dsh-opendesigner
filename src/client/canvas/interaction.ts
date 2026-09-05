/**
 * 画布交互状态机与事件控制器 (Canvas Interaction Controller)
 * 依据 docs/05 规约：
 * 管理平移 (Pan)、单选/多选、图元拖拽对齐 (6-Line Snap Move)、8 向手柄等比缩放 (Companion Resize)
 */

import type { Point, Rect, ResizeHandle } from "../geometry.ts";
import { rectFromPoints } from "../geometry.ts";
import type { SnapGuide } from "../snapping.ts";
import { SelectionManager } from "../selection.ts";
import { InfiniteCanvasViewport } from "./viewport.ts";

export type InteractionMode = "idle" | "panning" | "dragging" | "resizing" | "box-selecting";

export interface DragSession {
  startScreenPoint: Point;
  startWorldPoint: Point;
  initialBox: Rect;
}

export class CanvasInteractionController {
  private mode: InteractionMode = "idle";
  private viewport: InfiniteCanvasViewport;
  private selection: SelectionManager;
  private dragSession: DragSession | null = null;
  private currentGuides: SnapGuide[] = [];
  private marqueeRect: Rect | null = null;

  // 事件回调列表
  private onGuidesChangeCallbacks: ((guides: SnapGuide[]) => void)[] = [];
  private onModeChangeCallbacks: ((mode: InteractionMode) => void)[] = [];

  constructor(viewport: InfiniteCanvasViewport, selection: SelectionManager) {
    this.viewport = viewport;
    this.selection = selection;
  }

  public getMode(): InteractionMode {
    return this.mode;
  }

  public getGuides(): SnapGuide[] {
    return [...this.currentGuides];
  }

  public onGuidesChange(cb: (guides: SnapGuide[]) => void): () => void {
    this.onGuidesChangeCallbacks.push(cb);
    return () => {
      this.onGuidesChangeCallbacks = this.onGuidesChangeCallbacks.filter((c) => c !== cb);
    };
  }

  public onModeChange(cb: (mode: InteractionMode) => void): () => void {
    this.onModeChangeCallbacks.push(cb);
    return () => {
      this.onModeChangeCallbacks = this.onModeChangeCallbacks.filter((c) => c !== cb);
    };
  }

  private setMode(nextMode: InteractionMode): void {
    if (this.mode === nextMode) return;
    this.mode = nextMode;
    for (const cb of this.onModeChangeCallbacks) {
      cb(nextMode);
    }
  }

  private emitGuides(guides: SnapGuide[]): void {
    this.currentGuides = guides;
    for (const cb of this.onGuidesChangeCallbacks) {
      cb(guides);
    }
  }

  public getMarqueeRect(): Rect | null {
    return this.marqueeRect ? { ...this.marqueeRect } : null;
  }

  /**
   * Empty-canvas rubber-band. World-space rect is used for intersection hit-testing.
   */
  public startBoxSelect(screenPoint: Point): void {
    const worldP = this.viewport.toWorld(screenPoint);
    this.setMode("box-selecting");
    this.dragSession = {
      startScreenPoint: { ...screenPoint },
      startWorldPoint: worldP,
      initialBox: { left: worldP.x, top: worldP.y, width: 0, height: 0 }
    };
    this.marqueeRect = { left: worldP.x, top: worldP.y, width: 0, height: 0 };
  }

  public updateBoxSelect(screenPoint: Point): Rect | null {
    if (this.mode !== "box-selecting" || !this.dragSession) return null;
    const currentWorld = this.viewport.toWorld(screenPoint);
    this.marqueeRect = rectFromPoints(this.dragSession.startWorldPoint, currentWorld);
    return { ...this.marqueeRect };
  }

  public endBoxSelect(): Rect | null {
    if (this.mode !== "box-selecting") return null;
    const rect = this.marqueeRect ? { ...this.marqueeRect } : null;
    this.marqueeRect = null;
    this.dragSession = null;
    this.setMode("idle");
    return rect;
  }

  /**
   * 启动画布平移
   */
  public startPan(screenPoint: Point): void {
    this.setMode("panning");
    this.dragSession = {
      startScreenPoint: { ...screenPoint },
      startWorldPoint: this.viewport.toWorld(screenPoint),
      initialBox: { left: 0, top: 0, width: 0, height: 0 }
    };
  }

  /**
   * 更新画布平移
   */
  public updatePan(screenPoint: Point): void {
    if (this.mode !== "panning" || !this.dragSession) return;
    const dx = screenPoint.x - this.dragSession.startScreenPoint.x;
    const dy = screenPoint.y - this.dragSession.startScreenPoint.y;
    this.viewport.pan(dx, dy);
    this.dragSession.startScreenPoint = { ...screenPoint };
  }

  /**
   * 结束画布平移
   */
  public endPan(): void {
    if (this.mode === "panning") {
      this.dragSession = null;
      this.setMode("idle");
    }
  }

  /**
   * 启动选区拖拽移动
   */
  public startDrag(screenPoint: Point): boolean {
    const box = this.selection.getBoundingBox();
    if (!box) return false;

    const worldP = this.viewport.toWorld(screenPoint);
    this.dragSession = {
      startScreenPoint: { ...screenPoint },
      startWorldPoint: worldP,
      initialBox: { ...box }
    };

    this.setMode("dragging");
    return true;
  }

  /**
   * 更新选区拖拽移动 (联动 6 线智能吸附)
   */
  public updateDrag(
    screenPoint: Point,
    options: {
      candidates?: Rect[];
      snapThreshold?: number;
      enableSnapping?: boolean;
    } = {}
  ): {
    newBox: Rect;
    updatedElements: { id: string; rect: Rect }[];
    guides: SnapGuide[];
    snapped: boolean;
  } | null {
    if (this.mode !== "dragging" || !this.dragSession) return null;

    const currentWorld = this.viewport.toWorld(screenPoint);
    const totalDx = currentWorld.x - this.dragSession.startWorldPoint.x;
    const totalDy = currentWorld.y - this.dragSession.startWorldPoint.y;

    // 以 initialBox 为基准，重新从起点开始移动以防止累计误差
    const currentBox = this.selection.getBoundingBox();
    if (!currentBox) return null;

    const targetLeft = this.dragSession.initialBox.left + totalDx;
    const targetTop = this.dragSession.initialBox.top + totalDy;
    const stepDx = targetLeft - currentBox.left;
    const stepDy = targetTop - currentBox.top;

    const moveRes = this.selection.moveSelection(stepDx, stepDy, options);
    if (!moveRes) return null;

    this.emitGuides(moveRes.guides);
    return {
      newBox: moveRes.newBox,
      updatedElements: moveRes.updatedElements,
      guides: moveRes.guides,
      snapped: moveRes.snapped
    };
  }

  /**
   * 结束选区拖拽移动
   */
  public endDrag(): void {
    if (this.mode === "dragging") {
      this.dragSession = null;
      this.emitGuides([]);
      this.setMode("idle");
    }
  }

  /**
   * 启动 8 向控制手柄缩放
   */
  public startResize(handle: ResizeHandle, screenPoint: Point): boolean {
    const worldP = this.viewport.toWorld(screenPoint);
    const ok = this.selection.startResize(handle, worldP);
    if (ok) {
      this.setMode("resizing");
    }
    return ok;
  }

  /**
   * 更新 8 向控制手柄缩放 (伴随几何 + 6 线吸附)
   */
  public updateResize(
    screenPoint: Point,
    options: {
      candidates?: Rect[];
      snapThreshold?: number;
      enableSnapping?: boolean;
    } = {}
  ): {
    newBox: Rect;
    updatedElements: { id: string; rect: Rect }[];
    guides: SnapGuide[];
    snapped: boolean;
  } | null {
    if (this.mode !== "resizing") return null;

    const currentWorld = this.viewport.toWorld(screenPoint);
    const resizeRes = this.selection.updateResize(currentWorld, options);
    if (!resizeRes) return null;

    this.emitGuides(resizeRes.guides);
    return {
      newBox: resizeRes.newBox,
      updatedElements: resizeRes.updatedElements,
      guides: resizeRes.guides,
      snapped: resizeRes.snapped
    };
  }

  /**
   * 结束控制手柄缩放
   */
  public endResize(): void {
    if (this.mode === "resizing") {
      this.selection.endResize();
      this.emitGuides([]);
      this.setMode("idle");
    }
  }
}
