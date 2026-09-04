/**
 * Figma Kiwi 二进制剪贴板协议解析器与 Tailwind v4 映射引擎
 * 依据 docs/06 规约：
 * 1. Kiwi 二进制模式解包器 (纯 TypeScript / ArrayBuffer 实现，零额外依赖)
 * 2. 节点树场景索引重建 (buildSceneIndex: nodeMap + childrenMap)
 * 3. 视觉属性映射 (AutoLayout ➔ Flex/Grid, Fill ➔ bg-*, Typography ➔ font tokens / text tokens)
 * 4. 自动降级与回退支持 (Kiwi 二进制 -> JSON 场景树 -> SVG/HTML 片段)
 */

import type { FEElement } from "../store/flatStore.ts";

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | string;
  offset?: { x: number; y: number };
  radius?: number;
  color?: FigmaColor;
  visible?: boolean;
}

export interface FigmaPaint {
  type: "SOLID" | "IMAGE" | "GRADIENT_LINEAR" | string;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: "DOCUMENT" | "CANVAS" | "FRAME" | "GROUP" | "RECTANGLE" | "VECTOR" | "TEXT" | "COMPONENT" | "INSTANCE" | string;
  parentId?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  // AutoLayout
  stackMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  // Visuals
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  effects?: FigmaEffect[];
  opacity?: number;
  // Typography
  characters?: string;
  fontSize?: number;
  fontWeight?: number | string;
  lineHeight?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  children?: FigmaNode[];
}

export interface SceneIndex {
  nodeMap: Map<string, FigmaNode>;
  childrenMap: Map<string, string[]>;
  rootIds: string[];
}

export interface FigmaParseResult {
  success: boolean;
  rootId: string;
  elements: FEElement[];
  jsx: string;
  error?: string;
  scene?: SceneIndex;
  nodes?: FigmaNode[];
}

/**
 * 纯 TypeScript Kiwi 二进制流解码器
 */
export class KiwiReader {
  private view: DataView;
  private offset: number = 0;
  private bytes: Uint8Array;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.bytes = buffer;
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
  }

  public isEOF(): boolean {
    return this.offset >= this.bytes.length;
  }

  public getOffset(): number {
    return this.offset;
  }

  public readByte(): number {
    if (this.offset >= this.bytes.length) return 0;
    return this.bytes[this.offset++];
  }

  /**
   * 读取无符号 Varint
   */
  public readVarUint(): number {
    let result = 0;
    let shift = 0;
    while (this.offset < this.bytes.length) {
      const b = this.bytes[this.offset++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift >= 32) break;
    }
    return result >>> 0;
  }

  /**
   * 读取带符号 Varint (ZigZag 编码)
   */
  public readVarInt(): number {
    const raw = this.readVarUint();
    return (raw >>> 1) ^ -(raw & 1);
  }

  /**
   * 读取 32 位浮点数
   */
  public readFloat32(): number {
    if (this.offset + 4 > this.bytes.length) return 0;
    const val = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return val;
  }

  /**
   * 读取长度前缀的 UTF-8 字符串
   */
  public readString(): string {
    const len = this.readVarUint();
    if (len === 0 || this.offset + len > this.bytes.length) return "";
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder("utf-8").decode(slice);
  }

  /**
   * 探测并跳过 Figma Kiwi 头部 Magic 标识
   */
  public checkHeader(): boolean {
    if (this.bytes.length < 4) return false;
    // 检测 "figma" 或 "kiwi" 字节
    const str = String.fromCharCode(...this.bytes.subarray(0, Math.min(8, this.bytes.length)));
    if (str.startsWith("figma")) {
      this.offset = 5;
      return true;
    }
    if (str.startsWith("kiwi")) {
      this.offset = 4;
      return true;
    }
    return false;
  }
}

/**
 * 纯 TypeScript Kiwi 二进制流编码器
 */
export class KiwiWriter {
  private buffer: Uint8Array;
  private offset: number = 0;

  constructor(initialCapacity: number = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  private ensureCapacity(needed: number): void {
    if (this.offset + needed <= this.buffer.length) return;
    let nextCapacity = Math.max(this.buffer.length * 2, this.offset + needed);
    const nextBuffer = new Uint8Array(nextCapacity);
    nextBuffer.set(this.buffer);
    this.buffer = nextBuffer;
  }

  public getOffset(): number {
    return this.offset;
  }

  public writeByte(b: number): void {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = b & 0xff;
  }

  public writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  /**
   * 写入无符号 Varint
   */
  public writeVarUint(value: number): void {
    let val = value >>> 0;
    while (val >= 0x80) {
      this.writeByte((val & 0x7f) | 0x80);
      val >>>= 7;
    }
    this.writeByte(val & 0x7f);
  }

  /**
   * 写入带符号 Varint (ZigZag 编码)
   */
  public writeVarInt(value: number): void {
    const zigzag = (value << 1) ^ (value >> 31);
    this.writeVarUint(zigzag);
  }

  /**
   * 写入 32 位浮点数
   */
  public writeFloat32(val: number): void {
    this.ensureCapacity(4);
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.offset, 4);
    view.setFloat32(0, val, true);
    this.offset += 4;
  }

