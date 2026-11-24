/* Canvas document model (batch 6): node type schema, draft/tab persistence
   and every document/tab command. Extracted from infcanvas-core.js. Host
   helpers (toast/dialogs/storage/state/flow/backend) are injected explicitly;
   all symbols are returned so core can rebind them without changing callers. */
export function createModel({ NS, tr, API, refreshViewUrl, renewDocGalleryUrls, backend, uid, readTextFile, toast, confirmDialog, promptDialog, state, TABS_KEY, DRAFT_KEY, META_KEY, storageRead, storageWrite, storageRemove, flow, activeDoc, autoSaveEnabled, autoSaveDelay }) {
const SPECS = [
  { type: "infcanvas/media_image", role: "media", kind: "image", title: "core.image", desc: "core.imageAssetGenerateImageComfyui", icon: "pi pi-image", workflow: "image", size: [480, 270] },
  { type: "infcanvas/media_video", role: "media", kind: "video", title: "field.video", desc: "core.videoAssetGenerateVideoComfyui", icon: "pi pi-video", workflow: "video", size: [480, 270] },
  { type: "infcanvas/media_audio", role: "media", kind: "audio", title: "field.audio", desc: "core.audioAssetGenerateAudioComfyui", icon: "pi pi-volume-up", workflow: "audio", size: [480, 270] },
  { type: "infcanvas/asset_text", role: "text", kind: "text", title: "field.text", desc: "core.textAsset", icon: "pi pi-align-left", size: [480, 270] },
  /* Universal generator: accepts a wire from ANY node (image / video / audio /
     text / lora / cleanup) and can run ANY workflow. Unlike the medium-specific
     generators it has no fixed input vocabulary and no mode tabs, so the
     workflow picker is deliberately left unfiltered (activeCategory === "").
     role "media" keeps it a generator (input handle + run panel); kind "omni"
     keeps it out of isImageGenData / isAudioGenData / isTextGenData so every
     wire is allowed. Self-links are rejected by the global guard. */
  { type: "infcanvas/universal_gen", role: "media", kind: "omni", title: "core.universal", desc: "core.acceptsAnyNodeRunsAny", icon: "pi pi-sparkles", workflow: "", size: [480, 270] },
  /* LoRA stack: a pure configuration node. It is wired INTO a generator as a
     MODEL modifier — never carries media, never produces an output file. Its
     loras ride along in data.loras and are injected into the workflow by
     buildPrompt() at run time (LoraLoaderModelOnly chain on the MODEL input). */
  { type: "infcanvas/lora_stack", role: "lora", kind: "lora", title: "core.loraStack", desc: "core.loraStackHint", icon: "pi pi-sliders-h", size: [480, 270] },
  /* Cleanup pills: pass-through nodes rendered as a 30px bar. Wire them
     between two nodes; when generation flows through, they reclaim resources
     before the job is submitted. `cleanupMode` (== kind) selects the job. */
  { type: "infcanvas/cleanup_vram", role: "cleanup", kind: "cleanup_vram", title: "core.clearVram", desc: "core.oneClickVramRelease", icon: "pi pi-bolt", size: [160, 30] },
  { type: "infcanvas/cleanup_ram", role: "cleanup", kind: "cleanup_ram", title: "core.clearRam", desc: "core.oneClickRamReclaim", icon: "pi pi-bolt", size: [160, 30] },
  { type: "infcanvas/cleanup_both", role: "cleanup", kind: "cleanup_both", title: "core.clearVramRam", desc: "core.oneClickVramReleaseRam", icon: "pi pi-bolt", size: [160, 30] },
  /* Text merge pill: a 30px bar like the cleanup pills. Wires several text
     nodes into it and it emits all their text joined by newlines. The merged
     result is written into data.text (as if typed), so every downstream
     reader — generators via collectInputs, audio panels via audioWired —
     sees it with no special case. `kind` is "text_merge" for the menu, but
     assetKindOf()/collectInputs() advertise it as "text" at run time. */
  { type: "infcanvas/text_merge", role: "text_merge", kind: "text_merge", title: "core.textCollage", desc: "core.joinMultipleTextsIntoOne", icon: "merge", size: [160, 30] },
];
const TYPE_BY_KIND = {
  image: "infcanvas/media_image",
  video: "infcanvas/media_video",
  audio: "infcanvas/media_audio",
  text: "infcanvas/asset_text",
  omni: "infcanvas/universal_gen",
  lora: "infcanvas/lora_stack",
  cleanup_vram: "infcanvas/cleanup_vram",
  cleanup_ram: "infcanvas/cleanup_ram",
  cleanup_both: "infcanvas/cleanup_both",
  text_merge: "infcanvas/text_merge",
};
const SPEC_BY_TYPE = Object.fromEntries(SPECS.map((spec) => [spec.type, spec]));
/* Every type ever written to disk points at the merged type now; the role
   lives in the node data, so old canvases load into the unified node. */
const LEGACY_TYPE = {
  "infcanvas/asset_image": "infcanvas/media_image",
  "infcanvas/asset_video": "infcanvas/media_video",
  "infcanvas/asset_audio": "infcanvas/media_audio",
  "infcanvas/asset_text": "infcanvas/asset_text",
  "infcanvas/gen_image": "infcanvas/media_image",
  "infcanvas/gen_video": "infcanvas/media_video",
  "infcanvas/gen_audio": "infcanvas/media_audio",
};
const TYPE_BY_LEGACY = Object.fromEntries(
  Object.entries(LEGACY_TYPE).map(([old, current]) => [old, SPEC_BY_TYPE[current]]));
/* Old type names keep working for saved graphs and for any script that still
   asks for "infcanvas/gen_image" — the merged node is what comes back. */
const specOf = (type) => SPEC_BY_TYPE[type] || TYPE_BY_LEGACY[type] || null;
NS.SPECS = SPECS;
NS.TYPE_BY_KIND = TYPE_BY_KIND;

const TITLE_H = 30;
const SLOT_IDS = ["image", "video", "audio", "text"];

/* Persist the tab list + each doc's meta. Called after every tab operation
   (new/open/close/switch/save/rename) so a refresh can rebuild the exact set. */
function persistTabs() {
  storageWrite(TABS_KEY, {
    ids: state.docs.map((doc) => doc.id),
    activeIndex: Math.max(0, state.docs.findIndex((doc) => doc.id === state.activeId)),
  });
  for (const doc of state.docs) {
    storageWrite(META_KEY(doc.id), { id: doc.id, name: doc.name, saved: !!doc.saved });
  }
}

/* Write a doc's current graph to its draft slot. Source of truth for unsaved
   canvases; for saved ones it is just a mirror used until the next disk save. */
function writeDraft(doc) {
  if (!doc) return;
  storageWrite(DRAFT_KEY(doc.id), {
    version: 2,
    nodes: doc.nodes || [],
    edges: doc.edges || [],
    groups: doc.groups || [],
    viewport: doc.viewport || null,
  });
}
function readDraft(id) { return storageRead(DRAFT_KEY(id)); }
function clearDraft(id) { storageRemove(DRAFT_KEY(id)); storageRemove(META_KEY(id)); }

/* ------------------------- document <-> nodes ------------------------- */

function newNodeId() { return "n_" + uid().slice(3); }

function nodeFromSpec(spec, position, asset = null) {
  const data = {
    role: spec.role, kind: spec.kind, legacyType: spec.type,
    title: spec.title,
    asset: asset || null,
    text: "", prompt: "", negative: "",
    /* Audio generator: second text area (歌词 / 朗读文本), the mode tab, the
       mapping of the two areas onto the workflow's exposed text fields, and
       every value the user set on an API-exposed widget. */
    lyrics: "", audioMode: "", audioMap: {}, apiValues: {},
    /* LoRA stack entries: [{ name, strength, enabled }]. `name` is one of the
       lora_name values from /object_info/LoraLoaderModelOnly. Only enabled
       entries with a name are injected into the generated workflow. */
    loras: [],
    /* Cleanup pill action: "vram" | "ram" | "both" (empty for every other node). */
    cleanupMode: spec.role === "cleanup" ? String(spec.kind).replace(/^cleanup_/, "") : "",
    seed: 0, steps: 20, width: 512, height: 512,
    workflow: spec.workflow || "",
    status: "idle", error: "", result: null,
    size: spec.size.slice(),
  };
  if (asset) {
    data.kind = asset.kind || data.kind;
    if (asset.text) data.text = asset.text;
    /* Title stays the plain medium name ("图像"): the generator and the
       material node are the same thing, so the name must not advertise which
       state the node happens to be in. */
  }
  return { id: newNodeId(), type: "ic", position: { x: position[0], y: position[1] }, data };
}

/* LiteGraph stored node.pos at the *body* top-left and drew the title 30px
   above it; Vue Flow's node.position is the whole node's top-left, so the
   conversion is a straight -30 on Y. Links become edges with the slot index
   mapped back to a handle id (generate nodes have four typed inputs). */
function migrateLegacyGraph(doc, data) {
  const graph = data.graph || {};
  const savedProps = graph.infcanvas_node_props || {};
  const legacyNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const legacyLinks = Array.isArray(graph.links) ? graph.links : [];
  const idMap = new Map();

  for (const node of legacyNodes) {
    const props = savedProps[String(node.id)] || node.properties || {};
    const spec = TYPE_BY_LEGACY[node.type]
      || SPEC_BY_TYPE[TYPE_BY_KIND[props.kind || "image"]]
      || SPEC_BY_TYPE[TYPE_BY_KIND.image];
    if (!spec) continue;
    const pos = Array.isArray(node.pos) ? node.pos : [node.pos?.[0] || 0, node.pos?.[1] || 0];
    const size = Array.isArray(node.size) ? node.size : (spec.size || [480, 270]);
    const created = {
      id: String(node.id),
      type: "ic",
      position: { x: pos[0], y: pos[1] - TITLE_H },
      data: {
        role: spec.role, kind: props.kind || spec.kind, legacyType: node.type,
        title: props.title || node.title || spec.title,
        asset: props.asset || null,
        text: props.text || "",
        prompt: props.prompt || "",
        negative: props.negative || "",
        seed: Number(props.seed) || 0,
        steps: Number(props.steps) || 20,
        width: Number(props.width) || 512,
        height: Number(props.height) || 512,
        workflow: props.workflow || spec.workflow || "",
        status: props.status || "idle",
        error: props.error || "",
        result: props.result || null,
        size: [Number(size[0]) || 480, Number(size[1]) || 270],
      },
    };
    /* Old labels were auto-composed ("图像 · a.png"). Keep a real user name,
       otherwise name the node after its material file / its medium. */
    const savedTitle = String(created.data.title || "").trim();
    if (!savedTitle || savedTitle.indexOf(spec.title + " · ") === 0) {
      created.data.title = created.data.asset
        ? (created.data.asset.name || created.data.asset.filename || spec.title)
        : spec.title;
    }
    idMap.set(String(node.id), created);
    doc.nodes.push(created);
  }

  for (const link of legacyLinks) {
    const parts = Array.isArray(link)
      ? { id: link[0], origin_id: link[1], target_id: link[3], target_slot: link[4] }
      : link;
    const target = idMap.get(String(parts.target_id));
    if (!target) continue;
    // Only a generator (a media node with no material) accepts input; legacy
    // links into material nodes (old "in" handle) are dropped to match it.
    if (target.data.role !== "media" || target.data.asset) continue;
    doc.edges.push({
      id: "e_" + (parts.id ?? Math.random().toString(36).slice(2, 8)),
      source: String(parts.origin_id),
      sourceHandle: "out",
      target: String(parts.target_id),
      targetHandle: "in",
      type: "ic",
    });
  }
  doc.viewport = normalizeViewport(data.viewport);
}

function normalizeViewport(viewport) {
  if (!viewport) return null;
  // v1 stored LiteGraph's offset (translation in screen px) and scale.
  if (Array.isArray(viewport.offset) || viewport.scale !== undefined) {
    const offset = Array.isArray(viewport.offset) ? viewport.offset : [0, 0];
    return { x: Number(offset[0]) || 0, y: Number(offset[1]) || 0, zoom: Number(viewport.scale) || 1 };
  }
  return {
    x: Number(viewport.x) || 0,
    y: Number(viewport.y) || 0,
    zoom: Number(viewport.zoom) || 1,
  };
}

/* Old canvases stored two roles (`asset` / `gen`) and two type names per
   medium. The unified node keeps `data.asset` as the state, so all that has
   to change is the role label; the title is rewritten too because material
   nodes used to append the file name to it. */
/* Categories were renamed globally on 2026-11-17 (twice that day); old canvases store
   imageMode/videoMode/audioMode/textMode under the earliest names or the first-rename
   intermediate names. On load, map everything to the final name or activeCategory
   cannot filter workflows for the new categories. Keep in sync with server_routes.
   CATEGORY_RENAMES. */
const LEGACY_MODE_NAMES = {
  "图片生成": "cat.textToImage", "图片编辑": "cat.imageEdit", "图片放大": "cat.imageUpscale",
  "移除背景": "cat.removeBackground", "全能参考": "cat.refToVideo", "参考视频": "cat.refToVideo",
  "首帧": "cat.imageToVideo", "首尾帧": "cat.firstLastFrame", "音乐设计": "cat.textToMusic",
  "音乐翻唱": "cat.musicCover", "语音设计": "cat.textToSpeech", "TTS": "cat.textToSpeech",
  "语音克隆": "cat.voiceClone", "LLM": "cat.llmChat", "LLM对话": "cat.llmChat",
};
const migrateMode = (value) => (value ? (LEGACY_MODE_NAMES[value] || value) : value);

function normalizeNodeData(data) {
  if (!data) return;
  if (data.role === "asset" || data.role === "gen") {
    data.role = data.kind === "text" ? "text" : "media";
  }
  for (const key of ["imageMode", "videoMode", "audioMode", "textMode"]) {
    if (typeof data[key] === "string") data[key] = migrateMode(data[key]);
  }
  /* Old canvases store preview URLs without the user segment: recompute for the current
     account on load, or a same-named file in global input/output would show instead. */
  refreshViewUrl(data.asset);
  refreshViewUrl(data.result);
  if (data.role === "media" || data.role === "text") {
    const spec = SPEC_BY_TYPE[TYPE_BY_KIND[data.kind || "image"]];
    if (spec) {
      data.legacyType = spec.type;
      /* Titles are user-editable, so a saved name must survive a reload. Only
         the OLD auto-composed label ("图像 · a.png") is rewritten: a material
         node is named after its file, a generator after its medium. */
      const title = typeof data.title === "string" ? data.title.trim() : "";
      const legacyLabel = title.indexOf(spec.title + " · ") === 0;
      if (!title || legacyLabel) {
        data.title = data.asset
          ? (data.asset.name || data.asset.filename || spec.title)
          : spec.title;
      }
    }
  }
}

/* Older versions left a result node beside the generator showing the same image. Fold
   it away on load: the image stays in the generator, so old canvases look like new
   output (material → generator). */
function foldResultNodes(doc) {
  const nodes = doc.nodes || [];
  const byId = new Map(nodes.map((entry) => [String(entry.id), entry]));
  const drop = new Map();
  for (const entry of nodes) {
    const ownerId = entry?.data?.resultOf;
    if (!ownerId) continue;
    const owner = byId.get(String(ownerId));
    /* Leave a generator with no result to show untouched: the image is only in the result node. */
    if (!owner?.data?.result) continue;
    drop.set(String(entry.id), String(owner.id));
  }
  if (!drop.size) return;
  doc.nodes = nodes.filter((entry) => !drop.has(String(entry.id)));
  doc.edges = (doc.edges || []).filter((edge) =>
    !drop.has(String(edge.source)) && !drop.has(String(edge.target)));
  for (const ownerId of new Set(drop.values())) {
    const owner = byId.get(ownerId);
    if (owner?.data) owner.data.resultNodes = [];
  }
}

/* The very first Vue-Flow canvas format (before LiteGraph's graph:{} wrapper)
   saved nodes at the top level with type "demo" and media stored as
   `data.media` / `data.inputMedia` arrays of { name, kind, ref }. Map it onto
   the current single-node schema so old files open as real, editable nodes
   instead of silently loading as an empty canvas. */
function migrateDemoNodes(doc, data) {
  const idMap = new Map();
  for (const node of (Array.isArray(data.nodes) ? data.nodes : [])) {
    const raw = node?.data || {};
    const kind = raw.kind || "image";
    const spec = SPEC_BY_TYPE[TYPE_BY_KIND[kind] || "image"] || SPEC_BY_TYPE[TYPE_BY_KIND.image];
    const toAsset = (entry) => {
      if (!entry || typeof entry !== "object") return null;
      const ref = entry.ref || {};
      const asset = {
        name: entry.name || ref.filename || "",
        filename: ref.filename || "",
        subfolder: ref.subfolder || "",
        type: ref.type || "input",
        kind: entry.kind || kind,
      };
      refreshViewUrl(asset);
      return asset.filename ? asset : null;
    };
    const input = (Array.isArray(raw.inputMedia) ? raw.inputMedia.map(toAsset) : []).find(Boolean) || null;
    const result = (Array.isArray(raw.media) ? raw.media.map(toAsset) : []).find(Boolean) || null;
    const created = {
      id: String(node.id),
      type: "ic",
      position: {
        x: Number(node.position?.x) || 0,
        y: Number(node.position?.y) || 0,
      },
      data: {
        role: "media", kind, legacyType: node.type || "demo",
        title: String(raw.label || "").trim() || spec.title,
        asset: input || null,
        result: result || null,
        text: "", prompt: "", negative: "",
        seed: 0, steps: 20, width: 512, height: 512,
        workflow: raw.workflow || spec.workflow || "",
        status: "idle", error: "",
        size: spec.size.slice(),
      },
    };
    idMap.set(String(node.id), created);
    doc.nodes.push(created);
  }
  for (const edge of (Array.isArray(data.edges) ? data.edges : [])) {
    if (!idMap.has(String(edge?.source)) || !idMap.has(String(edge?.target))) continue;
    doc.edges.push({
      id: String(edge.id || ("e_" + Math.random().toString(36).slice(2, 8))),
      source: String(edge.source), sourceHandle: "out",
      target: String(edge.target), targetHandle: "in",
      type: "ic",
    });
  }
  doc.viewport = normalizeViewport(data.viewport);
}

function hydrate(doc, data) {
  if (!data) return;
  if (Number(data.version) >= 2 && Array.isArray(data.nodes)) {
    doc.nodes = data.nodes;
    doc.edges = Array.isArray(data.edges) ? data.edges : [];
    doc.groups = Array.isArray(data.groups) ? data.groups : [];
    for (const node of doc.nodes) normalizeNodeData(node?.data);
    foldResultNodes(doc);
    /* The unified node exposes a single input handle ("in"), and only in its
       generator state. Normalize legacy edges that targeted the old four
       typed handles so their lines survive. */
    const genIds = new Set(doc.nodes
      .filter((n) => n?.data?.role === "media" && !n.data.asset)
      .map((n) => String(n.id)));
    for (const edge of doc.edges) {
      if (genIds.has(String(edge.target))) edge.targetHandle = "in";
    }
    doc.viewport = normalizeViewport(data.viewport);
    return;
  }
  /* v1 came in two shapes: LiteGraph's graph:{nodes,links} (handled below) and
     the earlier top-level nodes:[] with type "demo" (handled above). Pick by
     shape, not by version number alone. */
  if (Array.isArray(data.nodes) && !data.graph) {
    migrateDemoNodes(doc, data);
    return;
  }
  try { migrateLegacyGraph(doc, data); }
  catch (error) {
    console.error("[InfCanvas] migrate failed", error);
    toast("error", tr("core.canvasMigrationFailed"), String(error));
  }
}

/* Mirrors workflowStore.getUnconflictedPath(). */
/* New-document default name follows the active language. */
const baseName = () => tr("core.unsavedCanvasName");

function unconflictedName(base = baseName()) {
  const taken = new Set(state.docs.map((doc) => doc.name));
  let name = base;
  let counter = 2;
  while (taken.has(name)) {
    name = `${base} (${counter})`;
    counter += 1;
  }
  return name;
}

function createDoc(name = null, data = null, id = null) {
  const doc = {
    id: id || uid(), name: name || unconflictedName(), saved: !!name, dirty: false,
    nodes: [], edges: [], groups: [], viewport: null,
  };
  hydrate(doc, data);
  return doc;
}

/* ---- autosave lifecycle ------------------------------------------------
   One pending timer at a time, owned by exactly one doc (state.autosaveDocId).
   Each doc carries a generation counter: markDirty bumps it and the timer
   captures the value; any later edit, close, or explicit save invalidates that
   captured value, so a stale callback can never write an abandoned doc back. */
function cancelAutosave(docId = null) {
  if (state.autosaveTimer == null) return;
  if (docId && state.autosaveDocId !== docId) return;
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = null;
  state.autosaveDocId = null;
}

function markDirty(doc = null) {
  const target = doc || activeDoc();
  if (!target) return;
  if (!target.dirty) { target.dirty = true; NS.ui?.renderTabs(); }
  if (target.id === state.activeId) syncDocFromFlow(target);
  writeDraft(target);
  persistTabs();
  cancelAutosave();
  const gen = (target._autosaveGen = (target._autosaveGen || 0) + 1);
  state.autosaveDocId = target.id;
  state.autosaveTimer = setTimeout(async () => {
    state.autosaveTimer = null;
    state.autosaveDocId = null;
    /* Re-check everything that could have changed while the timer was pending:
       canvas left, doc closed, setting turned off, or a newer edit/save. */
    if (!state.active || !target.saved || !autoSaveEnabled()) return;
    if (!state.docs.includes(target) || target._autosaveGen !== gen) return;
    /* silent=true: autosave shows no toast (a manual save still does). */
    try { await saveActive(false, target, true, gen); }
    catch (error) { console.warn("[InfCanvas] autosave failed", error); }
  }, autoSaveDelay());
}

/* Keep the in-memory doc in sync with what the user sees, so switching tabs
   never loses a drag that happened since the last save. */
function syncDocFromFlow(doc) {
  if (!doc || doc.id !== state.activeId) return;
  const snapshot = flow()?.snapshot?.();
  if (!snapshot) return;
  doc.nodes = snapshot.nodes;
  doc.edges = snapshot.edges;
  doc.groups = snapshot.groups || [];
  doc.viewport = snapshot.viewport;
}

function switchDoc(id) {
  const previous = activeDoc();
  if (previous && previous.id !== id) { syncDocFromFlow(previous); writeDraft(previous); }
  const doc = state.docs.find((entry) => entry.id === id);
  if (!doc || !flow()) return;
  state.activeId = id;
  flow().load(doc);
  persistTabs();
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
  /* Gallery asset URLs are signed with a per-process key, so assets restored
     from disk after a ComfyUI restart carry an expired signature and render
     blank. Re-mint them in the background. load() assigned state.nodes.value
     straight from doc.nodes (same object graph), and Vue's ref wraps it
     reactively, so writing asset.url in place repaints the node. This is a
     repair, not a user edit: no markDirty / autosave is triggered. */
  if (renewDocGalleryUrls) {
    renewDocGalleryUrls(doc).then((updates) => {
      if (!updates.length || !state.docs.includes(doc)) return;
      for (const { nodeId, key, url } of updates) {
        /* Live Flow node (reactive) — writing here repaints the media element. */
        const live = flow()?.findNode?.(nodeId);
        if (live?.data?.[key]) live.data[key].url = url;
        /* Doc object is the same graph load() handed to Flow, but update it
           explicitly so a later save serialises the fresh signature too. */
        const src = doc.nodes?.find((n) => String(n.id) === nodeId);
        if (src?.data?.[key]) src.data[key].url = url;
      }
    }).catch((error) => {
      console.warn("[InfCanvas] gallery URL renew failed", error);
    });
  }
}

async function saveActive(askName = false, docOverride = null, silent = false, expectedGen = null) {
  const doc = docOverride || activeDoc();
  if (!doc || !state.docs.includes(doc)) return false;
  let name = doc.name;
  if (!name || askName) {
    const input = await promptDialog({
      title: tr("shortcuts.saveCanvas"), message: tr("panel.canvasName"),
      defaultValue: name || baseName(),
    });
    if (input === null || !String(input).trim()) return false;
    name = String(input).trim();
  }
  if (doc.id === state.activeId) syncDocFromFlow(doc);
  const payload = {
    version: 2, engine: "vueflow",
    name, savedAt: new Date().toISOString(),
    nodes: doc.nodes, edges: doc.edges, groups: doc.groups || [], viewport: doc.viewport,
  };
  /* A doc can be closed (or edited again) while an async save is in flight.
     Revoke the write in that case so a stale task cannot resurrect an
     abandoned doc or overwrite a newer state on disk. */
  if (!state.docs.includes(doc)) return false;
  if (expectedGen !== null && doc._autosaveGen !== expectedGen) return false;
  await backend.save(name, payload);
  doc.name = name; doc.saved = true; doc.dirty = false;
  /* Content is now on disk; the draft is redundant. ComfyUI does the same
     on save — the draft is only for work that has not reached a file. */
  clearDraft(doc.id);
  persistTabs();
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
  return true;
}

async function closeDoc(id) {
  const doc = state.docs.find((entry) => entry.id === id);
  if (!doc) return false;
  if (doc.dirty) {
    const choice = await confirmDialog({
      title: tr("core.saveChanges"),
      message: tr("core.canvasHasUnsavedChanges", { name: doc.name || baseName() }),
      hint: tr("core.saveSaveCloseDonT"),
      threeWay: true,
    });
    if (choice === null) return false;
    if (choice === true && !(await saveActive(false, doc))) return false;
  }
  /* Revoke the pending autosave for this doc before removing it. Bumping the
     generation also invalidates a save already in flight (payload built, disk
     write pending), so a "don't save" close cannot be resurrected by a timer. */
  cancelAutosave(id);
  doc._autosaveGen = (doc._autosaveGen || 0) + 1;
  state.docs = state.docs.filter((entry) => entry.id !== id);
  clearDraft(id);
  if (state.activeId === id) {
    const next = state.docs[0];
    if (next) switchDoc(next.id);
    else {
      const fresh = createDoc();
      state.docs.push(fresh);
      switchDoc(fresh.id);
    }
  } else persistTabs();
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
  return true;
}

/* ---- ComfyUI-style keyboard commands (canvas-local) ------------------ */

/* R — refresh node definitions, exactly like ComfyUI's RefreshNodeDefinitions
   command. Two layers hold stale data: our api-config object_info promise and
   the workflow-name list cached in flow.js. Clear both and ask the host to
   re-register its node defs. */
async function refreshNodeDefinitions() {
  try { await API()?.execute?.("Comfy.RefreshNodeDefinitions"); }
  catch (error) { /* host command may be unavailable — local caches still clear */ }
  try { NS.apiConfig?.refreshDefs?.(); } catch (error) { /* optional module */ }
  try { window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed")); }
  catch (error) { /* no listeners yet */ }
  toast("success", tr("core.nodeDefinitionsRefreshed"));
}

/* Build a new canvas tab from an in-memory payload. Shared by Ctrl+O file
   import and any caller that already holds a canvas object; `hydrate` accepts
   both v2 and legacy v1 payloads. Returns the new doc (or null). */
function openFromPayload(data, fallbackName = "") {
  /* Accept every format hydrate() knows how to migrate: current v2 (top-level
     nodes), the early demo canvas (top-level nodes, version 1), and LiteGraph
     exports (graph:{ nodes, links }). Rejecting the latter two here used to
     make valid old canvases unimportable before hydrate() ever saw them. */
  const hasNodes = Array.isArray(data?.nodes);
  const hasLegacyGraph = Array.isArray(data?.graph?.nodes);
  if (!data || typeof data !== "object" || (!hasNodes && !hasLegacyGraph)) {
    throw new Error(tr("core.notValidCanvasFile"));
  }
  const base = String(data.name || fallbackName || baseName())
    .replace(/\.json$/i, "").trim() || baseName();
  const doc = createDoc(unconflictedName(base), data);
  state.docs.push(doc);
  switchDoc(doc.id);
  NS.ui?.renderTabs?.();
  toast("success", tr("core.canvasImported"), doc.name);
  return doc;
}

/* Ctrl+O — import a canvas .json file from disk as a brand-new tab. Mirrors
   `openByName` but takes the payload from a local file instead of the backend
   store. The input/change pattern is identical to the proven `pickFiles`. */
function importCanvasFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.style.display = "none";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    try {
      const text = await readTextFile(file);
      openFromPayload(JSON.parse(text), file.name);
    } catch (error) {
      toast("error", tr("core.failedImportCanvas"), String(error));
    }
  });
  document.body.appendChild(input);
  input.click();
}

