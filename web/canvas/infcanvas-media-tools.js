/* Video / audio node tools -- FFmpeg backend, reference interaction model.

   The operation flow is ported from the reference project's
   xcat-video-edit.js / xcat-audio-edit.js / xcat-media-core.js:

     video 音频分离            : click -> progress dialog -> 1 audio node
     video 截取                : preview + 10 thumbnails + two draggable
                                 handles + ruler + numeric start/end, playback
                                 confined to the selection -> 1 mp4 node
     video 抽帧                : three-way menu anchored to the button
                                 (当前帧 / 首帧 / 尾帧) -> progress -> 1 png
     audio 截取                : waveform multi-segment editor (split / merge /
                                 delete / undo / redo / audition) -> 1 m4a
     audio 变速                : 0.1-4 slider + 6 presets + numeric + duration
                                 estimate -> 1 m4a

   All six call POST /api/infcanvas/{audio,video}/process (FFmpeg). The backend
   writes m4a / mp4 / png into input/infcanvas and returns asset descriptors;
   NS.tools.spawnRefs() turns them into nodes. Media is never re-encoded in the
   browser and the source node is never replaced.

   Because a Python change needs a real ComfyUI restart, every dialog shows a
   readiness banner from createProbe() instead of a JSON parse error. */
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
  const R = (NS.icRegistry = NS.icRegistry || {});
  const T = () => NS.tools;
  /* A freshly generated node holds its media in data.result, not data.asset
     (only a dropped/imported file sets asset). actionsFor() and the node view
     already treat `asset || result` as the node's media — every tool must do
     the same when resolving a /view URL. Passing an empty asset made
     resolveMediaUrl() return a URL with no filename, so decode/duration
     failed and audio trimming reported "无法读取音频时长". */
  const ctxAsset = (ctx) => ctx?.data?.asset || ctx?.data?.result || {};

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const fmt = (v) => T()?.fmtPrecise?.(v) ?? "0:00.00";
  const toast = (kind, summary, detail = "") => {
    if (NS.api?.toast) NS.api.toast(kind, summary, detail);
    else console.log("[InfCanvas media tools]", kind, summary, detail);
  };
  const refOf = (ctx) => T().refOf(ctx);
  const stemOf = (name) => String(name || "asset").replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "asset";

  let probes = null;
  function getProbes() {
    if (!probes) {
      probes = {
        audio: T().createProbe(T().API_AUDIO),
        video: T().createProbe(T().API_VIDEO),
      };
    }
    return probes;
  }

  /* --------------------------- request / results ------------------------- */

  async function runRequest(api, payload, ctx, opts) {
    const ui = opts.ui;
    const probe = getProbes()[opts.kind];
    const ok = await probe.check();
    if (!ok) {
      toast("error", t(T().NOT_READY));
      ui?.setApiReady?.(false);
      ui?.setWarn?.(false);
      ui?.setStatus?.(t("media.backendApiNotReadyRestart"), true);
      T().closeModal();
      return false;
    }
    ui?.setApiReady?.(true);
    ui?.setWarn?.(true);
    ui?.setBusy?.(true);
    ui?.lock?.(true);
    try {
      const data = await T().request(api, payload, ui?.signal);
      const files = data.files || [];
      if (!files.length) throw new Error(t("media.backendReturnedNoOutput"));
      T().spawnRefs(files, ctx);
      T().closeModal();
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        T().closeModal();
        return false;
      }
      if (String(error?.message || "").includes("media.apiNotReady")) {
        probe.invalidate();
        ui?.setApiReady?.(false);
        ui?.setWarn?.(false);
      }
      ui?.setStatus?.(String(error?.message || error), true);
      ui?.setBusy?.(false);
      ui?.lock?.(false);
      toast("error", t(opts.label || "media.media") + t("media.processingFailed"), String(error?.message || error));
      return false;
    }
  }

  async function preflight(ui, kind, onReady) {
    const ok = await getProbes()[kind].check();
    ui.setApiReady(ok);
    ui.setWarn(ok);
    if (!ok) ui.setStatus(t("media.backendApiNotReadyRestart"), true);
    else ui.setStatus("");
    /* The reference paints the timeline/waveform regardless of readiness;
       the shell's apiReady gate keeps Apply disabled in the same render pass. */
    onReady?.();
    return ok;
  }

  /* Click-to-run actions show a compact spinner dialog, not a confirm dialog. */
  function progressModal(kind, title, sub, ctx, payload, opts = {}) {
    const api = kind === "audio" ? T().API_AUDIO : T().API_VIDEO;
    T().openModal({
      title, sub, width: 440,
      progress: true,
      progressText: t("media.processingFfmpegPleaseWait", { kind: t(kind === "audio" ? "field.audio" : "field.video") }),
      cancelLabel: t("media.cancelProcessing"),
      warn: T().warnHtml(),
      run: (ui) => runRequest(api, payload, ctx, {
        ui, kind, label: t(kind === "audio" ? "field.audio" : "field.video"), done: opts.done,
      }),
    });
  }

  /* --------------------------- video: no-arg actions --------------------- */

  R.extractAudio = (ctx) => progressModal("video", t("image.splitAudio"),
    t("media.extractAudioTrackIntoNew"), ctx,
    { ref: refOf(ctx), action: "extractAudio" },
    { done: t("media.audioTrackNodeCreated") });

  R.reverse = (ctx) => progressModal("video", t("media.reverse"),
    t("media.playVideoAudioBackwardsInto"), ctx,
    { ref: refOf(ctx), action: "reverse" },
    { done: t("media.reversedVideoNodeCreated") });

  /* --------------------------- video: mirror / rotate -------------------- */
  /* Same five transforms and same icon set as the image tool (R.mirror in
     infcanvas-tools.js). Labels use a LIVE t() (not the image tool's
     load-time-frozen ones) so switching language updates them. Hover/focus
     previews the transform on the first frame; a click generates at once. */
  R.rotate = async (ctx) => {
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctxAsset(ctx)).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    let frameUrl;
    try { frameUrl = await firstFrameUrl(mediaUrl); }
    catch (e) { toast("error", t("media.videoLoadFailed")); return; }
    const items = [
      { key: "flipX", mode: "flipX", label: t("image.flipHorizontal"), css: "scaleX(-1)" },
      { key: "flipY", mode: "flipY", label: t("image.flipVertical"), css: "scaleY(-1)" },
      { key: "rotate90", mode: "90", label: t("image.rotate90Cw"), css: "rotate(90deg)" },
      { key: "rotate270", mode: "270", label: t("image.rotate90Ccw"), css: "rotate(-90deg)" },
      { key: "rotate180", mode: "180", label: "180°", css: "rotate(180deg)" },
    ];
    let current = items[0], ui = null;
    const mirrorIcon = T().mirrorIcon;
    T().openModal({
      title: t("image.mirrorRotate"), width: 860,
      applyLabel: null, cancelLabel: t("settings.close"),
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview ict-mirror-preview"><img alt="${t("core.mirrorPreview")}" /></div>
            <aside class="ict-side">
              <p class="ict-label">${t("core.transform")}</p>
              <div class="ict-mirror-grid"></div>
            </aside>
          </div>`;
        const preview = body.querySelector("img");
        preview.src = frameUrl;
        const grid = body.querySelector(".ict-mirror-grid");
        for (const item of items) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ict-mirror-btn" + (item.key === "rotate180" ? " is-wide" : "");
          const icon = typeof mirrorIcon === "function"
            ? mirrorIcon(item.key) : "";
          button.innerHTML = `<span class="ict-mirror-icon">${icon}</span>` +
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
        preflight(ui, "video", () => {});
      },
      onApply: () => runRequest(T().API_VIDEO,
        { ref: refOf(ctx), action: "rotate", mode: current.mode }, ctx,
        { ui, kind: "video", label: t("field.video"), done: t("media.rotatedVideoNodeCreated") }),
    });
  };

  /* --------------------------- video: frame menu ------------------------- */

  R.frame = (ctx) => {
    const anchor = ctx.button || document.querySelector(
      `.vue-flow__node[data-id="${ctx.id}"] .icn__tool[data-action="frame"]`);
    if (!anchor) { toast("error", t("media.cannotLocateFrameExtractButton")); return; }
    const wrap = document.querySelector(`.vue-flow__node[data-id="${ctx.id}"]`);
    const nodeVideo = wrap?.querySelector("video");
    const current = nodeVideo && Number.isFinite(nodeVideo.currentTime) && nodeVideo.currentTime > 0
      ? nodeVideo.currentTime : 0;
    T().openMenu(anchor, [
      { label: t("media.extractCurrentFrame"), icon: "pi pi-video", value: fmt(current), onPick: () => runFrame("current", ctx, current) },
      { label: t("media.extractFirstFrame"), icon: "pi pi-angle-double-left", onPick: () => runFrame("first", ctx, 0) },
      { label: t("media.extractLastFrame"), icon: "pi pi-angle-double-right", onPick: () => runFrame("last", ctx, 0) },
    ]);
  };

  function runFrame(which, ctx, time) {
    const labels = { current: t("media.currentFrame"), first: t("media.firstFrame"), last: t("media.lastFrame") };
    progressModal("video", t("image.captureFrame"),
      t("media.exportPngImageNodeKeeping", { label: labels[which] }), ctx,
      { ref: refOf(ctx), action: "frame", frame: which, time: time || 0 },
      { done: t("media.imageNodeCreated") });
  }

  /* ------------------------------ video: trim ---------------------------- */

  function loadVideo(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
      video.addEventListener("loadedmetadata", () => resolve(video), { once: true });
      video.addEventListener("error", () => reject(new Error(t("media.videoLoadFailed"))), { once: true });
      video.load();
    });
  }

  /* Snapshot of video frame 0 as a data URL, used as the still preview behind
     transform tools (seeking a paused video straight to 0 is reliable). */
  async function firstFrameUrl(mediaUrl) {
    const video = await loadVideo(mediaUrl);
    const W = video.videoWidth, H = video.videoHeight;
    try { video.currentTime = 0; } catch (e) { /* optional */ }
    const url = await new Promise((resolve) => {
      const done = (u) => resolve(u);
      const grab = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = W; canvas.height = H;
          canvas.getContext("2d").drawImage(video, 0, 0, W, H);
          done(canvas.toDataURL("image/png"));
        } catch (e) { done(mediaUrl); }
      };
      video.addEventListener("seeked", grab, { once: true });
      setTimeout(grab, 1500);
      if (video.readyState >= 2 && video.currentTime === 0) setTimeout(grab, 0);
    });
    try { video.removeAttribute("src"); video.load(); } catch (e) { /* optional */ }
    return url;
  }

  /* Fixed 10 thumbnails, independent of clip length; offscreen video seeks and
     draws 160x96 JPEGs with `cover`. Stops as soon as the dialog is gone. */
  function buildThumbs(src, duration, cb, alive) {
    const video = document.createElement("video");
    video.muted = true; video.preload = "auto"; video.playsInline = true; video.src = src;
    const count = 10;
    const out = new Array(count).fill("");
    let index = 0, done = false, started = false, timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      video.onloadeddata = video.onseeked = video.onerror = null;
      try { video.removeAttribute("src"); video.load(); } catch (error) { /* optional */ }
      cb(out);
    };
    const shot = () => {
      if (done) return;
      if ((alive && !alive()) || index >= count) return finish();
      try {
        video.currentTime = Math.min(duration * (index + 0.5) / count,
          Math.max(0, duration - 0.001));
      } catch (error) { index += 1; shot(); }
    };
    const start = () => {
      if (started || done) return;
      started = true;
      shot();
    };
    timer = setTimeout(finish, 15000);
    video.addEventListener("loadeddata", start);
    if (video.readyState >= 2) setTimeout(start, 0);
    video.addEventListener("seeked", () => {
      if (done || (alive && !alive())) return finish();
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 96;
        const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const w = video.videoWidth * scale, h = video.videoHeight * scale;
        canvas.getContext("2d").drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        out[index] = canvas.toDataURL("image/jpeg", 0.75);
      } catch (error) { /* placeholder */ }
      index += 1; shot();
    });
    video.addEventListener("error", finish);
  }

  R.trim = (ctx) => {
    const S = { duration: 0, limit: 0, minLen: 0.01, start: 0, end: 0, current: 0 };
    let ui = null, video, track, strip, startInput, endInput;
    const valid = () => S.duration > 0 && S.start >= 0 && S.end > S.start &&
      S.end <= S.limit + 0.000001;

    const q = (selector) => ui?.body.querySelector(selector);
    const paintPlayhead = () => {
      if (!S.duration || !ui) return;
      if (video && Number.isFinite(video.currentTime)) S.current = video.currentTime;
      const head = q(".ict-tl-playhead");
      if (head) head.style.left = (clamp(S.current / S.duration, 0, 1) * 100) + "%";
    };
    function paint(skipInputs = false) {
      if (!S.duration || !ui) return;
      const startPct = clamp(S.start / S.duration, 0, 1) * 100;
      const endPct = clamp(S.end / S.duration, 0, 1) * 100;
      const sel = q(".ict-tl-sel");
      if (sel) { sel.style.left = startPct + "%"; sel.style.width = Math.max(0, endPct - startPct) + "%"; }
      const ml = q(".ict-ml"), mr = q(".ict-mr");
      if (ml) { ml.style.left = "0"; ml.style.width = startPct + "%"; }
      if (mr) { mr.style.left = endPct + "%"; mr.style.width = (100 - endPct) + "%"; }
      const hs = q(".ict-hs"), he = q(".ict-he");
      if (hs) {
        hs.style.left = startPct + "%";
        hs.setAttribute("aria-valuenow", S.start.toFixed(2));
        hs.setAttribute("aria-valuetext", S.start.toFixed(2) + t("core.s"));
      }
      if (he) {
        he.style.left = endPct + "%";
        he.setAttribute("aria-valuenow", S.end.toFixed(2));
        he.setAttribute("aria-valuetext", S.end.toFixed(2) + t("core.s"));
      }
      const sub = q(".ict-tl-dur");
      if (sub) sub.textContent = t("core.originalVideo") + fmt(S.duration);
      const length = q(".ict-length");
      if (length) length.textContent = t("core.duration") + (valid() ? (S.end - S.start).toFixed(2) : "—") + t("core.s");
      const hint = q(".ict-trim-hint");
      if (hint) hint.textContent = valid()
        ? t("media.timelineHint")
        : t("media.pleaseSelectValidStartEnd");
      if (!skipInputs) {
        if (startInput && document.activeElement !== startInput) startInput.value = S.start.toFixed(2);
        if (endInput && document.activeElement !== endInput) endInput.value = S.end.toFixed(2);
      }
      paintPlayhead();
      ui.setApplyEnabled(valid());
    }
    function seekPreview(value) {
      if (!S.duration || !Number.isFinite(value) || !ui || !video) return;
      video.pause();
      try { video.currentTime = clamp(value, 0, Math.max(0, S.duration - 0.001)); }
      catch (error) { /* optional */ }
      S.current = video.currentTime;
      paintPlayhead();
    }
    function setBoundary(edge, value) {
      if (!S.duration || !Number.isFinite(value)) return;
      const rounded = Math.round(value * 100) / 100;
      if (edge === "start") S.start = clamp(rounded, 0, Math.max(0, S.end - S.minLen));
      else S.end = clamp(rounded, S.start + S.minLen, S.limit);
      S.start = +S.start.toFixed(2);
      S.end = +S.end.toFixed(2);
      paint();
      seekPreview(edge === "start" ? S.start : S.end);
    }
    function onTimeInput(event) {
      if (!S.duration) return;
      const which = event?.target === endInput ? "end" : "start";
      const a = parseFloat(startInput.value), b = parseFloat(endInput.value);
      if (Number.isFinite(a)) S.start = clamp(+a.toFixed(2), 0, S.limit);
      if (Number.isFinite(b)) S.end = clamp(+b.toFixed(2), 0, S.limit);
      if (S.end < S.start + S.minLen) {
        if (which === "start") S.start = Math.max(0, S.end - S.minLen);
        else S.end = Math.min(S.limit, S.start + S.minLen);
      }
      paint(true);
      seekPreview(which === "start" ? S.start : S.end);
    }
    function bindHandle(el, which) {
      if (!el) return;
      el.addEventListener("pointerdown", (event) => {
        if (!S.duration || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const width = track.getBoundingClientRect().width;
        if (!width) return;
        const x0 = event.clientX, t0 = which === "start" ? S.start : S.end, pid = event.pointerId;
        try { el.setPointerCapture(pid); } catch (error) { /* optional */ }
        seekPreview(t0);
        const move = (ev) => {
          if (ev.pointerId !== pid) return;
          setBoundary(which, t0 + (ev.clientX - x0) / width * S.duration);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          try { if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid); } catch (error) { /* optional */ }
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      });
      el.addEventListener("keydown", (event) => {
        if (!S.duration) return;
        const step = event.shiftKey ? 1 : 0.1;
        const t = which === "start" ? S.start : S.end;
        let next;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = t - step;
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = t + step;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = S.limit;
        else return;
        event.preventDefault(); event.stopPropagation();
        setBoundary(which, next);
      });
    }

    T().openModal({
      title: t("media.trim"), sub: t("media.readingVideoProgress"), width: 760,
      applyLabel: t("media.trim"), applyDisabled: true, cancelLabel: t("api.cancel"),
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-video-preview"><video controls playsinline preload="auto"></video></div>
          <div class="ict-tl">
            <div class="ict-tl-head"><span>${t('core.dragLeftRightHandlesSelect')}</span><span class="ict-tl-dur">${t('media.originalVideo')} 00:00.00</span></div>
            <div class="ict-track">
              <div class="ict-strip"></div>
              <div class="ict-tl-mask ict-ml"></div><div class="ict-tl-mask ict-mr"></div>
              <div class="ict-tl-sel"></div><div class="ict-tl-playhead"></div>
              <button type="button" class="ict-tl-handle ict-hs" role="slider"
                      aria-label="${t('core.clipStartBoundary')}" aria-orientation="horizontal"><span></span></button>
              <button type="button" class="ict-tl-handle ict-he" role="slider"
                      aria-label="${t('core.clipEndBoundary')}" aria-orientation="horizontal"><span></span></button>
            </div>
            <div class="ict-tl-ruler"></div>
          </div>
          <div class="ict-times">
            <label>${t('core.startTime')} <input class="ict-input ict-start" type="number" step="0.01" min="0" value="0.00" /><span>${t('media.s')}</span></label>
            <label>${t('core.endTime')} <input class="ict-input ict-end" type="number" step="0.01" min="0" value="0.00" /><span>${t('media.s')}</span></label>
            <span class="ict-length ict-length">${t('media.duration')} — ${t('media.s')}</span>
          </div>
          <p class="ict-hint ict-trim-hint">${t('media.timelineHint')}</p>`;
        video = q("video");
        track = q(".ict-track");
        strip = q(".ict-strip");
        startInput = q(".ict-start");
        endInput = q(".ict-end");
        let mediaUrl = ctx.url;
        if (NS.api?.resolveMediaUrl) {
          NS.api.resolveMediaUrl(ctxAsset(ctx)).then((u) => {
            mediaUrl = u;
            if (ui?.mask?.isConnected && video) video.src = u;
          }).catch(() => { /* keep ctx.url */ });
        }
        video.src = mediaUrl;
        for (const input of [startInput, endInput]) {
          input.addEventListener("focus", function () { this.select(); });
          input.addEventListener("input", onTimeInput);
        }
        bindHandle(q(".ict-hs"), "start");
        bindHandle(q(".ict-he"), "end");
        track.addEventListener("pointerdown", (event) => {
          if (!S.duration || event.button !== 0) return;
          const box = track.getBoundingClientRect();
          if (!box.width) return;
          const t = (event.clientX - box.left) / box.width * S.duration;
          seekPreview(clamp(t, S.start, S.end));
        });
        video.addEventListener("loadedmetadata", () => {
          const d = Number(video.duration);
          if (!Number.isFinite(d) || d <= 0) { ui.setStatus(t("media.cannotReadVideoDuration"), true); return; }
          S.duration = d;
          S.limit = Math.floor(d * 100) / 100;
          S.minLen = Math.min(0.01, S.limit);
          S.start = 0; S.end = S.limit; S.current = 0;
          startInput.max = S.limit; endInput.max = S.limit;
          const ruler = q(".ict-tl-ruler");
          if (ruler) ruler.innerHTML = [0, 1, 2, 3, 4]
            .map((i) => `<span>${fmt(S.duration * i / 4)}</span>`).join("");
          ui.setStatus("");
          paint();
          buildThumbs(mediaUrl, d, (list) => {
            if (!ui?.mask?.isConnected || !strip) return;
            strip.innerHTML = list.map((src) => src
              ? `<img src="${src}" alt="" draggable="false" />` : "<i></i>").join("");
          }, () => !!ui?.mask?.isConnected);
        });
        video.addEventListener("timeupdate", () => {
          if (!S.duration) return;
          S.current = video.currentTime;
          paintPlayhead();
          if (!video.paused && valid() && video.currentTime >= S.end) {
            video.pause();
            try { video.currentTime = Math.max(0, S.end - 0.001); } catch (error) { /* optional */ }
          }
        });
        video.addEventListener("seeked", paintPlayhead);
        video.addEventListener("play", () => {
          if (!valid()) return;
          if (video.currentTime < S.start || video.currentTime >= S.end) {
            try { video.currentTime = S.start; } catch (error) { /* optional */ }
          }
        });
        video.addEventListener("error", () => ui.setStatus(t("media.videoPreviewFailed"), true));
        ui.lock = (on) => {
          for (const element of [startInput, endInput, q(".ict-hs"), q(".ict-he")]) {
            if (element) element.disabled = !!on;
          }
          track.style.pointerEvents = on ? "none" : "";
        };
        preflight(ui, "video", () => paint());
      },
      onClose: () => { try { video?.pause(); } catch (error) { /* optional */ } },
      onApply: () => {
        if (!valid()) throw new Error(t("media.selectValidRangeNoDot"));
        return runRequest(T().API_VIDEO,
          { ref: refOf(ctx), action: "trim", start: S.start, end: S.end }, ctx,
          { ui, kind: "video", label: t("field.video"), done: t("media.newVideoNodeCreated") });
      },
    });
  };

  /* --------------------------- video: scene split ------------------------ */
  /* Two-phase tool. Phase 1 calls the backend's FFmpeg scene detector and
     gets back {index,start,end} boundaries (no files, no nodes). The dialog
     paints a first-frame thumbnail per shot by seeking an offscreen video
     (same canvas technique as buildThumbs — no extra backend files). Phase 2
     sends the ticked segments to splitExport, which returns one mp4 per shot
     that spawnRefs turns into nodes; the source node is never touched. */
  function sceneThumbs(src, scenes, cb, alive) {
    const video = document.createElement("video");
    video.muted = true; video.preload = "auto"; video.playsInline = true; video.src = src;
    const out = new Array(scenes.length).fill("");
    let index = 0, done = false, started = false, timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      video.onloadeddata = video.onseeked = video.onerror = null;
      try { video.removeAttribute("src"); video.load(); } catch (error) { /* optional */ }
      cb(out);
    };
    const shot = () => {
      if (done) return;
      if ((alive && !alive()) || index >= scenes.length) return finish();
      const seek = scenes[index].start + Math.min(0.15, Math.max(0, (scenes[index].end - scenes[index].start) / 2));
      try { video.currentTime = seek; } catch (error) { index += 1; shot(); }
    };
    const start = () => {
      if (started || done) return;
      started = true;
      shot();
    };
    timer = setTimeout(finish, 30000);
    video.addEventListener("loadeddata", start);
    if (video.readyState >= 2) setTimeout(start, 0);
    video.addEventListener("seeked", () => {
      if (done || (alive && !alive())) return finish();
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 90;
        const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const w = video.videoWidth * scale, h = video.videoHeight * scale;
        canvas.getContext("2d").drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        out[index] = canvas.toDataURL("image/jpeg", 0.72);
      } catch (error) { /* placeholder */ }
      index += 1; shot();
    });
    video.addEventListener("error", finish);
  }

  R.splitScenes = (ctx) => {
    const S = { scenes: [], selected: new Set(), ready: false, threshold: 0.35 };
    let ui = null;

    const applyText = () => t("media.sceneExportSelected", { n: S.selected.size });
    const paintCount = () => {
      const count = ui?.body?.querySelector(".ict-scene-count");
      if (count) count.textContent = t("media.sceneSelected", { n: S.selected.size, total: S.scenes.length });
      const applyBtn = ui?.panel?.querySelector(".ict-btn--primary");
      if (applyBtn && !applyBtn.disabled) applyBtn.textContent = applyText();
      ui?.setApplyEnabled?.(S.ready && S.selected.size > 0);
    };
    const syncCards = () => {
      for (const card of ui?.body?.querySelectorAll(".ict-scene-card") || []) {
        const i = Number(card.dataset.index);
        const on = S.selected.has(i);
        card.classList.toggle("is-selected", on);
        const icon = card.querySelector(".ict-scene-check i");
        if (icon) icon.className = on ? "icon-[lucide--circle-check]" : "icon-[lucide--circle]";
      }
      paintCount();
    };
    const renderGrid = (thumbs) => {
      const grid = ui?.body?.querySelector(".ict-scene-grid");
      if (!grid) return;
      grid.innerHTML = "";
      S.scenes.forEach((scene, i) => {
        const card = document.createElement("button");
        card.type = "button"; card.className = "ict-scene-card"; card.dataset.index = String(i);
        const duration = Math.max(0, scene.end - scene.start);
        card.innerHTML =
          '<span class="ict-scene-thumb"><img alt="" /></span>' +
          '<span class="ict-scene-meta"><b>#' + (i + 1) + '</b>' +
            '<span>' + fmt(scene.start) + ' – ' + fmt(scene.end) + '</span>' +
            '<small>' + duration.toFixed(2) + t("media.s") + '</small></span>' +
          '<span class="ict-scene-check"><i class="icon-[lucide--circle]"></i></span>';
        const img = card.querySelector("img");
        if (thumbs[i]) img.src = thumbs[i];
        card.addEventListener("click", () => {
          if (S.selected.has(i)) S.selected.delete(i); else S.selected.add(i);
          syncCards();
        });
        grid.appendChild(card);
      });
      syncCards();
    };

    const detect = async () => {
      // Clear any previous result before a (re)detection so changing the
      // sensitivity never leaves stale cards/selection behind.
      S.scenes = [];
      S.selected.clear();
      S.ready = false;
      ui.setApplyEnabled(false);
      const status = ui.body.querySelector(".ict-scene-status");
      const grid = ui.body.querySelector(".ict-scene-grid");
      if (grid) { grid.hidden = true; grid.innerHTML = ""; }
      if (status) { status.hidden = false; status.textContent = t("media.sceneDetecting"); }

      // Read the current sensitivity from the slider + number pair.
      const slider = ui.body.querySelector(".ict-scene-threshold");
      const number = ui.body.querySelector(".ict-scene-number");
      let value = slider ? Number(slider.value) : S.threshold;
      if (!Number.isFinite(value)) value = S.threshold;
      S.threshold = clamp(value, 0.05, 1);
      if (slider) slider.value = String(S.threshold);
      if (number) number.value = S.threshold.toFixed(2);

      const ok = await getProbes().video.check();
      ui.setApiReady(ok); ui.setWarn(ok);
      if (!ok) { ui.setStatus(t("media.backendApiNotReadyRestart"), true); return; }
      try {
        const data = await T().request(T().API_VIDEO,
          { ref: refOf(ctx), action: "detectScenes", threshold: S.threshold }, ui.signal);
        S.scenes = Array.isArray(data.scenes) ? data.scenes : [];
        S.scenes.forEach((_, i) => S.selected.add(i));
        if (!S.scenes.length) {
          if (status) { status.hidden = false; status.textContent = t("media.sceneNoScenes"); }
          ui.setApplyEnabled(false);
          return;
        }
        if (status) status.hidden = true;
        if (grid) grid.hidden = false;
        const mediaUrl = (NS.api?.resolveMediaUrl
          ? await NS.api.resolveMediaUrl(ctxAsset(ctx)).catch(() => ctx.url)
          : ctx.url) || ctx.url;
        if (mediaUrl) sceneThumbs(mediaUrl, S.scenes, renderGrid, () => !!ui?.mask?.isConnected);
        else renderGrid([]);
        S.ready = true;
        paintCount();
      } catch (error) {
        if (error?.name === "AbortError") return;
        ui.setStatus(String(error?.message || error), true);
        toast("error", t("media.sceneSplit") + t("media.processingFailed"), String(error?.message || error));
      }
    };

    T().openModal({
      title: t("media.sceneSplit"), sub: t("media.sceneSplitSub"), width: 880,
      applyLabel: applyText(), applyDisabled: true, cancelLabel: t("api.cancel"),
      extraFoot: [
        { label: t("media.sceneSelectAll"), onClick: () => {
          S.scenes.forEach((_, i) => S.selected.add(i)); syncCards();
        } },
        { label: t("media.sceneSelectNone"), onClick: () => { S.selected.clear(); syncCards(); } },
      ],
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML =
          '<p class="ict-label">' + t("media.sceneSensitivity") + '</p>' +
          '<div class="ict-slider-field" style="margin-bottom:8px">' +
            '<input class="ict-slider-range ict-scene-threshold" type="range" min="0.05" max="1" step="0.05" value="0.35" aria-label="' + t("media.sceneSensitivity") + '" />' +
            '<input class="ict-input ict-scene-number" type="number" min="0.05" max="1" step="0.05" value="0.35" aria-label="' + t("media.sceneSensitivity") + '" />' +
          '</div>' +
          '<p class="ict-hint" style="margin:0 0 10px">' + t("media.sceneSensitivityHint") + '</p>' +
          '<button class="ict-btn ict-scene-redetect" type="button" style="margin-bottom:14px">' + t("media.sceneRedetect") + '</button>' +
          '<p class="ict-scene-status">' + t("media.sceneDetecting") + '</p>' +
          '<div class="ict-scene-count"></div>' +
          '<div class="ict-scene-grid" hidden></div>';
        const slider = body.querySelector(".ict-scene-threshold");
        const number = body.querySelector(".ict-scene-number");
        const redetect = body.querySelector(".ict-scene-redetect");
        const syncPair = () => {
          const v = clamp(Number(slider.value) || 0.35, 0.05, 1);
          slider.value = String(v); number.value = v.toFixed(2);
        };
        slider.addEventListener("input", syncPair);
        number.addEventListener("change", () => {
          const raw = Number(number.value);
          const v = Number.isFinite(raw) ? clamp(raw, 0.05, 1) : 0.35;
          slider.value = String(v); number.value = v.toFixed(2);
        });
        number.addEventListener("focus", function () { this.select(); });
        redetect.addEventListener("click", () => detect());
        detect();
      },
      onApply: () => {
        const segments = S.scenes
          .filter((_, i) => S.selected.has(i))
          .map((s) => ({ start: s.start, end: s.end }));
        if (!segments.length) throw new Error(t("media.sceneNoScenes"));
        return runRequest(T().API_VIDEO,
          { ref: refOf(ctx), action: "splitExport", segments }, ctx,
          { ui, kind: "video", label: t("media.sceneSplit"), done: t("media.sceneExportedNodes") });
      },
    });
  };

  /* --------------------------- audio: waveform --------------------------- */

  function offlineContext(length = 1, sampleRate = 44100) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) throw new Error(t("media.browserDoesNotSupportAudio"));
    return new OC(1, Math.max(1, length), sampleRate);
  }
  async function decodeUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(t("media.assetReadFailedHttp") + " " + response.status);
    const data = await response.arrayBuffer();
    return await offlineContext().decodeAudioData(data);
  }
  function computePeaks(buffer, count = 1200) {
    const data = buffer.getChannelData(0);
    const out = new Float32Array(count);
    const size = Math.max(1, Math.floor(data.length / count));
    for (let i = 0; i < count; i += 1) {
      let peak = 0;
      for (let j = i * size; j < Math.min(data.length, i * size + size); j += 1) {
        const value = Math.abs(data[j]);
        if (value > peak) peak = value;
      }
      out[i] = peak;
    }
    return out;
  }
  function fakePeaks(seedText) {
    const out = new Float32Array(1200);
    let seed = 0;
    for (let i = 0; i < seedText.length; i += 1) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
    for (let k = 0; k < 1200; k += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out[k] = 0.18 + (seed / 4294967296) * 0.5 * (0.6 + 0.4 * Math.sin(k / 17));
    }
    return out;
  }
  function drawClipWave(canvas, peaks, duration, kept) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    const cssRead = (name, fallback) =>
      (getComputedStyle(canvas).getPropertyValue(name) || "").trim() || fallback;
    ctx.fillStyle = cssRead("--icw-bg", "#232428");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!peaks || !peaks.length || !kept || !kept.length) return;
    const mid = canvas.height / 2;
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(canvas.width, mid + 0.5);
    ctx.stroke();
    ctx.fillStyle = cssRead("--primary", "#0b8ce9");
    ctx.globalAlpha = 0.5;
    const count = Math.max(1, Math.floor(rect.width / 4));
    const maxH = canvas.height * 0.82;
    const N = peaks.length;
    /* The kept ranges are laid out *contiguously* (end-to-end), exactly like the
       segment track below: deleted parts are gone, the surviving fragments are
       stitched together so the waveform reads as one continuous clip. Each column
       samples the peak at its position inside that concatenated timeline (via
       `idx`), which is what makes deleting a segment visibly change the waveform. */
    let totalKept = 0;
    for (const r of kept) totalKept += Math.max(0, r.end - r.start);
    if (totalKept <= 0) { ctx.globalAlpha = 1; return; }
    for (let i = 0; i < count; i += 1) {
      const keptT = (i / count) * totalKept; // position inside the concatenated timeline
      let acc = 0, srcT = 0;
      for (const r of kept) {
        const len = Math.max(0, r.end - r.start);
        if (keptT <= acc + len) { srcT = r.start + (keptT - acc); break; }
        acc += len;
      }
      const idx = clamp(Math.floor(srcT / (duration || 1) * N), 0, N - 1);
      const value = peaks[idx] || 0;
      const height = Math.max(2 * dpr, value * maxH);
      ctx.fillRect(i * 4 * dpr + dpr, mid - height / 2, 2 * dpr, height);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------------------- audio: clip ------------------------------ */

  R.clip = async (ctx) => {
    const MIN_GAP = 0.01;
    let buffer = null, duration = 0, peaks = null;
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctxAsset(ctx)).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    try {
      buffer = await decodeUrl(mediaUrl);
      duration = buffer.duration;
      peaks = computePeaks(buffer);
    } catch (error) { /* playable but undecodable: fall back to metadata */ }
    if (!duration) {
      duration = await new Promise((resolve) => {
        const audio = new Audio(mediaUrl);
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value || 0); } };
        audio.addEventListener("loadedmetadata", () => finish(
          Number.isFinite(audio.duration) ? audio.duration : 0));
        audio.addEventListener("error", () => finish(0));
        setTimeout(() => finish(0), 4000);
      });
      peaks = fakePeaks(mediaUrl);
    }
    if (!duration) throw new Error(t("media.audioDurationUnreadable"));

    const S = {
      duration, peaks, groups: [[{ start: 0, end: duration }]],
      selected: 0, playhead: 0, undoStack: [], redoStack: [],
      audio: new Audio(mediaUrl), playClip: 0, playPart: 0,
    };
    S.audio.preload = "auto";
    let ui = null;
    const q = (selector) => ui?.body.querySelector(selector);

    const clips = () => {
      let offset = 0;
      return S.groups.map((ranges) => {
        let length = 0;
        const parts = ranges.map((r) => {
          const part = { start: r.start, end: r.end, offset: length, length: r.end - r.start };
          length += part.length;
          return part;
        });
        const clip = { parts, offset, length };
        offset += length;
        return clip;
      });
    };
    const totalDuration = () => clips().reduce((sum, c) => sum + c.length, 0);
    const timelineDuration = () => totalDuration() || S.duration || 1;
    const valid = () => S.duration > 0 && S.groups.length > 0 && S.groups.every((group) =>
      group.length && group.every((r) => Number.isFinite(r.start) && Number.isFinite(r.end) &&
        r.start >= 0 && r.end > r.start && r.end <= S.duration + 0.05));
    const snapshot = () => ({
      groups: S.groups.map((g) => g.map((r) => ({ start: r.start, end: r.end }))),
      selected: S.selected, playhead: S.playhead,
    });
    const pause = () => { try { S.audio?.pause(); } catch (error) { /* optional */ } };
    function seekPlayer() {
      if (!S.groups.length) return;
      const list = clips();
      let index = list.findIndex((c) => c.offset + c.length > S.playhead);
      if (index < 0) index = Math.max(0, list.length - 1);
      S.playClip = index;
      const clip = list[index];
      if (!clip) return;
      let partIndex = clip.parts.findIndex((p) => clip.offset + p.offset + p.length > S.playhead);
      if (partIndex < 0) partIndex = clip.parts.length - 1;
      S.playPart = partIndex;
      const part = clip.parts[partIndex];
      if (!part) return;
      try { S.audio.currentTime = part.start + S.playhead - clip.offset - part.offset; }
      catch (error) { /* optional */ }
    }
    function applyState(state, silent) {
      pause();
      S.groups = state.groups;
      S.selected = clamp(state.selected, 0, Math.max(0, S.groups.length - 1));
      S.playhead = clamp(state.playhead, 0, totalDuration());
      if (!silent) { S.undoStack = []; S.redoStack = []; }
      seekPlayer();
      render();
    }
    function commit(next, index, time) {
      S.undoStack.push(snapshot());
      S.redoStack = [];
      applyState({ groups: next, selected: index,
                   playhead: time == null ? S.playhead : time }, true);
    }
    function undo() {
      if (!S.undoStack.length) return;
      S.redoStack.push(snapshot());
      applyState(S.undoStack.pop(), true);
    }
    function redo() {
      if (!S.redoStack.length) return;
      S.undoStack.push(snapshot());
      applyState(S.redoStack.pop(), true);
    }
    function split() {
      const list = clips(), clip = list[S.selected];
      if (!clip) return;
      const t = S.playhead - clip.offset;
      if (t < MIN_GAP || clip.length - t < MIN_GAP) return;
      const left = [], right = [];
      clip.parts.forEach((part) => {
        if (part.offset + part.length <= t) left.push({ start: part.start, end: part.end });
        else if (part.offset >= t) right.push({ start: part.start, end: part.end });
        else {
          const cut = part.start + t - part.offset;
          left.push({ start: part.start, end: cut });
          right.push({ start: cut, end: part.end });
        }
      });
      if (!left.length || !right.length) return;
      const next = S.groups.slice();
      next.splice(S.selected, 1, left, right);
      commit(next, S.selected + 1);
    }
    function merge() {
      if (S.groups.length < 2) return;
      const index = Math.max(0, S.selected - 1);
      const next = S.groups.slice();
      next.splice(index, 2, next[index].concat(next[index + 1]));
      commit(next, index, clips()[index] ? clips()[index].offset : 0);
    }
    function removeSegment() {
      if (!S.groups.length) return;
      const next = S.groups.filter((_, i) => i !== S.selected);
      const index = clamp(S.selected, 0, Math.max(0, next.length - 1));
      const time = clips().slice(0, index).reduce((sum, c) => sum + c.length, 0);
      commit(next, index, time);
    }
    function seekAt(t) {
      if (!Number.isFinite(t)) return;
      pause();
      S.playhead = clamp(t, 0, totalDuration());
      seekPlayer();
      render();
    }
    function updatePlayback() {
      const list = clips();
      let clip = list[S.playClip];
      let part = clip && clip.parts[S.playPart];
      const t = S.audio.currentTime;
      if (!part || !Number.isFinite(t)) return;
      S.playhead = clip.offset + part.offset + clamp(t - part.start, 0, part.length);
      if (!S.audio.paused && t >= part.end - 0.004) {
        let next = clip.parts[++S.playPart];
        if (!next) {
          clip = list[++S.playClip];
          S.playPart = 0;
          next = clip && clip.parts[0];
        }
        if (!next) { pause(); S.playhead = totalDuration(); }
        else { S.selected = S.playClip; try { S.audio.currentTime = next.start; } catch (error) { /* optional */ } }
      }
      render(true);
    }
    function togglePlay() {
      if (!valid()) return;
      if (!S.audio.paused) { pause(); render(); return; }
      if (S.playhead >= totalDuration() - 0.01) S.playhead = 0;
      seekPlayer();
      const promise = S.audio.play();
      promise?.catch?.(() => ui?.setStatus(t("core.audioDecodeFailed"), true));
      render();
    }

    function render(light = false) {
      if (!ui) return;
      const list = clips(), total = totalDuration(), span = timelineDuration();
      const head = q(".ict-clip-head");
      if (head) head.style.left = (S.playhead / span * 100) + "%";
      const current = q(".ict-cur"), totalEl = q(".ict-total");
      if (current) current.textContent = fmt(S.playhead);
      if (totalEl) totalEl.textContent = fmt(total);
      const play = q(".ict-play");
      if (play) play.innerHTML = S.audio && !S.audio.paused
        ? '<i class="icon-[lucide--pause] size-4" aria-hidden="true"></i>'
        : '<i class="icon-[lucide--play] size-4" aria-hidden="true"></i>';
      setToolState();
      if (light) return;
      const ruler = q(".ict-clip-ruler");
      if (ruler) ruler.innerHTML = [0, 1, 2, 3, 4, 5]
        .map((i) => `<span style="left:${i * 20}%">${fmt(i * span / 5)}</span>`).join("");
      const track = q(".ict-clip-track");
      if (track) {
        track.innerHTML = "";
        list.forEach((clip, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ict-clip-seg" + (index === S.selected ? " is-selected" : "");
          button.dataset.index = String(index);
          button.style.left = (clip.offset / span * 100) + "%";
          button.style.width = (clip.length / span * 100) + "%";
          button.textContent = t("core.clipS", { index: index + 1, length: clip.length.toFixed(2) });
          track.appendChild(button);
        });
      }
      const canvas = q(".ict-clip-wave");
      if (canvas && S.peaks) {
        const kept = S.groups.flat();
        drawClipWave(canvas, S.peaks, S.duration, kept);
      }
      ui.setApplyEnabled(valid());
    }
    function setToolState() {
      const list = clips(), clip = list[S.selected];
      const canSplit = !!clip && S.playhead - clip.offset >= MIN_GAP &&
        clip.offset + clip.length - S.playhead >= MIN_GAP;
      const state = {
        undo: S.undoStack.length > 0, redo: S.redoStack.length > 0,
        split: canSplit, merge: S.groups.length > 1, remove: !!clip,
      };
      ui?.body.querySelectorAll(".ict-toolrow button[data-act]").forEach((button) => {
        button.disabled = !state[button.dataset.act];
      });
    }

    S.audio.addEventListener("timeupdate", updatePlayback);
    S.audio.addEventListener("ended", () => render());

    T().openModal({
      title: t("media.trimJoin"), sub: t("media.readingAudio"), width: 760,
      applyLabel: t("media.exportAudio"), applyDisabled: true, cancelLabel: t("api.cancel"),
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-clip-tl">
            <div class="ict-clip-stage">
              <canvas class="ict-clip-wave"></canvas>
              <div class="ict-clip-track"></div>
              <span class="ict-clip-head"></span>
            </div>
            <div class="ict-clip-ruler"></div>
          </div>
          <div class="ict-toolrow">
            <button class="ict-btn" type="button" data-act="undo">${t('shortcuts.undo')}</button>
            <button class="ict-btn" type="button" data-act="redo">${t('shortcuts.redo')}</button>
            <span class="ict-sep"></span>
            <button class="ict-btn" type="button" data-act="split">${t('core.split')}</button>
            <button class="ict-btn" type="button" data-act="merge">${t('core.join')}</button>
            <button class="ict-btn" type="button" data-act="remove">${t('core.deleteSegment')}</button>
            <span class="ict-hint">${t('core.ctrlZUndoCtrlY')}</span>
          </div>
          <div class="ict-player">
            <button class="ict-btn ict-play" type="button"><i class="icon-[lucide--play] size-4" aria-hidden="true"></i></button>
            <time><b class="ict-cur">0:00.00</b> / <span class="ict-total">0:00.00</span></time>
            <span class="ict-hint">${t('core.clickClipTimelineMovePlayhead')}</span>
          </div>`;
        const stage = q(".ict-clip-stage");
        const waveEl = q(".ict-clip-wave");
        bindTip(q(".ict-play"), () => t("core.playPausePreview"));
        let scrubbing = false;
        const scrubTo = (clientX) => {
          const box = waveEl.getBoundingClientRect();
          if (!box.width) return;
          const ratio = clamp((clientX - box.left) / box.width, 0, 1);
          seekAt(ratio * timelineDuration());
        };
        /* Drag the white playhead directly on the waveform: press the head line
           (or anywhere on the wave) and drag. Segment buttons still select, so
           skip when the press lands on one. The line shows ew-resize arrows on
           hover and stays grabbed (dragging + is-scrubbing) while scrubbing. */
        const head = q(".ict-clip-head");
        stage.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          if (e.target.closest(".ict-clip-seg")) return;
          scrubbing = true;
          stage.classList.add("is-scrubbing");
          head.classList.add("dragging");
          try { stage.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
          scrubTo(e.clientX);
          e.preventDefault();
        });
        stage.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e.clientX); });
        const stopScrub = () => {
          if (!scrubbing) return;
          scrubbing = false;
          stage.classList.remove("is-scrubbing");
          head.classList.remove("dragging");
        };
        stage.addEventListener("pointerup", stopScrub);
        stage.addEventListener("pointercancel", stopScrub);
        body.addEventListener("click", (event) => {
          const tool = event.target.closest(".ict-toolrow button[data-act]");
          if (tool && !tool.disabled) {
            ({ undo, redo, split, merge, remove: removeSegment })[tool.dataset.act]?.();
            return;
          }
          if (event.target.closest(".ict-play")) { togglePlay(); return; }
          const segment = event.target.closest(".ict-clip-seg");
          if (segment) {
            const index = Number(segment.dataset.index), clip = clips()[index];
            if (!clip) return;
            const box = segment.getBoundingClientRect();
            S.selected = index;
            seekAt(clip.offset + clip.length * clamp((event.clientX - box.left) / box.width, 0, 1));
            return;
          }
          if (event.target.closest(".ict-clip-ruler")) {
            const box = q(".ict-clip-ruler").getBoundingClientRect();
            seekAt((event.clientX - box.left) / box.width * timelineDuration());
          }
        });
        body.addEventListener("keydown", (event) => {
          const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "");
          if (event.key === "Delete" || event.key === "Backspace") {
            if (!typing) event.stopPropagation();
            return;
          }
          const mod = event.ctrlKey || event.metaKey;
          if (mod && !event.altKey && !typing) {
            const key = String(event.key).toLowerCase();
            if (key === "z" || key === "y") {
              event.preventDefault(); event.stopPropagation();
              (key === "y" || event.shiftKey) ? redo() : undo();
              return;
            }
          }
          if (typing) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation();
            seekAt(S.playhead + (event.key === "ArrowRight" ? 0.1 : -0.1));
          } else if (event.key === " " || event.code === "Space") {
            if (event.target?.tagName === "BUTTON") return;
            event.preventDefault(); event.stopPropagation();
            togglePlay();
          }
        });
        render();
        preflight(ui, "audio", () => render());
      },
      onClose: () => pause(),
      onApply: () => {
        if (!valid()) throw new Error(t("media.invalidClipCheckAudioDuration"));
        const segments = S.groups.reduce((all, group) => all.concat(group.map((r) => ({
          start: +r.start.toFixed(4), end: +r.end.toFixed(4),
        }))), []);
        return runRequest(T().API_AUDIO,
          { ref: refOf(ctx), action: "clip", segments }, ctx,
          { ui, kind: "audio", label: t("field.audio"), done: t("media.newAudioNodeCreatedRight") });
      },
    });
  };

  /* ---------------------------- audio: speed ----------------------------- */

  R.speed = async (ctx) => {
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctxAsset(ctx)).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    let duration = 0;
    duration = await new Promise((resolve) => {
      const audio = new Audio(mediaUrl);
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value || 0); } };
      audio.addEventListener("loadedmetadata", () => finish(
        Number.isFinite(audio.duration) ? audio.duration : 0));
      audio.addEventListener("error", () => finish(0));
      setTimeout(() => finish(0), 4000);
    });
    let speed = 1, ui = null, audition = null;
    const q = (selector) => ui?.body.querySelector(selector);
    const render = () => {
      const info = q(".ict-speedinfo");
      if (info) info.textContent = duration
        ? t("media.original") + " " + fmt(duration) + "  →  " + t("media.estimated") + " " + fmt(duration / speed)
        : t("media.readingAudioDuration");
      const slider = q(".ict-slider-range"), number = q(".ict-speed-number");
      if (slider && String(speed) !== slider.value) slider.value = String(speed);
      if (number && document.activeElement !== number) number.value = speed.toFixed(2);
      T().paintRanges?.(ui?.body);
      ui?.body.querySelectorAll(".ict-chip[data-speed]").forEach((chip) => {
        chip.classList.toggle("is-active", Math.abs(Number(chip.dataset.speed) - speed) < 0.001);
      });
      if (audition && !audition.paused) audition.playbackRate = speed;
      const audBtn = q(".ict-audition");
      if (audBtn) audBtn.innerHTML = (audition && !audition.paused)
        ? '<i class="icon-[lucide--pause] size-4" aria-hidden="true"></i> ' + t("core.stopPreview")
        : '<i class="icon-[lucide--play] size-4" aria-hidden="true"></i> ' + t("core.audition");
    };
    const ensureAudition = () => {
      if (!audition) {
        audition = new Audio(mediaUrl);
        audition.preload = "auto";
        audition.addEventListener("ended", () => render());
      }
      return audition;
    };
    const toggleAudition = () => {
      const a = ensureAudition();
      if (!a.paused) { a.pause(); render(); return; }
      a.playbackRate = speed;
      a.play().then(() => render()).catch(() => ui?.setStatus(t("media.previewPlaybackFailed"), true));
    };
    T().openModal({
      title: t("media.audioSpeed"), sub: t("media.014FfmpegAtempo"), width: 560,
      applyLabel: t("media.generateSpeedChangedAudio"), applyDisabled: true, cancelLabel: t("api.cancel"),
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-hint ict-speedinfo" style="margin-top:0">${t('media.readingAudio')}</div>
          <div class="ict-slider-field" style="margin-top:12px">
            <input class="ict-slider-range" type="range" min="0.1" max="4" step="0.1" value="1"
                   aria-label="${t('core.speedMultiplier')}" />
            <input class="ict-input ict-speed-number" type="number" min="0.1" max="4" step="0.1" value="1.00" aria-label="${t('core.speedMultiplierValue')}" />
          </div>
          <div class="ict-chips ict-presets" style="margin-top:12px">
            ${[0.5, 0.75, 1, 1.5, 2, 3].map((v) =>
              `<button class="ict-chip" type="button" data-speed="${v}">${v}×</button>`).join("")}
          </div>
          <div class="ict-speed-preview" style="margin-top:12px;display:flex;align-items:center;gap:10px">
            <button class="ict-btn ict-audition" type="button"><i class="icon-[lucide--play] size-4" aria-hidden="true"></i> ${t('core.audition')}</button>
            <span class="ict-hint">${t('core.auditionRealTimeCurrentSpeed')}</span>
          </div>
          <p class="ict-hint">${t('core.speedChangeUsesFfmpegAtempo')}</p>`;
        const slider = q(".ict-slider-range"), number = q(".ict-speed-number");
        const audBtn = q(".ict-audition");
        audBtn?.addEventListener("click", toggleAudition);
        number.addEventListener("focus", function () { this.select(); });
        body.addEventListener("click", (event) => {
          const chip = event.target.closest(".ict-chip[data-speed]");
          if (!chip) return;
          speed = Number(chip.dataset.speed);
          render();
        });
        body.addEventListener("input", (event) => {
          if (event.target === slider) {
            speed = clamp(Number(slider.value) || 1, 0.1, 4);
            render();
          }
        });
        body.addEventListener("change", (event) => {
          if (event.target !== number) return;
          const value = Number(number.value);
          speed = Number.isFinite(value) ? clamp(value, 0.1, 4) : 1;
          render();
        });
        render();
        preflight(ui, "audio", () => ui.setApplyEnabled(true));
      },
      onApply: () => runRequest(T().API_AUDIO,
        { ref: refOf(ctx), action: "speed", speed }, ctx,
        { ui, kind: "audio", label: t("field.audio"), done: t("media.newAudioNodeCreatedRight") }),
      onClose: () => { try { audition?.pause(); } catch (e) { /* optional */ } audition = null; },
    });
  };

  /* --------------------------- video: speed ------------------------------ */
  /* Mirrors the audio speed dialog: slider + presets + numeric, with a live
     duration estimate. Video uses setpts; audio (when present) uses chained
     atempo so the pitch stays natural. */

  R.videoSpeed = async (ctx) => {
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctxAsset(ctx)).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    let duration = 0;
    try {
      const v = await loadVideo(mediaUrl);
      duration = Number.isFinite(v.duration) ? v.duration : 0;
      try { v.removeAttribute("src"); v.load(); } catch (e) { /* optional */ }
    } catch (e) { /* duration stays 0 */ }
    let speed = 1, ui = null;
    const q = (selector) => ui?.body.querySelector(selector);
    const render = () => {
      const info = q(".ict-speedinfo");
      if (info) info.textContent = duration
        ? t("media.original") + " " + fmt(duration) + "  →  " + t("media.estimated") + " " + fmt(duration / speed)
        : t("media.readingVideoDuration");
      const slider = q(".ict-slider-range"), number = q(".ict-speed-number");
      if (slider && String(speed) !== slider.value) slider.value = String(speed);
      if (number && document.activeElement !== number) number.value = speed.toFixed(2);
      T().paintRanges?.(ui?.body);
      ui?.body.querySelectorAll(".ict-chip[data-speed]").forEach((chip) => {
        chip.classList.toggle("is-active", Math.abs(Number(chip.dataset.speed) - speed) < 0.001);
      });
    };
    T().openModal({
      title: t("media.videoSpeed"), sub: t("media.014VideoSetpts"), width: 560,
      applyLabel: t("media.generateSpeedChangedVideo"), applyDisabled: true, cancelLabel: t("api.cancel"),
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-hint ict-speedinfo" style="margin-top:0">${t("media.readingVideoProgress")}</div>
          <div class="ict-slider-field" style="margin-top:12px">
            <input class="ict-slider-range" type="range" min="0.1" max="4" step="0.1" value="1"
                   aria-label="${t("core.speedMultiplier")}" />
            <input class="ict-input ict-speed-number" type="number" min="0.1" max="4" step="0.1" value="1.00" aria-label="${t("core.speedMultiplierValue")}" />
          </div>
          <div class="ict-chips ict-presets" style="margin-top:12px">
            ${[0.5, 0.75, 1, 1.5, 2, 3].map((v) =>
              `<button class="ict-chip" type="button" data-speed="${v}">${v}×</button>`).join("")}
          </div>
          <p class="ict-hint">${t("media.videoDurationChangesViaSetpts")}</p>`;
        const slider = q(".ict-slider-range"), number = q(".ict-speed-number");
        number.addEventListener("focus", function () { this.select(); });
        body.addEventListener("click", (event) => {
          const chip = event.target.closest(".ict-chip[data-speed]");
          if (!chip) return;
          speed = Number(chip.dataset.speed); render();
        });
        body.addEventListener("input", (event) => {
          if (event.target === slider) { speed = clamp(Number(slider.value) || 1, 0.1, 4); render(); }
        });
        body.addEventListener("change", (event) => {
          if (event.target !== number) return;
          const value = Number(number.value);
          speed = Number.isFinite(value) ? clamp(value, 0.1, 4) : 1; render();
        });
        render();
        preflight(ui, "video", () => ui.setApplyEnabled(true));
      },
      onApply: () => runRequest(T().API_VIDEO,
        { ref: refOf(ctx), action: "speed", speed }, ctx,
        { ui, kind: "video", label: t("field.video"), done: t("media.newVideoNodeCreatedRight") }),
    });
  };

  /* --------------------------- video: crop -------------------------------- */
  /* Crop a video by selecting a region on its first frame. Reuses the image
     crop's global .ict-crop-* styles; the background is a canvas snapshot of
     frame 0 (seeking a paused video straight to frame 0 is reliable). */

  R.videoCrop = async (ctx) => {
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctxAsset(ctx)).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    let video;
    try { video = await loadVideo(mediaUrl); }
    catch (e) { toast("error", t("media.videoLoadFailed")); return; }
    const W = video.videoWidth, H = video.videoHeight;
    try { video.currentTime = 0; } catch (e) { /* optional */ }
    const frameUrl = await new Promise((resolve) => {
      const done = (url) => resolve(url);
      const grab = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = W; canvas.height = H;
          canvas.getContext("2d").drawImage(video, 0, 0, W, H);
          done(canvas.toDataURL("image/png"));
        } catch (e) { done(mediaUrl); }
      };
      video.addEventListener("seeked", grab, { once: true });
      setTimeout(grab, 1500);
      if (video.readyState >= 2 && video.currentTime === 0) setTimeout(grab, 0);
    });
    try { video.removeAttribute("src"); video.load(); } catch (e) { /* optional */ }

    /* Same ratio locks as the image crop (tools.js RATIOS) — defined inside
       the handler so t() is evaluated at run time, not module load time. */
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
    const S = { rect: { x: Math.round(W * 0.1), y: Math.round(H * 0.1),
                        w: Math.round(W * 0.8), h: Math.round(H * 0.8) },
                scale: 1, drag: null, ready: true, ratioKey: "origin", ratio: 1 };
    let stage, frameEl, inputs = {}, ui = null;
    const q = (selector) => ui?.body.querySelector(selector);
    const ratioValue = () => {
      const entry = RATIOS.find((r) => r.key === S.ratioKey);
      if (!entry) return null;
      if (entry.value === 0) return W / H;
      return entry.value;
    };
    const valid = () => S.rect.w >= 2 && S.rect.h >= 2 &&
      S.rect.x >= 0 && S.rect.y >= 0 &&
      S.rect.x + S.rect.w <= W + 0.6 && S.rect.y + S.rect.h <= H + 0.6;
    function normalise() {
      const c = S.rect;
      c.w = clamp(Math.round(c.w), 2, W);
      c.h = clamp(Math.round(c.h), 2, H);
      c.x = clamp(Math.round(c.x), 0, Math.max(0, W - c.w));
      c.y = clamp(Math.round(c.y), 0, Math.max(0, H - c.h));
    }
    function paint(skipInputs = false) {
      if (!frameEl) return;
      const c = S.rect, s = S.scale;
      frameEl.style.left = (c.x * s) + "px";
      frameEl.style.top = (c.y * s) + "px";
      frameEl.style.width = Math.max(1, c.w * s) + "px";
      frameEl.style.height = Math.max(1, c.h * s) + "px";
      for (const key of ["w", "h"]) {
        const el = inputs[key];
        if (el && !skipInputs && document.activeElement !== el) el.value = Math.round(c[key]);
      }
      const summary = q(".ict-crop-size");
      if (summary) summary.textContent = t("media.originalVideo") + " " + W + " × " + H;
      ui?.setApplyEnabled?.(valid());
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
      const chips = ui?.body.querySelectorAll(".ict-ratio") || [];
      chips.forEach((chip) => {
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
      let w = key === "w" ? value : c.w, h = key === "h" ? value : c.h;
      if (r) { if (key === "w") h = w / r; else w = h * r; }
      w = clamp(w, 2, Math.max(2, W - c.x));
      h = clamp(h, 2, Math.max(2, H - c.y));
      if (r) { const limit = Math.min(W - c.x, (H - c.y) * r);
               w = Math.min(w, Math.max(2, limit)); h = w / r; }
      c.w = w; c.h = h;
      S.rect = c;
      paint(true);
    }
    function layout() {
      if (!stage) return;
      const box = q(".ict-preview");
      if (!box) return;
      const scale = Math.min(Math.max(40, box.clientWidth) / W, Math.max(40, box.clientHeight) / H);
      if (!Number.isFinite(scale) || scale <= 0) return;
      S.scale = scale;
      stage.style.width = Math.round(W * scale) + "px";
      stage.style.height = Math.round(H * scale) + "px";
      paint();
    }
    T().openModal({
      title: t("image.crop"), sub: t("media.selectRegionFirstFrameCreate"), width: 760,
      applyLabel: t("media.generateCroppedVideo"), applyDisabled: false, cancelLabel: t("api.cancel"),
      warn: T().warnHtml(),
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview">
              <div class="ict-crop-stage">
                <img alt="${t("media.firstFrame")}" src="${frameUrl}" />
                <div class="ict-crop-frame">
                  ${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((d) => `<i class="ict-handle ict-h-${d}" data-d="${d}"></i>`).join("")}
                </div>
              </div>
            </div>
            <aside class="ict-side">
              <div><p class="ict-label">${t("core.ratio")}</p><div class="ict-chips ict-ratios"></div></div>
              <div class="ict-4">
                <label>${t("core.width")} <input class="ict-input" type="number" data-f="w" /></label>
                <label>${t("core.height")} <input class="ict-input" type="number" data-f="h" /></label>
              </div>
              <p class="ict-summary ict-crop-size">${t("media.readingVideo")}</p>
            </aside>
          </div>`;
        stage = body.querySelector(".ict-crop-stage");
        frameEl = body.querySelector(".ict-crop-frame");
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
          if (event.button !== 0) return;
          event.preventDefault();
          const p = at(event);
          const handle = event.target.closest?.(".ict-handle");
          const c = S.rect;
          const inside = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
          S.drag = { mode: handle ? "resize" : (inside ? "move" : "new"),
                     dir: handle?.dataset.d || "", anchor: p, rect: { ...c }, r: ratioValue() };
          if (S.drag.mode === "new") S.rect = { x: p.x, y: p.y, w: 0, h: 0 };
          try { stage.setPointerCapture(event.pointerId); } catch (e) { /* optional */ }
          paint();
        });
        stage.addEventListener("pointermove", (event) => {
          const d = S.drag;
          if (!d) return;
          const p = at(event);
          if (d.mode === "move") {
            S.rect = { x: clamp(d.rect.x + (p.x - d.anchor.x), 0, Math.max(0, W - d.rect.w)),
                       y: clamp(d.rect.y + (p.y - d.anchor.y), 0, Math.max(0, H - d.rect.h)),
                       w: d.rect.w, h: d.rect.h };
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
        layout();
        preflight(ui, "video", () => {});
      },
      onApply: () => {
        const c = S.rect;
        return runRequest(T().API_VIDEO,
          { ref: refOf(ctx), action: "crop",
            x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) }, ctx,
          { ui, kind: "video", label: t("field.video"), done: t("media.newVideoNodeCreatedRight") });
      },
    });
  };
})();
