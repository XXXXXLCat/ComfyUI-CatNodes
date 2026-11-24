/* IcNode: the single Vue component used by every infinite-canvas node
   (asset/generator/text/LoRA/cleanup/merge). Extracted from infcanvas-flow.js
   (batch 5). Canvas state, the workflow list and the lazy i18n/tip helpers are
   injected; all NS.flow.* calls intentionally stay on the façade. */
import { Vue as VueNS, VueFlow as FlowNS } from "./vendor/vueflow.bundle.mjs";
import { IcIcon } from "./flow-icons.js";
import {
  KIND_CN,
  MODE_ASSET_SLOTS,
  IMAGE_MODE_ASSET_SLOTS,
  AUDIO_MODE_ASSET_SLOTS,
  TEXT_MODE_ASSET_SLOTS,
  AUDIO_INPUT_RULES,
  AUDIO_MODES,
  IMAGE_MODES,
  VIDEO_MODES,
  IMAGE_INPUT_RULES,
  TEXT_INPUT_RULES,
  TEXT_MODES,
  MODE_TOP_GROUPS,
  TOP_GROUP_MODES,
  TOP_OF_MODE,
  NODE_TAGS,
  TAG_BY_NAME,
  isMusicMode,
  assetKindOf,
  modeReasonFor,
  wiredTextSources,
} from "./flow-rules.js";
import { TagMenu, MediaSlots } from "./flow-components.js";
import { useMediaPlayer, useAudioWave } from "./flow-media.js";
import { icNodeTemplate } from "./flow-node-template.js";
import { usePromptMention } from "./flow-mention-editor.js";
import { useLoraStack } from "./flow-lora-stack.js";
import { useFieldControls } from "./flow-field-controls.js";

const { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } = VueNS;
const { Handle } = FlowNS;

/* ---- generator-popover viewport flip (2026-11-22) ------------------------
   Every dropdown used to open downward unconditionally, so a node near the
   bottom of the window pushed its menu off-screen. These pure helpers decide
   the side from SCREEN rects (getBoundingClientRect / window.innerHeight) and
   convert the result back into the node's LOCAL units for the inline styles.
   Works for inverse-scaled popovers (field list / value chooser: rect height
   is already screen px) and ordinary ones (LoRA picker: rect height = layout
   height * zoom) alike. The workflow picker is a third case: it lives inside
   .icn__genpanel, which inverse-scales as a whole, so its rect height is
   screen px AND its inline top must be panel CSS px (1:1 with screen). */
const MENU_GAP = 8, MENU_MARGIN = 8;
/* `prefer` is the popover's natural side; it is kept whenever it fits, and
   flipped only when it would cross the window and the other side has room
   (or is simply larger). Defaults to "down" — every dropdown except the
   settings card, which was designed to grow upward. */
const pickMenuSide = (anchorRect, menuRect, prefer = "down") => {
  const need = menuRect.height + MENU_GAP + MENU_MARGIN;
  const below = window.innerHeight - anchorRect.bottom;
  const above = anchorRect.top;
  const fitsDown = below >= need, fitsUp = above >= need;
  if (prefer === "down") {
    if (fitsDown) return "down";
    if (fitsUp || above > below) return "up";
    return "down";
  }
  if (fitsUp) return "up";
  if (fitsDown || below > above) return "down";
  return "up";
};
/* Local `top` (node units) for a popover anchored to `anchorRect` inside the
   zoomed `.icn` root. `gap` is in local units (existing call sites use 4/6);
   `menuH` is the menu's SCREEN height from getBoundingClientRect(). */
const menuTopLocal = (side, rootRect, anchorRect, scale, gap, menuH) => {
  const local = (screenY) => (screenY - rootRect.top) / scale;
  return Math.round(side === "up"
    ? local(anchorRect.top) - gap - menuH / scale
    : local(anchorRect.bottom) + gap);
};

