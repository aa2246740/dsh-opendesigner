/**
 * In-process host used by unit tests. This is not DeepSeek Harness.
 * Production loads `src/plugin.ts` into an unmodified DSH Context.
 */
export interface CordisToolDef {
    name: string;
    description: string;
    category?: string;
    parameters?: any;
    execute: (args: Record<string, any>, session?: any) => Promise<any> | any;
}
export interface CordisToolsService {
    defineTool?: (tool: CordisToolDef) => void;
    register?: (tool: CordisToolDef) => void;
    getTool?: (name: string) => CordisToolDef | undefined;
    listTools?: () => CordisToolDef[];
    [key: string]: any;
}
export declare class Context {
    tools?: CordisToolsService;
    private _events;
    [key: string]: any;
    constructor(options?: Record<string, any>);
    provide(name: string, value: any): void;
    on(event: string, callback: (...args: any[]) => any): () => void;
    emit(event: string, ...args: any[]): void;
}
//# sourceMappingURL=cordis.d.ts.map