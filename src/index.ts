/**
 * dsh-opendesigner 根入口
 * 导出核心编译器、Figma 剪贴板解析器、AI 网关、扁平状态树、DSH 服务端与 MCP 工具清单、客户端能力
 */

export * from "./compiler/sourceEdit.ts";
export * from "./compiler/aiMerge.ts";
export * from "./compiler/astParser.ts";
export * from "./compiler/figmaParser.ts";
export * from "./store/flatStore.ts";
export * from "./server/index.ts";
export * from "./server/aiGateway.ts";
export * from "./client/index.ts";
