/* Prompt compiler for the infinite canvas: upstream collection, LoRA and
   media-slot injection, bare LoadImage fallback, seed handling and buildPrompt.
   Extracted from infcanvas-core.js (batch 4). The Vue Flow handle and the host
   API are injected; this module owns no global canvas state. */
import { ensureLoraMeta, combinedTriggers } from "./lora-meta.js";
import { textFieldsOf, textFieldId } from "./flow-rules.js";

export const SAFE_INT_MAX = 18446744073709552000;

/* One text box <=> one text wire. The panel's exposed multiline text fields
   ARE the boxes, in order. Wire #i fills box #i; a box with a wire uses the
   WIRE's text (its typed value stays stored but is not applied), a box with
   no wire keeps its typed value. Nothing is ever joined — stacking is exactly
   what this rule removes. Wires beyond the box count cannot be created any
   more (the connect gate rejects them); a canvas saved from before the rule
   simply uses the first wire per box, ignoring any surplus.
   Returns a shallow copy; the node's own data is never mutated. Exported so
   the run loop can validate the effective values BEFORE buildPrompt. */
export function effectiveTextData(data, inputs, kind) {
  const wired = (inputs || []).filter((entry) => entry.kind === "text")
    .map((entry) => entry.text || entry.asset?.name || "").filter(Boolean);
  const fields = textFieldsOf(data);
  const audio = String(kind) === "audio";
  const eff = { ...data, apiValues: { ...(data.apiValues || {}) } };
  const typedAt = (i) => {
    if (i === 0) return data.prompt || "";
    if (i === 1 && audio) return data.lyrics || "";
    const key = fields[i] ? textFieldId(fields[i]) : "";
    const stored = key ? (data.apiValues || {})[key] : undefined;
    return stored === undefined || stored === null ? String(fields[i]?.default ?? "") : stored;
  };
  const valueAt = (i) => (i < wired.length ? wired[i] : typedAt(i));
  eff.prompt = valueAt(0);
  if (audio && fields.length > 1) eff.lyrics = valueAt(1);
  fields.forEach((field, i) => { eff.apiValues[textFieldId(field)] = valueAt(i); });
  return eff;
}