/* Ctrl+M (mute = DISABLED) / Ctrl+B (ignore = BYPASS/pass-through) — flip a
   status flag on every node in the current selection. The flag is plain node
   data so it persists with the canvas and needs no migration. flow.js greys
   the node; both run paths skip flagged generators; collectInputs() turns
   muted nodes into "no output" and ignored nodes into transparent relays. */
function toggleNodeFlag(flag) {
  /* A selected group is a batch selection of its member nodes: groups are
     not Vue Flow nodes (no .data, never returned by selectedNodes()), so fold
     every selected group's members into the target set. Dedupe by id so a
     member that is also directly selected is only toggled once. */
  const byId = new Map();
  for (const node of flow()?.selectedNodes?.() || []) byId.set(node.id, node);
  const nodes = flow()?.nodesOf?.() || [];
  for (const gid of NS.flow?.state?.selectedGroupIds?.value || []) {
    const group = NS.flow?.state?.groups?.value?.find((item) => item.id === gid);
    if (!group || !Array.isArray(group.nodes)) continue;
    for (const id of group.nodes) {
      if (byId.has(id)) continue;
      const member = nodes.find((entry) => entry.id === id);
      if (member) byId.set(id, member);
    }
  }
  const targets = [...byId.values()];
  if (!targets.length) { toast("info", tr("core.selectNodeFirst")); return; }
  const turningOn = !targets.every((node) => !!node.data?.[flag]);
  for (const node of targets) {
    NS.flow?.updateNodeData?.(node.id, { [flag]: turningOn });
  }
  markDirty();
  const label = flag === "muted" ? tr("core.mute") : tr("core.ignore");
  toast("success", `${turningOn ? "" : tr("api.cancel")}${label} ${targets.length} ${tr("core.nodeCountUnit")}`);
}

