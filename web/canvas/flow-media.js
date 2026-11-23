/* Media composables: sliders, media player and audio waveform.
   Extracted from infcanvas-flow.js (batch 2). Pure DOM/canvas + Vue lifecycle;
   the only host coupling is getZoom() (viewport zoom getter) passed in by the
   caller so the waveform canvas can re-measure on zoom without owning state. */
import {
  Vue as VueNS,
} from "./vendor/vueflow.bundle.mjs";
const { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } = VueNS;

/* Local copy of the clamp used by the canvas Root. Pure, no shared state. */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const WAVE_BG = "#232428";
  const WAVE_BAR = "#8b929e";
  const WAVE_PLAYED = "#4a9eff";
  const WAVE_HEAD = "#3d9cff";
  const WAVE_PAD_X = 14;
  const WAVE_UNIT = 5;
  const WAVE_PEAKS_RES = 1600;
  const WAVE_HEAD_HIT = 9;
  const WAVE_HEAD_PAD_Y = 12;

  const pad2 = (n) => String(n).padStart(2, "0");
  /* Media controls use a fixed two-digit minute clock (00:17 / 00:25), so the
     text never changes width while playing. The short form stays for the
     generic duration labels on generator panels. */
  const fmtClock = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.floor(seconds);
    return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
  };

  /* --------------------------- audio waveform ---------------------------- */

  const peakCache = new Map();
  let audioCtx = null;

  function hashOf(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /* mulberry32, same PRNG as xcat-audio-wave.js::rng() */
  function rngOf(seed) {
    let value = seed || 1;
    return () => {
      value |= 0;
      value = (value + 0x6D2B79F5) | 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* While decodeAudioData runs, draw a deterministic placeholder so the node
     never flashes an empty block. Mirrors the reference fakePeaks(): tapered
     ends, nine Gaussian bursts and a slow tremolo. */
  function fakePeaks(seed, count) {
    const random = rngOf(hashOf(seed || "xcat"));
    const out = new Float32Array(count);
    const bursts = [];
    for (let i = 0; i < 9; i += 1) {
      bursts.push({
        c: (i + 0.5) / 9 + (random() - 0.5) * 0.05,
        w: 0.035 + random() * 0.055,
        g: 0.30 + random() * 0.70,
      });
    }
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const edge = Math.pow(Math.sin(Math.PI * t), 0.42);
      let gain = 0.10;
      for (const burst of bursts) {
        const d = (t - burst.c) / burst.w;
        gain = Math.max(gain, burst.g * Math.exp(-d * d * 2.1));
      }
      const tremolo = 0.80 + 0.20 * Math.sin(t * 79);
      out[i] = clamp(edge * gain * tremolo * (0.62 + 0.38 * random()), 0.03, 1);
    }
    return out;
  }

  function computePeaks(buffer, count) {
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    const length = channels[0].length;
    const out = new Float32Array(count);
    let max = 0;
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor((i * length) / count);
      const end = Math.max(start + 1, Math.floor(((i + 1) * length) / count));
      const stride = Math.max(1, Math.floor((end - start) / 48));
      let peak = 0;
      for (let j = start; j < end; j += stride) {
        for (let k = 0; k < channels.length; k += 1) {
          const value = Math.abs(channels[k][j]);
          if (value > peak) peak = value;
        }
      }
      out[i] = peak;
      if (peak > max) max = peak;
    }
    if (max > 0) {
      for (let i = 0; i < count; i += 1) out[i] = clamp(Math.pow(out[i] / max, 1.15), 0.03, 1);
    }
    return out;
  }

  /* One fetch/decode per URL, shared by every node showing the same asset.
     onReady fires with the decoded peaks so each waveform can repaint. */
  function peaksFor(url, onReady) {
    if (!url) return null;
    let record = peakCache.get(url);
    if (!record) {
      record = { state: "loading", data: fakePeaks(url, WAVE_PEAKS_RES), waiters: [] };
      peakCache.set(url, record);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        record.state = "failed";
      } else {
        audioCtx = audioCtx || new AudioCtx();
        fetch(url)
          .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("fetch"))))
          .then((buffer) => audioCtx.decodeAudioData(buffer))
          .then((audio) => {
            record.state = "ready";
            record.data = computePeaks(audio, WAVE_PEAKS_RES);
            for (const waiter of record.waiters) waiter(record.data);
            record.waiters.length = 0;
          })
          .catch(() => { record.state = "failed"; record.waiters.length = 0; });
      }
    }
    if (onReady) {
      if (record.state === "ready") onReady(record.data);
      else if (record.state === "loading") record.waiters.push(onReady);
    }
    return record;
  }

  /* --------------------------- media elements ---------------------------- */

  /* The three asset nodes are a DOM port of the reference project's
     xcat-media-controls.js / xcat-audio-wave.js / VideoPlayer.vue:
       - media elements are inert (pointer-events:none), so dragging the node
         and clicking the canvas keep working
       - one control bar for video AND audio: transform-driven sliders
         (scaleX / translate3d, never layout), three fixed-width time segments,
         rAF painting, pointer capture, keyboard nudges, full event shield
       - audio waveform: decodeAudioData peaks, rounded bars, plot box with
         top/bottom headroom, a playhead that turns into a grab capsule on hover
         and is the ONLY thing that can seek
     Sources:
       frontend/public/assets/xcat-media-controls.js  (mkSlider / buildBar)
       frontend/public/assets/xcat-audio-wave.js      (plotBox / draw / hitHead)
       frontend/src/styles/xcat-overrides.css         (.xcat-mbar / --xw-*)
       frontend/src/components/Node/VideoPlayer.vue  (icons / .vp-video)      */
  const STOP_EVENTS = ["mousedown", "mouseup", "click", "pointerdown", "pointerup",
    "touchstart", "wheel", "dblclick"];

  /* Slider geometry: the track leaves 10px at BOTH ends of the slider box, so
     the visible line is inset 10px from the card edge and the 12px hover knob
     (radius 6) stays fully inside it even at ratio 0 / 1. Fill width and thumb
     left are driven in px, not transforms, so zoom never blurs the line. */
  const KNOB_INSET = 10;

  function makeSlider(root, onInput) {
    const fill = root.querySelector(".icn__slider-fill");
    const thumb = root.querySelector(".icn__slider-thumb");
    let ratio = 0, dragging = false, spanPx = 0, lastPct = -1;
    const measure = () => {
      spanPx = Math.max(0, root.clientWidth - KNOB_INSET * 2);
    };
    const paint = () => {
      const travel = spanPx || Math.max(0, root.clientWidth - KNOB_INSET * 2);
      const px = ratio * travel;
      fill.style.width = px + "px";
      thumb.style.left = (KNOB_INSET + px) + "px";
      const pct = Math.round(ratio * 100);
      if (pct !== lastPct) { lastPct = pct; root.setAttribute("aria-valuenow", String(pct)); }
    };
    const at = (clientX) => {
      const box = root.getBoundingClientRect();
      const travel = box.width - KNOB_INSET * 2;
      return clamp(travel > 0 ? (clientX - box.left - KNOB_INSET) / travel : 0, 0, 1);
    };
    const apply = (value, fire) => {
      ratio = clamp(value, 0, 1);
      paint();
      if (fire) onInput(ratio);
    };
    const onDown = (event) => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      dragging = true;
      /* Pin the expandable volume track open for the whole gesture, otherwise
         leaving the 84px strip collapses it to width:0 and the next pointermove
         maps against zero width -> value snaps to 100% (the "slider overshoots"
         bug). The class is also mirrored on the group so the pill keeps its
         background while the pointer is outside it. */
      root.classList.add("is-dragging");
      root.parentElement?.classList.add("is-dragging");
      try { root.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      measure();
      apply(at(event.clientX), true);
    };
    const onMove = (event) => {
      if (!dragging) return;
      event.stopPropagation();
      apply(at(event.clientX), true);
    };
    const onUp = (event) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("is-dragging");
      root.parentElement?.classList.remove("is-dragging");
      try { root.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
    };
    const onKey = (event) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 0.02
        : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -0.02 : 0;
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      apply(ratio + step, true);
    };
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("keydown", onKey);
    const ro = window.ResizeObserver ? new ResizeObserver(() => { measure(); paint(); }) : null;
    if (ro) ro.observe(root);
    measure();
    paint();
    return {
      set: (value) => apply(value, false),
      destroy() {
        root.removeEventListener("pointerdown", onDown);
        root.removeEventListener("pointermove", onMove);
        root.removeEventListener("pointerup", onUp);
        root.removeEventListener("pointercancel", onUp);
        root.removeEventListener("keydown", onKey);
        if (ro) ro.disconnect();
      },
    };
  }

  function useMediaPlayer(getUrl) {
    const el = ref(null);                 // <video> / <audio>
    const bar = ref(null);                // .icn__bar
    const playing = ref(false);
    const timeText = ref("0:00");
    const durationText = ref("0:00");
    const muteIcon = ref("volume-2");
    let raf = 0, lastSec = -1, seek = null, vol = null;
    let boundMedia = null, boundRoot = null;
    const listeners = [];

    const duration = () => {
      const value = el.value?.duration;
      return value && Number.isFinite(value) && value > 0 ? value : 0;
    };
    const repaint = () => {
      const media = el.value;
      if (!media || !seek) return;
      const total = duration();
      seek.set(total ? clamp((media.currentTime || 0) / total, 0, 1) : 0);
      const second = Math.floor(media.currentTime || 0);
      if (second !== lastSec) {
        lastSec = second;
        timeText.value = fmtClock(media.currentTime || 0);
        durationText.value = fmtClock(total);
      }
    };
    const frame = () => {
      if (!playing.value) return;
      repaint();
      raf = requestAnimationFrame(frame);
    };
    const syncVol = () => {
      const media = el.value;
      if (!media) return;
      const silent = media.muted || media.volume === 0;
      if (vol) vol.set(silent ? 0 : media.volume);
      muteIcon.value = silent ? "volume-x" : "volume-2";
    };
    const toggle = () => {
      const media = el.value;
      if (!media || !media.getAttribute("src")) return;
      if (media.paused) {
        const promise = media.play();
        if (promise?.catch) promise.catch(() => { playing.value = false; });
      } else media.pause();
    };
    const toggleMute = () => {
      const media = el.value;
      if (!media) return;
      media.muted = !media.muted;
      if (!media.muted && media.volume === 0) media.volume = 0.5;
      syncVol();
    };
    const onLoaded = () => {
      const media = el.value;
      if (!media) return;
      /* preload="metadata" leaves the first frame undecoded: nudge the decoder
         so the video poster is not black. */
      if (!media.videoWidth && media.readyState >= 1) {
        try { media.currentTime = Math.min(0.05, (media.duration || 1) / 100); } catch (error) { /* optional */ }
      }
      lastSec = -1;
      repaint();
    };
    const onPlayEvent = () => {
      playing.value = true;
      cancelAnimationFrame(raf);
      frame();
    };
    const onPauseEvent = () => {
      playing.value = false;
      cancelAnimationFrame(raf);
      lastSec = -1;
      repaint();
    };
    const onTimeUpdate = () => { if (!playing.value) { lastSec = -1; repaint(); } };

    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      listeners.push([target, type, fn]);
    };
    const teardown = () => {
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
      seek?.destroy(); vol?.destroy();
      seek = null; vol = null;
      cancelAnimationFrame(raf);
      boundMedia = null; boundRoot = null;
    };

    /* Called on mount and whenever a node acquires a media element. Rebinding
       is idempotent, so switching a node's asset never duplicates listeners. */
    function install() {
      const root = bar.value, media = el.value;
      if (!root || !media) return;
      if (boundMedia === media && boundRoot === root) return;
      teardown();
      boundMedia = media; boundRoot = root;
      const seekRoot = root.querySelector(".icn__seek");
      const volRoot = root.querySelector(".icn__vol");
      if (!seekRoot) return;

      seek = makeSlider(seekRoot, (ratio) => {
        const total = duration();
        if (!total) return;
        try { media.currentTime = ratio * total; } catch (error) { /* optional */ }
        lastSec = -1;
        repaint();
      });
      /* Volume slider (native-control behaviour): hover the speaker to reveal
         it; dragging adjusts volume, not just mute. */
      if (volRoot) vol = makeSlider(volRoot, (ratio) => {
        media.volume = ratio;
        if (ratio > 0 && media.muted) media.muted = false;
        syncVol();
      });

      /* The bar must never reach Vue Flow's node drag handler, the pane's
         dblclick menu, or the canvas wheel zoom. */
      for (const type of STOP_EVENTS) {
        listen(root, type, (event) => event.stopPropagation());
      }
      listen(media, "loadedmetadata", onLoaded);
      listen(media, "durationchange", () => { lastSec = -1; repaint(); });
      listen(media, "timeupdate", onTimeUpdate);
      listen(media, "seeked", () => { lastSec = -1; repaint(); });
      listen(media, "play", onPlayEvent);
      listen(media, "pause", onPauseEvent);
      listen(media, "ended", onPauseEvent);
      listen(media, "volumechange", syncVol);
      syncVol();
      lastSec = -1;
      repaint();
    }

    onMounted(() => nextTick(install));
    /* Uploading a different kind of file replaces <video> with <audio> (or
       vice versa); the bar must follow the new element. */
    watch(el, () => nextTick(install));
    onBeforeUnmount(() => {
      teardown();
      const media = el.value;
      if (media) {
        try { media.pause(); media.removeAttribute("src"); media.load(); } catch (error) { /* optional */ }
      }
    });
    watch(getUrl, () => {
      playing.value = false;
      timeText.value = "00:00";
      durationText.value = "00:00";
      lastSec = -1;
      repaint();
    });

    return { el, bar, playing, timeText, durationText, muteIcon, toggle, toggleMute, onLoaded, install };
  }

  /* ---------------------------- audio waveform --------------------------- */

  function capsule(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function useAudioWave(getUrl, getMedia, isEnabled, getZoom) {
    const host = ref(null);
    const canvas = ref(null);
    const inst = {
      w: 0, h: 0, progress: 0, peaks: null, raf: 0, dead: false,
      playing: false, dragging: false, hoverHead: false, dragDX: 0,
      lastX: null, lastY: null,
    };
    let ro = null;

    /* Centre the waveform on the WHOLE node: identical headroom above and
       below, with no allowance for the title strip or the control row. */
    const plotBox = (height) => {
      const margin = Math.max(8, height * 0.2);
      return { top: margin, bottom: margin, h: Math.max(6, height - margin * 2) };
    };
    const plotW = () => Math.max(1, inst.w - WAVE_PAD_X * 2);
    const headX = () => WAVE_PAD_X + clamp(inst.progress, 0, 1) * plotW();
    const hitHead = (clientX, clientY) => {
      const element = host.value;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      const box = plotBox(inst.h);
      return Math.abs(x - headX()) <= WAVE_HEAD_HIT &&
        y >= box.top - WAVE_HEAD_PAD_Y && y <= box.top + box.h + WAVE_HEAD_PAD_Y;
    };
    const colors = () => {
      const element = host.value;
      const style = element ? getComputedStyle(element) : null;
      const read = (name, fallback) => (style?.getPropertyValue(name) || "").trim() || fallback;
      return {
        bar: read("--icw-bar", WAVE_BAR),
        played: read("--icw-played", WAVE_PLAYED),
        head: read("--icw-head", WAVE_HEAD),
        headFg: read("--icw-head-fg", "#ffffff"),
        bg: read("--icw-bg", WAVE_BG),
      };
    };
    const resample = (peaks, count) => {
      const out = new Float32Array(count);
      if (!peaks?.length) return out;
      for (let i = 0; i < count; i += 1) {
        const start = Math.floor((i * peaks.length) / count);
        const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
        let value = 0;
        for (let j = start; j < end && j < peaks.length; j += 1) value = Math.max(value, peaks[j]);
        out[i] = value;
      }
      return out;
    };

    const measure = () => {
      const rect = host.value?.getBoundingClientRect();
      inst.w = rect ? Math.max(1, Math.round(rect.width)) : 1;
      inst.h = rect ? Math.max(1, Math.round(rect.height)) : 1;
    };

    const draw = () => {
      const element = canvas.value;
      if (!element || !inst.w || !inst.h || inst.dead) return;
      const width = inst.w, height = inst.h;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelW = Math.round(width * dpr), pixelH = Math.round(height * dpr);
      if (element.width !== pixelW || element.height !== pixelH) {
        element.width = pixelW;
        element.height = pixelH;
      }
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const col = colors();
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, width, height);

      const span = plotW();
      const box = plotBox(height);
      const count = Math.max(12, Math.min(260, Math.floor(span / WAVE_UNIT)));
      const peaks = resample(inst.peaks, count);
      const middle = box.top + box.h / 2;
      const step = span / count;
      const lineWidth = Math.max(1.5, Math.min(3, step * 0.58));
      const hx = headX();
      const grabbed = inst.hoverHead || inst.dragging;

      ctx.lineCap = "round";
      for (let i = 0; i < count; i += 1) {
        const x = WAVE_PAD_X + (i + 0.5) * step;
        const barH = Math.max(2, peaks[i] * box.h);
        ctx.strokeStyle = x <= hx ? col.played : col.bar;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x, middle - barH / 2);
        ctx.lineTo(x, middle + barH / 2);
        ctx.stroke();
      }

      ctx.strokeStyle = col.head;
      ctx.lineWidth = grabbed ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(hx + 0.5, box.top);
      ctx.lineTo(hx + 0.5, box.top + box.h);
      ctx.stroke();

      if (!grabbed) {
        ctx.fillStyle = col.head;
        ctx.beginPath();
        ctx.arc(hx, box.top, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const capX = clamp(hx - 16, 1, Math.max(1, width - 33));
        const centre = capX + 16;
        ctx.fillStyle = col.head;
        capsule(ctx, capX, box.top - 9, 32, 18, 9);
        ctx.fill();
        ctx.strokeStyle = col.headFg;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(centre - 6, box.top - 3.5);
        ctx.lineTo(centre - 9.5, box.top);
        ctx.lineTo(centre - 6, box.top + 3.5);
        ctx.moveTo(centre + 6, box.top - 3.5);
        ctx.lineTo(centre + 9.5, box.top);
        ctx.lineTo(centre + 6, box.top + 3.5);
        ctx.stroke();
      }
    };

    const sync = () => {
      const media = getMedia();
      if (media && Number.isFinite(media.duration) && media.duration > 0) {
        inst.progress = clamp((media.currentTime || 0) / media.duration, 0, 1);
      }
      /* The playhead moves while playing; re-evaluate hover even if the mouse
         is still, or the grab capsule drifts away from the blue line. */
      if (!inst.dragging && inst.lastX != null) {
        const over = hitHead(inst.lastX, inst.lastY);
        if (over !== inst.hoverHead) {
          inst.hoverHead = over;
          if (host.value) host.value.style.cursor = over ? "ew-resize" : "";
        }
      }
    };
    const loop = () => {
      if (inst.dead || !inst.playing) return;
      if (!inst.dragging) sync();
      draw();
      inst.raf = requestAnimationFrame(loop);
    };
    const seekAt = (clientX) => {
      const rect = host.value?.getBoundingClientRect();
      if (!rect) return;
      const ratio = clamp((clientX - rect.left - WAVE_PAD_X) / plotW(), 0, 1);
      const media = getMedia();
      if (media && Number.isFinite(media.duration) && media.duration > 0) {
        try { media.currentTime = ratio * media.duration; } catch (error) { /* optional */ }
      }
      inst.progress = ratio;
      draw();
    };

    const onDown = (event) => {
      if (!hitHead(event.clientX, event.clientY)) return;  // blank: drag the node
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      const rect = host.value.getBoundingClientRect();
      inst.dragDX = event.clientX - (rect.left + headX());
      inst.dragging = true;
      inst.hoverHead = true;
      host.value.style.cursor = "ew-resize";
      try { host.value.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      draw();
    };
    /* d3-drag listens on mousedown in the bubble phase; the waveform is a
       descendant, so stopping here is early enough to keep the node still. */
    const onMouseDown = (event) => {
      if (hitHead(event.clientX, event.clientY)) {
        event.stopPropagation();
        if (event.cancelable) event.preventDefault();
      }
    };
    const onMove = (event) => {
      inst.lastX = event.clientX;
      inst.lastY = event.clientY;
      if (inst.dragging) { seekAt(event.clientX - inst.dragDX); return; }
      const over = hitHead(event.clientX, event.clientY);
      if (over !== inst.hoverHead) {
        inst.hoverHead = over;
        host.value.style.cursor = over ? "ew-resize" : "";
        draw();
      }
    };
    const onUp = (event) => {
      if (!inst.dragging) return;
      inst.dragging = false;
      try { host.value.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
      inst.hoverHead = event.clientX != null ? hitHead(event.clientX, event.clientY) : false;
      host.value.style.cursor = inst.hoverHead ? "ew-resize" : "";
      draw();
    };
    const onLeave = () => {
      if (inst.dragging) return;
      inst.lastX = inst.lastY = null;
      inst.hoverHead = false;
      if (host.value) host.value.style.cursor = "";
      draw();
    };

    const loadPeaks = () => {
      const url = getUrl();
      const record = peaksFor(url, (data) => { inst.peaks = data; draw(); });
      inst.peaks = record?.data || fakePeaks(url, WAVE_PEAKS_RES);
      draw();
    };

    const attachMedia = () => {
      const media = getMedia();
      if (!media || media.dataset.icwBound === "1") return;
      media.dataset.icwBound = "1";
      media.addEventListener("play", () => {
        inst.playing = true;
        cancelAnimationFrame(inst.raf);
        loop();
      });
      media.addEventListener("pause", () => {
        inst.playing = false;
        cancelAnimationFrame(inst.raf);
        sync(); draw();
      });
      media.addEventListener("timeupdate", () => { if (!inst.dragging) { sync(); draw(); } });
      media.addEventListener("loadedmetadata", () => { sync(); draw(); });
      media.addEventListener("ended", () => { inst.playing = false; inst.progress = 0; draw(); });
    };

    const ensureObservers = () => {
      if (ro || !window.ResizeObserver || !host.value) return;
      ro = new ResizeObserver(() => { measure(); draw(); });
      ro.observe(host.value);
    };
    const activate = () => {
      measure();
      attachMedia();
      loadPeaks();
      ensureObservers();
      draw();
    };
    onMounted(() => {
      if (!isEnabled()) return;   // image / video / text nodes need no decode
      activate();
      /* The media element can appear a tick later when an asset is attached to
         an existing empty node. */
      nextTick(attachMedia);
    });
    watch(getUrl, () => {
      if (!isEnabled()) return;
      inst.progress = 0;
      inst.hoverHead = false;
      inst.dragging = false;
      nextTick(activate);
    });
    /* The waveform canvas is sized from getBoundingClientRect(), which already
       includes the viewport's scale(zoom). A ResizeObserver only fires on layout
       changes — not on zoom — so without this the backing store stays sized for
       the old zoom and the canvas is upscaled as a blurry bitmap when zoomed in.
       Re-measure + redraw on every zoom change to keep it pixel-crisp. */
    watch(getZoom, () => {
      if (!isEnabled()) return;
      /* Defer so the viewport transform is already applied to the DOM before we
         read getBoundingClientRect() — otherwise we may measure the old size. */
      nextTick(() => { measure(); draw(); });
    });
    onBeforeUnmount(() => {
      inst.dead = true;
      cancelAnimationFrame(inst.raf);
      if (ro) ro.disconnect();
    });

    return { host, canvas, onDown, onMouseDown, onMove, onUp, onLeave, draw, attachMedia };
  }

export { useMediaPlayer, useAudioWave };