  /**
   * 写入长度前缀的 UTF-8 字符串
   */
  public writeString(str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.writeVarUint(encoded.length);
    this.writeBytes(encoded);
  }

  /**
   * 写入 Figma Kiwi 头部 Magic 标识
   */
  public writeHeader(magic: "figma" | "kiwi" = "figma"): void {
    const magicBytes = new TextEncoder().encode(magic);
    this.writeBytes(magicBytes);
  }

  public toUint8Array(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }
}

/**
 * 调色板映射：将 Figma RGB 浮点色彩 (0-1) 映射为最贴合的 Tailwind 语义类名或 hex
 */
export function figmaColorToTailwind(
  color: FigmaColor,
  prefix: "bg" | "text" | "border" | "from" | "to" = "bg"
): string {
  const r = Math.round(Math.max(0, Math.min(1, color.r)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color.g)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color.b)) * 255);
  const a = color.a !== undefined ? Math.max(0, Math.min(1, color.a)) : 1;
  const opacitySuffix = a < 0.99 && a > 0 ? `/${Math.round(a * 100)}` : "";

  // 基础常用预设映射
  if (r === 255 && g === 255 && b === 255) return `${prefix}-white${opacitySuffix}`;
  if (r === 0 && g === 0 && b === 0) return `${prefix}-black${opacitySuffix}`;
  if (a === 0) return `${prefix}-transparent`;

  // 近似 Tailwind 调色盘
  if (r > 200 && g < 100 && b < 100) return `${prefix}-red-500${opacitySuffix}`;
  if (r < 100 && g > 180 && b < 100) return `${prefix}-green-500${opacitySuffix}`;
  if (r < 100 && g < 150 && b > 220) return `${prefix}-blue-500${opacitySuffix}`;
  if (r > 200 && g > 150 && b < 50) return `${prefix}-amber-500${opacitySuffix}`;
  if (r > 100 && g < 100 && b > 200) return `${prefix}-indigo-500${opacitySuffix}`;
  if (r > 200 && g < 100 && b > 200) return `${prefix}-pink-500${opacitySuffix}`;

  // 灰阶检测
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    if (r > 230) return `${prefix}-gray-100${opacitySuffix}`;
    if (r > 200) return `${prefix}-gray-200${opacitySuffix}`;
    if (r > 150) return `${prefix}-gray-400${opacitySuffix}`;
    if (r > 100) return `${prefix}-gray-600${opacitySuffix}`;
    if (r > 40) return `${prefix}-gray-800${opacitySuffix}`;
    return `${prefix}-gray-900${opacitySuffix}`;
  }

  // 兜底为十六进制 Arbitrary Value
  const hex = [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${prefix}-[#${hex}]${opacitySuffix}`;
}

/**
 * 边距像素数值映射为 Tailwind 标度
 */
export function pixelToTailwindScale(px?: number): string | null {
  if (px === undefined || px === null || px === 0) return null;
  const map: Record<number, string> = {
    1: "px",
    2: "0.5",
    4: "1",
    6: "1.5",
    8: "2",
    12: "3",
    16: "4",
    20: "5",
    24: "6",
    32: "8",
    40: "10",
    48: "12",
    64: "16"
  };
  if (map[px]) return map[px];
  return `[${px}px]`;
}

/**
 * 将单个 Figma 节点属性转译为生产级 Tailwind v4 类名
 */
export function figmaNodeToTailwindClasses(node: FigmaNode): string[] {
  const classes: string[] = [];

  // 1. AutoLayout (Flexbox) 映射
  if (node.stackMode === "HORIZONTAL") {
    classes.push("flex", "flex-row");
    if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
    else if (node.counterAxisAlignItems === "MAX") classes.push("items-end");
    else if (node.counterAxisAlignItems === "MIN") classes.push("items-start");
    else if (node.counterAxisAlignItems === "BASELINE") classes.push("items-baseline");
    else if (node.counterAxisAlignItems === "STRETCH") classes.push("items-stretch");

    if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
    else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");
    else if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");
    else if (node.primaryAxisAlignItems === "MIN") classes.push("justify-start");

    if (node.itemSpacing) {
      const gap = pixelToTailwindScale(node.itemSpacing);
      if (gap) classes.push(`gap-${gap}`);
    }
  } else if (node.stackMode === "VERTICAL") {
    classes.push("flex", "flex-col");
    if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
    else if (node.counterAxisAlignItems === "MAX") classes.push("items-end");
    else if (node.counterAxisAlignItems === "MIN") classes.push("items-start");
    else if (node.counterAxisAlignItems === "BASELINE") classes.push("items-baseline");
    else if (node.counterAxisAlignItems === "STRETCH") classes.push("items-stretch");

    if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
    else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");
    else if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");
    else if (node.primaryAxisAlignItems === "MIN") classes.push("justify-start");

    if (node.itemSpacing) {
      const gap = pixelToTailwindScale(node.itemSpacing);
      if (gap) classes.push(`gap-${gap}`);
    }
  }

  // 2. Padding 映射
  const { paddingLeft, paddingRight, paddingTop, paddingBottom } = node;
  if (paddingLeft !== undefined && paddingLeft === paddingRight && paddingLeft === paddingTop && paddingLeft === paddingBottom) {
    const p = pixelToTailwindScale(paddingLeft);
    if (p) classes.push(`p-${p}`);
  } else {
    if (paddingLeft !== undefined && paddingLeft === paddingRight) {
      const px = pixelToTailwindScale(paddingLeft);
      if (px) classes.push(`px-${px}`);
    } else {
      if (paddingLeft) classes.push(`pl-${pixelToTailwindScale(paddingLeft)}`);
      if (paddingRight) classes.push(`pr-${pixelToTailwindScale(paddingRight)}`);
    }

    if (paddingTop !== undefined && paddingTop === paddingBottom) {
      const py = pixelToTailwindScale(paddingTop);
      if (py) classes.push(`py-${py}`);
    } else {
      if (paddingTop) classes.push(`pt-${pixelToTailwindScale(paddingTop)}`);
      if (paddingBottom) classes.push(`pb-${pixelToTailwindScale(paddingBottom)}`);
    }
  }

  // 3. Fills (背景色与渐变)
  if (node.fills && node.fills.length > 0) {
    const solid = node.fills.find((f) => f.type === "SOLID" && f.visible !== false && f.color);
    if (solid?.color) {
      classes.push(figmaColorToTailwind(solid.color, "bg"));
    }

    // 支持线性渐变填充
    const gradient = node.fills.find((f) => f.type === "GRADIENT_LINEAR" && f.visible !== false);
    if (gradient) {
      classes.push("bg-gradient-to-r");
      const stops = (gradient as any).gradientStops;
      if (Array.isArray(stops) && stops.length >= 2) {
        classes.push(
          figmaColorToTailwind(stops[0].color, "from"),
          figmaColorToTailwind(stops[stops.length - 1].color, "to")
        );
      } else {
        classes.push("from-slate-900", "to-slate-800");
      }
    }
  }

  // 4. Strokes (边框)
  if (node.strokes && node.strokes.length > 0 && node.strokeWeight) {
    const sw = node.strokeWeight;
    if (sw === 1) classes.push("border");
    else if (sw === 2 || sw === 4 || sw === 8) classes.push(`border-${sw}`);
    else classes.push(`border-[${sw}px]`);

    const strokePaint = node.strokes.find((s) => s.type === "SOLID" && s.color);
    if (strokePaint?.color) {
      classes.push(figmaColorToTailwind(strokePaint.color, "border"));
    }
  }

  // 5. Corner Radius (圆角)
  if (node.cornerRadius) {
    const r = node.cornerRadius;
    if (r <= 2) classes.push("rounded-sm");
    else if (r <= 6) classes.push("rounded");
    else if (r <= 8) classes.push("rounded-md");
    else if (r <= 12) classes.push("rounded-lg");
    else if (r <= 16) classes.push("rounded-xl");
    else if (r <= 24) classes.push("rounded-2xl");
    else classes.push("rounded-full");
  }

  // 6. Effects (阴影)
  if (node.effects && node.effects.length > 0) {
    const shadow = node.effects.find((e) => e.type === "DROP_SHADOW" && e.visible !== false);
    if (shadow) {
      const rad = shadow.radius || 0;
      if (rad <= 2) classes.push("shadow-sm");
      else if (rad <= 6) classes.push("shadow");
      else if (rad <= 12) classes.push("shadow-md");
      else if (rad <= 20) classes.push("shadow-lg");
      else classes.push("shadow-xl");
    }
  }

  // 7. Opacity (图层透明度)
  if (node.opacity !== undefined && node.opacity < 1 && node.opacity >= 0) {
    const op = Math.round(node.opacity * 100);
    classes.push(`opacity-${op}`);
  }

  // 8. Typography (文字样式)
  if (node.type === "TEXT") {
    if (node.fontSize) {
      const sz = node.fontSize;
      if (sz <= 12) classes.push("text-xs");
      else if (sz <= 14) classes.push("text-sm");
      else if (sz <= 16) classes.push("text-base");
      else if (sz <= 18) classes.push("text-lg");
      else if (sz <= 20) classes.push("text-xl");
      else if (sz <= 24) classes.push("text-2xl");
      else if (sz <= 30) classes.push("text-3xl");
      else classes.push("text-4xl");
    }

    if (node.fontWeight) {
      const fw = typeof node.fontWeight === "string" ? node.fontWeight.toLowerCase() : node.fontWeight;
      if (fw === 500 || fw === "medium") classes.push("font-medium");
      else if (fw === 600 || fw === "semibold") classes.push("font-semibold");
      else if (fw === 700 || fw === "bold") classes.push("font-bold");
      else if (fw === 800 || fw === "extrabold") classes.push("font-extrabold");
    }

    if (node.textAlignHorizontal) {
      if (node.textAlignHorizontal === "CENTER") classes.push("text-center");
      else if (node.textAlignHorizontal === "RIGHT") classes.push("text-right");
    }

    if (node.lineHeight) {
      const lh = node.lineHeight;
      const lhMap: Record<number, string> = {
        12: "leading-3",
        16: "leading-4",
        20: "leading-5",
        24: "leading-6",
        28: "leading-7",
        32: "leading-8",
        36: "leading-9",
        40: "leading-10"
      };
      if (lhMap[lh]) classes.push(lhMap[lh]);
      else classes.push(`leading-[${lh}px]`);
    }

    // 文字颜色提取自 fills
    if (node.fills && node.fills.length > 0) {
      const textFill = node.fills.find((f) => f.type === "SOLID" && f.color);
      if (textFill?.color) {
        classes.push(figmaColorToTailwind(textFill.color, "text"));
      }
    }
  }

  return Array.from(new Set(classes));
}

/**
 * 场景索引重建：将无序变更节点列表重构为 nodeMap + childrenMap
 */
export function buildSceneIndex(nodes: FigmaNode[]): SceneIndex {
  const nodeMap = new Map<string, FigmaNode>();
  const childrenMap = new Map<string, string[]>();
  const allChildIds = new Set<string>();

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    if (!childrenMap.has(n.id)) {
      childrenMap.set(n.id, []);
    }
  }

  for (const n of nodes) {
    if (n.parentId && nodeMap.has(n.parentId)) {
      const list = childrenMap.get(n.parentId) || [];
      if (!list.includes(n.id)) list.push(n.id);
      childrenMap.set(n.parentId, list);
      allChildIds.add(n.id);
    }
    // 处理嵌套 children 数组
    if (Array.isArray(n.children)) {
      for (const child of n.children) {
        if (!nodeMap.has(child.id)) {
          nodeMap.set(child.id, child);
        }
        const list = childrenMap.get(n.id) || [];
        if (!list.includes(child.id)) list.push(child.id);
        childrenMap.set(n.id, list);
        allChildIds.add(child.id);
      }
    }
  }

  // 根节点定义为所有不在 allChildIds 中的唯一节点
  const rootIds = Array.from(new Set(nodes.filter((n) => !allChildIds.has(n.id)).map((n) => n.id)));

  return { nodeMap, childrenMap, rootIds };
}

