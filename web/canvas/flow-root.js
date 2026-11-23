/* Vue Flow root component: the canvas stage and its pointer/keyboard behavior.

   Wire validation, drag-to-create placement, node/group selection, Alt-edge
   cutting, minimap viewport sync and the root template's overlay markup live
   here. Node rendering itself is IcNode (flow-node-view.js); this module owns
   the stage around it and receives all cross-cutting helpers by injection. */
import {
  Vue as VueNS, VueFlow as FlowNS, MiniMap, Background,
} from "./vendor/vueflow.bundle.mjs";
import { IcIcon } from "./flow-icons.js";
import {
  KIND_CN,
  AUDIO_INPUT_RULES,
  AUDIO_MODES,
  VIDEO_INPUT_RULES,
  VIDEO_MODES,
  IMAGE_MODES,
  IMAGE_INPUT_RULES,
  TEXT_INPUT_RULES,
  TEXT_WIRE_CAPS,
  TEXT_MODES,
  TAG_BY_NAME,
  GEN_ACCEPTS,
  acceptsKind,
  isAudioGenData,
  isVideoGenData,
  isImageGenData,
  isTextGenData,
  isMusicMode,
  audioRefMode,
  textAutoMode,
  assetKindOf,
  incomingKindCounts,
  edgeKey,
  textWireFullReason,
  modeReasonFor,
} from "./flow-rules.js";
import { TagMenu } from "./flow-components.js";
import { makeIcEdge, makeIcConnectionLine } from "./flow-edges.js";

/* Root component (batch 7): the Vue Flow canvas app. Extracted from
   infcanvas-flow.js. Vendor/rule/component deps are imported locally; the
   IIFE-closure symbols (state, t, helpers, history callbacks) are injected. */
