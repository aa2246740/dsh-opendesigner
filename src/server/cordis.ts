/**
 * DSH Cordis 微内核架构兼容层与服务基类
 * 提供符合 Cordis 规范的 Context 与 Service 抽象，无缝对接 DeepSeek Harness
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

/**
 * Cordis 核心 Context 类
 */
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

  public plugin(pluginDef: any, config?: any): any {
    if (typeof pluginDef === "function") {
      if (pluginDef.prototype && pluginDef.prototype instanceof Service) {
        return new pluginDef(this, config);
      }
      return pluginDef(this, config);
    }
    if (pluginDef && typeof pluginDef.apply === "function") {
      return pluginDef.apply(this, config);
    }
    return null;
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
      try {
        fn(...args);
      } catch (err) {
        console.error(`[Context event error ${event}]:`, err);
      }
    }
  }
}

/**
 * Cordis 核心 Service 基类
 */
export class Service<C extends Context = Context> {
  protected ctx: C;
  protected name: string;

  constructor(ctx: C, name: string, immediate: boolean = true) {
    this.ctx = ctx;
    this.name = name;

    if (ctx) {
      if (typeof ctx.provide === "function") {
        ctx.provide(name, this);
      } else {
        (ctx as any)[name] = this;
      }
    }
  }

  /**
   * 服务启动钩子
   */
  public async start?(): Promise<void>;

  /**
   * 服务停止钩子
   */
  public async stop?(): Promise<void>;
}
