import { applySurgicalEdits } from "./aiMerge.js";
import { findBestMatchingOpeningElement, updateSourceCodeDeterministically } from "./sourceEdit.js";
import { dropTailwindCategory, mergeTailwindTokens } from "./tailwindMerge.js";
import { parse } from "@babel/parser";
import { createHash } from "node:crypto";
export class SourcePatchError extends Error {
    code;
    ruleMode;
    constructor(message, code, extras) {
        super(message);
        this.name = "SourcePatchError";
        this.code = code;
        this.ruleMode = extras?.ruleMode;
    }
}
export function hashSource(content) {
    return createHash("sha256").update(content).digest("hex");
}
function mentionsShadow(raw, lower) {
    return /shadow/.test(lower) || /阴影/.test(raw);
}
function isRemoval(raw, lower) {
    return /不要|别改|禁止|去掉|删除|取消|移除|without|\bremove\b|\bdon't\b|\bdo not\b|\bno\b/.test(lower) || /不要/.test(raw);
}
function isNegatedDropShadow(raw, lower) {
    return (/不要(去掉|删除|移除|取消)阴影/.test(raw) ||
        /别(去掉|删除|移除)阴影/.test(raw) ||
        /don'?t\s+(?:remove|drop|delete)\s+(?:the\s+)?shadow/.test(lower) ||
        /do\s+not\s+(?:remove|drop|delete)\s+(?:the\s+)?shadow/.test(lower) ||
        /keep\s+(?:the\s+)?shadow/.test(lower));
}
function isExplicitDropShadow(raw, lower) {
    return (/只?(去掉|删除|移除|取消)阴影/.test(raw) ||
        /(?:only\s+)?(?:remove|drop|delete)\s+(?:the\s+)?shadow/.test(lower));
}
export function parseIntent(instruction) {
    const raw = instruction.trim();
    if (!raw)
        return { kind: "unsupported", reason: "empty intent" };
    const lower = raw.toLowerCase();
    const removal = isRemoval(raw, lower);
    const shadow = mentionsShadow(raw, lower);
    const addShadow = (/加(上)?阴影/.test(raw) || /add(?:ing)?\s+shadow/.test(lower) || /\bshadow-lg\b/.test(lower)) && !removal;
    if (isNegatedDropShadow(raw, lower)) {
        return {
            kind: "unsupported",
            reason: "Negation/multi-constraint intent refused. Declaring rule mode refuse; className stays as-is.",
            ruleMode: "refuse"
        };
    }
    if (isExplicitDropShadow(raw, lower)) {
        return { kind: "dropCategory", category: "shadow" };
    }
    if (shadow && removal) {
        return {
            kind: "unsupported",
            reason: "Ambiguous shadow intent. Refusing to invert it. Current className stays as-is.",
            ruleMode: "refuse"
        };
    }
    if (shadow && !addShadow) {
        return {
            kind: "unsupported",
            reason: "Ambiguous shadow intent. Refusing to invert it. Current className stays as-is.",
            ruleMode: "refuse"
        };
    }
    if (addShadow)
        return { kind: "merge", tokens: "shadow-lg" };
    if (/翠绿/.test(raw) || /emerald/.test(lower))
        return { kind: "merge", tokens: "bg-emerald-600" };
    if (/玫红/.test(raw) || /\brose\b/.test(lower))
        return { kind: "merge", tokens: "bg-rose-600" };
    if (/\bindigo\b/.test(lower))
        return { kind: "merge", tokens: "bg-indigo-600" };
    if (/rounded|圆角/.test(lower) || /圆角/.test(raw))
        return { kind: "merge", tokens: "rounded-xl" };
    return {
        kind: "unsupported",
        reason: "Unsupported intent. Refusing a silent full-page rewrite. Current className stays as-is."
    };
}
export function intentToClassTokens(instruction) {
    const parsed = parseIntent(instruction);
    return parsed.kind === "merge" ? parsed.tokens : null;
}
function occurrenceCount(haystack, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let from = 0;
    while (from <= haystack.length) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return count;
        count += 1;
        from = idx + Math.max(needle.length, 1);
    }
    return count;
}
export function sliceEdits(before, after) {
    if (before === after)
        return [];
    let start = 0;
    const maxStart = Math.min(before.length, after.length);
    while (start < maxStart && before.charCodeAt(start) === after.charCodeAt(start))
        start += 1;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start &&
        endAfter > start &&
        before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
        endBefore -= 1;
        endAfter -= 1;
    }
    let left = start;
    let rightOld = endBefore;
    let rightNew = endAfter;
    let oldString = before.slice(left, rightOld);
    let newString = after.slice(left, rightNew);
    const unique = (chunk) => chunk.length > 0 && occurrenceCount(before, chunk) === 1;
    while (!unique(oldString)) {
        if (left === 0 && rightOld === before.length) {
            return [{ old_string: before, new_string: after }];
        }
        if (left > 0) {
            left -= 1;
        }
        else if (rightOld < before.length) {
            rightOld += 1;
            rightNew += 1;
        }
        else {
            return [{ old_string: before, new_string: after }];
        }
        oldString = before.slice(left, rightOld);
        newString = after.slice(left, rightNew);
    }
    return [{ old_string: oldString, new_string: newString }];
}
export function unifiedDiff(rel, before, after) {
    const a = before.split("\n");
    const b = after.split("\n");
    const lines = [`--- a/${rel}`, `+++ b/${rel}`];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i += 1) {
        if (a[i] === b[i])
            continue;
        if (a[i] !== undefined)
            lines.push(`-${a[i]}`);
        if (b[i] !== undefined)
            lines.push(`+${b[i]}`);
    }
    return lines.join("\n");
}
export function classNamePatch(input) {
    const result = updateSourceCodeDeterministically({
        sourceCode: input.sourceCode,
        targetLine: input.line,
        targetColumn: input.column,
        newClassName: input.newClassName,
        setClassName: true
    });
    if (!result.ok || !result.code)
        return { ok: false, reason: result.reason || "unsupported-edit" };
    return { ok: true, code: result.code };
}
export function applyBoundEdits(source, edits) {
    const applied = applySurgicalEdits(source, edits);
    if (!applied.success || applied.result === undefined) {
        return { ok: false, reason: applied.error || "apply-failed" };
    }
    return { ok: true, code: applied.result };
}
export function extractClassNameAt(code, line, column) {
    let ast;
    try {
        ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
    }
    catch {
        return null;
    }
    const opening = findBestMatchingOpeningElement(ast, line, column);
    if (!opening)
        return null;
    const attr = (opening.attributes || []).find((item) => item.type === "JSXAttribute" && item.name?.name === "className");
    if (!attr?.value || attr.value.type !== "StringLiteral")
        return null;
    return typeof attr.value.value === "string" ? attr.value.value : null;
}
export function extractClassName(code, loc) {
    if (loc)
        return extractClassNameAt(code, loc.line, loc.column);
    return extractClassNameAt(code, 1, 0);
}
export function looksLikeFakeButtonWrapper(source, merged) {
    const trimmed = merged.trim();
    if (trimmed.startsWith("<button") && !source.trim().startsWith("<button"))
        return true;
    if (source.includes("export default") && !merged.includes("export default") && trimmed.startsWith("<")) {
        return true;
    }
    return false;
}
export function applyIntentToClassName(beforeClassName, intent) {
    if (intent.kind === "merge")
        return mergeTailwindTokens(beforeClassName, intent.tokens);
    if (intent.kind === "dropCategory")
        return dropTailwindCategory(beforeClassName, intent.category);
    return null;
}
//# sourceMappingURL=sourcePatch.js.map