export function createPromptCompiler({ API, flow, SLOT_IDS, backend }) {
/* ---------------------------- generation ----------------------------- */

/* Edges carry the connection order; a generate node has four typed inputs, so
   the handle id is what tells us which kind of asset arrived. */
/* ComfyUI node-state semantics, mapped onto the canvas data flow:
     - muted   (Ctrl+M) = DISABLED. The node runs nothing and produces no
       output; a downstream consumer wired to it gets nothing (null).
     - ignored (Ctrl+B) = BYPASS / pass-through. The node runs nothing, but
       its input is forwarded unchanged: A -> ignored B -> C hands A's
       material/text straight to C.
   Cleanup pills have always behaved as pass-through links; they share the
   bypass path here. Walk upstream through every pass-through node until we
   reach one that actually carries material/text. A muted node terminates the
   chain with no output. Returns null when nothing is left to forward. */
function resolvePassThrough(sourceNode, visited) {
  visited = visited || new Set();
  if (!sourceNode) return null;
  /* Disabled: no output at all, even in the middle of a bypass chain. */
  if (sourceNode.data?.muted) return null;
  const passes = sourceNode.data?.role === "cleanup" || !!sourceNode.data?.ignored;
  if (!passes) return sourceNode;
  if (visited.has(sourceNode.id)) return null;
  visited.add(sourceNode.id);
  const nodes = flow()?.nodesOf?.() || [];
  for (const edge of flow()?.edgesOf?.() || []) {
    if (edge.target !== sourceNode.id) continue;
    const up = nodes.find((entry) => entry.id === edge.source);
    const resolved = resolvePassThrough(up, visited);
    if (resolved && (resolved.data?.asset || resolved.data?.result || resolved.data?.role === "text")) {
      return resolved;
    }
  }
  return null;
}

/* Cleanup pills sitting on the upstream paths of `node`, in wire order. A
   generator run submits these jobs BEFORE its own prompt; the native ComfyUI
   queue is FIFO, so memory is cleared first and generation continues after. */
function collectUpstreamCleanups(node) {
  const found = [];
  const visited = new Set();
  const nodes = flow()?.nodesOf?.() || [];
  const walk = (current) => {
    for (const edge of flow()?.edgesOf?.() || []) {
      if (edge.target !== current.id) continue;
      const up = nodes.find((entry) => entry.id === edge.source);
      if (!up || visited.has(up.id)) continue;
      visited.add(up.id);
      /* A disabled (muted) or bypassed (ignored) cleanup pill does not run
         its memory-reclaim job; in both states it is an inert pass-through. */
      if (up.data?.role === "cleanup" && !up.data?.muted && !up.data?.ignored) found.push(up);
      /* Traverse through every upstream node so cleanups nested behind a
         material/generator node are caught too. */
      walk(up);
    }
  };
  walk(node);
  /* DFS from the generator finds the pill nearest B first; reverse so the
     jobs are submitted in data-flow order (source → B). */
  return found.reverse();
}

function collectInputs(node) {
  const result = [];
  /* A single source wired into this node more than once is ONE input. Dedupe
     by RESOLVED source id so A direct + A-through-cleanup count as one. */
  const seenSources = new Set();
  const nodes = flow()?.nodesOf?.() || [];
  for (const edge of flow()?.edgesOf?.() || []) {
    if (edge.target !== node.id) continue;
    const raw = nodes.find((entry) => entry.id === edge.source);
    /* Cleanup / ignored nodes are pass-through (A -> X -> B delivers A's
       material to B); muted nodes are disabled and yield no input. The slot
       still comes from THIS edge's targetHandle on the generator. */
    const source = resolvePassThrough(raw);
    if (!source || seenSources.has(source.id)) continue;
    seenSources.add(source.id);
    /* The generator echoes its result on itself (data.result); there is no separate
       result node, and it can still feed a downstream generator — accept both forms. */
    const asset = source.data?.asset || source.data?.result;
    /* A text-merge pill carries its joined result in data.text just like a
       normal text node — advertise it as "text" so generators read it via
       the existing prompt path (no extra slot/branch needed). */
    const kind = source.data?.role === "text_merge" ? "text"
      : (source.data?.kind || asset?.kind || (source.data?.role === "text" ? "text" : null));
    /* A text node is a PROMPT input, not an asset — it legitimately has no
       asset, so don't drop it. Media nodes still require an asset. */
    if (!asset && kind !== "text") continue;
    const slot = SLOT_IDS.indexOf(edge.targetHandle);
    result.push({
      slot: slot < 0 ? 0 : slot,
      name: edge.targetHandle || "",
      asset: asset || null,
      kind,
      text: source.data.text || source.data.result?.text || source.data.asset?.text || "",
    });
  }
  return result;
}

/* LoRA stack nodes wired into a generator contribute their enabled entries.
   Walks the SAME incoming edges as collectInputs; a generator may have more
   than one LoRA stack wired in, so entries are concatenated in wire order.
   Duplicate filenames collapse (first wins) so the same model is never
   applied twice when two stacks overlap. */
function collectLoras(node) {
  const entries = [];
  const seen = new Set();
  const nodes = flow()?.nodesOf?.() || [];
  for (const edge of flow()?.edgesOf?.() || []) {
    if (edge.target !== node.id) continue;
    const source = nodes.find((entry) => entry.id === edge.source);
    if (source?.data?.role !== "lora") continue;
    /* A muted (disabled) or ignored (bypassed) LoRA stack contributes
       nothing — same as ComfyUI where a muted/bypassed loader is skipped. */
    if (source.data?.muted || source.data?.ignored) continue;
    for (const item of (source.data.loras || [])) {
      if (!item || item.enabled === false || !item.name || seen.has(item.name)) continue;
      seen.add(item.name);
      entries.push({ name: item.name, strength: Number(item.strength) });
    }
  }
  return entries;
}

/* Inject the LoRA chain into a built prompt. ComfyUI's LoraLoaderModelOnly
   takes a MODEL and returns a MODEL, so stacks chain naturally: the first
   LoRA reads the template's original MODEL source and every consumer of that
   source is rewired to the chain tail. A consumer is any node whose `model`
   input is a link [nodeId, slot]; the source is the node at the other end.
   Templates with no MODEL link (pure audio/text prompts) are left alone. */
function injectLoras(prompt, loras) {
  const active = (loras || []).filter((entry) => entry && entry.name && Number.isFinite(entry.strength));
  if (!active.length) return;
  /* Collect MODEL links: { consumer, key, sourceId }. A link is an array
     whose first element is the upstream node id. */
  const links = [];
  for (const [id, node] of Object.entries(prompt)) {
    if (!node?.inputs) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (key !== "model" || !Array.isArray(value) || !value.length) continue;
      const sourceId = String(value[0]);
      if (!prompt[sourceId]) continue;
      links.push({ id, key, sourceId });
    }
  }
  if (!links.length) return;
  /* Only TRUE sources get a chain: a node referenced by `model` that itself
     has no `model` input (CheckpointLoaderSimple / UNETLoader). A node sitting
     in the middle of a template's existing LoRA chain (e.g. a bundled
     LoraLoaderModelOnly) is BOTH a consumer and a source — injecting there
     would modulate twice and rewire the sampler away from the template chain. */
  const consumerIds = new Set(links.map((link) => link.id));
  const bySource = new Map();
  for (const link of links) {
    if (consumerIds.has(link.sourceId)) continue;
    if (!bySource.has(link.sourceId)) bySource.set(link.sourceId, []);
    bySource.get(link.sourceId).push(link);
  }
  if (!bySource.size) return;
  let seq = 0;
  for (const [sourceId, consumers] of bySource) {
    let tail = sourceId;
    for (const lora of active) {
      const chainId = "_xcat_lora_" + (++seq);
      prompt[chainId] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          model: [tail, 0],
          lora_name: lora.name,
          strength_model: Math.max(-100, Math.min(100, lora.strength)),
        },
        _meta: { title: "LoRA · " + lora.name.split(/[\\/]/).pop() },
      };
      tail = chainId;
    }
    for (const consumer of consumers) {
      prompt[consumer.id].inputs[consumer.key] = [tail, 0];
    }
  }
}

