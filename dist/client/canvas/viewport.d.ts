/**
 * 2D 仿射变换与无限视口管理引擎 (Infinite Canvas Viewport)
 * 依据 docs/05 规约：
 * 依托 DOMMatrix 仿射变换矩阵，实现屏幕物理坐标与世界画布坐标的无损双向映射
 * 支持光标锚点缩放、触控板双指捏合缩放、滚轮平移与双击重置
 */
import { CanvasAffineMatrix } from "../geometry.ts";
import type { Point, Rect } from "../geometry.ts";
export interface ViewportState {
    zoom: number;
    panX: number;
    panY: number;
    minZoom: number;
    maxZoom: number;
}
export interface WheelEventPayload {
    deltaX: number;
    deltaY: number;
    clientX: number;
    clientY: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
}
export declare class InfiniteCanvasViewport {
    private state;
    constructor(initialState?: Partial<ViewportState>);
    getState(): Readonly<ViewportState>;
    getZoom(): number;
    getPan(): Point;
    /**
     * 平移视口
     */
    pan(dx: number, dy: number): void;
    /**
     * 设置绝对平移量
     */
    setPan(panX: number, panY: number): void;
    /**
     * 缩放视口（以特定屏幕点为基准点等比放大/缩小，保持鼠标指向的世界坐标不动）
     */
    zoomAt(screenPoint: Point, zoomDelta: number): void;
    /**
     * 双击重置画布视口（恢复 1.0 倍率与原点对齐）
     */
    reset(defaultZoom?: number, panX?: number, panY?: number): void;
    /**
     * 处理鼠标滚轮与触控板手势事件
     * - 按住 Ctrl/Meta 键（或触控板捏合）时：以光标为中心缩放
     * - 普通滚动：平移画布
     */
    handleWheel(event: WheelEventPayload): void;
    /**
     * 获取当前仿射变换矩阵
     */
    getMatrix(): CanvasAffineMatrix;
    /**
     * 输出标准的 CSS transform 样式字符串
     * 格式: matrix(s, 0, 0, s, tx, ty)
     */
    getCssTransform(): string;
    /**
     * 屏幕坐标转世界画布坐标
     */
    toWorld(screenPoint: Point): Point;
    /**
     * 世界画布坐标转屏幕视口坐标
     */
    toScreen(worldPoint: Point): Point;
    /**
     * 将屏幕矩形转为世界矩形
     */
    screenRectToWorld(screenRect: Rect): Rect;
    /**
     * 将世界矩形转为屏幕矩形
     */
    worldRectToScreen(worldRect: Rect): Rect;
}
//# sourceMappingURL=viewport.d.ts.map