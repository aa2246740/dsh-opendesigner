/**
 * 6 线智能吸附实时导引线渲染层 (Snapping Overlay Layer)
 * 拖拽对齐时高亮显示粉色/红色基准线与几何间距标尺
 */
import type { SnapGuide } from "./snapping.ts";
export interface RenderableGuideLine {
    id: string;
    orientation: "vertical" | "horizontal";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string;
    label?: string;
}
export declare class SnappingOverlayRenderer {
    static defaultColor: string;
    static accentColor: string;
    /**
     * 将 SnapGuide 数组转为可供 SVG 或 Canvas 渲染的高亮导引线实体
     */
    static toRenderableLines(guides: SnapGuide[], options?: {
        color?: string;
        strokeWidth?: number;
        dashed?: boolean;
    }): RenderableGuideLine[];
    /**
     * 生成内联 SVG 字符串表示（用于直接嵌入视口渲染）
     */
    static renderSvgOverlay(guides: SnapGuide[], options?: {
        color?: string;
    }): string;
}
//# sourceMappingURL=snappingOverlay.d.ts.map