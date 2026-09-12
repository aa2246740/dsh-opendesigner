import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomicWrite.js";
import { git, gitHead, gitShowBytes, isGitRepo } from "./gitExec.js";
import { resolveProjectPath } from "./pathJail.js";
import { contentHash, presenceEqual, readPresence, managedReplace, managedUnlink } from "./fileBytes.js";
import { ApplyJournal } from "./applyJournal.js";
import { cloneFrozenChangeset, fileModeOf, fingerprintPresence, hashFrozenChangeset } from "./frozenChangeset.js";
export class GitRequiredError extends Error {
    code = "GIT_REQUIRED";
    constructor(message = "Agent-batch worktrees need a git repository. Canvas checkpoints, working-copy autosave, Save/Apply, and the path jail still work without git.") {
        super(message);
        this.name = "GitRequiredError";
    }
}
export class BatchError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = "BatchError";
        this.code = code;
    }
}
const BATCH_ID_RE = /^[a-zA-Z0-9_-]+$/;
export function assertBatchId(batchId) {
    if (!BATCH_ID_RE.test(batchId)) {
        throw new BatchError("batchId must match [a-zA-Z0-9_-]+", "INVALID_BATCH_ID");
    }
}
function worktreeRelPath(batchId) {
    return path.join(".designer", "worktrees", batchId);
}
function skipRel(rel) {
    const normalized = rel.replace(/\\/g, "/");
    return (normalized === ".git" ||
        normalized.startsWith(".git/") ||
        normalized === ".designer" ||
        normalized.startsWith(".designer/"));
}
function splitNul(raw) {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    return text.split("\0").filter((part) => part.length > 0);
}
function parseDiffNameStatus(raw) {
    const parts = splitNul(raw);
    const changes = [];
    let i = 0;
    while (i < parts.length) {
        const status = parts[i++];
        if (!status)
            continue;
        const code = status[0];
        if (code === "R" || code === "C") {
            const oldPath = parts[i++] || "";
            const newPath = parts[i++] || "";
            if (oldPath)
                changes.push({ kind: "delete", rel: oldPath.replace(/\\/g, "/") });
            if (newPath)
                changes.push({ kind: "write", rel: newPath.replace(/\\/g, "/") });
        }
        else if (code === "D") {
            const rel = (parts[i++] || "").replace(/\\/g, "/");
            if (rel)
                changes.push({ kind: "delete", rel });
        }
        else {
            const rel = (parts[i++] || "").replace(/\\/g, "/");
            if (rel)
                changes.push({ kind: "write", rel });
        }
    }
    return changes;
}
function parsePorcelainZ(raw) {
    const parts = splitNul(raw);
    const rels = [];
    let i = 0;
    while (i < parts.length) {
        const entry = parts[i++];
        if (entry.length < 3)
            continue;
        const xy0 = entry[0];
        const rel = entry.slice(3).replace(/\\/g, "/");
        if (xy0 === "R" || xy0 === "C") {
            const orig = (parts[i++] || "").replace(/\\/g, "/");
            if (rel)
                rels.push(rel);
            if (orig)
                rels.push(orig);
        }
        else if (rel) {
            rels.push(rel);
        }
    }
    return rels;
}
function workspaceIdOf(projectRoot) {
    return createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 12);
}
export function detectThreeWayConflict(input) {
    if (input.base.kind === "unreadable") {
        return `base blob unreadable (${input.base.code})`;
    }
    if (input.current.kind === "unreadable") {
        return `current file unreadable (${input.current.code})`;
    }
    if (input.kind === "write" && input.candidate.kind === "unreadable") {
        return `candidate unreadable (${input.candidate.code})`;
    }
    if (input.kind === "delete") {
        if (input.current.kind === "absent")
            return null;
        if (input.base.kind === "bytes" &&
            input.current.kind === "bytes" &&
            !input.base.bytes.equals(input.current.bytes)) {
            return "user modified a file the batch deletes";
        }
        return null;
    }
    if (presenceEqual(input.current, input.candidate))
        return null;
    if (input.current.kind === "absent") {
        if (input.base.kind === "bytes") {
            return "user deleted a file the batch modifies";
        }
        return null;
    }
    if (input.base.kind === "absent") {
        return "user created a different file at this path";
    }
    if (input.base.kind === "bytes" &&
        input.current.kind === "bytes" &&
        input.candidate.kind === "bytes" &&
        !input.base.bytes.equals(input.current.bytes) &&
        !input.current.bytes.equals(input.candidate.bytes)) {
        return "user modified this file concurrently";
    }
    return null;
}
export class AgentBatchRegistry {
    batches = [];
    projectRoot;
    filePath;
    workspaceId;
    journal;
    writeChain = Promise.resolve();
    beforeManagedWrite;
    constructor(projectRoot, filePath, workspaceId) {
        this.projectRoot = projectRoot;
        this.filePath = filePath;
        this.workspaceId = workspaceId ?? workspaceIdOf(projectRoot);
        this.journal = new ApplyJournal(projectRoot, this.workspaceId, path.join(path.dirname(filePath), "apply-journal.json"));
    }
    openBatch() {
        return this.batches.find((batch) => batch.status === "open");
    }
    get(batchId) {
        return this.batches.find((batch) => batch.batchId === batchId);
    }
    async load() {
        try {
            const raw = await fs.readFile(this.filePath, "utf-8");
            const data = JSON.parse(raw);
            this.batches = Array.isArray(data.batches) ? data.batches : [];
        }
        catch {
            this.batches = [];
        }
        await this.journal.recover();
    }
    async persist() {
        await atomicWriteJson(this.filePath, { batches: this.batches });
    }
    async create(label) {
        if (this.openBatch()) {
            throw new BatchError("An agent batch is already open", "BATCH_OPEN");
        }
        if (!(await isGitRepo(this.projectRoot))) {
            throw new GitRequiredError();
        }
        const head = await gitHead(this.projectRoot);
        if (!head) {
            throw new GitRequiredError("Agent-batch worktrees need a git commit (HEAD). Canvas checkpoints still work.");
        }
        await assertNoDirtyProject(this.projectRoot);
        const batchId = randomUUID();
        const rel = worktreeRelPath(batchId);
        const abs = resolveProjectPath(this.projectRoot, rel);
        const branch = `opendesigner/batch-${batchId.slice(0, 8)}`;
        await fs.mkdir(path.dirname(abs), { recursive: true });
        try {
            await git(this.projectRoot, ["worktree", "add", "-b", branch, abs, "HEAD"]);
        }
        catch (err) {
            await fs.rm(abs, { recursive: true, force: true }).catch(() => undefined);
            const detail = err instanceof Error ? err.message : String(err);
            throw new BatchError(`Failed to create jailed worktree: ${detail}`, "WORKTREE_CREATE_FAILED");
        }
        const batch = {
            batchId,
            status: "open",
            worktreeRelPath: rel,
            branch,
            baseRef: head,
            createdAt: new Date().toISOString(),
            label,
            isolation: "worktree"
        };
        this.batches.push(batch);
        await this.persist();
        return batch;
    }
    async discard(batchId) {
        const batch = this.requireOpen(batchId);
        await this.removeWorktree(batch);
        batch.status = "discarded";
        await this.persist();
        return batch;
    }
    async captureFrozen(batchId) {
        const batch = this.requireOpen(batchId);
        const worktreeAbs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
        const planned = (await listWorktreeChanges(worktreeAbs, batch.baseRef)).filter((change) => !skipRel(change.rel));
        const ops = [];
        const afterBytes = {};
        for (const change of planned) {
            resolveProjectPath(this.projectRoot, change.rel);
            resolveProjectPath(worktreeAbs, change.rel);
            const mainPath = resolveProjectPath(this.projectRoot, change.rel);
            const wtPath = resolveProjectPath(worktreeAbs, change.rel);
            const current = await readPresence(mainPath);
            const candidate = change.kind === "delete" ? { kind: "absent" } : await readPresence(wtPath);
            if (change.kind === "write" && candidate.kind !== "bytes") {
                throw new BatchError(`Candidate missing for ${change.rel}`, "APPLY_FAILED");
            }
            const op = {
                kind: change.kind,
                rel: change.rel,
                mode: change.kind === "write" ? fileModeOf(wtPath) : fileModeOf(mainPath),
                beforeHash: fingerprintPresence(current),
                afterHash: fingerprintPresence(candidate)
            };
            ops.push(op);
            if (candidate.kind === "bytes")
                afterBytes[change.rel] = Buffer.from(candidate.bytes);
        }
        const frozen = {
            projectId: this.workspaceId,
            worktreeRelPath: batch.worktreeRelPath,
            batchId: batch.batchId,
            baseVersion: batch.baseRef,
            ops,
            afterBytes
        };
        return cloneFrozenChangeset(frozen);
    }
    async prepareApply(batchId) {
        await this.journal.recover();
        this.requireOpen(batchId);
        const frozen = await this.captureFrozen(batchId);
        await this.assertFrozenConflicts(batchId, frozen);
        return frozen;
    }
    async commitPrepared(frozen) {
        return this.enqueueWrite(() => this.commitPreparedInner(frozen));
    }
    async apply(batchId) {
        return this.enqueueWrite(async () => {
            await this.journal.recover();
            this.requireOpen(batchId);
            const frozen = await this.captureFrozen(batchId);
            await this.assertFrozenConflicts(batchId, frozen);
            return await this.commitPreparedInner(frozen);
        });
    }
    enqueueWrite(fn) {
        const run = this.writeChain.then(fn, fn);
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }
    async commitPreparedInner(frozen) {
        const batch = this.requireOpen(frozen.batchId);
        const copied = [];
        const deleted = [];
        const staging = this.journal.stagingDir(batch.batchId);
        await fs.mkdir(staging, { recursive: true });
        const planned = frozen.ops.map((op) => ({
            kind: op.kind,
            rel: op.rel,
            mode: op.mode,
            beforeHash: op.beforeHash,
            afterHash: op.afterHash
        }));
        const entry = await this.journal.begin(batch.batchId, planned);
        try {
            for (const op of frozen.ops) {
                const to = resolveProjectPath(this.projectRoot, op.rel);
                const current = await readPresence(to);
                const nowHash = fingerprintPresence(current);
                if (nowHash !== op.beforeHash) {
                    throw new BatchError(`Refusing apply: ${op.rel} changed after preflight (expected-before mismatch)`, "BATCH_CONFLICT");
                }
                let backupRel = null;
                if (current.kind === "bytes") {
                    backupRel = await this.journal.backupFile(staging, op.rel, to);
                }
                else if (current.kind === "unreadable") {
                    throw new BatchError(`Cannot apply over ${op.rel}: ${current.message}`, "APPLY_FAILED");
                }
                await this.journal.recordBackup(entry, op.rel, backupRel, {
                    beforeHash: op.beforeHash,
                    afterHash: op.afterHash
                });
                if (this.beforeManagedWrite) {
                    await this.beforeManagedWrite(to);
                }
                try {
                    if (op.kind === "delete") {
                        await managedUnlink(to, op.beforeHash);
                        deleted.push(op.rel);
                        continue;
                    }
                    const bytes = frozen.afterBytes[op.rel];
                    if (!bytes) {
                        throw new BatchError(`Frozen candidate missing for ${op.rel}`, "APPLY_FAILED");
                    }
                    const pinnedBytes = Buffer.from(bytes);
                    if (op.afterHash && contentHash(pinnedBytes) !== op.afterHash) {
                        throw new BatchError(`Frozen candidate hash mismatch for ${op.rel}`, "APPLY_FAILED");
                    }
                    await managedReplace(to, op.beforeHash, pinnedBytes);
                    if (typeof op.mode === "number") {
                        await fs.chmod(to, op.mode);
                    }
                    copied.push(op.rel);
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (message.startsWith("BATCH_CONFLICT:")) {
                        throw new BatchError(`Refusing apply: ${op.rel} changed after preflight (expected-before mismatch)`, "BATCH_CONFLICT");
                    }
                    throw err;
                }
            }
        }
        catch (err) {
            try {
                await this.journal.recover();
            }
            catch (recErr) {
                if (err instanceof BatchError && err.code === "BATCH_CONFLICT")
                    throw err;
                throw recErr;
            }
            throw err;
        }
        await this.journal.commit(entry);
        await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        await this.removeWorktree(batch);
        batch.status = "applied";
        await this.persist();
        return { batchId: frozen.batchId, status: batch.status, copied, deleted };
    }
    async assertFrozenConflicts(batchId, frozen) {
        const batch = this.requireOpen(batchId);
        const conflicts = [];
        for (const op of frozen.ops) {
            const mainPath = resolveProjectPath(this.projectRoot, op.rel);
            const current = await readPresence(mainPath);
            const base = await gitShowBytes(this.projectRoot, batch.baseRef, op.rel);
            const candidate = op.kind === "delete"
                ? { kind: "absent" }
                : frozen.afterBytes[op.rel]
                    ? { kind: "bytes", bytes: frozen.afterBytes[op.rel] }
                    : { kind: "absent" };
            const reason = detectThreeWayConflict({
                kind: op.kind,
                base,
                current,
                candidate
            });
            if (reason)
                conflicts.push({ rel: op.rel, reason });
        }
        if (conflicts.length > 0) {
            throw new BatchError(`Refusing apply: ${conflicts.length} conflict(s): ${conflicts.map((c) => `${c.rel} (${c.reason})`).join(", ")}`, "BATCH_CONFLICT");
        }
    }
    async previewDiffs(batchId) {
        const batch = this.requireOpen(batchId);
        const worktreeAbs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
        return (await listWorktreeChanges(worktreeAbs, batch.baseRef)).filter((change) => !skipRel(change.rel));
    }
    worktreeAbs(batch) {
        return resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
    }
    async diffHash(batchId) {
        const frozen = await this.captureFrozen(batchId);
        return hashFrozenChangeset(frozen);
    }
    requireOpen(batchId) {
        assertBatchId(batchId);
        const batch = this.get(batchId);
        if (!batch) {
            throw new BatchError(`Agent batch ${batchId} not found`, "BATCH_NOT_FOUND");
        }
        if (batch.status !== "open") {
            throw new BatchError(`Agent batch ${batchId} is ${batch.status}`, "BATCH_NOT_OPEN");
        }
        return batch;
    }
    async removeWorktree(batch) {
        const abs = resolveProjectPath(this.projectRoot, batch.worktreeRelPath);
        try {
            await git(this.projectRoot, ["worktree", "remove", "--force", abs]);
        }
        catch {
            await fs.rm(abs, { recursive: true, force: true });
            await git(this.projectRoot, ["worktree", "prune"]).catch(() => undefined);
        }
        await git(this.projectRoot, ["branch", "-D", batch.branch]).catch(() => undefined);
    }
}
async function assertNoDirtyProject(cwd) {
    const { stdout } = await git(cwd, ["status", "-z", "--porcelain=v1"]);
    const dirty = parsePorcelainZ(stdout).filter((rel) => !skipRel(rel));
    if (dirty.length > 0) {
        throw new BatchError(`Project has uncommitted changes (${dirty.slice(0, 8).join(", ")}). Commit or stash them before creating an agent batch.`, "DIRTY_WORKTREE");
    }
}
export async function listWorktreeChanges(worktreeAbs, baseRef) {
    const byRel = new Map();
    const { stdout: diffOut } = await git(worktreeAbs, [
        "diff",
        "-z",
        "--name-status",
        "--find-renames",
        baseRef
    ]);
    for (const change of parseDiffNameStatus(diffOut)) {
        byRel.set(`${change.kind}:${change.rel}`, change);
    }
    const { stdout: untracked } = await git(worktreeAbs, ["ls-files", "-z", "--others", "--exclude-standard"]);
    for (const rel of splitNul(untracked)) {
        const normalized = rel.replace(/\\/g, "/");
        if (!normalized || skipRel(normalized))
            continue;
        byRel.set(`write:${normalized}`, { kind: "write", rel: normalized });
    }
    const merged = new Map();
    for (const change of byRel.values()) {
        merged.set(`${change.kind}:${change.rel}`, change);
    }
    return [...merged.values()];
}
//# sourceMappingURL=agentBatch.js.map