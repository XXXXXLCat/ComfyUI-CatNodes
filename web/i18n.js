/* Shared zh/en lookup for the CatNodes front-end panels.

   The language comes from ComfyUI's own `Comfy.Locale` **setting** — that is the
   only authoritative source: the current frontend keeps settings on the server
   (`/api/settings`), and `localStorage["Comfy.Locale"]` is a leftover from older
   versions that is never updated (it can hold a stale "zh" while the UI runs in
   English). So: setting first, localStorage / <html lang> / navigator only as
   fallbacks for the first paint or an older frontend.

   ComfyUI's language list has no `zh-CN`: Simplified Chinese is `zh`, Traditional
   is `zh-TW`. Anything that starts with `zh` is treated as Chinese, matching the
   server-side `locale_alias.py` that fills `zh-TW` from the `zh` bundle.

   The language never changes mid-render, but it *can* change mid-session: newer
   frontends (1.5x) switch `Comfy.Locale` in place instead of reloading, so
   anything captured as a plain string when a node/tab was created keeps the old
   language. Resolve the value on every lookup, or expose labels as accessors
   so a re-render picks them up.
   Only a value that came from a real source is cached, never a guess made before
   `app` was ready.
*/

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let _lang = null;
let _translations = null;
let _loadPromise = null;

function norm(value) {
    return String(value || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function fromSetting() {
    try {
        const value = app?.extensionManager?.setting?.get?.("Comfy.Locale");
        if (value) return value;
    } catch {
        /* extensionManager not ready */
    }
    try {
        const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
        if (value) return value;
    } catch {
        /* legacy settings API gone */
    }
    return "";
}

function fromStorage() {
    try {
        // `catnodes.locale` is written by us from the real setting, so it beats the
        // stale `Comfy.Locale` key older frontends used to keep in sync.
        return localStorage.getItem("catnodes.locale") || localStorage.getItem("Comfy.Locale") || "";
    } catch {
        return "";
    }
}

/* Last locale we rendered in, cached so a page reload can pick the language up
   before `/api/settings` resolves. */
function remember(lang) {
    try {
        localStorage.setItem("catnodes.locale", lang);
    } catch {
        /* private mode */
    }
}

export function langCode() {
    // Always ask the setting first, even when a value is already cached: the
    // extension can be imported before `/api/settings` resolves, and anything we
    // cached at that moment would otherwise stick for the whole page.
    const setting = fromSetting();
    if (setting) {
        const lang = norm(setting);
        // Only touch localStorage when the value actually moved: this runs on
        // every label lookup, which is a lot of renders during a session.
        if (_lang !== lang) {
            _lang = lang;
            remember(lang);
        }
        return lang;
    }

    if (_lang) return _lang;

    // `catnodes.locale` / `Comfy.Locale` are leftovers from the previous page load —
    // good enough for the first paint, but they must NOT be cached: switching the
    // language and reloading leaves them stale until the new setting is read.
    const stored = fromStorage();
    if (stored) return norm(stored);

    return norm(document.documentElement?.lang || navigator.language || "");
}

/* Standard ComfyUI custom-node catalogues: locales/<lang>/main.json,
   commands.json and settings.json are merged by the server into /i18n. New
   UI code uses t() with a key from that catalogue; textOf() resolves the
   catalogue-backed accessors passed by shared panels. */
export async function loadTranslations() {
    if (_translations) return _translations;
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
        let data = {};
        try {
            const response = await api.fetchApi("/i18n", { cache: "no-store" });
            if (response.ok) data = await response.json();
        } catch {
            /* frontend not ready yet */
        }
        if (!Object.keys(data).length) {
            try {
                const response = await fetch("/i18n", { cache: "no-store" });
                if (response.ok) data = await response.json();
            } catch {
                /* offline / no server */
            }
        }
        _translations = data;
        return data;
    })();
    return _loadPromise;
}

function lookup(lang, key) {
    let node = _translations?.[lang];
    for (const part of key.split(".")) {
        if (!node || typeof node !== "object") return undefined;
        node = node[part];
    }
    return typeof node === "string" ? node : undefined;
}

/* Resolve a locale-catalogue key, with {name} interpolation. `fallback` keeps
   first paint readable if /i18n has not answered yet. */
export function t(key, params, fallback) {
    const text = lookup(langCode(), key) ?? lookup("en", key);
    if (text == null) return fallback ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (_, name) =>
        params[name] == null ? `{${name}}` : String(params[name])
    );
}

/* Internal fallback for textOf(): resolves a legacy `{ zh, en }` pair if a
   caller still supplies one. UI modules use t() with catalogue keys. */
function pick(pair) {
  if (pair == null) return "";
  if (typeof pair === "string") return pair;
  return pair[langCode()] ?? pair.en ?? "";
}

/* Resolve a label whose source may be a live t() accessor, a ready string or a
   legacy `{ zh, en }` pair. Used by the shared control panel so its callers can
   pass catalogue-backed accessors while old workflows keep working. */
export function textOf(value, ...args) {
  if (typeof value === "function") return value(...args);
  if (typeof value === "string") return value;
  return pick(value);
}

/* `makeT({ zh: {...}, en: {...} })` → key lookup for flat string tables. */
export function makeT(table) {
    const lang = langCode();
    return (key) => table[lang]?.[key] ?? table.en?.[key] ?? key;
}
