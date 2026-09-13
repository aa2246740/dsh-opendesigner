import * as fs from "node:fs/promises";
import { atomicWriteJson } from "./atomicWrite.js";
import { contentHash, readPresence } from "./fileBytes.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function presenceFromBytes(bytes) {
    if (bytes.includes(0)) {
        return { kind: "binary", hash: contentHash(bytes), base64: bytes.toString("base64") };
    }
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
        return { kind: "binary", hash: contentHash(bytes), base64: bytes.toString("base64") };
    }
    return { kind: "text", text };
}
export async function readBaselinePresence(abs) {
    const presence = await readPresence(abs);
    if (presence.kind === "absent")
        return { kind: "absent" };
    if (presence.kind === "unreadable") {
        return { kind: "unreadable", code: presence.code, message: presence.message };
    }
    return presenceFromBytes(presence.bytes);
}
export function bytesFromBaseline(row) {
    if (row.kind === "text")
        return Buffer.from(row.text, "utf8");
    if (row.kind === "binary")
        return Buffer.from(row.base64, "base64");
    return null;
}
export class SourceBaselineStore {
    worktrees = {};
    filePath;
    workspaceId;
    constructor(filePath, workspaceId) {
        this.filePath = filePath;
        this.workspaceId = workspaceId;
    }
    get files() {
        const main = this.worktrees["."] || {};
        const out = {};
        for (const [rel, row] of Object.entries(main)) {
            if (row.kind === "text")
                out[rel] = row.text;
            else if (row.kind === "absent")
                out[rel] = null;
        }
        return out;
    }
    async load() {
        try {
            const data = JSON.parse(await fs.readFile(this.filePath, "utf-8"));
            if (data.workspaceId !== this.workspaceId) {
                this.worktrees = {};
                return;
            }
            if (isRecord(data.worktrees)) {
                this.worktrees = data.worktrees;
                return;
            }
            if (isRecord(data.files)) {
                const migrated = {};
                for (const [rel, value] of Object.entries(data.files)) {
                    if (typeof value === "string")
                        migrated[rel] = { kind: "text", text: value };
                    else if (value === null)
                        migrated[rel] = { kind: "absent" };
                }
                this.worktrees = { ".": migrated };
                return;
            }
            this.worktrees = {};
        }
        catch {
            this.worktrees = {};
        }
    }
    async persist() {
        await atomicWriteJson(this.filePath, {
            workspaceId: this.workspaceId,
            worktrees: this.worktrees
        });
    }
    remember(worktreeKey, rel, presence) {
        const bucket = this.worktrees[worktreeKey] ?? (this.worktrees[worktreeKey] = {});
        if (Object.prototype.hasOwnProperty.call(bucket, rel))
            return;
        bucket[rel] = presence;
    }
    overlay(worktreeKey) {
        return { ...(this.worktrees[worktreeKey] || {}) };
    }
}
//# sourceMappingURL=sourceBaseline.js.map