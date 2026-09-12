import type { CanvasRect, FlatStore } from "../store/flatStore.ts";
import * as NextShims from "./next-shims/index.ts";
export interface SandboxRenderOptions {
    activePath?: string;
    theme?: "light" | "dark";
    customStyles?: string;
    onError?: (err: Error) => void;
}
export interface RenderedNode {
    tag: string;
    props: Record<string, unknown>;
    children: (RenderedNode | string)[];
}
export declare const SANDBOX_CSP = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src 'self' data: https:; script-src 'none'; connect-src 'none'; object-src 'none'";
export declare const CANVAS_TRUSTED_CSS: string;
export declare function collectTrustedCanvasCss(doc?: Document): string;
export declare function wrapSandboxSrcdoc(inner: string, options?: {
    css?: string;
}): string;
export declare function sandboxIframeMarkup(inner: string, options?: {
    css?: string;
}): string;
export declare class ComponentSandbox {
    private activePath;
    nextShims: typeof NextShims;
    constructor(options?: SandboxRenderOptions);
    setPath(path: string): void;
    getShims(): typeof NextShims;
    renderElement(store: FlatStore, elementId: string, parentRect?: CanvasRect): RenderedNode | string;
    private applyCanvasRectStyle;
    renderToHtml(store: FlatStore, rootId: string): string;
    private nodeToHtmlString;
    private escapeHtml;
    private renderErrorFallback;
}
//# sourceMappingURL=sandbox.d.ts.map