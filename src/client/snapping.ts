/**
 * 6 线智能吸附算法 (6-Line Smart Snapping)
 * 垂直 3 线 (Left, Center, Right) 与水平 3 线 (Top, Center, Bottom)
 * 在拖拽与缩放时提供动态对齐吸附并生成对齐导引线
 */

import type { Rect } from "./geometry.ts";

export interface SnapGuide {
  orientation: "vertical" | "horizontal";
  coordinate: number; // 辅助线的 X 或 Y 绝对坐标
  start: number; // 辅助线起点（Y 或 X）
  end: number; // 辅助线终点（Y 或 X）
}

export interface SnapResult {
  snappedRect: Rect;
  guides: SnapGuide[];
  snappedX: boolean;
  snappedY: boolean;
}

export function compute6LineSnapping(
  active: Rect,
  candidates: Rect[],
  threshold: number = 5
): SnapResult {
  let bestDeltaX: number | null = null;
  let bestGuideX: SnapGuide | null = null;

  let bestDeltaY: number | null = null;
  let bestGuideY: SnapGuide | null = null;

  // 活动矩形的 3 垂直线与 3 水平线
  const activeVerticals = [
    { type: "near", val: active.left },
    { type: "center", val: active.left + active.width / 2 },
    { type: "far", val: active.left + active.width }
  ];

  const activeHorizontals = [
    { type: "near", val: active.top },
    { type: "center", val: active.top + active.height / 2 },
    { type: "far", val: active.top + active.height }
  ];

  for (const cand of candidates) {
    const candVerticals = [
      cand.left,
      cand.left + cand.width / 2,
      cand.left + cand.width
    ];

    const candHorizontals = [
      cand.top,
      cand.top + cand.height / 2,
      cand.top + cand.height
    ];

    // 1. X 轴吸附判定
    for (const aV of activeVerticals) {
      for (const cV of candVerticals) {
        const delta = cV - aV.val;
        if (Math.abs(delta) <= threshold) {
          if (bestDeltaX === null || Math.abs(delta) < Math.abs(bestDeltaX)) {
            bestDeltaX = delta;
            const minY = Math.min(active.top, cand.top);
            const maxY = Math.max(active.top + active.height, cand.top + cand.height);
            bestGuideX = {
              orientation: "vertical",
              coordinate: cV,
              start: minY,
              end: maxY
            };
          }
        }
      }
    }

    // 2. Y 轴吸附判定
    for (const aH of activeHorizontals) {
      for (const cH of candHorizontals) {
        const delta = cH - aH.val;
        if (Math.abs(delta) <= threshold) {
          if (bestDeltaY === null || Math.abs(delta) < Math.abs(bestDeltaY)) {
            bestDeltaY = delta;
            const minX = Math.min(active.left, cand.left);
            const maxX = Math.max(active.left + active.width, cand.left + cand.width);
            bestGuideY = {
              orientation: "horizontal",
              coordinate: cH,
              start: minX,
              end: maxX
            };
          }
        }
      }
    }
  }

  const snappedLeft = bestDeltaX !== null ? active.left + bestDeltaX : active.left;
  const snappedTop = bestDeltaY !== null ? active.top + bestDeltaY : active.top;

  const guides: SnapGuide[] = [];
  if (bestGuideX) guides.push(bestGuideX);
  if (bestGuideY) guides.push(bestGuideY);

  return {
    snappedRect: {
      left: snappedLeft,
      top: snappedTop,
      width: active.width,
      height: active.height
    },
    guides,
    snappedX: bestDeltaX !== null,
    snappedY: bestDeltaY !== null
  };
}
