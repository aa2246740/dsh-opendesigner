/**
 * 选区指示器与 8 向拖拽手柄引擎 (Selection & 8-Direction Handles)
 * 深度联动 companionGeometry 伴随几何缩放与 6 线智能吸附
 */

import { companionGeometry, computeBoundingBox, MIN_ELEMENT_SIZE, multiResize } from "./geometry.ts";
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
   * 伴随拖拽移动更新缩放几何 (精确保持固定边缘不动，仅移动把手边缘并吸附)
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
    const snapThreshold = options.snapThreshold ?? 5;
    const candidates = options.candidates || [];
    const enableSnapping = options.enableSnapping !== false && candidates.length > 0;

    const guides: SnapGuide[] = [];
    let snappedX = false;
    let snappedY = false;

    // 1. 水平方向 (X 轴) 计算
    let newLeft = startBox.left;
    let newWidth = startBox.width;

    if (handle.includes("e")) {
      // 东侧手柄：左边缘固定，右边缘随鼠标移动
      const rawRight = startBox.left + Math.max(MIN_ELEMENT_SIZE, startBox.width + dx);
      let bestRight = rawRight;
      let minDelta = Infinity;
      let snapGuide: SnapGuide | null = null;

      if (enableSnapping) {
        for (const cand of candidates) {
          const candX = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
          for (const cx of candX) {
            const diff = Math.abs(cx - rawRight);
            if (diff <= snapThreshold && diff < minDelta) {
              minDelta = diff;
              bestRight = cx;
              snapGuide = {
                orientation: "vertical",
                coordinate: cx,
                start: Math.min(startBox.top, cand.top),
                end: Math.max(startBox.top + startBox.height, cand.top + cand.height)
              };
            }
          }
        }
      }

      newLeft = startBox.left;
      newWidth = Math.max(MIN_ELEMENT_SIZE, bestRight - startBox.left);
      if (snapGuide) {
        guides.push(snapGuide);
        snappedX = true;
      }
    } else if (handle.includes("w")) {
      // 西侧手柄：右边缘固定，左边缘随鼠标移动
      const fixedRight = startBox.left + startBox.width;
      const rawLeft = startBox.left + dx;
      let bestLeft = Math.min(fixedRight - MIN_ELEMENT_SIZE, rawLeft);
      let minDelta = Infinity;
      let snapGuide: SnapGuide | null = null;

      if (enableSnapping) {
        for (const cand of candidates) {
          const candX = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
          for (const cx of candX) {
            const diff = Math.abs(cx - rawLeft);
            if (diff <= snapThreshold && diff < minDelta) {
              minDelta = diff;
              bestLeft = Math.min(fixedRight - MIN_ELEMENT_SIZE, cx);
              snapGuide = {
                orientation: "vertical",
                coordinate: cx,
                start: Math.min(startBox.top, cand.top),
                end: Math.max(startBox.top + startBox.height, cand.top + cand.height)
              };
            }
          }
        }
      }

      newLeft = bestLeft;
      newWidth = Math.max(MIN_ELEMENT_SIZE, fixedRight - bestLeft);
      if (snapGuide) {
        guides.push(snapGuide);
        snappedX = true;
      }
    }

    // 2. 垂直方向 (Y 轴) 计算
    let newTop = startBox.top;
    let newHeight = startBox.height;

    if (handle.includes("s")) {
      // 南侧手柄：顶边缘固定，底边缘随鼠标移动
      const rawBottom = startBox.top + Math.max(MIN_ELEMENT_SIZE, startBox.height + dy);
      let bestBottom = rawBottom;
      let minDelta = Infinity;
      let snapGuide: SnapGuide | null = null;

      if (enableSnapping) {
        for (const cand of candidates) {
          const candY = [cand.top, cand.top + cand.height / 2, cand.top + cand.height];
          for (const cy of candY) {
            const diff = Math.abs(cy - rawBottom);
            if (diff <= snapThreshold && diff < minDelta) {
              minDelta = diff;
              bestBottom = cy;
              snapGuide = {
                orientation: "horizontal",
                coordinate: cy,
                start: Math.min(startBox.left, cand.left),
                end: Math.max(startBox.left + startBox.width, cand.left + cand.width)
              };
            }
          }
        }
      }

      newTop = startBox.top;
      newHeight = Math.max(MIN_ELEMENT_SIZE, bestBottom - startBox.top);
      if (snapGuide) {
        guides.push(snapGuide);
        snappedY = true;
      }
    } else if (handle.includes("n")) {
      // 北侧手柄：底边缘固定，顶边缘随鼠标移动
      const fixedBottom = startBox.top + startBox.height;
      const rawTop = startBox.top + dy;
      let bestTop = Math.min(fixedBottom - MIN_ELEMENT_SIZE, rawTop);
      let minDelta = Infinity;
      let snapGuide: SnapGuide | null = null;

      if (enableSnapping) {
        for (const cand of candidates) {
          const candY = [cand.top, cand.top + cand.height / 2, cand.top + cand.height];
          for (const cy of candY) {
            const diff = Math.abs(cy - rawTop);
            if (diff <= snapThreshold && diff < minDelta) {
              minDelta = diff;
              bestTop = Math.min(fixedBottom - MIN_ELEMENT_SIZE, cy);
              snapGuide = {
                orientation: "horizontal",
                coordinate: cy,
                start: Math.min(startBox.left, cand.left),
                end: Math.max(startBox.left + startBox.width, cand.left + cand.width)
              };
            }
          }
        }
      }

      newTop = bestTop;
      newHeight = Math.max(MIN_ELEMENT_SIZE, fixedBottom - bestTop);
      if (snapGuide) {
        guides.push(snapGuide);
        snappedY = true;
      }
    }

    const newBox: Rect = {
      left: newLeft,
      top: newTop,
      width: newWidth,
      height: newHeight
    };
    const snapped = snappedX || snappedY;

    // 3. 计算子元素伴随等比缩放
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
   * 平移拖拽选区并触发 6 线智能吸附
   */
  public moveSelection(
    deltaX: number,
    deltaY: number,
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
    const box = this.getBoundingBox();
    if (!box) return null;

    let targetBox: Rect = {
      left: box.left + deltaX,
      top: box.top + deltaY,
      width: box.width,
      height: box.height
    };

    let guides: SnapGuide[] = [];
    let snapped = false;

    if (options.enableSnapping !== false && options.candidates && options.candidates.length > 0) {
      const snapRes = compute6LineSnapping(targetBox, options.candidates, options.snapThreshold ?? 5);
      targetBox = snapRes.snappedRect;
      guides = snapRes.guides;
      snapped = snapRes.snappedX || snapRes.snappedY;
    }

    const actualDx = targetBox.left - box.left;
    const actualDy = targetBox.top - box.top;

    const updatedElements: { id: string; rect: Rect }[] = [];
    for (const id of this.selectedIds) {
      const r = this.elementRects.get(id);
      if (r) {
        const movedRect = {
          left: r.left + actualDx,
          top: r.top + actualDy,
          width: r.width,
          height: r.height
        };
        this.elementRects.set(id, movedRect);
        updatedElements.push({ id, rect: movedRect });
      }
    }

    return {
      newBox: targetBox,
      updatedElements,
      guides,
      snapped
    };
  }

  public isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  /**
   * 结束缩放会话
   */
  public endResize(): void {
    this.activeSession = null;
  }
}