/**
 * Kiwi 二进制封包器：将 FigmaNode 列表打包为紧凑二进制字节流
 */
export function packKiwiBinary(nodes: FigmaNode[], magic: "figma" | "kiwi" = "figma"): Uint8Array {
  const writer = new KiwiWriter();
  writer.writeHeader(magic);

  const typeMapInverse: Record<string, number> = {
    FRAME: 1,
    GROUP: 2,
    TEXT: 3,
    RECTANGLE: 4,
    VECTOR: 5,
    COMPONENT: 6,
    INSTANCE: 7
  };

  const primaryMapInverse: Record<string, number> = {
    MIN: 1,
    CENTER: 2,
    MAX: 3,
    SPACE_BETWEEN: 4
  };

  const counterMapInverse: Record<string, number> = {
    MIN: 1,
    CENTER: 2,
    MAX: 3,
    BASELINE: 4,
    STRETCH: 5
  };

  const textAlignMapInverse: Record<string, number> = {
    LEFT: 1,
    CENTER: 2,
    RIGHT: 3,
    JUSTIFIED: 4
  };

  for (const node of nodes) {
    writer.writeByte(1); // 节点起始标记
    writer.writeString(node.id || "");
    writer.writeString(node.name || "");
    writer.writeByte(typeMapInverse[node.type] || 1);

    // 几何尺寸 x, y, width, height
    writer.writeFloat32(node.x || 0);
    writer.writeFloat32(node.y || 0);
    writer.writeFloat32(node.width || 0);
    writer.writeFloat32(node.height || 0);

    // AutoLayout 标志与间距
    let autoMode = 0;
    if (node.stackMode === "HORIZONTAL") autoMode = 1;
    else if (node.stackMode === "VERTICAL") autoMode = 2;
    writer.writeByte(autoMode);

    if (autoMode > 0) {
      writer.writeVarUint(node.itemSpacing || 0);
      writer.writeVarUint(node.paddingLeft || 0);
      writer.writeVarUint(node.paddingRight || 0);
      writer.writeVarUint(node.paddingTop || 0);
      writer.writeVarUint(node.paddingBottom || 0);
      writer.writeByte(primaryMapInverse[node.primaryAxisAlignItems!] || 0);
      writer.writeByte(counterMapInverse[node.counterAxisAlignItems!] || 0);
    }

    // 色彩 Fill
    const solidFill = node.fills?.find((f) => f.type === "SOLID" && f.color);
    if (solidFill?.color) {
      writer.writeByte(1);
      writer.writeFloat32(solidFill.color.r);
      writer.writeFloat32(solidFill.color.g);
      writer.writeFloat32(solidFill.color.b);
      writer.writeFloat32(solidFill.color.a ?? 1);
    } else {
      writer.writeByte(0);
    }

    // 边框 Stroke
    const strokePaint = node.strokes?.find((s) => s.type === "SOLID" && s.color);
    if (strokePaint?.color && (node.strokeWeight ?? 0) > 0) {
      writer.writeByte(1);
      writer.writeVarUint(node.strokeWeight || 1);
      writer.writeFloat32(strokePaint.color.r);
      writer.writeFloat32(strokePaint.color.g);
      writer.writeFloat32(strokePaint.color.b);
      writer.writeFloat32(strokePaint.color.a ?? 1);
    } else {
      writer.writeByte(0);
    }

    // 圆角
    writer.writeVarUint(node.cornerRadius || 0);

    // 阴影 Effect
    const shadow = node.effects?.find((e) => e.type === "DROP_SHADOW" && e.visible !== false);
    if (shadow) {
      writer.writeByte(1);
      writer.writeVarUint(shadow.radius || 0);
    } else {
      writer.writeByte(0);
    }

    // 不透明度 Opacity
    writer.writeFloat32(node.opacity !== undefined ? node.opacity : 1.0);

    // 文本/内容字符串
    writer.writeString(node.characters || "");
    if (node.type === "TEXT") {
      writer.writeVarUint(node.fontSize || 16);
      const fw = typeof node.fontWeight === "number" ? node.fontWeight : 400;
      writer.writeVarUint(fw);
      writer.writeByte(textAlignMapInverse[node.textAlignHorizontal!] || 0);
      writer.writeVarUint(node.lineHeight || 0);
    }

    // 可选 parentId
    writer.writeString(node.parentId || "");
  }

  writer.writeByte(0); // 终止标记
  return writer.toUint8Array();
}

