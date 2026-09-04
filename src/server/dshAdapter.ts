import { createRequire } from "node:module";
import type { MCPToolDefinition } from "./mcpTools.ts";

const require = createRequire(import.meta.url);

export interface DshToolParameters {
  [key: string]: Record<string, unknown>;
}

export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: DshToolParameters;
  output: {
    schema: { type: "json" };
    render: (_args: unknown, value: unknown) => Array<{ type: "text"; text: string }>;
  };
  execute: (
    args: Record<string, unknown>,
    exec?: { signal?: AbortSignal }
  ) => Promise<unknown>;
}

export interface DshHostContext {
  tools?: {
    register?: (tool: unknown) => void;
    defineTool?: (tool: unknown) => void;
  };
  inject?: (deps: string[], fn: (ctx: DshHostContext) => void) => void;
  get?: (name: string) => unknown;
}

export const JSON_OUTPUT = {
  schema: { type: "json" as const },
  render: (_args: unknown, value: unknown) => [
    { type: "text" as const, text: JSON.stringify(value, null, 2) }
  ]
};

export function toDshParameters(
  jsonSchema: Record<string, unknown> | undefined,
  extra?: DshToolParameters
): DshToolParameters {
  const properties = (jsonSchema?.properties as Record<string, Record<string, unknown>> | undefined) || {};
  const required = new Set<string>(
    Array.isArray(jsonSchema?.required) ? (jsonSchema.required as string[]) : []
  );
  const out: DshToolParameters = {};

  for (const [key, spec] of Object.entries(properties)) {
    out[key] = convertNode(spec, required.has(key));
  }

  if (extra) {
    Object.assign(out, extra);
  }

  return out;
}

function convertNode(spec: Record<string, unknown>, required: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = { ...spec };
  if (required) node.required = true;

  if (spec.type === "object" && spec.properties && typeof spec.properties === "object") {
    const nestedRequired = new Set<string>(
      Array.isArray(spec.required) ? (spec.required as string[]) : []
    );
    const nested: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(spec.properties as Record<string, Record<string, unknown>>)) {
      nested[key] = convertNode(child, nestedRequired.has(key));
    }
    node.properties = nested;
    if (spec.additionalProperties === undefined) {
      node.additionalProperties = true;
    }
    delete node.required;
    if (required) node.required = true;
  }

  if (spec.type === "array" && spec.items && typeof spec.items === "object") {
    node.items = convertNode(spec.items as Record<string, unknown>, false);
  }

  return node;
}

export function wrapDefineTool(def: DshToolDefinition): unknown {
  try {
    const mod = require("@deepseek-ai/dsh-tools") as { defineTool?: (d: unknown) => unknown };
    if (typeof mod.defineTool === "function") {
      return mod.defineTool(def);
    }
  } catch {
    // Host tests and standalone runs do not have the DSH tools package.
  }
  return def;
}

export function extraApproveParam(tool: MCPToolDefinition): DshToolParameters {
  if (!tool.destructive) return {};
  return {
    approve: {
      type: "boolean",
      description:
        "Set true after an explicit host confirmation. Required unless autoApprove is enabled. Does not expand the project-root jail."
    }
  };
}
