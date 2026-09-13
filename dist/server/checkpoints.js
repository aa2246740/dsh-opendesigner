import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomicWrite.js";
import { migrateOverlay } from "./sourceOverlay.js";
export const MAX_CHECKPOINTS = 50;
function cloneSnapshot(value) {
    return structuredClone(value);
}
function nothingToRewind() {
    const error = new Error("Nothing to rewind");
    error.code = "NOTHING_TO_REWIND";
    return error;
}
function checkpointNotFound(id) {
    const error = new Error(`Checkpoint ${id} not found`);
    error.code = "CHECKPOINT_NOT_FOUND";
    return error;
}
export class CheckpointLog {
    entries = [];
    cursor = -1;
    filePath;
    maxEntries;
    constructor(filePath, maxEntries = MAX_CHECKPOINTS) {
        this.filePath = filePath;
        this.maxEntries = maxEntries;
    }
    current() {
        if (this.cursor < 0 || this.cursor >= this.entries.length)
            return undefined;
        return this.entries[this.cursor];
    }
    list() {
        return this.entries.map(({ id, createdAt, label, kind }) => ({
            id,
            createdAt,
            label,
            kind
        }));
    }
    async load() {
        try {
            const raw = await fs.readFile(this.filePath, "utf-8");
            const data = JSON.parse(raw);
            const entries = Array.isArray(data.entries) ? cloneSnapshot(data.entries) : [];
            this.entries = entries.map((entry) => {
                const overlay = migrateOverlay(entry.sourceFiles);
                return overlay ? { ...entry, sourceFiles: overlay } : { ...entry, sourceFiles: undefined };
            });
            this.cursor = Number.isInteger(data.cursor) ? data.cursor : this.entries.length - 1;
            if (this.cursor >= this.entries.length)
                this.cursor = this.entries.length - 1;
        }
        catch {
            this.entries = [];
            this.cursor = -1;
        }
    }
    async persist() {
        await atomicWriteJson(this.filePath, {
            entries: this.entries,
            cursor: this.cursor
        });
    }
    async push(input) {
        if (this.cursor >= 0 && this.cursor < this.entries.length - 1) {
            this.entries = this.entries.slice(0, this.cursor + 1);
        }
        const overlay = migrateOverlay(input.sourceFiles) ?? input.sourceFiles;
        const checkpoint = {
            id: `cp_${randomUUID()}`,
            createdAt: new Date().toISOString(),
            label: input.label,
            kind: input.kind,
            store: cloneSnapshot(input.store),
            sourceFiles: overlay ? cloneSnapshot(overlay) : undefined
        };
        this.entries.push(checkpoint);
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(this.entries.length - this.maxEntries);
        }
        this.cursor = this.entries.length - 1;
        await this.persist();
        return checkpoint;
    }
    planRewind() {
        if (this.cursor <= 0)
            throw nothingToRewind();
        const index = this.cursor - 1;
        return {
            index,
            truncate: false,
            checkpoint: cloneSnapshot(this.entries[index])
        };
    }
    planRewindTo(id) {
        const index = this.entries.findIndex((entry) => entry.id === id);
        if (index < 0)
            throw checkpointNotFound(id);
        return {
            index,
            truncate: true,
            checkpoint: cloneSnapshot(this.entries[index])
        };
    }
    async commitRewind(plan) {
        this.cursor = plan.index;
        if (plan.truncate) {
            this.entries = this.entries.slice(0, plan.index + 1);
        }
        await this.persist();
        return cloneSnapshot(this.entries[this.cursor]);
    }
    async rewind() {
        const plan = this.planRewind();
        return await this.commitRewind(plan);
    }
    async rewindTo(id) {
        const plan = this.planRewindTo(id);
        return await this.commitRewind(plan);
    }
}
//# sourceMappingURL=checkpoints.js.map