/**
 * Kiwi 模拟二进制解包器：解析二进制流中的 Figma 节点列表
 */
export function unpackKiwiBinary(buffer: Uint8Array, options: { requireHeader?: boolean } = {}): FigmaNode[] {
  const reader = new KiwiReader(buffer);
  const hasHeader = reader.checkHeader();
  if (options.requireHeader !== false && !hasHeader) {
    return [];
  }

  const nodes: FigmaNode[] = [];

  const primaryMap: Record<number, FigmaNode["primaryAxisAlignItems"]> = {
    1: "MIN",
    2: "CENTER",
    3: "MAX",
    4: "SPACE_BETWEEN"
  };

  const counterMap: Record<number, FigmaNode["counterAxisAlignItems"]> = {
    1: "MIN",
    2: "CENTER",
    3: "MAX",
    4: "BASELINE",
    5: "STRETCH"
  };

  const textAlignMap: Record<number, FigmaNode["textAlignHorizontal"]> = {
    1: "LEFT",
    2: "CENTER",
    3: "RIGHT",
    4: "JUSTIFIED"
  };

  while (!reader.isEOF()) {
    try {
      const typeCode = reader.readByte();
      if (typeCode === 0) break; // 终止符

      // 读取节点基本属性
      const id = reader.readString() || `node_${nodes.length + 1}`;
      const name = reader.readString() || "FigmaNode";
      const typeTag = reader.readByte();
      const typeMap: Record<number, FigmaNode["type"]> = {
        1: "FRAME",
        2: "GROUP",
        3: "TEXT",
        4: "RECTANGLE",
        5: "VECTOR",
        6: "COMPONENT",
        7: "INSTANCE"
      };
      const nodeType = typeMap[typeTag] || "FRAME";

      // 读取几何尺寸
      const x = reader.readFloat32();
      const y = reader.readFloat32();
      const width = reader.readFloat32();
      const height = reader.readFloat32();

      const node: FigmaNode = {
        id,
        name,
        type: nodeType
      };

      if (x || y) {
        node.x = x;
        node.y = y;
      }
      if (width) node.width = width;
      if (height) node.height = height;

      // 读取 AutoLayout 标志
      const autoLayoutMode = reader.readByte();
      if (autoLayoutMode === 1) node.stackMode = "HORIZONTAL";
      else if (autoLayoutMode === 2) node.stackMode = "VERTICAL";

      if (autoLayoutMode > 0) {
        node.itemSpacing = reader.readVarUint();
        node.paddingLeft = reader.readVarUint();
        node.paddingRight = reader.readVarUint();
        node.paddingTop = reader.readVarUint();
        node.paddingBottom = reader.readVarUint();
        const primTag = reader.readByte();
        if (primaryMap[primTag]) node.primaryAxisAlignItems = primaryMap[primTag];
        const counterTag = reader.readByte();
        if (counterMap[counterTag]) node.counterAxisAlignItems = counterMap[counterTag];
      }

      // 读取色彩 Fill
      const hasFill = reader.readByte();
      if (hasFill) {
        const r = reader.readFloat32();
        const g = reader.readFloat32();
        const b = reader.readFloat32();
        const a = reader.readFloat32();
        node.fills = [{ type: "SOLID", color: { r, g, b, a } }];
      }

      // 读取边框 Stroke
      const hasStroke = reader.readByte();
      if (hasStroke) {
        const strokeWeight = reader.readVarUint();
        const r = reader.readFloat32();
        const g = reader.readFloat32();
        const b = reader.readFloat32();
        const a = reader.readFloat32();
        node.strokeWeight = strokeWeight;
        node.strokes = [{ type: "SOLID", color: { r, g, b, a } }];
      }

      // 读取圆角
      node.cornerRadius = reader.readVarUint();

      // 读取阴影 Effect
      const hasShadow = reader.readByte();
      if (hasShadow) {
        const radius = reader.readVarUint();
        node.effects = [{ type: "DROP_SHADOW", radius, visible: true }];
      }

      // 读取不透明度 Opacity
      const opacity = reader.readFloat32();
      if (opacity < 1.0 && opacity >= 0) {
        node.opacity = opacity;
      }

      // 读取 characters
      const chars = reader.readString();
      if (chars) {
        node.characters = chars;
      }

      // 若为文本节点，读取排版
      if (node.type === "TEXT") {
        node.fontSize = reader.readVarUint();
        node.fontWeight = reader.readVarUint();
        const alignTag = reader.readByte();
        if (textAlignMap[alignTag]) node.textAlignHorizontal = textAlignMap[alignTag];
        const lh = reader.readVarUint();
        if (lh > 0) node.lineHeight = lh;
      }

      // 若数据流后续包含 parentId 字符串，则提取
      if (!reader.isEOF()) {
        const pId = reader.readString();
        if (pId) {
          node.parentId = pId;
        }
      }

      nodes.push(node);
    } catch {
      break;
    }
  }

  return nodes;
}

