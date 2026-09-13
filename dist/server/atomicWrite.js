import * as fs from "node:fs/promises";
import * as path from "node:path";
export async function atomicWriteFile(filePath, contents) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmpPath, contents);
    await fs.rename(tmpPath, filePath);
}
export async function atomicWriteJson(filePath, value) {
    await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
//# sourceMappingURL=atomicWrite.js.map