/* All nodes upstream of a CONDITIONING link, through the usual combiners.
   Used for BOTH branches: the negative side must be mapped first, because a
   ConditioningCombine's second input is frequently the negative condition —
   following it from `positive` would leak trigger words into the negative
   text encoder. */
function conditioningNodeIds(prompt, condId, seen = new Set()) {
  const id = String(condId || "");
  if (!id || seen.has(id) || !prompt[id]) return [];
  seen.add(id);
  const out = [id];
  for (const key of ["conditioning", "conditioning_1", "conditioning_2", "conditioning_to", "conditioning_from"]) {
    const link = prompt[id].inputs?.[key];
    if (!Array.isArray(link) || !link.length) continue;
    out.push(...conditioningNodeIds(prompt, link[0], seen));
  }
  return out;
}

/* LoRA stacks wired into a generator also bring their trigger words. They go
   into the POSITIVE text encoder — the CLIPTextEncode feeding KSampler.positive
   (the "text position of the clip before the positive condition") — not into
   the canvas prompt field, so the user's own prompt stays untouched. Prefixed
   in stack order, de-duplicated, and skipped when already present. */
function injectLoraTriggers(prompt, words) {
  if (!words || !words.length) return;
  /* Map every NEGATIVE conditioning chain first, then exclude those nodes
     from the positive targets even if a combiner shares both branches. */
  const negativeIds = new Set();
  const targets = new Set();
  for (const node of Object.values(prompt)) {
    const neg = node?.inputs?.negative;
    if (Array.isArray(neg) && neg.length) {
      for (const id of conditioningNodeIds(prompt, neg[0])) negativeIds.add(id);
    }
    const pos = node?.inputs?.positive;
    if (Array.isArray(pos) && pos.length) {
      for (const id of conditioningNodeIds(prompt, pos[0])) targets.add(id);
    }
  }
  for (const id of negativeIds) targets.delete(id);
  for (const id of [...targets]) {
    if (!/^CLIPTextEncode/.test(String(prompt[id]?.class_type || ""))) targets.delete(id);
  }
  if (!targets.size) return;
  for (const id of targets) {
    const text = prompt[id]?.inputs?.text;
    if (typeof text !== "string") continue;                 /* linked STRING input */
    const trimmed = text.trim();
    const present = new Set(trimmed.split(/[,\n]+/).map((part) => part.trim().toLowerCase()).filter(Boolean));
    const missing = words.filter((word) => !present.has(word.toLowerCase()));
    if (!missing.length) continue;
    prompt[id].inputs.text = missing.join(", ") + (trimmed ? ", " + trimmed : "");
  }
}

/* --- generic media slot injection -------------------------------------
   Autogrow nodes (MiniMax H3 image editing / reference-to-video) expose a
   RUN of media slots: input keys ending in image_N / video_N /
   video_audio_N / audio_N whose value is a link. Each slot resolves upstream
   - across resize/extract/scale nodes - to a LOAD source (LoadImage /
   LoadVideo / LoadAudio). Slots are grouped by SOURCE NODE, never by key: a
   video-frame slot (video_N) and its audio slot (video_audio_N) trace back to
   the SAME LoadVideo and are one group, so setting that one file updates both
   paths (the "one source, two ports" case). Consumers may spell the same
   source with different keys; every key joins the group and all move together.

   media = { image:[path,...], video:[path,...], audio:[path,...] } in wire
   order. Groups per kind are sorted by slot index; the Nth asset fills the
   Nth group. Extra groups are detached (keys + orphaned chain nodes).

   Capacity per kind = caps[kind] (from the workflow's declared _mediaCaps)
   when given, else the template's own slot count. When a declared cap exceeds
   the template's slots, missing groups are grown by cloning a template group's
   whole source chain and adding matching keys at every consumer — this mirrors
   the front-end's floating/autogrow ports. Templates with no such slots
   (legacy {{image}} / single-image) stay untouched. */
const MEDIA_SLOT_RE = [
  /^(.*?)video_audio_?(\d+)$/,
  /^(.*?)ref_image_?(\d+)$/,
  /^(.*?)image_?(\d+)$/,
  /^(.*?)video_?(\d+)$/,
  /^(.*?)audio_?(\d+)$/,
];
const LOAD_KIND = { LoadImage: "image", LoadVideo: "video", LoadAudio: "audio" };
const LOAD_FIELD = { image: "image", video: "file", audio: "audio" };

function mediaSlotNum(key) {
  for (const re of MEDIA_SLOT_RE) { const m = re.exec(key); if (m) return Number(m[2]); }
  return -1;
}

/* Walk up from a slot's endpoint to a LOAD source, collecting every node on
   the way (endpoint -> ... -> source). Returns null when no LOAD is found, so
   ordinary links such as CreateVideo.images are never mistaken for slots. */