/**
 * 将场景树转换为 FlatStore 的 FEElement 集合
 * 支持直接写入目标 FlatStore 并建立父子引用关系
 */
export function sceneToFlatStore(
  scene: SceneIndex,
  targetStore?: any,
  targetParentId?: string
): { elements: FEElement[]; rootId: string; jsx: string } {
  const { nodeMap, childrenMap, rootIds } = scene;
  const elements: FEElement[] = [];
  const visited = new Set<string>();

  const mainRootId = rootIds[0] || "figma_root";

  function traverse(nodeId: string, parentId?: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const fNode = nodeMap.get(nodeId);
    if (!fNode) return;

    const classes = figmaNodeToTailwindClasses(fNode);
    const childIds = childrenMap.get(nodeId) || [];

    let tag = "div";
    if (fNode.type === "TEXT") tag = "p";
    else if (fNode.name.toLowerCase().includes("button")) tag = "button";
    else if (fNode.name.toLowerCase().includes("input")) tag = "input";
    else if (fNode.name.toLowerCase().includes("card")) tag = "section";
    else if (fNode.name.toLowerCase().includes("nav")) tag = "nav";
    else if (fNode.name.toLowerCase().includes("header")) tag = "header";
    else if (fNode.name.toLowerCase().includes("footer")) tag = "footer";
    else if (fNode.name.toLowerCase().includes("aside")) tag = "aside";

    const el: FEElement = {
      id: fNode.id,
      type: "element",
      tag,
      props: {
        className: classes.join(" ")
      },
      textContent: fNode.characters
    };

    if (fNode.width && fNode.height) {
      el.canvasRect = {
        left: fNode.x || 0,
        top: fNode.y || 0,
        width: fNode.width,
        height: fNode.height
      };
    }

    elements.push(el);

    if (targetStore && typeof targetStore.setElement === "function") {
      targetStore.setElement(el);
      if (parentId && typeof targetStore.attachChild === "function") {
        try {
          targetStore.attachChild(parentId, fNode.id);
        } catch {
          // ignore
        }
      }
    }

    for (const cId of childIds) {
      traverse(cId, nodeId);
    }
  }

  for (const rId of rootIds) {
    traverse(rId, targetParentId);
  }

  // 构建 JSX 字符串 (带 cycle 防护)
  const jsxVisited = new Set<string>();
  function buildJsx(nodeId: string, indent: number = 0): string {
    if (jsxVisited.has(nodeId)) return "";
    jsxVisited.add(nodeId);

    const fNode = nodeMap.get(nodeId);
    if (!fNode) return "";

    const classes = figmaNodeToTailwindClasses(fNode);
    const classAttr = classes.length > 0 ? ` className="${classes.join(" ")}"` : "";
    const childIds = childrenMap.get(nodeId) || [];
    const spaces = "  ".repeat(indent);

    let tag = "div";
    if (fNode.type === "TEXT") tag = "p";
    else if (fNode.name.toLowerCase().includes("button")) tag = "button";

    if (childIds.length === 0) {
      if (fNode.characters) {
        return `${spaces}<${tag}${classAttr}>${fNode.characters}</${tag}>`;
      }
      return `${spaces}<${tag}${classAttr} />`;
    }

    const inner = childIds.map((c) => buildJsx(c, indent + 1)).filter(Boolean).join("\n");
    return `${spaces}<${tag}${classAttr}>\n${inner}\n${spaces}</${tag}>`;
  }

  const jsx = rootIds.map((rId) => buildJsx(rId, 0)).filter(Boolean).join("\n");

  return { elements, rootId: mainRootId, jsx };
}

