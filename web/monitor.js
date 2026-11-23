/* CatNodes status bar 🐈‍⬛
   ------------------------------------------------------------------
   ComfyUI frontend extension: compact CPU / RAM / GPU / VRAM / TEMP
   readout plus VRAM and RAM cleanup buttons.

   Follows the official extension contract: registerExtension + setup(),
   api.fetchApi for all backend calls, declared commands, host CSS tokens and
   the shared locale lookup. The bar itself is DOM because topbarBadges are
   static and cannot show live readings.
*/
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { t, langCode, loadTranslations } from "./i18n.js";
// Native-style tooltip engine already shipped with the canvas (host utility
// classes, no custom CSS). Native `title` bubbles are suppressed by this
// frontend, so bind the shared engine instead; getText runs on every hover.
import { bindTip } from "./platform/native-tip.js";

const ROOT_ID = "catnodes-monitor";
const REFRESH_MS = 500;
const BAR_H = 32;
const BAR_RADIUS = 8;

// The canvas entry uses the SVG shipped with the canvas front end. Relative to
// this module (web/monitor.js), the mark lives in web/canvas/.
const CANVAS_LOGO_URL = new URL("./canvas/canvas-logo.svg", import.meta.url).href;

// Same surface / type scale as ComfyUI's native h-8 action-bar buttons.
const SURFACE = "var(--secondary-background, #262729)";
const SURFACE_HOVER = "var(--secondary-background-hover, #313235)";
const INK = "var(--foreground, #ffffff)";
const INK_MUTED = "var(--muted-foreground, #8a8a8a)";
const LABEL_INK = "color-mix(in srgb, var(--foreground, #ffffff) 55%, transparent)";
const FONT_STACK = "var(--font-inter, Inter, sans-serif)";
const TEXT_XS = "var(--text-xs, 12px)";
const TEXT_2XS = "var(--text-2xs, 10px)";
const FW_MEDIUM = "var(--font-weight-medium, 500)";

const COLORS = {
    cpu: "var(--color-green-600, #00a544)",
    ram: "var(--color-green-600, #00a544)",
    gpu: "var(--color-blue-500, #3080ff)",
    vram: "var(--color-blue-500, #3080ff)",
    temp: "var(--destructive, #b33a3a)",
};
const TEMP_MIN = 40;
const TEMP_MAX = 85;

// Node IDs come straight from the V3 schemas in nodes/vram_sweep.py and
// nodes/ram_reclaim.py. Both inputs are optional, so {} is a valid cleanup.
const CLEANUPS = {
    vram: { class_type: "🐈‍⬛CatVRAMSweep", inputs: {} },
    ram: { class_type: "🐈‍⬛CatRAMReclaim", inputs: {} },
};

let root = null;
let segs = {};
let buttons = {};
let importParts = null;
let maxVRAM = 0;
let lastLang = null;

function mk(tag) {
    return document.createElement(tag);
}

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

function fmtGB(gb) {
    return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);
}

function fillTone(color) {
    return "color-mix(in srgb, " + color + " 70%, " + SURFACE + ")";
}

function tempColor(ratio) {
    const pct = Math.round(clamp(ratio, 0, 1) * 100);
    return "color-mix(in srgb, var(--destructive, #b33a3a) " + pct +
        "%, var(--color-green-600, #00a544))";
}

function mkSeg(key, label, color) {
    const seg = mk("div");
    seg.dataset.catnodesStatus = key;
    seg.style.cssText = [
        "position:relative;overflow:hidden;flex-shrink:0;",
        "width:38px;height:" + BAR_H + "px;border-radius:" + BAR_RADIUS + "px;",
        "background:" + SURFACE + ";border:0;box-shadow:none;",
        "user-select:none;cursor:default;",
    ].join("");

    const fill = mk("i");
    fill.style.cssText =
        "position:absolute;left:0;right:0;bottom:0;height:0%;" +
        "background:" + fillTone(color) + ";transition:height .5s;z-index:0;";

    const value = mk("div");
    value.style.cssText =
        "position:absolute;top:3px;left:0;right:0;text-align:center;" +
        "font-family:" + FONT_STACK + ";font-size:" + TEXT_XS +
        ";font-weight:" + FW_MEDIUM + ";line-height:1;color:" + INK +
        ";font-variant-numeric:tabular-nums;z-index:1;";

    const caption = mk("div");
    caption.textContent = label;
    caption.style.cssText =
        "position:absolute;bottom:3px;left:0;right:0;text-align:center;" +
        "font-family:" + FONT_STACK + ";font-size:" + TEXT_2XS +
        ";line-height:1;color:" + LABEL_INK + ";z-index:1;";

    seg.append(fill, value, caption);
    return { seg, fill, value };
}

