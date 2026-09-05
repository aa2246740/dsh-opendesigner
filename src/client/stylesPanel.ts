/**
 * 样式检查器面板 (StylesPanel Inspector)
 * 提取并可视化控制 Flex/Grid 布局、边距/间距、字体排版、颜色与背景、阴影圆角
 * 联动 mergeTailwindClasses 确保无损排他更新
 */

import { mergeTailwindClasses } from "../compiler/tailwindMerge.ts";
import type { FEElement } from "../store/flatStore.ts";

export interface ParsedStyles {
  // 1. Layout
  display?: "flex" | "grid" | "block" | "inline-block" | "hidden";
  flexDirection?: "row" | "col" | "row-reverse" | "col-reverse";
  justifyContent?: "start" | "center" | "end" | "between" | "around" | "evenly";
  alignItems?: "start" | "center" | "end" | "baseline" | "stretch";
  gap?: string;
  // 2. Spacing
  padding?: string;
  paddingX?: string;
  paddingY?: string;
  margin?: string;
  marginX?: string;
  marginY?: string;
  // 3. Typography
  textSize?: string;
  fontWeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  textColor?: string;
  // 4. Background & Colors
  backgroundColor?: string;
  opacity?: string;
  // 5. Borders & Corners
  borderWidth?: string;
  borderColor?: string;
  borderRadius?: string;
  // 6. Shadows
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

export class StylesPanelManager {
  /**
   * 解析元素 className 中的 Tailwind v4 视觉属性
   */
  public static parseClasses(className: string): ParsedStyles {
    const tokens = className.trim().split(/\s+/).filter(Boolean);
    const styles: ParsedStyles = {};

    for (const t of tokens) {
      // 布局
      if (t === "flex" || t === "grid" || t === "block" || t === "inline-block" || t === "hidden") {
        styles.display = t as any;
      } else if (t.startsWith("flex-row") || t.startsWith("flex-col")) {
        styles.flexDirection = t.replace("flex-", "") as any;
      } else if (t.startsWith("justify-")) {
        styles.justifyContent = t.replace("justify-", "") as any;
      } else if (t.startsWith("items-")) {
        styles.alignItems = t.replace("items-", "") as any;
      } else if (t.startsWith("gap-")) {
        styles.gap = t.replace("gap-", "");
      }
      // 边距
      else if (t.startsWith("px-")) styles.paddingX = t.replace("px-", "");
      else if (t.startsWith("py-")) styles.paddingY = t.replace("py-", "");
      else if (t.startsWith("p-")) styles.padding = t.replace("p-", "");
      else if (t.startsWith("mx-")) styles.marginX = t.replace("mx-", "");
      else if (t.startsWith("my-")) styles.marginY = t.replace("my-", "");
      else if (t.startsWith("m-")) styles.margin = t.replace("m-", "");
      // 文字
      else if (/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+[^\]]*\])$/.test(t)) styles.textSize = t.replace("text-", "");
      else if (/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/.test(t)) styles.fontWeight = t.replace("font-", "");
      else if (/^text-(left|center|right|justify)$/.test(t)) styles.textAlign = t.replace("text-", "") as any;
      else if (t.startsWith("text-") && !t.startsWith("text-opacity-")) styles.textColor = t.replace("text-", "");
      // 背景与透明度
      else if (t.startsWith("bg-") && !t.startsWith("bg-opacity-")) styles.backgroundColor = t.replace("bg-", "");
      else if (t.startsWith("opacity-")) styles.opacity = t.replace("opacity-", "");
      // 边框与圆角
      else if (t === "border" || /^border-(\d+|\[\d+[^\]]*\])$/.test(t)) styles.borderWidth = t === "border" ? "1" : t.replace("border-", "");
      else if (t === "border-none") styles.borderWidth = "0";
      else if (t.startsWith("border-") && !t.startsWith("border-opacity-") && !/^(border-(solid|dashed|dotted|double|none|hidden))$/.test(t)) styles.borderColor = t.replace("border-", "");
      else if (t.startsWith("rounded")) styles.borderRadius = t === "rounded" ? "DEFAULT" : t.replace("rounded-", "");
      // 阴影
      else if (t.startsWith("shadow")) styles.shadow = t === "shadow" ? "DEFAULT" : t.replace("shadow-", "");
    }

    return styles;
  }

  /**
   * 应用单个属性变更并返回更新后的合并 className
   */
  public static applyPropertyChange(
    currentClassName: string,
    propertyType: keyof ParsedStyles,
    value: string
  ): string {
    let token = "";

    switch (propertyType) {
      case "display":
        token = value;
        break;
      case "flexDirection":
        token = `flex-${value}`;
        break;
      case "justifyContent":
        token = `justify-${value}`;
        break;
      case "alignItems":
        token = `items-${value}`;
        break;
      case "gap":
        token = `gap-${value}`;
        break;
      case "padding":
        token = `p-${value}`;
        break;
      case "paddingX":
        token = `px-${value}`;
        break;
      case "paddingY":
        token = `py-${value}`;
        break;
      case "margin":
        token = `m-${value}`;
        break;
      case "marginX":
        token = `mx-${value}`;
        break;
      case "marginY":
        token = `my-${value}`;
        break;
      case "textSize":
        token = `text-${value}`;
        break;
      case "fontWeight":
        token = `font-${value}`;
        break;
      case "textAlign":
        token = `text-${value}`;
        break;
      case "textColor":
        token = `text-${value}`;
        break;
      case "backgroundColor":
        token = `bg-${value}`;
        break;
      case "opacity":
        token = `opacity-${value}`;
        break;
      case "borderWidth":
        token = value === "1" ? "border" : value === "0" || value === "none" ? "border-0" : `border-${value}`;
        break;
      case "borderColor":
        token = `border-${value}`;
        break;
      case "borderRadius":
        token = value === "DEFAULT" ? "rounded" : value === "none" ? "rounded-none" : `rounded-${value}`;
        break;
      case "shadow":
        token = value === "DEFAULT" ? "shadow" : value === "none" ? "shadow-none" : `shadow-${value}`;
        break;
    }

    if (!token) return currentClassName;
    return mergeTailwindClasses(currentClassName, token);
  }

  /**
   * 构建样式检查器面板的 UI 渲染模型
   */
  public static buildPanelSections(className: string): StylesPanelSection[] {
    const parsed = this.parseClasses(className);

    return [
      {
        id: "layout",
        title: "布局与流排版 (Layout)",
        controls: [
          {
            name: "display",
            label: "Display",
            type: "select",
            currentValue: parsed.display || "block",
            options: [
              { label: "Block", value: "block", className: "block" },
              { label: "Flex", value: "flex", className: "flex" },
              { label: "Grid", value: "grid", className: "grid" },
              { label: "Inline Block", value: "inline-block", className: "inline-block" }
            ]
          },
          {
            name: "flexDirection",
            label: "方向",
            type: "select",
            currentValue: parsed.flexDirection || "row",
            options: [
              { label: "水平 (Row)", value: "row", className: "flex-row" },
              { label: "垂直 (Column)", value: "col", className: "flex-col" }
            ]
          },
          {
            name: "gap",
            label: "间距 (Gap)",
            type: "spacing",
            currentValue: parsed.gap || "0"
          }
        ]
      },
      {
        id: "spacing",
        title: "边距与内衬 (Spacing)",
        controls: [
          { name: "padding", label: "内边距 (P)", type: "spacing", currentValue: parsed.padding || "" },
          { name: "paddingX", label: "水平内边距 (PX)", type: "spacing", currentValue: parsed.paddingX || "" },
          { name: "paddingY", label: "垂直内边距 (PY)", type: "spacing", currentValue: parsed.paddingY || "" },
          { name: "margin", label: "外边距 (M)", type: "spacing", currentValue: parsed.margin || "" }
        ]
      },
      {
        id: "typography",
        title: "排版与字体 (Typography)",
        controls: [
          {
            name: "textSize",
            label: "字号",
            type: "select",
            currentValue: parsed.textSize || "base",
            options: [
              { label: "12px (xs)", value: "xs", className: "text-xs" },
              { label: "14px (sm)", value: "sm", className: "text-sm" },
              { label: "16px (base)", value: "base", className: "text-base" },
              { label: "18px (lg)", value: "lg", className: "text-lg" },
              { label: "20px (xl)", value: "xl", className: "text-xl" },
              { label: "24px (2xl)", value: "2xl", className: "text-2xl" }
            ]
          },
          {
            name: "fontWeight",
            label: "字重",
            type: "select",
            currentValue: parsed.fontWeight || "normal",
            options: [
              { label: "常规 (400)", value: "normal", className: "font-normal" },
              { label: "中粗 (500)", value: "medium", className: "font-medium" },
              { label: "半粗 (600)", value: "semibold", className: "font-semibold" },
              { label: "粗体 (700)", value: "bold", className: "font-bold" }
            ]
          },
          { name: "textColor", label: "文字颜色", type: "color", currentValue: parsed.textColor || "" }
        ]
      },
      {
        id: "appearance",
        title: "色彩与背景 (Appearance)",
        controls: [
          { name: "backgroundColor", label: "背景颜色", type: "color", currentValue: parsed.backgroundColor || "" },
          { name: "opacity", label: "不透明度", type: "select", currentValue: parsed.opacity || "100" }
        ]
      },
      {
        id: "borders",
        title: "边框与圆角 (Borders & Radius)",
        controls: [
          {
            name: "borderRadius",
            label: "圆角",
            type: "select",
            currentValue: parsed.borderRadius || "none",
            options: [
              { label: "无", value: "none", className: "rounded-none" },
              { label: "小 (sm)", value: "sm", className: "rounded-sm" },
              { label: "默认 (rounded)", value: "DEFAULT", className: "rounded" },
              { label: "中 (md)", value: "md", className: "rounded-md" },
              { label: "大 (lg)", value: "lg", className: "rounded-lg" },
              { label: "超大 (xl)", value: "xl", className: "rounded-xl" },
              { label: "胶囊 (full)", value: "full", className: "rounded-full" }
            ]
          },
          {
            name: "borderWidth",
            label: "边框粗细",
            type: "select",
            currentValue: parsed.borderWidth || "0",
            options: [
              { label: "无 (0)", value: "0", className: "border-0" },
              { label: "1px", value: "1", className: "border" },
              { label: "2px", value: "2", className: "border-2" },
              { label: "4px", value: "4", className: "border-4" },
              { label: "8px", value: "8", className: "border-8" }
            ]
          },
          { name: "borderColor", label: "边框颜色", type: "color", currentValue: parsed.borderColor || "" },
          {
            name: "shadow",
            label: "阴影",
            type: "select",
            currentValue: parsed.shadow || "none",
            options: [
              { label: "无", value: "none", className: "shadow-none" },
              { label: "微阴影 (sm)", value: "sm", className: "shadow-sm" },
              { label: "默认 (shadow)", value: "DEFAULT", className: "shadow" },
              { label: "普通 (md)", value: "md", className: "shadow-md" },
              { label: "大阴影 (lg)", value: "lg", className: "shadow-lg" },
              { label: "超大 (xl)", value: "xl", className: "shadow-xl" }
            ]
          }
        ]
      }
    ];
  }
}