/**
 * 便捷助手：将 Figma 导入结果直接挂载并附加到 FlatStore 中
 */
export function importFigmaToStore(
  store: any,
  parsed: FigmaParseResult | SceneIndex,
  targetParentId?: string
): string {
  let scene: SceneIndex;
  if ("nodeMap" in parsed && "childrenMap" in parsed) {
    scene = parsed;
  } else if ("elements" in parsed && Array.isArray(parsed.elements)) {
    const nodes: FigmaNode[] = parsed.elements.map((el) => ({
      id: el.id,
      name: el.tag,
      type: el.tag === "p" ? "TEXT" : "FRAME",
      characters: el.textContent
    }));
    scene = buildSceneIndex(nodes);
  } else {
    throw new Error("Invalid Figma import payload");
  }

  const result = sceneToFlatStore(scene, store, targetParentId);
  return result.rootId;
}

/**
 * 完整剪贴板解析入口：支持 Kiwi 二进制、JSON 场景树或 HTML/SVG 矢量输入
 */
export function parseFigmaClipboard(input: Uint8Array | string): FigmaParseResult {
  try {
    let nodes: FigmaNode[] = [];

    if (input instanceof Uint8Array) {
      // 优先检测是否为 UTF-8 文本 (如以 { 或 [ 或 < 开头的 JSON/HTML/SVG 字节流)
      // 避免将普通文本错误地按 Kiwi 二进制解析产生乱码
      const nonWhitespaceIdx = input.findIndex((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
      const firstByte = nonWhitespaceIdx !== -1 ? input[nonWhitespaceIdx] : 0;
      if (firstByte === 0x7b /* { */ || firstByte === 0x5b /* [ */ || firstByte === 0x3c /* < */) {
        const text = new TextDecoder("utf-8").decode(input);
        return parseFigmaClipboard(text);
      }

      // 1. 尝试二进制 Kiwi 解码 (必须含 magic header)
      nodes = unpackKiwiBinary(input);
      if (nodes.length === 0) {
        // 尝试按 UTF-8 字符串解读
        const text = new TextDecoder("utf-8").decode(input);
        return parseFigmaClipboard(text);
      }
    } else if (typeof input === "string") {
      const trimmed = input.trim();
      // 2. 尝试 JSON 场景树解析
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          const flattenTree = (root: any, parentId?: string): FigmaNode[] => {
            if (!root || typeof root !== "object") return [];
            const id = root.id || `json_node_${Math.random().toString(36).slice(2, 8)}`;
            const node: FigmaNode = {
              id,
              name: root.name || root.tag || "Component",
              type: root.type || (root.characters ? "TEXT" : "FRAME"),
              parentId: root.parentId || parentId,
              stackMode: root.stackMode || (root.layoutMode === "HORIZONTAL" ? "HORIZONTAL" : root.layoutMode === "VERTICAL" ? "VERTICAL" : undefined),
              itemSpacing: root.itemSpacing,
              paddingLeft: root.paddingLeft,
              paddingRight: root.paddingRight,
              paddingTop: root.paddingTop,
              paddingBottom: root.paddingBottom,
              primaryAxisAlignItems: root.primaryAxisAlignItems,
              counterAxisAlignItems: root.counterAxisAlignItems,
              fills: root.fills,
              strokes: root.strokes,
              strokeWeight: root.strokeWeight,
              cornerRadius: root.cornerRadius,
              effects: root.effects,
              characters: root.characters || root.text,
              fontSize: root.fontSize,
              fontWeight: root.fontWeight
            };

            const list: FigmaNode[] = [node];
            if (Array.isArray(root.children)) {
              for (const c of root.children) {
                list.push(...flattenTree(c, id));
              }
            }
            return list;
          };

          if (Array.isArray(parsed)) {
            nodes = parsed.flatMap((item) => flattenTree(item));
          } else if (parsed.nodes && Array.isArray(parsed.nodes)) {
            nodes = parsed.nodes.flatMap((item: any) => flattenTree(item));
          } else {
            nodes = flattenTree(parsed);
          }
        } catch {
          // 不是合法 JSON，继续降级
        }
      }

      // 3. 兜底 HTML / SVG / 文本片段处理
      if (nodes.length === 0) {
        const fallbackId = `figma_import_${Date.now().toString(36)}`;
        const isSvg = trimmed.startsWith("<svg");
        const node: FigmaNode = {
          id: fallbackId,
          name: isSvg ? "ImportedSVG" : "ImportedContainer",
          type: isSvg ? "VECTOR" : "FRAME",
          stackMode: "VERTICAL",
          itemSpacing: 8,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 16,
          paddingBottom: 16,
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
          cornerRadius: 8,
          characters: isSvg ? undefined : (trimmed.replace(/<[^>]+>/g, "").trim() || undefined)
        };
        nodes = [node];
      }
    }

    if (nodes.length === 0) {
      return {
        success: false,
        rootId: "",
        elements: [],
        jsx: "",
        error: "No valid Figma nodes extracted from input"
      };
    }

    const scene = buildSceneIndex(nodes);
    const converted = sceneToFlatStore(scene);

    return {
      success: true,
      rootId: converted.rootId,
      elements: converted.elements,
      jsx: converted.jsx,
      scene,
      nodes
    };
  } catch (err: any) {
    return {
      success: false,
      rootId: "",
      elements: [],
      jsx: "",
      error: `Figma parsing error: ${err.message}`
    };
  }
}

