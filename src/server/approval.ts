import type { MCPContext, MCPToolDefinition } from "./mcpTools.ts";

export class ApprovalRequiredError extends Error {
  readonly code = "APPROVAL_REQUIRED";

  constructor(toolName: string) {
    super(
      `Destructive tool ${toolName} requires a one-shot host approval receipt bound to project, revision, and diff hash. Model-supplied approve:true is ignored. autoApprove is an operator setting only; it does not expand the project-root jail.`
    );
    this.name = "ApprovalRequiredError";
  }
}

export type ApprovalMode = "auto" | "gated";
export type ApprovalChannel = "host" | "model";

export const PERSIST_APPROVAL: Record<string, ApprovalMode> = {
  checkpoint: "auto",
  rewind: "auto",
  list_checkpoints: "auto",
  autosave: "auto",
  apply_to_project: "gated",
  batch_create: "auto",
  batch_discard: "auto",
  batch_preview: "auto",
  batch_apply: "gated",
  propose_source_patch: "auto",
  reject_source_patch: "auto",
  accept_source_patch: "gated"
};

export function catalogApprovalMode(tool: MCPToolDefinition): ApprovalMode {
  return tool.destructive ? "gated" : "auto";
}

export function persistApprovalMode(toolName: string): ApprovalMode {
  return PERSIST_APPROVAL[toolName] ?? "gated";
}

export function isApproved(
  mode: ApprovalMode,
  ctx: Pick<MCPContext, "autoApprove" | "approvalGranted">,
  _args: Record<string, unknown>,
  _channel: ApprovalChannel = "model"
): boolean {
  if (mode === "auto") return true;
  if (ctx.autoApprove === true) return true;
  if (ctx.approvalGranted === true) return true;
  return false;
}

export function assertDestructiveApproval(
  tool: MCPToolDefinition,
  ctx: MCPContext,
  args: Record<string, unknown>
): void {
  if (catalogApprovalMode(tool) === "auto") return;
  const channel = ctx.approvalChannel ?? "model";
  if (isApproved("gated", ctx, args, channel)) return;
  throw new ApprovalRequiredError(tool.name);
}

export function assertPersistApproval(
  toolName: string,
  ctx: Pick<MCPContext, "autoApprove" | "approvalChannel">,
  args: Record<string, unknown>
): void {
  const mode = persistApprovalMode(toolName);
  const channel = ctx.approvalChannel ?? "model";
  if (isApproved(mode, ctx, args, channel)) return;
  throw new ApprovalRequiredError(toolName);
}
