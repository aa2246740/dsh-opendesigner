import type { MCPContext, MCPToolDefinition } from "./mcpTools.ts";
export declare class ApprovalRequiredError extends Error {
    readonly code = "APPROVAL_REQUIRED";
    constructor(toolName: string);
}
export type ApprovalMode = "auto" | "gated";
export type ApprovalChannel = "host" | "model";
export declare const PERSIST_APPROVAL: Record<string, ApprovalMode>;
export declare function catalogApprovalMode(tool: MCPToolDefinition): ApprovalMode;
export declare function persistApprovalMode(toolName: string): ApprovalMode;
export declare function isApproved(mode: ApprovalMode, ctx: Pick<MCPContext, "autoApprove" | "approvalGranted">, _args: Record<string, unknown>, _channel?: ApprovalChannel): boolean;
export declare function assertDestructiveApproval(tool: MCPToolDefinition, ctx: MCPContext, args: Record<string, unknown>): void;
export declare function assertPersistApproval(toolName: string, ctx: Pick<MCPContext, "autoApprove" | "approvalChannel">, args: Record<string, unknown>): void;
//# sourceMappingURL=approval.d.ts.map