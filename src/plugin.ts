import type { DshHostContext } from "./server/dshAdapter.ts";
import { extraApproveParam, JSON_OUTPUT, toDshParameters, wrapDefineTool } from "./server/dshAdapter.ts";
import { OpenDesignerService, type OpenDesignerConfig } from "./server/index.ts";
import { detectAiConfigFromEnv } from "./server/aiGateway.ts";
import { OPEN_DESIGNER_TOOLS } from "./server/mcpTools.ts";

export const name = "dsh-opendesigner";
export const inject = ["tools"];

export interface Config extends OpenDesignerConfig {}

export function apply(ctx: DshHostContext, config: Config = {}): OpenDesignerService {
  const service = new OpenDesignerService({
    ...config,
    aiConfig: {
      ...detectAiConfigFromEnv(),
      ...config.aiConfig
    }
  });
  void service.init();
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

  for (const tool of OPEN_DESIGNER_TOOLS) {
    register(
      wrapDefineTool({
        name: `opendesigner_${tool.name}`,
        description: `[OpenDesigner] ${tool.description}`,
        parameters: toDshParameters(tool.parameters, extraApproveParam(tool)),
        output: JSON_OUTPUT,
        async execute(args: Record<string, unknown>) {
          await service.init();
          return await service.executeTool(tool.name, args);
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
      async execute() {
        await service.init();
        return service.status();
      }
    })
  );

  return service;
}
