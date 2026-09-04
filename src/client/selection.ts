/**
 * 选区指示器与 8 向拖拽手柄引擎 (Selection & 8-Direction Handles)
 * 深度联动 companionGeometry 伴随几何缩放与 6 线智能吸附
 */

import { companionGeometry, computeBoundingBox, multiResize } from "./geometry.ts";
import type { Point, Rect, ResizeHandle } from "./geometry.ts";
import { compute6LineSnapping } from "./snapping.ts";
import type { SnapGuide, SnapResult } from "./snapping.ts";

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface HandlePosition {
  handle: ResizeHandle;
  point: Point;
  cursor: string;
}

export interface SelectionState {
  selectedIds: string[];
  boundingBox: Rect | null;
}

export interface ResizeSession {
  handle: ResizeHandle;
  startBox: Rect;
  startPoint: Point;
  elements: { id: string; rect: Rect }[];
}

export class SelectionManager {
  private selectedIds: Set<string> = new Set();
  private elementRects: Map<string, Rect> = new Map();
  private activeSession: ResizeSession | null = null;

  public setElements(elements: { id: string; rect: Rect }[]): void {
    this.elementRects.clear();
    for (const el of elements) {
      this.elementRects.set(el.id, el.rect);
    }
  }

  public select(ids: string[]): void {
    this.selectedIds = new Set(ids);
  }

  public toggleSelect(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
  }

  public clearSelection(): void {
    this.selectedIds.clear();
  }

  public getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  /**
   * 获取当前选区合并包围盒 (Bounding Box)
   */
  public getBoundingBox(): Rect | null {
    const rects: Rect[] = [];
    for (const id of this.selectedIds) {
      const r = this.elementRects.get(id);
      if (r) rects.push(r);
    }
    if (rects.length === 0) return null;
    return computeBoundingBox(rects);
  }

  /**
   * 计算 8 向控制手柄的坐标与鼠标光标样式
   */
  public getHandles(box?: Rect | null): HandlePosition[] {
    const targetBox = box || this.getBoundingBox();
    if (!targetBox) return [];

    const { left, top, width, height } = targetBox;
    const midX = left + width / 2;
    const midY = top + height / 2;
    const right = left + width;
    const bottom = top + height;

    const handleDefs: { handle: ResizeHandle; point: Point; cursor: string }[] = [
      { handle: "nw", point: { x: left, y: top }, cursor: "nwse-resize" },
      { handle: "n", point: { x: midX, y: top }, cursor: "ns-resize" },
      { handle: "ne", point: { x: right, y: top }, cursor: "nesw-resize" },
      { handle: "e", point: { x: right, y: midY }, cursor: "ew-resize" },
      { handle: "se", point: { x: right, y: bottom }, cursor: "nwse-resize" },
      { handle: "s", point: { x: midX, y: bottom }, cursor: "ns-resize" },
      { handle: "sw", point: { x: left, y: bottom }, cursor: "nesw-resize" },
      { handle: "w", point: { x: left, y: midY }, cursor: "ew-resize" }
    ];

    return handleDefs;
  }

  /**
   * 启动缩放拖拽会话
   */
  public startResize(handle: ResizeHandle, cursorPoint: Point): boolean {
    const box = this.getBoundingBox();
    if (!box) return false;

    const elements: { id: string; rect: Rect }[] = [];
    for (const id of this.selectedIds) {
      const r = this.elementRects.get(id);
      if (r) elements.push({ id, rect: { ...r } });
    }

    this.activeSession = {
      handle,
      startBox: { ...box },
      startPoint: { ...cursorPoint },
      elements
    };

    return true;
  }

  /**
   * 伴随拖拽移动更新缩放几何
   */
  public updateResize(
    currentCursor: Point,
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
    if (!this.activeSession) return null;

    const { handle, startBox, startPoint, elements } = this.activeSession;
    const dx = currentCursor.x - startPoint.x;
    const dy = currentCursor.y - startPoint.y;

    // 1. 根据手柄方向计算 deltaWidth 与 deltaHeight
    let deltaWidth = 0;
    let deltaHeight = 0;

    if (handle.includes("e")) deltaWidth = dx;
    else if (handle.includes("w")) deltaWidth = -dx;

    if (handle.includes("s")) deltaHeight = dy;
    else if (handle.includes("n")) deltaHeight = -dy;

    // 2. 调用伴随几何核心算法
    let newBox = companionGeometry(startBox, handle, deltaWidth, deltaHeight);
    let guides: SnapGuide[] = [];
    let snapped = false;

    // 3. 联动 6 线智能吸附
    if (options.enableSnapping !== false && options.candidates && options.candidates.length > 0) {
      const snapRes = compute6LineSnapping(newBox, options.candidates, options.snapThreshold ?? 5);
      newBox = snapRes.snappedRect;
      guides = snapRes.guides;
      snapped = snapRes.snappedX || snapRes.snappedY;
    }

    // 4. 计算子元素伴随等比缩放
    let updatedElements: { id: string; rect: Rect }[];
    if (elements.length === 1) {
      updatedElements = [{ id: elements[0].id, rect: newBox }];
    } else {
      updatedElements = multiResize(
        elements,
        startBox,
        handle,
        newBox.width - startBox.width,
        newBox.height - startBox.height
      );
    }

    // 更新内部缓存
    for (const item of updatedElements) {
      this.elementRects.set(item.id, item.rect);
    }

    return {
      newBox,
      updatedElements,
      guides,
      snapped
    };
  }

  /**
   * 结束缩放会话
   */
  public endResize(): void {
    this.activeSession = null;
  }
}
