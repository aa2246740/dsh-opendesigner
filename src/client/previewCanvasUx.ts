/**
 * Bind existing CanvasPanel pointer / wheel / keyboard APIs onto the preview DOM.
 * Does not invent a second interaction engine — it only exposes controller + overlay.
 */

import type { ResizeHandle } from "./geometry.ts";
import type { CanvasPanel } from "./canvas/canvasPanel.ts";
import type { FlatStore } from "../store/flatStore.ts";

const RESIZE_HANDLES = new Set<string>(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

export interface PreviewCanvasUxHooks {
  onCommit: (label: string) => void;
  onFullRender: () => void;
  onHud: () => void;
}

function canvasPointFromEvent(canvasEl: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const bounds = canvasEl.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function applyRectsToDom(canvasEl: HTMLElement, panel: CanvasPanel, store: FlatStore): void {
  for (const [id, rect] of panel.getAllElementRects()) {
    const node = canvasEl.querySelector(`[data-element-id="${CSS.escape(id)}"]`) as HTMLElement | null;
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

export function refreshOverlay(canvasEl: HTMLElement, panel: CanvasPanel): void {
  const host = canvasEl.querySelector(".canvas-overlay-host");
  if (host) {
    host.innerHTML = panel.overlay.renderSvgOverlay(
      panel.getSelectedBoundingBox(),
      panel.controller.getGuides()
    );
  }
  const layer = canvasEl.querySelector(".canvas-viewport-layer") as HTMLElement | null;
  if (layer) {
    layer.style.transform = panel.viewport.getCssTransform();
  }
}

function endInteraction(panel: CanvasPanel): void {
  const mode = panel.controller.getMode();
  if (mode === "panning") panel.controller.endPan();
  else if (mode === "dragging") panel.controller.endDrag();
  else if (mode === "resizing") panel.controller.endResize();
}

export function bindPreviewCanvasUx(
  canvasEl: HTMLElement,
  panel: CanvasPanel,
  store: FlatStore,
  hooks: PreviewCanvasUxHooks
): () => void {
  let spaceDown = false;
  let pointerId: number | null = null;
  let didMutate = false;
  let commitLabel = "canvas-gesture";

  const liveSync = (): void => {
    applyRectsToDom(canvasEl, panel, store);
    refreshOverlay(canvasEl, panel);
    hooks.onHud();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement | null;
    const screen = canvasPointFromEvent(canvasEl, event.clientX, event.clientY);
    const handleAttr = target?.closest("[data-handle]")?.getAttribute("data-handle");
    const nodeEl = target?.closest("[data-element-id]") as HTMLElement | null;
    const nodeId = nodeEl?.getAttribute("data-element-id") || panel.hitTest(panel.viewport.toWorld(screen));

    canvasEl.focus({ preventScroll: true });
    event.preventDefault();
    pointerId = event.pointerId;
    try {
      canvasEl.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    didMutate = false;

    if (handleAttr && RESIZE_HANDLES.has(handleAttr) && panel.selection.getSelectedIds().length > 0) {
      panel.controller.startResize(handleAttr as ResizeHandle, screen);
      commitLabel = `resize-${handleAttr}`;
      liveSync();
      return;
    }

    const panRequested = event.button === 1 || spaceDown || event.altKey || !nodeId;
    if (panRequested) {
      if (!nodeId && !event.shiftKey && event.button === 0 && !spaceDown) {
        panel.selection.clearSelection();
      }
      panel.controller.startPan(screen);
      commitLabel = "pan";
      liveSync();
      return;
    }

    if (event.shiftKey) {
      panel.selection.toggleSelect(nodeId);
    } else {
      panel.select([nodeId]);
    }

    if (panel.selection.getSelectedIds().length > 0) {
      panel.controller.startDrag(screen);
      commitLabel = "move";
    }
    liveSync();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const screen = canvasPointFromEvent(canvasEl, event.clientX, event.clientY);
    const mode = panel.controller.getMode();
    if (mode === "panning") {
      panel.controller.updatePan(screen);
      refreshOverlay(canvasEl, panel);
      hooks.onHud();
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

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const mode = panel.controller.getMode();
    endInteraction(panel);
    pointerId = null;
    try {
      canvasEl.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    liveSync();
    if (didMutate && (mode === "dragging" || mode === "resizing")) {
      hooks.onCommit(commitLabel);
    }
    didMutate = false;
  };

  const onWheel = (event: WheelEvent): void => {
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

  const onKeyDown = (event: KeyboardEvent): void => {
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

  const onKeyUp = (event: KeyboardEvent): void => {
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