/* Ctrl+Enter — run the selected generator nodes (same as clicking their Run
   button). With `explicit` nodes (Ctrl+Enter typed inside a node's parameter
   box) run exactly that node, selected or not. Non-generator / already-running
   nodes are skipped. */
function runSelected(explicit) {
  const selected = explicit || flow()?.selectedNodes?.() || [];
  const targets = selected.filter((node) => {
    const d = node?.data;
    return d && (d.role === "media" || d.role === "text") && !d.asset;
  });
  if (!targets.length) {
    if (!explicit) toast("info", tr("core.selectGeneratorNodeFirst"));
    return;
  }
  let queued = 0;
  for (const node of targets) {
    if (node.data?.muted || node.data?.ignored) continue;
    if (node.data?.status === "running") continue;
    NS.generate?.run?.(node.id);
    queued += 1;
  }
  if (!queued && !explicit) toast("info", tr("core.noSelectedNodeCanRun"));
}

/* Ctrl+Alt+Enter — interrupt every selected node that is currently running. */
function interruptSelected() {
  const selected = flow()?.selectedNodes?.() || [];
  const running = selected.filter((node) => node?.data?.status === "running");
  if (!running.length) { toast("info", tr("core.noSelectedNodeRunning")); return; }
  for (const node of running) NS.generate?.cancel?.(node.id);
}

