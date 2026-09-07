import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { FlatStore, GraphError, type FlatStoreJson } from "../store/flatStore.ts";
import { ClaimRegistry } from "./claimRegistry.ts";
import { dispatchMCPTool, OPEN_DESIGNER_TOOLS } from "./mcpTools.ts";
import type { MCPContext, ScreenshotMode } from "./mcpTools.ts";
import { AIGateway, liveProvidersStatus, type AIGatewayConfig, type AIProvider } from "./aiGateway.ts";
import { REQUIRED_DSH_RELEASE } from "./dshAdapter.ts";
import { ApprovalRequiredError, catalogApprovalMode, persistApprovalMode, type ApprovalChannel } from "./approval.ts";
import { ApprovalDeniedError, ApprovalLedger, hashDiffPayload } from "./approvalReceipt.ts";
import { PathJailError, resolveProjectPath } from "./pathJail.ts";
import { atomicWriteJson } from "./atomicWrite.ts";
import { CheckpointLog, type CheckpointKind, type SourceOverlay } from "./checkpoints.ts";
import { AgentBatchRegistry, BatchError, GitRequiredError, type BatchApplyResult } from "./agentBatch.ts";
import { ApplyJournalBlockedError } from "./applyJournal.ts";
import { RuntimeBusyError, RuntimeLock } from "./runtimeLock.ts";
import { hashFrozenChangeset } from "./frozenChangeset.ts";
import { contentHash, readPresence, writeFileNoFollow, readTextNoFollow } from "./fileBytes.ts";
import { SourceBaselineStore, readBaselinePresence, bytesFromBaseline } from "./sourceBaseline.ts";
import { git } from "./gitExec.ts";
import { importJsxToElements } from "../compiler/jsxImport.ts";
import {
  SourcePatchError,
  type SourcePatchProposal,
  applyBoundEdits,
  applyIntentToClassName,
  classNamePatch,
  extractClassNameAt,
  hashSource,
  looksLikeFakeButtonWrapper,
  parseIntent,
  sliceEdits,
  unifiedDiff
} from "../compiler/sourcePatch.ts";
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

export interface ExecuteToolOptions {
  approvalChannel?: ApprovalChannel;
}

export class StaleHydrateError extends Error {
  readonly code = "STALE_HYDRATE";
  constructor(message = "Refusing to overwrite a newer project runtime with a stale canvas.") {
    super(message);
    this.name = "StaleHydrateError";
  }
}

export class ProjectMismatchError extends Error {
  readonly code = "PROJECT_MISMATCH";
  constructor(message = "Canvas payload projectId does not match this runtime.") {
    super(message);
    this.name = "ProjectMismatchError";
  }
}

export class OpenDesignerService {
  public static readonly serviceName = "openDesigner";

  public projectRoot: string;
  public readonly projectId: string;
  public storeVersion = 0;
  public autoApprove: boolean;
  public screenshotMode: ScreenshotMode;
  public store: FlatStore;
  public claimRegistry: ClaimRegistry;
  public aiGateway: AIGateway;
  public checkpoints: CheckpointLog;
  public batches: AgentBatchRegistry;
  public approvals: ApprovalLedger;
  public sessionTouched = new Set<string>();
  private sourceBaselines: SourceBaselineStore;
  private pendingProposal: SourcePatchProposal | null = null;
  private saveChain: Promise<unknown> = Promise.resolve();
  private runtimeLock: RuntimeLock;
  private initPromise: Promise<void> | null = null;

  private canvasFilePath: string;
  private designerDir: string;
  private appliedFilePath: string;
  private isInitialized: boolean = false;
  private lastAutosaveAt: string | null = null;
  private lastAppliedAt: string | null = null;