function traceMediaChain(prompt, startId) {
  const chain = [];
  const seen = new Set();
  let id = String(startId);
  while (id && prompt[id] && !seen.has(id)) {
    seen.add(id);
    const node = prompt[id];
    if (LOAD_KIND[node.class_type]) return { source: id, chain: chain.concat(id) };
    chain.push(id);
    const entries = Object.entries(node.inputs || {});
    entries.sort((a, b) => {
      const rank = (k) => /^(image|images|video|audio|pixels|input)$/.test(k) ? 0 : 1;
      return rank(a[0]) - rank(b[0]);
    });
    let next = null;
    for (const [, value] of entries) {
      if (Array.isArray(value) && value.length && prompt[String(value[0])]) { next = String(value[0]); break; }
    }
    if (!next) return null;
    id = next;
  }
  return null;
}

function scanMediaGroups(prompt) {
  const groups = new Map();
  for (const [consumerId, node] of Object.entries(prompt)) {
    if (!node?.inputs) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      const num = mediaSlotNum(key);
      if (num < 0 || !Array.isArray(value) || !value.length) continue;
      const endpoint = String(value[0]);
      if (!prompt[endpoint]) continue;
      const traced = traceMediaChain(prompt, endpoint);
      if (!traced) continue;
      const sourceNode = prompt[traced.source];
      const kind = LOAD_KIND[sourceNode.class_type];
      if (!kind) continue;
      let group = groups.get(traced.source);
      if (!group) {
        group = { source: traced.source, kind, slots: [], chain: new Set(), minNum: num };
        groups.set(traced.source, group);
      }
      group.slots.push({ consumerId, key, num, endpoint, slotIndex: Number(value[1]) || 0 });
      traced.chain.forEach((n) => group.chain.add(n));
      if (num < group.minNum) group.minNum = num;
    }
  }
  const byKind = { image: [], video: [], audio: [] };
  for (const g of groups.values()) if (byKind[g.kind]) byKind[g.kind].push(g);
  for (const list of Object.values(byKind)) list.sort((a, b) => a.minNum - b.minNum);
  return { groups, byKind };
}

function makeMediaIdGen(prompt) {
  let n = 0;
  return () => { let id; do { id = "_xcat_m" + (++n); } while (prompt[id]); return id; };
}

function renumberSlotKey(key, newNum) {
  const m = /^(.*?)(\d+)$/.exec(key);
  return m ? m[1] + newNum : null;
}

/* Next free slot number = max numeric suffix across ALL consumers sharing any
   of this group's key prefixes, plus one. Scanning prefixes keeps numbering
   contiguous when one kind is spelled with several key styles. */
function nextMediaSlotNum(prompt, group) {
  const prefixes = new Set();
  for (const slot of group.slots) {
    const m = /^(.*?)(\d+)$/.exec(slot.key);
    if (m) prefixes.add(m[1]);
  }
  let max = -1;
  for (const node of Object.values(prompt)) {
    if (!node?.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      const m = /^(.*?)(\d+)$/.exec(key);
      if (m && prefixes.has(m[1])) max = Math.max(max, Number(m[2]));
    }
  }
  return max + 1;
}

/* Clone a group's entire source chain (LOAD + every node on the path to its
   consumers), rewiring internal refs to new ids, then add a fresh slot key at
   every consumer. Preserves main-image resize chains / video->audio pairing. */
function cloneMediaGroup(prompt, group, idGen) {
  const newNum = nextMediaSlotNum(prompt, group);
  const idMap = {};
  for (const cid of group.chain) idMap[cid] = idGen();
  for (const cid of group.chain) {
    const node = prompt[cid];
    if (!node) continue;
    const copy = JSON.parse(JSON.stringify(node));
    for (const value of Object.values(copy.inputs || {})) {
      if (Array.isArray(value) && value.length && idMap[String(value[0])] !== undefined) {
        value[0] = idMap[String(value[0])];
      }
    }
    prompt[idMap[cid]] = copy;
  }
  for (const slot of group.slots) {
    const newKey = renumberSlotKey(slot.key, newNum);
    if (!newKey || !prompt[slot.consumerId]?.inputs) continue;
    prompt[slot.consumerId].inputs[newKey] = [idMap[slot.endpoint] || slot.endpoint, slot.slotIndex];
  }
  return true;
}

function detachMediaGroup(prompt, group) {
  for (const slot of group.slots) {
    if (prompt[slot.consumerId]?.inputs) delete prompt[slot.consumerId].inputs[slot.key];
  }
  /* Delete chain nodes no longer referenced by any input. A legitimately
     shared node (e.g. a main image's resize path still in use) stays. */
  for (const cid of group.chain) {
    if (!prompt[cid]) continue;
    let referenced = false;
    for (const node of Object.values(prompt)) {
      if (!node?.inputs) continue;
      for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value) && value.length && String(value[0]) === cid) { referenced = true; break; }
      }
      if (referenced) break;
    }
    if (!referenced) delete prompt[cid];
  }
}

