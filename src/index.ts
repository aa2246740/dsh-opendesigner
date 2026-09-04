export { apply, name, inject } from "./plugin.ts";
export type { Config } from "./plugin.ts";
export * from "./compiler/sourceEdit.ts";
export * from "./compiler/tailwindMerge.ts";
export * from "./compiler/aiMerge.ts";
export * from "./compiler/astParser.ts";
export * from "./compiler/figmaParser.ts";
export * from "./store/flatStore.ts";
export {
  OpenDesignerService,
  OPEN_DESIGNER_TOOLS,
  dispatchMCPTool,
  ClaimRegistry
} from "./server/index.ts";
export type { OpenDesignerConfig, GitSyncStatus } from "./server/index.ts";
export * from "./server/aiGateway.ts";
export * from "./client/index.ts";
