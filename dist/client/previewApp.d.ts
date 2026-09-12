import { CanvasPanel } from "./canvas/index.ts";
export interface PreviewApi {
    getStatus?: () => Promise<Record<string, unknown>>;
    getCanvas?: () => Promise<Record<string, unknown>>;
    pushCanvas?: (store: Record<string, unknown>) => Promise<{
        success?: boolean;
        version?: number;
        error?: string;
    }>;
    callTool?: (tool: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    applyAiMerge?: (source: string, instruction: string) => Promise<{
        success: boolean;
        mergedCode?: string;
        error?: string;
        model?: string;
        fallback?: boolean;
        liveError?: string;
        mockMode?: boolean;
        provider?: string;
        attemptsLog?: Array<{
            provider: string;
            model: string;
            label?: string;
            ok?: boolean;
            httpStatus?: number;
            error?: string;
        }>;
    }>;
}
export interface ChangeSetProposal {
    id: string;
    instruction: string;
    elementId: string;
    filePath: string;
    sourceHash: string;
    baseRevision: number;
    beforeClassName: string;
    afterClassName: string;
    preview: string;
    mergedCode: string;
    afterHash?: string;
}
export declare function autosaveClearsDirty(httpOk: boolean, result: {
    success?: boolean;
    localEditId?: number;
    ackRevision?: number;
} | undefined, expected?: {
    localEditId?: number;
    ackRevision?: number;
}): boolean;
export declare function mountPreview(root: HTMLElement, api?: PreviewApi): CanvasPanel;
//# sourceMappingURL=previewApp.d.ts.map