function injectMediaSlots(prompt, media, caps) {
  let { byKind } = scanMediaGroups(prompt);
  if (!byKind.image.length && !byKind.video.length && !byKind.audio.length) return 0;
  const idGen = makeMediaIdGen(prompt);
  /* One limit per kind, reused by grow + fill: a declared _mediaCaps value is
     the hard cap; without a declaration we stay at the template's slot count
     (never grow). Want = min(wired, limit). */
  const limitOf = (kind, slots) => {
    const declared = Number(caps?.[kind]);
    return Number.isFinite(declared) && declared > 0 ? declared : slots;
  };
  for (const kind of ["image", "video", "audio"]) {
    const wired = (media[kind] || []).length;
    const want = Math.min(wired, limitOf(kind, byKind[kind].length));
    while (byKind[kind].length < want) {
      const tpl = byKind[kind][byKind[kind].length - 1];
      if (!tpl) break;
      const before = byKind[kind].length;
      cloneMediaGroup(prompt, tpl, idGen);
      ({ byKind } = scanMediaGroups(prompt));
      if (byKind[kind].length <= before) break;
    }
  }
  /* Fill in wire order, capped by the declared limit, and detach every group
     left unconnected so a demo asset can't leak into the result. */
  let total = 0;
  for (const kind of ["image", "video", "audio"]) {
    const list = byKind[kind];
    const paths = media[kind] || [];
    const fill = Math.min(list.length, paths.length, limitOf(kind, list.length));
    for (let i = 0; i < fill; i++) {
      const src = prompt[list[i].source];
      if (src?.inputs) src.inputs[LOAD_FIELD[kind]] = paths[i];
    }
    for (let i = fill; i < list.length; i++) detachMediaGroup(prompt, list[i]);
    total += fill;
  }
  return total;
}

/* Fallback for stock workflows whose LoadImage is hard-coded to an example
   filename (e.g. BiRefNet background removal ships "the_lily_veil.png"), with
   neither a {{image}} token nor an image_N slot. All the mechanisms above
   miss those, so the example name survives into the API prompt and ComfyUI
   rejects it as "Invalid image file". When nothing else claimed the main
   image, write the first wired picture into every bare LoadImage (a literal
   string `image`, not a link). Gated strictly by state so {{image}}, legacy
   img2img and image_N templates stay untouched. */
function injectBareLoadImage(prompt, paths, state) {
  if (!paths || !paths.length || !state || state.placeholder || state.slots) return 0;
  const bare = Object.keys(prompt).filter((id) => {
    const node = prompt[id];
    return node && node.class_type === "LoadImage"
      && node.inputs && typeof node.inputs.image === "string";
  }).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
  let filled = 0;
  for (let i = 0; i < bare.length && i < paths.length; i++) {
    prompt[bare[i]].inputs.image = paths[i];
    filled++;
  }
  return filled;
}

function assetPath(asset) {
  return (asset.subfolder ? asset.subfolder + "/" : "") + (asset.filename || "");
}

/* Audio generator: the panel's two text areas and the API-exposed widgets are
   written into the workflow's own LITERAL inputs. Templates that carry no
   {{placeholders}} (MiniMax music / voice design…) still receive them.
     audioMap  = { a: "nodeId:key", b: "nodeId:key" } for 提示词/语气 + 歌词/朗读文本
     apiValues = every right-hand widget, keyed the same way
   Both deliberately OVERWRITE the template value: an explicit user value
   beats whatever default the workflow file shipped with. Unlinked inputs only
   — a linked input (["node", 0]) is data, not a parameter. */
function applyNodeInputs(target, data, areaA) {
  if (!target || typeof target !== "object") return;
  const writes = [];
  const map = data?.audioMap || {};
  /* `areaA` is the first input area INCLUDING any wired text node, so a text
     wire reaches the workflow even when the user typed nothing. */
  if (map.a) writes.push([map.a, areaA ?? data.prompt ?? ""]);
  if (map.b) writes.push([map.b, data.lyrics ?? ""]);
  /* The prompt of an image / video / text generator is edited in the node's
     own text area, not in the settings popover; `promptMap` says which
     exposed input it belongs to. An empty area leaves the workflow's own
     default alone instead of wiping it. */
  const promptId = data?.promptMap || "";
  if (promptId && (areaA ?? data.prompt ?? "")) writes.push([promptId, areaA ?? data.prompt ?? ""]);
  for (const [id, value] of Object.entries(data?.apiValues || {})) {
    if (promptId && id === promptId) continue;
    writes.push([id, value]);
  }
  for (const [id, value] of writes) {
    /* Subgraph node ids themselves contain a colon (e.g. "37:13"), so the
       composite key is "37:13:caption". split(":") would cut it into
       ["37","13","caption"] and silently skip every such field — captions,
       lyrics, seed, steps, sampler… Split at the LAST colon instead, exactly
       like injectFallbackPrompt / injectExposedFields do. */
    const composite = String(id);
    const cut = composite.lastIndexOf(":");
    const nodeId = cut > 0 ? composite.slice(0, cut) : composite;
    const key = cut > 0 ? composite.slice(cut + 1) : "";
    const node = target[nodeId];
    if (!node || !key || !node.inputs || !(key in node.inputs)) continue;
    if (Array.isArray(node.inputs[key])) continue;
    /* Copy-on-write so the caller's template object is never mutated. */
    target[nodeId] = { ...node, inputs: { ...node.inputs, [key]: value } };
  }
}

