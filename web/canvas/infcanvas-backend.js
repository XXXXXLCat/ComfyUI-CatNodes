/* Backend HTTP client + asset URL helpers + favorites/prompt snippets.
   Extracted from infcanvas-core.js (batch 3). API()/tr() are injected by the
   caller as lazy getters so this module never reads NS at import time. */
export function createBackend({ API, tr, NS }) {
/* With multi-user (--multi-user + asset isolation) files live in input|output/<user>/, while
   An <img> tag cannot carry a comfy-user header. With only a filename, the host /view
   resolves it as a global path and can hit a same-named stale file in global input/output —
   the material was replaced but the canvas shows someone else's image. The host's own
   its /view fallback resolves the same shape — keep this in sync. */
function assetUser() {
  try {
    const user = window.comfyAPI?.api?.api?.user;
    return user ? String(user) : "";
  } catch (error) { return ""; }
}
function userSubfolder(subfolder) {
  const user = assetUser();
  const sub = String(subfolder || "");
  if (!user) return sub;
  if (sub === user || sub.startsWith(user + "/")) return sub;
  return sub ? user + "/" + sub : user;
}
/* Old canvases store paths without the user segment; recompute for the current user on load.
   Only touch local /view URLs — leave external links and blobs untouched. */
function refreshViewUrl(asset) {
  if (!asset || typeof asset !== "object" || !asset.filename) return asset;
  const url = String(asset.url || "");
  if (url && !url.includes("/view?")) return asset;
  asset.url = viewUrl(asset);
  return asset;
}

function viewUrl(asset) {
  const query = new URLSearchParams({
    filename: asset.filename || "",
    subfolder: userSubfolder(asset.subfolder),
    type: asset.type || "input",
  }).toString();
  const url = "/view?" + query;
  try {
    const api = API();
    return api?.fileURL ? api.fileURL(url) : url;
  } catch (error) { return url; }
}

/* Gallery assets carry a signed /xcat/gallery/file URL whose HMAC is minted
   with a per-process secret. A ComfyUI restart invalidates it, but the canvas
   persists the URL verbatim — after a reload the node shows the filename with
   no image. Re-mint just that one URL from its own source/path (no manifest
   scan, no thumbnails). The backend re-resolves it under the caller's identity,
   so multi-user isolation is preserved. Non-gallery URLs (bare /view, blob:,
   external) are left untouched. */
const GALLERY_FILE_PATH = "/xcat/gallery/file";
function isGalleryUrl(url) {
  return typeof url === "string" && url.includes(GALLERY_FILE_PATH + "?");
}
async function renewGalleryUrl(url) {
  if (!isGalleryUrl(url)) return null;
  let source, path;
  try {
    const query = url.slice(url.indexOf(GALLERY_FILE_PATH + "?") + GALLERY_FILE_PATH.length + 1);
    const params = new URLSearchParams(query);
    source = params.get("source") || "output";
    path = params.get("path") || "";
  } catch (error) { return null; }
  if (!path) return null;
  try {
    /* Only source+path are sent. The backend derives the owner from the
       authenticated request identity — an expired token cannot vouch for a
       `u` param, so echoing it here would be a cross-account re-sign vector. */
    const q = new URLSearchParams({ source, path });
    const api = API();
    const res = await api.fetchApi("/xcat/gallery/renew?" + q.toString());
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) return data.url;
    }
  } catch (error) { /* offline / old backend: keep the existing URL */ }
  return null;
}
/* Renew every gallery-backed asset on a loaded document. Returns a list of
   { nodeId, key, url } updates (key is "asset" or "result") so the caller can
   apply them through Vue Flow's reactive node data — mutating the plain doc
   objects directly would not repaint. One request per distinct URL. */
