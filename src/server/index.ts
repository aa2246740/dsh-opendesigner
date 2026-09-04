/**
 * DSH OpenDesigner 服务端核心服务
 * 深度融合 Cordis 微内核架构（OpenDesignerService extends Service）
 * 注入 tools 服务，无缝挂载 38 个 MCP 原生工具
 * 支持 .designer/canvas.json 原子持久化与本地 Git 工作区同步
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Service } from "./cordis.ts";
import { FlatStore } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import { dispatchMCPTool, OPEN_DESIGNER_TOOLS } from "./mcpTools.ts";
import type { MCPContext, MCPToolDefinition } from "./mcpTools.ts";

const execFileAsync = promisify(execFile);

export interface OpenDesignerConfig {
  projectRoot?: string;
  port?: number;
  autoApprove?: boolean;
  ttlMs?: number;
  modelProvider?: "deepseek" | "openai" | "ollama";
}

export interface GitSyncStatus {
  isGitRepo: boolean;
  branch?: string;
  clean: boolean;
  modifiedFiles: string[];
  canvasTracked: boolean;
}

export class OpenDesignerService extends Service {
  public static inject = ["tools"];
  public static readonly serviceName = "openDesigner";

  public projectRoot: string;
  public port: number;
  public autoApprove: boolean;
  public store: FlatStore;
  public claimRegistry: ClaimRegistry;
  private canvasFilePath: string;
  private designerDir: string;
  private isInitialized: boolean = false;

  constructor(
    ctxOrConfig?: Context | OpenDesignerConfig,
    maybeConfig?: OpenDesignerConfig
  ) {
    let ctx: Context;
    let config: OpenDesignerConfig;

    if (
      ctxOrConfig &&
      (typeof (ctxOrConfig as Context).provide === "function" ||
        (ctxOrConfig as Context).tools !== undefined ||
        maybeConfig !== undefined)
    ) {
      ctx = ctxOrConfig as Context;
      config = maybeConfig || {};
    } else {
      ctx = {} as Context;
      config = (ctxOrConfig as OpenDesignerConfig) || {};
    }

    super(ctx, "openDesigner", true);

    this.projectRoot = config.projectRoot || process.cwd();
    this.port = config.port || 21209;
    this.autoApprove = config.autoApprove ?? true;
    this.designerDir = path.join(this.projectRoot, ".designer");
    this.canvasFilePath = path.join(this.designerDir, "canvas.json");

    this.store = new FlatStore();
    this.claimRegistry = new ClaimRegistry(config.ttlMs ?? 300_000);

    // 若运行在 Cordis 微内核宿主环境，注册 38 个 MCP 工具到 DSH tools 服务
    if (this.ctx && this.ctx.tools) {
      this.mountDshTools(this.ctx.tools);
    }
  }

  /**
   * 将 38 个 MCP 工具挂载为 DSH 原生 Tool
   */
  public mountDshTools(toolsService: NonNullable<Context["tools"]>): void {
    const registerFn =
      typeof toolsService.defineTool === "function"
        ? toolsService.defineTool.bind(toolsService)
        : typeof toolsService.register === "function"
          ? toolsService.register.bind(toolsService)
          : null;

    if (!registerFn) return;

    for (const tool of OPEN_DESIGNER_TOOLS) {
      registerFn({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        execute: async (args: Record<string, any>) => {
          return await this.executeTool(tool.name, args);
        }
      });
    }
  }

  /**
   * Cordis 服务启动生命周期钩子
   */
  public async start(): Promise<void> {
    await this.init();
  }

  /**
   * Cordis 服务停止生命周期钩子
   */
  public async stop(): Promise<void> {
    await this.saveCanvas();
  }

  /**
   * 初始化服务，加载现有画布
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;
    await this.loadCanvas();
    this.isInitialized = true;
  }

  /**
   * 从本地 .designer/canvas.json 加载画布
   */
  public async loadCanvas(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.canvasFilePath, "utf-8");
      const data = JSON.parse(raw);
      this.store.fromJSON(data);
      return true;
    } catch {
      // 文件不存在或损坏，使用空白 Store
      return false;
    }
  }

  /**
   * 原子持久化到本地 .designer/canvas.json
   * 机制：先写入临时文件 .designer/canvas.json.tmp，然后原子 rename 覆盖
   */
  public async saveCanvas(): Promise<void> {
    await fs.mkdir(this.designerDir, { recursive: true });
    const tmpPath = `${this.canvasFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const serialized = JSON.stringify(this.store.toJSON(), null, 2);

    await fs.writeFile(tmpPath, serialized, "utf-8");
    await fs.rename(tmpPath, this.canvasFilePath);
  }

  /**
   * 获取本地 Git 工作区同步状态
   * 严格遵守安全红线：使用 GIT_CONFIG_GLOBAL=/dev/null，仅检查当前 projectRoot
   */
  public async getGitStatus(): Promise<GitSyncStatus> {
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
      const { stdout: branchOut } = await execFileAsync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: this.projectRoot, env }
      );
      const branch = branchOut.trim();

      const { stdout: statusOut } = await execFileAsync(
        "git",
        ["status", "--porcelain"],
        { cwd: this.projectRoot, env }
      );

      const lines = statusOut.split("\n").filter((l) => l.trim().length > 0);
      const modifiedFiles = lines.map((l) => l.slice(3).trim());
      const canvasTracked = lines.some((l) => l.includes(".designer/canvas.json"));

      return {
        isGitRepo: true,
        branch,
        clean: lines.length === 0,
        modifiedFiles,
        canvasTracked
      };
    } catch {
      return {
        isGitRepo: false,
        clean: true,
        modifiedFiles: [],
        canvasTracked: false
      };
    }
  }

  /**
   * 本地 Git 工作区同步：暂存 .designer/canvas.json 并生成原子变更记录
   */
  public async syncGitWorkspace(options: { stageCanvas?: boolean } = {}): Promise<GitSyncStatus> {
    // 确保最新状态已持久化到磁盘
    await this.saveCanvas();

    if (options.stageCanvas) {
      try {
        const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
        await execFileAsync("git", ["add", ".designer/canvas.json"], {
          cwd: this.projectRoot,
          env
        });
      } catch {
        // 非 Git 仓库或暂存失败时静默跳过
      }
    }

    return await this.getGitStatus();
  }

  /**
   * 执行 38 个 MCP 工具调度
   */
  public async executeTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    const context: MCPContext = {
      projectRoot: this.projectRoot,
      store: this.store,
      claims: this.claimRegistry,
      autoApprove: this.autoApprove,
      saveCanvas: () => this.saveCanvas()
    };

    return await dispatchMCPTool(toolName, args, context);
  }
}

/**
 * DSH 插件规范导出
 */
export const name = "dsh-opendesigner";
export const inject = ["tools"];

export function apply(ctx: Context, config: OpenDesignerConfig = {}): OpenDesignerService {
  return new OpenDesignerService(ctx, config);
}

export default OpenDesignerService;

export * from "./cordis.ts";
export * from "./claimRegistry.ts";
export * from "./mcpTools.ts";