/* Exposed multiline text params must land somewhere. An old or hand-built node may
   carry a stale promptMap (e.g. "9:text" on SaveImage); applyNodeInputs silently skips
   it via `!(key in node.inputs)`, so the user's words never reach the workflow — the
   box is drawn and data.prompt is saved, but the template's default prompt is submitted.
   Trace from the sampler's positive port to the real positive text-encode node and write
   the words there. Only fall back when nothing else took over: template {{prompt}}/{{text}},
   or a promptMap pointing at a real literal input. Neither case touches another node. */
const FALLBACK_SAMPLER = /(Sampler|SamplerCustom|SamplerCustomAdvanced)/i;
const FALLBACK_TEXT_NODE = /^(CLIPTextEncode|TextEncodeQwen.*|CLIPTextEncodeFlux|PrimitiveStringMultiline|CR Prompt Text|MOSSImageLayoutPrompt|MiniMaxH3.*ToVideo|.*Prompt.*)$/i;
const FALLBACK_POSITIVE_PORT = /^(positive|positive_prompt)$/i;
const FALLBACK_TEXT_PORT = /^(text|prompt|value|caption)$/i;

function fallbackPromptTargets(prompt) {
  const sources = [];
  for (const node of Object.values(prompt)) {
    if (!node?.inputs || !FALLBACK_SAMPLER.test(String(node.class_type || ""))) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!FALLBACK_POSITIVE_PORT.test(key) || !Array.isArray(value) || !value.length) continue;
      sources.push(String(value[0]));
    }
  }
  const out = [];
  const seen = new Set();
  for (const id of sources) {
    const node = prompt[id];
    if (!node?.inputs || !FALLBACK_TEXT_NODE.test(String(node.class_type || ""))) continue;
    for (const key of Object.keys(node.inputs)) {
      if (!FALLBACK_TEXT_PORT.test(key)) continue;
      if (typeof node.inputs[key] !== "string") continue;
      const token = id + ":" + key;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push({ nodeId: id, key });
    }
  }
  return out;
}

function injectFallbackPrompt(prompt, data, areaA, hadToken) {
  const text = String(areaA ?? data?.prompt ?? "");
  if (hadToken || !text.trim()) return 0;
  /* A working promptMap already delivered the text via applyNodeInputs. */
  const map = String(data?.promptMap || "");
  if (map) {
    const i = map.lastIndexOf(":");
    const node = i > 0 ? prompt[map.slice(0, i)] : null;
    const key = i > 0 ? map.slice(i + 1) : "";
    if (node?.inputs && key && key in node.inputs
        && !Array.isArray(node.inputs[key]) && typeof node.inputs[key] === "string") return 0;
  }
  let filled = 0;
  for (const { nodeId, key } of fallbackPromptTargets(prompt)) {
    const node = prompt[nodeId];
    prompt[nodeId] = { ...node, inputs: { ...node.inputs, [key]: text } };
    filled++;
  }
  return filled;
}

/* Global invariant: every field exposed in the settings panel must land in the
   submitted workflow, its current value included. This is the single rule regardless
   of a param's source, type or name — auto-detected or manually exposed, all alike.

   The main channel is applyNodeInputs: it walks every key of data.apiValues and writes
   it to the exact nodeId:key, picking neither name nor type. Day-to-day edits (panel
   change → apiValues → workflow) go through it and are naturally generic.

   This layer handles only anomalies: a node's field list may be stale (a legacy node
   with an old snapshot, or a template whose node id changed / workflow was swapped);
   then the exact path is silently skipped at `!(key in node.inputs)` — the panel value
   changes but the template default is submitted. The UI field list now follows the
   template live, yet old canvases can still hold dirty snapshots, so keep the fallback:
   relocate any exposed field (any name) by same-name key to a literal input in the
   template. A seed/steps/cfg whitelist used to live here and blocked manual params
   like shift / sampling / clip_name when mapping broke; it was removed — no name-based
   picking. Text fields are not handled here: the main prompt is filled by
   injectFallbackPrompt down the sampler positive port (so field.default never
   overwrites the user's words); other text boxes are written by applyNodeInputs. */
