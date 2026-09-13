/**
 * 6 线智能吸附算法 (6-Line Smart Snapping)
 * 垂直 3 线 (Left, Center, Right) 与水平 3 线 (Top, Center, Bottom)
 * 在拖拽与缩放时提供动态对齐吸附并生成对齐导引线
 */
import type { Rect } from "./geometry.ts";
export interface SnapGuide {
    orientation: "vertical" | "horizontal";
    coordinate: number;
    start: number;
    end: number;
}
export interface SnapResult {
    snappedRect: Rect;
    guides: SnapGuide[];
    snappedX: boolean;
    snappedY: boolean;
}
export declare function compute6LineSnapping(active: Rect, candidates: Rect[], threshold?: number): SnapResult;
//# sourceMappingURL=snapping.d.ts.map