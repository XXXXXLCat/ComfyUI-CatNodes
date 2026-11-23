import { createBackend } from "./infcanvas-backend.js";
import { createPromptCompiler, SAFE_INT_MAX } from "./infcanvas-prompt-compiler.js";
import { createDndClipboard } from "./infcanvas-dnd-clipboard.js";
import { createModel } from "./infcanvas-model.js";
import { createProgress } from "./infcanvas-progress.js";
import { createKeys } from "./infcanvas-keys.js";
/* Core assembler: shared canvas state and the NS.api surface.

   Backend I/O, document/tab commands, prompt compilation, generation progress,
   drag/drop and key handling now live in the sibling modules imported above and
   are bound here. Documents hold plain JSON (nodes / edges / viewport); there
   is no LiteGraph graph object and no ComfyUI node-type registration.

   Storage: payloads written by the old LiteGraph canvas are `version: 1` with a
   `graph: { nodes: [{ id, type, pos, size, properties }], links: [...] }`.
   `hydrate()` still reads those and converts them into canvas nodes, so every
   canvas saved before the switch opens unchanged. New saves are `version: 2`. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. Named `tr` (not `t`)
     because toast() below has a local `t` bound to the host toast object. */
  const tr = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

  const APP = () => NS.app || window.comfyAPI?.app?.app;
  const API = () => window.comfyAPI?.api?.api;
  const EXT = () => APP()?.extensionManager;

  /* backend client + asset URL helpers (infcanvas-backend.js). API()/tr() stay
     here as lazy getters; the module closes over them. */
  const _backend = createBackend({ API, tr, NS });
  const viewUrl = _backend.viewUrl;
  const resolveMediaUrl = _backend.resolveMediaUrl;
  const refreshViewUrl = _backend.refreshViewUrl;
  const backend = _backend.backend;
  const addToFavorites = _backend.addToFavorites;
  const listPrompts = _backend.listPrompts;
  const addPrompt = _backend.addPrompt;
  const removePrompt = _backend.removePrompt;
  const updatePrompt = _backend.updatePrompt;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const uid = () => "ic_" + Math.random().toString(36).slice(2, 10);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  /* Robust text decoding for pasted / dropped .txt / .md files, ported from the
     reference xcat-paste.js: UTF-8 (with BOM) -> UTF-16 BOM -> GBK -> lenient
     UTF-8, so Chinese ANSI/GBK files don't turn into mojibake. */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      try { return new TextDecoder("utf-16le").decode(u8.subarray(2)); } catch (error) { /* fall through */ }
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      try { return new TextDecoder("utf-16be").decode(u8.subarray(2)); } catch (error) { /* fall through */ }
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (error) { /* fall through */ }
    try { return new TextDecoder("gbk").decode(u8); } catch (error) { /* fall through */ }
    return new TextDecoder("utf-8").decode(u8);
  }
  async function readTextFile(file) {
    if (file.arrayBuffer) return decodeText(await file.arrayBuffer());
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(decodeText(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  const EXT_KIND = {
    png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
    bmp: "image", avif: "image", svg: "image",
    mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video",
    mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio",
    txt: "text", md: "text", json: "text", csv: "text",
  };
  const kindFromFile = (name) => EXT_KIND[String(name).split(".").pop().toLowerCase()] || null;

  /* `size` is the whole frame for every node (no title bar any more).
     ONE node type per medium: 图像 / 视频 / 音频 are generators by default and
     turn into material nodes the moment a file lands on them. `data.asset` is
     the only discriminator — a material node is a final state (delete + create
     to get a generator back), so there is no separate role for the two states.
     Text stays its own role: it is never uploaded, only typed/pasted. */

  /* ------------------------------ helpers ------------------------------ */

  /* Host toast store (src/components/ui/toast/toastStore.ts):
       success/error/info/warning/loading(title, { description, duration })
     duration is in ms. The store defaults it to POSITIVE_INFINITY, so a toast
     without duration never closes on its own. Mirror ComfyUI's per-kind habits:
     success/info 3s, warning 5s, error/loading stay until manually closed.
     An explicit 4th argument always overrides the per-kind default. */
  const TOAST_DURATION = { success: 3000, info: 3000, warning: 5000, error: 0, loading: 0 };
  function toast(kind, summary, detail = "", duration = null) {
    const t = EXT()?.toast;
    if (!t) { console.log("[InfCanvas]", kind, summary, detail); return; }
    const d = duration ?? TOAST_DURATION[kind] ?? 3000;
    try {
      if (typeof t[kind] === "function") {
        const opts = { description: detail || undefined };
        if (d > 0) opts.duration = d;   // 0 => omit => store's POSITIVE_INFINITY
        t[kind](summary, opts);
      } else if (typeof t.add === "function") {
        t.add({ severity: kind, summary, detail, life: d });  // life:0 = sticky (legacy)
      }
    } catch (error) { console.warn("[InfCanvas] toast failed", error); }
  }

  async function confirmDialog(opts = {}) {
    const dialog = EXT()?.dialog;
    if (dialog?.confirm) {
      return await dialog.confirm({
        key: opts.key || "infcanvas-confirm",
        title: opts.title,
        message: opts.message,
        hint: opts.hint,
        itemList: opts.itemList,
        denyLabel: opts.denyLabel,
        confirmLabel: opts.confirmLabel,
        type: opts.threeWay ? "dirtyClose" : (opts.type || "default"),
      });
    }
    if (opts.threeWay) {
      const text = (opts.title || tr("core.confirm")) + "\n\n" + (opts.message || "") +
        tr("core.saveDiscardHint");
      const ok = window.confirm(text);
      return ok ? true : (window.confirm(tr("core.discardAndContinue")) ? false : null);
    }
    return window.confirm((opts.title || tr("core.confirm")) + "\n\n" + (opts.message || ""));
  }

  async function promptDialog({ title, message, defaultValue }) {
    const dialog = EXT()?.dialog;
    if (dialog?.prompt) return await dialog.prompt({ title, message, defaultValue });
    return window.prompt(message || title, defaultValue || "");
  }

  function suppressPreexistingDialogs(on) {
    for (const portal of Array.from(document.querySelectorAll("body > div.z-overlay"))) {
      /* The shared canvas tooltip (native-tip.js) borrows the host's z-overlay
         class for its bubble, but it is NOT a ComfyUI dialog portal. Tagging its
         children would hide the text and the arrow (visibility:hidden!important)
         while the themed box keeps painting — every tooltip turns into an empty
         bordered bubble. Skip it; never suppress our own tooltip. */
      if (portal.getAttribute("role") === "tooltip" ||
          portal.dataset.testid === "tooltip-content") continue;
      for (const child of Array.from(portal.children)) {
        if (on) child.setAttribute("data-infcanvas-suppressed", "1");
        else child.removeAttribute("data-infcanvas-suppressed");
      }
    }
  }


  /* ------------------------------- state ------------------------------- */

  const state = NS.state = {
    active: false,
    exiting: false,
    docs: [],
    activeId: null,
    shell: null,
    tabsHost: null,
    panelKey: null,
    panelBody: null,
    panelToken: 0,
    autosaveTimer: null,
    // Which doc the pending autosave timer belongs to. Cleared together with
    // the timer so closeDoc() can revoke it without cancelling another tab's save.
    autosaveDocId: null,
    results: 0,
  };

  /* Canvas persistence mirrors ComfyUI's workflow store (see workflowStore.ts
     + useWorkflowTabState.ts in the frontend source). Three independent pieces:
       - Tabs: the ordered list of open canvas ids + the active index.
       - Drafts: node/edge/viewport payload for every canvas, keyed by its STABLE
         id (never its name), so unsaved work survives a page refresh.
       - Meta: name/saved per id, so a draft can be told apart from a saved file.
     A saved canvas lives on disk under user/<user>/Cat-Nodes/canvases;
     drafts/tabs/meta are the per-user server-side mirror in
     user/<user>/Cat-Nodes/prefs.json (see infcanvas-prefs.js). */
  const TABS_KEY = "InfCanvas.Tabs.v1";
  const DRAFT_KEY = (id) => "InfCanvas.Draft.v1:" + id;
  const META_KEY = (id) => "InfCanvas.Meta.v1:" + id;
  /* Canvas-generated jobs: persisted so the queue history list survives a page
     refresh (native ComfyUI rebuilds it from /history). Per-user prefs mirror. */
  const JOBS_KEY = "InfCanvas.Jobs.v1";

  /* Every canvas parameter is persisted by NS.prefs into
     user/<account>/Cat-Nodes/prefs.json — never in browser localStorage.
     These aliases keep the many call sites below unchanged. */
  const storageRead = (key) => (NS.prefs ? NS.prefs.get(key, null) : null);
  const storageWrite = (key, value) => NS.prefs?.set(key, value);
  const storageRemove = (key) => NS.prefs?.remove(key);


  const flow = () => NS.flow;
  const activeDoc = () => state.docs.find((doc) => doc.id === state.activeId) || null;
  // Canvas autosave (sidebar Settings panel) — read from per-user prefs, off by default.
  // The settings panel writes it as JSON, same format as storageRead/storageWrite.
  const AUTO_SAVE_KEY = "InfCanvas.Setting.AutoSave";
  const AUTO_SAVE_DELAY_KEY = "InfCanvas.Setting.AutoSaveDelay";
  const autoSaveEnabled = () => storageRead(AUTO_SAVE_KEY) === true;
  /* Autosave interval (ms). Settings stores it in seconds; multiply by 1000 here;
     invalid/missing falls back to 3000ms. */
  const autoSaveDelay = () => {
    const sec = Number(storageRead(AUTO_SAVE_DELAY_KEY));
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 3000;
  };

  /* document model (infcanvas-model.js): node schema, draft/tab persistence
     and document commands. Injected with host helpers; all symbols rebound
     below so the remaining core code and NS.api keep their call sites. */
  const _model = createModel({
    NS, tr, API, refreshViewUrl, backend, uid, readTextFile, toast,
    confirmDialog, promptDialog, state, TABS_KEY, DRAFT_KEY, META_KEY,
    storageRead, storageWrite, storageRemove, flow, activeDoc,
    autoSaveEnabled, autoSaveDelay,
  });
  const { SPECS, TYPE_BY_KIND, SPEC_BY_TYPE, LEGACY_TYPE, TYPE_BY_LEGACY,
    specOf, TITLE_H, SLOT_IDS, baseName, BOOKMARKS_KEY, LEGACY_MODE_NAMES,
    persistTabs, writeDraft, readDraft, clearDraft, newNodeId, nodeFromSpec,
    migrateLegacyGraph, normalizeViewport, migrateMode, normalizeNodeData,
    foldResultNodes, hydrate, unconflictedName, createDoc, markDirty,
    syncDocFromFlow, switchDoc, openFromPayload, importCanvasFile,
    toggleNodeFlag, runSelected, interruptSelected, newCanvas, duplicateDoc,
    readBookmarks, writeBookmarks, isBookmarked, toggleBookmark, renameCanvas,
    duplicateCanvas, refreshNodeDefinitions, renameDoc, openByName, saveActive,
    closeDoc, closeDocsAt } = _model;

  /* ----------------------------- placement ----------------------------- */

  const REVEAL_MARGIN = { top: 8, right: 8, bottom: 56, left: 8 };

  function visibleRect() {
    const vp = flow()?.getViewport?.();
    const host = document.querySelector("#infcanvas-vueflow");
    if (!vp || !host) return null;
    const width = host.clientWidth / (vp.zoom || 1);
    const height = host.clientHeight / (vp.zoom || 1);
    if (!(width > 0) || !(height > 0)) return null;
    return [-vp.x / (vp.zoom || 1), -vp.y / (vp.zoom || 1), width, height];
  }

  function centerPos() {
    const area = visibleRect();
    if (area) return [area[0] + area[2] / 2, area[1] + area[3] / 2];
    return [100, 100];
  }

  function leftOcclusion() {
    const host = document.querySelector("#infcanvas-vueflow");
    const panel = document.querySelector("#infcanvas-panel");
    if (!host || !panel) return 0;
    const box = panel.getBoundingClientRect();
    if (!(box.width > 0)) return 0;
    const base = host.getBoundingClientRect();
    return Math.max(0, box.right - base.left);
  }

  function freeSpot(point, size, role = "asset") {
    const area = visibleRect();
    const zoom = flow()?.getViewport?.().zoom || 1;
    const width = Number(size?.[0]) || 200;
    /* All nodes are frameless: data.size[1] IS the whole frame height. */
    const height = Number(size?.[1]) || 120;
    const step = 30;
    const stride = Math.max(120, width + 20);
    const startX = point[0];
    const startY = point[1];
    const bottom = area ? area[1] + area[3] - REVEAL_MARGIN.bottom - step : startY + 12000;
    const right = area ? area[0] + area[2] - REVEAL_MARGIN.right : startX + 12000;
    const left = area ? area[0] + REVEAL_MARGIN.left + leftOcclusion() / zoom : startX - 12000;

    const taken = (x, y) => {
      for (const node of flow()?.nodesOf?.() || []) {
        const pos = node.position;
        const dim = node.data?.size || [200, 120];
        const h = dim[1] || 120;
        if (x < pos.x + dim[0] && x + width > pos.x && y < pos.y + h && y + height > pos.y) return true;
      }
      return false;
    };

    const columns = [];
    for (let index = 0; index < 12; index += 1) {
      const k = Math.ceil(index / 2);
      const x = index === 0 ? startX : (index % 2 === 1 ? startX + k * stride : startX - k * stride);
      if (area && (x < left || x + width > right)) continue;
      columns.push(x);
    }
    if (!columns.length) columns.push(startX);

    for (let y = startY; y <= bottom; y += step) {
      for (const x of columns) if (!taken(x, y)) return [x, y];
    }
    for (let y = bottom + step; y < startY + 20000; y += step) {
      if (!taken(columns[0], y)) return [columns[0], y];
    }
    return [startX, startY];
  }

  function revealNode(node) {
    const area = visibleRect();
    const vp = flow()?.getViewport?.();
    if (!area || !vp || !node?.position) return;
    const dim = node.data?.size || [200, 120];
    const zoom = vp.zoom || 1;
    const x1 = node.position.x;
    const y1 = node.position.y;
    const x2 = x1 + (dim[0] || 0);
    const y2 = y1 + (dim[1] || 0);
    const left = area[0] + REVEAL_MARGIN.left + leftOcclusion() / zoom;
    const top = area[1];
    const right = area[0] + area[2];
    const bottom = top + area[3];
    let dx = 0, dy = 0;
    if (x2 - x1 + REVEAL_MARGIN.left + REVEAL_MARGIN.right <= right - left) {
      if (x1 < left) dx = x1 - left;
      else if (x2 + REVEAL_MARGIN.right > right) dx = x2 + REVEAL_MARGIN.right - right;
    } else dx = x1 - left;
    if (y2 - y1 + REVEAL_MARGIN.top + REVEAL_MARGIN.bottom <= area[3]) {
      if (y1 - REVEAL_MARGIN.top < top) dy = y1 - REVEAL_MARGIN.top - top;
      else if (y2 + REVEAL_MARGIN.bottom > bottom) dy = y2 + REVEAL_MARGIN.bottom - bottom;
    } else dy = y1 - REVEAL_MARGIN.top - top;
    if (!dx && !dy) return;
    flow().setViewport({ x: vp.x - dx * zoom, y: vp.y - dy * zoom, zoom });
  }

  /* Ctrl+V pasting grips 30px BELOW the card's top-left (x aligned to the left
     edge) — distinct from the title-bar-centre grip used by drags/placement. */
  const PASTE_ANCHOR_OFFSET = { x: 0, y: -30 };

  function addNodeByType(type, pos = null, asset = null, title = null, anchor = null, anchorOffset = null) {
    const spec = specOf(type);
    if (!spec || !flow()) {
      toast("error", tr("core.cannotCreateNode"), tr("core.canvasNotReadyRefreshRetry"));
      return null;
    }
    const autoPlaced = !pos;
    const position = autoPlaced ? freeSpot(centerPos(), spec.size, spec.role) : [pos[0], pos[1]];
    const node = nodeFromSpec(spec, position, asset);
    /* A node that starts life WITH a material is named after that material (the
       file the user dropped or pasted). A generated result passes its title
       explicitly so the new node keeps the plain medium name. */
    if (title !== null) node.data.title = title;
    else if (asset) node.data.title = asset.name || asset.filename || spec.title;
    /* `anchor` is the pointer's final release position for a drag-in. Group
       membership follows that point; the pointer marks the centre of the
       card's title bar, so the top-left sits half a width left / half a
       header up from it (matching the wire-placement grip). */
    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      const off = anchorOffset || flow()?.createAnchorOffset?.(node) || { x: 0, y: 0 };
      node.position = {
        x: anchor.x + (Number(off.x) || 0),
        y: anchor.y + (Number(off.y) || 0),
      };
    }
    flow().addNode(node, anchor);
    flow().selectNodes([node.id]);
    markDirty();
    if (autoPlaced) revealNode(node);
    return node;
  }

  function removeNode(id) {
    if (!flow()) return;
    flow().removeNodes([id]);
    markDirty();
  }

  /* ---- dropping a file ON a node: generator -> material, one way ----
     A media node is a generator until a file lands on it, and that flip is
     final (delete + create to get a generator back). Collapsing the states
     means the flip may never destroy work: a node that already produced a
     result, or that is being fed by upstream nodes, refuses the drop. */
  const MEDIA_LABELS = { image: "wire.image", video: "field.video", audio: "field.audio" };
  function absorbReason(node) {
    const data = node?.data;
    if (!data || data.role !== "media") return tr("core.nodeNotAcceptAsset");
    if (data.asset) return tr("core.alreadyAssetNode");
    if (data.result) return tr("core.hasResultCannotConvert");
    const wired = (flow()?.edgesOf?.() || []).filter((edge) => edge.target === node.id);
    if (wired.length) return tr("core.hasUpstreamDisconnect");
    return "";
  }

  async function absorbFiles(node, files, point) {
    const data = node?.data;
    if (!data) return;
    const file = files?.[0];
    if (!file) return;
    if (files.length > 1) toast("info", tr("core.onlyFirstFileAccepted"), file.name);
    const kind = kindOfFile(file);
    if (!kind) { toast("warning", tr("panel.unsupportedFileType"), file.name); return; }
    const reason = absorbReason(node);
    if (reason) { toast("warning", tr("core.cannotDropAsset"), reason); return; }
    if (kind !== data.kind) {
      toast("warning", tr("core.fileTypeMismatch"),
        tr("core.nodeOnlyAcceptsFiles", { title: data.title || tr(MEDIA_LABELS[data.kind] || data.kind), kind: tr(MEDIA_LABELS[data.kind] || data.kind), file: file.name }));
      return;
    }
    try {
      const asset = await backend.upload(file);
      asset.kind = kind;
      asset.name = asset.name || file.name;
      asset.url = refreshViewUrl(asset).url || viewUrl(asset);
      if (kind === "text") {
        try { asset.text = (await readTextFile(file)).slice(0, 4000); } catch (error) { /* binary */ }
      }
      /* The capsule shows the name the user actually dropped (file.name), not
         the store name the backend gave it (which carries a timestamp suffix). */
      NS.flow?.updateNodeData?.(node.id, kind === "text"
        ? { asset, text: asset.text || "", title: file.name }
        : { asset, title: file.name });
      markDirty();
      NS.ui?.refreshPanels?.();
    } catch (error) { toast("error", tr("panel.uploadFailed"), file.name + " · " + String(error)); }
  }

  /* ComfyUI keeps its own dialogs mounted after closing them (the template
     browser stays in the DOM with data-state="open" while visibility:hidden),
     so a bare querySelector would swallow every canvas shortcut. Only a dialog
     that is actually on screen may own the keyboard. Duplicated verbatim from
     infcanvas-keys.js: the dnd factory is constructed BEFORE the keys factory
     binds its own copy, so it needs a local (hoisted) declaration here. */
  function hostDialogOpen() {
    const dialogs = document.querySelectorAll('[data-reka-dialog-content][data-state="open"]');
    for (const dialog of dialogs) {
      const style = getComputedStyle(dialog);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const box = dialog.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return true;
    }
    return false;
  }

  /* system clipboard / file drop -> nodes (infcanvas-dnd-clipboard.js).
     All canvas helpers stay here; the module closes over the injected refs. */
  const _dnd = createDndClipboard({
    state, flow, NS, TYPE_BY_KIND, kindFromFile, centerPos, addNodeByType,
    markDirty, revealNode, backend, readTextFile, toast, tr, hostDialogOpen,
    PASTE_ANCHOR_OFFSET,
  });
  const kindOfFile = _dnd.kindOfFile;
  const collectFiles = _dnd.collectFiles;
  const rememberPointer = _dnd.rememberPointer;
  const pastePoint = _dnd.pastePoint;
  const isTypingTarget = _dnd.isTypingTarget;
  const createTextNode = _dnd.createTextNode;
  const handleFiles = _dnd.handleFiles;
  const pickFiles = _dnd.pickFiles;
  const setLoraClipboard = _dnd.setLoraClipboard;
  const setGraphClipboard = _dnd.setGraphClipboard;
  const copyGraphSelection = _dnd.copyGraphSelection;
  const onCopy = _dnd.onCopy;
  const onPaste = _dnd.onPaste;
  const loraFromTransfer = _dnd.loraFromTransfer;
  const hasLoraInTransfer = _dnd.hasLoraInTransfer;
  const seedLoraNode = _dnd.seedLoraNode;
  const appendLoraToNode = _dnd.appendLoraToNode;
  const onDrop = _dnd.onDrop;

  /* prompt compiler (infcanvas-prompt-compiler.js). API()/flow() are lazy
     getters; SAFE_INT_MAX is imported from the same module. */
  const _compiler = createPromptCompiler({ API, flow, SLOT_IDS, backend });
  const resolvePassThrough = _compiler.resolvePassThrough;
  const collectUpstreamCleanups = _compiler.collectUpstreamCleanups;
  const collectInputs = _compiler.collectInputs;
  const collectLoras = _compiler.collectLoras;
  const injectLoras = _compiler.injectLoras;
  const mediaSlotNum = _compiler.mediaSlotNum;
  const traceMediaChain = _compiler.traceMediaChain;
  const scanMediaGroups = _compiler.scanMediaGroups;
  const makeMediaIdGen = _compiler.makeMediaIdGen;
  const renumberSlotKey = _compiler.renumberSlotKey;
  const nextMediaSlotNum = _compiler.nextMediaSlotNum;
  const cloneMediaGroup = _compiler.cloneMediaGroup;
  const detachMediaGroup = _compiler.detachMediaGroup;
  const injectMediaSlots = _compiler.injectMediaSlots;
  const injectBareLoadImage = _compiler.injectBareLoadImage;
  const assetPath = _compiler.assetPath;
  const applyNodeInputs = _compiler.applyNodeInputs;
  const seedOrRandom = _compiler.seedOrRandom;
  const buildPrompt = _compiler.buildPrompt;
  /* generation progress (infcanvas-progress.js): result extraction, field
     control, native-WebSocket progress bridge and NS.generate. Injected with
     document/schema and compiler symbols; rebound below for core callers. */
  const _progress = createProgress({
    NS, tr, API, viewUrl, backend, sleep, TYPE_BY_KIND, SPEC_BY_TYPE,
    toast, state, JOBS_KEY, storageRead, storageWrite, flow, activeDoc,
    markDirty, addNodeByType, removeNode, collectUpstreamCleanups,
    collectInputs, collectLoras, buildPrompt,
  });
  const { extractOutputs, CANCEL_SENTINEL, pollHistory, attachResults,
    nextControlledValue, genProgress, cancelledJobs } = _progress;

  /* canvas lifecycle + keyboard (infcanvas-keys.js): injected with state/flow,
     storage, dialogs and the dnd/clipboard callbacks. Bound below so NS.api
     keeps the same command objects. */
  const _keys = createKeys({
    NS, tr, backend, toast, confirmDialog, suppressPreexistingDialogs, state,
    TABS_KEY, META_KEY, storageRead, flow, absorbReason, absorbFiles,
    collectFiles, rememberPointer, setGraphClipboard, onCopy, onPaste,
    loraFromTransfer, hasLoraInTransfer, appendLoraToNode, onDrop,
    readDraft, writeDraft, persistTabs, createDoc, saveActive, markDirty,
    switchDoc, baseName, genProgress, syncDocFromFlow, importCanvasFile,
    refreshNodeDefinitions, runSelected, interruptSelected, toggleNodeFlag,
  });
  const { ensureSurface, enter, exit, onKeyDown, onKeyBubble,
    init } = _keys;

  /* LoRA names come straight from ComfyUI's object_info (the same source the
     real Load LoRA node uses). Cached for the session; an empty result just
     leaves the stack's dropdown empty and the node still functional. */
  let loraNamesCache = null;
  async function loraNames(force = false) {
    if (!force && loraNamesCache) return loraNamesCache;
    try {
      const defs = await API().getNodeDefs();
      const names = defs?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
      loraNamesCache = Array.isArray(names) ? names.slice() : [];
    } catch (error) { loraNamesCache = []; }
    return loraNamesCache;
  }

  NS.api = {
    init, enter, exit, toast, confirmDialog, promptDialog, viewUrl, resolveMediaUrl,
    markDirty, saveActive, closeDoc, closeDocsAt, openByName, newCanvas,
    copySelection: copyGraphSelection,
    copyLora: setLoraClipboard,
    refreshNodeDefinitions, importCanvasFile, openFromPayload, toggleNodeFlag, runSelected, interruptSelected,
    renameDoc, duplicateDoc, switchDoc,
    renameCanvas, duplicateCanvas, isBookmarked, toggleBookmark,
    addNodeByType, removeNode, revealNode, freeSpot, pastePoint, activeDoc, kindFromFile, esc,
    readTextFile, pickFiles,
    addToFavorites, loraNames, listPrompts, addPrompt, removePrompt, updatePrompt,
    docs: () => state.docs, activeId: () => state.activeId,
    isActive: () => state.active,
    /** @deprecated kept for extensions written against the LiteGraph build. */
    canvas: () => null,
    activeGraph: () => activeDoc(),
  };

  if (NS.pendingApp && !NS.ready && NS.css && NS.ui?.injectStyles) init(NS.pendingApp);
})();
