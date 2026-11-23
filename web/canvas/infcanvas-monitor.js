/* Canvas-mode system monitor (top-right floating strip).
 *
 * Mirrors the ComfyUI menu-bar status bar (web/monitor.js) INSIDE the infinite
 * canvas, because canvas mode hides the host's own topbar (infcanvas-style.js).
 * One block, matching the menu bar exactly:
 *
 *   [logo 退出画布] | [RAM Cleanup] [VRAM Cleanup] | [CPU] [RAM] [GPU] [VRAM] [TEMP]
 *
 * Data:  GET /catnodes-monitor  (telemetry, 500ms)
 * Action: POST /prompt           RAM/VRAM cleanup nodes
 *
 * Mounted as a child of #infcanvas-root (a sibling of the Vue Flow stage), so
 * it is removed together with the shell on canvas exit. All host gestures are
 * stopped in the bubbling phase so the strip never pans/zooms/cuts the canvas.
 * Native DOM only — no custom component library inside the canvas shell.
 */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* Native ComfyUI tooltip (shared engine in native-tip.js) — replaces
      `el.title = ...` with the host's themed Reka tooltip. */
  const bindTip = (el, text, side) => {
    if (!el) return el;
    if (NS.tip?.bindTip) return NS.tip.bindTip(el, text, side);
    return el; // native-tip.js is always installed; no browser title fallback
  };
  const CANVAS_LOGO_URL = new URL("./canvas-logo.svg", import.meta.url).href;
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  const api = () => window.comfyAPI?.api?.api || NS.api?.raw || null;

  const REFRESH_MS = 500;
  /* Exact metrics from web/monitor.js (the menu-bar status bar) so the canvas
     copy is pixel-identical to the native one — don't invent new sizes. */
  const BAR_H = 32;
  const BAR_RADIUS = 8;
  /* All surface/type values come from host tokens so light and dark themes
     both follow; no hard-coded palette. */
  const SURFACE = "var(--secondary-background, #262729)"; // 原生 secondary 表面，浅色主题自动变浅
  const SURFACE_HOVER = "var(--secondary-background-hover, #313235)"; // 原生 hover:bg-secondary-background-hover
  const INK = "var(--foreground, #ffffff)";
  const INK_MUTED = "var(--muted-foreground, #8a8a8a)";
