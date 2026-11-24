/* Node semantic rules: input/mode tables + pure predicates. Extracted
   from infcanvas-flow.js (batch 1a). t() resolves NS.i18n lazily because
   i18n loads after this module (alphabetical flow < i18n). */
const NS = (window.InfCanvas = window.InfCanvas || {});
const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

  /* ---- time format ---- */
  export const fmtTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  };

  /* Top-level categories → second-level modes (2026-11-22 generator top tabs).
     Same source of truth as backend WORKFLOW_CATEGORIES / API-config left TOP_GROUPS;
     split here by node type: image nodes have 图像/图像工具, video have 视频/视频工具,
     audio have 音乐/音频, text only LLM (a single group skips the top-switch row).
     The top level only decides which group the second-level tabs show; mode names stay
     storage values / backend categories and do not affect fields.json. */
  export const TOP_GROUP_MODES = {
    "group.image":     ["cat.textToImage", "cat.imageEdit", "cat.inpaint", "cat.panorama", "cat.outpaint"],
    "group.imageTools": ["cat.imageUpscale", "cat.removeBackground", "cat.imageRelight", "cat.multiAngle", "cat.removeWatermark", "cat.cutout"],
    "group.video":     ["cat.refToVideo", "cat.textToVideo", "cat.imageToVideo", "cat.firstLastFrame"],
    "group.videoTools": ["cat.videoInterpolation", "cat.videoEdit", "cat.videoUpscale"],
    "group.music":     ["cat.textToMusic", "cat.musicCover", "cat.textToSfx"],
    "group.audio":     ["cat.textToSpeech", "cat.voiceClone"],
    "group.llm":      ["cat.llmChat", "cat.imageToPrompt", "cat.videoToPrompt", "cat.speechToText"],
  };
  export const MODE_TOP_GROUPS = {
    image: ["group.image", "group.imageTools"],
    video: ["group.video", "group.videoTools"],
    audio: ["group.music", "group.audio"],
    text:  ["group.llm"],
  };
  /* Reverse table: mode → owning top group. Generated from TOP_GROUP_MODES, no duplicate. */
  export const TOP_OF_MODE = Object.fromEntries(
    Object.entries(TOP_GROUP_MODES).flatMap(([top, modes]) => modes.map((mode) => [mode, top]))
  );

  /* ---- video-generator input rules ----------------------------------
     Contract for what a VIDEO generator node may take in through wired ASSET
     nodes, per mode. TEXT IS NOT AN ASSET — a wired text node supplies the
     PROMPT, so it never appears in these rules, never fills a slot and never
     counts toward any mode's availability. Each media kind is { min, max }:
       - a kind absent from a mode is NOT ACCEPTED at all;
       - min = required count (mode is NOT selectable while under it);
       - max = cap (mode is NOT selectable while over it), null = unlimited.
     `_minMedia` is an overall lower bound counting ONLY media (image/video/
     audio). 参考生视频 needs ≥1 media asset, so it is NOT selectable on an empty
     node nor on a text-only node. 文生视频 is the pure-prompt mode: its rule
     set is EMPTY, so any wired media disables it. 图生视频 = exactly 1 image;
     首尾帧视频 = exactly 2. This single table drives the tab-disable check
     (modeReasonFor) and the active-mode fallback. */
  export const VIDEO_INPUT_RULES = {
    "cat.refToVideo": { _minMedia:1, image: {min:0,max:null}, video: {min:0,max:null}, audio: {min:0,max:null} },
    "cat.textToVideo": {},
    "cat.imageToVideo":     { image: {min:1,max:1} },
    "cat.firstLastFrame":   { image: {min:2,max:2} },
    /* 视频工具 group: interpolate / edit / upscale all take exactly 1 input video. */
    "cat.videoInterpolation":     { video: {min:1,max:1} },
    "cat.videoEdit":     { video: {min:1,max:1} },
    "cat.videoUpscale":     { video: {min:1,max:1} },
  };
  export const KIND_CN = {
    image: { label: "wire.image", measure: "wire.measureImage" },
    video: { label: "field.video", measure: "wire.measureItem" },
    audio: { label: "field.audio", measure: "wire.measureClip" },
    text:  { label: "field.text", measure: "wire.measureClip" },
  };
  /* Edge-centre labels: 文本1 / 图像2 / 视频1 … Only shown when one target
     receives 2+ wires whose sources are ALL the same kind. */
  export const EDGE_LABEL_KIND = {
    text: "core.textIndexed", image: "core.imageIndexed", video: "core.video", audio: "core.audio", lora: "core.lora",
  };
  /* Fixed slot layout of the wired-assets row; null = follow actual wires. */
  export const MODE_ASSET_SLOTS = {
    "cat.refToVideo": null,
    "cat.textToVideo": [],
    "cat.imageToVideo":     [{ kind: "image" }],
    "cat.firstLastFrame":   [{ kind: "image" }, { kind: "image" }],
    "cat.videoInterpolation":     [{ kind: "video" }],
    "cat.videoEdit":     [{ kind: "video" }],
    "cat.videoUpscale":     [{ kind: "video" }],
  };
  /* The same table for the other two generators, keyed by their own mode names.
     文生图 / 文生音乐 / 语音合成 are pure-prompt modes, so they own no slot.
     图像编辑 follows the actual wires (it may take more than one reference
     image); every other media mode pins ONE slot, so an empty node still shows
     which kind of material the active mode is waiting for. */
  export const IMAGE_MODE_ASSET_SLOTS = {
    "cat.textToImage": [],
    "cat.imageEdit": null,
    "cat.imageUpscale": [{ kind: "image" }],
    "cat.removeBackground": [{ kind: "image" }],
    "cat.inpaint": [{ kind: "image" }],
    "cat.panorama": [],
    "cat.outpaint": [{ kind: "image" }],
    "cat.imageRelight": [{ kind: "image" }],
    "cat.multiAngle": [{ kind: "image" }],
    "cat.removeWatermark": [{ kind: "image" }],
    "cat.cutout": [{ kind: "image" }],
  };
  export const AUDIO_MODE_ASSET_SLOTS = {
    "cat.textToMusic": [],
    "cat.musicCover": [{ kind: "audio" }],
    "cat.textToSfx": [],
    "cat.textToSpeech": [],
    "cat.voiceClone": [{ kind: "audio" }],
  };
  /* Text generator: LLM shows every wired picture / clip (it may take many
     stills), 语音转录 pins the single audio slot it consumes. */
  export const TEXT_MODE_ASSET_SLOTS = {
    "cat.llmChat":      null,
    "cat.imageToPrompt": [{ kind: "image" }],
    "cat.videoToPrompt": [{ kind: "video" }],
    "cat.speechToText": [{ kind: "audio" }],
  };
  /* Audio generator accepts AUDIO + TEXT only — images and videos are refused
     at connect time (isValidConnection + onConnect), not merely mode-blocked.
     Audio belongs to the two reference-based modes (音乐翻唱 / 语音克隆) and to
     exactly ONE clip, so those tabs stay locked until a clip is wired; the two
     pure-prompt modes take no media at all (and go dark once audio arrives).
     A wired text node is a PROMPT, never a media asset: it feeds the FIRST
     area (提示词 / 语气), never 歌词 / 朗读文本. */
  export const AUDIO_INPUT_RULES = {
    "cat.textToMusic": {},
    "cat.musicCover": { audio: { min: 1, max: 1 } },
    "cat.textToSfx": {},
    "cat.textToSpeech": {},
    "cat.voiceClone": { audio: { min: 1, max: 1 } },
  };
  export const AUDIO_MODES = Object.keys(AUDIO_INPUT_RULES);
  /* Image generator: three of its four modes CONSUME a source picture, so they
     are unselectable until one is wired. 图像编辑 takes any number of reference
     images; 图像放大 / 背景移除 upscale or cut out a SINGLE picture, so they go
     dark at two or more. 文生图 is the pure-prompt mode and refuses media. */
  export const IMAGE_MODES = TOP_GROUP_MODES["group.image"].concat(TOP_GROUP_MODES["group.imageTools"]);
  export const IMAGE_INPUT_RULES = {
    "cat.textToImage": {},
    "cat.imageEdit": { image: { min: 1, max: null } },
    "cat.imageUpscale": { image: { min: 1, max: 1 } },
    "cat.removeBackground": { image: { min: 1, max: 1 } },
    /* Remaining image group: inpaint / outpaint take 1 image; panorama is pure prompt. */
    "cat.inpaint": { image: { min: 1, max: 1 } },
    "cat.panorama": {},
    "cat.outpaint": { image: { min: 1, max: 1 } },
    /* Remaining 图像工具 group: all take exactly 1 input image. */
    "cat.imageRelight": { image: { min: 1, max: 1 } },
    "cat.multiAngle": { image: { min: 1, max: 1 } },
    "cat.removeWatermark": { image: { min: 1, max: 1 } },
    "cat.cutout": { image: { min: 1, max: 1 } },
  };
  /* Text generator: LLM takes pictures, video AND audio in the same call, with
     NO front-end cap (2026-11-22 用户要求「图片/视频/音频各 0~∞」). The old
     50/100/100 numbers mirrored a specific TextGenerateV2 template; they were
     removed so a workflow with more slots is not blocked at connect time.
     Capacity is decided by the BACKEND per workflow (_mediaCaps, derived from
     the workflow's own autogrow slot count) — assets beyond that are trimmed
     when the prompt is built, so wiring more is harmless. 语音转录 needs
     exactly one audio clip (and nothing else). A wired text node is the prompt
     and is always legal, so it never appears in either rule set. */
  export const TEXT_INPUT_RULES = {
    "cat.llmChat":      { image: { min: 0, max: null }, video: { min: 0, max: null }, audio: { min: 0, max: null } },
    /* LLM group's reverse-inference modes: 图像反推 takes 1 image, 视频反推 1 video. */
    "cat.imageToPrompt": { image: { min: 1, max: 1 } },
    "cat.videoToPrompt": { video: { min: 1, max: 1 } },
    "cat.speechToText": { audio: { min: 1, max: 1 } },
  };
  /* Per-kind cap enforced at CONNECT time, derived from the LLM rule row so
     the gate and the tab check can never disagree. All three are now null =
     no front-end limit; the gate (textWireReason) treats a falsy cap as
     "unlimited" and lets the wire through. */
  export const TEXT_WIRE_CAPS = {
    image: TEXT_INPUT_RULES["cat.llmChat"].image.max,
    video: TEXT_INPUT_RULES["cat.llmChat"].video.max,
    audio: TEXT_INPUT_RULES["cat.llmChat"].audio.max,
  };
  /* Text node's generator modes. They select which workflow category the
     API dropdown filters to (see activeCategory); the actual generation uses
     the same generate.run path as every other generator. VIDEO_MODES is the
     video node's full 2-group list (was a local literal in flow-node-view). */
  export const TEXT_MODES = TOP_GROUP_MODES["group.llm"].slice();
  export const VIDEO_MODES = TOP_GROUP_MODES["group.video"].concat(TOP_GROUP_MODES["group.videoTools"]);
  /* Node label palette — a single tag per node, chosen from this fixed list.
     Order is the picker order; `name` is persisted in data.tag (an internal
     key, like category), the capsule shows the localised name via $t. */
  export const NODE_TAGS = [
    { name: "core.character", color: "var(--color-coral-500, #FF4B4B)" },
    { name: "core.scene", color: "#FF9F43" },
    { name: "core.prop", color: "#FFD93D" },
    { name: "core.styleRef", color: "#6BCB77" },
    { name: "core.storyboard", color: "var(--color-blue-400, #4D96FF)" },
    { name: "core.reference", color: "#6C63FF" },
    { name: "core.other", color: "#B56CFF" },
  ];
  export const TAG_BY_NAME = Object.fromEntries(NODE_TAGS.map((item) => [item.name, item]));
  /* Which SOURCE kinds each generator kind accepts, on the node-type level.
     This is the same contract audioWireReason / imageWireReason enforce, in
     table form: the wire-release menu reads it to list only the node types
     that could legally receive the wire being dragged. `text` is a prompt and
     is accepted everywhere; the video generator takes every media kind and
     lets the ACTIVE MODE constrain (modeReasonFor) instead. */
  export const GEN_ACCEPTS = {
    image: ["image", "text", "lora"],
    video: ["image", "video", "audio", "text", "lora"],
    audio: ["audio", "text", "lora"],
    text:  ["image", "video", "audio", "text", "lora"],
  };
  /* A universal node's output carries whatever workflow it ran, so every
     generator accepts it as a source; and "omni" as a target accepts any kind
     (its own genWireReason returns ""). Keeping this bidirectional makes the
     universal node a true pass-through junction in either wire direction. */
  export const acceptsKind = (genKind, srcKind) => genKind === "omni" || srcKind === "omni" || (GEN_ACCEPTS[genKind] || []).indexOf(srcKind) >= 0;
  /* A LoRA stack is a MODEL modifier, not a media asset: it never occupies a
     wired-assets slot, never counts toward a mode's min/max, and is accepted by
     every generator (it rides into the workflow via buildPrompt's MODEL chain).
     Guard clauses below filter it out of all asset bookkeeping. */
  export const isLoraNode = (node) => node?.data?.role === "lora";
  /* A media node is a generator only while it has no material of its own.
     Dropping a file on it sets data.asset and it becomes a material node for
     good, so every "does this accept input" question goes through here. */
  export function isGenState(data) {
    return !!data && data.role === "media" && !data.asset;
  }
  export function isAudioGenData(data) { return isGenState(data) && data.kind === "audio"; }
  export function isVideoGenData(data) { return isGenState(data) && data.kind === "video"; }
  export function isImageGenData(data) { return isGenState(data) && data.kind === "image"; }
  /* An EMPTY text node is a generator too (it owns the LLM / 语音转录 panel).
     Unlike the media nodes, incoming wires do NOT turn it into a material node:
     its whole point is to consume an image / video / audio clip. Only content
     of its own (typed text, an upload, a result) makes it material. */
  export function isTextGenData(data) {
    return !!data && data.role === "text" && !data.asset && !data.result
      && !String(data.text || "").trim();
  }
  /* Music vs voice is decided by an explicit set, not a "音乐" prefix test:
     the renamed 文生音乐 no longer starts with 音乐, while 音乐翻唱 still does. */
  export const MUSIC_MODES = TOP_GROUP_MODES["group.music"];
  export const isMusicMode = (mode) => MUSIC_MODES.indexOf(String(mode || "")) >= 0;
  /* The reference modes that own the audio input, per family. */
  export function audioRefMode(mode) {
    return isMusicMode(mode) ? "cat.musicCover" : "cat.voiceClone";
  }
  /* Which text mode the wired media implies — one input box <=> one precise
     mode, following the material actually connected:
       1 image  -> 图像反推; 1 video -> 视频反推; 1 audio -> 语音转录;
       mixed / none / more than one of a kind -> 智能对话 (LLM can consume any
       combination, the three 反推/转录 modes each take exactly one asset).
     Called both when a wire lands (onConnect) and after any wire is cut
     (reconcileModes), so tab and mode always track the current inputs. */
  export function textAutoMode(counts) {
    const image = counts.image || 0;
    const video = counts.video || 0;
    const audio = counts.audio || 0;
    if (image === 1 && !video && !audio) return "cat.imageToPrompt";
    if (video === 1 && !image && !audio) return "cat.videoToPrompt";
    if (audio === 1 && !image && !video) return "cat.speechToText";
    return "cat.llmChat";
  }
  /* What medium this node hands DOWNSTREAM. The generated RESULT wins over an
     input ASSET: a finished 图生视频 / 参考生视频 node still carries its
     reference picture in data.asset, but the wire carries the VIDEO in
     data.result — reading asset first made a video node look like an image
     one (text node switched to 图像反推 instead of 视频反推). A material node
     with no result emits its own file; an unrun generator emits its declared
     kind. Text is a prompt but callers still key off "text". */
  export function assetKindOf(node) {
    const d = node?.data;
    if (!d) return null;
    if (d.role === "lora") return "lora";
    /* Cleanup pills pass whatever flows through them; advertise as "lora" so
       every generator already accepts them and incomingKindCounts ignores them
       (a cleanup wire must never change a generator's available modes). */
    if (d.role === "cleanup") return "lora";
    if (d.role === "text" || d.role === "text_merge") return "text";
    return d.result?.kind || d.asset?.kind || d.kind || null;
  }
  /* Count currently wired MEDIA assets per kind, optionally ignoring one edge.
     Text nodes are prompts, not assets — they are excluded so a text wire
     never affects mode availability. */
  export function incomingKindCounts(targetId, edges, nodes, exceptEdgeId) {
    const counts = {};
    for (const edge of edges) {
      if (edge.target !== targetId || edge.id === exceptEdgeId) continue;
      const kind = assetKindOf(nodes.find((n) => n.id === edge.source));
      /* An unrun universal generator has no fixed medium: treat its wire like
         a pass-through (cleanup/lora/text) so it never trips a mode gate. Once
         it has a result, assetKindOf reports that result's real kind and it is
         counted normally. */
      if (!kind || kind === "text" || kind === "lora" || kind === "omni") continue;
      counts[kind] = (counts[kind] || 0) + 1;
    }
    return counts;
  }
  /* One source node wired into one target node counts as a SINGLE connection,
     no matter how many times the user drags the same wire. The pair identity
     is (source, target); handles are fixed ("out" -> "in"), so this is enough.
     Used both at connect time (reject duplicates) and at load time (collapse
     duplicates already present in a saved canvas). */
  export function edgeKey(edge) { return String(edge.source) + "→" + String(edge.target); }
