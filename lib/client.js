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
    this.activeSession = null;
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

  SelectionManager.prototype.toggleSelect = function (id) {
    var idx = this.selectedIds.indexOf(id);
    if (idx !== -1) {
      this.selectedIds.splice(idx, 1);
    } else {
      this.selectedIds.push(id);
    }
  };

  SelectionManager.prototype.clearSelection = function () {
    this.selectedIds = [];
  };

  SelectionManager.prototype.getSelectedIds = function () {
    return this.selectedIds.slice();
  };

  SelectionManager.prototype.isSelected = function (id) {
    return this.selectedIds.indexOf(id) !== -1;
  };

  SelectionManager.prototype.getBoundingBox = function () {
    var rects = [];
    for (var i = 0; i < this.selectedIds.length; i++) {
      var r = this.elementRects[this.selectedIds[i]];
      if (r) rects.push(r);
    }
    return computeBoundingBox(rects);
  };

  SelectionManager.prototype.getHandles = function (box) {
    var targetBox = box || this.getBoundingBox();
    if (!targetBox) return [];
    var left = targetBox.left;
    var top = targetBox.top;
    var width = targetBox.width;
    var height = targetBox.height;
    var midX = left + width / 2;
    var midY = top + height / 2;
    var right = left + width;
    var bottom = top + height;

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
  };

  SelectionManager.prototype.startResize = function (handle, cursorPoint) {
    var box = this.getBoundingBox();
    if (!box) return false;
    var elements = [];
    for (var i = 0; i < this.selectedIds.length; i++) {
      var id = this.selectedIds[i];
      var r = this.elementRects[id];
      if (r) elements.push({ id: id, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
    }
    this.activeSession = {
      handle: handle,
      startBox: { left: box.left, top: box.top, width: box.width, height: box.height },
      startPoint: { x: cursorPoint.x, y: cursorPoint.y },
      elements: elements
    };
    return true;
  };

  SelectionManager.prototype.updateResize = function (currentCursor, options) {
    if (!this.activeSession) return null;
    options = options || {};
    var session = this.activeSession;
    var handle = session.handle;
    var startBox = session.startBox;
    var startPoint = session.startPoint;
    var elements = session.elements;

    var dx = currentCursor.x - startPoint.x;
    var dy = currentCursor.y - startPoint.y;
    var snapThreshold = options.snapThreshold !== undefined ? options.snapThreshold : 5;
    var candidates = options.candidates || [];
    var enableSnapping = options.enableSnapping !== false && candidates.length > 0;

    var guides = [];
    var snappedX = false;
    var snappedY = false;

    var newLeft = startBox.left;
    var newWidth = startBox.width;

    if (handle.indexOf("e") !== -1) {
      var rawRight = startBox.left + Math.max(1, startBox.width + dx);
      var bestRight = rawRight;
      var minDeltaX = Infinity;
      var snapGuideX = null;
      if (enableSnapping) {
        for (var i = 0; i < candidates.length; i++) {
          var cand = candidates[i];
          var candX = [cand.left, cand.left + cand.width / 2, cand.left + cand.width];
          for (var ci = 0; ci < candX.length; ci++) {
            var diffX = Math.abs(candX[ci] - rawRight);
            if (diffX <= snapThreshold && diffX < minDeltaX) {
              minDeltaX = diffX;
              bestRight = candX[ci];
              snapGuideX = {
                orientation: "vertical",
                coordinate: candX[ci],
                start: Math.min(startBox.top, cand.top),
                end: Math.max(startBox.top + startBox.height, cand.top + cand.height)
              };
            }
          }
        }
      }
      newLeft = startBox.left;
      newWidth = Math.max(1, bestRight - startBox.left);
      if (snapGuideX) {
        guides.push(snapGuideX);
        snappedX = true;
      }
    } else if (handle.indexOf("w") !== -1) {
      var fixedRight = startBox.left + startBox.width;
      var rawLeft = startBox.left + dx;
      var bestLeft = Math.min(fixedRight - 1, rawLeft);
      var minDeltaW = Infinity;
      var snapGuideW = null;
      if (enableSnapping) {
        for (var j = 0; j < candidates.length; j++) {
          var candW = candidates[j];
          var candXW = [candW.left, candW.left + candW.width / 2, candW.left + candW.width];
          for (var cj = 0; cj < candXW.length; cj++) {
            var diffW = Math.abs(candXW[cj] - rawLeft);
            if (diffW <= snapThreshold && diffW < minDeltaW) {
              minDeltaW = diffW;
              bestLeft = Math.min(fixedRight - 1, candXW[cj]);
              snapGuideW = {
                orientation: "vertical",
                coordinate: candXW[cj],
                start: Math.min(startBox.top, candW.top),
                end: Math.max(startBox.top + startBox.height, candW.top + candW.height)
              };
            }
          }
        }
      }
      newLeft = bestLeft;
      newWidth = Math.max(1, fixedRight - bestLeft);
      if (snapGuideW) {
        guides.push(snapGuideW);
        snappedX = true;
      }
    }

    var newTop = startBox.top;
    var newHeight = startBox.height;

    if (handle.indexOf("s") !== -1) {
      var rawBottom = startBox.top + Math.max(1, startBox.height + dy);
      var bestBottom = rawBottom;
      var minDeltaY = Infinity;
      var snapGuideY = null;
      if (enableSnapping) {
        for (var k = 0; k < candidates.length; k++) {
          var candS = candidates[k];
          var candYS = [candS.top, candS.top + candS.height / 2, candS.top + candS.height];
          for (var ck = 0; ck < candYS.length; ck++) {
            var diffY = Math.abs(candYS[ck] - rawBottom);
            if (diffY <= snapThreshold && diffY < minDeltaY) {
              minDeltaY = diffY;
              bestBottom = candYS[ck];
              snapGuideY = {
                orientation: "horizontal",
                coordinate: candYS[ck],
                start: Math.min(startBox.left, candS.left),
                end: Math.max(startBox.left + startBox.width, candS.left + candS.width)
              };
            }
          }
        }
      }
      newTop = startBox.top;
      newHeight = Math.max(1, bestBottom - startBox.top);
      if (snapGuideY) {
        guides.push(snapGuideY);
        snappedY = true;
      }
    } else if (handle.indexOf("n") !== -1) {
      var fixedBottom = startBox.top + startBox.height;
      var rawTop = startBox.top + dy;
      var bestTop = Math.min(fixedBottom - 1, rawTop);
      var minDeltaN = Infinity;
      var snapGuideN = null;
      if (enableSnapping) {
        for (var l = 0; l < candidates.length; l++) {
          var candN = candidates[l];
          var candYN = [candN.top, candN.top + candN.height / 2, candN.top + candN.height];
          for (var cl = 0; cl < candYN.length; cl++) {
            var diffN = Math.abs(candYN[cl] - rawTop);
            if (diffN <= snapThreshold && diffN < minDeltaN) {
              minDeltaN = diffN;
              bestTop = Math.min(fixedBottom - 1, candYN[cl]);
              snapGuideN = {
                orientation: "horizontal",
                coordinate: candYN[cl],
                start: Math.min(startBox.left, candN.left),
                end: Math.max(startBox.left + startBox.width, candN.left + candN.width)
              };
            }
          }
        }
      }
      newTop = bestTop;
      newHeight = Math.max(1, fixedBottom - bestTop);
      if (snapGuideN) {
        guides.push(snapGuideN);
        snappedY = true;
      }
    }

    var newBox = { left: newLeft, top: newTop, width: newWidth, height: newHeight };
    var updatedElements = [];
    if (elements.length === 1) {
      updatedElements = [{ id: elements[0].id, rect: newBox }];
    } else {
      updatedElements = multiResize(elements, startBox, handle, newBox.width - startBox.width, newBox.height - startBox.height);
    }

    for (var u = 0; u < updatedElements.length; u++) {
      this.elementRects[updatedElements[u].id] = updatedElements[u].rect;
    }

    return {
      newBox: newBox,
      updatedElements: updatedElements,
      guides: guides,
      snapped: snappedX || snappedY
    };
  };

  SelectionManager.prototype.moveSelection = function (deltaX, deltaY, options) {
    var box = this.getBoundingBox();
    if (!box) return null;
    options = options || {};
    var targetBox = { left: box.left + deltaX, top: box.top + deltaY, width: box.width, height: box.height };
    var guides = [];
    var snapped = false;

    if (options.enableSnapping !== false && options.candidates && options.candidates.length > 0) {
      var snapRes = compute6LineSnapping(targetBox, options.candidates, options.snapThreshold);
      targetBox = snapRes.snappedRect;
      guides = snapRes.guides;
      snapped = snapRes.snappedX || snapRes.snappedY;
    }

    var actualDx = targetBox.left - box.left;
    var actualDy = targetBox.top - box.top;
    var updated = [];

    for (var i = 0; i < this.selectedIds.length; i++) {
      var id = this.selectedIds[i];
      var r = this.elementRects[id];
      if (r) {
        var moved = { left: r.left + actualDx, top: r.top + actualDy, width: r.width, height: r.height };
        this.elementRects[id] = moved;
        updated.push({ id: id, rect: moved });
      }
    }

    return {
      newBox: targetBox,
      updatedElements: updated,
      guides: guides,
      snapped: snapped
    };
  };

  SelectionManager.prototype.endResize = function () {
    this.activeSession = null;
  };

  // --- Snapping Overlay Renderer ---
  var SnappingOverlayRenderer = {
    defaultColor: "#ec4899",
    accentColor: "#ef4444",
    toRenderableLines: function (guides, options) {
      options = options || {};
      var color = options.color || this.defaultColor;
      var strokeWidth = options.strokeWidth !== undefined ? options.strokeWidth : 1;
      var strokeDasharray = options.dashed ? "4,4" : undefined;

      return guides.map(function (g, idx) {
        if (g.orientation === "vertical") {
          return {
            id: "guide_v_" + idx + "_" + Math.round(g.coordinate),
            orientation: "vertical",
            x1: g.coordinate,
            y1: g.start,
            x2: g.coordinate,
            y2: g.end,
            stroke: color,
            strokeWidth: strokeWidth,
            strokeDasharray: strokeDasharray,
            label: "X: " + Math.round(g.coordinate) + "px"
          };
        } else {
          return {
            id: "guide_h_" + idx + "_" + Math.round(g.coordinate),
            orientation: "horizontal",
            x1: g.start,
            y1: g.coordinate,
            x2: g.end,
            y2: g.coordinate,
            stroke: color,
            strokeWidth: strokeWidth,
            strokeDasharray: strokeDasharray,
            label: "Y: " + Math.round(g.coordinate) + "px"
          };
        }
      });
    },
    renderSvgOverlay: function (guides, options) {
      var lines = this.toRenderableLines(guides, options);
      if (lines.length === 0) return "";
      var elements = lines.map(function (l) {
        var dash = l.strokeDasharray ? ' stroke-dasharray="' + l.strokeDasharray + '"' : "";
        return '<line x1="' + l.x1 + '" y1="' + l.y1 + '" x2="' + l.x2 + '" y2="' + l.y2 + '" stroke="' + l.stroke + '" stroke-width="' + l.strokeWidth + '"' + dash + " />";
      });
      return '<g class="designer-snapping-guides">\n' + elements.join("\n") + "\n</g>";
    }
  };

  // --- StylesPanel Manager ---
  var StylesPanelManager = {
    parseClasses: function (className) {
      var tokens = className.trim().split(/\s+/).filter(Boolean);
      var styles = {};
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t === "flex" || t === "grid" || t === "block" || t === "inline-block" || t === "hidden") styles.display = t;
        else if (t.indexOf("flex-row") === 0 || t.indexOf("flex-col") === 0) styles.flexDirection = t.replace("flex-", "");
        else if (t.indexOf("justify-") === 0) styles.justifyContent = t.replace("justify-", "");
        else if (t.indexOf("items-") === 0) styles.alignItems = t.replace("items-", "");
        else if (t.indexOf("gap-") === 0) styles.gap = t.replace("gap-", "");
        else if (t.indexOf("px-") === 0) styles.paddingX = t.replace("px-", "");
        else if (t.indexOf("py-") === 0) styles.paddingY = t.replace("py-", "");
        else if (t.indexOf("p-") === 0) styles.padding = t.replace("p-", "");
        else if (t.indexOf("mx-") === 0) styles.marginX = t.replace("mx-", "");
        else if (t.indexOf("my-") === 0) styles.marginY = t.replace("my-", "");
        else if (t.indexOf("m-") === 0) styles.margin = t.replace("m-", "");
        else if (/^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+[^\]]*\])$/.test(t)) styles.textSize = t.replace("text-", "");
        else if (/^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/.test(t)) styles.fontWeight = t.replace("font-", "");
        else if (/^text-(left|center|right|justify)$/.test(t)) styles.textAlign = t.replace("text-", "");
        else if (t.indexOf("text-") === 0 && t.indexOf("text-opacity-") !== 0) styles.textColor = t.replace("text-", "");
        else if (t.indexOf("bg-") === 0 && t.indexOf("bg-opacity-") !== 0) styles.backgroundColor = t.replace("bg-", "");
        else if (t.indexOf("opacity-") === 0) styles.opacity = t.replace("opacity-", "");
        else if (t === "border" || /^border-(\d+|\[\d+[^\]]*\])$/.test(t)) styles.borderWidth = t === "border" ? "1" : t.replace("border-", "");
        else if (t === "border-none") styles.borderWidth = "0";
        else if (t.indexOf("border-") === 0 && t.indexOf("border-opacity-") !== 0 && !/^(border-(solid|dashed|dotted|double|none|hidden))$/.test(t)) styles.borderColor = t.replace("border-", "");
        else if (t.indexOf("rounded") === 0) styles.borderRadius = t === "rounded" ? "DEFAULT" : t.replace("rounded-", "");
        else if (t.indexOf("shadow") === 0) styles.shadow = t === "shadow" ? "DEFAULT" : t.replace("shadow-", "");
      }
      return styles;
    },
    buildPanelSections: function (className) {
      var parsed = this.parseClasses(className);
      return [
        {
          id: "layout",
          title: "布局与流排版 (Layout)",
          controls: [
            {
              name: "display",
              label: "Display",
              type: "select",
              currentValue: parsed.display || "block",
              options: [
                { label: "Block", value: "block", className: "block" },
                { label: "Flex", value: "flex", className: "flex" },
                { label: "Grid", value: "grid", className: "grid" }
              ]
            },
            {
              name: "flexDirection",
              label: "方向",
              type: "select",
              currentValue: parsed.flexDirection || "row",
              options: [
                { label: "水平 (Row)", value: "row", className: "flex-row" },
                { label: "垂直 (Column)", value: "col", className: "flex-col" }
              ]
            },
            { name: "gap", label: "间距 (Gap)", type: "spacing", currentValue: parsed.gap || "0" }
          ]
        },
        {
          id: "spacing",
          title: "边距与内衬 (Spacing)",
          controls: [
            { name: "padding", label: "内边距 (P)", type: "spacing", currentValue: parsed.padding || "" },
            { name: "paddingX", label: "水平内边距 (PX)", type: "spacing", currentValue: parsed.paddingX || "" },
            { name: "paddingY", label: "垂直内边距 (PY)", type: "spacing", currentValue: parsed.paddingY || "" },
            { name: "margin", label: "外边距 (M)", type: "spacing", currentValue: parsed.margin || "" }
          ]
        },
        {
          id: "typography",
          title: "排版与字体 (Typography)",
          controls: [
            {
              name: "textSize",
              label: "字号",
              type: "select",
              currentValue: parsed.textSize || "base",
              options: [
                { label: "12px (xs)", value: "xs", className: "text-xs" },
                { label: "14px (sm)", value: "sm", className: "text-sm" },
                { label: "16px (base)", value: "base", className: "text-base" },
                { label: "18px (lg)", value: "lg", className: "text-lg" },
                { label: "20px (xl)", value: "xl", className: "text-xl" }
              ]
            },
            {
              name: "fontWeight",
              label: "字重",
              type: "select",
              currentValue: parsed.fontWeight || "normal",
              options: [
                { label: "常规 (400)", value: "normal", className: "font-normal" },
                { label: "中粗 (500)", value: "medium", className: "font-medium" },
                { label: "半粗 (600)", value: "semibold", className: "font-semibold" },
                { label: "粗体 (700)", value: "bold", className: "font-bold" }
              ]
            },
            { name: "textColor", label: "文字颜色", type: "color", currentValue: parsed.textColor || "" }
          ]
        },
        {
          id: "appearance",
          title: "色彩与背景 (Appearance)",
          controls: [
            { name: "backgroundColor", label: "背景颜色", type: "color", currentValue: parsed.backgroundColor || "" },
            { name: "opacity", label: "不透明度", type: "select", currentValue: parsed.opacity || "100" }
          ]
        },
        {
          id: "borders",
          title: "边框与圆角 (Borders & Radius)",
          controls: [
            {
              name: "borderRadius",
              label: "圆角",
              type: "select",
              currentValue: parsed.borderRadius || "none",
              options: [
                { label: "无", value: "none", className: "rounded-none" },
                { label: "小 (sm)", value: "sm", className: "rounded-sm" },
                { label: "默认 (rounded)", value: "DEFAULT", className: "rounded" },
                { label: "中 (md)", value: "md", className: "rounded-md" },
                { label: "大 (lg)", value: "lg", className: "rounded-lg" },
                { label: "胶囊 (full)", value: "full", className: "rounded-full" }
              ]
            },
            {
              name: "borderWidth",
              label: "边框粗细",
              type: "select",
              currentValue: parsed.borderWidth || "0",
              options: [
                { label: "无 (0)", value: "0", className: "border-0" },
                { label: "1px", value: "1", className: "border" },
                { label: "2px", value: "2", className: "border-2" },
                { label: "4px", value: "4", className: "border-4" }
              ]
            },
            { name: "borderColor", label: "边框颜色", type: "color", currentValue: parsed.borderColor || "" },
            {
              name: "shadow",
              label: "阴影",
              type: "select",
              currentValue: parsed.shadow || "none",
              options: [
                { label: "无", value: "none", className: "shadow-none" },
                { label: "微阴影 (sm)", value: "sm", className: "shadow-sm" },
                { label: "默认 (shadow)", value: "DEFAULT", className: "shadow" },
                { label: "普通 (md)", value: "md", className: "shadow-md" },
                { label: "大阴影 (lg)", value: "lg", className: "shadow-lg" }
              ]
            }
          ]
        }
      ];
    }
  };

  // --- Component Sandbox ---
  function ComponentSandbox(options) {
    options = options || {};
    this.activePath = options.activePath || "/";
  }

  ComponentSandbox.prototype.escapeHtml = function (str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  ComponentSandbox.prototype.renderElement = function (store, elementId) {
    var el = typeof store.getElement === "function" ? store.getElement(elementId) : store.byId ? store.byId[elementId] : null;
    if (!el) return "";
    if (el.type === "text") return el.textContent || "";
    var children = typeof store.getChildren === "function" ? store.getChildren(elementId) : [];
    var renderedChildren = [];
    if (el.textContent) renderedChildren.push(el.textContent);
    for (var i = 0; i < children.length; i++) {
      renderedChildren.push(this.renderElement(store, children[i].id));
    }
    var finalTag = el.tag;
    var finalProps = Object.assign({}, el.props || {});
    if (el.tag === "Image" || el.tag === "next/image") {
      finalTag = "img";
      finalProps["data-next-image"] = "true";
      if (!finalProps.src) finalProps.src = "/placeholder.svg";
    } else if (el.tag === "Link" || el.tag === "next/link") {
      finalTag = "a";
      finalProps["data-next-link"] = "true";
      if (!finalProps.href) finalProps.href = "#";
    }
    if (!finalProps["data-element-id"]) {
      finalProps["data-element-id"] = el.id;
    }
    return { tag: finalTag, props: finalProps, children: renderedChildren };
  };

  ComponentSandbox.prototype.renderToHtml = function (store, rootId) {
    var self = this;
    function nodeToStr(node) {
      if (typeof node === "string") return self.escapeHtml(node);
      var tag = node.tag;
      var props = node.props;
      var children = node.children;
      var attrs = [];
      for (var k in props) {
        if (!props.hasOwnProperty(k)) continue;
        var v = props[k];
        if (typeof v === "function" || k === "children") continue;
        var attrName = k === "className" ? "class" : k;
        if (typeof v === "string") attrs.push(attrName + '="' + self.escapeHtml(v) + '"');
        else if (typeof v === "boolean") { if (v) attrs.push(attrName); }
        else if (typeof v === "number") attrs.push(attrName + '="' + v + '"');
      }
      var attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
      var selfClosing = /^(img|input|br|hr|meta|link)$/i.test(tag);
      if (selfClosing && children.length === 0) return "<" + tag + attrStr + " />";
      var inner = children.map(nodeToStr).join("");
      return "<" + tag + attrStr + ">" + inner + "</" + tag + ">";
    }
    return nodeToStr(this.renderElement(store, rootId));
  };

  // --- Client Init ---
  function initDesignerClient() {
    return {
      viewport: new InfiniteCanvasViewport(),
      selection: new SelectionManager(),
      sandbox: new ComponentSandbox(),
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
    SnappingOverlayRenderer: SnappingOverlayRenderer,
    StylesPanelManager: StylesPanelManager,
    ComponentSandbox: ComponentSandbox,
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
