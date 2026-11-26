/* Canvas lifecycle + keyboard (batch 7): enter/exit, native ComfyUI-style
   key commands and init(). Extracted from infcanvas-core.js. All cross-cutting
   helpers (state/flow/storage/dnd/genProgress via NS) are injected. The
   init() ordering -- await prefs.ready, genProgress.restore BEFORE controls
   subscribe -- is preserved verbatim. */
export function createKeys({ NS, tr, backend, toast, confirmDialog, suppressPreexistingDialogs, state, TABS_KEY, META_KEY, storageRead, flow, absorbReason, absorbFiles, collectFiles, rememberPointer, setGraphClipboard, onCopy, onPaste, loraFromTransfer, hasLoraInTransfer, appendLoraToNode, onDrop, readDraft, writeDraft, persistTabs, createDoc, saveActive, markDirty, switchDoc, baseName, genProgress, syncDocFromFlow, importCanvasFile, refreshNodeDefinitions, runSelected, interruptSelected, toggleNodeFlag }) {
/* --------------------------- enter / exit ---------------------------- */

function ensureSurface(stage) {
  const host = flow().init(stage);
  /* The host element survives exit/re-enter (the Vue app stays mounted), so
     the DOM listeners may only be attached once. */
  if (host.dataset.wired === "1") return host;
  host.dataset.wired = "1";
  host.addEventListener("dragover", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  host.addEventListener("drop", (event) => {
    event.preventDefault(); event.stopPropagation();
    onDrop(event);
  });
  /* A file dropped ON a node never creates a second node: it flips that
     generator into a material node (or is refused with a reason). Vue Flow
     puts the node id on the wrapper, so the hit test needs no DOM markers of
     our own. Capture phase, so the host's "drop -> new node" handler below
     never sees it. */
  const mediaTarget = (event) => {
    const wrapper = event.target?.closest?.(".vue-flow__node");
    const id = wrapper?.dataset?.id;
    if (!id) return null;
    const node = (flow()?.nodesOf?.() || []).find((entry) => String(entry.id) === String(id));
    return node?.data?.role === "media" ? node : null;
  };
  document.addEventListener("dragover", (event) => {
    if (!state.active) return;
    const target = mediaTarget(event);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    const effect = absorbReason(target) ? "none" : "copy";
    try { if (event.dataTransfer) event.dataTransfer.dropEffect = effect; } catch (error) { /* ignore */ }
  }, true);
  document.addEventListener("drop", (event) => {
    if (!state.active) return;
    const target = mediaTarget(event);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    const reason = absorbReason(target);
    if (reason) { toast("warning", tr("core.cannotDropAsset"), reason); return; }
    /* Asset payloads dragged out of a node's own tool dialog arrive as JSON,
       not as a File -- flip the node straight to that asset. */
    const custom = event.dataTransfer?.getData("application/x-infcanvas-asset");
    if (custom) {
      try {
        const asset = JSON.parse(custom);
        NS.flow?.updateNodeData?.(target.id, { asset });
        markDirty();
        NS.ui?.refreshPanels?.();
      } catch (error) { toast("error", tr("core.failedParseAsset"), String(error)); }
      return;
    }
    absorbFiles(target, collectFiles(event.dataTransfer));
  }, true);
  /* A LoRA card dropped ON a LoRA stack appends it. Separate capture pair so
     the media-node path above stays untouched; Vue Flow puts the node id on
     the wrapper, so no DOM markers are needed. */
  const loraTarget = (event) => {
    const wrapper = event.target?.closest?.(".vue-flow__node");
    const id = wrapper?.dataset?.id;
    if (!id) return null;
    const node = (flow()?.nodesOf?.() || []).find((entry) => String(entry.id) === String(id));
    return node?.data?.role === "lora" ? node : null;
  };
  document.addEventListener("dragover", (event) => {
    if (!state.active || !hasLoraInTransfer(event.dataTransfer)) return;
    if (!loraTarget(event)) return;
    event.preventDefault(); event.stopPropagation();
    try { if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; } catch (error) { /* ignore */ }
  }, true);
  document.addEventListener("drop", (event) => {
    if (!state.active) return;
    const target = loraTarget(event);
    if (!target) return;
    const lora = loraFromTransfer(event.dataTransfer);
    if (!lora) return;
    event.preventDefault(); event.stopPropagation();
    appendLoraToNode(target, lora);
  }, true);
  /* Double-clicking empty canvas opens the canvas's own node list at the
     pointer. Vue Flow gives us screen->flow conversion, so the new node lands
     exactly under the cursor -- same contract as LiteGraph's
     node.pos = convertEventToCanvasOffset(event). */
  host.addEventListener("dblclick", (event) => {
    if (!state.active) return;
    if (NS.tools?.isOpen?.()) return;
    /* LiteGraph's processMouseDown returns early when read_only is set
       (LGraphCanvas.ts:2843), so a double click in hand mode never opens the
       node menu in ComfyUI either. */
    if (NS.flow?.state?.mode?.value === "drag") return;
    if (event.target.closest?.(".vue-flow__node")) return;
    /* Groups and the multi-select toolbox are real controls on the canvas:
       double-clicking a group title renames it, and the toolbox buttons
       must never open the add-node menu underneath them. */
    if (event.target.closest?.(".ic-group, .ic-group-ui, .ic-group-tools, .ic-selection-tools")) return;
    const point = flow().screenToFlow(event.clientX, event.clientY);
    /* The group backdrop is pointer-events:none, so a double-click in the
       empty space INSIDE a group reaches the pane, not `.ic-group-ui`.
       Hit-test the actual group rectangle in graph units before opening the
       add-node menu; group titles still rename via their own handler above. */
    const inGroup = (flow()?.state?.groups?.value || []).some((group) =>
      Number.isFinite(group.x) && Number.isFinite(group.y) &&
      Number.isFinite(group.w) && Number.isFinite(group.h) &&
      point.x >= group.x && point.x <= group.x + group.w &&
      point.y >= group.y && point.y <= group.y + group.h);
    if (inGroup) return;
    NS.ui?.showAddNodeMenu?.({
      clientX: event.clientX, clientY: event.clientY,
      world: [point.x, point.y],
    });
    event.stopPropagation();
  }, true);
  return host;
}

async function enter() {
  if (state.exiting) return;
  if (state.active) { NS.ui?.renderTabs(); return; }
  if (!flow()) {
    toast("error", tr("core.canvasEngineNotReady"), tr("core.refreshRetry"));
    return;
  }
  NS.ui?.injectStyles();
  const shell = NS.ui?.mountShell();
  if (!shell) { toast("error", tr("core.failedCreateCanvasUi"), tr("core.refreshRetry")); return; }
  ensureSurface(shell.stage);
  try { NS.controls?.mount?.(shell.stage); }
  catch (error) { console.error("[InfCanvas] mountControls failed", error); }
  try { NS.ui?.mountTabs(); }
  catch (error) { console.error("[InfCanvas] mountTabs failed", error); }
  state.active = true;
  suppressPreexistingDialogs(true);
  document.documentElement.classList.add("infcanvas-mode");
  if (!state.docs.length) {
    /* Rebuild every open tab from persisted state. Saved canvases come from
       disk (fresh), unsaved ones from their per-user prefs draft. Both carry
       their original id so drafts/metas stay attached. */
    const tabs = storageRead(TABS_KEY);
    if (tabs && Array.isArray(tabs.ids) && tabs.ids.length) {
      for (const id of tabs.ids) {
        const meta = storageRead(META_KEY(id));
        let data = readDraft(id);
        let name = meta?.name || "";
        let saved = !!meta?.saved;
        if (saved && name) {
          try {
            const response = await backend.canvas(name);
            if (response.exists) data = response.data;
            else { /* file gone: fall back to draft if we have one */
              if (!data) continue;
              saved = false;
            }
          } catch (error) { if (!data) continue; }
        }
        if (!data) continue;
        const doc = createDoc(name || null, data, id);
        doc.saved = saved;
        doc.dirty = !saved;
        state.docs.push(doc);
      }
    }
    if (!state.docs.length) {
      const doc = createDoc();
      state.docs.push(doc);
      writeDraft(doc);
    }
    const wanted = tabs && Number.isInteger(tabs.activeIndex)
      ? Math.min(Math.max(tabs.activeIndex, 0), state.docs.length - 1) : 0;
    state.activeId = state.docs[wanted]?.id || state.docs[0].id;
  }
  switchDoc(state.activeId || state.docs[0].id);
}

async function exit() {
  if (state.exiting) return;
  if (!state.active) {
    document.documentElement.classList.remove("infcanvas-mode");
    suppressPreexistingDialogs(false);
    NS.ui?.unmountShell();
    flow()?.unmount?.();
    return;
  }
  state.exiting = true;
  try {
    /* Leaving the canvas serialises every open doc; flush an in-progress text
       edit first, otherwise the typed text dies with the closed editor. */
    NS.flushTextEdit?.();
    for (const doc of Array.from(state.docs)) {
      if (doc.dirty) {
        const choice = await confirmDialog({
          title: tr("core.saveChanges"),
          message: tr("core.canvasHasUnsavedChanges", { name: doc.name || baseName() }),
          hint: tr("core.saveSaveReturnDonT"),
          threeWay: true,
        });
        if (choice === null) return;
        if (choice === true && !(await saveActive(false, doc))) return;
      }
      syncDocFromFlow(doc);
      writeDraft(doc);
    }
    persistTabs();
    state.active = false;
    try { flow()?.pauseAll?.(); } catch (error) { /* optional */ }
    document.documentElement.classList.remove("infcanvas-mode");
    suppressPreexistingDialogs(false);
    NS.ui?.removeTabs();
    try { NS.controls?.unmount?.(); } catch (error) { /* optional */ }
    NS.ui?.unmountShell();
    flow()?.unmount?.();
  } finally {
    state.exiting = false;
  }
}

/* ------------------------------- init -------------------------------- */

/* ComfyUI keeps its own dialogs mounted after closing them (the template
   browser stays in the DOM with data-state="open" while visibility:hidden),
   so a bare querySelector would swallow every canvas shortcut. Only a dialog
   that is actually on screen may own the keyboard. */
function hostDialogOpen() {
  const dialogs = document.querySelectorAll('[data-reka-dialog-content][data-state="open"]');
  for (const dialog of dialogs) {
    const style = getComputedStyle(dialog);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const box = dialog.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return true;
  }
  return false;
}

/* Ctrl+Enter typed inside a generator's own parameter box runs THAT node,
   even when nothing is selected. Everything else typed in a field stays
   local to the field (Delete/Ctrl+S/Ctrl+Z/... must not touch the graph).
   Excludes the node-name capsule and search fields: those are not prompt
   / parameter inputs. */
function generatorNodeForInput(event) {
  const el = event.target;
  if (!(el instanceof Element)) return null;
  if (!el.closest("input, textarea, [contenteditable='true'], [contenteditable='']")) return null;
  if (el.closest(".icn__name--edit, .icn__sel-searchinput, .icn__lora-searchinput")) return null;
  const wrapper = el.closest(".vue-flow__node");
  const id = wrapper?.dataset?.id;
  if (!id) return null;
  const node = (flow()?.nodesOf?.() || []).find((entry) => String(entry.id) === String(id));
  const data = node?.data;
  if (!data || (data.role !== "media" && data.role !== "text") || data.asset) return null;
  return node;
}

function onKeyDown(event) {
  if (!state.active) return;
  /* Our own tool modals own the keyboard while open (Delete/Ctrl+S/etc.
     must not mutate the graph behind them). */
  if (NS.tools?.isOpen?.()) return;
  if (hostDialogOpen()) return;
  const key = String(event.key || "").toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  const fieldNode = (mod && key === "enter" && !event.altKey && !event.shiftKey
    && !event.isComposing) ? generatorNodeForInput(event) : null;
  if (!fieldNode && event.target instanceof Element
    && event.target.closest("input, textarea, select, [contenteditable]")) return;
  if (mod && event.shiftKey && key === "i") {
    event.preventDefault(); event.stopImmediatePropagation();
    exit();
    return;
  }
  if (mod && key === "s") {
    event.preventDefault(); event.stopImmediatePropagation();
    saveActive(false);
    return;
  }
  /* Ctrl+Z undo / Ctrl+Y (or Ctrl+Shift+Z) redo — ComfyUI's ChangeTracker
     bindings. Hand mode is the read-only canvas, so it blocks both. */
  if (mod && (key === "z" || key === "y")) {
    if (NS.flow?.state?.mode?.value === "drag") return;
    const redo = key === "y" || event.shiftKey;
    event.preventDefault(); event.stopImmediatePropagation();
    if (redo) flow()?.history?.redo?.();
    else flow()?.history?.undo?.();
    return;
  }
  if ((key === "delete" || key === "backspace") && !mod) {
    /* Hand mode is ComfyUI's read_only canvas: it blocks every mutation. */
    if (NS.flow?.state?.mode?.value === "drag") return;
    const selected = flow()?.selectedNodes?.() || [];
    /* Groups share the selection with nodes: Delete removes both, while a
       group's member nodes stay exactly where they are (ComfyUI's
       selected-LGraphGroup behaviour). */
    const groupIds = (flow()?.state?.selectedGroupIds?.value || []).slice();
    if (selected.length || groupIds.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (selected.length) flow().removeNodes(selected.map((node) => node.id));
      if (groupIds.length) flow()?.state?.groupActions?.deleteGroups?.(groupIds);
      markDirty();
      return;
    }
    /* No node or group selected: a highlighted link is what Delete removes. */
    const edges = NS.flow?.state?.flow?.getSelectedEdges?.value || [];
    if (edges.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      flow().removeEdges(edges.map((edge) => edge.id));
    }
    return;
  }
  /* Ctrl+G groups the current selection, like ComfyUI's group command.
     At least two nodes are required; a single node is not a selection. */
  /* Ctrl+V itself is left to the native paste event. The in-memory graph
     fallback is armed by menu Copy (setGraphClipboard), not by the keypress. */
  if (mod && key === "v" && !event.shiftKey) return;
  if (mod && key === "g" && !event.shiftKey) {
    const selected = flow()?.selectedNodes?.() || [];
    if (selected.length >= 2) {
      event.preventDefault(); event.stopImmediatePropagation();
      flow()?.state?.groupActions?.createGroup?.();
    }
    return;
  }
  if (mod && key === "a") {
    const nodes = flow()?.nodesOf?.() || [];
    if (nodes.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      flow().selectNodes(nodes.map((node) => node.id));
    }
  }
  /* ComfyUI-style canvas commands. Hand mode is read-only — block them. */
  if (NS.flow?.state?.mode?.value === "drag") return;
  /* R (bare) — refresh node definitions. */
  if (!mod && !event.altKey && key === "r") {
    event.preventDefault(); event.stopImmediatePropagation();
    refreshNodeDefinitions();
    return;
  }
  if (!mod) return;
  /* Ctrl+Alt+Enter must precede Ctrl+Enter (the latter has no alt guard). */
  if (key === "enter") {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.altKey) { interruptSelected(); return; }
    /* Capture phase fires BEFORE the field's own keydown/change handlers:
       blur() commits a just-typed value synchronously, so the workflow runs
       with what the user typed instead of the previous stored value. */
    if (fieldNode && event.target instanceof HTMLElement
      && typeof event.target.blur === "function") event.target.blur();
    runSelected(fieldNode ? [fieldNode] : undefined);
    return;
  }
  if (event.altKey || event.shiftKey) return;
  if (key === "m") {
    event.preventDefault(); event.stopImmediatePropagation();
    toggleNodeFlag("muted");
    return;
  }
  if (key === "b") {
    event.preventDefault(); event.stopImmediatePropagation();
    toggleNodeFlag("ignored");
    return;
  }
  if (key === "o") {
    event.preventDefault(); event.stopImmediatePropagation();
    importCanvasFile();
    return;
  }
}

function onKeyBubble(event) {
  if (!state.active) return;
  const target = event.target;
  if (target instanceof Element && target.closest(
    '[role="dialog"], [data-reka-dialog-content], [data-reka-portal], [data-toast-dock], .z-overlay, .z-toast')) return;
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
  event.stopPropagation();
}

async function init(app) {
  if (NS.ready) return;
  NS.app = app;
  /* All canvas parameters now live in user/<account>/Cat-Nodes/prefs.json.
     Wait for the one-time load so the first panel mount sees real values
     instead of defaults. */
  await NS.prefs?.ready?.();
  /* Restore canvas job history BEFORE the controls subscribe, so the badge
     and queue overlay show last session's rows immediately. */
  try { genProgress.restore(); } catch (e) { /* no-op */ }
  NS.ui?.injectStyles();
  if (flow()) {
    flow().state.onDirty = () => markDirty();
    // The toolbar used to be refreshed by LiteGraph's per-frame draw loop;
    // now the viewport event is the only thing that changes the zoom label.
    flow().onViewport = () => NS.controls?.tick?.();
  }
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keydown", onKeyBubble, false);
  document.addEventListener("keyup", onKeyBubble, false);
  /* System clipboard copy/paste. Capture phase so our graph payload wins
     over Vue Flow / ComfyUI's own text handling. */
  document.addEventListener("copy", onCopy, true);
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("pointermove", rememberPointer, true);
  document.addEventListener("pointerdown", rememberPointer, true);
  NS.ready = true;
  // core.js may load before infcanvas-flow.js; wire the dirty hook once both exist.
  if (!NS.flow) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (NS.flow) {
        NS.flow.state.onDirty = () => markDirty();
        NS.flow.onViewport = () => NS.controls?.tick?.();
        clearInterval(timer);
      } else if (tries > 100) clearInterval(timer);
    }, 50);
  }
}

  return { ensureSurface, enter, exit, hostDialogOpen, onKeyDown, onKeyBubble, init };
}
