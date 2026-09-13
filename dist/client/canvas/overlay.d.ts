/**
 * 选区指示器、8 向手柄与 6 线吸附引导线渲染器 (Selection & Snapping Overlay)
 * 依据 docs/05 规约：
 * 1. 绘制选区多选合并外边框
 * 2. 8 向控制手柄 (nw, n, ne, e, se, s, sw, w) 坐标计算与光标属性
 * 3. 6 线智能吸附辅助线 (Near/Center/Far 轴向对齐线与坐标标注)
 * 4. 纯轻量 SVG 与 HTML 标记字符串生成，兼顾无头测试与浏览器实时重绘
 */
import type { Rect } from "../geometry.ts";
import type { HandlePosition } from "../selection.ts";
import type { SnapGuide } from "../snapping.ts";
export interface OverlayRenderOptions {
    strokeColor?: string;
    guideColor?: string;
    handleSize?: number;
    showCoordinates?: boolean;
}
export declare class SelectionOverlayRenderer {
    private strokeColor;
    private guideColor;
    private handleSize;
    constructor(options?: OverlayRenderOptions);
    /**
     * 生成 8 向控制手柄的绝对几何坐标
     */
    computeHandles(box: Rect): HandlePosition[];
    /**
     * 生成包含选区框、8向手柄与吸附导引线的完整 SVG 标记
     */
    renderSvgOverlay(box: Rect | null, guides?: SnapGuide[], options?: {
        width?: number;
        height?: number;
        marquee?: Rect | null;
    }): string;
}
//# sourceMappingURL=overlay.d.ts.map