const { ref, computed, reactive, watch, onMounted, onBeforeUnmount, nextTick } = VueNS;
const { VueFlow: VueFlowComponent } = FlowNS;
export function createRoot({ NS, t, MIN_ZOOM, MAX_ZOOM, state, bringToFront, groupForNewNode, IcNode, workflowAcceptsText, syncLivePositions, historySchedule, copySelection, pasteGraph }) {
const Root = {
  components: { VueFlow: VueFlowComponent, MiniMap, Background, IcConnectionLine: makeIcConnectionLine(), IcIcon, TagMenu },
  setup() {
    const showMinimap = ref(state.minimap.value);
    const zoomFar = ref(state.viewport.value.zoom < 0.6);   // <60% hides link dots
    const cutMode = ref(false);                             // Alt knife armed
    const groupingFrozen = ref(false);                      // hide node chrome during grouping
    const mode = state.mode;
    const snap = state.snap;
    const groups = state.groups;
    const groupEditing = state.groupEditing;
    const selectedGroupIds = state.selectedGroupIds;
    const dropTargetGroupIds = state.dropTargetGroupIds;
    /* Marquee selection mode is direction-sensitive (like ComfyUI / CAD):
       drag left->right = window mode (a node is selected only when its whole
       rect lies inside the marquee -> Vue Flow SelectionMode.Full); drag
       right->left = crossing mode (any overlap selects -> SelectionMode.Partial).
       Vue Flow re-reads this every pointermove, so updating it during the
       stroke switches the mode live. */
    const selectionMode = ref("full");
    /* Interaction map is ComfyUI's default, Comfy.Canvas.NavigationMode =
       "legacy" / Drag Navigation (coreSettings.ts):
         - left drag on the pane pans, exactly like the reference canvas
         - a marquee needs Ctrl/Cmd held; LGraphCanvas.ts:2826 only starts
           _setupNodeSelectionDrag when ctrlOrMeta is pressed
         - clicking with Shift/Ctrl/Meta toggles a node in the selection
         - marquee is direction-sensitive (like ComfyUI/litegraph): drag
           left->right = window mode (fully contained), right->left =
           crossing mode (any overlap). See selectionMode / setMarqueeMode.
       Do not turn this into "left drag selects" -- that is the "standard"
       navigation mode, which is not what ComfyUI ships. */

    /* Background is now Vue Flow's native <Background variant="dots"> —
       default #81818a dots, gap 20, size 1, following viewport zoom/pan.
       The old hand-drawn ComfyUI grid canvas was removed. */

    const onInit = (instance) => {
      state.flow = instance;
      state.mounted = true;
      const vp = state.viewport.value;
      instance.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom }, { duration: 0 });
      /* Selection is Vue Flow's own state (click, Ctrl+click, marquee,
         Ctrl+A, node deletion). Mirror it into state.selectedIds so every
         edge can tell whether one of its endpoints is selected — the same
         relationship ComfyUI's highlighted_links derives from the selection. */
      watch(() => (instance.getSelectedNodes?.value || []).map((node) => node.id),
        (ids) => { state.selectedIds.value = ids; }, { immediate: true, deep: true });
      NS.flow?.onReady?.();
    };

    /* Inverse zoom for the node-attached floating chrome (action row +
       generator panel). These overlays live INSIDE VueFlow's scale(zoom)
       pane so they follow their node for free; multiplying their own
       transform by 1/zoom cancels that scale, keeping them at a constant
       SCREEN size — the same "outside the scaled layer" feel as the menus.
       Bound as a CSS var on .ic-flow so Vue applies it to every node at once. */
    const iz = computed(() => 1 / (state.viewport.value.zoom || 1));
    /* Handle magnet radius lives OUTSIDE the scaled layer: Vue Flow compares
       the pointer (converted to flow coords) against handles using this radius
       in FLOW units, so it would shrink with zoom and become near-unselectable
       when zoomed far out. Multiply by iz (1/zoom) to keep a constant 20 SCREEN
       px of snap range at any zoom. Pairs with the ::after hit area's inverse
       scale in infcanvas-vueflow.css. */
    const connectionRadius = computed(() => 20 * iz.value);

    const onViewportChange = (viewport) => {
      state.viewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
      /* Link centre markers disappear below 60% zoom, like ComfyUI. */
      zoomFar.value = (viewport.zoom || 1) < 0.6;
      NS.flow?.onViewport?.(viewport);
    };

    /* Audio generator gate, shared by the drag-time visual check and the
       authoritative onConnect check. Returns "" when the wire is allowed. */
    const audioWireReason = (targetId, sourceId) => {
      const nodes = state.nodes.value;
      const source = nodes.find((n) => n.id === sourceId);
      const srcKind = assetKindOf(source);
      if (srcKind === "text" && !workflowAcceptsText(nodes.find((n) => n.id === targetId)?.data)) {
        return t("prompt.workflowHasNoPromptInput");
      }
      if (!acceptsKind("audio", srcKind)) {
        return t("prompt.audioNodesOnlyAcceptAudio");
      }
      if (srcKind === "text") return "";
      const wired = state.edges.value.filter((e) => e.target === targetId
        && assetKindOf(nodes.find((n) => n.id === e.source)) === "audio");
      if (wired.some((e) => e.source === sourceId)) return "";
      if (wired.length >= 1) return t("prompt.only1AudioClipAllowed");
      return "";
    };
    /* Image generator gate: it has no video/audio input at all, only images
       and prompts. Checked at BOTH drag time and drop time so a generator
       output can never be wired into an incompatible generator. */
    const imageWireReason = (targetId, sourceId) => {
      const nodes = state.nodes.value;
      const srcKind = assetKindOf(nodes.find((n) => n.id === sourceId));
      if (srcKind === "text" && !workflowAcceptsText(nodes.find((n) => n.id === targetId)?.data)) {
        return t("prompt.workflowHasNoPromptInput");
      }
      if (acceptsKind("image", srcKind)) return "";
      if (srcKind === "video") return t("prompt.textImageNodesCannotAccept");
      if (srcKind === "audio") return t("prompt.textImageRejectAudio");
      return t("prompt.textImageNodesOnlyAccept");
    };
    /* Text generator gate: one cap per source kind, taken from the LLM rule
       row (50 pictures / 100 videos / 100 audio clips). The old two-family
       exclusion is gone — the node hands pictures, video and audio to the
       SAME tokenize() call, so mixing them is legal; wiring a picture into a
       语音转录 node simply makes that mode unavailable and the mode migrates
       to LLM instead of the wire being dropped. A wired text node is the
       PROMPT and is always accepted. */
    const textWireReason = (targetId, sourceId) => {
      const nodes = state.nodes.value;
      const srcKind = assetKindOf(nodes.find((n) => n.id === sourceId));
      if (srcKind === "text") {
        return workflowAcceptsText(nodes.find((n) => n.id === targetId)?.data)
          ? "" : t("prompt.workflowHasNoPromptInput");
      }
      if (!acceptsKind("text", srcKind)) return t("prompt.textNodesOnlyAcceptImages");
      const cap = TEXT_WIRE_CAPS[srcKind];
      if (!cap) return "";
      let have = 0;
      for (const edge of state.edges.value) {
        if (edge.target !== targetId || edge.source === sourceId) continue;
        if (assetKindOf(nodes.find((n) => n.id === edge.source)) === srcKind) have += 1;
      }
      if (have < cap) return "";
      const cn = KIND_CN[srcKind] || { label: "wire.asset", measure: "wire.measureItem" };
      return t("wire.acceptsMost", { mode: t("cat.llmChat"), max: cap, measure: cn.measure, label: cn.label });
    };
    /* One gate for every generator that restricts its input kinds. Video
       generators are not in here: they take all three kinds and let the
       active mode decide (modeReasonFor). */
    const genWireReason = (targetId, sourceId) => {
      const target = state.nodes.value.find((n) => n.id === targetId);
      /* A cleanup pill is a pass-through link: it can feed any generator. */
      if (state.nodes.value.find((n) => n.id === sourceId)?.data?.role === "cleanup") return "";
      if (isAudioGenData(target?.data)) return audioWireReason(targetId, sourceId);
      if (isImageGenData(target?.data)) return imageWireReason(targetId, sourceId);
      if (isTextGenData(target?.data)) return textWireReason(targetId, sourceId);
      return "";
    };
    /* Reject invalid drops at DRAG time so the handle turns invalid instead of
       silently swallowing the wire. onConnect re-checks — this prop is UX
       only (drops, restores and loaded canvases bypass it). */
    const isValidConnection = (conn) => {
      const targetId = conn?.target?.id ?? conn?.target;
      const sourceId = conn?.source?.id ?? conn?.source;
      /* Strict mode enforces output→input but DROPS Loose's self-link guard
         (`P!==o`), so a node could wire its own output back into its own
         input. Forbid same-node links in either drag direction. */
      if (sourceId != null && targetId != null && String(sourceId) === String(targetId)) return false;
      const target = state.nodes.value.find((n) => n.id === targetId);
      /* One text box <=> one text wire. Applies to EVERY node with text boxes
         (image / video / audio / text generators alike); merge & cleanup pills
         are pass-through and exempt. Checked here so the handle turns invalid
         while dragging, and again in onConnect as the authoritative guard. */
      const sourceNode = state.nodes.value.find((n) => n.id === sourceId);
      if (textWireFullReason(target, sourceNode, state.edges.value, state.nodes.value)) return false;
      if (!isAudioGenData(target?.data) && !isImageGenData(target?.data)
        && !isTextGenData(target?.data)) return true;
      return !genWireReason(targetId, sourceId);
    };

    /* ---- wire released over empty canvas (LiteGraph's link-release menu) ----
       Dragging out of a handle and letting go over empty canvas opens a list
       of the node types that can legally take that wire; picking one creates
       the node where the pointer landed and connects the two.

       Three cases must NOT open it:
         1. the drag actually connected (connect fires before connectEnd);
         2. the pointer was released over a handle — the type gate refused it,
            and ComfyUI stays silent there;
         3. the pointer barely moved — that is a click on the handle, which
            Vue Flow turns into its own click-to-connect flow. */
    let connectOrigin = null;
    let connectSettled = false;
    const CLICK_SLOP = 6;
    /* Frozen wire: after connectEnd over empty canvas the connection-line slot
       disappears, so we draw our own copy at the last reported graph coords
       and keep it until the pick menu resolves (node chosen -> clear, cancel
       -> clear). */
    const frozenConn = ref(null);
    let connFrame = null;
    const onConnFrame = (frame) => { connFrame = frame; };
    const clearFrozenConn = () => { frozenConn.value = null; connFrame = null; };

    const onConnectStart = (payload) => {
      connectSettled = false;
      clearFrozenConn();
      const event = payload?.event;
      connectOrigin = payload?.nodeId
        ? {
          nodeId: payload.nodeId, handleId: payload.handleId, handleType: payload.handleType,
          x: event?.clientX ?? 0, y: event?.clientY ?? 0,
        }
        : null;
    };
    /* Candidate node types for this wire, computed from the SAME table the
       connect gate enforces — the menu can never offer an illegal wire.
       The text node sits on BOTH ends of that table: its output feeds every
       generator (text is the universal prompt), and its own input takes any
       node's output. */
    const connectCandidates = (origin) => {
      const from = state.nodes.value.find((n) => n.id === origin.nodeId);
      if (!from) return [];
      const specs = NS.SPECS || [];
      /* NOTE: no "exclude the origin's own type" rule. Same-type wiring is
         legitimate (a video generator feeding another video generator in
         参考生视频, an image generator feeding an image generator for img2img),
         and every entry here creates a NEW node, so it can never wire to
         itself. */
      if (origin.handleType === "source") {
        const kind = assetKindOf(from);
        if (!kind) return [];
        return specs.filter((spec) => (spec.role === "text" || spec.role === "cleanup"
          || spec.role === "text_merge"
          ? true
          : spec.role === "media" && acceptsKind(spec.kind, kind)));
      }
      /* Drag started on an INPUT handle: offer the types that can feed it.
         Text, text-merge, cleanup and the universal generator accept every
         kind, so their menu lists all. */
      if (from.data?.role === "text" || from.data?.role === "text_merge"
        || from.data?.role === "cleanup" || from.data?.kind === "omni") return specs.slice();
      if (from.data?.role !== "media") return [];
      const accepts = GEN_ACCEPTS[from.data.kind] || [];
      return specs.filter((spec) => accepts.indexOf(spec.kind) >= 0);
    };

    /* Create the picked node at the drop point and land the wire on it, using
       the same handle ids a manual drag would produce ("out" -> "in"). */
    const createAndConnect = (spec, origin, point, anchor = null) => {
      const spot = NS.api?.freeSpot?.([point.x, point.y], spec.size, spec.role)
        || [point.x, point.y];
      const created = NS.api?.addNodeByType?.(spec.type, spot, null, null, anchor);
      if (!created) return;
      NS.flow?.selectNodes?.([created.id]);
      if (origin) {
        const fromSource = origin.handleType === "source";
        /* A text node exposes one target handle named "text", every media
           node names its own "in" — land the wire on whichever the created
           node actually renders, or the edge would point at a handle that is
           not there and Vue Flow would silently drop the line. */
        NS.flow?.addEdge?.({
          id: "e_" + Math.random().toString(36).slice(2, 10),
          source: fromSource ? origin.nodeId : created.id,
          sourceHandle: "out",
          target: fromSource ? created.id : origin.nodeId,
          targetHandle: fromSource
            ? (created.data?.role === "text" ? "text" : "in")
            : (origin.handleId || "in"),
          type: "ic",
        });
        /* A brand new generator sits on its pure-prompt mode, which takes no
           media — the wire we just landed would leave it on an unavailable
           mode. Same rule as onConnect: switch instead of dropping it. */
        if (fromSource) {
          const target = created;
          const srcKind = assetKindOf(state.nodes.value.find((n) => n.id === origin.nodeId));
          if (isVideoGenData(target.data)) {
            const counts = incomingKindCounts(target.id, state.edges.value, state.nodes.value);
            if (modeReasonFor(target.data.videoMode || "cat.textToVideo", counts)) {
              NS.flow?.updateNodeData?.(target.id, { videoMode: "cat.refToVideo" });
            }
          } else if (isAudioGenData(target.data) && srcKind === "audio") {
            const audioMode = target.data.audioMode || AUDIO_MODES[0];
            if (!AUDIO_INPUT_RULES[audioMode]?.audio) {
              NS.flow?.updateNodeData?.(target.id, { audioMode: audioRefMode(audioMode) });
            }
          }
        }
      }
      NS.api?.markDirty?.();
    };

    /* ---- live placement: after picking a type from the wire-release menu,
       a REAL node is created immediately (same node as any other, no ghost)
       and follows the pointer; the FIRST left click drops it, Esc or a right
       click removes it. The wire is connected for real from the start, so
       what you see while moving is exactly the finished node. */
    const placing = ref(null); // { nodeId, origin } while a real node follows
    let placeHandlers = null;
    const endPlacement = () => {
      if (placeHandlers) {
        /* WINDOW capture runs before every document-level group/marquee
           handler, so a final click inside a group cannot be swallowed by
           the group's drag hit-test. */
        window.removeEventListener("pointermove", placeHandlers.move, true);
        window.removeEventListener("pointerdown", placeHandlers.down, true);
        window.removeEventListener("keydown", placeHandlers.key, true);
        window.removeEventListener("contextmenu", placeHandlers.ctx, true);
        placeHandlers = null;
      }
      placing.value = null;
      document.getElementById("infcanvas-root")?.classList.remove("is-placing");
    };
    /* A placement's FINAL left-click is its real drop point: membership is
       re-decided there (creation-time membership was only a preview). */
    const setPlacementGroup = (id, point) => {
      const groups = state.groups.value;
      const live = NS.flow?.findNode?.(id) || state.nodes.value.find((node) => node.id === id);
      const target = groupForNewNode(live, point);
      const current = groupOfNode(groups, id);
      if (current && current !== target) {
        current.nodes = current.nodes.filter((nodeId) => nodeId !== id);
      }
      if (target && current !== target) {
        if (!Array.isArray(target.nodes)) target.nodes = [];
        if (!target.nodes.includes(id)) target.nodes.push(id);
      }
    };
    const detachNodeGroups = (id) => {
      for (const group of state.groups.value) {
        if (Array.isArray(group.nodes) && group.nodes.includes(id)) {
          group.nodes = group.nodes.filter((nodeId) => nodeId !== id);
        }
      }
    };
    /* Follow-the-pointer core shared by every manual creation: each entry is
       { id, off } for an already-created node; `off` puts the pointer at the
       centre of that node's title bar (plus a per-node stair-step for a
       multi-file upload). The FINAL left click commits position + membership,
       Esc or a right click removes every node (and its wires). */
    const startFollowing = (entries, point) => {
      endPlacement();
      if (!entries.length) return;
      placing.value = { entries };
      const toGraph = (clientX, clientY) => state.flow?.screenToFlowCoordinate
        ? state.flow.screenToFlowCoordinate({ x: clientX, y: clientY })
        : { x: clientX, y: clientY };
      const placeAt = (g) => {
        for (const e of entries) {
          NS.flow?.setNodePosition?.(e.id, { x: g.x + e.off.x, y: g.y + e.off.y });
        }
      };
      placeAt(point);
      /* Keep a normal arrow cursor for the whole ride (connection dragging
         leaves a crosshair/grabbing cursor behind). */
      document.getElementById("infcanvas-root")?.classList.add("is-placing");
      const move = (event) => {
        if (!placing.value) return;
        placeAt(toGraph(event.clientX, event.clientY));
      };
      /* The cancel shared by Esc and right click: drop the just-created nodes
         AND their wires, restoring the pre-pick state with no trace left. */
      const cancelFollowing = () => {
        const wasPlacing = placing.value;
        endPlacement();
        if (!wasPlacing) return;
        const ids = new Set(entries.map((e) => e.id));
        state.edges.value = state.edges.value.filter((e) => !ids.has(e.source) && !ids.has(e.target));
        for (const e of entries) {
          detachNodeGroups(e.id);
          NS.api?.removeNode?.(e.id);
        }
      };
      const down = (event) => {
        /* Left click commits the drop. Right click (button 2) is handled by
           the contextmenu capture below — stop it reaching Vue Flow's
           right-drag pan, but do NOT preventDefault so the native
           contextmenu still fires and reaches our cancel handler. */
        if (event.button === 2) { event.stopPropagation(); return; }
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        const wasPlacing = placing.value;
        const drop = toGraph(event.clientX, event.clientY);
        placeAt(drop);
        for (const e of entries) setPlacementGroup(e.id, drop);
        endPlacement();
        if (wasPlacing) {
          historySchedule();
          NS.api?.markDirty?.();
        }
      };
      const key = (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        event.preventDefault();
        cancelFollowing();
      };
      /* Right click cancels the ride, same as Esc. Listening on contextmenu
         (window capture) lets us swallow the native/node menu in the same
         breath — window capture fires before the node's own contextmenu
         handler, so the "复制/删除/标签" node menu cannot pop mid-placement. */
      const ctx = (event) => {
        if (!placing.value) return;
        event.stopPropagation();
        event.preventDefault();
        cancelFollowing();
      };
      placeHandlers = { move, down, key, ctx };
      /* Defer binding one tick so the click that picked the menu item (and the
         pointerdown that opened it) can't be mistaken for the placement click. */
      setTimeout(() => {
        if (placeHandlers && placeHandlers.move === move) {
          window.addEventListener("pointermove", move, true);
          window.addEventListener("pointerdown", down, true);
          window.addEventListener("keydown", key, true);
          window.addEventListener("contextmenu", ctx, true);
        }
      }, 0);
    };

    const beginPlacement = (spec, origin, point) => {
      endPlacement();
      /* Create the real node + real wire at the release point immediately. */
      const before = new Set(state.nodes.value.map((n) => n.id));
      createAndConnect(spec, origin, { x: point.x, y: point.y }, point);
      const created = state.nodes.value.find((n) => !before.has(n.id));
      if (!created) { clearFrozenConn(); return; }
      clearFrozenConn();
      const off = NS.flow?.createAnchorOffset?.(created) || { x: 0, y: 0 };
      startFollowing([{ id: created.id, off }], point);
    };
    /* Multi-file upload: the nodes were created asynchronously by core.js and
       handed over here. Lay them out as an aligned grid (60px gutter) and use
       the same follow/commit/cancel flow. The pointer grips 14px below the
       grid's TOP-CENTRE, so the whole batch rides under the cursor. */
    const beginNodePlacement = (ids, point, centerGrip = false) => {
      const nodes = ids
        .map((id) => NS.flow?.findNode?.(id) || state.nodes.value.find((n) => n.id === id))
        .filter(Boolean);
      if (!nodes.length) return;
      const count = nodes.length;
      const cols = count <= 2 ? count : 3;
      const GAP = 60;
      /* One cell size for the whole grid keeps rows/columns aligned even when
         the uploaded media have different default dimensions. */
      let cellW = 0, cellH = 0;
      for (const n of nodes) {
        const sz = Array.isArray(n.data?.size) ? n.data.size : [480, 270];
        cellW = Math.max(cellW, Number(sz[0]) || 480);
        cellH = Math.max(cellH, Number(sz[1]) || 270);
      }
      cellW += GAP;
      cellH += GAP;
      const gridW = cols * cellW - GAP; /* no trailing gutter after last column */
      const entries = nodes.map((n, index) => {
        /* Queue asset -> canvas: the caller asks for the node's whole card
           centre under the pointer instead of the title-bar grip. */
        if (centerGrip) {
          const sz = Array.isArray(n.data?.size) ? n.data.size : [480, 270];
          return {
            id: n.id,
            off: { x: -(Number(sz[0]) || 480) / 2, y: -(Number(sz[1]) || 270) / 2 },
          };
        }
        const col = index % cols;
        const row = Math.floor(index / cols);
        /* Grid top-left sits (-gridW/2, -14) from the pointer; add this
           node's cell offset within the grid. */
        return { id: n.id, off: { x: col * cellW - gridW / 2, y: row * cellH - 14 } };
      });
      startFollowing(entries, point);
    };

    const onConnectEnd = (event) => {
      const origin = connectOrigin;
      const settled = connectSettled;
      connectOrigin = null;
      connectSettled = false;
      if (!origin || settled) return;
      if (!event || !Number.isFinite(event.clientX)) return;
      /* Released on a handle: the gate refused the wire. Stay silent only when
         there is no reason to give; the input rules are fine-grained enough
         now (2nd video, audio mixed with pictures, 2+ pictures in 图像放大)
         that a silent refusal reads as a broken drop. */
      const handleEl = event.target?.closest?.(".vue-flow__handle");
      if (handleEl) {
        if (origin.handleType === "source") {
          const targetId = handleEl.closest(".vue-flow__node")?.getAttribute("data-id");
          let reason = targetId ? genWireReason(targetId, origin.nodeId) : "";
          if (!reason && targetId) {
            reason = textWireFullReason(
              state.nodes.value.find((n) => n.id === targetId),
              state.nodes.value.find((n) => n.id === origin.nodeId),
              state.edges.value, state.nodes.value);
          }
          if (reason) NS.api?.toast?.("warning", t("prompt.cannotConnect"), reason);
        }
        return;
      }
      if (!event.target?.closest?.(".vue-flow")) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < CLICK_SLOP) return;
      if (mode.value !== "select") return;
      const specs = connectCandidates(origin);
      if (!specs.length) return;
      const point = state.flow?.screenToFlowCoordinate
        ? state.flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
        : { x: 0, y: 0 };
      /* Freeze the wire at the last frame the slot drew (graph coords). This
         survives the slot's removal on connectEnd so the user sees the wire
         still attached, exactly where they released it. */
      if (connFrame) frozenConn.value = { ...connFrame };
      NS.ui?.showConnectNodeMenu?.({
        clientX: event.clientX, clientY: event.clientY, world: [point.x, point.y],
        specs,
        onPick: (spec) => beginPlacement(spec, origin, point),
        onDismiss: () => { endPlacement(); clearFrozenConn(); },
      });
    };

    const onConnect = (params) => {
      /* A real connection landed; connectEnd must not also open the menu. */
      connectSettled = true;
      /* Authoritative guard: isValidConnection is UX-only and is bypassed by
         programmatic addEdge / restored canvases. Never let a node feed itself. */
      if (params.source != null && params.target != null
        && String(params.source) === String(params.target)) return;
      /* Wires are ALWAYS accepted. The assets wired in decide which modes
         stay selectable (modeAvailable) — a mode choice never cuts a wire.
         But the SAME source→target pair is de-duplicated: dragging the same
         wire again is a no-op, so it always counts as one connection. */
      const key = String(params.source) + "→" + String(params.target);
      if (state.edges.value.some((e) => edgeKey(e) === key)) return;
      const nodes = state.nodes.value;
      const targetNode = nodes.find((n) => n.id === params.target);
      /* One text box <=> one text wire: a full target refuses the 2nd text
         node even on programmatic addEdge / restored canvases. */
      const textFull = textWireFullReason(targetNode, nodes.find((n) => n.id === params.source), state.edges.value, nodes);
      if (textFull) {
        NS.api?.toast?.("warning", t("prompt.cannotConnect"), textFull);
        return;
      }
      /* Generators with a fixed input vocabulary (image / audio) refuse the
         kinds they have no input for — never silently swallow the wire. */
      const denied = genWireReason(params.target, params.source);
      if (denied) {
        NS.api?.toast?.("warning", t("prompt.cannotConnect"), denied);
        return;
      }
      /* Audio generator: audio only lives in the two reference modes — switch
         there instead of dropping the wire the user just drew. */
      if (isAudioGenData(targetNode?.data)) {
        const srcKind = assetKindOf(nodes.find((n) => n.id === params.source));
        if (srcKind === "audio") {
          const mode = targetNode.data.audioMode || AUDIO_MODES[0];
          if (!AUDIO_INPUT_RULES[mode]?.audio) {
            const next = audioRefMode(mode);
            NS.flow?.updateNodeData?.(params.target, { audioMode: next });
            NS.api?.toast?.("info", t("wire.switched") + next, t("wire.doesNotAcceptAudioWire", { mode }));
          }
        }
      }
      state.edges.value = state.edges.value.concat([{
        id: "e_" + Math.random().toString(36).slice(2, 10),
        source: params.source, sourceHandle: params.sourceHandle || "out",
        target: params.target, targetHandle: params.targetHandle,
        type: "ic",
      }]);
      /* If this new wire makes the generator's ACTIVE mode invalid, fall back
         to a mode that fits instead of dropping the connection. */
      if (isVideoGenData(targetNode?.data)) {
        const mode = targetNode.data.videoMode || "cat.textToVideo";
        const counts = incomingKindCounts(params.target, state.edges.value, nodes);
        if (modeReasonFor(mode, counts)) {
          NS.flow?.updateNodeData?.(params.target, { videoMode: "cat.refToVideo" });
          NS.api?.toast?.("info", t("wire.switchedToMode", { mode: t("cat.refToVideo") }), t("wire.assetDoesNotFitWire", { mode }));
        }
      }
      /* Image generator: a picture just arrived. 图像编辑 is the widest
         picture-consuming mode, so that is where a pure-prompt (or now
         over-filled) mode steps aside to. */
      if (isImageGenData(targetNode?.data)) {
        const mode = targetNode.data.imageMode || IMAGE_MODES[0];
        const counts = incomingKindCounts(params.target, state.edges.value, nodes);
        if (modeReasonFor(mode, counts, IMAGE_INPUT_RULES)) {
          const next = modeReasonFor("cat.imageEdit", counts, IMAGE_INPUT_RULES) ? "cat.textToImage" : "cat.imageEdit";
          if (next !== mode) {
            NS.flow?.updateNodeData?.(params.target, { imageMode: next });
            NS.api?.toast?.("info", t("wire.switched") + next, t("wire.assetDoesNotFitWire", { mode }));
          }
        }
      }
      /* Text generator: the wired medium decides the mode — 1 image -> 图像反推,
         1 video -> 视频反推, 1 audio -> 语音转录, mixed/none -> 智能对话. Runs
         on EVERY wire so a tab change always tracks the current inputs, the
         same way image/audio/video generators behave. A wired text node is a
         prompt, never an asset, so connecting one leaves the counts (and thus
         the mode) untouched. */
      if (isTextGenData(targetNode?.data)) {
        const counts = incomingKindCounts(params.target, state.edges.value, nodes);
        const mode = targetNode.data.textMode || TEXT_MODES[0];
        const next = textAutoMode(counts);
        if (next !== mode && !modeReasonFor(next, counts, TEXT_INPUT_RULES)) {
          NS.flow?.updateNodeData?.(params.target, { textMode: next });
          NS.api?.toast?.("info", t("wire.switched") + next, t("wire.assetDoesNotFitWire", { mode }));
        }
      }
      NS.flow?.markDirty();
    };

    /* Wires decide modes, never the reverse — so cutting a wire must also
       release a mode that no longer fits, otherwise the tab stays selected
       and disabled and the node is stuck in a mode its inputs cannot serve.
       Runs AFTER onConnect (flush:"post") so a freshly added wire has already
       been reconciled by the block above; only misfits are touched. */
    const reconcileModes = () => {
      const nodes = state.nodes.value;
      const edges = state.edges.value;
      for (const node of nodes) {
        const data = node.data;
        if (!data) continue;
        const kind = data.role === "text" ? "text"
          : (data.role === "media" && !data.asset ? data.kind : "");
        if (kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "text") continue;
        const table = kind === "image" ? IMAGE_INPUT_RULES
          : kind === "audio" ? AUDIO_INPUT_RULES
            : kind === "video" ? VIDEO_INPUT_RULES : TEXT_INPUT_RULES;
        const modes = kind === "image" ? IMAGE_MODES
          : kind === "audio" ? AUDIO_MODES
            : kind === "video" ? VIDEO_MODES : TEXT_MODES;
        const field = kind === "image" ? "imageMode"
          : kind === "audio" ? "audioMode"
            : kind === "video" ? "videoMode" : "textMode";
        const current = data[field] || modes[0];
        const counts = incomingKindCounts(node.id, edges, nodes);
        if (!modeReasonFor(current, counts, table)) continue;
        /* Audio stays inside its family (音乐翻唱 -> 文生音乐, 语音克隆 ->
           语音合成) instead of jumping to the first legal tab. Text switches
           to the exact mode implied by the media. Image / video take the
           first mode that fits the current wires (e.g. cutting the last image
           from 图生视频 falls back to the pure-prompt mode). */
        const next = kind === "audio"
          ? (counts.audio ? audioRefMode(current)
            : (isMusicMode(current) ? "cat.textToMusic" : "cat.textToSpeech"))
          : kind === "text" ? textAutoMode(counts)
            : modes.find((mode) => !modeReasonFor(mode, counts, table));
        if (!next || next === current) continue;
        if (modeReasonFor(next, counts, table)) continue;
        /* Write BOTH copies (Vue Flow's store and the document array) without
           markDirty: this is a DERIVED correction, and doing it through
           updateNodeData on a freshly LOADED canvas would flag the document
           dirty and autosave it before the user touched anything. */
        data[field] = next;
        const live = state.flow?.findNode?.(node.id);
        if (live?.data && live.data !== data) live.data[field] = next;
      }
    };
    watch(() => state.edges.value.map((edge) => edge.id + ">" + edge.source).join("|"),
      reconcileModes, { flush: "post" });

    /* Vue Flow's own handleNodeClick runs *before* it emits node-click, so by
       the time we see the event the selection has already been toggled. Take
       a snapshot in the capture phase of pointerdown, which is strictly
       earlier than d3-drag's bubble-phase handlers. */
    let clickBaseline = null;
    const capturePointerDown = (event) => {
      const nodeEl = event.target?.closest?.(".vue-flow__node");
      if (!nodeEl || !event.target.closest?.("#infcanvas-vueflow")) {
        clickBaseline = null;
        return;
      }
      /* Resizing from a corner grip must not perturb the click selection
         baseline — a drag there is not a node click. */
      if (event.target.closest?.(".icn__rz, .nodrag")) {
        clickBaseline = null;
        return;
      }
      clickBaseline = {
        id: nodeEl.getAttribute("data-id"),
        selected: (NS.flow?.selectedNodes?.() || []).map((entry) => entry.id),
      };
    };
    onMounted(() => document.addEventListener("pointerdown", capturePointerDown, true));
    onBeforeUnmount(() => document.removeEventListener("pointerdown", capturePointerDown, true));

    let lastDragStopAt = -Infinity;
    /* Live membership highlight: recompute on every drag tick and paint the
       groups that the dragged nodes fully entered. Uses the same highlight
       class as a selected group; cleared on drag stop. */
    const onNodeDrag = (payload) => {
      /* Dragging nodes is a node-level operation: a group selection left over
         from clicking a group title must not linger, otherwise "group + node"
         reads as a multi-selection and paints the dashed border plus the node
         toolbars. Plain node clicks already clear it (selectNodes); the drag
         path never reached that, so clear it here at the first drag tick.
         Dragging a group's own title strip uses startGroupDrag, not this
         handler, so whole-group moves keep their selection intact. */
      if (state.selectedGroupIds.value.length) state.selectedGroupIds.value = [];
      const ids = draggedIds(payload);
      state.dropTargetGroupIds.value = ids.length
        ? [...planMembership(ids).dropTargets] : [];
    };
    const onNodeDragStop = (payload) => {
      /* d3-drag emits a click after some drags; that click must not collapse
         a multi-selection that was just moved as a group. */
      lastDragStopAt = performance.now();
      syncLivePositions();
      const ids = draggedIds(payload);
      const changed = ids.length ? applyMembership(planMembership(ids), ids) : false;
      state.dropTargetGroupIds.value = [];
      NS.flow?.markDirty();
      /* Vue Flow owns the live position, so the deep watcher never saw this
         move — make it an undo step explicitly. */
      NS.flow?.history?.schedule?.();
      if (changed) NS.api?.markDirty?.();
    };

    /* LiteGraph's resolveClickSelection (selectionIntent.ts) is explicit:
         plain click on a node -> 'replace' (even if it is already selected)
         Shift / Ctrl / Meta + click -> 'add' when unselected, 'remove' when
         selected
       Vue Flow instead keeps the old selection and *adds* the clicked node;
       clicking an already selected node does nothing. Its built-in
       handleNodeClick runs just before this emit, so setting the final
       selection here overrides whatever it did. */
    const onNodeClick = ({ event, node }) => {
      if (!node || state.mode.value === "drag") return;
      const baseline = clickBaseline;
      clickBaseline = null;
      if (performance.now() - lastDragStopAt < 250) return;
      /* Fall back to the live selection only if the pointerdown was missed. */
      const current = baseline && baseline.id === node.id
        ? baseline.selected
        : (NS.flow?.selectedNodes?.().map((entry) => entry.id) || []);
      const toggling = event && (event.shiftKey || event.ctrlKey || event.metaKey);
      let next;
      if (toggling) {
        next = current.includes(node.id)
          ? current.filter((id) => id !== node.id)
          : current.concat(node.id);
      } else {
        next = [node.id];
      }
      if (next.length === current.length && next.every((id, i) => id === current[i])) return;
      /* A modifier click is additive: keep any groups in the shared
         selection. A plain click replaces the nodes and clears groups. */
      NS.flow?.selectNodes?.(next, toggling);
    };
    const onSelectionChange = (payload) => {
      state.selectedIds.value = (payload?.nodes || []).map((node) => node.id);
      /* Groups can stay selected while nodes are selected: Ctrl/Shift clicks,
         marquee selection and Ctrl+A all keep the current group selection.
         A plain node click clears it via onNodeClick, and a pane click clears
         both via onPaneClick. */
      NS.flow?.onSelection?.(payload?.nodes || []);
    };

    /* Native MiniMap draws the viewport rect as a 2px foreground outline PLUS a
       20% foreground fill over the nodes. Vue Flow's minimap mask is an evenodd
       path whose fill covers the OUTSIDE, so mirror its inner subpath into a
       second path to tint the inside. The mask `d` changes on pan/zoom, so keep
       the mirror synced (and re-insert after Vue patches the node rects). */
    let minimapFillObserver = null;
    let minimapFillSvg = null;
    const detachMinimapFill = () => {
      if (minimapFillObserver) minimapFillObserver.disconnect();
      minimapFillObserver = null;
      minimapFillSvg = null;
    };
    const syncMinimapViewportFill = () => {
      const mask = document.querySelector(".ic-minimap .vue-flow__minimap-mask");
      const svg = mask && mask.ownerSVGElement;
      if (!svg) return;
      let fill = svg.querySelector(".ic-minimap__viewport-fill");
      if (!fill) {
        fill = document.createElementNS("http://www.w3.org/2000/svg", "path");
        fill.setAttribute("class", "ic-minimap__viewport-fill");
        fill.setAttribute("pointer-events", "none");
      }
      /* Paint above the node rects but below the mask outline. */
      if (fill.nextSibling !== mask) svg.insertBefore(fill, mask);
      const d = mask.getAttribute("d") || "";
      const second = d.indexOf("M", d.indexOf("M") + 1);
      if (second >= 0) {
        const inner = d.slice(second).trim();
        if (fill.getAttribute("d") !== inner) fill.setAttribute("d", inner);
      }
      /* Toggling the minimap rebuilds the SVG, so re-bind when it changes. */
      if (!minimapFillObserver || minimapFillSvg !== svg) {
        detachMinimapFill();
        minimapFillSvg = svg;
        minimapFillObserver = new MutationObserver(syncMinimapViewportFill);
        minimapFillObserver.observe(svg, { childList: true, subtree: true,
          attributes: true, attributeFilter: ["d"] });
      }
    };
    const attachMinimapFill = () => nextTick(() => requestAnimationFrame(syncMinimapViewportFill));
    watch(() => state.minimap.value, (value) => {
      showMinimap.value = value;
      if (value) attachMinimapFill();
      else detachMinimapFill();
    });
    onMounted(() => { if (showMinimap.value) attachMinimapFill(); });
    onBeforeUnmount(() => { detachMinimapFill(); });
    /* Selection order drives stacking: newly selected nodes/groups move to
       the front of their own kind. Groups stay below all nodes by using
       negative layers only (see groupLayerStyle). */
    watch(state.selectedIds, (ids, previous = []) => {
      const added = ids.filter((id) => !previous.includes(id));
      if (added.length) bringToFront(state.nodes, added);
    });
    watch(state.selectedGroupIds, (ids, previous = []) => {
      const added = ids.filter((id) => !previous.includes(id));
      if (added.length) bringToFront(state.groups, added);
    });

    /* ---- Alt + left drag slices links (ComfyUI-style canvas knife) --------
       Starting the drag ON the pane means we stopPropagation, so Vue Flow
       never begins a pan and the whole gesture belongs to the knife. Every
       wire the pointer crosses is marked red and removed on release — one
       history entry for the whole slice. */
    /* ---- Alt + left drag slices links (ComfyUI-style canvas knife) --------
       Ported from the reference front-end (infinite_canvas/App.vue), which is
       more complete than the earlier flow-space version: a wire is cut by
       DRAGGING ACROSS it, never by clicking a midpoint. Alt+left on empty
       canvas starts a knife stroke; every wire the red trail sweeps is marked
       and removed on release in one history entry.
       KEY DIFFERENCES from the old version (which silently failed to cut):
         * all hit-testing in SCREEN space (old mixed screenToFlowCoordinate
           flow coords with getPointAtLength path-local coords -> never matched)
         * getBBox broad-phase, sample lazily only for boxes the stroke crosses
         * pointerdown AND mousedown captured: Vue Flow pans via d3-zoom's
           mousedown, which pointerdown alone cannot stop
         * getCoalescedEvents + rAF batching, Escape cancels, Alt suppresses
           the context menu (mac). */
    let cutRect = { left: 0, top: 0 };
    let cutFrame = 0;
    let cutPending = [];
    let cutSamples = [];
    let markedGroups = new Set();
    let cutting = false;
    const CUT_THRESHOLD = 6;                        // screen px of slack
    const cutPoints = ref([]);
    const cutTrail = ref("");
    const trailPath = (points) => {
      if (!points.length) return "";
      if (points.length === 1) return `M${points[0].x},${points[0].y} L${points[0].x + 0.01},${points[0].y}`;
      let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
      for (let i = 1; i < points.length - 1; i += 1) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        d += ` Q${points[i].x.toFixed(1)},${points[i].y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
      }
      const last = points[points.length - 1];
      return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
    };
    const onAltState = (event) => {
      if (event.key !== "Alt" && event.key !== "AltGraph") return;
      const down = event.type === "keydown"
        && state.mode.value === "select" && !NS.tools?.isOpen?.();
      cutMode.value = down;
      if (!down && cutting) resetCut();
    };
    /* Nodes / panels / form controls never start a knife stroke. */
    const isCutBlocked = (target) => {
      if (!(target instanceof Element)) return true;
      return !!target.closest(
        ".vue-flow__node, .vue-flow__handle, .ic-panel, .ic-minimap, button, input, textarea, select, [contenteditable]"
      );
    };
    /* Broad phase: one getBBox per wire at pointerdown, converted to screen
       space. Sampling getPointAtLength for every edge on every move was O(n²)
       and stalled with many wires; now only boxes the stroke touches are
       sampled, and the result is cached for the stroke. */
    const buildCutSamples = () => {
      const entries = [];
      const host = hostEl();
      if (!host) return entries;
      const vp = state.viewport.value || {};
      const zoom = vp.zoom || 1, offsetX = vp.x || 0, offsetY = vp.y || 0;
      for (const path of host.querySelectorAll(".vue-flow__edge-path")) {
        const group = path.closest(".vue-flow__edge");
        if (!group || !path.getBBox) continue;
        let box;
        try { box = path.getBBox(); } catch (error) { continue; }
        if (!box.width && !box.height) continue;
        entries.push({
          group, path,
          minX: box.x * zoom + offsetX, minY: box.y * zoom + offsetY,
          maxX: (box.x + box.width) * zoom + offsetX,
          maxY: (box.y + box.height) * zoom + offsetY,
          points: null,
        });
      }
      return entries;
    };
    const sampleEntry = (entry) => {
      if (entry.points) return entry.points;
      const vp = state.viewport.value || {};
      const zoom = vp.zoom || 1, offsetX = vp.x || 0, offsetY = vp.y || 0;
      const step = Math.max(5 / zoom, 2);
      const total = entry.path.getTotalLength ? entry.path.getTotalLength() : 0;
      const points = [];
      for (let length = 0; length < total; length += step) {
        const point = entry.path.getPointAtLength(length);
        points.push({ x: point.x * zoom + offsetX, y: point.y * zoom + offsetY });
      }
      if (total) {
        const point = entry.path.getPointAtLength(total);
        points.push({ x: point.x * zoom + offsetX, y: point.y * zoom + offsetY });
      }
      entry.points = points;
      return points;
    };
    const distanceToSegment = (point, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
      if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
      let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
      t = Math.min(1, Math.max(0, t));
      return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    };
    /* A fresh slice segment vs every unmarked wire: box cull first, sample
       only on overlap, mark red once (stays marked for the whole stroke). */
    const testCutSegment = (a, b) => {
      const minX = Math.min(a.x, b.x) - CUT_THRESHOLD;
      const minY = Math.min(a.y, b.y) - CUT_THRESHOLD;
      const maxX = Math.max(a.x, b.x) + CUT_THRESHOLD;
      const maxY = Math.max(a.y, b.y) + CUT_THRESHOLD;
      for (const entry of cutSamples) {
        if (markedGroups.has(entry.group)) continue;
        if (entry.maxX < minX || entry.minX > maxX ||
            entry.maxY < minY || entry.minY > maxY) continue;
        for (const point of sampleEntry(entry)) {
          if (distanceToSegment(point, a, b) <= CUT_THRESHOLD) {
            entry.group.classList.add("is-cut");
            markedGroups.add(entry.group);
            break;
          }
        }
      }
    };
    const hostEl = () => document.querySelector("#infcanvas-vueflow");
    const onCutPointerDown = (event) => {
      if (event.button !== 0 || !event.altKey) return;
      if (state.mode.value === "drag" || NS.tools?.isOpen?.()) return;
      if (isCutBlocked(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const host = hostEl();
      if (!host) return;
      cutRect = host.getBoundingClientRect();
      cutPoints.value = [{ x: event.clientX - cutRect.left, y: event.clientY - cutRect.top }];
      cutTrail.value = trailPath(cutPoints.value);
      cutting = true;
      cutMode.value = true;
      cutPending = [];
      cutSamples = buildCutSamples();
      markedGroups = new Set();
      document.body.style.cursor = "crosshair";
      window.addEventListener("pointermove", onCutPointerMove, true);
      window.addEventListener("pointerup", onCutPointerUp, true);
      window.addEventListener("pointercancel", resetCut, true);
      window.addEventListener("keydown", onCutKeyDown, true);
      window.addEventListener("blur", resetCut);
    };
    const onCutPointerMove = (event) => {
      if (!cutting) return;
      const batch = event.getCoalescedEvents?.() || [];
      for (const item of (batch.length ? batch : [event])) {
        const x = item.clientX - cutRect.left;
        const y = item.clientY - cutRect.top;
        const last = cutPending[cutPending.length - 1] || cutPoints.value[cutPoints.value.length - 1];
        if (!last) continue;
        if (Math.abs(x - last.x) < 1.5 && Math.abs(y - last.y) < 1.5) continue;
        cutPending.push({ x, y });
      }
      if (!cutPending.length) return;
      if (!cutFrame) cutFrame = requestAnimationFrame(flushCut);
    };
    const flushCut = () => {
      cutFrame = 0;
      if (!cutPending.length) return;
      const pending = cutPending;
      cutPending = [];
      let from = cutPoints.value[cutPoints.value.length - 1];
      cutPoints.value = cutPoints.value.concat(pending);
      cutTrail.value = trailPath(cutPoints.value);
      for (const point of pending) {
        if (from) testCutSegment(from, point);
        from = point;
      }
    };
    function stopCutListeners() {
      window.removeEventListener("pointermove", onCutPointerMove, true);
      window.removeEventListener("pointerup", onCutPointerUp, true);
      window.removeEventListener("pointercancel", resetCut, true);
      window.removeEventListener("keydown", onCutKeyDown, true);
      window.removeEventListener("blur", resetCut);
      if (cutFrame) { cancelAnimationFrame(cutFrame); cutFrame = 0; }
    }
    function resetCut() {
      if (!cutting) return;
      stopCutListeners();
      for (const group of markedGroups) group.classList.remove("is-cut");
      markedGroups = new Set();
      cutSamples = [];
      cutPending = [];
      cutting = false;
      cutMode.value = false;
      cutPoints.value = [];
      cutTrail.value = "";
      document.body.style.cursor = "";
    }
    const onCutPointerUp = (event) => {
      if (cutPending.length) flushCut();
      stopCutListeners();
      if (event.button === 0) {
        const ids = [...markedGroups]
          .map((group) => group.getAttribute("data-id"))
          .filter(Boolean);
        if (ids.length) NS.flow?.removeEdges?.(ids);
      }
      resetCut();
    };
    const onCutKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      resetCut();
    };
    /* Vue Flow's pane pans on d3-zoom's mousedown, which pointerdown cannot
       stop — capture mousedown too so the stroke never drags the canvas. */
    const onCutMouseDown = (event) => {
      if (event.button !== 0 || !event.altKey) return;
      if (isCutBlocked(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    /* macOS turns Ctrl/Alt+left into a context menu; suppress it mid-slice. */
    const onCutContextMenu = (event) => { if (event.altKey) event.preventDefault(); };
    const onAltBlur = () => { cutMode.value = false; };
    onMounted(() => {
      const host = hostEl();
      host?.addEventListener("pointerdown", onCutPointerDown, true);
      host?.addEventListener("mousedown", onCutMouseDown, true);
      host?.addEventListener("contextmenu", onCutContextMenu, true);
      document.addEventListener("keydown", onAltState, true);
      document.addEventListener("keyup", onAltState, true);
      window.addEventListener("blur", onAltBlur);
    });
    onBeforeUnmount(() => {
      resetCut();
      const host = hostEl();
      host?.removeEventListener("pointerdown", onCutPointerDown, true);
      host?.removeEventListener("mousedown", onCutMouseDown, true);
      host?.removeEventListener("contextmenu", onCutContextMenu, true);
      document.removeEventListener("keydown", onAltState, true);
      document.removeEventListener("keyup", onAltState, true);
      window.removeEventListener("blur", onAltBlur);
    });
    /* Undo/redo snapshots are taken by a debounced watcher: any change to the
       node/edge arrays (add, delete, field edit, resize) schedules a commit;
       a drag end has to say so explicitly because Vue Flow keeps the live
       position in its own store. */
    watch([state.nodes, state.edges], () => { NS.flow?.history?.schedule?.(); }, { deep: true });
    /* A bulk selection is for moving/deleting nodes, not for editing one.
       Hide every node's top action row and bottom parameter panel while
       more than one node is selected so they don't cover the neighbours. */
    const multiSelect = computed(() =>
      state.selectedIds.value.length + state.selectedGroupIds.value.length > 1);

    /* ComfyUI's Comfy.SelectionBorder extension draws a dashed round-rect
       around every selected item once there are 2+. Mirror it in screen
       space: padding is 10 world px (so it scales with zoom), while the
       2px stroke / 5px dashes / 8px radius stay pixel-constant like the
       host's 2/scale, 5/scale, 8/scale canvas values. */
    const selectionRect = ref(null);
    /* The single selected group's toolbar anchor, in the SAME screen space as
       selectionRect. Both toolbars now live outside the zoom pane, so their
       position/size must be screen pixels -- graph units would skew on zoom. */
    const groupToolRect = ref(null);
    const singleGroupSelected = computed(() =>
      state.selectedGroupIds.value.length === 1 && state.selectedIds.value.length === 0);
    const activeGroup = computed(() => {
      if (!singleGroupSelected.value) return null;
      const gid = state.selectedGroupIds.value[0];
      return state.groups.value.find((g) => g.id === gid) || null;
    });
    let selectionRaf = 0;
    const measureToolbars = () => {
      const host = document.querySelector("#infcanvas-vueflow");
      if (!host) return;
      const hostBox = host.getBoundingClientRect();
      /* Multi-selection box: 10 world px of padding so it scales with zoom,
         but the stored coordinates are screen px for the layer-outside SVG. */
      if (multiSelect.value) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const selectedEls = [
          ...state.selectedIds.value.map((id) => host.querySelector('.vue-flow__node[data-id="' + id + '"]')),
          ...state.selectedGroupIds.value.map((id) => host.querySelector('.ic-group[data-id="' + id + '"]')),
        ];
        for (const el of selectedEls) {
          if (!el) continue;
          const box = el.getBoundingClientRect();
          minX = Math.min(minX, box.left - hostBox.left);
          minY = Math.min(minY, box.top - hostBox.top);
          maxX = Math.max(maxX, box.right - hostBox.left);
          maxY = Math.max(maxY, box.bottom - hostBox.top);
        }
        if (!Number.isFinite(minX)) selectionRect.value = null;
        else {
          const pad = 10 * (state.viewport.value.zoom || 1);
          const next = {
            x: minX - pad, y: minY - pad,
            w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad,
          };
          const prev = selectionRect.value;
          if (!prev || Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5
            || Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5) {
            selectionRect.value = next;
          }
        }
        groupToolRect.value = null;
        return;
      }
      selectionRect.value = null;
      /* Single group: centre the toolbar on the group's top edge; the CSS
         translate(-50%,-100%) puts its bottom 10px above that edge. */
      if (singleGroupSelected.value) {
        const gid = state.selectedGroupIds.value[0];
        const el = host.querySelector('.ic-group[data-id="' + gid + '"]');
        if (el) {
          const box = el.getBoundingClientRect();
          const next = {
            x: box.left - hostBox.left + box.width / 2,
            y: box.top - hostBox.top - 10,
          };
          const prev = groupToolRect.value;
          if (!prev || Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5) {
            groupToolRect.value = next;
          }
        } else groupToolRect.value = null;
      } else groupToolRect.value = null;
    };
    const selectionTick = () => { measureToolbars(); selectionRaf = requestAnimationFrame(selectionTick); };
    watch([multiSelect, singleGroupSelected], () => {
      cancelAnimationFrame(selectionRaf);
      if (multiSelect.value || singleGroupSelected.value) {
        measureToolbars(); selectionRaf = requestAnimationFrame(selectionTick);
      } else {
        selectionRect.value = null; groupToolRect.value = null;
      }
    });
    onBeforeUnmount(() => { cancelAnimationFrame(selectionRaf); endPlacement(); });

    /* ---- multi-selection toolbox actions ------------------------------ */
    /* Boxes are in graph units. Vue Flow keeps the authoritative position
       and measured size in its live node; fall back to the DOM (or the
       node's declared size) when a freshly added node has not measured yet. */
    const boxesOfIds = (ids) => {
      syncLivePositions();
      const zoom = state.viewport.value.zoom || 1;
      return ids.map((id) => {
        const src = state.nodes.value.find((node) => node.id === id);
        if (!src) return null;
        const live = state.flow?.findNode?.(id);
        let w = live?.dimensions?.width;
        let h = live?.dimensions?.height;
        if (!Number.isFinite(w) || !Number.isFinite(h)) {
          const el = document.querySelector('.vue-flow__node[data-id="' + id + '"]');
          if (el) {
            const rect = el.getBoundingClientRect();
            w = rect.width / zoom;
            h = rect.height / zoom;
          }
        }
        if (!Number.isFinite(w)) w = 480;
        if (!Number.isFinite(h)) h = 270;
        return { id, x: src.position.x, y: src.position.y, w, h };
      }).filter(Boolean);
    };
    const selectedBoxes = () => boxesOfIds(state.selectedIds.value);

    /* Bounds of a set of node boxes: 60px padding around the members (user
       spec) plus a 40px title strip on top (matching --ic-group-title-h).
       createGroup uses this one rule so the outline sits 60px outside every
       node horizontally/bottom; the top also carries the title strip. */
    const groupBounds = (boxes) => {
      const pad = 60, titleHeight = 40;
      const minX = Math.min(...boxes.map((box) => box.x));
      const minY = Math.min(...boxes.map((box) => box.y));
      const maxX = Math.max(...boxes.map((box) => box.x + box.w));
      const maxY = Math.max(...boxes.map((box) => box.y + box.h));
      return {
        x: minX - pad,
        y: minY - pad - titleHeight,
        w: maxX - minX + 2 * pad,
        h: maxY - minY + 2 * pad + titleHeight,
      };
    };

    /* ---- node ↔ group membership --------------------------------------
       A group is a rectangle in graph units. Membership is derived from
       geometry, never stored on the node: "inside" means the node's whole
       box fits inside the group rectangle; "outside" means the two boxes do
       not intersect at all. A partial overlap is a no-op (hysteresis), so a
       node crossing the border does not oscillate while being dragged. */
    const boxInsideGroup = (box, group) =>
      box.x >= group.x && box.y >= group.y &&
      box.x + box.w <= group.x + group.w &&
      box.y + box.h <= group.y + group.h;
    const boxOutsideGroup = (box, group) =>
      box.x + box.w <= group.x || box.x >= group.x + group.w ||
      box.y + box.h <= group.y || box.y >= group.y + group.h;
    const groupArea = (group) => group.w * group.h;
    const groupOfNode = (groups, id) =>
      groups.find((group) => Array.isArray(group.nodes) && group.nodes.includes(id));

    /* Ids actually being dragged: Vue Flow reports them in the payload;
       fall back to the shared selection for synthetic/drag-stop events. */
    const draggedIds = (payload) => {
      const fromPayload = payload?.nodes?.map((node) => node.id).filter(Boolean);
      return fromPayload && fromPayload.length ? fromPayload : state.selectedIds.value.slice();
    };

    /* Plan a drag: for every moved node decide its TARGET group (null means
       "no join target" — it then only leaves a group on a full exit).
       Membership is strictly PER NODE: each node joins only the group its
       own box is fully inside (the smallest such group); a node that did
       not fully enter any group does NOT join one just because a sibling in
       the same multi-select drag did. Also report which groups are newly
       joined, for live drag highlight. */
    const planMembership = (ids) => {
      const boxes = new Map(boxesOfIds(ids).map((box) => [box.id, box]));
      const groups = state.groups.value;
      const targets = new Map();
      const dropTargets = new Set();
      for (const id of ids) {
        const box = boxes.get(id);
        let target = null;
        if (box) {
          const candidates = groups.filter((group) => boxInsideGroup(box, group));
          if (candidates.length) {
            candidates.sort((a, b) => groupArea(a) - groupArea(b));
            target = candidates[0].id;
          }
        }
        const current = groupOfNode(groups, id);
        if (target && (!current || current.id !== target)) dropTargets.add(target);
        targets.set(id, target);
      }
      return { targets, dropTargets, boxes, groups };
    };

    /* Apply the plan: reassign members on the SAME group objects (so the
       deep watcher/history sees the graft). Groups are kept even when they
       end up empty — membership changes never dissolve a group. Group
       rectangles are NEVER auto-fitted — the outline only changes when the
       user explicitly creates, pans, or resizes a group. */
    const applyMembership = (plan, ids) => {
      const { targets, boxes } = plan;
      const groups = state.groups.value;
      const touched = new Set();
      for (const id of ids) {
        const target = targets.get(id);
        const current = groupOfNode(groups, id);
        /* Still in the same group after the move: neither the nodes array
           nor the outline should change. Skip entirely — no re-fit. */
        if (target && current && target === current.id) continue;
        if (target) {
          for (const group of groups) {
            if (Array.isArray(group.nodes) && group.nodes.includes(id)) {
              group.nodes = group.nodes.filter((nodeId) => nodeId !== id);
              touched.add(group.id);
            }
          }
          const dest = groups.find((group) => group.id === target);
          if (dest) {
            if (!Array.isArray(dest.nodes)) dest.nodes = [];
            if (!dest.nodes.includes(id)) dest.nodes.push(id);
            touched.add(dest.id);
          }
        } else if (current && boxes.has(id) && boxOutsideGroup(boxes.get(id), current)) {
          current.nodes = current.nodes.filter((nodeId) => nodeId !== id);
          touched.add(current.id);
        }
      }
      if (!touched.size) return false;
      /* Empty groups are kept on purpose — no auto-dissolve and no re-fit.
         A group only goes away when the user explicitly deletes it. */
      return true;
    };

    /* ComfyUI's Add Group For Selected Nodes: createBounds(selected, 10),
       then lift the top by the title-strip height (40) to fit its header.
       The group itself is visual only — it never rewires or reflows nodes.
       Members already in another group are pulled into the new one; old
       groups keep their rectangle and are kept even when emptied — no
       auto-dissolve, no auto re-fit. */
    const createGroup = () => {
      /* Hold the per-node toolbar + parameter panel hidden across the whole
         opacity fade-out this selection clear triggers. Dropping is-multi-
         select while .icn.is-selected is still on the old cards flashes the
         row fully opaque, then it fades for ~120ms -- a visible flicker. Keep
         the hold longer than that fade so the first painted frame is hidden.
         Must be a reactive ref bound in the template: Vue rewrites .ic-flow's
         class on the grouping re-render and would erase a hand-added class. */
      groupingFrozen.value = true;
      clearTimeout(createGroup._holdTimer);
      createGroup._holdTimer = setTimeout(() => { groupingFrozen.value = false; }, 250);
      /* Participants = selected nodes + every member of a selected group. */
      const participantIds = new Set(state.selectedIds.value);
      for (const gid of state.selectedGroupIds.value) {
        const group = state.groups.value.find((entry) => entry.id === gid);
        if (group && Array.isArray(group.nodes)) group.nodes.forEach((id) => participantIds.add(id));
      }
      const boxes = boxesOfIds([...participantIds]);
      if (boxes.length < 2) return;
      const ids = boxes.map((box) => box.id);
      const taken = new Set(ids);
      const survivors = state.groups.value.map((group) => ({
        ...group,
        nodes: (group.nodes || []).filter((id) => !taken.has(id)),
      }));
      survivors.push({
        id: "grp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: "core.groupGeneric",   /* internal key, rendered via t() like node titles */
        ...groupBounds(boxes),
        nodes: ids,
      });
      state.groups.value = survivors;
      state.selectedGroupIds.value = [];
      /* Must call selectNodes([]) to clear Vue Flow's own selected flag: clearing only
         state.selectedIds removes is-multi-select but leaves .icn.is-selected attached,
         so every node pops its toolbar and parameter box after grouping. */
      NS.flow?.selectNodes?.([]);
      NS.api?.markDirty?.();
      NS.flow?.history?.schedule?.();
      NS.api?.toast?.("success", t("core.groupCreated"),
        t("core.addedSelectedNodesGroup", { count: ids.length }));
    };

    /* ComfyUI's processSelect(group): clicking the title strip selects the
       group rectangle itself. Children stay unselected by default —
       LiteGraph.Group.SelectChildrenOnClick defaults to false. */
    const selectGroup = (id, additive = false) => {
      if (state.groupEditing.value) commitGroupRename();
      const current = state.selectedGroupIds.value.slice();
      /* Shift/Ctrl/Cmd + click toggles a group in the shared selection,
         leaving any selected nodes alone — the same "add" intent ComfyUI's
         resolveClickSelection uses for nodes. */
      if (additive) {
        if (current.includes(id)) state.selectedGroupIds.value = current.filter((entry) => entry !== id);
        else {
          state.selectedGroupIds.value = current.concat(id);
          bringToFront(state.groups, [id]);
        }
        return;
      }
      /* A plain group click joins an existing node multi-selection instead
         of collapsing it; with no/one node selected it stays a group-only
         selection (ComfyUI picks a single item on a plain click). */
      if (state.selectedIds.value.length > 1) {
        if (!current.includes(id)) state.selectedGroupIds.value = current.concat(id);
        bringToFront(state.groups, [id]);
        return;
      }
      state.selectedGroupIds.value = [id];
      bringToFront(state.groups, [id]);
      const api = state.flow;
      const currentNodes = api?.getSelectedNodes?.value || [];
      if (currentNodes.length) api?.removeSelectedNodes?.(currentNodes);
      state.selectedIds.value = [];
    };
    /* Drag the title strip: LGraphGroup.move(dx, dy) shifts the group
       AND every child node by the same amount. Screen pixels are converted
       with the live zoom, exactly like node dragging. */
    const GROUP_CORNERS = ["nw", "ne", "sw", "se"];
    const startGroupDrag = (event, group) => {
      /* Hand (read-only) mode: ComfyUI's _processPrimaryButton returns before
         pressGroup when read_only, so a press on the title strip only pans
         the canvas. Bail here without claiming the event. */
      if (state.mode.value === "drag") return;
      if (event.button !== 0 || state.groupEditing.value || !NS.api?.isActive?.()) return;
      event.stopPropagation();
      selectGroup(group.id, event.shiftKey || event.ctrlKey || event.metaKey);
      const zoom = state.viewport.value.zoom || 1;
      const startX = event.clientX, startY = event.clientY;
      const x0 = group.x, y0 = group.y;
      const members = (Array.isArray(group.nodes) ? group.nodes : []).map((id) => {
        const node = state.nodes.value.find((entry) => entry.id === id);
        return node ? { id, x: node.position.x, y: node.position.y } : null;
      }).filter(Boolean);
      let moved = false;
      groupDraggingId.value = group.id;
      /* Same 10px grid as node dragging. Snap the GROUP first, then move
         every child by the group's ACTUAL (snapped) delta — not the raw dx.
         Rounding only the group while children kept the fractional dx made
         them drift apart at non-integer zoom. */
      const snap10 = (v) => Math.round(v / 10) * 10;
      const move = (ev) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / zoom) return;
        moved = true;
        let nx = x0 + dx, ny = y0 + dy;
        if (state.snap.value) { nx = snap10(nx); ny = snap10(ny); }
        else { nx = Math.round(nx); ny = Math.round(ny); }
        const actualDx = nx - x0, actualDy = ny - y0;
        group.x = nx;
        group.y = ny;
        for (const member of members) {
          NS.flow?.setNodePosition?.(member.id, { x: member.x + actualDx, y: member.y + actualDy });
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        groupDraggingId.value = null;
        if (moved) { NS.api?.markDirty?.(); NS.flow?.history?.schedule?.(); }
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    /* Four grips like node resize: the opposite edges stay pinned, and the
       child nodes are left alone (LGraphGroup.resize only changes its box). */
    const startGroupResize = (event, group, corner) => {
      /* Same read-only rule as group drag: no group editing by hand. */
      if (state.mode.value === "drag") return;
      if (event.button !== 0 || !NS.api?.isActive?.()) return;
      event.preventDefault();
      event.stopPropagation();
      selectGroup(group.id, event.shiftKey || event.ctrlKey || event.metaKey);
      const zoom = state.viewport.value.zoom || 1;
      const startX = event.clientX, startY = event.clientY;
      const x0 = group.x, y0 = group.y, w0 = group.w, h0 = group.h;
      const west = corner.indexOf("w") >= 0, north = corner.indexOf("n") >= 0;
      const MINW = 80, MINH = 60;
      const move = (ev) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let x = x0 + (west ? dx : 0), y = y0 + (north ? dy : 0);
        let w = w0 + (west ? -dx : dx), h = h0 + (north ? -dy : dy);
        if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
        if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
        /* Same moving-edge snap as node resize, opposite edge pinned. */
        if (state.snap.value) {
          const snap10 = (v) => Math.round(v / 10) * 10;
          if (west) { x = snap10(x); w = (x0 + w0) - x; }
          else { w = snap10(x0 + w) - x0; }
          if (north) { y = snap10(y); h = (y0 + h0) - y; }
          else { h = snap10(y0 + h) - y0; }
          if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
          if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
        }
        group.x = Math.round(x); group.y = Math.round(y);
        group.w = Math.round(w); group.h = Math.round(h);
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        NS.api?.markDirty?.();
        NS.flow?.history?.schedule?.();
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    /* Groups render behind Vue Flow and are pointer-transparent except for
       the title, so a press on the empty pane inside a rectangle has to be
       hit-tested here (graph units) and claimed before the pane handler. */
    const groupAtScreen = (clientX, clientY) => {
      const point = NS.flow?.screenToFlow?.(clientX, clientY);
      if (!point) return null;
      const list = state.groups.value;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const group = list[i];
        if (point.x >= group.x && point.x <= group.x + group.w &&
            point.y >= group.y && point.y <= group.y + group.h) return group;
      }
      return null;
    };
    let suppressPaneClick = false;
    const onGroupPointerDown = (event) => {
      suppressPaneClick = false;
      /* The group palette shares [data-node-tag] with the node palette: a
         press outside it (canvas, a node, another group) closes it. */
      if (groupTagOpen.value && !(event.target instanceof Element && event.target.closest("[data-node-tag]"))) {
        groupTagOpen.value = false;
      }
      if (!NS.api?.isActive?.()) return;
      /* Hand mode: let the pane claim the press for panning, never a group. */
      if (state.mode.value === "drag") return;
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      /* This hit-test is purely by SCREEN coordinate, so a press on any
         chrome overlaying the canvas (the side-panel resize handle, the
         panel/sidebar themselves, the tab bar) would also land inside a
         group rectangle and get wrongly claimed via stopImmediatePropagation
         -- e.g. dragging the panel splitter failed whenever its edge sat
         over a group. Groups only ever live in the stage, so ignore press
         targets outside it. */
      if (!target.closest("#infcanvas-stage")) return;
      if (target.closest(".vue-flow__node, .ic-group, .ic-group-ui, .ic-group-tools, .ic-selection-tools, .ic-menu, input, textarea, [contenteditable]")) return;
      const group = groupAtScreen(event.clientX, event.clientY);
      if (!group) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressPaneClick = true;   /* the matching click is still a group hit */
      /* A group used to move only from its 30px title strip. A press anywhere
         else inside the rectangle (i.e. not on a node) now starts the same
         group+children drag; startGroupDrag also selects the group. */
      startGroupDrag(event, group);
    };
    /* Right-click on blank canvas: reuse the exact native `.ic-menu` surface
       every other canvas menu uses, with Add node / Add group / Paste. This
       also suppresses the browser's own context menu, which used to appear
       wherever no node or group claimed the event. */
    const openCanvasContextMenu = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const world = NS.flow?.screenToFlow?.(event.clientX, event.clientY) || null;
      const at = world && Number.isFinite(world.x) && Number.isFinite(world.y)
        ? { x: world.x, y: world.y }
        : null;
      /* Keep the dropdown on screen when right-clicking near an edge. */
      const anchor = { getBoundingClientRect: () => ({
        left: Math.min(event.clientX, window.innerWidth - 216),
        bottom: Math.min(event.clientY, window.innerHeight - 184),
      }) };

      const addGroup = () => {
        const picked = new Set((NS.flow?.selectedNodes?.() || []).map((node) => node.id));
        for (const gid of NS.flow?.state?.selectedGroupIds?.value || []) {
          const group = NS.flow?.state?.groups?.value?.find((item) => item.id === gid);
          if (group && Array.isArray(group.nodes)) group.nodes.forEach((id) => picked.add(id));
        }
        if (picked.size >= 2) { state.groupActions?.createGroup?.(); return; }
        /* No usable selection: drop an empty group at the pointer, matching
           LiteGraph's Add Group command. */
        const point = at || NS.api?.pastePoint?.() || { x: 0, y: 0 };
        state.groups.value = state.groups.value.concat({
          id: "grp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: "core.groupGeneric", x: point.x, y: point.y, w: 360, h: 220, nodes: [],
        });
        NS.api?.markDirty?.();
        NS.api?.toast?.("success", t("core.groupCreated"));
      };

      const paste = () => {
        const point = at || NS.api?.pastePoint?.() || { x: 0, y: 0 };
        const apply = (raw) => {
          let payload = null;
          if (raw) { try { payload = JSON.parse(raw); } catch (error) { payload = null; } }
          if (!payload && NS.clipboard) payload = NS.clipboard;
          if (payload?.app === "InfCanvas.Clipboard" && Array.isArray(payload.nodes)) {
            NS.flow?.pasteGraph?.(payload, point);
            return true;
          }
          return false;
        };
        const fail = () => NS.api?.toast?.("info", t("core.noCanvasContentClipboard"));
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText()
            .then((text) => { if (!apply(text)) fail(); })
            .catch(() => { if (!apply("")) fail(); });
        } else if (!apply("")) fail();
      };

      NS.tools?.openMenu?.(anchor, [
        { label: t("shortcuts.addNode"), icon: "pi pi-plus", onPick: () => NS.ui?.showAddNodeMenu?.({
          clientX: event.clientX, clientY: event.clientY,
          world: at ? [at.x, at.y] : [0, 0],
        }) },
        { label: t("core.addGroup"), icon: "pi pi-folder", onPick: addGroup },
        { separator: true },
        { label: t("core.paste"), icon: "pi pi-clipboard", onPick: paste },
      ]);
    };
    /* Right-click anywhere in the group rectangle, not just the title.
       The body is pointer-transparent, so it cannot carry its own handler;
       hit-test it exactly like the left-drag above. Titles/chips/tools and
       nodes already own their contextmenu and are excluded here. */
    const onGroupContextMenu = (event) => {
      if (!NS.api?.isActive?.()) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("#infcanvas-stage")) return;
      if (target.closest(".vue-flow__node, .ic-group-title, .ic-group-tools, .ic-group__rz, "
        + ".ic-selection-tools, .ic-menu, [data-node-tag], input, textarea, [contenteditable]")) return;
      const group = groupAtScreen(event.clientX, event.clientY);
      if (!group) { openCanvasContextMenu(event); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      openGroupMenu(event, group);
    };
    /* Ctrl/Cmd + drag marquee: Vue Flow only selects nodes (groups are DOM
       overlays in the zoom pane), so add every group rectangle the marquee
       overlaps to the shared selection on release. */
    let marqueeStart = null;
    let marqueePickedAt = -Infinity;
    /* Direction -> mode. Vue Flow re-reads selectionMode on every pointermove,
       but that value travels through a Vue prop (async nextTick). Write the
       store ref directly too so the CURRENT stroke already uses the new mode. */
    const setMarqueeMode = (partial) => {
      const mode = partial ? "partial" : "full";
      selectionMode.value = mode;
      try { if (state.flow?.selectionMode) state.flow.selectionMode.value = mode; }
      catch (error) { /* store ref may be read-only in some builds; prop is enough */ }
      /* Drive the box skin imperatively too: the reactive :class binding on
         <VueFlow> does not always flush before Vue Flow paints the rect on
         the same pointermove. Toggling the host class here guarantees the
         current stroke shows green-dashed (crossing) or blue-solid (window). */
      try {
        document.querySelectorAll(".ic-flow").forEach((host) =>
          host.classList.toggle("marquee-crossing", partial));
      } catch (error) { /* non-critical visual only */ }
    };
    const onMarqueePointerDown = (event) => {
      marqueeStart = null;
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("#infcanvas-stage")) return;
      if (target.closest(".vue-flow__node, .ic-group-ui, .ic-group-tools, .ic-selection-tools, .ic-menu, input, textarea, [contenteditable]")) return;
      marqueeStart = { x: event.clientX, y: event.clientY };
      /* Every new stroke starts blue/solid; pointermove switches to green
         dashed once a leftward drag is detected. */
      setMarqueeMode(false);
    };
    /* Capture phase runs before Vue Flow's pane pointermove handler, so the
       mode is already switched when Vue Flow recomputes the selection.
       Drag right (dx>0) -> window mode (full containment); drag left -> crossing. */
    const onMarqueePointerMove = (event) => {
      if (!marqueeStart) return;
      const dx = event.clientX - marqueeStart.x;
      if (dx > 2) setMarqueeMode(false);
      else if (dx < -2) setMarqueeMode(true);
    };
    const onMarqueePointerUp = (event) => {
      const start = marqueeStart;
      marqueeStart = null;
      if (!start) return;
      if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 4) return;
      const a = NS.flow?.screenToFlow?.(start.x, start.y);
      const b = NS.flow?.screenToFlow?.(event.clientX, event.clientY);
      if (!a || !b) return;
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
      const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
      /* Rightward drag = window mode: a group counts only when fully inside.
         Leftward drag = crossing mode: any overlap counts. */
      const windowMode = event.clientX >= start.x;
      const picked = state.groups.value.filter((group) => {
        const inside = group.x >= left && group.x + group.w <= right &&
          group.y >= top && group.y + group.h <= bottom;
        const overlap = group.x <= right && group.x + group.w >= left &&
          group.y <= bottom && group.y + group.h >= top;
        return windowMode ? inside : overlap;
      }).map((group) => group.id);
      if (picked.length) {
        /* A Ctrl+drag that started and ended on the pane still emits Vue
           Flow's pane-click, which would immediately clear the groups the
           marquee just picked. Ignore that one follow-up click. */
        marqueePickedAt = performance.now();
        state.selectedGroupIds.value = Array.from(
          new Set(state.selectedGroupIds.value.concat(picked)));
      }
    };
    /* A real pane click (outside every group) deselects groups as well. */
    const onPaneClick = () => {
      if (suppressPaneClick) { suppressPaneClick = false; return; }
      if (performance.now() - marqueePickedAt < 150) return;
      state.selectedGroupIds.value = [];
    };
    onMounted(() => {
      document.addEventListener("contextmenu", onGroupContextMenu, true);
      document.addEventListener("pointerdown", onGroupPointerDown, true);
      document.addEventListener("pointerdown", onMarqueePointerDown, true);
      document.addEventListener("pointermove", onMarqueePointerMove, true);
      document.addEventListener("pointerup", onMarqueePointerUp, true);
    });
    onBeforeUnmount(() => {
      document.removeEventListener("contextmenu", onGroupContextMenu, true);
      document.removeEventListener("pointerdown", onGroupPointerDown, true);
      document.removeEventListener("pointerdown", onMarqueePointerDown, true);
      document.removeEventListener("pointermove", onMarqueePointerMove, true);
      document.removeEventListener("pointerup", onMarqueePointerUp, true);
    });

    /* Group title editing mirrors ComfyUI's TitleEditor.vue: double-click
     the title strip to edit in place, Enter or blur commits a trimmed
     non-empty value, Escape cancels. The default title is stored as the
     Chinese key "core.groupGeneric" (same convention as node titles) and translated on
     display; an explicitly renamed title stays user data, untouched by
     the translator. */
    const groupDisplayTitle = (title) =>
      (title === "core.groupGeneric" || title === "Group") ? t("core.groupGeneric") : title;
    const canonicalGroupTitle = (title) =>
      (title === "Group" || title === "core.groupGeneric") ? "core.groupGeneric" : title;
    const startGroupRename = (group) => {
      state.groupEditing.value = { id: group.id, value: groupDisplayTitle(group.title) };
      nextTick(() => {
        const input = document.querySelector(".ic-group-title-input");
        if (!input) return;
        input.focus();
        input.select();
      });
    };
    const commitGroupRename = () => {
      const edit = state.groupEditing.value;
      if (!edit) return;
      const value = String(edit.value || "").trim();
      if (value) {
        const title = canonicalGroupTitle(value);
        const target = state.groups.value.find((group) => group.id === edit.id);
        if (target && target.title !== title) {
          target.title = title;
          NS.api?.markDirty?.();
          NS.flow?.history?.schedule?.();
        }
      }
      state.groupEditing.value = null;
    };
    const cancelGroupRename = () => { state.groupEditing.value = null; };

    /* ComfyUI's group "Remove" deletes the group rectangle only — the
     nodes it contained stay exactly where they are. */
    const deleteGroups = (ids) => {
      const gone = new Set(Array.isArray(ids) ? ids : [ids]);
      const before = state.groups.value.length;
      state.groups.value = state.groups.value.filter((group) => !gone.has(group.id));
      if (state.groups.value.length === before) return;
      state.groupEditing.value = null;
      state.selectedGroupIds.value = state.selectedGroupIds.value.filter((id) => !gone.has(id));
      NS.api?.markDirty?.();
      NS.flow?.history?.schedule?.();
      NS.api?.toast?.("success", gone.size > 1
        ? t("core.deletedGroups", { count: gone.size }) : t("core.groupDeleted"));
    };
    const deleteGroup = (id) => deleteGroups([id]);

    /* Right-click the group title strip: Copy / Delete / Add tag. The tag is
       stored on the group object itself and rendered with the very same
       chip markup as a node tag, only scaled up for the taller title band;
       renaming stays on double-click. */
    const groupTagColor = (group) => TAG_BY_NAME[group?.tag]?.color || "";
    const groupTagInfo = (group) => TAG_BY_NAME[group?.tag] || null;
    /* The group uses the SAME TagMenu component as a node header — no
       second palette implementation. Only the open flag and the write-back
       live here; the component owns the markup and the seven colour rows. */
    const groupTagOpen = ref(false);
    const groupTagTarget = ref(null);
    /* Reactive so Vue's class patch cannot strip the drag feedback when
       group.x/y change and the template re-renders mid-drag. */
    const groupDraggingId = ref(null);
    const openGroupTagMenu = (group) => {
      groupTagTarget.value = group;
      groupTagOpen.value = true;
    };
    const toggleGroupTag = (group) => {
      if (groupTagOpen.value && groupTagTarget.value === group) groupTagOpen.value = false;
      else openGroupTagMenu(group);
    };
    const pickGroupTag = (name) => {
      const group = groupTagTarget.value;
      groupTagOpen.value = false;
      if (!group) return;
      const next = name || null;
      if (next !== group.tag) {
        group.tag = next;
        NS.api?.markDirty?.();
        NS.flow?.history?.schedule?.();
      }
    };
    const openGroupMenu = (event, group) => {
      if (!state.selectedGroupIds.value.includes(group.id)) {
        state.selectedGroupIds.value = [group.id];
        NS.flow?.selectNodes?.([]);
      }
      bringToFront(state.groups, [group.id]);
      const anchor = { getBoundingClientRect: () => ({ left: event.clientX, bottom: event.clientY }) };
      NS.tools?.openMenu?.(anchor, [
        { label: t("panel.copyCanvas"), icon: "pi pi-copy", onPick: () => NS.api?.copySelection?.() },
        { label: t("panel.delete"), icon: "pi pi-trash", onPick: () => deleteGroup(group.id) },
        { label: t("core.addTag"), icon: "pi pi-tag", onPick: () => openGroupTagMenu(group) },
      ]);
    };
    /* Let core.js's single keydown handler reuse this setup-scoped action. */
    /* Bridge for core.js (and live checks): reuse these setup-scoped actions
       from outside without duplicating the membership logic. */
    state.groupActions = {
      createGroup, deleteGroup, deleteGroups, selectGroup,
      onNodeDrag, onNodeDragStop,
      /* Set a node's live graph position the same way a drag would, so the
         membership checks read the up-to-date coordinates. */
      placeNode(id, x, y) {
        const live = state.flow?.findNode?.(id);
        const src = state.nodes.value.find((node) => node.id === id);
        if (live) live.position = { x, y };
        if (src) src.position = { x, y };
      },
    };
    /* Let menu-driven creation reuse the same live placement used by the
       wire-release flow: node follows the pointer, left click commits. */
    state.placementActions = { beginPlacement, beginNodePlacement };
    onBeforeUnmount(() => { state.groupActions = null; state.placementActions = null; });

    /* Groups are re-fit ONLY when their member set changes (add/remove or
       group creation). Plain moves — dragging nodes, arranging, panning a
       group — never change membership, so the rectangle stays put. */

    /* Same three layouts as ComfyUI's useArrangeNodes.ts; users asked for a
       60px node gap (up from the native 12px default). Our cards already
       include their header in the measured size, so titleHeight is zero. */
    const arrangeNodes = (layout, ids) => {
      const boxes = boxesOfIds(ids);
      if (boxes.length < 2) return;
      const gap = 60;
      const anchor = boxes.reduce((best, box) =>
        box.x + box.y < best.x + best.y ? box : best, boxes[0]);
      let updates;
      if (layout === "vertical") {
        const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
        let cursor = anchor.y;
        updates = sorted.map((box) => {
          const update = { id: box.id, x: anchor.x, y: cursor };
          cursor += box.h + gap;
          return update;
        });
      } else if (layout === "horizontal") {
        const sorted = [...boxes].sort((a, b) => a.x - b.x || a.y - b.y);
        let cursor = anchor.x;
        updates = sorted.map((box) => {
          const update = { id: box.id, x: cursor, y: anchor.y };
          cursor += box.w + gap;
          return update;
        });
      } else {
        const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
        const cols = Math.ceil(Math.sqrt(sorted.length));
        const rows = Math.ceil(sorted.length / cols);
        const widths = Array(cols).fill(0), heights = Array(rows).fill(0);
        sorted.forEach((box, index) => {
          const col = index % cols, row = Math.floor(index / cols);
          widths[col] = Math.max(widths[col], box.w);
          heights[row] = Math.max(heights[row], box.h);
        });
        const colX = [anchor.x], rowY = [anchor.y];
        for (let i = 1; i < cols; i += 1) colX.push(colX[i - 1] + widths[i - 1] + gap);
        for (let i = 1; i < rows; i += 1) rowY.push(rowY[i - 1] + heights[i - 1] + gap);
        updates = sorted.map((box, index) => ({
          id: box.id, x: colX[index % cols], y: rowY[Math.floor(index / cols)],
        }));
      }
      for (const update of updates) NS.flow?.setNodePosition?.(update.id, { x: update.x, y: update.y });
      /* Arrange only repositions members — it never changes the member set,
         so group rectangles stay put (no re-fit). */
      NS.flow?.history?.schedule?.();
      const label = layout === "vertical" ? t("core.arrangeVertically")
        : layout === "horizontal" ? t("core.arrangeHorizontally") : t("core.arrangeGrid");
      NS.api?.toast?.("success", t("core.arrangementDone"),
        t("core.arrangedNodes", { layout: label, count: boxes.length }));
    };
    /* The multi-select toolbox arranges the current selection; the group
       toolbar passes the group's own member ids instead. */
    const arrangeSelected = (layout) => arrangeNodes(layout, state.selectedIds.value);

    const openArrangeMenu = (event) => {
      NS.tools?.openMenu?.(event.currentTarget, [
        { label: t("core.arrangeVertically"), icon: "pi pi-bars", onPick: () => arrangeSelected("vertical") },
        { label: t("core.arrangeHorizontally"), icon: "pi pi-ellipsis-h", onPick: () => arrangeSelected("horizontal") },
        { label: t("core.arrangeGrid"), icon: "pi pi-th-large", onPick: () => arrangeSelected("grid") },
      ]);
    };
    const openGroupArrangeMenu = (event, group) => {
      const ids = Array.isArray(group.nodes) ? group.nodes.slice() : [];
      NS.tools?.openMenu?.(event.currentTarget, [
        { label: t("core.arrangeVertically"), icon: "pi pi-bars", onPick: () => arrangeNodes("vertical", ids) },
        { label: t("core.arrangeHorizontally"), icon: "pi pi-ellipsis-h", onPick: () => arrangeNodes("horizontal", ids) },
        { label: t("core.arrangeGrid"), icon: "pi pi-th-large", onPick: () => arrangeNodes("grid", ids) },
      ]);
    };

    const favoriteNodes = async (nodeIds) => {
      const ids = new Set(nodeIds);
      const nodes = state.nodes.value.filter((node) => ids.has(node.id));
      let count = 0;
      for (const node of nodes) {
        const asset = node.data?.result || node.data?.asset;
        const kind = asset?.kind || node.data?.kind || "text";
        const url = asset?.url || (asset && NS.api?.viewUrl?.(asset));
        try {
          // Only text nodes carry their payload in data.text; media nodes
          // have an empty data.text that must not shadow their fetchable file.
          const text = node.data?.text ?? node.data?.asset?.text ?? node.data?.result?.text;
          await NS.api.addToFavorites(asset || {}, {
            url, kind,
            name: asset?.name || asset?.filename || node.data?.title || "asset",
            text: kind === "text" && text != null ? String(text) : undefined,
          });
          count += 1;
        } catch (error) {
          console.warn("[InfCanvas] batch favorite failed", error);
        }
      }
      NS.api?.toast?.(count ? "success" : "info",
        count ? t("media.addedAssetsFavorites", { count }) : t("media.nothingAdd"));
    };
    const batchFavorite = () => favoriteNodes(state.selectedIds.value);
    const favoriteGroup = (group) => favoriteNodes(
      Array.isArray(group.nodes) ? group.nodes : []);

    /* "整组执行": run the group's generator nodes in WIRE order, so a node
       whose input comes from a sibling is queued only AFTER that sibling has
       finished and attached its result. Kahn topological sort over the
       edges whose two ends are both group members; ties keep wire/array
       order. Nodes already carrying an asset/result are materials, not
       generators, and are skipped. Cycles fall back to array order. */
    const runGroup = async (group) => {
      const memberIds = Array.isArray(group.nodes) ? group.nodes.slice() : [];
      const members = new Set(memberIds);
      const runnable = memberIds.filter((id) => {
        const node = state.nodes.value.find((entry) => entry.id === id);
        const role = node?.data?.role;
        /* Muted / ignored nodes never join a group run. */
        if (node?.data?.muted || node?.data?.ignored) return false;
        /* Generators: media nodes with no asset yet, or empty text nodes. */
        return !!node && ((role === "media" && !node.data?.asset)
          || (role === "text" && !node.data?.asset && !node.data?.result));
      });
      if (!runnable.length) {
        NS.api?.toast?.("info", t("core.runGroup"), t("core.noRunnableGeneratorNodesGroup"));
        return;
      }
      const indeg = new Map(runnable.map((id) => [id, 0]));
      const adj = new Map(runnable.map((id) => [id, []]));
      for (const edge of state.edges.value || []) {
        if (!members.has(edge.source) || !adj.has(edge.target)) continue;
        /* Only order by edges between two RUNNABLE members; an edge from a
           material sibling is an input, not a dependency on another run. */
        if (!adj.has(edge.source)) continue;
        adj.get(edge.source).push(edge.target);
        indeg.set(edge.target, (indeg.get(edge.target) || 0) + 1);
      }
      const queue = runnable.filter((id) => indeg.get(id) === 0);
      const order = [];
      while (queue.length) {
        const id = queue.shift();
        order.push(id);
        for (const next of adj.get(id) || []) {
          indeg.set(next, indeg.get(next) - 1);
          if (indeg.get(next) === 0) queue.push(next);
        }
      }
      for (const id of runnable) if (!order.includes(id)) order.push(id); // cycles

      /* Split the wire order into dependency layers. Nodes on the same layer
         have no wire path between them, so they can all be submitted to
         ComfyUI's native queue AT ONCE (Promise.all) instead of the old
         "wait for one to finish before starting the next" loop. Layers are
         still sequential: a node whose input comes from a sibling generator
         must wait for that sibling's data.result to be attached first. */
      const level = new Map(runnable.map((id) => [id, 0]));
      for (const id of order) {
        for (const next of adj.get(id) || []) {
          level.set(next, Math.max(level.get(next) || 0, (level.get(id) || 0) + 1));
        }
      }
      const layers = [];
      for (const id of order) {
        const lv = level.get(id) || 0;
        if (!layers[lv]) layers[lv] = [];
        layers[lv].push(id);
      }

      NS.api?.toast?.("info", t("core.runGroup"),
        t("core.queuingNodesOnce", { count: order.length }));
      for (const layer of layers) {
        if (!layer || !layer.length) continue;
        /* Silent per-node toasts — one summary at the end instead of a
           stack of "core.generationComplete" notifications when a whole layer finishes. */
        await Promise.all(layer.map(async (id) => {
          try { await NS.generate?.run?.(id, { silent: true }); }
          catch (error) { console.warn("[InfCanvas] group run failed", id, error); }
        }));
      }
      let done = 0, failed = 0;
      for (const id of order) {
        const node = state.nodes.value.find((entry) => entry.id === id);
        if (node?.data?.status === "done") done += 1; else failed += 1;
      }
      NS.api?.toast?.(failed ? "warning" : "success", t("core.groupRunFinished"),
        t("core.doneFailed", { done, failed }));
    };

    const batchDelete = () => {
      const ids = state.selectedIds.value.slice();
      const groupIds = state.selectedGroupIds.value.slice();
      if (ids.length + groupIds.length < 2) return;
      const gone = new Set(ids);
      const goneGroups = new Set(groupIds);
      state.groups.value = state.groups.value.filter((group) => !goneGroups.has(group.id));
      state.selectedGroupIds.value = state.selectedGroupIds.value.filter((id) => !goneGroups.has(id));
      if (ids.length) {
        NS.flow?.selectNodes?.([]);
        NS.flow?.removeNodes?.(ids);
      }
      NS.api?.markDirty?.();
      NS.flow?.history?.schedule?.();
      const label = ids.length && groupIds.length
        ? t("core.deletedItems", { count: ids.length + groupIds.length })
        : ids.length ? t("core.deletedNodes", { count: ids.length })
          : t("core.deletedGroups", { count: groupIds.length });
      NS.api?.toast?.("success", label);
    };

    /* Groups and the toolbox live in VueFlow's transformation pane, so all
       of these are GRAPH units now — the pane's translate+scale does the
       same work it does for node cards, which keeps the 12px radius, 1px
       border and 20px grips visually identical to a node at every zoom. */
    const groupStyle = (group) => ({
      left: group.x + "px",
      top: group.y + "px",
      width: group.w + "px",
      height: group.h + "px",
    });
    /* Last group in state.groups is the most recently selected one. Negative
       layers keep every group below node cards (z=0), while giving each
       group's backdrop AND title the same rank so a newer group covers an
       older one completely. */
    const groupLayer = (group) => {
      const index = state.groups.value.findIndex((entry) => entry.id === group.id);
      return -(state.groups.value.length - Math.max(index, 0));
    };
    const groupBackdropStyle = (group) => ({ ...groupStyle(group), zIndex: groupLayer(group) });
    const groupTitleStyle = (group) => ({ zIndex: groupLayer(group) });

    /* Both toolbars are layer-outside now: selectionRect/groupToolRect are
       already SCREEN pixels relative to #infcanvas-vueflow, so position them
       directly with no graph-unit round-trip (which would skew on zoom). */
    const toolStyle = () => {
      const rect = selectionRect.value;
      if (!rect) return {};
      return {
        left: (rect.x + rect.w / 2) + "px",
        top: (rect.y - 10) + "px",
      };
    };
    const groupToolStyle = () => {
      const rect = groupToolRect.value;
      if (!rect) return {};
      return { left: rect.x + "px", top: rect.y + "px" };
    };

    return {
      mode, showMinimap, multiSelect, groupingFrozen, selectionRect, groupToolRect, activeGroup,
      groupEditing, selectedGroupIds, groupDisplayTitle,
      dropTargetGroupIds, iz,
      groups, createGroup, selectGroup, onPaneClick, GROUP_CORNERS,
      startGroupRename, commitGroupRename, cancelGroupRename, startGroupDrag, startGroupResize,
      openGroupMenu, openGroupTagMenu, toggleGroupTag, pickGroupTag, groupTagOpen, groupTagTarget,
      groupDraggingId,
      openArrangeMenu, batchFavorite, batchDelete, groupTagColor, groupTagInfo,
      openGroupArrangeMenu, favoriteGroup, runGroup, ungroup: deleteGroup,
      groupStyle, groupBackdropStyle, groupTitleStyle, toolStyle, groupToolStyle,
      onInit, onViewportChange, onConnect, isValidConnection,
      onConnectStart, onConnectEnd, frozenConn, onConnFrame, clearFrozenConn,
      onNodeDrag, onNodeDragStop, onNodeClick, onSelectionChange,
      zoomFar, cutMode, cutTrail,
      /* Vue Flow clamps d3-zoom's scaleExtent from these two props; leaving
         them at the library default (0.5 .. 2) would cap the wheel at 200%. */
      minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
      snap, snapGrid: [10, 10],
      nodes: state.nodes, edges: state.edges,
      nodeTypes: VueNS.markRaw({ ic: IcNode }),
      edgeTypes: VueNS.markRaw({ ic: makeIcEdge(state, t, (ids) => NS.flow?.removeEdges?.(ids)) }),
      toggleMinimap: () => NS.flow?.minimap.toggle(),
      /* Native MiniMap.vue colours nodes with color-mix(in srgb, primary 60%,
         transparent) so they follow the ComfyUI palette/theme instead of a
         hard-coded blue. SVG fill resolves var() + color-mix (verified live). */
      miniColor: () => "color-mix(in srgb, var(--primary) 60%, transparent)",
      /* Native Button: muted-textonly + size icon (button.variants.ts). Kept
         here because flow-root.js builds its own template outside controls.js. */
      miniBtnClass: "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 border-none font-inter text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([width]):not([height])]:size-4 bg-transparent text-muted-foreground hover:bg-accent size-8 rounded-lg",
    };
  },
  template: `
    <VueFlow
      :nodes="nodes" :edges="edges" :node-types="nodeTypes" :edge-types="edgeTypes"
      :min-zoom="minZoom" :max-zoom="maxZoom"
      :snap-to-grid="snap" :snap-grid="snapGrid"
      :pan-on-drag="true"
      :connection-radius="connectionRadius"
      :nodes-draggable="mode === 'select'" :elements-selectable="mode === 'select'"
      :nodes-connectable="mode === 'select'" :edges-updatable="mode === 'select'"
      connection-mode="strict"
      :selection-key-code="mode === 'select' ? 'Control' : false"
      :multi-selection-key-code="['Shift', 'Control', 'Meta']"
      :selection-mode="selectionMode"
      :zoom-on-scroll="true" :zoom-on-double-click="false" :prevent-scrolling="true"
      :delete-key-code="null" :fit-view-on-init="false" :elevate-edges-on-select="false"
      :elevate-nodes-on-select="false"
      :default-edge-options="{ type: 'ic' }"
      :class="['ic-flow', 'mode-' + mode, { 'is-far': zoomFar, 'is-cut-mode': cutMode, 'is-multi-select': multiSelect, 'is-grouping': groupingFrozen, 'marquee-crossing': selectionMode === 'partial' }]"
      :style="{ '--ic-iz': iz }"
      @init="onInit" @viewport-change="onViewportChange" @connect="onConnect"
      @pane-click="onPaneClick"
      @connect-start="onConnectStart" @connect-end="onConnectEnd"
      :is-valid-connection="isValidConnection"
      @node-drag="onNodeDrag" @node-drag-stop="onNodeDragStop"
      @node-click="onNodeClick" @selection-change="onSelectionChange"
    >
      <!-- Vue Flow native dotted background (#81818a dots, gap 20). It lives
           inside VueFlow so it follows the viewport zoom/pan automatically. -->
      <Background variant="dots" />
      <template #connection-line="slotProps">
        <IcConnectionLine v-bind="slotProps" :on-frame="onConnFrame" />
      </template>
      <!-- zoom-pane is the slot VueFlow renders INSIDE the transformation
           pane, so these use graph units and scale exactly like nodes. The
           backdrop is below the nodes; only the strip/grips/toolbar take
           pointers (the pane itself is pointer-events:none). -->
      <template #zoom-pane>
        <!-- Frozen wire after a release over empty canvas (connect menu open):
             same component + same graph coords as the live connection line, so
             it reads as the wire never left the pointer. Cleared on pick/cancel. -->
        <svg v-if="frozenConn" class="ic-frozen-conn" width="1" height="1">
          <IcConnectionLine v-bind="frozenConn" />
        </svg>
        <div v-for="group in groups" :key="group.id" class="ic-group" :data-id="group.id"
             :class="{ 'is-selected': selectedGroupIds.includes(group.id), 'is-drop-target': dropTargetGroupIds.includes(group.id) }"
             :style="groupBackdropStyle(group)"></div>
        <div v-for="group in groups" :key="'ui-' + group.id" class="ic-group-ui" :data-id="group.id"
             :class="{ 'is-selected': selectedGroupIds.includes(group.id), 'is-drop-target': dropTargetGroupIds.includes(group.id), 'is-dragging': groupDraggingId === group.id }"
             :style="groupStyle(group)">
          <input v-if="groupEditing && groupEditing.id === group.id"
                 class="ic-group-title-input" v-model="groupEditing.value" :style="groupTitleStyle(group)"
                 @keydown.enter.prevent="commitGroupRename" @keydown.esc.prevent="cancelGroupRename"
                 @blur="commitGroupRename" @pointerdown.stop @mousedown.stop
                 @dblclick.stop @wheel.stop @contextmenu.stop.prevent />
          <div v-else class="ic-group-title nopan nodrag"
               :style="groupTitleStyle(group)"
               @pointerdown="startGroupDrag($event, group)" @mousedown.stop
               @dblclick.stop.prevent="startGroupRename(group)"
               @contextmenu.prevent.stop="openGroupMenu($event, group)"><button
               v-if="groupTagInfo(group)" class="icn__tag-chip ic-group-tag-chip nodrag nopan" type="button"
               :style="{ background: groupTagInfo(group).color }" v-tip="$t('core.changeTag')"
               @pointerdown.stop @click.stop="toggleGroupTag(group)"><span
               class="icn__tag-chip-dot"></span><span class="icn__tag-chip-name">{{ $t(groupTagInfo(group).name) }}</span></button
               ><button v-else class="icn__tag-add ic-group-tag-add nodrag nopan" type="button"
               v-tip="$t('core.addTag')" @pointerdown.stop @click.stop="toggleGroupTag(group)">
                 <IcIcon name="tag" :size="17" />
               </button>{{ groupDisplayTitle(group.title) }}</div>
          <TagMenu v-if="groupTagOpen && groupTagTarget === group" class="ic-group-tagmenu"
                   :current="group.tag || ''" @pick="pickGroupTag" />
          <div v-for="corner in GROUP_CORNERS" :key="corner" class="ic-group__rz nopan nodrag"
               :class="'ic-group__rz--' + corner"
               @pointerdown="startGroupResize($event, group, corner)" @mousedown.stop>
            <svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg>
          </div>
        </div>
      </template>
      <div v-if="showMinimap" class="ic-minimap-wrap nodrag">
        <div class="ic-minimap">
          <MiniMap :width="253" :height="200" :node-color="miniColor"
                 mask-color="transparent" mask-stroke-color="#fff" :mask-stroke-width="2"
                 pannable zoomable />
          <!-- Native MiniMap.vue keeps only the close button here; the settings
               button is intentionally omitted. The border rule sits below the
               32px button row so it never crosses a control. -->
          <button :class="miniBtnClass" class="ic-minimap__btn ic-minimap__close"
                  v-tip="$t('settings.close')" :aria-label="$t('settings.close')" @click.stop="toggleMinimap">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <hr class="ic-minimap__rule" />
        </div>
      </div>
    </VueFlow>
    <!-- Toolbars live OUTSIDE the zoom pane (screen-space siblings of the
         selection border), so they never inherit the viewport transform:
         buttons/graphics stay pixel-identical at any zoom. Positions come
         from toolStyle()/groupToolStyle() measured in host-relative pixels. -->
    <div v-if="selectionRect && multiSelect" class="ic-selection-tools" :style="toolStyle()"
         @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop @contextmenu.stop>
      <button type="button" class="icn__tool" v-tip="$t('core.group')" :aria-label="$t('core.group')" @click="createGroup">
        <IcIcon class="icn__tool-icon" name="grid-3x3" :size="14" /><span>{{ $t('core.group') }}</span>
      </button>
      <button type="button" class="icn__tool" v-tip="$t('core.arrange')" :aria-label="$t('core.arrange')" @click="openArrangeMenu">
        <IcIcon class="icn__tool-icon" name="layout-dashboard" :size="14" /><span>{{ $t('core.arrange') }}</span>
      </button>
      <button type="button" class="icn__tool" v-tip="$t('core.addAllFavorites')" :aria-label="$t('core.addAllFavorites')" @click="batchFavorite">
        <IcIcon class="icn__tool-icon" name="bookmark" :size="14" /><span>{{ $t('core.addAllFavorites') }}</span>
      </button>
      <button type="button" class="icn__tool icn__tool--danger" v-tip="$t('core.delete')" :aria-label="$t('core.delete')" @click="batchDelete">
        <IcIcon class="icn__tool-icon" name="trash-2" :size="14" /><span>{{ $t('core.delete') }}</span>
      </button>
    </div>
    <div v-if="groupToolRect && activeGroup" class="ic-group-tools" :style="groupToolStyle()"
         @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop @contextmenu.stop>
      <button type="button" class="icn__tool" v-tip="$t('core.arrange')" :aria-label="$t('core.arrange')" @click="openGroupArrangeMenu($event, activeGroup)">
        <IcIcon class="icn__tool-icon" name="layout-dashboard" :size="14" /><span>{{ $t('core.arrange') }}</span>
      </button>
      <button type="button" class="icn__tool" v-tip="$t('core.addAllFavorites')" :aria-label="$t('core.addAllFavorites')" @click="favoriteGroup(activeGroup)">
        <IcIcon class="icn__tool-icon" name="bookmark" :size="14" /><span>{{ $t('core.addAllFavorites') }}</span>
      </button>
      <button type="button" class="icn__tool" v-tip="$t('core.runGroup')" :aria-label="$t('core.runGroup')" @click="runGroup(activeGroup)">
        <IcIcon class="icn__tool-icon" name="play" :size="14" /><span>{{ $t('core.runGroup') }}</span>
      </button>
      <button type="button" class="icn__tool" v-tip="$t('core.ungroup')" :aria-label="$t('core.ungroup')" @click="ungroup(activeGroup.id)">
        <IcIcon class="icn__tool-icon" name="grid-3x3-off" :size="14" /><span>{{ $t('core.ungroup') }}</span>
      </button>
    </div>
    <!-- ComfyUI Comfy.SelectionBorder equivalent: dashed round-rect around
         all selected nodes, measured in screen space above. -->
    <svg v-if="selectionRect" class="ic-selection-border" aria-hidden="true">
      <rect :x="selectionRect.x" :y="selectionRect.y" :width="selectionRect.w" :height="selectionRect.h"
            rx="8" ry="8" fill="none" stroke="var(--border, #ffffff66)" stroke-width="2"
            stroke-dasharray="5 5" />
    </svg>
    <!-- Alt slice: the stroke the pointer actually travels, so the user sees
         which wires the knife is about to take. -->
    <svg v-if="cutTrail" class="ic-cut-trail" aria-hidden="true">
      <path :d="cutTrail"></path>
    </svg>
  `,
};

  return Root;
}
