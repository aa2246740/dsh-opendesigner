/**
 * 选区指示器与 8 向拖拽手柄引擎 (Selection & 8-Direction Handles)
 * 深度联动 companionGeometry 伴随几何缩放与 6 线智能吸附
 */
import type { Point, Rect, ResizeHandle } from "./geometry.ts";
import type { SnapGuide } from "./snapping.ts";
export declare const RESIZE_HANDLES: ResizeHandle[];
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
    elements: {
        id: string;
        rect: Rect;
    }[];
}
export declare class SelectionManager {
    private selectedIds;
    private elementRects;
    private activeSession;
    setElements(elements: {
        id: string;
        rect: Rect;
    }[]): void;
    select(ids: string[]): void;
    toggleSelect(id: string): void;
    clearSelection(): void;
    getSelectedIds(): string[];
    /**
     * 获取当前选区合并包围盒 (Bounding Box)
     */
    getBoundingBox(): Rect | null;
    /**
     * 计算 8 向控制手柄的坐标与鼠标光标样式
     */
    getHandles(box?: Rect | null): HandlePosition[];
    /**
     * 启动缩放拖拽会话
     */
    startResize(handle: ResizeHandle, cursorPoint: Point): boolean;
    /**
     * 伴随拖拽移动更新缩放几何 (精确保持固定边缘不动，仅移动把手边缘并吸附)
     */
    updateResize(currentCursor: Point, options?: {
        candidates?: Rect[];
        snapThreshold?: number;
        enableSnapping?: boolean;
    }): {
        newBox: Rect;
        updatedElements: {
            id: string;
            rect: Rect;
        }[];
        guides: SnapGuide[];
        snapped: boolean;
    } | null;
    /**
     * 平移拖拽选区并触发 6 线智能吸附
     */
    moveSelection(deltaX: number, deltaY: number, options?: {
        candidates?: Rect[];
        snapThreshold?: number;
        enableSnapping?: boolean;
    }): {
        newBox: Rect;
        updatedElements: {
            id: string;
            rect: Rect;
        }[];
        guides: SnapGuide[];
        snapped: boolean;
    } | null;
    isSelected(id: string): boolean;
    /**
     * 结束缩放会话
     */
    endResize(): void;
}
//# sourceMappingURL=selection.d.ts.map