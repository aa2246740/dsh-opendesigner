import { type CodePatchEdit } from "./aiMerge.ts";
export interface SourcePatchProposal {
    id: string;
    instruction: string;
    elementId: string;
    filePath: string;
    sourceHash: string;
    afterHash: string;
    baseRevision: number;
    beforeClassName: string;
    afterClassName: string;
    edits: CodePatchEdit[];
    preview: string;
    mergedCode: string;
}
export declare class SourcePatchError extends Error {
    readonly code: string;
    readonly ruleMode?: string;
    constructor(message: string, code: string, extras?: {
        ruleMode?: string;
    });
}
export declare function hashSource(content: string | Buffer): string;
export type ParsedIntent = {
    kind: "merge";
    tokens: string;
} | {
    kind: "dropCategory";
    category: string;
} | {
    kind: "unsupported";
    reason: string;
    ruleMode?: "refuse";
};
export declare function parseIntent(instruction: string): ParsedIntent;
export declare function intentToClassTokens(instruction: string): string | null;
export declare function sliceEdits(before: string, after: string): CodePatchEdit[];
export declare function unifiedDiff(rel: string, before: string, after: string): string;
export declare function classNamePatch(input: {
    sourceCode: string;
    line: number;
    column: number;
    newClassName: string;
}): {
    ok: true;
    code: string;
} | {
    ok: false;
    reason: string;
};
export declare function applyBoundEdits(source: string, edits: CodePatchEdit[]): {
    ok: true;
    code: string;
} | {
    ok: false;
    reason: string;
};
export declare function extractClassNameAt(code: string, line: number, column: number): string | null;
export declare function extractClassName(code: string, loc?: {
    line: number;
    column: number;
}): string | null;
export declare function looksLikeFakeButtonWrapper(source: string, merged: string): boolean;
export declare function applyIntentToClassName(beforeClassName: string, intent: ParsedIntent): string | null;
export type { CodePatchEdit };
//# sourceMappingURL=sourcePatch.d.ts.map