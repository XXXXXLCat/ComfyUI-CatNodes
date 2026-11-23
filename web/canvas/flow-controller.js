/* Flow controller: the imperative NS.flow façade over the Vue Flow app.

   Owns Vue mount/init and the commands core and extensions call (fit view,
   zoom, selection, node add/remove, minimap, viewport/coordinate helpers).
   The Vue component tree lives in flow-root.js; the injected history/clipboard
   callbacks are bound in infcanvas-flow.js. Everything else is injected here,
   so this module owns no document state. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";
import { dedupeEdges } from "./flow-rules.js";
import { injectStyles } from "./flow-styles.js";

/* NS.flow facade (batch 7): the public contract exposed to core and extensions.
   Extracted from infcanvas-flow.js. Mount name, method names and the callback
   slots (onReady/onViewport/onSelection replaced by core) are unchanged. */
const { createApp, reactive, ref } = VueNS;
export function createFlowController({ NS, applyTip, t, MIN_ZOOM, MAX_ZOOM, HEAD_H, clamp, state, groupForNewNode, workflowAcceptsText, Root, injectStyles, dedupeEdges, nextTick, syncLivePositions, historySchedule, historyCommit, historyReset, historyUndo, historyRedo, historyAbsorb, copySelection, pasteGraph }) {
  /* Mute flag for the category-default adoption watcher; written by setRenaming,
     read by api-config during a workflow rename. Kept internal to the facade. */
  let renamingWorkflows = false;

const flow = NS.flow = {
  state,
  init(stage) {
    injectStyles();
    if (!this.host) {
      const host = document.createElement("div");
      host.id = "infcanvas-vueflow";
      this.host = host;
    }
    stage.appendChild(this.host);
    if (!state.app) {
      state.app = createApp(Root);
      /* v-tip: native ComfyUI tooltip in place of `:title`. Node templates
         set `:title` on dozens of controls; the browser's title bubble is
         unthemeable, so this directive routes the same text through the
         shared native-tip engine (themed Reka bubble + arrow), and keeps it
         live when the expression changes (language toggle / state changes). */
      state.app.directive("tip", {
        mounted(el, binding) { applyTip(el, binding.value); },
        updated(el, binding) {
          if (binding.value !== binding.oldValue) applyTip(el, binding.value);
        },
        unmounted(el) { if (el.__xcatTipOff) el.__xcatTipOff(); },
      });
      /* Expose reactive $t to every node template; switching language
         updates the shared lang ref and re-renders all template text. */
      if (NS.i18n) {
        state.app.config.globalProperties.$t = NS.i18n.t;
        state.app.config.globalProperties.$cat = NS.i18n.cat;
      }
      state.app.mount(this.host);
    }
    return this.host;
  },

  unmount() {
    if (this.host?.parentElement) this.host.parentElement.removeChild(this.host);
  },

  /* ---- docs ---- */
  load(doc) {
    state.nodes.value = doc.nodes || [];
    state.groups.value = Array.isArray(doc.groups) ? doc.groups : [];
    state.selectedGroupIds.value = [];
    /* Collapse any duplicate source→target wires already present in an old
       save so every downstream count sees one connection per node pair. */
    state.edges.value = dedupeEdges(doc.edges);
    const viewport = doc.viewport || { x: 0, y: 0, zoom: 1 };
    state.viewport.value = { x: viewport.x || 0, y: viewport.y || 0, zoom: viewport.zoom || 1 };
    nextTick(() => {
      try { state.flow?.setViewport(state.viewport.value, { duration: 0 }); } catch (error) { /* optional */ }
    });
    /* A freshly opened document is the undo baseline. */
    historyReset();
  },

  /* ---- undo / redo (Ctrl+Z / Ctrl+Y) ---- */
  history: {
    schedule: historySchedule,
    commit: historyCommit,
    reset: historyReset,
    undo: historyUndo,
    redo: historyRedo,
    canUndo: () => history.past.length > 0,
    canRedo: () => history.future.length > 0,
    absorb: historyAbsorb,
    /* Stack depth — handy for the live checks and a future toolbar state. */
    size: () => ({ past: history.past.length, future: history.future.length, ready: !!history.last }),
  },

  /* Workflow templates are referenced by their file stem (node.data.workflow),
     so renaming one in the API dialog would leave every existing node pointing
     at a name that no longer exists. Retarget them in place; the reactive data
     object re-renders the node's API selector and its fields request. */
  /** Mute the category-default adoption while a rename is in flight. */
  setRenaming(on) { renamingWorkflows = !!on; },
  /* Read side for the category-default adoption watcher in the node component.
     That component is a factory with its own scope and cannot see the closure
     variable above; reading it there used to throw ReferenceError, which killed
     adoptDefaultWorkflow and stopped modes from switching their workflow. */
  isRenamingWorkflows() { return renamingWorkflows; },

  /** Same prompt gate the canvas uses, exposed for live checks. */
  acceptsText(nodeId) {
    return workflowAcceptsText(state.nodes.value.find((n) => n.id === nodeId)?.data);
  },

  renameWorkflowRefs(from, to) {
    if (!from || !to || from === to) return 0;
    let changed = 0;
    for (const node of state.nodes.value) {
      const data = node && node.data;
      if (!data || data.workflow !== from) continue;
      data.workflow = to;
      /* The frozen parameter set belongs to the same graph — only the file
         name moved. Retarget it so a finished node does not refetch (and lose
         its frozen config) just because the template was renamed. */
      if (data.fieldSnapshot && data.fieldSnapshot.workflow === from) {
        data.fieldSnapshot.workflow = to;
        if (data.fieldSnapshot.name === from) data.fieldSnapshot.name = to;
      }
      changed += 1;
    }
    return changed;
  },

  snapshot() {
    /* Positions live in Vue Flow's store, not in our array: pull them back
       before serialising or the saved canvas reopens at the old coordinates. */
    syncLivePositions();
    return {
      nodes: JSON.parse(JSON.stringify(state.nodes.value)),
      edges: JSON.parse(JSON.stringify(state.edges.value)),
      groups: JSON.parse(JSON.stringify(state.groups.value)),
      viewport: { ...state.viewport.value },
    };
  },

  /* ---- selection clipboard ---- */
  copySelection,
  pasteGraph,

  /* ---- viewport ---- */
  getViewport() { return state.flow?.getViewport?.() || { ...state.viewport.value }; },
  setViewport(vp) {
    const value = { x: vp.x || 0, y: vp.y || 0, zoom: vp.zoom || 1 };
    state.viewport.value = value;
    state.flow?.setViewport(value, { duration: 0 });
  },
  /* Delta from the pointer to the node's top-left corner, in graph units.
     The pointer marks the CENTRE OF THE TITLE BAR: half the card width to the
     left, half the header height up. Pill nodes (cleanup / text collage) have
     no body — their whole 30px is the title bar. */
  createAnchorOffset(node) {
    const size = Array.isArray(node?.data?.size) ? node.data.size : null;
    const w = Number(size?.[0]) || 480;
    const role = node?.data?.role;
    const pill = role === "cleanup" || role === "text_merge";
    const headH = pill ? (Number(size?.[1]) || 30) : HEAD_H;
    return { x: -w / 2, y: -headH / 2 };
  },
  screenToFlow(clientX, clientY) {
    const box = this.host?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return state.flow.screenToFlowCoordinate({ x: clientX, y: clientY });
  },
  flowToScreen(x, y) {
    const p = state.flow.flowToScreenCoordinate({ x, y });
    return { x: p.x, y: p.y };
  },
  zoomIn() { state.flow?.zoomIn({ duration: 120 }); },
  zoomOut() { state.flow?.zoomOut({ duration: 120 }); },
  /* One setViewport call only: Vue Flow applies it asynchronously, so calling
     setViewport twice (once to zoom, once to re-centre) lets the second write
     race back to the old zoom. Compute the final transform here instead. */
  setZoom(zoom) {
    const target = clamp(Number(zoom) || 1, MIN_ZOOM, MAX_ZOOM);
    const vp = this.getViewport();
    const box = this.host?.getBoundingClientRect();
    if (!box) { state.flow?.setViewport({ ...vp, zoom: target }, { duration: 0 }); return; }
    const cx = (box.width / 2 - vp.x) / (vp.zoom || 1);
    const cy = (box.height / 2 - vp.y) / (vp.zoom || 1);
    state.flow?.setViewport({
      x: box.width / 2 - cx * target,
      y: box.height / 2 - cy * target,
      zoom: target,
    }, { duration: 0 });
  },
  viewportCenter() {
    const vp = this.getViewport();
    const box = this.host?.getBoundingClientRect();
    const width = box?.width || 1;
    const height = box?.height || 1;
    return {
      x: (width / 2 - vp.x) / vp.zoom,
      y: (height / 2 - vp.y) / vp.zoom,
      width, height,
    };
  },
  centerOn(x, y, zoom = null) {
    const box = this.host?.getBoundingClientRect();
    const scale = zoom || this.getViewport().zoom;
    state.flow?.setViewport({
      x: (box?.width || 1) / 2 - x * scale,
      y: (box?.height || 1) / 2 - y * scale,
      zoom: scale,
    }, { duration: 0 });
  },
  panBy(dx, dy) {
    const vp = this.getViewport();
    state.flow?.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 0 });
  },
  /* ComfyUI's Comfy.Canvas.FitView -> LGraphCanvas.fitViewToSelectionAnimated()
     -> DragAndScale.animateToBounds(), ported 1:1:
       - selected nodes win; with nothing selected the whole graph is used
       - fill ratio 0.75 (animateToBounds' `zoom` option), not a jump
       - each axis divides by max(bounds, 300) so a single small node is not
         blown up to the 1000% ceiling
       - scale is capped by max_scale and eased over 350ms
     Vue Flow maps graph -> screen as screen = graph * zoom + offset, while
     LiteGraph uses one extra *scale, hence x = centre - graphCentre * zoom. */
  fitView(fill = 0.75) {
    const selected = this.selectedNodes();
    const pool = selected.length ? selected : state.nodes.value;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of pool) {
      const size = node.data?.size || [200, 150];
      const x = node.position?.x ?? 0;
      const y = node.position?.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + (size[0] || 200));
      /* Every node is a plain size[1]-tall card (no 30px gen header). */
      maxY = Math.max(maxY, y + (size[1] || 150));
    }
    const box = this.host?.getBoundingClientRect();
    if (!Number.isFinite(minX) || !box) return false;
    /* Fit into what the user can actually see: a docked panel covers the
       left edge, which is ComfyUI's visibleCanvasViewport(). */
    const left = this.visibleLeft();
    const vw = Math.max(1, box.width - left);
    const vh = Math.max(1, box.height);
    const bw = maxX - minX;
    const bh = maxY - minY;
    const zoom = clamp(
      Math.min((fill * vw) / Math.max(bw, 300), (fill * vh) / Math.max(bh, 300)),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    state.flow?.setViewport({
      x: left + vw / 2 - (minX + bw / 2) * zoom,
      y: vh / 2 - (minY + bh / 2) * zoom,
      zoom,
    }, { duration: 350 });
    return true;
  },
  /* Width of the left dock that covers the canvas right now (screen px). */
  visibleLeft() {
    const box = this.host?.getBoundingClientRect();
    const panel = document.querySelector("#infcanvas-panel");
    if (!box || !panel) return 0;
    const p = panel.getBoundingClientRect();
    if (!(p.width > 0)) return 0;
    return Math.max(0, Math.min(box.width, p.right - box.left));
  },
  setMode(mode) { state.mode.value = mode === "drag" ? "drag" : "select"; },
  /* ---- grid snap (10px cells) ---- */
  snap: {
    enabled() { return !!state.snap.value; },
    set(value) { state.snap.value = !!value; },
    toggle() { state.snap.value = !state.snap.value; return state.snap.value; },
  },
  /* Called before serialising: Vue Flow owns the live node positions. */
  syncPositions() { syncLivePositions(); },

  /* ---- nodes / edges ---- */
  addNode(node, anchor = null) {
    state.nodes.value = state.nodes.value.concat([node]);
    const group = groupForNewNode(node, anchor);
    if (group) {
      if (!Array.isArray(group.nodes)) group.nodes = [];
      if (!group.nodes.includes(node.id)) group.nodes.push(node.id);
    }
    return node;
  },
  removeNodes(ids) {
    const set = new Set(ids);
    state.nodes.value = state.nodes.value.filter((node) => !set.has(node.id));
    state.edges.value = state.edges.value.filter((edge) => !set.has(edge.source) && !set.has(edge.target));
  },
  removeEdges(ids) {
    const set = new Set(ids);
    state.edges.value = state.edges.value.filter((edge) => !set.has(edge.id));
    NS.api?.markDirty?.();
  },
  addEdge(edge) { state.edges.value = state.edges.value.concat([edge]); },
  nodesOf() { return state.nodes.value; },
  edgesOf() { return state.edges.value; },
  /* Expose the live (Vue Flow store) node: its position is authoritative
     while the source array may still hold the pre-drag coordinates. */
  findNode(id) {
    return state.flow?.findNode?.(id) || state.nodes.value.find((node) => node.id === id) || null;
  },
  /* Keep the serialised source array in sync with the reactive copy Vue Flow
     hands to node components (generated params, text edits, resize, uploads). */
  updateNodeData(id, fields) {
    const src = state.nodes.value.find((node) => node.id === id);
    const live = state.flow?.findNode?.(id);
    for (const [key, value] of Object.entries(fields)) {
      if (src) src.data[key] = value;
      if (live?.data && live.data !== src?.data) live.data[key] = value;
    }
    NS.api?.markDirty?.();
  },
  /* Corner-resize moves the node's top-left as well as its size. Vue Flow
     owns the live (reactive) position in its store — dragging itself writes
     node.position directly — so do the same here, and mirror into the source
     array so serialising (and syncLivePositions) sees the new coordinates. */
  setNodePosition(id, position) {
    const pos = { x: position.x, y: position.y };
    const src = state.nodes.value.find((node) => node.id === id);
    const live = state.flow?.findNode?.(id);
    if (src) src.position = { ...pos };
    if (live) live.position = pos;
    NS.api?.markDirty?.();
  },
  revealNode(node) { NS.api?.revealNode?.(node); },
  selectedNodes() { return state.flow?.getSelectedNodes?.value || []; },
  /* Selection lives in Vue Flow's own store, so go through its API instead of
     flipping `node.selected` on our plain objects (they are not the same). */
  selectNodes(ids, keepGroups = false) {
    const api = state.flow;
    if (!api) return;
    try {
      const current = api.getSelectedNodes?.value || [];
      if (current.length) api.removeSelectedNodes(current);
      const nodes = ids.map((id) => api.findNode(id)).filter(Boolean);
      if (nodes.length) {
        api.addSelectedNodes(nodes);
        /* A single node is a replacement selection, just like a plain click;
           a bulk select keeps any groups already in the shared selection. */
        if (nodes.length === 1 && !keepGroups) state.selectedGroupIds.value = [];
      }
      /* Mirror immediately so the edge highlight does not wait a tick. */
      state.selectedIds.value = nodes.map((node) => node.id);
    } catch (error) { console.warn("[InfCanvas] select failed", error); }
  },

  /* ---- minimap ---- */
  minimap: {
    toggle() {
      state.minimap.value = !state.minimap.value;
      NS.controls?.syncMapButton?.();
      return state.minimap.value;
    },
    set(visible) {
      state.minimap.value = !!visible;
      NS.controls?.syncMapButton?.();
    },
    visible() { return state.minimap.value; },
  },

  pauseAll() {
    for (const media of this.host?.querySelectorAll("video, audio") || []) {
      try { media.pause(); } catch (error) { /* optional */ }
    }
  },

  markDirty() { state.onDirty?.(); },
  onReady() { /* replaced by core */ },
  onViewport() { /* replaced by core */ },
  onSelection() { /* replaced by core */ },
};

  return flow;
}
