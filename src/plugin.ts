import type { DshHostContext } from "./server/dshAdapter.ts";
import {
  extraApproveParam,
  JSON_OUTPUT,
  toDshParameters,
  wrapDefineTool
} from "./server/dshAdapter.ts";
import { OpenDesignerService, type OpenDesignerConfig } from "./server/index.ts";
import { detectAiConfigFromEnv } from "./server/aiGateway.ts";
import { OPEN_DESIGNER_TOOLS } from "./server/mcpTools.ts";
import { PERSISTENCE_TOOL_NAMES, PERSISTENCE_TOOLS } from "./server/persistenceTools.ts";
import { catalogApprovalMode, persistApprovalMode } from "./server/approval.ts";

export const name = "dsh-opendesigner";
export const inject = ["tools"];

export interface Config extends OpenDesignerConfig {}

function shortToolName(fullName: string): string | null {
  if (!fullName.startsWith("opendesigner_")) return null;
  return fullName.slice("opendesigner_".length);
}

function isGatedOpenDesignerTool(fullName: string): boolean {
  const short = shortToolName(fullName);
  if (!short) return false;
  if (PERSISTENCE_TOOL_NAMES.has(short)) return persistApprovalMode(short) === "gated";
  const catalog = OPEN_DESIGNER_TOOLS.find((tool) => tool.name === short);
  return catalog ? catalogApprovalMode(catalog) === "gated" : false;
}

function wireHostAsk(ctx: DshHostContext, service: OpenDesignerService): boolean {
  if (typeof ctx.on !== "function") return false;
  ctx.on("tools/pre-execute", async (exec: unknown, next: unknown) => {
    const payload = exec as { name?: string; args?: Record<string, unknown> };
    const proceed = typeof next === "function" ? (next as () => Promise<unknown>) : async () => ({ kind: "allow" });
    if (service.autoApprove) return await proceed();
    const name = String(payload?.name || "");
    if (!isGatedOpenDesignerTool(name)) return await proceed();
    if (typeof payload.args?.approvalReceipt === "string" && payload.args.approvalReceipt.length > 0) {
      return await proceed();
    }
    return {
      kind: "ask",
      reason: `OpenDesigner ${name} is destructive. The host must grant a one-shot approval; approve:true is ignored.`
    };
  });
  return true;
}

export function apply(ctx: DshHostContext, config: Config = {}): OpenDesignerService {
  const service = new OpenDesignerService({
    ...config,
    aiConfig: {
      ...detectAiConfigFromEnv(),
      ...config.aiConfig
    }
  });
  void service.init();
  const dshAskWired = wireHostAsk(ctx, service);
  const tools = ctx.tools;
  const register =
    typeof tools?.register === "function"
      ? tools.register.bind(tools)
      : typeof tools?.defineTool === "function"
        ? tools.defineTool.bind(tools)
        : null;

  if (!register) {
    throw new Error("dsh-opendesigner requires ctx.tools.register from DeepSeek Harness");
  }

  for (const tool of [...OPEN_DESIGNER_TOOLS, ...PERSISTENCE_TOOLS]) {
    const gated = isGatedOpenDesignerTool(`opendesigner_${tool.name}`);
    register(
      wrapDefineTool({
        name: `opendesigner_${tool.name}`,
        description: `[OpenDesigner] ${tool.description}`,
        parameters: toDshParameters(tool.parameters, extraApproveParam(tool)),
        output: JSON_OUTPUT,
        async execute(args: Record<string, unknown>, exec?: { signal?: AbortSignal }) {
          if (exec?.signal?.aborted) {
            throw new Error("opendesigner tool aborted");
          }
          await service.init();
          let toolArgs = { ...args };
          if (
            dshAskWired &&
            gated &&
            !service.autoApprove &&
            typeof toolArgs.approvalReceipt !== "string"
          ) {
            const issued = (await service.issueHostReceipt(tool.name, toolArgs)) as {
              approvalReceipt?: string;
            };
            if (typeof issued.approvalReceipt === "string") {
              toolArgs = { ...toolArgs, approvalReceipt: issued.approvalReceipt };
            }
          }
          return await service.executeTool(tool.name, toolArgs);
        }
      })
    );
  }

  register(
    wrapDefineTool({
      name: "opendesigner_status",
      description: "[OpenDesigner] Report plugin status, jail root, and AI provider (never includes secrets).",
      parameters: {},
      output: JSON_OUTPUT,
      async execute(_args: Record<string, unknown>, exec?: { signal?: AbortSignal }) {
        if (exec?.signal?.aborted) {
          throw new Error("opendesigner tool aborted");
        }
        await service.init();
        return service.status();
      }
    })
  );

  return service;
}
