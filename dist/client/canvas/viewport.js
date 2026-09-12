/**
 * 2D 仿射变换与无限视口管理引擎 (Infinite Canvas Viewport)
 * 依据 docs/05 规约：
 * 依托 DOMMatrix 仿射变换矩阵，实现屏幕物理坐标与世界画布坐标的无损双向映射
 * 支持光标锚点缩放、触控板双指捏合缩放、滚轮平移与双击重置
 */
import { CanvasAffineMatrix, screenToWorld, worldToScreen } from "../geometry.js";
export class InfiniteCanvasViewport {
    state;
    constructor(initialState = {}) {
        this.state = {
            zoom: initialState.zoom ?? 1.0,
            panX: initialState.panX ?? 0,
            panY: initialState.panY ?? 0,
            minZoom: initialState.minZoom ?? 0.1,
            maxZoom: initialState.maxZoom ?? 5.0
        };
    }
    getState() {
        return { ...this.state };
    }
    getZoom() {
        return this.state.zoom;
    }
    getPan() {
        return { x: this.state.panX, y: this.state.panY };
    }
    /**
     * 平移视口
     */
    pan(dx, dy) {
        this.state.panX += dx;
        this.state.panY += dy;
    }
    /**
     * 设置绝对平移量
     */
    setPan(panX, panY) {
        this.state.panX = panX;
        this.state.panY = panY;
    }
    /**
     * 缩放视口（以特定屏幕点为基准点等比放大/缩小，保持鼠标指向的世界坐标不动）
     */
    zoomAt(screenPoint, zoomDelta) {
        const prevZoom = this.state.zoom;
        const nextZoom = Math.min(this.state.maxZoom, Math.max(this.state.minZoom, prevZoom * zoomDelta));
        if (nextZoom === prevZoom)
            return;
        // 保持鼠标光标所在世界坐标位置在缩放后屏幕位置不动
        const worldP = screenToWorld(screenPoint, prevZoom, this.state.panX, this.state.panY);
        this.state.zoom = nextZoom;
        this.state.panX = screenPoint.x - worldP.x * nextZoom;
        this.state.panY = screenPoint.y - worldP.y * nextZoom;
    }
    /**
     * 双击重置画布视口（恢复 1.0 倍率与原点对齐）
     */
    reset(defaultZoom = 1.0, panX = 0, panY = 0) {
        this.state.zoom = defaultZoom;
        this.state.panX = panX;
        this.state.panY = panY;
    }
    /**
     * 处理鼠标滚轮与触控板手势事件
     * - 按住 Ctrl/Meta 键（或触控板捏合）时：以光标为中心缩放
     * - 普通滚动：平移画布
     */
    handleWheel(event) {
        const isPinchOrZoom = event.ctrlKey || event.metaKey;
        if (isPinchOrZoom) {
            // 缩放灵敏度
            const zoomFactor = Math.exp(-event.deltaY * 0.005);
            this.zoomAt({ x: event.clientX, y: event.clientY }, zoomFactor);
        }
        else {
            // 触控板/鼠标滚轮平移
            this.pan(-event.deltaX, -event.deltaY);
        }
    }
    /**
     * 获取当前仿射变换矩阵
     */
    getMatrix() {
        return new CanvasAffineMatrix(this.state.zoom, this.state.panX, this.state.panY);
    }
    /**
     * 输出标准的 CSS transform 样式字符串
     * 格式: matrix(s, 0, 0, s, tx, ty)
     */
    getCssTransform() {
        return `matrix(${this.state.zoom}, 0, 0, ${this.state.zoom}, ${this.state.panX}, ${this.state.panY})`;
    }
    /**
     * 屏幕坐标转世界画布坐标
     */
    toWorld(screenPoint) {
        return screenToWorld(screenPoint, this.state.zoom, this.state.panX, this.state.panY);
    }
    /**
     * 世界画布坐标转屏幕视口坐标
     */
    toScreen(worldPoint) {
        return worldToScreen(worldPoint, this.state.zoom, this.state.panX, this.state.panY);
    }
    /**
     * 将屏幕矩形转为世界矩形
     */
    screenRectToWorld(screenRect) {
        const topLeft = this.toWorld({ x: screenRect.left, y: screenRect.top });
        return {
            left: topLeft.x,
            top: topLeft.y,
            width: screenRect.width / this.state.zoom,
            height: screenRect.height / this.state.zoom
        };
    }
    /**
     * 将世界矩形转为屏幕矩形
     */
    worldRectToScreen(worldRect) {
        const topLeft = this.toScreen({ x: worldRect.left, y: worldRect.top });
        return {
            left: topLeft.x,
            top: topLeft.y,
            width: worldRect.width * this.state.zoom,
            height: worldRect.height * this.state.zoom
        };
    }
}
//# sourceMappingURL=viewport.js.map