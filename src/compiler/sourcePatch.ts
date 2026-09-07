import { createHash } from "node:crypto";
import { applySurgicalEdits, type CodePatchEdit } from "./aiMerge.ts";
import { updateSourceCodeDeterministically } from "./sourceEdit.ts";

export interface SourcePatchProposal {
  id: string;
  instruction: string;
  elementId: string;
  filePath: string;
  sourceHash: string;
  baseRevision: number;
  beforeClassName: string;
  afterClassName: string;
  edits: CodePatchEdit[];
  preview: string;
  mergedCode: string;
}

export class SourcePatchError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SourcePatchError";
    this.code = code;
  }
}

export function hashSource(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function intentToClassTokens(instruction: string): string | null {
  const raw = instruction.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (/翠绿|emerald/.test(raw) || lower.includes("emerald")) return "bg-emerald-600";
  if (/玫红|rose/.test(lower)) return "bg-rose-600";
  if (/indigo/.test(lower)) return "bg-indigo-600";
  if (/shadow/.test(lower) || /阴影/.test(raw)) return "shadow-lg";
  if (/rounded|圆角/.test(lower) || /圆角/.test(raw)) return "rounded-xl";
  return null;
}

export function sliceEdits(before: string, after: string): CodePatchEdit[] {
  if (before === after) return [];
  let start = 0;
  const maxStart = Math.min(before.length, after.length);
  while (start < maxStart && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  let oldString = before.slice(start, endBefore);
  let newString = after.slice(start, endAfter);
  if (!oldString) {
    const ctxStart = Math.max(0, start - 24);
    oldString = before.slice(ctxStart, start + Math.min(24, before.length - start));
    newString = after.slice(ctxStart, endAfter + (before.length - endBefore));
  }
  return [{ old_string: oldString, new_string: newString }];
}

export function unifiedDiff(rel: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lines = [`--- a/${rel}`, `+++ b/${rel}`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`-${a[i]}`);
    if (b[i] !== undefined) lines.push(`+${b[i]}`);
  }
  return lines.join("\n");
}

export function classNamePatch(input: {
  sourceCode: string;
  line: number;
  column: number;
  newClassName: string;
}): { ok: true; code: string } | { ok: false; reason: string } {
  const result = updateSourceCodeDeterministically({
    sourceCode: input.sourceCode,
    targetLine: input.line,
    targetColumn: input.column,
    newClassName: input.newClassName
  });
  if (!result.ok || !result.code) return { ok: false, reason: result.reason || "unsupported-edit" };
  return { ok: true, code: result.code };
}

export function applyBoundEdits(source: string, edits: CodePatchEdit[]): { ok: true; code: string } | { ok: false; reason: string } {
  const applied = applySurgicalEdits(source, edits);
  if (!applied.success || applied.result === undefined) {
    return { ok: false, reason: applied.error || "apply-failed" };
  }
  return { ok: true, code: applied.result };
}

export function extractClassName(code: string): string | null {
  const match = code.match(/className="([^"]*)"/);
  return match ? match[1] : null;
}

export function looksLikeFakeButtonWrapper(source: string, merged: string): boolean {
  const trimmed = merged.trim();
  if (trimmed.startsWith("<button") && !source.trim().startsWith("<button")) return true;
  if (source.includes("export default") && !merged.includes("export default") && trimmed.startsWith("<")) {
    return true;
  }
  return false;
}