async function renewDocGalleryUrls(doc) {
  const seen = new Map();
  const targets = [];
  for (const node of (doc?.nodes || [])) {
    for (const key of ["asset", "result"]) {
      const asset = node?.data?.[key];
      if (!isGalleryUrl(asset?.url)) continue;
      if (!seen.has(asset.url)) seen.set(asset.url, renewGalleryUrl(asset.url));
      targets.push({ nodeId: String(node.id), key, old: asset.url });
    }
  }
  if (!seen.size) return [];
  const resolved = await Promise.all([...seen.entries()].map(async ([url, promise]) => [url, await promise]));
  const fresh = new Map(resolved);
  const updates = [];
  for (const { nodeId, key, old } of targets) {
    const url = fresh.get(old);
    if (url && url !== old) updates.push({ nodeId, key, url });
  }
  return updates;
}

/* Resolve a possibly-mislabelled asset to a working /view URL via the backend,
   which searches input/output for the real file. Falls back to the local
   viewUrl() if the backend is unreachable (e.g. not yet restarted). */
async function resolveMediaUrl(asset) {
  const filename = asset?.filename || "";
  if (!filename) return viewUrl(asset);
  try {
    const q = new URLSearchParams({
      filename,
      subfolder: asset.subfolder || "",
      type: asset.type || "input",
    }).toString();
    const api = API();
    const res = await api.fetchApi("/infcanvas/media/resolve?" + q);
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) return data.url;
    }
  } catch (error) { /* fall through to local viewUrl */ }
  return viewUrl(asset);
}

/* ------------------------------ backend ------------------------------ */

