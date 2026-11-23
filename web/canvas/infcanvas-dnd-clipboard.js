/* System clipboard and drag/drop bridge for the infinite canvas: file/text
   sniffing, upload-to-node, graph + LoRA clipboard envelopes, pointer anchoring.
   Extracted from infcanvas-core.js (batch 4). Canvas state, node creation and
   host dialog helpers are injected so this module owns no globals. */
export function createDndClipboard({
  state, flow, NS, TYPE_BY_KIND, kindFromFile, centerPos, addNodeByType,
  markDirty, revealNode, backend, readTextFile, toast, tr, hostDialogOpen,
  PASTE_ANCHOR_OFFSET,
}) {
/* ---- system clipboard / file drop -> nodes (ported from xcat-paste.js) ----
   Both paste and drop funnel through handleFiles(). A bare text/plain paste
   creates a text node directly (no upload), matching the reference's single
   "asset-text" node for both pasted text and dropped .txt/.md files. */
const TEXT_EXT = /\.(txt|text|md|markdown|mdown|mkd|mdx)$/i;
const TEXT_MIME = /^(?:text\/(?:plain|markdown|md|x-markdown)|application\/(?:markdown|x-markdown))/i;
const isTextFile = (file) => !!file && (
  TEXT_EXT.test(String(file.name || "")) || TEXT_MIME.test(String(file.type || ""))
);
/* Extend kindFromFile (extension only) with MIME sniffing for clipboard files,
   which often arrive without a usable filename. */
function kindOfFile(file) {
  const byName = kindFromFile(file?.name);
  if (byName) return byName;
  const mime = String(file?.type || "").toLowerCase();
  if (mime.indexOf("image/") === 0) return "image";
  if (mime.indexOf("video/") === 0) return "video";
  if (mime.indexOf("audio/") === 0) return "audio";
  if (isTextFile(file)) return "text";
  return null;
}
function collectFiles(dt) {
  const out = [];
  if (dt?.files?.length) for (const file of dt.files) out.push(file);
  /* Images copied from a web page sometimes live only in dt.items. */
  if (!out.length && dt?.items?.length) {
    for (const item of dt.items) {
      if (item?.kind === "file" && item.getAsFile) {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
  }
  return out.filter((file) => file && (file.size > 0 || file.type || file.name));
}
const lastPointer = { x: 0, y: 0, ok: false };
function rememberPointer(event) {
  if (!state.active) return;
  if (event.target?.closest?.(".vue-flow, #infcanvas-vueflow")) {
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    lastPointer.ok = true;
  }
}
/* Paste events carry no useful client coords, so anchor on the last pointer
   position inside the canvas; fall back to the visible-area centre. */
function pastePoint() {
  const at = lastPointer.ok
    ? flow()?.screenToFlow?.(lastPointer.x, lastPointer.y)
    : null;
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) return { x: at.x, y: at.y };
  const center = centerPos();
  return { x: center[0], y: center[1] };
}
const isTypingTarget = (target) => !!target?.closest?.(
  "input, textarea, select, [contenteditable='true'], [contenteditable='']");

function createTextNode(text, point, anchor = null, anchorOffset = null) {
  const node = addNodeByType(TYPE_BY_KIND.text, [point.x, point.y], null, null, anchor, anchorOffset);
  if (!node) return null;
  node.data.text = String(text || "").slice(0, 4000);
  NS.flow?.updateNodeData?.(node.id, { text: node.data.text });
  markDirty();
  revealNode(node);
  return node;
}

async function handleFiles(files, point, anchor = null, livePlace = false, anchorOffset = null) {
  const createdIds = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const kind = kindOfFile(file);
    if (!kind) { toast("warning", tr("panel.unsupportedFileType"), file.name); continue; }
    try {
      const asset = await backend.upload(file);
      if (kind === "text") {
        try { asset.text = (await readTextFile(file)).slice(0, 4000); } catch (error) { /* binary */ }
      }
      const node = addNodeByType(TYPE_BY_KIND[kind], [point.x + index * 24, point.y + index * 24], asset, file.name,
        anchor ? { x: anchor.x + index * 24, y: anchor.y + index * 24 } : null, anchorOffset);
      if (node) createdIds.push(node.id);
      NS.ui?.refreshPanels();
    } catch (error) { toast("error", tr("panel.uploadFailed"), file.name + " · " + String(error)); }
  }
  /* Menu 添加资源 / 上传 uses the same live placement as the node-creation
     menu: the uploaded nodes follow the pointer and only settle on the
     final left click. Drop point re-decides group; Esc removes them all. */
  if (livePlace && createdIds.length) {
    flow()?.state?.placementActions?.beginNodePlacement?.(createdIds, point);
  }
}

/* Open the native file picker and import every chosen file as a canvas node.
   Backs the double-click menu's 添加资源 / 上传 action. `point` is {x,y} in
   flow coordinates; falls back to the viewport centre. */
function pickFiles(point) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = "image/*,video/*,audio/*,.txt,.text,.md,.markdown,.mdown,.mkd,.mdx";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    if (files.length) handleFiles(files, point || centerPos(), null, true);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

const GRAPH_MIME = "application/x-infcanvas-graph";
const CLIPBOARD_TAG = '{"app":"InfCanvas.Clipboard"';
let lastGraphJson = "";
/* One-shot token for the menu Copy path (NS.api.copySelection). That path
   has no paste event clipboardData, so it can only write via the async
   Clipboard API; if the host refuses, the following Ctrl+V must fall back to
   our in-memory graph. The token is consumed by the NEXT paste and only when
   that paste carries no files and no text — never hijack a system copy. */
let pendingMemoryGraph = false;

/* LoRA library Copy (sidebar right-click). Uses a tagged text/plain payload
   so it survives across tabs/hosts — custom MIME is stripped by many hosts,
   but text/plain is universal. `app` marks our envelope; name is the exact
   lora_name the node dropdown offers. A one-shot in-memory copy mirrors the
   graph path for hosts that refuse navigator.clipboard.writeText. */
const LORA_CLIP_TAG = '{"app":"InfCanvas.LoraCopy"';
let lastLoraPayload = null;
let pendingMemoryLora = false;
function setLoraClipboard(lora) {
  if (!lora || typeof lora.name !== "string" || !lora.name) return;
  const payload = {
    app: "InfCanvas.LoraCopy",
    name: lora.name,
    stem: lora.stem || "",
    category: lora.category || "",
  };
  lastLoraPayload = payload;
  pendingMemoryLora = true;
  /* Copying a lora supersedes any earlier graph copy (single clipboard). */
  pendingMemoryGraph = false;
  try { navigator.clipboard?.writeText?.(JSON.stringify(payload))?.catch?.(() => {}); }
  catch (error) { /* the in-memory copy remains available */ }
}

/* One writer for the native Ctrl+C event and the right-click Copy item. The
   event path fills clipboardData directly; the menu path uses the async
   Clipboard API and keeps an in-memory fallback if the host refuses it. */
function setGraphClipboard(payload, clipboardData) {
  NS.clipboard = payload;
  const json = JSON.stringify(payload);
  lastGraphJson = json;
  /* Copying a graph supersedes any earlier lora copy (single clipboard). */
  pendingMemoryLora = false;
  if (clipboardData) {
    /* Ctrl+C wrote the graph straight into the system clipboard — no fallback
       needed. Clear any stale token from an earlier menu copy. */
    pendingMemoryGraph = false;
    try {
      clipboardData.setData(GRAPH_MIME, json);
      clipboardData.setData("text/plain", json);
    } catch (error) { /* the in-memory copy remains available */ }
  } else {
    /* Menu Copy: arm the one-shot fallback before attempting the async write. */
    pendingMemoryGraph = true;
    try {
      navigator.clipboard?.writeText?.(json)?.catch?.(() => {});
    } catch (error) { /* the in-memory copy remains available */ }
  }
}

function copyGraphSelection() {
  const payload = flow()?.copySelection?.();
  if (!payload) return false;
  setGraphClipboard(payload, null);
  return true;
}

/* Ctrl+C on a node/wire/group selection copies the graph subset instead of
   the page text. Both the custom MIME (same-browser tabs) and a tagged
   text/plain fallback (hosts that strip custom types on cross-tab paste)
   carry it, plus an in-memory copy that survives canvas/doc switches. */
function onCopy(event) {
  if (!state.active || event.defaultPrevented) return;
  if (isTypingTarget(event.target)) return;
  if (NS.tools?.isOpen?.()) return;
  if (hostDialogOpen()) return;
  const payload = flow()?.copySelection?.();
  if (!payload) return;
  event.preventDefault();
  event.stopPropagation();
  setGraphClipboard(payload, event.clipboardData);
}

function onPaste(event) {
  if (!state.active || event.defaultPrevented) return;
  /* Let text fields paste normally (node editor, rename box). */
  if (isTypingTarget(event.target)) return;
  if (NS.tools?.isOpen?.()) return;
  if (document.querySelector('[data-reka-dialog-content][data-state="open"]')) return;
  const dt = event.clipboardData;
  if (!dt) return;
  /* A graph paste must win over the plain-text node fallback, otherwise the
     JSON representation would be pasted as a new text node. */
  let raw = "";
  try { raw = String(dt.getData(GRAPH_MIME) || ""); } catch (error) { raw = ""; }
  if (!raw) {
    try {
      const plain = String(dt.getData("text/plain") || "");
      if (plain.trimStart().startsWith(CLIPBOARD_TAG)) raw = plain;
    } catch (error) { raw = ""; }
  }
  /* A copied LoRA (sidebar right-click) is a tagged text/plain envelope. It
     wins over the plain-text node fallback: pasting must seed a fresh LoRA
     stack, never a text node holding the JSON. The in-memory token covers
     hosts that refused the async clipboard write; consume it only when the
     system clipboard holds no competing text. */
  let loraPayload = null;
  if (!raw) {
    let plain = "";
    try { plain = String(dt.getData("text/plain") || ""); } catch (error) { plain = ""; }
    if (plain.trimStart().startsWith(LORA_CLIP_TAG)) {
      try {
        const parsed = JSON.parse(plain);
        if (parsed?.app === "InfCanvas.LoraCopy" && typeof parsed.name === "string" && parsed.name) {
          loraPayload = parsed;
        }
      } catch (error) { loraPayload = null; }
    } else if (pendingMemoryLora && lastLoraPayload && !plain.trim()) {
      loraPayload = lastLoraPayload;
    }
    if (loraPayload) pendingMemoryLora = false;
  }
  if (loraPayload) {
    event.preventDefault();
    event.stopPropagation();
    const pp = pastePoint();
    seedLoraNode(loraPayload, pp, pp, PASTE_ANCHOR_OFFSET);
    return;
  }
  /* Menu Copy (NS.api.copySelection) has no paste-event clipboardData, so it
     writes via the async Clipboard API. If the host refuses, consume our
     one-shot token here. The fallback is ONLY for that graph-copy intent: it
     needs no files in the clipboard and a plaintext that is empty or still our
     JSON. A system copy of an image/file/text (files present, or foreign text)
     must fall through to the normal media/text node path below. */
  const incomingFiles = collectFiles(dt);
  if (!raw && pendingMemoryGraph && !incomingFiles.length && NS.clipboard && lastGraphJson) {
    let plain = "";
    try { plain = String(dt.getData("text/plain") || ""); } catch (error) { plain = ""; }
    if (!plain.trim() || plain === lastGraphJson) {
      raw = lastGraphJson;
      pendingMemoryGraph = false;
    }
  }
  if (raw) {
    let payload = null;
    try { payload = JSON.parse(raw); } catch (error) { payload = null; }
    if (payload?.app === "InfCanvas.Clipboard" && Array.isArray(payload.nodes)) {
      event.preventDefault();
      event.stopPropagation();
      NS.clipboard = payload;
      flow()?.pasteGraph?.(payload, pastePoint());
      return;
    }
  }
  const files = incomingFiles;
  let text = "";
  try { text = String(dt.getData("text/plain") || ""); } catch (error) { text = ""; }
  if (!files.length && !text.trim()) return;
  event.preventDefault();
  event.stopPropagation();
  /* Paste anchors on the current mouse position: the top-left corner sits
     30px ABOVE the cursor (x aligned to its left edge). For a multi-file
     paste the first file is that top-left anchor; the rest stair-step. */
  const pp = pastePoint();
  if (files.length) { handleFiles(files, pp, pp, false, PASTE_ANCHOR_OFFSET); return; }
  createTextNode(text, pp, pp, PASTE_ANCHOR_OFFSET);
}

/* ---- LoRA library drag contract ----
   A library card writes application/x-infcanvas-lora holding the exact
   lora_name (the very value the node's dropdown offers). Dropped on empty
   canvas it seeds a new LoRA stack; dropped on an existing LoRA stack it
   appends to that stack's loras list. */
const LORA_MIME = "application/x-infcanvas-lora";
function loraFromTransfer(dt) {
  try {
    const raw = dt?.getData?.(LORA_MIME);
    if (!raw) return null;
    const item = JSON.parse(raw);
    return item && typeof item.name === "string" && item.name ? item : null;
  } catch (error) { return null; }
}
function hasLoraInTransfer(dt) {
  try { return Array.from(dt?.types || []).includes(LORA_MIME); }
  catch (error) { return false; }
}
function seedLoraNode(lora, point, anchor = null, anchorOffset = null) {
  const node = addNodeByType(TYPE_BY_KIND.lora, [point.x, point.y], null, null, anchor, anchorOffset);
  if (!node) return;
  NS.flow?.updateNodeData?.(node.id, {
    loras: [{ name: lora.name, strength: 1, enabled: true }],
  });
  markDirty();
}
function appendLoraToNode(node, lora) {
  const next = (Array.isArray(node.data.loras) ? node.data.loras : []).map((entry) => ({ ...entry }));
  next.push({ name: lora.name, strength: 1, enabled: true });
  NS.flow?.updateNodeData?.(node.id, { loras: next });
  markDirty();
  NS.ui?.refreshPanels?.();
}

async function onDrop(event) {
  const point = flow()?.screenToFlow?.(event.clientX, event.clientY) || { x: 0, y: 0 };
  /* Sidebar drops use the same grip as a paste: the node's top-left corner
     sits 30px ABOVE the release point (x aligned to the pointer). */
  const lora = loraFromTransfer(event.dataTransfer);
  if (lora) { seedLoraNode(lora, point, point, PASTE_ANCHOR_OFFSET); return; }
  const custom = event.dataTransfer?.getData("application/x-infcanvas-asset");
  if (custom) {
    try {
      const asset = JSON.parse(custom);
      addNodeByType(TYPE_BY_KIND[asset.kind] || TYPE_BY_KIND.text, [point.x, point.y], asset, null, point, PASTE_ANCHOR_OFFSET);
    } catch (error) { toast("error", tr("core.failedParseAsset"), String(error)); }
    return;
  }
  await handleFiles(collectFiles(event.dataTransfer), point, point, false, PASTE_ANCHOR_OFFSET);
}

  return {
    kindOfFile, collectFiles, rememberPointer, pastePoint, isTypingTarget,
    createTextNode, handleFiles, pickFiles, setLoraClipboard,
    setGraphClipboard, copyGraphSelection, onCopy, onPaste,
    loraFromTransfer, hasLoraInTransfer, seedLoraNode, appendLoraToNode, onDrop,
  };
}
