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

export interface DesignerClientState {
  viewport: InfiniteCanvasViewport;
  selection: SelectionManager;
  sandbox: ComponentSandbox;
  selectedElementIds: string[];
  hoveredElementId: string | null;
}

export function initDesignerClient(): DesignerClientState {
  const viewport = new InfiniteCanvasViewport();
  const selection = new SelectionManager();
  const sandbox = new ComponentSandbox();

  return {
    viewport,
    selection,
    sandbox,
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
        ComponentSandbox
      })
    });
  }
}
