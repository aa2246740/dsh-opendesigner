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
        render: (_args: unknown, value: unknown) => Array<{
            type: "text";
            text: string;
        }>;
    };
    execute: (args: Record<string, unknown>, exec?: {
        signal?: AbortSignal;
    }) => Promise<unknown>;
}
export interface DshHostContext {
    tools?: {
        register?: (tool: unknown) => void;
        defineTool?: (tool: unknown) => void;
    };
    inject?: (deps: string[], fn: (ctx: DshHostContext) => void) => void;
    get?: (name: string) => unknown;
    on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown;
}
/** Host CLI release this plugin is proved against. Peer `@deepseek-ai/dsh-tools` is `^0.1.5-rc.2`. */
export declare const REQUIRED_DSH_RELEASE = "0.1.5-rc.3";
export declare const JSON_OUTPUT: {
    schema: {
        type: "object";
        additionalProperties: boolean;
    };
    render: (_args: unknown, value: unknown) => {
        type: "text";
        text: string;
    }[];
};
export declare function toDshParameters(jsonSchema: Record<string, unknown> | undefined, extra?: DshToolParameters): DshToolParameters;
export declare function wrapDefineTool(def: DshToolDefinition): unknown;
export declare function extraApproveParam(tool: MCPToolDefinition): DshToolParameters;
//# sourceMappingURL=dshAdapter.d.ts.map