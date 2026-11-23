/* Generation progress bridge + execution (batch 6): result extraction,
   field control, the native-WebSocket progress facade and NS.generate.
   Extracted from infcanvas-core.js. Document/schema symbols (markDirty,
   TYPE_BY_KIND, ...) and compiler helpers are injected; SAFE_INT_MAX is
   imported from the compiler module (single source of truth). */
import { SAFE_INT_MAX, effectiveTextData } from "./infcanvas-prompt-compiler.js";

/* Every exposed text box must be filled before generation. The live field set is the
   node's frozen fieldSnapshot.list (same source as the panel), read in the same order as
   the panel's textAreaValue: box one from data.prompt, audio box two from data.lyrics,
   the rest from data.apiValues (falling back to field defaults). Empty after trim = unfilled. */
export function missingRequiredTexts(data, tr = (s) => s) {
  const list = data?.fieldSnapshot?.list || [];
  /* Only multiline text boxes are required-input boxes. Single-line `text`
     fields are ordinary parameters (bottom bar), not prompt boxes. */
  const fields = list.filter((f) => f && f.type === "textarea");
  if (!fields.length) return [];
  const apiValues = data.apiValues || {};
  const fid = (f) => String(f.nodeId || "") + ":" + String(f.key || "");
  const missing = [];
  fields.forEach((field, i) => {
    let value;
    if (i === 0) value = data.prompt;
    else if (i === 1 && data.kind === "audio") value = data.lyrics;
    else {
      const stored = apiValues[fid(field)];
      value = stored === undefined || stored === null ? field.default : stored;
    }
    if (typeof value !== "string" || !value.trim()) {
      const label = String(field.label || field.key || "").trim();
      missing.push(label || tr("core.textInput"));
    }
  });
  return missing;
}

