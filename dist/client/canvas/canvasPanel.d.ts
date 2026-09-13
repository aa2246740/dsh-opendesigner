/**
 * Web Client 视觉交互视口组件与面板 (CanvasPanel)
 * 依据 docs/05 与 docs/08 规约：
 * 打通 2D 仿射变换、手柄缩放与 6 线吸附，集成 FlatStore 与 ComponentSandbox
 */
import { FlatStore } from "../../store/flatStore.ts";
import type { FEElement } from "../../store/flatStore.ts";
import type { Point, Rect } from "../geometry.ts";
import type { SnapGuide } from "../snapping.ts";
import { SelectionManager } from "../selection.ts";
import { ComponentSandbox } from "../sandbox.ts";
import { StylesPanelManager } from "../stylesPanel.ts";
import { InfiniteCanvasViewport } from "./viewport.ts";
import { SelectionOverlayRenderer } from "./overlay.ts";
import { CanvasInteractionController } from "./interaction.ts";
export interface CanvasPanelOptions {
    initialZoom?: number;
    initialPan?: Point;
    snapThreshold?: number;
    handleSize?: number;
    store?: FlatStore;
}
export declare class CanvasPanel {
    viewport: InfiniteCanvasViewport;
    selection: SelectionManager;
    controller: CanvasInteractionController;
    overlay: SelectionOverlayRenderer;
    sandbox: ComponentSandbox;
    stylesPanel: StylesPanelManager;
    store: FlatStore;
    snapThreshold: number;
    private elementRects;
    constructor(options?: CanvasPanelOptions);
    /**
     * 同步或注册图元世界几何矩形
     */
    registerElement(id: string, rect: Rect, element?: FEElement): void;
    /**
     * 移除指定图元
     */
    unregisterElement(id: string): void;
    clearRegisteredRects(): void;
    /**
     * 同步所有元素矩形至 SelectionManager
     */
    private syncSelectionManager;
    /**
     * 获取除了已选中元素之外的所有候选对齐矩形
     */
    getAlignmentCandidates(): Rect[];
    /**
     * 选中图元
     */
    select(ids: string[]): void;
    /**
     * 获取当前选区合并包围盒
     */
    getSelectedBoundingBox(): Rect | null;
    getElementRect(id: string): Rect | undefined;
    getAllElementRects(): Map<string, Rect>;
    /**
     * Hit-test world point against registered rects. Prefers the smallest containing box
     * so nested children win over their parent.
     */
    hitTest(worldPoint: Point): string | null;
    hitTestIntersecting(worldRect: Rect): string[];
    updateMarquee(screenPoint: Point, additive: boolean, baseIds: string[]): string[];
    private persistRect;
    /**
     * When a parent box moves or its origin shifts, keep descendant world rects in sync
     * so nested DOM children and hit-testing stay aligned.
     */
    private translateUnselectedDescendants;
    /**
     * 执行拖拽移动 (打通 6 线智能吸附)
     */
    moveSelected(screenPoint: Point): {
        newBox: Rect;
        updatedElements: {
            id: string;
            rect: Rect;
        }[];
        guides: SnapGuide[];
        snapped: boolean;
    } | null;
    /**
     * 执行 8 向手柄缩放 (打通伴随几何与 6 线吸附)
     */
    resizeSelected(screenPoint: Point): {
        newBox: Rect;
        updatedElements: {
            id: string;
            rect: Rect;
        }[];
        guides: SnapGuide[];
        snapped: boolean;
    } | null;
    /**
     * 渲染完整画布 HTML/SVG 标记
     */
    renderHtml(): string;
}
//# sourceMappingURL=canvasPanel.d.ts.map