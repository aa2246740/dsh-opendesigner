/**
 * Bind existing CanvasPanel pointer / wheel / keyboard APIs onto the preview DOM.
 * Does not invent a second interaction engine — it only exposes controller + overlay.
 */
import type { CanvasPanel } from "./canvas/canvasPanel.ts";
import type { FlatStore } from "../store/flatStore.ts";
export interface PreviewCanvasUxHooks {
    onCommit: (label: string) => void;
    onFullRender: () => void;
    onHud: () => void;
}
export declare function applyRectsToDom(canvasEl: HTMLElement, panel: CanvasPanel, store: FlatStore): void;
export declare function refreshOverlay(canvasEl: HTMLElement, panel: CanvasPanel): void;
export declare function bindFloatingTooltips(root: HTMLElement): () => void;
export declare function bindPreviewCanvasUx(canvasEl: HTMLElement, panel: CanvasPanel, store: FlatStore, hooks: PreviewCanvasUxHooks): () => void;
//# sourceMappingURL=previewCanvasUx.d.ts.map