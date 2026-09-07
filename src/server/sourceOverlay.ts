import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveProjectPath } from "./pathJail.ts";
import { bytesFromBaseline, readBaselinePresence, type BaselinePresence } from "./sourceBaseline.ts";
import { contentHash, writeFileNoFollow } from "./fileBytes.ts";

export type OverlayFile = BaselinePresence;

export type SourceOverlay = {
  workspaceId: string;
  worktreeKey: string;
  files: Record<string, OverlayFile>;
};

export type LegacySourceOverlay = Record<string, string | null>;

export type RestorePlanStep = { rel: string; abs: string; bytes: Buffer | null };

export function isV2Overlay(value: unknown): value is SourceOverlay {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SourceOverlay).workspaceId === "string" &&
    typeof (value as SourceOverlay).worktreeKey === "string" &&
    !!(value as SourceOverlay).files &&
    typeof (value as SourceOverlay).files === "object" &&
    !Array.isArray((value as SourceOverlay).files)
  );
}

export function migrateOverlay(raw: unknown): SourceOverlay | null {
  if (!raw) return null;
  if (isV2Overlay(raw)) return raw;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const files: Record<string, OverlayFile> = {};
  for (const [rel, value] of Object.entries(raw as LegacySourceOverlay)) {
    if (value === null) files[rel] = { kind: "absent" };
    else if (typeof value === "string") files[rel] = { kind: "text", text: value };
  }
  return { workspaceId: "", worktreeKey: "", files };
}

export function overlayRoot(projectRoot: string, worktreeKey: string): string {
  const key = worktreeKey && worktreeKey.length > 0 ? worktreeKey : ".";
  return resolveProjectPath(projectRoot, key);
}

export async function captureOverlayFiles(
  srcDir: string,
  relPaths: Iterable<string>
): Promise<Record<string, OverlayFile>> {
  const files: Record<string, OverlayFile> = {};
  for (const rel of relPaths) {
    const abs = resolveProjectPath(srcDir, rel);
    files[rel] = await readBaselinePresence(abs);
  }
  return files;
}

export function materializeOverlayEntry(
  srcDir: string,
  rel: string,
  entry: OverlayFile
): RestorePlanStep {
  const abs = resolveProjectPath(srcDir, rel);
  if (entry.kind === "absent") return { rel, abs, bytes: null };
  if (entry.kind === "unreadable") {
    const error = new Error(`CHECKPOINT_UNREADABLE:${rel}:${entry.message}`);
    (error as Error & { code: string }).code = "CHECKPOINT_UNREADABLE";
    throw error;
  }
  if (entry.kind === "binary") {
    const bytes = Buffer.from(entry.base64, "base64");
    if (contentHash(bytes) !== entry.hash) {
      const error = new Error(`CHECKPOINT_HASH_MISMATCH:${rel}`);
      (error as Error & { code: string }).code = "CHECKPOINT_HASH_MISMATCH";
      throw error;
    }
    return { rel, abs, bytes };
  }
  return { rel, abs, bytes: Buffer.from(entry.text, "utf8") };
}

export function materializeRestorePlan(srcDir: string, overlay: SourceOverlay): RestorePlanStep[] {
  return Object.entries(overlay.files).map(([rel, entry]) => materializeOverlayEntry(srcDir, rel, entry));
}

export async function applyRestorePlan(plan: RestorePlanStep[]): Promise<void> {
  for (const step of plan) {
    if (step.bytes === null) {
      await fs.rm(step.abs, { force: true });
      continue;
    }
    await fs.mkdir(path.dirname(step.abs), { recursive: true });
    await writeFileNoFollow(step.abs, step.bytes);
  }
}

export function bytesFromOverlay(entry: OverlayFile): Buffer | null {
  return bytesFromBaseline(entry);
}