export function createProgress({ NS, tr, API, viewUrl, backend, sleep, TYPE_BY_KIND, SPEC_BY_TYPE, toast, state, JOBS_KEY, storageRead, storageWrite, flow, activeDoc, markDirty, addNodeByType, removeNode, collectUpstreamCleanups, collectInputs, collectLoras, buildPrompt }) {
function extractOutputs(outputs) {
  const result = [];
  for (const output of Object.values(outputs || {})) {
    for (const key of ["images", "gifs", "videos", "audio", "text", "strings"]) {
      const items = output?.[key];
      if (!Array.isArray(items)) continue;
      if (key === "text" || key === "strings") {
        for (const value of items) {
          result.push({ kind: "text", name: "wire.generateText", text: String(value), filename: "", subfolder: "", type: "output", url: "" });
        }
        continue;
      }
      for (const item of items) {
        if (!item?.filename) continue;
        const kind = key === "gifs" || key === "videos" ? "video" : key === "audio" ? "audio" : "image";
        const asset = {
          kind, name: item.filename, filename: item.filename,
          subfolder: item.subfolder || "", type: item.type || "output",
        };
        asset.url = viewUrl(asset);
        result.push(asset);
      }
    }
  }
  /* Preview-text toggle (sidebar 设置 → 显示预览文本, off by default).
     Workflows like MINIMAX H3 IMAGE first expand the prompt into a caption with a text
     model, then hand it to the image node; PreviewAny emits that caption as text. It is
     an intermediate product and should not take over an image node's frame. By default
     strip it and echo only media; show it once the user opts in. If a run produces only
     text (text-gen / LLM nodes), keep everything — filtering would leave an empty result. */
  const showPreviewText = storageRead("InfCanvas.ShowPreviewText") === true;
  if (!showPreviewText) {
    const hasMedia = result.some((a) => a.kind !== "text");
    if (hasMedia) return result.filter((a) => a.kind !== "text");
  }
  return result;
}

const CANCEL_SENTINEL = new Error("cancelled by user");

async function pollHistory(promptId, shouldStop) {
  for (let attempt = 0; attempt < 720; attempt += 1) {
    if (shouldStop && shouldStop()) throw CANCEL_SENTINEL;
    const data = await backend.history(promptId);
    const entry = data?.[promptId];
    if (entry) {
      const status = entry.status?.status_str;
      if (status === "error") {
        throw new Error(JSON.stringify(entry.status?.messages || []).slice(0, 300));
      }
      if (entry.outputs && Object.keys(entry.outputs).length) return extractOutputs(entry.outputs);
    }
    await sleep(500);
  }
  throw new Error(window.InfCanvas.i18n.t("core.waitResultTimeout"));
}

/* Results write straight back to the generator: the node already shows data.result as
   its image (assetOf = asset || result), so a separate result node duplicates the same
   picture. That echoed image can itself feed a downstream generator (the generator
   exposes result). Only a batch run with multiple outputs needs extra nodes for what
   the generator cannot hold; `resultNodes` tracks just those; `data.resultOf` points back. */
function attachResults(node, assets) {
  const data = node.data;
  const list = (assets || []).filter(Boolean);
  if (!list.length) return;

  /* Result node left by older versions beside the generator: fold it away on load. */
  for (const id of Array.isArray(data.resultNodes) ? data.resultNodes.slice() : []) {
    const found = flow()?.findNode?.(id);
    if (!found || found.data?.resultOf !== node.id) continue;
    removeNode(found.id);
  }

  const next = [];
  list.slice(1).forEach((asset, index) => {
    const type = TYPE_BY_KIND[asset.kind] || TYPE_BY_KIND.text;
    const spec = SPEC_BY_TYPE[type];
    const size = data?.size || [250, 230];
    const position = [
      node.position.x + (size[0] || 250) + 70,
      node.position.y + ((state.results + index) % 5) * 46,
    ];
    /* A generated result keeps the medium name ("图像"), NOT the output file
       name: the file name is an implementation detail of the run, while the
       node stays the same kind of thing the user created. */
    const created = addNodeByType(type, position, asset, spec?.title || null);
    if (!created) return;
    /* Marked through the flow layer, not on the raw object: Vue Flow keeps its
       own copy of the node, so a plain field write would only reach the
       serialised array and fail the resultOf check on the next run. */
    NS.flow?.updateNodeData?.(created.id, { resultOf: node.id });
    next.push(created.id);
    state.results += 1;
  });

  data.resultNodes = next;
  /* Re-running overwrites the same frame — no extra image is added each time. */
  data.result = list[0];
  NS.flow?.updateNodeData?.(node.id, { resultNodes: next, result: data.result });
}

function nextControlledValue(mode, spec, current) {
  const value = Number(current);
  if (!Number.isFinite(value)) return undefined;
  if (mode === "fixed") return undefined;
  const step = Number.isFinite(Number(spec?.step)) && Number(spec.step) > 0
    ? Number(spec.step) : 1;
  const min = Math.max(-SAFE_INT_MAX, Number.isFinite(Number(spec?.min))
    ? Number(spec.min) : 0);
  const max = Math.min(SAFE_INT_MAX, Number.isFinite(Number(spec?.max))
    ? Number(spec.max) : min + step * 1000000);
  let next = value;
  if (mode === "increment") next += step;
  else if (mode === "decrement") next -= step;
  else if (mode === "randomize") {
    /* A float cannot hold 2^64-1 exactly: drawing near the ceiling rounds UP
       to 2^64, which ComfyUI then rejects with value_bigger_than_max. Rolling
       inside the safe-integer range stays a valid seed and never overflows. */
    const ceiling = Math.min(max, Number.MAX_SAFE_INTEGER);
    const range = (ceiling - min) / step;
    if (!(range > 0)) return min;
    next = Math.floor(Math.random() * range) * step + min;
  } else return undefined;
  return Number(Math.min(Math.max(next, min), max).toFixed(6));
}

NS.fieldControl = {
  next: nextControlledValue,
  /* Runs right after the prompt is queued (the host's "after generate").
     Writing apiValues means the NEXT run uses the new seed and the node's own
     input shows it immediately. */
  applyAfterQueue(node) {
    const modes = node?.data?.fieldModes || {};
    const specs = node?.data?.fieldSpecs || {};
    /* EVERY exposed 随机数 counts, not only the ones whose badge was clicked:
       the badge shows 随机值 by default (the host default is "randomize"), so
       an untouched seed still has to advance after each run -- keying off
       fieldModes alone made 递增 / 递减 / 随机 all do nothing until the user
       happened to re-pick a mode. */
    const ids = [...new Set([...Object.keys(specs), ...Object.keys(modes)])];
    if (!ids.length) return;
    const values = { ...(node.data.apiValues || {}) };
    let changed = false;
    for (const id of ids) {
      const spec = specs[id] || {};
      const raw = values[id];
      /* Never touched: the panel is showing the template's own value, so that
         is the number to advance. Passing undefined skipped every mode. */
      const current = raw === undefined || raw === null || raw === ""
        ? spec.default
        : raw;
      /* A mode the user picked on the node wins; otherwise honour the mode
         configured on the field in the API dialog (carried in fieldSpecs).
         Without this fallback a configured 固定值 / 递增 / 递减 silently ran as
         randomize, because only an ad-hoc fieldModes pick was ever consulted. */
      const mode = modes[id] || spec.controlMode || "randomize";
      const next = nextControlledValue(mode, spec, current);
      if (next === undefined || next === current) continue;
      values[id] = next;
      changed = true;
    }
    if (!changed) return;
    node.data.apiValues = values;
    NS.flow?.updateNodeData?.(node.id, { apiValues: values });
    markDirty();
  },
};

/* ------------------------------------------------------------------------
   Generation progress bridge.

   ComfyUI pushes live execution events over its native WebSocket. The
   canvas generation runs through the SAME native api (NS.generate below
   uses API().queuePrompt), so we can subscribe to those events and mirror
   value/max/preview onto the generating node's own data. Nothing here
   invents a transport — every listener is the host api's addEventListener
   and is removed as soon as the job settles.

   Routing by prompt_id is essential: several canvas nodes may be running
   at once, and every event carries prompt_id EXCEPT bare b_preview (older
   backends). For that one we fall back to the most recently started job.
   ------------------------------------------------------------------------ */
const genProgress = (() => {
  /* promptId -> { nodeId, node, listeners:[[type,fn]], previewUrl, lastTs } */
  const jobs = new Map();
  let apiBound = null;
  let activePromptId = null;
  /* The server emits execution_start when a prompt BEGINS executing, which can
     happen before /prompt returns to the browser. begin() only attaches its
     execution_start listener after queuePrompt() resolves, so a fast start can
     be missed and the node would sit at "等待中" for the whole run. Keep a
     lightweight long-lived recorder of started prompt_ids (strings, bounded)
     so begin() can tell whether this prompt already started. This is PURELY a
     record — it never writes any phase/state, so multi-job queue semantics and
     the active-task snapshot stay exactly as before. */
  const startedPrompts = new Map(); // promptId -> timestamp
  let earlyBound = false;
  function markStarted(promptId) {
    if (!promptId) return;
    const id = String(promptId);
    startedPrompts.set(id, Date.now());
    if (startedPrompts.size <= 128) return;
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of startedPrompts) if (ts < cutoff) startedPrompts.delete(key);
  }
  function hasStarted(promptId) {
    return !!promptId && startedPrompts.has(String(promptId));
  }
  function bindEarlyStart() {
    if (earlyBound) return;
    const a = api();
    if (typeof a?.addEventListener !== "function") return;
    earlyBound = true;
    a.addEventListener("execution_start", (e) => markStarted(e?.detail?.prompt_id));
  }
  /* Subscribers (the canvas active-task badge) are notified whenever the set
     of live canvas jobs or any job's phase/progress changes. */
  const listeners = new Set();

  function api() { return API(); }

  function notify() {
    for (const fn of listeners) { try { fn(snapshot()); } catch (e) { /* no-op */ } }
  }

  /* Snapshot of canvas-owned live jobs for the active-task badge. Each job
     already carries nodeId/nodeTitles/totalNodes/executedSet; phase/progress
     are mirrored from the node data that writeNode keeps up to date. */
  function snapshot() {
    const out = [];
    const nodes = flow()?.nodesOf?.() || [];
    for (const [promptId, job] of jobs) {
      const node = nodes.find((entry) => entry.id === job.nodeId);
      const data = node?.data || {};
      /* Self-contained persisted snapshot: a refresh rebuilds the job map from
         prefs, and the source node may be missing (canvas closed / node deleted).
         Live node data wins; saved fields fill any gap. */
      const saved = job.snap || {};
      /* A settled job keeps its frozen phase on the job itself — the node's
         genPhase may be overwritten when the same node is reused later. */
      const phase = job.settledPhase || data.genPhase || saved.phase || "queued";
      /* Filter (all/current canvas) + sort (recent/slowest) metadata. */
      const settled = phase === "done" || phase === "error" || phase === "cancelled";
      const item = {
        promptId,
        nodeId: job.nodeId,
        title: data.title || data._meta?.title || saved.title || tr("core.generationTask"),
        phase,
        phaseText: job.settledPhase ? phaseText(job.settledPhase) : (data.genPhaseText || saved.phaseText || phaseText(phase)),
        progress: Number(data.genTotalProgress) || saved.progress || 0,
        /* Native QueueInlineProgress draws two bars: total (executionProgress)
           and current node (executingNodeProgress). Mirror both so the actionbar
           inline progress can reproduce ComfyUI's double-bar look. */
        currentNodeProgress: Number(data.genCurrentNodeProgress) || saved.currentNodeProgress || 0,
        kind: data.kind || saved.kind || "image",
        /* Native JobAssetsList shows a preview thumbnail + elapsed meta.
           Live jobs use the WS blob; settled jobs fall back to the node's
           (or persisted snapshot's) final result asset url — blob previews
           are session-only and never persisted. */
        previewUrl: data.genPreviewUrl || job.previewUrl || (settled && (data.result?.url || saved.resultAsset?.url)) || "",
        /* Settled result asset (kind/filename/subfolder/type/url) — lets the
           task list reuse the 资产 panel's MediaLightbox for a "View" action. */
        resultAsset: settled ? (data.result || saved.resultAsset || null) : null,
        currentNodeName: data.genCurrentNodeName || saved.currentNodeName || "",
        step: Number(data.genStep) || saved.step || 0,
        steps: Number(data.genSteps) || saved.steps || 0,
        startedAt: job.startedAt || saved.startedAt || 0,
        /* Canvas filter: which canvas document submitted this job. */
        docId: job.docId || saved.docId || "",
        /* Sort: elapsed generation time in ms. Native job.executionTime.
           Settled jobs freeze at endAt; live jobs keep counting up. */
        endedAt: job.endedAt || saved.endedAt || 0,
      };
      item.durationMs = item.startedAt
        ? ((item.endedAt || (settled ? item.startedAt : Date.now())) - item.startedAt)
        : 0;
      /* Refresh the self-contained copy used by persist() — never store the
         blob preview (revoked object URL) in prefs. Keep the live item's URL
         untouched so running rows still show the realtime preview. */
      job.snap = { ...item, previewUrl: job.previewUrl ? "" : item.previewUrl };
      out.push(item);
    }
    return out;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    try { fn(snapshot()); } catch (e) { /* no-op */ }
    return () => listeners.delete(fn);
  }

  const phaseText = (phase) => {
    if (phase === "queued") return tr("core.queuedStatus");
    if (phase === "running") return tr("core.generatingStatus");
    if (phase === "sampling") return tr("core.sampling");
    if (phase === "done") return tr("core.generationComplete");
    if (phase === "error") return tr("core.generationFailed");
    if (phase === "cancelled") return tr("media.cancelled");
    return "";
  };

  function writeNode(job, fields) {
    if (!job) return;
    /* Re-resolve by id on every event: updateNodeData swaps data objects,
       so a captured `job.node` reference can go stale between events. */
    NS.flow?.updateNodeData?.(job.nodeId, fields);
    notify();
  }

  /* Detach WS listeners + revoke the temporary preview blob. Shared by the
     two terminal paths: finish(keep=false) deletes the job, finish(keep=true)
     retains it as a completed history row. */
  function detachJob(job) {
    const a = api();
    for (const [type, fn] of job.listeners) {
      try { a?.removeEventListener?.(type, fn); } catch (e) { /* no-op */ }
    }
    job.listeners = [];
    if (job.previewUrl) {
      try { URL.revokeObjectURL(job.previewUrl); } catch (e) { /* no-op */ }
    }
    job.previewUrl = "";
  }

  function cleanup(promptId) {
    const job = jobs.get(promptId);
    if (!job) return;
    detachJob(job);
    jobs.delete(promptId);
    if (activePromptId === promptId) activePromptId = null;
  }

  function listen(job, type, fn) {
    const a = api();
    if (!a || typeof a.addEventListener !== "function") return;
    /* Native api wraps listeners to guard errors; removing with the SAME
       function reference works because ComfyApi.addEventListener maps it. */
    a.addEventListener(type, fn);
    job.listeners.push([type, fn]);
  }

  function begin(promptId, nodeId, prompt) {
    /* Defensive: a previous job with the same id (shouldn't happen) — clear. */
    if (jobs.has(promptId)) cleanup(promptId);
    /* Map execution node id -> friendly title so the text row can show the
       SAME name ComfyUI's queue overlay shows (_meta.title ?? class_type).
       Total node count is the number of nodes in the submitted prompt. */
    const nodeTitles = Object.fromEntries(
      Object.entries(prompt || {}).map(([id, n]) => [
        String(id), n?._meta?.title || n?.class_type || String(id),
      ])
    );
    const job = {
      nodeId, node: null, listeners: [], previewUrl: null, lastTs: 0,
      nodeTitles, totalNodes: Object.keys(prompt || {}).length, executedSet: new Set(),
      startedAt: Date.now(),
      /* Source canvas for the "current canvas" queue filter. */
      docId: activeDoc()?.id || "",
      endedAt: 0,
    };
    jobs.set(promptId, job);
    activePromptId = promptId;
    writeNode(job, {
      genPhase: "queued", genPhaseText: phaseText("queued"), genProgress: 0,
      genTotalProgress: 0, genCurrentNodeProgress: 0, genCurrentNodeName: "",
    });
    persist();

    listen(job, "execution_start", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      /* Point the "active job" cursor at the job that ACTUALLY started, not
         merely the last one submitted. begin() sets activePromptId at submit
         time, so with several queued nodes it stays on the newest (still
         waiting) job. Bare b_preview has no id and falls back to this cursor,
         which made a running job's preview land on a waiting node. Switching
         here routes those id-less events to the right job. Only the preview /
         progress_text fallbacks read this cursor — genPhase/genProgress and
         queue semantics are untouched. */
      activePromptId = promptId;
      writeNode(job, { genPhase: "running", genPhaseText: phaseText("running") });
    });
    /* If execution_start arrived before we attached the listener above (the
       /prompt response lost the race), the recorder has it — catch up now so
       a fast-starting job never stays stuck at "等待中". This mirrors exactly
       what the listener above would have written; nothing else is touched. */
    if (hasStarted(promptId)) {
      writeNode(job, { genPhase: "running", genPhaseText: phaseText("running") });
    }

    listen(job, "progress", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      const max = Number(d.max) || 0;
      const value = Number(d.value) || 0;
      const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
      const nodeName = job.nodeTitles[String(d.node)] || String(d.node || "");
      writeNode(job, {
        genPhase: "sampling",
        genPhaseText: phaseText("sampling"),
        genProgress: pct,
        genCurrentNodeProgress: pct,
        genCurrentNodeName: nodeName,
        genStep: value,
        genSteps: max,
      });
    });

    /* "全部" progress mirrors ComfyUI's executionProgress: distinct nodes
       reported by `executed` over the total nodes in the submitted prompt.
       Cached nodes also count (execution_cached), same as the native store. */
    const markExecuted = (id) => {
      if (id == null) return;
      job.executedSet.add(String(id));
      const total = job.totalNodes || 0;
      writeNode(job, {
        genTotalProgress: total > 0
          ? Math.min(1, job.executedSet.size / total) : 0,
      });
    };
    listen(job, "executed", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      markExecuted(d.node);
    });
    listen(job, "execution_cached", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      for (const id of d.nodes || []) markExecuted(id);
    });

    /* progress_text carries a localised/explicit stage string from custom
       nodes that call send_progress_text (e.g. "VAE 解码/第 2 阶段"). */
    listen(job, "progress_text", (e) => {
      const d = e?.detail;
      if (!d) return;
      /* New backend includes prompt_id in metadata; old one doesn't — accept
         only when it matches, or when there's no id and this is the active job. */
      if (d.prompt_id && d.prompt_id !== promptId) return;
      if (!d.prompt_id && promptId !== activePromptId) return;
      if (d.text) writeNode(job, { genPhaseText: String(d.text).slice(0, 60) });
    });

    const onPreview = (blob) => {
      if (!(blob instanceof Blob)) return;
      if (promptId !== activePromptId) return; /* bare preview: active job only */
      try {
        if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
        job.previewUrl = URL.createObjectURL(blob);
        writeNode(job, { genPreviewUrl: job.previewUrl });
      } catch (e) { /* no-op */ }
    };
    /* Preferred: metadata event carries jobId === prompt_id for exact routing. */
    listen(job, "b_preview_with_metadata", (e) => {
      const d = e?.detail;
      if (!d || (d.jobId && d.jobId !== promptId)) return;
      onPreview(d.blob);
    });
    /* Fallback for backends that only emit bare b_preview. */
    listen(job, "b_preview", (e) => onPreview(e?.detail));

    listen(job, "execution_success", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      job.endedAt = Date.now();
      writeNode(job, {
        genPhase: "done", genPhaseText: phaseText("done"), genProgress: 1,
        genTotalProgress: 1, genCurrentNodeProgress: 1,
      });
    });
    listen(job, "execution_error", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      job.endedAt = Date.now();
      writeNode(job, { genPhase: "error", genPhaseText: phaseText("error") });
    });
    listen(job, "execution_interrupted", (e) => {
      const d = e?.detail;
      if (!d || d.prompt_id !== promptId) return;
      job.endedAt = Date.now();
      writeNode(job, { genPhase: "error", genPhaseText: tr("core.interrupted") });
    });

    return job;
  }

  /* ComfyUI keeps settled jobs in the queue list (history): completed, failed
     AND cancelled all stay visible as rows. When `frozenPhase` is a string
     the job is finalised IN PLACE — listeners detached, phase frozen on the
     job (node data may be reused later), endedAt stamped, and the job stays
     in `jobs` so snapshot() still emits it. With no frozenPhase it is removed
     (the legacy path); explicit removal also goes through drop(). */
  function finish(promptId, frozenPhase) {
    const job = jobs.get(promptId);
    if (!job) return;
    detachJob(job);
    if (activePromptId === promptId) activePromptId = null;
    if (!frozenPhase) {
      jobs.delete(promptId);
    } else {
      /* Cancelled jobs have genPhase="" on the node (cleared by cancel), so
         callers pass the explicit terminal phase ("cancelled"/"error"/"done"). */
      job.settledPhase = frozenPhase;
      job.endedAt = job.endedAt || Date.now();
    }
    NS.flow?.updateNodeData?.(job.nodeId, {
      genPreviewUrl: "",
      genPreviewing: false,
    });
    notify();
    persist();
  }

  /* Explicitly remove a job row (used only by 清理队列 for queued jobs). */
  function drop(promptId) {
    const job = jobs.get(promptId);
    if (!job) return;
    cleanup(promptId);
    notify();
    persist();
  }

  /* Mark a promptId as cancelled so the running poll loop bails immediately
     (no false "core.generationFailed" toast). cancelledJobs is declared just below; the
     method body only runs after module init, so the TDZ is not an issue. */
  function cancelPrompt(promptId) {
    if (promptId) { try { cancelledJobs.add(promptId); } catch (e) { /* no-op */ } }
  }

  /* Native queueStore.clear(['history']): drop only settled rows (done /
     error / cancelled). queued + running jobs are live work and stay. */
  function clearHistory() {
    let removed = 0;
    for (const [promptId, job] of jobs) {
      const phase = job.settledPhase || "";
      if (phase === "done" || phase === "error" || phase === "cancelled") {
        jobs.delete(promptId);
        removed++;
      }
    }
    if (removed) { persist(); notify(); }
    return removed;
  }

  /* Serialise just the job metadata + compact display snapshot to the
     per-user prefs mirror. Blob previews / WS listeners are session-only. */
  function persist() {
    const data = {};
    for (const [promptId, job] of jobs) {
      data[promptId] = {
        nodeId: job.nodeId,
        docId: job.docId || "",
        settledPhase: job.settledPhase || "",
        startedAt: job.startedAt || 0,
        endedAt: job.endedAt || 0,
        snapshot: job.snap || null,
      };
    }
    storageWrite(JOBS_KEY, data);
  }

  /* Rebuild the job map after init() has awaited prefs.ready(). Nodes are
     re-resolved by id on every snapshot() call, so restoring needs no flow
     access here. */
  function restore() {
    let data;
    try { data = storageRead(JOBS_KEY) || {}; } catch (e) { return; }
    const unsettled = [];
    for (const [promptId, meta] of Object.entries(data)) {
      if (!meta || !meta.nodeId) continue;
      jobs.set(promptId, {
        nodeId: meta.nodeId, node: null, listeners: [], previewUrl: null, lastTs: 0,
        nodeTitles: {}, totalNodes: 0, executedSet: new Set(),
        startedAt: meta.startedAt || 0, docId: meta.docId || "",
        endedAt: meta.endedAt || 0, settledPhase: meta.settledPhase || "",
        snap: meta.snapshot || null, restored: true,
      });
      if (!meta.settledPhase) unsettled.push(promptId);
    }
    if (jobs.size) notify();
    /* A refresh tears down this session's WS listeners, so a job persisted as
       queued/running can no longer track live progress. Reconcile each such
       row against the backend ONCE: freeze a real outcome (done/error), or —
       if the backend has no record (refresh interrupted it, or it was cleared)
       — mark it cancelled. The row always stays visible, like native history;
       no stuck "core.generatingStatus" zombie rows survive a refresh. */
    for (const promptId of unsettled) {
      Promise.resolve()
        .then(() => backend.history(promptId))
        .then((data) => {
          const entry = data?.[promptId];
          if (entry?.status?.status_str === "error") { finish(promptId, "error"); return; }
          if (entry?.outputs && Object.keys(entry.outputs).length) {
            const assets = extractOutputs(entry.outputs);
            if (assets.length) {
              const job = jobs.get(promptId);
              if (job) NS.flow?.updateNodeData?.(job.nodeId, { result: assets[0] });
            }
            finish(promptId, "done");
            return;
          }
          finish(promptId, "cancelled");
        })
        .catch(() => { try { finish(promptId, "cancelled"); } catch (e) { /* no-op */ } });
    }
  }

  return { begin, finish, drop, snapshot, subscribe, cancelPrompt, persist, restore, clearHistory, bindEarlyStart };
})();
NS.genProgress = genProgress;

