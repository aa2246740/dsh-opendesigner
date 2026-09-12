import type { DshHostContext } from "./server/dshAdapter.ts";
import { OpenDesignerService, type OpenDesignerConfig } from "./server/index.ts";
export declare const name = "dsh-opendesigner";
export declare const inject: string[];
export interface Config extends OpenDesignerConfig {
}
export declare function apply(ctx: DshHostContext, config?: Config): OpenDesignerService;
//# sourceMappingURL=plugin.d.ts.map