const backend = NS.backend = {
  async call(route, options = {}) {
    const api = API();
    if (!api?.fetchApi) throw new Error("ComfyUI API is not available");
    const response = await api.fetchApi("/infcanvas" + route, options);
    if (!response.ok) throw new Error(route + " → HTTP " + response.status);
    return await response.json();
  },
  health: () => backend.call("/health"),
  canvases: () => backend.call("/canvases"),
  canvas: (name) => backend.call("/canvas?name=" + encodeURIComponent(name)),
  save: (name, data) => backend.call("/canvas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  }),
  remove: (name) => backend.call("/canvas?name=" + encodeURIComponent(name), { method: "DELETE" }),
  assets: () => backend.call("/assets"),
  /* LORA library: via ComfyUI folder_paths (incl. extra_model_paths), grouped by subfolder.
     preview is the same-stem image relative path, read through /infcanvas/lora/preview. */
  /* force=true makes the backend bypass its lora-list cache and re-scan the
     model folders — used by the sidebar refresh button after files changed. */
  loras: (force) => backend.call("/loras" + (force ? "?refresh=1" : "")),
  loraPreviewUrl: (rel) => API().apiURL
    ? API().apiURL("/infcanvas/lora/preview?file=" + encodeURIComponent(rel))
    : "/api/infcanvas/lora/preview?file=" + encodeURIComponent(rel),
  /* Trigger words: trainedWords in each LoRA's <stem>.metadata.json sidecar.
     Fetched in one batched request (?name= repeatable); names without a sidecar get []. */
  loraMeta: (names) => backend.call("/lora/meta?" + (names || [])
    .map((name) => "name=" + encodeURIComponent(name)).join("&")),
  workflows: () => backend.call("/workflows"),
  /* The generate node may point at ANY workflow file, including Chinese names
     such as 文生音乐：MiniMax Music 3. The legacy ?name= route validates with
     the old ASCII-only NAME_RE, so the newer REST route is tried first (it
     accepts every legal filename) and ?name= only back-stops an un-restarted
     backend that does not have it yet. */
  async workflow(name) {
    try {
      const data = await backend.call("/workflows/" + encodeURIComponent(name));
      if (data && data.workflow) return data.workflow;
    } catch (error) { /* fall through to the legacy route */ }
    return backend.call("/workflow?name=" + encodeURIComponent(name));
  },
  async upload(file) {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await API().fetchApi("/infcanvas/upload", {
      method: "POST", body: form, timeoutMs: null,
    });
    if (!response.ok) throw new Error("upload → HTTP " + response.status);
    const payload = await response.json();
    return payload.asset;
  },
  async history(promptId) {
    const response = await API().fetchApi("/history/" + encodeURIComponent(promptId));
    if (!response.ok) throw new Error("history → HTTP " + response.status);
    return await response.json();
  },
};

/* 添加到收藏: fetch the asset's bytes from its (possibly signed) URL and
   hand them to the backend, which writes them into the user-chosen 收藏
   folder under a kind sub-folder. Taking bytes rather than a disk path keeps
   this working for generated results, gallery items and arbitrary URLs. */

async function addToFavorites(asset, options = {}) {
  const kind = options.kind || asset?.kind || "text";
  let name = options.name || asset?.filename || asset?.name || tr("wire.asset");
  if (kind === "text" && !/\.[a-z0-9]+$/i.test(name)) name += ".txt";
  let blob;
  /* Only text assets take their bytes from data.text. Image/video/audio nodes
     also carry an (often empty) data.text; treating that empty string as the
     payload produced a 0-byte Blob and the backend rejected it with
     "empty file". For every non-text kind, read the real file from its URL. */
  const textPayload = options.text != null ? String(options.text) : "";
  if (kind === "text" && textPayload.length > 0) {
    blob = new Blob([textPayload], { type: "text/plain;charset=utf-8" });
  } else {
    const raw = options.url || asset?.url || (asset && viewUrl(asset));
    if (!raw) throw new Error(tr("media.nothingAdd"));
    /* Local URLs (bare /view, signed /xcat/gallery/file, etc.) must go through api.fetchApi:
       it adds the Comfy-User header so the backend knows to read input|output/<user>/
       in multi-user mode. Plain fetch carries no identity, so an asset with a subdir
       (e.g. <user>/ming_tts/x.flac) 404s. Keep the URL as-is — /view needs the user
       segment in subfolder; the backend dedupes by header, no <user>/<user> nesting.
        no data or no identity needed → plain fetch is fine. */
    const source = String(raw);
    const sameSite = source.startsWith("/") && !source.startsWith("//");
    const response = await (sameSite
      ? API().fetchApi(source)
      : fetch(source));
    if (!response.ok) throw new Error(tr("media.couldNotReadAssetHttp") + " " + response.status);
    blob = await response.blob();
  }
  const form = new FormData();
  form.append("file", blob, name);
  const api = API();
  const saved = await api.fetchApi(
    "/xcat/favorites/add?kind=" + encodeURIComponent(kind),
    { method: "POST", body: form, timeoutMs: null }
  );
  if (!saved.ok) {
    let message = tr("media.couldNotAddFavorites");
    try { const body = await saved.json(); if (body?.error) message = body.error; }
    catch (error) { /* keep the generic message */ }
    throw new Error(message);
  }
  const result = await saved.json();
  // The 收藏 sidebar (a separate gallery-panel mount) caches its file list.
  // Announce the new asset so an open panel reloads without a manual refresh.
  try {
    document.dispatchEvent(new CustomEvent("xcat-favorites-changed", { detail: result }));
  } catch (error) { /* non-browser context */ }
  return result;
}

/* Saved prompts: per-account {title,text} snippets stored as one JSON file
   under the user's Cat-Nodes dir. All calls go through api.fetchApi so the
   /api prefix and the multi-user Comfy-User header are attached for us. */
async function promptRequest(path, options = {}) {
  const response = await API().fetchApi("/xcat/prompts" + path, options);
  if (!response.ok) {
    let message = "HTTP " + response.status;
    try { const body = await response.json(); if (body?.error) message = body.error; }
    catch (error) { /* keep the status */ }
    throw new Error(message);
  }
  return await response.json();
}
async function listPrompts() {
  return await promptRequest("");
}
async function addPrompt(title, text) {
  return await promptRequest("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, text }),
  });
}
async function removePrompt(id) {
  return await promptRequest("?id=" + encodeURIComponent(id), { method: "DELETE" });
}
async function updatePrompt(id, title, text) {
  return await promptRequest("", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title, text }),
  });
}

  return {
    viewUrl, resolveMediaUrl, refreshViewUrl, renewGalleryUrl, renewDocGalleryUrls,
    isGalleryUrl, backend,
    addToFavorites, listPrompts, addPrompt, removePrompt, updatePrompt,
  };
}
