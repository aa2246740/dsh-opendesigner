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

export class Context {
  tools?: CordisToolsService;
  private _events: Map<string, Function[]> = new Map();
  [key: string]: any;

  constructor(options: Record<string, any> = {}) {
    Object.assign(this, options);
  }

  public provide(name: string, value: any): void {
    (this as any)[name] = value;
  }

  public on(event: string, callback: (...args: any[]) => any): () => void {
    const list = this._events.get(event) || [];
    list.push(callback);
    this._events.set(event, list);
    return () => {
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  public emit(event: string, ...args: any[]): void {
    const list = this._events.get(event) || [];
    for (const fn of list) {
      fn(...args);
    }
  }
}
