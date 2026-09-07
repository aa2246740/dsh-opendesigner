import type { MCPToolDefinition } from "./mcpTools.ts";

export const PERSISTENCE_TOOLS: MCPToolDefinition[] = [
  {
    name: "checkpoint",
    description: "Push an in-session Rewind checkpoint of the canvas and session source overlay. Does not create a git worktree.",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Checkpoint label" },
        kind: { type: "string", description: "canvas | source | session" }
      }
    }
  },
  {
    name: "rewind",
    description: "Restore a previous in-session checkpoint. Restores canvas (and session source overlay). Does not spawn a worktree.",
    category: "canvas",
    parameters: {
      type: "object",
      properties: {
        checkpointId: { type: "string", description: "Optional checkpoint id; omit to rewind one step" }
      }
    }
  },
  {
    name: "list_checkpoints",
    description: "List in-session Rewind checkpoints (no store payloads).",
    category: "canvas",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "autosave",
    description: "Atomically write the working copy to .designer/canvas.json. Crash safety only. Never git commit.",
    category: "canvas",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "apply_to_project",
    description: "Save the design draft to .designer/canvas.json (保存设计稿). This does not apply source file diffs. Never git commit. Requires host approval.",
    category: "project",
    destructive: true,
    parameters: { type: "object", properties: {} }
  },
  {
    name: "batch_create",
    description: "Create a jailed git worktree under .designer/worktrees/<batchId> for an Agent source batch. Fails with GIT_REQUIRED when the project is not a git repo.",
    category: "project",
    parameters: {
      type: "object",
      properties: { label: { type: "string", description: "Optional batch label" } }
    }
  },
  {
    name: "batch_discard",
    description: "Remove an open Agent-batch worktree without copying files back to the project.",
    category: "project",
    parameters: {
      type: "object",
      properties: { batchId: { type: "string", description: "Batch id" } },
      required: ["batchId"]
    }
  },
  {
    name: "batch_preview",
    description: "List file diffs an open Agent batch would apply. Does not write.",
    category: "project",
    parameters: {
      type: "object",
      properties: { batchId: { type: "string", description: "Batch id" } },
      required: ["batchId"]
    }
  },
  {
    name: "batch_apply",
    description: "应用到工程: copy jailed Agent-batch worktree file diffs into the project through a conflict-checked recoverable transaction. Refuses concurrent user edits. Never git commit. Requires a host approval receipt.",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: { batchId: { type: "string", description: "Batch id" } },
      required: ["batchId"]
    }
  },
  {
    name: "propose_source_patch",
    description: "Propose a structured source-file patch bound to the selected node's file, sourceHash, and baseRevision. Does not write.",
    category: "project",
    parameters: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        instruction: { type: "string" },
        live: { type: "boolean" }
      },
      required: ["elementId", "instruction"]
    }
  },
  {
    name: "accept_source_patch",
    description: "Apply the pending structured source patch after beforeClassName/baseRevision/sourceHash checks. Requires a host approval receipt.",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: { proposalId: { type: "string" } }
    }
  },
  {
    name: "reject_source_patch",
    description: "Drop the pending structured source patch. Leaves the repo unchanged.",
    category: "project",
    parameters: { type: "object", properties: {} }
  }
];

export const PERSISTENCE_TOOL_NAMES = new Set(PERSISTENCE_TOOLS.map((tool) => tool.name));

export const CANVAS_MUTATION_TOOLS = new Set([
  "canvas_create_page",
  "canvas_add",
  "canvas_update",
  "canvas_edit",
  "canvas_insert",
  "canvas_delete",
  "canvas_create_import_scaffold"
]);

export const SOURCE_MUTATION_TOOLS = new Set([
  "project_write",
  "project_write_batch",
  "project_edit",
  "project_delete",
  "local_write",
  "local_edit"
]);
