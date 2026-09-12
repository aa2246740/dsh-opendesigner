/**
 * 画布交互状态机与事件控制器 (Canvas Interaction Controller)
 * 依据 docs/05 规约：
 * 管理平移 (Pan)、单选/多选、图元拖拽对齐 (6-Line Snap Move)、8 向手柄等比缩放 (Companion Resize)
 */
import type { Point, Rect, ResizeHandle } from "../geometry.ts";
import type { SnapGuide } from "../snapping.ts";
import { SelectionManager } from "../selection.ts";
import { InfiniteCanvasViewport } from "./viewport.ts";
export type InteractionMode = "idle" | "panning" | "dragging" | "resizing" | "box-selecting";
export interface DragSession {
    startScreenPoint: Point;
    startWorldPoint: Point;
    initialBox: Rect;
}
export declare class CanvasInteractionController {
    private mode;
    private viewport;
    private selection;
    private dragSession;
    private currentGuides;
    private marqueeRect;
    private onGuidesChangeCallbacks;
    private onModeChangeCallbacks;
    constructor(viewport: InfiniteCanvasViewport, selection: SelectionManager);
    getMode(): InteractionMode;
    getGuides(): SnapGuide[];
    onGuidesChange(cb: (guides: SnapGuide[]) => void): () => void;
    onModeChange(cb: (mode: InteractionMode) => void): () => void;
    private setMode;
    private emitGuides;
    getMarqueeRect(): Rect | null;
    /**
     * Empty-canvas rubber-band. World-space rect is used for intersection hit-testing.
     */
    startBoxSelect(screenPoint: Point): void;
    updateBoxSelect(screenPoint: Point): Rect | null;
    endBoxSelect(): Rect | null;
    /**
     * 启动画布平移
     */
    startPan(screenPoint: Point): void;
    /**
     * 更新画布平移
     */
    updatePan(screenPoint: Point): void;
    /**
     * 结束画布平移
     */
    endPan(): void;
    /**
     * 启动选区拖拽移动
     */
    startDrag(screenPoint: Point): boolean;
    /**
     * 更新选区拖拽移动 (联动 6 线智能吸附)
     */
    updateDrag(screenPoint: Point, options?: {
        candidates?: Rect[];
        snapThreshold?: number;
        enableSnapping?: boolean;
    }): {
        newBox: Rect;
        updatedElements: {
            id: string;
            rect: Rect;
        }[];
        guides: SnapGuide[];
        snapped: boolean;
    } | null;
    /**
     * 结束选区拖拽移动
     */
    endDrag(): void;
    /**
     * 启动 8 向控制手柄缩放
     */
    startResize(handle: ResizeHandle, screenPoint: Point): boolean;
    /**
     * 更新 8 向控制手柄缩放 (伴随几何 + 6 线吸附)
     */
    updateResize(screenPoint: Point, options?: {
        candidates?: Rect[];
        snapThreshold?: number;
        enableSnapping?: boolean;
    }): {
        newBox: Rect;
        updatedElements: {
            id: string;
            rect: Rect;
        }[];
        guides: SnapGuide[];
        snapped: boolean;
    } | null;
    /**
     * 结束控制手柄缩放
     */
    endResize(): void;
}
//# sourceMappingURL=interaction.d.ts.map