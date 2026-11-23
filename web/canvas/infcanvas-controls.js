/* Bottom-right canvas controls: floating toolbar + minimap panel.

   Mirrors comfyui_frontend 1.59.1:
     src/components/graph/GraphCanvasMenu.vue        -> toolbar (mode selector,
       divider, fit view, zoom %, divider, minimap toggle, link visibility)
     .../CanvasModeSelector.vue                      -> select / hand popover
     .../modals/ZoomControlsModal.vue                -> zoom popup (in / out /
       fit + percentage field, press-and-hold repeats every 100ms)
     .../MiniMap.vue + MiniMapPanel.vue              -> 253x200 minimap, header
       rule, settings / close buttons, viewport outline, drag + wheel navigation
     useMinimapViewport.ts / useMinimapInteraction.ts / minimapCanvasRenderer.ts
     boundsCalculator.ts                             -> drawing + hit geometry
     design-system/button.variants.ts                 -> button class strings

   Zero CSS is copied: every surface, radius, colour and spacing comes from the
   host stylesheet (floating-panel, z-1200, size-8, bg-accent, icon-[lucide--*])
   and from :root custom properties, so light/dark themes follow ComfyUI. Only
   the number field and the "pressed" background need local rules, because the
   host renders those through Vue components. */
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
  const api = () => NS.api;

  /* Button.vue renders cn(buttonVariants({ variant: 'secondary', size: 'md' }),
     customClass). cn() is tailwind-merge: it DROPS the utilities the call site
     overrides. The strings below are therefore the final class lists ComfyUI
     itself renders (read off the live DOM of frontend 1.59.1), not a
     concatenation of base + override -- concatenating keeps both `rounded-md`
     and `rounded-lg`, both `p-2` and `p-0`, and Tailwind's stylesheet order
     decides the winner (.rounded-md is emitted after .rounded-lg, .p-2 after
     .p-0), which made the mode trigger 70px wide with 8px padding instead of
     the native 54px with none. */
  const BTN_BASE =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
    "items-center justify-center gap-2 border-none font-inter " +
    "text-sm font-medium whitespace-nowrap transition-colors " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 " +
    "[&_svg:not([width]):not([height])]:size-4";
  /* size md ('h-8 rounded-lg p-2 text-xs') with the overrides already merged. */
  const BTN_ICON =
    BTN_BASE + " text-foreground hover:bg-accent rounded-lg text-xs size-8 " +
    "bg-transparent p-0";
  const BTN_ZOOM =
    BTN_BASE + " text-foreground rounded-lg text-xs h-8 w-15 bg-transparent " +
    "p-0 hover:bg-accent";
  /* CanvasModeSelector.vue: rounded-none! + hover:rounded-lg! so the trigger
     stays flush with the panel edge until hovered. */
  const BTN_MODE = BTN_BASE +
    " text-foreground h-8 rounded-lg text-xs group rounded-none! " +
    "bg-transparent p-0 transition-none! hover:rounded-lg! hover:bg-accent!";
  /* variant 'muted-textonly' + size 'icon' (MiniMap.vue's header buttons). */
  const BTN_MUTED_ICON =
    BTN_BASE + " bg-transparent text-muted-foreground hover:bg-accent " +
    "size-8 rounded-lg";
  /* GraphCanvasMenu.vue marks an engaged toggle with not-active:bg-muted
     ("muted while not pressed"); the rule is already in the host CSS. */
  const THEME_ON = "not-active:bg-muted";
  /* GraphCanvas.vue insets #graph-canvas-panel by ml/mr/mb
     var(--comfy-canvas-gutter) (= calc(.25rem * 2) = 8px), and everything that
     anchors to the canvas edge -- GraphCanvasMenu (bottom-0), MiniMap
     (bottom-[54px]), ZoomControlsModal (bottom-[62px]) -- is positioned
     against that inset panel, i.e. 8px inside the visible canvas. */
  const GUTTER = "var(--comfy-canvas-gutter, 8px)";

  const MINIMAP_WIDTH = 253;
  const MINIMAP_HEIGHT = 200;
  const ZOOM_STEP = 1.1;
  /* Must stay in sync with MIN_ZOOM / MAX_ZOOM in js/infcanvas-flow.js: the
     toolbar clamps here, Vue Flow's d3-zoom clamps there. 10 = 1000%, which is
     also the aria-valuemax of the percentage field and ComfyUI's own limit. */
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10;
  const PREF_VISIBLE = "InfCanvas.MinimapVisible";
  const PREF_LINKS_HIDDEN = "InfCanvas.LinkHidden";
  const PREF_SNAP = "InfCanvas.SnapToGrid";
  /* Native Comfy.Queue.ShowRunProgressBar (hidden setting, default true) —
     toggled by the "core.showRunProgressBar" checkbox in JobHistoryActionsMenu. */
  const PREF_RUN_PROGRESS = "InfCanvas.ShowRunProgressBar";
  function runProgressEnabled() {
    const v = readPref(PREF_RUN_PROGRESS);
    return v === null ? true : !!v;
  }

  const ui = {
    stage: null,
    wrap: null,
    bar: null,
    modeBtn: null,
    modeIcon: null,
    zoomBtn: null,
    zoomLabel: null,
    mapBtn: null,
    snapBtn: null,
    snapOn: false,
    linksBtn: null,
    zoomPop: null,
    modePop: null,
    minimap: null,
    repeat: 0,
    scaleText: "",
    readOnlyIcon: null,
    linksHidden: null,
    linksReady: false,
    fieldEditing: false,
    /* Active-task badge (top-right): canvas-owned generation jobs. */
    taskBadge: null,
    taskCount: null,
    taskDot: null,
    taskInterrupt: null,
    taskList: null,
    taskListBody: null,
    taskTabs: null,
    taskTab: "all",
    taskUnsub: null,
    taskListSig: "",
    /* Queue filter/sort state (native useJobList defaults). */
    taskScope: "all",       // "all" | "current" canvas
    taskSort: "mostRecent", // "mostRecent" | "totalGenerationTime"
    taskMenu: null,         // open radio / more-options menu (one at a time)
    taskListSide: false,    // job list currently rendered in sidebar tab
    /* Native QueueProgressOverlay active card (QueueOverlayActive.vue). */
    runProgress: null,
    runProgressTotalFill: null,
    runProgressNodeFill: null,
    runProgressTotalPct: null,
    runProgressNodeName: null,
    runProgressNodePct: null,
    runProgressRunning: null,
    runProgressQueued: null,
    runProgressInterrupt: null,
    runProgressClear: null,
    clearDlg: null,          // native QueueClearHistoryDialog reimplementation
  };

  /* ------------------------------- helpers -------------------------------- */

  function el(tag, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  function icon(name, extra) {
    const glyph = el("i", "icon-[lucide--" + name + "] " + (extra || "size-4"));
    glyph.setAttribute("aria-hidden", "true");
    return glyph;
  }

  function ext() {
    return (window.comfyAPI?.app?.app || NS.app)?.extensionManager;
  }

  /* Open OUR OWN asset sidebar (the canvas gallery panel), not ComfyUI's
     native assets tab. NS.ui.togglePanel('gallery') mirrors the rail button. */
  function openAssetsSidebar() {
    try { NS.ui?.togglePanel?.("gallery"); } catch (error) { /* no-op */ }
  }

  function setting(key, fallback) {
    try {
      const value = ext()?.setting?.get(key);
      return value === undefined || value === null ? fallback : value;
    } catch (error) { return fallback; }
  }

  /* Toolbar/view flags live in the per-user Cat-Nodes/prefs.json file. */
  function readPref(key) {
    return NS.prefs ? NS.prefs.get(key, null) : null;
  }

  function writePref(key, value) {
    NS.prefs?.set(key, value);
  }

  /* The canvas engine is Vue Flow. Everything below reads the flow viewport
     instead of LiteGraph's ds (offset/scale). */
  function flowApi() { return NS.flow || null; }
  function zoom() { return flowApi()?.getViewport?.().zoom || 1; }
  function hasNodes() { return (flowApi()?.nodesOf?.() || []).length > 0; }

  /* comfyui_frontend formats key sequences with
     useCommandStore().formatKeySequence(commandStore.getCommand(id)).toUpperCase().
     The extension API only exposes commandStore.execute (no getCommand, no
     formatKeySequence), so the bindings cannot be formatted at runtime. The
     strings below are what this build (frontend 1.59.1) actually renders: read
     from the native zoom popover rows ("Alt + =", "Alt + -", "."), the native
     canvas-mode menu ("V", "H") and the native toolbar aria-labels
     ("适应视图 (.)", "隐藏小地图 (ALT + SHIFT + M)"). A user rebinding these
     shortcuts in ComfyUI's settings will not be reflected here. */
  const SHORTCUTS = {
    "Comfy.Canvas.FitView": ".",
    "Comfy.Canvas.ZoomIn": "Alt + =",
    "Comfy.Canvas.ZoomOut": "Alt + -",
    "Comfy.Canvas.Unlock": "V",
    "Comfy.Canvas.Lock": "H",
    "Comfy.Canvas.ToggleMinimap": "Alt + Shift + M",
    /* Local mnemonics for the two toggles ComfyUI leaves unbound; the keydown
       handler registers them alongside the native bindings (see onShortcut). */
    "InfCanvas.SnapToGrid": "S",
    "InfCanvas.ToggleLinks": "L",
  };

  function shortcutText(id) {
    const known = SHORTCUTS[id];
    if (known) return known;
    /* Older/newer builds may expose the store method after all. */
    try {
      const store = ext()?.command;
      const format = store?.formatKeySequence;
      const command = store?.getCommand?.(id);
      if (typeof format === "function" && command) {
        return format(command) || "";
      }
    } catch (error) { /* optional */ }
    return "";
  }

  /* ------------------------------ toolbar --------------------------------- */

  /* GraphCanvasMenu.vue hands every button :style="stringifiedMinimapStyles
     .buttonStyles", i.e. { borderRadius: '8px', border: 'none' } lifted from
     the minimap container. It is inline, so it is the radius the toolbar
     actually ends up with; only the mode trigger overrides it (rounded-none! is
     !important and beats inline). Reproducing that inline pair keeps the radius
     correct no matter how Tailwind ordered its radius utilities. */
  function styledButton(className) {
    const button = el("button", className);
    button.type = "button";
    button.style.borderRadius = "8px";
    button.style.border = "none";
    return button;
  }

  function iconButton(iconName, label) {
    const button = styledButton(BTN_ICON);
    bindTip(button, () => label);
    button.setAttribute("aria-label", label);
    button.appendChild(icon(iconName));
    return button;
  }

  function divider() {
    return el("div", "h-[27px] w-px self-center bg-border");
  }

  /* ---------------------- active-task badge (top-right) ------------------
     Canvas counterpart of ComfyUI's actionbar "X + N active jobs" capsule.
     Mirrors QueueProgressOverlay semantics but counts ONLY canvas-owned jobs
     (NS.genProgress.snapshot()), per the canvas-scope decision. The X interrupts
     the running job; the capsule opens a lightweight task list.
     All surfaces use host classes/tokens; no local palette. */
  function closeTaskList() {
    closeTaskMenu();
    ui.taskListSide = false;
    if (!ui.taskList) return;
    ui.taskList.remove();
    ui.taskList = null;
    ui.taskListBody = null;
    ui.taskTabs = null;
    ui.taskListSig = "";
    /* The collapsed QueueProgressOverlay card and the expanded list are two
       states of the same native overlay — closing the list reveals the card. */
    syncRunProgressBar();
  }

  /* Native button variant/size constants for the queue overlay, read verbatim
     from design-system/button.variants.ts (see native-button.txt in tmp/):
       secondary      = bg-secondary text-foreground hover:bg-accent
       muted-textonly = bg-transparent text-muted-foreground hover:bg-accent
       destructive    = bg-destructive text-foreground hover:bg-destructive/90
       size icon      = size-8 rounded-lg
       size md        = h-8 rounded-lg p-2 text-xs
     JobFilterTabs.vue passes plain size="md" — NO extra px-3. Only the queue
     toggle in ComfyActionbar.vue overrides with class px-3. Using px-3 here
     made both tabs 8px wider than native. */
  const BTN_VARIANT_MUTED_TEXT =
    "bg-transparent text-muted-foreground hover:bg-accent";
  const BTN_SIZE_MD_TAB = "h-8 rounded-lg p-2 text-xs";

  /* AssetsListItem.vue task row: h-12 wrapper, inside a flex items-center
     gap-2 rounded-lg p-2 hover:bg-accent; a size-8 rounded-sm bg-secondary
     thumbnail (image or state icon) + a min-w-0 flex-1 flex-col gap-1 text-xs
     leading-none text column (primary foreground / secondary muted). */
  function assetThumb(job) {
    const thumb = el("div",
      "relative z-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary");
    /* Native buildJobDisplay(): only a COMPLETED job carries iconImageUrl (the
       settled result thumbnail). Running/queued/failed rows always show the
       state glyph — a live WS preview blob is not a generated thumbnail. */
    const previewUrl = job.phase === "done" ? job.previewUrl : "";
    if (previewUrl) {
      const img = el("img", "pointer-events-none size-full object-cover");
      img.src = previewUrl;
      img.alt = job.title || "";
      thumb.appendChild(img);
    } else {
      const glyph = el("i",
        "icon-[lucide--" + assetIconFor(job) + "] size-4 text-muted-foreground pointer-events-none" +
        (job.phase === "queued" ? " animate-spin" : ""));
      glyph.setAttribute("aria-hidden", "true");
      thumb.appendChild(glyph);
    }
    return thumb;
  }

  /* Native job tabs: "All" shows every job; "Completed" shows settled
     (completed + failed, and cancelled which ComfyUI maps to failed). */
  const isSettled = (j) => j.phase === "done" || j.phase === "error" || j.phase === "cancelled";

  function assetIconFor(job) {
    /* ComfyUI queueDisplay.ts iconForJobState(): pending=loader-circle(spinner),
       running=zap, completed=check-check, failed (incl. cancelled)=alert-circle. */
    if (job.phase === "error" || job.phase === "cancelled") return "alert-circle";
    if (job.phase === "done") return "check-check";
    if (job.phase === "running" || job.phase === "sampling") return "zap";
    return "loader-circle";
  }

  /* Open the SAME MediaLightbox the 资产 grid uses, fed by the queue overlay's
     completed jobs. Native viewItem: only completed jobs with a preview output
     are openable; the sibling list backs prev/next in the user-visible order. */
  function jobToFile(job) {
    const asset = job.resultAsset || {};
    const url = job.previewUrl || asset.url || "";
    return {
      /* Stable id so the lightbox's sameFile() locates THIS job even when two
         tasks produced the same filename (it prefers id over source/path). */
      id: job.promptId,
      source: "canvas-job",
      path: job.promptId,
      url,
      preview_url: url,
      filename: asset.filename || asset.name || job.title || "",
      subfolder: asset.subfolder || "",
      type: asset.type || "output",
      kind: asset.kind || (job.kind === "video" ? "video" : "image"),
      size: asset.size || 0,
      mtime: asset.mtime || 0,
      /* Task results are real files under ComfyUI's output root, but their
         preview URL is a plain /view? link with no signed gallery token. The
         asset lightbox reads generation metadata via /xcat/gallery/prompt,
         which needs source + path (+ the Comfy-User header). Give the lightbox
         a real source/path so it can look up the SAME file the asset panel
         would, instead of reporting "生成信息读取失败". */
      metaSource: "output",
      metaPath: (() => {
        let user = "";
        try { user = String(window.comfyAPI?.api?.api?.user || ""); } catch (e) { /* no-op */ }
        const sub = String(asset.subfolder || "");
        const name = asset.filename || asset.name || "";
        const rel = sub ? sub.replace(/\//g, "/") + "/" + name : name;
        /* Multi-user output files live under output/<user>/...; the prompt
           route resolves with the request's own user id. Avoid doubling it. */
        if (user && rel && rel !== user && !rel.startsWith(user + "/")) {
          return user + "/" + rel;
        }
        return rel;
      })(),
    };
  }
  function canView(job) {
    return job.phase === "done" && !!(job.previewUrl || job.resultAsset?.url);
  }
  function viewJob(job) {
    if (!canView(job)) return;
    /* Build the nav list from the current (filtered/sorted) overlay view so
       prev/next step through exactly what the user sees, like native. */
    const all = NS.genProgress?.snapshot?.() || [];
    const view = applyTaskView(ui.taskTab === "done"
      ? all.filter(isSettled) : all);
    const files = view.filter(canView).map(jobToFile);
    const file = jobToFile(job);
    NS.galleryPanel?.openLightbox?.(file, files, { hideDelete: true });
  }

  /* lucide bookmark: NOT in the host prebuilt glyph sheet (flow.js draws it
     locally too), so the body-mounted menu needs an inline SVG, not a class. */
  function bookmarkGlyph() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "size-4");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function addJobToFavorites(job) {
    const file = jobToFile(job);
    if (!file.url) { NS.api?.toast?.("warning", t("media.nothingAdd")); return; }
    const kind = file.kind === "video" || file.kind === "audio" ? file.kind : "image";
    Promise.resolve(NS.api?.addToFavorites?.(file, {
      url: file.url, kind, name: file.filename || t("wire.asset"),
    })).then(() => {
      NS.api?.toast?.("success", t("media.addedAssetsFavorites", { count: 1 }));
    }).catch((error) => {
      NS.api?.toast?.("error", t("media.couldNotAddFavorites"), String(error?.message || error));
    });
  }

  /* ComfyUI useJobMenu.ts completed-row action: turn a job's output into a
     canvas asset node, then hand it to the SAME live placement used by every
     manual creation (node follows pointer, left click drops, right click /
     Esc cancels). Grip is the node's geometric centre for this entry. */
  function addJobToCanvas(job, event) {
    const file = jobToFile(job);
    if (!file.url) { NS.api?.toast?.("warning", t("core.nothingDownload")); return; }
    const kind = file.kind === "video" || file.kind === "audio" ? file.kind : "image";
    const type = NS.TYPE_BY_KIND?.[kind];
    if (!type) return;
    const asset = {
      name: file.filename || t("wire.asset"),
      filename: file.filename || "",
      subfolder: file.subfolder || "",
      type: file.type || "output",
      kind,
      url: file.url,
      preview_url: file.preview_url,
      size: file.size || 0,
      mtime: file.mtime || 0,
      path: file.path || "",
    };
    /* Start under the pointer that picked the menu item (screen -> graph),
       falling back to the canvas' last pointer when invoked by keyboard. */
    let pt = null;
    if (Number.isFinite(event?.clientX) && event.clientX > 0) {
      pt = NS.flow?.screenToFlow?.(event.clientX, event.clientY);
    }
    if (!pt || !Number.isFinite(pt.x)) pt = NS.api?.pastePoint?.();
    const point = pt && Number.isFinite(pt.x) ? { x: pt.x, y: pt.y } : { x: 200, y: 200 };
    const node = NS.api?.addNodeByType?.(type, [point.x, point.y], asset, asset.name);
    if (!node) return;
    NS.ui?.refreshPanels?.();
    NS.flow?.state?.placementActions?.beginNodePlacement?.([node.id], point, true);
  }

  /* Native JobAssetsList.vue row ellipsis (Button secondary/icon) opens the
     point menu from useJobMenu.ts. Its first three completed-job entries are
     inspect / add-to-current / download, with these exact lucide/comfy glyphs. */
  function toggleJobMenu(anchor, job) {
    const wasOpen = ui.taskMenu?.dataset?.kind === "job" &&
      ui.taskMenu?.dataset?.promptId === (job.promptId || "");
    closeTaskMenu();
    if (wasOpen) return;

    const itemCls =
      "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md " +
      "border-0 bg-transparent px-3 py-1.5 text-left text-sm whitespace-nowrap " +
      "text-foreground outline-none hover:bg-accent focus-visible:bg-accent";
    const menu = el("div",
      "ic-taskmenu fixed w-auto min-w-48 max-w-full select-none overflow-y-auto " +
      "rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-testid", "job-menu");
    menu.dataset.kind = "job";
    menu.dataset.promptId = job.promptId || "";
    const entries = [
      { label: t("image.inspectAsset"), glyph: "icon-[lucide--zoom-in]",
        run: () => viewJob(job) },
      { label: t("image.addCurrentCanvas"), glyph: "icon-[comfy--node]",
        run: (e) => addJobToCanvas(job, e) },
      { label: t("media.addFavorites"), glyph: bookmarkGlyph,
        run: () => addJobToFavorites(job) },
    ];
    for (const entry of entries) {
      const item = el("button", itemCls);
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-testid", "job-menu-item");
      const glyph = typeof entry.glyph === "function"
        ? entry.glyph()
        : el("i", entry.glyph + " size-4");
      glyph.setAttribute("aria-hidden", "true");
      const label = el("span", "min-w-0 flex-1");
      label.textContent = entry.label;
      item.append(glyph, label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTaskMenu();
        entry.run(e);
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    const aRect = anchor.getBoundingClientRect();
    const gutter = 8;
    let left = aRect.right - menu.offsetWidth;
    left = Math.max(gutter, Math.min(left, window.innerWidth - menu.offsetWidth - gutter));
    menu.style.left = left + "px";
    menu.style.top = (aRect.bottom + 4) + "px";
    ui.taskMenu = menu;

    const onDown = (event) => {
      if (!menu.isConnected) { closeTaskMenu(); return; }
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeTaskMenu();
    };
    const onKey = (event) => { if (event.key === "Escape") closeTaskMenu(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    ui.taskMenuOff = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }

  function taskRow(job) {
    const wrapper = el("div", "px-3");
    const holder = el("div", "h-12");
    /* Native JobAssetsList.vue: the action slot is guarded by
       `v-if="hoveredJobId === row.job.id"` and hoveredJobId flips on the
       h-12 holder's @mouseenter/@mouseleave — actions appear only while the
       row is hovered, never persistently. */
    let actions = null;
    const row = el("div",
      "relative flex size-full shrink-0 cursor-default select-none items-center gap-2 overflow-hidden rounded-lg p-2 text-foreground transition-colors hover:bg-accent" +
      (job.phase === "running" || job.phase === "sampling" ? " bg-secondary" : ""));

    row.appendChild(assetThumb(job));

    const mid = el("div",
      "relative z-1 flex min-w-0 flex-1 flex-col gap-1 text-xs leading-none");
    /* Native queueDisplay.ts buildJobDisplay() rows:
       pending    → "In queue"  / queued time
       running    → "Running"   / ""        (thumbnail only after completion)
       completed  → preview filename / execution seconds
       failed     → "Failed"    / "Failed"  (cancelled maps to failed) */
    const running = job.phase === "running" || job.phase === "sampling";
    let primaryText, secondaryText;
    if (job.phase === "queued") {
      primaryText = t("core.queuedStatus");
      secondaryText = "";
    } else if (running) {
      primaryText = t("core.runningNow");
      secondaryText = "";
    } else if (job.phase === "done") {
      primaryText = job.title || t("core.generationTask");
      secondaryText = job.endedAt && job.startedAt
        ? ((job.endedAt - job.startedAt) / 1000).toFixed(2) + "s" : "";
    } else {
      primaryText = t("core.failed");
      secondaryText = t("core.failed");
    }
    /* Native AssetsListItem.vue guards BOTH text rows with v-if — an empty
       secondary is not rendered at all, so a single-line row stays vertically
       centered against the 32px thumb. Always emitting an empty meta div adds
       a 4px flex gap and pushes "core.runningNow" off-centre. */
    const title = el("div", "min-w-0 text-foreground");
    const titleSpan = el("span", "block truncate");
    titleSpan.textContent = primaryText;
    title.appendChild(titleSpan);
    mid.appendChild(title);
    if (secondaryText) {
      const meta = el("div", "min-w-0 text-muted-foreground");
      const metaSpan = el("span", "block truncate");
      metaSpan.textContent = secondaryText;
      meta.appendChild(metaSpan);
      mid.appendChild(meta);
    }
    row.appendChild(mid);

    /* Native shows hover actions; cancel (destructive X) for active jobs. */
    actions = el("div", "relative z-1 hidden shrink-0 items-center gap-2");
    const cancelable = job.phase === "queued" || job.phase === "running" ||
      job.phase === "sampling";
    if (cancelable) {
      const cancel = el("button",
        BTN_BASE + " " + BTN_VARIANT_DESTRUCTIVE + " " + BTN_SIZE_ICON);
      cancel.type = "button";
      cancel.appendChild(icon("x", "size-4"));
      bindTip(cancel, () => t("core.cancelJob"));
      cancel.addEventListener("click", (e) => {
        e.stopPropagation();
        cancelCanvasJob(job);
      });
      actions.appendChild(cancel);
    } else if (job.phase === "error" || job.phase === "cancelled") {
      /* ComfyUI isFailedDeletable(): failed/cancelled rows get a destructive
         trash button to remove the row (result assets are left untouched). */
      const del = el("button",
        BTN_BASE + " " + BTN_VARIANT_DESTRUCTIVE + " " + BTN_SIZE_ICON);
      del.type = "button";
      del.appendChild(icon("trash-2", "size-4"));
      bindTip(del, () => t("core.deleteJob"));
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (job.promptId) { try { NS.genProgress?.drop?.(job.promptId); } catch (err) { /* no-op */ } }
      });
      actions.appendChild(del);
    } else if (canView(job)) {
      /* Native completed jobs get a textonly size-sm "View" button that opens
         MediaLightbox (JobAssetsList.vue → emitCompletedViewItem). */
      const view = el("button",
        BTN_BASE + " " + BTN_VARIANT_TEXTONLY + " " + BTN_SIZE_SM);
      view.type = "button";
      view.textContent = t("shortcuts.group.view");
      view.addEventListener("click", (e) => { e.stopPropagation(); viewJob(job); });
      actions.appendChild(view);
      /* Native completed row: textonly "View" followed by secondary/icon
         ellipsis (JobAssetsList.vue → useJobMenu.ts). */
      const more = el("button",
        BTN_BASE + " " + BTN_VARIANT_SECONDARY + " " + BTN_SIZE_ICON);
      more.type = "button";
      more.setAttribute("data-testid", "job-row-more");
      more.appendChild(icon("ellipsis", "size-4"));
      bindTip(more, () => t("image.more"));
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleJobMenu(more, job);
      });
      actions.appendChild(more);
    }
    /* Native JobAssetsList @dblclick="emitViewItem" opens the lightbox for
       previewable completed jobs. */
    if (canView(job)) {
      row.addEventListener("dblclick", (e) => { e.stopPropagation(); viewJob(job); });
    }
    row.appendChild(actions);
    holder.appendChild(row);
    /* Toggle the action slot on hover (native hoveredJobId guard). Skip rows
       with no actions so hovering doesn't create an empty flex gap. */
    if (actions.childElementCount) {
      const showActions = () => { actions.className = "relative z-1 flex shrink-0 items-center gap-2"; };
      const hideActions = () => { actions.className = "relative z-1 hidden shrink-0 items-center gap-2"; };
      holder.addEventListener("mouseenter", showActions);
      holder.addEventListener("mouseleave", hideActions);
    } else {
      actions.remove();
    }
    wrapper.appendChild(holder);
    return wrapper;
  }

  /* Native queue actions. The canvas job list is only the LIVE jobs mirrored
     from WS progress; the authoritative cancel/clear endpoints live on the
     ComfyUI api. Cancel by promptId (POST /jobs/{id}/cancel) is the native
     primitive — going through generate.cancel(nodeId) worked only while the
     node still carried genPromptId, which is cleared the moment a job settles. */
  function rawApi() {
    return window.comfyAPI?.api?.api || NS.api?.raw || null;
  }
  /* Drop a job from genProgress so the badge/overlay list actually removes it.
     The list is built from genProgress.snapshot() (a jobs Map); updateNodeData
     alone only edits node data and NEVER removes the row. finish() is the only
     path that does jobs.delete(promptId) + notify(). Without this, "api.cancel"
     calls the API successfully but the task row stays visible forever. */
  function dropCanvasJob(job) {
    if (!job) return;
    if (job.promptId) {
      /* Explicit REMOVE from the list. Completed/failed/cancelled jobs are
         normally kept as history rows; only an explicit cancel/clear drops
         them. cancelPrompt bails the poll loop so its finally cannot re-add. */
      try { NS.genProgress?.drop?.(job.promptId); } catch (e) { /* no-op */ }
      NS.genProgress?.cancelPrompt?.(job.promptId);
    }
    if (job.nodeId) {
      NS.flow?.updateNodeData?.(job.nodeId, {
        status: "idle", error: "", genPromptId: "",
        genPhase: "", genPhaseText: "", genProgress: 0,
        genTotalProgress: 0, genCurrentNodeProgress: 0, genCurrentNodeName: "",
        genPreviewUrl: "",
      });
    }
  }

  async function cancelCanvasJob(job) {
    if (!job) return;
    const api = rawApi();
    /* Native (ComfyUI api-reference + QueueProgressOverlay): a queued job is
       cancelled via cancelJob(promptId); a RUNNING job is interrupted via
       interrupt(promptId) (POST /interrupt, the state-agnostic primitive that
       works on every runtime). Use interrupt for running/sampling so cancel
       never depends on the newer /jobs/{id}/cancel endpoint parity. */
    const isRunning = job.phase === "running" || job.phase === "sampling";
    try {
      if (isRunning && typeof api?.interrupt === "function") {
        await api.interrupt(job.promptId);
      } else if (job.promptId && typeof api?.cancelJob === "function") {
        await api.cancelJob(job.promptId);
      } else if (job.promptId && typeof api?.interrupt === "function") {
        await api.interrupt(job.promptId);
      } else {
        NS.generate?.cancel?.(job.nodeId);
      }
    } catch (error) {
      /* Endpoint may not exist / job already gone — fall back to interrupt. */
      try { if (job.promptId && typeof api?.interrupt === "function") await api.interrupt(job.promptId); }
      catch (e2) { NS.generate?.cancel?.(job.nodeId); }
    }
    dropCanvasJob(job);
    markDirtySafe();
    NS.ui?.refreshPanels?.();
  }
  function markDirtySafe() {
    try { NS.api?.markDirty?.(); } catch (error) { /* no-op */ }
  }
  /* Native QueueProgressOverlay.cancelQueuedWorkflows ->
     Comfy.ClearPendingTasks -> useQueueStore().clear(['queue']) -> POST
     /queue {clear:true}. This clears ONLY pending (queued) tasks; a running
     job keeps executing. Never fall back to interrupt(null) here — that would
     kill the running job, the exact opposite of "clear queue". */
  async function clearPendingQueue(tasks) {
    /* Guard at the call site too: only queued rows may be dropped. The button
       is disabled when queuedCount===0, but keep the scope explicit so any
       other caller cannot wipe a running job by accident. */
    const queued = (tasks || []).filter((j) => j.phase === "queued");
    if (!queued.length) return;
    const api = rawApi();
    try {
      if (typeof api?.clearItems === "function") await api.clearItems("queue");
    } catch (error) { /* best effort */ }
    /* Only queued rows disappear from genProgress (the overlay list source);
       a running job's row and node progress stay untouched. Mark each queued
       prompt cancelled so its poll loop bails without a false "core.generationFailed" toast. */
    for (const job of queued) {
      if (job.promptId) {
        try { NS.genProgress?.cancelPrompt?.(job.promptId); } catch (e) { /* no-op */ }
        try { NS.genProgress?.drop?.(job.promptId); } catch (e) { /* no-op */ }
      }
      if (job.nodeId) {
        NS.flow?.updateNodeData?.(job.nodeId, {
          status: "idle", error: "", genPromptId: "",
          genPhase: "", genPhaseText: "", genProgress: 0,
          genTotalProgress: 0, genCurrentNodeProgress: 0, genCurrentNodeName: "",
          genPreviewUrl: "",
        });
      }
    }
    markDirtySafe();
    NS.ui?.refreshPanels?.();
    NS.api?.toast?.("info", t("core.queueCleared"));
  }

  /* QueueOverlayHeader.vue: h-12 flex items-center gap-2 border-b px-2,
     title (min-w-0 flex-1 px-2 text-[14px] font-normal), then an inline-flex
     h-6 gap-2 text-[12px] group holding the "core.clearQueue" label + destructive
     list-x Button, then the muted-textonly ellipsis. Native truth (1.59.6):
     queuedCount = pendingTasks.length; when 0 the label gets `opacity-50` and
     the Button is :disabled. BTN_BASE already carries disabled:pointer-events-none
     disabled:opacity-50, so setting .disabled is enough to match natively. */
  function buildQueueHeader(tasks, side) {
    const head = el("div", "flex h-12 items-center gap-2 border-b px-2");
    const title = el("div", "min-w-0 flex-1 px-2 text-[14px] font-normal");
    const titleSpan = el("span");
    /* Native JobHistorySidebarTab gets its title from SidebarTabTemplate
       (the drawer header = 作业历史), so don't repeat it inside the panel. */
    titleSpan.textContent = side ? "" : t("core.taskQueue");
    title.appendChild(titleSpan);

    const queuedCount = tasks.filter((j) => j.phase === "queued").length;
    const clearWrap = el("div", "inline-flex h-6 items-center gap-2 text-[12px] leading-none");
    const clearLabel = el("span", queuedCount === 0 ? "opacity-50" : "");
    clearLabel.textContent = t("core.clearQueue");
    const clearBtn = el("button",
      BTN_BASE + " " + BTN_VARIANT_DESTRUCTIVE + " " + BTN_SIZE_ICON);
    clearBtn.type = "button";
    clearBtn.disabled = queuedCount === 0;
    clearBtn.setAttribute("aria-label", t("core.clearQueue"));
    clearBtn.appendChild(icon("list-x", "size-4"));
    bindTip(clearBtn, () => t("core.cancelAllRunningJobs"), "bottom");
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearPendingQueue(tasks.filter((j) => j.phase === "queued"));
    });
    clearWrap.append(clearLabel, clearBtn);

    const more = el("button", BTN_MUTED_ICON);
    more.type = "button";
    more.appendChild(icon("more-horizontal", "size-4"));
    bindTip(more, () => t("core.moreOptions"), "bottom");
    more.addEventListener("click", (e) => { e.stopPropagation(); toggleMoreMenu(more); });

    head.append(title, clearWrap, more);
    return head;
  }

  /* JobFiltersBar.vue: flex items-center justify-between gap-2 px-3. Left =
     JobFilterTabs (inline-flex gap-1): All (secondary) + Completed (muted).
     Right = three secondary size-icon buttons: list-filter, arrow-up-down,
     comfy--image-ai-edit, each with a tooltip. */
  function buildQueueFilters(tasks, side) {
    const bar = el("div", "flex items-center justify-between gap-2 px-3");
    const tabs = el("div", "inline-flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap");
    const mkTab = (label, selected) => {
      const b = el("button", BTN_BASE + " " +
        (selected ? BTN_VARIANT_SECONDARY : BTN_VARIANT_MUTED_TEXT) + " " + BTN_SIZE_MD_TAB);
      b.type = "button";
      b.textContent = label;
      return b;
    };
    const allTab = mkTab(t("core.all"), true);
    const doneTab = mkTab(t("core.completed"), false);
    const selectTab = (which) => {
      ui.taskTab = which;
      const shown = which === "done"
        ? tasks.filter(isSettled) : tasks;
      renderQueueList(shown);
    };
    allTab.addEventListener("click", (e) => { e.stopPropagation(); selectTab("all"); });
    doneTab.addEventListener("click", (e) => { e.stopPropagation(); selectTab("done"); });
    ui.taskTabs = { all: allTab, done: doneTab, tasks };
    tabs.append(allTab, doneTab);

    const actions = el("div", "flex shrink-0 items-center gap-2");
    /* Native Button :indicator shows a `bg-foreground` dot at -top-1 -right-1
       whenever the menu's value is non-default (JobFilterActions.vue). */
    const mkAction = (iconCls, label, onClick, indicator) => {
      const b = el("button", BTN_BASE + " " + BTN_VARIANT_SECONDARY + " " + BTN_SIZE_ICON);
      b.type = "button";
      const glyph = el("i", iconCls + " size-4");
      glyph.setAttribute("aria-hidden", "true");
      b.appendChild(glyph);
      if (indicator) {
        const dot = el("span",
          "pointer-events-none absolute -top-1 -right-1 size-2 rounded-full bg-foreground");
        dot.setAttribute("aria-hidden", "true");
        b.appendChild(dot);
      }
      bindTip(b, () => t(label), "bottom");
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(b); });
      return b;
    };
    actions.append(
      mkAction("icon-[lucide--list-filter]", "core.filter",
        (b) => toggleTaskMenu(b, "scope"), ui.taskScope !== "all"),
      mkAction("icon-[lucide--arrow-up-down]", "core.sort",
        (b) => toggleTaskMenu(b, "sort"), ui.taskSort !== "mostRecent")
    );
    /* Native JobHistorySidebarTab: :hide-show-assets-action="true". */
    if (!side) {
      actions.appendChild(mkAction("icon-[comfy--image-ai-edit]", "core.showAssets", () => openAssetsSidebar()));
    }
    bar.append(tabs, actions);
    return bar;
  }

  /* Native useJobList.ts: filter scope (all/current workflow) + sort mode
     (mostRecent by createTime desc, totalGenerationTime by executionTime desc).
     Canvas mapping: "workflow" -> canvas document (job.docId), createTime ->
     startedAt, executionTime -> durationMs. */
  function currentDocId() {
    try {
      return NS.api?.activeGraph?.()?.id || NS.api?.activeDoc?.()?.id || "";
    } catch (error) { return ""; }
  }
  function applyTaskView(tasks) {
    let out = (tasks || []).slice();
    if (ui.taskScope === "current") {
      const id = currentDocId();
      out = out.filter((j) => !!id && j.docId === id);
    }
    if (ui.taskSort === "totalGenerationTime") {
      out.sort((a, b) => (Number(b.durationMs) || 0) - (Number(a.durationMs) || 0));
    } else {
      out.sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
    }
    return out;
  }

  /* Close just the queue radio menu (never touches the persistent overlay or
     the toolbar closePops()). */
  function closeTaskMenu() {
    if (ui.taskMenu) {
      ui.taskMenu.remove();
      ui.taskMenu = null;
    }
    if (ui.taskMenuOff) { ui.taskMenuOff(); ui.taskMenuOff = null; }
  }

  /* JobFilterTabs.vue's sibling radio menus (MenuRadioGroup + MenuRadioItem +
     MenuItemContent). Native item: min-h-8 rounded-md px-3 py-1.5 text-sm,
     checked trailing `icon-[lucide--check] size-4 ml-auto` (invisible when not
     checked, data-testid=menu-item-indicator). Popover content: min-w-39
     rounded-lg border bg-background p-1 shadow-lg. */
  function toggleTaskMenu(anchor, kind) {
    const wasOpen = ui.taskMenu?.dataset?.kind === kind;
    closeTaskMenu();
    if (wasOpen) return;

    const options = kind === "scope"
      ? [
          { value: "all", label: t("core.allCanvases"), active: ui.taskScope === "all" },
          { value: "current", label: t("core.currentCanvas"), active: ui.taskScope === "current" },
        ]
      : [
          { value: "mostRecent", label: t("core.mostRecent"), active: ui.taskSort === "mostRecent" },
          { value: "totalGenerationTime", label: t("core.generationTimeSlowest"), active: ui.taskSort === "totalGenerationTime" },
        ];

    const menu = el("div",
      "ic-taskmenu fixed w-auto min-w-39 max-w-full select-none overflow-y-auto " +
      "rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none");
    menu.setAttribute("role", "menu");
    menu.dataset.kind = kind;
    for (const opt of options) {
      const item = el("button",
        "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md " +
        "border-0 bg-transparent px-3 py-1.5 text-left text-sm whitespace-nowrap " +
        "text-foreground outline-none hover:bg-accent focus-visible:bg-accent");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", opt.active ? "true" : "false");
      const label = el("span", "min-w-0 flex-1");
      label.textContent = opt.label;
      const check = el("i",
        "icon-[lucide--check] ml-auto size-4" + (opt.active ? "" : " invisible"));
      check.setAttribute("data-testid", "menu-item-indicator");
      check.setAttribute("aria-hidden", "true");
      item.append(label, check);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (kind === "scope") ui.taskScope = opt.value;
        else ui.taskSort = opt.value;
        closeTaskMenu();
        refreshTaskList();
      });
      menu.appendChild(item);
    }

    /* Reka DropdownMenu portals to body with fixed coords, so the menu sits
       above every overlay ancestor (the task list / toast dock would otherwise
       cover it). Position with viewport coords = bottom-start of the trigger. */
    document.body.appendChild(menu);
    const aRect = anchor.getBoundingClientRect();
    /* Reka collision detection: start-align to the trigger, but shift left when
       the menu would overflow the viewport so the right edge keeps the 8px
       gutter instead of being clipped. */
    const gutter = 8;
    const maxLeft = window.innerWidth - menu.offsetWidth - gutter;
    menu.style.left = Math.max(gutter, Math.min(aRect.left, maxLeft)) + "px";
    menu.style.top = (aRect.bottom + 4) + "px";
    ui.taskMenu = menu;

    /* Outside pointerdown closes only the menu, not the persistent overlay. */
    const onDown = (event) => {
      if (!menu.isConnected) { closeTaskMenu(); return; }
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeTaskMenu();
    };
    const onKey = (event) => { if (event.key === "Escape") closeTaskMenu(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    ui.taskMenuOff = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }

  /* Native JobHistoryActionsMenu.vue: muted-textonly more-horizontal trigger,
     Menu align=end with [docked job history (checked)] / separator / [clear
     history (destructive)]. Rendered through the same ic-taskmenu DOM as the
     radio menus so the canvas-mode hide whitelist already covers it. */
  function toggleMoreMenu(anchor) {
    const wasOpen = ui.taskMenu?.dataset?.kind === "more";
    closeTaskMenu();
    if (wasOpen) return;

    const itemCls =
      "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md " +
      "border-0 bg-transparent px-3 py-1.5 text-left text-sm whitespace-nowrap " +
      "text-foreground outline-none hover:bg-accent focus-visible:bg-accent";
    const menu = el("div",
      "ic-taskmenu fixed w-auto min-w-56 max-w-full select-none overflow-y-auto " +
      "rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none");
    menu.setAttribute("role", "menu");
    menu.dataset.kind = "more";

    const dock = el("button", itemCls);
    dock.type = "button";
    dock.setAttribute("role", "menuitemcheckbox");
    const docked = !!NS.ui?.isJobHistoryDocked?.();
    dock.setAttribute("aria-checked", docked ? "true" : "false");
    const dockIcon = el("i", "icon-[lucide--panel-left-close] size-4");
    dockIcon.setAttribute("aria-hidden", "true");
    const dockLabel = el("span", "min-w-0 flex-1");
    dockLabel.textContent = t("core.dockedJobHistory");
    const dockCheck = el("i",
      "icon-[lucide--check] ml-auto size-4" + (docked ? "" : " invisible"));
    dockCheck.setAttribute("data-testid", "menu-item-indicator");
    dockCheck.setAttribute("aria-hidden", "true");
    dock.append(dockIcon, dockLabel, dockCheck);
    dock.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTaskMenu();
      const next = !NS.ui?.isJobHistoryDocked?.();
      NS.ui?.setJobHistoryDocked?.(next);
      if (next) {
        NS.ui?.setPanel?.("job-history");
      } else {
        /* Switching back to undocked: the job list leaves the sidebar, so
           restore the floating overlay instead of letting the task view
           vanish. setJobHistoryDocked(false) already collapses the tab. */
        openTaskList(NS.genProgress?.snapshot?.() || []);
      }
    });
    menu.appendChild(dock);

    /* Native JobHistoryActionsMenu.vue second item: showRunProgressBar,
       icon-[lucide--hourglass], checked = Comfy.Queue.ShowRunProgressBar. */
    const progress = el("button", itemCls);
    progress.type = "button";
    progress.setAttribute("role", "menuitemcheckbox");
    const progOn = runProgressEnabled();
    progress.setAttribute("aria-checked", progOn ? "true" : "false");
    const progIcon = el("i", "icon-[lucide--hourglass] size-4");
    progIcon.setAttribute("aria-hidden", "true");
    const progLabel = el("span", "min-w-0 flex-1");
    progLabel.textContent = t("core.showRunProgressBar");
    const progCheck = el("i",
      "icon-[lucide--check] ml-auto size-4" + (progOn ? "" : " invisible"));
    progCheck.setAttribute("data-testid", "menu-item-indicator");
    progCheck.setAttribute("aria-hidden", "true");
    progress.append(progIcon, progLabel, progCheck);
    progress.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTaskMenu();
      writePref(PREF_RUN_PROGRESS, !runProgressEnabled());
      syncRunProgressBar();
    });
    menu.appendChild(progress);

    const sep = el("div", "my-1 h-px bg-border");
    sep.setAttribute("role", "separator");
    menu.appendChild(sep);

    const clear = el("button",
      "flex min-h-8 w-full cursor-pointer flex-col items-start gap-0.5 rounded-md " +
      "border-0 bg-transparent px-3 py-1.5 text-left text-sm text-destructive " +
      "outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10");
    clear.type = "button";
    clear.setAttribute("role", "menuitem");
    const clearTop = el("span", "flex items-center gap-2");
    const clearIcon = el("i", "icon-[lucide--trash-2] size-4");
    clearIcon.setAttribute("aria-hidden", "true");
    const clearLabel = el("span");
    clearLabel.textContent = t("core.clearTaskHistory");
    clearTop.append(clearIcon, clearLabel);
    const clearDesc = el("span", "pl-6 text-xs leading-tight text-muted-foreground");
    clearDesc.textContent = t("core.mediaAssetsWillNotDeleted");
    clear.append(clearTop, clearDesc);
    clear.addEventListener("click", (e) => { e.stopPropagation(); clearTaskHistory(); });
    menu.appendChild(clear);

    /* Reka Menu portals to body and aligns `end` to the trigger's right edge.
       Collision-shift left only when the viewport gutter would be violated. */
    document.body.appendChild(menu);
    const aRect = anchor.getBoundingClientRect();
    const gutter = 8;
    let left = aRect.right - menu.offsetWidth;
    left = Math.max(gutter, Math.min(left, window.innerWidth - menu.offsetWidth - gutter));
    menu.style.left = left + "px";
    menu.style.top = (aRect.bottom + 4) + "px";
    ui.taskMenu = menu;

    const onDown = (event) => {
      if (!menu.isConnected) { closeTaskMenu(); return; }
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeTaskMenu();
    };
    const onKey = (event) => { if (event.key === "Escape") closeTaskMenu(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    ui.taskMenuOff = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }

  /* Native QueueClearHistoryDialog.vue -> AppDialogPanel size=compact ->
     DialogPanel -> Card. The generic api().confirmDialog renders a DIFFERENT
     component (ConfirmHeader/ConfirmBody/ConfirmFooter), so it can't match the
     reference screenshot. Teleport a reimplementation to <body> under a
     whitelisted class (like .ic-taskmenu) so the host UnoCSS classes apply and
     the canvas suppress scan doesn't hide it. Returns a Promise<boolean>. */
  function showClearHistoryDialog() {
    return new Promise((resolve) => {
      closeClearHistoryDialog();
      const finish = (ok) => {
        closeClearHistoryDialog();
        resolve(!!ok);
      };

      /* DialogOverlay.vue: fixed inset-0 z-overlay bg-black/70. */
      const overlay = el("div",
        "ic-clear-dlg fixed inset-0 bg-black/70");
      overlay.setAttribute("data-testid", "clear-history-dialog-overlay");

      /* DialogContent (dialogContentVariants surface=card,size=md,maximized=false)
         + AppDialogPanel compact (w-full max-w-90) + Card (rounded-2xl border
         bg-background shadow-lg). Centered with the native top-1/2/left-1/2
         translate pattern. */
      const panel = el("div",
        "fixed top-1/2 left-1/2 max-h-[85vh] w-[calc(100vw-1rem)] max-w-90 " +
        "-translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border " +
        "border-border bg-background text-foreground shadow-lg outline-none");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("data-testid", "clear-history-dialog");
      panel.addEventListener("pointerdown", (e) => e.stopPropagation());
      panel.addEventListener("click", (e) => e.stopPropagation());

      /* CardHeader.vue: flex h-12 shrink-0 items-center justify-between gap-2
         border-b px-4, with DialogTitle (text-sm font-normal) + muted X icon. */
      const header = el("div",
        "flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4");
      const title = el("h2", "m-0 flex items-center gap-2 text-sm font-normal");
      title.textContent = t("core.clearJobQueueHistory");
      const closeBtn = el("button",
        BTN_BASE + " " + BTN_MUTED_ICON);
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", t("settings.close"));
      closeBtn.appendChild(icon("x", "size-4"));
      closeBtn.addEventListener("click", (e) => { e.stopPropagation(); finish(false); });
      header.append(title, closeBtn);

      /* AppDialogPanel bodyClass: p-4 flex flex-col gap-4 text-[14px]
         text-muted-foreground; two `<p class="m-0">` paragraphs. */
      const body = el("div",
        "flex flex-col gap-4 p-4 text-[14px] text-muted-foreground");
      const desc = el("p", "m-0");
      desc.textContent = t("core.allFinishedFailedJobsBelow");
      const note = el("p", "m-0");
      note.textContent = t("core.assetsGeneratedTheseJobsWon");
      body.append(desc, note);

      /* CardFooter.vue: flex items-center justify-end gap-4 p-4, holding
         `flex items-center gap-4 leading-none` with muted-textonly Cancel +
         secondary Clear (both size lg = h-10 rounded-lg px-4 py-2 text-sm). */
      const footer = el("div", "flex items-center justify-end gap-4 p-4");
      const actions = el("div", "flex items-center gap-4 leading-none");
      const cancelBtn = el("button",
        BTN_BASE + " bg-transparent text-muted-foreground hover:bg-accent h-10 rounded-lg px-4 py-2 text-sm");
      cancelBtn.type = "button";
      cancelBtn.textContent = t("api.cancel");
      cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); finish(false); });
      const clearBtn = el("button",
        BTN_BASE + " " + BTN_VARIANT_SECONDARY + " h-10 rounded-lg px-4 py-2 text-sm");
      clearBtn.type = "button";
      clearBtn.textContent = t("core.clear");
      clearBtn.addEventListener("click", (e) => { e.stopPropagation(); finish(true); });
      actions.append(cancelBtn, clearBtn);
      footer.appendChild(actions);

      panel.append(header, body, footer);
      overlay.appendChild(panel);

      /* dismissOnPointerDownOutside: clicking the backdrop cancels. */
      overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) finish(false);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(false);
      });
      const onKey = (e) => { if (e.key === "Escape") finish(false); };
      document.addEventListener("keydown", onKey, true);

      document.body.appendChild(overlay);
      ui.clearDlg = { overlay, onKey };
      clearBtn.focus();
    });
  }

  function closeClearHistoryDialog() {
    const d = ui.clearDlg;
    if (!d) return;
    if (d.onKey) document.removeEventListener("keydown", d.onKey, true);
    d.overlay?.remove();
    ui.clearDlg = null;
  }

  async function clearTaskHistory() {
    closeTaskMenu();
    const ok = await showClearHistoryDialog();
    if (!ok) return;
    try { NS.genProgress?.clearHistory?.(); } catch (e) { /* no-op */ }
    markDirtySafe();
    NS.ui?.refreshPanels?.();
    NS.api?.toast?.("info", t("core.taskHistoryCleared"));
    refreshTaskList();
  }

  /* Re-apply scope/sort to the raw snapshot and rebuild the open overlay. */
  function refreshTaskList() {
    if (!ui.taskList) return;
    openTaskList(NS.genProgress?.snapshot?.() || [], { side: ui.taskListSide });
  }

  /* JobAssetsList.vue: h-full overflow-y-auto pb-4; each group header is
     px-3 pb-2 text-xs leading-none text-muted-foreground ("core.today" for the
     canvas's live jobs), each job row is the 48px AssetsListItem. */
  function renderQueueList(tasks) {
    const body = ui.taskListBody;
    if (!body) return;
    body.replaceChildren();
    /* Keep tab visual state in sync (may be rebuilt on progress ticks). */
    if (ui.taskTabs) {
      const sel = ui.taskTab === "done" ? ui.taskTabs.done : ui.taskTabs.all;
      const other = sel === ui.taskTabs.done ? ui.taskTabs.all : ui.taskTabs.done;
      sel.className = BTN_BASE + " " + BTN_VARIANT_SECONDARY + " " + BTN_SIZE_MD_TAB;
      other.className = BTN_BASE + " " + BTN_VARIANT_MUTED_TEXT + " " + BTN_SIZE_MD_TAB;
    }
    const day = el("div", "px-3 pb-2 text-xs leading-none text-muted-foreground");
    day.textContent = t("core.today");
    body.appendChild(day);
    if (!tasks.length) {
      const empty = el("div", "px-3 py-6 text-center text-xs text-muted-foreground");
      empty.textContent = t("core.noTasks");
      body.appendChild(empty);
    } else {
      for (const job of tasks) body.appendChild(taskRow(job));
    }
  }

  function openTaskList(rawTasks, opts) {
    closeTaskList();
    /* Filter + sort the raw snapshot before it feeds header/filters/rows. */
    const tasks = applyTaskView(rawTasks);
    /* Two mount points share this renderer: the floating queue overlay (right
       of the actionbar) and the sidebar "job-history" tab. The sidebar variant
       fills the drawer body instead of floating/positioning. */
    const side = !!(opts && opts.side);
    const sideHost = side
      ? (opts.host || document.getElementById("infcanvas-panel-body")) : null;
    /* QueueProgressOverlay.vue: pointer-events-auto flex max-h-[60vh]
       w-[350px] min-w-[310px] flex-col overflow-hidden rounded-lg border
       border-border bg-background shadow-md. */
    const pop = el("div", side
      ? "ic-tasklist ic-tasklist-side flex h-full min-h-0 w-full flex-col"
      : "ic-tasklist z-1300 pointer-events-auto absolute flex max-h-[60vh] w-[350px] min-w-[310px] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-md");
    if (!side) pop.style.minWidth = "310px";
    const host = side
      ? sideHost
      : (document.getElementById("infcanvas-root") || ui.stage || document.body);
    /* Native TopMenuSection.vue renders QueueProgressOverlay inside the top
       menu's `flex flex-col items-end gap-1` container (right edge = viewport
       minus the 8px canvas gutter). The overlay therefore aligns its RIGHT
       edge with that container and sits 4px (gap-1) BELOW the actionbar row.
       Our equivalent of that row is the monitor plate — NOT the badge, which
       is inset ~7px from the plate and would push the popup left of ComfyUI's
       edge. Anchor to the plate to match the native margin exactly. */
    if (!side) {
      const plate = document.getElementById("infcanvas-monitor-plate");
      const aRect = (plate || ui.taskBadge)?.getBoundingClientRect();
      const hRect = host.getBoundingClientRect();
      pop.style.top = aRect ? (aRect.bottom - hRect.top + 4) + "px" : "90px";
      pop.style.right = aRect ? (hRect.right - aRect.right) + "px" : GUTTER;
    }

    /* QueueOverlayExpanded.vue wraps header + filters + list in gap-4. */
    const expanded = el("div", "flex w-full flex-col gap-4");
    expanded.append(buildQueueHeader(tasks, side), buildQueueFilters(tasks, side));
    const listWrap = el("div", "min-h-0 flex-1");
    const body = el("div", side
      ? "h-full min-h-0 flex-1 overflow-y-auto pb-4"
      : "h-full max-h-[46vh] overflow-y-auto pb-4");
    listWrap.appendChild(body);
    expanded.appendChild(listWrap);
    pop.appendChild(expanded);
    host.appendChild(pop);

    ui.taskList = pop;
    ui.taskListBody = body;
    ui.taskListSide = side;
    if (ui.taskTab !== "done") ui.taskTab = "all";
    const shown = ui.taskTab === "done"
      ? tasks.filter((j) => j.phase === "done" || j.phase === "error") : tasks;
    renderQueueList(shown);
    ui.taskListSig = tasks.map((j) => j.promptId + ":" + j.phase).join("|");
    /* The queue overlay is persistent: it stays open until the active-task
       capsule is clicked again (the toggle in buildActiveTaskBadge). No
       outside-pointerdown dismiss — matches the requested always-on behavior. */
    /* Expanded list and collapsed progress card share the same anchor. */
    syncRunProgressBar(tasks);
  }

  /* Native QueueProgressOverlay.vue + QueueOverlayActive.vue: the collapsed
     floating progress CARD shown while a job is active — NOT QueueInlineProgress
     (the 3px actionbar-bottom bars, which ComfyUI only teleports in docked
     mode). This is the card in the reference screenshot: a w-350 rounded border
     container with a h-2 pill track, `全部：N% 当前节点：<name> N%`, and a bottom
     row of `<n> 运行中 [✕]  <n> 已执行 [list-x]  [查看全部任务]`. */
  function buildRunProgressBar() {
    if (ui.runProgress) return;
    const host = document.getElementById("infcanvas-root") || ui.stage || document.body;
    /* QueueProgressOverlay outer = flex justify-end w-full pointer-events-none;
       inner card = pointer-events-auto flex w-[350px] min-w-[310px] flex-col
       overflow-hidden rounded-lg border border-border bg-background shadow-md. */
    const card = el("div",
      "ic-runprogress z-1290 pointer-events-auto absolute flex w-[350px] " +
      "min-w-[310px] flex-col overflow-hidden rounded-lg border border-border " +
      "bg-background text-foreground shadow-md transition-colors duration-200 ease-in-out");
    card.setAttribute("data-testid", "queue-progress-overlay");
    card.style.minWidth = "310px";
    /* Native showBackground = expanded || (active && isOverlayHovered): in the
       collapsed 'active' state the OUTER FRAME is transparent until hovered —
       border-transparent / bg-transparent / shadow-none, then border-border /
       bg-background / shadow-md on hover. Inline overrides the static classes;
       clearing them on hover lets the native classes apply again. Keep the
       1px border width (only color changes) so the card never shifts size. */
    card.style.borderColor = "transparent";
    card.style.backgroundColor = "transparent";
    card.style.boxShadow = "none";
    /* `z-1290` is not a class the host UnoCSS emits (only z-1300 exists, used
       by the expanded list), so the computed z-index stayed `auto` and the
       Vue Flow pane (z=2) swallowed every real pointer click. Set it inline —
       same pattern as minWidth above — so the three buttons are actually
       hittable. Keep it below the expanded list (1300) and task menu. */
    card.style.zIndex = "1290";
    const inner = el("div", "flex flex-col gap-3 p-2");
    card.appendChild(inner);

    /* QueueOverlayActive top block: gap-1 column of track + percent row. */
    const top = el("div", "flex flex-col gap-1");
    const track = el("div", "relative h-2 w-full overflow-hidden rounded-full border bg-background");
    const totalFill = el("div");
    totalFill.style.cssText = "position:absolute;inset:0;height:100%;transform-origin:left;transform:scaleX(0);will-change:transform;background:var(--primary)";
    const nodeFill = el("div");
    nodeFill.style.cssText = "position:absolute;inset:0;height:100%;transform-origin:left;transform:scaleX(0);will-change:transform;background:color-mix(in srgb, var(--primary) 30%, transparent)";
    nodeFill.setAttribute("data-testid", "queue-progress-node-fill");
    track.append(totalFill, nodeFill);

    const pctRow = el("div", "flex items-start justify-end gap-4 text-[12px] leading-none");
    const totalWrap = el("div", "flex items-center gap-1 opacity-90");
    totalWrap.appendChild(document.createTextNode(t("core.total")));
    const totalPct = el("span", "font-bold");
    totalPct.textContent = "0%";
    totalWrap.appendChild(totalPct);
    const nodeWrap = el("div", "flex items-center gap-1 text-muted-foreground");
    const nodeLabel = el("span");
    nodeLabel.textContent = t("core.currentNode");
    const nodeName = el("span", "inline-block max-w-40 truncate");
    nodeName.textContent = "—";
    const nodePctWrap = el("span", "flex items-center gap-1");
    const nodePct = el("span");
    nodePct.textContent = "0%";
    nodePctWrap.appendChild(nodePct);
    nodeWrap.append(nodeLabel, nodeName, nodePctWrap);
    pctRow.append(totalWrap, nodeWrap);
    top.append(track, pctRow);
    inner.appendChild(top);

    /* Native bottomRowClass keeps this row visible in the collapsed card;
       screenshot shows it without hover. */
    const bottom = el("div", "flex items-center justify-end gap-4 transition-opacity duration-200 ease-in-out");
    /* Native QueueProgressOverlay.bottomRowClass: the action row fades in only
       while the card is hovered (overlayState==='active' && isOverlayHovered),
       otherwise opacity-0 pointer-events-none. Inline style mirrors it because
       the host UnoCSS may not emit those utility classes in the canvas DOM.
       It still occupies layout space, matching the reference screenshot where
       only the track + percent row stay visible when the mouse is away. */
    bottom.style.opacity = "0";
    bottom.style.pointerEvents = "none";
    const counts = el("div", "flex items-center gap-4 text-[12px] text-foreground");

    const runningGroup = el("div", "flex items-center gap-2");
    const runningText = el("span", "opacity-90");
    const runningCount = el("span", "font-bold");
    runningCount.textContent = "0";
    const runningLabel = el("span", "ml-1");
    runningLabel.textContent = t("core.runningStatus");
    runningText.append(runningCount, runningLabel);
    const interrupt = el("button", BTN_BASE + " " + BTN_VARIANT_DESTRUCTIVE + " " + BTN_SIZE_ICON);
    interrupt.type = "button";
    interrupt.appendChild(icon("x", "block size-4 leading-none text-foreground"));
    bindTip(interrupt, () => t("core.interruptAllRunningJobs"), "bottom");
    runningGroup.append(runningText, interrupt);

    const queuedGroup = el("div", "flex items-center gap-2");
    const queuedText = el("span", "opacity-90");
    const queuedCount = el("span", "font-bold");
    queuedCount.textContent = "0";
    const queuedLabel = el("span", "ml-1");
    queuedLabel.textContent = t("core.queued");
    queuedText.append(queuedCount, queuedLabel);
    const clearQueuedBtn = el("button", BTN_BASE + " " + BTN_VARIANT_DESTRUCTIVE + " " + BTN_SIZE_ICON);
    clearQueuedBtn.type = "button";
    clearQueuedBtn.appendChild(icon("list-x", "block size-4 leading-none text-foreground"));
    bindTip(clearQueuedBtn, () => t("core.clearQueue"), "bottom");
    queuedGroup.append(queuedText, clearQueuedBtn);
    counts.append(runningGroup, queuedGroup);

    const viewAll = el("button", BTN_BASE + " " + BTN_VARIANT_SECONDARY + " h-8 min-w-30 flex-1 rounded-lg px-2 py-0 text-xs");
    viewAll.type = "button";
    viewAll.textContent = t("core.viewAllJobs");
    bottom.append(counts, viewAll);
    inner.appendChild(bottom);

    /* Actions reuse the exact same handlers as the badge/list. */
    interrupt.addEventListener("click", (e) => {
      e.stopPropagation();
      const running = (NS.genProgress?.snapshot?.() || []).filter((j) =>
        j.phase === "running" || j.phase === "sampling");
      for (const job of running) cancelCanvasJob(job);
    });
    clearQueuedBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearPendingQueue(NS.genProgress?.snapshot?.() || []);
    });
    viewAll.addEventListener("click", (e) => {
      e.stopPropagation();
      openTaskList(NS.genProgress?.snapshot?.() || []);
    });

    /* hover drives both the outer frame (showBackground) and the bottom-row
       opacity/pointer-events, exactly like the native `@mouseenter`/
       `@mouseleave` on the overlay card. Clearing the inline frame overrides
       restores the static border-border/bg-background/shadow-md classes. */
    card.addEventListener("mouseenter", () => {
      bottom.style.opacity = "1";
      bottom.style.pointerEvents = "auto";
      card.style.borderColor = "";
      card.style.backgroundColor = "";
      card.style.boxShadow = "";
    });
    card.addEventListener("mouseleave", () => {
      bottom.style.opacity = "0";
      bottom.style.pointerEvents = "none";
      card.style.borderColor = "transparent";
      card.style.backgroundColor = "transparent";
      card.style.boxShadow = "none";
    });

    host.appendChild(card);
    ui.runProgress = card;
    ui.runProgressTotalFill = totalFill;
    ui.runProgressNodeFill = nodeFill;
    ui.runProgressTotalPct = totalPct;
    ui.runProgressNodeName = nodeName;
    ui.runProgressNodePct = nodePct;
    ui.runProgressRunning = runningCount;
    ui.runProgressQueued = queuedCount;
    ui.runProgressInterrupt = interrupt;
    ui.runProgressClear = clearQueuedBtn;
  }

  function syncRunProgressBar(tasks) {
    if (!ui.runProgress) return;
    const list = Array.isArray(tasks) ? tasks
      : (NS.genProgress?.snapshot?.() || []);
    const isRunning = (j) => j.phase === "running" || j.phase === "sampling";
    const runningJobs = list.filter(isRunning);
    const queuedJobs = list.filter((j) => j.phase === "queued");
    /* Native executionProgress is global for the one running job: mirror the
       most recent running job's total + current-node fractions. */
    const active = runningJobs[runningJobs.length - 1] || null;
    const total = active ? Math.max(0, Math.min(100, Math.round((active.progress || 0) * 100))) : 0;
    const node = active ? Math.max(0, Math.min(100, Math.round((active.currentNodeProgress || 0) * 100))) : 0;
    ui.runProgressTotalFill.style.transform = "scaleX(" + (total / 100) + ")";
    ui.runProgressNodeFill.style.transform = "scaleX(" + (node / 100) + ")";
    ui.runProgressTotalPct.textContent = total + "%";
    ui.runProgressNodePct.textContent = node + "%";
    ui.runProgressNodeName.textContent = active?.currentNodeName || "—";
    ui.runProgressRunning.textContent = String(runningJobs.length);
    ui.runProgressQueued.textContent = String(queuedJobs.length);
    ui.runProgressInterrupt.style.visibility = runningJobs.length ? "" : "hidden";
    ui.runProgressClear.style.visibility = queuedJobs.length ? "" : "hidden";

    /* Show the collapsed card while enabled + a job is active, but never while
       the expanded list owns the same anchor (or a dock-side render is active). */
    const show = runProgressEnabled() && runningJobs.length + queuedJobs.length > 0
      && !ui.taskList;
    ui.runProgress.style.display = show ? "" : "none";
    if (!show) return;
    const plate = document.getElementById("infcanvas-monitor-plate");
    const aRect = plate?.getBoundingClientRect();
    const hRect = ui.runProgress.parentElement.getBoundingClientRect();
    if (aRect) {
      ui.runProgress.style.top = (aRect.bottom - hRect.top + 4) + "px";
      ui.runProgress.style.right = (hRect.right - aRect.right) + "px";
    }
  }

  function syncActiveTaskBadge(tasks) {
    if (!ui.taskBadge) return;
    const list = Array.isArray(tasks) ? tasks : [];
    /* Settled rows (completed/failed/cancelled) stay in the list but are NOT
       "active" — ComfyUI's actionbar count = pending + running only. */
    const isActive = (j) => j.phase === "queued" || j.phase === "running" || j.phase === "sampling";
    const activeCount = list.filter(isActive).length;
    if (ui.taskCount) ui.taskCount.textContent = t("core.activeTasks", { count: activeCount });
    const running = list.some((j) => j.phase === "running" || j.phase === "sampling");
    /* ComfyActionbar.vue: interrupt Button is variant destructive while it can
       interrupt, otherwise secondary. Native swaps the full variant class. */
    if (ui.taskInterrupt) {
      ui.taskInterrupt.disabled = !running;
      const base = BTN_BASE + " " + BTN_SIZE_ICON + " ";
      ui.taskInterrupt.className = base + (running ? BTN_VARIANT_DESTRUCTIVE : BTN_VARIANT_SECONDARY);
    }
    /* Native keeps both buttons permanently visible and only toggles the dot
       Badge on activeJobsCount > 0 — never hide the whole row. */
    if (ui.taskDot) ui.taskDot.style.display = activeCount ? "" : "none";
    syncRunProgressBar(list);
    /* Rebuild an open list only when the SET of jobs changes; progress events
       fire rapidly and must not tear down rows on every tick. Use the same
       filtered view as openTaskList so the sig stays comparable. */
    if (ui.taskList) {
      const view = applyTaskView(list);
      const sig = view.map((j) => j.promptId + ":" + j.phase).join("|");
      if (sig !== ui.taskListSig) openTaskList(list, { side: ui.taskListSide });
    }
  }

  /* Native button.variants.ts (design-system) — final resolved class strings
     for the two ComfyActionbar.vue buttons, verbatim:
       interrupt: Button variant={canInterrupt?'destructive':'secondary'} size="icon"
       queue:     Button variant="secondary" size="md" class="px-3"
     base = buttonVariants.base; variant + size are merged (no tailwind-merge
     conflict here because each contributes a distinct utility). */
  const BTN_VARIANT_SECONDARY = "bg-secondary text-foreground hover:bg-accent";
  const BTN_VARIANT_DESTRUCTIVE = "bg-destructive text-foreground hover:bg-destructive/90";
  /* Button variant=textonly size=sm (native JobAssetsList "View" action):
     textonly=`bg-transparent text-foreground hover:bg-accent`,
     sm=`h-6 rounded-sm px-2 py-1 text-xs`. */
  const BTN_VARIANT_TEXTONLY = "bg-transparent text-foreground hover:bg-accent";
  const BTN_SIZE_SM = "h-6 rounded-sm px-2 py-1 text-xs";
  const BTN_SIZE_ICON = "size-8 rounded-lg p-0";
  const BTN_SIZE_MD_PX3 = "h-8 rounded-lg px-3";
  const NATIVE_DOT = "inline-flex shrink-0 items-center justify-center size-2 rounded-full p-0 bg-primary";

  function buildActiveTaskBadge() {
    /* Native ComfyActionbar.vue keeps [✕][N tasks] as two SEPARATE buttons in
       one flex row (gap-2) inside the action/menu bar; the queue Button also
       carries a dot Badge when activeJobsCount > 0. We mount the row as the
       last item of the top-right monitor plate (see #infcanvas-monitor-plate),
       so the plate supplies the bar surface + pointer-events. Both buttons are
       permanently visible; only the dot toggles. */
    const badge = el("div", "inline-flex shrink-0 items-center gap-2");
    badge.id = "infcanvas-active-tasks";

    const x = el("button", BTN_BASE + " " + BTN_VARIANT_SECONDARY + " " + BTN_SIZE_ICON);
    x.type = "button";
    x.appendChild(icon("x", "block size-4"));
    bindTip(x, () => t("core.interruptCurrentTask"), "bottom");
    x.setAttribute("aria-label", t("core.interruptCurrentTask"));
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      const snap = NS.genProgress?.snapshot?.() || [];
      const running = [...snap].reverse().find((j) => j.phase === "running" || j.phase === "sampling")
        || snap[snap.length - 1];
      /* Native ComfyActionbar X = Comfy.Interrupt → api.interrupt(runningJobId).
         cancelCanvasJob picks interrupt for running jobs and drops the row. */
      if (running) cancelCanvasJob(running);
    });
    ui.taskInterrupt = x;

    const capsule = el("button", BTN_BASE + " " + BTN_VARIANT_SECONDARY + " " + BTN_SIZE_MD_PX3);
    capsule.type = "button";
    const count = el("span", "text-sm font-normal tabular-nums");
    count.textContent = t("core.activeTasks", { count: 0 });
    capsule.appendChild(count);
    const dot = el("span", NATIVE_DOT + " pointer-events-none absolute -top-0.5 -right-0.5 animate-pulse");
    dot.style.display = "none";
    capsule.style.position = "relative";
    capsule.appendChild(dot);
    capsule.addEventListener("click", (e) => {
      e.stopPropagation();
      /* When "停靠的作业历史" is on, the capsule is just another toggle for
         the sidebar tab: click opens it, click again collapses it — exactly
         like the rail button. It never opens the floating overlay in this mode.
         When docked off, fall back to the original floating-overlay toggle. */
      if (NS.ui?.isJobHistoryDocked?.()) {
        NS.ui?.togglePanel?.("job-history");
        return;
      }
      if (ui.taskList) { closeTaskList(); return; }
      openTaskList(NS.genProgress?.snapshot?.() || []);
    });
    bindTip(capsule, () => t("core.viewCanvasTasks"), "bottom");
    ui.taskCount = count;
    ui.taskDot = dot;

    badge.append(x, capsule);
    ui.taskBadge = badge;
    return badge;
  }

  function buildToolbar() {
    /* CanvasModeSelector.vue: rounded-none! + hover:rounded-lg! so the trigger
       stays flush with the panel edge until hovered; the current mode glyph
       sits on its own bg-muted chip and the whole 54x32 button turns accent
       (bg-accent! + group-hover:bg-accent) while hovered. */
    const mode = styledButton(BTN_MODE);
    bindTip(mode, () => t("controls.canvasMode"));
    mode.setAttribute("aria-label", t("controls.canvasMode"));
    mode.setAttribute("aria-haspopup", "menu");
    mode.setAttribute("aria-expanded", "false");
    const modeInner = el("div", "flex items-center gap-1 pr-0.5");
    const chip = el("div", "rounded-lg bg-muted p-2 group-hover:bg-accent");
    const modeIcon = icon("mouse-pointer-2", "block size-4");
    chip.appendChild(modeIcon);
    modeInner.append(chip, icon("chevron-down", "block size-4 pr-1.5"));
    mode.appendChild(modeInner);

    /* GraphCanvasMenu.vue: <Button size-8 bg-transparent p-0> with
       icon-[lucide--focus] for Comfy.Canvas.FitView. Native aria-label /
       tooltip is "适应视图 (.)". */
    const fit = iconButton("focus", t("controls.fitView") + shortcutText("Comfy.Canvas.FitView") + ")");

    /* Percentage trigger: h-8 w-15, the label and chevron in one text-xs row. */
    const zoom = styledButton(BTN_ZOOM);
    bindTip(zoom, () => t("controls.zoomControls"));
    zoom.setAttribute("aria-label", t("controls.zoomControls"));
    zoom.setAttribute("data-testid", "zoom-controls-button");
    const zoomInner = el("span", "inline-flex items-center gap-1 px-2 text-xs");
    const zoomLabel = el("span");
    zoomLabel.textContent = "100%";
    zoomInner.append(zoomLabel, icon("chevron-down"));
    zoom.appendChild(zoomInner);

    const map = iconButton("map", t("controls.showMinimap"));
    const snap = iconButton("grid-3x3", t("shortcuts.snapToGrid") + " (" + shortcutText("InfCanvas.SnapToGrid") + ")");
    const links = iconButton("route-off", t("controls.hideLinks") + " (" + shortcutText("InfCanvas.ToggleLinks") + ")");

    const bar = el("div",
      "pointer-events-auto ml-auto flex max-w-full min-w-0 gap-1 " +
      "overflow-x-auto floating-panel");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("controls.canvasToolbar"));
    bar.append(mode, divider(), fit, zoom, divider(), map, snap, links);
    bar.addEventListener("wheel", onToolbarWheel, { passive: false });

    ui.modeBtn = mode;
    ui.modeIcon = modeIcon;
    ui.zoomBtn = zoom;
    ui.zoomLabel = zoomLabel;
    ui.mapBtn = map;
    ui.snapBtn = snap;
    ui.linksBtn = links;
    ui.bar = bar;

    mode.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleModePop();
    });
    fit.addEventListener("click", fitView);
    zoom.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleZoomPop();
    });
    map.addEventListener("click", toggleMinimap);
    snap.addEventListener("click", toggleSnap);
    links.addEventListener("click", toggleLinks);

    return bar;
  }

  /* GraphCanvasMenu.vue puts @wheel="canvasInteractions.handleWheel" on the
     toolbar, so scrolling over it zooms the graph behind it. */
  function onToolbarWheel(event) {
    /* Forward the wheel to Vue Flow's pane so scrolling over the toolbar zooms
       the graph behind it, exactly like GraphCanvasMenu.vue does. */
    const pane = flowHost()?.querySelector(".vue-flow__pane");
    if (!pane) return;
    event.preventDefault();
    pane.dispatchEvent(new WheelEvent("wheel", {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
      clientX: event.clientX, clientY: event.clientY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey,
      bubbles: true, cancelable: true,
    }));
  }

  /* --------------------------- select / hand ------------------------------ */

  /* CanvasModeSelector.vue: a two-item radio menu (select / hand) that maps to
     Comfy.Canvas.Unlock / Comfy.Canvas.Lock, i.e. canvas.read_only. */
  function toggleModePop() {
    if (ui.modePop?.isConnected) { closePops(); return; }
    closePops();
    const readOnly = flowApi()?.state?.mode?.value === "drag";

    /* PopoverContent.vue defaults (z-overlay w-72 rounded-md p-4 shadow-md)
       merged by cn() with menuContentClass (min-w-48 rounded-lg border
       bg-background p-1 shadow-lg) and CanvasModeSelector's own
       (w-auto min-w-39 select-none, animations disabled). Net result measured
       in the browser: 156px wide, 4px padding, 8px radius, 1px border. */
    const pop = el("div",
      "absolute z-1300 w-auto min-w-39 max-w-full select-none overflow-y-auto " +
      "rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none");
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", t("controls.canvasMode"));

    const items = [
      { id: "Comfy.Canvas.Unlock", icon: "mouse-pointer-2", label: t("controls.select"), active: !readOnly, readOnly: false },
      { id: "Comfy.Canvas.Lock", icon: "hand", label: t("controls.pan"), active: readOnly, readOnly: true },
    ];
    for (const item of items) {
      /* menuButtonClass + 'justify-between' after cn(): one min-height, one
         padding, one radius, one justify. */
      const button = el("button",
        "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md " +
        "px-3 py-1.5 text-sm outline-none border-0 bg-transparent text-left " +
        "whitespace-nowrap hover:bg-accent focus-visible:bg-accent " +
        "disabled:pointer-events-none disabled:opacity-50 justify-between");
      button.type = "button";
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", item.active ? "true" : "false");
      button.setAttribute("aria-label", item.label);
      button.setAttribute("tabindex", item.active ? "0" : "-1");
      const head = el("div", "flex items-center gap-2");
      head.append(icon(item.icon), el("span"));
      head.lastChild.textContent = item.label;
      button.appendChild(head);
      const hint = shortcutText(item.id);
      if (hint) {
        const span = el("span", "text-[9px] text-foreground");
        span.textContent = hint;
        span.setAttribute("data-testid", "shortcut-hint");
        button.appendChild(span);
      }
      button.addEventListener("click", () => {
        setReadOnly(item.readOnly);
        closePops();
      });
      pop.appendChild(button);
    }

    ui.modeBtn.setAttribute("aria-expanded", "true");
    ui.modePop = pop;
    placeAbove(pop, ui.modeBtn);
    dismissLater(pop, ui.modeBtn);
  }

  /* Anchored inside the stage (never <body>: canvas mode hides every body-level
     sibling of #infcanvas-root). reka-ui PopoverContent defaults to
     align="center" + side="top" + sideOffset=8 + collisionPadding=8, so the
     menu is centred on the trigger and only shifts to stay 8px inside the
     stage. */
  function placeAbove(pop, anchor) {
    ui.stage.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const stageRect = ui.stage.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const triggerCentre = rect.left - stageRect.left + rect.width / 2;
    const left = Math.max(8, Math.min(
      triggerCentre - box.width / 2,
      stageRect.width - box.width - 8
    ));
    pop.style.position = "absolute";
    pop.style.left = left + "px";
    pop.style.bottom = (stageRect.bottom - rect.top + 8) + "px";
  }

  function setReadOnly(value) {
    flowApi()?.setMode?.(value ? "drag" : "select");
    syncModeIcon();
  }

  function syncModeIcon() {
    const readOnly = flowApi()?.state?.mode?.value === "drag";
    if (ui.readOnlyIcon === readOnly) return;
    ui.readOnlyIcon = readOnly;
    if (!ui.modeIcon) return;
    /* CanvasModeSelector.vue keeps the trigger labelled 画布模式 in both modes;
       only the glyph (and the checkmark inside the open menu) follows. */
    ui.modeIcon.className = readOnly
      ? "icon-[lucide--hand] block size-4"
      : "icon-[lucide--mouse-pointer-2] block size-4";
    for (const item of ui.modePop?.querySelectorAll("[role=menuitemradio]") || []) {
      const isHand = item.getAttribute("aria-label") === t("controls.pan");
      const active = isHand === readOnly;
      item.setAttribute("aria-checked", active ? "true" : "false");
      item.setAttribute("tabindex", active ? "0" : "-1");
    }
  }

  /* ------------------------------ zoom popup ------------------------------ */

  function toggleZoomPop() {
    /* The reference can outlive the element (the stage is rebuilt on re-enter),
       so treat a detached popup as closed instead of swallowing the click. */
    if (ui.zoomPop?.isConnected) { closePops(); return; }
    closePops();

    /* ZoomControlsModal.vue: root is absolute right-0 bottom-[62px] z-1300
       flex w-[250px] justify-center border-0! bg-inherit! -- anchored to the
       gutter-inset graph canvas panel, so its right edge is 8px inside the
       canvas and it sits 62px above the panel's bottom edge (62 + gutter from
       the canvas edge). The card inside is w-4/5 (= 200px) rounded-lg border
       bg-background p-2 shadow-lg + inline
       { border: 1px solid var(--border); border-radius: 8px }. */
    const pop = el("div",
      "absolute z-1300 flex w-[250px] justify-center border-0! bg-inherit!");
    pop.style.right = GUTTER;
    pop.style.bottom = "calc(62px + " + GUTTER + ")";
    pop.setAttribute("data-testid", "zoom-controls-popup");
    const panel = el("div",
      "w-4/5 rounded-lg border bg-background p-2 text-foreground shadow-lg select-none");
    panel.style.border = "1px solid var(--border)";
    panel.style.borderRadius = "8px";
    panel.addEventListener("click", (event) => event.stopPropagation());
    const column = el("div", "flex flex-col gap-1");
    column.append(
      zoomRow(t("shortcuts.zoomIn"), "zoom-in-action", "Comfy.Canvas.ZoomIn", () => zoomBy(ZOOM_STEP), true),
      zoomRow(t("shortcuts.zoomOut"), "zoom-out-action", "Comfy.Canvas.ZoomOut", () => zoomBy(1 / ZOOM_STEP), true),
      zoomRow(t("controls.fitScreen"), "zoom-to-fit-action", "Comfy.Canvas.FitView", fitView, false),
      zoomField()
    );
    panel.appendChild(column);
    pop.appendChild(panel);
    ui.stage.appendChild(pop);
    ui.zoomPop = pop;
    ui.zoomBtn.classList.add(THEME_ON);
    /* watch() in ZoomControlsModal.vue focuses the number field on open. */
    const input = pop.querySelector("input");
    if (input) input.focus();
    dismissLater(pop, ui.zoomBtn);
  }

  function zoomRow(label, testId, commandId, action, repeat) {
    const row = el("div",
      "flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-accent");
    row.setAttribute("data-testid", testId);
    const text = el("span", "font-medium");
    text.textContent = label;
    row.appendChild(text);
    const hint = shortcutText(commandId);
    if (hint) {
      const span = el("span", "text-[9px]");
      span.textContent = hint;
      row.appendChild(span);
    }
    if (repeat) {
      /* ZoomControlsModal.vue: press-and-hold repeats the command every 100ms. */
      row.addEventListener("mousedown", () => {
        startRepeat(action);
        row.classList.add("bg-accent");
      });
      const stop = () => {
        stopRepeat();
        row.classList.remove("bg-accent");
      };
      row.addEventListener("mouseup", stop);
      row.addEventListener("mouseleave", stop);
    } else {
      row.addEventListener("click", () => action());
    }
    return row;
  }

  /* FormNumberField.vue as rendered inside ZoomControlsModal.vue: a 40px
     bg-secondary pill with a w-6 minus, a centred flex-1 text field, the '%'
     suffix and a w-6 plus. Stepping is 1 (the reka number field default). */
  const FIELD_GROUP =
    "flex h-10 w-full items-center rounded-lg bg-secondary text-foreground " +
    "focus-within:ring-1 focus-within:ring-ring hover:bg-accent " +
    "data-disabled:pointer-events-none data-disabled:opacity-50";
  const FIELD_STEP =
    "flex h-full w-6 shrink-0 cursor-pointer items-center justify-center " +
    "border-none bg-transparent text-muted-foreground hover:bg-accent " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-30";

  function zoomField() {
    const group = el("div", FIELD_GROUP);
    group.setAttribute("role", "group");
    group.setAttribute("data-slot", "number-field");
    group.setAttribute("data-testid", "zoom-percentage-input");

    const step = (iconName, side, delta) => {
      const button = el("button", FIELD_STEP + " rounded-" + side + "-lg");
      button.type = "button";
      button.tabIndex = -1;
      button.setAttribute("aria-label", side === "l" ? t("controls.decrease") : t("controls.increase"));
      button.setAttribute("data-slot", "number-field-" +
        (side === "l" ? "decrement" : "increment"));
      button.appendChild(icon(iconName));
      button.addEventListener("click", () => setPercentage(percentage() + delta));
      return button;
    };

    const input = el("input");
    /* type=text + inputmode=numeric: the reka field hides the native spinners. */
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className =
      "min-w-0 flex-1 border-none bg-transparent text-center text-base " +
      "text-foreground focus-visible:outline-none";
    input.style.padding = "1px 2px";
    input.value = String(percentage());
    input.setAttribute("role", "spinbutton");
    input.setAttribute("aria-label", t("controls.zoomPercentage"));
    input.setAttribute("aria-valuemin", "1");
    input.setAttribute("aria-valuemax", "1000");
    input.setAttribute("aria-valuenow", String(percentage()));
    input.setAttribute("data-testid", "zoom-percentage-input");
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[^\d]/g, "");
      if (digits !== input.value) input.value = digits;
      const value = Number(digits);
      if (!Number.isFinite(value) || value <= 0) return;
      ui.fieldEditing = true;
      setPercentage(value);
    });
    input.addEventListener("blur", () => {
      ui.fieldEditing = false;
      input.value = String(percentage());
    });
    input.addEventListener("keydown", (event) => {
      /* LiteGraph listens for keys on the document; typing must not reach it. */
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") input.blur();
      if (event.key === "ArrowUp") { event.preventDefault(); setPercentage(percentage() + 1); }
      if (event.key === "ArrowDown") { event.preventDefault(); setPercentage(percentage() - 1); }
    });

    const suffix = el("span", "shrink-0 text-sm");
    suffix.textContent = "%";

    const plus = step("plus", "r", 1);
    const minus = step("minus", "l", -1);
    group.append(minus, input, suffix, plus);
    return group;
  }

  function startRepeat(action) {
    if (ui.repeat) return;
    action();
    ui.repeat = setInterval(action, 100);
  }

  function stopRepeat() {
    if (!ui.repeat) return;
    clearInterval(ui.repeat);
    ui.repeat = 0;
  }

  /* Comfy.Canvas.ZoomIn / ZoomOut: 10% around the canvas centre. */
  function zoomBy(factor) {
    const api = flowApi();
    if (!api) return;
    api.setZoom(Math.max(MIN_SCALE, Math.min(MAX_SCALE, zoom() * factor)));
    syncZoomLabel();
  }

  /* canvasStore.setAppZoomFromPercentage(): percentage of the app scale. */
  function setPercentage(value) {
    const api = flowApi();
    if (!api) return;
    api.setZoom(Math.max(MIN_SCALE, Math.min(MAX_SCALE, value / 100)));
    syncZoomLabel();
  }

  function percentage() {
    return Math.round(zoom() * 100);
  }

  function syncZoomLabel() {
    /* Resolve the label from the live button instead of the cached reference:
       the toolbar can be rebuilt on re-enter, and a stale span would swallow
       every update while the visible one stayed at its initial value. */
    const btn = document.querySelector('#infcanvas-controls [data-testid="zoom-controls-button"]') || ui.zoomBtn;
    const labelEl = btn?.querySelector("span span") || ui.zoomLabel;
    if (!labelEl) return;
    const value = percentage();
    const next = value + "%";
    if (next !== ui.scaleText) {
      ui.scaleText = next;
      labelEl.textContent = next;
    }
    /* ZoomControlsModal.vue's FormNumberField is two-way bound to
       canvasStore.appScalePercentage, so the field follows outside zooming
       (wheel over the graph, fit view, the popup's own rows) while it is open.
       It is not overwritten while the user is typing into it. */
    const input = ui.zoomPop?.querySelector("input");
    if (!input || ui.fieldEditing) return;
    if (input.value !== String(value)) input.value = String(value);
    input.setAttribute("aria-valuenow", String(value));
  }

  /* Comfy.Canvas.FitView: fit every node with a little breathing room. */
  function fitView() {
    const api = flowApi();
    if (!api) return;
    if (!hasNodes()) {
      NS.api?.toast?.("info", t("controls.noNodesCanvas"));
      return;
    }
    /* 0.75 is animateToBounds' fill ratio: the bounds occupy 75% of the
       viewport, leaving the same breathing room ComfyUI's Zoom to fit has. */
    try { api.fitView(0.75); }
    catch (error) { console.warn("[InfCanvas] fit view failed", error); }
  }

  /* ------------------------- link visibility ------------------------------ */

  /* settingStore 'Comfy.LinkRenderMode' is global to ComfyUI. The canvas keeps
     its own copy so toggling here never changes the user's workflow tabs. */
  function flowHost() { return document.querySelector("#infcanvas-vueflow"); }

  function linksHidden() { return !!ui.linksHiddenState; }

  function toggleLinks() {
    ui.linksHiddenState = !ui.linksHiddenState;
    flowHost()?.classList.toggle("ic-hide-edges", ui.linksHiddenState);
    writePref(PREF_LINKS_HIDDEN, ui.linksHiddenState);
    syncLinkButton();
  }

  /* linkVisibilityLabel in GraphCanvasMenu.vue: hideLinks while the links are
     drawn, showLinks once hidden. Local "L" mnemonic appended to match the
     other toolbar toggles (ComfyUI leaves link visibility unbound). */
  function syncLinkButton() {
    const hidden = linksHidden();
    if (ui.linksHidden === hidden) return;
    ui.linksHidden = hidden;
    if (!ui.linksBtn) return;
    ui.linksBtn.classList.toggle(THEME_ON, hidden);
    const label = (hidden ? t("controls.showLinks") : t("controls.hideLinks")) +
      " (" + shortcutText("InfCanvas.ToggleLinks") + ")";
    bindTip(ui.linksBtn, () => label);
    ui.linksBtn.setAttribute("aria-label", label);
  }

  function applyInitialLinkMode() {
    const stored = readPref(PREF_LINKS_HIDDEN);
    const hidden = stored === null ? false : !!stored;
    ui.linksHiddenState = hidden;
    flowHost()?.classList.toggle("ic-hide-edges", hidden);
    ui.linksHidden = null;
    syncLinkButton();
    return true;
  }

  /* ------------------------------- minimap -------------------------------- */

  /* The minimap is rendered by Vue Flow inside #infcanvas-vueflow; this module
     only owns the toolbar toggle and its persisted preference. */

  /* minimapLabel in GraphCanvasMenu.vue: "显示小地图" / "隐藏小地图" plus the
     uppercased ToggleMinimap sequence, e.g. "隐藏小地图 (ALT + SHIFT + M)". */
  function syncMapButton() {
    if (!ui.mapBtn) return;
    const visible = !!flowApi()?.minimap?.visible?.();
    ui.mapBtn.classList.toggle(THEME_ON, visible);
    const label = (visible ? t("controls.hideMinimap") : t("controls.showMinimap")) +
      " (" + shortcutText("Comfy.Canvas.ToggleMinimap").toUpperCase() + ")";
    bindTip(ui.mapBtn, () => label);
    ui.mapBtn.setAttribute("aria-label", label);
  }

  function setMinimapVisible(visible, persist) {
    const api = flowApi();
    if (!api) return;
    api.minimap.set(!!visible);
    if (persist) writePref(PREF_VISIBLE, !!visible);
    syncMapButton();
  }

  function toggleMinimap() { setMinimapVisible(!flowApi()?.minimap?.visible?.(), true); }

  /* ------------------------------ grid snap ------------------------------ */

  /* Grid snap rounds node positions (Vue Flow's snapToGrid) and resize edges
     to the nearest 10px cell -- half the 20px gap of the Vue Flow dot
     background. The toggle is a persistent toolbar preference, kept in
     the flow engine so both the toolbar and the node components read one
     source of truth. */
  function snapEnabled() { return !!ui.snapOn; }

  function setSnapEnabled(enabled, persist) {
    ui.snapOn = !!enabled;
    flowApi()?.snap?.set?.(ui.snapOn);
    if (persist) writePref(PREF_SNAP, ui.snapOn);
    syncSnapButton();
  }

  function toggleSnap() { setSnapEnabled(!snapEnabled(), true); }

  function syncSnapButton() {
    if (!ui.snapBtn) return;
    const on = snapEnabled();
    ui.snapBtn.classList.toggle(THEME_ON, on);
    const label = (on ? t("controls.disableGridSnap") : t("controls.enableGridSnap")) +
      " (" + shortcutText("InfCanvas.SnapToGrid") + ")";
    bindTip(ui.snapBtn, () => label);
    ui.snapBtn.setAttribute("aria-label", label);
    ui.snapBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function applyInitialSnapMode() {
    const stored = readPref(PREF_SNAP);
    setSnapEnabled(stored === null ? false : !!stored, false);
    return true;
  }

  function closePops() {
    stopRepeat();
    ui.fieldEditing = false;
    if (ui.zoomPop) {
      ui.zoomPop.remove();
      ui.zoomPop = null;
    }
    if (ui.modePop) {
      ui.modePop.remove();
      ui.modePop = null;
    }
    ui.modeBtn?.setAttribute("aria-expanded", "false");
    ui.zoomBtn?.classList.remove(THEME_ON);
  }

  function dismissLater(pop, anchor) {
    /* These listeners outlive the popup they were created for: when a popup is
       closed by the toolbar button (closePops removes the element directly) the
       pair stays on document. Without the isConnected guard a stale listener
       would see `pop.contains(target) === false` for every click and close the
       popup that is currently open -- i.e. the first click inside a freshly
       opened menu would dismiss it. */
    const off = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const onDown = (event) => {
      if (!pop.isConnected) { off(); return; }
      if (pop.contains(event.target)) return;
      if (anchor?.contains(event.target)) return;
      off();
      closePops();
    };
    const onKey = (event) => {
      if (!pop.isConnected) { off(); return; }
      if (event.key !== "Escape") return;
      off();
      closePops();
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  /* --------------------------- keyboard shortcuts ------------------------- */

  /* Mirrors the host dialog guard in core.js: only a *visible, non-empty* reka
     dialog swallows the keyboard. Keeps bare V/H/. from reaching the graph
     while a confirm/settings dialog is on screen. */
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

  /* ComfyUI's default canvas keybindings (frontend 1.59.6, verified in the
     shipped keybindingService source) plus two local mnemonics for the toggles
     that ComfyUI itself leaves unbound. Registered only while the canvas is
     mounted, so a bare key can never reach the host canvas behind it.

       V          select / unlock   (Comfy.Canvas.Unlock)
       H          hand / lock       (Comfy.Canvas.Lock)
       .          fit view          (Comfy.Canvas.FitView)
       Alt + =    zoom in           (Comfy.Canvas.ZoomIn)
       Alt + -    zoom out          (Comfy.Canvas.ZoomOut)
       Alt+Shift+M toggle minimap   (Comfy.Canvas.ToggleMinimap)
       S          toggle grid snap  (local mnemonic; no native binding)
       L          toggle links      (local mnemonic; no native binding)
       A          open media assets (sidebar rail mnemonic)
       N          open add-node drawer
       M          open LoRA models
       C          open canvas list
       Ctrl + ,   toggle canvas settings (second press closes it)

     Matching is deliberately strict on modifiers: a bare key must have no
     ctrl/meta/shift/alt, which keeps Ctrl+S (save), Ctrl+G (group), Ctrl+A
     (select all) and every other core.js combo in their own lane. */
  function onShortcut(event) {
    if (!NS.api?.isActive?.()) return;
    if (event.defaultPrevented) return;
    const key = String(event.key || "").toLowerCase();

    /* Ctrl + , must also work while the Settings dialog is open, otherwise the
       dialog guard below would swallow the second press. Toggle before it. */
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === ",") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (NS.settings?.isOpen?.()) NS.settings.close();
      else NS.settings?.open?.();
      return;
    }

    if (NS.tools?.isOpen?.()) return;
    if (NS.apiConfig?.isOpen?.()) return;
    if (hostDialogOpen()) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;

    const alt = !!event.altKey, shift = !!event.shiftKey;
    const mod = event.ctrlKey || event.metaKey;

    let action = null;
    if (mod) return; // Ctrl + , was handled above; every other binding is modifier-free
    if (alt && shift) {
      if (key === "m") action = toggleMinimap;
    } else if (alt) {
      if (key === "=" || key === "+" || key === "numpadadd") action = () => zoomBy(ZOOM_STEP);
      else if (key === "-" || key === "_" || key === "numpadsubtract") action = () => zoomBy(1 / ZOOM_STEP);
    } else if (!shift) {
      if (key === "v") action = () => setReadOnly(false);
      else if (key === "h") action = () => setReadOnly(true);
      else if (key === ".") action = fitView;
      else if (key === "s") action = toggleSnap;
      else if (key === "l") action = toggleLinks;
      /* Sidebar rail mnemonics — same toggle as clicking the button: a second
         press on the same key closes the drawer. */
      else if (key === "a") action = () => NS.ui?.togglePanel?.("gallery");
      else if (key === "n") action = () => NS.ui?.togglePanel?.("nodes");
      else if (key === "m") action = () => NS.ui?.togglePanel?.("lora");
      else if (key === "c") action = () => NS.ui?.togglePanel?.("canvases");
    }
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    action();
  }

  /* ------------------------------ lifecycle ------------------------------- */

  function mount(stage) {
    if (!stage) return null;
    /* Capture on document, like core.js's own keydown handler: our canvas is
       the active surface, so bare keys must be consumed here before the host
       ComfyUI keybinding service (also on document) can see them. */
    document.removeEventListener("keydown", onShortcut, true);
    document.addEventListener("keydown", onShortcut, true);
    /* Subscribe on first mount (i18n.js loads after this module alphabetically,
       so a top-level subscription would be skipped). */
    if (!NS._i18nControlsSubscribed && NS.i18n?.onChange) {
      NS.i18n.onChange(() => repaintLocale());
      NS._i18nControlsSubscribed = true;
    }
    ui.stage = stage;
    if (!ui.wrap) {
      /* GraphCanvasMenu.vue: outer row is `pointer-events-none absolute
         inset-x-0 bottom-0 z-1200 flex`, but it lives inside the graph canvas
         panel that GraphCanvas.vue insets by var(--comfy-canvas-gutter) on the
         right and bottom. Applying that gutter as padding on the row keeps the
         floating panel exactly as far from the canvas edge as ComfyUI's own
         (measured: 8px right, 8px bottom). */
      ui.wrap = el("div",
        "ic-controls pointer-events-none absolute inset-x-0 bottom-0 z-1200 flex");
      ui.wrap.id = "infcanvas-controls";
      ui.wrap.setAttribute("data-testid", "infcanvas-controls");
      ui.wrap.style.paddingRight = GUTTER;
      ui.wrap.style.paddingBottom = GUTTER;
      ui.wrap.appendChild(buildToolbar());
    }
    stage.appendChild(ui.wrap);
    /* Active-task badge: mount into the top-right monitor plate so it sits in
       the same bar as the status readouts. mountShell() mounts the monitor
       before controls.mount(), so the plate normally exists; fall back to the
       stage if it ever does not (badge then renders unparented to the plate). */
    const taskPlate = document.getElementById("infcanvas-monitor-plate") || stage;
    if (!ui.taskBadge) taskPlate.appendChild(buildActiveTaskBadge());
    else taskPlate.appendChild(ui.taskBadge);
    buildRunProgressBar();
    if (!ui.taskUnsub && NS.genProgress?.subscribe) {
      ui.taskUnsub = NS.genProgress.subscribe(syncActiveTaskBadge);
    }
    ui.linksReady = applyInitialLinkMode();
    syncModeIcon();
    const stored = readPref(PREF_VISIBLE);
    setMinimapVisible(
      stored === null ? setting("Comfy.Minimap.Visible", true) !== false : !!stored,
      false
    );
    applyInitialSnapMode();
    syncZoomLabel();
    return ui;
  }

  function unmount() {
    document.removeEventListener("keydown", onShortcut, true);
    closePops();
    closeTaskList();
    closeClearHistoryDialog();
    if (ui.taskUnsub) { try { ui.taskUnsub(); } catch (e) { /* no-op */ } ui.taskUnsub = null; }
    ui.taskBadge?.remove();
    ui.taskBadge = null;
    ui.taskCount = null;
    ui.taskDot = null;
    ui.taskInterrupt = null;
    ui.runProgress?.remove();
    ui.runProgress = null;
    ui.runProgressTotalFill = null;
    ui.runProgressNodeFill = null;
    ui.runProgressTotalPct = null;
    ui.runProgressNodeName = null;
    ui.runProgressNodePct = null;
    ui.runProgressRunning = null;
    ui.runProgressQueued = null;
    ui.runProgressInterrupt = null;
    ui.runProgressClear = null;
    ui.wrap?.remove();
    ui.wrap = null;
    ui.bar = null;
    ui.modeBtn = null;
    ui.modeIcon = null;
    ui.zoomBtn = null;
    ui.zoomLabel = null;
    ui.mapBtn = null;
    ui.snapBtn = null;
    ui.linksBtn = null;
    ui.stage = null;
    ui.scaleText = "";
    ui.readOnlyIcon = null;
    ui.linksHidden = null;
    ui.linksReady = false;
  }

  /* Viewport changes arrive through NS.flow.onViewport in core; the labels are
     also refreshed per frame, which covers wheel zoom. */
  function tick() {
    if (!ui.wrap) return;
    if (!ui.linksReady && applyInitialLinkMode()) ui.linksReady = true;
    syncZoomLabel();
    syncModeIcon();
    syncLinkButton();
    syncSnapButton();
  }

  /* Rebuild the toolbar so every title/aria-label picks up the new language.
     Preferences (minimap/snap/links visibility) are persisted and restored by
     mount(), so no state is lost. */
  function repaintLocale() {
    const stage = ui.stage;
    if (!stage || !ui.wrap) return;
    unmount();
    mount(stage);
  }
  /* Sidebar job-history tab renders the same header/filters/rows as the
     floating overlay, kept live by the genProgress subscription. */
  function renderJobHistoryPanel(host) {
    if (!host) return;
    openTaskList(NS.genProgress?.snapshot?.() || [], { side: true, host });
  }
  NS.controls = {
    mount, unmount, tick, fitView, toggleMinimap,
    snapEnabled, setSnapEnabled, syncSnapButton, repaintLocale,
    renderJobHistoryPanel, closeTaskList,
  };
})();
