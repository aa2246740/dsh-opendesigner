import { type BaselinePresence } from "./sourceBaseline.ts";
export type OverlayFile = BaselinePresence;
export type SourceOverlay = {
    workspaceId: string;
    worktreeKey: string;
    files: Record<string, OverlayFile>;
};
export type LegacySourceOverlay = Record<string, string | null>;
export type RestorePlanStep = {
    rel: string;
    abs: string;
    bytes: Buffer | null;
};
export declare function isV2Overlay(value: unknown): value is SourceOverlay;
export declare function migrateOverlay(raw: unknown): SourceOverlay | null;
export declare function overlayRoot(projectRoot: string, worktreeKey: string): string;
export declare function captureOverlayFiles(srcDir: string, relPaths: Iterable<string>): Promise<Record<string, OverlayFile>>;
export declare function materializeOverlayEntry(srcDir: string, rel: string, entry: OverlayFile): RestorePlanStep;
export declare function materializeRestorePlan(srcDir: string, overlay: SourceOverlay): RestorePlanStep[];
export declare function applyRestorePlan(plan: RestorePlanStep[]): Promise<void>;
export declare function bytesFromOverlay(entry: OverlayFile): Buffer | null;
//# sourceMappingURL=sourceOverlay.d.ts.map