export interface FigmaToReactOptions {
  componentName?: string;
  exportType?: "named" | "default";
  typescript?: boolean;
  useNextShims?: boolean;
  includeImports?: boolean;
}

/**
 * 将 Figma 节点转换为生产级 React 19 / Tailwind v4 组件代码
 */
export function figmaToReact19(
  input: Uint8Array | string | FigmaNode[] | SceneIndex | FigmaParseResult,
  options: FigmaToReactOptions = {}
): {
  componentName: string;
  code: string;
  elements: FEElement[];
  rootId: string;
} {
  let scene: SceneIndex;
  let rawElements: FEElement[] = [];
  let rootId: string = "FigmaRoot";

  if (input instanceof Uint8Array || typeof input === "string") {
    const parsed = parseFigmaClipboard(input);
    if (!parsed.success) {
      throw new Error(parsed.error || "Failed to parse Figma input");
    }
    rawElements = parsed.elements;
    rootId = parsed.rootId;
    if (parsed.scene) {
      scene = parsed.scene;
    } else if (parsed.nodes) {
      scene = buildSceneIndex(parsed.nodes);
    } else {
      const nodes: FigmaNode[] = rawElements.map((el) => ({
        id: el.id,
        name: el.tag,
        type: el.tag === "p" ? "TEXT" : "FRAME",
        characters: el.textContent
      }));
      scene = buildSceneIndex(nodes);
    }
  } else if ("nodeMap" in input && "childrenMap" in input) {
    scene = input;
    const res = sceneToFlatStore(scene);
    rawElements = res.elements;
    rootId = res.rootId;
  } else if ("elements" in input && Array.isArray((input as any).elements)) {
    const p = input as FigmaParseResult;
    rawElements = p.elements;
    rootId = p.rootId;
    if (p.scene) {
      scene = p.scene;
    } else if (p.nodes) {
      scene = buildSceneIndex(p.nodes);
    } else {
      const nodes: FigmaNode[] = rawElements.map((el) => ({
        id: el.id,
        name: el.tag,
        type: el.tag === "p" ? "TEXT" : "FRAME",
        characters: el.textContent
      }));
      scene = buildSceneIndex(nodes);
    }
  } else if (Array.isArray(input)) {
    scene = buildSceneIndex(input);
    const res = sceneToFlatStore(scene);
    rawElements = res.elements;
    rootId = res.rootId;
  } else {
    throw new Error("Invalid input to figmaToReact19");
  }

  // 计算组件名称
  let rawName = options.componentName;
  if (!rawName) {
    const rootNode = scene.nodeMap.get(rootId);
    rawName = rootNode?.name || "FigmaComponent";
  }

  // 格式化为合法 PascalCase 标识符
  let componentName = rawName
    .replace(/[^a-zA-Z0-9_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  if (!componentName || !/^[A-Z]/.test(componentName)) {
    componentName = "FigmaComponent";
  }

  // 构建 JSX 节点
  const { nodeMap, childrenMap, rootIds } = scene;
  const jsxVisited = new Set<string>();

  function escapeJsxText(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\{/g, "&#123;")
      .replace(/\}/g, "&#125;");
  }

  function renderJsxNode(nodeId: string, indent: number = 2): string {
    if (jsxVisited.has(nodeId)) return "";
    jsxVisited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return "";

    const classes = figmaNodeToTailwindClasses(node);
    const classAttr = classes.length > 0 ? ` className="${classes.join(" ")}"` : "";
    const childIds = childrenMap.get(nodeId) || [];
    const spaces = "  ".repeat(indent);

    let tag = "div";
    if (node.type === "TEXT") tag = "p";
    else if (node.name.toLowerCase().includes("button")) tag = "button";
    else if (node.name.toLowerCase().includes("input")) tag = "input";
    else if (node.name.toLowerCase().includes("card")) tag = "section";
    else if (node.name.toLowerCase().includes("nav")) tag = "nav";
    else if (node.name.toLowerCase().includes("header")) tag = "header";
    else if (node.name.toLowerCase().includes("footer")) tag = "footer";
    else if (node.name.toLowerCase().includes("aside")) tag = "aside";

    if (tag === "input") {
      return `${spaces}<input${classAttr} />`;
    }

    if (childIds.length === 0) {
      if (node.characters) {
        return `${spaces}<${tag}${classAttr}>${escapeJsxText(node.characters)}</${tag}>`;
      }
      return `${spaces}<${tag}${classAttr} />`;
    }

    const childrenJsx = childIds
      .map((cId) => renderJsxNode(cId, indent + 1))
      .filter(Boolean)
      .join("\n");

    return `${spaces}<${tag}${classAttr}>\n${childrenJsx}\n${spaces}</${tag}>`;
  }

  const innerJsx = rootIds
    .map((rId) => renderJsxNode(rId, 2))
    .filter(Boolean)
    .join("\n");

  const lines: string[] = [];
  if (options.includeImports !== false) {
    lines.push('import React from "react";\n');
  }

  const exportPrefix = options.exportType === "default" ? "export default function" : "export function";
  lines.push(`${exportPrefix} ${componentName}() {`);
  lines.push("  return (");
  if (rootIds.length > 1) {
    lines.push("    <>");
    lines.push(innerJsx);
    lines.push("    </>");
  } else {
    lines.push(innerJsx);
  }
  lines.push("  );");
  lines.push("}\n");

  const code = lines.join("\n");

  return {
    componentName,
    code,
    elements: rawElements,
    rootId
  };
}
