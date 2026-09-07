import { CanvasPanel } from "./canvas/index.ts";
import { FlatStore } from "../store/flatStore.ts";
import { StylesPanelManager, type ParsedStyles } from "./stylesPanel.ts";
import { mergeTailwindClasses } from "../compiler/tailwindMerge.ts";
import { bindPreviewCanvasUx, bindFloatingTooltips, refreshOverlay } from "./previewCanvasUx.ts";

export interface PreviewApi {
  getStatus?: () => Promise<Record<string, unknown>>;
  getCanvas?: () => Promise<Record<string, unknown>>;
  pushCanvas?: (store: Record<string, unknown>) => Promise<{ success?: boolean; version?: number; error?: string }>;
  callTool?: (tool: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  applyAiMerge?: (
    source: string,
    instruction: string
  ) => Promise<{
    success: boolean;
    mergedCode?: string;
    error?: string;
    model?: string;
    fallback?: boolean;
    liveError?: string;
    mockMode?: boolean;
    provider?: string;
    attemptsLog?: Array<{
      provider: string;
      model: string;
      label?: string;
      ok?: boolean;
      httpStatus?: number;
      error?: string;
    }>;
  }>;
}

export interface ChangeSetProposal {
  id: string;
  instruction: string;
  elementId: string;
  filePath: string;
  sourceHash: string;
  baseRevision: number;
  beforeClassName: string;
  afterClassName: string;
  preview: string;
  mergedCode: string;
}

export function autosaveClearsDirty(
  httpOk: boolean,
  result: { success?: boolean; localEditId?: number; ackRevision?: number } | undefined,
  expected?: { localEditId?: number; ackRevision?: number }
): boolean {
  if (!httpOk || result?.success === false) return false;
  if (expected?.localEditId !== undefined && result?.localEditId !== expected.localEditId) return false;
  if (expected?.ackRevision !== undefined && result?.ackRevision !== expected.ackRevision) return false;
  return true;
}

const GATED_TOOLS = new Set([
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

const CARD_ID = "hero-card";
const BADGE_ID = "status-badge";
const TITLE_ID = "hero-title";
const BODY_ID = "hero-body";
const BTN_ID = "primary-btn";
const BATCH_FILE = "src/agent-batch-demo.txt";

const FILL_SWATCHES = ["slate-900", "emerald-600", "indigo-600", "rose-600"];
const TEXT_SWATCHES = ["slate-100", "amber-300", "rose-400", "emerald-400"];
const RADIUS_VALUES = ["none", "md", "xl", "full"];
const PADDING_VALUES = ["2", "4", "6", "8"];
const SHADOW_VALUES = ["none", "sm", "md", "lg"];

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
    props: {
      className:
        "inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
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

function listElementIds(store: FlatStore): string[] {
  return Object.keys(store.toJSON().byId);
}

function swatchButtons(prefix: string, values: string[], kind: "bg" | "text"): string {
  return values
    .map((value) => {
      const colorClass = `bg-${value}`;
      return `<button type="button" class="od-swatch ${colorClass}" data-testid="${prefix}-${value}" data-value="${value}" data-tooltip="${kind === "bg" ? "Fill" : "Text"} ${value}"></button>`;
    })
    .join("");
}

export function mountPreview(root: HTMLElement, api: PreviewApi = {}): CanvasPanel {
  const store = new FlatStore();
  const panel = new CanvasPanel({ store, handleSize: 12 });
  let dirty = false;
  let openBatchId: string | null = null;
  let lastSeenVersion = 0;
  let projectId: string | null = null;
  let proposal: ChangeSetProposal | null = null;
  let hasLiveModel = false;
  let fileDiffCount = 0;
  let pendingEditId = 0;
  let saveQueue: Promise<unknown> = Promise.resolve();

  function syncGeometry(): void {
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
            <button type="button" data-testid="zoom-out" id="od-zoom-out" data-tooltip="Zoom out">−</button>
            <span class="od-zoom-label" data-testid="zoom-label" id="od-zoom-label" data-tooltip="Current zoom">100%</span>
            <button type="button" data-testid="zoom-in" id="od-zoom-in" data-tooltip="Zoom in">+</button>
            <button type="button" data-testid="zoom-reset" id="od-zoom-reset" data-tooltip="Reset pan and zoom">Reset view</button>
            <button type="button" data-testid="insert-box" id="od-insert-box" data-tooltip="Insert a sibling box">Insert box</button>
            <button type="button" data-testid="delete-element" id="od-delete-element" data-tooltip="Delete selected">Delete</button>
            <span class="od-hud" data-testid="canvas-hud" id="od-hud">idle</span>
          </div>
          <div class="od-hint" data-testid="editor-hint">Drag empty canvas to marquee-select · Space-drag or middle-drag to pan · Wheel pans · Ctrl+wheel zooms at cursor · Min size 8×8</div>
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
          <textarea id="od-intent" class="od-intent" data-testid="ai-intent" rows="3" placeholder="例如：把按钮改成翠绿 / make the button emerald"></textarea>
          <div class="od-actions">
            <button type="button" data-testid="ai-propose" id="od-ai-propose" data-tooltip="Propose a scoped ChangeSet. Does not write until you accept.">提出修改</button>
            <button type="button" data-testid="ai-accept" id="od-ai-accept" disabled data-tooltip="Accept the proposal and checkpoint">接受</button>
            <button type="button" data-testid="ai-reject" id="od-ai-reject" disabled data-tooltip="Reject with no residue">拒绝</button>
          </div>
          <div class="od-hint" data-testid="receipt-kind">Local HTTP debug receipts are not human approval of a seen diff. Accept binds the exact diff hash. Reject writes nothing.</div>
          </div>
          <div class="od-styles-title">Save / Rewind</div>
          <div id="od-autosave" class="od-mono" data-testid="autosave-indicator">working copy: pending</div>
          <div class="od-actions">
            <button type="button" data-testid="rewind" id="od-rewind" data-tooltip="Rewind one checkpoint">Rewind</button>
            <button type="button" data-testid="save-design" id="od-save-design" data-tooltip="Write .designer/canvas.json only">保存设计稿</button>
            <button type="button" data-testid="apply-files" id="od-apply-files" disabled data-tooltip="Apply real file diffs from the open agent batch">应用到工程</button>
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

  const canvasEl = root.querySelector("#od-canvas") as HTMLElement;
  const layersEl = root.querySelector(".od-layers") as HTMLElement;
  const selectedEl = root.querySelector("#od-selected") as HTMLElement;
  const classEl = root.querySelector("#od-class") as HTMLElement;
  const statusEl = root.querySelector("#od-status") as HTMLElement;
  const aiEl = root.querySelector("#od-ai") as HTMLElement;
  const aiBannerEl = root.querySelector("#od-ai-banner") as HTMLElement;
  const persistEl = root.querySelector("#od-persist") as HTMLElement;
  const autosaveEl = root.querySelector("#od-autosave") as HTMLElement;
  const inspectorEl = root.querySelector("#od-inspector") as HTMLElement;
  const hudEl = root.querySelector("#od-hud") as HTMLElement;
  const zoomLabelEl = root.querySelector("#od-zoom-label") as HTMLElement;
  const intentEl = root.querySelector("#od-intent") as HTMLTextAreaElement;
  const proposeBtn = root.querySelector("#od-ai-propose") as HTMLButtonElement;
  const acceptBtn = root.querySelector("#od-ai-accept") as HTMLButtonElement;
  const rejectBtn = root.querySelector("#od-ai-reject") as HTMLButtonElement;
  const applyFilesBtn = root.querySelector("#od-apply-files") as HTMLButtonElement;

  function selectedId(): string {
    return panel.selection.getSelectedIds()[0] || "";
  }

  function syncProposalButtons(): void {
    acceptBtn.disabled = !proposal;
    rejectBtn.disabled = !proposal;
    applyFilesBtn.disabled = !openBatchId || fileDiffCount === 0;
    proposeBtn.disabled = false;
    proposeBtn.title = hasLiveModel
      ? "Propose a structured patch of the selected source node"
      : "Supported zh/en intents map onto a real source patch. Live model is used when configured.";
  }

  function updateHud(): void {
    const ids = panel.selection.getSelectedIds();
    const box = panel.getSelectedBoundingBox();
    const zoom = Math.round(panel.viewport.getZoom() * 100);
    const pan = panel.viewport.getPan();
    const rectText = box
      ? `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}×${Math.round(box.height)}`
      : "none";
    hudEl.textContent = `${panel.controller.getMode()} · z${zoom}% · pan ${Math.round(pan.x)},${Math.round(pan.y)} · ${ids.join(",") || "none"} · ${rectText} · guides ${panel.controller.getGuides().length}`;
    zoomLabelEl.textContent = `${zoom}%`;
  }

  function renderInspector(): void {
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

  function renderLayers(): void {
    const ids = listElementIds(store);
    layersEl.innerHTML = `<div class="od-styles-title">Layers</div>` + ids
      .map((id) => {
        const el = store.getElement(id);
        const selected = panel.selection.isSelected(id);
        return `<button type="button" class="od-layer${selected ? " is-selected" : ""}" data-testid="layer-${id}" data-id="${id}">${el?.tag || "node"} ${id}</button>`;
      })
      .join("");
  }

  function render(options: { preserveViewport?: boolean } = {}): void {
    const selected = panel.selection.getSelectedIds();
    syncGeometry();
    if (selected.length) panel.select(selected.filter((id) => store.getElement(id)));
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

  async function refreshStatus(): Promise<void> {
    if (!api.getStatus) return;
    const status = await api.getStatus();
    const persistence = (status.persistence || {}) as Record<string, unknown>;
    const ai = (status.ai || {}) as Record<string, unknown>;
    projectId = typeof status.projectId === "string" ? status.projectId : projectId;
    hasLiveModel = ai.hasApiKey === true && ai.mockMode !== true;
    statusEl.textContent = `plugin ${status.name} | project ${projectId || "—"} v${lastSeenVersion} | jail ${status.projectRoot} | ai ${ai.provider || "none"}/${ai.model || "none"} hasApiKey=${ai.hasApiKey === true}`;
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

  async function pushAuthoritativeCanvas(): Promise<boolean> {
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

  async function callTool(tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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
    if (typeof result.version === "number") lastSeenVersion = result.version as number;
    await refreshStatus();
    return result;
  }

  function markDirty(): void {
    dirty = true;
    pendingEditId += 1;
  }

  async function checkpointAndAutosave(label: string): Promise<void> {
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

  function applyStyle(property: keyof ParsedStyles, value: string, label: string): void {
    const id = selectedId();
    if (!id) return;
    const next = StylesPanelManager.applyPropertyChange(classNameOf(store, id), property, value);
    setClassName(store, id, next);
    render();
    void checkpointAndAutosave(label);
  }

  function applyLocalShadow(value: string): void {
    const id = selectedId() || CARD_ID;
    if (!selectedId()) panel.select([id]);
    const token = value === "none" ? "shadow-none" : `shadow-${value}`;
    const next = mergeTailwindClasses(classNameOf(store, id), token);
    setClassName(store, id, next);
    render();
    void checkpointAndAutosave(`shadow-${value}`);
  }

  function insertBox(): void {
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

  function deleteSelected(): void {
    const ids = panel.selection.getSelectedIds();
    if (ids.length === 0) return;
    for (const id of ids) panel.unregisterElement(id);
    panel.selection.clearSelection();
    render();
    void checkpointAndAutosave("delete-element");
  }

  function zoomBy(factor: number): void {
    const bounds = canvasEl.getBoundingClientRect();
    panel.viewport.zoomAt({ x: bounds.width / 2, y: bounds.height / 2 }, factor);
    refreshOverlay(canvasEl, panel);
    updateHud();
  }

  function clearProposal(message: string): void {
    proposal = null;
    aiEl.textContent = message;
    syncProposalButtons();
  }

  layersEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const id = target.getAttribute("data-id");
    if (!id) return;
    panel.select([id]);
    render();
  });

  inspectorEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const fill = target.getAttribute("data-testid")?.startsWith("style-fill-")
      ? target.getAttribute("data-value")
      : null;
    const radius = target.getAttribute("data-radius");
    const padding = target.getAttribute("data-padding");
    const text = target.getAttribute("data-testid")?.startsWith("style-text-")
      ? target.getAttribute("data-value")
      : null;
    const shadow = target.getAttribute("data-shadow");
    if (fill) applyStyle("backgroundColor", fill, `fill-${fill}`);
    else if (radius) applyStyle("borderRadius", radius, `radius-${radius}`);
    else if (padding) applyStyle("padding", padding, `padding-${padding}`);
    else if (text) applyStyle("textColor", text, `text-${text}`);
    else if (shadow) applyLocalShadow(shadow);
  });

  root.querySelector("#od-edit-fill")!.addEventListener("click", () => {
    applyStyle("backgroundColor", "emerald-600", "fill-emerald");
  });

  root.querySelector("#od-edit-radius")!.addEventListener("click", () => {
    const id = selectedId() || CARD_ID;
    if (!selectedId()) panel.select([id]);
    const next = mergeTailwindClasses(classNameOf(store, id), "rounded-xl");
    setClassName(store, id, next);
    render();
    void checkpointAndAutosave("radius-xl");
  });

  root.querySelector("#od-edit-shadow")!.addEventListener("click", () => {
    applyLocalShadow("lg");
  });

  root.querySelector("#od-rewind")!.addEventListener("click", async () => {
    const result = await callTool("rewind");
    if (result.success && result.store) {
      store.fromJSON(result.store);
      const ids = listElementIds(store);
      panel.select(ids.includes(CARD_ID) ? [CARD_ID] : ids.slice(0, 1));
      clearProposal("Rewound. No pending ChangeSet.");
      render();
    }
  });

  root.querySelector("#od-save-design")!.addEventListener("click", () => {
    void callTool("apply_to_project");
  });

  root.querySelector("#od-apply-files")!.addEventListener("click", async () => {
    if (!openBatchId || fileDiffCount === 0) {
      persistEl.textContent = JSON.stringify({
        success: false,
        error: "应用到工程 needs an open batch with file diffs"
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

  root.querySelector("#od-batch-create")!.addEventListener("click", async () => {
    const result = await callTool("batch_create", { label: "preview-batch" });
    if (result.success && typeof result.batchId === "string") {
      openBatchId = result.batchId;
    }
  });

  root.querySelector("#od-batch-write")!.addEventListener("click", () => {
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

  root.querySelector("#od-batch-discard")!.addEventListener("click", async () => {
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
      proposal = result.proposal as ChangeSetProposal;
      aiBannerEl.textContent = `proposal ${proposal.id} file=${proposal.filePath} hash=${proposal.sourceHash.slice(0, 8)}`;
    aiEl.textContent = `${aiBannerEl.textContent}\nintent: ${instruction}\nbefore: ${proposal.beforeClassName}\nafter: ${proposal.afterClassName}\ndiffHash bind: ${proposal.afterHash || proposal.sourceHash}\n${proposal.preview}\nAccept writes this file. Reject leaves the repo unchanged.`;
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
      aiEl.textContent = `Accept refused: ${String(result.error || "stale or unsupported")}`;
      return;
    }
    if (result.store && typeof result.store === "object") {
      store.fromJSON(result.store as Record<string, unknown>);
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

  root.querySelector("#od-insert-box")!.addEventListener("click", () => insertBox());
  root.querySelector("#od-delete-element")!.addEventListener("click", () => deleteSelected());
  root.querySelector("#od-zoom-in")!.addEventListener("click", () => zoomBy(1.15));
  root.querySelector("#od-zoom-out")!.addEventListener("click", () => zoomBy(1 / 1.15));
  root.querySelector("#od-zoom-reset")!.addEventListener("click", () => {
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
  }, 8000);

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
        if (canvas && canvas.byId && Object.keys(canvas.byId as object).length > 0) {
          store.fromJSON(canvas);
          if (typeof canvas.version === "number") lastSeenVersion = canvas.version as number;
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
          persistEl.textContent = `debug receipt (${String(receipt.receiptKind || "debug-http")}) ≠ human approval of seen diff. tool=${tool} diffHash=${String(receipt.diffHash || "").slice(0, 16)}`;
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
