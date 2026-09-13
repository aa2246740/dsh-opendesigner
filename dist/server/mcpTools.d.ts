/**
 * 完整对齐官方 38 个 MCP 工具的目录、Schema 定义与本地 Dispatcher 调度执行
 */
import { FlatStore } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
export interface MCPToolDefinition {
    name: string;
    description: string;
    category: "project" | "local" | "canvas" | "design" | "skills";
    destructive?: boolean;
    parameters?: Record<string, any>;
}
export type ScreenshotMode = "none" | "jsx-svg" | "html-render";
export interface MCPContext {
    projectRoot: string;
    store: FlatStore;
    claims: ClaimRegistry;
    autoApprove?: boolean;
    approvalGranted?: boolean;
    approvalChannel?: "host" | "model";
    screenshotMode?: ScreenshotMode;
    captureScreenshot?: (elementId: string) => Promise<string | null>;
    saveCanvas?: () => Promise<void>;
}
export declare const OPEN_DESIGNER_TOOLS: MCPToolDefinition[];
/**
 * 将 FlatStore 节点转换为结构化 JSX 字符串
 */
export declare function elementToJSX(store: FlatStore, elementId: string): string;
/**
 * Dispatcher for the OpenDesigner tool catalog.
 */
export declare function dispatchMCPTool(toolName: string, args: Record<string, any>, ctx: MCPContext): Promise<any>;
//# sourceMappingURL=mcpTools.d.ts.map