function injectExposedFields(prompt, data) {
  const list = data?.fieldSnapshot?.list || [];
  if (!list.length) return 0;
  const apiValues = data?.apiValues || {};
  let filled = 0;
  for (const field of list) {
    const nodeId = String(field?.nodeId || "");
    const key = String(field?.key || "");
    if (!key) continue;
    const type = String(field?.type || "");
    if (type === "text" || type === "textarea") continue;
    const raw = apiValues[nodeId + ":" + key];
    const value = raw === undefined || raw === null ? field.default : raw;
    if (value === undefined || value === null) continue;
    /* Exact path: the original mapping node is still present and its input is a literal. */
    const exact = prompt[nodeId];
    if (exact?.inputs && (key in exact.inputs) && !Array.isArray(exact.inputs[key])) {
      if (exact.inputs[key] !== value) {
        prompt[nodeId] = { ...exact, inputs: { ...exact.inputs, [key]: value } };
        filled++;
      }
      continue;
    }
    /* Mapping broken: relocate every param name by same-name key across all literal inputs.
       Only write type-compatible targets, so a string never lands in a number input. */
    const wantType = typeof value;
    for (const [id, node] of Object.entries(prompt)) {
      if (!node?.inputs || !(key in node.inputs) || Array.isArray(node.inputs[key])) continue;
      if (typeof node.inputs[key] !== wantType) continue;
      if (node.inputs[key] === value) continue;
      prompt[id] = { ...node, inputs: { ...node.inputs, [key]: value } };
      filled++;
    }
  }
  return filled;
}

/* Seeds are 64-bit in ComfyUI. Only fall back to a random pick when the panel
   actually has no value -- `Number(data.seed) || x` used to rewrite a legal 0. */
function seedOrRandom(raw) {
  const value = Number(raw);
  if (raw !== "" && raw !== null && raw !== undefined && Number.isFinite(value)) return value;
  return Math.floor(Math.random() * SAFE_INT_MAX);
}

