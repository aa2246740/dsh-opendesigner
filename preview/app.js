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
    mountPreview: () => mountPreview
  });

  // src/client/geometry.ts
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
    const width = Math.max(1, start.width + deltaWidth);
    const height = Math.max(1, start.height + deltaHeight);
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
          width: Math.max(1, relWidth * newGroupBox.width),
          height: Math.max(1, relHeight * newGroupBox.height)
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
      if (box) {
        parts.push(
          `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="${this.strokeColor}" stroke-width="1.5" />`
        );
        const half = this.handleSize / 2;
        const handles = this.computeHandles(box);
        for (const h of handles) {
          parts.push(
            `<rect class="resize-handle handle-${h.handle}" x="${h.point.x - half}" y="${h.point.y - half}" width="${this.handleSize}" height="${this.handleSize}" fill="#ffffff" stroke="${this.strokeColor}" stroke-width="1.5" style="pointer-events:auto;cursor:${h.cursor};" data-handle="${h.handle}" />`
          );
        }
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
  var FlatStore = class {
    state;
    constructor() {
      this.state = {
        byId: /* @__PURE__ */ new Map(),
        childrenByParent: /* @__PURE__ */ new Map(),
        parentByChild: /* @__PURE__ */ new Map(),
        pages: [],
        activePageId: ""
      };
    }
    /**
     * 注册或更新元素
     */
    setElement(el) {
      this.state.byId.set(el.id, el);
    }
    /**
     * 获取单个元素
     */
    getElement(id) {
      return this.state.byId.get(id);
    }
    /**
     * 获取父级元素
     */
    getParent(id) {
      const parentId = this.state.parentByChild.get(id);
      return parentId ? this.state.byId.get(parentId) : void 0;
    }
    /**
     * 获取直接子节点列表
     */
    getChildren(id) {
      const childIds = this.state.childrenByParent.get(id) ?? [];
      return childIds.map((cid) => this.state.byId.get(cid)).filter(Boolean);
    }
    /**
     * 建立父子关联
     */
    attachChild(parentId, childId, index) {
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
    /**
     * 检查 targetId 是否为 ancestorId 的后代节点（或自身）
     */
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
    /**
     * 移动节点层级并附带循环引用安全校验
     */
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
    /**
     * 深度克隆以 rootId 为根的整棵子树，自动重新生成 UUID
     */
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
          props: JSON.parse(JSON.stringify(el.props)),
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
    /**
     * 移除元素及其在关系表中的关联
     */
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
      const children = this.state.childrenByParent.get(id) ?? [];
      for (const childId of children) {
        this.removeElement(childId);
      }
      this.state.childrenByParent.delete(id);
      this.state.byId.delete(id);
    }
    /**
     * 广度优先提取以 rootId 为根的整棵子树
     */
    getSubtree(rootId) {
      const result = [];
      const queue = [rootId];
      while (queue.length > 0) {
        const currentId = queue.shift();
        const el = this.state.byId.get(currentId);
        if (!el) continue;
        result.push(el);
        const children = this.state.childrenByParent.get(currentId) ?? [];
        queue.push(...children);
      }
      return result;
    }
    /**
     * 获取所有无父级的顶层根节点 ID
     */
    getRootIds() {
      const rootIds = [];
      for (const id of this.state.byId.keys()) {
        if (!this.state.parentByChild.has(id)) {
          rootIds.push(id);
        }
      }
      return rootIds;
    }
    /**
     * 画布页面管理
     */
    addPage(page) {
      this.state.pages.push(page);
      if (!this.state.activePageId) {
        this.state.activePageId = page.id;
      }
    }
    getPages() {
      return this.state.pages;
    }
    setActivePage(pageId) {
      this.state.activePageId = pageId;
    }
    getActivePageId() {
      return this.state.activePageId;
    }
    /**
     * 导出为 JSON 序列化对象（用于本地 .designer/canvas.json 存储）
     */
    toJSON() {
      return {
        byId: Object.fromEntries(this.state.byId),
        childrenByParent: Object.fromEntries(this.state.childrenByParent),
        parentByChild: Object.fromEntries(this.state.parentByChild),
        pages: this.state.pages,
        activePageId: this.state.activePageId
      };
    }
    /**
     * 从 JSON 反序列化恢复 Store
     */
    fromJSON(data) {
      this.state.byId = new Map(Object.entries(data.byId || {}));
      this.state.childrenByParent = new Map(Object.entries(data.childrenByParent || {}));
      this.state.parentByChild = new Map(Object.entries(data.parentByChild || {}));
      this.state.pages = data.pages || [];
      this.state.activePageId = data.activePageId || "";
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
        const rawRight = startBox.left + Math.max(1, startBox.width + dx);
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
        newWidth = Math.max(1, bestRight - startBox.left);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedX = true;
        }
      } else if (handle.includes("w")) {
        const fixedRight = startBox.left + startBox.width;
        const rawLeft = startBox.left + dx;
        let bestLeft = Math.min(fixedRight - 1, rawLeft);
        let minDelta = Infinity;
        let snapGuide = null;
        if (enableSnapping) {
          for (const cand of candidates) {
            const candX = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
            for (const cx of candX) {
              const diff = Math.abs(cx - rawLeft);
              if (diff <= snapThreshold && diff < minDelta) {
                minDelta = diff;
                bestLeft = Math.min(fixedRight - 1, cx);
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
        newWidth = Math.max(1, fixedRight - bestLeft);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedX = true;
        }
      }
      let newTop = startBox.top;
      let newHeight = startBox.height;
      if (handle.includes("s")) {
        const rawBottom = startBox.top + Math.max(1, startBox.height + dy);
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
        newHeight = Math.max(1, bestBottom - startBox.top);
        if (snapGuide) {
          guides.push(snapGuide);
          snappedY = true;
        }
      } else if (handle.includes("n")) {
        const fixedBottom = startBox.top + startBox.height;
        const rawTop = startBox.top + dy;
        let bestTop = Math.min(fixedBottom - 1, rawTop);
        let minDelta = Infinity;
        let snapGuide = null;
        if (enableSnapping) {
          for (const cand of candidates) {
            const candY = [cand.top, cand.top + cand.height / 2, cand.top + cand.height];
            for (const cy of candY) {
              const diff = Math.abs(cy - rawTop);
              if (diff <= snapThreshold && diff < minDelta) {
                minDelta = diff;
                bestTop = Math.min(fixedBottom - 1, cy);
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
        newHeight = Math.max(1, fixedBottom - bestTop);
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
    /**
     * 将 FlatStore 节点递归渲染为安全虚拟 DOM 结构
     */
    renderElement(store, elementId) {
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
        renderedChildren.push(this.renderElement(store, child.id));
      }
      let finalTag = el.tag;
      const finalProps = { ...el.props || {} };
      if (el.tag === "Image" || el.tag === "next/image") {
        const shim = this.nextShims.Image({
          src: finalProps.src || "/placeholder.svg",
          alt: finalProps.alt || "",
          width: finalProps.width,
          height: finalProps.height,
          fill: finalProps.fill,
          className: finalProps.className
        });
        finalTag = shim.type;
        Object.assign(finalProps, shim.props, { "data-next-image": "true" });
      } else if (el.tag === "Link" || el.tag === "next/link") {
        const shim = this.nextShims.Link({
          href: finalProps.href || "#",
          className: finalProps.className
        });
        finalTag = shim.type;
        Object.assign(finalProps, shim.props, { "data-next-link": "true" });
      }
      if (!finalProps["data-element-id"]) {
        finalProps["data-element-id"] = el.id;
      }
      return {
        tag: finalTag,
        props: finalProps,
        children: renderedChildren
      };
    }
    /**
     * 将虚拟渲染节点转换为 HTML 字符串（可直接注入 iframe 或 shadow DOM）
     */
    renderToHtml(store, rootId) {
      try {
        const node = this.renderElement(store, rootId);
        return this.nodeToHtmlString(node);
      } catch (err) {
        return this.renderErrorFallback(err);
      }
    }
    nodeToHtmlString(node) {
      if (typeof node === "string") {
        return this.escapeHtml(node);
      }
      const { tag, props, children } = node;
      const safeTag = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) ? tag : "div";
      const attrs = Object.entries(props).map(([k, v]) => {
        if (typeof v === "function") return "";
        if (k === "children") return "";
        const attrName = k === "className" ? "class" : k;
        if (k === "style" && typeof v === "object" && v !== null) {
          const css = Object.entries(v).map(([sk, sv]) => `${sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${sv}`).join(";");
          return `style="${this.escapeHtml(css)}"`;
        }
        if (typeof v === "string") return `${attrName}="${this.escapeHtml(v)}"`;
        if (typeof v === "boolean") return v ? attrName : "";
        if (typeof v === "number") return `${attrName}="${v}"`;
        return `${attrName}="${this.escapeHtml(JSON.stringify(v))}"`;
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
    /**
     * 优雅错误边界回退渲染
     */
    renderErrorFallback(error) {
      return `
      <div style="padding: 16px; border: 1px solid #ef4444; background: #fef2f2; color: #991b1b; border-radius: 8px; font-family: sans-serif;">
        <div style="font-weight: bold; margin-bottom: 4px;">\u26A0\uFE0F \u6C99\u7BB1\u6E32\u67D3\u9694\u79BB\u4FDD\u62A4</div>
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
    if (/^rounded-(t|b|l|r|tl|tr|bl|br)(-.*)?$/.test(baseToken)) {
      const side = baseToken.match(/^rounded-(t|b|l|r|tl|tr|bl|br)/)[1];
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
    if (/^flex-(1|auto|initial|none)$/.test(baseToken) || /^grow(-.*)?$/.test(baseToken) || /^shrink(-.*)?$/.test(baseToken)) {
      return `${prefix}flex-grow-shrink`;
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
      this.overlay = new SelectionOverlayRenderer();
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
        if (!element.canvasRect) {
          element.canvasRect = { ...rect };
        }
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
     * 执行拖拽移动 (打通 6 线智能吸附)
     */
    moveSelected(screenPoint) {
      const candidates = this.getAlignmentCandidates();
      const res = this.controller.updateDrag(screenPoint, {
        candidates,
        snapThreshold: this.snapThreshold,
        enableSnapping: true
      });
      if (res && res.updatedElements) {
        for (const item of res.updatedElements) {
          this.elementRects.set(item.id, { ...item.rect });
          const el = this.store.getElement(item.id);
          if (el) {
            el.canvasRect = { ...item.rect };
          }
        }
      }
      return res;
    }
    /**
     * 执行 8 向手柄缩放 (打通伴随几何与 6 线吸附)
     */
    resizeSelected(screenPoint) {
      const candidates = this.getAlignmentCandidates();
      const res = this.controller.updateResize(screenPoint, {
        candidates,
        snapThreshold: this.snapThreshold,
        enableSnapping: true
      });
      if (res && res.updatedElements) {
        for (const item of res.updatedElements) {
          this.elementRects.set(item.id, { ...item.rect });
          const el = this.store.getElement(item.id);
          if (el) {
            el.canvasRect = { ...item.rect };
          }
        }
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
      const overlaySvg = this.overlay.renderSvgOverlay(box, guides);
      return [
        `<div class="opendesigner-canvas-container" style="position:relative;width:100%;height:100%;overflow:hidden;background:#0f172a;">`,
        `  <div class="canvas-viewport-layer" style="transform-origin:0 0;transform:${transformStyle};position:absolute;top:0;left:0;">`,
        `    ${elementsHtml.join("\n    ")}`,
        `    ${overlaySvg}`,
        `  </div>`,
        `</div>`
      ].join("\n");
    }
  };

  // src/client/previewApp.ts
  var CARD_ID = "hero-card";
  var BADGE_ID = "status-badge";
  var TITLE_ID = "hero-title";
  var BODY_ID = "hero-body";
  var BTN_ID = "primary-btn";
  var BATCH_FILE = "src/agent-batch-demo.txt";
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
      textContent: "Code is the canvas. Style edits update the live className with deterministic Tailwind slot merge.",
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
      textContent: "Build",
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
  function mountPreview(root, api = {}) {
    const store = new FlatStore();
    const panel = new CanvasPanel({ store });
    let dirty = false;
    let openBatchId = null;
    function syncGeometry() {
      panel.clearRegisteredRects();
      for (const [id, el] of Object.entries(store.toJSON().byId)) {
        if (el.canvasRect) {
          panel.registerElement(id, el.canvasRect, el);
        }
      }
    }
    function markDirty() {
      dirty = true;
    }
    root.innerHTML = `
    <div class="od-shell">
      <header class="od-header">
        <div>
          <div class="od-title">dsh-opendesigner</div>
          <div class="od-sub">DeepSeek Harness plugin preview</div>
        </div>
        <div id="od-status" class="od-status" data-testid="plugin-status">loading status</div>
      </header>
      <div class="od-main">
        <aside class="od-layers" data-testid="layer-tree"></aside>
        <section class="od-canvas" id="od-canvas" data-testid="canvas-surface"></section>
        <aside class="od-styles">
          <div class="od-styles-title">Styles</div>
          <div id="od-selected" class="od-mono"></div>
          <div class="od-actions">
            <button type="button" data-testid="edit-fill" id="od-edit-fill">Fill emerald</button>
            <button type="button" data-testid="edit-radius" id="od-edit-radius">Radius xl</button>
            <button type="button" data-testid="ai-merge" id="od-ai-merge">AI merge</button>
          </div>
          <div class="od-styles-title">Save / Rewind</div>
          <div id="od-autosave" class="od-mono" data-testid="autosave-indicator">working copy: pending</div>
          <div class="od-actions">
            <button type="button" data-testid="rewind" id="od-rewind">Rewind</button>
            <button type="button" data-testid="apply-project" id="od-apply-project">Save / Apply to project</button>
          </div>
          <div class="od-styles-title">Agent batch</div>
          <div class="od-actions">
            <button type="button" data-testid="batch-create" id="od-batch-create">Create batch</button>
            <button type="button" data-testid="batch-write" id="od-batch-write">Write batch file</button>
            <button type="button" data-testid="batch-apply" id="od-batch-apply">Apply batch</button>
            <button type="button" data-testid="batch-discard" id="od-batch-discard">Discard batch</button>
          </div>
          <pre id="od-persist" class="od-mono" data-testid="persist-log">persistence idle</pre>
          <pre id="od-class" class="od-mono" data-testid="class-output"></pre>
          <pre id="od-ai" class="od-mono" data-testid="ai-output"></pre>
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
    const persistEl = root.querySelector("#od-persist");
    const autosaveEl = root.querySelector("#od-autosave");
    function render() {
      syncGeometry();
      canvasEl.innerHTML = panel.renderHtml();
      const ids = [CARD_ID, BADGE_ID, TITLE_ID, BODY_ID, BTN_ID];
      layersEl.innerHTML = ids.map((id) => {
        const el = store.getElement(id);
        const selected = panel.selection.getSelectedIds().includes(id);
        return `<button type="button" class="od-layer${selected ? " is-selected" : ""}" data-id="${id}">${el?.tag} ${id}</button>`;
      }).join("");
      const selectedId = panel.selection.getSelectedIds()[0] || CARD_ID;
      selectedEl.textContent = selectedId;
      classEl.textContent = classNameOf(store, selectedId);
    }
    async function refreshStatus() {
      if (!api.getStatus) return;
      const status = await api.getStatus();
      const persistence = status.persistence || {};
      statusEl.textContent = `plugin ${status.name} | jail ${status.projectRoot} | autoApprove=${status.autoApprove}`;
      autosaveEl.textContent = `working copy ${persistence.lastAutosaveAt || "none"} | checkpoints ${persistence.checkpointCount ?? 0} | current ${persistence.currentCheckpointLabel || "none"}`;
      openBatchId = typeof persistence.openBatchId === "string" ? persistence.openBatchId : null;
    }
    async function callTool(tool, args = {}) {
      if (!api.callTool) {
        persistEl.textContent = "persistence API is not attached.";
        return { success: false, error: "no persistence API" };
      }
      if (api.pushCanvas && (tool === "checkpoint" || tool === "autosave" || tool === "apply_to_project")) {
        await api.pushCanvas(store.toJSON());
      }
      const result = await api.callTool(tool, args);
      persistEl.textContent = JSON.stringify(result, null, 2);
      await refreshStatus();
      return result;
    }
    async function checkpointAndAutosave(label) {
      markDirty();
      await callTool("checkpoint", { label, kind: "canvas" });
      await callTool("autosave");
      dirty = false;
    }
    layersEl.addEventListener("click", (event) => {
      const target = event.target;
      const id = target.getAttribute("data-id");
      if (!id) return;
      panel.select([id]);
      render();
    });
    root.querySelector("#od-edit-fill").addEventListener("click", () => {
      const id = panel.selection.getSelectedIds()[0] || CARD_ID;
      const next = StylesPanelManager.applyPropertyChange(classNameOf(store, id), "backgroundColor", "emerald-600");
      setClassName(store, id, next);
      render();
      void checkpointAndAutosave("fill-emerald");
    });
    root.querySelector("#od-edit-radius").addEventListener("click", () => {
      const id = panel.selection.getSelectedIds()[0] || CARD_ID;
      const next = mergeTailwindClasses(classNameOf(store, id), "rounded-xl");
      setClassName(store, id, next);
      render();
      void checkpointAndAutosave("radius-xl");
    });
    root.querySelector("#od-rewind").addEventListener("click", async () => {
      const result = await callTool("rewind");
      if (result.success && result.store) {
        store.fromJSON(result.store);
        panel.select([CARD_ID]);
        render();
      }
    });
    root.querySelector("#od-apply-project").addEventListener("click", () => {
      void callTool("apply_to_project", { approve: true });
    });
    root.querySelector("#od-batch-create").addEventListener("click", async () => {
      const result = await callTool("batch_create", { label: "preview-batch" });
      if (result.success && typeof result.batchId === "string") {
        openBatchId = result.batchId;
      }
    });
    root.querySelector("#od-batch-write").addEventListener("click", () => {
      void callTool("project_write", {
        path: BATCH_FILE,
        content: "agent-batch isolation write\n",
        approve: true
      });
    });
    root.querySelector("#od-batch-apply").addEventListener("click", async () => {
      if (!openBatchId) {
        persistEl.textContent = JSON.stringify({ success: false, error: "no open batch" });
        return;
      }
      await callTool("batch_apply", { batchId: openBatchId, approve: true });
      openBatchId = null;
    });
    root.querySelector("#od-batch-discard").addEventListener("click", async () => {
      if (!openBatchId) {
        persistEl.textContent = JSON.stringify({ success: false, error: "no open batch" });
        return;
      }
      await callTool("batch_discard", { batchId: openBatchId });
      openBatchId = null;
    });
    root.querySelector("#od-ai-merge").addEventListener("click", async () => {
      if (!api.applyAiMerge) {
        aiEl.textContent = "AI merge endpoint is not attached.";
        return;
      }
      const id = panel.selection.getSelectedIds()[0] || BTN_ID;
      const source = `<button className="${classNameOf(store, id)}">${store.getElement(id)?.textContent || ""}</button>`;
      const result = await api.applyAiMerge(source, "Add shadow-lg to the button className");
      if (result.success && result.mergedCode) {
        const match = result.mergedCode.match(/className="([^"]*)"/);
        if (match) setClassName(store, id, match[1]);
        aiEl.textContent = `model=${result.model || "unknown"}
${result.mergedCode}`;
        render();
        void checkpointAndAutosave("ai-merge");
      } else {
        aiEl.textContent = result.error || "AI merge failed";
      }
    });
    window.setInterval(() => {
      if (!dirty) return;
      dirty = false;
      void callTool("autosave");
    }, 8e3);
    void (async () => {
      if (!api.getStatus) {
        statusEl.textContent = "standalone preview (no DSH host)";
        seedStore(store);
        panel.select([CARD_ID]);
        render();
        return;
      }
      try {
        let restored = false;
        if (api.getCanvas) {
          const canvas = await api.getCanvas();
          if (canvas && canvas.byId && Object.keys(canvas.byId).length > 0) {
            store.fromJSON(canvas);
            restored = true;
          }
        }
        if (!restored) {
          seedStore(store);
          await checkpointAndAutosave("seed");
        }
        panel.select([CARD_ID]);
        await refreshStatus();
        render();
      } catch (err) {
        statusEl.textContent = `status unavailable: ${err instanceof Error ? err.message : String(err)}`;
        seedStore(store);
        panel.select([CARD_ID]);
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
          return await res.json();
        },
        getCanvas: async () => {
          const res = await fetch("/api/canvas");
          return await res.json();
        },
        pushCanvas: async (canvas) => {
          await fetch("/api/canvas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(canvas)
          });
        },
        callTool: async (tool, args = {}) => {
          const res = await fetch("/api/tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool, args })
          });
          return await res.json();
        },
        applyAiMerge: async (source, instruction) => {
          const res = await fetch("/api/ai-merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceCode: source, instruction })
          });
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
