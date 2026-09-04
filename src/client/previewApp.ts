import { CanvasPanel } from "./canvas/index.ts";
import { FlatStore } from "../store/flatStore.ts";
import { StylesPanelManager } from "./stylesPanel.ts";
import { mergeTailwindClasses } from "../compiler/tailwindMerge.ts";

export interface PreviewApi {
  getStatus?: () => Promise<Record<string, unknown>>;
  applyAiMerge?: (source: string, instruction: string) => Promise<{ success: boolean; mergedCode?: string; error?: string; model?: string }>;
}

const CARD_ID = "hero-card";
const BADGE_ID = "status-badge";
const TITLE_ID = "hero-title";
const BODY_ID = "hero-body";
const BTN_ID = "primary-btn";

function seedStore(store: FlatStore): void {
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
    props: { className: "inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" },
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
    props: { className: "mt-4 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg", "data-testid": "primary-btn" },
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

function classNameOf(store: FlatStore, id: string): string {
  const el = store.getElement(id);
  return typeof el?.props.className === "string" ? el.props.className : "";
}

function setClassName(store: FlatStore, id: string, className: string): void {
  const el = store.getElement(id);
  if (!el) return;
  el.props = { ...el.props, className };
  store.setElement(el);
}

export function mountPreview(root: HTMLElement, api: PreviewApi = {}): CanvasPanel {
  const store = new FlatStore();
  seedStore(store);
  const panel = new CanvasPanel({ store });

  for (const [id, el] of Object.entries(store.toJSON().byId)) {
    if (el.canvasRect) {
      panel.registerElement(id, el.canvasRect, el);
    }
  }
  panel.select([CARD_ID]);

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
          <pre id="od-class" class="od-mono" data-testid="class-output"></pre>
          <pre id="od-ai" class="od-mono" data-testid="ai-output"></pre>
        </aside>
      </div>
    </div>
  `;

  const canvasEl = root.querySelector("#od-canvas") as HTMLElement;
  const layersEl = root.querySelector(".od-layers") as HTMLElement;
  const selectedEl = root.querySelector("#od-selected") as HTMLElement;
  const classEl = root.querySelector("#od-class") as HTMLElement;
  const statusEl = root.querySelector("#od-status") as HTMLElement;
  const aiEl = root.querySelector("#od-ai") as HTMLElement;

  function render(): void {
    canvasEl.innerHTML = panel.renderHtml();
    const ids = [CARD_ID, BADGE_ID, TITLE_ID, BODY_ID, BTN_ID];
    layersEl.innerHTML = ids
      .map((id) => {
        const el = store.getElement(id);
        const selected = panel.selection.getSelectedIds().includes(id);
        return `<button type="button" class="od-layer${selected ? " is-selected" : ""}" data-id="${id}">${el?.tag} ${id}</button>`;
      })
      .join("");
    const selectedId = panel.selection.getSelectedIds()[0] || CARD_ID;
    selectedEl.textContent = selectedId;
    classEl.textContent = classNameOf(store, selectedId);
  }

  layersEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const id = target.getAttribute("data-id");
    if (!id) return;
    panel.select([id]);
    render();
  });

  root.querySelector("#od-edit-fill")!.addEventListener("click", () => {
    const id = panel.selection.getSelectedIds()[0] || CARD_ID;
    const next = StylesPanelManager.applyPropertyChange(classNameOf(store, id), "backgroundColor", "emerald-600");
    setClassName(store, id, next);
    render();
  });

  root.querySelector("#od-edit-radius")!.addEventListener("click", () => {
    const id = panel.selection.getSelectedIds()[0] || CARD_ID;
    const next = mergeTailwindClasses(classNameOf(store, id), "rounded-xl");
    setClassName(store, id, next);
    render();
  });

  root.querySelector("#od-ai-merge")!.addEventListener("click", async () => {
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
      aiEl.textContent = `model=${result.model || "unknown"}\n${result.mergedCode}`;
      render();
    } else {
      aiEl.textContent = result.error || "AI merge failed";
    }
  });

  void (async () => {
    if (!api.getStatus) {
      statusEl.textContent = "standalone preview (no DSH host)";
      return;
    }
    try {
      const status = await api.getStatus();
      statusEl.textContent = `plugin ${status.name} | jail ${status.projectRoot} | autoApprove=${status.autoApprove} | ai ${JSON.stringify(status.ai)}`;
    } catch (err) {
      statusEl.textContent = `status unavailable: ${err instanceof Error ? err.message : String(err)}`;
    }
  })();

  render();
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
