/**
 * Bind existing CanvasPanel pointer / wheel / keyboard APIs onto the preview DOM.
 * Does not invent a second interaction engine — it only exposes controller + overlay.
 */

import type { ResizeHandle } from "./geometry.ts";
import type { CanvasPanel } from "./canvas/canvasPanel.ts";
import type { FlatStore } from "../store/flatStore.ts";

const RESIZE_HANDLES = new Set<string>(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
const MARQUEE_CLICK_PX = 4;

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
      panel.controller.getGuides(),
      { marquee: panel.controller.getMarqueeRect() }
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
  else if (mode === "box-selecting") panel.controller.endBoxSelect();
}

export function bindFloatingTooltips(root: HTMLElement): () => void {
  let tip = root.querySelector("[data-testid='editor-tooltip']") as HTMLElement | null;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "od-float-tip";
    tip.setAttribute("data-testid", "editor-tooltip");
    tip.hidden = true;
    root.appendChild(tip);
  }

  let hideTimer = 0;
  const show = (text: string, x: number, y: number): void => {
    window.clearTimeout(hideTimer);
    tip!.hidden = false;
    tip!.textContent = text;
    const pad = 12;
    const maxX = window.innerWidth - tip!.offsetWidth - 8;
    const maxY = window.innerHeight - tip!.offsetHeight - 8;
    tip!.style.left = `${Math.max(8, Math.min(maxX, x + pad))}px`;
    tip!.style.top = `${Math.max(8, Math.min(maxY, y + pad))}px`;
  };
  const hide = (): void => {
    hideTimer = window.setTimeout(() => {
      tip!.hidden = true;
      tip!.textContent = "";
    }, 80);
  };

  const onOver = (event: PointerEvent): void => {
    const target = event.target as Element | null;
    const el = target?.closest?.("[data-tooltip]") as HTMLElement | null;
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
  const onMove = (event: PointerEvent): void => {
    if (tip!.hidden) return;
    const el = (event.target as Element | null)?.closest?.("[data-tooltip]");
    if (el) show(el.getAttribute("data-tooltip") || "", event.clientX, event.clientY);
  };
  const onOut = (event: PointerEvent): void => {
    const next = event.relatedTarget as Element | null;
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
  let marqueeAdditive = false;
  let marqueeBaseIds: string[] = [];
  let pointerStart: { x: number; y: number } | null = null;

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
    pointerStart = { ...screen };
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

  const onPointerUp = (event: PointerEvent): void => {
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
