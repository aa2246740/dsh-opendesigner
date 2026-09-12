import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { FlatStore, GraphError } from "../store/flatStore.js";
import { ClaimRegistry } from "./claimRegistry.js";
import { dispatchMCPTool, OPEN_DESIGNER_TOOLS } from "./mcpTools.js";
import { AIGateway, liveProvidersStatus } from "./aiGateway.js";
import { REQUIRED_DSH_RELEASE } from "./dshAdapter.js";
import { ApprovalRequiredError, catalogApprovalMode, persistApprovalMode } from "./approval.js";
import { ApprovalDeniedError, ApprovalLedger, hashDiffPayload } from "./approvalReceipt.js";
import { PathJailError, resolveProjectPath } from "./pathJail.js";
import { atomicWriteJson } from "./atomicWrite.js";
import { CheckpointLog } from "./checkpoints.js";
import { AgentBatchRegistry, BatchError, GitRequiredError } from "./agentBatch.js";
import { ApplyJournalBlockedError } from "./applyJournal.js";
import { RuntimeBusyError, RuntimeLock } from "./runtimeLock.js";
import { hashFrozenChangeset, cloneFrozenChangeset } from "./frozenChangeset.js";
import { contentHash, readPresence, writeFileNoFollow, readTextNoFollow } from "./fileBytes.js";
import { SourceBaselineStore, bytesFromBaseline, readBaselinePresence } from "./sourceBaseline.js";
import { applyRestorePlan, materializeOverlayEntry, migrateOverlay, overlayRoot } from "./sourceOverlay.js";
import { git } from "./gitExec.js";
import { importJsxToElements } from "../compiler/jsxImport.js";
import { SourcePatchError, applyBoundEdits, applyIntentToClassName, classNamePatch, extractClassNameAt, hashSource, looksLikeFakeButtonWrapper, parseIntent, sliceEdits, unifiedDiff } from "../compiler/sourcePatch.js";
import { CANVAS_MUTATION_TOOLS, PERSISTENCE_TOOL_NAMES, SOURCE_MUTATION_TOOLS } from "./persistenceTools.js";
export class StaleHydrateError extends Error {
    code = "STALE_HYDRATE";
    constructor(message = "Refusing to overwrite a newer project runtime with a stale canvas.") {
        super(message);
        this.name = "StaleHydrateError";
    }
}
export class ProjectMismatchError extends Error {
    code = "PROJECT_MISMATCH";
    constructor(message = "Canvas payload projectId does not match this runtime.") {
        super(message);
        this.name = "ProjectMismatchError";
    }
}
export class OpenDesignerService {
    static serviceName = "openDesigner";
    projectRoot;
    projectId;
    storeVersion = 0;
    autoApprove;
    screenshotMode;
    store;
    claimRegistry;
    aiGateway;
    checkpoints;
    batches;
    approvals;
    sessionTouched = new Set();
    sourceBaselines;
    pendingProposal = null;
    approvedChangeset = null;
    saveChain = Promise.resolve();
    commandChain = Promise.resolve();
    runtimeLock;
    initPromise = null;
    canvasFilePath;
    designerDir;
    appliedFilePath;
    isInitialized = false;
    lastAutosaveAt = null;
    lastAppliedAt = null;
    constructor(config = {}) {
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
        this.batches = new AgentBatchRegistry(this.projectRoot, path.join(this.designerDir, "batches.json"), this.projectId);
        this.approvals = new ApprovalLedger(path.join(this.designerDir, "approvals.json"));
        this.sourceBaselines = new SourceBaselineStore(path.join(this.designerDir, "source-baselines.json"), this.projectId);
        this.runtimeLock = new RuntimeLock(path.join(this.designerDir, "runtime.lock"));
    }
    fileIoRoot() {
        const open = this.batches.openBatch();
        if (!open)
            return this.projectRoot;
        return this.batches.worktreeAbs(open);
    }
    worktreeKey() {
        return this.batches.openBatch()?.worktreeRelPath ?? ".";
    }
    async start() {
        await this.init();
    }
    async stop() {
        if (this.initPromise)
            await this.initPromise.catch(() => undefined);
        try {
            if (this.isInitialized)
                await this.saveCanvas();
        }
        finally {
            await this.runtimeLock.release();
            this.isInitialized = false;
            this.initPromise = null;
        }
    }
    async init() {
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = this.doInit();
        try {
            await this.initPromise;
        }
        catch (err) {
            this.initPromise = null;
            throw err;
        }
    }
    async doInit() {
        if (this.isInitialized)
            return;
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
                const applied = JSON.parse(await fs.readFile(this.appliedFilePath, "utf-8"));
                this.lastAppliedAt = applied.appliedAt ?? null;
            }
            catch {
                this.lastAppliedAt = null;
            }
            if (this.store.getRootIds().length === 0) {
                await this.importProjectSource();
            }
            if (this.checkpoints.entries.length === 0) {
                await this.pushCheckpoint({ label: "baseline", kind: "canvas" });
            }
            this.isInitialized = true;
        }
        catch (err) {
            await this.runtimeLock.release();
            throw err;
        }
    }
    status() {
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
    async loadCanvas() {
        try {
            const raw = await fs.readFile(this.canvasFilePath, "utf-8");
            const data = JSON.parse(raw);
            this.store.fromJSON(data);
            this.lastAutosaveAt = typeof data.savedAt === "string" ? data.savedAt : null;
            if (typeof data.version === "number")
                this.storeVersion = data.version;
            return true;
        }
        catch {
            return false;
        }
    }
    hydrateStore(data) {
        const payload = (data ?? {});
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
    canvasPayload() {
        return {
            ...this.store.toJSON(),
            projectId: this.projectId,
            version: this.storeVersion,
            ...(this.lastAutosaveAt ? { savedAt: this.lastAutosaveAt } : {})
        };
    }
    bumpStoreVersion() {
        this.storeVersion += 1;
    }
    async saveCanvas(localEditId) {
        const frozenStore = this.store.toJSON();
        const frozenVersion = this.storeVersion;
        const run = this.saveChain.then(() => this.writeCanvas(localEditId, frozenStore, frozenVersion));
        this.saveChain = run.then(() => undefined, () => undefined);
        return run;
    }
    async writeCanvas(localEditId, frozenStore, frozenVersion) {
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
    async captureSourceFiles() {
        const worktreeKey = this.worktreeKey();
        const root = this.fileIoRoot();
        const files = {};
        for (const rel of this.sessionTouched) {
            const abs = resolveProjectPath(root, rel);
            files[rel] = await readBaselinePresence(abs);
        }
        return {
            workspaceId: this.projectId,
            worktreeKey,
            files
        };
    }
    async restoreSourceFiles(files) {
        const overlay = migrateOverlay(files);
        const worktreeKey = overlay?.worktreeKey || ".";
        if (overlay?.workspaceId && overlay.workspaceId !== this.projectId) {
            const error = new Error("Checkpoint workspace identity does not match this runtime.");
            error.code = "CHECKPOINT_WORKSPACE_MISMATCH";
            throw error;
        }
        const root = overlayRoot(this.projectRoot, worktreeKey);
        const overlayFiles = overlay?.files ?? {};
        const baseline = this.sourceBaselines.overlay(worktreeKey || ".");
        const rels = new Set([...this.sessionTouched, ...Object.keys(baseline), ...Object.keys(overlayFiles)]);
        const plan = [];
        for (const rel of rels) {
            if (Object.prototype.hasOwnProperty.call(overlayFiles, rel)) {
                plan.push(materializeOverlayEntry(root, rel, overlayFiles[rel]));
                continue;
            }
            const remembered = baseline[rel];
            if (!remembered || remembered.kind === "unreadable")
                continue;
            if (remembered.kind === "absent") {
                plan.push({ rel, abs: resolveProjectPath(root, rel), bytes: null });
                continue;
            }
            const bytes = bytesFromBaseline(remembered);
            if (!bytes)
                continue;
            plan.push({ rel, abs: resolveProjectPath(root, rel), bytes });
        }
        await applyRestorePlan(plan);
    }
    async rememberSourceBaselines(toolName, args) {
        const rels = [];
        if (toolName === "project_write_batch") {
            for (const file of args.files || []) {
                if (typeof file?.path === "string")
                    rels.push(file.path);
            }
        }
        else if (toolName === "project_copy_asset") {
            if (typeof args.targetPath === "string")
                rels.push(args.targetPath);
        }
        else if (typeof args.path === "string") {
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
    async pushCheckpoint(input) {
        const sourceFiles = await this.captureSourceFiles();
        const hasFiles = Object.keys(sourceFiles.files).length > 0;
        const checkpoint = await this.checkpoints.push({
            label: input.label,
            kind: input.kind ?? (hasFiles ? "session" : "canvas"),
            store: this.store.toJSON(),
            sourceFiles
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
    async rewind(checkpointId) {
        const plan = checkpointId
            ? this.checkpoints.planRewindTo(checkpointId)
            : this.checkpoints.planRewind();
        await this.restoreSourceFiles(plan.checkpoint.sourceFiles);
        this.store.fromJSON(plan.checkpoint.store);
        this.storeVersion += 1;
        const checkpoint = await this.checkpoints.commitRewind(plan);
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
    async applyToProject() {
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
    async applyOpenBatchFiles(batchId) {
        const approved = this.approvedChangeset;
        this.approvedChangeset = null;
        if (approved) {
            if (approved.batchId !== batchId) {
                throw new ApprovalDeniedError("Approved changeset does not match this batch.");
            }
            if (approved.ops.length === 0) {
                throw new BatchError("No file diffs to apply", "NO_FILE_DIFFS");
            }
            return await this.batches.commitPrepared(approved);
        }
        const diffs = await this.batches.previewDiffs(batchId);
        if (diffs.length === 0) {
            throw new BatchError("No file diffs to apply", "NO_FILE_DIFFS");
        }
        return await this.batches.apply(batchId);
    }
    async getGitStatus() {
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
        }
        catch {
            return {
                isGitRepo: false,
                clean: true,
                modifiedFiles: [],
                canvasTracked: false
            };
        }
    }
    async syncGitWorkspace(options = {}) {
        await this.saveCanvas();
        if (options.stageCanvas) {
            try {
                await git(this.projectRoot, ["add", "-f", ".designer/canvas.json"]);
            }
            catch {
                // Non-git trees skip staging. Autosave never calls this.
            }
        }
        return await this.getGitStatus();
    }
    async executeTool(toolName, args = {}, options = {}) {
        return this.enqueueCommand(() => this.executeToolUngated(toolName, args, options));
    }
    enqueueCommand(fn) {
        const run = this.commandChain.then(fn, fn);
        this.commandChain = run.then(() => undefined, () => undefined);
        return run;
    }
    async executeToolUngated(toolName, args = {}, options = {}) {
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
            const context = {
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
            }
            else if (SOURCE_MUTATION_TOOLS.has(toolName) && result?.success !== false) {
                await this.pushCheckpoint({ label: toolName, kind: "source" });
            }
            return result;
        }
        catch (err) {
            if (err instanceof PathJailError ||
                err instanceof ApprovalRequiredError ||
                err instanceof ApprovalDeniedError ||
                err instanceof GitRequiredError ||
                err instanceof BatchError ||
                err instanceof GraphError ||
                err instanceof StaleHydrateError ||
                err instanceof ProjectMismatchError ||
                err instanceof SourcePatchError ||
                err instanceof ApplyJournalBlockedError ||
                err instanceof RuntimeBusyError) {
                return {
                    success: false,
                    error: err.message,
                    code: err.code,
                    ...(err instanceof SourcePatchError && err.ruleMode ? { ruleMode: err.ruleMode } : {})
                };
            }
            if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
                const code = err.code;
                if (code === "NOTHING_TO_REWIND" ||
                    code === "CHECKPOINT_NOT_FOUND" ||
                    code === "CHECKPOINT_UNREADABLE" ||
                    code === "CHECKPOINT_HASH_MISMATCH" ||
                    code === "CHECKPOINT_WORKSPACE_MISMATCH") {
                    return { success: false, error: err instanceof Error ? err.message : String(err), code };
                }
                if (code === "ENOENT") {
                    return { success: false, error: err instanceof Error ? err.message : String(err), code: "NOT_FOUND" };
                }
            }
            throw err;
        }
    }
    async issueHostReceipt(tool, args = {}) {
        return this.enqueueCommand(() => this.issueHostReceiptUngated(tool, args));
    }
    async issueHostReceiptUngated(tool, args = {}) {
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
    async proposeSourcePatch(input) {
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
        let mergedCode = null;
        let liveError;
        if (input.live !== false && this.aiGateway.mockMode !== true && this.aiGateway.status().hasApiKey) {
            const result = await this.aiGateway.generateAndApply({
                sourceCode,
                instruction: `Apply this visual intent to the JSX node at ${filePath}:${loc.line}:${loc.column}. Return surgical edits of this real file, not a wrapped snippet.\nIntent: ${instruction}`
            });
            if (result.success && result.mergedCode && result.fallback !== true) {
                if (looksLikeFakeButtonWrapper(sourceCode, result.mergedCode)) {
                    liveError = "Model returned a button wrapper instead of a real file patch.";
                }
                else {
                    mergedCode = result.mergedCode;
                }
            }
            else {
                liveError = result.liveError || result.error;
            }
        }
        if (!mergedCode) {
            const intent = parseIntent(instruction);
            const nextClass = applyIntentToClassName(beforeClassName, intent);
            if (intent.kind === "unsupported" || nextClass === null) {
                throw new SourcePatchError(`${liveError || (intent.kind === "unsupported" ? intent.reason : "Unsupported edit.")} currentClassName=${JSON.stringify(beforeClassName)}`, "UNSUPPORTED_EDIT", { ruleMode: intent.kind === "unsupported" ? intent.ruleMode : undefined });
            }
            const patched = classNamePatch({
                sourceCode,
                line: loc.line,
                column: loc.column,
                newClassName: nextClass
            });
            if (!patched.ok) {
                throw new SourcePatchError(`${patched.reason}. currentClassName=${JSON.stringify(beforeClassName)}`, "UNSUPPORTED_EDIT");
            }
            mergedCode = patched.code;
        }
        const edits = sliceEdits(sourceCode, mergedCode);
        const applied = applyBoundEdits(sourceCode, edits);
        if (!applied.ok) {
            throw new SourcePatchError(applied.reason, "UNSUPPORTED_EDIT");
        }
        const afterClassName = extractClassNameAt(applied.code, loc.line, loc.column) ?? beforeClassName;
        const proposal = {
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
    async acceptSourcePatch(input = {}) {
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
    async rejectSourcePatch() {
        this.pendingProposal = null;
        return { success: true, residue: false, wrote: false };
    }
    reprojectSourceFile(rel, source) {
        const snapshot = this.store.toJSON();
        for (const page of snapshot.pages) {
            const root = snapshot.byId[page.rootElementId];
            if (root?.sourceLocation?.filePath === rel) {
                this.store.removeElement(page.rootElementId);
            }
        }
        const remaining = this.store.toJSON();
        for (const [id, el] of Object.entries(remaining.byId)) {
            if (el.sourceLocation?.filePath === rel)
                this.store.removeElement(id);
        }
        const imported = importJsxToElements(source, rel);
        for (const el of imported.elements)
            this.store.setElement(el);
        for (const edge of imported.attachments)
            this.store.attachChild(edge.parentId, edge.childId);
        const rootId = imported.rootIds[0];
        if (rootId) {
            this.store.addPage({ id: "page-source", name: path.basename(rel), isLoaded: true, rootElementId: rootId });
            this.store.setActivePage("page-source");
        }
    }
    async importProjectSource() {
        const candidates = ["src/App.tsx", "src/app.tsx", "App.tsx", "src/page.tsx"];
        for (const rel of candidates) {
            try {
                const abs = resolveProjectPath(this.projectRoot, rel);
                const source = await readTextNoFollow(abs);
                const imported = importJsxToElements(source, rel);
                if (imported.elements.length === 0)
                    continue;
                for (const el of imported.elements)
                    this.store.setElement(el);
                for (const edge of imported.attachments)
                    this.store.attachChild(edge.parentId, edge.childId);
                const rootId = imported.rootIds[0];
                if (rootId) {
                    this.store.addPage({ id: "page-source", name: path.basename(rel), isLoaded: true, rootElementId: rootId });
                    this.store.setActivePage("page-source");
                }
                return;
            }
            catch {
                // Try the next candidate.
            }
        }
    }
    async toolDiffHash(tool, args) {
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
            const parts = [tool];
            for (const file of files) {
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
                    if (applied.ok)
                        after = hashSource(applied.code);
                }
                catch {
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
    async pathFingerprint(rel) {
        if (!rel)
            return "path:none";
        try {
            const abs = resolveProjectPath(this.fileIoRoot(), rel);
            const presence = await readPresence(abs);
            if (presence.kind === "absent")
                return "absent";
            if (presence.kind === "unreadable")
                return `unreadable:${presence.code}`;
            return contentHash(presence.bytes);
        }
        catch (err) {
            if (err instanceof PathJailError)
                return `jail:${err.message}`;
            return "unreadable:error";
        }
    }
    async assertReceipt(toolName, args, ctx) {
        const persist = PERSISTENCE_TOOL_NAMES.has(toolName);
        const catalog = OPEN_DESIGNER_TOOLS.find((tool) => tool.name === toolName);
        const mode = persist
            ? persistApprovalMode(toolName)
            : catalog
                ? catalogApprovalMode(catalog)
                : "auto";
        if (mode === "auto")
            return;
        if (ctx.autoApprove === true)
            return;
        if (toolName === "batch_apply" && typeof args.batchId === "string") {
            const frozen = await this.batches.captureFrozen(args.batchId);
            const diffHash = hashFrozenChangeset(frozen);
            await this.approvals.consume({
                receiptId: args.approvalReceipt,
                projectId: this.projectId,
                revision: this.storeVersion,
                diffHash,
                tool: toolName
            });
            this.approvedChangeset = cloneFrozenChangeset(frozen);
            return;
        }
        const diffHash = await this.toolDiffHash(toolName, args);
        await this.approvals.consume({
            receiptId: args.approvalReceipt,
            projectId: this.projectId,
            revision: this.storeVersion,
            diffHash,
            tool: toolName
        });
    }
    async executePersistTool(toolName, args) {
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
    trackSessionWrites(toolName, args, result) {
        if (!SOURCE_MUTATION_TOOLS.has(toolName) || result?.success === false)
            return;
        if (toolName === "project_write_batch") {
            for (const file of args.files || []) {
                if (typeof file?.path === "string")
                    this.sessionTouched.add(file.path);
            }
            return;
        }
        if (typeof args.path === "string")
            this.sessionTouched.add(args.path);
    }
}
export * from "./claimRegistry.js";
export * from "./mcpTools.js";
export * from "./aiGateway.js";
export * from "./pathJail.js";
export * from "./approval.js";
export * from "./approvalReceipt.js";
export * from "./applyJournal.js";
export * from "./checkpoints.js";
export * from "./agentBatch.js";
export * from "./persistenceTools.js";
export * from "./atomicWrite.js";
export * from "./runtimeLock.js";
export * from "./frozenChangeset.js";
export { GraphError } from "../store/flatStore.js";
//# sourceMappingURL=index.js.map