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
 * 调色板映射：将 Figma RGB 浮点色彩 (0-1) 映射为最贴合的 Tailwind 语义类名或 hex
 */
export function figmaColorToTailwind(color: FigmaColor, prefix: "bg" | "text" | "border" = "bg"): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a ?? 1;

  // 基础常用预设映射
  if (r === 255 && g === 255 && b === 255) return `${prefix}-white`;
  if (r === 0 && g === 0 && b === 0) return `${prefix}-black`;
  if (a === 0) return `${prefix}-transparent`;

  // 近似 Tailwind 调色盘
  if (r > 200 && g < 100 && b < 100) return `${prefix}-red-500`;
  if (r < 100 && g > 180 && b < 100) return `${prefix}-green-500`;
  if (r < 100 && g < 150 && b > 220) return `${prefix}-blue-500`;
  if (r > 200 && g > 150 && b < 50) return `${prefix}-amber-500`;
  if (r > 100 && g < 100 && b > 200) return `${prefix}-indigo-500`;
  if (r > 200 && g < 100 && b > 200) return `${prefix}-pink-500`;

  // 灰阶检测
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    if (r > 230) return `${prefix}-gray-100`;
    if (r > 200) return `${prefix}-gray-200`;
    if (r > 150) return `${prefix}-gray-400`;
    if (r > 100) return `${prefix}-gray-600`;
    if (r > 40) return `${prefix}-gray-800`;
    return `${prefix}-gray-900`;
  }

  // 兜底为十六进制 Arbitrary Value
  const hex = [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${prefix}-[#${hex}]`;
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

    if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
    else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");
    else if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");

    if (node.itemSpacing) {
      const gap = pixelToTailwindScale(node.itemSpacing);
      if (gap) classes.push(`gap-${gap}`);
    }
  } else if (node.stackMode === "VERTICAL") {
    classes.push("flex", "flex-col");
    if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
    else if (node.counterAxisAlignItems === "MAX") classes.push("items-end");
    else if (node.counterAxisAlignItems === "MIN") classes.push("items-start");

    if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
    else if (node.primaryAxisAlignItems === "SPACE_BETWEEN") classes.push("justify-between");

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

  // 3. Fills (背景色)
  if (node.fills && node.fills.length > 0) {
    const solid = node.fills.find((f) => f.type === "SOLID" && f.visible !== false && f.color);
    if (solid?.color) {
      classes.push(figmaColorToTailwind(solid.color, "bg"));
    }
  }

  // 4. Strokes (边框)
  if (node.strokes && node.strokes.length > 0 && node.strokeWeight) {
    classes.push(node.strokeWeight === 1 ? "border" : `border-${node.strokeWeight}`);
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

  // 7. Typography (文字样式)
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
      list.push(n.id);
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

  // 根节点定义为所有不在 allChildIds 中的节点
  const rootIds = nodes.filter((n) => !allChildIds.has(n.id)).map((n) => n.id);

  return { nodeMap, childrenMap, rootIds };
}

/**
 * Kiwi 模拟二进制解包器：解析二进制流中的 Figma 节点列表
 */
export function unpackKiwiBinary(buffer: Uint8Array): FigmaNode[] {
  const reader = new KiwiReader(buffer);
  reader.checkHeader();

  const nodes: FigmaNode[] = [];

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

      const node: FigmaNode = {
        id,
        name,
        type: nodeType
      };

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

      // 读取圆角
      node.cornerRadius = reader.readVarUint();

      // 若为文本节点，读取 characters
      if (node.type === "TEXT") {
        node.characters = reader.readString();
        node.fontSize = reader.readVarUint();
        node.fontWeight = reader.readVarUint();
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
 */
export function sceneToFlatStore(scene: SceneIndex): { elements: FEElement[]; rootId: string; jsx: string } {
  const { nodeMap, childrenMap, rootIds } = scene;
  const elements: FEElement[] = [];

  const mainRootId = rootIds[0] || "figma_root";

  function traverse(nodeId: string, parentId?: string): void {
    const fNode = nodeMap.get(nodeId);
    if (!fNode) return;

    const classes = figmaNodeToTailwindClasses(fNode);
    const childIds = childrenMap.get(nodeId) || [];

    let tag = "div";
    if (fNode.type === "TEXT") tag = "p";
    else if (fNode.name.toLowerCase().includes("button")) tag = "button";
    else if (fNode.name.toLowerCase().includes("input")) tag = "input";
    else if (fNode.name.toLowerCase().includes("card")) tag = "section";

    const el: FEElement = {
      id: fNode.id,
      type: "element",
      tag,
      props: {
        className: classes.join(" ")
      },
      textContent: fNode.characters
    };

    elements.push(el);

    for (const cId of childIds) {
      traverse(cId, nodeId);
    }
  }

  for (const rId of rootIds) {
    traverse(rId);
  }

  // 构建 JSX 字符串
  function buildJsx(nodeId: string, indent: number = 0): string {
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

    const inner = childIds.map((c) => buildJsx(c, indent + 1)).join("\n");
    return `${spaces}<${tag}${classAttr}>\n${inner}\n${spaces}</${tag}>`;
  }

  const jsx = rootIds.map((rId) => buildJsx(rId, 0)).join("\n");

  return { elements, rootId: mainRootId, jsx };
}

/**
 * 完整剪贴板解析入口：支持 Kiwi 二进制、JSON 场景树或 HTML/SVG 矢量输入
 */
export function parseFigmaClipboard(input: Uint8Array | string): FigmaParseResult {
  try {
    let nodes: FigmaNode[] = [];

    if (input instanceof Uint8Array) {
      // 1. 尝试二进制 Kiwi 解码
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
      jsx: converted.jsx
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
