"use strict";
var OpenDesignerPreview = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/previewApp.ts
  var previewApp_exports = {};
  __export(previewApp_exports, {
    autosaveClearsDirty: () => autosaveClearsDirty,
    mountPreview: () => mountPreview
  });

  // src/client/geometry.ts
  var MIN_ELEMENT_SIZE = 8;
  function rectFromPoints(a, b) {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    return {
      left,
      top,
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y)
    };
  }
  function rectsIntersect(a, b) {
    return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
  }
  function worldToScreen(worldPoint, zoom, panX, panY) {
    return {
      x: worldPoint.x * zoom + panX,
      y: worldPoint.y * zoom + panY
    };
  }
  function screenToWorld(screenPoint, zoom, panX, panY) {
    if (zoom === 0) throw new Error("Zoom factor cannot be zero");
    return {
      x: (screenPoint.x - panX) / zoom,
      y: (screenPoint.y - panY) / zoom
    };
  }
  var CanvasAffineMatrix = class {
    a;
    // scaleX
    b;
    // skewY
    c;
    // skewX
    d;
    // scaleY
    e;
    // translateX
    f;
    // translateY
    constructor(zoom = 1, panX = 0, panY = 0) {
      this.a = zoom;
      this.b = 0;
      this.c = 0;
      this.d = zoom;
      this.e = panX;
      this.f = panY;
    }
    transformPoint(p) {
      return {
        x: this.a * p.x + this.c * p.y + this.e,
        y: this.b * p.x + this.d * p.y + this.f
      };
    }
    inverseTransformPoint(p) {
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) throw new Error("Singular matrix cannot be inverted");
      return {
        x: (this.d * (p.x - this.e) - this.c * (p.y - this.f)) / det,
        y: (this.a * (p.y - this.f) - this.b * (p.x - this.e)) / det
      };
    }
  };
  function companionGeometry(start, handle, deltaWidth, deltaHeight) {
    const width = Math.max(MIN_ELEMENT_SIZE, start.width + deltaWidth);
    const height = Math.max(MIN_ELEMENT_SIZE, start.height + deltaHeight);
    return {
      width,
      height,
      // 西侧（左侧）拉伸时，反向位移补偿以固定右边缘
      left: handle.includes("w") ? start.left - (width - start.width) : start.left,
      // 北侧（顶侧）拉伸时，反向位移补偿以固定底边缘
      top: handle.includes("n") ? start.top - (height - start.height) : start.top
    };
  }
  function computeBoundingBox(rects) {
    if (rects.length === 0) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;
    for (const r of rects) {
      minLeft = Math.min(minLeft, r.left);
      minTop = Math.min(minTop, r.top);
      maxRight = Math.max(maxRight, r.left + r.width);
      maxBottom = Math.max(maxBottom, r.top + r.height);
    }
    return {
      left: minLeft,
      top: minTop,
      width: Math.max(0, maxRight - minLeft),
      height: Math.max(0, maxBottom - minTop)
    };
  }
  function multiResize(elements, groupStartBox, handle, deltaWidth, deltaHeight) {
    if (groupStartBox.width === 0 || groupStartBox.height === 0) {
      return elements;
    }
    const newGroupBox = companionGeometry(groupStartBox, handle, deltaWidth, deltaHeight);
    const scaleX = newGroupBox.width / groupStartBox.width;
    const scaleY = newGroupBox.height / groupStartBox.height;
    return elements.map(({ id, rect }) => {
      const relLeft = (rect.left - groupStartBox.left) / groupStartBox.width;
      const relTop = (rect.top - groupStartBox.top) / groupStartBox.height;
      const relWidth = rect.width / groupStartBox.width;
      const relHeight = rect.height / groupStartBox.height;
      return {
        id,
        rect: {
          left: newGroupBox.left + relLeft * newGroupBox.width,
          top: newGroupBox.top + relTop * newGroupBox.height,
          width: Math.max(MIN_ELEMENT_SIZE, relWidth * newGroupBox.width),
          height: Math.max(MIN_ELEMENT_SIZE, relHeight * newGroupBox.height)
        }
      };
    });
  }

  // src/client/canvas/viewport.ts
  var InfiniteCanvasViewport = class {
    state;
    constructor(initialState = {}) {
      this.state = {
        zoom: initialState.zoom ?? 1,
        panX: initialState.panX ?? 0,
        panY: initialState.panY ?? 0,
        minZoom: initialState.minZoom ?? 0.1,
        maxZoom: initialState.maxZoom ?? 5
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
      const nextZoom = Math.min(
        this.state.maxZoom,
        Math.max(this.state.minZoom, prevZoom * zoomDelta)
      );
      if (nextZoom === prevZoom) return;
      const worldP = screenToWorld(screenPoint, prevZoom, this.state.panX, this.state.panY);
      this.state.zoom = nextZoom;
      this.state.panX = screenPoint.x - worldP.x * nextZoom;
      this.state.panY = screenPoint.y - worldP.y * nextZoom;
    }
    /**
     * 双击重置画布视口（恢复 1.0 倍率与原点对齐）
     */
    reset(defaultZoom = 1, panX = 0, panY = 0) {
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
        const zoomFactor = Math.exp(-event.deltaY * 5e-3);
        this.zoomAt({ x: event.clientX, y: event.clientY }, zoomFactor);
      } else {
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
  };

  // src/client/canvas/overlay.ts
  var SelectionOverlayRenderer = class {
    strokeColor;
    guideColor;
    handleSize;
    constructor(options = {}) {
      this.strokeColor = options.strokeColor || "#3b82f6";
      this.guideColor = options.guideColor || "#ef4444";
      this.handleSize = options.handleSize || 8;
    }
    /**
     * 生成 8 向控制手柄的绝对几何坐标
     */
    computeHandles(box) {
      const { left, top, width, height } = box;
      const midX = left + width / 2;
      const midY = top + height / 2;
      const right = left + width;
      const bottom = top + height;
      return [
        { handle: "nw", point: { x: left, y: top }, cursor: "nwse-resize" },
        { handle: "n", point: { x: midX, y: top }, cursor: "ns-resize" },
        { handle: "ne", point: { x: right, y: top }, cursor: "nesw-resize" },
        { handle: "e", point: { x: right, y: midY }, cursor: "ew-resize" },
        { handle: "se", point: { x: right, y: bottom }, cursor: "nwse-resize" },
        { handle: "s", point: { x: midX, y: bottom }, cursor: "ns-resize" },
        { handle: "sw", point: { x: left, y: bottom }, cursor: "nesw-resize" },
        { handle: "w", point: { x: left, y: midY }, cursor: "ew-resize" }
      ];
    }
    /**
     * 生成包含选区框、8向手柄与吸附导引线的完整 SVG 标记
     */
    renderSvgOverlay(box, guides = [], options = {}) {
      const svgWidth = options.width || 2e3;
      const svgHeight = options.height || 2e3;
      const parts = [
        `<svg class="canvas-selection-overlay" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="position:absolute;top:0;left:0;pointer-events:none;z-index:50;" xmlns="http://www.w3.org/2000/svg">`
      ];
      for (const guide of guides) {
        if (guide.orientation === "vertical") {
          parts.push(
            `<line x1="${guide.coordinate}" y1="${guide.start}" x2="${guide.coordinate}" y2="${guide.end}" stroke="${this.guideColor}" stroke-width="1" stroke-dasharray="3 3" />`
          );
          parts.push(
            `<circle cx="${guide.coordinate}" cy="${(guide.start + guide.end) / 2}" r="2" fill="${this.guideColor}" />`
          );
        } else {
          parts.push(
            `<line x1="${guide.start}" y1="${guide.coordinate}" x2="${guide.end}" y2="${guide.coordinate}" stroke="${this.guideColor}" stroke-width="1" stroke-dasharray="3 3" />`
          );
          parts.push(
            `<circle cx="${(guide.start + guide.end) / 2}" cy="${guide.coordinate}" r="2" fill="${this.guideColor}" />`
          );
        }
      }
      const HANDLE_TOOLTIPS = {
        nw: "Resize top-left",
        n: "Resize top",
        ne: "Resize top-right",
        e: "Resize right",
        se: "Resize bottom-right",
        s: "Resize bottom",
        sw: "Resize bottom-left",
        w: "Resize left"
      };
      if (box) {
        parts.push(
          `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="${this.strokeColor}" stroke-width="1.5" />`
        );
        const half = this.handleSize / 2;
        const handles = this.computeHandles(box);
        for (const h of handles) {
          const tip = HANDLE_TOOLTIPS[h.handle] || `Resize ${h.handle}`;
          parts.push(
            `<g class="resize-handle-group" data-handle="${h.handle}" data-testid="overlay-handle-${h.handle}" data-tooltip="${tip}" style="pointer-events:auto;cursor:${h.cursor};">
            <title>${tip}</title>
            <rect class="resize-handle handle-${h.handle}" x="${h.point.x - half}" y="${h.point.y - half}" width="${this.handleSize}" height="${this.handleSize}" fill="#ffffff" stroke="${this.strokeColor}" stroke-width="1.5" />
          </g>`
          );
        }
      }
      const marquee = options.marquee;
      if (marquee && (marquee.width > 1 || marquee.height > 1)) {
        parts.push(
          `<rect class="marquee-band" data-testid="marquee-band" x="${marquee.left}" y="${marquee.top}" width="${marquee.width}" height="${marquee.height}" fill="rgba(96,165,250,0.16)" stroke="#60a5fa" stroke-width="1" stroke-dasharray="4 3" />`
        );
      }
      parts.push(`</svg>`);
      return parts.join("\n");
    }
  };

  // src/client/canvas/interaction.ts
  var CanvasInteractionController = class {
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
      if (this.mode === nextMode) return;
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
      if (this.mode !== "box-selecting" || !this.dragSession) return null;
      const currentWorld = this.viewport.toWorld(screenPoint);
      this.marqueeRect = rectFromPoints(this.dragSession.startWorldPoint, currentWorld);
      return { ...this.marqueeRect };
    }
    endBoxSelect() {
      if (this.mode !== "box-selecting") return null;
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
      if (this.mode !== "panning" || !this.dragSession) return;
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
      if (!box) return false;
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
      if (this.mode !== "dragging" || !this.dragSession) return null;
      const currentWorld = this.viewport.toWorld(screenPoint);
      const totalDx = currentWorld.x - this.dragSession.startWorldPoint.x;
      const totalDy = currentWorld.y - this.dragSession.startWorldPoint.y;
      const currentBox = this.selection.getBoundingBox();
      if (!currentBox) return null;
      const targetLeft = this.dragSession.initialBox.left + totalDx;
      const targetTop = this.dragSession.initialBox.top + totalDy;
      const stepDx = targetLeft - currentBox.left;
      const stepDy = targetTop - currentBox.top;
      const moveRes = this.selection.moveSelection(stepDx, stepDy, options);
      if (!moveRes) return null;
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
      if (this.mode !== "resizing") return null;
      const currentWorld = this.viewport.toWorld(screenPoint);
      const resizeRes = this.selection.updateResize(currentWorld, options);
      if (!resizeRes) return null;
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
  };

  // src/store/flatStore.ts
  function createId() {
    return crypto.randomUUID();
  }
  var GraphError = class extends Error {
    code = "GRAPH_INVALID";
    constructor(message) {
      super(message);
      this.name = "GraphError";
    }
  };
  function emptyState() {
    return {
      byId: /* @__PURE__ */ new Map(),
      childrenByParent: /* @__PURE__ */ new Map(),
      parentByChild: /* @__PURE__ */ new Map(),
      pages: [],
      activePageId: ""
    };
  }
  function assertValidGraph(data) {
    const byId = data.byId || {};
    const childrenByParent = data.childrenByParent || {};
    const parentByChild = data.parentByChild || {};
    const pages = data.pages || [];
    for (const [parentId, children] of Object.entries(childrenByParent)) {
      if (!byId[parentId]) {
        throw new GraphError(`Missing parent node ${parentId}`);
      }
      if (!Array.isArray(children)) {
        throw new GraphError(`childrenByParent.${parentId} must be an array`);
      }
      const seen = /* @__PURE__ */ new Set();
      for (const childId of children) {
        if (!byId[childId]) {
          throw new GraphError(`Missing child node ${childId} under ${parentId}`);
        }
        if (seen.has(childId)) {
          throw new GraphError(`Duplicate child ${childId} under ${parentId}`);
        }
        seen.add(childId);
        if (parentByChild[childId] !== parentId) {
          throw new GraphError(`parent/child maps disagree for ${childId}`);
        }
      }
    }
    const claimedParent = /* @__PURE__ */ new Map();
    for (const [parentId, children] of Object.entries(childrenByParent)) {
      for (const childId of children) {
        const previous = claimedParent.get(childId);
        if (previous && previous !== parentId) {
          throw new GraphError(`child ${childId} has multiple parents`);
        }
        claimedParent.set(childId, parentId);
      }
    }
    for (const [childId, parentId] of Object.entries(parentByChild)) {
      if (!byId[childId]) {
        throw new GraphError(`parentByChild references missing child ${childId}`);
      }
      if (!byId[parentId]) {
        throw new GraphError(`parentByChild references missing parent ${parentId}`);
      }
      const siblings = childrenByParent[parentId];
      if (!Array.isArray(siblings) || !siblings.includes(childId)) {
        throw new GraphError(`parent/child maps disagree for ${childId}`);
      }
    }
    const visiting = /* @__PURE__ */ new Set();
    const visited = /* @__PURE__ */ new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new GraphError(`Cycle detected at ${id}`);
      }
      visiting.add(id);
      for (const childId of childrenByParent[id] || []) {
        visit(childId);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of Object.keys(byId)) {
      visit(id);
    }
    for (const page of pages) {
      if (!page || typeof page.rootElementId !== "string" || !byId[page.rootElementId]) {
        throw new GraphError(`Dangling page root ${page?.rootElementId ?? "(missing)"}`);
      }
    }
    if (data.activePageId) {
      if (!pages.some((page) => page.id === data.activePageId)) {
        throw new GraphError(`active page ${data.activePageId} is not in pages`);
      }
    }
  }
  var FlatStore = class {
    state;
    constructor() {
      this.state = emptyState();
    }
    setElement(el) {
      this.state.byId.set(el.id, el);
    }
    getElement(id) {
      return this.state.byId.get(id);
    }
    getParent(id) {
      const parentId = this.state.parentByChild.get(id);
      return parentId ? this.state.byId.get(parentId) : void 0;
    }
    getChildren(id) {
      const childIds = this.state.childrenByParent.get(id) ?? [];
      return childIds.map((cid) => this.state.byId.get(cid)).filter(Boolean);
    }
    attachChild(parentId, childId, index) {
      if (!this.state.byId.has(parentId)) {
        throw new GraphError(`Parent not found: ${parentId}`);
      }
      if (!this.state.byId.has(childId)) {
        throw new GraphError(`Child not found: ${childId}`);
      }
      if (parentId === childId) {
        throw new Error(`Cannot attach element to itself: ${parentId}`);
      }
      if (this.isDescendant(childId, parentId)) {
        throw new Error(`Cycle detected: cannot attach ancestor ${childId} as child of descendant ${parentId}`);
      }
      const currentParentId = this.state.parentByChild.get(childId);
      if (currentParentId) {
        const oldSiblings = this.state.childrenByParent.get(currentParentId) ?? [];
        this.state.childrenByParent.set(
          currentParentId,
          oldSiblings.filter((sId) => sId !== childId)
        );
      }
      const siblings = this.state.childrenByParent.get(parentId) ?? [];
      if (index !== void 0 && index >= 0 && index <= siblings.length) {
        siblings.splice(index, 0, childId);
      } else {
        siblings.push(childId);
      }
      this.state.childrenByParent.set(parentId, siblings);
      this.state.parentByChild.set(childId, parentId);
    }
    isDescendant(ancestorId, targetId) {
      if (ancestorId === targetId) return true;
      let current = targetId;
      const visited = /* @__PURE__ */ new Set();
      while (current) {
        if (visited.has(current)) break;
        visited.add(current);
        const parentId = this.state.parentByChild.get(current);
        if (!parentId) break;
        if (parentId === ancestorId) return true;
        current = parentId;
      }
      return false;
    }
    moveElement(elementId, newParentId, index) {
      if (!this.state.byId.has(elementId)) {
        throw new Error(`Element not found: ${elementId}`);
      }
      if (!this.state.byId.has(newParentId)) {
        throw new Error(`Target parent element not found: ${newParentId}`);
      }
      if (elementId === newParentId) {
        throw new Error(`Cycle detected: cannot move element ${elementId} into itself`);
      }
      if (this.isDescendant(elementId, newParentId)) {
        throw new Error(`Cycle detected: cannot move element ${elementId} into its own descendant ${newParentId}`);
      }
      this.attachChild(newParentId, elementId, index);
      return true;
    }
    cloneSubtree(rootId, idGenerator = () => createId()) {
      const originalSubtree = this.getSubtree(rootId);
      if (originalSubtree.length === 0) {
        throw new Error(`Subtree root element not found: ${rootId}`);
      }
      const idMap = /* @__PURE__ */ new Map();
      for (const el of originalSubtree) {
        idMap.set(el.id, idGenerator(el.id));
      }
      const clonedElements = [];
      for (const el of originalSubtree) {
        const newId = idMap.get(el.id);
        const cloned = {
          ...el,
          id: newId,
          props: structuredClone(el.props),
          canvasRect: el.canvasRect ? { ...el.canvasRect } : void 0,
          sourceLocation: el.sourceLocation ? { ...el.sourceLocation } : void 0
        };
        this.state.byId.set(newId, cloned);
        clonedElements.push(cloned);
      }
      for (const el of originalSubtree) {
        const newId = idMap.get(el.id);
        const originalChildren = this.state.childrenByParent.get(el.id) ?? [];
        const newChildren = [];
        for (const childId of originalChildren) {
          const newChildId = idMap.get(childId);
          if (newChildId) {
            newChildren.push(newChildId);
            this.state.parentByChild.set(newChildId, newId);
          }
        }
        this.state.childrenByParent.set(newId, newChildren);
      }
      return {
        rootId: idMap.get(rootId),
        clonedElements
      };
    }
    removeElement(id) {
      const parentId = this.state.parentByChild.get(id);
      if (parentId) {
        const siblings = this.state.childrenByParent.get(parentId);
        if (siblings) {
          this.state.childrenByParent.set(
            parentId,
            siblings.filter((sId) => sId !== id)
          );
        }
        this.state.parentByChild.delete(id);
      }
      const children = [...this.state.childrenByParent.get(id) ?? []];
      for (const childId of children) {
        this.removeElement(childId);
      }
      this.state.childrenByParent.delete(id);
      this.state.byId.delete(id);
      this.dropPagesForMissingRoots();
    }
    dropPagesForMissingRoots() {
      const remaining = this.state.pages.filter((page) => this.state.byId.has(page.rootElementId));
      this.state.pages = remaining;
      if (!remaining.some((page) => page.id === this.state.activePageId)) {
        this.state.activePageId = remaining[0]?.id ?? "";
      }
    }
    getSubtree(rootId) {
      const result = [];
      const queue = [rootId];
      const visited = /* @__PURE__ */ new Set();
      while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) {
          throw new GraphError(`Cycle detected at ${currentId}`);
        }
        visited.add(currentId);
        const el = this.state.byId.get(currentId);
        if (!el) continue;
        result.push(el);
        const children = this.state.childrenByParent.get(currentId) ?? [];
        queue.push(...children);
      }
      return result;
    }
    getRootIds() {
      const rootIds = [];
      for (const id of this.state.byId.keys()) {
        if (!this.state.parentByChild.has(id)) {
          rootIds.push(id);
        }
      }
      return rootIds;
    }
    addPage(page) {
      if (!this.state.byId.has(page.rootElementId)) {
        throw new GraphError(`Dangling page root ${page.rootElementId}`);
      }
      this.state.pages.push({ ...page });
      if (!this.state.activePageId) {
        this.state.activePageId = page.id;
      }
    }
    getPages() {
      return this.state.pages.map((page) => ({ ...page }));
    }
    setActivePage(pageId) {
      if (!this.state.pages.some((page) => page.id === pageId)) {
        throw new GraphError(`active page ${pageId} is not in pages`);
      }
      this.state.activePageId = pageId;
    }
    getActivePageId() {
      return this.state.activePageId;
    }
    toJSON() {
      return structuredClone({
        byId: Object.fromEntries(this.state.byId),
        childrenByParent: Object.fromEntries(this.state.childrenByParent),
        parentByChild: Object.fromEntries(this.state.parentByChild),
        pages: this.state.pages,
        activePageId: this.state.activePageId
      });
    }
    fromJSON(data) {
      const cloned = structuredClone(data ?? {});
      if (!cloned.byId) cloned.byId = {};
      if (!cloned.childrenByParent) cloned.childrenByParent = {};
      if (!cloned.parentByChild) cloned.parentByChild = {};
      if (!cloned.pages) cloned.pages = [];
      assertValidGraph(cloned);
      this.state.byId = new Map(Object.entries(cloned.byId));
      this.state.childrenByParent = new Map(Object.entries(cloned.childrenByParent));
      this.state.parentByChild = new Map(Object.entries(cloned.parentByChild));
      this.state.pages = cloned.pages;
      this.state.activePageId = cloned.activePageId || "";
    }
  };

  // src/client/snapping.ts
  function compute6LineSnapping(active, candidates, threshold = 5) {
    let bestDeltaX = null;
    let bestGuideX = null;
    let bestDeltaY = null;
    let bestGuideY = null;
    const activeVerticals = [
      { type: "near", val: active.left },
      { type: "center", val: active.left + active.width / 2 },
      { type: "far", val: active.left + active.width }
    ];
    const activeHorizontals = [
      { type: "near", val: active.top },
      { type: "center", val: active.top + active.height / 2 },
      { type: "far", val: active.top + active.height }
    ];
    for (const cand of candidates) {
      const candVerticals = [
        cand.left,
        cand.left + cand.width / 2,
        cand.left + cand.width
      ];
      const candHorizontals = [
        cand.top,
        cand.top + cand.height / 2,
        cand.top + cand.height
      ];
      for (const aV of activeVerticals) {
        for (const cV of candVerticals) {
          const delta = cV - aV.val;
          if (Math.abs(delta) <= threshold) {
            if (bestDeltaX === null || Math.abs(delta) < Math.abs(bestDeltaX)) {
              bestDeltaX = delta;
              const minY = Math.min(active.top, cand.top);
              const maxY = Math.max(active.top + active.height, cand.top + cand.height);
              bestGuideX = {
                orientation: "vertical",
                coordinate: cV,
                start: minY,
                end: maxY
              };
            }
          }
        }
      }
      for (const aH of activeHorizontals) {
        for (const cH of candHorizontals) {
          const delta = cH - aH.val;
          if (Math.abs(delta) <= threshold) {
            if (bestDeltaY === null || Math.abs(delta) < Math.abs(bestDeltaY)) {
              bestDeltaY = delta;
              const minX = Math.min(active.left, cand.left);
              const maxX = Math.max(active.left + active.width, cand.left + cand.width);
              bestGuideY = {
                orientation: "horizontal",
                coordinate: cH,
                start: minX,
                end: maxX
              };
            }
          }
        }
      }
    }
    const snappedLeft = bestDeltaX !== null ? active.left + bestDeltaX : active.left;
    const snappedTop = bestDeltaY !== null ? active.top + bestDeltaY : active.top;
    const guides = [];
    if (bestGuideX) guides.push(bestGuideX);
    if (bestGuideY) guides.push(bestGuideY);
    return {
      snappedRect: {
        left: snappedLeft,
        top: snappedTop,
        width: active.width,
        height: active.height
      },
      guides,
      snappedX: bestDeltaX !== null,
      snappedY: bestDeltaY !== null
    };
  }

  // src/client/selection.ts
  var SelectionManager = class {
    selectedIds = /* @__PURE__ */ new Set();
    elementRects = /* @__PURE__ */ new Map();
    activeSession = null;
    setElements(elements) {
      this.elementRects.clear();
      for (const el of elements) {
        this.elementRects.set(el.id, el.rect);
      }
    }
    select(ids) {
      this.selectedIds = new Set(ids);
    }
    toggleSelect(id) {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
      } else {
        this.selectedIds.add(id);
      }
    }
    clearSelection() {
      this.selectedIds.clear();
    }
    getSelectedIds() {
      return Array.from(this.selectedIds);
    }
    /**
     * 获取当前选区合并包围盒 (Bounding Box)
     */
    getBoundingBox() {
      const rects = [];
      for (const id of this.selectedIds) {
        const r = this.elementRects.get(id);
        if (r) rects.push(r);
      }
      if (rects.length === 0) return null;
      return computeBoundingBox(rects);
    }
    /**
     * 计算 8 向控制手柄的坐标与鼠标光标样式
     */
    getHandles(box) {
      const targetBox = box || this.getBoundingBox();
      if (!targetBox) return [];
      const { left, top, width, height } = targetBox;
      const midX = left + width / 2;
      const midY = top + height / 2;
      const right = left + width;
      const bottom = top + height;
      const handleDefs = [
        { handle: "nw", point: { x: left, y: top }, cursor: "nwse-resize" },
        { handle: "n", point: { x: midX, y: top }, cursor: "ns-resize" },
        { handle: "ne", point: { x: right, y: top }, cursor: "nesw-resize" },
        { handle: "e", point: { x: right, y: midY }, cursor: "ew-resize" },
        { handle: "se", point: { x: right, y: bottom }, cursor: "nwse-resize" },
        { handle: "s", point: { x: midX, y: bottom }, cursor: "ns-resize" },
        { handle: "sw", point: { x: left, y: bottom }, cursor: "nesw-resize" },
        { handle: "w", point: { x: left, y: midY }, cursor: "ew-resize" }
      ];
      return handleDefs;
    }
    /**
     * 启动缩放拖拽会话
     */
    startResize(handle, cursorPoint) {
      const box = this.getBoundingBox();
      if (!box) return false;
      const elements = [];
      for (const id of this.selectedIds) {
        const r = this.elementRects.get(id);
        if (r) elements.push({ id, rect: { ...r } });
      }
      this.activeSession = {
        handle,
        startBox: { ...box },
        startPoint: { ...cursorPoint },
        elements
      };
      return true;
    }
    /**
     * 伴随拖拽移动更新缩放几何 (精确保持固定边缘不动，仅移动把手边缘并吸附)
     */
    updateResize(currentCursor, options = {}) {
      if (!this.activeSession) return null;
      const { handle, startBox, startPoint, elements } = this.activeSession;
      const dx = currentCursor.x - startPoint.x;
      const dy = currentCursor.y - startPoint.y;
      const snapThreshold = options.snapThreshold ?? 5;
      const candidates = options.candidates || [];
      const enableSnapping = options.enableSnapping !== false && candidates.length > 0;
      const guides = [];
      let snappedX = false;
      let snappedY = false;
      let newLeft = startBox.left;
      let newWidth = startBox.width;
      if (handle.includes("e")) {
        const rawRight = startBox.left + Math.max(MIN_ELEMENT_SIZE, startBox.width + dx);
        let bestRight = rawRight;
        let minDelta = Infinity;
        let snapGuide = null;
        if (enableSnapping) {
          for (const cand of candidates) {
            const candX = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
            for (const cx of candX) {
              const diff = Math.abs(cx - rawRight);
              if (diff <= snapThreshold && diff < minDelta) {
                minDelta = diff;
                bestRight = cx;
                snapGuide = {
                  orientation: "vertical",
                  coordinate: cx,
                  start: Math.min(startBox.top, cand.top),
                  end: Math.max(startBox.top + startBox.height, cand.top + cand.height)
                };
              }
            }
          }
        }
        newLeft = startBox.left;
        newWidth = Math.max(MIN_ELEMENT_SIZE, bestRight - startBox.left);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedX = true;
        }
      } else if (handle.includes("w")) {
        const fixedRight = startBox.left + startBox.width;
        const rawLeft = startBox.left + dx;
        let bestLeft = Math.min(fixedRight - MIN_ELEMENT_SIZE, rawLeft);
        let minDelta = Infinity;
        let snapGuide = null;
        if (enableSnapping) {
          for (const cand of candidates) {
            const candX = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
            for (const cx of candX) {
              const diff = Math.abs(cx - rawLeft);
              if (diff <= snapThreshold && diff < minDelta) {
                minDelta = diff;
                bestLeft = Math.min(fixedRight - MIN_ELEMENT_SIZE, cx);
                snapGuide = {
                  orientation: "vertical",
                  coordinate: cx,
                  start: Math.min(startBox.top, cand.top),
                  end: Math.max(startBox.top + startBox.height, cand.top + cand.height)
                };
              }
            }
          }
        }
        newLeft = bestLeft;
        newWidth = Math.max(MIN_ELEMENT_SIZE, fixedRight - bestLeft);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedX = true;
        }
      }
      let newTop = startBox.top;
      let newHeight = startBox.height;
      if (handle.includes("s")) {
        const rawBottom = startBox.top + Math.max(MIN_ELEMENT_SIZE, startBox.height + dy);
        let bestBottom = rawBottom;
        let minDelta = Infinity;
        let snapGuide = null;
        if (enableSnapping) {
          for (const cand of candidates) {
            const candY = [cand.top, cand.top + cand.height / 2, cand.top + cand.height];
            for (const cy of candY) {
              const diff = Math.abs(cy - rawBottom);
              if (diff <= snapThreshold && diff < minDelta) {
                minDelta = diff;
                bestBottom = cy;
                snapGuide = {
                  orientation: "horizontal",
                  coordinate: cy,
                  start: Math.min(startBox.left, cand.left),
                  end: Math.max(startBox.left + startBox.width, cand.left + cand.width)
                };
              }
            }
          }
        }
        newTop = startBox.top;
        newHeight = Math.max(MIN_ELEMENT_SIZE, bestBottom - startBox.top);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedY = true;
        }
      } else if (handle.includes("n")) {
        const fixedBottom = startBox.top + startBox.height;
        const rawTop = startBox.top + dy;
        let bestTop = Math.min(fixedBottom - MIN_ELEMENT_SIZE, rawTop);
        let minDelta = Infinity;
        let snapGuide = null;
        if (enableSnapping) {
          for (const cand of candidates) {
            const candY = [cand.top, cand.top + cand.height / 2, cand.top + cand.height];
            for (const cy of candY) {
              const diff = Math.abs(cy - rawTop);
              if (diff <= snapThreshold && diff < minDelta) {
                minDelta = diff;
                bestTop = Math.min(fixedBottom - MIN_ELEMENT_SIZE, cy);
                snapGuide = {
                  orientation: "horizontal",
                  coordinate: cy,
                  start: Math.min(startBox.left, cand.left),
                  end: Math.max(startBox.left + startBox.width, cand.left + cand.width)
                };
              }
            }
          }
        }
        newTop = bestTop;
        newHeight = Math.max(MIN_ELEMENT_SIZE, fixedBottom - bestTop);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedY = true;
        }
      }
      const newBox = {
        left: newLeft,
        top: newTop,
        width: newWidth,
        height: newHeight
      };
      const snapped = snappedX || snappedY;
      let updatedElements;
      if (elements.length === 1) {
        updatedElements = [{ id: elements[0].id, rect: newBox }];
      } else {
        updatedElements = multiResize(
          elements,
          startBox,
          handle,
          newBox.width - startBox.width,
          newBox.height - startBox.height
        );
      }
      for (const item of updatedElements) {
        this.elementRects.set(item.id, item.rect);
      }
      return {
        newBox,
        updatedElements,
        guides,
        snapped
      };
    }
    /**
     * 平移拖拽选区并触发 6 线智能吸附
     */
    moveSelection(deltaX, deltaY, options = {}) {
      const box = this.getBoundingBox();
      if (!box) return null;
      let targetBox = {
        left: box.left + deltaX,
        top: box.top + deltaY,
        width: box.width,
        height: box.height
      };
      let guides = [];
      let snapped = false;
      if (options.enableSnapping !== false && options.candidates && options.candidates.length > 0) {
        const snapRes = compute6LineSnapping(targetBox, options.candidates, options.snapThreshold ?? 5);
        targetBox = snapRes.snappedRect;
        guides = snapRes.guides;
        snapped = snapRes.snappedX || snapRes.snappedY;
      }
      const actualDx = targetBox.left - box.left;
      const actualDy = targetBox.top - box.top;
      const updatedElements = [];
      for (const id of this.selectedIds) {
        const r = this.elementRects.get(id);
        if (r) {
          const movedRect = {
            left: r.left + actualDx,
            top: r.top + actualDy,
            width: r.width,
            height: r.height
          };
          this.elementRects.set(id, movedRect);
          updatedElements.push({ id, rect: movedRect });
        }
      }
      return {
        newBox: targetBox,
        updatedElements,
        guides,
        snapped
      };
    }
    isSelected(id) {
      return this.selectedIds.has(id);
    }
    /**
     * 结束缩放会话
     */
    endResize() {
      this.activeSession = null;
    }
  };

  // src/client/next-shims/index.ts
  var next_shims_exports = {};
  __export(next_shims_exports, {
    Geist: () => Geist,
    Geist_Mono: () => Geist_Mono,
    Image: () => Image,
    Inter: () => Inter,
    Link: () => Link,
    Roboto: () => Roboto,
    createGoogleFontStub: () => createGoogleFontStub,
    setVirtualLocation: () => setVirtualLocation,
    useParams: () => useParams,
    usePathname: () => usePathname,
    useRouter: () => useRouter,
    useSearchParams: () => useSearchParams
  });

  // src/client/next-shims/image.ts
  function Image(props) {
    const { src, alt, width, height, fill, className, style = {}, ...rest } = props;
    const actualSrc = typeof src === "object" && src !== null ? src.src : src;
    const finalStyle = fill ? {
      position: "absolute",
      height: "100%",
      width: "100%",
      inset: 0,
      objectFit: "cover",
      ...style
    } : {
      width,
      height,
      ...style
    };
    return {
      type: "img",
      props: {
        src: actualSrc,
        alt,
        style: finalStyle,
        className,
        ...rest
      }
    };
  }

  // src/client/next-shims/link.ts
  function Link(props) {
    const { href, children, className, onClick, ...rest } = props;
    const handleClick = (e) => {
      if (e && typeof e.preventDefault === "function") {
        e.preventDefault();
      }
      if (onClick) onClick(e);
      if (typeof globalThis !== "undefined" && typeof globalThis.dispatchEvent === "function") {
        try {
          globalThis.dispatchEvent(
            new CustomEvent("designer:navigate", { detail: { href } })
          );
        } catch {
        }
      }
    };
    return {
      type: "a",
      props: {
        href,
        className,
        onClick: handleClick,
        children,
        ...rest
      }
    };
  }

  // src/client/next-shims/navigation.ts
  var currentVirtualPath = "/";
  var currentVirtualSearch = "";
  function setVirtualLocation(pathname, search = "") {
    currentVirtualPath = pathname;
    currentVirtualSearch = search;
  }
  function useRouter() {
    return {
      push(url) {
        const parts = url.split("?");
        setVirtualLocation(parts[0], parts[1] || "");
      },
      replace(url) {
        const parts = url.split("?");
        setVirtualLocation(parts[0], parts[1] || "");
      },
      back() {
      },
      forward() {
      },
      refresh() {
      },
      prefetch() {
      }
    };
  }
  function usePathname() {
    return currentVirtualPath;
  }
  function useSearchParams() {
    return new URLSearchParams(currentVirtualSearch);
  }
  function useParams() {
    return {};
  }

  // src/client/next-shims/font.ts
  function createGoogleFontStub(fontName, defaultVariable) {
    return () => ({
      className: `font-${fontName.toLowerCase()}`,
      variable: defaultVariable,
      style: { fontFamily: `${fontName}, sans-serif` }
    });
  }
  var Inter = createGoogleFontStub("Inter", "--font-inter");
  var Roboto = createGoogleFontStub("Roboto", "--font-roboto");
  var Geist = createGoogleFontStub("Geist", "--font-geist-sans");
  var Geist_Mono = createGoogleFontStub("Geist_Mono", "--font-geist-mono");

  // src/client/sandbox.ts
  var SANDBOX_CSP = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src 'self' data: https:; script-src 'none'; connect-src 'none'; object-src 'none'";
  var CANVAS_TRUSTED_CSS = `
html,body{font-family:ui-sans-serif,system-ui,sans-serif;}
.min-h-screen{min-height:100vh;}
.bg-slate-950{background-color:rgb(2,6,23);}
.bg-slate-900{background-color:rgb(15,23,42);}
.bg-indigo-600{background-color:rgb(79,70,229);}
.bg-emerald-600{background-color:rgb(5,150,105);}
.bg-rose-600{background-color:rgb(225,29,72);}
.bg-amber-400{background-color:rgb(251,191,36);}
.text-slate-100{color:rgb(241,245,249);}
.text-slate-400{color:rgb(148,163,184);}
.text-white{color:rgb(255,255,255);}
.text-emerald-400{color:rgb(52,211,153);}
.text-slate-900{color:rgb(15,23,42);}
.text-2xl{font-size:1.5rem;line-height:2rem;}
.text-xl{font-size:1.25rem;line-height:1.75rem;}
.text-sm{font-size:0.875rem;line-height:1.25rem;}
.text-xs{font-size:0.75rem;line-height:1rem;}
.font-bold{font-weight:700;}
.font-semibold{font-weight:600;}
.tracking-tight{letter-spacing:-0.025em;}
.leading-relaxed{line-height:1.625;}
.p-8{padding:2rem;}
.p-6{padding:1.5rem;}
.px-4{padding-left:1rem;padding-right:1rem;}
.py-2{padding-top:0.5rem;padding-bottom:0.5rem;}
.mt-2{margin-top:0.5rem;}
.mt-4{margin-top:1rem;}
.mt-6{margin-top:1.5rem;}
.rounded-lg{border-radius:0.5rem;}
.rounded-xl{border-radius:0.75rem;}
.rounded-2xl{border-radius:1rem;}
.rounded-full{border-radius:9999px;}
.shadow-md{box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1),0 2px 4px -2px rgb(0 0 0 / 0.1);}
.shadow-lg{box-shadow:0 10px 15px -3px rgb(0 0 0 / 0.1),0 4px 6px -4px rgb(0 0 0 / 0.1);}
.shadow-xl{box-shadow:0 20px 25px -5px rgb(0 0 0 / 0.1),0 8px 10px -6px rgb(0 0 0 / 0.1);}
.border-2{border-width:2px;border-style:solid;}
.border{border-width:1px;border-style:solid;}
.border-indigo-500{border-color:rgb(99,102,241);}
.w-\\[380px\\]{width:380px;}
.inline-flex{display:inline-flex;}
`.trim();
  function collectTrustedCanvasCss(doc) {
    const chunks = [CANVAS_TRUSTED_CSS];
    const target = doc ?? (typeof document !== "undefined" ? document : void 0);
    if (!target) return chunks.join("\n");
    for (const sheet of Array.from(target.styleSheets)) {
      try {
        chunks.push(...Array.from(sheet.cssRules).map((rule) => rule.cssText));
      } catch {
      }
    }
    return chunks.join("\n");
  }
  function sanitizeCss(css) {
    return css.replace(/<\/style/gi, "<\\/style");
  }
  var ALLOWED_TAGS = /* @__PURE__ */ new Set([
    "a",
    "abbr",
    "article",
    "aside",
    "b",
    "blockquote",
    "br",
    "button",
    "caption",
    "code",
    "div",
    "em",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "i",
    "img",
    "input",
    "label",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
    "svg",
    "path",
    "circle",
    "rect",
    "g",
    "line",
    "polyline",
    "polygon"
  ]);
  var ALLOWED_ATTRS = /* @__PURE__ */ new Set([
    "alt",
    "class",
    "className",
    "colspan",
    "disabled",
    "fill",
    "for",
    "height",
    "href",
    "id",
    "name",
    "placeholder",
    "rel",
    "role",
    "rowspan",
    "src",
    "stroke",
    "stroke-width",
    "style",
    "target",
    "title",
    "type",
    "value",
    "viewBox",
    "width",
    "xmlns",
    "d",
    "cx",
    "cy",
    "r",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2"
  ]);
  function isAllowedAttr(name) {
    if (name.startsWith("on")) return false;
    if (name.startsWith("data-")) return true;
    if (name.startsWith("aria-")) return true;
    return ALLOWED_ATTRS.has(name);
  }
  function isAllowedUrl(value) {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:")) return false;
    if (lower.startsWith("vbscript:")) return false;
    if (lower.startsWith("data:text/html")) return false;
    if (lower.startsWith("data:image/")) return true;
    if (lower.startsWith("https:")) return true;
    if (lower.startsWith("http:")) return true;
    if (lower.startsWith("mailto:")) return true;
    if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith(".")) return true;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return true;
    return false;
  }
  function wrapSandboxSrcdoc(inner, options = {}) {
    const css = sanitizeCss(options.css ?? CANVAS_TRUSTED_CSS);
    return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><style>${css}</style></head><body style="margin:0;background:transparent;">${inner}</body></html>`;
  }
  function sandboxIframeMarkup(inner, options = {}) {
    const srcdoc = wrapSandboxSrcdoc(inner, options).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return `<iframe class="od-sandbox-frame" data-testid="component-sandbox" sandbox="allow-same-origin" referrerpolicy="no-referrer" srcdoc="${srcdoc}" style="border:0;width:100%;height:100%;pointer-events:none;background:transparent;position:absolute;inset:0;"></iframe>`;
  }
  var ComponentSandbox = class {
    activePath;
    nextShims;
    constructor(options = {}) {
      this.activePath = options.activePath || "/";
      this.nextShims = next_shims_exports;
      this.nextShims.setVirtualLocation(this.activePath);
    }
    setPath(path) {
      this.activePath = path;
      this.nextShims.setVirtualLocation(path);
    }
    getShims() {
      return this.nextShims;
    }
    renderElement(store, elementId, parentRect) {
      const el = store.getElement(elementId);
      if (!el) return "";
      if (el.type === "text") {
        return el.textContent || "";
      }
      const children = store.getChildren(elementId);
      const renderedChildren = [];
      if (el.textContent) {
        renderedChildren.push(el.textContent);
      }
      for (const child of children) {
        renderedChildren.push(this.renderElement(store, child.id, el.canvasRect));
      }
      let finalTag = el.tag;
      const finalProps = { ...el.props || {} };
      if (el.tag === "Image" || el.tag === "next/image") {
        const shim = this.nextShims.Image({
          src: finalProps.src || "/placeholder.svg",
          alt: String(finalProps.alt || ""),
          width: finalProps.width,
          height: finalProps.height,
          fill: Boolean(finalProps.fill),
          className: finalProps.className
        });
        finalTag = shim.type;
        Object.assign(finalProps, shim.props, { "data-next-image": "true" });
      } else if (el.tag === "Link" || el.tag === "next/link") {
        const shim = this.nextShims.Link({
          href: String(finalProps.href || "#"),
          className: finalProps.className
        });
        finalTag = shim.type;
        Object.assign(finalProps, shim.props, { "data-next-link": "true" });
      }
      if (!finalProps["data-element-id"]) {
        finalProps["data-element-id"] = el.id;
      }
      if (!finalProps["data-testid"]) {
        finalProps["data-testid"] = `node-${el.id}`;
      }
      if (el.canvasRect) {
        this.applyCanvasRectStyle(finalProps, el.canvasRect, parentRect);
      }
      return {
        tag: finalTag,
        props: finalProps,
        children: renderedChildren
      };
    }
    applyCanvasRectStyle(props, rect, parentRect) {
      const left = parentRect ? rect.left - parentRect.left : rect.left;
      const top = parentRect ? rect.top - parentRect.top : rect.top;
      const layout = {
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        boxSizing: "border-box"
      };
      if (props.style && typeof props.style === "object" && !Array.isArray(props.style)) {
        props.style = { ...layout, ...props.style };
        return;
      }
      if (typeof props.style === "string" && props.style.trim()) {
        const css = Object.entries(layout).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`).join(";");
        props.style = `${css};${props.style}`;
        return;
      }
      props.style = layout;
    }
    renderToHtml(store, rootId) {
      try {
        const node = this.renderElement(store, rootId);
        return this.nodeToHtmlString(node);
      } catch (err) {
        return this.renderErrorFallback(err instanceof Error ? err : new Error(String(err)));
      }
    }
    nodeToHtmlString(node) {
      if (typeof node === "string") {
        return this.escapeHtml(node);
      }
      const { tag, props, children } = node;
      const rawTag = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) ? tag : "div";
      const safeTag = ALLOWED_TAGS.has(rawTag.toLowerCase()) ? rawTag : "div";
      const attrs = Object.entries(props).map(([k, v]) => {
        if (typeof v === "function") return "";
        if (k === "children") return "";
        if (!isAllowedAttr(k)) return "";
        const attrName = k === "className" ? "class" : k;
        if (k === "style" && typeof v === "object" && v !== null) {
          const css = Object.entries(v).map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`).join(";");
          return `style="${this.escapeHtml(css)}"`;
        }
        if (typeof v === "boolean") return v ? attrName : "";
        let text = typeof v === "string" ? v : typeof v === "number" ? String(v) : JSON.stringify(v);
        if ((attrName === "href" || attrName === "src" || attrName === "xlink:href") && !isAllowedUrl(text)) {
          return "";
        }
        return `${attrName}="${this.escapeHtml(text)}"`;
      }).filter(Boolean).join(" ");
      const attrStr = attrs ? ` ${attrs}` : "";
      const selfClosingTags = /* @__PURE__ */ new Set(["img", "input", "br", "hr", "meta", "link"]);
      if (selfClosingTags.has(safeTag.toLowerCase()) && children.length === 0) {
        return `<${safeTag}${attrStr} />`;
      }
      const innerHtml = children.map((c) => this.nodeToHtmlString(c)).join("");
      return `<${safeTag}${attrStr}>${innerHtml}</${safeTag}>`;
    }
    escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    renderErrorFallback(error) {
      return `
      <div style="padding: 16px; border: 1px solid #ef4444; background: #fef2f2; color: #991b1b; border-radius: 8px; font-family: sans-serif;">
        <div style="font-weight: bold; margin-bottom: 4px;">Sandbox render isolation</div>
        <div style="font-size: 13px;">${this.escapeHtml(error.message || String(error))}</div>
      </div>
    `.trim();
    }
  };

  // src/compiler/tailwindMerge.ts
  function getTailwindCategory(token) {
    const colonIdx = token.lastIndexOf(":");
    const prefix = colonIdx !== -1 ? token.slice(0, colonIdx + 1) : "";
    const baseToken = colonIdx !== -1 ? token.slice(colonIdx + 1) : token;
    if (/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+[^\]]*\])$/.test(baseToken)) {
      return `${prefix}text-size`;
    }
    if (/^text-(left|center|right|justify|start|end)$/.test(baseToken)) {
      return `${prefix}text-align`;
    }
    if (/^text-(wrap|nowrap|balance|pretty)$/.test(baseToken)) {
      return `${prefix}text-wrap`;
    }
    if (/^text-(ellipsis|clip)$/.test(baseToken)) {
      return `${prefix}text-overflow`;
    }
    if (/^text-opacity-/.test(baseToken)) {
      return `${prefix}text-opacity`;
    }
    if (/^text-/.test(baseToken)) {
      return `${prefix}text-color`;
    }
    if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(baseToken)) {
      return `${prefix}font-weight`;
    }
    if (/^font-(sans|serif|mono)$/.test(baseToken)) {
      return `${prefix}font-family`;
    }
    if (/^(italic|not-italic)$/.test(baseToken)) {
      return `${prefix}font-style`;
    }
    if (/^bg-(auto|cover|contain)$/.test(baseToken)) {
      return `${prefix}bg-size`;
    }
    if (/^bg-(bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top)$/.test(baseToken)) {
      return `${prefix}bg-position`;
    }
    if (/^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/.test(baseToken)) {
      return `${prefix}bg-repeat`;
    }
    if (/^bg-(clip-border|clip-padding|clip-content|clip-text)$/.test(baseToken) || /^bg-clip-/.test(baseToken)) {
      return `${prefix}bg-clip`;
    }
    if (/^bg-(origin-border|origin-padding|origin-content)$/.test(baseToken) || /^bg-origin-/.test(baseToken)) {
      return `${prefix}bg-origin`;
    }
    if (/^bg-(gradient-to-[trbl]{1,2}|none)$/.test(baseToken) || /^bg-gradient-/.test(baseToken)) {
      return `${prefix}bg-gradient`;
    }
    if (/^bg-opacity-/.test(baseToken)) {
      return `${prefix}bg-opacity`;
    }
    if (/^bg-/.test(baseToken)) {
      return `${prefix}bg-color`;
    }
    if (/^rounded-(tl|tr|bl|br|ss|se|ee|es|s|e)(-.*)?$/.test(baseToken)) {
      const corner = baseToken.match(/^rounded-(tl|tr|bl|br|ss|se|ee|es|s|e)/)[1];
      return `${prefix}rounded-${corner}`;
    }
    if (/^rounded-(t|b|l|r)(-.*)?$/.test(baseToken)) {
      const side = baseToken.match(/^rounded-(t|b|l|r)/)[1];
      return `${prefix}rounded-${side}`;
    }
    if (/^rounded(-.*)?$/.test(baseToken)) {
      return `${prefix}rounded`;
    }
    if (/^border-(solid|dashed|dotted|double|none|hidden)$/.test(baseToken)) {
      return `${prefix}border-style`;
    }
    if (/^border-(collapse|separate)$/.test(baseToken)) {
      return `${prefix}border-collapse`;
    }
    if (/^border-opacity-/.test(baseToken)) {
      return `${prefix}border-opacity`;
    }
    if (/^border-(t|b|l|r)(-\d+|-\[\d+[^\]]*\])?$/.test(baseToken)) {
      const side = baseToken.match(/^border-(t|b|l|r)/)[1];
      return `${prefix}border-width-${side}`;
    }
    if (/^border(-\d+|-\[\d+[^\]]*\])?$/.test(baseToken)) {
      return `${prefix}border-width`;
    }
    if (/^border-(t|b|l|r)-/.test(baseToken)) {
      const side = baseToken.match(/^border-(t|b|l|r)/)[1];
      return `${prefix}border-color-${side}`;
    }
    if (/^border-/.test(baseToken)) {
      return `${prefix}border-color`;
    }
    const spacingMatch = baseToken.match(/^(-?[mp][xytrbl]?)-/);
    if (spacingMatch) {
      const dir = spacingMatch[1].replace(/^-/, "");
      return `${prefix}spacing-${dir}`;
    }
    if (/^w-/.test(baseToken)) return `${prefix}w`;
    if (/^h-/.test(baseToken)) return `${prefix}h`;
    if (/^min-w-/.test(baseToken)) return `${prefix}min-w`;
    if (/^max-w-/.test(baseToken)) return `${prefix}max-w`;
    if (/^min-h-/.test(baseToken)) return `${prefix}min-h`;
    if (/^max-h-/.test(baseToken)) return `${prefix}max-h`;
    if (/^flex-(row|row-reverse|col|col-reverse)$/.test(baseToken)) return `${prefix}flex-direction`;
    if (/^flex-(wrap|wrap-reverse|nowrap)$/.test(baseToken)) return `${prefix}flex-wrap`;
    if (/^flex-(1|auto|initial|none)$/.test(baseToken)) {
      return `${prefix}flex-size`;
    }
    if (/^grow(-.*)?$/.test(baseToken)) {
      return `${prefix}flex-grow`;
    }
    if (/^shrink(-.*)?$/.test(baseToken)) {
      return `${prefix}flex-shrink`;
    }
    if (/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/.test(baseToken)) {
      return `${prefix}display`;
    }
    if (/^items-/.test(baseToken)) return `${prefix}items`;
    if (/^justify-items-/.test(baseToken)) return `${prefix}justify-items`;
    if (/^justify-/.test(baseToken)) return `${prefix}justify-content`;
    if (/^gap-x-/.test(baseToken)) return `${prefix}gap-x`;
    if (/^gap-y-/.test(baseToken)) return `${prefix}gap-y`;
    if (/^gap-/.test(baseToken)) return `${prefix}gap`;
    if (/^(static|fixed|absolute|relative|sticky)$/.test(baseToken)) return `${prefix}position`;
    if (/^-?top-/.test(baseToken)) return `${prefix}top`;
    if (/^-?right-/.test(baseToken)) return `${prefix}right`;
    if (/^-?bottom-/.test(baseToken)) return `${prefix}bottom`;
    if (/^-?left-/.test(baseToken)) return `${prefix}left`;
    if (/^-?inset-/.test(baseToken)) return `${prefix}inset`;
    if (/^z-/.test(baseToken)) return `${prefix}z-index`;
    if (/^shadow(-.*)?$/.test(baseToken)) return `${prefix}shadow`;
    if (/^opacity-/.test(baseToken)) return `${prefix}opacity`;
    if (/^cursor-/.test(baseToken)) return `${prefix}cursor`;
    if (/^overflow-x-/.test(baseToken)) return `${prefix}overflow-x`;
    if (/^overflow-y-/.test(baseToken)) return `${prefix}overflow-y`;
    if (/^overflow-/.test(baseToken)) return `${prefix}overflow`;
    const dashIdx = baseToken.lastIndexOf("-");
    return dashIdx > 0 ? `${prefix}${baseToken.slice(0, dashIdx + 1)}` : `${prefix}${baseToken}`;
  }
  function mergeTailwindTokens(existingClasses, tokensToAddOrReplace) {
    const existingTokens = existingClasses.split(/\s+/).filter(Boolean);
    const incomingTokens = tokensToAddOrReplace.split(/\s+/).filter(Boolean);
    let currentTokens = [...existingTokens];
    for (const incomingToken of incomingTokens) {
      const targetCategory = getTailwindCategory(incomingToken);
      currentTokens = currentTokens.filter((t) => getTailwindCategory(t) !== targetCategory);
      currentTokens.push(incomingToken);
    }
    return currentTokens.join(" ");
  }
  var mergeTailwindClasses = mergeTailwindTokens;

  // src/client/stylesPanel.ts
  var StylesPanelManager = class {
    /**
     * 解析元素 className 中的 Tailwind v4 视觉属性
     */
    static parseClasses(className) {
      const tokens = className.trim().split(/\s+/).filter(Boolean);
      const styles = {};
      for (const t of tokens) {
        if (t === "flex" || t === "grid" || t === "block" || t === "inline-block" || t === "hidden") {
          styles.display = t;
        } else if (t.startsWith("flex-row") || t.startsWith("flex-col")) {
          styles.flexDirection = t.replace("flex-", "");
        } else if (t.startsWith("justify-")) {
          styles.justifyContent = t.replace("justify-", "");
        } else if (t.startsWith("items-")) {
          styles.alignItems = t.replace("items-", "");
        } else if (t.startsWith("gap-")) {
          styles.gap = t.replace("gap-", "");
        } else if (t.startsWith("px-")) styles.paddingX = t.replace("px-", "");
        else if (t.startsWith("py-")) styles.paddingY = t.replace("py-", "");
        else if (t.startsWith("p-")) styles.padding = t.replace("p-", "");
        else if (t.startsWith("mx-")) styles.marginX = t.replace("mx-", "");
        else if (t.startsWith("my-")) styles.marginY = t.replace("my-", "");
        else if (t.startsWith("m-")) styles.margin = t.replace("m-", "");
        else if (/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+[^\]]*\])$/.test(t)) styles.textSize = t.replace("text-", "");
        else if (/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/.test(t)) styles.fontWeight = t.replace("font-", "");
        else if (/^text-(left|center|right|justify)$/.test(t)) styles.textAlign = t.replace("text-", "");
        else if (t.startsWith("text-") && !t.startsWith("text-opacity-")) styles.textColor = t.replace("text-", "");
        else if (t.startsWith("bg-") && !t.startsWith("bg-opacity-")) styles.backgroundColor = t.replace("bg-", "");
        else if (t.startsWith("opacity-")) styles.opacity = t.replace("opacity-", "");
        else if (t === "border" || /^border-(\d+|\[\d+[^\]]*\])$/.test(t)) styles.borderWidth = t === "border" ? "1" : t.replace("border-", "");
        else if (t === "border-none") styles.borderWidth = "0";
        else if (t.startsWith("border-") && !t.startsWith("border-opacity-") && !/^(border-(solid|dashed|dotted|double|none|hidden))$/.test(t)) styles.borderColor = t.replace("border-", "");
        else if (t.startsWith("rounded")) styles.borderRadius = t === "rounded" ? "DEFAULT" : t.replace("rounded-", "");
        else if (t.startsWith("shadow")) styles.shadow = t === "shadow" ? "DEFAULT" : t.replace("shadow-", "");
      }
      return styles;
    }
    /**
     * 应用单个属性变更并返回更新后的合并 className
     */
    static applyPropertyChange(currentClassName, propertyType, value) {
      let token = "";
      switch (propertyType) {
        case "display":
          token = value;
          break;
        case "flexDirection":
          token = `flex-${value}`;
          break;
        case "justifyContent":
          token = `justify-${value}`;
          break;
        case "alignItems":
          token = `items-${value}`;
          break;
        case "gap":
          token = `gap-${value}`;
          break;
        case "padding":
          token = `p-${value}`;
          break;
        case "paddingX":
          token = `px-${value}`;
          break;
        case "paddingY":
          token = `py-${value}`;
          break;
        case "margin":
          token = `m-${value}`;
          break;
        case "marginX":
          token = `mx-${value}`;
          break;
        case "marginY":
          token = `my-${value}`;
          break;
        case "textSize":
          token = `text-${value}`;
          break;
        case "fontWeight":
          token = `font-${value}`;
          break;
        case "textAlign":
          token = `text-${value}`;
          break;
        case "textColor":
          token = `text-${value}`;
          break;
        case "backgroundColor":
          token = `bg-${value}`;
          break;
        case "opacity":
          token = `opacity-${value}`;
          break;
        case "borderWidth":
          token = value === "1" ? "border" : value === "0" || value === "none" ? "border-0" : `border-${value}`;
          break;
        case "borderColor":
          token = `border-${value}`;
          break;
        case "borderRadius":
          token = value === "DEFAULT" ? "rounded" : value === "none" ? "rounded-none" : `rounded-${value}`;
          break;
        case "shadow":
          token = value === "DEFAULT" ? "shadow" : value === "none" ? "shadow-none" : `shadow-${value}`;
          break;
      }
      if (!token) return currentClassName;
      return mergeTailwindClasses(currentClassName, token);
    }
    /**
     * 构建样式检查器面板的 UI 渲染模型
     */
    static buildPanelSections(className) {
      const parsed = this.parseClasses(className);
      return [
        {
          id: "layout",
          title: "\u5E03\u5C40\u4E0E\u6D41\u6392\u7248 (Layout)",
          controls: [
            {
              name: "display",
              label: "Display",
              type: "select",
              currentValue: parsed.display || "block",
              options: [
                { label: "Block", value: "block", className: "block" },
                { label: "Flex", value: "flex", className: "flex" },
                { label: "Grid", value: "grid", className: "grid" },
                { label: "Inline Block", value: "inline-block", className: "inline-block" }
              ]
            },
            {
              name: "flexDirection",
              label: "\u65B9\u5411",
              type: "select",
              currentValue: parsed.flexDirection || "row",
              options: [
                { label: "\u6C34\u5E73 (Row)", value: "row", className: "flex-row" },
                { label: "\u5782\u76F4 (Column)", value: "col", className: "flex-col" }
              ]
            },
            {
              name: "gap",
              label: "\u95F4\u8DDD (Gap)",
              type: "spacing",
              currentValue: parsed.gap || "0"
            }
          ]
        },
        {
          id: "spacing",
          title: "\u8FB9\u8DDD\u4E0E\u5185\u886C (Spacing)",
          controls: [
            { name: "padding", label: "\u5185\u8FB9\u8DDD (P)", type: "spacing", currentValue: parsed.padding || "" },
            { name: "paddingX", label: "\u6C34\u5E73\u5185\u8FB9\u8DDD (PX)", type: "spacing", currentValue: parsed.paddingX || "" },
            { name: "paddingY", label: "\u5782\u76F4\u5185\u8FB9\u8DDD (PY)", type: "spacing", currentValue: parsed.paddingY || "" },
            { name: "margin", label: "\u5916\u8FB9\u8DDD (M)", type: "spacing", currentValue: parsed.margin || "" }
          ]
        },
        {
          id: "typography",
          title: "\u6392\u7248\u4E0E\u5B57\u4F53 (Typography)",
          controls: [
            {
              name: "textSize",
              label: "\u5B57\u53F7",
              type: "select",
              currentValue: parsed.textSize || "base",
              options: [
                { label: "12px (xs)", value: "xs", className: "text-xs" },
                { label: "14px (sm)", value: "sm", className: "text-sm" },
                { label: "16px (base)", value: "base", className: "text-base" },
                { label: "18px (lg)", value: "lg", className: "text-lg" },
                { label: "20px (xl)", value: "xl", className: "text-xl" },
                { label: "24px (2xl)", value: "2xl", className: "text-2xl" }
              ]
            },
            {
              name: "fontWeight",
              label: "\u5B57\u91CD",
              type: "select",
              currentValue: parsed.fontWeight || "normal",
              options: [
                { label: "\u5E38\u89C4 (400)", value: "normal", className: "font-normal" },
                { label: "\u4E2D\u7C97 (500)", value: "medium", className: "font-medium" },
                { label: "\u534A\u7C97 (600)", value: "semibold", className: "font-semibold" },
                { label: "\u7C97\u4F53 (700)", value: "bold", className: "font-bold" }
              ]
            },
            { name: "textColor", label: "\u6587\u5B57\u989C\u8272", type: "color", currentValue: parsed.textColor || "" }
          ]
        },
        {
          id: "appearance",
          title: "\u8272\u5F69\u4E0E\u80CC\u666F (Appearance)",
          controls: [
            { name: "backgroundColor", label: "\u80CC\u666F\u989C\u8272", type: "color", currentValue: parsed.backgroundColor || "" },
            { name: "opacity", label: "\u4E0D\u900F\u660E\u5EA6", type: "select", currentValue: parsed.opacity || "100" }
          ]
        },
        {
          id: "borders",
          title: "\u8FB9\u6846\u4E0E\u5706\u89D2 (Borders & Radius)",
          controls: [
            {
              name: "borderRadius",
              label: "\u5706\u89D2",
              type: "select",
              currentValue: parsed.borderRadius || "none",
              options: [
                { label: "\u65E0", value: "none", className: "rounded-none" },
                { label: "\u5C0F (sm)", value: "sm", className: "rounded-sm" },
                { label: "\u9ED8\u8BA4 (rounded)", value: "DEFAULT", className: "rounded" },
                { label: "\u4E2D (md)", value: "md", className: "rounded-md" },
                { label: "\u5927 (lg)", value: "lg", className: "rounded-lg" },
                { label: "\u8D85\u5927 (xl)", value: "xl", className: "rounded-xl" },
                { label: "\u80F6\u56CA (full)", value: "full", className: "rounded-full" }
              ]
            },
            {
              name: "borderWidth",
              label: "\u8FB9\u6846\u7C97\u7EC6",
              type: "select",
              currentValue: parsed.borderWidth || "0",
              options: [
                { label: "\u65E0 (0)", value: "0", className: "border-0" },
                { label: "1px", value: "1", className: "border" },
                { label: "2px", value: "2", className: "border-2" },
                { label: "4px", value: "4", className: "border-4" },
                { label: "8px", value: "8", className: "border-8" }
              ]
            },
            { name: "borderColor", label: "\u8FB9\u6846\u989C\u8272", type: "color", currentValue: parsed.borderColor || "" },
            {
              name: "shadow",
              label: "\u9634\u5F71",
              type: "select",
              currentValue: parsed.shadow || "none",
              options: [
                { label: "\u65E0", value: "none", className: "shadow-none" },
                { label: "\u5FAE\u9634\u5F71 (sm)", value: "sm", className: "shadow-sm" },
                { label: "\u9ED8\u8BA4 (shadow)", value: "DEFAULT", className: "shadow" },
                { label: "\u666E\u901A (md)", value: "md", className: "shadow-md" },
                { label: "\u5927\u9634\u5F71 (lg)", value: "lg", className: "shadow-lg" },
                { label: "\u8D85\u5927 (xl)", value: "xl", className: "shadow-xl" }
              ]
            }
          ]
        }
      ];
    }
  };

  // src/client/canvas/canvasPanel.ts
  var CanvasPanel = class {
    viewport;
    selection;
    controller;
    overlay;
    sandbox;
    stylesPanel;
    store;
    snapThreshold;
    elementRects = /* @__PURE__ */ new Map();
    constructor(options = {}) {
      this.viewport = new InfiniteCanvasViewport({
        zoom: options.initialZoom ?? 1,
        panX: options.initialPan?.x ?? 0,
        panY: options.initialPan?.y ?? 0
      });
      this.selection = new SelectionManager();
      this.controller = new CanvasInteractionController(this.viewport, this.selection);
      this.overlay = new SelectionOverlayRenderer({
        handleSize: options.handleSize ?? 12
      });
      this.sandbox = new ComponentSandbox();
      this.stylesPanel = new StylesPanelManager();
      this.store = options.store || new FlatStore();
      this.snapThreshold = options.snapThreshold ?? 5;
    }
    /**
     * 同步或注册图元世界几何矩形
     */
    registerElement(id, rect, element) {
      this.elementRects.set(id, { ...rect });
      if (element) {
        element.canvasRect = { ...rect };
        this.store.setElement(element);
      }
      this.syncSelectionManager();
    }
    /**
     * 移除指定图元
     */
    unregisterElement(id) {
      this.elementRects.delete(id);
      this.store.removeElement(id);
      this.syncSelectionManager();
    }
    clearRegisteredRects() {
      this.elementRects.clear();
      this.syncSelectionManager();
    }
    /**
     * 同步所有元素矩形至 SelectionManager
     */
    syncSelectionManager() {
      const list = [];
      for (const [id, rect] of this.elementRects.entries()) {
        list.push({ id, rect: { ...rect } });
      }
      this.selection.setElements(list);
    }
    /**
     * 获取除了已选中元素之外的所有候选对齐矩形
     */
    getAlignmentCandidates() {
      const selected = new Set(this.selection.getSelectedIds());
      const candidates = [];
      for (const [id, rect] of this.elementRects.entries()) {
        if (!selected.has(id)) {
          candidates.push({ ...rect });
        }
      }
      return candidates;
    }
    /**
     * 选中图元
     */
    select(ids) {
      this.selection.select(ids);
    }
    /**
     * 获取当前选区合并包围盒
     */
    getSelectedBoundingBox() {
      return this.selection.getBoundingBox();
    }
    getElementRect(id) {
      const r = this.elementRects.get(id);
      return r ? { ...r } : void 0;
    }
    getAllElementRects() {
      return new Map(this.elementRects);
    }
    /**
     * Hit-test world point against registered rects. Prefers the smallest containing box
     * so nested children win over their parent.
     */
    hitTest(worldPoint) {
      let bestId = null;
      let bestArea = Infinity;
      for (const [id, rect] of this.elementRects.entries()) {
        if (worldPoint.x >= rect.left && worldPoint.x <= rect.left + rect.width && worldPoint.y >= rect.top && worldPoint.y <= rect.top + rect.height) {
          const area = Math.max(1, rect.width * rect.height);
          if (area <= bestArea) {
            bestArea = area;
            bestId = id;
          }
        }
      }
      return bestId;
    }
    hitTestIntersecting(worldRect) {
      const ids = [];
      for (const [id, rect] of this.elementRects.entries()) {
        if (rectsIntersect(worldRect, rect)) ids.push(id);
      }
      return ids;
    }
    updateMarquee(screenPoint, additive, baseIds) {
      const marquee = this.controller.updateBoxSelect(screenPoint);
      if (!marquee) return [];
      const hit = this.hitTestIntersecting(marquee);
      const merged = additive ? Array.from(/* @__PURE__ */ new Set([...baseIds, ...hit])) : hit;
      this.select(merged);
      return merged;
    }
    persistRect(id, rect) {
      this.elementRects.set(id, { ...rect });
      const el = this.store.getElement(id);
      if (el) {
        el.canvasRect = { ...rect };
      }
    }
    /**
     * When a parent box moves or its origin shifts, keep descendant world rects in sync
     * so nested DOM children and hit-testing stay aligned.
     */
    translateUnselectedDescendants(movedIds, before) {
      for (const id of movedIds) {
        const prev = before.get(id);
        const next = this.elementRects.get(id);
        if (!prev || !next) continue;
        const dx = next.left - prev.left;
        const dy = next.top - prev.top;
        if (dx === 0 && dy === 0) continue;
        for (const desc of this.store.getSubtree(id)) {
          if (desc.id === id || movedIds.has(desc.id)) continue;
          const current = this.elementRects.get(desc.id);
          if (!current) continue;
          this.persistRect(desc.id, {
            left: current.left + dx,
            top: current.top + dy,
            width: current.width,
            height: current.height
          });
        }
      }
      this.syncSelectionManager();
    }
    /**
     * 执行拖拽移动 (打通 6 线智能吸附)
     */
    moveSelected(screenPoint) {
      const before = this.getAllElementRects();
      const candidates = this.getAlignmentCandidates();
      const res = this.controller.updateDrag(screenPoint, {
        candidates,
        snapThreshold: this.snapThreshold,
        enableSnapping: true
      });
      if (res && res.updatedElements) {
        for (const item of res.updatedElements) {
          this.persistRect(item.id, item.rect);
        }
        this.translateUnselectedDescendants(
          new Set(res.updatedElements.map((item) => item.id)),
          before
        );
      }
      return res;
    }
    /**
     * 执行 8 向手柄缩放 (打通伴随几何与 6 线吸附)
     */
    resizeSelected(screenPoint) {
      const before = this.getAllElementRects();
      const candidates = this.getAlignmentCandidates();
      const res = this.controller.updateResize(screenPoint, {
        candidates,
        snapThreshold: this.snapThreshold,
        enableSnapping: true
      });
      if (res && res.updatedElements) {
        for (const item of res.updatedElements) {
          this.persistRect(item.id, item.rect);
        }
        this.translateUnselectedDescendants(
          new Set(res.updatedElements.map((item) => item.id)),
          before
        );
      }
      return res;
    }
    /**
     * 渲染完整画布 HTML/SVG 标记
     */
    renderHtml() {
      const transformStyle = this.viewport.getCssTransform();
      const box = this.selection.getBoundingBox();
      const guides = this.controller.getGuides();
      const elementsHtml = [];
      const rootIds = this.store.getRootIds();
      for (const rid of rootIds) {
        elementsHtml.push(this.sandbox.renderToHtml(this.store, rid));
      }
      const overlaySvg = this.overlay.renderSvgOverlay(box, guides, {
        marquee: this.controller.getMarqueeRect()
      });
      return [
        `<div class="opendesigner-canvas-container" data-testid="canvas-container" style="position:relative;width:100%;height:100%;overflow:hidden;background:#0f172a;">`,
        `  <div class="canvas-viewport-layer" data-testid="canvas-viewport-layer" style="transform-origin:0 0;transform:${transformStyle};position:absolute;top:0;left:0;width:100%;height:100%;">`,
        `    ${sandboxIframeMarkup(elementsHtml.join("\n    "), { css: collectTrustedCanvasCss() })}`,
        `    <div class="canvas-overlay-host" data-testid="canvas-overlay" style="pointer-events:none;position:absolute;inset:0;">${overlaySvg}</div>`,
        `  </div>`,
        `</div>`
      ].join("\n");
    }
  };

  // src/client/previewCanvasUx.ts
  var RESIZE_HANDLES = /* @__PURE__ */ new Set(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
  var MARQUEE_CLICK_PX = 4;
  function canvasPointFromEvent(canvasEl, clientX, clientY) {
    const bounds = canvasEl.getBoundingClientRect();
    return { x: clientX - bounds.left, y: clientY - bounds.top };
  }
  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
  }
  function applyRectsToDom(canvasEl, panel, store) {
    const iframe = canvasEl.querySelector("iframe.od-sandbox-frame");
    const scope = iframe?.contentDocument?.body ?? canvasEl;
    for (const [id, rect] of panel.getAllElementRects()) {
      const node = scope.querySelector(`[data-element-id="${CSS.escape(id)}"]`);
      if (!node) continue;
      const parent = store.getParent(id);
      const parentRect = parent?.canvasRect;
      const left = parentRect ? rect.left - parentRect.left : rect.left;
      const top = parentRect ? rect.top - parentRect.top : rect.top;
      node.style.position = "absolute";
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.width = `${rect.width}px`;
      node.style.height = `${rect.height}px`;
      node.style.boxSizing = "border-box";
    }
  }
  function refreshOverlay(canvasEl, panel) {
    const host = canvasEl.querySelector(".canvas-overlay-host");
    if (host) {
      host.innerHTML = panel.overlay.renderSvgOverlay(
        panel.getSelectedBoundingBox(),
        panel.controller.getGuides(),
        { marquee: panel.controller.getMarqueeRect() }
      );
    }
    const layer = canvasEl.querySelector(".canvas-viewport-layer");
    if (layer) {
      layer.style.transform = panel.viewport.getCssTransform();
    }
  }
  function endInteraction(panel) {
    const mode = panel.controller.getMode();
    if (mode === "panning") panel.controller.endPan();
    else if (mode === "dragging") panel.controller.endDrag();
    else if (mode === "resizing") panel.controller.endResize();
    else if (mode === "box-selecting") panel.controller.endBoxSelect();
  }
  function bindFloatingTooltips(root) {
    let tip = root.querySelector("[data-testid='editor-tooltip']");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "od-float-tip";
      tip.setAttribute("data-testid", "editor-tooltip");
      tip.hidden = true;
      root.appendChild(tip);
    }
    let hideTimer = 0;
    const show = (text, x, y) => {
      window.clearTimeout(hideTimer);
      tip.hidden = false;
      tip.textContent = text;
      const pad = 12;
      const maxX = window.innerWidth - tip.offsetWidth - 8;
      const maxY = window.innerHeight - tip.offsetHeight - 8;
      tip.style.left = `${Math.max(8, Math.min(maxX, x + pad))}px`;
      tip.style.top = `${Math.max(8, Math.min(maxY, y + pad))}px`;
    };
    const hide = () => {
      hideTimer = window.setTimeout(() => {
        tip.hidden = true;
        tip.textContent = "";
      }, 80);
    };
    const onOver = (event) => {
      const target = event.target;
      const el = target?.closest?.("[data-tooltip]");
      if (!el) {
        hide();
        return;
      }
      const text = el.getAttribute("data-tooltip");
      if (!text) {
        hide();
        return;
      }
      show(text, event.clientX, event.clientY);
    };
    const onMove = (event) => {
      if (tip.hidden) return;
      const el = event.target?.closest?.("[data-tooltip]");
      if (el) show(el.getAttribute("data-tooltip") || "", event.clientX, event.clientY);
    };
    const onOut = (event) => {
      const next = event.relatedTarget;
      if (next && root.contains(next) && next.closest("[data-tooltip]")) return;
      hide();
    };
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerout", onOut);
    return () => {
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerout", onOut);
    };
  }
  function bindPreviewCanvasUx(canvasEl, panel, store, hooks) {
    let spaceDown = false;
    let pointerId = null;
    let didMutate = false;
    let commitLabel = "canvas-gesture";
    let marqueeAdditive = false;
    let marqueeBaseIds = [];
    let pointerStart = null;
    const liveSync = () => {
      applyRectsToDom(canvasEl, panel, store);
      refreshOverlay(canvasEl, panel);
      hooks.onHud();
    };
    const onPointerDown = (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      const target = event.target;
      const screen = canvasPointFromEvent(canvasEl, event.clientX, event.clientY);
      const handleAttr = target?.closest("[data-handle]")?.getAttribute("data-handle");
      const nodeEl = target?.closest("[data-element-id]");
      const nodeId = nodeEl?.getAttribute("data-element-id") || panel.hitTest(panel.viewport.toWorld(screen));
      canvasEl.focus({ preventScroll: true });
      event.preventDefault();
      pointerId = event.pointerId;
      pointerStart = { ...screen };
      try {
        canvasEl.setPointerCapture(event.pointerId);
      } catch {
      }
      didMutate = false;
      if (handleAttr && RESIZE_HANDLES.has(handleAttr) && panel.selection.getSelectedIds().length > 0) {
        panel.controller.startResize(handleAttr, screen);
        commitLabel = `resize-${handleAttr}`;
        liveSync();
        return;
      }
      const panRequested = event.button === 1 || spaceDown || event.altKey;
      if (panRequested) {
        panel.controller.startPan(screen);
        commitLabel = "pan";
        liveSync();
        return;
      }
      if (!nodeId) {
        marqueeAdditive = event.shiftKey;
        marqueeBaseIds = marqueeAdditive ? panel.selection.getSelectedIds() : [];
        panel.controller.startBoxSelect(screen);
        commitLabel = "marquee";
        liveSync();
        return;
      }
      if (event.shiftKey) {
        panel.selection.toggleSelect(nodeId);
      } else if (!panel.selection.isSelected(nodeId)) {
        panel.select([nodeId]);
      }
      if (panel.selection.getSelectedIds().length > 0) {
        panel.controller.startDrag(screen);
        commitLabel = "move";
      }
      liveSync();
    };
    const onPointerMove = (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const screen = canvasPointFromEvent(canvasEl, event.clientX, event.clientY);
      const mode = panel.controller.getMode();
      if (mode === "panning") {
        panel.controller.updatePan(screen);
        refreshOverlay(canvasEl, panel);
        hooks.onHud();
        return;
      }
      if (mode === "box-selecting") {
        panel.updateMarquee(screen, marqueeAdditive, marqueeBaseIds);
        liveSync();
        return;
      }
      if (mode === "dragging") {
        const res = panel.moveSelected(screen);
        if (res) didMutate = true;
        liveSync();
        return;
      }
      if (mode === "resizing") {
        const res = panel.resizeSelected(screen);
        if (res) didMutate = true;
        liveSync();
      }
    };
    const onPointerUp = (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const mode = panel.controller.getMode();
      const screen = canvasPointFromEvent(canvasEl, event.clientX, event.clientY);
      if (mode === "box-selecting") {
        const dx = pointerStart ? screen.x - pointerStart.x : 0;
        const dy = pointerStart ? screen.y - pointerStart.y : 0;
        const dist = Math.hypot(dx, dy);
        if (dist < MARQUEE_CLICK_PX) {
          if (!marqueeAdditive) panel.selection.clearSelection();
          panel.controller.endBoxSelect();
        } else {
          panel.updateMarquee(screen, marqueeAdditive, marqueeBaseIds);
          panel.controller.endBoxSelect();
        }
      } else {
        endInteraction(panel);
      }
      pointerId = null;
      pointerStart = null;
      try {
        canvasEl.releasePointerCapture(event.pointerId);
      } catch {
      }
      liveSync();
      if (didMutate && (mode === "dragging" || mode === "resizing")) {
        hooks.onCommit(commitLabel);
      }
      didMutate = false;
    };
    const onWheel = (event) => {
      event.preventDefault();
      const screen = canvasPointFromEvent(canvasEl, event.clientX, event.clientY);
      panel.viewport.handleWheel({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        clientX: screen.x,
        clientY: screen.y,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      });
      refreshOverlay(canvasEl, panel);
      hooks.onHud();
    };
    const onKeyDown = (event) => {
      if (event.code === "Space") {
        spaceDown = true;
        canvasEl.style.cursor = "grab";
      }
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        panel.selection.clearSelection();
        liveSync();
        event.preventDefault();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const ids = panel.selection.getSelectedIds();
        if (ids.length === 0) return;
        event.preventDefault();
        for (const id of ids) {
          panel.unregisterElement(id);
        }
        panel.selection.clearSelection();
        hooks.onFullRender();
        hooks.onCommit("delete-element");
      }
    };
    const onKeyUp = (event) => {
      if (event.code === "Space") {
        spaceDown = false;
        canvasEl.style.cursor = "";
      }
    };
    canvasEl.tabIndex = 0;
    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", onPointerUp);
    canvasEl.addEventListener("pointercancel", onPointerUp);
    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerup", onPointerUp);
      canvasEl.removeEventListener("pointercancel", onPointerUp);
      canvasEl.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }

  // src/client/previewApp.ts
  function autosaveClearsDirty(httpOk, result, expected) {
    if (!httpOk || result?.success === false) return false;
    if (expected?.localEditId !== void 0 && result?.localEditId !== expected.localEditId) return false;
    if (expected?.ackRevision !== void 0 && result?.ackRevision !== expected.ackRevision) return false;
    return true;
  }
  var GATED_TOOLS = /* @__PURE__ */ new Set([
    "apply_to_project",
    "batch_apply",
    "project_write",
    "project_write_batch",
    "project_edit",
    "project_delete",
    "local_write",
    "local_edit",
    "accept_source_patch"
  ]);
  var CARD_ID = "hero-card";
  var BADGE_ID = "status-badge";
  var TITLE_ID = "hero-title";
  var BODY_ID = "hero-body";
  var BTN_ID = "primary-btn";
  var BATCH_FILE = "src/agent-batch-demo.txt";
  var FILL_SWATCHES = ["slate-900", "emerald-600", "indigo-600", "rose-600"];
  var TEXT_SWATCHES = ["slate-100", "amber-300", "rose-400", "emerald-400"];
  var RADIUS_VALUES = ["none", "md", "xl", "full"];
  var PADDING_VALUES = ["2", "4", "6", "8"];
  var SHADOW_VALUES = ["none", "sm", "md", "lg"];
  function seedStore(store) {
    store.setElement({
      id: CARD_ID,
      type: "element",
      tag: "article",
      props: {
        className: "w-[380px] p-6 rounded-2xl bg-slate-900 border-2 border-indigo-500 shadow-xl text-slate-100",
        "data-testid": "hero-card"
      },
      canvasRect: { left: 60, top: 40, width: 380, height: 250 }
    });
    store.setElement({
      id: BADGE_ID,
      type: "element",
      tag: "span",
      props: {
        className: "inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      },
      textContent: "Live canvas",
      canvasRect: { left: 76, top: 56, width: 120, height: 24 }
    });
    store.setElement({
      id: TITLE_ID,
      type: "element",
      tag: "h2",
      props: { className: "text-xl font-bold tracking-tight mt-4" },
      textContent: "OpenDesigner",
      canvasRect: { left: 76, top: 96, width: 320, height: 32 }
    });
    store.setElement({
      id: BODY_ID,
      type: "element",
      tag: "p",
      props: { className: "text-xs text-slate-400 mt-2 leading-relaxed" },
      textContent: "Select a region. State intent. Accept or reject. Apply writes real file diffs, not only canvas.json.",
      canvasRect: { left: 76, top: 136, width: 320, height: 48 }
    });
    store.setElement({
      id: BTN_ID,
      type: "element",
      tag: "button",
      props: {
        className: "mt-4 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg",
        "data-testid": "primary-btn"
      },
      textContent: "Pay now",
      canvasRect: { left: 76, top: 200, width: 88, height: 32 }
    });
    store.attachChild(CARD_ID, BADGE_ID);
    store.attachChild(CARD_ID, TITLE_ID);
    store.attachChild(CARD_ID, BODY_ID);
    store.attachChild(CARD_ID, BTN_ID);
    store.addPage({ id: "page-home", name: "Home", isLoaded: true, rootElementId: CARD_ID });
    store.setActivePage("page-home");
  }
  function classNameOf(store, id) {
    const el = store.getElement(id);
    return typeof el?.props.className === "string" ? el.props.className : "";
  }
  function setClassName(store, id, className) {
    const el = store.getElement(id);
    if (!el) return;
    el.props = { ...el.props, className };
    store.setElement(el);
  }
  function listElementIds(store) {
    return Object.keys(store.toJSON().byId);
  }
  function swatchButtons(prefix, values, kind) {
    return values.map((value) => {
      const colorClass = `bg-${value}`;
      return `<button type="button" class="od-swatch ${colorClass}" data-testid="${prefix}-${value}" data-value="${value}" data-tooltip="${kind === "bg" ? "Fill" : "Text"} ${value}"></button>`;
    }).join("");
  }
  function mountPreview(root, api = {}) {
    const store = new FlatStore();
    const panel = new CanvasPanel({ store, handleSize: 12 });
    let dirty = false;
    let openBatchId = null;
    let lastSeenVersion = 0;
    let projectId = null;
    let proposal = null;
    let hasLiveModel = false;
    let fileDiffCount = 0;
    let pendingEditId = 0;
    let saveQueue = Promise.resolve();
    function syncGeometry() {
      panel.clearRegisteredRects();
      for (const [id, el] of Object.entries(store.toJSON().byId)) {
        if (el.canvasRect) {
          panel.registerElement(id, el.canvasRect, el);
        }
      }
    }
    root.innerHTML = `
    <div class="od-shell">
      <header class="od-header">
        <div>
          <div class="od-title">dsh-opendesigner</div>
          <div class="od-sub">Select a region, state intent, accept or reject. Apply is a file diff.</div>
        </div>
        <div id="od-status" class="od-status" data-testid="plugin-status">loading status</div>
      </header>
      <div class="od-main">
        <aside class="od-layers" data-testid="layer-tree"></aside>
        <div class="od-canvas-col">
          <div class="od-canvas-toolbar" data-testid="canvas-toolbar">
            <button type="button" data-testid="zoom-out" id="od-zoom-out" data-tooltip="Zoom out">\u2212</button>
            <span class="od-zoom-label" data-testid="zoom-label" id="od-zoom-label" data-tooltip="Current zoom">100%</span>
            <button type="button" data-testid="zoom-in" id="od-zoom-in" data-tooltip="Zoom in">+</button>
            <button type="button" data-testid="zoom-reset" id="od-zoom-reset" data-tooltip="Reset pan and zoom">Reset view</button>
            <button type="button" data-testid="insert-box" id="od-insert-box" data-tooltip="Insert a sibling box">Insert box</button>
            <button type="button" data-testid="delete-element" id="od-delete-element" data-tooltip="Delete selected">Delete</button>
            <span class="od-hud" data-testid="canvas-hud" id="od-hud">idle</span>
          </div>
          <div class="od-hint" data-testid="editor-hint">Drag empty canvas to marquee-select \xB7 Space-drag or middle-drag to pan \xB7 Wheel pans \xB7 Ctrl+wheel zooms at cursor \xB7 Min size 8\xD78</div>
          <section class="od-canvas" id="od-canvas" data-testid="canvas-surface"></section>
        </div>
        <aside class="od-styles">
          <div class="od-styles-title">Styles (local)</div>
          <div id="od-selected" class="od-mono" data-testid="selected-id"></div>
          <div id="od-inspector" class="od-inspector" data-testid="styles-inspector"></div>
          <div class="od-actions">
            <button type="button" data-testid="edit-fill" id="od-edit-fill" data-tooltip="Local fill emerald">Fill emerald</button>
            <button type="button" data-testid="edit-radius" id="od-edit-radius" data-tooltip="Local radius xl">Radius xl</button>
            <button type="button" data-testid="edit-shadow" id="od-edit-shadow" data-tooltip="Local shadow-lg">Shadow lg</button>
          </div>
          <div class="od-styles-title">Intent (zh/en)</div>
          <textarea id="od-intent" class="od-intent" data-testid="ai-intent" rows="3" placeholder="\u4F8B\u5982\uFF1A\u628A\u6309\u94AE\u6539\u6210\u7FE0\u7EFF / make the button emerald"></textarea>
          <div class="od-actions">
            <button type="button" data-testid="ai-propose" id="od-ai-propose" data-tooltip="Propose a scoped ChangeSet. Does not write until you accept.">\u63D0\u51FA\u4FEE\u6539</button>
            <button type="button" data-testid="ai-accept" id="od-ai-accept" disabled data-tooltip="Accept the proposal and checkpoint">\u63A5\u53D7</button>
            <button type="button" data-testid="ai-reject" id="od-ai-reject" disabled data-tooltip="Reject with no residue">\u62D2\u7EDD</button>
          </div>
          <div class="od-hint" data-testid="receipt-kind">Local HTTP debug receipts are not human approval of a seen diff. Accept binds the exact diff hash. Reject writes nothing.</div>
          </div>
          <div class="od-styles-title">Save / Rewind</div>
          <div id="od-autosave" class="od-mono" data-testid="autosave-indicator">working copy: pending</div>
          <div class="od-actions">
            <button type="button" data-testid="rewind" id="od-rewind" data-tooltip="Rewind one checkpoint">Rewind</button>
            <button type="button" data-testid="save-design" id="od-save-design" data-tooltip="Write .designer/canvas.json only">\u4FDD\u5B58\u8BBE\u8BA1\u7A3F</button>
            <button type="button" data-testid="apply-files" id="od-apply-files" disabled data-tooltip="Apply real file diffs from the open agent batch">\u5E94\u7528\u5230\u5DE5\u7A0B</button>
          </div>
          <div class="od-styles-title">Agent batch</div>
          <div class="od-actions">
            <button type="button" data-testid="batch-create" id="od-batch-create" data-tooltip="Create an isolated agent worktree">Create batch</button>
            <button type="button" data-testid="batch-write" id="od-batch-write" data-tooltip="Write a jailed file inside the batch worktree">Write batch file</button>
            <button type="button" data-testid="batch-discard" id="od-batch-discard" data-tooltip="Discard the agent worktree">Discard batch</button>
          </div>
          <pre id="od-persist" class="od-mono" data-testid="persist-log">persistence idle</pre>
          <pre id="od-ai-banner" class="od-mono" data-testid="ai-live-banner">Model path: propose ChangeSet, then accept or reject</pre>
          <pre id="od-class" class="od-mono" data-testid="class-output"></pre>
          <pre id="od-ai" class="od-mono" data-testid="ai-output"></pre>
          <div class="od-styles-title">Stubs</div>
          <div class="od-hint" data-testid="stub-note">get_theme, search_icons, and set_icon_library are stubs. They are not implemented in this preview.</div>
        </aside>
      </div>
    </div>
  `;
    const canvasEl = root.querySelector("#od-canvas");
    const layersEl = root.querySelector(".od-layers");
    const selectedEl = root.querySelector("#od-selected");
    const classEl = root.querySelector("#od-class");
    const statusEl = root.querySelector("#od-status");
    const aiEl = root.querySelector("#od-ai");
    const aiBannerEl = root.querySelector("#od-ai-banner");
    const persistEl = root.querySelector("#od-persist");
    const autosaveEl = root.querySelector("#od-autosave");
    const inspectorEl = root.querySelector("#od-inspector");
    const hudEl = root.querySelector("#od-hud");
    const zoomLabelEl = root.querySelector("#od-zoom-label");
    const intentEl = root.querySelector("#od-intent");
    const proposeBtn = root.querySelector("#od-ai-propose");
    const acceptBtn = root.querySelector("#od-ai-accept");
    const rejectBtn = root.querySelector("#od-ai-reject");
    const applyFilesBtn = root.querySelector("#od-apply-files");
    function selectedId() {
      return panel.selection.getSelectedIds()[0] || "";
    }
    function syncProposalButtons() {
      acceptBtn.disabled = !proposal;
      rejectBtn.disabled = !proposal;
      applyFilesBtn.disabled = !openBatchId || fileDiffCount === 0;
      proposeBtn.disabled = false;
      proposeBtn.title = hasLiveModel ? "Propose a structured patch of the selected source node" : "Supported zh/en intents map onto a real source patch. Live model is used when configured.";
    }
    function updateHud() {
      const ids = panel.selection.getSelectedIds();
      const box = panel.getSelectedBoundingBox();
      const zoom = Math.round(panel.viewport.getZoom() * 100);
      const pan = panel.viewport.getPan();
      const rectText = box ? `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}\xD7${Math.round(box.height)}` : "none";
      hudEl.textContent = `${panel.controller.getMode()} \xB7 z${zoom}% \xB7 pan ${Math.round(pan.x)},${Math.round(pan.y)} \xB7 ${ids.join(",") || "none"} \xB7 ${rectText} \xB7 guides ${panel.controller.getGuides().length}`;
      zoomLabelEl.textContent = `${zoom}%`;
    }
    function renderInspector() {
      const id = selectedId();
      if (!id) {
        inspectorEl.innerHTML = `<div class="od-hint">Select an element to edit fill, radius, padding, text color, and shadow locally.</div>`;
        return;
      }
      const className = classNameOf(store, id);
      const parsed = StylesPanelManager.parseClasses(className);
      inspectorEl.innerHTML = `
      <div class="od-field">
        <div class="od-field-label">Fill ${parsed.backgroundColor || ""}</div>
        <div class="od-swatches">${swatchButtons("style-fill", FILL_SWATCHES, "bg")}</div>
      </div>
      <div class="od-field">
        <div class="od-field-label">Radius ${parsed.borderRadius || ""}</div>
        <div class="od-chip-row">${RADIUS_VALUES.map((value) => `<button type="button" data-testid="style-radius-${value}" data-radius="${value}" data-tooltip="Border radius ${value}">${value}</button>`).join("")}</div>
      </div>
      <div class="od-field">
        <div class="od-field-label">Padding ${parsed.padding || parsed.paddingX || ""}</div>
        <div class="od-chip-row">${PADDING_VALUES.map((value) => `<button type="button" data-testid="style-padding-${value}" data-padding="${value}" data-tooltip="Padding p-${value}">p-${value}</button>`).join("")}</div>
      </div>
      <div class="od-field">
        <div class="od-field-label">Text color ${parsed.textColor || ""}</div>
        <div class="od-swatches">${swatchButtons("style-text", TEXT_SWATCHES, "text")}</div>
      </div>
      <div class="od-field">
        <div class="od-field-label">Shadow</div>
        <div class="od-chip-row">${SHADOW_VALUES.map((value) => `<button type="button" data-testid="style-shadow-${value}" data-shadow="${value}" data-tooltip="Local shadow ${value}">${value}</button>`).join("")}</div>
      </div>
    `;
    }
    function renderLayers() {
      const ids = listElementIds(store);
      layersEl.innerHTML = `<div class="od-styles-title">Layers</div>` + ids.map((id) => {
        const el = store.getElement(id);
        const selected = panel.selection.isSelected(id);
        return `<button type="button" class="od-layer${selected ? " is-selected" : ""}" data-testid="layer-${id}" data-id="${id}">${el?.tag || "node"} ${id}</button>`;
      }).join("");
    }
    function render(options = {}) {
      const selected = panel.selection.getSelectedIds();
      syncGeometry();
      if (selected.length) panel.select(selected.filter((id2) => store.getElement(id2)));
      canvasEl.innerHTML = panel.renderHtml();
      renderLayers();
      renderInspector();
      const id = selectedId();
      selectedEl.textContent = id || "(none)";
      classEl.textContent = id ? classNameOf(store, id) : "";
      updateHud();
      syncProposalButtons();
      if (options.preserveViewport) refreshOverlay(canvasEl, panel);
    }
    async function refreshStatus() {
      if (!api.getStatus) return;
      const status = await api.getStatus();
      const persistence = status.persistence || {};
      const ai = status.ai || {};
      projectId = typeof status.projectId === "string" ? status.projectId : projectId;
      hasLiveModel = ai.hasApiKey === true && ai.mockMode !== true;
      statusEl.textContent = `plugin ${status.name} | project ${projectId || "\u2014"} v${lastSeenVersion} | jail ${status.projectRoot} | ai ${ai.provider || "none"}/${ai.model || "none"} hasApiKey=${ai.hasApiKey === true}`;
      autosaveEl.textContent = `working copy ${persistence.lastAutosaveAt || "none"} | checkpoints ${persistence.checkpointCount ?? 0} | current ${persistence.currentCheckpointLabel || "none"} | dirty=${dirty}`;
      openBatchId = typeof persistence.openBatchId === "string" ? persistence.openBatchId : null;
      fileDiffCount = 0;
      if (openBatchId && api.callTool) {
        const diffs = await api.callTool("batch_preview", { batchId: openBatchId });
        if (Array.isArray(diffs.diffs)) fileDiffCount = diffs.diffs.length;
        else if (Array.isArray(diffs.copied)) fileDiffCount = diffs.copied.length;
      }
      syncProposalButtons();
    }
    async function pushAuthoritativeCanvas() {
      if (!api.pushCanvas) return true;
      const payload = {
        ...store.toJSON(),
        projectId,
        baseVersion: lastSeenVersion
      };
      try {
        const result = await api.pushCanvas(payload);
        if (result.success === false) {
          persistEl.textContent = JSON.stringify(result, null, 2);
          return false;
        }
        if (typeof result.version === "number") lastSeenVersion = result.version;
        else lastSeenVersion += 1;
        return true;
      } catch (err) {
        persistEl.textContent = `push failed: ${err instanceof Error ? err.message : String(err)}`;
        return false;
      }
    }
    async function callTool(tool, args = {}) {
      if (!api.callTool) {
        persistEl.textContent = "persistence API is not attached.";
        return { success: false, error: "no persistence API" };
      }
      if (tool === "checkpoint" || tool === "autosave" || tool === "apply_to_project") {
        const pushed = await pushAuthoritativeCanvas();
        if (!pushed) return { success: false, error: "STALE_HYDRATE" };
      }
      const result = await api.callTool(tool, args);
      const shown = { ...result };
      if (shown.store) shown.store = { restored: true };
      persistEl.textContent = JSON.stringify(shown, null, 2);
      if (typeof result.version === "number") lastSeenVersion = result.version;
      await refreshStatus();
      return result;
    }
    function markDirty() {
      dirty = true;
      pendingEditId += 1;
    }
    async function checkpointAndAutosave(label) {
      markDirty();
      const editId = pendingEditId;
      const work = async () => {
        const cp = await callTool("checkpoint", { label, kind: "canvas" });
        if (cp.success === false) return;
        const auto = await callTool("autosave", { localEditId: editId });
        if (autosaveClearsDirty(true, auto, { localEditId: editId, ackRevision: lastSeenVersion })) {
          dirty = pendingEditId !== editId ? true : false;
        }
      };
      saveQueue = saveQueue.then(work, work);
      await saveQueue;
    }
    function applyStyle(property, value, label) {
      const id = selectedId();
      if (!id) return;
      const next = StylesPanelManager.applyPropertyChange(classNameOf(store, id), property, value);
      setClassName(store, id, next);
      render();
      void checkpointAndAutosave(label);
    }
    function applyLocalShadow(value) {
      const id = selectedId() || CARD_ID;
      if (!selectedId()) panel.select([id]);
      const token = value === "none" ? "shadow-none" : `shadow-${value}`;
      const next = mergeTailwindClasses(classNameOf(store, id), token);
      setClassName(store, id, next);
      render();
      void checkpointAndAutosave(`shadow-${value}`);
    }
    function insertBox() {
      let n = 1;
      while (store.getElement(`insert-box-${n}`)) n += 1;
      const id = `insert-box-${n}`;
      const left = 470 + (n - 1) * 16;
      store.setElement({
        id,
        type: "element",
        tag: "div",
        props: {
          className: "rounded-lg bg-amber-400 text-slate-900 text-xs font-semibold px-3 py-2 shadow-md",
          "data-testid": `node-${id}`
        },
        textContent: `Insert ${n}`,
        canvasRect: { left, top: 48, width: 140, height: 88 }
      });
      panel.select([id]);
      render();
      void checkpointAndAutosave("insert-box");
    }
    function deleteSelected() {
      const ids = panel.selection.getSelectedIds();
      if (ids.length === 0) return;
      for (const id of ids) panel.unregisterElement(id);
      panel.selection.clearSelection();
      render();
      void checkpointAndAutosave("delete-element");
    }
    function zoomBy(factor) {
      const bounds = canvasEl.getBoundingClientRect();
      panel.viewport.zoomAt({ x: bounds.width / 2, y: bounds.height / 2 }, factor);
      refreshOverlay(canvasEl, panel);
      updateHud();
    }
    function clearProposal(message) {
      proposal = null;
      aiEl.textContent = message;
      syncProposalButtons();
    }
    layersEl.addEventListener("click", (event) => {
      const target = event.target;
      const id = target.getAttribute("data-id");
      if (!id) return;
      panel.select([id]);
      render();
    });
    inspectorEl.addEventListener("click", (event) => {
      const target = event.target;
      const fill = target.getAttribute("data-testid")?.startsWith("style-fill-") ? target.getAttribute("data-value") : null;
      const radius = target.getAttribute("data-radius");
      const padding = target.getAttribute("data-padding");
      const text = target.getAttribute("data-testid")?.startsWith("style-text-") ? target.getAttribute("data-value") : null;
      const shadow = target.getAttribute("data-shadow");
      if (fill) applyStyle("backgroundColor", fill, `fill-${fill}`);
      else if (radius) applyStyle("borderRadius", radius, `radius-${radius}`);
      else if (padding) applyStyle("padding", padding, `padding-${padding}`);
      else if (text) applyStyle("textColor", text, `text-${text}`);
      else if (shadow) applyLocalShadow(shadow);
    });
    root.querySelector("#od-edit-fill").addEventListener("click", () => {
      applyStyle("backgroundColor", "emerald-600", "fill-emerald");
    });
    root.querySelector("#od-edit-radius").addEventListener("click", () => {
      const id = selectedId() || CARD_ID;
      if (!selectedId()) panel.select([id]);
      const next = mergeTailwindClasses(classNameOf(store, id), "rounded-xl");
      setClassName(store, id, next);
      render();
      void checkpointAndAutosave("radius-xl");
    });
    root.querySelector("#od-edit-shadow").addEventListener("click", () => {
      applyLocalShadow("lg");
    });
    root.querySelector("#od-rewind").addEventListener("click", async () => {
      const result = await callTool("rewind");
      if (result.success && result.store) {
        store.fromJSON(result.store);
        const ids = listElementIds(store);
        panel.select(ids.includes(CARD_ID) ? [CARD_ID] : ids.slice(0, 1));
        clearProposal("Rewound. No pending ChangeSet.");
        render();
      }
    });
    root.querySelector("#od-save-design").addEventListener("click", () => {
      void callTool("apply_to_project");
    });
    root.querySelector("#od-apply-files").addEventListener("click", async () => {
      if (!openBatchId || fileDiffCount === 0) {
        persistEl.textContent = JSON.stringify({
          success: false,
          error: "\u5E94\u7528\u5230\u5DE5\u7A0B needs an open batch with file diffs"
        });
        return;
      }
      const result = await callTool("batch_apply", { batchId: openBatchId });
      if (result.success === true) {
        openBatchId = null;
        fileDiffCount = 0;
      }
      syncProposalButtons();
    });
    root.querySelector("#od-batch-create").addEventListener("click", async () => {
      const result = await callTool("batch_create", { label: "preview-batch" });
      if (result.success && typeof result.batchId === "string") {
        openBatchId = result.batchId;
      }
    });
    root.querySelector("#od-batch-write").addEventListener("click", () => {
      if (!openBatchId) {
        persistEl.textContent = JSON.stringify({
          success: false,
          error: "Create an Agent batch before writing isolated file diffs"
        });
        return;
      }
      void callTool("project_write_batch", {
        files: [{ path: BATCH_FILE, content: "agent-batch isolation write\n" }]
      });
    });
    root.querySelector("#od-batch-discard").addEventListener("click", async () => {
      if (!openBatchId) {
        persistEl.textContent = JSON.stringify({ success: false, error: "no open batch" });
        return;
      }
      await callTool("batch_discard", { batchId: openBatchId });
      openBatchId = null;
      fileDiffCount = 0;
      syncProposalButtons();
    });
    proposeBtn.addEventListener("click", async () => {
      const id = selectedId();
      if (!id) {
        aiEl.textContent = "Select a region that maps to a source node before proposing.";
        return;
      }
      const instruction = intentEl.value.trim();
      if (!instruction) {
        aiEl.textContent = "Write an intent in zh or en before proposing.";
        return;
      }
      const result = await callTool("propose_source_patch", { elementId: id, instruction });
      if (result.success && result.proposal && typeof result.proposal === "object") {
        proposal = result.proposal;
        aiBannerEl.textContent = `proposal ${proposal.id} file=${proposal.filePath} hash=${proposal.sourceHash.slice(0, 8)}`;
        aiEl.textContent = `${aiBannerEl.textContent}
intent: ${instruction}
before: ${proposal.beforeClassName}
after: ${proposal.afterClassName}
diffHash bind: ${proposal.afterHash || proposal.sourceHash}
${proposal.preview}
Accept writes this file. Reject leaves the repo unchanged.`;
        syncProposalButtons();
        return;
      }
      proposal = null;
      syncProposalButtons();
      aiBannerEl.textContent = "AI propose failed";
      aiEl.textContent = String(result.error || "propose failed");
    });
    acceptBtn.addEventListener("click", async () => {
      if (!proposal) return;
      const accepted = proposal;
      const result = await callTool("accept_source_patch", { proposalId: accepted.id });
      if (result.success === false) {
        aiEl.textContent = `Accept refused: ${String(result.error || "stale or unsupported")}${result.code ? ` (${String(result.code)})` : ""}`;
        return;
      }
      if (result.store && typeof result.store === "object") {
        store.fromJSON(result.store);
      } else {
        const el = store.getElement(accepted.elementId);
        if (el) {
          el.props = { ...el.props, className: accepted.afterClassName };
          store.setElement(el);
        }
      }
      proposal = null;
      render();
      aiEl.textContent = `Accepted ${accepted.id}. Wrote ${accepted.filePath}. Rewind restores the file.`;
      syncProposalButtons();
    });
    rejectBtn.addEventListener("click", async () => {
      if (!proposal) return;
      await callTool("reject_source_patch");
      proposal = null;
      aiBannerEl.textContent = "ChangeSet rejected with no residue";
      aiEl.textContent = "Rejected. Store and repo unchanged. No write.";
      syncProposalButtons();
      render();
    });
    root.querySelector("#od-insert-box").addEventListener("click", () => insertBox());
    root.querySelector("#od-delete-element").addEventListener("click", () => deleteSelected());
    root.querySelector("#od-zoom-in").addEventListener("click", () => zoomBy(1.15));
    root.querySelector("#od-zoom-out").addEventListener("click", () => zoomBy(1 / 1.15));
    root.querySelector("#od-zoom-reset").addEventListener("click", () => {
      panel.viewport.reset();
      refreshOverlay(canvasEl, panel);
      updateHud();
    });
    bindPreviewCanvasUx(canvasEl, panel, store, {
      onCommit: (label) => {
        void checkpointAndAutosave(label);
      },
      onFullRender: () => render(),
      onHud: () => {
        renderLayers();
        renderInspector();
        const id = selectedId();
        selectedEl.textContent = id || "(none)";
        classEl.textContent = id ? classNameOf(store, id) : "";
        updateHud();
      }
    });
    bindFloatingTooltips(root);
    window.setInterval(() => {
      if (!dirty) return;
      const editId = pendingEditId;
      const work = async () => {
        const result = await callTool("autosave", { localEditId: editId });
        if (autosaveClearsDirty(true, result, { localEditId: editId, ackRevision: lastSeenVersion })) {
          dirty = pendingEditId !== editId ? true : false;
        }
      };
      saveQueue = saveQueue.then(work, work);
    }, 8e3);
    void (async () => {
      if (!api.getStatus) {
        statusEl.textContent = "standalone preview (no DSH host)";
        seedStore(store);
        const ids = listElementIds(store);
        panel.select(ids.slice(0, 1));
        render();
        return;
      }
      try {
        let restored = false;
        if (api.getCanvas) {
          const canvas = await api.getCanvas();
          if (canvas && canvas.byId && Object.keys(canvas.byId).length > 0) {
            store.fromJSON(canvas);
            if (typeof canvas.version === "number") lastSeenVersion = canvas.version;
            if (typeof canvas.projectId === "string") projectId = canvas.projectId;
            restored = true;
          }
        }
        if (!restored) {
          seedStore(store);
          await checkpointAndAutosave("seed");
        }
        const ids = listElementIds(store);
        const button = ids.find((id) => store.getElement(id)?.tag === "button") || ids[0];
        if (button) panel.select([button]);
        await refreshStatus();
        render();
      } catch (err) {
        statusEl.textContent = `status unavailable: ${err instanceof Error ? err.message : String(err)}`;
        seedStore(store);
        const ids = listElementIds(store);
        panel.select(ids.slice(0, 1));
        render();
      }
    })();
    return panel;
  }
  if (typeof window !== "undefined") {
    const boot = () => {
      const host = document.getElementById("opendesigner-root");
      if (!host) return;
      mountPreview(host, {
        getStatus: async () => {
          const res = await fetch("/api/status");
          if (!res.ok) throw new Error(`status HTTP ${res.status}`);
          return await res.json();
        },
        getCanvas: async () => {
          const res = await fetch("/api/canvas");
          if (!res.ok) throw new Error(`canvas HTTP ${res.status}`);
          return await res.json();
        },
        pushCanvas: async (canvas) => {
          const res = await fetch("/api/canvas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(canvas)
          });
          const body = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
          if (!res.ok) return { success: false, error: body.error || `HTTP ${res.status}` };
          return body;
        },
        callTool: async (tool, args = {}) => {
          let payloadArgs = { ...args };
          if (GATED_TOOLS.has(tool)) {
            const issued = await fetch("/api/approval", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tool, args: payloadArgs })
            });
            const receipt = await issued.json().catch(() => ({ success: false }));
            if (!issued.ok || receipt.success === false || typeof receipt.approvalReceipt !== "string") {
              return { success: false, error: receipt.error || "DENIED: no approval receipt", code: "DENIED" };
            }
            const persistHost = document.getElementById("od-persist");
            if (persistHost) {
              persistHost.textContent = `debug receipt (${String(receipt.receiptKind || "debug-http")}) \u2260 human approval of seen diff. tool=${tool} diffHash=${String(receipt.diffHash || "").slice(0, 16)}`;
            }
            payloadArgs = { ...payloadArgs, approvalReceipt: receipt.approvalReceipt };
          }
          const res = await fetch("/api/tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool, args: payloadArgs })
          });
          if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
          return await res.json();
        },
        applyAiMerge: async (source, instruction) => {
          const res = await fetch("/api/ai-merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceCode: source, instruction })
          });
          if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
          return await res.json();
        }
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
  return __toCommonJS(previewApp_exports);
})();
//# sourceMappingURL=app.js.map
