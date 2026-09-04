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

export function assertDestructiveApproval(
  tool: MCPToolDefinition,
  ctx: MCPContext,
  args: Record<string, unknown>
): void {
  if (!tool.destructive) return;
  if (args.approve === true) return;
  if (ctx.autoApprove === true) return;
  throw new ApprovalRequiredError(tool.name);
}
