import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FlatStore } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import { dispatchMCPTool, OPEN_DESIGNER_TOOLS } from "./mcpTools.ts";
import type { MCPContext, ScreenshotMode } from "./mcpTools.ts";
import { AIGateway, liveProvidersStatus, type AIGatewayConfig, type AIProvider } from "./aiGateway.ts";
import { REQUIRED_DSH_RELEASE } from "./dshAdapter.ts";
import { ApprovalRequiredError, assertPersistApproval } from "./approval.ts";
import { PathJailError, resolveProjectPath } from "./pathJail.ts";
import { atomicWriteFile, atomicWriteJson } from "./atomicWrite.ts";
import { CheckpointLog, type CheckpointKind } from "./checkpoints.ts";
import { AgentBatchRegistry, BatchError, GitRequiredError } from "./agentBatch.ts";
import { git } from "./gitExec.ts";
import {
  CANVAS_MUTATION_TOOLS,
  PERSISTENCE_TOOL_NAMES,
  SOURCE_MUTATION_TOOLS
} from "./persistenceTools.ts";

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
  public checkpoints: CheckpointLog;
  public batches: AgentBatchRegistry;
  public sessionTouched = new Set<string>();

  private canvasFilePath: string;
  private designerDir: string;
  private appliedFilePath: string;
  private isInitialized: boolean = false;
  private lastAutosaveAt: string | null = null;
  private lastAppliedAt: string | null = null;

  constructor(config: OpenDesignerConfig = {}) {
    this.projectRoot = path.resolve(config.projectRoot || process.cwd());
    this.autoApprove = config.autoApprove ?? false;
    this.screenshotMode = config.screenshotMode ?? "none";
    this.designerDir = path.join(this.projectRoot, ".designer");
    this.canvasFilePath = path.join(this.designerDir, "canvas.json");
    this.appliedFilePath = path.join(this.designerDir, "applied.json");

    this.store = new FlatStore();
    this.claimRegistry = new ClaimRegistry(config.ttlMs ?? 300_000);
    this.aiGateway = new AIGateway({
      provider: config.modelProvider || "deepseek",
      ...config.aiConfig
    });
    this.checkpoints = new CheckpointLog(path.join(this.designerDir, "checkpoints.json"));
    this.batches = new AgentBatchRegistry(
      this.projectRoot,
      path.join(this.designerDir, "batches.json")
    );
  }

  public fileIoRoot(): string {
    const open = this.batches.openBatch();
    if (!open) return this.projectRoot;
    return this.batches.worktreeAbs(open);
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
    await this.checkpoints.load();
    await this.batches.load();
    try {
      const applied = JSON.parse(await fs.readFile(this.appliedFilePath, "utf-8")) as {
        appliedAt?: string;
      };
      this.lastAppliedAt = applied.appliedAt ?? null;
    } catch {
      this.lastAppliedAt = null;
    }
    if (this.checkpoints.entries.length === 0) {
      await this.pushCheckpoint({ label: "baseline", kind: "canvas" });
    }
    this.isInitialized = true;
  }

  public status(): Record<string, unknown> {
    const current = this.checkpoints.current();
    const open = this.batches.openBatch();
    return {
      name: "dsh-opendesigner",
      requiredDsh: REQUIRED_DSH_RELEASE,
      projectRoot: this.projectRoot,
      fileIoRoot: this.fileIoRoot(),
      autoApprove: this.autoApprove,
      screenshotMode: this.screenshotMode,
      toolCount: OPEN_DESIGNER_TOOLS.length,
      ai: {
        ...this.aiGateway.status(),
        liveProviders: liveProvidersStatus()
      },
      persistence: {
        workingCopy: ".designer/canvas.json",
        lastAutosaveAt: this.lastAutosaveAt,
        lastAppliedAt: this.lastAppliedAt,
        checkpointCount: this.checkpoints.entries.length,
        currentCheckpointId: current?.id ?? null,
        currentCheckpointLabel: current?.label ?? null,
        openBatchId: open?.batchId ?? null,
        openBatchWorktree: open?.worktreeRelPath ?? null,
        batches: this.batches.batches.map((batch) => ({
          batchId: batch.batchId,
          status: batch.status,
          branch: batch.branch,
          isolation: batch.isolation
        })),
        gitCommitOnAutosave: false
      }
    };
  }

  public async loadCanvas(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.canvasFilePath, "utf-8");
      const data = JSON.parse(raw);
      this.store.fromJSON(data);
      this.lastAutosaveAt = typeof data.savedAt === "string" ? data.savedAt : null;
      return true;
    } catch {
      return false;
    }
  }

  public hydrateStore(data: unknown): void {
    this.store.fromJSON(data);
  }

  public async saveCanvas(): Promise<void> {
    const savedAt = new Date().toISOString();
    await atomicWriteJson(this.canvasFilePath, {
      ...this.store.toJSON(),
      savedAt
    });
    this.lastAutosaveAt = savedAt;
  }

  public async captureSourceFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const root = this.fileIoRoot();
    for (const rel of this.sessionTouched) {
      try {
        const abs = resolveProjectPath(root, rel);
        files[rel] = await fs.readFile(abs, "utf-8");
      } catch {
        // File was deleted or never written.
      }
    }
    return files;
  }

  public async restoreSourceFiles(files?: Record<string, string>): Promise<void> {
    if (!files) return;
    const root = this.fileIoRoot();
    for (const [rel, content] of Object.entries(files)) {
      const abs = resolveProjectPath(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await atomicWriteFile(abs, content);
    }
  }

  public async pushCheckpoint(input: { label: string; kind?: CheckpointKind }): Promise<unknown> {
    const sourceFiles = await this.captureSourceFiles();
    const checkpoint = await this.checkpoints.push({
      label: input.label,
      kind: input.kind ?? (Object.keys(sourceFiles).length > 0 ? "session" : "canvas"),
      store: this.store.toJSON(),
      sourceFiles: Object.keys(sourceFiles).length > 0 ? sourceFiles : undefined
    });
    return {
      success: true,
      checkpoint: {
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        label: checkpoint.label,
        kind: checkpoint.kind
      },
      cursor: this.checkpoints.cursor,
      count: this.checkpoints.entries.length,
      worktreeCreated: false
    };
  }

  public async rewind(checkpointId?: string): Promise<unknown> {
    const checkpoint = checkpointId
      ? await this.checkpoints.rewindTo(checkpointId)
      : await this.checkpoints.rewind();
    this.store.fromJSON(checkpoint.store);
    await this.restoreSourceFiles(checkpoint.sourceFiles);
    await this.saveCanvas();
    return {
      success: true,
      checkpoint: {
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        label: checkpoint.label,
        kind: checkpoint.kind
      },
      store: this.store.toJSON(),
      sourceFiles: checkpoint.sourceFiles ?? {},
      worktreeCreated: false
    };
  }

  public async applyToProject(): Promise<unknown> {
    await this.saveCanvas();
    const current = this.checkpoints.current();
    const appliedAt = new Date().toISOString();
    await atomicWriteJson(this.appliedFilePath, {
      appliedAt,
      checkpointId: current?.id ?? null,
      gitCommit: false
    });
    this.lastAppliedAt = appliedAt;
    return {
      success: true,
      appliedAt,
      checkpointId: current?.id ?? null,
      workingCopy: ".designer/canvas.json",
      gitCommit: false
    };
  }

  public async getGitStatus(): Promise<GitSyncStatus> {
    try {
      const { stdout: branchOut } = await git(this.projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = branchOut.trim();
      const { stdout: statusOut } = await git(this.projectRoot, ["status", "--porcelain"]);
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
        await git(this.projectRoot, ["add", "-f", ".designer/canvas.json"]);
      } catch {
        // Non-git trees skip staging. Autosave never calls this.
      }
    }

    return await this.getGitStatus();
  }

  public async executeTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    await this.init();
    const persistCtx = { autoApprove: this.autoApprove };

    try {
      if (PERSISTENCE_TOOL_NAMES.has(toolName)) {
        assertPersistApproval(toolName, persistCtx, args);
        return await this.executePersistTool(toolName, args);
      }

      const context: MCPContext = {
        projectRoot: this.fileIoRoot(),
        store: this.store,
        claims: this.claimRegistry,
        autoApprove: this.autoApprove,
        screenshotMode: this.screenshotMode,
        saveCanvas: () => this.saveCanvas()
      };

      const result = await dispatchMCPTool(toolName, args, context);
      this.trackSessionWrites(toolName, args, result);
      if (CANVAS_MUTATION_TOOLS.has(toolName) && result?.success !== false) {
        await this.pushCheckpoint({ label: toolName, kind: "canvas" });
      } else if (SOURCE_MUTATION_TOOLS.has(toolName) && result?.success !== false) {
        await this.pushCheckpoint({ label: toolName, kind: "source" });
      }
      return result;
    } catch (err) {
      if (
        err instanceof PathJailError ||
        err instanceof ApprovalRequiredError ||
        err instanceof GitRequiredError ||
        err instanceof BatchError
      ) {
        return { success: false, error: err.message, code: err.code };
      }
      if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
        const code = (err as { code: string }).code;
        if (code === "NOTHING_TO_REWIND" || code === "CHECKPOINT_NOT_FOUND") {
          return { success: false, error: err instanceof Error ? err.message : String(err), code };
        }
        if (code === "ENOENT") {
          return { success: false, error: err instanceof Error ? err.message : String(err), code: "NOT_FOUND" };
        }
      }
      throw err;
    }
  }

  private async executePersistTool(toolName: string, args: Record<string, any>): Promise<unknown> {
    switch (toolName) {
      case "checkpoint":
        return await this.pushCheckpoint({
          label: String(args.label || "checkpoint"),
          kind: args.kind === "source" || args.kind === "session" ? args.kind : "canvas"
        });
      case "rewind":
        return await this.rewind(typeof args.checkpointId === "string" ? args.checkpointId : undefined);
      case "list_checkpoints":
        return {
          success: true,
          checkpoints: this.checkpoints.list(),
          cursor: this.checkpoints.cursor
        };
      case "autosave":
        await this.saveCanvas();
        return {
          success: true,
          path: ".designer/canvas.json",
          savedAt: this.lastAutosaveAt,
          gitCommit: false
        };
      case "apply_to_project":
        return await this.applyToProject();
      case "batch_create":
        return {
          success: true,
          ...(await this.batches.create(typeof args.label === "string" ? args.label : undefined))
        };
      case "batch_discard":
        return { success: true, ...(await this.batches.discard(String(args.batchId || ""))) };
      case "batch_apply":
        return { success: true, ...(await this.batches.apply(String(args.batchId || ""))) };
      default:
        throw new Error(`Unknown persistence tool: ${toolName}`);
    }
  }

  private trackSessionWrites(
    toolName: string,
    args: Record<string, any>,
    result: { success?: boolean } | undefined
  ): void {
    if (!SOURCE_MUTATION_TOOLS.has(toolName) || result?.success === false) return;
    if (toolName === "project_write_batch") {
      for (const file of args.files || []) {
        if (typeof file?.path === "string") this.sessionTouched.add(file.path);
      }
      return;
    }
    if (typeof args.path === "string") this.sessionTouched.add(args.path);
  }
}

export * from "./claimRegistry.ts";
export * from "./mcpTools.ts";
export * from "./aiGateway.ts";
export * from "./pathJail.ts";
export * from "./approval.ts";
export * from "./checkpoints.ts";
export * from "./agentBatch.ts";
export * from "./persistenceTools.ts";
export * from "./atomicWrite.ts";