  constructor(config: OpenDesignerConfig = {}) {
    this.projectRoot = path.resolve(config.projectRoot || process.cwd());
    this.projectId = createHash("sha256").update(this.projectRoot).digest("hex").slice(0, 12);
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
      path.join(this.designerDir, "batches.json"),
      this.projectId
    );
    this.approvals = new ApprovalLedger(path.join(this.designerDir, "approvals.json"));
    this.sourceBaselines = new SourceBaselineStore(
      path.join(this.designerDir, "source-baselines.json"),
      this.projectId
    );
    this.runtimeLock = new RuntimeLock(path.join(this.designerDir, "runtime.lock"));
  }

  public fileIoRoot(): string {
    const open = this.batches.openBatch();
    if (!open) return this.projectRoot;
    return this.batches.worktreeAbs(open);
  }

  public worktreeKey(): string {
    return this.batches.openBatch()?.worktreeRelPath ?? ".";
  }

  public async start(): Promise<void> {
    await this.init();
  }

  public async stop(): Promise<void> {
    if (this.initPromise) await this.initPromise.catch(() => undefined);
    try {
      if (this.isInitialized) await this.saveCanvas();
    } finally {
      await this.runtimeLock.release();
      this.isInitialized = false;
      this.initPromise = null;
    }
  }

  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  private async doInit(): Promise<void> {
    if (this.isInitialized) return;
    await this.runtimeLock.acquire();
    try {
      await this.loadCanvas();
      await this.checkpoints.load();
      await this.batches.load();
      await this.approvals.load();
      await this.sourceBaselines.load();
      for (const rel of Object.keys(this.sourceBaselines.overlay(this.worktreeKey()))) {
        this.sessionTouched.add(rel);
      }
      try {
        const applied = JSON.parse(await fs.readFile(this.appliedFilePath, "utf-8")) as {
          appliedAt?: string;
        };
        this.lastAppliedAt = applied.appliedAt ?? null;
      } catch {
        this.lastAppliedAt = null;
      }
      if (this.store.getRootIds().length === 0) {
        await this.importProjectSource();
      }
      if (this.checkpoints.entries.length === 0) {
        await this.pushCheckpoint({ label: "baseline", kind: "canvas" });
      }
      this.isInitialized = true;
    } catch (err) {
      await this.runtimeLock.release();
      throw err;
    }
  }

  public status(): Record<string, unknown> {
    const current = this.checkpoints.current();
    const open = this.batches.openBatch();
    return {
      name: "dsh-opendesigner",
      requiredDsh: REQUIRED_DSH_RELEASE,
      projectRoot: this.projectRoot,
      projectId: this.projectId,
      storeVersion: this.storeVersion,
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
        gitCommitOnAutosave: false,
        saveDesign: "writes .designer/canvas.json only",
        applyToProject: "applies real file diffs from an open agent batch"
      }
    };
  }

  public async loadCanvas(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.canvasFilePath, "utf-8");
      const data = JSON.parse(raw) as FlatStoreJson;
      this.store.fromJSON(data);
      this.lastAutosaveAt = typeof data.savedAt === "string" ? data.savedAt : null;
      if (typeof data.version === "number") this.storeVersion = data.version;
      return true;
    } catch {
      return false;
    }
  }

  public hydrateStore(data: unknown): void {
    const payload = (data ?? {}) as FlatStoreJson & { baseVersion?: number };
    if (typeof payload.projectId !== "string" || payload.projectId.length === 0) {
      throw new ProjectMismatchError("projectId is required");
    }
    if (payload.projectId !== this.projectId) {
      throw new ProjectMismatchError();
    }
    if (typeof payload.baseVersion !== "number") {
      throw new StaleHydrateError("baseVersion is required and must exactly match the runtime version");
    }
    if (payload.baseVersion !== this.storeVersion) {
      throw new StaleHydrateError();
    }
    this.store.fromJSON(payload);
    this.storeVersion += 1;
  }

  public canvasPayload(): FlatStoreJson & { projectId: string; version: number; savedAt?: string } {
    return {
      ...this.store.toJSON(),
      projectId: this.projectId,
      version: this.storeVersion,
      ...(this.lastAutosaveAt ? { savedAt: this.lastAutosaveAt } : {})
    };
  }

  public bumpStoreVersion(): void {
    this.storeVersion += 1;
  }

  public async saveCanvas(localEditId?: number): Promise<{ savedAt: string; ackRevision: number; localEditId?: number }> {
    const frozenStore = this.store.toJSON();
    const frozenVersion = this.storeVersion;
    const run = this.saveChain.then(() => this.writeCanvas(localEditId, frozenStore, frozenVersion));
    this.saveChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async writeCanvas(
    localEditId: number | undefined,
    frozenStore: FlatStoreJson,
    frozenVersion: number
  ): Promise<{ savedAt: string; ackRevision: number; localEditId?: number }> {
    const savedAt = new Date().toISOString();
    await atomicWriteJson(this.canvasFilePath, {
      ...frozenStore,
      projectId: this.projectId,
      version: frozenVersion,
      savedAt
    });
    this.lastAutosaveAt = savedAt;
    return { savedAt, ackRevision: frozenVersion, localEditId };
  }

  public async captureSourceFiles(): Promise<SourceOverlay> {
    const files: SourceOverlay = {};
    const root = this.fileIoRoot();
    for (const rel of this.sessionTouched) {
      const abs = resolveProjectPath(root, rel);
      const presence = await readPresence(abs);
      if (presence.kind === "unreadable") continue;
      if (presence.kind === "absent") {
        files[rel] = null;
        continue;
      }
      const text = presence.bytes.toString("utf8");
      if (presence.bytes.includes(0) || !Buffer.from(text, "utf8").equals(presence.bytes)) continue;
      files[rel] = text;
    }
    return files;
  }

  public async restoreSourceFiles(files?: SourceOverlay): Promise<void> {
    const root = this.fileIoRoot();
    const worktree = this.worktreeKey();
    const baseline = this.sourceBaselines.overlay(worktree);
    const rels = new Set<string>([...this.sessionTouched, ...Object.keys(baseline), ...Object.keys(files ?? {})]);
    for (const rel of rels) {
      const hasSnap = Boolean(files && Object.prototype.hasOwnProperty.call(files, rel));
      const abs = resolveProjectPath(root, rel);
      if (hasSnap) {
        const content = files![rel];
        if (content === null || content === undefined) await fs.rm(abs, { force: true });
        else {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await writeFileNoFollow(abs, content);
        }
        continue;
      }
      const remembered = baseline[rel];
      if (!remembered || remembered.kind === "unreadable") continue;
      if (remembered.kind === "absent") {
        await fs.rm(abs, { force: true });
        continue;
      }
      const bytes = bytesFromBaseline(remembered);
      if (!bytes) continue;
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await writeFileNoFollow(abs, bytes);
    }
  }

  private async rememberSourceBaselines(toolName: string, args: Record<string, unknown>): Promise<void> {
    const rels: string[] = [];
    if (toolName === "project_write_batch") {
      for (const file of (args.files as Array<{ path?: string }> | undefined) || []) {
        if (typeof file?.path === "string") rels.push(file.path);
      }
    } else if (toolName === "project_copy_asset") {
      if (typeof args.targetPath === "string") rels.push(args.targetPath);
    } else if (typeof args.path === "string") {
      rels.push(args.path);
    }
    const root = this.fileIoRoot();
    const worktree = this.worktreeKey();
    for (const rel of rels) {
      this.sessionTouched.add(rel);
      const abs = resolveProjectPath(root, rel);
      this.sourceBaselines.remember(worktree, rel, await readBaselinePresence(abs));
    }
    await this.sourceBaselines.persist();
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
    this.storeVersion += 1;
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
      projectId: this.projectId,
      version: this.storeVersion,
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
      gitCommit: false,
      kind: "save-design"
    });
    this.lastAppliedAt = appliedAt;
    return {
      success: true,
      appliedAt,
      checkpointId: current?.id ?? null,
      workingCopy: ".designer/canvas.json",
      kind: "save-design",
      gitCommit: false
    };
  }

  public async applyOpenBatchFiles(batchId: string): Promise<BatchApplyResult> {
    const diffs = await this.batches.previewDiffs(batchId);
    if (diffs.length === 0) {
      throw new BatchError("No file diffs to apply", "NO_FILE_DIFFS");
    }
    return await this.batches.apply(batchId);
  }

  public async getGitStatus(): Promise<GitSyncStatus> {
    try {
      const { stdout: branchOut } = await git(this.projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = branchOut.trim();
      const { stdout: statusOut } = await git(this.projectRoot, ["status", "-z", "--porcelain=v1"]);
      const lines = statusOut.split("\0").filter((l) => l.trim().length > 0);
      const modifiedFiles = lines.map((l) => l.slice(3).trim()).filter(Boolean);
      const canvasTracked = modifiedFiles.some((l) => l.includes(".designer/canvas.json"));

      return {
        isGitRepo: true,
        branch,
        clean: modifiedFiles.length === 0,
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

  public async executeTool(
    toolName: string,
    args: Record<string, any> = {},
    options: ExecuteToolOptions = {}
  ): Promise<any> {
    try {
      await this.init();
      const persistCtx = {
        autoApprove: this.autoApprove,
        approvalChannel: options.approvalChannel ?? "model"
      };

      await this.assertReceipt(toolName, args, persistCtx);

      if (PERSISTENCE_TOOL_NAMES.has(toolName)) {
        return await this.executePersistTool(toolName, args);
      }

      if (SOURCE_MUTATION_TOOLS.has(toolName)) {
        await this.rememberSourceBaselines(toolName, args);
      }

      const context: MCPContext = {
        projectRoot: this.fileIoRoot(),
        store: this.store,
        claims: this.claimRegistry,
        autoApprove: this.autoApprove,
        approvalGranted: true,
        approvalChannel: options.approvalChannel ?? "model",
        screenshotMode: this.screenshotMode,
        saveCanvas: async () => {
          await this.saveCanvas();
        }
      };

      const result = await dispatchMCPTool(toolName, args, context);
      this.trackSessionWrites(toolName, args, result);
      if (CANVAS_MUTATION_TOOLS.has(toolName) && result?.success !== false) {
        this.storeVersion += 1;
        await this.pushCheckpoint({ label: toolName, kind: "canvas" });
      } else if (SOURCE_MUTATION_TOOLS.has(toolName) && result?.success !== false) {
        await this.pushCheckpoint({ label: toolName, kind: "source" });
      }
      return result;
    } catch (err) {
      if (
        err instanceof PathJailError ||
        err instanceof ApprovalRequiredError ||
        err instanceof ApprovalDeniedError ||
        err instanceof GitRequiredError ||
        err instanceof BatchError ||
        err instanceof GraphError ||
        err instanceof StaleHydrateError ||
        err instanceof ProjectMismatchError ||
        err instanceof SourcePatchError ||
        err instanceof ApplyJournalBlockedError ||
        err instanceof RuntimeBusyError
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

  public async issueHostReceipt(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.init();
    const diffHash = await this.toolDiffHash(tool, args);
    const receipt = await this.approvals.issue({
      projectId: this.projectId,
      revision: this.storeVersion,
      diffHash,
      tool
    });
    return {
      success: true,
      approvalReceipt: receipt.id,
      projectId: receipt.projectId,
      revision: receipt.revision,
      diffHash: receipt.diffHash,
      tool: receipt.tool,
      expiresAt: receipt.expiresAt,
      receiptKind: "debug-http",
      humanApproval: false,
      note: "Local HTTP can mint a debug receipt. That is not human approval of a seen diff."
    };
  }

  public async proposeSourcePatch(input: {
    elementId: string;
    instruction: string;
    live?: boolean;
  }): Promise<unknown> {
    await this.init();
    const element = this.store.getElement(input.elementId);
    if (!element?.sourceLocation) {
      throw new SourcePatchError("Selection is not mapped to a source node. Unsupported edits cannot fake-accept.", "NO_SOURCE_NODE");
    }
    const instruction = input.instruction.trim();
    if (!instruction) {
      throw new SourcePatchError("Write an intent in zh or en before proposing.", "EMPTY_INTENT");
    }
    const filePath = element.sourceLocation.filePath;
    const abs = resolveProjectPath(this.projectRoot, filePath);
    const sourceCode = await readTextNoFollow(abs);
    const sourceHash = hashSource(sourceCode);
    const beforeClassName = typeof element.props.className === "string" ? element.props.className : "";
    const loc = element.sourceLocation;

    let mergedCode: string | null = null;
    let liveError: string | undefined;
    if (input.live !== false && this.aiGateway.mockMode !== true && this.aiGateway.status().hasApiKey) {
      const result = await this.aiGateway.generateAndApply({
        sourceCode,
        instruction: `Apply this visual intent to the JSX node at ${filePath}:${loc.line}:${loc.column}. Return surgical edits of this real file, not a wrapped snippet.\nIntent: ${instruction}`
      });
      if (result.success && result.mergedCode && result.fallback !== true) {
        if (looksLikeFakeButtonWrapper(sourceCode, result.mergedCode)) {
          liveError = "Model returned a button wrapper instead of a real file patch.";
        } else {
          mergedCode = result.mergedCode;
        }
      } else {
        liveError = result.liveError || result.error;
      }
    }

    if (!mergedCode) {
      const intent = parseIntent(instruction);
      const nextClass = applyIntentToClassName(beforeClassName, intent);
      if (intent.kind === "unsupported" || nextClass === null) {
        throw new SourcePatchError(
          `${liveError || (intent.kind === "unsupported" ? intent.reason : "Unsupported edit.")} currentClassName=${JSON.stringify(beforeClassName)}`,
          "UNSUPPORTED_EDIT"
        );
      }
      const patched = classNamePatch({
        sourceCode,
        line: loc.line,
        column: loc.column,
        newClassName: nextClass
      });
      if (!patched.ok) {
        throw new SourcePatchError(
          `${patched.reason}. currentClassName=${JSON.stringify(beforeClassName)}`,
          "UNSUPPORTED_EDIT"
        );
      }
      mergedCode = patched.code;
    }

    const edits = sliceEdits(sourceCode, mergedCode);
    const applied = applyBoundEdits(sourceCode, edits);
    if (!applied.ok) {
      throw new SourcePatchError(applied.reason, "UNSUPPORTED_EDIT");
    }
    const afterClassName = extractClassNameAt(applied.code, loc.line, loc.column) ?? beforeClassName;
    const proposal: SourcePatchProposal = {
      id: `cs_${Date.now()}`,
      instruction,
      elementId: input.elementId,
      filePath,
      sourceHash,
      afterHash: hashSource(applied.code),
      baseRevision: this.storeVersion,
      beforeClassName,
      afterClassName,
      edits,
      preview: unifiedDiff(filePath, sourceCode, applied.code),
      mergedCode: applied.code
    };
    this.pendingProposal = proposal;
    return {
      success: true,
      proposal,
      visualProof: false
    };
  }

  public async acceptSourcePatch(input: { proposalId?: string } = {}): Promise<unknown> {
    await this.init();
    const proposal = this.pendingProposal;
    if (!proposal) {
      throw new SourcePatchError("No pending source patch.", "NO_PROPOSAL");
    }
    if (input.proposalId && input.proposalId !== proposal.id) {
      throw new SourcePatchError("Proposal id mismatch.", "STALE_PROPOSAL");
    }
    const element = this.store.getElement(proposal.elementId);
    const currentClass = typeof element?.props.className === "string" ? element.props.className : "";
    if (currentClass !== proposal.beforeClassName) {
      throw new SourcePatchError("beforeClassName no longer matches the selected node.", "STALE_PROPOSAL");
    }
    if (proposal.baseRevision !== this.storeVersion) {
      throw new SourcePatchError("baseRevision no longer matches the project runtime.", "STALE_PROPOSAL");
    }
    const abs = resolveProjectPath(this.projectRoot, proposal.filePath);
    const current = await readTextNoFollow(abs);
    if (hashSource(current) !== proposal.sourceHash) {
      throw new SourcePatchError("sourceHash no longer matches the file on disk.", "STALE_PROPOSAL");
    }
    const applied = applyBoundEdits(current, proposal.edits);
    if (!applied.ok || applied.code !== proposal.mergedCode) {
      throw new SourcePatchError(applied.ok ? "Patch preview does not match accept payload." : applied.reason, "UNSUPPORTED_EDIT");
    }
    await this.rememberSourceBaselines("project_edit", { path: proposal.filePath });
    await this.pushCheckpoint({ label: "changeset-before-accept", kind: "session" });
    await writeFileNoFollow(abs, applied.code);
    this.sessionTouched.add(proposal.filePath);
    this.reprojectSourceFile(proposal.filePath, applied.code);
    this.storeVersion += 1;
    this.pendingProposal = null;
    await this.pushCheckpoint({ label: "changeset-accept", kind: "session" });
    await this.saveCanvas();
    const projected = this.store.getElement(proposal.elementId);
    return {
      success: true,
      filePath: proposal.filePath,
      preview: proposal.preview,
      afterClassName: typeof projected?.props.className === "string" ? projected.props.className : proposal.afterClassName,
      afterHash: proposal.afterHash,
      projectId: this.projectId,
      version: this.storeVersion,
      store: this.store.toJSON()
    };
  }

  public async rejectSourcePatch(): Promise<unknown> {
    this.pendingProposal = null;
    return { success: true, residue: false, wrote: false };
  }

  private reprojectSourceFile(rel: string, source: string): void {
    const snapshot = this.store.toJSON();
    for (const page of snapshot.pages) {
      const root = snapshot.byId[page.rootElementId];
      if (root?.sourceLocation?.filePath === rel) {
        this.store.removeElement(page.rootElementId);
      }
    }
    const remaining = this.store.toJSON();
    for (const [id, el] of Object.entries(remaining.byId)) {
      if (el.sourceLocation?.filePath === rel) this.store.removeElement(id);
    }
    const imported = importJsxToElements(source, rel);
    for (const el of imported.elements) this.store.setElement(el);
    for (const edge of imported.attachments) this.store.attachChild(edge.parentId, edge.childId);
    const rootId = imported.rootIds[0];
    if (rootId) {
      this.store.addPage({ id: "page-source", name: path.basename(rel), isLoaded: true, rootElementId: rootId });
      this.store.setActivePage("page-source");
    }
  }

  private async importProjectSource(): Promise<void> {
    const candidates = ["src/App.tsx", "src/app.tsx", "App.tsx", "src/page.tsx"];
    for (const rel of candidates) {
      try {
        const abs = resolveProjectPath(this.projectRoot, rel);
        const source = await readTextNoFollow(abs);
        const imported = importJsxToElements(source, rel);
        if (imported.elements.length === 0) continue;
        for (const el of imported.elements) this.store.setElement(el);
        for (const edge of imported.attachments) this.store.attachChild(edge.parentId, edge.childId);
        const rootId = imported.rootIds[0];
        if (rootId) {
          this.store.addPage({ id: "page-source", name: path.basename(rel), isLoaded: true, rootElementId: rootId });
          this.store.setActivePage("page-source");
        }
        return;
      } catch {
        // Try the next candidate.
      }
    }
  }

  private async toolDiffHash(tool: string, args: Record<string, unknown>): Promise<string> {
    if (tool === "batch_apply" && typeof args.batchId === "string") {
      const frozen = await this.batches.captureFrozen(args.batchId);
      return hashFrozenChangeset(frozen);
    }
    if (tool === "accept_source_patch") {
      const proposal = this.pendingProposal;
      return hashDiffPayload([
        tool,
        proposal?.id || "",
        proposal?.filePath || "",
        proposal?.sourceHash || "",
        proposal?.afterHash || "",
        JSON.stringify(proposal?.edits || [])
      ]);
    }
    if (tool === "project_write_batch") {
      const files = Array.isArray(args.files) ? args.files : [];
      const parts: Array<string | Buffer> = [tool];
      for (const file of files as Array<{ path?: string; content?: string }>) {
        const rel = String(file?.path || "");
        const after = Buffer.from(String(file?.content ?? ""), "utf8");
        const before = rel ? await this.pathFingerprint(rel) : "path:none";
        parts.push(rel, before, contentHash(after));
      }
      return hashDiffPayload(parts);
    }
    if (tool === "project_copy_asset") {
      const sourcePath = String(args.sourcePath || args.source || "");
      const targetPath = String(args.targetPath || args.destination || args.path || "");
      return hashDiffPayload([
        tool,
        sourcePath,
        targetPath,
        await this.pathFingerprint(sourcePath),
        await this.pathFingerprint(targetPath)
      ]);
    }
    if (tool === "project_edit" || tool === "local_edit") {
      const rel = String(args.path || "");
      const before = await this.pathFingerprint(rel);
      let after = "after:none";
      if (rel) {
        try {
          const abs = resolveProjectPath(this.fileIoRoot(), rel);
          const current = await readTextNoFollow(abs);
          const applied = applyBoundEdits(current, [
            {
              old_string: String(args.old_string || ""),
              new_string: String(args.new_string || ""),
              replace_all: Boolean(args.replace_all)
            }
          ]);
          if (applied.ok) after = hashSource(applied.code);
        } catch {
          after = "after:unreadable";
        }
      }
      return hashDiffPayload([
        tool,
        rel,
        String(args.old_string || ""),
        String(args.new_string || ""),
        args.replace_all === true ? "replace_all" : "replace_one",
        before,
        after
      ]);
    }
    const rel = String(args.path || args.batchId || "");
    const content = typeof args.content === "string" ? args.content : "";
    return hashDiffPayload([
      tool,
      rel,
      await this.pathFingerprint(rel),
      content ? contentHash(Buffer.from(content, "utf8")) : "",
      String(args.old_string || ""),
      String(args.new_string || ""),
      args.replace_all === true ? "replace_all" : ""
    ]);
  }

  private async pathFingerprint(rel: string): Promise<string> {
    if (!rel) return "path:none";
    try {
      const abs = resolveProjectPath(this.fileIoRoot(), rel);
      const presence = await readPresence(abs);
      if (presence.kind === "absent") return "absent";
      if (presence.kind === "unreadable") return `unreadable:${presence.code}`;
      return contentHash(presence.bytes);
    } catch (err) {
      if (err instanceof PathJailError) return `jail:${err.message}`;
      return "unreadable:error";
    }
  }

  private async assertReceipt(
    toolName: string,
    args: Record<string, unknown>,
    ctx: { autoApprove?: boolean }
  ): Promise<void> {
    const persist = PERSISTENCE_TOOL_NAMES.has(toolName);
    const catalog = OPEN_DESIGNER_TOOLS.find((tool) => tool.name === toolName);
    const mode = persist
      ? persistApprovalMode(toolName)
      : catalog
        ? catalogApprovalMode(catalog)
        : "auto";
    if (mode === "auto") return;
    if (ctx.autoApprove === true) return;
    const diffHash = await this.toolDiffHash(toolName, args);
    await this.approvals.consume({
      receiptId: args.approvalReceipt,
      projectId: this.projectId,
      revision: this.storeVersion,
      diffHash,
      tool: toolName
    });
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
      case "autosave": {
        const localEditId = typeof args.localEditId === "number" ? args.localEditId : undefined;
        const saved = await this.saveCanvas(localEditId);
        return {
          success: true,
          path: ".designer/canvas.json",
          savedAt: saved.savedAt,
          projectId: this.projectId,
          version: saved.ackRevision,
          ackRevision: saved.ackRevision,
          localEditId: saved.localEditId,
          gitCommit: false
        };
      }
      case "apply_to_project":
        return await this.applyToProject();
      case "batch_create":
        return {
          success: true,
          ...(await this.batches.create(typeof args.label === "string" ? args.label : undefined))
        };
      case "batch_discard":
        return { success: true, ...(await this.batches.discard(String(args.batchId || ""))) };
      case "batch_preview":
        return {
          success: true,
          diffs: await this.batches.previewDiffs(String(args.batchId || ""))
        };
      case "batch_apply":
        return { success: true, ...(await this.applyOpenBatchFiles(String(args.batchId || ""))) };
      case "propose_source_patch":
        return await this.proposeSourcePatch({
          elementId: String(args.elementId || ""),
          instruction: String(args.instruction || ""),
          live: args.live !== false
        });
      case "accept_source_patch":
        return await this.acceptSourcePatch({
          proposalId: typeof args.proposalId === "string" ? args.proposalId : undefined
        });
      case "reject_source_patch":
        return await this.rejectSourcePatch();
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
export * from "./approvalReceipt.ts";
export * from "./applyJournal.ts";
export * from "./checkpoints.ts";
export * from "./agentBatch.ts";
export * from "./persistenceTools.ts";
export * from "./atomicWrite.ts";
export * from "./runtimeLock.ts";
export * from "./frozenChangeset.ts";
export { GraphError } from "../store/flatStore.ts";
