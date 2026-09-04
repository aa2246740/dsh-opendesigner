/**
 * DSH OpenDesigner 服务端核心服务
 * 管理本地 FlatStore 状态、ClaimRegistry 并发锁、.designer/canvas.json 原子持久化
 * 支持 DSH Cordis 微内核架构与独立本地服务模式
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FlatStore } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import { dispatchMCPTool } from "./mcpTools.ts";
import type { MCPContext } from "./mcpTools.ts";

export interface OpenDesignerConfig {
  projectRoot?: string;
  port?: number;
  autoApprove?: boolean;
  ttlMs?: number;
}

export class OpenDesignerService {
  public projectRoot: string;
  public port: number;
  public autoApprove: boolean;
  public store: FlatStore;
  public claimRegistry: ClaimRegistry;
  private canvasFilePath: string;
  private designerDir: string;

  constructor(config: OpenDesignerConfig = {}) {
    this.projectRoot = config.projectRoot || process.cwd();
    this.port = config.port || 21209;
    this.autoApprove = config.autoApprove ?? true;
    this.designerDir = path.join(this.projectRoot, ".designer");
    this.canvasFilePath = path.join(this.designerDir, "canvas.json");

    this.store = new FlatStore();
    this.claimRegistry = new ClaimRegistry(config.ttlMs ?? 300_000);
  }

  /**
   * 初始化服务，加载现有画布
   */
  public async init(): Promise<void> {
    await this.loadCanvas();
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
    const tmpPath = `${this.canvasFilePath}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(this.store.toJSON(), null, 2);

    await fs.writeFile(tmpPath, serialized, "utf-8");
    await fs.rename(tmpPath, this.canvasFilePath);
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

export * from "./claimRegistry.ts";
export * from "./mcpTools.ts";
