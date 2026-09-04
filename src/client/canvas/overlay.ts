/**
 * 选区指示器、8 向手柄与 6 线吸附引导线渲染器 (Selection & Snapping Overlay)
 * 依据 docs/05 规约：
 * 1. 绘制选区多选合并外边框
 * 2. 8 向控制手柄 (nw, n, ne, e, se, s, sw, w) 坐标计算与光标属性
 * 3. 6 线智能吸附辅助线 (Near/Center/Far 轴向对齐线与坐标标注)
 * 4. 纯轻量 SVG 与 HTML 标记字符串生成，兼顾无头测试与浏览器实时重绘
 */

import type { Rect, ResizeHandle } from "../geometry.ts";
import type { HandlePosition } from "../selection.ts";
import type { SnapGuide } from "../snapping.ts";

export interface OverlayRenderOptions {
  strokeColor?: string;
  guideColor?: string;
  handleSize?: number;
  showCoordinates?: boolean;
}

export class SelectionOverlayRenderer {
  private strokeColor: string;
  private guideColor: string;
  private handleSize: number;

  constructor(options: OverlayRenderOptions = {}) {
    this.strokeColor = options.strokeColor || "#3b82f6"; // Tailwind blue-500
    this.guideColor = options.guideColor || "#ef4444";   // Tailwind red-500
    this.handleSize = options.handleSize || 8;
  }

  /**
   * 生成 8 向控制手柄的绝对几何坐标
   */
  public computeHandles(box: Rect): HandlePosition[] {
    const { left, top, width, height } = box;
    const midX = left + width / 2;
    const midY = top + height / 2;
    const right = left + width;
    const bottom = top + height;

    return [
      { handle: "nw", point: { x: left, y: top }, cursor: "nwse-resize" },
      { handle: "n", point: { x: midX, y: top }, cursor: "ns-resize" },
      { handle: "ne", point: { x: right, y: top }, cursor: "nesw-resize" },
      { handle: "e", point: { x: right, y: midY }, cursor: "ew-resize" },
      { handle: "se", point: { x: right, y: bottom }, cursor: "nwse-resize" },
      { handle: "s", point: { x: midX, y: bottom }, cursor: "ns-resize" },
      { handle: "sw", point: { x: left, y: bottom }, cursor: "nesw-resize" },
      { handle: "w", point: { x: left, y: midY }, cursor: "ew-resize" }
    ];
  }

  /**
   * 生成包含选区框、8向手柄与吸附导引线的完整 SVG 标记
   */
  public renderSvgOverlay(
    box: Rect | null,
    guides: SnapGuide[] = [],
    options: { width?: number; height?: number } = {}
  ): string {
    const svgWidth = options.width || 2000;
    const svgHeight = options.height || 2000;

    const parts: string[] = [
      `<svg class="canvas-selection-overlay" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="position:absolute;top:0;left:0;pointer-events:none;z-index:50;" xmlns="http://www.w3.org/2000/svg">`
    ];

    // 1. 渲染 6 线智能吸附辅助线
    for (const guide of guides) {
      if (guide.orientation === "vertical") {
        parts.push(
          `<line x1="${guide.coordinate}" y1="${guide.start}" x2="${guide.coordinate}" y2="${guide.end}" stroke="${this.guideColor}" stroke-width="1" stroke-dasharray="3 3" />`
        );
        parts.push(
          `<circle cx="${guide.coordinate}" cy="${(guide.start + guide.end) / 2}" r="2" fill="${this.guideColor}" />`
        );
      } else {
        parts.push(
          `<line x1="${guide.start}" y1="${guide.coordinate}" x2="${guide.end}" y2="${guide.coordinate}" stroke="${this.guideColor}" stroke-width="1" stroke-dasharray="3 3" />`
        );
        parts.push(
          `<circle cx="${(guide.start + guide.end) / 2}" cy="${guide.coordinate}" r="2" fill="${this.guideColor}" />`
        );
      }
    }

    // 2. 渲染选区主外边框与 8 向控制点
    if (box) {
      parts.push(
        `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="${this.strokeColor}" stroke-width="1.5" />`
      );

      const half = this.handleSize / 2;
      const handles = this.computeHandles(box);

      for (const h of handles) {
        parts.push(
          `<g class="resize-handle-group" data-handle="${h.handle}" data-testid="overlay-handle-${h.handle}" style="pointer-events:auto;cursor:${h.cursor};">
            <title>Resize ${h.handle}</title>
            <rect class="resize-handle handle-${h.handle}" x="${h.point.x - half}" y="${h.point.y - half}" width="${this.handleSize}" height="${this.handleSize}" fill="#ffffff" stroke="${this.strokeColor}" stroke-width="1.5" />
          </g>`
        );
      }
    }

    parts.push(`</svg>`);
    return parts.join("\n");
  }
}
