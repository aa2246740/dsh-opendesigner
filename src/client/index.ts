/**
 * dsh-opendesigner Web 客户端接入点
 * 遵循 DSH ModuleLoader 与 Web Client Bundle 规范
 * 导出画布 2D 几何引擎、无限视口、选区手柄、智能吸附、样式检查器与沙箱环境
 */

export * from "./geometry.ts";
export * from "./snapping.ts";
export * from "./canvas.ts";
export * from "./selection.ts";
export * from "./snappingOverlay.ts";
export * from "./stylesPanel.ts";
export * from "./sandbox.ts";
export * as NextShims from "./next-shims/index.ts";

import { InfiniteCanvasViewport } from "./canvas.ts";
import { SelectionManager } from "./selection.ts";
import { ComponentSandbox } from "./sandbox.ts";
import { CanvasPanel } from "./canvas/index.ts";
import { FlatStore } from "../store/flatStore.ts";

export interface DesignerClientState {
  viewport: InfiniteCanvasViewport;
  selection: SelectionManager;
  sandbox: ComponentSandbox;
  panel: CanvasPanel;
  selectedElementIds: string[];
  hoveredElementId: string | null;
}

export function initDesignerClient(): DesignerClientState {
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
  const globalAny = window as any;
  if (globalAny.__ModuleLoader__) {
    globalAny.__ModuleLoader__.load({
      id: "dsh-opendesigner",
      factory: () => ({
        name: "dsh-opendesigner",
        version: "0.1.0",
        init: initDesignerClient,
        InfiniteCanvasViewport,
        SelectionManager,
        ComponentSandbox,
        CanvasPanel
      })
    });
  }
}
