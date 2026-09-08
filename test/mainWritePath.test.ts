import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { OpenDesignerService } from "../src/server/index.ts";
import { git } from "../src/server/gitExec.ts";

async function tmp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("MAIN-06 acceptSourcePatch while batch open", () => {
  it("refuses main-root accept and leaves the source file unchanged", async () => {
    const dir = await tmp("main06-accept-");
    await git(dir, ["init", "-b", "main"]);
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    const source = `export default function App() {\n  return <button className="px-4 bg-indigo-600">Pay now</button>;\n}\n`;
    await fs.writeFile(path.join(dir, "src/App.tsx"), source);
    await git(dir, ["add", "."]);
    await git(dir, ["-c", "user.name=Review", "-c", "user.email=review@local", "commit", "-m", "base"]);

    const service = new OpenDesignerService({ projectRoot: dir, autoApprove: true });
    await service.init();
    const button = Object.values(service.store.toJSON().byId).find((el) => el.tag === "button");
    assert.ok(button);
    const proposed = await service.executeTool("propose_source_patch", {
      elementId: button!.id,
      instruction: "把按钮改成翠绿",
      live: false
    });
    assert.equal(proposed.success, true);

    const created = await service.executeTool("batch_create", { label: "main06" });
    assert.equal(created.success, true);

    const accepted = await service.executeTool("accept_source_patch", {
      proposalId: proposed.proposal.id
    });
    assert.equal(accepted.success, false);
    assert.equal(accepted.code, "SOURCE_PATCH_MAIN_ROOT_LOCKED");
    assert.equal(await fs.readFile(path.join(dir, "src/App.tsx"), "utf8"), source);

    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
