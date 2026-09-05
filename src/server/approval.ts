import type { MCPContext, MCPToolDefinition } from "./mcpTools.ts";

export class ApprovalRequiredError extends Error {
  readonly code = "APPROVAL_REQUIRED";

  constructor(toolName: string) {
    super(
      `Destructive tool ${toolName} requires explicit approval. Pass approve:true after a host confirmation. autoApprove skips that prompt only; it does not expand the project-root jail.`
    );
    this.name = "ApprovalRequiredError";
  }
}

export type ApprovalMode = "auto" | "gated";

export const PERSIST_APPROVAL: Record<string, ApprovalMode> = {
  checkpoint: "auto",
  rewind: "auto",
  list_checkpoints: "auto",
  autosave: "auto",
  apply_to_project: "gated",
  batch_create: "auto",
  batch_discard: "auto",
  batch_apply: "gated"
};

export function catalogApprovalMode(tool: MCPToolDefinition): ApprovalMode {
  return tool.destructive ? "gated" : "auto";
}

export function persistApprovalMode(toolName: string): ApprovalMode {
  return PERSIST_APPROVAL[toolName] ?? "gated";
}

export function isApproved(
  mode: ApprovalMode,
  ctx: Pick<MCPContext, "autoApprove">,
  args: Record<string, unknown>
): boolean {
  if (mode === "auto") return true;
  if (args.approve === true) return true;
  if (ctx.autoApprove === true) return true;
  return false;
}

export function assertDestructiveApproval(
  tool: MCPToolDefinition,
  ctx: MCPContext,
  args: Record<string, unknown>
): void {
  if (catalogApprovalMode(tool) === "auto") return;
  if (isApproved("gated", ctx, args)) return;
  throw new ApprovalRequiredError(tool.name);
}

export function assertPersistApproval(
  toolName: string,
  ctx: Pick<MCPContext, "autoApprove">,
  args: Record<string, unknown>
): void {
  const mode = persistApprovalMode(toolName);
  if (isApproved(mode, ctx, args)) return;
  throw new ApprovalRequiredError(toolName);
}
