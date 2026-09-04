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
    description: "Explicit human Save/Apply. Persists the working copy and stamps .designer/applied.json. Never git commit. Requires approve.",
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
    name: "batch_apply",
    description: "Copy jailed Agent-batch worktree files into the project tree, then remove the worktree. Never git commit. Requires approve.",
    category: "project",
    destructive: true,
    parameters: {
      type: "object",
      properties: { batchId: { type: "string", description: "Batch id" } },
      required: ["batchId"]
    }
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
