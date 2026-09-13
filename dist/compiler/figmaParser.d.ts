/**
 * Figma Kiwi 二进制剪贴板协议解析器与 Tailwind v4 映射引擎
 * 依据 docs/06 规约：
 * 1. Kiwi 二进制模式解包器 (纯 TypeScript / ArrayBuffer 实现，零额外依赖)
 * 2. 节点树场景索引重建 (buildSceneIndex: nodeMap + childrenMap)
 * 3. 视觉属性映射 (AutoLayout ➥ Flex/Grid, Fill ➥ bg-*, Typography ➥ font tokens / text tokens)
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
    offset?: {
        x: number;
        y: number;
    };
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
    stackMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
    itemSpacing?: number;
    paddingLeft?: number;
    paddingRight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
    counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE" | "STRETCH";
    fills?: FigmaPaint[];
    strokes?: FigmaPaint[];
    strokeWeight?: number;
    cornerRadius?: number;
    effects?: FigmaEffect[];
    opacity?: number;
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
export declare class KiwiReader {
    private view;
    private offset;
    private bytes;
    constructor(buffer: ArrayBuffer | Uint8Array);
    isEOF(): boolean;
    getOffset(): number;
    readByte(): number;
    /**
     * 读取无符号 Varint
     */
    readVarUint(): number;
    /**
     * 读取带符号 Varint (ZigZag 编码)
     */
    readVarInt(): number;
    /**
     * 读取 32 位浮点数
     */
    readFloat32(): number;
    /**
     * 读取长度前缀的 UTF-8 字符串
     */
    readString(): string;
    /**
     * 探测并跳过 Figma Kiwi 头部 Magic 标识
     */
    checkHeader(): boolean;
}
/**
 * 纯 TypeScript Kiwi 二进制流编码器
 */
export declare class KiwiWriter {
    private buffer;
    private offset;
    constructor(initialCapacity?: number);
    private ensureCapacity;
    getOffset(): number;
    writeByte(b: number): void;
    writeBytes(bytes: Uint8Array): void;
    /**
     * 写入无符号 Varint
     */
    writeVarUint(value: number): void;
    /**
     * 写入带符号 Varint (ZigZag 编码)
     */
    writeVarInt(value: number): void;
    /**
     * 写入 32 位浮点数
     */
    writeFloat32(val: number): void;
    /**
     * 写入长度前缀的 UTF-8 字符串
     */
    writeString(str: string): void;
    /**
     * 写入 Figma Kiwi 头部 Magic 标识
     */
    writeHeader(magic?: "figma" | "kiwi"): void;
    toUint8Array(): Uint8Array;
}
/**
 * 调色板映射：将 Figma RGB 浮点色彩 (0-1) 映射为最贴合的 Tailwind 语义类名或 hex
 */
export declare function figmaColorToTailwind(color: FigmaColor, prefix?: "bg" | "text" | "border" | "from" | "to"): string;
/**
 * 边距像素数值映射为 Tailwind 标度
 */
export declare function pixelToTailwindScale(px?: number): string | null;
/**
 * 将单个 Figma 节点属性转译为生产级 Tailwind v4 类名
 */
export declare function figmaNodeToTailwindClasses(node: FigmaNode): string[];
/**
 * 场景索引重建：将无序变更节点列表重构为 nodeMap + childrenMap
 */
export declare function buildSceneIndex(nodes: FigmaNode[]): SceneIndex;
/**
 * Kiwi 二进制封包器：将 FigmaNode 列表打包为紧凑二进制字节流
 */
export declare function packKiwiBinary(nodes: FigmaNode[], magic?: "figma" | "kiwi"): Uint8Array;
/**
 * Kiwi 模拟二进制解包器：解析二进制流中的 Figma 节点列表
 */
export declare function unpackKiwiBinary(buffer: Uint8Array, options?: {
    requireHeader?: boolean;
}): FigmaNode[];
/**
 * 将场景树转换为 FlatStore 的 FEElement 集合
 * 支持直接写入目标 FlatStore 并建立父子引用关系
 */
export declare function sceneToFlatStore(scene: SceneIndex, targetStore?: any, targetParentId?: string): {
    elements: FEElement[];
    rootId: string;
    jsx: string;
};
/**
 * 便捷助手：将 Figma 导入结果直接挂载并附加到 FlatStore 中
 */
export declare function importFigmaToStore(store: any, parsed: FigmaParseResult | SceneIndex, targetParentId?: string): string;
/**
 * 完整剪贴板解析入口：支持 Kiwi 二进制、JSON 场景树或 HTML/SVG 矢量输入
 */
export declare function parseFigmaClipboard(input: Uint8Array | string): FigmaParseResult;
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
export declare function figmaToReact19(input: Uint8Array | string | FigmaNode[] | SceneIndex | FigmaParseResult, options?: FigmaToReactOptions): {
    componentName: string;
    code: string;
    elements: FEElement[];
    rootId: string;
};
//# sourceMappingURL=figmaParser.d.ts.map