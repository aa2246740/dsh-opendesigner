import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FlatStore } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import { dispatchMCPTool, OPEN_DESIGNER_TOOLS } from "./mcpTools.ts";
import type { MCPContext, ScreenshotMode } from "./mcpTools.ts";
import { AIGateway, type AIGatewayConfig, type AIProvider } from "./aiGateway.ts";
import { ApprovalRequiredError } from "./approval.ts";
import { PathJailError } from "./pathJail.ts";

const execFileAsync = promisify(execFile);

export interface OpenDesignerConfig {
  projectRoot?: string;
  autoApprove?: boolean;
  ttlMs?: number;
  screenshotMode?: ScreenshotMode;
  modelProvider?: AIProvider;
  aiConfig?: Partial<AIGatewayConfig>;
}

export interface GitSyncStatus {
  isGitRepo: boolean;
  branch?: string;
  clean: boolean;
  modifiedFiles: string[];
  canvasTracked: boolean;
}

export class OpenDesignerService {
  public static readonly serviceName = "openDesigner";

  public projectRoot: string;
  public autoApprove: boolean;
  public screenshotMode: ScreenshotMode;
  public store: FlatStore;
  public claimRegistry: ClaimRegistry;
  public aiGateway: AIGateway;
  private canvasFilePath: string;
  private designerDir: string;
  private isInitialized: boolean = false;

  constructor(config: OpenDesignerConfig = {}) {
    this.projectRoot = path.resolve(config.projectRoot || process.cwd());
    this.autoApprove = config.autoApprove ?? false;
    this.screenshotMode = config.screenshotMode ?? "none";
    this.designerDir = path.join(this.projectRoot, ".designer");
    this.canvasFilePath = path.join(this.designerDir, "canvas.json");

    this.store = new FlatStore();
    this.claimRegistry = new ClaimRegistry(config.ttlMs ?? 300_000);
    this.aiGateway = new AIGateway({
      provider: config.modelProvider || "deepseek",
      ...config.aiConfig
    });
  }

  public async start(): Promise<void> {
    await this.init();
  }

  public async stop(): Promise<void> {
    await this.saveCanvas();
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    await this.loadCanvas();
    this.isInitialized = true;
  }

  public status(): Record<string, unknown> {
    return {
      name: "dsh-opendesigner",
      projectRoot: this.projectRoot,
      autoApprove: this.autoApprove,
      screenshotMode: this.screenshotMode,
      toolCount: OPEN_DESIGNER_TOOLS.length,
      ai: this.aiGateway.status()
    };
  }

  public async loadCanvas(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.canvasFilePath, "utf-8");
      const data = JSON.parse(raw);
      this.store.fromJSON(data);
      return true;
    } catch {
      return false;
    }
  }

  public async saveCanvas(): Promise<void> {
    await fs.mkdir(this.designerDir, { recursive: true });
    const tmpPath = `${this.canvasFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const serialized = JSON.stringify(this.store.toJSON(), null, 2);

    await fs.writeFile(tmpPath, serialized, "utf-8");
    await fs.rename(tmpPath, this.canvasFilePath);
  }

  public async getGitStatus(): Promise<GitSyncStatus> {
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        XDG_CONFIG_HOME: "/dev/null"
      };
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

  public async syncGitWorkspace(options: { stageCanvas?: boolean } = {}): Promise<GitSyncStatus> {
    await this.saveCanvas();

    if (options.stageCanvas) {
      try {
        const env = {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
          XDG_CONFIG_HOME: "/dev/null"
        };
        await execFileAsync("git", ["add", ".designer/canvas.json"], {
          cwd: this.projectRoot,
          env
        });
      } catch {
        // Non-git trees skip staging.
      }
    }

    return await this.getGitStatus();
  }

  public async executeTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    const context: MCPContext = {
      projectRoot: this.projectRoot,
      store: this.store,
      claims: this.claimRegistry,
      autoApprove: this.autoApprove,
      screenshotMode: this.screenshotMode,
      saveCanvas: () => this.saveCanvas()
    };

    try {
      return await dispatchMCPTool(toolName, args, context);
    } catch (err) {
      if (err instanceof PathJailError || err instanceof ApprovalRequiredError) {
        return { success: false, error: err.message, code: err.code };
      }
      throw err;
    }
  }
}

export * from "./claimRegistry.ts";
export * from "./mcpTools.ts";
export * from "./aiGateway.ts";
export * from "./pathJail.ts";
export * from "./approval.ts";