export function dedupeEdges(edges) {
  const seen = new Set();
  return (edges || []).filter((edge) => {
    const key = edgeKey(edge);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---- one text box <=> one text wire ----------------------------------
   A generator's exposed multiline text fields ARE its "boxes": field order
   matches the panel's text areas and runtime's missingRequiredTexts. A legacy
   {{prompt}} template exposes no field but still has one implicit box. */
export function textFieldsOf(data) {
  const list = data?.fieldSnapshot?.list || [];
  /* Only MULTILINE text fields are connectable "boxes". Single-line `text`
     fields are ordinary parameters and live in the bottom bar instead. */
  return list.filter((f) => f && f.type === "textarea");
}
export function textFieldId(field) {
  return String(field?.nodeId || "") + ":" + String(field?.key || "");
}
export function textSlotCount(data) {
  const fields = textFieldsOf(data);
  if (fields.length) return fields.length;
  /* No field snapshot yet / legacy placeholder template: still one box. */
  if (data?.fieldSnapshot?.promptSlot || data?.promptSlot || data?.promptMap || data?.audioMap?.a) return 1;
  return 0;
}
/* Resolve a pass-through source (cleanup / ignored) to the node that actually
   carries the text, so a text wire routed through a pill still counts once. */
function resolveTextSource(node, edges, nodes, visited) {
  if (!node) return null;
  if (node.data?.muted) return null;
  const passes = node.data?.role === "cleanup" || !!node.data?.ignored;
  if (!passes) return node;
  visited = visited || new Set();
  if (visited.has(node.id)) return null;
  visited.add(node.id);
  for (const edge of edges) {
    if (edge.target !== node.id) continue;
    const up = nodes.find((n) => n.id === edge.source);
    const resolved = resolveTextSource(up, edges, nodes, visited);
    if (resolved && assetKindOf(resolved) === "text") return resolved;
  }
  return null;
}
/* Distinct text sources already feeding target. Mirrors collectInputs: dedupe
   by RESOLVED source id, so A direct + A-through-cleanup count as one wire. */
export function wiredTextCount(targetId, edges, nodes, exceptSourceId) {
  const seen = new Set();
  let count = 0;
  for (const edge of edges) {
    if (edge.target !== targetId || edge.source === exceptSourceId) continue;
    const raw = nodes.find((n) => n.id === edge.source);
    const source = resolveTextSource(raw, edges, nodes);
    if (!source || assetKindOf(source) !== "text" || seen.has(source.id)) continue;
    seen.add(source.id);
    count += 1;
  }
  return count;
}
/* Ordered, de-duplicated text sources wired into `targetId`, in wire order.
   This is the SAME order effectiveTextData uses to map wire #i -> text box #i,
   so the node panel can disable exactly the box that generation reads from.
   Mirrors wiredTextCount (resolveTextSource + distinct resolved source id). */
export function wiredTextSources(targetId, edges, nodes) {
  const seen = new Set();
  const out = [];
  for (const edge of edges || []) {
    if (edge.target !== targetId) continue;
    const raw = (nodes || []).find((n) => n.id === edge.source);
    const source = resolveTextSource(raw, edges, nodes);
    if (!source || assetKindOf(source) !== "text" || seen.has(source.id)) continue;
    seen.add(source.id);
    out.push(source);
  }
  return out;
}
/* "Text merge" and cleanup pills have no text box — they exist to combine or
   pass through, so the 1-box-1-wire rule does not apply to them. */
export function isTextPassThrough(data) {
  return data?.role === "text_merge" || data?.role === "cleanup";
}
export function textWireFullReason(targetNode, sourceNode, edges, nodes) {
  if (!targetNode || !sourceNode || isTextPassThrough(targetNode.data)) return "";
  const source = resolveTextSource(sourceNode, edges, nodes);
  if (!source || assetKindOf(source) !== "text") return "";
  const slots = textSlotCount(targetNode.data);
  /* No text box on this node (e.g. an empty LLM text generator, whose input
     is media not prompt) — leave it to the existing per-kind gates. */
  if (!slots) return "";
  if (wiredTextCount(targetNode.id, edges, nodes, sourceNode.id) >= slots) {
    return t("prompt.allTextBoxesConnectedRemove", { n: slots });
  }
  return "";
}
  /* Single source of truth: given the counts of wired assets per kind, decide
     whether `mode` is selectable. Returns "" when OK, else the reason.
     Checks BOTH bounds: kinds the mode doesn't allow, required counts (min)
     and caps (max) — so 1 image does NOT qualify for 首尾帧视频 (needs 2).
     `table` picks the rule set (video / audio generator); an unknown mode falls
     back to an EMPTY rule set = pure-prompt mode. `denyText` lets the caller
     word the "kind not accepted here" case per node type. */
  export function modeReasonFor(mode, counts, table = VIDEO_INPUT_RULES, denyText = null) {
    const rules = table[mode] || {};
    /* Any wired kind this mode forbids? (metadata keys start with "_") */
    for (const kind of Object.keys(counts)) {
      if (!counts[kind]) continue;
      if (!kind.startsWith("_") && !(kind in rules)) {
        if (denyText) return denyText(kind, mode);
        const allowed = Object.keys(rules).filter((k) => !k.startsWith("_")).map((k) => KIND_CN[k]?.label || k).join(t("core.punctListSep"));
        /* Empty rule set (文生视频) accepts no media at all — it's the pure
           prompt mode. */
        if (!allowed) return t("wire.promptOnlyDoesNotAccept", { mode: t(mode) });
        return t("wire.onlyAccepts", { mode, allowed });
      }
    }
    /* Overall MEDIA lower bound (参考生视频 needs ≥1 image/video/audio). Text
       alone never satisfies it. Zero counts count. */
    const minMedia = rules._minMedia || 0;
    if (minMedia) {
      let media = 0;
      for (const kind of ["image", "video", "audio"]) media += counts[kind] || 0;
      if (media < minMedia) return t("wire.needsLeastImageVideoAudio", { mode: t(mode), min: minMedia, have: media });
    }
    /* Required minimums and caps — STRICT: a required kind with 0 wired still
       fails (0 < min). No "empty node" exception. */
    for (const kind of Object.keys(rules)) {
      if (kind.startsWith("_")) continue;
      const { min, max } = rules[kind];
      const have = counts[kind] || 0;
      const cn = KIND_CN[kind] || { label: "wire.asset", measure: "wire.measureItem" };
      if (min && have < min) {
        return t("wire.needsCurrentlyOnly", { mode: t(mode), min, measure: t(cn.measure), label: t(cn.label), have });
      }
      if (max !== null && have > max) {
        return t("wire.acceptsMost", { mode: t(mode), max, measure: t(cn.measure), label: t(cn.label) });
      }
    }
    return "";
  }

  /* Fallback workflow options if the backend list is unavailable. */
  export const WF_FALLBACK = [
    { id: "video", name: "cat.textToVideo" },
    { id: "image", name: "cat.textToImage" },
    { id: "audio", name: "wire.textAudio" },
    { id: "text", name: "wire.generateText" },
  ];

