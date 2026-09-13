/**
 * 6 线智能吸附实时导引线渲染层 (Snapping Overlay Layer)
 * 拖拽对齐时高亮显示粉色/红色基准线与几何间距标尺
 */
export class SnappingOverlayRenderer {
    static defaultColor = "#ec4899"; // Tailwind pink-500
    static accentColor = "#ef4444"; // Tailwind red-500
    /**
     * 将 SnapGuide 数组转为可供 SVG 或 Canvas 渲染的高亮导引线实体
     */
    static toRenderableLines(guides, options = {}) {
        const color = options.color || this.defaultColor;
        const strokeWidth = options.strokeWidth ?? 1;
        const strokeDasharray = options.dashed ? "4,4" : undefined;
        return guides.map((g, idx) => {
            if (g.orientation === "vertical") {
                return {
                    id: `guide_v_${idx}_${Math.round(g.coordinate)}`,
                    orientation: "vertical",
                    x1: g.coordinate,
                    y1: g.start,
                    x2: g.coordinate,
                    y2: g.end,
                    stroke: color,
                    strokeWidth,
                    strokeDasharray,
                    label: `X: ${Math.round(g.coordinate)}px`
                };
            }
            else {
                return {
                    id: `guide_h_${idx}_${Math.round(g.coordinate)}`,
                    orientation: "horizontal",
                    x1: g.start,
                    y1: g.coordinate,
                    x2: g.end,
                    y2: g.coordinate,
                    stroke: color,
                    strokeWidth,
                    strokeDasharray,
                    label: `Y: ${Math.round(g.coordinate)}px`
                };
            }
        });
    }
    /**
     * 生成内联 SVG 字符串表示（用于直接嵌入视口渲染）
     */
    static renderSvgOverlay(guides, options = {}) {
        const lines = this.toRenderableLines(guides, options);
        if (lines.length === 0)
            return "";
        const elements = lines.map((l) => {
            const dash = l.strokeDasharray ? ` stroke-dasharray="${l.strokeDasharray}"` : "";
            return `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}"${dash} />`;
        });
        return `<g class="designer-snapping-guides">${elements.join("\n")}</g>`;
    }
}
//# sourceMappingURL=snappingOverlay.js.map