import * as fs from "node:fs/promises";
import * as path from "node:path";
export class RuntimeBusyError extends Error {
    code = "RUNTIME_BUSY";
    constructor(message = "Another OpenDesigner runtime already holds this project.") {
        super(message);
        this.name = "RuntimeBusyError";
    }
}
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export class RuntimeLock {
    filePath;
    held = false;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async acquire() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        try {
            await this.createExclusive();
            this.held = true;
            return;
        }
        catch (err) {
            if (err.code !== "EEXIST")
                throw err;
        }
        const existing = await this.readPayload();
        if (existing && pidAlive(existing.pid)) {
            throw new RuntimeBusyError(`Project already has a writer (pid ${existing.pid}). Stop that runtime before starting another.`);
        }
        await fs.rm(this.filePath, { force: true });
        await this.createExclusive();
        this.held = true;
    }
    async release() {
        if (!this.held)
            return;
        this.held = false;
        await fs.rm(this.filePath, { force: true });
    }
    async createExclusive() {
        const handle = await fs.open(this.filePath, "wx");
        try {
            const payload = { pid: process.pid, acquiredAt: new Date().toISOString() };
            await handle.writeFile(`${JSON.stringify(payload)}\n`);
        }
        finally {
            await handle.close();
        }
    }
    async readPayload() {
        try {
            const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
            if (typeof raw.pid !== "number")
                return null;
            return raw;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=runtimeLock.js.map