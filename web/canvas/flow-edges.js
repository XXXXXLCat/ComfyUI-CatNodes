/* Edge + connection-line components. Extracted from infcanvas-flow.js (batch 2).
   Depends on: shared reactive `state`, flow-rules tables, i18n `t`, and the
   Vue Flow vendor bundle. All are injected explicitly to keep this module pure. */
import {
  Vue as VueNS, VueFlow as FlowNS,
} from "./vendor/vueflow.bundle.mjs";
import { assetKindOf, EDGE_LABEL_KIND } from "./flow-rules.js";
const { computed, watch } = VueNS;
/* BaseEdge / getBezierPath live on the VueFlow namespace object, not as named
   exports of the bundle (same as infcanvas-flow.js:89). */
const { BaseEdge, getBezierPath } = FlowNS;

/* Map an infinite-canvas node kind to a ComfyUI slot datatype so wire colours
   match the host's per-type palette AND follow theme changes. ComfyUI writes
   these variables onto <html> on every palette switch (loadLinkColorPaletteForVueNodes);
   getSlotColor() reads `var(--color-datatype-<TYPE>, #AAA)`. We do the same through
   --ic-edge-tone (see infcanvas-vueflow.css). No audio/video datatype exists in
   ComfyUI, so those borrow the closest semantic slot. */