async function openByName(name) {
  /* Disk is the source of truth. Even when a tab with this name is already
     open, reload its content from disk — otherwise the stale in-memory copy
     would hide (and on next save overwrite) the persisted version. This is
     exactly the "Unsaved Canvas loses its content" bug. */
  try {
    const response = await backend.canvas(name);
    if (!response.exists) { toast("error", tr("core.failedOpenCanvas"), tr("core.canvasDoesNotExist") + name); return; }
    const existing = state.docs.find((doc) => doc.name === name && doc.saved);
    if (existing) {
      /* Same identity, fresh content. Keep the id so its draft/meta follow. */
      hydrate(existing, response.data);
      existing.dirty = false;
      clearDraft(existing.id);
      switchDoc(existing.id);
    } else {
      const doc = createDoc(name, response.data);
      state.docs.push(doc);
      switchDoc(doc.id);
    }
  } catch (error) { toast("error", tr("core.failedOpenCanvas"), String(error)); }
}

function newCanvas() {
  const doc = createDoc();
  state.docs.push(doc);
  switchDoc(doc.id);
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
}

async function renameDoc(id) {
  const doc = state.docs.find((entry) => entry.id === id);
  if (!doc) return;
  const value = await promptDialog({
    title: tr("panel.renameCanvas"), message: tr("panel.canvasName"),
    defaultValue: doc.name || baseName(),
  });
  if (value === null || !String(value).trim()) return;
  doc.name = String(value).trim();
  doc.dirty = true;
  /* If it was saved under the old name, renaming detaches it from that file
     until the next explicit save — same as ComfyUI's Save As. */
  if (doc.saved) doc.saved = false;
  writeDraft(doc);
  persistTabs();
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
}

