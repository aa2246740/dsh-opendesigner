/**
 * dsh-opendesigner DSH Web Client Artifact
 * Compiled client bundle adhering to DSH __ModuleLoader__ specification
 */

(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    var exports = factory();
    root.DshOpenDesignerClient = exports;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // --- 2D Geometry & Affine Transforms ---
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

  function CanvasAffineMatrix(zoom, panX, panY) {
    this.a = zoom !== undefined ? zoom : 1.0;
    this.b = 0;
    this.c = 0;
    this.d = zoom !== undefined ? zoom : 1.0;
    this.e = panX !== undefined ? panX : 0;
    this.f = panY !== undefined ? panY : 0;
  }

  CanvasAffineMatrix.prototype.transformPoint = function (p) {
    return {
      x: this.a * p.x + this.c * p.y + this.e,
      y: this.b * p.x + this.d * p.y + this.f
    };
  };

  CanvasAffineMatrix.prototype.inverseTransformPoint = function (p) {
    var det = this.a * this.d - this.b * this.c;
    if (det === 0) throw new Error("Singular matrix cannot be inverted");
    return {
      x: (this.d * (p.x - this.e) - this.c * (p.y - this.f)) / det,
      y: (this.a * (p.y - this.f) - this.b * (p.x - this.e)) / det
    };
  };

  function companionGeometry(start, handle, deltaWidth, deltaHeight) {
    var width = Math.max(1, start.width + deltaWidth);
    var height = Math.max(1, start.height + deltaHeight);
    return {
      width: width,
      height: height,
      left: handle.indexOf("w") !== -1 ? start.left - (width - start.width) : start.left,
      top: handle.indexOf("n") !== -1 ? start.top - (height - start.height) : start.top
    };
  }

  function computeBoundingBox(rects) {
    if (!rects || rects.length === 0) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    var minLeft = Infinity;
    var minTop = Infinity;
    var maxRight = -Infinity;
    var maxBottom = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.left < minLeft) minLeft = r.left;
      if (r.top < minTop) minTop = r.top;
      if (r.left + r.width > maxRight) maxRight = r.left + r.width;
      if (r.top + r.height > maxBottom) maxBottom = r.top + r.height;
    }
    return {
      left: minLeft,
      top: minTop,
      width: Math.max(0, maxRight - minLeft),
      height: Math.max(0, maxBottom - minTop)
    };
  }

  function multiResize(elements, groupStartBox, handle, deltaWidth, deltaHeight) {
    if (groupStartBox.width === 0 || groupStartBox.height === 0) return elements;
    var newGroupBox = companionGeometry(groupStartBox, handle, deltaWidth, deltaHeight);
    return elements.map(function (item) {
      var rect = item.rect;
      var relLeft = (rect.left - groupStartBox.left) / groupStartBox.width;
      var relTop = (rect.top - groupStartBox.top) / groupStartBox.height;
      var relWidth = rect.width / groupStartBox.width;
      var relHeight = rect.height / groupStartBox.height;
      return {
        id: item.id,
        rect: {
          left: newGroupBox.left + relLeft * newGroupBox.width,
          top: newGroupBox.top + relTop * newGroupBox.height,
          width: Math.max(1, relWidth * newGroupBox.width),
          height: Math.max(1, relHeight * newGroupBox.height)
        }
      };
    });
  }

  // --- 6-Line Smart Snapping ---
  function compute6LineSnapping(active, candidates, threshold) {
    threshold = threshold !== undefined ? threshold : 5;
    var bestDeltaX = null;
    var bestGuideX = null;
    var bestDeltaY = null;
    var bestGuideY = null;

    var activeVerticals = [
      { val: active.left },
      { val: active.left + active.width / 2 },
      { val: active.left + active.width }
    ];

    var activeHorizontals = [
      { val: active.top },
      { val: active.top + active.height / 2 },
      { val: active.top + active.height }
    ];

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      var candVerticals = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
      var candHorizontals = [cand.top, cand.top + cand.height / 2, cand.top + cand.height];

      for (var v = 0; v < activeVerticals.length; v++) {
        for (var cv = 0; cv < candVerticals.length; cv++) {
          var dx = candVerticals[cv] - activeVerticals[v].val;
          if (Math.abs(dx) <= threshold) {
            if (bestDeltaX === null || Math.abs(dx) < Math.abs(bestDeltaX)) {
              bestDeltaX = dx;
              bestGuideX = {
                orientation: "vertical",
                coordinate: candVerticals[cv],
                start: Math.min(active.top, cand.top),
                end: Math.max(active.top + active.height, cand.top + cand.height)
              };
            }
          }
        }
      }

      for (var h = 0; h < activeHorizontals.length; h++) {
        for (var ch = 0; ch < candHorizontals.length; ch++) {
          var dy = candHorizontals[ch] - activeHorizontals[h].val;
          if (Math.abs(dy) <= threshold) {
            if (bestDeltaY === null || Math.abs(dy) < Math.abs(bestDeltaY)) {
              bestDeltaY = dy;
              bestGuideY = {
                orientation: "horizontal",
                coordinate: candHorizontals[ch],
                start: Math.min(active.left, cand.left),
                end: Math.max(active.left + active.width, cand.left + cand.width)
              };
            }
          }
        }
      }
    }

    var guides = [];
    if (bestGuideX) guides.push(bestGuideX);
    if (bestGuideY) guides.push(bestGuideY);

    return {
      snappedRect: {
        left: bestDeltaX !== null ? active.left + bestDeltaX : active.left,
        top: bestDeltaY !== null ? active.top + bestDeltaY : active.top,
        width: active.width,
        height: active.height
      },
      guides: guides,
      snappedX: bestDeltaX !== null,
      snappedY: bestDeltaY !== null
    };
  }

  // --- Infinite Canvas Viewport ---
  function InfiniteCanvasViewport(initialState) {
    initialState = initialState || {};
    this.zoom = initialState.zoom || 1.0;
    this.panX = initialState.panX || 0;
    this.panY = initialState.panY || 0;
    this.minZoom = initialState.minZoom || 0.1;
    this.maxZoom = initialState.maxZoom || 5.0;
  }

  InfiniteCanvasViewport.prototype.pan = function (dx, dy) {
    this.panX += dx;
    this.panY += dy;
  };

  InfiniteCanvasViewport.prototype.zoomAt = function (screenPoint, zoomDelta) {
    var prevZoom = this.zoom;
    var nextZoom = Math.min(this.maxZoom, Math.max(this.minZoom, prevZoom * zoomDelta));
    if (nextZoom === prevZoom) return;
    var worldX = (screenPoint.x - this.panX) / prevZoom;
    var worldY = (screenPoint.y - this.panY) / prevZoom;
    this.zoom = nextZoom;
    this.panX = screenPoint.x - worldX * nextZoom;
    this.panY = screenPoint.y - worldY * nextZoom;
  };

  InfiniteCanvasViewport.prototype.reset = function () {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
  };

  InfiniteCanvasViewport.prototype.getZoom = function () {
    return this.zoom;
  };

  InfiniteCanvasViewport.prototype.getPan = function () {
    return { x: this.panX, y: this.panY };
  };

  InfiniteCanvasViewport.prototype.getCssTransform = function () {
    return "matrix(" + this.zoom + ", 0, 0, " + this.zoom + ", " + this.panX + ", " + this.panY + ")";
  };

  // --- Selection Manager ---
  function SelectionManager() {
    this.selectedIds = [];
    this.elementRects = {};
  }

  SelectionManager.prototype.setElements = function (elements) {
    this.elementRects = {};
    for (var i = 0; i < elements.length; i++) {
      this.elementRects[elements[i].id] = elements[i].rect;
    }
  };

  SelectionManager.prototype.select = function (ids) {
    this.selectedIds = ids.slice();
  };

  SelectionManager.prototype.getBoundingBox = function () {
    var rects = [];
    for (var i = 0; i < this.selectedIds.length; i++) {
      var r = this.elementRects[this.selectedIds[i]];
      if (r) rects.push(r);
    }
    return computeBoundingBox(rects);
  };

  // --- Client Init ---
  function initDesignerClient() {
    return {
      viewport: new InfiniteCanvasViewport(),
      selection: new SelectionManager(),
      selectedElementIds: [],
      hoveredElementId: null
    };
  }

  var clientExports = {
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    CanvasAffineMatrix: CanvasAffineMatrix,
    companionGeometry: companionGeometry,
    computeBoundingBox: computeBoundingBox,
    multiResize: multiResize,
    compute6LineSnapping: compute6LineSnapping,
    InfiniteCanvasViewport: InfiniteCanvasViewport,
    SelectionManager: SelectionManager,
    initDesignerClient: initDesignerClient
  };

  // 挂载到 DSH 官方 ModuleLoader
  if (typeof window !== "undefined" && window.__ModuleLoader__) {
    window.__ModuleLoader__.load({
      id: "dsh-opendesigner",
      factory: function () {
        return clientExports;
      }
    });
  }

  return clientExports;
});
