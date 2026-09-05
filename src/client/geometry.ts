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
export const MIN_ELEMENT_SIZE = 8;

export function rectFromPoints(a: Point, b: Point): Rect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    left,
    top,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * 世界坐标转换为屏幕视口坐标
 */
export function worldToScreen(worldPoint: Point, zoom: number, panX: number, panY: number): Point {
  return {
    x: worldPoint.x * zoom + panX,
    y: worldPoint.y * zoom + panY
  };
}

/**
 * 屏幕视口坐标逆向转换为世界画布坐标
 */
export function screenToWorld(screenPoint: Point, zoom: number, panX: number, panY: number): Point {
  if (zoom === 0) throw new Error("Zoom factor cannot be zero");
  return {
    x: (screenPoint.x - panX) / zoom,
    y: (screenPoint.y - panY) / zoom
  };
}

/**
 * 2D 仿射变换矩阵
 */
export class CanvasAffineMatrix {
  public a: number; // scaleX
  public b: number; // skewY
  public c: number; // skewX
  public d: number; // scaleY
  public e: number; // translateX
  public f: number; // translateY

  constructor(zoom: number = 1.0, panX: number = 0, panY: number = 0) {
    this.a = zoom;
    this.b = 0;
    this.c = 0;
    this.d = zoom;
    this.e = panX;
    this.f = panY;
  }

  public transformPoint(p: Point): Point {
    return {
      x: this.a * p.x + this.c * p.y + this.e,
      y: this.b * p.x + this.d * p.y + this.f
    };
  }

  public inverseTransformPoint(p: Point): Point {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) throw new Error("Singular matrix cannot be inverted");
    return {
      x: (this.d * (p.x - this.e) - this.c * (p.y - this.f)) / det,
      y: (this.a * (p.y - this.f) - this.b * (p.x - this.e)) / det
    };
  }
}

/**
 * 伴随几何缩放算法 (companionGeometry)
 * 处理 8 向手柄（nw, n, ne, e, se, s, sw, w）的拉伸与反向边缘固定
 */
export function companionGeometry(
  start: Rect,
  handle: ResizeHandle,
  deltaWidth: number,
  deltaHeight: number
): Rect {
  const width = Math.max(MIN_ELEMENT_SIZE, start.width + deltaWidth);
  const height = Math.max(MIN_ELEMENT_SIZE, start.height + deltaHeight);

  return {
    width,
    height,
    // 西侧（左侧）拉伸时，反向位移补偿以固定右边缘
    left: handle.includes("w") ? start.left - (width - start.width) : start.left,
    // 北侧（顶侧）拉伸时，反向位移补偿以固定底边缘
    top: handle.includes("n") ? start.top - (height - start.height) : start.top
  };
}

/**
 * 计算多个矩形的合并包围盒 (Bounding Box)
 */
export function computeBoundingBox(rects: Rect[]): Rect {
  if (rects.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const r of rects) {
    minLeft = Math.min(minLeft, r.left);
    minTop = Math.min(minTop, r.top);
    maxRight = Math.max(maxRight, r.left + r.width);
    maxBottom = Math.max(maxBottom, r.top + r.height);
  }

  return {
    left: minLeft,
    top: minTop,
    width: Math.max(0, maxRight - minLeft),
    height: Math.max(0, maxBottom - minTop)
  };
}

/**
 * 多选元素伴随等比例缩放
 */
export function multiResize(
  elements: { id: string; rect: Rect }[],
  groupStartBox: Rect,
  handle: ResizeHandle,
  deltaWidth: number,
  deltaHeight: number
): { id: string; rect: Rect }[] {
  if (groupStartBox.width === 0 || groupStartBox.height === 0) {
    return elements;
  }

  const newGroupBox = companionGeometry(groupStartBox, handle, deltaWidth, deltaHeight);
  const scaleX = newGroupBox.width / groupStartBox.width;
  const scaleY = newGroupBox.height / groupStartBox.height;

  return elements.map(({ id, rect }) => {
    const relLeft = (rect.left - groupStartBox.left) / groupStartBox.width;
    const relTop = (rect.top - groupStartBox.top) / groupStartBox.height;
    const relWidth = rect.width / groupStartBox.width;
    const relHeight = rect.height / groupStartBox.height;

    return {
      id,
      rect: {
        left: newGroupBox.left + relLeft * newGroupBox.width,
        top: newGroupBox.top + relTop * newGroupBox.height,
        width: Math.max(MIN_ELEMENT_SIZE, relWidth * newGroupBox.width),
        height: Math.max(MIN_ELEMENT_SIZE, relHeight * newGroupBox.height)
      }
    };
  });
}