function duplicateDoc(id) {
  const doc = state.docs.find((entry) => entry.id === id);
  if (!doc) return;
  syncDocFromFlow(doc);
  const base = String(doc.name || baseName()).replace(/\s*\(\d+\)$/, "");
  const name = unconflictedName(base + (doc.saved ? " (Copy)" : ""));
  const copy = createDoc(null, {
    version: 2,
    nodes: JSON.parse(JSON.stringify(doc.nodes)),
    edges: JSON.parse(JSON.stringify(doc.edges)),
    groups: JSON.parse(JSON.stringify(doc.groups || [])),
    viewport: doc.viewport ? { ...doc.viewport } : null,
  });
  copy.name = name;
  copy.saved = false;
  copy.dirty = true;
  state.docs.push(copy);
  writeDraft(copy);
  switchDoc(copy.id);
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
}

/* Bookmarks mirror ComfyUI's useWorkflowBookmarkStore: a Set of canvas names
   kept in the per-user prefs file. The sidebar marks each row with a bookmark button. */
const BOOKMARKS_KEY = "InfCanvas.Bookmarks.v1";

function readBookmarks() {
  const value = storageRead(BOOKMARKS_KEY);
  return new Set(Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string") : []);
}
function writeBookmarks(set) { storageWrite(BOOKMARKS_KEY, Array.from(set)); }
function isBookmarked(name) { return !!name && readBookmarks().has(name); }
function toggleBookmark(name) {
  const set = readBookmarks();
  const next = !set.has(name);
  if (next) set.add(name); else set.delete(name);
  writeBookmarks(set);
  return next;
}

/* Rename/duplicate a saved canvas by composing the existing GET/POST/DELETE
   canvas routes, so no Python change (and no ComfyUI restart) is required. */
async function renameCanvas(oldName, newName) {
  const target = String(newName || "").trim();
  if (!target) throw new Error(tr("core.nameCannotEmpty"));
  if (target === oldName) return target;
  const response = await backend.canvas(oldName);
  if (!response.exists) throw new Error(tr("core.canvasDoesNotExist") + oldName);
  const payload = {
    ...(response.data || {}), name: target, savedAt: new Date().toISOString(),
  };
  await backend.save(target, payload);
  await backend.remove(oldName);
  for (const doc of state.docs) {
    if (doc.saved && doc.name === oldName) doc.name = target;
  }
  const marks = readBookmarks();
  if (marks.delete(oldName)) { marks.add(target); writeBookmarks(marks); }
  persistTabs();
  NS.ui?.renderTabs();
  return target;
}

/* 复制 ≠ 保存. Duplicating a canvas only loads its content into a NEW
   in-memory document (saved=false, dirty=true) and opens it — exactly like
   duplicateDoc() for tabs. Nothing is written to disk until the user saves,
   so no "<name> (Copy)" file appears in the canvas list.
   `takenNames` lets the caller fold in the on-disk names it already knows. */
async function duplicateCanvas(name, newName, takenNames) {
  const response = await backend.canvas(name);
  if (!response.exists) throw new Error(tr("core.canvasDoesNotExist") + name);
  const source = response.data || {};
  const used = new Set([
    ...(Array.isArray(takenNames) ? takenNames : []),
    ...state.docs.map((doc) => doc.name),
  ]);
  const suggested = String(newName || "").trim()
    || String(name).replace(/\s*\(\d+\)$/, "") + " (Copy)";
  let target = suggested;
  if (used.has(target)) {
    const stem = suggested.replace(/\s*\(\d+\)$/, "");
    let counter = 2;
    while (used.has(`${stem} (${counter})`)) counter += 1;
    target = `${stem} (${counter})`;
  }
  const copy = createDoc(null, {
    version: 2,
    nodes: JSON.parse(JSON.stringify(source.nodes || [])),
    edges: JSON.parse(JSON.stringify(source.edges || [])),
    viewport: source.viewport ? { ...source.viewport } : null,
  });
  copy.name = target;
  copy.saved = false;
  copy.dirty = true;
  state.docs.push(copy);
  writeDraft(copy);
  persistTabs();
  switchDoc(copy.id);
  NS.ui?.renderTabs();
  NS.ui?.refreshPanels();
  return target;
}

async function closeDocsAt(id, mode) {
  const index = state.docs.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  let targets;
  if (mode === "left") targets = state.docs.slice(0, index);
  else if (mode === "right") targets = state.docs.slice(index + 1);
  else targets = [...state.docs.slice(index + 1), ...state.docs.slice(0, index)];
  for (const targetId of targets.map((entry) => entry.id)) {
    if (!(await closeDoc(targetId))) break;
  }
}

  return {
    SPECS,
    TYPE_BY_KIND,
    SPEC_BY_TYPE,
    LEGACY_TYPE,
    TYPE_BY_LEGACY,
    specOf,
    TITLE_H,
    SLOT_IDS,
    baseName,
    BOOKMARKS_KEY,
    LEGACY_MODE_NAMES,
    persistTabs,
    writeDraft,
    readDraft,
    clearDraft,
    newNodeId,
    nodeFromSpec,
    migrateLegacyGraph,
    normalizeViewport,
    migrateMode,
    normalizeNodeData,
    foldResultNodes,
    hydrate,
    unconflictedName,
    createDoc,
    markDirty,
    syncDocFromFlow,
    switchDoc,
    openFromPayload,
    importCanvasFile,
    toggleNodeFlag,
    runSelected,
    interruptSelected,
    newCanvas,
    duplicateDoc,
    readBookmarks,
    writeBookmarks,
    isBookmarked,
    toggleBookmark,
    renameCanvas,
    duplicateCanvas,
    refreshNodeDefinitions,
    renameDoc,
    openByName,
    saveActive,
    closeDoc,
    closeDocsAt
  };
}