function setSeg(segment, pct, text, tip, color) {
    segment.fill.style.height = clamp(pct, 0, 100).toFixed(1) + "%";
    if (color) segment.fill.style.background = fillTone(color);
    segment.value.textContent = text;
    // Reference layout: every live segment carries a native tooltip with its
    // current reading. bindTip is idempotent and re-reads a function-form text
    // source on each hover, so the bubble reflects both live data and locale.
    if (tip) bindTip(segment.seg, tip, "bottom");
}

function render(data) {
    if (!data) return;

    if (data.cpu?.percent != null) {
        const p = Math.floor(data.cpu.percent);
        setSeg(segs.cpu, data.cpu.percent, p + "%",
            t("catnodes.monitor.tip.status.cpu", { value: p }, "CPU " + p + "% · processor usage"));
    }
    if (data.ram) {
        const p = Math.floor(data.ram.percent);
        const detail = fmtGB(data.ram.used_gb) + "G / " + fmtGB(data.ram.total_gb) + "G";
        setSeg(segs.ram, data.ram.percent, p + "%",
            t("catnodes.monitor.tip.status.ram", { value: p, detail }, "RAM " + p + "% · " + detail + " used"));
    }

    const gpu = data.gpus?.[0];
    if (gpu) {
        const usage = Math.floor(gpu.usage);
        setSeg(segs.gpu, gpu.usage, usage + "%",
            t("catnodes.monitor.tip.status.gpu", { value: usage, name: gpu.name }, "GPU " + usage + "% · " + gpu.name));

        const total = gpu.vram_total_gb > 0 ? gpu.vram_total_gb : 1;
        const usedPct = 100 * gpu.vram_used_gb / total;
        if (gpu.vram_used_gb > maxVRAM) maxVRAM = gpu.vram_used_gb;
        const vramDetail = fmtGB(gpu.vram_used_gb) + "G / " + fmtGB(gpu.vram_total_gb) + "G" +
            (maxVRAM > 0 ? " · Max " + fmtGB(maxVRAM) + "G" : "");
        setSeg(segs.vram, usedPct, fmtGB(gpu.vram_used_gb) + "G",
            t("catnodes.monitor.tip.status.vram", { value: Math.floor(usedPct), detail: vramDetail },
                "VRAM " + Math.floor(usedPct) + "% · " + vramDetail + " used"));

        const ratio = clamp((gpu.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
        const temp = Math.round(gpu.temp);
        setSeg(segs.temp, ratio * 100, temp + "°C",
            t("catnodes.monitor.tip.status.temp", { value: temp, name: gpu.name },
                "Temperature " + temp + "°C · " + gpu.name),
            tempColor(ratio));
    } else {
        for (const key of ["gpu", "vram", "temp"]) {
            setSeg(segs[key], 0, "N/A",
                t("catnodes.monitor.tip.status.noGpu", null, "No NVIDIA GPU detected"));
        }
    }
}

async function tick() {
    refreshLabels();
    try {
        const response = await api.fetchApi("/catnodes-monitor", { cache: "no-store" });
        if (!response.ok) return;
        render(await response.json());
    } catch (error) {
        // Not ready yet, or the server restarted: keep the last readings.
    }
}

function notify(severity, message) {
    const toast = app?.extensionManager?.toast;
    try {
        if (toast?.[severity]) {
            toast[severity](message, { duration: 2500, closable: false });
        } else if (toast?.add) {
            toast.add({ severity, summary: message, life: 2500 });
        }
    } catch (error) {
        /* notifications are best-effort */
    }
}

async function queueCleanup(kind, button) {
    const spec = CLEANUPS[kind];
    if (!spec) return;
    if (button) {
        button.disabled = true;
        button.style.opacity = ".45";
    }
    try {
        const response = await api.fetchApi("/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: { clean_1: { class_type: spec.class_type, inputs: spec.inputs } },
                client_id: api.clientId || "catnodes-monitor",
            }),
            timeoutMs: 30000,
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const result = await response.json();
        if (result?.error) throw new Error(result.error.message || "prompt rejected");
        notify("success", t("catnodes.monitor.toast." + kind, null,
            kind === "vram" ? "VRAM cleanup queued" : "RAM cleanup queued"));
    } catch (error) {
        notify("error", t("catnodes.monitor.toast.error", null,
            "Cleanup could not be queued; see the ComfyUI log"));
    } finally {
        if (button) {
            button.disabled = false;
            button.style.opacity = "";
        }
    }
}

function cleanupTip(kind) {
    return t("catnodes.monitor.tip.cleanup." + kind, null,
        kind === "vram"
            ? "Clear VRAM: unload models, run garbage collection and empty ComfyUI's cache."
            : "Reclaim RAM: clear ComfyUI's execution cache after the current prompt.");
}

/* Save the active ComfyUI workflow into the embedded canvas' workflow library.
   The implementation lives in web/canvas/infcanvas.js, which exposes it as
   InfCanvas.importActiveWorkflow. Extensions load in parallel, so poll briefly
   instead of assuming the canvas module is already evaluated. */
/* Toggle the embedded canvas from the status-bar logo. ComfyUI evaluates
   extensions in parallel, so poll briefly if the canvas API is not ready yet. */
function toggleInfCanvas(tries) {
    const canvasApi = window.InfCanvas && window.InfCanvas.api;
    if (canvasApi && canvasApi.enter && canvasApi.exit) {
        if (canvasApi.isActive && canvasApi.isActive()) canvasApi.exit();
        else canvasApi.enter();
        return;
    }
    const left = tries == null ? 30 : tries;
    if (left > 0) window.setTimeout(() => toggleInfCanvas(left - 1), 100);
}

/* Logo entry for the embedded canvas: same geometry as the cleanup buttons,
   showing only the canvas mark. Uses the reference package's own SVG and
   currentColor mask technique, with no new custom styling. */
function mkCanvasButton() {
    const parts = mkBarButton(
        "", "",
        () => t("catnodes.monitor.canvasEntry", null, "Infinite Canvas"),
        { logo: CANVAS_LOGO_URL }
    );
    parts.button.id = "catnodes-infinite-canvas-entry";
    parts.button.addEventListener("click", () => toggleInfCanvas());
    return parts.button;
}

function importWorkflowWithWait(tries) {
    const fn = window.InfCanvas && window.InfCanvas.importActiveWorkflow;
    if (typeof fn === "function") {
        fn();
        return;
    }
    const left = tries == null ? 30 : tries;
    if (left > 0) window.setTimeout(() => importWorkflowWithWait(left - 1), 100);
}

function mkBarButton(top, bottom, tipGetter, palette) {
    const skin = palette || {};
    const bg = skin.bg || SURFACE;
    const bgHover = skin.bgHover || SURFACE_HOVER;
    const ink = skin.ink || INK;
    const button = mk("button");
    button.type = "button";
    // Bind the shared native-style tooltip engine. getText is a function, so
    // bindTip re-evaluates it on each hover — the bubble follows the live
    // locale without a repaint hook. Passed by cleanup / import / logo buttons.
    if (typeof tipGetter === "function") {
        bindTip(button, tipGetter, "bottom");
    }
    button.style.cssText = [
        "display:flex;flex-direction:column;align-items:center;justify-content:center;",
        "width:50px;height:" + BAR_H + "px;flex-shrink:0;border-radius:" + BAR_RADIUS + "px;",
        "box-sizing:border-box;border:0;outline:none;box-shadow:none;background:" + bg + ";",
        "font-family:" + FONT_STACK + ";cursor:pointer;padding:0;line-height:1.15;",
        "transition:background .15s;",
    ].join("");

    if (skin.logo) {
        // Pure-logo mode: no text line. The mark is tinted via currentColor so
        // it follows the active theme instead of disappearing on light themes.
        // Same CSS tokens and mask technique as the reference canvas bar.
        button.style.color = ink;
        const mark = mk("span");
        mark.style.cssText =
            "width:100%;height:100%;display:block;pointer-events:none;background-color:currentColor;" +
            "-webkit-mask:url('" + skin.logo + "') center/contain no-repeat;" +
            "mask:url('" + skin.logo + "') center/contain no-repeat;";
        button.append(mark);
        button.addEventListener("mouseenter", () => {
            if (!button.disabled) button.style.background = bgHover;
        });
        button.addEventListener("mouseleave", () => {
            button.style.background = bg;
        });
        return { button, line1: null, line2: null };
    }

    const line1 = mk("div");
    line1.textContent = top;
    line1.style.cssText = "font-size:" + TEXT_XS + ";font-weight:" + FW_MEDIUM +
        ";line-height:1.05;color:" + INK + ";";
    const line2 = mk("div");
    line2.textContent = bottom;
    line2.style.cssText = "font-size:" + TEXT_2XS + ";line-height:1.1;color:" + INK_MUTED + ";";
    button.append(line1, line2);

    button.addEventListener("mouseenter", () => {
        if (!button.disabled) button.style.background = SURFACE_HOVER;
    });
    button.addEventListener("mouseleave", () => {
        button.style.background = SURFACE;
    });
    return { button, line1, line2 };
}

function mkSeparator() {
    const separator = mk("div");
    separator.style.cssText =
        "width:1px;height:20px;flex:0 0 auto;margin:0 3px;" +
        "background:color-mix(in srgb, var(--border, #494a50) 50%, transparent);";
    return separator;
}

function refreshLabels() {
    const lang = langCode();
    if (lang === lastLang) return;
    lastLang = lang;
    for (const kind of Object.keys(buttons)) {
        buttons[kind].line1.textContent = kind.toUpperCase();
        buttons[kind].line2.textContent = t("catnodes.monitor.cleanup", null, "Cleanup");
    }
    // The import button has its own two-line face (not a cleanup kind), so it
    // must be repainted here too — otherwise it stays in the build-time locale.
    if (importParts) {
        importParts.line1.textContent = t("catnodes.monitor.importCanvas", null, "Import");
        importParts.line2.textContent = t("catnodes.monitor.canvas", null, "Canvas");
    }
}

function build() {
    document.getElementById(ROOT_ID)?.remove();
    root = mk("div");
    root.id = ROOT_ID;
    root.style.cssText =
        "display:flex;flex-direction:row;gap:4px;flex-wrap:wrap;align-items:center;" +
        "user-select:none;cursor:default;";

    // Canvas entry (logo) and its import button sit together on the left,
    // matching the reference layout; a divider separates them from cleanup.
    root.append(mkCanvasButton());

    /* Import-to-canvas: same two-line native button, calls the canvas module's
       shared upload implementation. Kept separate from `buttons` (not a cleanup
       kind) but still repainted by refreshLabels on a locale change. */
    importParts = mkBarButton(
        t("catnodes.monitor.importCanvas", null, "Import"),
        t("catnodes.monitor.canvas", null, "Canvas"),
        () => t("catnodes.monitor.tip.importCanvas", null,
            "Save the current workflow to the canvas workflow library")
    );
    importParts.button.id = "catnodes-import-canvas-entry";
    importParts.button.addEventListener("click", () => importWorkflowWithWait());
    root.append(importParts.button);
    root.append(mkSeparator());

    for (const kind of ["ram", "vram"]) {
        const parts = mkBarButton(
            kind.toUpperCase(),
            t("catnodes.monitor.cleanup", null, "Cleanup"),
            () => cleanupTip(kind)
        );
        parts.button.dataset.catnodesCleanup = kind;
        parts.button.addEventListener("click", () => queueCleanup(kind, parts.button));
        buttons[kind] = parts;
        root.append(parts.button);
    }
    root.append(mkSeparator());

    segs.cpu = mkSeg("cpu", "CPU", COLORS.cpu);
    segs.ram = mkSeg("ram", "RAM", COLORS.ram);
    segs.gpu = mkSeg("gpu", "GPU", COLORS.gpu);
    segs.vram = mkSeg("vram", "VRAM", COLORS.vram);
    segs.temp = mkSeg("temp", "TEMP", COLORS.temp);
    for (const key of Object.keys(segs)) root.append(segs[key].seg);
    return root;
}

function attach() {
    // Preferred: the native menu bar, before its settings group. This is an
    // internal frontend structure, so the guarded fallbacks keep the bar alive
    // across frontend upgrades.
    const settingsGroup = app.menu?.settingsGroup?.element;
    if (settingsGroup) {
        settingsGroup.before(root);
        return;
    }
    const bar = document.querySelector(
        "#comfy-menu-bar, #menu-container, .comfy-menu-bar, .menu-bar, .topbar"
    );
    if (bar) {
        bar.appendChild(root);
        return;
    }
    root.style.cssText +=
        "position:fixed;top:44px;right:12px;z-index:9999;width:auto;" +
        "background:color-mix(in srgb, var(--background, #171718) 88%, transparent);" +
        "border:1px solid color-mix(in srgb, var(--border, #494a50) 50%, transparent);" +
        "border-radius:8px;padding:6px 8px;backdrop-filter:blur(6px);";
    document.body.appendChild(root);
}

app.registerExtension({
    name: "CatNodes.Monitor",
    commands: [
        {
            id: "catnodes.cleanup.vram",
            label: "CatNodes: Clear VRAM",
            icon: "pi pi-bolt",
            function: () => queueCleanup("vram"),
        },
        {
            id: "catnodes.cleanup.ram",
            label: "CatNodes: Reclaim RAM",
            icon: "pi pi-bolt",
            function: () => queueCleanup("ram"),
        },
        {
            id: "catnodes.import-canvas",
            label: "CatNodes: Import to Canvas",
            icon: "pi pi-upload",
            function: () => importWorkflowWithWait(),
        },
    ],
    async setup() {
        await loadTranslations();
        build();
        attach();
        refreshLabels();
        window.setInterval(tick, REFRESH_MS);
        tick();
    },
});