// Label text: originally 55% white (rgba(255,255,255,.55)); use 55% foreground here,
// which reads more clearly than muted-foreground over a coloured fill.
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
  const TEMP_MIN = 40, TEMP_MAX = 85;
  /* Outer frame replicates ComfyUI's native .floating-panel verbatim (host CSS truth:
     border-radius:var(--radius-xl); padding:var(--spacing);
     background-color:var(--background);
     box-shadow:var(--shadow-inset-highlight), 0 2px 16px 0 var(--shadow-color)）。
     No solid border in the native version — the earlier 1px border + one-way shadow
     copied from the minimap was wrong. */
  const PLATE_BG = "var(--background, #171718)";
  const PLATE_PAD = "var(--spacing, 4px)";
  const PLATE_RADIUS = "var(--radius-xl, 12px)";
  const PLATE_SHADOW =
    "var(--shadow-inset-highlight, inset 0 1px 0 0 #ffffff1a), "
    + "0 2px 16px 0 var(--shadow-color, rgb(0 0 0 / 0.4))";

  const CLEANUP = {
    ram: { cls: "🐈‍⬛CatRAMReclaim", inputs: { clean_file_cache: true } },
    vram: { cls: "🐈‍⬛CatVRAMSweep", inputs: {} },
  };
  /* Build a /prompt node graph for a cleanup kind. `both` chains RAM off VRAM's
     pass-through output so ComfyUI runs VRAM first, then RAM, in one queue.
     Inputs match the current CatNodes V3 schemas: CatRAMReclaim accepts
     clean_file_cache + optional anything; CatVRAMSweep accepts optional anything. */
  function cleanPrompt(kind) {
    const vram = { class_type: "🐈‍⬛CatVRAMSweep", inputs: {} };
    const ram = (anything) => ({
      class_type: "🐈‍⬛CatRAMReclaim",
      inputs: {
        clean_file_cache: true,
        ...(anything ? { anything } : {}),
      },
    });
    if (kind === "ram") return { clean_1: ram(null) };
    if (kind === "both") return { clean_1: vram, clean_2: ram(["clean_1", 0]) };
    return { clean_1: vram }; // vram (default)
  }

  let root = null;
  let timer = null;
  let segs = null;
  let maxVRAM = 0;
  let exitBtn = null;
  let exitLabel = null;

  const mk = (tag) => document.createElement(tag);
  const fmtGB = (gb) => (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /* green-600 -> destructive, both host tokens (no hex literals). */
  function tempColor(ratio) {
    const pct = Math.round(clamp(ratio, 0, 1) * 100);
    return "color-mix(in srgb, var(--destructive, #b33a3a) " + pct + "%, var(--color-green-600, #00a544))";
  }

  /* Occupancy tone: metric colour blended into the current surface, so the
     label stays legible in both themes. */
  function fillTone(color) {
    return "color-mix(in srgb, " + color + " 70%, " + SURFACE + ")";
  }

  function mkSeg(key, label, color) {
    const seg = mk("div");
    seg.className = "ic-cm-seg";
    seg.dataset.key = key;
    seg.style.cssText = [
      "position:relative;overflow:hidden;flex-shrink:0;",
      "width:38px;height:" + BAR_H + "px;border-radius:" + BAR_RADIUS + "px;",
      "background:" + SURFACE + ";",
      "box-shadow:none;border:0;",
      "user-select:none;cursor:default;",
    ].join("");
    /* Fill rises from the bottom, height = usage ratio (original layout). */
    const fill = mk("i");
    fill.style.cssText =
      "position:absolute;left:0;right:0;bottom:0;height:0%;" +
      "background:" + fillTone(color) + ";transition:height .5s;z-index:0;";
    const val = mk("div");
    val.style.cssText =
      "position:absolute;top:3px;left:0;right:0;text-align:center;" +
      "font-family:" + FONT_STACK + ";font-size:" + TEXT_XS + ";font-weight:" + FW_MEDIUM + ";line-height:1;" +
      "color:" + INK + ";font-variant-numeric:tabular-nums;z-index:1;";
    val.textContent = "…";
    const lbl = mk("div");
    lbl.textContent = label;
    lbl.style.cssText =
      "position:absolute;bottom:3px;left:0;right:0;text-align:center;" +
      "font-family:" + FONT_STACK + ";font-size:" + TEXT_2XS + ";line-height:1;" +
      "color:" + LABEL_INK + ";z-index:1;";
    seg.append(fill, val, lbl);
    return { seg, val, fill };
  }

  function setSeg(s, pct, text, title, fillColor) {
    s.fill.style.height = clamp(pct, 0, 100).toFixed(1) + "%";
    if (fillColor) s.fill.style.background = fillTone(fillColor);
    s.val.textContent = text;
    if (title) bindTip(s.seg, title, "bottom");
  }

  function mkCleanupButton(kind) {
    const def = CLEANUP[kind];
    const btn = mk("button");
    btn.type = "button";
    btn.className = "ic-cm-clean";
    btn.dataset.kind = kind;
    const top = kind === "ram" ? "RAM" : "VRAM";
    bindTip(btn, () => top + " " + t("controls.cleanup"), "bottom");
    btn.style.cssText = [
      "display:flex;flex-direction:column;align-items:center;justify-content:center;",
      "width:50px;height:" + BAR_H + "px;flex-shrink:0;border-radius:" + BAR_RADIUS + "px;",
      "box-sizing:border-box;border:0;outline:none;box-shadow:none;background:" + SURFACE + ";",
      "font-family:" + FONT_STACK + ";cursor:pointer;padding:0;line-height:1.15;transition:background .15s;",
    ].join("");
    const l1 = mk("div");
    l1.textContent = top;
    l1.style.cssText = "font-size:" + TEXT_XS + ";font-weight:" + FW_MEDIUM + ";line-height:1.05;color:" + INK + ";";
    const l2 = mk("div");
    l2.textContent = t("controls.cleanup");
    l2.dataset.i18n = "controls.cleanup";
    l2.style.cssText = "font-size:" + TEXT_2XS + ";line-height:1.1;color:" + INK_MUTED + ";";
    btn.append(l1, l2);
    btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.background = SURFACE_HOVER; });
    btn.addEventListener("mouseleave", () => { if (!btn.disabled) btn.style.background = SURFACE; });
    btn.addEventListener("click", () => runCleanup(kind, btn));
    return btn;
  }

  function mkSeparator() {
    const sep = mk("div");
    sep.style.cssText = "width:1px;height:20px;flex:0 0 auto;margin:0 3px;" +
      "background:color-mix(in srgb, var(--border, #494a50) 50%, transparent);";
    return sep;
  }

  /* Exit-canvas control: the canvas logo and its label live in ONE chip at the
     far left of the plate, logo first / text after. Same surface as the cleanup
     buttons; mask + currentColor keeps the mark visible in both themes. */
  function mkExitButton() {
    const btn = mk("button");
    btn.type = "button";
    btn.className = "ic-monitor-exit";
    btn.style.cssText = [
      "display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;flex:0 0 auto;",
      "height:" + BAR_H + "px;padding:0 12px;box-sizing:border-box;",
      "background:" + SURFACE + ";color:" + INK + ";border:0;border-radius:" + BAR_RADIUS + "px;",
      "font-family:" + FONT_STACK + ";font-size:var(--text-sm, 14px);",
      "font-weight:var(--font-weight-medium, 500);line-height:1;",
      "cursor:pointer;white-space:nowrap;transition:background .15s;",
    ].join("");
    const mark = mk("span");
    mark.setAttribute("aria-hidden", "true");
    mark.style.cssText =
      "display:block;width:50px;height:30px;color:" + INK + ";" +
      "background-color:currentColor;" +
      "-webkit-mask:url('" + CANVAS_LOGO_URL + "') center/contain no-repeat;" +
      "mask:url('" + CANVAS_LOGO_URL + "') center/contain no-repeat;";
    exitLabel = mk("span");
    exitLabel.className = "ic-monitor-exit-label";
    exitLabel.textContent = t("sidebar.exitCanvas");
    btn.append(mark, exitLabel);
    btn.setAttribute("aria-label", t("sidebar.exitCanvasReturnComfyui"));
    bindTip(btn, () => t("sidebar.exitCanvasReturnComfyui"), "bottom");
    btn.addEventListener("mouseenter", () => { btn.style.background = SURFACE_HOVER; });
    btn.addEventListener("mouseleave", () => { btn.style.background = SURFACE; });
    btn.addEventListener("click", () => NS.api?.exit?.());
    exitBtn = btn;
    return btn;
  }

  function build() {
    const el = mk("div");
    el.id = "infcanvas-monitor";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("core.systemStatus"));
    el.style.cssText = [
      "position:absolute;right:8px;top:46px;z-index:1000;",
      "display:flex;flex-direction:column;align-items:flex-start;gap:5px;",
      "pointer-events:auto;user-select:none;",
    ].join("");

    /* Stop canvas-level gestures in the bubble phase (capture stays open so
       the buttons still receive their own events). */
    ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((type) => {
      el.addEventListener(type, (e) => e.stopPropagation());
    });

    const plate = mk("div");
    /* Anchor for the active-task capsule (controls.js): ComfyUI keeps the
       [✕][N tasks] group in the same action/menu bar as the status readouts. */
    plate.id = "infcanvas-monitor-plate";
    plate.style.cssText = [
      "display:flex;flex-direction:row;align-items:center;gap:5px;",
      /* Follow the native floating-panel frame: padding uses --spacing(4px) on all
         four sides, no solid border; 40px total − 4px top/bottom = 32px button area. */
      "height:40px;padding:" + PLATE_PAD + ";box-sizing:border-box;",
      "background:" + PLATE_BG + ";border-radius:" + PLATE_RADIUS + ";",
      "box-shadow:" + PLATE_SHADOW + ";",
    ].join("");
    /* Logo + label are one exit chip; the divider separates it from cleanup. */
    plate.append(mkExitButton(), mkSeparator());
    plate.append(mkCleanupButton("ram"), mkCleanupButton("vram"), mkSeparator());
    segs = {
      cpu: mkSeg("cpu", "CPU", COLORS.cpu),
      ram: mkSeg("ram", "RAM", COLORS.ram),
      gpu: mkSeg("gpu", "GPU", COLORS.gpu),
      vram: mkSeg("vram", "VRAM", COLORS.vram),
      temp: mkSeg("temp", "TEMP", COLORS.temp),
    };
    Object.keys(segs).forEach((k) => plate.append(segs[k].seg));
    /* Add the same separator between the readouts and the following active-job button
       (plate gap-5 + sep mx-3, 8px each side, matching the one after VRAM Cleanup). */
    plate.append(mkSeparator());

    el.append(plate);
    return el;
  }

  function renderTelemetry(data) {
    if (!data || !segs) return;
    if (data.cpu && data.cpu.percent != null) {
      const p = data.cpu.percent;
      setSeg(segs.cpu, p, Math.floor(p) + "%", "CPU " + Math.floor(p) + "%");
    }
    if (data.ram) {
      const rp = data.ram.percent;
      setSeg(segs.ram, rp, Math.floor(rp) + "%",
        "RAM " + Math.floor(rp) + "% · " + fmtGB(data.ram.used_gb) + "G / " + fmtGB(data.ram.total_gb) + "G");
    }
    const gpu = data.gpus && data.gpus[0];
    if (gpu) {
      setSeg(segs.gpu, gpu.usage, Math.floor(gpu.usage) + "%", "GPU " + Math.floor(gpu.usage) + "% · " + gpu.name);
      const vramP = 100 * (gpu.vram_used_gb / gpu.vram_total_gb);
      if (gpu.vram_used_gb > maxVRAM) maxVRAM = gpu.vram_used_gb;
      let vramTitle = "VRAM " + Math.floor(vramP) + "% · " + fmtGB(gpu.vram_used_gb) + "G / " + fmtGB(gpu.vram_total_gb) + "G";
      if (maxVRAM > 0) vramTitle += " · Max " + fmtGB(maxVRAM) + "G";
      setSeg(segs.vram, vramP, fmtGB(gpu.vram_used_gb) + "G", vramTitle);
      const ratio = clamp((gpu.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
      setSeg(segs.temp, ratio * 100, Math.round(gpu.temp) + "°C", "TEMP " + Math.round(gpu.temp) + "°C · " + gpu.name, tempColor(ratio));
    } else {
      ["gpu", "vram", "temp"].forEach((key) => setSeg(segs[key], 0, "N/A", key.toUpperCase() + " N/A"));
    }
  }

  async function runCleanup(kind, btn) {
    /* `btn` is optional: the three 30px cleanup pills in the canvas call this
       with just a kind, so the action has to work without a monitor button. */
    if (btn && btn.disabled) return false;
    if (btn) { btn.disabled = true; btn.style.opacity = ".45"; }
    let ok = false;
    try {
      const a = api();
      const prompt = cleanPrompt(kind);
      if (a && a.fetchApi) {
        const resp = await a.fetchApi("/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, client_id: a.clientId || "catnodes-canvas-monitor" }),
        });
        ok = !resp || resp.ok !== false;
      } else {
        const resp = await fetch("/prompt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, client_id: "catnodes-canvas-monitor" }),
        });
        ok = !resp || resp.ok !== false;
      }
    } catch (e) { /* silent: restore the button / pill below */ }
    if (btn) setTimeout(() => { btn.disabled = false; btn.style.opacity = ""; }, 800);
    return ok;
  }

  async function tick() {
    const fetchJson = async (url) => {
      const a = api();
      const resp = a && a.fetchApi ? await a.fetchApi(url, { cache: "no-store" }) : await fetch(url, { cache: "no-store" });
      return resp && resp.ok ? resp.json() : null;
    };
    try { renderTelemetry(await fetchJson("/catnodes-monitor")); } catch (e) { /* keep last reading */ }
  }

  function mount(parent) {
    if (root && root.isConnected) return root;
    root = build();
    (parent || document.getElementById("infcanvas-root") || document.body).appendChild(root);
    repaintLocale();
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, REFRESH_MS);
    return root;
  }

  function unmount() {
    if (timer) { clearInterval(timer); timer = null; }
    if (root) { root.remove(); root = null; }
    segs = null; maxVRAM = 0; exitBtn = null; exitLabel = null;
  }

  function repaintLocale() {
    if (!root) return;
    root.setAttribute("aria-label", t("core.systemStatus"));
    if (exitLabel) exitLabel.textContent = t("sidebar.exitCanvas");
    if (exitBtn) {
      exitBtn.setAttribute("aria-label", t("sidebar.exitCanvasReturnComfyui"));
      bindTip(exitBtn, () => t("sidebar.exitCanvasReturnComfyui"), "bottom");
    }
    for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  }

  NS.canvasMonitor = { mount, unmount, repaintLocale, tick, runCleanup, get root() { return root; } };
})();
