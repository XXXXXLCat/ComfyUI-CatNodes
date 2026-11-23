/* Flow assembly entry: builds the Vue Flow engine from the split modules.

   Owns the shared reactive state, DOM/canvas helpers (applyTip, clamp, video
   thumbnails, bringToFront, grouping), the workflow list and the
   workflowAcceptsText predicate. It binds the history/clipboard composable,
   creates Root and the NS.flow façade, then exposes both on NS for core.
   i18n loads after this module, so t() resolves NS.i18n lazily. */
import { Vue as VueNS, VueFlow as FlowNS } from "./vendor/vueflow.bundle.mjs";
import {
  isAudioGenData,
  isVideoGenData,
  isImageGenData,
  isTextGenData,
  dedupeEdges,
  WF_FALLBACK,
} from "./flow-rules.js";
import { videoThumbs } from "./flow-components.js";
import { injectStyles } from "./flow-styles.js";
import { createHistoryClipboard } from "./flow-history-clipboard.js";
import { createIcNode } from "./flow-node-view.js";
import { createRoot } from "./flow-root.js";
import { createFlowController } from "./flow-controller.js";

(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* Native ComfyUI tooltip (shared engine in native-tip.js) — replaces
      `el.title = ...` with the host's themed Reka tooltip. */
  const bindTip = (el, text, side) => {
    if (!el) return el;
    if (NS.tip?.bindTip) return NS.tip.bindTip(el, text, side);
    return el; // native-tip.js is always installed; no browser title fallback
  };
  /* v-tip directive helper: empty/false text falls back to no tooltip. */
  function applyTip(el, text) {
    if (!el) return;
    const value = text == null || text === false ? "" : String(text);
    if (!value) { el.removeAttribute("title"); return; }
    bindTip(el, value);
  }
  const { createApp, ref, computed, reactive, watch, onMounted, onBeforeUnmount, nextTick } = VueNS;
  const { VueFlow: VueFlowComponent, Handle } = FlowNS;
  /* i18n loads after this file (alphabetical flow < i18n), so resolve t lazily
     at call time; every call site runs after the app is mounted. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

  /* ------------------------------ geometry ------------------------------ */

  const SLOT_STEP = 20;            // LiteGraph.NODE_SLOT_HEIGHT
  /* Zoom range in plain scale factors: 10% .. 1000%. The upper bound matches
     ComfyUI's own ZoomControlsModal (aria-valuemax 1000) and the toolbar's
     MAX_SCALE, so the popup, the wheel and the percentage field all agree. */
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10;

  /* README.md "in-node accent #F2FF59 → #0B8CE9": this azure is the reference
     project's --accent-yellow override (xcat-overrides.css:4946). */

  /* Asset media nodes: minimum width and the fixed width used when a source
     is first loaded (height then follows the source aspect ratio). */
  const ASSET_MIN_W = 320;
  const ASSET_DEF_W = 480;
  /* Node header strip — the darker band at the top of every card. ComfyUI 2.0
     builds it from LGraphNode.vue (.node-inner-wrapper = bg-node-header) plus a
     NodeHeader.vue child (p-1 around an icon-sm control), then paints the body
     with bg-node on top; the two greys are --node-header = charcoal-700
     #202121 and --node = --card = charcoal-600 #262729 (read out of the shipped
     main-*.css). HEAD_H is 28, MEASURED on a live node (NodeHeader = p-1 (4px)
     around an icon-sm Button = size-5 (20px), title text-xs): 4+20+4. It is part
     of data.size — the body gets whatever is left. */
  const HEAD_H = 28;





  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /* --------------------- video thumbnail (offscreen seek) ---------------- */
  /* Mirrors the reference project's xcat-video-edit.js buildThumbs: an offscreen
     <video> seeks to an early frame and a canvas snapshots it to a data URL.
     Module-level so every generator node shares one cache / decode per url. */
  const videoThumbCache = new Map();     // url -> dataURL | null (null = failed, don't retry)
  const videoThumbBusy = new Set();      // urls currently decoding
  const ensureVideoThumb = (url) => {
    if (!url) return;
    if (videoThumbCache.has(url)) {
      const d = videoThumbCache.get(url);
      if (d) videoThumbs[url] = d;
      return;
    }
    if (videoThumbBusy.has(url)) return;
    videoThumbBusy.add(url);
    const v = document.createElement("video");
    let finished = false;
    const finish = (dataUrl) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      v.onloadeddata = v.onseeked = v.onerror = null;
      try { v.removeAttribute("src"); v.load(); } catch (e) { /* optional */ }
      videoThumbBusy.delete(url);
      videoThumbCache.set(url, dataUrl || null);
      if (dataUrl) videoThumbs[url] = dataUrl;
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    v.onloadeddata = () => {
      try {
        const d = v.duration;
        v.currentTime = Number.isFinite(d) && d > 0.2 ? 0.1 : 0;
      } catch (e) { finish(null); }
    };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 160;
        c.height = v.videoHeight || 90;
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        finish(c.toDataURL("image/jpeg", 0.72));
      } catch (e) { finish(null); }
    };
    v.onerror = () => finish(null);
    v.src = url;
  };

  /* ------------------------------- state -------------------------------- */

  const state = {
    app: null,
    host: null,
    flow: null,                       // useVueFlow() instance
    mounted: false,
    nodes: ref([]),
    edges: ref([]),
    /* ComfyUI-style visual groups: { id, title, x, y, w, h } in graph units.
       Rendered behind nodes and saved with the canvas. */
    groups: ref([]),
    groupEditing: ref(null),          // { id, value } while a group title is being renamed
    selectedGroupIds: ref([]),        // groups may join a multi-selection alongside nodes
    /* Groups that currently satisfy the drop-in condition while nodes are
       being dragged; rendered with the same highlight as a selected group. */
    dropTargetGroupIds: ref([]),
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    mode: ref("select"),              // "select" | "drag"
    minimap: ref(false),
    snap: ref(false),                 // grid snap (10px) toggle
    /* Ids of the currently selected nodes. Kept here (not in an edge component)
       so every edge can turn white when either of its endpoints is selected —
       ComfyUI's LGraphCanvas.highlighted_links, derived from the selection. */
    selectedIds: ref([]),
    onDirty: null,                    // set by core
  };

  /* Last-selected wins: move the touched items to the end of their list.
     Vue Flow renders nodes in array order with equal z-index, and our groups
     render in array order too, so later DOM = visually on top. Unlike a
     z-index counter this never outgrows the fixed overlay layers (toolbars,
     palettes, minimap). */
  function bringToFront(list, ids) {
    const wanted = new Set(ids);
    if (!wanted.size) return;
    const current = list.value;
    const front = current.filter((entry) => wanted.has(entry.id));
    if (!front.length) return;
    const rest = current.filter((entry) => !wanted.has(entry.id));
    list.value = rest.concat(front);
  }

  /* A node created inside a group belongs to that group. Creation places the
     card by its top-left corner, so testing its CENTER is what matches "I
     dropped it in here"; full containment (the drag rule) would reject most
     newly created cards. Overlapping groups pick the smallest rectangle, the
     same tie-break used when dragging a node into a group. */
  function groupForNewNode(node, anchor = null) {
    let cx, cy;
    /* A drop carries the pointer's FINAL release position in graph units:
       that is where the user says the material landed, even when the card's
       own centre ends up elsewhere (small group, multi-file stagger, ...). */
    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      cx = anchor.x;
      cy = anchor.y;
    } else {
      const pos = node?.position;
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
      const size = Array.isArray(node.data?.size) ? node.data.size : [480, 270];
      cx = pos.x + (Number(size[0]) || 480) / 2;
      cy = pos.y + (Number(size[1]) || 270) / 2;
    }
    const hits = state.groups.value.filter((group) =>
      cx >= group.x && cx <= group.x + group.w &&
      cy >= group.y && cy <= group.y + group.h);
    if (hits.length > 1) hits.sort((a, b) => a.w * a.h - b.w * b.h);
    return hits[0] || null;
  }




  /* Shared workflow list for the bottom-left selector of every generate node.
     The API 配置 dialog (js/infcanvas-api-config.js) dispatches
     "infcanvas:workflows-changed" after upload / reorder / delete — this is
     the same wiring as the reference project's
     "infinite-canvas:workflows-changed" -> useGraph.loadWorkflowNames(true).
     One module-level listener keeps all node selectors in sync. */
  const SHARED_WF_LIST = ref([]);
  const loadWorkflows = (force = false) => {
    if (!force && SHARED_WF_LIST.value.length && SHARED_WF_LIST.value !== WF_FALLBACK) return;
    Promise.resolve(NS.backend?.workflows?.())
      .then((res) => {
        const list = Array.isArray(res?.workflows) ? res.workflows : [];
        SHARED_WF_LIST.value = list.length ? list : WF_FALLBACK;
      })
      .catch(() => { SHARED_WF_LIST.value = WF_FALLBACK; });
  };
  window.addEventListener("infcanvas:workflows-changed", () => loadWorkflows(true));




  /* node view (flow-node-view.js): one component for every node role.
     The component keeps calling the NS.flow façade, so no call sites change. */
  const IcNode = createIcNode({
    NS, state, t, clamp, bindTip, SHARED_WF_LIST, loadWorkflows, bringToFront,
    SLOT_STEP, ASSET_MIN_W, ASSET_DEF_W, HEAD_H, ensureVideoThumb,
  });



  /* A text wire is only a prompt. If the chosen workflow exposes no text
     field and carries no {{prompt}} / {{text}} placeholder, the node hides
     its prompt area — accepting the wire here would silently drop it. Read
     the node's own field list (a live mirror of the template) so this gate
     follows the same set the panel shows; an old node with no list keeps the
     old behaviour. */
  function workflowAcceptsText(data) {
    if (!data) return true;
    const snap = data.fieldSnapshot;
    const list = Array.isArray(snap?.list) ? snap.list : null;
    if ((snap ? Boolean(snap.promptSlot) : Boolean(data.promptSlot)) || data.promptMap) return true;
    if (isAudioGenData(data)) {
      if (data.audioMap?.a || data.audioMap?.b) return true;
      return list ? list.some((f) => f?.type === "text" || f?.type === "textarea") : true;
    }
    if (!isImageGenData(data) && !isVideoGenData(data) && !isTextGenData(data)) return true;
    if (!list) return true;
    /* The node shows EVERY exposed multiline-text field by name, so any of
       them accepts a wired text node — no 提示词/prompt name lock. */
    return list.some((f) => f?.type === "text" || f?.type === "textarea");
  }

  /* -------------------------------- root app ------------------------------ */


  /* undo/redo history + selection clipboard (flow-history-clipboard.js).
     Injected with the reactive state and helpers; the returned functions are
     bound here so all existing call sites keep working unchanged. */
  const _hc = createHistoryClipboard({
    state, dedupeEdges, nextTick,
    getFlow: () => flow,
    NS,
  });
  const syncLivePositions = _hc.syncLivePositions;
  const historySchedule = _hc.historySchedule;
  const historyCommit = _hc.historyCommit;
  const historyReset = _hc.historyReset;
  const historyUndo = _hc.historyUndo;
  const historyRedo = _hc.historyRedo;
  const historyAbsorb = _hc.historyAbsorb;
  const history = _hc.history;
  const copySelection = _hc.copySelection;
  const pasteGraph = _hc.pasteGraph;
  /* Root component (flow-root.js): injected with closure helpers and the
     history/clipboard callbacks just bound from _hc above. */
  const Root = createRoot({
    NS, t, MIN_ZOOM, MAX_ZOOM, state, bringToFront, groupForNewNode, IcNode,
    workflowAcceptsText, syncLivePositions, historySchedule, copySelection,
    pasteGraph,
  });

  const flow = NS.flow = createFlowController({
    NS, applyTip, t, MIN_ZOOM, MAX_ZOOM, HEAD_H, clamp, state,
    groupForNewNode, workflowAcceptsText, Root, injectStyles, dedupeEdges, nextTick,
    syncLivePositions, historySchedule, historyCommit, historyReset,
    historyUndo, historyRedo, historyAbsorb, copySelection, pasteGraph,
  });
})();
