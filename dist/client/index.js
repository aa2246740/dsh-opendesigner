/**
 * dsh-opendesigner Web 客户端接入点
 * 遵循 DSH ModuleLoader 与 Web Client Bundle 规范
 * 导出画布 2D 几何引擎、无限视口、选区手柄、智能吸附、样式检查器与沙箱环境
 */
export * from "./geometry.js";
export * from "./snapping.js";
export * from "./canvas.js";
export * from "./selection.js";
export * from "./snappingOverlay.js";
export * from "./stylesPanel.js";
export * from "./sandbox.js";
export * as NextShims from "./next-shims/index.js";
import { CanvasInteractionController, CanvasPanel, InfiniteCanvasViewport, SelectionOverlayRenderer } from "./canvas/index.js";
import { SelectionManager } from "./selection.js";
import { ComponentSandbox } from "./sandbox.js";
import { worldToScreen } from "./geometry.js";
import { FlatStore } from "../store/flatStore.js";
export function initDesignerClient() {
    const store = new FlatStore();
    const panel = new CanvasPanel({ store });
    const viewport = panel.viewport;
    const selection = panel.selection;
    const sandbox = panel.sandbox;
    return {
        viewport,
        selection,
        sandbox,
        panel,
        selectedElementIds: [],
        hoveredElementId: null
    };
}
// 供 DSH ModuleLoader 动态挂载
if (typeof window !== "undefined") {
    const globalAny = window;
    if (globalAny.__ModuleLoader__) {
        globalAny.__ModuleLoader__.load({
            id: "dsh-opendesigner",
            factory: () => ({
                name: "dsh-opendesigner",
                version: "0.1.0",
                init: initDesignerClient,
                initDesignerClient,
                InfiniteCanvasViewport,
                SelectionManager,
                ComponentSandbox,
                CanvasPanel,
                CanvasInteractionController,
                SelectionOverlayRenderer,
                worldToScreen
            })
        });
    }
}
//# sourceMappingURL=index.js.map