async function buildPrompt(kind, template, data, inputs, loras = []) {
  let checkpoint = "";
  try {
    const defs = await API().getNodeDefs();
    checkpoint = defs?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0] || "";
  } catch (error) { /* object_info may be unavailable */ }
  const find = (wanted) => inputs.find((entry) => entry.kind === wanted)?.asset || null;
  /* LoadImage / LoadVideo / LoadAudio read only input/, while results land in output/ —
     the generate → upscale / edit / regenerate chain used to throw and force the user to
     re-drop the image. Now ask the backend to copy the file into input/infcanvas (once),
     then pass the returned ref to the template. Old backends keep the original error. */
  const MEDIA_LABEL = { image: "core.image", video: "field.video", audio: "field.audio" };
  async function ensureInputAsset(asset, kind) {
    if (!asset || !asset.filename) return asset;
    if ((asset.type || "input") === "input") return asset;
    try {
      const api = API();
      const res = await api.fetchApi("/infcanvas/media/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: asset.filename,
          subfolder: asset.subfolder || "",
          type: asset.type || "input",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const next = data?.asset;
        if (next?.filename) {
          return { ...asset, filename: next.filename, subfolder: next.subfolder || "", type: "input" };
        }
      }
    } catch (error) { /* Old backend has no /media/import — fall through to the error below */ }
    throw new Error(window.InfCanvas.i18n.t("core.mustComeFromInput", { label: window.InfCanvas.i18n.t(MEDIA_LABEL[kind] || "field.text") }));
  }
  /* Only move material the template really uses: text nodes also accept image/video, but
     with no {{image}} placeholder there is no point copying a 100MB video. */
  const templateText = JSON.stringify(template);
  const hadPromptToken = templateText.includes("{{prompt}}") || templateText.includes("{{text}}");
  const legacyImage = !!(template["3"] && template["4"] && template["5"]);
  const consumed = {
    image: templateText.includes("{{image}}") || legacyImage,
    video: templateText.includes("{{video}}"),
    audio: templateText.includes("{{audio}}"),
  };
  const take = async (wanted) => {
    const asset = find(wanted);
    return consumed[wanted] ? await ensureInputAsset(asset, wanted) : asset;
  };
  const image = await take("image");
  const video = await take("video");
  const audio = await take("audio");
  /* One box <=> one wire: wire i fills text box i (prompt / lyrics / extra
     exposed text fields), in wire order. Boxes without a wire keep their
     typed value. Nothing is joined any more. Effective values feed BOTH the
     placeholder pass and the exact nodeId:key writes below. */
  const boxed = effectiveTextData(data, inputs, kind);
  const areaA = boxed.prompt || "";
  const promptText = areaA || "a photo";
  if (!checkpoint && JSON.stringify(template).includes("{{checkpoint}}")) {
    throw new Error(window.InfCanvas.i18n.t("core.noCheckpoint"));
  }
  const values = {
    prompt: promptText,
    negative: data.negative || "",
    text: promptText,
    /* Audio generator aliases: the second area is 歌词 (music) / 朗读文本
       (voice), the first one doubles as 语气 for voice templates. */
    lyrics: boxed.lyrics || "",
    tone: areaA,
    /* 0 is a legal seed, so test for absence rather than truthiness; the
       fallback stays inside the same 64-bit range object_info reports. */
    seed: seedOrRandom(data.seed),
    steps: Number(data.steps) || 20,
    width: Number(data.width) || 512,
    height: Number(data.height) || 512,
    checkpoint, prefix: kind + "_" + Date.now(),
    image: image ? assetPath(image) : "",
    video: video ? assetPath(video) : "",
    audio: audio ? assetPath(audio) : "",
  };
  const clean = {};
  for (const [key, value] of Object.entries(template)) {
    if (!key.startsWith("_")) clean[key] = value;
  }
  let raw = JSON.stringify(clean);
  for (const [key, value] of Object.entries(values)) {
    const quoted = '"{{' + key + '}}"';
    const replacement = typeof value === "number" ? String(value) : JSON.stringify(String(value));
    raw = raw.split(quoted).join(replacement);
    const inner = JSON.stringify(String(value)).slice(1, -1);
    raw = raw.split("{{" + key + "}}").join(inner);
  }
  /* Only a bare `{{identifier}}` token is a placeholder. A template's own
     text may legitimately contain literal double braces — e.g. MINIMAX H3
     IMAGE's system prompt embeds a {{"expanded_caption":...,"aspect_ratio":...}}
     JSON example — which are data, not placeholders. Match only the token
     form so those examples survive, and name any truly unknown token. */
  const unknownTokens = raw.match(/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/g);
  if (unknownTokens && unknownTokens.length) {
    throw new Error(window.InfCanvas.i18n.t("core.unknownPlaceholder") + [...new Set(unknownTokens)].join(", "));
  }
  const prompt = JSON.parse(raw);
  /* Audio panel values beat the template's own defaults. Applied AFTER the
     placeholder pass so the user's own text is never scanned for {{tokens}}
     (a lyric may legitimately contain braces). */
  applyNodeInputs(prompt, boxed, areaA);
  /* Exposed multiline text with a stale/invalid promptMap would otherwise be
     dropped above; find the real positive text node and write it there. */
  injectFallbackPrompt(prompt, boxed, areaA, hadPromptToken);
  /* Every other exposed parameter (seed / steps / cfg / …) must reach the
     workflow too, even when the node holds a stale field snapshot. */
  injectExposedFields(prompt, boxed);
  if (image && prompt["3"]?.inputs && prompt["4"] && prompt["5"]) {
    prompt["1001"] = { class_type: "LoadImage", inputs: { image: values.image } };
    prompt["1002"] = { class_type: "VAEEncode", inputs: { pixels: ["1001", 0], vae: ["4", 2] } };
    prompt["3"].inputs.latent_image = ["1002", 0];
    delete prompt["5"];
  }
  /* Generic media slots: when the template exposes a run of image / video /
     audio slots (autogrow MiniMax H3 conditioning, ref-to-video, batch nodes),
     wire EVERY connected asset, in wire order, into its kind's slots. Capacity
     comes from the workflow's declared _mediaCaps (written at upload time);
     without it we fall back to the template's own slot count. Missing slots are
     grown by cloning the source chain up to that cap. No slots => no-op, so
     single-image / {{image}} templates keep their existing behaviour. Assets
     are ensured into input/ first (idempotent). */
  const mediaIn = { image: [], video: [], audio: [] };
  for (const entry of inputs) {
    if (!entry.asset || !(entry.kind in mediaIn)) continue;
    mediaIn[entry.kind].push(assetPath(await ensureInputAsset(entry.asset, entry.kind)));
  }
  if (mediaIn.image.length || mediaIn.video.length || mediaIn.audio.length) {
    injectMediaSlots(prompt, mediaIn, template?._mediaCaps);
  }
  /* Bare-LoadImage fallback: single-image stock workflows (BiRefNet, RMBG,
     CUCIDA…) hard-code an example filename with no {{image}} token and no
     image_N slot, so injectMediaSlots fills nothing and ComfyUI validates the
     example name. If no other path claimed the image, rewrite those bare
     LoadImage nodes in wire order. Skipped when a placeholder / legacy img2img
     path already set the image, or when slot injection found real groups. */
  if (mediaIn.image.length) {
    const hasPlaceholder = consumed.image || legacyImage;
    const slotGroups = scanMediaGroups(prompt).byKind.image.length;
    injectBareLoadImage(prompt, mediaIn.image, {
      placeholder: hasPlaceholder,
      slots: slotGroups > 0,
    });
  }
  /* Trigger words from wired LoRA stacks go into the POSITIVE text encoder.
     Await the shared sidecar fetch first: the stack card may have started it
     but not finished when Generate was pressed, and a missing word here would
     silently change the generated image. */
  if (loras && loras.length) {
    await ensureLoraMeta(loras, backend);
    injectLoraTriggers(prompt, combinedTriggers(loras));
  }
  /* LoRA stacks are wired into the generator as MODEL modifiers. Inject AFTER
     every other mutation so the rewired MODEL links are the final ones. */
  injectLoras(prompt, loras);
  return prompt;
}


  return {
    resolvePassThrough, collectUpstreamCleanups, collectInputs, collectLoras,
    injectLoras, injectLoraTriggers, mediaSlotNum, traceMediaChain, scanMediaGroups,
    makeMediaIdGen, renumberSlotKey, nextMediaSlotNum, cloneMediaGroup,
    detachMediaGroup, injectMediaSlots, injectBareLoadImage, assetPath,
    applyNodeInputs, fallbackPromptTargets, injectFallbackPrompt, injectExposedFields, seedOrRandom, buildPrompt,
  };
}