/* promptIds the user has cancelled. pollHistory is told to bail out as soon
   as its id lands here, so cancelling a QUEUED job never waits for the full
   500ms polling loop (and never surfaces a false "core.generationFailed" toast). */
const cancelledJobs = new Set();

NS.generate = {
  async cancel(nodeId) {
    const node = (flow()?.nodesOf?.() || []).find((entry) => entry.id === nodeId);
    /* updateNodeData swaps the node's data object on every progress event,
       so the genPromptId written at queue time (on the captured `data`) can be
       gone from node.data by the time the user clicks 取消. The genProgress
       job map is authoritative and keyed by nodeId — prefer its live job. */
    const live = (genProgress.snapshot() || []).find((j) =>
      j.nodeId === nodeId && (j.phase === "queued" || j.phase === "running" || j.phase === "sampling")
    );
    const promptId = live?.promptId || node?.data?.genPromptId;
    /* Immediate visible feedback — a cancel click must never be silent, even
       if the backend call later hangs (that produced "no reaction at all"). */
    toast("info", tr("core.cancellingJob"));

    /* Reset the node UI SYNCHRONOUSLY, before any awaited network call.
       A hung interrupt() must never leave the node stuck in "running" with a
       dead cancel button — earlier the reset sat after `await`, so a stalled
       request made the whole click look like it did nothing. */
    NS.flow?.updateNodeData?.(nodeId, {
      status: "idle", error: "", genPromptId: "",
      genPhase: "", genPhaseText: "", genProgress: 0,
      genTotalProgress: 0, genCurrentNodeProgress: 0, genCurrentNodeName: "",
      genPreviewUrl: "",
    });
    markDirty();

    if (!promptId) { toast("warning", tr("core.noCancellableTask")); return; }
    cancelledJobs.add(promptId);
    /* Settle the row as cancelled immediately so it stays visible with the
       cancelled state, without waiting for the poll loop's finally path. */
    try { genProgress.finish(promptId, "cancelled"); } catch (e) { /* no-op */ }
    NS.flow?.history?.absorb?.();
    NS.ui?.refreshPanels?.();

    /* Fire BOTH native primitives, non-blocking and error-swallowed:
       /interrupt stops a running execution, cancelJob drops a queued prompt.
       We can't fully trust the node's phase after data swaps, so cover both.
       A 3s cap guarantees a hung fetch can never stall the UI again. */
    const api = API();
    const safe = (fn) => {
      try { return Promise.resolve(fn()).catch(() => {}); } catch (e) { return null; }
    };
    const calls = [];
    if (typeof api?.interrupt === "function") calls.push(safe(() => api.interrupt(promptId)));
    if (typeof api?.cancelJob === "function") calls.push(safe(() => api.cancelJob(promptId)));
    if (!calls.length) toast("error", tr("core.failedCancel"), "no cancel primitive");
    await Promise.race([
      Promise.allSettled(calls.filter(Boolean)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  },

  async run(nodeId, opts = {}) {
    /* silent: group runs suppress the per-node toasts and report one summary
       instead, so a whole group queueing at once does not spam notifications. */
    const silent = !!opts.silent;
    const note = silent ? () => {} : (...args) => toast(...args);
    const node = (flow()?.nodesOf?.() || []).find((entry) => entry.id === nodeId);
    if (!node) return;
    const data = node.data;
    if (data.status === "running") { note("info", tr("core.nodeGenerating")); return; }
    /* Neither state reaches the queue — independent of how the run was
       triggered. muted = DISABLED (no output); ignored = BYPASS (its input
       is forwarded downstream instead of generating anything here). */
    if (data.muted) {
      note("info", tr("core.nodeMutedDisabled"), tr("core.notRunNoOutput"));
      return;
    }
    if (data.ignored) {
      note("info", tr("core.nodeBypassedPassThrough"), tr("core.passthroughHint"));
      return;
    }
    const kind = data.kind;
    const templateName = data.workflow || kind;
    let template;
    try { template = await backend.workflow(templateName); }
    catch (error) { note("error", tr("core.failedReadWorkflowTemplate"), String(error)); return; }
    if (template?._requires_config) {
      note("warning", tr("core.configureWorkflowTemplateFirst"), template.hint || `workflows/${templateName}.json`);
      return;
    }
    /* collectInputs walks edges by NODE id, so it needs the node, not its
       data object (data has no id — passing it silently yielded zero
       wired inputs, so {{image}}/{{text}}/{{audio}} were always empty). */
    const inputs = collectInputs(node);
    /* Every exposed multiline box must have content: a wired slot's effective value
       comes from the wire, not the typed text, so validation must read effectiveTextData
       (as buildPrompt does), or "wired but empty" is wrongly rejected. */
    const effective = effectiveTextData(data, inputs, kind);
    const missingTexts = missingRequiredTexts(effective, tr);
    if (missingTexts.length) {
      note("warning", tr("core.pleaseFillAllTextInputs"), missingTexts.map((label) => tr("core.punctQuoteOpen") + label + tr("core.punctQuoteClose")).join(tr("core.punctListSep")));
      return;
    }
    let prompt;
    try { prompt = await buildPrompt(kind, template, data, inputs, collectLoras(node)); }
    catch (error) { note("error", tr("core.failedBuildWorkflow"), String(error)); return; }
    /* Cleanup pills wired upstream run BEFORE generation: submit their jobs to
       the native queue first (FIFO → memory reclaimed, then generation runs),
       and flash each pill so the pass-through is visible. Failure is non-fatal. */
    try {
      for (const pill of collectUpstreamCleanups(node)) {
        for (const el of document.querySelectorAll(".vue-flow__node")) {
          if (el.getAttribute("data-id") !== String(pill.id)) continue;
          const bar = el.querySelector(".icn--cleanup");
          if (bar) {
            bar.classList.add("is-cleaning");
            setTimeout(() => bar.classList.remove("is-cleaning"), 900);
          }
        }
        await NS.canvasMonitor?.runCleanup?.(pill.data?.cleanupMode || "vram");
      }
    } catch (error) { note("warning", tr("core.cleanupFailed"), String(error)); }
    data.status = "running";
    data.error = "";
    /* Show 等待中... from the moment we flip to running — even before
       queuePrompt() returns and genProgress.begin() writes genPhase. */
    data.genPhase = "queued";
    data.genPhaseText = tr("core.queuedStatus");
    markDirty();
    /* Arm the long-lived execution_start recorder BEFORE submitting, so a
       start that arrives before queuePrompt() resolves is not missed. */
    genProgress.bindEarlyStart();
    /* A status flip is runtime state, not an edit: keep it out of undo. */
    NS.flow?.history?.absorb?.();
    let promptId = null;
    try {
      const queued = await API().queuePrompt(0, { output: prompt, workflow: {} });
      if (!queued?.prompt_id) throw new Error(window.InfCanvas.i18n.t("core.submitFailedNoPromptId"));
      promptId = queued.prompt_id;
      /* Persist the id on the node so the left-hand 取消 button can cancel
         THIS job (queued or running) via native api.cancelJob(promptId). */
      data.genPromptId = promptId;
      /* Subscribe to native WS progress events and mirror them onto this
         node, routed strictly by prompt_id (see genProgress above). */
      genProgress.begin(promptId, nodeId, prompt);
      /* Comfy.WidgetControlMode defaults to "after": the seed advances once the
         prompt is queued, so this run keeps the value it was submitted with. */
      NS.fieldControl.applyAfterQueue(node);
      const outputs = await pollHistory(promptId, () => cancelledJobs.has(promptId));
      if (cancelledJobs.has(promptId)) return;
      if (!outputs.length) throw new Error(window.InfCanvas.i18n.t("core.doneNoOutput"));
      attachResults(node, outputs);
      data.status = "done";
    } catch (error) {
      if (promptId && cancelledJobs.has(promptId)) {
        /* cancel() already reset the node to idle — swallow the abort and
           the backend's cancelled error so no false 「生成失败」 toast. */
      } else {
        data.status = "error";
        data.error = String(error);
        note("error", tr("core.generationFailed"), String(error));
      }
    } finally {
      /* ComfyUI keeps every settled job visible in the queue list. Freeze the
         terminal phase on the job so it stays a history row (completed /
         failed / cancelled) instead of vanishing. The WS listeners already
         wrote genPhase=done or error on the node; a cancelled run carries the
         cancelledJobs marker. */
      if (promptId) {
        let terminal = "done";
        if (cancelledJobs.has(promptId)) terminal = "cancelled";
        else if (data.status === "error" || data.genPhase === "error") terminal = "error";
        genProgress.finish(promptId, terminal);
        cancelledJobs.delete(promptId);
        data.genPromptId = "";
      }
    }
    markDirty();
    NS.flow?.history?.absorb?.();
    NS.ui?.refreshPanels();
  },
};

  return {
    extractOutputs,
    CANCEL_SENTINEL,
    pollHistory,
    attachResults,
    nextControlledValue,
    genProgress,
    cancelledJobs
  };
}
