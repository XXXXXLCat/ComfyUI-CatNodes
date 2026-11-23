/* UI layer: a standalone canvas-mode shell (tab bar + left rail + drawer panel
   + graph stage). None of these elements live inside ComfyUI's own sidebar or
   topbar: they are mounted under #infcanvas-root, a sibling of #vue-app. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* Native ComfyUI tooltip (shared engine in native-tip.js). Replaces every
     `el.title = ...` so the bubble is the host's themed Reka tooltip, not the
     browser's unthemeable black title bubble. Fallback keeps `title` if the
     shared module has not loaded yet (ComfyUI loads web modules in parallel). */
  const bindTip = (el, text, side) => {
    if (!el) return el;
    if (NS.tip?.bindTip) return NS.tip.bindTip(el, text, side);
    return el; // native-tip.js is always installed; no browser title fallback
  };
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* A few labels/tooltips are computed at call time (e.g. tooltips that wrap
     t(...)): pass a function and resolve it at render + every locale repaint,
     same as a normal dictionary key. The language switch now lives in the settings
     dialog, so the sidebar no longer has a functional label for the target language,
     though tips still generally use the function form. */
  const displayOf = (value) => (typeof value === "function" ? value() : t(value));
  const st = () => NS.state;
  const api = () => NS.api;
  const backend = () => NS.backend;
  const esc = (value) => api()?.esc ? api().esc(value) : String(value ?? "");
  /* The rail's top slot is the Infinite Canvas brand mark, not a control: the
     same white/orange logo as the ComfyUI top-bar entry (canvas-logo.svg). */
  const CANVAS_LOGO_URL = new URL("./canvas-logo.svg", import.meta.url).href;

  /* Native ComfyUI class strings, copied verbatim from the frontend sources
     (searchInput.variants.ts + SearchInput.vue + button.variants.ts). The shell
     is mounted in the host document (#infcanvas-root is a sibling of #vue-app),
     so these UnoCSS classes apply directly — the same way the rail's native
     side-bar-button classes already do. Only layout/state hooks (.ic-*) stay
     custom; all visual styling comes from the host stylesheet. */
  const NATIVE_SEARCH_ANCHOR =
    "relative flex shrink-0 w-full cursor-text items-center rounded-lg bg-secondary text-foreground " +
    "focus-within:ring-1 focus-within:ring-ring h-8 px-2 py-1.5";
  const NATIVE_SEARCH_ICON =
    "pointer-events-none absolute left-2.5 size-4 icon-[lucide--search]";
  const NATIVE_SEARCH_INPUT =
    "size-full border-none bg-transparent outline-none pl-8 text-xs";
  /* Button variant=textonly size=icon-sm, used by SearchInput's clear slot. */
  const NATIVE_BTN_TEXTONLY_ICON =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center justify-center " +
    "gap-2 rounded-md border-none font-inter text-sm font-medium whitespace-nowrap transition-colors " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none " +
    "disabled:opacity-50 bg-transparent text-foreground hover:bg-accent size-5 p-0";
  /* SelectTrigger.vue size=md border=none, verbatim from the native source. */
  const NATIVE_SELECT_TRIGGER =
    "flex w-full cursor-pointer items-center justify-between select-none " +
    "h-8 px-3 py-1 text-xs rounded-lg bg-secondary text-foreground " +
    "transition-all duration-200 ease-in-out hover:bg-accent " +
    "border-[2.5px] border-solid border-transparent focus:border-border " +
    "data-[state=open]:border-border focus:outline-none " +
    "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-secondary";
  const NATIVE_SELECT_CHEVRON = "icon-[lucide--chevron-down] shrink-0 text-muted-foreground";
  /* Browse lightbox follows MediaLightbox.vue (same one the 资产 panel uses):
     overlay bg-black/90, secondary icon-lg close rounded-full, bare media. */
  const NATIVE_BTN_BASE =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center " +
    "justify-center gap-2 border-none font-inter text-sm font-medium whitespace-nowrap " +
    "transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0";
  /* cn() in the host drops Button base's `relative` when placement adds
     `absolute`; do the same here or the two collide and CSS order leaves the
     button in normal flow instead of top-4 right-4. */
  const NATIVE_BTN_CLOSE_LG =
    NATIVE_BTN_BASE.replace("relative ", "") +
    " size-10 rounded-full bg-secondary text-foreground hover:bg-accent";
  /* MediaLightbox.vue prev/next use the same secondary icon-lg rounded-full
     Button as close; only placement differs (handled by .ic-lora-lb-prev/next). */
  const NATIVE_BTN_NAV =
    NATIVE_BTN_BASE.replace("relative ", "") +
    " size-10 rounded-full bg-secondary text-foreground hover:bg-accent";
  /* Lightbox scrim is the fixed bg-black/90 from MediaLightbox.vue, so its
     caption must use text-white (as ComfyUI does for text on dark surfaces,
     e.g. BoundingBoxesEditor bg-black/90 text-white). text-foreground would
     turn black under the light theme and vanish against the black scrim. */
  const NATIVE_LB_NAME = "truncate text-sm/normal font-normal text-white";

  /* Canvas manager (workflows sidebar) native class strings, verbatim from the
     host sources: treeStyles.ts + TreeItem.vue + TreeExplorer.vue +
     TreeExplorerTreeNode.vue + WorkflowTreeLeaf.vue + TextDivider.vue +
     NoResultsPlaceholder.vue + button.variants.ts. The panel is mounted in the
     host document (#infcanvas-root is a sibling of #vue-app), so these UnoCSS
     classes apply directly; only layout/state hooks (.ic-*) stay custom. */
  /* treeItemClass from treeStyles.ts — the outer UiTreeItem row. `level=1`
     indent (treeItemIndent) is 8px, applied inline below. data-selected:bg-muted
     needs a real data-selected attribute (set on the row when active). */
  const NATIVE_TREE_ROW =
    "group/tree-node flex w-full min-w-0 cursor-pointer items-center gap-3 " +
    "rounded-sm py-(--tree-item-padding,--spacing(2)) pr-2 text-sm text-foreground " +
    "outline-none select-none hover:bg-accent focus-visible:bg-accent data-selected:bg-muted";
  /* TreeExplorer.vue: icon wrapper + leaf icon. getTreeNodeIcon() leaf = pi-file. */
  const NATIVE_TREE_ICON_WRAP = "relative size-4 shrink-0";
  const NATIVE_TREE_ICON = "tree-explorer-node-icon size-4 text-muted-foreground";
  /* TreeItem.vue: leaf rows reserve a size-5 chevron placeholder BEFORE the icon. */
  const NATIVE_TREE_CHEVRON = "size-5 shrink-0";
  /* TreeExplorer.vue: flex-1 host that wraps the tree-node after the icon. */
  const NATIVE_TREE_NODE_HOST = "flex min-w-0 flex-1 items-center";
  /* TreeExplorerTreeNode.vue: node > content(label) + actions(bookmark). */
  const NATIVE_TREE_NODE = "tree-node flex w-full items-center justify-between rounded-sm";
  const NATIVE_TREE_CONTENT = "flex min-w-0 flex-1 items-center";
  const NATIVE_TREE_LABEL = "node-label block min-w-0 truncate";
  const NATIVE_TREE_ACTIONS =
    "node-actions flex gap-1 motion-safe:opacity-0 " +
    "motion-safe:group-focus-within/tree-node:opacity-100 " +
    "motion-safe:group-hover/tree-node:opacity-100 touch:opacity-100";
  /* WorkflowTreeLeaf.vue: Button variant=muted-textonly size=icon-sm + pi. */
  const NATIVE_BTN_MUTED_ICON_SM =
    NATIVE_BTN_BASE.replace("relative ", "") +
    " bg-transparent text-muted-foreground hover:bg-accent size-5 p-0";
  const NATIVE_BOOKMARK_ICON = "size-3.5";
  /* TextDivider.vue (type=dashed, position=left) + BaseWorkflowsSidebarTab's ml-2. */
  const NATIVE_DIVIDER = "flex items-center ml-2";
  const NATIVE_DIVIDER_LABEL = "mr-2 shrink-0";
  const NATIVE_DIVIDER_LINE = "grow border-0 border-t border-dashed";
  /* NoResultsPlaceholder.vue (icon/title/message parts). */
  const NATIVE_EMPTY = "h-full p-8";
  const NATIVE_EMPTY_INNER = "flex flex-col items-center bg-(--surface-ground) text-center";
  const NATIVE_EMPTY_ICON = "mb-4 text-5xl";
  const NATIVE_EMPTY_TITLE = "mb-2 text-foreground";
  const NATIVE_EMPTY_MSG = "mb-4 text-center whitespace-pre-line";
  /* selectContentClass + selectItemVariants(single) from select.variants.ts. */
  const NATIVE_SELECT_CONTENT =
    "z-overlay overflow-hidden rounded-lg p-2 bg-background text-foreground border border-solid shadow-md";
  const NATIVE_SELECT_ITEM =
    "relative flex w-full cursor-pointer items-center justify-between gap-3 " +
    "rounded-sm py-3 text-sm select-none focus:bg-accent";
  /* menuStyles.ts, verbatim — surface/items/separator of ComfyUI's own menu. */
  const NATIVE_MENU_CONTENT =
    "z-overlay min-w-48 overflow-y-auto rounded-lg border bg-background " +
    "p-1 text-foreground shadow-lg outline-none";
  const NATIVE_MENU_ITEM =
    "flex min-h-8 cursor-default items-center gap-2 rounded-md px-3 py-1.5 " +
    "text-sm outline-none data-disabled:opacity-50 data-highlighted:bg-accent " +
    "w-full justify-start border-0 bg-transparent text-left hover:bg-accent " +
    "focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50";
  const NATIVE_MENU_SEP = "my-1 h-px bg-border/50";
  /* OverlayIcon.vue: 8-way dark outline keeps the 0.5em sub-glyph legible
     where it overlaps the main glyph, in both light and dark host themes. */
  const OVERLAY_SUB_TEXT_SHADOW = [
    "-1px -1px 0 rgba(0,0,0,.7)", "1px -1px 0 rgba(0,0,0,.7)",
    "-1px 1px 0 rgba(0,0,0,.7)", "1px 1px 0 rgba(0,0,0,.7)",
    "-1px 0 0 rgba(0,0,0,.7)", "1px 0 0 rgba(0,0,0,.7)",
    "0 -1px 0 rgba(0,0,0,.7)", "0 1px 0 rgba(0,0,0,.7)",
  ].join(", ");
  /* Shared with tools.js, which builds its own menu DOM in its own scope. */
  NS.NATIVE_MENU = {
    content: NATIVE_MENU_CONTENT,
    item: NATIVE_MENU_ITEM,
    sep: NATIVE_MENU_SEP,
  };
  /* MediaAssetSettingsMenu.vue view switcher (the 资产 panel's search-row
     button + list/grid popover), reused for the LoRA library so both panels
     expose the same control. Popover.vue content + arrow are the real source
     (NOT menuStyles.ts): p-2 / border-border/50 / shadow-sm, no min-width. */
  const NATIVE_BTN_SECONDARY_ICON =
    NATIVE_BTN_BASE + " size-8 rounded-lg bg-secondary text-foreground hover:bg-accent";
  const NATIVE_VIEW_ITEM =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center " +
    "justify-between gap-2 rounded-lg border-none font-inter text-xs font-medium " +
    "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring " +
    "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 " +
    "w-full bg-transparent text-foreground hover:bg-accent h-8 p-2";
  const NATIVE_POPOVER_CONTENT =
    "z-overlay rounded-lg border border-border/50 bg-background p-2 shadow-sm " +
    "will-change-[transform,opacity] text-foreground";
  const NATIVE_POPOVER_ARROW_SVG =
    '<svg width="10" height="5" viewBox="0 0 12 6" preserveAspectRatio="none" ' +
    'class="fill-background stroke-border/50" style="display:block">' +
    '<path d="M0 0L6 6L12 0"></path></svg>';

  /* Icons come from ComfyUI 1.59.1 source:
     src/composables/sidebarTabs/useNodeLibrarySidebarTab.ts -> icon-[comfy--node]
     .../useAssetsSidebarTab.ts -> icon-[comfy--image-ai-edit]
     .../useNodeLibrarySidebarTab.ts -> icon-[comfy--node]
     .../useWorkflowsSidebarTab.ts -> icon-[comfy--workflow]
     .../useModelLibrarySidebarTab.ts -> icon-[comfy--ai-model]
     src/platform/workflow/management/composables/useAppsSidebarTab.ts
       -> icon-[lucide--panels-top-left] (the ComfyUI Apps icon) */
  /* label/tip are i18n source keys (Chinese); resolved through t() at render
     and on every language change so the rail never shows a stale language. */
  const SIDEBAR_ITEMS = [
    /* Job history — mirror of ComfyUI's core job-history sidebar tab
       (useJobHistorySidebarTab.ts: icon-[lucide--history], id job-history).
       Placed first, straight below the canvas logo in the rail. */
    { key: "job-history", icon: "icon-[lucide--history]", label: "core.jobHistory", tip: () => t("core.jobHistory") },
    /* Gallery — the panel itself is the same history-gallery builder used by
       ComfyUI's own sidebar tab (setPanel -> NS.galleryPanel.mount). */
    { key: "gallery", icon: "icon-[comfy--image-ai-edit]", label: "sidebar.assets", tip: () => t("shortcuts.mediaAssets") + " (a)" },
    { key: "nodes", icon: "icon-[comfy--node]", label: "shortcuts.group.node", tip: () => t("shortcuts.addNode") + " (n)" },
    /* LoRA library: auto-grouped by subfolder, same-stem previews; drag onto the canvas
       to create a LoRA node or onto a LoRA stack to append. Icon follows ComfyUI's model. */
    { key: "lora", icon: "icon-[comfy--ai-model]", label: "panel.lora", tip: () => t("shortcuts.loraLibrary") + " \u00a0(m)" },
    { key: "canvases", icon: "icon-[comfy--workflow]", label: "sidebar.canvas", tip: () => t("shortcuts.canvasList") + " (c)" },
    /* Saved prompts: a small per-account snippet library in its own drawer,
       placed right above 收藏. */
    { key: "prompts", icon: "icon-[lucide--text]", label: "field.prompt", tip: "media.savedPrompts" },
    /* Favorites: icon follows ComfyUI's template icon. 2026-11-21: config moved to the
       bottom toolbar (above the console), no longer in the main button group. */
    { key: "media", icon: "icon-[comfy--template]", label: "media.favorites", tip: () => t("sidebar.savedAssets") },
    /* Settings left the main button group; built separately and mounted in the bottomToolbar group. */
  ];
  const PANEL_TITLES = {
    gallery: "shortcuts.mediaAssets", nodes: "shortcuts.addNode", media: "media.favorites", prompts: "media.savedPrompts", canvases: "sidebar.canvasManage",
    lora: "panel.loraLibrary", "job-history": "core.jobHistory",
  };
  /* "停靠的作业历史" is a persistent preference (one source of truth shared
     by the rail and the active-task capsule). The job-history rail button is
     only shown while docked; when undocked the tab disappears from the rail. */
  const DOCK_PREF = "InfCanvas.JobHistoryDocked";
  const isJobHistoryDocked = () => !!NS.prefs?.get?.(DOCK_PREF, false);

  function syncJobHistoryRail() {
    const shell = st().shell;
    const btn = shell?.buttons?.get("job-history");
    if (btn) btn.style.display = isJobHistoryDocked() ? "" : "none";
  }

  function setJobHistoryDocked(on) {
    NS.prefs?.set?.(DOCK_PREF, !!on);
    syncJobHistoryRail();
    /* Undocking also closes the tab if it was the active panel. */
    if (!on && st().panelKey === "job-history") setPanel(null);
  }
  /* Cleanup returned by NS.galleryPanel.mount — the gallery installs global
     listeners and body-portaled popovers, so it must be torn down on switch. */
  let galleryCleanup = null;
  /* Set when switching into the canvas panel so renderCanvasList can mirror
     BaseWorkflowsSidebarTab's onMounted search focus exactly once. */
  let focusCanvasSearch = false;

  /* Resizable drawer, copied from ComfyUI 1.59.1 (frontend sourcesContent):
     - LiteGraphCanvasSplitterOverlay.vue / SplitterResizeHandle.vue:
       a SplitterResizeHandle sits between the side panel and the graph,
       role=separator / tabindex=0 / data-state=inactive|hover|drag,
       1px line with a 4px ::after hit area, bg-border/50 -> bg-primary on
       hover/drag, inline touch-action:none + user-select:none.
     - usePanelSizing.ts: the panel width in PIXELS is captured on drag start
       and written to localStorage on drag end (100ms debounce via
       splitterPersistence.ts); the same value is restored on open.
     - splitterConstants: SIDEBAR_MIN_WIDTH (= default, measured 311.5px),
       CENTER_PANEL_MIN_WIDTH (graph keeps ~160px), SIDE_PANEL_SIZE=20.4
       (measured data-panel-size="20.4").
     - reka-ui calculate.js: ArrowLeft/Right ±10% of group (Shift 100%),
       Home/End jump to min/max.
     All visuals come from the host's own classes/stylesheet; no CSS copied. */
  const SIDEBAR_MIN_WIDTH = 312;
  const CENTER_PANEL_MIN_WIDTH = 160;
  const SIDE_PANEL_SIZE = 20.4;
  const PANEL_WIDTH_KEY = "InfCanvas.Sidebar.LeftWidth";
  const HANDLE_CLASSES = [
    "relative z-10 flex w-px shrink-0 items-center justify-center bg-border",
    "outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-1",
    "after:-translate-x-1/2 hover:bg-primary data-[state=drag]:bg-primary",
    "focus-visible:ring-1 focus-visible:ring-ring cursor-ew-resize",
    "pointer-events-auto bg-border/50",
  ].join(" ");

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  /* Native ComfyUI icon classes. The host bundle inlines the Iconify SVG at
     build time (UnoCSS preset-icons), so `icon-[lucide--*]` is the only way to
     get the exact host glyph/stroke weight — no hand-inlined SVG paths here.
     image / film / volume-2 / message-square-text mirror the host's own
     add-node menu glyphs; all four are verified inlined in the bundled CSS.
     layers-3 / merge are NOT in the shipped lucide subset, so lora/text_merge
     fall back to the closest shipped glyphs layers / diff. */
  const NODE_ICON_OF = {
    text: "icon-[lucide--message-square-text]",
    image: "icon-[lucide--image]",
    video: "icon-[lucide--film]",
    audio: "icon-[lucide--volume-2]",
    omni: "icon-[lucide--sparkles]",
    lora: "icon-[lucide--layers]",
    text_merge: "icon-[lucide--diff]",
    cleanup_vram: "icon-[lucide--zap]",
    cleanup_ram: "icon-[lucide--zap]",
    cleanup_both: "icon-[lucide--zap]",
    upload: "icon-[lucide--upload]",
  };
  const nodeIconHtml = (kind, extra) =>
    '<i class="' + (NODE_ICON_OF[kind] || "icon-[lucide--image]")
    + ' size-4 shrink-0' + (extra ? " " + extra : "") + '"></i>';
  /* treeStyles.ts treeItemClass — the row class ComfyUI's own node-library
     sidebar uses. Mounted verbatim on our add-node rows instead of the old
     hand-drawn .ic-item surface. */
  const NATIVE_TREE_ITEM =
    "group/tree-node flex w-full min-w-0 cursor-pointer items-center gap-3 " +
    "rounded-sm py-(--tree-item-padding,--spacing(2)) pr-2 text-sm text-foreground " +
    "outline-none select-none hover:bg-accent focus-visible:bg-accent data-selected:bg-muted";

  function injectStyles() {
    if (!NS.css || document.querySelector("#infcanvas-style")) return;
    const style = document.createElement("style");
    style.id = "infcanvas-style";
    style.textContent = NS.css;
    document.head.appendChild(style);
  }

  function attachPanelResizer(shell, handle) {
    const bounds = () => {
      const rail = shell.sidebar.getBoundingClientRect().width || 56;
      return {
        min: SIDEBAR_MIN_WIDTH,
        max: Math.max(SIDEBAR_MIN_WIDTH,
          window.innerWidth - rail - CENTER_PANEL_MIN_WIDTH - 1),
        group: Math.max(1, window.innerWidth - rail),
      };
    };
    let width = SIDEBAR_MIN_WIDTH;
    let saveTimer = 0;
    let drag = null;

    const apply = (px) => {
      const { min, max } = bounds();
      width = Math.max(min, Math.min(max, Math.round(px)));
      shell.root.style.setProperty("--infcanvas-panel-width", width + "px");
      return width;
    };
    const save = () => {
      NS.prefs?.set(PANEL_WIDTH_KEY, width);
    };
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 100);
    };

    try {
      const stored = Number(NS.prefs?.get(PANEL_WIDTH_KEY, null));
      const rail = shell.sidebar.getBoundingClientRect().width || 56;
      const fallback = Math.max(SIDEBAR_MIN_WIDTH,
        Math.round((SIDE_PANEL_SIZE / 100) * (window.innerWidth - rail)));
      apply(Number.isFinite(stored) && stored > 0 ? stored : fallback);
    } catch (error) {
      apply(SIDEBAR_MIN_WIDTH);
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !st().panelKey) return;
      event.preventDefault();
      event.stopPropagation();
      try { handle.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      drag = { x: event.clientX, width };
      handle.dataset.state = "drag";
      shell.root.classList.add("is-resizing");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag) return;
      event.preventDefault();
      apply(drag.width + (event.clientX - drag.x));
    });
    const finish = () => {
      if (!drag) return;
      drag = null;
      handle.dataset.state = "hover";
      shell.root.classList.remove("is-resizing");
      scheduleSave();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("pointerenter", () => {
      if (!drag) handle.dataset.state = "hover";
    });
    handle.addEventListener("pointerleave", () => {
      if (!drag) handle.dataset.state = "inactive";
    });
    handle.addEventListener("keydown", (event) => {
      const { min, max, group } = bounds();
      const step = (event.shiftKey ? 100 : 10) / 100 * group;
      let next;
      switch (event.key) {
        case "ArrowRight": next = width + step; break;
        case "ArrowLeft": next = width - step; break;
        case "End": next = max; break;
        case "Home": next = min; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      apply(next);
      scheduleSave();
    });

    const onWindowResize = () => apply(width);
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      clearTimeout(saveTimer);
      save(); // onBeforeUnmount(flushLayouts) in LiteGraphCanvasSplitterOverlay.vue
      shell.root.classList.remove("is-resizing");
    };
  }

  /* --------------------------- standalone shell --------------------------- */

  function mountShell() {
    if (st().shell) return st().shell;
    const root = node("div");
    root.id = "infcanvas-root";
    root.setAttribute("data-testid", "infcanvas-root");

    /* Native .workflow-tabs-container carries `shadow-md`; hang the same class
       here so the tab bar's shadow onto the rail/drawer/canvas is the host's
       own token (dark/light following) instead of a hard-coded box-shadow. */
    const tabbar = node("header", "shadow-md");
    tabbar.id = "infcanvas-tabbar";
    root.appendChild(tabbar);

    const body = node("div");
    body.id = "infcanvas-body";

    /* SideToolbar.vue + SidebarIcon.vue: reuse the exact host classes so the
       host's own stylesheet (button variants, --sidebar-* tokens, selected /
       hover rules) styles the rail. No copied pixel values here. */
    const sidebar = node("nav",
      "side-tool-bar-container flex h-full flex-col items-center bg-transparent " +
      "transition-[max-width,opacity,transform] duration-300 ease-in-out " +
      "connected-sidebar pointer-events-auto overflow-hidden border-r border-border/50 shadow-md");
    sidebar.id = "infcanvas-sidebar";
    sidebar.setAttribute("data-testid", "infcanvas-sidebar");
    /* SideToolbar.vue: :style="{ maxWidth: isHidden ? '0px' : 'var(--sidebar-width)' }" */
    sidebar.style.maxWidth = "var(--sidebar-width)";
    const group = node("div",
      "sidebar-item-group flex shrink-0 flex-col items-center overflow-hidden border border-transparent");
    sidebar.appendChild(group);
    /* Logo slot: plain <div>/<img>, never a <button>. No click, no tooltip,
       no i18n label — it is branding only. In the top monitor strip the same
       logo is merged with the "sidebar.exitCanvas" label into one exit chip. */
    const logoSlot = node("div", "ic-side-logo");
    logoSlot.setAttribute("aria-hidden", "true");
    // Mask + currentColor (same as the top-bar canvas entry): the raw SVG has
    // white strokes/fills that vanish on a light rail. A mask paints the whole
    // mark with the host foreground, so it stays visible in dark AND light
    // themes instead of shipping a fixed two-tone bitmap.
    const logoMark = node("span");
    logoMark.style.cssText =
      "display:block;width:40px;height:24px;color:var(--foreground,#ffffff);" +
      "background-color:currentColor;" +
      "-webkit-mask:url('" + CANVAS_LOGO_URL + "') center/contain no-repeat;" +
      "mask:url('" + CANVAS_LOGO_URL + "') center/contain no-repeat;";
    logoSlot.appendChild(logoMark);
    group.appendChild(logoSlot);
    const buttons = new Map();
    const sideRefs = new Map();   // key -> { label, item, button } (tooltip is a live bindTip function)
    const makeSideButton = (item) => {
      const button = node("button",
        "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
        "items-center justify-center gap-2 border-none font-inter font-medium " +
        "whitespace-nowrap transition-colors focus-visible:ring-1 " +
        "focus-visible:ring-ring focus-visible:outline-none " +
        "disabled:pointer-events-none disabled:opacity-50 " +
        "bg-transparent text-muted-foreground hover:bg-accent " +
        "side-bar-button h-(--sidebar-item-height) w-(--sidebar-width) " +
        "shrink-0 rounded-none p-2 text-xs ic-side-btn");
      button.type = "button";
      button.dataset.key = item.key;
      button.setAttribute("aria-label", displayOf(item.tip));
      const content = node("div", "side-bar-button-content flex flex-col items-center gap-2");
      const iconWrap = node("div", "sidebar-icon-wrapper relative");
      iconWrap.appendChild(node("i", item.icon + " side-bar-button-icon"));
      content.appendChild(iconWrap);
      const labelEl = node("span",
        "side-bar-button-label line-clamp-2 w-max " +
        "max-w-[calc(var(--sidebar-width)-var(--sidebar-padding))] " +
        "text-center text-2xs leading-none wrap-break-word whitespace-normal",
        displayOf(item.label));
      content.appendChild(labelEl);
      button.appendChild(content);
      /* Native ComfyUI tooltip (Reka) on the right, matching the host's own
         "模板"-style bubble: themed + arrow. Function form keeps the label
         live across language switches without a repaint hook. */
      bindTip(button, () => displayOf(item.tip), "right");
      sideRefs.set(item.key, { label: labelEl, item, button });
      return button;
    };
    for (const item of SIDEBAR_ITEMS) {
      const button = makeSideButton(item);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePanel(item.key);
      });
      group.appendChild(button);
      buttons.set(item.key, button);
    }

    /* Bottom toolbar group: SideToolbar.vue's bottomToolbarRef — the second `sidebar-item-group`
       with `mt-auto` in an h-full flex column, absorbing all remaining height. 2026-11-21: the
       language switch moved into settings; config moved here from the main group, now at the
       top. Order: config / console / shortcuts / settings. */
    const langGroup = node("div",
      "sidebar-item-group mt-auto flex shrink-0 flex-col items-center overflow-hidden border border-transparent");
    sidebar.appendChild(langGroup);

    /* Config: moved here from the main group, top of the bottom group (above console).
       Icon changed to icon-[lucide--sliders-horizontal] per the user screenshot. Click opens it. */
    const apiItem = { key: "api", icon: "icon-[lucide--sliders-horizontal]", label: "sidebar.config", tip: () => t("sidebar.apiConfig") };
    const apiButton = makeSideButton(apiItem);
    apiButton.addEventListener("click", (event) => {
      event.stopPropagation();
      NS.apiConfig?.open?.();
    });
    langGroup.appendChild(apiButton);
    /* makeSideButton already did sideRefs.set('api', ...), and language switches repaint;
       but the main group's buttons map no longer has api — add it back for key lookups. */
    buttons.set("api", apiButton);

    /* Console: follows ComfyUI's sidebar-bottom terminal button (SidebarBottomPanelToggleButton,
       icon-[ph--terminal-bold] / label 控制台 / tooltip toggles the bottom panel). Click toggles
       the native-style log panel inside the canvas (infcanvas-console.js); selected state uses
       the host's .side-bar-button-selected, identical to the host Console button. Position
       follows the host bottomToolbar: console → shortcuts → settings. */
    const consoleItem = { key: "console", icon: "icon-[ph--terminal-bold]", label: "console.title", tip: () => t("console.panel") };
    const consoleButton = makeSideButton(consoleItem);
    consoleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      NS.consolePanel?.toggle?.("terminal");
    });
    langGroup.appendChild(consoleButton);

    /* Shortcuts: 1:1 against ComfyUI's SidebarShortcutsToggleButton — icon
       icon-[lucide--keyboard], label 快捷键, tooltip keyboard shortcuts. Click toggles
       the bottom shortcuts panel (two tabs: basic shortcuts / view controls), matching
       bottomPanelStore.togglePanel('shortcuts'). Sits right below the console and above
       settings — the host bottomToolbar order. */
    const shortcutsItem = {
      key: "shortcuts", icon: "icon-[lucide--keyboard]",
      label: "shortcuts.title", tip: () => t("shortcuts.keyboardShortcuts"),
    };
    const shortcutsButton = makeSideButton(shortcutsItem);
    shortcutsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      NS.consolePanel?.toggle?.("shortcuts");
    });
    langGroup.appendChild(shortcutsButton);

    /* Settings: follows ComfyUI, ordered below the language switch in the bottom toolbar.
       Built separately (not in SIDEBAR_ITEMS / buttons map, since it opens its own dialog
       rather than a drawer), but still via makeSideButton so repaintLocale refreshes text. */
    const settingsItem = { key: "settings", icon: "icon-[lucide--settings]", label: "settings.settings", tip: () => t("settings.settings") + " \u00a0(Ctrl + , )" };
    const settingsButton = makeSideButton(settingsItem);
    settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      NS.settings?.open?.();
    });
    langGroup.appendChild(settingsButton);

    /* LiteGraphCanvasSplitterOverlay.vue + SidebarTabTemplate.vue +
       SidebarTabCloseButton.vue: the panel appears instantly (no width tween;
       reka-ui splitter sets flex:20.4 1 0). Only .sidebar-content-container
       fades its opacity over 200ms. */
    const panel = node("aside",
      "min-h-0 min-w-0 side-bar-panel pointer-events-auto bg-background " +
      "focus-visible:outline-hidden");
    panel.id = "infcanvas-panel";
    panel.setAttribute("data-testid", "infcanvas-panel");
    const contentWrap = node("div",
      "sidebar-content-container size-full overflow-x-hidden overflow-y-auto " +
      "transition-opacity duration-200 ease-in-out");
    const container = node("div",
      "comfy-vue-side-bar-container group/sidebar-tab flex size-full flex-col");
    const headerWrap = node("div", "comfy-vue-side-bar-header flex flex-col");
    const panelHead = node("div", "flex min-h-16 items-center justify-between border-b px-4");
    const titleBox = node("div", "flex min-w-0 flex-1 items-center overflow-hidden");
    const panelTitle = node("span", "truncate font-bold", "");
    titleBox.appendChild(panelTitle);
    const actions = node("div", "flex items-center gap-2");
    /* SidebarTabTemplate #tool-buttons: hover-revealed muted icon button.
       Only the canvas panel shows it; renderCanvasList wires its handler. */
    /* SidebarTabTemplate's tool-buttons wrapper: w-0 opacity-0, revealed by
       group-hover/group-focus-within. The wrapper (not the button) animates,
       so the 32px icon button never gets clipped. */
    const toolButtons = node("div", "ic-tool-buttons");
    const panelRefresh = node("button",
      "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
      "items-center justify-center gap-2 border-none font-inter text-sm " +
      "font-medium whitespace-nowrap transition-colors focus-visible:ring-1 " +
      "focus-visible:ring-ring focus-visible:outline-none " +
      "disabled:pointer-events-none disabled:opacity-50 " +
      "bg-transparent text-muted-foreground hover:bg-accent shrink-0 size-8 rounded-lg");
    panelRefresh.type = "button";
    bindTip(panelRefresh, () => t("panel.refreshCanvasList"));
    panelRefresh.setAttribute("aria-label", t("panel.refreshCanvasList"));
    panelRefresh.setAttribute("data-testid", "workflows-refresh-button");
    /* BaseWorkflowsSidebarTab: icon-[lucide--refresh-cw] size-4. */
    panelRefresh.innerHTML = '<i class="icon-[lucide--refresh-cw] size-4"></i>';
    panelRefresh.style.display = "none";
    toolButtons.appendChild(panelRefresh);
    actions.appendChild(toolButtons);
    /* The gallery/媒体 panels move their file count + refresh button into this
       slot so they sit in the title row, immediately left of the close X. */
    const headSlot = node("div", "xog-head-slot");
    actions.appendChild(headSlot);
    const panelClose = node("button",
      "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
      "items-center justify-center gap-2 border-none font-inter text-sm " +
      "font-medium whitespace-nowrap transition-colors focus-visible:ring-1 " +
      "focus-visible:ring-ring focus-visible:outline-none " +
      "disabled:pointer-events-none disabled:opacity-50 " +
      "bg-transparent text-muted-foreground hover:bg-accent shrink-0 size-8 rounded-lg");
    panelClose.type = "button";
    bindTip(panelClose, () => t("panel.closeSidebar"));
    panelClose.setAttribute("aria-label", t("panel.closeSidebar"));
    panelClose.setAttribute("data-testid", "sidebar-close-button");
    panelClose.innerHTML = '<i class="icon-[lucide--x] size-4"></i>';
    panelClose.addEventListener("click", () => setPanel(null));
    actions.appendChild(panelClose);
    panelHead.append(titleBox, actions);
    headerWrap.appendChild(panelHead);
    const panelBody = node("div", "comfy-vue-side-bar-body scrollbar-custom h-0 grow overflow-x-hidden");
    panelBody.id = "infcanvas-panel-body";
    panelBody.setAttribute("data-testid", "infcanvas-panel-body");
    container.append(headerWrap, panelBody);
    contentWrap.appendChild(container);
    panel.appendChild(contentWrap);

    /* SplitterResizeHandle.vue: hidden while no panel is mounted, 1px line,
       4px ::after hit area, role=separator, keyboard resizable. */
    const resizeHandle = node("div", HANDLE_CLASSES);
    resizeHandle.id = "infcanvas-panel-resize-handle";
    resizeHandle.setAttribute("data-testid", "infcanvas-panel-resize-handle");
    resizeHandle.setAttribute("role", "separator");
    resizeHandle.setAttribute("tabindex", "0");
    resizeHandle.setAttribute("data-resize-handle", "");
    resizeHandle.setAttribute("data-orientation", "horizontal");
    resizeHandle.setAttribute("data-state", "inactive");
    resizeHandle.setAttribute("data-resize-handle-state", "inactive");
    resizeHandle.setAttribute("data-panel-resize-handle-enabled", "true");
    resizeHandle.setAttribute("data-panel-resize-handle-id", "infcanvas-panel-resize-handle");
    resizeHandle.setAttribute("aria-controls", "infcanvas-panel");
    /* reka-ui sets these inline on the handle (measured on the native DOM). */
    resizeHandle.style.touchAction = "none";
    resizeHandle.style.userSelect = "none";

    const stage = node("main");
    stage.id = "infcanvas-stage";
    stage.setAttribute("data-testid", "infcanvas-stage");
    body.append(sidebar, panel, resizeHandle, stage);
    root.appendChild(body);
    document.body.appendChild(root);
    /* Canvas-mode system monitor: the ComfyUI menu-bar status strip (fig. 2)
       + active-job count (fig. 3), mirrored inside the canvas. Mounted after
       the root is in the document so its absolute top-left placement and
       first telemetry fetch see a live DOM. */
    try { NS.canvasMonitor?.mount?.(root); } catch (error) { console.warn("[InfCanvas] monitor mount failed", error); }
    /* ComfyUI console: native-style bottom logs panel (infcanvas-console.js).
       Mounted under #infcanvas-root so it is removed with the shell on exit. */
    try { NS.consolePanel?.mount?.(body); } catch (error) { console.warn("[InfCanvas] console mount failed", error); }

    const shell = {
      root, tabbar, sidebar, buttons, sideRefs,
      panel, panelTitle, panelBody, panelRefresh, headSlot, stage, resizeHandle,
    };
    shell.destroyResizer = attachPanelResizer(shell, resizeHandle);
    st().shell = shell;
    /* Subscribe once for native-DOM locale repaint (Vue nodes react via $t). */
    if (!NS._i18nUiSubscribed && NS.i18n?.onChange) {
      NS.i18n.onChange(() => repaintLocale());
      NS._i18nUiSubscribed = true;
    }
    st().panelKey = null;
    st().panelBody = panelBody;
    st().panelToken = (st().panelToken || 0) + 1;
    /* Job-history tab is hidden until "停靠的作业历史" is enabled. Needs the
       shell assigned above so syncJobHistoryRail() can find the rail button. */
    syncJobHistoryRail();
    return shell;
  }

  function unmountShell() {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    try { NS.canvasMonitor?.unmount?.(); } catch (error) { /* optional */ }
    try { NS.consolePanel?.unmount?.(); } catch (error) { /* optional */ }
    if (galleryCleanup) { galleryCleanup(); galleryCleanup = null; }
    const shell = st().shell;
    try { shell?.destroyResizer?.(); } catch (error) { /* optional */ }
    if (shell?.root) shell.root.remove();
    st().shell = null;
    st().tabsHost = null;
    st().panelKey = null;
    st().panelBody = null;
    st().panelToken = (st().panelToken || 0) + 1;
  }

  /* ------------------------------ tab bar -------------------------------- */

  function mountTabs() {
    const shell = st().shell;
    if (!shell || document.querySelector("#infcanvas-tabs")) return;
    const bar = node("div");
    bar.id = "infcanvas-tabs";
    bar.setAttribute("data-testid", "infcanvas-tabs");
    shell.tabbar.appendChild(bar);
    st().tabsHost = bar;
    renderTabs();
  }

  function removeTabs() {
    const bar = st().tabsHost;
    if (bar) bar.remove();
    st().tabsHost = null;
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
  }

  /* One menu surface for every context menu in the canvas: the tab menu, the
     canvas row menu and the node list all render through here, so they stay
     identical. Surface + items follow menuStyles.ts / MenuItemContent.vue /
     MenuSeparator.vue. */
  function openMenu(event, items, extraClass) {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const menu = node("div", NATIVE_MENU_CONTENT + " ic-menu" + (extraClass ? " " + extraClass : ""));
    menu.setAttribute("role", "menu");

    for (const item of items) {
      if (item.separator) { menu.appendChild(node("div", NATIVE_MENU_SEP + " ic-menu-sep")); continue; }
      const button = node("button", NATIVE_MENU_ITEM + " ic-menu-item");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      if (item.disabled) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      /* MenuItemContent.vue: OverlayIcon (compound main + sub glyph) or a
         direct <i>, then min-w-0 flex-1 > block truncate. */
      let iconEl;
      if (item.overlayIcon) {
        const oi = item.overlayIcon;
        iconEl = node("span", "relative inline-flex size-[1em] items-center justify-center shrink-0");
        iconEl.appendChild(node("i", oi.mainIcon + " text-[1em]"));
        const sub = node("i", oi.subIcon +
          " pointer-events-none absolute leading-none " +
          (oi.positionX === "left" ? "left-0" : "right-0") + " " +
          (oi.positionY === "top" ? "top-0" : "bottom-0"));
        sub.style.fontSize = (oi.subIconScale || 0.6) + "em";
        sub.style.textShadow = OVERLAY_SUB_TEXT_SHADOW;
        iconEl.appendChild(sub);
      } else {
        iconEl = node("i", item.icon + " size-4 shrink-0");
        /* Native `text-[1em]` icons: glyph tracks the item's 14px font, not 16. */
        if (item.iconEm) iconEl.style.fontSize = "1em";
      }
      const labelWrap = node("span", "min-w-0 flex-1");
      labelWrap.appendChild(node("span", "block truncate", item.label));
      button.append(iconEl, labelWrap);
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        menu.remove();
        if (!item.disabled) item.command();
      });
      menu.appendChild(button);
    }

    (st().shell?.root || document.body).appendChild(menu);
    const rect = typeof menu.getBoundingClientRect === "function"
      ? menu.getBoundingClientRect() : { width: 224, height: 340 };
    menu.style.left = Math.max(0, Math.min(event.clientX, window.innerWidth - rect.width - 4)) + "px";
    menu.style.top = Math.max(0, Math.min(event.clientY, window.innerHeight - rect.height - 4)) + "px";
    const dismiss = (clickEvent) => {
      if (!menu.contains(clickEvent.target)) menu.remove();
      document.removeEventListener("click", dismiss, true);
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  }

  /* Tab menu mirrors WorkflowTab.contextMenuItems + useWorkflowActionsMenu:
     rename, duplicate | separator | save, save-as | separator | close-tab,
     close-left, close-right, close-others. */
  function showTabMenu(event, doc, index, count) {
    const isFirst = index === 0;
    const isLast = index === count - 1;
    const items = [
      { label: t("panel.rename"), icon: "pi pi-file-edit", command: () => api().renameDoc(doc.id) },
      { label: t("panel.copyCanvas"), icon: "pi pi-copy", command: () => api().duplicateDoc(doc.id) },
      { separator: true },
      { label: t("panel.save"), icon: "pi pi-save", command: () => api().saveActive(false, doc) },
      { label: t("panel.saveAs"), icon: "pi pi-save", command: () => api().saveActive(true, doc) },
      { separator: true },
      { label: t("panel.closeTab"), icon: "pi pi-times", command: () => api().closeDoc(doc.id) },
      /* WorkflowTab.vue: close-left/right/others use `overlayIcon` — a pi-times
         cross with a 0.5em direction arrow pinned bottom-right (arrow-left /
         arrow-right / arrows-h), outlined for legibility. Mirrored verbatim. */
      {
        label: t("panel.closeTabsLeft"),
        overlayIcon: {
          mainIcon: "pi pi-times", subIcon: "pi pi-arrow-left",
          positionX: "right", positionY: "bottom", subIconScale: 0.5,
        },
        disabled: isFirst, command: () => api().closeDocsAt(doc.id, "left"),
      },
      {
        label: t("panel.closeTabsRight"),
        overlayIcon: {
          mainIcon: "pi pi-times", subIcon: "pi pi-arrow-right",
          positionX: "right", positionY: "bottom", subIconScale: 0.5,
        },
        disabled: isLast, command: () => api().closeDocsAt(doc.id, "right"),
      },
      {
        label: t("panel.closeOtherTabs"),
        overlayIcon: {
          mainIcon: "pi pi-times", subIcon: "pi pi-arrows-h",
          positionX: "right", positionY: "bottom", subIconScale: 0.5,
        },
        disabled: isFirst && isLast, command: () => api().closeDocsAt(doc.id, "others"),
      },
    ];

    openMenu(event, items, "ic-menu--tab");
  }

  /* Canvas row menu: same surface and same rename/duplicate semantics as the
     tab menu — rename asks for a name, duplicate copies straight away under
     "<name> (Copy)" and opens the copy. Item order follows the native tree
     menu (rename, delete, duplicate) with no separator and no red delete. */
  function showCanvasMenu(event, canvas, reload, names) {
    const uniqueCanvasName = (base) => {
      const taken = new Set((names || []).map((entry) => entry.name));
      let name = base;
      let counter = 2;
      while (taken.has(name)) {
        name = `${base} (${counter})`;
        counter += 1;
      }
      return name;
    };
    const items = [
      { label: t("panel.rename"), icon: "pi pi-file-edit", command: async () => {
        const value = await api().promptDialog({
          title: t("panel.renameCanvas"), message: t("panel.canvasName"), defaultValue: canvas.name,
        });
        if (value === null || !String(value).trim()) return;
        const name = String(value).trim();
        if (name === canvas.name) return;
        try {
          await api().renameCanvas(canvas.name, name);
          await reload();
        } catch (error) { api().toast("error", t("panel.renameFailed"), String(error)); }
      } },
      { label: t("panel.delete"), icon: "pi pi-trash", command: async () => {
        const ok = await api().confirmDialog({
          title: t("panel.deleteCanvas"), message: t("panel.confirmDeleteNamed", { name: canvas.name }), hint: t("panel.actionCannotUndone"),
          type: "delete", key: "infcanvas-delete-canvas",
        });
        if (!ok) return;
        try {
          await backend().remove(canvas.name);
          await reload();
        } catch (error) { api().toast("error", t("panel.deleteFailed"), String(error)); }
      } },
      /* 复制 ≠ 保存: the copy opens as an unsaved tab, nothing is written to
         disk, and the canvas list therefore gains no new row. */
      { label: t("panel.copyCanvas"), icon: "pi pi-copy", command: async () => {
        const base = String(canvas.name).replace(/\s*\(\d+\)$/, "");
        const name = uniqueCanvasName(base + " (Copy)");
        try {
          await api().duplicateCanvas(canvas.name, name, (names || []).map((entry) => entry.name));
        } catch (error) { api().toast("error", t("panel.duplicateFailed"), String(error)); }
      } },
    ];
    openMenu(event, items);
  }

  /* One popover drives both node lists:
       - double click on empty canvas -> every registered type (only the 8
         infcanvas types; ComfyUI's node search box is what we deliberately
         replaced, see onCanvasEvent in infcanvas-core.js);
       - releasing a wire over empty canvas -> ONLY the types that can take
         that wire, picked by infcanvas-flow.js.
     `options.specs` limits the list, `options.title` adds a caption and
     `options.onPick(spec)` replaces the default "create at the pointer".
     The menu surface is the one menuStyles.ts defines for ComfyUI's own
     context menus, so it reads as part of the host UI. */
  function showNodePickMenu(anchor, options = {}) {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const menu = node("div", NATIVE_MENU_CONTENT + " ic-menu ic-node-menu");
    menu.id = options.id || "infcanvas-node-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", options.label || t("shortcuts.addNode"));

    const allowed = options.specs ? new Set(options.specs.map((spec) => spec.type)) : null;
    /* One flat list, no role subheadings and no description tooltips: caption
       is 添加节点 (or the caller's own title on the wire-release menu), then
       文本 / 图像 / 视频 / 音频 in that fixed order, with the matching
       lucide glyphs. */
    const ORDER = ["text", "image", "video", "audio", "omni", "lora", "cleanup_vram", "cleanup_ram", "cleanup_both", "text_merge"];
    const specs = (NS.SPECS || [])
      .filter((entry) => !allowed || allowed.has(entry.type))
      .slice()
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    menu.appendChild(node("div", "ic-menu-section", options.title || t("shortcuts.addNode")));
    for (const spec of specs) {
      /* Groups: media generators / LoRA stack (its own group) / helper pills.
         A separator goes before LoRA stack and before the cleanup pills, but
         only when something precedes them (wire menus can filter specs down). */
      if ((spec.kind === "lora" || spec.kind === "cleanup_vram")
          && menu.querySelector(".ic-menu-item")) {
        menu.appendChild(node("div", NATIVE_MENU_SEP + " ic-menu-sep"));
      }
      const button = node("button", NATIVE_MENU_ITEM + " ic-menu-item");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.insertAdjacentHTML("beforeend", nodeIconHtml(spec.kind));
      const specLabel = node("span", "min-w-0 flex-1");
      specLabel.appendChild(node("span", "block truncate", t(spec.title)));
      button.appendChild(specLabel);
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        /* A pick hands off to a placement flow (ghost follows the pointer), so
           DON'T dismiss the frozen wire here — only real cancellation does. */
        closeMenu(false);
        if (options.onPick) { options.onPick(spec, clickEvent); return; }
        /* Menu picks now use the same live placement as a wire drop: the node
           follows the pointer and the FINAL left click decides both position
           and group membership. Fall back only if the flow bridge is absent. */
        const begin = NS.flow?.state?.placementActions?.beginPlacement;
        if (begin && Array.isArray(anchor.world)) {
          begin(spec, null, { x: anchor.world[0], y: anchor.world[1] });
          return;
        }
        api().addNodeByType(spec.type, anchor.world);
      });
      menu.appendChild(button);
    }
    if (!menu.querySelector(".ic-menu-item")) {
      menu.appendChild(node("div", "ic-menu-empty", t("panel.noConnectableNodes")));
    }

    /* Double-click "添加节点" only: a 添加资源 section with one 上传 action.
       Clicking opens the native file picker; picked files are uploaded and
       turned into nodes at the menu's world position (same path as drop). */
    if (options.withAssets) {
      menu.appendChild(node("div", NATIVE_MENU_SEP + " ic-menu-sep"));
      menu.appendChild(node("div", "ic-menu-section", t("panel.addResource")));
      const upload = node("button", NATIVE_MENU_ITEM + " ic-menu-item");
      upload.type = "button";
      upload.setAttribute("role", "menuitem");
      upload.insertAdjacentHTML("beforeend", nodeIconHtml("upload"));
      const upLabel = node("span", "min-w-0 flex-1");
      upLabel.appendChild(node("span", "block truncate", t("image.upload")));
      upload.appendChild(upLabel);
      upload.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        closeMenu();
        const w = anchor.world || [0, 0];
        api()?.pickFiles?.({ x: w[0], y: w[1] });
      });
      menu.appendChild(upload);
    }

    const root = st().shell?.root || document.body;
    root.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const x = Number.isFinite(anchor.clientX) ? anchor.clientX : 0;
    const y = Number.isFinite(anchor.clientY) ? anchor.clientY : 0;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) + "px";

    function closeMenu(dismiss = true) {
      menu.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("wheel", closeMenu, true);
      if (dismiss && options.onDismiss) options.onDismiss();
    }
    function onOutside(event) {
      if (!menu.contains(event.target)) closeMenu();
    }
    function onKey(event) {
      if (event.key === "Escape") { event.stopPropagation(); closeMenu(); }
    }
    setTimeout(() => {
      if (!document.body.contains(menu)) return;
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
      // Wheel over the canvas zooms; the menu would stay pinned to stale
      // screen coordinates, so dismiss it like ComfyUI's own popovers do.
      document.addEventListener("wheel", closeMenu, true);
    }, 0);
    return menu;
  }

  /* Double-click on empty canvas: every node type, at the pointer. */
  function showAddNodeMenu(anchor) {
    return showNodePickMenu(anchor, { withAssets: true });
  }
  /* Wire released over empty canvas: only the types that can take it. The
     candidate list and the "create + connect" step both live in
     infcanvas-flow.js — this is the surface. */
  function showConnectNodeMenu(anchor) {
    return showNodePickMenu(anchor, {
      id: "infcanvas-connect-menu",
      label: t("panel.wireNewNode"),
      title: t("panel.connectNewNode"),
      specs: anchor.specs || [],
      onPick: anchor.onPick,
      onDismiss: anchor.onDismiss,
    });
  }

  function renderTabs() {
    const bar = st().tabsHost;
    if (!bar) return;
    bar.replaceChildren();
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const strip = node("div", "ic-tab-strip");
    const docs = st().docs;
    for (let index = 0; index < docs.length; index += 1) {
      const doc = docs[index];
      const active = doc.id === st().activeId;
      const tab = node("div", "ic-tab"
        + (active ? " is-active" : "")
        + (doc.dirty ? " has-status" : ""));
      tab.dataset.id = doc.id;
      tab.appendChild(node("span", "ic-label", doc.name || t("core.unsavedCanvasName")));
      /* WorkflowTab.vue: a size-4 shrink-0 status slot follows the label.
         The close button is absolutely positioned over that slot, so it can
         never overlap the label text. */
      const status = node("span", "ic-status");
      if (doc.dirty) status.appendChild(node("span", "ic-dot"));
      tab.appendChild(status);
      const close = node("button", "ic-close");
      close.type = "button";
      close.setAttribute("aria-label", t("panel.closeTab"));
      bindTip(close, () => t("panel.closeTab"));
      close.innerHTML = '<i class="icon-[lucide--x] size-4"></i>';
      close.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        api().closeDoc(doc.id);
      });
      tab.appendChild(close);
      tab.addEventListener("click", () => api().switchDoc(doc.id));
      tab.addEventListener("auxclick", (auxEvent) => {
        if (auxEvent.button === 1) { auxEvent.preventDefault(); api().closeDoc(doc.id); }
      });
      tab.addEventListener("contextmenu", (menuEvent) => {
        menuEvent.preventDefault();
        showTabMenu(menuEvent, doc, index, docs.length);
      });
      strip.appendChild(tab);
    }
    bar.appendChild(strip);
    const add = node("button", "ic-tab-add");
    add.type = "button";
    add.innerHTML = '<i class="pi pi-plus"></i>';
    bindTip(add, () => t("panel.newCanvas"));
    add.addEventListener("click", () => api().newCanvas());
    bar.appendChild(add);
    /* The exit-canvas button moved to the far left of the top monitor bar (see
       infcanvas-monitor.js); the tab bar no longer keeps a second exit entry. */
  }

  /* --------------------------- drawer panels ----------------------------- */

  function isCurrent(container, key) {
    return st().panelKey === key
      && st().panelBody === container
      && document.body.contains(container);
  }

  /* Shared by rail clicks and the A/N/M/C mnemonics: pressing the same key
     again closes the drawer, exactly like clicking the button a second time. */
  function togglePanel(key) {
    setPanel(st().panelKey === key ? null : key);
  }

  function setPanel(key) {
    const state = st();
    const shell = state.shell;
    if (!shell) return;
    /* Gallery owns document/window listeners + body-portaled popovers. Tear the
       previous instance down before its host is cleared (or before switching
       to a different panel), otherwise those listeners pile up on every switch. */
    if (state.panelKey === "job-history" && key !== "job-history") {
      try { NS.controls?.closeTaskList?.(); } catch (e) { /* no-op */ }
    }
    if (galleryCleanup) { galleryCleanup(); galleryCleanup = null; }
    closeLoraLightbox();
    closeLoraFolderMenu();
    closeLoraViewMenu();
    shell.panelBody.classList.remove("ic-gallery-host");
    /* BaseWorkflowsSidebarTab's onMounted focuses the SearchInput. Mirror that
       once per switch into the canvas panel — not on every refreshPanels()
       re-render, which would yank the caret away while typing. */
    if (key === "canvases" && state.panelKey !== "canvases") focusCanvasSearch = true;
    state.panelKey = key;
    state.panelToken = (state.panelToken || 0) + 1;
    shell.root.classList.toggle("has-panel", !!key);
    for (const [itemKey, button] of shell.buttons) {
      const selected = !!key && itemKey === key;
      /* .side-bar-button-selected is SidebarIcon.vue's own global rule */
      button.classList.toggle("side-bar-button-selected", selected);
      button.classList.toggle("is-active", selected);
    }
    shell.panelTitle.textContent = key ? t(PANEL_TITLES[key] || "") : "";
    shell.panelRefresh.style.display = key === "canvases" ? "" : "none";
    shell.panelRefresh.onclick = null;
    /* Gallery moved its count + refresh into the header slot; clear it on
       every switch so they never leak into a different panel. */
    shell.headSlot.replaceChildren();
    shell.panelBody.replaceChildren();
    if (!key) return;
    if (key === "gallery" || key === "media") {
      /* Both panels use the same builder; 媒体 only swaps the output/input
         tabs for a folder chip (mode:media) and lists the chosen folder. Mark
         the host so canvas CSS pins the header and scrolls only the grid. */
      shell.panelBody.classList.add("ic-gallery-host");
      galleryCleanup = NS.galleryPanel?.mount?.(
          shell.panelBody,
          { ...(key === "media" ? { mode: "media" } : {}), headSlot: shell.headSlot }
      ) || null;
    } else if (key === "nodes") renderNodeLibrary(shell.panelBody);
    else if (key === "lora") renderLoraLibrary(shell.panelBody);
    else if (key === "prompts") renderPrompts(shell.panelBody);
    else if (key === "canvases") renderCanvasList(shell.panelBody);
    else if (key === "job-history") NS.controls?.renderJobHistoryPanel?.(shell.panelBody);
  }

  /* Repaint every native-DOM string in the shell when language changes.
     Vue-driven nodes react on their own through the shared lang ref. */
  function repaintLocale() {
    try { NS.canvasMonitor?.repaintLocale?.(); } catch (error) { /* optional */ }
    try { NS.consolePanel?.repaintLocale?.(); } catch (error) { /* optional */ }
    try { NS.settings?.repaintLocale?.(); } catch (error) { /* optional */ }
    const shell = st().shell;
    if (!shell) return;
    for (const [key, ref] of shell.sideRefs) {
      ref.label.textContent = displayOf(ref.item.label);
      ref.button.setAttribute("aria-label", displayOf(ref.item.tip));
      /* Tooltip text is a function (bindTip), so it re-reads displayOf() on
         each hover — no separate tip element to repaint. */
    }
    /* These aria-labels are set once at mount; unlike tooltips they never
       re-resolve, so a language switch leaves the old text behind. */
    const refresh = shell.root?.querySelector('[data-testid="workflows-refresh-button"]');
    if (refresh) refresh.setAttribute("aria-label", t("panel.refreshCanvasList"));
    const sideClose = shell.root?.querySelector('[data-testid="sidebar-close-button"]');
    if (sideClose) sideClose.setAttribute("aria-label", t("panel.closeSidebar"));
    shell.tabbar?.querySelectorAll(".ic-close").forEach((el) => {
      el.setAttribute("aria-label", t("panel.closeTab"));
    });
    /* Unnamed tabs show a localised fallback; named tabs keep their saved name. */
    shell.tabbar?.querySelectorAll(".ic-tab .ic-label").forEach((el) => {
      const doc = st().docs?.find((d) => d.id === el.parentElement?.dataset?.id);
      if (doc && !doc.name) el.textContent = t("core.unsavedCanvasName");
    });
    /* Re-render the currently open drawer so its static labels switch too. */
    if (st().panelKey) setPanel(st().panelKey);
    /* Tab bar tooltips + add-canvas title. */
    document.querySelectorAll(".ic-tabbar [title]").forEach((el) => {
      /* titles set from t() at creation are refreshed by re-running mountTabs
         below only when needed; tab labels are user data and stay as-is. */
    });
    const add = shell.tabbar?.querySelector(".ic-tab-add");
    if (add) bindTip(add, () => t("panel.newCanvas"));
    /* Exit-button label / tooltip are refreshed by canvasMonitor.repaintLocale(). */
  }

  /* Panel chrome follows ComfyUI's SidebarTabTemplate.vue: the title lives in
     the 64px header; the body holds the panel's own content. */
  function panelHeader(hintText) {
    const panel = node("div", "ic-panel");
    if (hintText) panel.appendChild(node("div", "ic-hint", hintText));
    return panel;
  }

  /* Saved prompts drawer. Every visual class below is copied verbatim from
     the host sourcesContent (button.variants.ts default secondary/md,
     Input.vue, Textarea.vue, treeStyles.ts + TreeItem.vue, MenuItemContent.vue,
     NoResultsPlaceholder.vue). Only .ic-* hooks stay for state/listeners. */
  /* Button base + variant=secondary + size=md. The base's rounded-md is
     dropped here because the md size overrides it with rounded-lg (cn() in
     the host does the same merge). */
  const BTN_BASE =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
    "items-center justify-center gap-2 border-none font-inter " +
    "text-sm font-medium whitespace-nowrap transition-colors " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 " +
    "[&_svg:not([width]):not([height])]:size-4";
  const NATIVE_BTN =
    BTN_BASE + " bg-secondary text-foreground hover:bg-accent " +
    "h-8 rounded-lg p-2 text-xs";
  const NATIVE_INPUT =
    "flex h-10 w-full min-w-0 appearance-none rounded-lg border-none bg-secondary " +
    "px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "aria-invalid:ring-1 aria-invalid:ring-destructive";
  const NATIVE_TEXTAREA =
    "flex min-h-16 w-full scrollbar-gutter-stable resize-y rounded-lg border-none bg-secondary " +
    "px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "aria-invalid:ring-1 aria-invalid:ring-destructive";
  /* Native NoResultsPlaceholder.vue structure, reused for empty/load-error. */
  function promptPlaceholder(title, icon) {
    const empty = node("div", NATIVE_EMPTY);
    const inner = node("div", NATIVE_EMPTY_INNER);
    inner.appendChild(node("i", "pi pi-" + icon + " " + NATIVE_EMPTY_ICON));
    inner.appendChild(node("h3", NATIVE_EMPTY_TITLE, title));
    empty.appendChild(inner);
    return empty;
  }

  async function renderPrompts(container) {
    if (!isCurrent(container, "prompts")) return;
    /* No .ic-panel here: its hand-written padding/gap/font would override
       the native utilities below (our injected CSS comes after the host's). */
    const panel = node("div", "ic-prompt-panel flex h-full min-h-0 flex-col gap-2 pt-2 pb-4 text-sm text-foreground");

    const addBtn = node("button", NATIVE_BTN + " mx-4");
    addBtn.type = "button";
    addBtn.textContent = t("media.addPrompt");
    panel.appendChild(addBtn);

    /* The editor is created lazily and toggled, so the list stays put. */
    const editor = node("div", "mx-4 flex flex-col gap-2 hidden");
    const titleInput = node("input", NATIVE_INPUT + " ic-prompt-title");
    titleInput.type = "text";
    titleInput.placeholder = t("media.promptTitle");
    titleInput.setAttribute("aria-label", t("media.promptTitle"));
    const textInput = node("textarea", NATIVE_TEXTAREA);
    textInput.placeholder = t("media.promptText");
    textInput.setAttribute("aria-label", t("media.promptText"));
    textInput.rows = 5;
    const actions = node("div", "flex justify-end gap-2");
    const saveBtn = node("button", NATIVE_BTN + " ic-prompt-save");
    saveBtn.type = "button";
    saveBtn.textContent = t("panel.save");
    const cancelBtn = node("button", NATIVE_BTN + " ic-prompt-cancel");
    cancelBtn.type = "button";
    cancelBtn.textContent = t("api.cancel");
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    editor.appendChild(titleInput);
    editor.appendChild(textInput);
    editor.appendChild(actions);
    panel.appendChild(editor);

    /* TreeExplorer.vue uses "tree-explorer px-2"; buttons/editor keep the
       native 16px search-box inset, the tree itself the native 8px inset. */
    const list = node("div", "tree-explorer scrollbar-custom flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-2");
    panel.appendChild(list);
    container.replaceChildren(panel);

    /* null = adding a new prompt; a string id = editing that prompt. */
    let editingId = null;
    const openEditor = (item = null) => {
      editingId = item ? item.id : null;
      editor.classList.remove("hidden");
      titleInput.value = item ? (item.title || "") : "";
      textInput.value = item ? (item.text || "") : "";
      titleInput.focus();
    };
    const closeEditor = () => { editor.classList.add("hidden"); editingId = null; };
    addBtn.addEventListener("click", () => openEditor(null));
    cancelBtn.addEventListener("click", closeEditor);

    saveBtn.addEventListener("click", async () => {
      const title = titleInput.value.trim();
      const text = textInput.value;
      if (!title && !text.trim()) {
        api().toast("error", t("media.titlePromptCannotBothEmpty"));
        return;
      }
      saveBtn.disabled = true;
      try {
        if (editingId) {
          await api().updatePrompt(editingId, title, text);
        } else {
          await api().addPrompt(title, text);
        }
        closeEditor();
        await load();
      } catch (error) {
        api().toast("error", t("media.saveFailed"), String(error?.message || error));
      } finally {
        saveBtn.disabled = false;
      }
    });

    const load = async () => {
      if (!isCurrent(container, "prompts")) return;
      let items = [];
      try {
        const data = await api().listPrompts();
        items = Array.isArray(data?.items) ? data.items : [];
      } catch (error) {
        list.replaceChildren(promptPlaceholder(t("media.couldNotLoadPrompts"), "exclamation-triangle"));
        return;
      }
      if (!isCurrent(container, "prompts")) return;
      if (!items.length) {
        list.replaceChildren(promptPlaceholder(t("media.noSavedPromptsYet"), "file"));
        return;
      }
      list.replaceChildren();
      for (const item of items) {
        /* TreeItem.vue leaf: size-5 chevron placeholder, then slot icon,
           then the flex-1 node host. TreeExplorerTreeNode.vue supplies the
           label wrapper; only the two stacked text lines are ours, built
           from native utilities. */
        const row = node("div", NATIVE_TREE_ROW + " ic-prompt-item");
        row.appendChild(node("span", NATIVE_TREE_CHEVRON));
        const iconWrap = node("span", NATIVE_TREE_ICON_WRAP);
        iconWrap.appendChild(node("i", "pi pi-file " + NATIVE_TREE_ICON));
        row.appendChild(iconWrap);
        const rowHost = node("div", NATIVE_TREE_NODE_HOST);
        const treeNode = node("div", NATIVE_TREE_NODE);
        const content = node("div", NATIVE_TREE_CONTENT);
        const body = node("div", "flex min-w-0 flex-1 flex-col");
        /* Keep the original newlines; line-clamp-3 is ComfyUI's own utility. */
        body.appendChild(node("div", "block min-w-0 truncate text-sm text-foreground",
          item.title || t("media.untitled")));
        body.appendChild(node("div",
          "line-clamp-3 min-w-0 wrap-anywhere whitespace-pre-wrap text-xs text-muted-foreground",
          String(item.text || "").trim()));
        content.appendChild(body);
        treeNode.appendChild(content);
        rowHost.appendChild(treeNode);
        row.appendChild(rowHost);

        const copyPrompt = async () => {
          try {
            await navigator.clipboard.writeText(String(item.text || ""));
          } catch (error) {
            api().toast("error", t("media.couldNotCopyPrompt"), String(error?.message || error));
          }
        };
        const editPrompt = () => openEditor(item);
        const deletePrompt = async () => {
          const ok = await api().confirmDialog({
            title: t("media.deletePrompt"),
            message: t("panel.confirmDeleteNamed", { name: item.title || t("media.untitled") }),
            type: "delete", key: "infcanvas-delete-prompt",
          });
          if (ok !== true) return;
          try {
            await api().removePrompt(item.id);
            await load();
          } catch (error) {
            api().toast("error", t("panel.deleteFailed"), String(error?.message || error));
          }
        };
        /* Same context-menu surface as the tab / canvas / node menus. */
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu(event, [
            { label: t("media.copyPrompt"), icon: "pi pi-copy", command: copyPrompt },
            { label: t("media.editPrompt"), icon: "pi pi-file-edit", command: editPrompt },
            { label: t("media.deletePrompt"), icon: "pi pi-trash", command: deletePrompt },
          ]);
        });
        list.appendChild(row);
      }
    };
    await load();
  }

  /* ---- LoRA library ---------------------------------------------------------
     List models from all ComfyUI lora dirs (via backend folder_paths, including
     extra_model_paths shared dirs), auto-grouped by subfolder, with same-stem previews.
     Clicking a card only opens an enlarged preview; nothing is added to the canvas.
     Backend /infcanvas/loras returns items[{name,file,stem,subfolder,category,preview}];
     preview is a same-stem image relative path, read via the /infcanvas/lora/preview proxy. */
  /* Previews may be same-basename images OR videos (.mp4/.webm). The backend
     already proxies both; the UI must pick the right media element or a video
     fed to <img> shows as a broken image. */
  function isLoraVideo(preview) {
    return !!preview && /\.(mp4|webm)$/i.test(preview);
  }
  let loraLightbox = null;
  function closeLoraLightbox() {
    if (!loraLightbox) return;
    loraLightbox.remove();
    document.removeEventListener("keydown", loraLightbox._onKey, true);
    loraLightbox = null;
  }
  /* Folder dropdown is portaled to #infcanvas-root (fixed) so the panel's
     overflow never clips it. Track it module-wide so setPanel / lightbox can
     tear it down (and unbind document listeners) on every panel switch. */
  let loraFolderMenu = null;
  function closeLoraFolderMenu() {
    if (!loraFolderMenu) return;
    const m = loraFolderMenu;
    m.el.remove();
    document.removeEventListener("pointerdown", m.onDown, true);
    window.removeEventListener("keydown", m.onKey, true);
    if (m.btn) { m.btn.setAttribute("aria-expanded", "false"); m.btn.dataset.state = "closed"; }
    loraFolderMenu = null;
  }
  /* View-switcher popover (native MediaAssetSettingsMenu): kept local to the
     panel, hidden rather than removed so its item/check DOM stays bound. */
  let loraViewMenu = null;
  function closeLoraViewMenu() {
    if (!loraViewMenu) return;
    const m = loraViewMenu;
    m.el.hidden = true;
    m.btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", m.onDown, true);
    window.removeEventListener("keydown", m.onKey, true);
    loraViewMenu = null;
  }
  /* LoRA pinned items — names promoted to the top of the library. Stored as
     an ordered array (oldest pin first) in per-user prefs, like the view mode. */
  const LORA_PIN_KEY = "xcat.lora.pinned";
  function getLoraPinned() {
    const v = NS.prefs?.get(LORA_PIN_KEY, []);
    return Array.isArray(v) ? v.filter((n) => typeof n === "string") : [];
  }
  function setLoraPinned(names) { NS.prefs?.set(LORA_PIN_KEY, names); }
  function toggleLoraPin(name) {
    const pinned = getLoraPinned();
    const i = pinned.indexOf(name);
    if (i >= 0) pinned.splice(i, 1);
    else pinned.push(name);
    setLoraPinned(pinned);
    return i < 0;
  }
  function isLoraPinned(name) { return getLoraPinned().indexOf(name) >= 0; }

  /* LoRA view mode mirrors the gallery's three modes, under its own prefs key. */
  const LORA_VIEW_KEY = "xcat.lora.view";
  const LORA_VIEW_MODES = ["list", "grid-small", "grid"];
  function getLoraViewMode() {
    const v = NS.prefs?.get(LORA_VIEW_KEY, "");
    return LORA_VIEW_MODES.includes(v) ? v : "grid-small";
  }
  function loraGridColumns(mode) {
    const minWidth = mode === "grid-small" ? 128 : 240;
    return `repeat(auto-fill, minmax(min(${minWidth}px, 30vw), 1fr))`;
  }
  function openLoraLightbox(item, list) {
    closeLoraFolderMenu();
    closeLoraViewMenu();
    closeLoraLightbox();
    /* Follows MediaLightbox.vue — same native lightbox the 资产 panel uses.
       `list` is the panel's current (filtered) visible order, so prev/next step
       through exactly what the user sees. Only the high z-index stays custom
       (native z-overlay=1700 is far below the 20000 canvas root). */
    const navItems = Array.isArray(list) && list.length ? list : [item];
    let navIndex = Math.max(0, navItems.indexOf(item));
    const overlay = node("div", "fixed inset-0 z-overlay flex items-center justify-center bg-black/90 outline-none ic-lora-lb");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    /* Button variant=secondary size=icon-lg rounded-full, MediaLightbox close. */
    const close = node("button", NATIVE_BTN_CLOSE_LG + " absolute top-4 right-4 z-10 ic-lora-lb-close");
    close.type = "button";
    bindTip(close, () => t("settings.close"));
    close.innerHTML = '<i class="icon-[lucide--x] size-5"></i>';
    close.addEventListener("click", closeLoraLightbox);
    overlay.appendChild(close);
    /* Media sits in a bare centred stage, exactly like MediaLightbox. The full
       path name rides in a bottom caption that is absolutely positioned, so it
       never steals vertical space from the image — top/bottom gaps stay even. */
    const card = node("div", "ic-lora-lb-card");
    const stage = node("div", "ic-lora-lb-stage");
    card.appendChild(stage);
    overlay.appendChild(card);
    const caption = node("div", "ic-lora-lb-caption");
    const pathName = node("span", NATIVE_LB_NAME + " ic-lora-lb-name");
    caption.appendChild(pathName);
    overlay.appendChild(caption);

    /* Prev/next — MediaLightbox.vue: only when hasMultiple, wrap-around,
       secondary icon-lg rounded-full, chevron-left/right size-6. Repaint the
       same stage/caption on every step instead of rebuilding the dialog. */
    function show(it) {
      stage.replaceChildren();
      if (it.preview) {
        const url = backend().loraPreviewUrl(it.preview);
        if (isLoraVideo(it.preview)) {
          const vid = node("video", "size-auto max-h-[90vh] max-w-[90vw] object-contain ic-lora-lb-img");
          vid.src = url;
          vid.controls = true;
          vid.autoplay = true;
          vid.loop = true;
          vid.muted = true;
          vid.playsInline = true;
          vid.preload = "metadata";
          stage.appendChild(vid);
        } else {
          const img = node("img", "size-auto max-h-[90vh] max-w-[90vw] object-contain ic-lora-lb-img");
          img.src = url;
          img.alt = it.stem;
          stage.appendChild(img);
        }
      } else {
        stage.appendChild(node("div", "ic-lora-lb-noimg icon-[lucide--image-off]"));
      }
      pathName.textContent = it.name;
    }
    function step(delta) {
      navIndex = (navIndex + delta + navItems.length) % navItems.length;
      show(navItems[navIndex]);
    }
    bindTip(pathName, () => navItems[navIndex]?.name || "");
    if (navItems.length > 1) {
      const prev = node("button", NATIVE_BTN_NAV + " ic-lora-lb-prev");
      prev.type = "button";
      prev.innerHTML = '<i class="icon-[lucide--chevron-left] size-6"></i>';
      bindTip(prev, () => t("panel.previous"));
      prev.setAttribute("aria-label", t("panel.previous"));
      prev.addEventListener("click", (ev) => { ev.stopPropagation(); step(-1); });
      const next = node("button", NATIVE_BTN_NAV + " ic-lora-lb-next");
      next.type = "button";
      next.innerHTML = '<i class="icon-[lucide--chevron-right] size-6"></i>';
      bindTip(next, () => t("panel.next"));
      next.setAttribute("aria-label", t("panel.next"));
      next.addEventListener("click", (ev) => { ev.stopPropagation(); step(1); });
      overlay.append(prev, next);
    }
    show(navItems[navIndex]);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeLoraLightbox();
    });
    overlay._onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); closeLoraLightbox(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); step(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); step(1); }
    };
    document.addEventListener("keydown", overlay._onKey, true);
    (document.getElementById("infcanvas-root") || document.body).appendChild(overlay);
    loraLightbox = overlay;
  }

  async function renderLoraLibrary(container) {
    if (!isCurrent(container, "lora")) return;
    closeLoraLightbox();
    closeLoraViewMenu();
    const panel = panelHeader(null);
    panel.classList.add("ic-panel--lora");
    /* Folder Select — native SelectTrigger.vue size=md (text + SelectIcon
       chevron), opens a fixed menu of all lora folders in alphabetical order.
       First entry 全部 clears the filter and shows every lora. */
    const folderBtn = node("button", NATIVE_SELECT_TRIGGER + " ic-lora-folder-btn");
    folderBtn.type = "button";
    folderBtn.dataset.state = "closed";
    bindTip(folderBtn, () => t("panel.selectLoraFolder"));
    folderBtn.setAttribute("aria-label", t("panel.selectLoraFolder"));
    folderBtn.setAttribute("aria-haspopup", "menu");
    folderBtn.setAttribute("aria-expanded", "false");
    const folderText = node("span", "flex flex-1 items-center overflow-hidden whitespace-nowrap");
    const folderLabel = node("span", "truncate", t("panel.allLora"));
    folderText.appendChild(folderLabel);
    /* selectDropdownClass = flex shrink-0 cursor-pointer items-center
       justify-center pl-3; icon from SelectIcon = lucide--chevron-down. */
    const folderChev = node("div", "flex shrink-0 cursor-pointer items-center justify-center pl-3");
    folderChev.appendChild(node("i", NATIVE_SELECT_CHEVRON));
    folderBtn.append(folderText, folderChev);
    const folderWrap = node("div", "ic-lora-folder");
    folderWrap.appendChild(folderBtn);

    /* Search row: native SearchInput md + the 资产 panel's view switcher on
       its right (MediaAssetSettingsButton -> settings-2 icon + Popover menu). */
    const searchRow = node("div", "ic-lora-searchrow");
    const search = node("div", NATIVE_SEARCH_ANCHOR + " ic-search ic-lora-search");
    search.appendChild(node("i", NATIVE_SEARCH_ICON + " ic-search-glyph"));
    const searchInput = node("input", NATIVE_SEARCH_INPUT + " ic-search-input");
    searchInput.type = "text";
    searchInput.placeholder = t("panel.searchLora");
    searchInput.setAttribute("aria-label", t("panel.searchLoraInput"));
    search.appendChild(searchInput);

    const viewWrap = node("div", "ic-lora-viewwrap");
    const viewBtn = node("button", NATIVE_BTN_SECONDARY_ICON + " ic-lora-viewbtn");
    viewBtn.type = "button";
    viewBtn.setAttribute("aria-haspopup", "menu");
    viewBtn.setAttribute("aria-expanded", "false");
    bindTip(viewBtn, () => t("panel.viewSettings"));
    viewBtn.setAttribute("aria-label", t("panel.viewSettings"));
    viewBtn.appendChild(node("i", "icon-[lucide--settings-2] size-4"));
    const viewMenu = node("div", "ic-lora-viewmenu " + NATIVE_POPOVER_CONTENT);
    viewMenu.setAttribute("role", "menu");
    viewMenu.hidden = true;
    viewWrap.append(viewBtn, viewMenu);
    searchRow.append(search, viewWrap);
    panel.appendChild(searchRow);
    panel.appendChild(folderWrap);

    const listWrap = node("div", "ic-lora-list scrollbar-custom");
    panel.appendChild(listWrap);
    container.replaceChildren(panel);

    let items = [];
    let loading = true;
    let loadingError = "";
    let selectedFolder = "";   /* "" = 全部 */
    let currentGrid = null;
    let countEl = null;        /* head-slot N/N count; set when the header is built */

    /* Header count: N = the currently listed LoRAs (after folder + search
       filters, i.e. matched.length), N = library total. Driven from render()
       so folder switches AND search input both refresh it. */
    function syncLoraCount(listed) {
      if (!countEl) return;
      /* Same format as the gallery's xog-count: "N / N files" (EN) / "N / N 个文件" (ZH). */
      countEl.textContent = listed + " / " + items.length + " " + t("panel.files");
    }

    /* View-switcher menu — MediaAssetSettingsMenu.vue entries verbatim:
       textonly Button h-8 p-2, icon size-4, trailing check ml-auto. Same three
       modes / glyphs / wording as the 资产 panel, resolved through our i18n. */
    const VIEW_ITEMS = [
      { mode: "list", icon: "list", label: "panel.listView" },
      { mode: "grid-small", icon: "grid-2x2", label: "panel.gridSmall" },
      { mode: "grid", icon: "grid-3x3", label: "panel.gridLarge" },
    ];
    for (const spec of VIEW_ITEMS) {
      const btn = node("button", NATIVE_VIEW_ITEM + " ic-lora-viewitem");
      btn.type = "button";
      btn.dataset.mode = spec.mode;
      btn.setAttribute("role", "menuitemradio");
      const label = node("span", "flex min-w-0 items-center gap-2");
      label.appendChild(node("i", "icon-[lucide--" + spec.icon + "] size-4 shrink-0"));
      label.appendChild(node("span", undefined, t(spec.label)));
      const check = node("i", "icon-[lucide--check] ic-lora-viewcheck ml-auto size-4 shrink-0 opacity-0");
      btn.append(label, check);
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeLoraViewMenu();
        setLoraView(spec.mode);
      });
      viewMenu.appendChild(btn);
    }
    /* Popover.vue arrow: 10x5 at the surface's top edge, centred on the 32px
       trigger (inset-inline-end:0 => 16px from right edge => right 11px). */
    const viewArrow = node("span", "ic-lora-viewmenu-arrow");
    viewArrow.innerHTML = NATIVE_POPOVER_ARROW_SVG;
    viewMenu.appendChild(viewArrow);

    /* Apply a mode to the live grid + check marks without a data reload. */
    function applyViewToGrid(mode) {
      if (currentGrid) {
        currentGrid.dataset.view = mode;
        currentGrid.style.gridTemplateColumns =
          mode === "list" ? "minmax(0, 1fr)" : loraGridColumns(mode);
      }
      for (const btn of viewMenu.querySelectorAll(".ic-lora-viewitem")) {
        const active = btn.dataset.mode === mode;
        btn.dataset.active = String(active);
        const check = btn.querySelector(".ic-lora-viewcheck");
        if (check) check.classList.toggle("opacity-0", !active);
      }
    }
    function setLoraView(mode) {
      if (!LORA_VIEW_MODES.includes(mode)) return;
      NS.prefs?.set(LORA_VIEW_KEY, mode);
      applyViewToGrid(mode);
    }

    function render() {
      if (!isCurrent(container, "lora")) return;
      listWrap.replaceChildren();
      syncLoraCount(0);   /* default; overwritten with matched.length below */
      if (loading) {
        listWrap.appendChild(node("div", "ic-empty", t("panel.loadingLoraModels")));
        return;
      }
      if (loadingError) {
        listWrap.appendChild(node("div", "ic-empty", loadingError));
        return;
      }
      if (!items.length) {
        listWrap.appendChild(node("div", "ic-empty", t("panel.noLoraModelsFound")));
        return;
      }
      const query = (searchInput.value || "").trim().toLowerCase();
      const matched = items.filter((it) =>
        (!selectedFolder || it.category === selectedFolder)
        && (!query
          || it.stem.toLowerCase().includes(query)
          || it.category.toLowerCase().includes(query)));
      syncLoraCount(matched.length);
      /* Pinned loras float to the top, keeping both the pin order and the
         original relative order of unpinned entries (stable sort). */
      const pinOrder = getLoraPinned();
      matched.sort((a, b) => {
        const pa = pinOrder.indexOf(a.name);
        const pb = pinOrder.indexOf(b.name);
        if (pa < 0 && pb < 0) return 0;
        if (pa < 0) return 1;
        if (pb < 0) return -1;
        return pa - pb;
      });
      if (!matched.length) {
        listWrap.appendChild(node("div", "ic-empty", t("panel.noMatchingLora")));
        return;
      }
      /* One flat grid — the folder dropdown already provides the grouping,
         so no per-group category heading/divider is shown above the cards. */
      const grid = node("div", "ic-lora-grid");
      currentGrid = grid;
      applyViewToGrid(getLoraViewMode());
      for (const it of matched) {
        const card = node("button", "ic-lora-card");
        card.type = "button";
        /* Drag onto the canvas: an empty spot seeds a new LoRA stack with this
           lora; dropping on an existing stack appends it. Uses the same MIME
           drag contract as the asset cards (handled in infcanvas-core.js). */
        card.draggable = true;
        card.addEventListener("dragstart", (ev) => {
          if (!ev.dataTransfer) return;
          ev.dataTransfer.setData("application/x-infcanvas-lora", JSON.stringify({
            name: it.name, stem: it.stem, category: it.category,
          }));
          ev.dataTransfer.effectAllowed = "copy";
        });
        const thumb = node("span", "ic-lora-thumb");
        if (it.preview) {
          const url = backend().loraPreviewUrl(it.preview);
          if (isLoraVideo(it.preview)) {
            /* Short clips: stay on a still first frame until hover, then play
               on loop; leaving pauses and rewinds so the grid stays quiet. */
            const vid = node("video", "ic-lora-thumb-img");
            vid.src = url;
            vid.draggable = false;
            vid.muted = true;
            vid.playsInline = true;
            vid.loop = true;
            vid.preload = "metadata";
            vid._hoverPlaying = false;
            const poster = () => { if (!vid._hoverPlaying) { try { vid.currentTime = 0.1; } catch (e) {} } };
            vid.addEventListener("loadeddata", poster);
            card.addEventListener("mouseenter", () => {
              vid._hoverPlaying = true;
              const p = vid.play();
              if (p && typeof p.catch === "function") p.catch(() => {});
            });
            card.addEventListener("mouseleave", () => {
              vid._hoverPlaying = false;
              vid.pause();
              poster();
            });
            thumb.appendChild(vid);
            thumb.appendChild(node("i", "ic-lora-play-badge icon-[lucide--play]"));
          } else {
            const img = node("img", "ic-lora-thumb-img");
            img.loading = "lazy";
            img.src = url;
            img.draggable = false;
            img.alt = it.stem;
            img.addEventListener("error", () => thumb.classList.add("is-broken"));
            thumb.appendChild(img);
          }
        } else {
          thumb.classList.add("is-empty");
          thumb.appendChild(node("i", "icon-[lucide--image-off]"));
        }
        card.appendChild(thumb);
        /* Pinned badge: the exact same native bookmark glyph the 画布管理
           sidebar uses (pi-bookmark-fill size-3.5, muted-foreground). Only the
           anchor position differs — thumbnail top-right in grid, row end in
           list. */
        if (isLoraPinned(it.name)) {
          const badge = node("span", "ic-lora-pin-badge");
          badge.appendChild(node("i", "pi pi-bookmark-fill size-3.5"));
          bindTip(badge, () => t("panel.unpin"));
          badge.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleLoraPin(it.name);
            render();
          });
          card.appendChild(badge);
        }
        const label = node("span", "ic-lora-name", it.stem);
        bindTip(label, it.name, "bottom");
        card.appendChild(label);
        card.addEventListener("click", () => openLoraLightbox(it, matched));
        card.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          closeLoraViewMenu();
          closeLoraFolderMenu();
          const pinned = isLoraPinned(it.name);
          openMenu(ev, [
            { label: t("panel.copyCanvas"), icon: "pi pi-copy", command: () => {
              try {
                api().copyLora(it);
                api().toast("success", t("panel.loraCopied"), t("panel.pasteCanvasCreateLoraStack"));
              } catch (error) { api().toast("error", t("panel.duplicateFailed"), String(error)); }
            } },
            { label: pinned ? t("panel.unpin") : t("panel.pinTop"), icon: pinned ? "pi pi-bookmark" : "pi pi-bookmark-fill", command: () => {
              toggleLoraPin(it.name);
              render();
            } },
          ]);
        });
        grid.appendChild(card);
      }
      listWrap.appendChild(grid);
    }

    searchInput.addEventListener("input", render);

    async function load(force = false) {
      loading = true;
      loadingError = "";
      render();
      try {
        const data = await backend().loras(force);
        items = Array.isArray(data?.items) ? data.items : [];
      } catch (error) {
        items = [];
        loadingError = t("panel.failedLoadLora") + esc(error?.message || error);
      }
      loading = false;
      render();
    }

    /* Build the fixed folder menu from whatever the latest load returned.
       Folder names are sorted alphabetically (localeCompare); 全部 is first. */
    const openFolderMenu = () => {
      closeLoraFolderMenu();
      const menu = node("div", "ic-lora-fmenu " + NATIVE_SELECT_CONTENT + " outline-none");
      menu.setAttribute("role", "listbox");
      const entry = (label, value) => {
        const active = selectedFolder === value;
        /* reka-ui SelectItem renders a div[role=option], NOT a <button>. Using a
           button inherits the browser UA default border (ComfyUI ships no global
           button reset), which paints every option as a boxed chip instead of
           the native borderless row. Mirror the real element + ARIA state. */
        const item = node("div", NATIVE_SELECT_ITEM + " px-2 outline-none " +
          (active ? "bg-muted hover:bg-muted" : "hover:bg-accent"));
        item.dataset.state = active ? "checked" : "unchecked";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", active ? "true" : "false");
        item.tabIndex = -1;
        /* SelectItemText wraps the label in a truncate span. */
        item.appendChild(node("span", "truncate", label));
        if (active) {
          /* SelectItemIndicator = lucide--check at size-4. */
          item.appendChild(node("i", "flex size-4 shrink-0 items-center justify-center text-foreground icon-[lucide--check]"));
        }
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          closeLoraFolderMenu();
          if (!active) {
            selectedFolder = value;
            folderLabel.textContent = value || t("panel.allLora");
            render();
          }
        });
        menu.appendChild(item);
      };
      entry(t("panel.allLora"), "");
      const folders = [...new Set(items.map((it) => it.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      for (const folder of folders) entry(folder, folder);
      (document.getElementById("infcanvas-root") || document.body).appendChild(menu);
      const onDown = (event) => {
        if (menu.contains(event.target) || folderBtn.contains(event.target)) return;
        closeLoraFolderMenu();
      };
      const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); closeLoraFolderMenu(); } };
      document.addEventListener("pointerdown", onDown, true);
      window.addEventListener("keydown", onKey, true);
      folderBtn.setAttribute("aria-expanded", "true");
      folderBtn.dataset.state = "open";
      loraFolderMenu = { el: menu, btn: folderBtn, onDown, onKey };
      const r = folderBtn.getBoundingClientRect();
      const w = Math.max(Math.round(r.width), 192);
      const h = menu.offsetHeight;
      menu.style.width = w + "px";
      menu.style.left = Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8)) + "px";
      menu.style.top = (r.bottom + h > innerHeight - 8
        ? Math.max(8, Math.round(r.top - h - 6))
        : Math.round(r.bottom + 6)) + "px";
    };
    folderBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeLoraViewMenu();
      if (loraFolderMenu && loraFolderMenu.btn === folderBtn) closeLoraFolderMenu();
      else openFolderMenu();
    });

    /* View switcher toggles the Popover; outside pointerdown / Escape closes
       it, mirroring the folder menu's teardown contract. */
    function openLoraViewMenu() {
      applyViewToGrid(getLoraViewMode());
      viewMenu.hidden = false;
      viewBtn.setAttribute("aria-expanded", "true");
      const onDown = (event) => {
        if (viewMenu.contains(event.target) || viewBtn.contains(event.target)) return;
        closeLoraViewMenu();
      };
      const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); closeLoraViewMenu(); } };
      document.addEventListener("pointerdown", onDown, true);
      window.addEventListener("keydown", onKey, true);
      loraViewMenu = { el: viewMenu, btn: viewBtn, onDown, onKey };
    }
    viewBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeLoraFolderMenu();
      if (loraViewMenu && loraViewMenu.btn === viewBtn) closeLoraViewMenu();
      else openLoraViewMenu();
    });

    /* Header refresh immediately left of the native close X, matching the
       资产 panel's refresh. Use the SHELL's native button classes (identical
       to the close button) instead of .xog-* — the gallery stylesheet is only
       injected once a gallery panel opens, so LoRA cannot rely on it. */
    const shell = st().shell;
    if (shell?.headSlot) {
      const refresh = node("button",
        "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
        "items-center justify-center gap-2 border-none font-inter text-sm " +
        "font-medium whitespace-nowrap transition-colors focus-visible:ring-1 " +
        "focus-visible:ring-ring focus-visible:outline-none " +
        "disabled:pointer-events-none disabled:opacity-50 " +
        "bg-transparent text-muted-foreground hover:bg-accent shrink-0 size-8 rounded-lg");
      refresh.type = "button";
      bindTip(refresh, () => t("panel.refreshLoraList"));
      refresh.setAttribute("aria-label", t("panel.refreshLoraList"));
      refresh.innerHTML = '<i class="icon-[lucide--refresh-cw] size-4"></i>';
      refresh.addEventListener("click", () => { load(true); });
      /* Folder-scoped LoRA count, left of the refresh button. Uses the host's
         native text classes (same as the 资产 panel's .xog-count); the gallery
         stylesheet is not injected for this panel, so no .xog-* dependency. */
      countEl = node("span", "text-xs text-muted-foreground whitespace-nowrap shrink-0 ic-lora-count-head");
      countEl.setAttribute("aria-label", t("panel.loraCount"));
      shell.headSlot.replaceChildren(countEl, refresh);
    }

    await load();
  }

  function renderNodeLibrary(container) {
    if (!isCurrent(container, "nodes")) return;
    const panel = panelHeader(null);
    /* One flat list, no role subheadings / row descriptions / footer hint:
       the drawer follows the same fixed order and lucide glyphs as the
       double-click menu (showNodePickMenu), with the same 5 / 4 divider. */
    const ORDER = ["text", "image", "video", "audio", "omni", "lora", "cleanup_vram", "cleanup_ram", "cleanup_both", "text_merge"];
    const list = node("div", "ic-list");
    for (const kind of ORDER) {
      const spec = (NS.SPECS || []).find((entry) => entry.kind === kind);
      if (!spec) continue;
      /* LoRA stack is its own group; mirror the double-click menu exactly. */
      if ((kind === "lora" || kind === "cleanup_vram") && list.childElementCount) {
        list.appendChild(node("div", NATIVE_MENU_SEP + " ic-menu-sep"));
      }
      const button = node("button", NATIVE_TREE_ITEM + " border-0 bg-transparent text-left ic-node-item");
      button.type = "button";
      button.innerHTML = nodeIconHtml(spec.kind, "text-muted-foreground")
        + `<span class="flex-1 truncate">${esc(t(spec.title))}</span>`;
      button.addEventListener("click", () => {
        /* Same placement contract as the canvas menu: start at the last
           canvas pointer (or viewport centre), then let the user move and
           left-click to commit both the position and the group. */
        const begin = NS.flow?.state?.placementActions?.beginPlacement;
        if (begin) {
          const p = api().pastePoint();
          begin(spec, null, { x: p.x, y: p.y });
          return;
        }
        api().addNodeByType(spec.type);
      });
      list.appendChild(button);
    }
    panel.appendChild(list);
    container.replaceChildren(panel);
  }

  async function renderCanvasList(container) {
    if (!isCurrent(container, "canvases")) return;
    const panel = panelHeader(null);
    /* Native sidebar body has no padding/gap wrapper (see .ic-panel--canvases). */
    panel.classList.add("ic-panel--canvases");

    /* BaseWorkflowsSidebarTab puts a SearchInput in the header slot; its
       TextDivider is a left label followed by a growing dashed rule.
       SearchInput.vue md: icon-[lucide--search] size-4 at left-2.5, and the
       clear Button (variant=textonly, size=icon-sm) REPLACES it at the same
       left-2.5 spot — it does not sit on the right. */
    const search = node("div", NATIVE_SEARCH_ANCHOR + " ic-search");
    search.appendChild(node("i", NATIVE_SEARCH_ICON + " ic-search-glyph"));
    const searchInput = node("input", NATIVE_SEARCH_INPUT + " ic-search-input");
    searchInput.type = "text";
    /* Native: $t('g.searchPlaceholder', { subject }) -> "搜索 {subject}…"
       with the space; subject for this tab is 画布. */
    searchInput.placeholder = t("panel.searchCanvases");
    searchInput.setAttribute("aria-label", t("panel.searchCanvasInput"));
    searchInput.addEventListener("input", render);
    search.appendChild(searchInput);
    const clear = node("button", NATIVE_BTN_TEXTONLY_ICON + " absolute left-2.5 ic-search-clear");
    clear.type = "button";
    bindTip(clear, () => t("panel.clearSearch"));
    clear.innerHTML = '<i class="icon-[lucide--x] size-4"></i>';
    clear.addEventListener("click", () => {
      searchInput.value = "";
      render();
      searchInput.focus();
    });
    search.appendChild(clear);
    panel.appendChild(search);
    const refreshBtn = st().shell?.panelRefresh;
    if (refreshBtn) refreshBtn.onclick = load;

    const list = node("div", "ic-list ic-canvas-list scrollbar-custom");
    panel.appendChild(list);
    container.replaceChildren(panel);
    if (focusCanvasSearch) {
      focusCanvasSearch = false;
      searchInput.focus();
    }

    let canvases = [];

    function divider(text) {
      /* TextDivider.vue: flex items-center > span.mr-2.shrink-0 + div.grow
         .border-0.border-t.border-dashed; BaseWorkflowsSidebarTab adds ml-2. */
      const wrap = node("div", NATIVE_DIVIDER + " ic-divider");
      wrap.appendChild(node("span", NATIVE_DIVIDER_LABEL, text));
      const line = node("div", NATIVE_DIVIDER_LINE);
      line.setAttribute("role", "separator");
      wrap.appendChild(line);
      return wrap;
    }

    function rowFor(canvas) {
      /* Mirror the native tree row structure instead of a flattened fake:
         UiTreeItem(row, treeItemClass + level indent) > icon span + leaf chevron
         placeholder + TreeExplorerTreeNode(.tree-node > .node-content label +
         .node-actions bookmark Button). Native classes carry all visuals. */
      const row = node("div", NATIVE_TREE_ROW + " ic-canvas-item");
      row.style.paddingLeft = "8px"; /* treeItemIndent(level=1) = 8px */
      const active = (api().docs() || []).some(
        (entry) => entry.saved && entry.name === canvas.name && entry.id === api().activeId());
      /* data-selected:bg-muted comes from treeItemClass; Reka sets this on the
         selected native item. Mirror it with the real attribute. */
      if (active) row.setAttribute("data-selected", "");
      row.dataset.testid = "tree-node-" + canvas.name;

      /* TreeItem.vue renders the size-5 chevron placeholder BEFORE the slotted
         icon on leaf rows; the row's gap-3 then separates chevron from icon.
         Native icon x = padding 8 + chevron 20 + gap 12 = 40px. Placing the
         placeholder after the icon pulled every icon ~32px too far left. */
      row.appendChild(node("span", NATIVE_TREE_CHEVRON));
      const iconWrap = node("span", NATIVE_TREE_ICON_WRAP);
      iconWrap.appendChild(node("i", "pi pi-file " + NATIVE_TREE_ICON));
      row.appendChild(iconWrap);

      const treeNode = node("div", NATIVE_TREE_NODE);
      const content = node("div", NATIVE_TREE_CONTENT);
      content.appendChild(node("span", NATIVE_TREE_LABEL, canvas.name));
      treeNode.appendChild(content);

      const actions = node("div", NATIVE_TREE_ACTIONS);
      const bookmark = node("button", NATIVE_BTN_MUTED_ICON_SM + " ic-bookmark");
      bookmark.type = "button";
      const paint = (on) => {
        bookmark.innerHTML = '<i class="pi ' + (on ? "pi-bookmark-fill" : "pi-bookmark") +
          " " + NATIVE_BOOKMARK_ICON + '"></i>';
        bookmark.setAttribute("aria-label", t(on ? "panel.removeBookmark" : "panel.addBookmark"));
        bindTip(bookmark, () => (on ? t("panel.removeBookmark") : t("panel.addBookmark")));
      };
      paint(api().isBookmarked(canvas.name));
      bookmark.addEventListener("click", (event) => {
        event.stopPropagation();
        paint(api().toggleBookmark(canvas.name));
        render();
      });
      actions.appendChild(bookmark);
      treeNode.appendChild(actions);
      const nodeHost = node("div", NATIVE_TREE_NODE_HOST);
      nodeHost.appendChild(treeNode);
      row.appendChild(nodeHost);

      row.addEventListener("click", () => api().openByName(canvas.name));
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showCanvasMenu(event, canvas, load, canvases);
      });
      return row;
    }

    function render() {
      search.classList.toggle("has-value", !!searchInput.value);
      const query = String(searchInput.value || "").trim().toLocaleLowerCase();
      const filtered = canvases.filter(
        (canvas) => String(canvas.name).toLocaleLowerCase().includes(query));
      list.replaceChildren();
      const marked = filtered.filter((canvas) => api().isBookmarked(canvas.name));
      if (marked.length) {
        list.appendChild(divider(t("panel.bookmarks")));
        for (const canvas of marked) list.appendChild(rowFor(canvas));
      }
      if (filtered.length) {
        /* Native TextDivider label for the "all workflows" group is 浏览. */
        list.appendChild(divider(t("panel.browse")));
        for (const canvas of filtered) list.appendChild(rowFor(canvas));
      } else {
        /* NoResultsPlaceholder.vue: h-full p-8 > flex flex-col items-center
           bg-(--surface-ground) text-center, with title + message. */
        const empty = node("div", NATIVE_EMPTY);
        const inner = node("div", NATIVE_EMPTY_INNER);
        inner.appendChild(node("i", "pi pi-folder " + NATIVE_EMPTY_ICON));
        inner.appendChild(node("h3", NATIVE_EMPTY_TITLE, t("panel.noMatchingCanvases")));
        inner.appendChild(node("p", NATIVE_EMPTY_MSG,
          query ? t("panel.noMatchingCanvases") : t("panel.noSavedCanvasesYetCreate")));
        empty.appendChild(inner);
        list.appendChild(empty);
      }
    }

    async function load() {
      try {
        const { canvases: items = [] } = await backend().canvases();
        if (!isCurrent(container, "canvases")) return;
        canvases = items;
        render();
      } catch (error) {
        if (!isCurrent(container, "canvases")) return;
        const empty = node("div", NATIVE_EMPTY);
        const inner = node("div", NATIVE_EMPTY_INNER);
        inner.appendChild(node("p", NATIVE_EMPTY_MSG, t("panel.loadFailed") + esc(error)));
        empty.appendChild(inner);
        list.replaceChildren(empty);
      }
    }
    await load();
  }

  /* API config: the sidebar "API Config" button opens a standalone dialog (js/infcanvas-api-config.js). */

  function refreshPanels() {
    const state = st();
    try {
      if (!state.shell || !state.panelBody || !document.body.contains(state.panelBody)) return;
      if (state.panelKey === "canvases") renderCanvasList(state.panelBody);
    } catch (error) { console.warn("[InfCanvas] refreshPanels failed", error); }
  }

  /* No toast/dialog implementation here: infcanvas-core.js calls ComfyUI's
     own extensionManager.toast / .dialog.confirm / .dialog.prompt, and the
     stylesheet keeps DialogPortal / the toast dock above #infcanvas-root.
     Reimplementing them would only drift from ComfyUI's real appearance. */

  NS.ui = {
    injectStyles, mountShell, unmountShell, mountTabs, removeTabs, renderTabs,
    setPanel, togglePanel, getPanelKey: () => st().panelKey,
    isJobHistoryDocked, setJobHistoryDocked, syncJobHistoryRail,
    renderNodeLibrary, renderCanvasList, refreshPanels,
    showAddNodeMenu, showConnectNodeMenu,
  };
})();
