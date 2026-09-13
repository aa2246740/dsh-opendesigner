import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveProjectPath } from "./pathJail.js";
import { bytesFromBaseline, readBaselinePresence } from "./sourceBaseline.js";
import { contentHash, writeFileNoFollow } from "./fileBytes.js";
export function isV2Overlay(value) {
    return (!!value &&
        typeof value === "object" &&
        typeof value.workspaceId === "string" &&
        typeof value.worktreeKey === "string" &&
        !!value.files &&
        typeof value.files === "object" &&
        !Array.isArray(value.files));
}
export function migrateOverlay(raw) {
    if (!raw)
        return null;
    if (isV2Overlay(raw))
        return raw;
    if (typeof raw !== "object" || Array.isArray(raw))
        return null;
    const files = {};
    for (const [rel, value] of Object.entries(raw)) {
        if (value === null)
            files[rel] = { kind: "absent" };
        else if (typeof value === "string")
            files[rel] = { kind: "text", text: value };
    }
    return { workspaceId: "", worktreeKey: "", files };
}
export function overlayRoot(projectRoot, worktreeKey) {
    const key = worktreeKey && worktreeKey.length > 0 ? worktreeKey : ".";
    return resolveProjectPath(projectRoot, key);
}
export async function captureOverlayFiles(srcDir, relPaths) {
    const files = {};
    for (const rel of relPaths) {
        const abs = resolveProjectPath(srcDir, rel);
        files[rel] = await readBaselinePresence(abs);
    }
    return files;
}
export function materializeOverlayEntry(srcDir, rel, entry) {
    const abs = resolveProjectPath(srcDir, rel);
    if (entry.kind === "absent")
        return { rel, abs, bytes: null };
    if (entry.kind === "unreadable") {
        const error = new Error(`CHECKPOINT_UNREADABLE:${rel}:${entry.message}`);
        error.code = "CHECKPOINT_UNREADABLE";
        throw error;
    }
    if (entry.kind === "binary") {
        const bytes = Buffer.from(entry.base64, "base64");
        if (contentHash(bytes) !== entry.hash) {
            const error = new Error(`CHECKPOINT_HASH_MISMATCH:${rel}`);
            error.code = "CHECKPOINT_HASH_MISMATCH";
            throw error;
        }
        return { rel, abs, bytes };
    }
    return { rel, abs, bytes: Buffer.from(entry.text, "utf8") };
}
export function materializeRestorePlan(srcDir, overlay) {
    return Object.entries(overlay.files).map(([rel, entry]) => materializeOverlayEntry(srcDir, rel, entry));
}
export async function applyRestorePlan(plan) {
    for (const step of plan) {
        if (step.bytes === null) {
            await fs.rm(step.abs, { force: true });
            continue;
        }
        await fs.mkdir(path.dirname(step.abs), { recursive: true });
        await writeFileNoFollow(step.abs, step.bytes);
    }
}
export function bytesFromOverlay(entry) {
    return bytesFromBaseline(entry);
}
//# sourceMappingURL=sourceOverlay.js.map