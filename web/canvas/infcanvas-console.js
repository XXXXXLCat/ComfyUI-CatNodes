/* Canvas-mode ComfyUI console (bottom logs panel).
 *
 * Mirrors ComfyUI's native "console" (side-toolbar terminal button ->
 * BottomPanel -> LogsTerminal/xterm) INSIDE the infinite canvas, because
 * canvas mode hides the host's own bottom panel together with #vue-app
 * (infcanvas-style.js). Fidelity rule: no fake transport and no terminal
 * reimplementation — every byte comes from the host ComfyApi:
 *
 *   initial snapshot : api.getRawLogs()          -> { entries: [{ m }, ...] }
 *   live stream      : api.addEventListener('logs', e => e.detail.entries)
 *   subscription     : api.subscribeLogs(true)   (same as useLogsTerminal)
 *   backend reconnect: 'reconnected' event -> reset + getRawLogs + resubscribe
 *
 * The xterm widget itself cannot be reused (it is a Vue component inside the
 * hidden #vue-app), so the terminal AREA is a faithful native-DOM reproduction:
 * ComfyUI's BaseTerminal.vue is `bg-neutral-900` (#171717) with `p-2`, monospace
 * font, ANSI colour via xterm's default theme. We render the log entries as
 * lines and apply xterm's default ANSI palette so it reads identically.
 *
 * Mounted as a child of #infcanvas-root (a sibling of the stage), removed with
 * the shell on canvas exit. All host gestures are stopped in the bubble phase
 * so the panel never pans/zooms/cuts the canvas behind it.
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
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  const api = () => window.comfyAPI?.api?.api || NS.api?.raw || null;

  /* xterm.js default ANSI palette (the theme ComfyUI uses when not desktop:
     `theme: isDesktop ? { background: '#171717' } : undefined` -> xterm default).
     Foreground 30-37 / 90-97, background 40-47 / 100-107. */
  const ANSI_FG = [
    "#000000", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
    "#5c6370", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
  ];
  const ANSI_BG = [
    "#000000", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
    "#5c6370", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
  ];
  const MAX_LINES = 2000;       // bound the DOM (xterm scrollback is capped too)
  const SPLIT_STORAGE_KEY = "bottom-panel-splitter"; // native splitterPersistence key
  const MIN_PANEL_H = 120;      // matches min-height on #infcanvas-console
  const DEFAULT_SPLIT = 50;     // native bottomPanelDefaultSizes = [50, 50]

  /* ComfyUI BottomPanel has two mutually exclusive panels: 'terminal' (LOGS)
     and 'shortcuts'. The latter shows two tabs via useShortcutsTab.ts —
     EssentialsPanel ('shortcuts-essentials') and ViewControlsPanel
     ('shortcuts-view-controls') — each rendered by ShortcutsList.vue: a 3-col
     grid of subcategory columns, each row = command label + key badges.
     These are OUR canvas shortcuts (gathered from core.js onKeyDown,
     controls.js onShortcut and infcanvas.js keybindings), grouped the same
     way. Labels are i18n source keys (zh verbatim, EN via dictionary). */
  const KEY_FMT = { Enter: "↵", Delete: "⌦", Backspace: "⌫", Escape: "Esc", Tab: "⇥", " ": "Space" };
  const fmtKey = (k) => KEY_FMT[k] || k;
  const SHORTCUT_PANELS = [
    {
      id: "essentials",
      label: "shortcuts.essentials",
      groups: [
        { title: "shortcuts.group.workflow", items: [
          { label: "shortcuts.toggleCanvas", keys: ["Ctrl", "Shift", "I"] },
          { label: "shortcuts.openCanvas", keys: ["Ctrl", "O"] },
          { label: "shortcuts.saveCanvas", keys: ["Ctrl", "S"] },
          { label: "shortcuts.undo", keys: ["Ctrl", "Z"] },
          { label: "shortcuts.redo", keys: ["Ctrl", "Y"] },
          { label: "shortcuts.selectAll", keys: ["Ctrl", "A"] },
        ]},
        { title: "shortcuts.group.node", items: [
          { label: "shortcuts.refreshNodeDefs", keys: ["R"] },
          { label: "shortcuts.addFrame", keys: ["Ctrl", "G"] },
          { label: "shortcuts.toggleMute", keys: ["Ctrl", "M"] },
          { label: "shortcuts.toggleBypass", keys: ["Ctrl", "B"] },
        ]},
        { title: "shortcuts.group.queue", items: [
          { label: "shortcuts.runSelected", keys: ["Ctrl", "Enter"] },
          { label: "shortcuts.interruptSelected", keys: ["Ctrl", "Alt", "Enter"] },
        ]},
      ],
    },
    {
      id: "view-controls",
      label: "shortcuts.viewControls",
      groups: [
        { title: "shortcuts.group.view", items: [
          { label: "shortcuts.selectUnlock", keys: ["V"] },
          { label: "shortcuts.panLock", keys: ["H"] },
          { label: "shortcuts.fitView", keys: ["."] },
          { label: "shortcuts.zoomIn", keys: ["Alt", "="] },
          { label: "shortcuts.zoomOut", keys: ["Alt", "-"] },
          { label: "shortcuts.toggleMinimap", keys: ["Alt", "Shift", "M"] },
          { label: "shortcuts.snapToGrid", keys: ["S"] },
          { label: "shortcuts.toggleLinks", keys: ["L"] },
        ]},
        { title: "shortcuts.group.panels", items: [
          { label: "shortcuts.mediaAssets", keys: ["A"] },
          { label: "shortcuts.addNode", keys: ["N"] },
          { label: "shortcuts.loraLibrary", keys: ["M"] },
          { label: "shortcuts.canvasList", keys: ["C"] },
          { label: "shortcuts.canvasSettings", keys: ["Ctrl", ","] },
        ]},
      ],
    },
  ];

  let root = null;
  let screen = null;            // scrolling log viewport
  let titleEl = null;
  let copyBtn = null;
  let closeBtn = null;
  let resizeHandle = null;
  let dragState = null;         // { startY, startH } while resizing
  let opened = false;
  let activePanel = "terminal"; // "terminal" | "shortcuts" (BottomPanel.activePanel)
  let activeShortcutTab = "essentials"; // "essentials" | "view-controls"
  let tabsContainer = null;
  let terminalView = null;      // LOGS content wrapper
  let shortcutsView = null;     // shortcuts content wrapper
  let subscribed = false;
  let listeners = [];           // [[type, fn]] — removed on unmount
  let resyncController = null;
  let lineCount = 0;
  let resizeObserver = null;

  const mk = (tag) => document.createElement(tag);

  /* Publish the distance from the console's TOP edge to the viewport bottom
     so floating widgets pinned bottom-right (minimap / control toolbar) ride
     above it instead of overlapping. This equals height + the 8px bottom
     gutter (native --comfy-canvas-gutter); computing it from the real rect
     (host bottom - console top) keeps it correct when max-height:70% clamps
     the card on short viewports. Reading getBoundingClientRect after the
     .is-open class flip forces the reflow needed for an accurate value. */
  function syncOffset() {
    const host = root && root.parentElement;
    if (!host) return;
    if (!opened) { host.style.removeProperty("--ic-console-h"); return; }
    const gap = Math.round(window.innerHeight - root.getBoundingClientRect().top);
    host.style.setProperty("--ic-console-h", Math.max(0, gap) + "px");
  }

  /* ---- Resizable height (native vertical SplitterResizeHandle) -----------
     ComfyUI's bottom panel lives in a vertical splitter with default [50, 50]
     and the split is persisted to localStorage under SPLIT_STORAGE_KEY as
     [topPercent, bottomPercent]. We mirror that: read the persisted bottom
     percent on mount, apply it as a pixel height, and on drag write it back. */
  function maxPanelHeight() {
    return Math.max(MIN_PANEL_H, Math.round(window.innerHeight * 0.7));
  }
  function loadPersistedHeight() {
    try {
      const raw = JSON.parse(localStorage.getItem(SPLIT_STORAGE_KEY) || "null");
      if (Array.isArray(raw) && raw.length === 2 &&
          raw.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) {
        const bottom = raw[1];
        if (bottom > 0) {
          const h = Math.round((bottom / 100) * window.innerHeight);
          return Math.min(maxPanelHeight(), Math.max(MIN_PANEL_H, h));
        }
      }
    } catch (e) { /* no/invalid storage — fall through to default */ }
    return null;
  }
  function applyHeight(h) {
    if (!root) return;
    const clamped = Math.min(maxPanelHeight(), Math.max(MIN_PANEL_H, Math.round(h)));
    root.style.height = clamped + "px";
    syncOffset();
  }
  function persistHeight() {
    if (!root) return;
    const h = root.getBoundingClientRect().height;
    const bottom = (h / window.innerHeight) * 100;
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify([100 - bottom, bottom]));
    } catch (e) { /* storage unavailable — resize still works this session */ }
  }
  function onResizeStart(e) {
    if (!root || e.button > 0) return;
    e.preventDefault();
    dragState = { startY: e.clientY, startH: root.getBoundingClientRect().height };
    resizeHandle.classList.add("is-dragging");
    /* pointer capture keeps move/up on the handle even outside the panel. */
    try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) { /* no-op */ }
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeEnd);
  }
  function onResizeMove(e) {
    if (!dragState) return;
    /* Dragging the top edge UP grows the panel: delta = startY - currentY. */
    applyHeight(dragState.startH + (dragState.startY - e.clientY));
  }
  function onResizeEnd() {
    if (!dragState) return;
    dragState = null;
    resizeHandle.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
    persistHeight();
  }
  function onResizeKey(e) {
    /* Reka splitter handles are focusable and arrow-key resizable. */
    const step = e.shiftKey ? 40 : 16;
    let delta = 0;
    if (e.key === "ArrowUp") delta = step;
    else if (e.key === "ArrowDown") delta = -step;
    else return;
    e.preventDefault();
    applyHeight((root ? root.getBoundingClientRect().height : MIN_PANEL_H) + delta);
    persistHeight();
  }

  /* ---- ANSI SGR -> styled spans ------------------------------------------
     xterm writes entries as raw strings that may contain CSI SGR sequences.
     We support the colour/bold subset ComfyUI's server logger emits; anything
     else is stripped so control bytes never reach the DOM. */
  function trim() {
    if (lineCount <= MAX_LINES) return;
    const drop = lineCount - MAX_LINES;
    // Remove from the top until `drop` <br> markers are gone.
    let removed = 0;
    while (screen.firstChild && removed < drop) {
      const node = screen.firstChild;
      node.remove();
      if (node.tagName === "BR") removed += 1;
    }
    lineCount = MAX_LINES;
  }

  function renderEntryText(text, fg, bg, bold) {
    const span = mk("span");
    span.textContent = text;
    if (fg) span.style.color = fg;
    if (bg) span.style.backgroundColor = bg;
    if (bold) span.style.fontWeight = "600";
    return span;
  }

  /* Style-correct writer: tracks SGR state and opens a new span whenever the
     style changes, matching xterm's per-cell colours. */
  function writeEntriesStyled(entries) {
    if (!screen || !Array.isArray(entries)) return;
    const text = entries.map((e) => (e && typeof e.m === "string" ? e.m : "")).join("");
    if (!text) return;

    let fg = null, bg = null, bold = false;
    let frag = document.createDocumentFragment();
    let pending = "";
    const emit = () => {
      if (!pending) return;
      frag.appendChild(renderEntryText(pending, fg, bg, bold));
      pending = "";
    };
    const applySGR = (params) => {
      emit();
      const codes = params === "" ? [0] : params.split(";").map((x) => (x === "" ? 0 : parseInt(x, 10)));
      for (const c of codes) {
        if (c === 0) { fg = null; bg = null; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c === 39) fg = null;
        else if (c === 49) bg = null;
        else if (c >= 30 && c <= 37) fg = ANSI_FG[c - 30];
        else if (c >= 90 && c <= 97) fg = ANSI_FG[c - 90 + 8];
        else if (c >= 40 && c <= 47) bg = ANSI_BG[c - 40];
        else if (c >= 100 && c <= 107) bg = ANSI_BG[c - 100 + 8];
      }
    };
    const newLine = () => {
      emit();
      screen.appendChild(frag);
      screen.appendChild(mk("br"));
      frag = document.createDocumentFragment();
      lineCount += 1;
    };

    const re = /\x1b\[([0-9;?]*)([A-Za-z])|\r?\n|\r/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      pending += text.slice(last, m.index);
      if (m[0] === "\n" || m[0] === "\r\n") newLine();
      else if (m[2] === "m") applySGR(m[1]);
      last = m.index + m[0].length;
    }
    pending += text.slice(last);
    emit();
    if (frag.firstChild) screen.appendChild(frag);

    trim();
    screen.scrollTop = screen.scrollHeight;
  }

  function reset() {
    if (screen) screen.replaceChildren();
    lineCount = 0;
  }

  /* ---- host API bridge --------------------------------------------------- */
  function listen(type, fn) {
    const a = api();
    if (!a || typeof a.addEventListener !== "function") return;
    a.addEventListener(type, fn);
    listeners.push([type, fn]);
  }
  function unlisten() {
    const a = api();
    for (const [type, fn] of listeners) {
      try { a?.removeEventListener?.(type, fn); } catch (e) { /* no-op */ }
    }
    listeners = [];
  }

  async function loadLogs() {
    const a = api();
    if (!a || typeof a.getRawLogs !== "function") {
      writeEntriesStyled([{ m: t("console.logServiceError") + "\r\n" }]);
      return;
    }
    const controller = new AbortController();
    resyncController = controller;
    try {
      const logs = await a.getRawLogs();
      if (controller.signal.aborted) return;
      reset();
      writeEntriesStyled(logs?.entries || []);
      if (!subscribed && typeof a.subscribeLogs === "function") {
        await a.subscribeLogs(true);
        subscribed = true;
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.warn("[InfCanvas console] getRawLogs failed", e);
    }
  }

  function bindStream() {
    if (listeners.length) return;
    listen("logs", (e) => writeEntriesStyled(e?.detail?.entries || []));
    listen("reconnected", () => { void loadLogs(); });
  }

  /* ---- DOM --------------------------------------------------------------- */
  function build() {
    const el = mk("div");
    el.id = "infcanvas-console";
    el.className = "ic-console";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", t("console.title"));
    el.setAttribute("data-testid", "infcanvas-console");

    /* Stop canvas gestures (panel sits over the Vue Flow stage). */
    ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((type) => {
      el.addEventListener(type, (e) => e.stopPropagation());
    });

    /* Native BottomPanel.vue: TabsList variant="panel" (border-b, py-2) with a
       tab per bottomPanelStore.bottomPanelTabs and a close button on the right.
       The active tab list depends on which panel is open: terminal -> LOGS;
       shortcuts -> ESSENTIALS + VIEW CONTROLS (useShortcutsTab.ts). */
    const bar = mk("div");
    bar.className = "ic-console-bar";

    tabsContainer = mk("div");
    tabsContainer.className = "ic-console-tabs-container";
    tabsContainer.setAttribute("data-testid", "infcanvas-console-tabs");

    /* flex w-full justify-between: tabs left, close right. */
    const rightOps = mk("div");
    rightOps.className = "ic-console-ops";
    closeBtn = mk("button");
    closeBtn.type = "button";
    closeBtn.className = "ic-console-close";
    closeBtn.innerHTML = '<i class="pi pi-times"></i>';
    closeBtn.addEventListener("click", () => hide());
    rightOps.appendChild(closeBtn);

    bar.append(tabsContainer, rightOps);

    /* Native BaseTerminal.vue: root relative/overflow-hidden/bg-neutral-900;
       inner p-2 xterm host; copy button absolute top-2 right-8, secondary/sm,
       hidden until the terminal root is hovered. */
    terminalView = mk("div");
    terminalView.className = "ic-console-view ic-console-terminal";
    terminalView.setAttribute("data-panel-view", "terminal");
    const termInner = mk("div");
    termInner.className = "ic-console-terminal-inner";
    screen = mk("div");
    screen.className = "ic-console-screen";
    screen.setAttribute("data-testid", "infcanvas-console-screen");
    termInner.appendChild(screen);

    copyBtn = mk("button");
    copyBtn.type = "button";
    copyBtn.className = "ic-console-copy";
    copyBtn.innerHTML = '<i class="pi pi-copy"></i>';
    copyBtn.addEventListener("click", copyAll);
    terminalView.append(termInner, copyBtn);
    /* Hover state drives the copy button's opacity, exactly like useElementHover
       on BaseTerminal's rootEl. */
    terminalView.addEventListener("mouseenter", () => terminalView.classList.add("is-hovered"));
    terminalView.addEventListener("mouseleave", () => terminalView.classList.remove("is-hovered"));

    /* Shortcuts panel — EssentialsPanel / ViewControlsPanel both mount the same
       ShortcutsList.vue. We build both tab contents up front and toggle them. */
    shortcutsView = mk("div");
    shortcutsView.className = "ic-console-view ic-console-shortcuts";
    shortcutsView.setAttribute("data-panel-view", "shortcuts");
    shortcutsView.setAttribute("data-testid", "infcanvas-console-shortcuts");
    for (const panelDef of SHORTCUT_PANELS) {
      const pane = mk("div");
      pane.className = "ic-shortcuts-pane";
      pane.dataset.shortcutTab = panelDef.id;
      const list = mk("div");
      list.className = "ic-shortcuts-list flex justify-center";
      const grid = mk("div");
      grid.className = "ic-shortcuts-columns grid";
      grid.setAttribute("data-testid", "shortcuts-columns");
      for (const group of panelDef.groups) {
        const col = mk("div");
        col.className = "ic-shortcuts-group flex flex-col";
        const h3 = mk("h3");
        h3.className = "ic-shortcuts-subtitle";
        h3.textContent = t(group.title);
        h3.dataset.i18n = group.title;
        col.appendChild(h3);
        const rows = mk("div");
        rows.className = "ic-shortcuts-items flex flex-col";
        for (const item of group.items) {
          const row = mk("div");
          row.className = "ic-shortcut-item flex items-center justify-between";
          const name = mk("div");
          name.className = "ic-shortcut-name";
          name.textContent = t(item.label);
          name.dataset.i18n = item.label;
          const combo = mk("div");
          combo.className = "ic-keybinding-combo flex gap-1";
          combo.dataset.i18nAria = "shortcuts.keyboardShortcuts";
          combo.dataset.keys = item.keys.join(" + ");
          combo.setAttribute("aria-label", t("shortcuts.keyboardShortcuts") + ": " + item.keys.join(" + "));
          for (const key of item.keys) {
            const badge = mk("span");
            badge.className = "ic-key-badge";
            badge.textContent = fmtKey(key);
            combo.appendChild(badge);
          }
          row.append(name, combo);
          rows.appendChild(row);
        }
        col.appendChild(rows);
        grid.appendChild(col);
      }
      list.appendChild(grid);
      pane.appendChild(list);
      shortcutsView.appendChild(pane);
    }

    /* Native vertical SplitterResizeHandle between the graph and bottom panel:
       1px hairline with a larger (4px) hit area, turns primary on hover/drag.
       Dragging it resizes this panel and persists the split (see resize fns). */
    resizeHandle = mk("div");
    resizeHandle.className = "ic-console-resize-handle";
    resizeHandle.setAttribute("role", "separator");
    resizeHandle.setAttribute("aria-orientation", "horizontal");
    resizeHandle.setAttribute("data-testid", "infcanvas-console-resize");
    resizeHandle.setAttribute("tabindex", "0");
    resizeHandle.addEventListener("pointerdown", onResizeStart);
    resizeHandle.addEventListener("keydown", onResizeKey);

    el.append(resizeHandle, bar, terminalView, shortcutsView);
    return el;
  }

  /* Rebuild the tab strip for the current panel (BottomPanel.vue iterates
     bottomPanelStore.bottomPanelTabs). Terminal shows one muted, non-clickable
     LOGS trigger; shortcuts shows two clickable triggers with the active pill. */
  function renderTabs() {
    if (!tabsContainer) return;
    tabsContainer.replaceChildren();
    if (activePanel === "terminal") {
      const tab = mk("div");
      tab.className = "ic-console-tab is-solo";
      tab.setAttribute("data-state", "active");
      tab.setAttribute("data-testid", "infcanvas-console-tab-logs");
      titleEl = mk("span");
      titleEl.className = "font-normal";
      titleEl.textContent = t("console.logs").toUpperCase();
      tab.appendChild(titleEl);
      tabsContainer.appendChild(tab);
      return;
    }
    titleEl = null;
    for (const def of SHORTCUT_PANELS) {
      const tab = mk("button");
      tab.type = "button";
      tab.className = "ic-console-tab";
      tab.setAttribute("data-state", def.id === activeShortcutTab ? "active" : "inactive");
      tab.setAttribute("data-testid", "infcanvas-console-tab-" + def.id);
      tab.dataset.shortcutTab = def.id;
      const span = mk("span");
      span.className = "font-normal";
      span.textContent = t(def.label);
      span.dataset.i18n = def.label;
      tab.appendChild(span);
      tab.addEventListener("click", () => {
        if (activeShortcutTab === def.id) return;
        activeShortcutTab = def.id;
        renderTabs();
        renderPanel();
        repaintLocale();
      });
      tabsContainer.appendChild(tab);
    }
  }

  /* Show exactly one content view and sync the tab-specific header controls. */
  function renderPanel() {
    if (!root) return;
    root.setAttribute("data-panel", activePanel);
    /* Use an explicit value, not "" — clearing inline display would fall back
       to the stylesheet's display:none on the shortcuts view. */
    if (terminalView) terminalView.style.display = activePanel === "terminal" ? "block" : "none";
    if (shortcutsView) {
      shortcutsView.style.display = activePanel === "shortcuts" ? "block" : "none";
      for (const pane of shortcutsView.children) {
        pane.style.display = pane.dataset.shortcutTab === activeShortcutTab ? "block" : "none";
      }
    }
    syncOffset();
  }

  async function copyAll() {
    const text = screen ? screen.innerText : "";
    try { await navigator.clipboard.writeText(text); }
    catch (e) { /* clipboard may be unavailable in insecure context */ }
  }

  function syncButton() {
    /* Both rail buttons reflect the active BottomPanel panel; only one can be
       selected at a time (native activePanel is a single value). */
    const consoleBtn = document.querySelector('#infcanvas-sidebar [data-key="console"]');
    if (consoleBtn) consoleBtn.classList.toggle("side-bar-button-selected", opened && activePanel === "terminal");
    const shortcutsBtn = document.querySelector('#infcanvas-sidebar [data-key="shortcuts"]');
    if (shortcutsBtn) shortcutsBtn.classList.toggle("side-bar-button-selected", opened && activePanel === "shortcuts");
  }

  /* ComfyUI bottomPanelStore.setPanel / togglePanel: opening one panel closes
     the other; clicking the active one again closes it. */
  function setPanel(panel) {
    if (!root) return;
    activePanel = panel === "shortcuts" ? "shortcuts" : "terminal";
    root.classList.add("is-open");
    opened = true;
    renderTabs();
    renderPanel();
    syncButton();
    repaintLocale();
    if (activePanel === "terminal") { bindStream(); void loadLogs(); }
  }
  function show() { setPanel("terminal"); }
  function hide() {
    if (!root) return;
    root.classList.remove("is-open");
    opened = false;
    syncButton();
    syncOffset();
  }
  /* toggle(panel) — native SidebarShortcutsToggleButton calls
     bottomPanelStore.togglePanel('shortcuts'); console calls it with no arg.
     No arg keeps the legacy behaviour: toggle whatever panel is active. */
  function toggle(panel) {
    if (!opened) { setPanel(panel || "terminal"); return; }
    if (panel) {
      if (activePanel === (panel === "shortcuts" ? "shortcuts" : "terminal")) hide();
      else setPanel(panel);
    } else {
      hide();
    }
  }

  function mount(parent) {
    if (root && root.isConnected) return root;
    root = build();
    (parent || document.getElementById("infcanvas-root") || document.body).appendChild(root);
    const savedH = loadPersistedHeight();
    if (savedH) root.style.height = savedH + "px";
    renderTabs();
    renderPanel();
    repaintLocale();
    /* Subscribe to the stream even while hidden so opening shows live lines
       immediately; the initial snapshot is (re)loaded on first open. */
    bindStream();
    /* Keep the offset correct when the viewport shrinks and max-height:70%
       clamps the panel, or when its height is otherwise changed. */
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { if (opened) syncOffset(); });
      resizeObserver.observe(root);
    }
    return root;
  }

  function unmount() {
    if (resyncController) { resyncController.abort(); resyncController = null; }
    unlisten();
    subscribed = false;
    if (dragState) onResizeEnd();
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (root && root.parentElement) root.parentElement.style.removeProperty("--ic-console-h");
    if (root) { root.remove(); root = null; }
    screen = null; titleEl = null; copyBtn = null; closeBtn = null; resizeHandle = null;
    tabsContainer = null; terminalView = null; shortcutsView = null;
    opened = false; lineCount = 0; activePanel = "terminal"; activeShortcutTab = "essentials";
  }

  function repaintLocale() {
    if (!root) return;
    root.setAttribute("aria-label", t(activePanel === "shortcuts" ? "shortcuts.title" : "console.title"));
    if (titleEl) titleEl.textContent = t("console.logs").toUpperCase();
    if (copyBtn) bindTip(copyBtn, () => t("console.copyLogs"));
    if (closeBtn) bindTip(closeBtn, () => t("console.close"));
    /* Repaint every i18n-tagged node inside the dynamic tabs + shortcut grid. */
    const nodes = root.querySelectorAll("[data-i18n]");
    for (const node of nodes) node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll("[data-i18n-aria]"))
      node.setAttribute("aria-label", t(node.dataset.i18nAria) + ": " + (node.dataset.keys || ""));
  }

  NS.consolePanel = {
    mount, unmount, show, hide, toggle, setPanel, repaintLocale,
    writeEntries: writeEntriesStyled,
    isOpen: () => opened,
    activePanel: () => activePanel,
  };
})();
