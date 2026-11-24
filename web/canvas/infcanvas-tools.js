/* Node tools for the embedded infinite canvas.

   Each asset kind gets its own hover action row, mirroring the reference
   project's per-kind tool set (NodeActions.vue + xcat-image-tools.js /
   xcat-video-edit.js / xcat-audio-edit.js):

     image : crop / grid split / mirror / adjust / download / delete
     video : split audio / trim / grab frame / download / delete
     audio : clip / speed / download / delete
     text  : download / delete (+ double click to edit)
     gen   : delete
     empty : delete

   Image tools stay browser-side (Canvas 2D) and write PNGs through the existing
   /infcanvas/upload endpoint. Video/audio tools are implemented in
   infcanvas-media-tools.js and call the FFmpeg endpoints in server_routes.py;
   those need a real ComfyUI restart, hence the readiness probe/banner. The
   image adjustment kernel is ported from the reference project's
   xcat-image-adjust-core.js (itself MIT, derived from @xdadda/mini-gl shaders)
   with the same constants and order.

   Modals are mounted inside #infcanvas-root, NOT document.body: in canvas mode
   ComfyUI hides every body child except our root. ComfyUI's own
   dialog/toast portals stay above us. */
import { CSS_TOOLS as CSS } from "./infcanvas-style.js";
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* Native ComfyUI tooltip (shared engine in native-tip.js) — replaces
      `el.title = ...` with the host's themed Reka tooltip. */
  const bindTip = (el, text, side) => {
    if (!el) return el;
    if (NS.tip?.bindTip) return NS.tip.bindTip(el, text, side);
    return el; // native-tip.js is always installed; no browser title fallback
  };
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* Shared, load-order-independent registry. infcanvas-media-tools.js writes
     the video/audio handlers into the same object. */
  const R = (NS.icRegistry = NS.icRegistry || {});


  function injectStyles() {
    if (document.querySelector("#infcanvas-tools-style")) return;
    const style = document.createElement("style");
    style.id = "infcanvas-tools-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const toast = (kind, summary, detail = "") => {
    if (NS.api?.toast) NS.api.toast(kind, summary, detail);
    else console.log("[InfCanvas tools]", kind, summary, detail);
  };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  /* Nodes 2.0 sliders draw a filled track; a bare range input cannot, so the
     current value is written into --ict-p and the track gradient uses it. */
  const paintRange = (input) => {
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const value = Number(input.value || 0);
    const ratio = max > min ? clamp01((value - min) / (max - min)) : 0;
    input.style.setProperty("--ict-p", (ratio * 100).toFixed(2) + "%");
  };
  const paintRanges = (root) => {
    root?.querySelectorAll?.('input[type="range"]').forEach(paintRange);
  };
  /* ComfyUI Nodes 2.0 的数字控件是 ScrubableNumberInput：一条 24px 高的
     bg-input 行，左右是 aspect-square 的正方形按钮（hover 才浮出 --muted），
     中间是左对齐的 12px 输入框，上面盖一层 ew-resize 的拖动层——
     拖动按 10px 一格改值，单击不拖则全选文本。这里把普通 number 输入
     就地包装成同样的结构，模板不必重复写三件套。 */
  const STEP_ICONS = {
    minus: '<i class="icon-[lucide--minus] size-4" aria-hidden="true"></i>',
    plus: '<i class="icon-[lucide--plus] size-4" aria-hidden="true"></i>',
  };
  function decorateNumberFields(root) {
    root?.querySelectorAll?.('input[type="number"]').forEach((input) => {
      if (input.closest(".ict-num")) return;
      const width = Math.round(input.getBoundingClientRect().width);
      const step = () => Number(input.step) || 1;
      const precision = () => String(input.step || "1").split(".")[1]?.length || 0;
      const value = () => {
        const n = Number(input.value);
        return Number.isFinite(n) ? n : 0;
      };
      const format = (n) => {
        const prec = precision();
        return prec > 0 ? n.toFixed(prec) : String(n);
      };
      const write = (next, quiet) => {
        const lo = input.min === "" ? -Infinity : Number(input.min);
        const hi = input.max === "" ? Infinity : Number(input.max);
        input.value = format(Math.min(hi, Math.max(lo, next)));
        if (quiet) return;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const wrap = document.createElement("span");
      wrap.className = "ict-num";
      wrap.style.width = (width > 0 ? width : 112) + "px";

      const makeButton = (dir, label, icon) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ict-num-" + (dir < 0 ? "dec" : "inc");
        btn.setAttribute("aria-label", label);
        btn.tabIndex = -1;
        btn.innerHTML = icon;
        btn.addEventListener("click", () => {
          if (input.disabled) return;
          write(value() + dir * step());
        });
        return btn;
      };

      const cell = document.createElement("span");
      cell.className = "ict-num-cell";
      const swipe = document.createElement("span");
      swipe.className = "ict-num-swipe";

      let startX = 0, startValue = 0, ticks = 0, moved = false, active = false;
      swipe.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || input.disabled) return;
        active = true; moved = false; ticks = 0;
        startX = event.clientX; startValue = value();
        try { swipe.setPointerCapture(event.pointerId); } catch (e) { /* optional */ }
      });
      swipe.addEventListener("pointermove", (event) => {
        if (!active) return;
        const dx = event.clientX - startX;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        /* ComfyUI: delta = (distanceX - dragDelta) / 10, value - delta * step */
        const next = Math.trunc(dx / 10);
        if (next === ticks) return;
        ticks = next;
        write(startValue - ticks * step());
      });
      const finishSwipe = () => {
        if (!active) return;
        active = false;
        if (moved) return;
        wrap.classList.add("is-editing");
        input.focus();
        input.select();
      };
      swipe.addEventListener("pointerup", finishSwipe);
      swipe.addEventListener("pointercancel", () => { active = false; });

      let last = input.value;
      input.addEventListener("blur", () => {
        wrap.classList.remove("is-editing");
        const raw = input.value.trim();
        if (raw === "" || !Number.isFinite(Number(raw))) { input.value = last; return; }
        write(Number(raw), true);
        last = input.value;
      });

      input.replaceWith(wrap);
      cell.append(input, swipe);
      wrap.append(makeButton(-1, t("controls.decrease"), STEP_ICONS.minus), cell,
        makeButton(1, t("core.increase"), STEP_ICONS.plus));
    });
  }
  const fmtTime = (seconds) => {
    const s = Math.max(0, Number(seconds) || 0);
    return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  };
  const stemOf = (name) => String(name || "asset").replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "asset";

  function canvasBlob(canvas, type = "image/png") {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(window.InfCanvas.i18n.t("core.toBlobFailed")))), type));
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(window.InfCanvas.i18n.t("core.imageLoadFailed") + url));
      img.src = url;
    });
  }
  function drawToCanvas(img, w = img.naturalWidth, h = img.naturalHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas;
  }

  /* ------------------------------- modal -------------------------------- */

  let modal = null;
  let menu = null;

  function closeMenu() {
    if (!menu) return;
    if (menu.raf) cancelAnimationFrame(menu.raf);
    menu.el.remove();
    document.removeEventListener("pointerdown", onMenuOutside, true);
    document.removeEventListener("keydown", onMenuKey, true);
    menu = null;
  }
  function onMenuOutside(event) {
    if (menu && !menu.el.contains(event.target)) closeMenu();
  }
  function onMenuKey(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
  }
  /* Anchored dropdown (node/group context menu, selection arrange, frame menu).
     Shares the EXACT `.ic-menu` surface the double-click add-node menu uses:
     same classes, same ComfyUI tokens, same 14px type, and it lives on the
     screen-space layer OUTSIDE the scaled pane. Unlike the old `.ict-menu` it
     never scales with canvas zoom, so every menu in the canvas looks identical.
     Closes on outside pointerdown / Escape, never on a backdrop click. */
  function openMenu(anchor, items) {
    closeMenu();
    const host = document.getElementById("infcanvas-root") || document.body;
    /* Native menuStyles.ts classes (shared from ui.js, with inline fallback)
       so this menu reads exactly like ComfyUI's own context menu. */
    const NM = window.InfCanvas?.NATIVE_MENU || {
      content: "z-overlay min-w-48 overflow-y-auto rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none",
      item: "flex min-h-8 cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none data-disabled:opacity-50 data-highlighted:bg-accent w-full justify-start border-0 bg-transparent text-left hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50",
      sep: "my-1 h-px bg-border/50",
    };
    const el = document.createElement("div");
    el.className = NM.content + " ic-menu";
    el.setAttribute("role", "menu");
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = NM.sep + " ic-menu-sep";
        el.appendChild(sep);
        continue;
      }
      if (item.section) {
        const section = document.createElement("div");
        section.className = "ic-menu-section";
        section.textContent = item.section;
        el.appendChild(section);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = NM.item + " ic-menu-item";
      button.setAttribute("role", "menuitem");
      if (item.disabled) { button.disabled = true; button.setAttribute("aria-disabled", "true"); }
      /* PrimeIcons glyph, same i-element + size-4 slot as ui.js openMenu, so
         every context menu in the canvas shares one icon style. Optional:
         callers that omit the icon field stay text-only. */
      if (item.icon) {
        const iconEl = document.createElement("i");
        iconEl.className = item.icon + " size-4 shrink-0";
        if (item.iconEm) iconEl.style.fontSize = "1em";
        button.appendChild(iconEl);
      }
      /* MenuItemContent.vue: label wrap + optional shortcut. */
      const labelWrap = document.createElement("span");
      labelWrap.className = "min-w-0 flex-1";
      const label = document.createElement("span");
      label.className = "block truncate";
      label.textContent = item.label;
      labelWrap.appendChild(label);
      button.appendChild(labelWrap);
      if (item.value) {
        const value = document.createElement("span");
        value.className = "ml-auto rounded-sm border bg-secondary p-1 text-xs text-nowrap text-muted-foreground";
        value.textContent = item.value;
        button.appendChild(value);
      }
      button.addEventListener("click", () => { const pick = item.onPick; closeMenu(); if (!item.disabled) pick?.(); });
      el.appendChild(button);
    }
    host.appendChild(el);
    /* Screen-space fixed: no zoom transform, so glyphs stay 14px like every
       other `.ic-menu`. Anchoring follows the button's live screen rect so the
       menu still tracks pan/zoom while open. */
    menu = { el, raf: 0 };
    const place = () => {
      if (!menu || menu.el !== el) return;
      const box = anchor.getBoundingClientRect();
      const width = el.offsetWidth || 192;
      el.style.left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8)) + "px";
      el.style.top = (box.bottom + 6) + "px";
      menu.raf = requestAnimationFrame(place);
    };
    place();
    for (const type of ["pointerdown", "mousedown", "dblclick", "click", "wheel", "contextmenu"]) {
      el.addEventListener(type, (event) => event.stopPropagation());
    }
    setTimeout(() => {
      if (!menu) return;
      document.addEventListener("pointerdown", onMenuOutside, true);
      document.addEventListener("keydown", onMenuKey, true);
    }, 0);
    return el;
  }

  function closeModal() {
    closeMenu();
    if (!modal) return;
    const { mask, onClose } = modal;
    modal = null;
    if (mask?.parentElement) mask.parentElement.removeChild(mask);
    try { onClose?.(); } catch (error) { /* optional */ }
  }

  /* options:
       title/sub/width, warn (HTML), progress (spinner dialog),
       applyLabel (null = no apply button), cancelLabel, extraFoot[],
       build(body, ui), onApply(ui), run(ui) (start immediately), onClose().
     ui: setStatus / setBusy / setApplyEnabled / setWarn / apply / close / signal.
     Mirrors the reference .xcat-ae-modal shell: head + optional readiness
     banner + body + status/actions footer. */
  function openModal(options = {}) {
    closeModal();
    const host = document.getElementById("infcanvas-root") || document.body;
    const mask = document.createElement("div");
    mask.className = "ict-mask";
    const panel = document.createElement("div");
    panel.className = "ict-panel";
    panel.style.width = (options.width || 760) + "px";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", options.title || t("image.tools"));

    const head = document.createElement("div");
    head.className = "ict-head";
    head.innerHTML = `<h3></h3><span class="ict-sub"></span><button class="ict-x" type="button"><i class="icon-[lucide--x] size-4" aria-hidden="true"></i></button>`;
    bindTip(head.querySelector(".ict-x"), () => t("settings.close"));
    head.querySelector("h3").textContent = options.title || t("image.tools");
    head.querySelector(".ict-sub").textContent = options.sub || "";

    let warnEl = null;
    if (options.warn) {
      warnEl = document.createElement("div");
      warnEl.className = "ict-warn";
      warnEl.innerHTML = options.warn;
      warnEl.hidden = true;
    }

    const body = document.createElement("div");
    body.className = "ict-body" + (options.progress ? " ict-progress" : "");
    let progressText = null;
    if (options.progress) {
      body.innerHTML = `<div class="ict-spinner"></div><div class="ict-progress-text"></div>`;
      progressText = body.querySelector(".ict-progress-text");
      progressText.textContent = options.progressText || t("image.processingPleaseWait");
    }

    const foot = document.createElement("div");
    foot.className = "ict-foot";
    const status = document.createElement("span");
    status.className = "ict-status";
    const actions = document.createElement("div");
    actions.className = "ict-actions";
    const extraButtons = [];
    for (const item of options.extraFoot || []) {
      const button = document.createElement("button");
      button.className = "ict-btn" + (item.className ? " " + item.className : "");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => item.onClick?.(ui));
      extraButtons.push(button);
      actions.appendChild(button);
    }
    const cancelLabel = options.cancelLabel || t("api.cancel");
    const applyLabel = options.applyLabel === null ? null : (options.applyLabel || t("image.apply"));
    const cancel = document.createElement("button");
    cancel.className = "ict-btn"; cancel.type = "button"; cancel.textContent = cancelLabel;
    actions.appendChild(cancel);
    let apply = null;
    if (applyLabel && !options.progress) {
      apply = document.createElement("button");
      apply.className = "ict-btn ict-btn--primary"; apply.type = "button";
      apply.textContent = applyLabel;
      if (options.applyDisabled) apply.disabled = true;
      actions.appendChild(apply);
    }
    foot.append(status, actions);
    panel.append(head, ...(warnEl ? [warnEl] : []), body, foot);
    mask.appendChild(panel);
    host.appendChild(mask);

    const controller = new AbortController();
    let busy = false;
    /* The reference keeps an apiReady flag and ANDs it into every render pass
       (`run.disabled = !valid() || busy || !apiReady`). Keeping it in the shell
       means a later paint()/render() cannot re-enable Apply behind the
       "backend not restarted" banner, and no tool has to remember it. */
    let apiReady = true;
    let applyEnabled = options.applyDisabled ? false : true;
    const refreshApply = () => {
      if (apply && !busy) apply.disabled = !applyEnabled || !apiReady;
    };
    const ui = {
      body, panel, mask, signal: controller.signal,
      setStatus(text, isError = false) {
        /* `loadedmetadata` clears the status after preflight; keep the
           readiness error visible when the backend is still an old process. */
        if (!text && !apiReady && status.classList.contains("is-error")) return;
        status.textContent = text || "";
        status.classList.toggle("is-error", !!isError);
      },
      setBusy(value) {
        busy = !!value;
        if (apply) {
          apply.disabled = busy || !applyEnabled || !apiReady;
          apply.textContent = busy ? t("image.processing") : applyLabel;
        }
        cancel.textContent = busy ? t("media.cancelProcessing") : cancelLabel;
        for (const button of extraButtons) button.disabled = busy;
      },
      setApplyEnabled(enabled) { applyEnabled = !!enabled; refreshApply(); },
      setApiReady(ready) {
        apiReady = !!ready;
        if (warnEl) warnEl.hidden = apiReady;
        refreshApply();
      },
      setWarn(ready) { if (warnEl) warnEl.hidden = !!ready; },
      setProgressText(text) { if (progressText) progressText.textContent = text; },
      /* Lets a tool repaint the slider fills after it moves a range in JS. */
      paintRanges() { paintRanges(body); },
      abort() { controller.abort(); },
      close: closeModal,
    };
    modal = { mask, onClose: options.onClose };

    head.querySelector(".ict-x").addEventListener("click", () => {
      if (busy) controller.abort();
      closeModal();
    });
    cancel.addEventListener("click", () => {
      if (busy) controller.abort();
      closeModal();
    });

    async function doApply() {
      if (!options.onApply || busy) return;
      ui.setBusy(true);
      try {
        await options.onApply(ui);
        closeModal();
      } catch (error) {
        if (error?.name === "AbortError") { closeModal(); return; }
        console.error("[InfCanvas tools]", error);
        toast("error", t("image.operationFailed"), String(error?.message || error));
        ui.setStatus(String(error?.message || error), true);
        ui.setBusy(false);
      }
    }
    ui.apply = doApply;
    apply?.addEventListener("click", doApply);

    /* The canvas owns document-level keydown (capture) and Vue Flow owns
       wheel/dblclick. Keep every modal gesture local. Backdrop clicks do NOT
       close (the reference avoids a second click landing on the canvas). */
    const swallow = (event) => event.stopPropagation();
    for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick",
                        "wheel", "contextmenu", "pointermove", "keydown", "keyup",
                        "paste", "drop", "dragover"]) {
      mask.addEventListener(type, swallow, false);
    }
    mask.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeModal(); }
    });
    try { options.build?.(body, ui); } catch (error) { console.error("[InfCanvas tools] build", error); }
    /* ComfyUI's Slider paints its fill with a range element, we have no
       SliderRange node, so the value is mirrored into --ict-p for the track
       gradient. Sliders are created by build(), hence the paint here. */
    decorateNumberFields(body);
    paintRanges(body);
    body.addEventListener("input", (event) => {
      if (event.target?.type === "range") paintRange(event.target);
    });
    body.addEventListener("change", (event) => {
      if (event.target?.type === "range") paintRange(event.target);
    });
    if (options.run) Promise.resolve().then(() => options.run(ui));
    if (!options.progress) {
      const focus = body.querySelector("input, textarea, button");
      focus?.focus?.();
    }
    return ui;
  }

  /* --------------------------- result plumbing --------------------------- */

  /* Place a result next to the source node, but always inside the visible
     area (the reference buildResultNodes/placeClear rule: off-screen nodes get
     dropped by Vue Flow). core.freeSpot() does exactly that search. */
  function resultPosition(ctx, index = 0) {
    const src = NS.flow?.findNode?.(ctx.id);
    const width = Number(src?.data?.size?.[0]) || 480;
    const desired = src ? [src.position.x + width + 80, src.position.y + index * 40] : null;
    if (!desired) return null;
    return NS.api?.freeSpot ? NS.api.freeSpot(desired, [480, 270], "asset") : desired;
  }

  function commitAsset(asset, ctx, index = 0) {
    const node = NS.api.addNodeByType(NS.TYPE_BY_KIND[asset.kind], resultPosition(ctx, index), asset);
    NS.ui?.refreshPanels?.();
    NS.api?.markDirty?.();
    return node;
  }

  async function spawn(blob, filename, ctx, index = 0) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    const asset = await NS.backend.upload(file);
    return commitAsset(asset, ctx, index);
  }

  /* FFmpeg endpoints return asset descriptors directly (no upload needed). */
  function spawnRefs(files, ctx) {
    return (files || []).map((asset, index) => commitAsset(asset, ctx, index));
  }

  function refOf(ctx) {
    const asset = ctx.data?.asset || {};
    if (asset.filename) {
      return { filename: String(asset.filename), subfolder: String(asset.subfolder || ""),
               type: String(asset.type || "input") };
    }
    try {
      const url = new URL(ctx.url, location.origin);
      return { filename: url.searchParams.get("filename") || "",
               subfolder: url.searchParams.get("subfolder") || "",
               type: url.searchParams.get("type") || "input" };
    } catch (error) {
      return { filename: "", subfolder: "", type: "input" };
    }
  }

  const API_AUDIO = "/api/infcanvas/audio/process";
  const API_VIDEO = "/api/infcanvas/video/process";
  const API_HEALTH = "/api/infcanvas/media/health";
  const NOT_READY = "image.mediaApiNotReadyFully";
  /* Built at call time so the active language is honoured (module loads before
     i18n). t() returns a plain string; escape the highlighted phrase as HTML. */
  function warnHtml() {
    return t("core.mediaProcessingApiNotReady")
      .replace("{strong}", "<strong>").replace("{/strong}", "</strong>");
  }
  /* Legacy getter kept for compatibility; prefer warnHtml() so the language
     is resolved at call time, not module load. */
  const WARN_HTML = "Media API not ready: backend Python has not restarted. Please <strong>fully restart ComfyUI</strong> " +
    "(refreshing alone won't help), then retry.";

  /* A Python route change needs a real ComfyUI restart. An old process answers
     with plain text 404/405, which res.json() would report as a parse error. */
  function createProbe() {
    let ready = false, checked = false;
    return {
      invalidate() { ready = false; checked = false; },
      async check() {
        if (checked) return ready;
        try {
          const res = await fetch(API_HEALTH, { cache: "no-store" });
          const raw = await res.text();
          let ok = false;
          try { ok = res.ok && /json/i.test(res.headers.get("content-type") || "") && !!JSON.parse(raw).ok; }
          catch (error) { ok = false; }
          ready = ok; checked = ok;
        } catch (error) { ready = false; checked = false; }
        return ready;
      },
    };
  }

  async function request(api, payload, signal) {
    const res = await fetch(api, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: signal || undefined,
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (error) {
      throw new Error(t("image.mediaApiNotReadyHttp", { status: res.status }));
    }
    if (!res.ok) {
      const detail = data?.detail;
      let msg = data?.error || ("HTTP " + res.status);
      if (detail && detail.ref) {
        const r = detail.ref;
        msg += t("core.punctParenOpen") + r.filename + " @ " + (r.subfolder || "/") + "/" + r.type + t("core.punctParenClose");
      }
      throw new Error(msg);
    }
    return data;
  }

  /* mm:ss.cc, same as the reference video/audio editors' formatTime. */
  const fmtPrecise = (value) => {
    const t = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 100);
    return String(Math.floor(t / 6000)).padStart(2, "0") + ":" +
      ((t % 6000) / 100).toFixed(2).padStart(5, "0");
  };

  function saveBlob(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /* ---------------------- image adjustment kernel ----------------------- */
  /* Ported verbatim (constants and pass order) from the reference project's
     xcat-image-adjust-core.js. Pixels are converted to linear light, held in a
     Float32Array and encoded back; 8-bit in-place maths loses dark detail. */

  const ADJUST_FIELDS = [
    { key: "brightness", label: t("image.brightness"), min: -1, max: 1 },
    { key: "exposure", label: t("image.exposure"), min: -1, max: 1 },
    { key: "contrast", label: t("image.contrast"), min: -1, max: 1 },
    { key: "highlights", label: t("image.highlights"), min: -1, max: 1 },
    { key: "shadows", label: t("image.shadows"), min: -1, max: 1 },
    { key: "saturation", label: t("image.saturation"), min: -1, max: 1 },
    { key: "vibrance", label: t("image.vibrance"), min: -1, max: 1 },
    { key: "temperature", label: t("image.warmth"), min: -1, max: 1 },
    { key: "tint", label: t("image.fade"), min: -1, max: 1 },
    { key: "clarity", label: t("image.clarity"), min: -1, max: 1 },
    { key: "vignette", label: t("image.vignette"), min: 0, max: 1 },
  ];
  const defaultParams = () => Object.fromEntries(ADJUST_FIELDS.map((f) => [f.key, 0]));
  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

  function multiplyMatrix(left, right) {
    const out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += left[row][k] * right[k][col];
        out[row][col] = sum;
      }
    }
    return out;
  }
  function buildColorMatrix(p) {
    const brightness = p.brightness / 4;
    const contrast = (p.contrast + 1) / 2 + 0.5;
    const saturation = p.saturation + 1;
    const exposure = ((p.exposure > 0 ? p.exposure * 3 : p.exposure * 1.5) + 1) / 2 + 0.5;
    const x = p.temperature * 2, tint = p.tint * 2;
    const B = { matrix: IDENTITY, offset: [brightness, brightness, brightness, 0] };
    const C = { matrix: [[contrast, 0, 0, 0], [0, contrast, 0, 0], [0, 0, contrast, 0], [0, 0, 0, 1]],
                offset: [0.5 * (1 - contrast), 0.5 * (1 - contrast), 0.5 * (1 - contrast), 0] };
    const S = { matrix: [
      [0.213 + 0.787 * saturation, 0.715 - 0.715 * saturation, 0.072 - 0.072 * saturation, 0],
      [0.213 - 0.213 * saturation, 0.715 + 0.285 * saturation, 0.072 - 0.072 * saturation, 0],
      [0.213 - 0.213 * saturation, 0.715 - 0.715 * saturation, 0.072 + 0.928 * saturation, 0],
      [0, 0, 0, 1]] };
    const E = { matrix: [[exposure, 0, 0, 0], [0, exposure, 0, 0], [0, 0, exposure, 0], [0, 0, 0, 1]] };
    const T = { matrix: x > 0
      ? [[1 + 0.1 * x, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1 - 0.1 * x, 0], [0, 0, 0, 1]]
      : [[1 + 0.15 * x, 0, 0, 0], [0, 1 + 0.05 * x, 0, 0], [0, 0, 1 - 0.15 * x, 0], [0, 0, 0, 1]] };
    const I = { matrix: [[1, 0, 0, 0], [0, 1 + 0.1 * tint, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] };
    let matrix = IDENTITY;
    const offset = [0, 0, 0, 0];
    for (const step of [B, C, S, E, T, I]) {
      matrix = multiplyMatrix(matrix, step.matrix);
      if (step.offset) for (let j = 0; j < 4; j += 1) offset[j] += step.offset[j];
    }
    return { matrix, offset };
  }
  function pick(source, width, height, x, y, channel) {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return source[(cy * width + cx) * 3 + channel];
  }
  function applyClarity(buffer, width, height, clarity) {
    const f = clarity;
    const kernel = f >= 0
      ? [0, -f, 0, -f, 1 + 4 * f, -f, 0, -f, 0]
      : [-f, -2 * f, -f, -2 * f, 1 - 3 * f, -2 * f, -f, -2 * f, -f];
    let weight = kernel.reduce((sum, v) => sum + v, 0);
    if (weight <= 0) weight = 1;
    const snapshot = Float32Array.from(buffer);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky += 1) {
            for (let kx = -1; kx <= 1; kx += 1) {
              sum += pick(snapshot, width, height, x + kx, y + ky, channel) * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          buffer[target + channel] = clamp01(sum / weight);
        }
      }
    }
  }
  function applyHighlightsShadows(buffer, highlights, shadows) {
    const uHighlights = highlights + 1, uShadows = shadows / 2 + 1;
    const whiteTarget = clamp(uHighlights, 0, 2) - 1;
    const blackTarget = 1 - clamp(uShadows, 0, 1);
    const shadowPower = 1 / uShadows;
    const highlightPower1 = 1 / (2 - uHighlights), highlightPower2 = 2 / (2 - uHighlights);
    for (let index = 0; index < buffer.length; index += 3) {
      const r = buffer[index], g = buffer[index + 1], b = buffer[index + 2];
      const luminance = 0.2125 * r + 0.7154 * g + 0.0721 * b;
      if (luminance <= 0) continue;
      const shadow = clamp((Math.pow(luminance, shadowPower) + -0.76 * Math.pow(luminance, 2 / uShadows)) - luminance, 0, 1);
      const highlight = clamp((1 - (Math.pow(1 - luminance, highlightPower1) + -0.8 * Math.pow(1 - luminance, highlightPower2))) - luminance, -1, 0);
      const scale = (luminance + shadow + highlight) / luminance;
      const contrasted = (luminance - 0.5) * 1.5 + 0.5;
      const whiteInterp = contrasted * contrasted * contrasted;
      const inverse = 1 - contrasted;
      const blackInterp = inverse * inverse * inverse;
      const whiteBlend = whiteInterp * whiteTarget;
      const blackBlend = blackInterp * blackTarget;
      buffer[index] = (r * scale + (1 - r * scale) * whiteBlend) * (1 - blackBlend);
      buffer[index + 1] = (g * scale + (1 - g * scale) * whiteBlend) * (1 - blackBlend);
      buffer[index + 2] = (b * scale + (1 - b * scale) * whiteBlend) * (1 - blackBlend);
    }
  }
  function applyImageAdjust(image, params) {
    const width = image.width, height = image.height, data = image.data;
    if (ADJUST_FIELDS.every((f) => params[f.key] === 0)) return image;
    const count = width * height;
    const buffer = new Float32Array(count * 3);
    for (let pixel = 0, s = 0, d = 0; pixel < count; pixel += 1, s += 4, d += 3) {
      buffer[d] = srgbToLinear(data[s] / 255);
      buffer[d + 1] = srgbToLinear(data[s + 1] / 255);
      buffer[d + 2] = srgbToLinear(data[s + 2] / 255);
    }
    if (params.highlights !== 0 || params.shadows !== 0) applyHighlightsShadows(buffer, params.highlights, params.shadows);
    if (params.clarity !== 0) applyClarity(buffer, width, height, params.clarity);
    const { matrix, offset } = buildColorMatrix(params);
    const [m00, m01, m02] = matrix[0], [m10, m11, m12] = matrix[1], [m20, m21, m22] = matrix[2];
    const vibrance = params.vibrance, vignette = params.vignette;
    for (let y = 0; y < height; y += 1) {
      const ny = (y + 0.5) * 2 / height - 1;
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 3;
        let r = buffer[target], g = buffer[target + 1], b = buffer[target + 2];
        if (vibrance !== 0) {
          const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
          const average = (r + g + b) / 3;
          const amount = Math.abs(max - average) * 2 * -vibrance;
          if (r !== max) r += (max - r) * amount;
          if (g !== max) g += (max - g) * amount;
          if (b !== max) b += (max - b) * amount;
        }
        const nr = clamp01(m00 * r + m01 * g + m02 * b + offset[0]);
        const ng = clamp01(m10 * r + m11 * g + m12 * b + offset[1]);
        const nb = clamp01(m20 * r + m21 * g + m22 * b + offset[2]);
        r = nr; g = ng; b = nb;
        if (vignette !== 0) {
          const nx = (x + 0.5) * 2 / width - 1;
          const curveX = Math.pow(Math.abs(nx), 1 / 0.65);
          const curveY = Math.pow(Math.abs(ny), 1 / 0.65);
          const edge = Math.pow(Math.sqrt(curveX * curveX + curveY * curveY), 0.65);
          const factor = 1 - vignette * smoothstep(0.20, 1.1, edge);
          r *= factor; g *= factor; b *= factor;
        }
        buffer[target] = r; buffer[target + 1] = g; buffer[target + 2] = b;
      }
    }
    for (let p = 0, s = 0, t = 0; p < count; p += 1, s += 3, t += 4) {
      data[t] = linearToSrgb(clamp01(buffer[s])) * 255;
      data[t + 1] = linearToSrgb(clamp01(buffer[s + 1])) * 255;
      data[t + 2] = linearToSrgb(clamp01(buffer[s + 2])) * 255;
    }
    return image;
  }

  /* ------------------------------------------------------------ LUT ------
     Standard Adobe .cube LUT text parser + sampler. Supports 3D tables
     (LUT_3D_SIZE, the common case) and 1D tables (LUT_1D_SIZE), with optional
     DOMAIN_MIN / DOMAIN_MAX. Cube stores red as the fastest-varying axis, so a
     sample index is r + N*(g + N*b). LUTs are display-referred (sRGB): they are
     applied AFTER the linear-light image adjustments, directly on image.data.
     Kept as pure functions and exported on helpers so they can be unit-tested. */
  function parseCubeLUT(text) {
    const lines = String(text || "").split(/\r?\n/);
    let size = 0, dim = 0, title = "";
    let dmin = [0, 0, 0], dmax = [1, 1, 1];
    const data = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.charAt(0) === "#") continue;
      const parts = line.split(/\s+/);
      const head = parts[0].toUpperCase();
      if (head === "TITLE") { title = parts.slice(1).join(" ").replace(/^"|"$/g, ""); continue; }
      if (head === "LUT_3D_SIZE") { dim = 3; size = parseInt(parts[1], 10); continue; }
      if (head === "LUT_1D_SIZE") { dim = 1; size = parseInt(parts[1], 10); continue; }
      if (head === "DOMAIN_MIN") { dmin = [ +parts[1], +parts[2], +parts[3] ]; continue; }
      if (head === "DOMAIN_MAX") { dmax = [ +parts[1], +parts[2], +parts[3] ]; continue; }
      const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) data.push(r, g, b);
    }
    const need = (dim === 3 ? size * size * size : size) * 3;
    if (!dim || !Number.isInteger(size) || size < 2 || size > 256 || data.length !== need) {
      throw new Error(t("core.invalidLutFileSizeData", { n: need }));
    }
    return { dim, size, domainMin: dmin, domainMax: dmax, title, data: new Float32Array(data) };
  }

  function sampleLUT3D(lut, r, g, b, out) {
    const n = lut.size, s = n - 1, d = lut.data, dmin = lut.domainMin, dmax = lut.domainMax;
    const fr = clamp01((r - dmin[0]) / ((dmax[0] - dmin[0]) || 1)) * s;
    const fg = clamp01((g - dmin[1]) / ((dmax[1] - dmin[1]) || 1)) * s;
    const fb = clamp01((b - dmin[2]) / ((dmax[2] - dmin[2]) || 1)) * s;
    const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
    const r1 = Math.min(r0 + 1, s), g1 = Math.min(g0 + 1, s), b1 = Math.min(b0 + 1, s);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    const at = (ri, gi, bi) => (ri + n * (gi + n * bi)) * 3;
    for (let c = 0; c < 3; c += 1) {
      const c000 = d[at(r0, g0, b0) + c], c100 = d[at(r1, g0, b0) + c];
      const c010 = d[at(r0, g1, b0) + c], c110 = d[at(r1, g1, b0) + c];
      const c001 = d[at(r0, g0, b1) + c], c101 = d[at(r1, g0, b1) + c];
      const c011 = d[at(r0, g1, b1) + c], c111 = d[at(r1, g1, b1) + c];
      const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
      const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
      const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
      out[c] = c0 + (c1 - c0) * tb;
    }
  }

  function sampleLUT1D(lut, r, g, b, out) {
    const n = lut.size, s = n - 1, d = lut.data, dmin = lut.domainMin, dmax = lut.domainMax;
    for (let c = 0; c < 3; c += 1) {
      const v = c === 0 ? r : (c === 1 ? g : b);
      const f = clamp01((v - dmin[c]) / ((dmax[c] - dmin[c]) || 1)) * s;
      const i0 = Math.floor(f), i1 = Math.min(i0 + 1, s), t = f - i0;
      out[c] = d[i0 * 3 + c] + (d[i1 * 3 + c] - d[i0 * 3 + c]) * t;
    }
  }

  function applyLUT(image, lut, strength) {
    if (!lut || !(strength > 0)) return image;
    const data = image.data, count = image.width * image.height, amt = clamp01(strength);
    const sample = lut.dim === 3 ? sampleLUT3D : sampleLUT1D;
    const mapped = [0, 0, 0];
    for (let p = 0, o = 0; p < count; p += 1, o += 4) {
      const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
      sample(lut, r, g, b, mapped);
      data[o] = clamp01(r + (mapped[0] - r) * amt) * 255;
      data[o + 1] = clamp01(g + (mapped[1] - g) * amt) * 255;
      data[o + 2] = clamp01(b + (mapped[2] - b) * amt) * 255;
    }
    return image;
  }

  /* ------------------------------ image tools ---------------------------- */

  const RATIOS = [
    { key: "origin", label: t("image.original"), value: 0 },
    { key: "1:1", label: "1:1", value: 1 },
    { key: "2:3", label: "2:3", value: 2 / 3 },
    { key: "3:2", label: "3:2", value: 3 / 2 },
    { key: "3:4", label: "3:4", value: 3 / 4 },
    { key: "4:3", label: "4:3", value: 4 / 3 },
    { key: "9:16", label: "9:16", value: 9 / 16 },
    { key: "16:9", label: "16:9", value: 16 / 9 },
    { key: "21:9", label: "21:9", value: 21 / 9 },
    { key: "free", label: t("image.free"), value: null },
  ];

  /* ---------------------------------------------------------------- crop ----
     Reference xcat-image-tools.js openCrop(): selection stored in natural
     pixels; explicit preview frame size; drag-to-create, drag inside to move,
     8 resize handles, ratio locks (原图 / 1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 9:16 /
     16:9 / 21:9 / 自由), 宽/高 numeric fields, arrow-key nudging, "shortcuts.selectAll" button. */
  R.crop = async (ctx) => {
    const img = await loadImage(ctx.url);
    const W = img.naturalWidth, H = img.naturalHeight;
    const S = {
      natW: W, natH: H, scale: 1, dispW: 0, dispH: 0,
      rect: { x: Math.round(W * 0.1), y: Math.round(H * 0.1),
              w: Math.round(W * 0.8), h: Math.round(H * 0.8) },
      ratioKey: "origin", ratio: 1, drag: null, ready: false,
    };
    let stage, frame, preview, inputs = {}, uiRef = null, layoutHandler = null;

    const ratioValue = () => {
      const entry = RATIOS.find((r) => r.key === S.ratioKey);
      if (!entry) return null;
      if (entry.value === 0) return W / H;
      return entry.value;
    };
    const isValid = () => S.ready && S.rect.w >= 1 && S.rect.h >= 1 &&
      S.rect.x >= 0 && S.rect.y >= 0 &&
      S.rect.x + S.rect.w <= W + 0.6 && S.rect.y + S.rect.h <= H + 0.6;

    function layout() {
      if (!S.ready || !stage || !preview) return;
      const availW = Math.max(40, preview.clientWidth);
      const availH = Math.max(40, preview.clientHeight);
      const scale = Math.min(availW / W, availH / H);
      if (!Number.isFinite(scale) || scale <= 0) return;
      S.scale = scale;
      S.dispW = Math.max(1, Math.round(W * scale));
      S.dispH = Math.max(1, Math.round(H * scale));
      stage.style.width = S.dispW + "px";
      stage.style.height = S.dispH + "px";
      const image = stage.querySelector("img");
      if (image) {
        image.style.position = "absolute"; image.style.inset = "0";
        image.style.width = "100%"; image.style.height = "100%";
        image.style.maxWidth = "none"; image.style.maxHeight = "none";
      }
      paint();
    }

    function paint(skipInputs = false) {
      if (!frame) return;
      const c = S.rect, s = S.scale;
      frame.style.left = (c.x * s) + "px";
      frame.style.top = (c.y * s) + "px";
      frame.style.width = Math.max(1, c.w * s) + "px";
      frame.style.height = Math.max(1, c.h * s) + "px";
      if (!skipInputs) {
        for (const key of ["w", "h"]) {
          const el = inputs[key];
          if (el && document.activeElement !== el) el.value = Math.round(c[key]);
        }
      }
      /* Only the source size here: the crop size already sits in the 宽 / 高
         fields right above, so repeating it just made the line read twice. */
      const summary = document.querySelector(".ict-crop-size");
      if (summary) summary.textContent = S.ready ? t("image.original") + ` ${W} × ${H}` : t("image.readingImage");
      uiRef?.setApplyEnabled?.(isValid());
    }

    function normalise() {
      const c = S.rect;
      c.w = clamp(Math.round(c.w), 1, W);
      c.h = clamp(Math.round(c.h), 1, H);
      c.x = clamp(Math.round(c.x), 0, Math.max(0, W - c.w));
      c.y = clamp(Math.round(c.y), 0, Math.max(0, H - c.h));
    }

    /* Opposite edge/corner stays fixed, ratio lock derives h from w. */
    function resizeRect(dir, p, anchor, r) {
      const hasW = dir.includes("w"), hasE = dir.includes("e");
      const hasN = dir.includes("n"), hasS = dir.includes("s");
      const x0 = anchor.x, y0 = anchor.y, x1 = x0 + anchor.w, y1 = y0 + anchor.h;
      const fx = hasW ? x1 : (hasE ? x0 : (x0 + x1) / 2);
      const fy = hasN ? y1 : (hasS ? y0 : (y0 + y1) / 2);
      const dx = hasW ? -1 : (hasE ? 1 : 0);
      const dy = hasN ? -1 : (hasS ? 1 : 0);
      let w = (hasW || hasE) ? Math.abs(p.x - fx) : anchor.w;
      let h = (hasN || hasS) ? Math.abs(p.y - fy) : anchor.h;
      if (r) { w = Math.max(w, h * r); h = w / r; }
      const availW = dx > 0 ? W - fx : (dx < 0 ? fx : Math.min(fx, W - fx) * 2);
      const availH = dy > 0 ? H - fy : (dy < 0 ? fy : Math.min(fy, H - fy) * 2);
      if (r) { const limit = Math.min(availW, availH * r); w = Math.min(w, limit); h = w / r; }
      else { w = Math.min(w, availW); h = Math.min(h, availH); }
      w = Math.max(1, Math.min(w, W));
      h = Math.max(1, Math.min(h, H));
      return {
        x: clamp(dx > 0 ? fx : (dx < 0 ? fx - w : fx - w / 2), 0, Math.max(0, W - w)),
        y: clamp(dy > 0 ? fy : (dy < 0 ? fy - h : fy - h / 2), 0, Math.max(0, H - h)),
        w, h,
      };
    }

    function setRatio(key) {
      S.ratioKey = key;
      const entry = RATIOS.find((r) => r.key === key);
      if (entry && entry.value > 0) S.ratio = entry.value;
      document.querySelectorAll(".ict-ratio").forEach((chip) => {
        const on = chip.dataset.ratio === key;
        chip.classList.toggle("is-active", on);
        chip.setAttribute("aria-pressed", String(on));
      });
      const r = ratioValue();
      if (!r || !Number.isFinite(r) || r <= 0) return paint();
      const c = S.rect, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      const maxW = Math.min(cx, W - cx) * 2, maxH = Math.min(cy, H - cy) * 2;
      const w = Math.max(1, Math.min(Math.max(c.w, c.h * r), maxW, maxH * r));
      const h = w / r;
      S.rect = { x: clamp(cx - w / 2, 0, Math.max(0, W - w)),
                 y: clamp(cy - h / 2, 0, Math.max(0, H - h)), w, h };
      paint();
    }

    function setField(key, value) {
      const c = { ...S.rect }, r = ratioValue();
      if (key === "w" || key === "h") {
        let w = key === "w" ? value : c.w, h = key === "h" ? value : c.h;
        if (r) { if (key === "w") h = w / r; else w = h * r; }
        w = clamp(w, 1, Math.max(1, W - c.x));
        h = clamp(h, 1, Math.max(1, H - c.y));
        if (r) { const limit = Math.min(W - c.x, (H - c.y) * r);
                 w = Math.min(w, Math.max(1, limit)); h = w / r; }
        c.w = w; c.h = h;
      }
      S.rect = c;
      paint(true);
    }

    openModal({
      title: t("image.crop"), width: 860,
      applyLabel: t("image.cropCreateNode"), applyDisabled: true,
      extraFoot: [{ label: t("shortcuts.selectAll"), onClick: () => {
        const r = ratioValue();
        if (!r) S.rect = { x: 0, y: 0, w: W, h: H };
        else { const w = Math.min(W, H * r), h = w / r;
               S.rect = { x: (W - w) / 2, y: (H - h) / 2, w, h }; }
        paint();
      } }],
      build(body, ui) {
        uiRef = ui;
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview">
              <div class="ict-crop-stage">
                <img alt="${t('image.original')}" />
                <div class="ict-crop-frame">
                  ${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((d) => `<i class="ict-handle ict-h-${d}" data-d="${d}"></i>`).join("")}
                </div>
              </div>
            </div>
            <aside class="ict-side">
              <div><p class="ict-label">${t('core.ratio')}</p><div class="ict-chips ict-ratios"></div></div>
              <div class="ict-4">
                <label>${t('core.width')} <input class="ict-input" type="number" data-f="w" /></label>
                <label>${t('core.height')} <input class="ict-input" type="number" data-f="h" /></label>
              </div>
              <p class="ict-summary ict-crop-size">${t('image.readingImage')}</p>
            </aside>
          </div>`;
        preview = body.querySelector(".ict-preview");
        stage = body.querySelector(".ict-crop-stage");
        frame = body.querySelector(".ict-crop-frame");
        const image = stage.querySelector("img");
        image.src = ctx.url;

        const chips = body.querySelector(".ict-ratios");
        for (const entry of RATIOS) {
          const chip = document.createElement("button");
          chip.type = "button"; chip.className = "ict-chip ict-ratio";
          chip.dataset.ratio = entry.key; chip.textContent = entry.label;
          chip.setAttribute("aria-pressed", String(entry.key === S.ratioKey));
          if (entry.key === S.ratioKey) chip.classList.add("is-active");
          chip.addEventListener("click", () => setRatio(entry.key));
          chips.appendChild(chip);
        }
        body.querySelectorAll(".ict-4 input[data-f]").forEach((input) => {
          inputs[input.dataset.f] = input;
          input.addEventListener("input", () => {
            const value = parseFloat(input.value);
            if (Number.isFinite(value)) setField(input.dataset.f, value);
          });
        });

        const at = (event) => {
          const box = stage.getBoundingClientRect();
          return { x: clamp((event.clientX - box.left) / S.scale, 0, W),
                   y: clamp((event.clientY - box.top) / S.scale, 0, H) };
        };
        stage.addEventListener("pointerdown", (event) => {
          if (!S.ready || event.button !== 0) return;
          event.preventDefault();
          const p = at(event);
          const handle = event.target.closest?.(".ict-handle");
          const c = S.rect;
          const inside = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
          S.drag = {
            mode: handle ? "resize" : (inside ? "move" : "new"),
            dir: handle?.dataset.d || "", anchor: p,
            rect: { ...c }, r: ratioValue(),
          };
          if (S.drag.mode === "new") S.rect = { x: p.x, y: p.y, w: 0, h: 0 };
          try { stage.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
          paint();
        });
        stage.addEventListener("pointermove", (event) => {
          const d = S.drag;
          if (!d) return;
          const p = at(event);
          if (d.mode === "move") {
            S.rect = {
              x: clamp(d.rect.x + (p.x - d.anchor.x), 0, Math.max(0, W - d.rect.w)),
              y: clamp(d.rect.y + (p.y - d.anchor.y), 0, Math.max(0, H - d.rect.h)),
              w: d.rect.w, h: d.rect.h,
            };
          } else if (d.mode === "new") {
            const dirX = p.x >= d.anchor.x ? 1 : -1, dirY = p.y >= d.anchor.y ? 1 : -1;
            let w = Math.abs(p.x - d.anchor.x), h = Math.abs(p.y - d.anchor.y);
            if (d.r) { w = Math.max(w, h * d.r); h = w / d.r; }
            const maxW = dirX > 0 ? W - d.anchor.x : d.anchor.x;
            const maxH = dirY > 0 ? H - d.anchor.y : d.anchor.y;
            if (d.r) { const limit = Math.min(maxW, maxH * d.r); w = Math.min(w, limit); h = w / d.r; }
            else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
            S.rect = { x: dirX > 0 ? d.anchor.x : d.anchor.x - w,
                       y: dirY > 0 ? d.anchor.y : d.anchor.y - h, w, h };
          } else {
            S.rect = resizeRect(d.dir, p, d.rect, d.r);
          }
          paint();
          event.preventDefault();
        });
        const stop = () => { S.drag = null; normalise(); paint(); };
        stage.addEventListener("pointerup", stop);
        stage.addEventListener("pointercancel", stop);
        body.addEventListener("keydown", (event) => {
          const tag = document.activeElement?.tagName || "";
          if (tag === "INPUT" || tag === "TEXTAREA") return;
          const step = event.shiftKey ? 10 : 1;
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                          ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
          if (!delta) return;
          event.preventDefault();
          S.rect.x += delta[0]; S.rect.y += delta[1];
          normalise(); paint();
        });

        const init = () => {
          if (S.ready) return;
          S.ready = true;
          layout();
        };
        image.addEventListener("load", init);
        if (image.complete && image.naturalWidth) init();
        layoutHandler = layout;
        window.addEventListener("resize", layoutHandler);
      },
      onClose: () => {
        if (layoutHandler) window.removeEventListener("resize", layoutHandler);
        layoutHandler = null;
      },
      onApply: async (ui) => {
        normalise();
        if (!isValid()) throw new Error(t("image.pleaseSelectValidCropArea"));
        const c = S.rect;
        const sx = clamp(Math.round(c.x), 0, W - 1), sy = clamp(Math.round(c.y), 0, H - 1);
        const sw = clamp(Math.round(c.w), 1, W - sx), sh = clamp(Math.round(c.h), 1, H - sy);
        const canvas = document.createElement("canvas");
        canvas.width = sw; canvas.height = sh;
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        ui.setStatus(t("image.croppingOriginalResolution"));
        await spawn(await canvasBlob(canvas),
          `${stemOf(ctx.data.asset?.name)}_crop_${sw}x${sh}.png`, ctx);
      },
    });
  };

  /* ---------------------------------------------------------------- grid ---- */
  R.grid = async (ctx) => {
    const img = await loadImage(ctx.url);
    let rows = 3, cols = 3;
    let custom = false; // true = 自定义滑块模式；false = 预设模式
    let overlay, summary, inputs = {}, outputs = {}, customBtn = null, customBox = null;
    const valid = () => Number.isInteger(rows) && Number.isInteger(cols) &&
      rows >= 1 && rows <= 10 && cols >= 1 && cols <= 10 && rows * cols > 1;
    const render = () => {
      if (inputs.rows) inputs.rows.value = rows;
      if (inputs.cols) inputs.cols.value = cols;
      if (outputs.rows) outputs.rows.textContent = String(rows);
      if (outputs.cols) outputs.cols.textContent = String(cols);
      /* render() may write the inputs itself (preset click / reset), which
         fires no input event — repaint the slider fill or the track lies. */
      if (customBox) paintRanges(customBox);
      overlay.innerHTML = "";
      const total = rows * cols;
      for (let i = 0; i < total; i += 1) {
        const cell = document.createElement("div");
        cell.className = "ict-cell";
        cell.style.left = ((i % cols) / cols * 100) + "%";
        cell.style.top = (Math.floor(i / cols) / rows * 100) + "%";
        cell.style.width = (100 / cols) + "%";
        cell.style.height = (100 / rows) + "%";
        cell.textContent = String(i + 1);
        overlay.appendChild(cell);
      }
      summary.textContent = valid() ? t("image.images", { n: total }) : t("image.setValidRowColumnCounts");
      document.querySelectorAll(".ict-grid-preset").forEach((chip) => {
        const n = Number(chip.dataset.grid);
        chip.classList.toggle("is-active", !custom && n === rows && n === cols);
      });
      customBtn?.classList.toggle("is-active", custom);
      if (customBox) customBox.hidden = !custom;
      uiRef?.setApplyEnabled?.(valid() && img.naturalWidth >= cols && img.naturalHeight >= rows);
    };
    let uiRef = null;
    openModal({
      title: t("image.gridCrop"), width: 860,
      applyLabel: t("image.splitIntoImageNodes"), applyDisabled: true,
      build(body, ui) {
        uiRef = ui;
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview"><div class="ict-crop-stage">
              <img alt="${t('image.original')}" /><div class="ict-grid-overlay"></div>
            </div></div>
            <aside class="ict-side">
              <div><p class="ict-label">${t('core.preset')}</p><div class="ict-grid-presets"></div></div>
              <button class="ict-grid-custom-btn" type="button">${t('core.custom')}</button>
              <div class="ict-grid-custom" hidden>
                <label class="ict-grid-slider-row"><span>${t('core.rows')}</span>
                  <input type="range" data-f="rows" min="1" max="10" step="1" value="3" />
                  <output data-o="rows">3</output></label>
                <label class="ict-grid-slider-row"><span>${t('core.columns')}</span>
                  <input type="range" data-f="cols" min="1" max="10" step="1" value="3" />
                  <output data-o="cols">3</output></label>
              </div>
              <p class="ict-summary"></p>
            </aside>
          </div>`;
        body.querySelector("img").src = ctx.url;
        const gridStage = body.querySelector(".ict-crop-stage");
        const gridImg = body.querySelector("img");
        const gridPreview = body.querySelector(".ict-preview");
        const layoutGrid = () => {
          if (!gridImg.naturalWidth || !gridPreview) return;
          const s = Math.min(gridPreview.clientWidth / gridImg.naturalWidth,
                             gridPreview.clientHeight / gridImg.naturalHeight);
          gridStage.style.width = Math.round(gridImg.naturalWidth * s) + "px";
          gridStage.style.height = Math.round(gridImg.naturalHeight * s) + "px";
          gridImg.style.width = "100%"; gridImg.style.height = "100%";
          gridImg.style.maxWidth = "none"; gridImg.style.maxHeight = "none";
        };
        if (gridImg.complete) layoutGrid(); else gridImg.addEventListener("load", layoutGrid);
        overlay = body.querySelector(".ict-grid-overlay");
        summary = body.querySelector(".ict-summary");
        const presets = body.querySelector(".ict-grid-presets");
        for (const n of [2, 3, 4, 5]) {
          const chip = document.createElement("button");
          chip.type = "button"; chip.className = "ict-grid-preset"; chip.dataset.grid = String(n);
          const icon = document.createElement("i");
          icon.style.gridTemplateColumns = `repeat(${n},1fr)`;
          for (let i = 0; i < n * n; i += 1) icon.appendChild(document.createElement("b"));
          const label = document.createElement("span");
          label.textContent = t("image.grid", { n: n * n });
          chip.append(icon, label);
          chip.addEventListener("click", () => { rows = n; cols = n; custom = false; render(); });
          presets.appendChild(chip);
        }
        customBtn = body.querySelector(".ict-grid-custom-btn");
        customBox = body.querySelector(".ict-grid-custom");
        /* Custom mode always opens at 3 × 3. Inheriting whatever preset was
           tapped last (2 × 2, 25 宫格 …) meant the sliders started on a value
           nobody had asked for. */
        customBtn.addEventListener("click", () => {
          if (!custom) { rows = 3; cols = 3; }
          custom = true; render();
        });
        body.querySelectorAll(".ict-grid-custom output[data-o]").forEach((out) => {
          outputs[out.dataset.o] = out;
        });
        body.querySelectorAll(".ict-grid-custom input[data-f]").forEach((input) => {
          inputs[input.dataset.f] = input;
          input.addEventListener("input", () => {
            const value = parseInt(input.value, 10);
            if (Number.isFinite(value)) {
              const next = clamp(value, 1, 10);
              if (input.dataset.f === "rows") rows = next; else cols = next;
              render();
            }
          });
        });
        render();
      },
      onApply: async (ui) => {
        if (!valid()) throw new Error(t("image.setValidRowsCols"));
        const W = img.naturalWidth, H = img.naturalHeight;
        if (W < cols || H < rows) throw new Error(t("image.imageSmallerGridDimensions"));
        const base = stemOf(ctx.data.asset?.name);
        for (let r = 0, i = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1, i += 1) {
            const x0 = Math.floor(c * W / cols), x1 = Math.floor((c + 1) * W / cols);
            const y0 = Math.floor(r * H / rows), y1 = Math.floor((r + 1) * H / rows);
            const canvas = document.createElement("canvas");
            canvas.width = x1 - x0; canvas.height = y1 - y0;
            canvas.getContext("2d").drawImage(img, x0, y0, canvas.width, canvas.height,
              0, 0, canvas.width, canvas.height);
            ui.setStatus(t("image.generatingOutput", { i: i + 1, n: rows * cols }));
            await spawn(await canvasBlob(canvas), `${base}_grid_${r + 1}-${c + 1}.png`, ctx, i);
          }
        }
      },
    });
  };

  const MIRRORS = [
    { key: "flipX", label: t("image.flipHorizontal"), css: "scaleX(-1)", swap: false },
    { key: "flipY", label: t("image.flipVertical"), css: "scaleY(-1)", swap: false },
    { key: "rotate90", label: t("image.rotate90Cw"), css: "rotate(90deg)", swap: true },
    { key: "rotate270", label: t("image.rotate90Ccw"), css: "rotate(-90deg)", swap: true },
    { key: "rotate180", label: "180°", css: "rotate(180deg)", swap: false },
  ];
  /* rotate-*-square glyphs (lucide): a framed square whose top corner opens
     into a chevron, so the arrow reads as "this box turns". */
  const MIRROR_PATHS = {
    flipX: '<path d="M12 3v18M8 7 3 12l5 5M16 7l5 5-5 5"/>',
    flipY: '<path d="M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
    rotate90: '<path d="M12 5H6a2 2 0 0 0-2 2v3"/><path d="m9 8 3-3-3-3"/>' +
      '<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    rotate270: '<path d="M20 9V7a2 2 0 0 0-2-2h-6"/><path d="m15 2-3 3 3 3"/>' +
      '<path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
    rotate180: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  };
  /* Host lucide glyphs for the transforms that have an exact native match.
     rotate90/270 keep their inline path: the host has no rotate-square glyph. */
  const MIRROR_GLYPH = {
    flipX: "flip-horizontal-2",
    flipY: "flip-vertical-2",
    rotate180: "rotate-ccw",
  };
  const mirrorIcon = (key) => MIRROR_GLYPH[key]
    ? '<i class="icon-[lucide--' + MIRROR_GLYPH[key] + '] size-5" aria-hidden="true"></i>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      (MIRROR_PATHS[key] || "") + "</svg>";

  /* Reference: hover/focus previews the transform, a CLICK immediately
     generates the new node. There is no "image.apply" button in this dialog. */
  R.mirror = async (ctx) => {
    const img = await loadImage(ctx.url);
    let current = MIRRORS[0];
    openModal({
      title: t("image.mirrorRotate"), width: 860,
      applyLabel: null, cancelLabel: t("settings.close"),
      build(body, ui) {
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview ict-mirror-preview"><img alt="${t('core.mirrorPreview')}" /></div>
            <aside class="ict-side">
              <p class="ict-label">${t('core.transform')}</p>
              <div class="ict-mirror-grid"></div>
            </aside>
          </div>`;
        const preview = body.querySelector("img");
        preview.src = ctx.url;
        const grid = body.querySelector(".ict-mirror-grid");
        for (const item of MIRRORS) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ict-mirror-btn" + (item.key === "rotate180" ? " is-wide" : "");
          button.innerHTML = `<span class="ict-mirror-icon">${mirrorIcon(item.key)}</span>` +
            `<span class="ict-mirror-label">${item.label}</span>`;
          const show = () => { preview.style.transform = item.css; };
          const hide = () => { preview.style.transform = ""; };
          button.addEventListener("mouseenter", show);
          button.addEventListener("mouseleave", hide);
          button.addEventListener("focus", show);
          button.addEventListener("blur", hide);
          button.addEventListener("click", () => { current = item; ui.apply(); });
          grid.appendChild(button);
        }
      },
      onApply: async (ui) => {
        const W = img.naturalWidth, H = img.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = current.swap ? H : W;
        canvas.height = current.swap ? W : H;
        const c = canvas.getContext("2d");
        switch (current.key) {
          case "flipX": c.translate(W, 0); c.scale(-1, 1); break;
          case "flipY": c.translate(0, H); c.scale(1, -1); break;
          case "rotate90": c.translate(H, 0); c.rotate(Math.PI / 2); break;
          case "rotate270": c.translate(0, W); c.rotate(-Math.PI / 2); break;
          case "rotate180": c.translate(W, H); c.scale(-1, -1); break;
          default: break;
        }
        c.drawImage(img, 0, 0);
        ui.setStatus(t("image.processingEllipsis"));
        await spawn(await canvasBlob(canvas),
          `${stemOf(ctx.data.asset?.name)}_mirror_${current.key}.png`, ctx);
      },
    });
  };

  const fmtAdjust = (value) => value === 0 ? "0"
    : (value > 0 ? "+" : "−") + Math.abs(value).toFixed(2);
  const isNoop = (params) => ADJUST_FIELDS.every((field) => params[field.key] === 0);

  R.adjust = async (ctx) => {
    const img = await loadImage(ctx.url);
    const params = defaultParams();
    let previewCanvas, raf = 0, ready = false;
    let base = null, pw = 0, ph = 0;
    let lut = null, lutStrength = 1, lutName = "";
    let uiRef = null, lutNameEl = null, lutDetailEl = null, lutFileEl = null,
        lutStrengthEl = null, lutStrengthOut = null;
    const hasChange = () => !isNoop(params) || !!lut;
    const refreshApply = (ui) => (ui || uiRef)?.setApplyEnabled?.(hasChange());
    const renderLutMeta = () => {
      if (lutNameEl) {
        lutNameEl.textContent = lut ? (lutName || lut.title || t("image.lutFilterLoaded")) : t("image.noFilterLoadedSupportsCube");
        lutNameEl.classList.toggle("is-empty", !lut);
      }
      if (lutDetailEl) lutDetailEl.hidden = !lut;
    };
    const schedule = (ui) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!previewCanvas) return;
        loadPreview().then(() => {
          if (!previewCanvas || !base) return;
          previewCanvas.width = pw; previewCanvas.height = ph;
          const c = previewCanvas.getContext("2d");
          const image = new ImageData(new Uint8ClampedArray(base.data), pw, ph);
          const adjusted = applyImageAdjust(image, { ...params });
          c.putImageData(applyLUT(adjusted, lut, lutStrength), 0, 0);
        }).catch((error) => ui?.setStatus(error?.message || t("image.previewFailed"), true));
      });
    };
    function loadPreview() {
      if (ready) return Promise.resolve();
      return new Promise((resolve) => {
        const W = img.naturalWidth, H = img.naturalHeight;
        const scale = Math.min(1, 512 / Math.max(W, H));
        pw = Math.max(1, Math.round(W * scale));
        ph = Math.max(1, Math.round(H * scale));
        const canvas = document.createElement("canvas");
        canvas.width = pw; canvas.height = ph;
        canvas.getContext("2d").drawImage(img, 0, 0, pw, ph);
        base = canvas.getContext("2d").getImageData(0, 0, pw, ph);
        ready = true;
        resolve();
      });
    }
    const loadLutFile = async (file, ui) => {
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseCubeLUT(text);
        lut = parsed;
        lutName = file.name.replace(/\.[^.]+$/, "").slice(0, 48);
        lutStrength = 1;
        if (lutStrengthEl) lutStrengthEl.value = "100";
        if (lutStrengthOut) lutStrengthOut.textContent = "100%";
        renderLutMeta();
        refreshApply(ui);
        schedule(ui);
      } catch (error) {
        lut = null;
        renderLutMeta();
        refreshApply(ui);
        schedule(ui);
        toast("error", t("image.lutLoadFailed"), String(error?.message || error));
      }
    };
    openModal({
      title: t("image.colorAdjust"), sub: t("image.parametersCustomLutFilter"), width: 860,
      applyLabel: t("image.apply"), applyDisabled: true,
      extraFoot: [{ label: t("image.reset"), onClick: (ui) => {
        Object.assign(params, defaultParams());
        ui.body.querySelectorAll(".ict-slider input").forEach((input) => { input.value = "0"; });
        ui.body.querySelectorAll(".ict-slider output").forEach((out) => {
          out.textContent = "0"; out.classList.remove("is-changed");
        });
        lut = null; lutStrength = 1; lutName = "";
        if (lutFileEl) lutFileEl.value = "";
        if (lutStrengthEl) lutStrengthEl.value = "100";
        if (lutStrengthOut) lutStrengthOut.textContent = "100%";
        NS.tools?.paintRanges?.(ui.body);
        renderLutMeta();
        ui.setApplyEnabled(false);
        schedule(ui);
      } }],
      build(body, ui) {
        uiRef = ui;
        body.innerHTML = `
          <div class="ict-adjust">
            <div class="ict-preview"><canvas></canvas></div>
            <aside class="ict-side">
              <div class="ict-sliders"></div>
              <div class="ict-lut-block">
                <p class="ict-label">${t('core.filterLut')}</p>
                <div class="ict-lut-file">
                  <button type="button" class="ict-btn ict-lut-pick">${t('core.loadLutFile')}</button>
                  <input type="file" accept=".cube,.3dl,.txt,text/plain" />
                </div>
                <p class="ict-lut-name is-empty">${t('image.noFilterLoadedSupportsCube')}</p>
                <div class="ict-lut-detail" hidden>
                  <label class="ict-lut-strength"><span>${t('core.strength')}</span>
                    <input type="range" min="0" max="100" step="1" value="100" />
                    <output>100%</output></label>
                  <button type="button" class="ict-btn ict-lut-remove">${t('core.removeFilter')}</button>
                </div>
              </div>
            </aside>
          </div>`;
        previewCanvas = body.querySelector("canvas");
        lutNameEl = body.querySelector(".ict-lut-name");
        lutDetailEl = body.querySelector(".ict-lut-detail");
        lutFileEl = body.querySelector(".ict-lut-file input");
        lutStrengthEl = body.querySelector(".ict-lut-strength input");
        lutStrengthOut = body.querySelector(".ict-lut-strength output");
        body.querySelector(".ict-lut-pick").addEventListener("click", () => lutFileEl.click());
        lutFileEl.addEventListener("change", () => loadLutFile(lutFileEl.files?.[0], ui));
        body.querySelector(".ict-lut-remove").addEventListener("click", () => {
          lut = null; lutStrength = 1; lutName = "";
          if (lutFileEl) lutFileEl.value = "";
          if (lutStrengthEl) lutStrengthEl.value = "100";
          if (lutStrengthOut) lutStrengthOut.textContent = "100%";
          renderLutMeta();
          refreshApply(ui);
          schedule(ui);
        });
        lutStrengthEl.addEventListener("input", () => {
          lutStrength = parseInt(lutStrengthEl.value, 10) / 100;
          lutStrengthOut.textContent = lutStrengthEl.value + "%";
          schedule(ui);
        });
        const list = body.querySelector(".ict-sliders");
        for (const field of ADJUST_FIELDS) {
          const row = document.createElement("label");
          row.className = "ict-slider";
          row.innerHTML = `<span>${field.label}</span>` +
            `<input type="range" min="${field.min}" max="${field.max}" step="0.01" value="0" />` +
            `<output>0</output>`;
          const input = row.querySelector("input"), output = row.querySelector("output");
          input.addEventListener("input", () => {
            params[field.key] = parseFloat(input.value) || 0;
            output.textContent = fmtAdjust(params[field.key]);
            output.classList.toggle("is-changed", params[field.key] !== 0);
            refreshApply(ui);
            schedule(ui);
          });
          list.appendChild(row);
        }
        renderLutMeta();
        schedule(ui);
      },
      onApply: async (ui) => {
        if (!hasChange()) throw new Error(t("image.adjustParametersLoadLutFilter"));
        ui.setStatus(t("image.exportingOriginalResolution"));
        const canvas = drawToCanvas(img);
        const c = canvas.getContext("2d");
        const image = c.getImageData(0, 0, canvas.width, canvas.height);
        const adjusted = applyImageAdjust(image, { ...params });
        c.putImageData(applyLUT(adjusted, lut, lutStrength), 0, 0);
        const active = ADJUST_FIELDS.filter((f) => params[f.key] !== 0).slice(0, 3)
          .map((f) => f.key).join("_") || "default";
        const summary = ADJUST_FIELDS.filter((f) => params[f.key] !== 0).slice(0, 3)
          .map((f) => f.label).join("·");
        const parts = ["adjust", active];
        if (lut) parts.push("lut_" + stemOf(lutName));
        const label = [summary || t("image.defaultValue"), lut ? ("LUT " + lutName) : ""].filter(Boolean).join(" + ");
        await spawn(await canvasBlob(canvas), `${stemOf(ctx.data.asset?.name)}_${parts.join("_")}.png`, ctx);
      },
    });
  };

  /* --------------------------- shared actions ---------------------------- */

  R.favorite = async (ctx) => {
    /* Generated nodes keep their result in data.result; asset nodes in data.asset. */
    const asset = ctx.data?.result || ctx.data?.asset;
    const kind = asset?.kind || ctx.data?.kind || "text";
    const url = ctx.url || asset?.url || (asset && NS.api?.viewUrl?.(asset));
    const text = ctx.data?.text ?? ctx.data?.asset?.text ?? ctx.data?.result?.text;
    const saved = await NS.api.addToFavorites(asset || {}, {
      url, kind,
      name: asset?.name || asset?.filename || ctx.data?.title || "asset",
      // Only text assets use data.text as the payload; media nodes carry an
      // empty data.text that must NOT shadow their fetchable file.
      text: kind === "text" && text != null ? String(text) : undefined,
    });
    toast("success", t("media.addedFavorites"), t("media.savedFavoritesFolder", { name: saved.filename }));
  };
  /* Download the original asset file backing this node. Only shown when the
     node actually holds a file (see actionsFor), so text-only/empty generator
     nodes never offer a dead download. Fetch as a blob so the local filename
     is controlled by us rather than the server's Content-Disposition. */
  R.download = async (ctx) => {
    const asset = ctx.data?.result || ctx.data?.asset;
    const url = ctx.url || asset?.url || (asset && NS.api?.viewUrl?.(asset));
    if (!url) { toast("warning", t("core.nothingDownload")); return; }
    const filename = asset?.filename || asset?.name ||
      (() => { try { return decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || ""); } catch (e) { return ""; } })() ||
      "download";
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(t("image.downloadFailedHttp") + " " + response.status);
      saveBlob(await response.blob(), filename);
    } catch (error) {
      console.error("[InfCanvas download]", error);
      toast("error", t("image.download") + " " + t("image.operationFailed"), String(error?.message || error));
    }
  };
  R.delete = (ctx) => NS.api?.removeNode?.(ctx.id);
  /* Feed a material file straight into the node from the disk. Only offered on
     an empty generator whose input is free (see ICanvasNode's canUpload): the
     node flips to its material state, exactly like a file dropped on it. */
  R.upload = (ctx) => ctx.pickFile?.();

  const TOOL_SETS = {
    image: [["crop", "image.crop"], ["grid", "image.gridCrop"], ["mirror", "image.rotate"], ["adjust", "image.colorAdjust"]],
    video: [["videoCrop", "image.crop"], ["videoSpeed", "image.speed"], ["reverse", "media.reverse"], ["rotate", "image.rotate"],
            ["extractAudio", "image.splitAudio"], ["trim", "media.trim"], ["splitScenes", "media.sceneSplit"], ["frame", "image.captureFrame"]],
    audio: [["clip", "media.trim"], ["speed", "image.speed"]],
  };

  /* Lucide glyph name per tool key, rendered by IcIcon in the node toolbar.
     These are stable internal names; only the visible label is localised. */
  const TOOL_ICONS = {
    crop: "crop", grid: "layout-grid", mirror: "rotate-3d", adjust: "aperture",
    extractAudio: "audio-lines-off", trim: "scissors",
    videoCrop: "crop", videoSpeed: "gauge", reverse: "rewind", rotate: "rotate-3d",
    splitScenes: "film",
    frame: "camera", clip: "scissors", speed: "gauge", favorite: "bookmark",
    download: "download", upload: "upload", delete: "trash-2",
  };

  // Hover tooltips for the node action buttons. Each describes what the tool
  // does, what it produces, and whether the original asset is kept — unlike a
  // bare button label, this tells the user what to expect before clicking.
  const TOOL_TIPS = {
    crop:         "image.cropDragSelectRegionOptionally",
    grid:         "image.gridCropSliceImageInto",
    mirror:       "image.rotateHint",
    adjust:       "image.colorAdjustHint",
    videoCrop:    "image.cropSelectPictureRegionFirst",
    videoSpeed:   "image.speedChangePlayback012",
    reverse:      "image.reverseHint",
    rotate:       "image.rotate90Clockwise18090",
    extractAudio: "image.splitAudioPullAudioTrack",
    trim:         "image.trimCutClipStartEnd",
    splitScenes:  "media.sceneSplitHint",
    frame:        "image.captureFrameGrabFrameGiven",
    clip:         "image.trimCutClipsRemoveJoin",
    speed:        "image.speedChangePlayback01",
    favorite:     "media.addFavoritesSaveAssetInto",
    download:     "image.downloadSaveOriginalAssetFile",
    upload:       "image.uploadPickLocalAssetFill",
    delete:       "image.deleteRemoveNodeCanvasFile",
  };

  function actionsFor(data, options) {
    /* One rule for both states: whatever the node is holding (a dropped file
       on a material node, or the result of a generator) gets the same per-kind
       tools plus 收藏. Text nodes have no tool set, so they only get 收藏 + delete. */
    const media = data.asset || data.result || null;
    const kind = media?.kind || data.kind;
    const pairs = [];
    if (media && TOOL_SETS[kind]) pairs.push(...TOOL_SETS[kind]);
    if (media) pairs.push(["favorite", "media.addFavorites"]);
    /* Download sits just left of the destructive slot, and only appears when
       the node actually holds a file — text-only/empty nodes have nothing to
       save. Upload and download are mutually exclusive: an empty generator can
       be filled (upload), a filled one can be saved (download). */
    if (media) pairs.push(["download", "image.download"]);
    if (options?.canUpload) pairs.push(["upload", "image.upload"]);
    pairs.push(["delete", "panel.delete"]);
    return pairs.map(([key, label]) => ({
      key, label: t(label), tip: t(TOOL_TIPS[key] || label), icon: TOOL_ICONS[key] || "",
    }));
  }

  async function run(key, ctx) {
    const handler = R[key];
    if (!handler) { toast("warning", t("image.featureNotReady"), key); return; }
    try { await handler(ctx); }
    catch (error) {
      console.error("[InfCanvas tools]", key, error);
      toast("error", t("image.operationFailed"), String(error?.message || error));
    }
  }

  function renderText(text) {
    const manager = NS.app?.extensionManager || window.comfyAPI?.app?.app?.extensionManager;
    const render = manager?.renderMarkdownToHtml;
    if (typeof render === "function") {
      try { return render.call(manager, text || ""); } catch (error) { /* fallback */ }
    }
    return String(text || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c])).replace(/\n/g, "<br>");
  }

  NS.tools = {
    actionsFor, run, renderText, spawn, spawnRefs, refOf, resultPosition,
    openModal, closeModal, openMenu, closeMenu, paintRanges,
    MIRROR_PATHS, mirrorIcon,
    createProbe, request, API_AUDIO, API_VIDEO, API_HEALTH, NOT_READY, WARN_HTML, warnHtml, fmtPrecise,
    isOpen: () => !!modal?.mask?.isConnected || !!menu,
    helpers: { loadImage, canvasBlob, drawToCanvas, saveBlob, clamp, clamp01, fmtTime, fmtPrecise,
               stemOf, toast, applyImageAdjust, parseCubeLUT, applyLUT },
    registry: R,
  };
  injectStyles();
})();
