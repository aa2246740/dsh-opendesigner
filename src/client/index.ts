/**
 * dsh-opendesigner Web 客户端接入点
 * 遵循 DSH ModuleLoader 与 Web Bundle 规范
 * 导出画布 2D 几何引擎、智能吸附与 next-shims 垫片
 */

export * from "./geometry.ts";
export * from "./snapping.ts";
export * as NextShims from "./next-shims/index.ts";

export interface DesignerClientState {
  zoom: number;
  panX: number;
  panY: number;
  selectedElementIds: string[];
  hoveredElementId: string | null;
}

export function initDesignerClient(): DesignerClientState {
  return {
    zoom: 1.0,
    panX: 0,
    panY: 0,
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
        init: initDesignerClient
      })
    });
  }
}
