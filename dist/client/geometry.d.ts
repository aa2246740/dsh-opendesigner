/**
 * 画布几何引擎：DOMMatrix 2D 仿射变换、屏幕与世界坐标映射、8向手柄缩放
 */
export interface Point {
    x: number;
    y: number;
}
export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
/** Designed product minimum for resize; not a 1px engine floor. */
export declare const MIN_ELEMENT_SIZE = 8;
export declare function rectFromPoints(a: Point, b: Point): Rect;
export declare function rectsIntersect(a: Rect, b: Rect): boolean;
/**
 * 世界坐标转换为屏幕视口坐标
 */
export declare function worldToScreen(worldPoint: Point, zoom: number, panX: number, panY: number): Point;
/**
 * 屏幕视口坐标逆向转换为世界画布坐标
 */
export declare function screenToWorld(screenPoint: Point, zoom: number, panX: number, panY: number): Point;
/**
 * 2D 仿射变换矩阵
 */
export declare class CanvasAffineMatrix {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    constructor(zoom?: number, panX?: number, panY?: number);
    transformPoint(p: Point): Point;
    inverseTransformPoint(p: Point): Point;
}
/**
 * 伴随几何缩放算法 (companionGeometry)
 * 处理 8 向手柄（nw, n, ne, e, se, s, sw, w）的拉伸与反向边缘固定
 */
export declare function companionGeometry(start: Rect, handle: ResizeHandle, deltaWidth: number, deltaHeight: number): Rect;
/**
 * 计算多个矩形的合并包围盒 (Bounding Box)
 */
export declare function computeBoundingBox(rects: Rect[]): Rect;
/**
 * 多选元素伴随等比例缩放
 */
export declare function multiResize(elements: {
    id: string;
    rect: Rect;
}[], groupStartBox: Rect, handle: ResizeHandle, deltaWidth: number, deltaHeight: number): {
    id: string;
    rect: Rect;
}[];
//# sourceMappingURL=geometry.d.ts.map