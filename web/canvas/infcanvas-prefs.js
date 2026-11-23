/* Canvas preferences store — every small UI parameter now lives on the server
   in user/<account>/Cat-Nodes/prefs.json (single user: user/default).  The old
   localStorage keys are only read ONCE for migration, never written again, so
   the same browser switched between ComfyUI accounts no longer leaks settings.

   Reads are synchronous (an in-memory cache, loaded at boot) because existing
   call sites read preferences while building the UI. Writes merge into a patch
   queue and are PUT to /api/infcanvas/prefs; NS.api.init awaits load() so the
   cache is authoritative before any panel mounts. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const API = () => window.comfyAPI?.api?.api;
  const OWN = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  let cache = Object.create(null);
  let loaded = false;
  let timer = 0;
  let pending = Object.create(null);
  const waiters = [];

  /* Only keys this plugin used to own are migrated. `xcat.locale` / `Comfy.Locale`
     belong to the global node i18n and stay where they are. */
  const isOurKey = (key) => typeof key === "string" && (
    key.startsWith("InfCanvas.") || key.startsWith("infcanvas:") ||
    key.startsWith("xcat.gallery.")
  );

  function legacyGet(key) {
    if (!isOurKey(key)) return undefined;
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (error) {
      /* not JSON (or storage blocked) — nothing to migrate */
      return undefined;
    }
  }

  function get(key, fallback = null) {
    if (OWN(cache, key)) return cache[key];
    const legacy = legacyGet(key);
    return legacy === undefined ? fallback : legacy;
  }

  function set(key, value) {
    if (value === undefined || value === null) return remove(key);
    cache[key] = value;
    pending[key] = value;
    scheduleFlush();
    return value;
  }

  function remove(key) {
    delete cache[key];
    pending[key] = null; // backend treats null as "delete this key"
    scheduleFlush();
  }

  function scheduleFlush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; flush(); }, 120);
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    const patch = pending;
    pending = Object.create(null);
    if (!Object.keys(patch).length) return true;
    try {
      const api = API();
      if (!api?.fetchApi) throw new Error("ComfyUI API unavailable");
      const response = await api.fetchApi("/infcanvas/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: patch }),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      /* Server is authoritative: adopt its full view so concurrent tabs that
         wrote other keys are never clobbered by our local snapshot. */
      const data = await response.json();
      if (data && data.prefs && typeof data.prefs === "object") {
        /* Keep writes that arrived while the request was in flight. */
        cache = Object.assign(Object.create(null), data.prefs, pending);
      }
      // Legacy keys are safe to drop once the server has them.
      for (const key of Object.keys(patch)) {
        if (patch[key] !== null) {
          try { localStorage.removeItem(key); } catch (error) { /* private mode */ }
        }
      }
      return true;
    } catch (error) {
      /* Put the failed patch back so the next write retries it, without
         overwriting newer values queued while the request was in flight. */
      pending = Object.assign(Object.create(null), patch, pending);
      console.warn("[InfCanvas prefs] save failed:", error);
      return false;
    }
  }

  async function load() {
    if (loaded) return cache;
    let server = null;
    try {
      const api = API();
      if (api?.fetchApi) {
        const response = await api.fetchApi("/infcanvas/prefs", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (data && data.prefs && typeof data.prefs === "object") server = data.prefs;
        }
      }
    } catch (error) {
      console.warn("[InfCanvas prefs] load failed, using cached values:", error);
    }
    /* Pending writes (made before load resolved) win over the server copy. */
    cache = Object.assign(Object.create(null), server || {}, pending);
    loaded = true;

    /* One-time migration: copy every old key the server does not have yet. */
    const migrate = Object.create(null);
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!isOurKey(key) || OWN(cache, key)) continue;
        const value = legacyGet(key);
        if (value !== undefined) migrate[key] = value;
      }
    } catch (error) { /* storage unavailable */ }
    if (Object.keys(migrate).length) {
      Object.assign(cache, migrate);
      Object.assign(pending, migrate);
    }
    if (Object.keys(pending).length) await flush();

    for (const cb of waiters.splice(0)) {
      try { cb(); } catch (error) { console.warn("[InfCanvas prefs] waiter error:", error); }
    }
    try {
      document.dispatchEvent(new CustomEvent("xcat-prefs-loaded"));
    } catch (error) { /* non-browser context */ }
    return cache;
  }

  function ready() {
    if (loaded) return Promise.resolve(cache);
    return new Promise((resolve) => waiters.push(() => resolve(cache)));
  }

  NS.prefs = { get, set, remove, load, ready, flush, isOurKey,
               all: () => Object.assign({}, cache) };
  load();
})();
