/**
 * 画布交互状态机与事件控制器 (Canvas Interaction Controller)
 * 依据 docs/05 规约：
 * 管理平移 (Pan)、单选/多选、图元拖拽对齐 (6-Line Snap Move)、8 向手柄等比缩放 (Companion Resize)
 */
import { rectFromPoints } from "../geometry.js";
export class CanvasInteractionController {
    mode = "idle";
    viewport;
    selection;
    dragSession = null;
    currentGuides = [];
    marqueeRect = null;
    // 事件回调列表
    onGuidesChangeCallbacks = [];
    onModeChangeCallbacks = [];
    constructor(viewport, selection) {
        this.viewport = viewport;
        this.selection = selection;
    }
    getMode() {
        return this.mode;
    }
    getGuides() {
        return [...this.currentGuides];
    }
    onGuidesChange(cb) {
        this.onGuidesChangeCallbacks.push(cb);
        return () => {
            this.onGuidesChangeCallbacks = this.onGuidesChangeCallbacks.filter((c) => c !== cb);
        };
    }
    onModeChange(cb) {
        this.onModeChangeCallbacks.push(cb);
        return () => {
            this.onModeChangeCallbacks = this.onModeChangeCallbacks.filter((c) => c !== cb);
        };
    }
    setMode(nextMode) {
        if (this.mode === nextMode)
            return;
        this.mode = nextMode;
        for (const cb of this.onModeChangeCallbacks) {
            cb(nextMode);
        }
    }
    emitGuides(guides) {
        this.currentGuides = guides;
        for (const cb of this.onGuidesChangeCallbacks) {
            cb(guides);
        }
    }
    getMarqueeRect() {
        return this.marqueeRect ? { ...this.marqueeRect } : null;
    }
    /**
     * Empty-canvas rubber-band. World-space rect is used for intersection hit-testing.
     */
    startBoxSelect(screenPoint) {
        const worldP = this.viewport.toWorld(screenPoint);
        this.setMode("box-selecting");
        this.dragSession = {
            startScreenPoint: { ...screenPoint },
            startWorldPoint: worldP,
            initialBox: { left: worldP.x, top: worldP.y, width: 0, height: 0 }
        };
        this.marqueeRect = { left: worldP.x, top: worldP.y, width: 0, height: 0 };
    }
    updateBoxSelect(screenPoint) {
        if (this.mode !== "box-selecting" || !this.dragSession)
            return null;
        const currentWorld = this.viewport.toWorld(screenPoint);
        this.marqueeRect = rectFromPoints(this.dragSession.startWorldPoint, currentWorld);
        return { ...this.marqueeRect };
    }
    endBoxSelect() {
        if (this.mode !== "box-selecting")
            return null;
        const rect = this.marqueeRect ? { ...this.marqueeRect } : null;
        this.marqueeRect = null;
        this.dragSession = null;
        this.setMode("idle");
        return rect;
    }
    /**
     * 启动画布平移
     */
    startPan(screenPoint) {
        this.setMode("panning");
        this.dragSession = {
            startScreenPoint: { ...screenPoint },
            startWorldPoint: this.viewport.toWorld(screenPoint),
            initialBox: { left: 0, top: 0, width: 0, height: 0 }
        };
    }
    /**
     * 更新画布平移
     */
    updatePan(screenPoint) {
        if (this.mode !== "panning" || !this.dragSession)
            return;
        const dx = screenPoint.x - this.dragSession.startScreenPoint.x;
        const dy = screenPoint.y - this.dragSession.startScreenPoint.y;
        this.viewport.pan(dx, dy);
        this.dragSession.startScreenPoint = { ...screenPoint };
    }
    /**
     * 结束画布平移
     */
    endPan() {
        if (this.mode === "panning") {
            this.dragSession = null;
            this.setMode("idle");
        }
    }
    /**
     * 启动选区拖拽移动
     */
    startDrag(screenPoint) {
        const box = this.selection.getBoundingBox();
        if (!box)
            return false;
        const worldP = this.viewport.toWorld(screenPoint);
        this.dragSession = {
            startScreenPoint: { ...screenPoint },
            startWorldPoint: worldP,
            initialBox: { ...box }
        };
        this.setMode("dragging");
        return true;
    }
    /**
     * 更新选区拖拽移动 (联动 6 线智能吸附)
     */
    updateDrag(screenPoint, options = {}) {
        if (this.mode !== "dragging" || !this.dragSession)
            return null;
        const currentWorld = this.viewport.toWorld(screenPoint);
        const totalDx = currentWorld.x - this.dragSession.startWorldPoint.x;
        const totalDy = currentWorld.y - this.dragSession.startWorldPoint.y;
        // 以 initialBox 为基准，重新从起点开始移动以防止累计误差
        const currentBox = this.selection.getBoundingBox();
        if (!currentBox)
            return null;
        const targetLeft = this.dragSession.initialBox.left + totalDx;
        const targetTop = this.dragSession.initialBox.top + totalDy;
        const stepDx = targetLeft - currentBox.left;
        const stepDy = targetTop - currentBox.top;
        const moveRes = this.selection.moveSelection(stepDx, stepDy, options);
        if (!moveRes)
            return null;
        this.emitGuides(moveRes.guides);
        return {
            newBox: moveRes.newBox,
            updatedElements: moveRes.updatedElements,
            guides: moveRes.guides,
            snapped: moveRes.snapped
        };
    }
    /**
     * 结束选区拖拽移动
     */
    endDrag() {
        if (this.mode === "dragging") {
            this.dragSession = null;
            this.emitGuides([]);
            this.setMode("idle");
        }
    }
    /**
     * 启动 8 向控制手柄缩放
     */
    startResize(handle, screenPoint) {
        const worldP = this.viewport.toWorld(screenPoint);
        const ok = this.selection.startResize(handle, worldP);
        if (ok) {
            this.setMode("resizing");
        }
        return ok;
    }
    /**
     * 更新 8 向控制手柄缩放 (伴随几何 + 6 线吸附)
     */
    updateResize(screenPoint, options = {}) {
        if (this.mode !== "resizing")
            return null;
        const currentWorld = this.viewport.toWorld(screenPoint);
        const resizeRes = this.selection.updateResize(currentWorld, options);
        if (!resizeRes)
            return null;
        this.emitGuides(resizeRes.guides);
        return {
            newBox: resizeRes.newBox,
            updatedElements: resizeRes.updatedElements,
            guides: resizeRes.guides,
            snapped: resizeRes.snapped
        };
    }
    /**
     * 结束控制手柄缩放
     */
    endResize() {
        if (this.mode === "resizing") {
            this.selection.endResize();
            this.emitGuides([]);
            this.setMode("idle");
        }
    }
}
//# sourceMappingURL=interaction.js.map