export function createIcNode({ NS, state, t, clamp, bindTip, SHARED_WF_LIST, loadWorkflows, bringToFront, SLOT_STEP, ASSET_MIN_W, ASSET_DEF_W, HEAD_H, ensureVideoThumb }) {
/* ------------------------------ node view ------------------------------ */

const IcNode = {
  name: "IcNode",
  components: { Handle, IcIcon, MediaSlots, TagMenu },
  props: { id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean },
  setup(props) {
    const data = props.data;
    /* Workflow scope by node type. The four medium-specific generators
       (image / video / audio / text) may only use shipped/built-in workflows;
       the universal (omni) node is where users pick the workflows they added
       themselves. Both read the same backend list, split on `builtin`.
       Declared before the category tabs so tab visibility reacts to the live
       list, including bundled defaults. SHARED_WF_LIST itself stays untouched
       (other nodes and the API dialog read the raw list). */
    const kind = computed(() => data.kind || "image");
    const wfList = computed(() => {
      const all = SHARED_WF_LIST.value || [];
      return kind.value === "omni"
        ? all.filter((w) => !w.builtin)
        : all.filter((w) => w.builtin === true);
    });
    /* A universal generator runs ANY workflow, so its result's real medium
       is only known after it runs. The node still identifies as kind "omni"
       for all panel/mode logic, but for result DISPLAY (thumbnail, video,
       audio wave) it must follow what the workflow actually produced. Before
       a result exists there is nothing to show, so this mirrors `kind`. */
    const displayKind = computed(() => {
      if (kind.value === "omni" && data.result?.kind) return data.result.kind;
      return kind.value;
    });
    /* ONE node type per medium. `isGen` means "this media node is still a
       generator": no material of its own yet, so it owns the input handle and
       the parameter panel. Dropping a file on it sets data.asset and it turns
       into a material node — a final state, hence computed: the flip has to
       re-render this very node in place. */
    const isMedia = data.role === "media";
    const isGen = computed(() => isMedia && !data.asset);
    /* Generation frame states (mutually exclusive, all outrank the white
       selection ring): queued = yellow, running/sampling = azure, error =
       red. queued is the window between submit and execution_start, so it is
       status=running paired with genPhase=queued. */
    const isWaiting = computed(() => isProgressing.value && data.status === "running" && data.genPhase === "queued");
    const isError = computed(() => isProgressing.value && data.status === "error");
    const isRunningFrame = computed(() => isProgressing.value && data.status === "running" && !isWaiting.value);
    /* Text nodes are their own role (neither media nor generator): they keep
       the asset-style frameless look but also accept an input handle. */
    const isText = data.role === "text";
    /* LoRA stack node: a pure config card wired into a generator. Kept as a
       plain data.role flag (not a Vue nodeType) so it shares the frame, resize
       grips, selection ring and out-handle with every other node. */
    const isLora = data.role === "lora";
    /* Quick-cleanup pill: a 30px solid bar with one AnyType socket on each
       end. Clicking the bar runs the cleanup (no generator panel involved). */
    const isCleanup = data.role === "cleanup";
    /* Text-merge pill: same 30px bar as a cleanup pill, but instead of running
       a job it joins every upstream text node with newlines into its own
       data.text (read downstream as an ordinary text input). */
    const isMerge = data.role === "text_merge";
    /* 30px-bar nodes share the pill chrome: cleanup actions and the merge. */
    const isPill = isCleanup || isMerge;
    /* A material node shows its material; a generator shows its last result.
       Material wins: once a node flips to material it never flips back, so a
       stale result can never shadow the file the user dropped on it. */
    const assetOf = computed(() => data.asset || data.result || null);
    const url = computed(() => {
      const asset = assetOf.value;
      if (!asset) return "";
      return asset.url || NS.api?.viewUrl?.(asset) || "";
    });
    /* Does a text node hold anything at all? Drives both its empty-state
       glyph and whether its upload slot is still available. */
    const hasText = computed(() =>
      !!(data.text || data.asset?.text || data.asset?.name || "").trim());

    /* Is anything wired into this node's input? Live, so the upload action
       appears/disappears the moment a wire is connected or cut. */
    const hasIncoming = computed(() => {
      const edges = NS.flow?.edgesOf?.() || [];
      return edges.some((edge) => edge.target === props.id);
    });
    /* An EMPTY text node is a generator: it shows the same bottom panel as
       the media generators, with two modes (LLM / 语音转录). Incoming WIRES
       do NOT turn it into material — the point of an LLM node is to read the
       picture / video wired into it, and 语音转录 reads the wired clip. Only
       content of its own (typed text, an uploaded file, a result) makes it a
       material node and retires the panel, the same one-way rule the media
       nodes follow. */
    /* The generated result is echoed on the node itself (data.result), so with a
       result it stays a generator: the panel remains to re-run, the body shows its text. */
    const isGenText = computed(() => isText && !data.asset && !hasText.value);
    /* Which nodes show LIVE generation progress (header bar, progress card,
       running frame). Media generators AND text generators both run through
       NS.generate.run() / genProgress and carry genPhase/genProgress on their
       data — text nodes are role="text", so they were excluded by isGen and
       never got a progress UI even though the backend kept writing progress.
       Deliberately separate from isGen: that flag also drives media-only panel
       and input-handle branches, which must stay as they are for text nodes. */
    const isProgressing = computed(() => isGen.value || isGenText.value);
    const textModes = TEXT_MODES;
    const textMode = computed(() => (TEXT_MODES.indexOf(data.textMode) >= 0
      ? data.textMode : TEXT_MODES[0]));
    /* The guard mirrors setVideoMode: wires decide modes, so a mode the wired
       media cannot satisfy is refused with its reason instead of silently
       being selected. */
    const setTextMode = (mode) => {
      if (TEXT_MODES.indexOf(mode) < 0 || mode === textMode.value) return;
      const reason = textModeReason(mode);
      if (reason) {
        NS.api?.toast?.("warning", t("wire.modeUnavailable"), reason);
        return;
      }
      patch({ textMode: mode });
    };
    /* Which nodes own a bottom generator panel: all media generators plus an
       empty text node. Kept separate from isGen because the text node still
       renders its body as editable text / upload slot, not as media. */

    const media = useMediaPlayer(() => url.value);
    const wave = useAudioWave(() => url.value, () => media.el.value, () => displayKind.value === "audio", () => state.viewport.value.zoom);
    /* Every generator popover now lives inside .icn__genpanel / .icn__gpa-pop
       and inherits the panel's whole-panel inverse scale, so none of them
       needs a zoom re-anchor hook. */
    /* A generate node's bottom strip is reserved for its parameter bar;
       playback of a generated video/audio lives in the node's own body, which
       shows the result it keeps in data.result. */
    const bar = computed(() => (displayKind.value === "video" || displayKind.value === "audio") && !!assetOf.value);
    const hasMedia = computed(() => !!assetOf.value && (displayKind.value === "image" || displayKind.value === "video" || displayKind.value === "audio"));

    /* Every node shares the same card: data.size IS the whole frame, the
       header strip eats the top HEAD_H and the body gets the rest.
       The LoRA stack is content-driven — height follows the enabled row
       count (see flow-lora-stack.js:loraFitHeight).    /* Live sample preview (ComfyUI b_preview stream) is written to data.genPreviewUrl
       by core.js/genProgress. Its natural aspect drives the running node height;
       measured on img load, cleared implicitly when genPreviewUrl resets. */
    const genPreviewH = ref(0);
    const size = computed(() => Array.isArray(data.size) ? data.size : [480, 270]);
    /* While a generator is running, the HEADER band doubles as the progress bar
       and the body shows the live sample preview with one text row floating at
       its top. The instant generation starts there is no sample yet: keep the
       node at its normal stored content height (don't collapse to the thin text
       strip). Once a sample arrives, size to the image's aspect ratio. Restore
       the stored size on completion. Ports stay centred via handleTop. */
    const GEN_RUN_BODY_H = 40; // absolute floor: one 16px text row + breathing room
    const bodyH = computed(() => {
      if (isPill) return 0; // the whole pill IS the title bar — no body
      if (isGen.value && data.status === "running") {
        return data.genPreviewUrl && genPreviewH.value > 0
          ? Math.max(GEN_RUN_BODY_H, genPreviewH.value)
          : Math.max(GEN_RUN_BODY_H, size.value[1] - HEAD_H);
      }
      return isLora
        ? Math.max(80, size.value[1] - HEAD_H, loraFitHeight(loras.value.length) - HEAD_H)
        : Math.max(80, size.value[1] - HEAD_H);
    });
    const rootStyle = computed(() => ({
      width: Math.max(isPill ? 160 : isLora ? LORA_MIN_W : 0, size.value[0]) + "px",
      height: (isPill ? 30 : bodyH.value + HEAD_H) + "px",
    }));
    /* Ports sit on the body, not on the card: keep them centred on the content
       area so a wire never lands on the header edge. A cleanup pill has no body,
       so its single socket sits dead centre of the 30px bar. */
    const handleTop = (index, count = 1) =>
      isPill ? "50%" : `calc(50% + ${HEAD_H / 2 + (index - (count - 1) / 2) * SLOT_STEP}px)`;

    /* ---- resize (four corners) ---- */
    /* `corner` is a compass label: "nw" | "ne" | "sw" | "se". Each handle
       keeps the OPPOSITE edges fixed and only moves its own two edges, so
       resizing from any corner behaves like ComfyUI's corner grips. */
    const resizing = ref("");
    const onResizeDown = (event, corner = "se") => {
      event.preventDefault();
      event.stopPropagation();
      /* The node's CSS width/height live in canvas/logical pixels, but the
         viewport applies a `zoom` transform. Mouse movement is in screen
         pixels, so divide by the live zoom — otherwise, at any zoom other
         than 100%, the handle drifts away from the cursor while resizing. */
      const zoom = NS.flow?.getViewport?.().zoom || 1;
      const startX = event.clientX;
      const startY = event.clientY;
      const live = NS.flow?.findNode?.(props.id);
      const x0 = live?.position?.x ?? 0;
      const y0 = live?.position?.y ?? 0;
      const [w0, h0] = size.value;
      const west = corner.indexOf("w") >= 0;     // left edge moves
      const north = corner.indexOf("n") >= 0;   // top edge moves
      const snapped = () => !!NS.flow?.snap?.enabled?.();
      const snap10 = (v) => Math.round(v / 10) * 10;
      /* Asset media, generated media and text nodes all use the frameless
         320px-minimum card; only the legacy unknown kinds keep 160. */
      const isMediaLike = kind.value === "image" || kind.value === "video" || kind.value === "audio" || kind.value === "text" || kind.value === "omni";
      /* LoRA stacks share the 320px media floor and a content-derived height
         floor (never smaller than fitHeight for the current row count), so a
         manual resize can't shrink them back over their own rows. */
      const MINW = isPill ? 160 : (isMediaLike || isLora) ? ASSET_MIN_W : 160;
      const MINH = isPill ? 30 : isLora
        ? loraFitHeight(loras.value.length)
        : HEAD_H + 80;
      resizing.value = corner;
      const move = (ev) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let w = w0 + (west ? -dx : dx);
        let h = h0 + (north ? -dy : dy);
        let x = x0 + (west ? dx : 0);   // fixed right edge when dragging left
        let y = y0 + (north ? dy : 0);  // fixed bottom edge when dragging top
        /* Min size: clamp, then re-pin the fixed edge so the opposite side
           never creeps while the dragged side hits the limit. */
        if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
        if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
        /* Grid snap: align the MOVING edge to the nearest 10px cell, keeping
           the opposite edge pinned. Same step as node-move snapping. */
        if (snapped()) {
          if (west) { x = snap10(x); w = (x0 + w0) - x; }
          else { w = snap10(x0 + w) - x0; }
          if (north) { y = snap10(y); h = (y0 + h0) - y; }
          else { h = snap10(y0 + h) - y0; }
          if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
          if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
        }
        w = Math.round(w); h = Math.round(h);
        x = Math.round(x); y = Math.round(y);
        patch({ size: [w, h] });
        NS.flow?.setNodePosition?.(props.id, { x, y });
      };
      const up = () => {
        resizing.value = "";
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };

    /* Vue Flow's parseNode() copies each node into its own store. The node
       component edits that copy, while the document (and therefore `save`)
       holds the source array. Every mutation must touch both. */
    const patch = (fields, options) => {
      for (const [key, value] of Object.entries(fields)) data[key] = value;
      NS.flow?.updateNodeData?.(props.id, fields);
      /* `silent` = derived/normalised write, not a user edit: keep it out of
         the undo stack (see historyAbsorb). */
      if (options?.silent) NS.flow?.history?.absorb?.();
      NS.flow?.markDirty?.();
    };
    /* ---- Text-merge pill: join every wired upstream text with newlines ----
       The merged result lives in data.text, exactly where a hand-typed text
       node keeps its content. Downstream readers (buildPrompt/collectInputs
       for generators, audioWired/wiredText for audio panels) therefore need
       NO special case: they already read source.data.text. Follow incoming
       edges in wire order, take each source node's text (plain text node, a
       generator's result, or another merge pill), drop empties, join with a
       single newline. Re-runs whenever any upstream text or edge changes. */
    const mergedText = computed(() => {
      if (!isMerge) return "";
      const nodes = NS.flow?.nodesOf?.() || [];
      const edges = NS.flow?.edgesOf?.() || [];
      const parts = [];
      for (const edge of edges) {
        if (edge.target !== props.id) continue;
        const src = nodes.find((n) => n.id === edge.source);
        if (!src || src.data?.role === "lora" || src.data?.role === "cleanup") continue;
        const value = String(src.data?.text || src.data?.result?.text || "").trim();
        if (value) parts.push(value);
      }
      return parts.join("\n");
    });
    watch(mergedText, (value) => {
      if (data.text !== value) patch({ text: value }, { silent: true });
    }, { immediate: true });
    /* ---- LoRA stack (see flow-lora-stack.js) ----
       Model list + searched name combobox + content-driven height are now a
       composable. These bindings are re-exported unchanged; geometry below
       (bodyH / rootStyle / resize) keeps using loraFitHeight / LORA_MIN_W. */
    const {
      loras, loraOptions, loadLoraOptions, addLora, removeLora, setLoraName,
      setLoraStrength, stepLora, toggleLora, loraStrengthText,
      loraSelIndex, loraQuery, loraSelStyle, loraSearchEl, loraSelName,
      filteredLoraOptions, closeLoraSel, setLoraSearchEl, toggleLoraSel, pickLoraSel,
      loraFitHeight, LORA_MIN_W, enabledTriggers, setTriggerEl,
    } = useLoraStack({ data, patch, NS, isLora, HEAD_H, ASSET_MIN_W, pickMenuSide, menuTopLocal });
    /* Typing in the prompt box (rich editor or plain textarea) marks the
       value as the user's own, so a later API-default fetch never overwrites
       it. Other fields keep the plain write. */
    const setField = (key, value) => patch(
      key === "prompt" ? { prompt: value, promptEdited: true } : { [key]: value }
    );
    const run = () => {
      /* A mode whose category has no workflow must not be runnable even if
         the click is triggered from elsewhere than the disabled button. */
      if (noWorkflow.value) return;
      NS.generate?.run?.(props.id);
    };
    const cancelGen = () => NS.generate?.cancel?.(props.id);
    /* Generate-node control bar: compact selects mirroring the reference
       video-generator toolbar, wired to this node's real parameters. */
    /* Image generator has two categories mirroring the API workflow
       categories; its API selector is filtered to the active one below. */
    const imageModes = IMAGE_MODES;
    /* Universal generator (kind "omni"): a media generator that takes ANY
       incoming kind and any workflow. It rides the generic `isGen` panel with
       its mode tabs hidden (see the panel template), so no medium-specific
       branch is involved. */
    const isGenOmni = computed(() => isGen.value && kind.value === "omni");
    /* Text result echo for the universal generator: it keeps kind="omni" for
       all panel/mode logic, so the plain `kind === "text"` body test never
       matches its text outputs. Follow displayKind (the result's real medium)
       for the BODY only, leaving isGen / panel branches untouched. */
    const showTextBody = computed(() =>
      (kind.value === "text" && !isGen.value) ||
      (isGenOmni.value && displayKind.value === "text" && !!assetOf.value));
    const hasDisplayText = computed(() =>
      hasText.value || !!(data.result?.text && String(data.result.text).trim()));
    const isGenImage = computed(() => isGen.value && kind.value === "image");
    const imageMode = computed(() => (imageModes.indexOf(data.imageMode) >= 0
      ? data.imageMode : imageModes[0]));
    /* Same contract as setVideoMode / setTextMode: the wired pictures decide
       which modes can be entered (see IMAGE_INPUT_RULES). */
    const setImageMode = (mode) => {
      if (imageModes.indexOf(mode) < 0 || mode === imageMode.value) return;
      const reason = imageModeReason(mode);
      if (reason) {
        NS.api?.toast?.("warning", t("wire.modeUnavailable"), reason);
        return;
      }
      patch({ imageMode: mode });
    };
    const sizePresets = [
      { value: "512x512", label: "512×512" },
      { value: "512x768", label: "512×768" },
      { value: "768x512", label: "768×512" },
      { value: "768x768", label: "768×768" },
      { value: "1024x1024", label: "1024×1024" },
      { value: "1024x576", label: "1024×576" },
      { value: "1280x720", label: "1280×720" },
      { value: "1920x1080", label: "1920×1080" },
    ];
    const sizeValue = computed(() => (data.width || 512) + "x" + (data.height || 512));
    const setSize = (value) => {
      const [w, h] = String(value).split("x").map(Number);
      if (w > 0 && h > 0) patch({ width: w, height: h });
    };
    /* ---- video-generator panel data (reference video node layout) ----
       Only the VIDEO generator uses the four-mode / wired-assets panel;
       image & audio generators keep the original compact panel. */
    const isGenVideo = computed(() => isGen.value && kind.value === "video");
    const videoModes = VIDEO_MODES;
    const videoMode = computed(() => data.videoMode || "cat.textToVideo");
    /* Switching mode NEVER touches wires. Availability is decided by the
       assets already wired in (modeAvailable), and the tab UI disables the
       modes that don't fit. This guard only back-stops programmatic calls. */
    const setVideoMode = (mode) => {
      if (!modeAvailable(mode)) {
        NS.api?.toast?.("warning", t("wire.modeUnavailable"), modeReason(mode));
        return;
      }
      patch({ videoMode: mode });
    };
    /* Assets wired into ANY generator: follow incoming edges live so the
       thumbnail row updates when the user connects/disconnects a source.
       Shared by the video, image and audio panels — the text generator takes
       no media at all, and a wired text node is a PROMPT, never an asset. */
    const incomingAssets = computed(() => {
      if (!isGen.value && !isGenText.value) return [];
      const nodes = NS.flow?.nodesOf?.() || [];
      const edges = NS.flow?.edgesOf?.() || [];
      const out = [];
      /* Per-kind running counters so each slot gets a label like 图片1 /
         视频1 / 音频1 — the same kind increments independently in wire order. */
      const counters = {};
      for (const edge of edges) {
        if (edge.target !== props.id) continue;
        const src = nodes.find((n) => n.id === edge.source);
        if (!src) continue;
        /* Text nodes supply the PROMPT, not a media asset — never show them
           in the wired-assets row nor count them as an asset. LoRA stacks are
           MODEL modifiers, not assets either: they never take a slot. */
        const assetKind = assetKindOf(src);
        if (assetKind === "text" || assetKind === "lora") continue;
        /* The generator echoes its result on itself (data.result); there is no separate
           result node. That echoed image can also feed a downstream generator — read both. */
        const asset = src.data?.asset || src.data?.result;
        const url = asset ? (asset.url || NS.api?.viewUrl?.(asset) || "") : "";
        const kind = src.data?.kind || asset?.kind || "image";
        counters[kind] = (counters[kind] || 0) + 1;
        const cn = KIND_CN[kind] || { label: "wire.asset" };
        out.push({
          id: src.id,
          kind,
          name: asset?.name || asset?.filename || src.data?.title || "wire.asset",
          /* The @ reference label is stored in the prompt as plain text, so it
             follows the UI language at insert time: 图片1 / 视频1 in Chinese,
             Image1 / Video1 in English. The parser accepts both spellings. */
          label: t(cn.label) + counters[kind],   // 图片1 / 视频1 / Image1 / Video1
          url,
        });
      }
      return out;
    });
    /* ---- mode availability: WIRED ASSETS are the cause, SELECTABLE MODES
       the effect (never the reverse). A mode is selectable only when it can
       accommodate every asset currently feeding this node. Returns "" when
       selectable, otherwise a human-readable reason for the disabled tab. */
    const modeReason = (mode) => {
      const counts = {};
      for (const a of incomingAssets.value) counts[a.kind] = (counts[a.kind] || 0) + 1;
      return modeReasonFor(mode, counts);
    };
    const modeAvailable = (mode) => !modeReason(mode);
    /* Same contract for the image generator: 图像编辑 / 图像放大 / 背景移除 all
       consume an input picture (so they are locked until one is wired), and
       the two single-image modes go dark once a SECOND picture arrives. */
    const imageModeReason = (mode) => {
      const counts = {};
      for (const a of incomingAssets.value) counts[a.kind] = (counts[a.kind] || 0) + 1;
      return modeReasonFor(mode, counts, IMAGE_INPUT_RULES,
        (badKind, target) => t("wire.doesNotAccept", { target: t(target), bad: t(KIND_CN[badKind]?.label || "wire.mediaAsset") }));
    };
    const imageModeAvailable = (mode) => !imageModeReason(mode);
    /* Text generator: LLM reads pictures + ONE video, 语音转录 exactly one
       audio clip. The two families never coexist, so the deny text names the
       wire that has to be cut first. */
    const textModeReason = (mode) => {
      const counts = {};
      for (const a of incomingAssets.value) counts[a.kind] = (counts[a.kind] || 0) + 1;
      return modeReasonFor(mode, counts, TEXT_INPUT_RULES, (badKind, target) => (target === "cat.speechToText"
        ? "wire.speechTextHandlesAudioOnly"
        : t("wire.doesNotAccept", { target: t("cat.llmChat"), bad: t(KIND_CN[badKind]?.label || badKind) })));
    };
    const textModeAvailable = (mode) => !textModeReason(mode);
    /* Wired-assets row is mode-driven, for EVERY generator that can take
       media. Which table applies follows the node kind:
         - a null entry follows the actual wires (视频 参考生视频 / 图像编辑 /
           LLM);
         - an empty entry means the mode takes no media at all (文生视频 /
           文生图 / 文生音乐 / 语音合成), so the whole row disappears;
         - the rest pin fixed slots, filled from wired assets IN ORDER.
       Each slot: { key, kind, asset|null }. */
    const assetSlots = computed(() => {
      if (!isGen.value && !isGenText.value) return [];
      /* Universal generator: show every wired MEDIA asset as a slot, in wire
         order — it has no mode table, so follow the wires like 参考生视频. */
      if (isGenOmni.value) {
        return incomingAssets.value.map((a) => ({ key: a.id, kind: a.kind, asset: a }));
      }
      const mode = isGenImage.value ? imageMode.value
        : isGenAudio.value ? audioMode.value
          : isGenVideo.value ? videoMode.value
            : isGenText.value ? textMode.value : "";
      const table = isGenImage.value ? IMAGE_MODE_ASSET_SLOTS
        : isGenAudio.value ? AUDIO_MODE_ASSET_SLOTS
          : isGenVideo.value ? MODE_ASSET_SLOTS
            : isGenText.value ? TEXT_MODE_ASSET_SLOTS : null;
      if (!table || !(mode in table)) return [];
      const incoming = incomingAssets.value.slice();
      const template = table[mode];
      const slots = [];
      if (template === null) {
        /* Follow the wires: every wired MEDIA asset (image/video/audio)
           becomes one slot, in wire order. */
        incoming.forEach((a) => slots.push({ key: a.id, kind: a.kind, asset: a }));
      } else {
        /* Fixed image slots (图生视频 1 / 首尾帧视频 2 / 文生视频 0) filled from
           wired images in order. Text is a prompt, never a slot. */
        const used = new Set();
        template.forEach((slot, i) => {
          const idx = incoming.findIndex((a) => a.kind === slot.kind && !used.has(a.id));
          if (idx >= 0) {
            used.add(incoming[idx].id);
            slots.push({ key: incoming[idx].id, kind: slot.kind, asset: incoming[idx] });
          } else {
            slots.push({ key: "slot" + i, kind: slot.kind, asset: null });
          }
        });
      }
      return slots;
    });
    /* Slot titles / hover preview now live in the shared MediaSlots component
       (one instance per panel), so an empty slot and a filled one look and
       behave identically on the video, image and audio generators. */
    /* Kick off offscreen thumbnail extraction for any newly wired video. */
    watch(incomingAssets, (assets) => {
      for (const a of assets) if (a.kind === "video" && a.url) ensureVideoThumb(a.url);
    }, { immediate: true });

    /* ---- AUDIO generator panel: 4 modes / TWO prompt areas / API bar ----
       The audio generator has a different shape from image & video:
          文生音乐 / 音乐翻唱  → 提示词 + 歌词
          语音合成 / 语音克隆  → 语气   + 朗读文本
       The bottom bar is [API ▾] on the LEFT and, on the RIGHT, widgets built
       from the workflow's EXPOSED FIELDS — the very list the API 配置 dialog
       edits (<name>.fields.json), read through
       GET /infcanvas/workflows/{name}/fields.
       Each text area is bound to the matching exposed TEXT field (keyword
       match first, remaining fields in wire order) and the pair is stored in
       `audioMap`, so js/infcanvas-core.js can write both values — plus every
       right-hand widget — into the workflow's REAL node inputs at run time.
       Templates that carry no {{placeholders}} (MiniMax music, voice design)
       therefore still receive what the user typed. */
    /* AUDIO_MODES / AUDIO_INPUT_RULES live at module level: the same table
       gates the tabs here and the wires in onConnect. */
    const audioModes = AUDIO_MODES;
    const isGenAudio = computed(() => isGen.value && kind.value === "audio");
    const audioMode = computed(() => (AUDIO_MODES.indexOf(data.audioMode) >= 0
      ? data.audioMode : AUDIO_MODES[0]));
    const audioFamily = computed(() => (isMusicMode(audioMode.value) ? "music" : "voice"));
    /* Wired inputs of the audio generator: audio clips (max 1) and text nodes
       (prompts). Read straight from the edge store so the tabs react the
       moment a wire is added or removed. */
    const audioWired = computed(() => {
      const out = { audio: [], text: [] };
      if (!isGenAudio.value) return out;
      const nodes = NS.flow?.nodesOf?.() || [];
      const edges = NS.flow?.edgesOf?.() || [];
      const seen = new Set();
      for (const edge of edges) {
        if (edge.target !== props.id || seen.has(edge.source)) continue;
        seen.add(edge.source);
        const src = nodes.find((n) => n.id === edge.source);
        const srcKind = assetKindOf(src);
        if (srcKind === "audio") out.audio.push(src);
        else if (srcKind === "text") out.text.push(src);
      }
      return out;
    });
    const wiredAudio = computed(() => audioWired.value.audio);
    const wiredTextNodes = computed(() => audioWired.value.text);
    /* One box <=> one wire: the FIRST area (提示词 / 语气) shows the text of
       its own wire only — wire #0 fills box #0. Extra wires (other text
       boxes) no longer pile into this one, so the placeholder must not join
       them any more. Generation uses the same per-box mapping. */
    const wiredText = computed(() => {
      const first = wiredTextNodes.value[0];
      return first ? String(first.data?.text || "").trim() : "";
    });
    const audioCounts = computed(() => (wiredAudio.value.length ? { audio: wiredAudio.value.length } : {}));
    const audioModeReason = (mode) => modeReasonFor(mode, audioCounts.value, AUDIO_INPUT_RULES,
      (badKind, target) => (badKind === "audio"
        ? t("core.doesNotAcceptAudioSwitch", { target })
        : t("wire.doesNotAccept", { target: t(target), bad: t(KIND_CN[badKind]?.label || "wire.mediaAsset") })));
    const audioModeAvailable = (mode) => !audioModeReason(mode);
    const setAudioMode = (mode) => {
      if (AUDIO_MODES.indexOf(mode) < 0 || mode === audioMode.value) return;
      const reason = audioModeReason(mode);
      if (reason) {
        NS.api?.toast?.("warning", t("wire.modeUnavailable"), reason);
        return;
      }
      patch({ audioMode: mode });
    };
    const audioSlots = computed(() => (audioFamily.value === "music"
      ? {
        a: { label: "field.prompt", ph: "prompt.describeMusic" },
        b: { label: "prompt.lyrics", ph: "prompt.writeLyricsLineLineUse" },
      }
      : {
        a: { label: "prompt.toneVoice", ph: "prompt.describeTone" },
        b: { label: "prompt.textRead", ph: "prompt.enterTextReadAloud" },
      }));

    /* ---- top-level group tabs (2026-11-22) ----
       Each generator shows only its own groups: image=图像/图像工具, video=视频/视频工具,
       audio=音乐/音频, text=LLM (one group, row not rendered). A group or mode with
       NO workflow in the live backend list is hidden outright (not greyed): an
       empty category cannot lead to a runnable prompt. Wire-based availability
       still greys out tabs/modes that DO have a workflow but do not fit the
       current assets. Clicking a top group sets mode to that group's first
       workflow-backed mode, avoiding "show group A, run workflow B". */
    /* 2026-11-24: mode tabs are keyed by the FINE subCategory (cat.*), while
       `category` is now the 7-group top level used by the API dialog / omni. */
    const workflowCategories = computed(() => new Set(
      wfList.value.map((item) => item && item.subCategory).filter(Boolean)
    ));
    const hasWorkflowCategory = (cat) => !!cat && workflowCategories.value.has(cat);
    const topGroups = computed(() => MODE_TOP_GROUPS[kind.value] || []);
    const modesWithWorkflow = (group) =>
      (TOP_GROUP_MODES[group] || []).filter(hasWorkflowCategory);
    const visibleTopGroups = computed(() => topGroups.value.filter(
      (group) => modesWithWorkflow(group).length > 0
    ));
    const activeMode = computed(() => kind.value === "video" ? videoMode.value
      : kind.value === "audio" ? audioMode.value
        : kind.value === "text" ? textMode.value : imageMode.value);
    /* Distinct name: `modeField` below is the field-card mode chooser ref. */
    const topModeField = computed(() => kind.value === "video" ? "videoMode"
      : kind.value === "audio" ? "audioMode"
        : kind.value === "text" ? "textMode" : "imageMode");
    const topTab = ref(visibleTopGroups.value[0] || topGroups.value[0] || "");
    watch(activeMode, (m) => {
      const g = TOP_OF_MODE[m];
      if (g && visibleTopGroups.value.indexOf(g) >= 0 && g !== topTab.value) topTab.value = g;
    }, { immediate: true });
    /* Top-level tab row is hidden (2026-11-24): the mode row now shows ALL
       fine modes backed by a workflow for this node kind, across its groups. */
    const topModes = computed(() => {
      const out = [];
      for (const group of topGroups.value) {
        for (const mode of modesWithWorkflow(group)) if (!out.includes(mode)) out.push(mode);
      }
      return out;
    });
    /* Workflows arrive asynchronously. Once the list lands (or changes), move
       off a hidden group/mode silently so the visible tabs always own the run. */
    watch(visibleTopGroups, (groups) => {
      if (groups.length && groups.indexOf(topTab.value) < 0) topTab.value = groups[0];
    }, { immediate: true });
    watch(topModes, (modes) => {
      if (modes.length && modes.indexOf(activeMode.value) < 0) {
        patch({ [topModeField.value]: modes[0] }, { silent: true });
      }
    }, { immediate: true });
    /* A top group is available if any second-level mode in it is available — never by
       the group name alone. Typical: a video node with 1 video + 1 image wired; 参考生视频
       still accepts both, but 视频工具's 插帧/编辑/放大 each take exactly 1 video and no
       image. With no usable mode the entire group must grey out, or the user only sees a
       row of disabled modes. Distinguish this from an available group whose "first" mode
       is not (empty node + 视频组 → 参考生视频 lacks material): that still allows entry,
       with is-on + is-disabled hinting what is missing. */
    const modeReasonOf = (mode) => kind.value === "video" ? modeReason(mode)
      : kind.value === "image" ? imageModeReason(mode)
        : kind.value === "audio" ? audioModeReason(mode)
          : textModeReason(mode);
    const topGroupReason = (group) => {
      const modes = modesWithWorkflow(group);
      if (!modes.length) return t("wire.currentAssetsDoNotFit");
      const reasons = modes.map(modeReasonOf).filter(Boolean);
      if (reasons.length < modes.length) return "";
      return reasons[0] || t("wire.currentAssetsDoNotFit");
    };
    const topGroupAvailable = (group) => !topGroupReason(group);
    const setTopTab = (group) => {
      if (visibleTopGroups.value.indexOf(group) < 0 || group === topTab.value) return;
      const blocked = topGroupReason(group);
      if (blocked) {
        NS.api?.toast?.("warning", t("wire.groupUnavailable"), blocked);
        return;
      }
      topTab.value = group;
      const target = modesWithWorkflow(group)[0];
      if (!target || target === activeMode.value) return;
      patch({ [topModeField.value]: target });
    };
    /* ---- exposed API fields (the workflow's own parameters) ---- */
    const BAR_FIELD_TYPES = { number: 1, slider: 1, random: 1, select: 1, switch: 1, text: 1, textarea: 1 };
    const apiFields = ref([]);
    const fieldId = (field) => String(field?.nodeId || "") + ":" + String(field?.key || "");
    const apiValues = computed(() => data.apiValues || {});
    /* Literal {{prompt}} / {{text}} templates do not expose a prompt row in
       fields.json. The backend reports them once with the field list; keep
       that bit on the node (inside fieldSnapshot) so a finished node freezes
       both halves of the prompt entry, not just the exposed rows. */
    const promptSlot = ref(false);
    /* While there is no workflow category, block loadApiFields from writing fields back.
       A category switch makes adoptDefaultWorkflow patch data.workflow, retriggering the watch
       and loadApiFields; clearing once in noWorkflow watch lets the refill restore old fields. */
    const fieldsSuppressed = ref(false);
    const fieldValue = (field) => {
      const stored = apiValues.value[fieldId(field)];
      return stored === undefined || stored === null ? (field?.default ?? "") : stored;
    };
    const setFieldValue = (field, value) => {
      if (!field) return;
      patch({ apiValues: { ...apiValues.value, [fieldId(field)]: value } });
    };
    /* Every exposed multiline-text field gets its OWN area on the node, in
       the exact order the workflow exposes them — no name lock, so a field
       called 风格描述 / 歌词 / anything else still renders with its own name
       above the box. The FIRST area stays the node's rich `prompt` slot (wired
       text nodes, @mention chips, core's promptMap); the SECOND one on audio
       stays `lyrics` (core's audioMap.b); every other area reads/writes
       apiValues keyed by field id, which core already writes into the real
       workflow input at run time. */
    /* Only multiline fields are connectable text boxes. Single-line `text`
       fields are ordinary parameters and stay in the bottom parameter bar. */
    const isTextField = (field) => field?.type === "textarea";
    const promptTextFields = computed(() => apiFields.value.filter(isTextField));
    const promptField = computed(() => promptTextFields.value[0] || null);
    const audioFieldSlots = computed(() => ({
      a: promptTextFields.value[0] || null,
      b: promptTextFields.value[1] || null,
    }));
    /* First two slots keep the node's own values so wired text and core's
       applyNodeInputs keep working unchanged; the rest live in apiValues. */
    const textAreaValue = (field, i) => {
      if (i === 0) return data.prompt ?? "";
      if (i === 1 && isGenAudio.value) return data.lyrics ?? "";
      return fieldValue(field);
    };
    const setTextArea = (field, i, value) => {
      if (i === 0) return setField("prompt", value);
      if (i === 1 && isGenAudio.value) return setField("lyrics", value);
      return setFieldValue(field, value);
    };
    /* The field's own label wins (a renamed field must keep working); only
       an unlabelled field falls back to the built-in slot name. */
    const textAreaLabel = (field, i) => {
      /* Node-surface labels may be i18n keys (field.*); translate them so a
         bare key never leaks onto the canvas. Literal/user-authored labels
         pass through. Inlined here because fieldLabelText is injected later
         (useFieldControls below) and would hit a TDZ at definition time. */
      const raw = String(field?.label || "").trim();
      const label = raw.startsWith("field.") ? t(raw) : raw;
      return label || (i === 1 && isGenAudio.value ? t(audioSlots.value.b.label)
        : i === 0 ? t(audioSlots.value.a.label) : "");
    };
    /* One source of truth for the on-screen text areas. A workflow takes
       prompts either through an exposed text field bound to an area or
       through a literal placeholder in the template. With neither, drawing
       a box would promise an input the workflow cannot receive. */
    const hasPromptArea = computed(() => promptTextFields.value.length > 0 || promptSlot.value);

    /* ---- one box <=> one wire: per-box occupancy & disabled state --------
       The wire #i (in connection order) owns text box #i — EXACTLY the mapping
       effectiveTextData uses at run time (wired[i] -> fields[i]). A wired box
       is disabled (its content comes from the wire, not from typing). A box is
       ALSO disabled when it is only a placeholder: no workflow in this
       category, or the picked workflow exposes no multiline text input.
       `wiredTextSources` dedupes by resolved source, mirroring the connect
       gate and the compiler, so the UI and generation never disagree. */
    const textWires = computed(() => {
      if (!isGen.value) return [];
      const nodes = NS.flow?.nodesOf?.() || [];
      const edges = NS.flow?.edgesOf?.() || [];
      return wiredTextSources(props.id, edges, nodes);
    });
    /* Number of real boxes. A legacy {{prompt}} template exposes no field but
       still has one implicit box, so never render fewer than one. */
    const boxCount = computed(() => Math.max(1, promptTextFields.value.length));
    const noTextWorkflow = computed(() => noWorkflow.value || (!promptTextFields.value.length && !promptSlot.value));
    /* Box #i (0-based, top to bottom): the wired source that owns it, if any. */
    const boxWiredAt = (i) => textWires.value[i] || null;
    const boxDisabledAt = (i) => !!boxWiredAt(i) || noTextWorkflow.value;
    const wiredTextAt = (i) => {
      const src = boxWiredAt(i);
      if (!src) return "";
      const d = src.data || {};
      /* Mirrors collectInputs: text may live on data.text, the result payload,
         or (for asset-style text nodes) on data.asset.text / .name. */
      return String(d.text || d.result?.text || d.asset?.text || d.asset?.name || "").trim();
    };
    /* All exposed text fields live on the node surface as their own boxes;
       none of them belongs in the settings popover. */
    const apiBarFields = computed(() => {
      const skip = new Set(promptTextFields.value.map(fieldId));
      return apiFields.value.filter((field) => !skip.has(fieldId(field)) && BAR_FIELD_TYPES[field.type]);
    });
    /* Advanced vs basic: ComfyUI folds everything a node does not need for a
       first run behind its footer toggle (nodeFooter's showAdvanced). The
       split is decided where the parameter is EXPOSED — the「高级」checkbox in
       API 配置 (fields.json `advanced`) — and only falls back to this label
       table for files written before that flag existed. 提示词 is in the list
       even though its row lives in the node's own text area: the label keeps a
       manually re-exposed prompt out of the advanced bucket. */
    const BASIC_LABELS = [
      "field.promptEnhancement", "field.prompt", "field.aspectRatio", "field.megapixels", "field.upscaleFactor", "field.seed",
      "Prompt", "Style", "Lyrics", "Caption",
      "Aspect Ratio", "Megapixels", "Multiple", "Width", "Height", "Seed",
    ];
    const isAdvancedField = (field) => (typeof field?.advanced === "boolean"
      ? field.advanced
      : !BASIC_LABELS.includes(String(field?.label || "").trim()));
    const advancedCount = computed(() => apiBarFields.value.filter(isAdvancedField).length);
    const visibleBarFields = computed(() => (data.showAdvanced
      ? apiBarFields.value
      : apiBarFields.value.filter((field) => !isAdvancedField(field))));
    /* Per node, like ComfyUI's node.showAdvanced: collapsed by default. */
    const toggleAdvanced = () => patch({ showAdvanced: !data.showAdvanced });

    /* ---- settings popover: the exposed API parameters -------------------
       Rendering every parameter inline turned the 30px bar into a wrapping
       mess on a workflow with 6+ params (and squeezed the API selector), so
       they now sit behind a gear button. Each row is a port of ComfyUI's
       Nodes 2.0 widget line, which is what the user pointed at:
         WidgetLayoutField  label left (muted, truncated), control right;
         ScrubableNumberInput  − value [control badge] + inside one bg-input
                            pill; a bg-primary/15 fill behind them when the
                            range is small enough to draw one;
         Switch             36×20 track + 16px thumb, bg-primary when on. */
    /* A value edit re-renders the node, which can recreate this component's
       subtree -- the open flag therefore lives outside the instance, keyed by
       node id, so the card does not slam shut under the pointer. */
    const cardUi = (NS.icCardUi = NS.icCardUi || new Map());
    const setOpen = ref(!!(cardUi.get(props.id) || {}).open);
    watch(setOpen, (open) => {
      cardUi.set(props.id, { ...(cardUi.get(props.id) || {}), open });
    });
    /* The card is 348px wide and hangs off the gear, which now sits to the
       right of the API picker: aligning the card's left edge to the gear would
       push it past the node. Anchor it to the gear, then slide it back inside
       the node (8px inset) whenever it would overflow. */
    const popStyle = ref({});
    const placePop = (event) => {
      const gear = event?.currentTarget;
      const wrap = gear?.parentElement;
      /* Measure against the generator panel (460/520px), not the node card:
         the panel hangs below the node and is wider than it. */
      const box = wrap?.closest?.(".icn__genpanel") || wrap?.closest?.(".icn");
      if (!wrap || !box) return;
      const rr = box.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const scale = box.offsetWidth ? rr.width / box.offsetWidth : 1;
      const boxW = box.offsetWidth;
      const CARD_W = 348;
      const gearLeft = (wr.left - rr.left) / scale;
      let left = gearLeft;
      if (left + CARD_W > boxW - 8) left = boxW - 8 - CARD_W;
      if (left < 8) left = 8;
      popStyle.value = { left: Math.round(left - gearLeft) + "px" };
      /* Vertical: the card is CSS-anchored bottom:calc(100%+8px) (opens upward
         by default). Judge from the VIEWPORT like every other popover: flip it
         below the gear when the upward card would cross the window top and
         there is more room below. Because the card is NOT inverse-scaled, its
         rect height is screen px; convert back to node-local for `top`. */
      nextTick(() => {
        const el = box.querySelector(".icn__gpa-pop");
        if (!el) return;
        const ar = gear.getBoundingClientRect();
        const side = pickMenuSide(ar, el.getBoundingClientRect(), "up");
        const prev = popStyle.value;
        popStyle.value = side === "down"
          ? { ...prev, top: Math.round((ar.bottom - wr.top) / scale + MENU_GAP) + "px", bottom: "auto" }
          : { ...prev, top: "", bottom: "" }; /* empty = fall back to CSS bottom */
      });
    };
    const toggleSet = (event) => {
      if (noWorkflow.value) return;
      setOpen.value = !setOpen.value;
      if (setOpen.value) {
        selOpen.value = null;
        placePop(event);
      }
      closeModes();
    };
    /* A field has the value-control badge because it IS a 随机数 -- the API
       config dialog exposes 种子 with type "random" (随机数). Nothing here
       keys off a widget name; a plain number stays a plain number. */
    const isRandomField = (field) => field?.type === "random";

    /* ---- value control: ValueControlButton + ValueControlPopover ---------
       The badge is NOT a "randomize now" button. It picks what happens to the
       value each time the workflow runs, exactly like the host. Modes and
       wording are copied from packages/design-system/button.variants.ts +
       locales/zh/main.json:
         固定值  数值不变                    fixed
         递增值  数值+1或切换到下一个选项     increment
         递减值  数值-1或切换到上一个选项     decrement
         随机值  每次运行后随机化该值        randomize */
    const CONTROL_MODES = [
      { mode: "fixed", icon: "pencil-off", title: t("prompt.fixed"), desc: t("prompt.valueUnchanged") },
      { mode: "increment", text: "+1", title: t("prompt.increment"), desc: t("prompt.value1MoveNextOption") },
      { mode: "decrement", text: "-1", title: t("prompt.decrement"), desc: t("prompt.value1MovePreviousOption") },
      { mode: "randomize", icon: "shuffle", title: t("prompt.randomize"), desc: t("prompt.randomizeValueAfterEachRun") },
    ];
    /* Host default: addValueControlWidget(..., 'randomize'). */
    /* A mode picked on the node wins; otherwise fall back to the mode configured
       on the field in the API dialog, then to the host default. This is what
       makes a configured 固定值/递增/递减 actually show on a fresh node. */
    const fieldMode = (field) => (data.fieldModes || {})[fieldId(field)]
      || field?.controlMode || "randomize";
    const modeTitle = (field) => {
      const mode = fieldMode(field);
      const entry = CONTROL_MODES.find((item) => item.mode === mode);
      return entry ? entry.title + t("prompt.clickChangeMode") : t("prompt.clickChangeControlMode");
    };
    const setFieldMode = (field, mode) => patch({
      fieldModes: { ...(data.fieldModes || {}), [fieldId(field)]: mode },
    });
    const modeOpen = ref("");
    const modeField = ref(null);
    const modeStyle = ref({});
    const closeModes = () => { modeOpen.value = ""; modeField.value = null; };
    /* The chooser is a child of .icn__gpa-pop now, like the field list: the
       panel inverse-scales as a whole, so all offsets here are card CSS px
       (1:1 with screen px) and no zoom re-anchoring is needed. */
    const openModes = (field, event) => {
      const badge = event?.currentTarget;
      const card = badge?.closest(".icn__gpa-pop");
      if (!badge || !card) return;
      if (modeOpen.value === fieldId(field)) { closeModes(); return; }
      selOpen.value = null;
      modeField.value = field;
      modeOpen.value = fieldId(field);
      nextTick(() => {
        const el = card.querySelector(".icn__gpa-modes");
        if (!el) return; /* closed or not mounted yet */
        /* Re-measure on every open: the panel's .14s reveal can still run. */
        const cr = card.getBoundingClientRect();
        const br = badge.getBoundingClientRect();
        const mr = el.getBoundingClientRect();
        const k = cr.height ? card.offsetHeight / cr.height : 1;
        /* Inline right/top are relative to the card's PADDING box. */
        const bx = card.clientLeft || 0, by = card.clientTop || 0;
        const badgeTop = (br.top - cr.top) * k - by;
        const h = mr.height * k;
        /* Flip above the badge if opening down would cross the window. */
        const side = pickMenuSide(br, mr);
        let top = side === "up" ? badgeTop - 6 - h : badgeTop;
        if (side === "down") {
          const maxTop = card.clientHeight - 6 - h;
          if (top > maxTop) top = maxTop;
          if (top < 0) top = -6 - h;
        }
        /* Final window clamp, converted screen px -> card CSS px. */
        const menuScreenTop = cr.top + (by + top) / k;
        if (menuScreenTop < 8) top += (8 - menuScreenTop) * k;
        const over = menuScreenTop + mr.height - (window.innerHeight - 8);
        if (over > 0) top -= over * k;
        /* Stretch to the card's BORDER box. Do NOT read offsetWidth here:
           on the opening tick the card is still 348px before popStyle widens
           it to 600px. left+right+width:auto tracks the final layout instead. */
        modeStyle.value = {
          left: -bx + "px",
          right: -bx + "px",
          top: Math.round(top) + "px",
          width: "auto",
        };
      });
    };
    const pickMode = (mode) => {
      if (modeField.value) setFieldMode(modeField.value, mode);
      closeModes();
    };
    const syncAudioMap = () => {
      if (!isGenAudio.value) return;
      const slots = audioFieldSlots.value;
      const next = {};
      if (slots.a) next.a = fieldId(slots.a);
      if (slots.b) next.b = fieldId(slots.b);
      const prev = data.audioMap || {};
      if (prev.a === next.a && prev.b === next.b) return;
      /* Derived wiring, not a user edit — keep it out of the undo stack. */
      patch({ audioMap: next }, { silent: true });
    };
    /* Bind the panel's text area to the exposed prompt field (image / video /
       text generators). Stored on the node so core can write the typed text —
       and any wired text node — into the workflow's REAL input: these
       templates carry no {{placeholders}}, so nothing else would deliver it. */
    const syncPromptMap = () => {
      const next = promptField.value ? fieldId(promptField.value) : "";
      if ((data.promptMap || "") !== next) patch({ promptMap: next }, { silent: true });
      /* Text an older build let the user type into the gear row is migrated
         into the prompt area once, so hiding that row drops nothing. */
      const stored = next ? (data.apiValues || {})[next] : undefined;
      if (typeof stored === "string" && stored.trim() && !String(data.prompt || "").trim()) {
        patch({ prompt: stored, promptEdited: true }, { silent: true });
      }
    };
    /* Show the API workflow config's default prompt in the prompt box. The field list
       follows the template live, and so do already-produced nodes: a template default
       change is written in on the next fetch. Never overwrite text the user typed —
       promptEdited is set by setField("prompt"); {{prompt}} templates expose no field. */
    const seedPromptDefault = () => {
      if (data.promptEdited) return;
      const field = isGenAudio.value ? audioFieldSlots.value.a : promptField.value;
      if (!field || field.default === undefined || field.default === null) return;
      const def = String(field.default);
      if (def && def !== String(data.prompt || "")) patch({ prompt: def }, { silent: true });
    };
    /* ---- parameter snapshot (live mirror, not frozen) -------------------
       The API config edits the template; nodes follow live: saving it (workflows-changed)
       makes loadApiFields refetch, syncing row changes, default changes and advanced
       grouping to every referencing node, produced or not. data.fieldSnapshot is only the
       latest fetched mirror, used at runtime (core cannot read fields.json) for required
       checks / defaults / stale-mapping relocation — no longer a frozen parameter set.
       Renaming a workflow leaves fields intact; renameWorkflowRefs repoints the mirror's
       workflow/name. Deleting is separate (see frozenWf — that only keeps the current
       selection visible in the dropdown, unrelated to parameter freezing). */
    /* Value-control ranges travel with the node because the run loop (core)
       has no access to fields.json. Kept as a separate write so both the
       fresh fetch and the frozen snapshot path feed it identically. */
    const syncFieldSpecs = (list) => {
      const specs = {};
      for (const field of list) {
        if (isRandomField(field)) {
          specs[fieldId(field)] = {
            min: field.min, max: field.max, step: field.step, default: field.default,
            /* The API-config dialog persists the chosen seed mode on the field
               (fields.json). Carry it onto the node so the run loop -- which has
               no access to fields.json -- can honour a configured fixed /
               increment / decrement mode, not just an ad-hoc fieldModes pick. */
            controlMode: field.controlMode || "randomize",
          };
        }
      }
      const prevSpecs = data.fieldSpecs || {};
      if (JSON.stringify(specs) !== JSON.stringify(prevSpecs)) {
        patch({ fieldSpecs: specs }, { silent: true });
      }
    };
    let fieldsToken = 0;
    const loadApiFields = async () => {
      if (fieldsSuppressed.value) { apiFields.value = []; promptSlot.value = false; return; }
      if (!isGen.value && !isGenText.value) { apiFields.value = []; return; }
      const name = data.workflow || kind.value;
      /* The field list follows the template live, no longer frozen: every render refetches
         the current fields regardless of whether the node produced a result. Saving the
         API config dispatches infcanvas:workflows-changed; the node re-runs on it, so a
         template edit updates all referencing nodes. data.fieldSnapshot degrades to a
         "latest fetched mirror" for runtime required checks / defaults / stale-mapping
         relocation — no longer a frozen snapshot of the parameter set. */
      const token = ++fieldsToken;
      let list = [];
      let slot = false;
      try {
        const res = await NS.backend?.call?.("/workflows/" + encodeURIComponent(name) + "/fields");
        list = Array.isArray(res?.fields) ? res.fields.filter((f) => f && f.nodeId && f.key) : [];
        slot = Boolean(res?.prompt_placeholder);
      } catch (error) {
        /* Route missing (un-restarted ComfyUI) or no fields file: the node's
           own inputs keep working through the {{prompt}} placeholders. */
        list = [];
      }
      if (token !== fieldsToken || fieldsSuppressed.value) return;
      apiFields.value = list;
      promptSlot.value = slot;
      syncFieldSpecs(list);
      /* Freeze what this node was configured with. Written on EVERY fetch so
         the last look at the template before the first result is the one that
         sticks — and so a never-run node keeps overwriting it with the newest
         config until it actually produces something. */
      const snapName = (() => {
        const hit = SHARED_WF_LIST.value.find((w) => w.id === name);
        return hit ? (hit.name || hit.id) : name;
      })();
      const prevSnap = data.fieldSnapshot;
      if (!prevSnap || prevSnap.workflow !== name
        || JSON.stringify(prevSnap.list) !== JSON.stringify(list)
        || prevSnap.name !== snapName || Boolean(prevSnap.promptSlot) !== slot) {
        patch({ fieldSnapshot: { workflow: name, name: snapName, promptSlot: slot, list } }, { silent: true });
      }
      syncAudioMap();
      syncPromptMap();
      seedPromptDefault();
    };
    watch([() => data.workflow, isGenText], () => { loadApiFields(); }, { immediate: true });
    watch(audioFamily, () => { syncAudioMap(); });
    const onWorkflowsChanged = () => { if (!noWorkflow.value) loadApiFields(); };
    onMounted(() => window.addEventListener("infcanvas:workflows-changed", onWorkflowsChanged));
    onBeforeUnmount(() => window.removeEventListener("infcanvas:workflows-changed", onWorkflowsChanged));

    /* ---- "@" quick reference (see flow-mention-editor.js) ----
       The whole editor (chips, caret, IME, hover preview) is now a composable;
       this node supplies its runtime inputs and re-exports the bindings the
       template uses. Deselect clean-up stays here because it also owns state
       that does not belong to the editor (workflow/settings/mode popovers). */
    const {
      promptEl, mention, mentionItems, closeMention, onPromptInput, hoverMention, pickMention, onPromptKeydown,
      refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut,
    } = usePromptMention({
      data,
      incomingAssets,
      isRich: computed(() => isGenVideo.value || isGenImage.value),
      setPrompt: (text) => setField("prompt", text),
      bindTip,
    });
    /* Deselecting hides the panel without firing mouseout on the chip. */
    watch(() => props.selected, (on) => {
      if (on) return;
      closeMention();
      refPreview.value = null;
      selOpen.value = null;
      setOpen.value = false;
      closeModes();
    });
    /* Keep the shared list loaded for the bottom-left selector; the API 配置
       dialog refreshes it through the same workflows-changed event. */
    loadWorkflows();
    /* ---- Nodes 2.0 select (ComfyUI src/components/ui/select) -----------
       A native <select> popup is painted by the OS and cannot be themed, so
       the trigger is a plain button and the list is our own popover:
         trigger  SelectTrigger size="md" — bg-secondary surface, rounded-lg,
                  bg-accent on hover/open, chevron-down in muted-foreground;
         content  SelectContent — bg-background #171718, rounded-lg, p-2,
                  8px below the trigger, border + shadow;
         item     SelectItem — rounded-sm, accent on hover, muted + check
                  when it is the current value.
       Only one list may be open; Escape / an outside press closes it. */
    const selOpen = ref(null);                       // "wf" | "size" | "gsize" | "f:nodeId:key"
    /* The exposed-parameter listbox is a child of .icn__gpa-pop: that card has
       no height cap and no overflow, and the whole generator panel is inverse-
       scaled, so the list is placed in card CSS px (1:1 with screen px). */
    const selStyle = ref({});
    /* Workflow picker menu: CSS puts it below the trigger (top:calc(100%+8px))
       with no inline style. When the node sits near the window bottom we set an
       inline local `top` that places it ABOVE instead (same screen-space flip
       as the other popovers). Cleared on every close so the CSS default comes
       back when there is room below again. */
    const wfMenuStyle = ref({});
    /* Shared search term for the two host select listboxes (workflow picker
       and API field dropdown). Only one is open at a time (selOpen is a single
       value), so one query + one search ref covers both — mirrors the LoRA
       picker below. */
    const selQuery = ref("");
    const selSearchEl = ref(null);
    const setSelSearchEl = (el) => { selSearchEl.value = el; };
    const toggleSel = (key, event) => {
      if (key === "wf" && noWorkflow.value) return;
      const wasOpen = selOpen.value === key;
      selOpen.value = wasOpen ? null : key;
      selQuery.value = "";
      wfMenuStyle.value = {};
      if (wasOpen) return;
      if (key === "wf") {
        /* The picker lives INSIDE .icn__genpanel, which already inverse-scales
           itself by 1/zoom. So CSS px inside .icn__selwrap map 1:1 to screen
           px — dividing by zoom (correct for node-root popovers) made the
           offset drift with the canvas zoom and with the panel's .14s open
           transition. Re-measure on EVERY call and derive the screen->local
           factor from the wrap itself, which also absorbs the transition. */
        const btn = event?.currentTarget;
        const wrap = btn?.parentElement;
        if (btn && wrap) {
          const place = () => {
            const menu = wrap.querySelector(".icn__selmenu");
            if (!menu) return; /* not mounted yet on the synchronous call */
            const wr = wrap.getBoundingClientRect();
            const ar = btn.getBoundingClientRect();
            const mr = menu.getBoundingClientRect();
            const k = wr.height ? wrap.offsetHeight / wr.height : 1;
            const side = pickMenuSide(ar, mr);
            wfMenuStyle.value = side === "up"
              ? { top: Math.round((ar.top - wr.top) * k - MENU_GAP - mr.height * k) + "px", bottom: "auto" }
              : { top: Math.round((ar.bottom - wr.top) * k + MENU_GAP) + "px", bottom: "auto" };
          };
          place();
          nextTick(place);
        }
      }
      if (String(key).indexOf("f:") === 0) {
        const rowEl = event?.currentTarget?.closest?.("[data-widget-name]");
        /* Anchor is the whole combobox (label + arrow) so either button lands
           the list at the same place. The list is now a child of the settings
           card, so all inline offsets are CARD CSS px, not node-local px. */
        const anchor = rowEl?.querySelector('[role="combobox"]')?.parentElement;
        const card = anchor?.closest(".icn__gpa-pop");
        if (!anchor || !card) return;
        const place = () => {
          const menu = card.querySelector(".icn__gpa-fsel");
          if (!menu) return; /* closed or not mounted yet: nothing to place */
          /* Re-measure every call (open + nextTick). The panel inverse-scales
             as a whole, so card CSS px are 1:1 with screen px; k absorbs the
             panel's .14s open transition when a press lands mid-animation. */
          const cr = card.getBoundingClientRect();
          const ar = anchor.getBoundingClientRect();
          const mr = menu.getBoundingClientRect();
          const k = cr.height ? card.offsetHeight / cr.height : 1;
          /* 2026-11-22 rule: API field dropdowns in the parameter panel always open
             Inline offsets are relative to the card's PADDING box, so subtract
             its 1px border or the list lands 1px low/right of the anchor. */
          const bx = card.clientLeft || 0, by = card.clientTop || 0;
          selStyle.value = {
            left: Math.round((ar.left - cr.left) * k - bx) + "px",
            top: Math.round((ar.top - cr.top) * k - by - 4 - mr.height * k) + "px",
            width: Math.round(ar.width * k) + "px",
          };
        };
        place();
        nextTick(place);
      }
      nextTick(() => selSearchEl.value?.focus?.());
    };
    const selField = computed(() => {
      const key = selOpen.value;
      if (!key || String(key).indexOf("f:") !== 0) return null;
      return apiFields.value.find((field) => "f:" + fieldId(field) === key) || null;
    });
    const filteredSelOptions = computed(() => {
      const opts = selField.value?.options || [];
      const q = String(selQuery.value || "").trim().toLowerCase();
      return q ? opts.filter((o) => String(o).toLowerCase().includes(q)) : opts;
    });
    const pickSel = (key, value) => {
      if (key === "wf") setField("workflow", value);
      else if (key === "size" || key === "gsize") setSize(value);
      else if (String(key).indexOf("f:") === 0) {
        /* API-exposed select: the key carries the field identity. */
        const target = apiFields.value.find((field) => "f:" + fieldId(field) === key);
        if (target) setFieldValue(target, value);
      }
      selOpen.value = null;
    };
    /* Workflows are tagged with a category in the API dialog. Each generator
       shows only the workflows matching its active mode: image -> 文生图/
       图像编辑/图像放大/背景移除, video -> the 4 video modes, audio -> the 4
       audio modes. */
    /* Universal node: user workflows are now grouped by the 7 TOP categories
       (their `category` field), shown as a single tab row. Legacy workflows
       whose category is still a fine cat.* value are folded into their top
       group so they remain reachable. */
    const omniCategories = computed(() => {
      const out = [];
      for (const w of wfList.value) {
        const c = w && w.category;
        if (!c) continue;
        const top = c.startsWith("group.") ? c : (TOP_OF_MODE[c] || "");
        if (top && Object.prototype.hasOwnProperty.call(MODE_TOP_GROUPS, top) && !out.includes(top)) out.push(top);
      }
      return out;
    });
    const omniCategory = ref("");
    watch(omniCategories, (list) => {
      if (list.length && list.indexOf(omniCategory.value) < 0) omniCategory.value = list[0];
    }, { immediate: true });
    const setOmniCategory = (cat) => {
      if (omniCategories.value.indexOf(cat) < 0 || cat === omniCategory.value) return;
      omniCategory.value = cat;
      const pool = wfList.value.filter((w) => w.category === cat);
      if (pool.length && (!data.workflow || !pool.some((w) => w.id === data.workflow))) {
        const def = pool.find((w) => w.is_default) || pool[0];
        if (def) patch({ workflow: def.id }, { silent: true });
      }
    };
    const activeCategory = computed(() => {
      if (isGenOmni.value) return omniCategory.value;
      if (isGenImage.value) return imageMode.value;
      if (isGenVideo.value) return videoMode.value;
      if (isGenAudio.value) return audioMode.value;
      if (isGenText.value) return textMode.value;
      return "";
    });
    const filteredWfList = computed(() => {
      const cat = activeCategory.value;
      if (!cat) return wfList.value;
      /* Generators filter by fine subCategory; omni (cat="") is handled below. */
      const field = isGenOmni.value ? "category" : "subCategory";
      return wfList.value.filter((w) => w[field] === cat);
    });
    /* A node that already produced something keeps pointing at its template
       even after that template is deleted: the API list is live and no longer
       contains it, so the option is put back from the node's own snapshot and
       pinned to the top of the menu. Never-run nodes just lose the option. */
    const frozenWf = computed(() => {
      const id = data.workflow || "";
      if (!id || !data.result) return null;
      if (wfList.value.some((w) => w.id === id)) return null;
      const snap = data.fieldSnapshot;
      const name = (snap && snap.workflow === id && snap.name) || id;
      return { id, name, category: activeCategory.value, is_default: false, missing: true };
    });
    const wfOptions = computed(() => {
      const frozen = frozenWf.value;
      const list = filteredWfList.value.filter((w) => !frozen || w.id !== frozen.id);
      return frozen ? [frozen, ...list] : list;
    });
    const filteredWfOptions = computed(() => {
      const list = wfOptions.value;
      const q = String(selQuery.value || "").trim().toLowerCase();
      return q ? list.filter((w) => String(w.name || w.id).toLowerCase().includes(q)) : list;
    });
    /* Empty category = the mode has no API at all. The picker itself becomes
       a static label (not an openable dropdown) and the settings gear is
       disabled: showing the previous mode's workflow here would be a lie, and
       its parameters have nothing to write into. A finished node keeps its
       own deleted-template option, so that case is not "no workflow". */
    const noWorkflow = computed(() => !!activeCategory.value && !wfOptions.value.length);
    watch(noWorkflow, (empty) => {
      if (empty) {
        setOpen.value = false; selOpen.value = null;
        /* By the same token, with no workflow every display derived from apiFields /
           promptSlot must disappear together — not just the gear summary, but the prompt
           box, extra multiline boxes and settings-popover fields. Set the suppression flag,
           clear the list and abort in-flight requests, to block the loadApiFields refill. */
        fieldsSuppressed.value = true;
        fieldsToken++;
        apiFields.value = []; promptSlot.value = false;
      } else {
        /* Switching back to a category with a workflow: lift suppression, then refetch. */
        fieldsSuppressed.value = false;
        loadApiFields();
      }
    }, { immediate: true });
    /* Default template follows the node's medium, so a fresh text generator

    /* ---- exposed-parameter controls (numeric widget + bar summary) ----
       Injected only; isRandomField stays with the data layer (syncFieldSpecs).
       Placed after noWorkflow is defined to avoid a TDZ on that injected ref. */
    const { fieldStep, fieldMin, fieldMax, fieldNum, decimalsOf, fieldText, plainParams, fieldLabelText, paramLabel,
      paramText, openSetFromBar, fieldFill, clampField, bumpField, commitFieldNum, stepField, canFieldDec, 
      canFieldInc, editingField, scrubStart, scrubMove, scrubCancel, scrubEnd } = useFieldControls({ fieldValue, setFieldValue, fieldId, apiBarFields, isAdvancedField, noWorkflow, t });
    /* Default template follows the node's medium, so a fresh text generator
       offers 生成文本 rather than a leftover video workflow. */
    const WF_DEFAULT = { image: "image", video: "video", audio: "audio", text: "text" };
    /* ---- category default workflow --------------------------------
       The API dialog pins one workflow per category (the list endpoint marks
       it `is_default`, falling back to the category's first entry). ONLY a
       node that has no usable workflow of its own adopts it -- a fresh node
       still carrying the legacy "image"/"video" stem, or one whose template
       was deleted/renamed. Nodes already on the canvas keep their pick when
       the pin changes; adopting happens once, never as a live follow. */
    const wfPool = computed(() => {
      const cat = activeCategory.value;
      const field = isGenOmni.value ? "category" : "subCategory";
      const pool = cat ? wfList.value.filter((w) => w[field] === cat) : wfList.value;
      return pool.length ? pool : wfList.value;
    });
    const defaultWfId = computed(() => {
      const hit = wfPool.value.find((w) => w.is_default);
      return hit ? hit.id : (wfPool.value[0] ? wfPool.value[0].id : "");
    });
    const adoptDefaultWorkflow = () => {
      if (NS.flow?.isRenamingWorkflows?.()) return;
      if (!wfList.value.length) return;
      const cur = data.workflow || "";
      /* Only a pick from the ACTIVE category is usable: the API selector is
         filtered by the mode's category, so a 文生图 graph left behind when
         the user switches to 图像放大 would be invisible in the dropdown and
         would fail at run time. wfPool falls back to the whole list when the
         category is empty, which keeps modes without templates unaffected. */
      if (cur && wfPool.value.some((w) => w.id === cur)) return;
      /* A node that already produced content keeps its reference even if the template was
         deleted — keeping the original (dropdown still shows it) beats silently switching
         workflows. Nodes with no output get no exemption: a deleted template falls back. */
      if (cur && data.result && !wfList.value.some((w) => w.id === cur)) return;
      const target = defaultWfId.value;
      if (target && target !== cur) patch({ workflow: target }, { silent: true });
    };
    /* Keyed on the category pool, not the whole list: a mode switch must move
       the node onto that mode's template, while a DEFAULT-pin change inside
       the same category must not (already-created nodes keep their pick). */
    watch([wfPool, () => data.workflow], adoptDefaultWorkflow, { immediate: true });
    const wfValue = computed(() => data.workflow || defaultWfId.value
      || WF_DEFAULT[kind.value] || "video");
    const wfLabel = computed(() => {
      const hit = wfList.value.find((w) => w.id === wfValue.value);
      if (hit) return hit.name || hit.id;
      if (frozenWf.value && frozenWf.value.id === wfValue.value) return frozenWf.value.name;
      return wfValue.value;
    });
    const sizeLabel = computed(() => {
      const hit = sizePresets.find((s) => s.value === sizeValue.value);
      return hit ? hit.label : (data.width || 512) + "×" + (data.height || 512);
    });
    const onSelOutside = (event) => {
      /* Header tag palette: trigger + menu share [data-node-tag]; a press
         elsewhere closes it. */
      if (tagOpen.value && !event.target?.closest?.("[data-node-tag]")) tagOpen.value = false;
      /* The settings popover is its own layer: a press outside the gear
         wrapper closes it. Both popovers are children of that wrapper now. */
      if (setOpen.value && !event.target?.closest?.(".icn__gpa-setwrap")) setOpen.value = false;
      /* The chooser hangs off the node root, not off the badge, so it needs
         its own outside test. A press on the badge itself is handled by its
         click handler (which toggles), hence the badge exemption. */
      if (modeOpen.value && !event.target?.closest?.(".icn__gpa-modes")
        && !event.target?.closest?.("[data-vc-badge]")) closeModes();
      /* LoRA name listbox: trigger + floating menu share [data-lora-sel];
         a press anywhere else closes it. */
      if (loraSelIndex.value != null && !event.target?.closest?.("[data-lora-sel]")) closeLoraSel();
      if (!selOpen.value) return;
      if (event.target?.closest?.(".icn__selwrap")) return;
      /* The list lives inside the card now, but a press on its search row
         must still not count as an outside press for the list itself. */
      if (event.target?.closest?.(".icn__gpa-fsel")) return;
      if (event.target?.closest?.("[data-widget-name]")) return;
      selOpen.value = null;
    };
    const onSelKey = (event) => {
      if (!selOpen.value && !setOpen.value && !modeOpen.value && loraSelIndex.value == null && !tagOpen.value) return;
      if (event.key !== "Escape" && event.key !== "Esc") return;
      /* Swallow it: Vue Flow uses Escape for its own selection handling, which
         would deselect the node and hide the panel just because a list closed. */
      event.stopPropagation();
      event.preventDefault();
      tagOpen.value = false;
      selOpen.value = null;
      setOpen.value = false;
      closeLoraSel();
      closeModes();
    };
    onMounted(() => {
      document.addEventListener("pointerdown", onSelOutside, true);
      document.addEventListener("keydown", onSelKey, true);
    });
    onBeforeUnmount(() => {
      document.removeEventListener("pointerdown", onSelOutside, true);
      document.removeEventListener("keydown", onSelKey, true);
    });
    const openResult = () => {
      const result = data.result;
      if (result?.url) window.open(result.url, "_blank");
      else NS.api?.toast?.("info", t("core.noResultsYet"));
    };

    /* Per-kind hover actions (image / video / audio / text / gen / empty).
       The tool set itself lives in js/infcanvas-tools.js and the video/audio
       handlers in js/infcanvas-media-tools.js. */
    /* A generator with a FREE input can be fed straight from the disk. Once a
       wire is connected the material comes from upstream instead, so there is
       deliberately no upload button — a node holding both its own file and a
       live input would have two contradictory identities. A text node takes a
       .txt/.md/.json/.csv the same way, as long as it is still empty: whatever
       is already there (typed text, an uploaded file, a generated result) is
       the node's content, and its upload slot is spent. */
    const canUpload = computed(() => {
      if (hasIncoming.value || data.result) return false;
      if (isText) return !data.asset && !hasText.value;
      return isGen.value;
    });

    /* Big centred glyph for a generator that has produced nothing yet. */
    const EMPTY_ICONS = { image: "image", video: "video", audio: "audio-lines", text: "text-pen", omni: "sparkles" };
    const emptyIcon = computed(() => EMPTY_ICONS[kind.value] || "image");
    /* Scales with the frame (a resized node keeps its proportions) but never
       smaller than a legible glyph nor larger than a tasteful watermark. */
    const emptyIconSize = computed(() =>
      Math.max(32, Math.min(72, Math.round(bodyH.value * 0.3))));

    const actions = computed(() => NS.tools?.actionsFor?.(data, {
      canUpload: canUpload.value,
    }) || []);
    /* `button` is the hover-row element: the frame tool opens its three-way
       menu anchored to it, exactly like the reference xcat-ve-menu. */
    const onAction = (key, event) => NS.tools?.run?.(key, {
      id: props.id,
      data,
      url: url.value,
      button: event?.currentTarget || null,
      pickFile,
    });

    /* Text nodes render Markdown but enter a source editor on double click,
       exactly like the reference xcat-text-edit.js / xcat-markdown.js pair. */
    const editing = ref(false);
    const draft = ref("");
    const editor = ref(null);
    const setEditor = (element) => { editor.value = element; };
    /* Source text is the single origin (never mutated). Translation keeps a
       separate `translated` overlay, so toggling zh<->en never writes the
       node's real content: generation/editing always read the original. */
    const sourceText = computed(() =>
      String(data.text || data.asset?.text || data.result?.text || data.asset?.name || ""));
    const translated = ref("");
    const translating = ref(false);
    /* What the node SHOWS: the translated overlay while active, else the source.
       Both the rendered HTML and the copy button read this, so "copy what you
       see" holds in either state (translated text copied while translated,
       original text copied while not). */
    const displayText = computed(() => translated.value || sourceText.value);
    /* Tooltip follows the RAW ComfyUI locale (same source the translator uses),
       so a Japanese UI says "Translate to Japanese" instead of the old hard-coded
       English/中文. Recomputes when the host locale changes mid-session. */
    const targetLangName = computed(() => {
      const raw = NS.i18n?.rawLocale?.() || NS.i18n?.current?.() || "en";
      return NS.translate?.langName?.(raw) || "English";
    });
    const textHtml = computed(() => NS.tools?.renderText?.(displayText.value) || "");
    const textPlain = displayText;
    const copyText = async () => {
      const value = textPlain.value;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        NS.api?.toast?.("success", t("media.copiedClipboard"));
      } catch (error) {
        NS.api?.toast?.("error", t("media.couldNotCopyText"), String(error?.message || error));
      }
    };
    /* Toggle translation in the language ComfyUI is currently using. First
       click translates the source, next click restores the original, and so
       on. An in-flight request is a no-op (no duplicate queue jobs). Changing
       the source text invalidates the overlay so a stale translation is never
       shown against new content. */
    const toggleTranslate = async () => {
      if (translating.value) return;
      if (translated.value) { translated.value = ""; return; }
      const source = sourceText.value;
      if (!source.trim()) return;
      translating.value = true;
      try {
        /* Follow the RAW ComfyUI locale (ja / ko / zh-TW / pt-BR …), not our
           zh/en UI bucket — Qwen can translate into all of them. */
        const lang = NS.i18n?.rawLocale?.() || NS.i18n?.current?.() || "en";
        const result = await NS.translate?.text?.(source, lang);
        if (!result) throw new Error(t("trans.translateEmpty"));
        translated.value = result;
      } catch (error) {
        NS.api?.toast?.("error", t("trans.failed"), String(error?.message || error));
      } finally {
        translating.value = false;
      }
    };
    watch(sourceText, () => { translated.value = ""; });
    /* Reference xcat-text-edit.js: double click anywhere on the node enters
       the inline textarea, caret goes to the end (not select-all); Esc /
       clicking outside / losing focus exits editing and keeps the text. */
    const startEdit = () => {
      /* Generate nodes keep the asset-node body; their parameters live in the
         panel that appears on selection, so double-click needs no extra edit. */
      if (isGen.value) return;
      if (kind.value !== "text" || editing.value) return;
      /* A text node with a wired input is a locked consumer: it reads the
         incoming text/media and must NOT be edited by hand (mirrors the
         upload rule — canUpload also refuses while hasIncoming). Only a free
         text node may be double-clicked into the editor. */
      if (hasIncoming.value) return;
      draft.value = data.text || data.asset?.text || data.asset?.name || "";
      editing.value = true;
      nextTick(() => {
        const area = editor.value;
        if (!area) return;
        area.focus({ preventScroll: true });
        const end = (area.value || "").length;
        try { area.setSelectionRange(end, end); } catch (error) { /* optional */ }
      });
    };
    const commitEdit = () => {
      if (!editing.value) return;
      editing.value = false;
      patch({ text: draft.value });
    };
    const onEditKey = (event) => {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        commitEdit();
      }
      event.stopPropagation();
    };
    /* If a wire lands while the editor is open, leave edit mode at once: a
       wired text node is a locked consumer, no manual textarea. Discard the
       draft (do NOT commit) — the incoming asset is now the text source. */
    watch(hasIncoming, (wired) => { if (wired && editing.value) editing.value = false; });

    /* ---- node name (double click the capsule) ----
       The name is the only free-form label a node has: it defaults to the
       medium ("core.image"), becomes the file name when material is dropped in, and
       can be renamed here. contenteditable rather than <input>: the capsule is
       inline-block and must grow with the text instead of being pinned to a
       guessed width. */
    const DEFAULT_TITLE = {
      image: "core.image", video: "field.video", audio: "field.audio", text: "field.text", omni: "core.universal", lora: "core.loraStack",
      cleanup_vram: "core.clearVram", cleanup_ram: "core.clearRam", cleanup_both: "core.clearVramRam",
      text_merge: "core.textCollage",
    };
    /* Titles are persisted as the Chinese medium name (an internal key, same
       as the category keys), but the capsule must read Text / Image / Video /
       Audio / LoRA Stack in English. Both spellings map back to the key on
       rename so a language switch never turns a default title into a
       "custom" one. */
    const TITLE_KEYS = {
      "core.image": "image", "Image": "image", "field.video": "video", "Video": "video",
      "core.universal": "omni", "Universal": "omni", "万能生成": "omni",
      "field.audio": "audio", "Audio": "audio", "field.text": "text", "Text": "text",
      "core.loraStack": "lora", "LoRA 栈": "lora", "LoRA Stack": "lora",
      "core.clearVram": "cleanup_vram", "Clear VRAM": "cleanup_vram",
      "core.clearRam": "cleanup_ram", "Clear RAM": "cleanup_ram",
      "core.clearVramRam": "cleanup_both", "Clear VRAM & RAM": "cleanup_both",
      "core.textCollage": "text_merge", "Text Collage": "text_merge",
      "core.mergeText": "text_merge", "Merge Text": "text_merge", "Text Merge": "text_merge",
      "shortcuts.group.node": "node", "Node": "node",
    };
    const canonicalTitle = (name) => {
      const key = TITLE_KEYS[name];
      return key ? (DEFAULT_TITLE[key] || "shortcuts.group.node") : name;
    };
    const displayTitle = computed(() => {
      const raw = data.title || "shortcuts.group.node";
      const key = TITLE_KEYS[raw];
      return key ? t(DEFAULT_TITLE[key] || "shortcuts.group.node") : raw;
    });
    const renaming = ref(false);
    const nameBox = ref(null);
    const setNameBox = (element) => { nameBox.value = element; };
    const startRename = () => {
      if (renaming.value) return;
      renaming.value = true;
      nextTick(() => {
        const box = nameBox.value;
        if (!box) return;
        box.textContent = displayTitle.value;
        box.focus({ preventScroll: true });
        /* Select the whole name so typing replaces it, like a file rename. */
        try {
          const range = document.createRange();
          range.selectNodeContents(box);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } catch (error) { /* optional */ }
      });
    };
    const commitRename = () => {
      if (!renaming.value) return;
      renaming.value = false;
      /* textContent, never innerHTML: a paste can carry markup that would
         otherwise end up rendered inside the capsule. */
      const next = String(nameBox.value?.textContent || "").replace(/\s+/g, " ").trim();
      const title = canonicalTitle(next) || DEFAULT_TITLE[kind.value] || "shortcuts.group.node";
      if (title !== data.title) patch({ title });
    };
    const cancelRename = () => { renaming.value = false; };
    const onNameKey = (event) => {
      if (event.key === "Enter") { event.preventDefault(); commitRename(); }
      else if (event.key === "Escape" || event.key === "Esc") { event.preventDefault(); cancelRename(); }
      event.stopPropagation();
    };
    const onNamePaste = (event) => {
      event.preventDefault();
      const text = String(event.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
      try { document.execCommand("insertText", false, text); } catch (error) { /* optional */ }
    };

    /* ---- header tag (one colour capsule per node) ----
       Clicking the tag icon in the header opens a palette of NODE_TAGS. Picking
       one stores its name in data.tag (persisted, like title); the palette
       closes and the icon is replaced by a coloured capsule showing the same
       name. Clicking the capsule reopens the palette to change/clear it. */
    const tagOpen = ref(false);
    const tagInfo = computed(() => TAG_BY_NAME[data.tag] || null);
    const toggleTag = () => { tagOpen.value = !tagOpen.value; };
    const pickTag = (name) => {
      tagOpen.value = false;
      const next = name || null;
      if (next !== data.tag) patch({ tag: next });
    };

    /* Right-click a node: Copy / Delete / Add tag. A right-click on a node
       that is already in a multi-selection keeps that selection; otherwise
       the menu acts on the node under the pointer alone. */
    const openNodeMenu = (event) => {
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!state.selectedIds.value.includes(props.id)) NS.flow?.selectNodes?.([props.id]);
      else bringToFront(state.nodes, [props.id]);   /* re-clicking a selected node raises it */
      const anchor = { getBoundingClientRect: () => ({ left: event.clientX, bottom: event.clientY }) };
      NS.tools?.openMenu?.(anchor, [
        { label: t("panel.copyCanvas"), icon: "pi pi-copy", onPick: () => NS.api?.copySelection?.() },
        { label: t("panel.delete"), icon: "pi pi-trash", onPick: () => {
          const ids = state.selectedIds.value;
          const targets = ids.includes(props.id) && ids.length > 1 ? ids.slice() : [props.id];
          NS.flow?.removeNodes?.(targets);
          NS.api?.markDirty?.();
          NS.flow?.history?.schedule?.();
        } },
        { label: t("core.addTag"), icon: "pi pi-tag", onPick: () => { tagOpen.value = true; } },
      ]);
    };

    /* Kept for extensions written against the earlier two-button build. */
    const download = () => onAction("download");
    const remove = () => onAction("delete");

    /* Empty asset nodes are one big upload hit area, like the reference
       .node-upload. Uploading turns this very node into the matching media
       node instead of creating a second one. */
    const fileInput = ref(null);
    /* A top-level ref is auto-unwrapped in templates, so bind it through a
       function ref (nested refs such as media.el can be passed directly). */
    const setFileInput = (element) => { fileInput.value = element; };
    const pickFile = () => fileInput.value?.click();
    /* Each asset node has a FIXED kind from the spec that created it. An
       image node only ever accepts images, a video node only videos, etc.
       The old code re-derived the kind from the file name here, which let an
       image node silently morph into a video/audio node — reject mismatches. */
    const ACCEPT_BY_KIND = {
      image: "image/*",
      video: "video/*",
      audio: "audio/*",
      text: ".txt,.md,.json,.csv",
      omni: "image/*,video/*,audio/*,.txt,.md,.json,.csv",
    };
    const KIND_LABELS = { image: "wire.image", video: "field.video", audio: "field.audio", text: "field.text", omni: "wire.asset" };
    const acceptAttr = computed(() => ACCEPT_BY_KIND[kind.value] || "image/*");
    /* Already translated here: the template binds :title directly, and the
       mismatch toast below reports the same wording the button shows. */
    const emptyHint = computed(() => t("image.clickUpload", { kind: t(KIND_LABELS[kind.value] || "wire.asset") }));
    const onPicked = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const fileKind = NS.api?.kindFromFile?.(file.name);
      if (!fileKind) { NS.api?.toast?.("warning", t("panel.unsupportedFileType"), file.name); return; }
      if (fileKind !== kind.value) {
        NS.api?.toast?.("warning", t("core.fileTypeMismatch"),
          t("core.nodeOnlyAcceptsFiles", { title: emptyHint.value, kind: t(KIND_LABELS[kind.value] || kind.value), file: file.name }));
        return;
      }
      const nextKind = kind.value;
      try {
        const asset = await NS.backend.upload(file);
        asset.kind = nextKind;
        asset.name = asset.name || file.name;
        asset.url = asset.url || NS.api?.viewUrl?.(asset) || "";
        if (nextKind === "text") {
          try { asset.text = (await (NS.api?.readTextFile || ((f) => f.text()))(file)).slice(0, 4000); } catch (error) { /* binary */ }
        }
        patch({
          kind: nextKind,
          asset,
          text: asset.text || "",
          /* Material in = named after the file the user picked, matching the
             drop path (not the timestamped store name). */
          title: file.name,
        });
        NS.api?.toast?.("success", t("panel.assetAdded"), file.name);
        await nextTick();
        media.install();
        wave.attachMedia();
      } catch (error) {
        NS.api?.toast?.("error", t("panel.uploadFailed"), file.name + " · " + String(error));
      }
    };

    /* Asset media nodes fit their frame to the source aspect ratio on load:
       width is pinned to 320 and height follows the source. `fitKey` remembers
       which asset we already auto-fitted, so re-entering the canvas (which
       re-fires img/video load) never clobbers a size the user resized by hand.
       Only a genuinely new asset (different filename/url) re-triggers the fit. */
    const fitToAsset = (naturalW, naturalH) => {
      if (!(naturalW > 0) || !(naturalH > 0) || !hasMedia.value) return;
      const asset = assetOf.value;
      const key = asset?.filename || asset?.url || url.value;
      if (!key || data.fitKey === key) return;
      const bodyTarget = Math.max(80, Math.round(ASSET_DEF_W * naturalH / naturalW));
      /* Auto-fit is the node's own normalisation, not an edit the user made.
         The header is added on top so the media keeps its own aspect ratio. */
      patch({ fitKey: key, size: [ASSET_DEF_W, bodyTarget + HEAD_H] }, { silent: true });
    };
    const onImageLoad = (event) => {
      const img = event?.target;
      fitToAsset(img?.naturalWidth, img?.naturalHeight);
    };
    const onVideoMeta = (event) => {
      media.onLoaded();
      const video = event?.target;
      fitToAsset(video?.videoWidth, video?.videoHeight);
    };
    /* Live sample preview: size the running body to the streamed image's own
       aspect ratio (width pinned to the node's stored width). Never touches
       data.size so the final result keeps the frame the user configured. */
    const onGenPreviewLoad = (event) => {
      const el = event?.target;
      /* <img> exposes naturalWidth/Height; <video> exposes videoWidth/Height
         once loadedmetadata fires. Both feed the same aspect sizing. */
      const w = el?.naturalWidth || el?.videoWidth;
      const h = el?.naturalHeight || el?.videoHeight;
      if (!(w > 0) || !(h > 0)) return;
      genPreviewH.value = Math.max(GEN_RUN_BODY_H, Math.round(size.value[0] * h / w));
    };
    /* Live preview MIME can be video/mp4 (KJNodes) or image/* (native b_preview,
       animated WebP). The template picks <video> vs <img> off this field. */
    const isVideoMime = (mime) => typeof mime === "string" && mime.startsWith("video/");

    onMounted(() => nextTick(() => media.install()));
    watch(bar, (visible) => { if (visible) nextTick(() => media.install()); });

    return {
      data, isGen, isProgressing, isWaiting, isError, isRunningFrame, isText, isLora, kind, displayKind, url, hasMedia, bar, size, bodyH, rootStyle, handleTop,
      loras, loraOptions, loadLoraOptions, addLora, removeLora, setLoraName,
      setLoraStrength, stepLora, toggleLora, loraStrengthText,
      loraSelIndex, loraQuery, loraSelStyle, loraSelName, filteredLoraOptions,
      closeLoraSel, toggleLoraSel, pickLoraSel, setLoraSearchEl,
      enabledTriggers, setTriggerEl,
      media, wave, onResizeDown, resizing, setField, run, cancelGen, openResult, download, remove,
      imageModes, imageMode, setImageMode, isGenImage, imageModeReason, imageModeAvailable,
      sizePresets, sizeValue, setSize,
      isGenVideo, videoModes, videoMode, setVideoMode, modeAvailable, modeReason, incomingAssets, assetSlots,
      isGenAudio, audioModes, audioMode, setAudioMode, audioSlots, audioFamily,
      isGenText, textModes, textMode, setTextMode, textModeReason, textModeAvailable,
      visibleTopGroups, topTab, topModes, setTopTab, topGroupReason, topGroupAvailable,
      omniCategories, omniCategory, setOmniCategory,
      audioModeReason, audioModeAvailable, wiredAudio, wiredTextNodes, wiredText,
      textWires, boxCount, noTextWorkflow, boxWiredAt, boxDisabledAt, wiredTextAt,
      apiFields, promptTextFields, hasPromptArea, textAreaValue, setTextArea, textAreaLabel,
      apiBarFields, visibleBarFields, advancedCount, toggleAdvanced,
      plainParams, fieldLabelText, paramLabel, paramText, openSetFromBar,
      fieldId, fieldValue, setFieldValue,
      setOpen, toggleSet, popStyle, fieldText, fieldFill, bumpField, commitFieldNum,
      stepField, canFieldDec, canFieldInc, editingField,
      scrubStart, scrubMove, scrubEnd, scrubCancel,
      isRandomField, CONTROL_MODES, fieldMode, modeTitle, openModes, modeOpen,
      modeField, modeStyle, pickMode, closeModes, selField, selStyle, wfMenuStyle,
      selQuery, setSelSearchEl, filteredSelOptions,
      refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut,
      wfList, filteredWfList, wfOptions, filteredWfOptions, noWorkflow,
      selOpen, toggleSel, pickSel, wfValue, wfLabel, sizeLabel,
      promptEl, mention, mentionItems, closeMention, onPromptInput, hoverMention, pickMention, onPromptKeydown,
      refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut,
      setFileInput, pickFile, onPicked, acceptAttr, emptyHint, onImageLoad, onVideoMeta, onGenPreviewLoad, isVideoMime,
      emptyIcon, emptyIconSize, canUpload, hasIncoming,
      actions, onAction, editing, draft, setEditor, textHtml, textPlain, copyText, startEdit, commitEdit, onEditKey,
      translated, translating, toggleTranslate, targetLangName,
      renaming, setNameBox, startRename, commitRename, cancelRename, onNameKey, onNamePaste, displayTitle,
      hasText, hasDisplayText, showTextBody, isCleanup, isMerge, isPill, isGenOmni,
      NODE_TAGS, tagOpen, tagInfo, toggleTag, pickTag, openNodeMenu,
    };
  },
  template: icNodeTemplate,
};

  return IcNode;
}
