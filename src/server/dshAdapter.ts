import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import type { MCPToolDefinition } from "./mcpTools.ts";

export interface DshToolParameters {
  [key: string]: Record<string, unknown>;
}

export interface HostJsonSchema {
  type: "object";
  additionalProperties: boolean;
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: DshToolParameters;
  output: {
    schema: HostJsonSchema;
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

/** Host CLI and `@deepseek-ai/dsh-tools` release this plugin is proved against. */
export const REQUIRED_DSH_RELEASE = "0.1.2-rc.1";

export const JSON_OUTPUT = {
  schema: { type: "object" as const, additionalProperties: true },
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

  if (spec.type === "object") {
    if (spec.additionalProperties === undefined) {
      node.additionalProperties = true;
    }
    if (spec.properties && typeof spec.properties === "object") {
      const nestedRequired = new Set<string>(
        Array.isArray(spec.required) ? (spec.required as string[]) : []
      );
      const nested: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(spec.properties as Record<string, Record<string, unknown>>)) {
        nested[key] = convertNode(child, nestedRequired.has(key));
      }
      node.properties = nested;
    }
    delete node.required;
    if (required) node.required = true;
  }

  if (spec.type === "array" && spec.items && typeof spec.items === "object") {
    node.items = convertNode(spec.items as Record<string, unknown>, false);
  }

  return node;
}

function defineToolResolvers(): string[] {
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const bases = [
    import.meta.url,
    pathToFileURL(path.join(pluginRoot, "package.json")).href,
    pathToFileURL(path.join(process.cwd(), "package.json")).href
  ];
  if (typeof process.argv[1] === "string") {
    try {
      bases.push(pathToFileURL(path.resolve(process.argv[1])).href);
    } catch {
      // argv[1] is not always a file path.
    }
  }
  const home = process.env.DSH_HOME;
  if (home) {
    try {
      for (const entry of fs.readdirSync(path.join(home, "profiles"), { withFileTypes: true })) {
        if (entry.isDirectory()) {
          bases.push(pathToFileURL(path.join(home, "profiles", entry.name, "package.json")).href);
        }
      }
    } catch {
      // Isolated tests have no DSH_HOME profiles.
    }
  }
  return bases;
}

function parametersToJsonSchema(params: DshToolParameters): HostJsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(params)) {
    const node: Record<string, unknown> = { ...spec };
    if (node.required === true) {
      required.push(key);
      delete node.required;
    }
    properties[key] = node;
  }
  return {
    type: "object",
    additionalProperties: true,
    properties,
    ...(required.length > 0 ? { required } : {})
  };
}

function loadDefineTool(): ((def: unknown) => unknown) | undefined {
  for (const base of defineToolResolvers()) {
    try {
      const req = createRequire(base);
      const mod = req("@deepseek-ai/dsh-tools") as { defineTool?: (d: unknown) => unknown };
      if (typeof mod.defineTool === "function") {
        return mod.defineTool.bind(mod);
      }
    } catch {
      // Keep walking. The host package is a peer, not always next to this file.
    }
  }
  return undefined;
}

export function wrapDefineTool(def: DshToolDefinition): unknown {
  const hostDef: DshToolDefinition = {
    ...def,
    output: JSON_OUTPUT
  };
  const defineTool = loadDefineTool();
  if (defineTool) {
    return defineTool(hostDef);
  }
  return {
    ...hostDef,
    parameters: parametersToJsonSchema(def.parameters)
  };
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