const EDGE_TONE_VAR = {
  image: "--color-datatype-IMAGE",   // blue-ish per theme
  video: "--color-datatype-LATENT",  // video flows through latent space
  audio: "--color-datatype-CLIP_VISION", // closest encoded-media slot
  text:  "--color-datatype-CONDITIONING", // prompts become conditioning
  lora:  "--color-datatype-MODEL",
};
const edgeTone = (kind) => EDGE_TONE_VAR[kind] || "--color-datatype-IMAGE";

  /* ------------------------------- edge view ----------------------------- */

  /* Mirrors ComfyUI's link rendering (renderer/core/canvas/pathRenderer.ts):
     the bezier itself plus a CENTRE MARKER — a filled circle of radius 5 at the
     curve's t=0.5 point, drawn in the link colour (drawCenterMarker), hidden
     once the canvas is zoomed below 60% (`scale >= 0.6`). ComfyUI opens a link
     menu when that marker is clicked; here a click simply disconnects the wire.
     Highlight: LGraphCanvas.highlighted_links collects every link attached to a
     SELECTED node and renders them with colors.highlighted = '#FFF'. */
  function makeIcEdge(state, t, removeEdges) {
  return {
    name: "IcEdge",
    props: ["id", "source", "target", "sourceX", "sourceY", "targetX", "targetY",
            "sourcePosition", "targetPosition", "selected"],
    setup(props) {
      const bezier = computed(() => getBezierPath({
        sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
        targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
      }));
      const path = computed(() => bezier.value[0]);
      /* getBezierPath's label point IS the exact t=0.5 sample of the cubic
         (weights .125/.375/.375/.125), i.e. the same point ComfyUI stores as
         link._pos for its centre marker. */
      const cx = computed(() => bezier.value[1]);
      const cy = computed(() => bezier.value[2]);
      const highlighted = computed(() => {
        const ids = state.selectedIds.value;
        return ids.length > 0 && (ids.includes(props.source) || ids.includes(props.target));
      });
      /* One target with 2+ incoming wires, all from the SAME kind of source:
         label each wire 文本1 / 文本2, 图像1 / 图像2 … A single wire or a mix
         of kinds stays unlabelled (only the original centre dot shows). */
      const edgeLabel = computed(() => {
        const incoming = state.edges.value.filter((e) => e.target === props.target);
        if (incoming.length < 2) return "";
        const nodes = state.nodes.value;
        const kinds = incoming.map((e) => assetKindOf(nodes.find((n) => n.id === e.source)));
        if (kinds.some((kind) => !kind || kind !== kinds[0])) return "";
        const base = EDGE_LABEL_KIND[kinds[0]];
        if (!base) return "";
        const index = incoming.findIndex((e) => e.id === props.id) + 1;
        return index ? t(base, { n: index }) : "";
      });
      /* Same metrics as .icn__tag-chip: 20px tall, 9px side padding, 12px
         glyphs (CJK 12px, latin/digits ~7px), no dot. */
      const labelWidth = computed(() => {
        const text = edgeLabel.value;
        if (!text) return 0;
        let units = 0;
        for (const ch of text) units += /[\u3400-\u9fff]/.test(ch) ? 12 : 7;
        return Math.ceil(units + 18);
      });
      /* Per-edge wire colour: host datatype variable keyed by the SOURCE
         node's kind (mirrors ComfyUI link colour = output slot type). The
         variable lives on <html> and re-resolves on theme switch. */
      const tone = computed(() => {
        const srcNode = state.nodes.value.find((n) => n.id === props.source);
        return `var(${edgeTone(assetKindOf(srcNode))}, var(--color-smoke-700, #9a9))`;
      });
      const cut = (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeEdges?.([props.id]);
      };
      return { path, cx, cy, highlighted, edgeLabel, labelWidth, cut, tone };
    },
    template: `
      <g class="ic-edge-g" :class="{ 'is-hl': highlighted }" :style="{ '--ic-edge-tone': tone }">
        <path :d="path" class="ic-edge-border" />
        <BaseEdge :id="id" :path="path" class="ic-edge" />
        <g v-if="edgeLabel" class="ic-edge-label-hit" @pointerdown.stop @click.stop="cut">
          <rect class="ic-edge-label-bg" :x="cx - labelWidth / 2" :y="cy - 10" :width="labelWidth" height="20" rx="10"></rect>
          <text class="ic-edge-label-text" :x="cx" :y="cy + 1">{{ edgeLabel }}</text>
        </g>
        <g v-else class="ic-edge-dot-hit" @pointerdown.stop @click.stop="cut">
          <circle class="ic-edge-dot-halo" :cx="cx" :cy="cy" r="9"></circle>
          <circle class="ic-edge-dot ic-edge-dot-core" :cx="cx" :cy="cy" r="5"></circle>
          <circle class="ic-edge-dot-center" :cx="cx" :cy="cy" r="3"></circle>
        </g>
      </g>
    `,
    components: { BaseEdge },
  };
}

  /* Dragging a new wire from a slot: green #AAFFAA line + 8px green dot at
     the source handle, 12px amber #FFCC00 dot at the cursor (user spec). Graph
     coords (auto-scaled by the pane). Colours are literal hex, not UI text.
     Vue Flow anchors sourceX/Y at the handle's OUTER EDGE, but our visible slot
     dot is centred on the 6px handle element -> the anchor is half a handle
     (3px) off. Pull it back by half a handle so the drag dot sits exactly on
     the slot centre ("centre on centre"); do the same for the path start. */
  function makeIcConnectionLine() {
  return {
    name: "IcConnectionLine",
    props: ["sourceX", "sourceY", "sourcePosition", "targetX", "targetY", "targetPosition", "onFrame"],
    setup(props) {
      /* Report every frame to the owner so a released wire can be frozen at
         the exact last-drawn graph coordinates (Vue Flow drops this slot the
         instant connectEnd fires). */
      watch(
        () => [props.sourceX, props.sourceY, props.sourcePosition, props.targetX, props.targetY, props.targetPosition],
        () => {
          if (typeof props.onFrame === "function") {
            props.onFrame({
              sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
              targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
            });
          }
        },
        { immediate: true }
      );
      const HALF = 3; // half of the 6px handle (graph units)
      const src = computed(() => {
        const p = String(props.sourcePosition || '').toLowerCase();
        let dx = 0, dy = 0;
        if (p.includes('right')) dx = -HALF;
        else if (p.includes('left')) dx = HALF;
        else if (p.includes('top')) dy = HALF;
        else if (p.includes('bottom')) dy = -HALF;
        else dx = -HALF; // drag always starts from an output (right) handle
        return { x: props.sourceX + dx, y: props.sourceY + dy };
      });
      const path = computed(() => getBezierPath({
        sourceX: src.value.x, sourceY: src.value.y, sourcePosition: props.sourcePosition,
        targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
      })[0]);
      /* In-flight wire source colour follows the same host datatype palette
         as settled wires (default IMAGE), so theme switches recolour it too. */
      const connTone = `var(--color-datatype-IMAGE, #AAFFAA)`;
      return { path, src, connTone };
    },
    template: `
      <g class="ic-connline" :style="{ '--ic-conn-tone': connTone }">
        <path :d="path" fill="none" :stroke="connTone" stroke-width="3" />
        <circle :cx="src.x" :cy="src.y" r="4" :fill="connTone" />
        <circle :cx="targetX" :cy="targetY" r="6" fill="#FFCC00" />
      </g>
    `,
  };
}
export { makeIcEdge, makeIcConnectionLine };
