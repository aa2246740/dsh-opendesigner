/**
 * 样式检查器面板 (StylesPanel Inspector)
 * 提取并可视化控制 Flex/Grid 布局、边距/间距、字体排版、颜色与背景、阴影圆角
 * 联动 mergeTailwindClasses 确保无损排他更新
 */
export interface ParsedStyles {
    display?: "flex" | "grid" | "block" | "inline-block" | "hidden";
    flexDirection?: "row" | "col" | "row-reverse" | "col-reverse";
    justifyContent?: "start" | "center" | "end" | "between" | "around" | "evenly";
    alignItems?: "start" | "center" | "end" | "baseline" | "stretch";
    gap?: string;
    padding?: string;
    paddingX?: string;
    paddingY?: string;
    margin?: string;
    marginX?: string;
    marginY?: string;
    textSize?: string;
    fontWeight?: string;
    textAlign?: "left" | "center" | "right" | "justify";
    textColor?: string;
    backgroundColor?: string;
    opacity?: string;
    borderWidth?: string;
    borderColor?: string;
    borderRadius?: string;
    shadow?: string;
}
export interface StyleOption {
    label: string;
    value: string;
    className: string;
}
export interface StylesPanelSection {
    id: string;
    title: string;
    controls: {
        name: string;
        label: string;
        type: "select" | "color" | "spacing" | "toggle";
        currentValue?: string;
        options?: StyleOption[];
    }[];
}
export declare class StylesPanelManager {
    /**
     * 解析元素 className 中的 Tailwind v4 视觉属性
     */
    static parseClasses(className: string): ParsedStyles;
    /**
     * 应用单个属性变更并返回更新后的合并 className
     */
    static applyPropertyChange(currentClassName: string, propertyType: keyof ParsedStyles, value: string): string;
    /**
     * 构建样式检查器面板的 UI 渲染模型
     */
    static buildPanelSections(className: string): StylesPanelSection[];
}
//# sourceMappingURL=stylesPanel.d.ts.map