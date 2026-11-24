// ../../web/canvas/css/infcanvas-isolation.css
var infcanvas_isolation_default = `/* ---- 1. hide ALL of ComfyUI's UI in canvas mode -------------------------\r
   ComfyUI (and Reka UI dialogs) may set document.body.style.pointerEvents =\r
   'none' while a modal is open. Our root must opt back in explicitly, and\r
   tour overlays must not sit on top of the canvas. Nothing here is removed\r
   from the DOM, so exiting restores everything.\r
\r
   Exception: .z-overlay is DialogPortal.vue's container\r
   ('pointer-events-none fixed inset-0 z-overlay *:pointer-events-auto\r
   empty:hidden') and .z-toast is the toast dock. We call ComfyUI's own\r
   extensionManager.dialog.confirm / .prompt / .toast, so these stay visible\r
   and above our root -- the dialogs ARE ComfyUI's, not a reimplementation.\r
   Dialogs that were already open before entering canvas mode are tagged with\r
   data-infcanvas-suppressed and stay hidden (see infcanvas-core.js). */\r
\r
/* ---- shared z-index tokens (scoped to canvas mode) ---------------------\r
   Teleported overlays live on <body>, outside #infcanvas-root, so these are\r
   declared on html.infcanvas-mode (not on the root element) to be visible to\r
   every rule in this file. Values are unchanged from the literals they\r
   replace -- no visual difference. */\r
html.infcanvas-mode {\r
  --ic-z-canvas: 20000;        /* #infcanvas-root (tokens.css) */\r
  --ic-z-overlay: 2147483000;  /* teleported dialogs/menus/lightbox */\r
  --ic-z-toast: 2147483600;    /* toast dock, above every overlay */\r
  --ic-z-console: 900;         /* #infcanvas-console (infcanvas-console.css) */\r
  --ic-z-menu: 2400;           /* .ic-menu fixed context menu (overlays.css) */\r
  --ic-z-lora-menu: 10007;     /* .ic-lora-viewmenu / .ic-lora-fmenu (lora.css) */\r
  --ic-z-lora-lightbox: 30000; /* .ic-lora-lb (lora.css) */\r
}\r
\r
html.infcanvas-mode body > div:not(#infcanvas-root):not(#splash-loader):not(.litemenu):not(.graphdialog):not(.litegraph-contextmenu):not(.z-overlay):not(.xog-dlg):not(.xog-lb):not(.xog-ctx):not(.xog-selbar):not(.xog-marquee):not(.ic-taskmenu):not(.ic-clear-dlg) {\r
  visibility: hidden !important;\r
  pointer-events: none !important;\r
}\r
/* Our native-styled QueueClearHistoryDialog reimplementation: teleported to\r
   <body> so the host UnoCSS classes apply, whitelisted and lifted above the\r
   canvas root exactly like .ic-taskmenu. */\r
html.infcanvas-mode body > div.ic-clear-dlg {\r
  visibility: visible !important;\r
  pointer-events: auto !important;\r
  z-index: var(--ic-z-overlay) !important;\r
}\r
/* Our own queue-filter/sort radio menu, teleported to <body> with fixed coords\r
   so it escapes the task-list stacking context. Whitelist + lift over the root\r
   exactly like our other teleported overlays (no ComfyUI class reuse). */\r
html.infcanvas-mode body > div.ic-taskmenu {\r
  visibility: visible !important;\r
  pointer-events: auto !important;\r
  z-index: var(--ic-z-overlay) !important;\r
}\r
/* History-gallery overlays are teleported to <body> (like ComfyUI's own\r
   dialogs/menus) so they escape the sidebar's stacking context. Whitelist them\r
   above, and lift them over the canvas root (#infcanvas-root z-index 20000). */\r
html.infcanvas-mode body > div.xog-dlg,\r
html.infcanvas-mode body > div.xog-lb,\r
html.infcanvas-mode body > div.xog-ctx,\r
html.infcanvas-mode body > div.xog-selbar {\r
  visibility: visible !important;\r
  pointer-events: auto !important;\r
  z-index: var(--ic-z-overlay) !important;\r
}\r
/* The gallery marquee is a native z-overlay upstream; without lifting it over\r
   #infcanvas-root (20000) the blue rectangle is painted behind the canvas and\r
   the drag looks like it selects without drawing anything. Keep pointer-events\r
   none \u2014 the rectangle must not swallow the drag it visualises. */\r
html.infcanvas-mode body > div.xog-marquee {\r
  visibility: visible !important;\r
  z-index: var(--ic-z-overlay) !important;\r
}\r
html.infcanvas-mode body > div.z-overlay {\r
  visibility: visible !important;\r
  z-index: var(--ic-z-overlay) !important;\r
}\r
html.infcanvas-mode body > div.z-overlay > [data-infcanvas-suppressed] {\r
  visibility: hidden !important;\r
  pointer-events: none !important;\r
}\r
/* Toast dock must outrank the gallery lightbox (.xog-lb) and every other\r
   teleported overlay, otherwise "\u5DF2\u590D\u5236" is painted behind the preview. */\r
html.infcanvas-mode .z-toast {\r
  visibility: visible !important;\r
  z-index: var(--ic-z-toast) !important;\r
}\r
html.infcanvas-mode body > div.z-toast { z-index: var(--ic-z-toast) !important; }\r
html.infcanvas-mode .z-toast * { visibility: visible !important; }\r
/* Toast cards stay 100% ComfyUI-native (we only call the host toast store).\r
   The host dock is an <ol class="z-toast ... fixed top-20 right-..."> anchored\r
   to the TOP-right. Leave that positioning untouched in canvas mode so toasts\r
   appear in the same top-right spot (and follow the same theme) as ComfyUI. */\r
html.infcanvas-mode .litemenu,\r
html.infcanvas-mode .graphdialog,\r
html.infcanvas-mode .litegraph-contextmenu {\r
  visibility: visible !important;\r
  pointer-events: auto !important;\r
  z-index: var(--ic-z-overlay) !important;\r
}\r
`;

// ../../web/canvas/css/infcanvas-tokens.css
var infcanvas_tokens_default = "/* ---- 2. canvas mode root (fully owned by this extension) ---------------- */\r\n#infcanvas-root {\r\n  --ic-font-sans: var(--font-inter, Inter, Arial, sans-serif);\r\n  position: fixed; inset: 0; z-index: var(--ic-z-canvas, 20000);\r\n  pointer-events: auto !important;\r\n  display: flex; flex-direction: column;\r\n  background: var(--ic-input, #171718);\r\n  color: var(--ic-text, #ffffff);\r\n  font-family: var(--ic-font-sans, var(--font-inter, Inter, Arial, sans-serif));\r\n  font-size: var(--text-base, 16px);\r\n  box-sizing: border-box;\r\n}\r\n#infcanvas-root *, #infcanvas-root *::before, #infcanvas-root *::after { box-sizing: border-box; }\r\n#infcanvas-root button { font-family: inherit; }\r\n/* ComfyUI's border/50 (used on the tab bar, rail and panel header) */\r\n#infcanvas-root {\r\n  --ic-border-50: color-mix(in srgb, var(--border, #494a50) 50%, transparent);\r\n  --ic-shadow: 1px 1px 8px 0 var(--shadow-color, rgba(0, 0, 0, .4));\r\n\r\n  /* ---- ONE shared palette for every surface in canvas mode ----\r\n     All aliases resolve to ComfyUI's own design tokens, so the canvas follows\r\n     the host theme (dark/light) instead of shipping a second hardcoded theme.\r\n     Dialogs, side panels, tool windows and node widgets all reference these. */\r\n  /* Hairlines are translucent (ComfyUI's own border/50 pattern). A solid\r\n     #494a50 1px line around EVERY control reads as a spreadsheet, not a UI. */\r\n  --ic-line: color-mix(in srgb, var(--border, #494a50) 42%, transparent);\r\n  --ic-panel: var(--secondary-background, #262729);\r\n  --ic-input: var(--background, #171718);\r\n  --ic-text: var(--base-foreground, #ffffff);\r\n  --ic-soft: var(--muted-foreground, #8a8a8a);\r\n  --ic-brand: var(--primary, #0b8ce9);\r\n  --ic-danger: var(--destructive, #b33a3a);\r\n  --ic-hover: color-mix(in srgb, var(--muted, #3c3d42) 55%, transparent);\r\n  --ic-brand-soft: color-mix(in srgb, var(--primary, #0b8ce9) 14%, transparent);\r\n  --ic-brand-ring: color-mix(in srgb, var(--primary, #0b8ce9) 26%, transparent);\r\n  --ic-danger-soft: color-mix(in srgb, var(--destructive, #b33a3a) 16%, transparent);\r\n\r\n  /* Flat panels need a hint of depth: a 1px top highlight + a soft shadow. */\r\n  --ic-hi: inset 0 1px 0 color-mix(in srgb, var(--color-white, #fff) 4.5%, transparent);\r\n  --ic-shadow-card: 0 8px 26px color-mix(in srgb, var(--color-black, #000) 32%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-white, #fff) 3.5%, transparent);\r\n  --ic-shadow-pop: 0 18px 48px color-mix(in srgb, var(--color-black, #000) 50%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-white, #fff) 5%, transparent);\r\n\r\n  /* ---- ONE shared control spec ---- */\r\n  --ic-ctrl-h: 30px;       /* buttons, inputs, selects, chips */\r\n  --ic-ctrl-r: 8px;        /* control corner radius */\r\n  --ic-ctrl-fs: 12px;      /* control font size */\r\n  --ic-radius: 12px;       /* cards / blocks (matches the 12px node card) */\r\n  --ic-radius-lg: 16px;    /* dialog shells */\r\n}\r\n@supports not (color: color-mix(in srgb, red 50%, transparent)) {\r\n  #infcanvas-root { --ic-border-50: rgba(73, 74, 80, .5); }\r\n}\r\n";

// ../../web/canvas/css/infcanvas-layout.css
var infcanvas_layout_default = `/* ---- 3. workflow-style tab bar ------------------------------------------\r
   ComfyUI: .workflow-tabs-container = h 38px, bg-background, border-b\r
   border/50, shadow-md; inner flex gap 4px px 4px. TabsTrigger = full height,\r
   radius 8px, no border, padding 8px 8px 8px 12px, gap 8px, 14px text,\r
   active bg-secondary + text-foreground, inactive text-muted-foreground. */\r
#infcanvas-tabbar {\r
  display: flex; align-items: center; flex: 0 0 auto;\r
  height: var(--workflow-tabs-height, 2.375rem);\r
  padding: 0 4px; gap: 4px;\r
  background: var(--ic-input, #171718);\r
  border-bottom: 1px solid var(--ic-border-50);\r
  /* Shadow comes from the native shadow-md class on the element (same one\r
     ComfyUI's .workflow-tabs-container uses) -- no hard-coded box-shadow. */\r
  overflow: hidden;\r
  /* The bar sits in normal flow, so #infcanvas-body (stage included) painted\r
     AFTER it and swallowed the whole shadow. Lift it into its own layer so the\r
     blur falls on the canvas. It must also sit ABOVE the drawer (z=12) and its\r
     resize handle (z=13), otherwise an open side panel covers the shadow where\r
     it meets the tab bar -- exactly the edge that must stay shadowed. */\r
  position: relative; z-index: 14;\r
}\r
#infcanvas-tabs { display: flex; align-items: center; gap: 4px; height: 100%; flex: 1 1 auto; min-width: 0; overflow: hidden; }\r
.ic-tab-strip { display: flex; align-items: center; gap: 4px; height: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }\r
/* WorkflowTab.vue: wrapper is min-w-22.5 + shrink (inactive) / shrink-0\r
   (active) with NO fixed width \u2014 a tab is as wide as its label (max 150px) and\r
   only shrinks when the strip runs out. The label is followed by a size-4\r
   shrink-0 status slot; the close button is absolutely positioned over that\r
   slot (right-2), so it never covers the label text. */\r
.ic-tab {\r
  position: relative; display: inline-flex; align-items: center; gap: 8px;\r
  height: 100%; min-width: 90px; flex: 0 1 auto;\r
  padding: 8px 8px 8px 12px;\r
  border: 0; border-radius: 8px; background: transparent;\r
  color: var(--ic-soft, #8a8a8a);\r
  font-family: var(--font-inter, Inter, sans-serif); font-size: var(--text-sm, 14px); font-weight: var(--font-weight-normal, 400);\r
  line-height: 1; white-space: nowrap;\r
  transition: all .2s cubic-bezier(.4, 0, .2, 1);\r
  cursor: pointer; user-select: none;\r
}\r
.ic-tab:hover { background: color-mix(in srgb, var(--ic-panel, #262729) 50%, transparent); }\r
.ic-tab.is-active {\r
  flex: 0 0 auto; min-width: 90px;\r
  background: var(--ic-panel, #262729); color: var(--ic-text, #ffffff);\r
}\r
.ic-tab .ic-label {\r
  display: inline-block; flex: 1 1 auto; min-width: 0; max-width: 150px;\r
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\r
  font-family: var(--font-inter, Inter, sans-serif); font-size: var(--text-sm, 14px); font-weight: var(--font-weight-normal, 400); line-height: 1;\r
}\r
.ic-tab.is-active .ic-label { flex: 0 0 auto; max-width: none; }\r
.ic-status {\r
  position: relative; display: inline-flex; align-items: center; justify-content: center;\r
  width: 16px; height: 16px; flex: 0 0 16px;\r
}\r
.ic-tab .ic-dot {\r
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);\r
  width: 8px; height: 8px; border-radius: 50%;\r
  background: var(--ic-soft, #8a8a8a);\r
}\r
.ic-tab.is-active .ic-dot { background: var(--ic-text, #ffffff); }\r
.ic-tab:hover .ic-status, .ic-tab:focus-within .ic-status { visibility: hidden; }\r
.ic-tab .ic-close {\r
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);\r
  display: inline-flex; align-items: center; justify-content: center;\r
  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 0;\r
  background: transparent; color: var(--ic-soft, #8a8a8a);\r
  font-size: var(--text-sm, 14px); opacity: 0; cursor: pointer;\r
}\r
/* Close glyph is the native one: WorkflowTab.vue renders <i class="icon-\r
   [lucide--x] size-4">, i.e. a 16px lucide mask icon (not a 14px PrimeIcon). */\r
.ic-tab .ic-close i { width: 16px; height: 16px; }\r
/* closeButtonVisibility: active + no status dot is always visible; otherwise\r
   hover/focus hides the dot and reveals the close button. */\r
.ic-tab.is-active:not(.has-status) .ic-close,\r
.ic-tab:hover .ic-close,\r
.ic-tab:focus-within .ic-close { opacity: 1; }\r
/* Button variant=muted-textonly: bg-transparent text-muted-foreground\r
   hover:bg-accent (--accent = #313235). Text colour does NOT change. */\r
.ic-tab .ic-close:hover { background: var(--accent, #313235); }\r
.ic-tab-add {\r
  display: inline-flex; align-items: center; justify-content: center;\r
  width: 32px; height: 32px; flex: 0 0 auto;\r
  border: 0; border-radius: 8px; background: transparent;\r
  color: var(--ic-soft, #8a8a8a); font-size: var(--text-sm, 14px); cursor: pointer;\r
  transition: background-color .1s cubic-bezier(.4, 0, .2, 1), color .1s cubic-bezier(.4, 0, .2, 1);\r
}\r
.ic-tab-add i { font-size: var(--text-sm, 14px); }\r
/* Same muted-textonly hover as the close button: accent surface, no colour shift. */\r
.ic-tab-add:hover { background: var(--accent, #313235); }\r
#infcanvas-body { display: flex; flex: 1 1 auto; min-height: 0; position: relative; }\r
\r
/* ---- 4. left rail: SideToolbar.vue / SidebarIcon.vue --------------------\r
   The rail and its buttons carry ComfyUI's own class names, so button\r
   variants, --sidebar-* tokens, hover and .side-bar-button-selected all come\r
   from the host stylesheet. Only the flex geometry belongs to us. */\r
#infcanvas-sidebar {\r
  flex: 0 0 var(--sidebar-width, 56px);\r
  width: var(--sidebar-width, 56px);\r
  display: flex; flex-direction: column; align-items: center;\r
  padding: var(--sidebar-padding, 4px) 0;\r
  background: var(--ic-input, #171718);\r
  border-right: 1px solid var(--ic-border-50);\r
  /* Shadow comes from the native shadow-md class already on the element\r
     (identical to ComfyUI's .connected-sidebar); no hard-coded override. */\r
  overflow: hidden; z-index: 2;\r
}\r
.ic-side-btn { position: relative; }\r
/* Brand mark at the top of the rail: deliberately a div, not a side-bar-button\r
   \u2014 no hover, no tooltip, no click handler. Exit lives in the tab bar. */\r
#infcanvas-sidebar .ic-side-logo {\r
  display: flex; align-items: center; justify-content: center;\r
  flex: 0 0 var(--sidebar-item-height, 48px);\r
  width: var(--sidebar-width, 56px);\r
  height: var(--sidebar-item-height, 48px);\r
  pointer-events: none; user-select: none;\r
}\r
/* The mark is a span painted with mask + currentColor (set in infcanvas-ui.js),\r
   so it inherits this theme's foreground and survives the light rail. */\r
/* SidebarIcon.vue keeps its labels at leading-none (line-height:1). Keep it so\r
   the icon and label sit at exactly ComfyUI's vertical offsets - line-height\r
   1.2 grows the flex-col by 2px and shifts the icon 1px above native (the\r
   icon is a symmetrical glyph so that 1px reads as "icon too high"). Keep\r
   overflow:visible so long-label descenders (e.g. the g in English) survive. */\r
#infcanvas-sidebar .side-bar-button-label {\r
  line-height: 1;\r
  overflow: visible;\r
}\r
/* ---- 5. drawer: LiteGraphCanvasSplitterOverlay.vue ----------------------\r
   Measured in a real browser: .side-bar-panel has transition-duration 0s and\r
   getAnimations() == 0 -- the width changes instantly (reka-ui splitter sets\r
   flex: 20.4 1 0 => 311.5px at 1600px, right of the 56px rail). The only\r
   animation is .sidebar-content-container's opacity over 200ms ease-in-out.\r
   Header/body classes come from SidebarTabTemplate.vue.\r
\r
   Layout: GraphCanvas.vue renders <canvas id="graph-canvas"\r
   class="absolute inset-0 size-full"> and the whole splitter tree as a\r
   SEPARATE absolute overlay (LiteGraphCanvasSplitterOverlay.vue root =\r
   "pointer-events-none absolute top-0 left-0 z-999 flex size-full").\r
   Measured in 1.59.1: opening the panel leaves #graph-canvas at exactly\r
   the same rect (0,0,1584,849). So the panel overlays the canvas instead of\r
   shrinking it. Our stage/panel/handle mirror that relationship: the stage\r
   is absolutely positioned and never resized by the panel. */\r
#infcanvas-panel {\r
  position: absolute; top: 0; bottom: 0;\r
  left: var(--sidebar-width, 56px);\r
  width: var(--infcanvas-panel-width, 312px);\r
  display: none; overflow: hidden;\r
  background: var(--ic-input, #171718);\r
  /* The multi-select dashed border / Alt-knife trail are siblings of VueFlow\r
     at z=10 / z=9. The drawer is an overlay, so it must paint above them;\r
     otherwise the selection rect cuts straight across an open side panel. */\r
  z-index: 12;\r
}\r
/* --infcanvas-panel-width is set on #infcanvas-root by attachPanelResizer():\r
   the pixel width restored from localStorage / clamped while dragging. */\r
#infcanvas-root.has-panel #infcanvas-panel { display: block; }\r
#infcanvas-panel > .sidebar-content-container { opacity: 0; }\r
#infcanvas-root.has-panel #infcanvas-panel > .sidebar-content-container { opacity: 1; }\r
#infcanvas-panel-body { min-height: 0; }\r
\r
/* Side-panel scrollbars use the host's own .scrollbar-custom utility on each\r
   scroll container (panel body, prompt/canvas lists, LORA list); no local\r
   pseudo-element copy is needed. */\r
\r
/* Gallery in the canvas drawer: pin the header and scroll ONLY the card grid,\r
   so the thin .xog scrollbar starts below the search row (ComfyUI native\r
   media-assets behaviour) instead of spanning the whole drawer. Scoped to the\r
   canvas host so ComfyUI's own gallery sidebar tab keeps its layout. */\r
#infcanvas-panel-body.ic-gallery-host {\r
  display: flex;\r
  flex-direction: column;\r
  min-height: 0;\r
  overflow: hidden;\r
}\r
/* NOTE: the gallery builder adds the xog class to the host itself, so the\r
   host IS .xog here \u2014 .xog-bar / .xog-body are its DIRECT children. */\r
#infcanvas-panel-body.ic-gallery-host.xog {\r
  flex: 1 1 auto;\r
  min-height: 0;\r
  height: 100%;\r
}\r
#infcanvas-panel-body.ic-gallery-host > .xog-bar { flex: none; }\r
#infcanvas-panel-body.ic-gallery-host > .xog-body {\r
  flex: 1 1 auto;\r
  min-height: 0;\r
  overflow-y: auto;\r
}\r
\r
/* SplitterResizeHandle.vue: 1px w-px line + 4px ::after hit area rendered by\r
   the host's own Tailwind classes. Hidden while no side panel is mounted,\r
   exactly like :disabled="!firstPanelRendered" + 'hidden' in the overlay.\r
   It sits on the overlay too, at the panel's right edge. */\r
#infcanvas-panel-resize-handle {\r
  position: absolute; top: 0; bottom: 0;\r
  left: calc(var(--sidebar-width, 56px) + var(--infcanvas-panel-width, 312px));\r
  width: 1px; display: none; z-index: 13;\r
}\r
#infcanvas-root.has-panel #infcanvas-panel-resize-handle { display: flex; }\r
/* reka-ui injects a global '*{cursor:ew-resize!important}' style during drag;\r
   keeping it inside our root avoids leaking into ComfyUI's own UI. */\r
#infcanvas-root.is-resizing,\r
#infcanvas-root.is-resizing * { cursor: ew-resize !important; }\r
/* Live node placement (wire-release -> pick -> node rides the pointer): keep a\r
   normal arrow everywhere; connection drag otherwise leaves a crosshair/grab. */\r
#infcanvas-root.is-placing,\r
#infcanvas-root.is-placing * { cursor: default !important; }\r
\r
/* #graph-canvas equivalent: absolutely positioned, full height, and NOT part\r
   of the panel's flex row, so opening/closing/resizing a side panel never\r
   changes its rect (nor triggers resizeSurface / shifts graph coordinates). */\r
#infcanvas-stage {\r
  position: absolute; top: 0; right: 0; bottom: 0;\r
  left: var(--sidebar-width, 56px);\r
  overflow: hidden;\r
}\r
/* The graph surface itself is Vue Flow (#infcanvas-vueflow); its layout and the\r
   node chrome live in js/infcanvas-flow.js, next to the components they style. */\r
`;

// ../../web/canvas/css/infcanvas-panels.css
var infcanvas_panels_default = `/* ---- 6. panel content: ComfyUI palette for list / asset grid ------------ */\r
.ic-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 16px; color: var(--ic-text, #ffffff); font-size: var(--text-sm, 14px); }\r
/* BaseWorkflowsSidebarTab has NO padding/gap wrapper: the SearchInput sits in\r
   SidebarTopArea (px-4 py-2) and the tree follows flush. Measured native:\r
   panel top 38 -> header ends 102 -> search 110 (8px py) -> 32 tall -> divider\r
   150 (8px py). So this panel must drop the shared 8+8 and inherit 16px. */\r
.ic-panel--canvases { gap: 0; padding: 0; font-size: var(--text-base, 16px); height: 100%; min-height: 0; overflow: hidden; }\r
/* Only the tree area scrolls: the search row stays put, like the native\r
   sidebar where SidebarTopArea lives outside the scrollable tree. */\r
.ic-panel--canvases .ic-canvas-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }\r
/* the list is a flex column inside a fixed-height scroller: rows must keep\r
   their intrinsic 36px (8px padding + 20px line) instead of shrinking. */\r
.ic-panel--canvases .ic-canvas-list > * { flex: 0 0 auto; }\r
.ic-section {\r
  display: flex; align-items: center; gap: 8px; min-height: 32px;\r
  padding: 0 16px; color: var(--ic-soft, #8a8a8a);\r
  font-size: var(--text-xs, 12px); font-weight: var(--font-weight-semibold, 600); letter-spacing: .02em;\r
}\r
.ic-row { display: flex; align-items: center; gap: 8px; padding: 0 16px; }\r
.ic-btn {\r
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;\r
  height: var(--ic-ctrl-h, 30px); padding: 0 12px;\r
  border: 1px solid var(--ic-line, #494a50); border-radius: var(--ic-ctrl-r, 8px);\r
  background: var(--ic-panel, #262729); color: var(--ic-text, #ffffff);\r
  font-size: var(--ic-ctrl-fs, 12px); font-weight: var(--font-weight-normal, 400); white-space: nowrap; cursor: pointer;\r
  transition: background-color .1s cubic-bezier(.4, 0, .2, 1), color .1s cubic-bezier(.4, 0, .2, 1);\r
}\r
/* Neutral hover, matching every other sidebar control (menu/target/canvas\r
   rows all use --accent); no brand blue here. */\r
.ic-btn:hover:not(:disabled) { background: var(--accent, #313235); color: var(--foreground, #ffffff); }\r
.ic-btn:disabled { opacity: .45; cursor: default; }\r
.ic-btn i { font-size: var(--text-sm, 14px); }\r
.ic-btn.danger:hover:not(:disabled) {\r
  border-color: var(--ic-danger, #b33a3a); background: var(--ic-danger-soft, rgba(179,58,58,.16));\r
  color: var(--ic-danger, #b33a3a);\r
}\r
.ic-btn.tiny { width: var(--ic-ctrl-h, 30px); height: var(--ic-ctrl-h, 30px); padding: 0; font-size: var(--ic-ctrl-fs, 12px); }\r
.ic-list { display: flex; flex-direction: column; gap: calc(var(--spacing, 4px) * .5); padding: 0 8px; }\r
.ic-item {\r
  display: flex; align-items: center; gap: calc(var(--spacing, 4px) * 2); width: 100%; min-height: 36px;\r
  padding: 8px; border: 0; border-radius: var(--ic-ctrl-r, 8px); background: transparent;\r
  color: var(--ic-text, #ffffff); text-align: left; font-size: var(--text-sm, 14px); cursor: pointer;\r
  transition: background-color .1s cubic-bezier(.4, 0, .2, 1);\r
}\r
.ic-item:hover { background: var(--ic-hover, #313235); }\r
.ic-item .ic-item-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\r
.ic-item .ic-item-desc { color: var(--ic-soft, #8a8a8a); font-size: var(--text-xs, 12px); white-space: nowrap; }\r
.ic-item i { width: var(--sidebar-icon-size, 16px); text-align: center; font-size: var(--text-sm, 14px); color: var(--ic-soft, #8a8a8a); }\r
/* \u6DFB\u52A0\u8282\u70B9\u5217\u8868\u7684\u56FE\u6807\u73B0\u5728\u76F4\u63A5\u6302\u5BBF\u4E3B icon-[lucide--*] class\uFF0C\u5C3A\u5BF8/\u989C\u8272\u7531\r
   size-4 + text-muted-foreground \u51B3\u5B9A\uFF1B\u8FD9\u91CC\u4E0D\u518D\u624B\u753B SVG\u3002 */\r
.ic-item .ic-btn { margin-left: auto; }\r
.ic-empty { padding: 24px 16px; color: var(--ic-soft, #8a8a8a); text-align: center; line-height: 1.6; font-size: var(--text-sm, 14px); }\r
\r
/* ---- canvas sidebar: ComfyUI workflow sidebar measured values ---------- */\r
/* Token truth (getComputedStyle): --secondary #262729, --accent #313235,\r
   --muted-foreground #8a8a8a, --border #494a50, font Inter 12/16.\r
   SidebarTabTemplate: title span.truncate.font-bold -> 16px/700, white.\r
   Header: min-h-16 border-b px-4 -> measured 64px tall, 16px side padding. */\r
#infcanvas-panel .font-bold { font-family: var(--ic-font-sans, var(--font-inter, Inter, Arial, sans-serif)); font-size: var(--text-base, 16px); font-weight: var(--font-weight-bold, 700); line-height: normal; color: var(--foreground, #ffffff); }\r
\r
/* Search box: native SearchInput md classes live on the DOM itself\r
   (NATIVE_SEARCH_ANCHOR / ICON / INPUT / BTN_TEXTONLY_ICON in ui.js). This\r
   block keeps only the two things UnoCSS cannot express here: the 8px/16px\r
   outer inset (native gets it from SidebarTopArea's px-4 py-2 wrapper, which\r
   we do not mount) and the Vue v-if clear/glyph swap (we toggle .has-value).\r
   Do NOT restyle ::placeholder -- the native SearchInput.vue sets no colour,\r
   so the host/UA default (rgb 117,117,117) applies. Forcing muted-foreground\r
   here made our placeholder visibly darker than every native search box. */\r
/* Native SearchInput carries w-full (100%). We mount it in a panel that\r
   supplies 16px side insets via margin (instead of the native px-4 wrapper),\r
   so subtract those 32px from the width \u2014 otherwise the box is 100%+32px and\r
   its right edge overflows 16px past the panel while the folder Select above\r
   (no w-full, shrinks to 280px) leaves a correct 16px. Double class wins over\r
   UnoCSS's single-class .w-full regardless of stylesheet order. */\r
.ic-search.ic-search { width: calc(100% - 32px); }\r
.ic-search { margin: 8px 16px; }\r
.ic-search-clear { display: none; }\r
.ic-search.has-value .ic-search-clear { display: inline-flex; }\r
.ic-search.has-value .ic-search-glyph { display: none; }\r
/* SidebarTabTemplate tool-buttons wrapper: flex gap-2 overflow-hidden\r
   w-0 opacity-0 transition-all duration-200, revealed on sidebar hover /\r
   focus-within. The wrapper collapses, the button keeps its 32px box. */\r
#infcanvas-panel .ic-tool-buttons {\r
  display: flex; gap: 8px; overflow: hidden;\r
  width: 0; opacity: 0; transition: all .2s;\r
}\r
#infcanvas-panel:hover .ic-tool-buttons,\r
#infcanvas-panel:focus-within .ic-tool-buttons { width: auto; opacity: 1; }\r
/* Button variant=muted-textonly size=icon: size-8 rounded-lg, lucide 16px. */\r
#infcanvas-panel [data-testid="workflows-refresh-button"] i { font-size: var(--text-base, 16px); }\r
/* Header slot (immediately left of the close X). gallery's own CSS defines\r
   this too, but LORA doesn't inject that stylesheet \u2014 provide the same\r
   display:contents here so its refresh button sits directly in the title row. */\r
#infcanvas-panel .xog-head-slot { display: contents; }\r
.ic-canvas-list { gap: 0; padding: 0 8px 16px; }\r
/* Canvas manager now mounts the native strings from treeStyles.ts /\r
   TextDivider.vue / WorkflowTreeLeaf.vue / NoResultsPlaceholder.vue directly\r
   on the DOM (see ui.js NATIVE_TREE_* / NATIVE_DIVIDER_* / NATIVE_EMPTY_*).\r
   Those UnoCSS classes carry every visual: color, font, icon, glyph, spacing.\r
   Only what the host's build-time scanner cannot generate for our dynamic\r
   DOM stays here, plus pure layout hooks \u2014 no re-implemented visuals. */\r
\r
/* TextDivider's dashed rule must run to the panel's right edge. The native\r
   panel gives TextDivider ml-2 inside a px-2 tree; we keep the same overhang\r
   because our scroll container supplies the 8px row inset instead. */\r
.ic-divider { margin-right: -8px; }\r
\r
/* treeItemClass uses build-time-only UnoCSS forms that are NOT emitted for our\r
   runtime-created DOM: py-(--tree-item-padding,--spacing(2)) (arbitrary CSS\r
   var shortcut), data-selected:bg-muted (state variant driven by a real\r
   data-selected attr), and the motion-safe group-hover/tree-node reveal on\r
   .node-actions. Restate just those three with the same native tokens. */\r
.ic-canvas-item { padding-top: calc(var(--spacing, 4px) * 2); padding-bottom: calc(var(--spacing, 4px) * 2); }\r
.ic-canvas-item[data-selected] { background: var(--muted, #3c3d42); }\r
.ic-canvas-item .node-actions { opacity: 0; }\r
.ic-canvas-item:hover .node-actions,\r
.ic-canvas-item:focus-within .node-actions { opacity: 1; }\r
/* size-3.5 on a PrimeIcon: the box is 14px but its glyph inks at font-size\r
   16px and overflows by design (measured on the native bookmark leaf). */\r
.ic-bookmark i { width: calc(var(--spacing, 4px) * 3.5); height: calc(var(--spacing, 4px) * 3.5); font-size: var(--text-base, 16px); line-height: 16px; }`;

// ../../web/canvas/css/infcanvas-overlays.css
var infcanvas_overlays_default = "/* ---- 7. tab context menu: ComfyUI menu surface ------------------------- */\r\n/* Surface/items/separator are the native menuStyles.ts class strings; icon\r\n   and label now follow MenuItemContent.vue directly (no wrapper CSS). Only\r\n   screen positioning, a z-index above the canvas (native z-overlay=1700 is\r\n   below the canvas root), and per-menu min-width overrides stay local. */\r\n.ic-menu { position: fixed; z-index: var(--ic-z-menu, 2400); }\r\n/* WorkflowTab.vue adds min-w-56 to the tab menu only; node menus are narrower.\r\n   Native min-w-48 (=192px) applies to the rest via NATIVE_MENU_CONTENT. */\r\n.ic-menu--tab { min-width: 224px; }\r\n.ic-node-menu { min-width: 176px; }\r\n/* Double-click node menu (#infcanvas-node-menu): MenuLabel.vue's caption --\r\n   12px, muted, 500 weight, px-2 -- plus a narrower width than the tab menu. */\r\n.ic-menu-section {\r\n  padding: 4px 12px 2px; color: var(--ic-soft, #8a8a8a);\r\n  font-size: var(--text-xs, 12px); font-weight: var(--font-weight-medium, 500); line-height: 16px;\r\n}\r\n.ic-menu-empty { padding: 6px 12px 8px; color: var(--ic-soft, #8a8a8a); font-size: var(--text-xs, 12px); line-height: 16px; }\r\n\r\n/* ---- 8. bottom-right canvas controls -----------------------------------\r\n   Zero local rules: .floating-panel (radius var(--radius-xl), padding\r\n   var(--spacing), bg-background, inset-highlight shadow) draws the tray, the\r\n   buttons reuse the exact final class lists of button.variants.ts, the zoom\r\n   popover's number field reuses FormNumberField.vue's classes, and the minimap\r\n   settings panel reuses Checkbox.vue's. Everything follows the host theme. */\r\n.ic-controls { font-family: var(--ic-font-sans, var(--font-inter, Inter, Arial, sans-serif)); }\r\n\r\n\r\n/* ---- saved prompts drawer --------------------------------------------\r\n   No panel-specific CSS: button/Input/Textarea/tree-row/line-clamp/\r\n   NoResultsPlaceholder classes are all native host utilities, assembled in\r\n   renderPrompts() (infcanvas-ui.js). The .ic-prompt-panel hook is inert. */\r\n";

// ../../web/canvas/css/infcanvas-lora.css
var infcanvas_lora_default = `/* ---- LORA \u6A21\u578B\u5E93 drawer ----\r
   Geometry only; colours/spacing tokens come from the host stylesheet. The\r
   grid is two columns so each card reads as a preview poster + truncated name. */\r
.ic-panel--lora { gap: 8px; padding: 8px 0 16px; height: 100%; min-height: 0; }\r
/* Search sits first (just under the title bar), folder Select below it. */\r
.ic-lora-folder { flex: 0 0 auto; margin: 0 16px 8px; }\r
/* Search row: native SearchInput + view switcher side by side, mirroring the\r
   \u8D44\u4EA7 panel's .xog-searchrow (flex, gap 8). Outer margins move to the row so\r
   the box and button share one 16px inset and align with the folder Select. */\r
.ic-lora-searchrow { display: flex; align-items: center; gap: 8px; margin: 0 16px; }\r
.ic-lora-searchrow > .ic-search.ic-search { flex: 1 1 auto; min-width: 0; margin: 0; width: auto; }\r
/* View switcher: surface/items/arrow visuals are native classes on the DOM\r
   (NATIVE_POPOVER_CONTENT / NATIVE_VIEW_ITEM / arrow SVG). Only placement stays.\r
   Menu is right-aligned to the 32px trigger; Popover sideOffset=5 + arrow 5px\r
   puts the bubble 10px below the button. z-index clears the panel + canvas. */\r
.ic-lora-viewwrap { position: relative; flex: none; }\r
.ic-lora-viewmenu {\r
  position: absolute; top: calc(100% + 10px); inset-inline-end: 0;\r
  z-index: var(--ic-z-lora-menu, 10007); display: flex; flex-direction: column; box-sizing: border-box;\r
}\r
.ic-lora-viewmenu[hidden] { display: none; }\r
.ic-lora-viewmenu-arrow {\r
  position: absolute; top: -5px; right: 11px;\r
  transform: rotate(180deg); pointer-events: none;\r
}\r
/* The opened folder menu is portaled + fixed, never clipped by the panel. */\r
.ic-lora-fmenu { position: fixed; max-height: min(60vh, 460px); overflow-y: auto; z-index: var(--ic-z-lora-menu, 10007); }\r
/* Match the \u8D44\u4EA7 grid's spacing stack: grid padding 8 + card padding 8 keeps\r
   the first thumbnail 16px from the panel edge (aligned with the 16px search\r
   box), while the card padding gives 24px between adjacent thumbnails\r
   (8 right + 8 gap + 8 left) exactly like .xog-grid/.xog-card. */\r
.ic-lora-list {\r
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;\r
  padding: 0 8px 12px;\r
}\r
.ic-lora-divider { margin-top: 8px; }\r
.ic-lora-count {\r
  flex: 0 0 auto; margin-left: calc(var(--spacing, 4px) * 2); font-size: var(--text-xs, 12px); line-height: 16px;\r
  color: var(--muted-foreground, #8a8a8a);\r
}\r
.ic-lora-grid {\r
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;\r
}\r
/* View modes: grid-small / grid change gridTemplateColumns inline (from JS);\r
   list turns each card into a compact horizontal row (32px thumb + name),\r
   matching the \u8D44\u4EA7 panel's AssetsListItem. */\r
.ic-lora-grid[data-view="list"] .ic-lora-card {\r
  flex-direction: row; align-items: center; gap: 8px; padding: 6px 8px; min-height: 48px;\r
}\r
.ic-lora-grid[data-view="list"] .ic-lora-thumb {\r
  flex: none; width: 32px; height: 32px; aspect-ratio: auto; border-radius: 4px;\r
}\r
.ic-lora-grid[data-view="list"] .ic-lora-thumb.is-empty i,\r
.ic-lora-grid[data-view="list"] .ic-lora-thumb.is-broken i { width: 16px; height: 16px; }\r
.ic-lora-grid[data-view="list"] .ic-lora-play-badge { display: none; }\r
.ic-lora-grid[data-view="list"] .ic-lora-name { font-size: var(--text-xs, 12px); line-height: 16px; }\r
/* Card matches the \u8D44\u4EA7 panel's .xog-card: 8px padding + 8px gap between\r
   thumbnail and name. Padding is what opens 24px between neighbouring\r
   thumbnails (with the grid's 8px gap); without it they sit just 8px apart. */\r
.ic-lora-card {\r
  position: relative;\r
  display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 8px;\r
  border: 0; border-radius: 8px; background: transparent; color: var(--foreground, #ffffff);\r
  text-align: left; cursor: pointer;\r
}\r
.ic-lora-thumb {\r
  position: relative; display: block; width: 100%; aspect-ratio: 1 / 1;\r
  overflow: hidden; border-radius: 8px; background: var(--secondary-background, #262729);\r
}\r
.ic-lora-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }\r
/* Native card motion: images ease to 1.05 on hover (cropped by the thumb's\r
   overflow:hidden), both directions; video previews stay still so their short\r
   loop reads clean. */\r
img.ic-lora-thumb-img { transition: transform 0.3s ease; }\r
.ic-lora-card:hover img.ic-lora-thumb-img { transform: scale(1.05); }\r
/* Video previews use the same <video> element in the grid; a small play badge\r
   marks them as playable (the lightbox opens a controlling, looping player). */\r
.ic-lora-play-badge {\r
  position: absolute; right: 6px; bottom: 6px; width: 24px; height: 24px;\r
  padding: 4px; border-radius: 9999px; color: var(--foreground, #ffffff);\r
  background: color-mix(in srgb, var(--color-black) 60%, transparent);\r
}\r
.ic-lora-thumb.is-empty, .ic-lora-thumb.is-broken {\r
  display: flex; align-items: center; justify-content: center;\r
  color: var(--muted-foreground, #8a8a8a);\r
}\r
.ic-lora-thumb.is-empty i, .ic-lora-thumb.is-broken i { width: 32px; height: 32px; }\r
/* Pin badge: the same native bookmark glyph the \u753B\u5E03\u7BA1\u7406 sidebar uses \u2014\r
   pi-bookmark-fill at size-3.5 (14px box, 16px glyph, per .ic-bookmark i), no\r
   custom plate. Coloured like the LoRA name (text-primary) so it reads white\r
   on the dark thumbnail. Only the anchor position differs: grid modes park it\r
   on the thumbnail's top-right (card padding 8 + inset 6 = 14px), clear of the\r
   video play badge at bottom-right. */\r
.ic-lora-pin-badge {\r
  position: absolute; top: 14px; right: 14px; z-index: 1;\r
  display: flex; align-items: center; justify-content: center;\r
  width: calc(var(--spacing, 4px) * 3.5); height: calc(var(--spacing, 4px) * 3.5);\r
  color: var(--text-primary, var(--fg-color, #e8e8e8));\r
  pointer-events: auto;\r
}\r
.ic-lora-pin-badge i {\r
  width: calc(var(--spacing, 4px) * 3.5); height: calc(var(--spacing, 4px) * 3.5);\r
  font-size: var(--text-base, 16px); line-height: 16px;\r
}\r
/* List rows are 32px-thumb horizontal strips: park the badge at the row's\r
   right edge, vertically centred, leaving room for the name. */\r
.ic-lora-grid[data-view="list"] .ic-lora-pin-badge {\r
  top: 50%; right: 8px; transform: translateY(-50%);\r
}\r
.ic-lora-grid[data-view="list"] .ic-lora-name { padding-right: 26px; }\r
/* Name matches the \u8D44\u4EA7 panel's .xog-name: 14px/20px, single-line ellipsis,\r
   same foreground token chain (xog vars are not injected for this panel). */\r
.ic-lora-name {\r
  display: block; width: 100%; overflow: hidden; text-overflow: ellipsis;\r
  white-space: nowrap; font-size: var(--text-sm, 14px); line-height: 20px;\r
  color: var(--text-primary, var(--fg-color, #e8e8e8));\r
}\r
/* Hover tint covers the whole card (thumbnail + name) like the \u8D44\u4EA7 panel's\r
   .xog-card:hover. The xog variable is not injected here, so use its exact\r
   underlying token chain (modal-card-background-hovered at 20% over transparent). */\r
.ic-lora-card:hover {\r
  background: color-mix(in oklab, var(--modal-card-background-hovered, var(--secondary-background-hover, #313235)) 20%, transparent);\r
}\r
\r
/* Browse-only lightbox. Overlay / close / media carry MediaLightbox.vue's\r
   native classes (same as the \u8D44\u4EA7 panel); only the high z-index stays custom\r
   (native z-overlay=1700 is far below the 20000 canvas root). The stage centres\r
   a bare preview; a compact caption bar keeps the LoRA name/category. */\r
.ic-lora-lb { z-index: var(--ic-z-lora-lightbox, 30000); padding: 40px; }\r
.ic-lora-lb-card {\r
  display: flex; flex-direction: column; align-items: center; gap: 12px;\r
  max-width: 90vw; max-height: 90vh; min-width: 0;\r
}\r
.ic-lora-lb-stage {\r
  display: flex; align-items: center; justify-content: center;\r
  min-width: 0; min-height: 0;\r
}\r
.ic-lora-lb-img { display: block; }\r
/* MediaLightbox prev/next: secondary icon-lg rounded-full (mounted on DOM).\r
   Overlay is a full-screen fixed stage, so absolute at 50%/16px mirrors the\r
   native fixed top-1/2 left-4 -translate-y-1/2; translate via margin trick\r
   keeps it independent of UnoCSS translate-property ordering. */\r
.ic-lora-lb-prev,\r
.ic-lora-lb-next { position: absolute; top: 50%; z-index: 2; margin-top: -20px; }\r
.ic-lora-lb-prev { left: 16px; }\r
.ic-lora-lb-next { right: 16px; }\r
.ic-lora-lb-noimg {\r
  display: flex; align-items: center; justify-content: center;\r
  width: 480px; max-width: 100%; height: 320px; border-radius: 8px;\r
  background: var(--secondary-background, #262729);\r
  color: var(--muted-foreground, #8a8a8a);\r
}\r
.ic-lora-lb-noimg::before { width: 48px; height: 48px; }\r
/* Caption is pinned to the bottom of the full-screen overlay (out of flex\r
   flow), so the image in the centred card keeps equal top/bottom breathing\r
   space. Text visuals come from NATIVE_LB_NAME on the DOM (native classes);\r
   only placement + ellipsis sizing stay here. */\r
.ic-lora-lb-caption {\r
  position: absolute; inset-inline: 0; bottom: 24px;\r
  display: flex; justify-content: center;\r
  min-width: 0; pointer-events: none;\r
}\r
.ic-lora-lb-name { max-width: 90vw; min-width: 0; pointer-events: auto; }\r
\r
`;

// ../../web/canvas/css/infcanvas-console.css
var infcanvas_console_default = `/* ---- 11. ComfyUI console: bottom logs panel (infcanvas-console.js) -------\r
   Mirrors the native BottomPanel -> LogsTerminal/xterm. Native geometry comes\r
   from LiteGraphCanvasSplitterOverlay.vue: the bottom panel is a card inside\r
   the graph's vertical splitter with rounded-lg / border / bg-background, and\r
   the surrounding SplitterGroup carries ml-/mr-/mb-(--comfy-canvas-gutter)\r
   where --comfy-canvas-gutter = calc(var(--spacing) * 2) = 8px (spacing .25rem).\r
   So the native panel is a rounded, fully-bordered card floating 8px off the\r
   left/right/bottom edges of the graph area \u2014 NOT a borderless edge-hugging\r
   bar. Reproduce that exact geometry here (border color = --border full, no\r
   shadow \u2014 the native card relies on its hairline border, not a drop shadow). */\r
#infcanvas-console {\r
  position: absolute;\r
  left: calc(var(--sidebar-width, 56px) + 8px); right: 8px; bottom: 8px;\r
  z-index: var(--ic-z-console, 900); display: none; flex-direction: column; overflow: hidden;\r
  height: 50vh; min-height: 120px; max-height: 70%;\r
  background: var(--background, #171718);\r
  border: 1px solid var(--border, #494a50);\r
  border-radius: 8px;\r
  color: var(--ic-text, #ffffff);\r
  font-family: inherit;\r
}\r
#infcanvas-console.is-open { display: flex; }\r
/* Native vertical SplitterResizeHandle (LiteGraphCanvasSplitterOverlay):\r
   relative / z-10 / flex / w-px / shrink-0 / bg-border, plus vertical\r
   h-px w-full, a 4px hit area (after:h-1), hover/drag bg-primary, and the\r
   overlay's translate-y-1 rounded-t-lg. It sits on the panel's top edge;\r
   dragging it up grows the console (see onResizeMove in console.js). */\r
.ic-console-resize-handle {\r
  position: absolute; z-index: 10; top: 0; left: 0; right: 0;\r
  height: 2px; flex: 0 0 auto;\r
  background: var(--border, #494a50);\r
  border-radius: 8px 8px 0 0;\r
  cursor: ns-resize; touch-action: none;\r
  transition: background-color .12s;\r
}\r
/* Hit area grows downward (the panel is overflow:hidden, so an upward\r
   pseudo-element would be clipped). */\r
.ic-console-resize-handle::after {\r
  content: ""; position: absolute; left: 0; right: 0; top: 0;\r
  height: 8px;\r
}\r
.ic-console-resize-handle:hover,\r
.ic-console-resize-handle.is-dragging { background: var(--primary, #0b8ce9); }\r
.ic-console-resize-handle:focus-visible { outline: 1px solid var(--ring, var(--primary, #0b8ce9)); }\r
/* The side panel is an overlay (has-panel on #infcanvas-root) that covers the\r
   stage's left edge; shift the console right by the live panel width so it is\r
   never hidden under the drawer. Both vars live on the root, inherited here. */\r
#infcanvas-root.has-panel #infcanvas-console {\r
  left: calc(var(--sidebar-width, 56px) + var(--infcanvas-panel-width, 312px) + 8px);\r
}\r
/* ---- BottomPanel.vue / TabsList variant="panel" -------------------------\r
   Native classes: TabsList panel = border-b border-solid bg-transparent py-2;\r
   TabsTrigger panel = h-8 ... rounded-lg px-2.5 text-sm text-muted-foreground\r
   data-[state=active]:bg-secondary data-[state=active]:text-foreground, plus\r
   panel m-1 mx-2 p-3. So the tab is a padded secondary pill with 8px side /\r
   4px vertical margins on a transparent, bottom-bordered strip (~60px tall). */\r
.ic-console-bar {\r
  display: flex; align-items: center; justify-content: space-between;\r
  flex: 0 0 auto; padding: 8px 0; gap: 8px;\r
  border-bottom: 1px solid var(--border, #494a50);\r
  background: transparent;\r
}\r
.ic-console-tabs-container { display: flex; align-items: center; flex: 1 1 auto; min-width: 0; }\r
/* TabsTrigger variant="panel": h-8 rounded-lg px-2.5 text-sm text-muted-foreground\r
   + panel m-1 mx-2 p-3, active gets bg-secondary + text-foreground. A LONE tab\r
   (the terminal/LOGS panel) is forced pointer-events-none + transparent + muted\r
   by BottomPanel.vue's bottomPanelTabs.length === 1 branch \u2014 no active pill. */\r
.ic-console-tab {\r
  display: inline-flex; align-items: center; justify-content: center;\r
  min-height: 32px; padding: 12px; margin: 4px 8px;\r
  border: 0; border-radius: 8px; background: transparent;\r
  font-size: var(--text-sm, 14px); font-weight: var(--font-weight-medium, 500);\r
  line-height: 1; color: var(--muted-foreground, #8a8a8a);\r
  cursor: pointer;\r
}\r
.ic-console-tab.is-solo { pointer-events: none; }\r
.ic-console-tab[data-state="active"]:not(.is-solo) {\r
  background: var(--secondary-background, #262729);\r
  color: var(--base-foreground, #ffffff);\r
}\r
.ic-console-tab[data-state="inactive"] {\r
  background: transparent; color: var(--muted-foreground, #8a8a8a);\r
}\r
.ic-console-tab[data-state="inactive"]:hover { background: var(--accent, #313236); }\r
.ic-console-tab .pi { font-size:var(--text-sm, 14px); }\r
/* Right-side close button: Button variant="muted-textonly" size="sm"\r
   = bg-transparent text-muted-foreground hover:bg-accent + h-6 px-2 py-1\r
   rounded-sm text-xs. */\r
.ic-console-ops { display: flex; align-items: center; gap: 8px; padding-right: 8px; }\r
.ic-console-close {\r
  display: inline-flex; align-items: center; justify-content: center;\r
  height: 24px; padding: 4px 8px; margin: 0;\r
  border: 0; border-radius: 4px; background: transparent;\r
  color: var(--muted-foreground, #8a8a8a); cursor: pointer;\r
  font-size: var(--text-xs, 12px); line-height: 1;\r
  transition: background-color .15s;\r
}\r
.ic-console-close:hover { background: var(--accent, #313236); }\r
.ic-console-close .pi { font-size:var(--text-sm, 14px); }\r
/* ---- BaseTerminal.vue ---------------------------------------------------\r
   root = relative size-full overflow-hidden bg-neutral-900; inner = size-full\r
   p-2 with xterm host; copy = absolute top-2 right-8, Button secondary/sm,\r
   hidden until root hover (useElementHover). xterm default: monospace 14px,\r
   foreground #ffffff on the neutral-900 screen. */\r
.ic-console-terminal { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--color-neutral-900); }\r
.ic-console-terminal-inner { height: 100%; padding: 8px; }\r
.ic-console-screen {\r
  height: 100%; min-height: 0; overflow: auto;\r
  color:var(--foreground, #ffffff);\r
  font-family: var(--font-mono, "DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace);\r
  font-size:var(--text-sm, 14px); line-height: 1.2;\r
  white-space: pre; overflow-wrap: normal;\r
  scrollbar-width: thin;\r
  scrollbar-color: var(--muted, #3c3d42) transparent;\r
}\r
.ic-console-copy {\r
  position: absolute; top: 8px; right: 32px;\r
  display: inline-flex; align-items: center; justify-content: center;\r
  height: 24px; padding: 4px 8px;\r
  border: 0; border-radius: 4px;\r
  background: var(--secondary-background, #262729); color: var(--base-foreground, #ffffff);\r
  cursor: pointer; font-size: var(--text-xs, 12px); line-height: 1;\r
  opacity: 0; pointer-events: none; transition: opacity .15s;\r
}\r
.ic-console-terminal.is-hovered .ic-console-copy { opacity: 1; pointer-events: auto; }\r
.ic-console-copy:hover { background: var(--accent, #313236); }\r
.ic-console-copy .pi { font-size:var(--text-sm, 14px); }\r
.ic-console-screen::-webkit-scrollbar { width: 10px; height: 10px; }\r
.ic-console-screen::-webkit-scrollbar-track { background: transparent; }\r
.ic-console-screen::-webkit-scrollbar-thumb {\r
  background: var(--muted, #3c3d42); background-clip: padding-box;\r
  border: 2px solid transparent; border-radius: 9999px;\r
}\r
/* ---- Shortcuts panel: EssentialsPanel / ViewControlsPanel ----------------\r
   Both mount ShortcutsList.vue: outer flex justify-center, grid w-[90%] with\r
   3 columns (gap-4 / md:gap-24), each subcategory a column. Subcategory title\r
   = mb-4 text-xs font-bold tracking-wide uppercase text-muted-foreground.\r
   Shortcut row = py-2 flex items-center justify-between; name = text-sm\r
   font-medium; each key badge = min-w-6 rounded-sm bg-muted px-2 py-1\r
   text-center font-mono text-xs. The panel root (p-4 + scroll) mirrors\r
   EssentialsPanel.vue's flex h-full flex-col p-4 > min-h-0 flex-1 overflow-auto. */\r
.ic-console-shortcuts {\r
  display: none; flex: 1 1 auto; min-height: 0;\r
  padding: 16px; overflow: auto;\r
  background: var(--background, #171718);\r
}\r
.ic-shortcuts-pane { height: 100%; }\r
.ic-shortcuts-list { display: flex; justify-content: center; }\r
.ic-shortcuts-columns {\r
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));\r
  gap: 16px 96px; width: 90%; height: 100%;\r
}\r
.ic-shortcuts-group { display: flex; flex-direction: column; min-width: 0; }\r
.ic-shortcuts-subtitle {\r
  display: block; margin-bottom: 16px;\r
  color: var(--muted-foreground, #8a8a8a);\r
  font-family: var(--font-inter, Inter, sans-serif);\r
  font-size: var(--text-xs, 12px); font-weight: var(--font-weight-bold, 700);\r
  letter-spacing: var(--tracking-wide, 0.025em); line-height: 1.2;\r
  text-transform: uppercase;\r
}\r
.ic-shortcuts-items { display: flex; flex-direction: column; gap: 4px; }\r
.ic-shortcut-item {\r
  display: flex; align-items: center; justify-content: space-between;\r
  gap: 8px; padding: 8px 0; border-radius: 4px;\r
  transition: background-color .2s;\r
}\r
.ic-shortcut-name {\r
  flex: 1 1 auto; min-width: 0; padding-right: 16px;\r
  color: var(--foreground, #ffffff);\r
  font-family: var(--font-inter, Inter, sans-serif);\r
  font-size: var(--text-sm, 14px); font-weight: var(--font-weight-medium, 500);\r
  line-height: 1.3;\r
}\r
.ic-keybinding-combo { display: flex; flex: 0 0 auto; gap: 4px; }\r
.ic-key-badge {\r
  display: inline-flex; align-items: center; justify-content: center;\r
  min-width: 24px; padding: 4px 8px;\r
  border-radius: 4px; background: var(--muted, #3c3d42);\r
  color: var(--muted-foreground, #8a8a8a);\r
  font-family: var(--font-mono, monospace);\r
  font-size: var(--text-xs, 12px); line-height: 1; text-align: center;\r
}\r
/* The bottom-right floating controls (mouse/zoom/minimap/grid row) is pinned\r
   with the Tailwind bottom-0 utility. Ride it above the open console too,\r
   using the same --ic-console-h the console publishes on #infcanvas-body.\r
   ID selector wins over the single-class utility regardless of sheet order. */\r
#infcanvas-controls {\r
  bottom: var(--ic-console-h, 0px);\r
}`;

// ../../web/canvas/css/infcanvas-vueflow.css
var infcanvas_vueflow_default = `\r
#infcanvas-vueflow { position:absolute; inset:0; overflow:hidden; background:var(--background, #0F0F0F);\r
  /* ONE palette: the shared --ic-* aliases (--ic-line/--ic-panel/--ic-input/\r
     --ic-text/--ic-soft/--ic-brand/--ic-danger/--ic-hover/--ic-brand-soft/\r
     --ic-danger-soft) are declared once on #infcanvas-root and resolve to\r
     ComfyUI's own tokens. #infcanvas-vueflow is a descendant, so nodes inherit\r
     them and follow dark/light themes \u2014 do NOT re-declare them here.\r
     Only canvas-SPECIFIC variables remain, all pointing at native tokens. */\r
  --icw-bg:var(--color-charcoal-300, #232428); --icw-bar:var(--muted-foreground, #8b929e); --icw-played:var(--primary, #4a9eff);\r
  --icw-head:var(--primary, #3d9cff); --icw-head-fg:var(--foreground, #ffffff);\r
  --ic-node-bg:var(--node, #262729);\r
  /* Node card = header band + body: --node-header / --node, straight from host. */\r
  --ic-head-bg:var(--node-header, #202121); --ic-head-h:28px;\r
  /* Nodes 2.0 widget tokens: bg-input=--accent, hover=--muted, ring=--ring.\r
     Widgets are border-none + rounded-md(6px); --ic-input is a darker DIALOG\r
     surface, not the widget surface, so keep the dedicated --icnw-* aliases. */\r
  --icnw-bg:var(--accent, #313235); --icnw-hover:var(--muted, #3c3d42);\r
  --icnw-ring:var(--ring, #8a8a8a); --icnw-r:6px;\r
  --icnw-r-sm:4px; --icnw-panel:var(--card, #262729); }\r
/* Groups render before VueFlow in DOM order; this z-index keeps every node\r
   above their tinted backdrop, exactly like LGraphCanvas.drawGroups. */\r
.ic-flow { background:transparent; position:relative; z-index:2; }\r
/* Cursor contract mirrors ComfyUI LGraphCanvas._updateCursorStyle: editable\r
   (select) mode shows the normal arrow pointer on empty canvas, while nodes are\r
   a grab hand \u2014 including while dragging, per user spec. Vue Flow ships\r
   pane.draggable / node.draggable with cursor:grab at specificity (0,2,0),\r
   which outranks a bare pane default rule even though ours is injected last \u2014\r
   so every rule here carries an extra .ic-flow/.mode-* class to win. */\r
/* Select (editable) mode: arrow pointer on empty canvas, grab hand over EVERY\r
   node (plain, image, empty \u2014 deliberately uniform rather than the ComfyUI\r
   split where only image previews get the hand). Declared on the node root so\r
   it inherits into every node body; the explicit .dragging rule keeps the grab\r
   hand while dragging too (Vue Flow's .node.draggable.dragging would flip it\r
   to grabbing). No JS writes the cursor; it clears on leaving the node. */\r
.ic-flow.mode-select .vue-flow__pane,\r
.ic-flow.mode-select .vue-flow__viewport { cursor:default; }\r
.ic-flow.mode-select .vue-flow__node { cursor:grab; }\r
.ic-flow.mode-select .vue-flow__node.dragging { cursor:grab; }\r
/* Ctrl/Cmd-drag marquee selection: crosshair. Outranks the select default. */\r
.ic-flow .vue-flow__pane.selection { cursor:crosshair; }\r
/* Actively dragging the CANVAS: grabbing hand. Dragging a NODE keeps the grab\r
   hand in both modes: ComfyUI only flips to grabbing for draggingCanvas, a\r
   node drag leaves the cursor as-is. */\r
.ic-flow .vue-flow__pane.dragging,\r
.ic-flow .vue-flow__viewport.dragging { cursor:grabbing; }\r
/* Hand (read-only) mode: pane + viewport + nodes are a grab hand everywhere. */\r
.ic-flow.mode-drag .vue-flow__pane,\r
.ic-flow.mode-drag .vue-flow__viewport,\r
.ic-flow.mode-drag .vue-flow__node { cursor:grab; }\r
.ic-flow.mode-drag .vue-flow__pane.dragging,\r
.ic-flow.mode-drag .vue-flow__viewport.dragging { cursor:grabbing; }\r
/* Hand (read-only) mode: the group title strip and its four resize grips must\r
   not take pointers, otherwise a press there is eaten by the group instead of\r
   panning the canvas. Mirrors ComfyUI _processPrimaryButton's early read_only\r
   return before the groupTitle/groupResize branches. Node cards still win\r
   (they are siblings above the group), so they remain visible and pannable. */\r
.ic-flow.mode-drag .ic-group-title,\r
.ic-flow.mode-drag .ic-group__rz,\r
.ic-flow.mode-drag .icn__tagmenu.ic-group-tagmenu { pointer-events:none; }\r
.vue-flow__node { font-family:var(--ic-font-sans, var(--font-inter, Inter, Arial, sans-serif)); }\r
/* Input/output slot (handle) \u2014 two-tone dot per user spec (NOT plain fill):\r
   idle    : centre #AAAAAA 6px (r3), ring #B2B2B2 1px\r
   active  : centre #AAAAAA 7px (r3.5), ring #D4D4D4 1.5px (visual)\r
   On highlight BOTH rings grow 0.5px outwards. The dot is pinned to the handle\r
   centre by a FIXED -3px margin and grown with transform:scale() around\r
   transform-origin:center \u2014 scale cannot move the centre (one composited\r
   property, no interpolation desync). DO NOT animate width+margin together:\r
   their sub-pixel rounding differs mid-transition and the centre jitters even\r
   though both steady states compute equal. box-shadow spread is pre-divided by\r
   the scale (1.5 / (7/6) = 1.286px) so it renders 1.5px when active.\r
   ::after = 20px invisible hit area (getSlotInPosition \xB110), inverse-scaled by\r
   --ic-iz so the hit area stays a constant 20 SCREEN px \u2014 easy to grab even\r
   when the canvas is zoomed far out. Pairs with :connection-radius in flow-root.js. */\r
.vue-flow__handle { width:6px; height:6px; min-width:6px; min-height:6px;\r
  border-radius:50%; background:transparent; border:0; }\r
.vue-flow__handle::before { content:""; position:absolute; left:50%; top:50%;\r
  width:6px; height:6px; margin-left:-3px; margin-top:-3px;\r
  transform:scale(1); transform-origin:center center;\r
  border-radius:50%; background:var(--color-smoke-600, #aaa);\r
  box-shadow:0 0 0 1px var(--color-smoke-600, #b2b2b2);\r
  transition:transform .1s, box-shadow .1s; }\r
.vue-flow__handle::after { content:""; position:absolute; width:20px; height:20px;\r
  left:50%; top:50%; transform:translate(-50%,-50%) scale(var(--ic-iz, 1)); border-radius:50%; }\r
.vue-flow__handle:hover::before, .vue-flow__handle.connectingto::before,\r
.vue-flow__handle.vue-flow__handle-connecting::before,\r
.vue-flow__handle.vue-flow__handle-valid::before { transform:scale(1.166667);\r
  box-shadow:0 0 0 1.286px var(--color-neutral-300, #d4d4d4); }\r
/* Wire idle colour follows the host's per-datatype palette, exactly like\r
   ComfyUI's Vue nodes (getSlotColor -> var(--color-datatype-<TYPE>)).\r
   makeIcEdge sets --ic-edge-tone per edge from its source node kind, so wires\r
   differ by type AND re-colour when the theme changes. Fallback = classic #9a9. */\r
.vue-flow__edge-path.ic-edge { stroke:var(--ic-edge-tone, var(--color-smoke-700, #9a9)); stroke-width:3; }\r
/* In-flight link is drawn by the #connection-line slot (IcConnectionLine:\r
   source dot = host IMAGE datatype colour (follows theme), cursor dot amber).\r
   This rule is only a fallback if the slot ever misses; bundle default is grey.\r
   --ic-conn-tone is set inline by IcConnectionLine from --color-datatype-IMAGE. */\r
.vue-flow__connection-path { stroke:var(--ic-conn-tone, #AAFFAA); stroke-width:3; fill:none; }\r
/* Frozen released wire lives in the zoom-pane graph layer; let its <g> paint\r
   far outside the 1x1 host <svg>, and never eat pointer events from the menu. */\r
.ic-frozen-conn { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; }\r
/* Vue Flow adds .updating to edges during recompute and its CSS forces #777\r
   grey at equal specificity, overriding .ic-edge -> a wire flashes grey. Pin\r
   our green for that state only; leave .selected/.focus feedback untouched. */\r
.vue-flow__edge.updating .vue-flow__edge-path.ic-edge { stroke:var(--ic-edge-tone, var(--color-smoke-700, #9a9)); }\r
.ic-edge-border { fill:none; stroke:color-mix(in srgb, var(--color-black) 50%, transparent); stroke-width:7; stroke-linecap:round; }\r
.vue-flow__edge.selected .vue-flow__edge-path.ic-edge { stroke:var(--color-primary-comfy-canvas, #b3c9b3); }\r
.ic-edge-g { pointer-events:none; }\r
.ic-edge-dot-hit { pointer-events:all; cursor:pointer; }\r
.ic-edge-dot-halo { fill:transparent; }\r
.ic-edge-dot-core { fill:var(--ic-edge-tone, var(--color-smoke-700, #9a9)); }   /* fixed r=5 outer size, never grows */\r
/* Active marker = centre r=3 turns black INSIDE the fixed r=5 core, leaving a\r
   2px tone-coloured outer ring (user spec: \u4E2D\u5FC3\u9ED1 + \u4FDD\u7559\u5916\u57082px). core size never changes. */\r
.ic-edge-dot-center { fill:transparent; pointer-events:none; transition:fill .1s ease; }\r
.ic-edge-dot-hit:hover .ic-edge-dot-center { fill:var(--color-black, #000); }\r
/* Same-type multi-wire label: same capsule metrics as .icn__tag-chip\r
   (20px tall, 10px radius, 12px/400 white text, .02em tracking), no dot. */\r
.ic-edge-label-hit { pointer-events:all; cursor:pointer; }\r
/* Capsule fill follows the wire stroke: per-kind tone idle, #b3c9b3 selected, #fff\r
   when the whole branch is highlighted. Dark text on the white highlight\r
   keeps the label readable. */\r
.ic-edge-label-bg { fill:var(--ic-edge-tone, var(--color-smoke-700, #9a9)); }\r
.ic-edge-label-text { fill:var(--foreground, #fff); font-family:var(--ic-font-sans, var(--font-inter, Inter, Arial, sans-serif)); font-size:var(--text-xs, 12px);\r
  line-height:1; font-weight:var(--font-weight-normal, 400); letter-spacing:.02em;\r
  text-anchor:middle; dominant-baseline:middle; pointer-events:none; }\r
.ic-edge-label-hit:hover .ic-edge-label-bg { filter:brightness(1.12); }\r
.vue-flow__edge.selected .ic-edge-label-bg { fill:var(--color-primary-comfy-canvas, #b3c9b3); }\r
.ic-edge-g.is-hl .ic-edge-label-bg { fill:var(--foreground, #fff); }\r
.ic-edge-g.is-hl .ic-edge-label-text { fill:var(--background, #000); }\r
.ic-flow.is-far .ic-edge-label-hit { display:none; }\r
.ic-flow.is-far .ic-edge-dot-hit { display:none; }\r
.ic-flow.is-far .ic-edge-dot { display:none; }   /* legacy check_edges.js reads .ic-edge-dot display */\r
.ic-edge-g.is-hl .vue-flow__edge-path.ic-edge { stroke:var(--foreground, #fff); }\r
.ic-edge-g.is-hl .ic-edge-dot-core { fill:var(--foreground, #fff); }\r
/* On cut-highlight only the wire core turns white; the dark outline\r
   (.ic-edge-border) keeps its original rgba(0,0,0,.5) so the wire stays\r
   legible against the white stroke. */\r
.vue-flow__edge.is-cut .vue-flow__edge-path.ic-edge { stroke:var(--foreground, #fff); }\r
.vue-flow__edge.is-cut .ic-edge-dot-core { fill:var(--foreground, #fff); }\r
.ic-flow.is-cut-mode .vue-flow__pane { cursor:crosshair; }\r
/* The Alt-knife stroke: a white core with a soft halo, drawn over the wires. */\r
.ic-cut-trail { position:absolute; inset:0; width:100%; height:100%;\r
  pointer-events:none; z-index:9; overflow:visible; }\r
.ic-cut-trail path { fill:none; stroke:var(--foreground, #fff); stroke-width:2;\r
  stroke-linecap:round; stroke-linejoin:round;\r
  filter:drop-shadow(0 0 3px color-mix(in srgb, var(--foreground, #fff) 65%, transparent)); }\r
/* Multi-selection outline, mirroring ComfyUI's Comfy.SelectionBorder:\r
   host --border colour, 2px dashes at 5/5, 8px corners, never interactive.\r
   The side drawer is a sibling overlay at z=12 so it stays above this rect. */\r
.ic-selection-border { position:absolute; inset:0; width:100%; height:100%;\r
  pointer-events:none; z-index:10; overflow:visible; }\r
/* Groups live INSIDE VueFlow's transformation pane (the zoom-pane slot), in\r
   graph units, so the 12px radius / 1px border / 20px grips scale with the\r
   viewport exactly like a node card. The pane is its own stacking context:\r
   nodes are z=0, so the translucent backdrop sits at z=-1 and the interactive\r
   strip/grips layer sits above them. All metrics below are GRAPH pixels. */\r
/* Group uses the host's two-pass fill pattern (box, then title strip over it),\r
   but at 10% white each: 1-0.9^2 = ~19% over the title, 10% on the body.\r
   Border is 50% white, text at 82% white. */\r
.ic-group { position:absolute; z-index:-1; pointer-events:none; box-sizing:border-box;\r
  border:1px solid color-mix(in srgb, var(--foreground, #fff) 50%, transparent); border-radius:12px;\r
  background:color-mix(in srgb, var(--foreground, #fff) 10%, transparent); color:color-mix(in srgb, var(--foreground, #fff) 82%, transparent); overflow:visible;\r
  font-size:var(--text-xl, 20px); }\r
/* Selected groups mirror a selected node's 3px pure-white highlight ring\r
   (.icn.is-selected uses box-shadow:0 0 0 3px var(--foreground, #fff)). An outline is drawn\r
   outside the border box anyway, so offset stays 0 -- the ring hugs the group\r
   edge exactly like a node's, with no gap. */\r
.ic-group.is-selected { border-color:color-mix(in srgb, var(--foreground, #fff) 85%, transparent);\r
  outline:3px solid var(--foreground, #fff); outline-offset:0; }\r
/* Live drag-in target: identical highlight to a selected group. */\r
.ic-group.is-drop-target { border-color:color-mix(in srgb, var(--foreground, #fff) 85%, transparent);\r
  outline:3px solid var(--foreground, #fff); outline-offset:0; }\r
.ic-group-ui.is-drop-target .ic-group-title { color:var(--foreground, #fff); }\r
/* The layer itself is inert (the pane already is); only its children take\r
   pointers. No z-index here on purpose: this must NOT be a stacking context,\r
   so the title can sit BELOW node cards (a group is a backdrop, not an overlay)\r
   while its tools/grips/palette stay above them via their own z-index. */\r
.ic-group-ui { position:absolute; pointer-events:none; box-sizing:border-box;\r
  font-size:var(--text-xl, 20px); }\r
.ic-group-ui.is-selected .ic-group-title { color:var(--foreground, #fff); }\r
.ic-group-title { position:relative; z-index:-1; display:flex; align-items:center; box-sizing:border-box;\r
  width:100%; height:var(--ic-group-title-h, 40px); padding:0 10px;\r
  border-radius:12px 12px 0 0; background:color-mix(in srgb, var(--foreground, #fff) 10%, transparent);\r
  color:inherit; white-space:nowrap; pointer-events:auto; cursor:grab; user-select:none; }\r
/* Same dragging feedback as Vue Flow's .vue-flow__node.draggable.dragging. */\r
.ic-group-ui.is-dragging .ic-group-title { cursor:grabbing; }\r
/* Group tag reuses the node chip markup verbatim (.icn__tag-chip + dot/name)\r
   and only scales it up for the 40px title band; the node header is 28px.\r
   Two-class selectors win over the single-class node chip rules regardless\r
   of where this block sits in the stylesheet. */\r
.ic-group-title .ic-group-tag-chip { height:28px; max-width:190px; padding:0 13px;\r
  gap:8px; border-radius:14px; font-size:var(--text-lg, 18px); letter-spacing:.02em; margin-right:10px; }\r
.ic-group-title .ic-group-tag-chip .icn__tag-chip-dot { width:7px; height:7px; }\r
.ic-group-title .ic-group-tag-add { width:24px; height:24px; border-radius:6px;\r
  margin-right:8px; color:color-mix(in srgb, var(--foreground, #fff) 75%, transparent); }\r
.ic-group-title .ic-group-tag-add:hover { color:var(--foreground, #fff); background:color-mix(in srgb, var(--foreground, #fff) 12%, transparent); }\r
/* The palette is the very same .icn__tagmenu component; just anchor it under\r
   the taller group title instead of the 28px node header. */\r
.icn__tagmenu.ic-group-tagmenu { left:12px; right:auto; width:max-content;\r
  top:calc(var(--ic-group-title-h,40px) + 4px); pointer-events:auto; }\r
.ic-group-title-input { position:relative; z-index:-1; display:block; box-sizing:border-box; width:100%;\r
  height:var(--ic-group-title-h, 40px); padding:0 10px; border:1px solid color-mix(in srgb, var(--foreground, #fff) 50%, transparent);\r
  border-radius:12px 12px 0 0; outline:none; background:color-mix(in srgb, var(--color-charcoal-600) 92%, transparent);\r
  color:var(--foreground, #fff); font:inherit; line-height:1; pointer-events:auto; }\r
/* Corner grips: same 20px box / 8px glyph / upstream SVG path as node resize. */\r
.ic-group__rz { position:absolute; width:20px; height:20px; z-index:2;\r
  opacity:0; transition:opacity .12s ease; pointer-events:auto; }\r
/* Resize grips appear only while the group is selected (or actively dragged),\r
   never on hover \u2014 moving the pointer across the title bar must not restyle\r
   the group. */\r
.ic-group-ui.is-selected .ic-group__rz,\r
.ic-group__rz.is-active { opacity:1; }\r
.ic-group__rz svg { position:absolute; width:40%; height:40%; }\r
.ic-group__rz svg path { fill:none; stroke:var(--color-muted-foreground, rgba(255,255,255,.62));\r
  stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }\r
.ic-group__rz:hover svg path, .ic-group__rz.is-active svg path { stroke:var(--primary, #0b8ce9); }\r
.ic-group__rz--se { right:-4px; bottom:-4px; cursor:se-resize; }\r
.ic-group__rz--se svg { top:4px; left:4px; }\r
.ic-group__rz--ne { right:-4px; top:-4px; cursor:ne-resize; }\r
.ic-group__rz--ne svg { bottom:4px; left:4px; transform:scaleY(-1); }\r
.ic-group__rz--sw { left:-4px; bottom:-4px; cursor:sw-resize; }\r
.ic-group__rz--sw svg { top:4px; right:4px; transform:scaleX(-1); }\r
.ic-group__rz--nw { left:-4px; top:-4px; cursor:nw-resize; }\r
.ic-group__rz--nw svg { bottom:4px; right:4px; transform:scale(-1,-1); }\r
/* Group + multi-select toolbars live OUTSIDE the zoom pane (siblings of the\r
   selection border in #infcanvas-vueflow), positioned in screen pixels so they\r
   keep a constant size and never skew while the canvas zooms. The host div is\r
   placed by JS at the anchor's screen centre/top, so translate(-50%,-100%)\r
   keeps the panel centred and hovering above the target.\r
   Chrome + buttons now match the node action row (.icn__tools / .icn__tool):\r
   same 32px panel, 26px buttons, --background fill and --shadow-color shadow.\r
   Only the positioning differs (screen space vs the zoomed node layer), so the\r
   two container rules below keep their own transform/z-index/pointer-events. */\r
.ic-group-tools { position:absolute; z-index:11;\r
  display:flex; align-items:center; gap:2px; height:32px; padding:2px;\r
  box-sizing:border-box; white-space:nowrap; transform:translate(-50%,-100%);\r
  -webkit-user-select:none; user-select:none; pointer-events:auto;\r
  border:1px solid var(--border, #494a50); border-radius:8px;\r
  background:var(--background, #171718); box-shadow:0 2px 16px 0 var(--shadow-color, rgba(0,0,0,.4)); }\r
/* Selection toolbox: layer-outside (screen pixels, see .ic-group-tools),\r
   centred 10px above the selection box. */\r
.ic-selection-tools { position:absolute; z-index:11; display:flex; align-items:center;\r
  gap:2px; height:32px; padding:2px; box-sizing:border-box; white-space:nowrap;\r
  transform:translate(-50%, -100%); pointer-events:auto;\r
  -webkit-user-select:none; user-select:none;\r
  border:1px solid var(--border, #494a50); border-radius:8px;\r
  background:var(--background, #171718); box-shadow:0 2px 16px 0 var(--shadow-color, rgba(0,0,0,.4)); }\r
/* Buttons in BOTH toolbars reuse .icn__tool (the node action-row button), so\r
   dimensions / hover / icon opacity / --danger state stay identical to the\r
   node tools. Only extra rule needed: the old <i> glyph sizing is replaced by\r
   .icn__tool-icon; no per-toolbar button rules remain. */\r
/* Marquee box: window mode (left->right, SelectionMode.Full) = blue solid,\r
   crossing mode (right->left, SelectionMode.Partial) = green dashed. The\r
   .ic-flow container gets .marquee-crossing while a crossing stroke is active. */\r
.vue-flow__selection { background:color-mix(in srgb, var(--color-blue-400) 8%, transparent); border:1px solid color-mix(in srgb, var(--color-blue-400) 60%, transparent);\r
  border-style:solid; }\r
.ic-flow.marquee-crossing .vue-flow__selection { background:color-mix(in srgb, var(--color-green-400) 10%, transparent);\r
  border:1px dashed color-mix(in srgb, var(--color-green-400) 75%, transparent); }\r
/* Vue Flow renders a full-box NodesSelection rect on top of multi-selected\r
   nodes (pointer-events:all by default). It swallows every click, so a plain\r
   click can no longer replace the selection and Shift/Ctrl+click cannot toggle\r
   individual nodes -- the exact "selection feels broken" symptom. LiteGraph\r
   has no such overlay: clicking a node selects it, dragging any selected node\r
   moves the whole group, and the empty space between nodes belongs to the\r
   pane. Let the rect be visual only; group dragging still works via nodes. */\r
.vue-flow__nodesselection-rect { pointer-events:none!important; background:transparent; border:0; }\r
.ic-hide-edges .vue-flow__edge { display:none; }\r
\r
/* ---- asset node shell: reference .demo-node (border:0 / padding:0 / radius 12),\r
   selected ring = ComfyUI's NODE_BOX_OUTLINE_COLOR (var(--foreground, #FFF)) at\r
   LGraphCanvas.connections_width (3). The node name is a top-left capsule\r
   instead of a 30px title bar; the hover tool row sits above the frame. ---- */\r
/* Node shadow mirrors host Nodes 2.0 LGraphNode.vue: the root carries the\r
   Tailwind drop-shadow-lg filter = drop-shadow(0 9px 7px var(--shadow-color)),\r
   and --shadow-color is #0006 (rgba(0,0,0,.4)). It is a FILTER, not a\r
   box-shadow: it follows the card's rounded/transparent silhouette. The node\r
   lives in the zoom pane, so these px are graph units and scale with it.\r
   The 3px white selection ring is a separate box-shadow (host outline). */\r
.icn { position:relative; border-radius:12px; background:var(--ic-head-bg, #202121); color:var(--foreground, #ddd); user-select:none;\r
  filter:drop-shadow(0 9px 7px var(--shadow-color, rgba(0,0,0,.4))); }\r
.icn.is-selected { box-shadow:0 0 0 3px var(--foreground, #fff); }\r
/* Running ALWAYS shows the blue ring \u2014 identical 3px solid style to the white\r
   selection ring, only a different colour. Running wins over selection: both\r
   selected+running still shows ONE blue ring, never white, never two rings.\r
   Listing the .is-selected variant raises specificity above .is-selected. */\r
.icn.is-running, .icn.is-running.is-selected { box-shadow:0 0 0 3px var(--primary, #0B8CE9); }\r
/* Queued = amber, error = red. Same 3px solid ring as the others; each state\r
   outranks the white selection ring (running/queued/error all win over white). */\r
.icn.is-waiting, .icn.is-waiting.is-selected { box-shadow:0 0 0 3px var(--color-gold-600); }\r
.icn.is-error, .icn.is-error.is-selected { box-shadow:0 0 0 3px var(--destructive, #B33A3A); }\r
/* Muted (Ctrl+M) / ignored (Ctrl+B) mirror ComfyUI's node-mode visuals\r
   (LGraphNode.vue + LiteGraph): BOTH dim to 0.5 opacity \u2014 they never run \u2014\r
   but only BYPASS gets ComfyUI's 60%-transparent --color-bypass veil\r
   (#6a246a99), the before:bg-bypass/60 overlay. So a muted node reads\r
   neutral/dimmed while an ignored (pass-through) node reads PURPLE. The veil\r
   is pointer-events:none, rounded to the card, above the header (z-index 6)\r
   yet below the toolbars (30) and tag menu (70), so controls stay reachable. */\r
.icn.is-muted, .icn.is-ignored { opacity:.45; }\r
.icn.is-ignored::before {\r
  content:""; position:absolute; inset:0; z-index:8; border-radius:12px;\r
  background:color-mix(in srgb, var(--color-bypass) 60%, transparent);\r
  background:color-mix(in oklab, var(--color-bypass, #6a246a) 60%, transparent);\r
  pointer-events:none;\r
}\r
.icn__status-flag { display:inline-flex; align-items:center; justify-content:center;\r
  flex:0 0 auto; margin-left:6px; pointer-events:auto; }\r
/* Flag glyphs echo the node treatment: muted = neutral grey, ignored = the\r
   bypass purple (derived from the same native token, lifted for legibility). */\r
.icn__status-flag.is-muted { color:var(--muted-foreground, #8a8a8a); }\r
.icn__status-flag.is-ignored {\r
  color:color-mix(in oklab, var(--color-bypass, #6a246a) 55%, white);\r
}\r
.icn__body { position:relative; overflow:hidden; background:var(--ic-node-bg, #262729); }\r
/* \u6240\u6709\u8282\u70B9\u5361\u7247\u7684\u4E0B\u89D2\u90FD\u4FDD\u6301 12px \u5706\u89D2\uFF08\u4E0E .icn \u5916\u58F3\u4E00\u81F4\uFF09\u3002\u4E4B\u524D\u628A media body\r
   \u8BBE\u6210\u76F4\u89D2 0\uFF0C\u4E0D\u900F\u660E\u65B9\u5F62\u80CC\u666F\u628A\u5916\u58F3\u7684\u4E0B\u5706\u89D2\u586B\u5E73\uFF0C\u89C6\u89C9\u4E0A\u5DE6\u53F3\u4E0B\u89D2\u53D8\u5C16\u3002\u56FE\u7247\u7528\r
   object-fit:contain + \u540C\u8272\u80CC\u666F\uFF0Cbody \u5706\u89D2\u53EA\u88C1\u540C\u8272\u7559\u767D\u3001\u4E0D\u4F1A\u88C1\u56FE\u7247\u5185\u5BB9\u3002 */\r
.icn--media .icn__body, .icn--text .icn__body, .icn--lora .icn__body { border-radius:0 0 12px 12px; }\r
\r
/* ComfyUI 2.0 node header: a REAL strip at the top of the card, not an overlay.\r
   LGraphNode.vue wraps everything in bg-node-header (charcoal-700 #202121) and\r
   paints the body bg-node (charcoal-600 #262729) underneath it, so the title\r
   band reads as a darker block \u2014 that is the whole trick. NodeHeader.vue is\r
   p-1 (4px) around an icon-sm control with a truncating title at text-xs.\r
   The collapse chevron is intentionally omitted (we have no collapse). */\r
.icn__head { position:relative; z-index:6; box-sizing:border-box;\r
  height:var(--ic-head-h, 28px); padding:0 10px; display:flex; align-items:center;\r
  border-radius:12px 12px 0 0; background:var(--ic-head-bg, #202121);\r
  overflow:hidden; pointer-events:none; }\r
/* While generating, the header band itself is the progress bar: a #133A56\r
   fill grows left\u2192right across the full header width, behind the title text\r
   (title keeps pointer-events:auto so it stays legible & editable). */\r
.icn__head-progress { position:absolute; left:0; top:0; bottom:0; z-index:0;\r
  background:var(--color-ocean-900); pointer-events:none;\r
  transition:width .25s ease; }\r
.icn__head.is-generating .icn__name { position:relative; z-index:1; }\r
\r
/* ---- Quick-cleanup pill: a 30px solid bar, title centred, socket each end ----\r
   The bar IS the header (body is 0px), so no two-tone card, no tag chip, no\r
   tools and no resize grips. Colour follows the action, text is always the\r
   node title (already centred by the rules below). Click anywhere runs it. */\r
.icn--cleanup, .icn--text_merge { border-radius:8px; }\r
/* The bar IS the node header strip: same charcoal as every node title, same\r
   title text colour and weight. Just shorter, centred and click-to-run. */\r
.icn--cleanup .icn__head, .icn--text_merge .icn__head {\r
  height:100%; border-radius:8px; padding:0 10px; justify-content:center;\r
  background:var(--ic-head-bg, #202121); pointer-events:auto;\r
}\r
.icn--cleanup .icn__name, .icn--text_merge .icn__name { max-width:100%; color:var(--foreground, #cdcdcd); font-size:var(--text-xs, 12px);\r
  font-weight:var(--font-weight-medium, 500); text-align:center; pointer-events:none; }\r
/* The header strip fills the whole bar at z-index 6 \u2014 keep the sockets above\r
   it so their inner half is not clipped/covered by the opaque head background. */\r
.icn--cleanup .vue-flow__handle, .icn--text_merge .vue-flow__handle { z-index:10; }\r
.icn--cleanup .icn__body, .icn--text_merge .icn__body { display:none; }\r
.icn--cleanup .icn__tag,\r
.icn--cleanup .icn__tools,\r
.icn--cleanup .icn__rz,\r
.icn--cleanup .icn__file,\r
.icn--cleanup .icn__tagmenu,\r
.icn--text_merge .icn__tag,\r
.icn--text_merge .icn__tools,\r
.icn--text_merge .icn__rz,\r
.icn--text_merge .icn__file,\r
.icn--text_merge .icn__tagmenu { display:none !important; }\r
/* A quick click flash confirms the job was queued. */\r
.icn--cleanup.is-cleaning .icn__head { box-shadow:inset 0 0 0 1px var(--primary, #0B8CE9); }\r
\r
/* ComfyUI draws the title as BARE TEXT inside the header band (NodeHeader.vue\r
   wraps an EditableText, whose resting state is a plain span and whose editing\r
   state is a borderless input: rounded-none, zero padding, no focus ring).\r
   No capsule, no chip, no hover plate \u2014 the darker band IS the affordance. */\r
.icn__name { display:inline-block; max-width:100%; box-sizing:border-box;\r
  padding:0; border-radius:0; background:transparent;\r
  color:var(--foreground, #cdcdcd); font-size:var(--text-xs, 12px); line-height:1;\r
  font-weight:var(--font-weight-medium, 500); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;\r
  user-select:none; pointer-events:auto; cursor:default; }\r
.icn__name--edit { min-width:60px; max-width:260px; overflow:hidden; text-overflow:clip;\r
  background:transparent; outline:none; box-shadow:none;\r
  cursor:text; user-select:text; }\r
/* Header tag: a single colour capsule (or the add icon) pinned to the right of\r
   the title band. The title above is flex-shrunk so a long name can never push\r
   the tag out (name gets the ellipsis, tag stays put). Header is pointer-events\r
   :none, so the control opts back in. z-index 2 keeps it above the progress fill. */\r
.icn__name { flex:0 1 auto; min-width:0; }\r
.icn__tag { flex:0 0 auto; margin-left:auto; position:relative; z-index:2; pointer-events:auto;\r
  display:inline-flex; align-items:center; align-self:center; line-height:0; }\r
.icn__tag-add, .icn__tag-chip { display:inline-flex; align-items:center; justify-content:center;\r
  box-sizing:border-box; border:0; padding:0; cursor:pointer; }\r
.icn__tag-add { width:18px; height:18px; border-radius:4px; color:var(--ic-soft, #8a8a8a);\r
  background:transparent; }\r
.icn__tag-add:hover { color:var(--foreground, #fff); background:color-mix(in srgb, var(--foreground, #fff) 12%, transparent); }\r
.icn__tag-chip { height:20px; max-width:130px; padding:0 9px; border-radius:10px;\r
  gap:6px; color:var(--foreground, #fff); font-size:var(--text-xs, 12px); line-height:1; font-weight:var(--font-weight-normal, 400); letter-spacing:.02em;\r
  overflow:hidden; }\r
.icn__tag-chip-dot { flex:0 0 auto; width:5px; height:5px; border-radius:50%; background:var(--foreground, #fff); }\r
.icn__tag-chip-name { display:inline-flex; align-items:center; height:100%; min-width:0;\r
  line-height:1; overflow:hidden; white-space:nowrap; }\r
.icn__tag-chip:hover { filter:brightness(1.12); }\r
/* Palette menu: same dark floating card language as the other pickers. */\r
.icn__tagmenu { position:absolute; right:6px; top:calc(var(--ic-head-h, 28px) + 4px); z-index:70;\r
  box-sizing:border-box; min-width:132px; padding:4px; border-radius:8px;\r
  background:var(--icnw-bg, #2b2c2f); border:1px solid color-mix(in srgb, var(--foreground, #fff) 8%, transparent);\r
  box-shadow:0 8px 24px color-mix(in srgb, var(--color-black) 50%, transparent); display:flex; flex-direction:column; gap:1px; }\r
.icn__tagmenu-item { display:flex; align-items:center; gap:8px; width:100%; height:28px;\r
  padding:0 8px; box-sizing:border-box; border:0; border-radius:5px; background:transparent;\r
  color:var(--ic-text, #fff); font-size:var(--text-xs, 12px); text-align:left; cursor:pointer; }\r
.icn__tagmenu-item:hover { background:var(--icnw-hover, #3c3d42); }\r
.icn__tagmenu-dot { flex:0 0 auto; width:9px; height:9px; border-radius:50%; }\r
.icn__tagmenu-name { flex:1 1 auto; min-width:0; }\r
.icn__tagmenu-clear { margin-top:3px; padding:6px 8px 3px; border:0; cursor:pointer;\r
  background:transparent; border-top:1px solid color-mix(in srgb, var(--foreground, #fff) 10%, transparent);\r
  color:var(--ic-soft, #8a8a8a); font-size:var(--text-xs, 12px); text-align:left; }\r
.icn__tagmenu-clear:hover { color:var(--foreground, #fff); }\r
\r
/* Single-node action row mirrors the multi-select toolbox (.ic-selection-tools):\r
   one dark floating panel with a border/radius/shadow, transparent buttons that\r
   highlight on hover. Centred above the node via left:50% + translate, which\r
   also carries the show/hide slide so the transform never fights for both. */\r
/* Layer-outside chrome: the action row lives inside VueFlow's scale(zoom)\r
   pane, so it is multiplied by --ic-iz (= 1/zoom) to stay a constant SCREEN\r
   size. transform-origin is the bottom-centre anchor so the inverse scale\r
   never drags it off the node's top edge. The gap stays literal graph-space\r
   (calc(100% + 20px)), so it scales together with the node card on zoom. */\r
.icn__tools { position:absolute; left:50%; bottom:calc(100% + 20px); width:max-content; z-index:30;\r
  display:flex; align-items:center; gap:2px; height:32px; padding:2px; box-sizing:border-box;\r
  white-space:nowrap; pointer-events:none; opacity:0; visibility:hidden;\r
  transform-origin:bottom center; transform:translate(-50%, 4px) scale(var(--ic-iz, 1));\r
  transition:opacity .12s ease, transform .12s ease, visibility 0s linear .12s;\r
  border:1px solid var(--border, #494a50); border-radius:8px;\r
  background:var(--background, #171718); box-shadow:0 2px 16px 0 var(--shadow-color, rgba(0,0,0,.4)); }\r
/* The panel belongs to the SELECTED node only: hovering a node no longer pops\r
   a floating toolbar over its neighbours. Selecting is one click on the node\r
   itself (or a Ctrl box-select), so the row is still one click away. */\r
.icn.is-selected .icn__tools {\r
  opacity:1; visibility:visible; transform:translate(-50%, 0) scale(var(--ic-iz, 1));\r
  transition:opacity .12s ease, transform .12s ease, visibility 0s; }\r
.icn__tool { pointer-events:auto; display:inline-flex; align-items:center; gap:5px;\r
  height:26px; padding:0 8px; border:0; border-radius:6px; background:transparent;\r
  color:var(--ic-text, #ffffff); font:inherit; font-size:var(--text-xs, 12px); line-height:1;\r
  white-space:nowrap; cursor:pointer; }\r
.icn__tool-icon { flex:0 0 auto; display:block; opacity:.9; }\r
.icn__tool:hover .icn__tool-icon { opacity:1; }\r
.icn__tool:hover { background:var(--accent, #3c3d42); color:var(--ic-text, #ffffff); }\r
.icn__tool--danger:hover { background:var(--ic-danger, #b33a3a); color:var(--ic-text, #ffffff); }\r
\r
/* Media fills the whole card; media elements are inert so dragging the node\r
   and clicking the canvas behave exactly like the reference .vp-video. */\r
.icn__media { position:absolute; inset:0; width:100%; height:100%; object-fit:contain;\r
  background:var(--ic-node-bg, #262729); display:block; pointer-events:none; }\r
.icn__wave-audio { display:none; }\r
/* The waveform owns the whole node: the control bar is a transparent overlay,\r
   so reserving its 98px left a dead band under the bars and made the wave look\r
   jammed against the top edge. plotBox() keeps the bars clear of the button row\r
   instead. */\r
.icn__wave-host { position:absolute; inset:0; overflow:hidden; background:var(--icw-bg);\r
  cursor:inherit; touch-action:none; user-select:none; }\r
.icn__wave { display:block; width:100%; height:100%; pointer-events:none; }\r
/* The name capsule floats at top-left (top:8, height:22) and the copy button\r
   at top-right (top:6, height:22). Reserve the whole first line (30px) so the\r
   text starts on line two and is never covered by either corner affordance. */\r
.icn__text { position:absolute; inset:0; padding:30px 10px 8px; font-size:var(--text-xs, 12px); line-height:var(--text-base--line-height, 1.5);\r
  color:var(--ic-text, #ffffff); overflow:auto; white-space:pre-wrap; word-break:break-word; }\r
/* Corner copy button on text results: mirrors the header tag-add affordance\r
   (native soft colour, hover to foreground). Anchored top-LEFT so it sits in the\r
   reserved first line and never collides with the right-side scrollbar thumb. */\r
.icn__text-copy { position:absolute; left:6px; top:6px; z-index:6;\r
  width:22px; height:22px; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center;\r
  border:0; padding:0; border-radius:4px; cursor:pointer; color:var(--ic-soft, #8a8a8a);\r
  background:var(--ic-node-bg, #262729); opacity:.72; transition:opacity .12s, color .12s, background .12s; }\r
.icn__text-copy:hover { opacity:1; color:var(--foreground, #fff); background:var(--icnw-hover, #3c3d42); }\r
.icn__text-copy svg { display:block; }\r
/* Translate button sits directly right of copy; both share the copy button's\r
   visual (only the anchor differs). Active = showing a translation; busy =\r
   generation in flight (dimmed, non-clickable via the handler guard). */\r
.icn__text-translate { left:32px; }\r
.icn__text-translate.is-active { opacity:1; color:var(--ic-brand, #0b8ce9); }\r
.icn__text-translate.is-busy { opacity:.4; }\r
.icn__text p { margin:0 0 6px; } .icn__text h1, .icn__text h2, .icn__text h3 { margin:4px 0 6px; font-size:var(--text-sm, 14px); }\r
.icn__text ul, .icn__text ol { margin:4px 0; padding-left:18px; }\r
.icn__text code { padding:0 3px; border-radius:3px; background:var(--ic-hover, #313235); }\r
.icn__text a { color:var(--ic-brand, #0b8ce9); }\r
.icn__text-edit { position:absolute; inset:0; z-index:5; box-sizing:border-box; padding:8px 10px;\r
  border:0; border-radius:var(--icnw-r, 6px); outline:none; resize:none; cursor:text;\r
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff); font:12px/1.5 ui-monospace, Consolas, monospace; }\r
.icn__text-edit:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }\r
.icn__empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;\r
  justify-content:center; gap:6px; padding:0; border:0; border-radius:12px;\r
  color:var(--color-smoke-700, #a0a0a0); background:var(--ic-node-bg, #262729); font:inherit; cursor:pointer; }\r
.icn__file { display:none; }\r
.icn__empty-line { font-size:var(--text-xs, 12px); white-space:nowrap; }\r
.icn:hover .icn__empty { color:var(--ic-text, #ffffff); }\r
/* Generate nodes never upload from the body \u2014 a centred glyph of the medium\r
   stands in for the result until one exists. Kept low-contrast so the node\r
   frame still reads as empty rather than as a button. */\r
.icn__gen-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;\r
  box-sizing:border-box; border-radius:12px; background:var(--ic-node-bg, #262729);\r
  color:var(--color-charcoal-100, #5c5d63); user-select:none; pointer-events:none; }\r
.icn__gen-empty svg { display:block; }\r
.icn:hover .icn__gen-empty { color:var(--color-zinc-500, #787980); }\r
.icn.is-selected .icn__gen-empty { color:var(--color-smoke-800, #8b8c93); }\r
/* Text nodes keep their own background (the empty editor underneath), so the\r
   glyph layer must not paint over it. */\r
.icn__gen-empty--ghost { background:transparent; }\r
\r
/* ---- control bar: 1:1 port of the native video controls ----\r
   This is the bar ComfyUI's Load Video node shows: it renders a plain video\r
   element with native controls, so everything below is pixel-sampled from a\r
   real one (480x270 frame at 2x DPR):\r
     panel    98px tall, NO background (the native black scrim was dropped on\r
              request: it turned the whole lower third into one dark block and\r
              made the audio waveform look squeezed into the top of the node)\r
     seek     full-width 4px capsule, centred 32px above the bottom edge and\r
              ABOVE the icon row (native control-bar order); x 16..464;\r
              unplayed rgba(255,255,255,.66), played var(--foreground, #fff)\r
     row 2    icon row: 24px boxes centred 16px above the bottom edge;\r
              equal 16px gaps from the seek centre above and the node edge below\r
     play     triangle 8.5 x 12px, centre x = 24.75 (row padding 12px)\r
     time     14px white starting at x = 48.5  => 12px gap after the button\r
     volume   speaker 14.5px tall, same row, flush with the right padding\r
   The fullscreen key and the three-dot overflow menu are NOT reproduced --\r
   they were explicitly dropped from this node.\r
   Never write backticks inside this CSS string. ---- */\r
.icn__bar { position:absolute; left:0; right:0; bottom:0; z-index:4;\r
  box-sizing:border-box; height:98px;\r
  /* No scrim: the black gradient made the whole lower third read as one dark\r
     block, which visually pushed the audio waveform into the top of the node.\r
     Controls sit directly on the media/waveform instead. */\r
  background:transparent;\r
  color:var(--foreground, #fff); touch-action:none; user-select:none;\r
  /* Hover-only overlay, like a native player: at rest nothing is drawn over the\r
     media. The strip itself NEVER takes the pointer -- only the real controls do\r
     (--ic-bar-hit), so a drag started anywhere in the lower third still moves\r
     the node instead of dying on empty bar space. */\r
  opacity:0; pointer-events:none; --ic-bar-hit:none;\r
  transition:opacity .16s ease; }\r
/* Revealed by hovering ANYWHERE on the card (not just the invisible strip,\r
   which cannot be hovered while inert), by KEYBOARD focus inside the bar\r
   (:focus-visible only -- a plain :focus-within kept the bar pinned after any\r
   mouse click on play), and for the whole duration of a slider drag: pointer\r
   capture keeps that gesture alive after the pointer leaves the card. The custom property\r
   inherits into the controls, which is the only place we switch hit-testing on. */\r
.icn:hover .icn__bar,\r
.icn__bar:has(:focus-visible),\r
.icn__bar.is-dragging,\r
.icn__bar:has(.is-dragging) { opacity:1; --ic-bar-hit:auto; }\r
.icn__bar .icn__btn,\r
.icn__bar .icn__slider,\r
.icn__bar .icn__vol-group { pointer-events:var(--ic-bar-hit, none); }\r
.icn__bar-left { position:absolute; left:12px; right:12px; bottom:4px;\r
  height:24px; display:flex; align-items:center; gap:12px; }\r
.icn__btn { flex:0 0 24px; width:24px; height:24px; display:inline-flex;\r
  align-items:center; justify-content:center; padding:0; border:0; border-radius:50%;\r
  background:transparent; color:var(--foreground, #fff); cursor:pointer; }\r
.icn__btn svg { display:block; width:18px; height:18px; color:var(--foreground, #fff); }\r
.icn__btn--vol svg { width:17px; height:17px; }\r
/* No capsule/wash under the icons, not even on hover: the reference draws the\r
   bare glyph directly on the media. */\r
/* Reference layout: the speaker and its bar sit side by side, both fully\r
   visible for as long as the (hover-only) control bar is shown. No expanding\r
   pill and no second hover needed to reach the volume. */\r
.icn__vol-group { position:absolute; right:12px; bottom:4px; height:24px;\r
  display:inline-flex; flex-direction:row-reverse; align-items:center; gap:4px; }\r
.icn__vol-group > * { position:relative; z-index:1; }\r
.icn__vol { width:56px; opacity:1; }\r
.icn__time { flex:0 0 auto; display:inline-flex; align-items:center;\r
  font-size:var(--text-xs, 12px); font-weight:var(--font-weight-normal, 400); line-height:1; color:var(--foreground, #fff);\r
  font-variant-numeric:tabular-nums; white-space:nowrap; }\r
.icn__time b { display:inline-block; font-weight:var(--font-weight-normal, 400); }\r
.icn__time i { font-style:normal; padding:0 5px; }\r
/* 16px hit area around the 4px visual line. */\r
.icn__slider { position:relative; flex:0 0 auto; height:16px; cursor:pointer;\r
  outline:none; touch-action:none; }\r
.icn__seek { position:absolute; left:0; right:0; bottom:24px; height:16px; }\r
.icn__slider-track, .icn__slider-fill, .icn__slider-thumb { pointer-events:none; }\r
/* KNOB_INSET (10px) is both the visible margin and the travel margin:\r
   makeSlider maps the pointer against width - 2*KNOB_INSET so ratio 0 / 1 land\r
   exactly on the ends of the line. */\r
.icn__slider-track, .icn__slider-fill { position:absolute; top:50%; left:10px; right:10px;\r
  height:4px; margin-top:-2px; border-radius:999px; }\r
.icn__slider-track { background:color-mix(in srgb, var(--color-white, #fff) 20%, transparent); }\r
/* No transform / will-change here: those promote the fill to its own\r
   composited layer, which the viewport's scale(zoom) then upscales as a\r
   bitmap \u2014 so it goes blurry when the canvas is zoomed in. */\r
.icn__slider-fill { background:var(--color-white, #ffffff); right:auto; width:0; }\r
/* Hover knobs: 12px plain white discs, centred on the 4px line. No border and\r
   no shadow. They only exist while that slider is hovered, focused or dragged. */\r
.icn__slider-thumb { position:absolute; top:50%; left:0; width:0; height:0;\r
  margin:0; border-radius:50%; background:var(--color-white); opacity:0;\r
  transition:opacity .12s ease; }\r
.icn__seek:hover .icn__slider-thumb, .icn__seek:focus-visible .icn__slider-thumb,\r
.icn__seek.is-dragging .icn__slider-thumb,\r
.icn__vol:hover .icn__slider-thumb, .icn__vol:focus-visible .icn__slider-thumb,\r
.icn__vol.is-dragging .icn__slider-thumb {\r
  width:12px; height:12px; margin:-6px 0 0 -6px; opacity:1; }\r
.icn__slider:focus-visible .icn__slider-fill { box-shadow:0 0 0 2px color-mix(in srgb, var(--color-white) 45%, transparent); }\r
\r
.icn__form { position:absolute; inset:0; display:flex; flex-direction:column; gap:4px; padding:38px 10px 10px; font-size:var(--ic-ctrl-fs, 12px); overflow:auto; }\r
.icn__row { display:flex; align-items:center; gap:6px; }\r
.icn__label { flex:0 0 42px; color:var(--ic-soft, #8a8a8a); font-size:var(--text-2xs, 10px); }\r
.icn__input { flex:1 1 0; min-width:0; height:var(--ic-ctrl-h, 30px); padding:0 8px;\r
  border-radius:var(--icnw-r, 6px); border:0;\r
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);\r
  font-size:var(--ic-ctrl-fs, 12px); outline:none; cursor:text; }\r
.icn__input:hover { background:var(--icnw-hover, #3c3d42); }\r
.icn__input:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }\r
.icn__actions { display:flex; gap:6px; margin-top:2px; }\r
.icn__action { flex:1 1 0; height:var(--ic-ctrl-h, 30px); border-radius:var(--icnw-r, 6px);\r
  border:0; background:var(--icnw-bg, #313235);\r
  color:var(--ic-text, #ffffff); font-size:var(--ic-ctrl-fs, 12px); cursor:pointer; }\r
.icn__action--ghost { background:transparent; }\r
.icn__action:hover { background:var(--icnw-hover, #3c3d42); }\r
.icn__status { display:flex; align-items:center; gap:6px; margin-top:auto; color:var(--ic-soft, #8a8a8a); }\r
.icn__dot { width:6px; height:6px; border-radius:50%; background:var(--ic-soft, #8a8a8a); }\r
.icn__status.is-running .icn__dot { background:var(--color-credit); }\r
.icn__status.is-done .icn__dot { background:var(--color-jade-600); }\r
.icn__status.is-error .icn__dot { background:var(--ic-danger, #b33a3a); }\r
\r
/* Live generation progress while status=running: header carries the bar; body\r
   shows the streamed sample preview with a bottom shade so the text row stays\r
   readable. With no sample the body is just the text row (GEN_RUN_BODY_H). */\r
.icn__genprogress { position:relative; z-index:5; height:100%; box-sizing:border-box; overflow:hidden; }\r
.icn__gp-preview { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }\r
.icn__gp-shade { position:absolute; left:0; right:0; top:0; height:44px;\r
  background:linear-gradient(to bottom, color-mix(in srgb, var(--color-black, #000) 86%, transparent), transparent); }\r
.icn__gp-row { position:absolute; left:0; right:0; top:0; height:44px; display:flex; align-items:flex-start;\r
  padding:9px 12px 0; box-sizing:border-box; justify-content:flex-end; gap:16px;\r
  font-size:var(--text-xs, 12px); line-height:16px; color:var(--foreground, #fff); }\r
.icn__gp-total { flex:0 0 auto; white-space:nowrap; opacity:.9; }\r
.icn__gp-total b, .icn__gp-current b { font-weight:var(--font-weight-bold, 700); font-variant-numeric:tabular-nums; }\r
.icn__gp-current { display:inline-flex; align-items:baseline; gap:4px; min-width:0;\r
  color:var(--muted-foreground, rgba(255,255,255,.72)); }\r
.icn__gp-curname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap;\r
  max-width:200px; color:var(--foreground, #fff); }\r
\r
/* ---- LoRA stack node: config-only card wired into a generator ---- */\r
/* The card is auto-height (one row per LoRA); bodyH in setup grows with the\r
   row count, so the list never scrolls and no row is covered. Controls mirror\r
   ComfyUI Node 2.0: reka Switch for enable, SelectTrigger for the name, and a\r
   ScrubableNumberInput for the weight. */\r
.icn__lora { position:absolute; inset:0; box-sizing:border-box; display:flex; flex-direction:column;\r
  gap:6px; padding:8px 10px; overflow:hidden;\r
  font-size:var(--ic-ctrl-fs, 12px); color:var(--ic-text, #ffffff); }\r
.icn__lora-head { display:flex; align-items:center; justify-content:space-between;\r
  flex:0 0 auto; font-size:var(--text-xs, 12px); letter-spacing:.04em; color:var(--ic-soft, #8a8a8a); }\r
.icn__lora-refresh { display:inline-flex; align-items:center; justify-content:center;\r
  width:20px; height:20px; padding:0; border:0; border-radius:4px; cursor:pointer;\r
  background:transparent; color:var(--ic-soft, #8a8a8a); }\r
.icn__lora-refresh:hover { background:var(--icnw-hover, #3c3d42); color:var(--ic-text, #ffffff); }\r
.icn__lora-list { flex:1 1 auto; min-height:0; overflow:visible; display:flex; flex-direction:column; gap:4px; }\r
.icn__lora-row { display:flex; align-items:center; gap:6px; min-height:24px; height:24px; }\r
\r
/* Every LoRA widget uses ComfyUI's native node-control height of 24px (h-6),\r
   the same as the widgets inside the \u753B\u5E03 API \u53C2\u6570\u9762\u677F (lg-node-widgets) \u2014 NOT\r
   the 30px --ic-ctrl-h that the bigger action/input bar uses. */\r
.icn-switch { flex:0 0 40px; width:40px; height:24px; padding:0; border:0; border-radius:0;\r
  display:inline-flex; align-items:center; justify-content:center; background:transparent;\r
  cursor:pointer; outline:none; }\r
.icn-switch:focus-visible { box-shadow:0 0 0 1px var(--ring, var(--muted-foreground, #8a8a8a)); }\r
.icn-switch-track { box-sizing:border-box; display:inline-flex; align-items:center;\r
  width:36px; height:20px; padding:0 2px; border:1px solid transparent; border-radius:9999px;\r
  background:var(--border, #494a50); transition:background-color .2s ease; }\r
.icn-switch.is-on .icn-switch-track,\r
.icn__lora-row:not(.is-off) .icn-switch-track { background:var(--primary, #0b8ce9); }\r
.icn-switch-thumb { display:block; width:16px; height:16px; border-radius:9999px;\r
  background:var(--background, #171718); box-shadow:0 1px 2px color-mix(in srgb, var(--color-black) 35%, transparent);\r
  transform:translateX(0); transition:transform .2s ease; }\r
.icn__lora-row:not(.is-off) .icn-switch-thumb { transform:translateX(14px); }\r
.icn__lora-row.is-off .icn__lora-sel, .icn__lora-row.is-off .icn__lora-weight { opacity:.9; }\r
\r
.icn__lora-del { flex:0 0 24px; width:24px; height:24px; padding:0;\r
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer;\r
  border:0; border-radius:var(--ic-ctrl-r, 8px); background:var(--input, #313235); color:var(--ic-soft, #8a8a8a); }\r
.icn__lora-del:hover { background:var(--muted, #3c3d42); color:var(--ic-danger, #ff6b6b); }\r
/* SelectTrigger.md \u2014 w-full, no 172px cap: the name field stretches with the\r
   node as it is resized, which is what Node 2.0 widgets do. */\r
.icn__lora-name, .icn__lora-sel { flex:1 1 auto; min-width:0; max-width:none; height:24px;\r
  padding:0 6px 0 8px; border:2px solid transparent; border-radius:var(--ic-ctrl-r, 8px);\r
  background:var(--input, #313235); color:var(--ic-text, #ffffff); font:inherit;\r
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; outline:none;\r
  cursor:pointer; gap:6px; transition:background-color .2s ease; }\r
.icn__lora-sel:hover, .icn__lora-sel.is-open { background:var(--muted, #3c3d42); }\r
/* Two-class specificity beats the later generic .icn__sel \u2014 which sets both\r
   max-width:172px and height:var(--ic-ctrl-h,30px) \u2014 so the name trigger keeps\r
   growing with the node AND uses the 24px native-control height. */\r
.icn__sel.icn__lora-sel { max-width:none; height:24px; }\r
.icn__lora-sel .icn__sel-caret { color:var(--ic-soft, #8a8a8a); }\r
\r
/* ScrubableNumberInput.vue: rounded-md bg-input, square buttons h-full with\r
   hover:bg-muted. 100px wide \u2014 two 24px \xB1 buttons leave ~48px for the plain\r
   two-decimal value (e.g. "0.85"). All heights use the shared token. */\r
.icn__lora-weight { flex:0 0 auto; width:100px; display:inline-flex; align-items:stretch; gap:1px;\r
  height:24px; padding:0; border-radius:var(--ic-ctrl-r, 8px);\r
  background:var(--input, #313235); overflow:hidden; }\r
.icn__lora-weight button { flex:0 0 26px; width:26px; height:100%; padding:0; border:0; cursor:pointer;\r
  display:inline-flex; align-items:center; justify-content:center;\r
  background:transparent; color:var(--ic-soft, #8a8a8a); border-radius:0; }\r
.icn__lora-weight button:hover { background:var(--muted, #3c3d42); color:var(--ic-text, #ffffff); }\r
.icn__lora-weight input { flex:1 1 auto; min-width:0; width:100%; padding:0 2px; border:0; outline:none;\r
  background:transparent; color:var(--ic-text, #ffffff); font-size:var(--ic-ctrl-fs, 12px); text-align:center;\r
  font-variant-numeric:tabular-nums; }\r
.icn__lora-empty { flex:1 1 auto; display:flex; align-items:center; justify-content:center;\r
  color:var(--ic-soft, #8a8a8a); font-size:var(--text-xs, 12px); }\r
/* Trigger words read-back: the same bg-input + 8px radius language as the\r
   widgets above it, but with a real line height so a wrapped list stays\r
   legible. It never scrolls \u2014 flow-lora-stack.js measures this block and the\r
   card grows to fit (see setTriggerEl / the triggerH watcher).\r
   The label reuses the head row's type ramp (12px / .04em / soft). */\r
.icn__lora-triggers-wrap { flex:0 0 auto; display:flex; flex-direction:column; gap:4px; }\r
.icn__lora-triggers-label { font-size:var(--text-xs, 12px); line-height:16px;\r
  letter-spacing:.04em; color:var(--ic-soft, #8a8a8a); }\r
.icn__lora-triggers { flex:0 0 auto; padding:4px 8px; border-radius:var(--ic-ctrl-r, 8px);\r
  background:var(--input, #313235); color:var(--ic-text, #ffffff);\r
  font-size:var(--ic-ctrl-fs, 12px); line-height:16px;\r
  white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }\r
.icn__lora-add { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; gap:5px;\r
  height:24px; padding:0 10px; border:1px dashed var(--border, #494a50);\r
  border-radius:var(--ic-ctrl-r, 8px); background:transparent; color:var(--ic-soft, #8a8a8a);\r
  font-size:var(--ic-ctrl-fs, 12px); cursor:pointer; }\r
.icn__lora-add:hover { border-color:var(--ic-text, #ffffff); color:var(--ic-text, #ffffff); }\r
\r
/* ---- generate-node parameter PANEL: the body above is an asset-identical\r
   media card; this whole block appears BELOW it only when the node is selected.\r
   Three zones mirroring the reference: mode tabs / prompt input / bottom bar\r
   with a round send button. Sits outside .icn__body so overflow can't clip it. ---- */\r
/* z-index 32 clears the selected node's action row (z-index 30): the settings\r
   popover grows UPWARD out of the panel, and a workflow with a dozen exposed\r
   parameters makes it tall enough to reach the \u4E0A\u4F20/\u5220\u9664 buttons \u2014 at 24 those\r
   buttons' labels showed through the popover's rows. */\r
/* Layer-outside like the action row: inverse-scaled by --ic-iz so the panel\r
   keeps a constant SCREEN size at any canvas zoom. Anchor is the top-centre\r
   (top:calc(100% + 20px)), so scale about that edge to keep it pinned under\r
   the node. Chrome matches .ic-menu / .icn__tools \u2014 one floating-panel look. */\r
/* 2026-11-24 \u7528\u6237\u5B9A\u7A3F\uFF1A\u6240\u6709\u8282\u70B9\u7684\u53C2\u6570\u9762\u677F\u56FA\u5B9A 840px\uFF0C\u5C4F\u5E55\u5C3A\u5BF8\u6052\u5B9A\uFF0C\r
   \u4E0D\u518D\u8DDF\u8282\u70B9\u5BBD\u5EA6\u6216\u8282\u70B9\u7C7B\u578B\u8D70\uFF08\u539F\u5148 420/600 \u4E24\u79CD\u8D77\u70B9\u5BFC\u81F4\u5BBD\u5EA6\u4E0D\u4E00\uFF09\u3002 */\r
.icn__genpanel { position:absolute; left:50%; top:calc(100% + 20px); z-index:32;\r
  box-sizing:border-box; width:840px;\r
  display:flex; flex-direction:column; gap:0;\r
  padding:8px; border-radius:8px; border:1px solid var(--border, #494a50);\r
  background:var(--background, #171718); box-shadow:0 2px 16px 0 var(--shadow-color, rgba(0,0,0,.4)); color:var(--foreground, #ffffff);\r
  opacity:0; visibility:hidden; transform-origin:top center; transform:translate(-50%, -6px) scale(var(--ic-iz, 1));\r
  transition:opacity .14s ease, transform .14s ease, visibility 0s linear .14s; }\r
.icn--media.is-selected .icn__genpanel,\r
.icn--text.is-selected .icn__genpanel { opacity:1; visibility:visible; transform:translateX(-50%) scale(var(--ic-iz, 1));\r
  transition:opacity .14s ease, transform .14s ease, visibility 0s; }\r
/* Ctrl/Shift multi-selection is a bulk gesture (move / delete), not an edit\r
   session: the per-node action row and parameter panel would overlap every\r
   other selected card, so both stay away until only one node remains. */\r
.ic-flow.is-multi-select .icn__tools,\r
.ic-flow.is-multi-select .icn__genpanel {\r
  /* opacity is 1 while .icn.is-selected is set even though display:none hides\r
     the row. Grouping drops is-multi-select one render tick before Vue Flow\r
     clears .icn.is-selected, so display would flip back to flex while the row\r
     is still fully opaque -> a one-frame flash. Pin opacity/visibility too. */\r
  display:none !important; opacity:0 !important; visibility:hidden !important;\r
  transition:none !important; }\r
/* Group creation clears the selection in the same tick; hold the per-node\r
   chrome hidden for two frames so it can never flash between the two updates. */\r
.ic-flow.is-grouping .icn__tools,\r
.ic-flow.is-grouping .icn__genpanel { display:none !important; opacity:0 !important; visibility:hidden !important; }\r
/* \u5FFD\u7565(Ctrl+B)/\u9759\u97F3(Ctrl+M)\u7684\u8282\u70B9\u4E0D\u8FDB\u5165\u7F16\u8F91\uFF1A\u6574\u8282\u70B9\u53D8\u6697\u3001\u4E0D\u53C2\u4E0E\u8FD0\u884C\uFF0C\r
   \u9010\u8282\u70B9\u7684\u5DE5\u5177\u6761\u548C\u53C2\u6570\u6846\u4E5F\u4E0D\u8BE5\u5F39\u51FA\u3002\u4E0E\u591A\u9009\u9690\u85CF\u540C\u4E00\u6761\u89C4\u5219\u3001\u540C\u4E00 !important\r
   \u5F3A\u5EA6\uFF0C\u538B\u8FC7 .icn.is-selected \u7684 .icn__tools / .icn__genpanel \u663E\u793A\u6001\u3002 */\r
.icn.is-muted .icn__tools, .icn.is-muted .icn__genpanel,\r
.icn.is-ignored .icn__tools, .icn.is-ignored .icn__genpanel { display:none !important; }\r
/* Workflow switch \u2014 same Nodes 2.0 segmented control as .icn__gpv-modes.\r
   px is 10px instead of the source's px-5: workflow names are arbitrary length\r
   and this row holds 3-6 tabs, so the extra padding would truncate every label. */\r
.icn__gp-tabs { display:flex; align-items:center; justify-content:center; gap:4px;\r
  margin-bottom:8px; padding:4px; border-radius:6px; background:var(--icnw-bg, #313235); }\r
.icn__gp-tab { display:inline-flex; align-items:center; justify-content:center;\r
  flex:1 1 0; min-width:0; height:24px; padding:0 10px; border:0;\r
  border-radius:var(--icnw-r-sm, 4px); background:transparent;\r
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-normal, 400); line-height:1;\r
  text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;\r
  transition:background-color .15s ease, color .15s ease; }\r
.icn__gp-tab:hover { background:color-mix(in srgb, var(--color-charcoal-600) 50%, transparent); }\r
.icn__gp-tab.is-on { background:var(--icnw-panel, #262729); color:var(--ic-text, #ffffff); }\r
/* Prompt input area: every generator now paints the SAME rich box\r
   (.icn__gpv-rich) so the @ picker and its chips work on all of them. */\r
/* Bottom parameter bar */\r
.icn__gp-bar { display:flex; align-items:center; gap:6px; min-width:0; }\r
/* ---- Nodes 2.0 select (ComfyUI src/components/ui/select) ----------------\r
   Native <select> popups are painted by the OS and cannot be themed, so the\r
   trigger is a button and the list is our own popover:\r
     trigger  SelectTrigger size="md"  \u2192 rounded-lg, bg-secondary, hover/open\r
              bg-accent, leading label + chevron-down in muted-foreground;\r
     content  SelectContent            \u2192 bg-background #171718, rounded-lg,\r
              p-2, 8px below the trigger, 1px border + shadow, scrolls;\r
     item     SelectItem               \u2192 rounded-sm, accent on hover, muted\r
              surface + check glyph for the current value.\r
   Height stays 30px so it lines up with seed / \u6B65\u6570 / \u8FD0\u884C. The menu may\r
   overflow the panel on purpose: .icn does not clip, .icn__body does. */\r
.icn__selwrap { position:relative; display:inline-flex; min-width:0; }\r
.icn__sel { display:inline-flex; align-items:center; gap:6px; height:var(--ic-ctrl-h, 30px);\r
  padding:0 8px 0 10px; border:0; border-radius:8px; background:var(--icnw-bg, #313235);\r
  color:var(--ic-text, #ffffff); font:inherit; font-size:var(--text-xs, 12px); line-height:1;\r
  max-width:172px; min-width:0; cursor:pointer; transition:background-color .15s ease; }\r
.icn__sel:hover, .icn__sel.is-open { background:var(--icnw-hover, #3c3d42); }\r
/* Empty category: the picker is a plain box, no caret and no hover affordance. */\r
.icn__sel--empty { cursor:default; color:var(--ic-soft, #8a8a8a); }\r
.icn__sel--empty:hover { background:var(--icnw-bg, #313235); }\r
.icn__sel-t { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\r
.icn__sel-caret { flex:0 0 auto; color:var(--ic-soft, #8a8a8a); }\r
.icn__selmenu { position:absolute; left:0; top:calc(100% + 8px); z-index:60;\r
  box-sizing:border-box; min-width:max(100%, 148px); max-height:240px; overflow:auto;\r
  display:flex; flex-direction:column; padding:8px; border-radius:8px;\r
  background:var(--background, #171718); border:1px solid var(--ic-line, #494a50);\r
  box-shadow:0 10px 30px color-mix(in srgb, var(--color-black) 55%, transparent); }\r
/* Searched select menus (workflow picker + API field dropdown): same pinned\r
   search row as the LoRA picker, so every dropdown is filterable. */\r
.icn__sel-search { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:6px;\r
  flex:0 0 auto; margin:0 0 4px; padding:0 8px; height:28px;\r
  border-radius:6px; background:var(--muted, #3c3d42); color:var(--ic-soft, #8a8a8a); }\r
.icn__sel-searchinput { flex:1 1 auto; min-width:0; height:100%; padding:0; border:0; outline:none;\r
  background:transparent; color:var(--ic-text, #ffffff); font:inherit; font-size:var(--text-xs, 12px); }\r
.icn__sel-searchinput::placeholder { color:var(--ic-soft, #8a8a8a); }\r
.icn__selmenu--search { gap:1px; }\r
.icn__selitem { display:flex; align-items:center; justify-content:space-between; gap:10px;\r
  width:100%; padding:7px 8px; border:0; border-radius:4px; background:transparent;\r
  color:var(--ic-text, #ffffff); font:inherit; font-size:var(--text-xs, 12px); line-height:1.2;\r
  text-align:left; white-space:nowrap; cursor:pointer; }\r
.icn__selitem:hover { background:var(--icnw-bg, #313235); }\r
.icn__selitem.is-on { background:var(--icnw-hover, #3c3d42); }\r
.icn__selitem-t { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }\r
.icn__selitem-check { flex:0 0 auto; color:var(--ic-text, #ffffff); }\r
.icn__selitem--hint { color:var(--ic-soft, #8a8a8a); cursor:default; }\r
.icn__selitem--hint:hover { background:transparent; }\r
/* Searched LoRA picker: the API panel's icn__gpa-fsel listbox with a pinned\r
   search row above the scroll area, so hundreds of names stay filterable. */\r
.icn__lora-search { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:6px;\r
  flex:0 0 auto; margin:5px 5px 2px; padding:0 8px; height:28px;\r
  border-radius:6px; background:var(--muted, #3c3d42); color:var(--ic-soft, #8a8a8a); }\r
.icn__lora-searchinput { flex:1 1 auto; min-width:0; height:100%; padding:0; border:0; outline:none;\r
  background:transparent; color:var(--ic-text, #ffffff); font:inherit; font-size:var(--text-xs, 12px); }\r
.icn__lora-searchinput::placeholder { color:var(--ic-soft, #8a8a8a); }\r
.icn__lora-options { flex:1 1 auto; min-height:0; max-height:236px; overflow-y:auto;\r
  display:flex; flex-direction:column; gap:1px; }\r
.icn__lora-options::-webkit-scrollbar { width:6px; }\r
.icn__lora-options::-webkit-scrollbar-thumb { background:var(--icnw-hover, #3c3d42); border-radius:3px; }\r
.icn__gp-num { display:inline-flex; align-items:center; gap:4px; height:var(--ic-ctrl-h, 30px); padding:0 8px;\r
  border-radius:var(--icnw-r, 6px); border:0;\r
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); font-size:var(--text-2xs, 10px); white-space:nowrap; }\r
.icn__gp-num:hover { background:var(--icnw-hover, #3c3d42); }\r
.icn__gp-num input { width:42px; border:0; outline:none; background:transparent; color:var(--ic-text, #ffffff);\r
  font:inherit; font-size:var(--ic-ctrl-fs, 12px); text-align:right; -moz-appearance:textfield; cursor:text; }\r
.icn__gp-num input::-webkit-inner-spin-button, .icn__gp-num input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }\r
.icn__gp-send { flex:0 0 auto; height:var(--ic-ctrl-h, 30px); padding:0 12px; margin-left:auto;\r
  display:inline-flex; align-items:center; justify-content:center; border:0;\r
  border-radius:8px; background:var(--ic-brand, #0b8ce9); color:var(--foreground, #fff);\r
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; white-space:nowrap; cursor:pointer; }\r
.icn__gp-send:hover { background:color-mix(in srgb, var(--ic-brand, #0b8ce9) 90%, transparent); }\r
.icn__gp-send:disabled { opacity:.5; cursor:default; }\r
/* Run row: \u53D6\u6D88 (secondary) + run/sending button, kept together on the right. */\r
.icn__gp-run { display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; margin-left:auto; }\r
.icn__gp-run > .icn__gpv-send, .icn__gp-run > .icn__gp-send { margin-left:0; }\r
.icn__gp-cancel { height:var(--ic-ctrl-h, 30px); padding:0 12px; border:0; border-radius:8px;\r
  background:var(--icnw-bg, #313235); color:var(--ic-text, #fff);\r
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; white-space:nowrap; cursor:pointer; }\r
.icn__gp-cancel:hover { background:var(--icnw-hover, #3c3d42); }\r
\r
/* ---- VIDEO generator panel (reference layout) ---- */\r
.icn__genpanel.icn__gpv, .icn__genpanel:not(.icn__gpv):not(.icn__gpa) { width:840px; padding:10px; }\r
/* \u4E00\u7EA7\u5206\u7C7B tab\uFF08\u56FE\u50CF/\u56FE\u50CF\u5DE5\u5177 \xB7 \u89C6\u9891/\u89C6\u9891\u5DE5\u5177 \xB7 \u97F3\u4E50/\u97F3\u9891\uFF09\uFF1A\u590D\u7528\u4E0E\u4E8C\u7EA7\r
   WidgetToggleSwitch \u76F8\u540C\u7684\u539F\u751F\u89C2\u611F\uFF08bg-input / rounded-md / p-1 / gap-1\uFF09\uFF0C\r
   \u4F46\u53EA\u5360\u5185\u5BB9\u5BBD\u5EA6\u4E14\u4E0D flex:1\uFF0C\u907F\u514D\u4E24\u9879\u88AB\u62C9\u6EE1\u6574\u884C\uFF1B\u9009\u4E2D\u6001\u540C secondary\u3002 */\r
.icn__gpv-tops { display:flex; align-items:center; justify-content:center; gap:4px;\r
  margin-bottom:8px; padding:4px; border-radius:6px; background:var(--icnw-bg, #313235); }\r
.icn__gpv-top { display:inline-flex; align-items:center; justify-content:center;\r
  flex:0 1 auto; min-width:64px; height:24px; padding:0 16px; border:0;\r
  border-radius:var(--icnw-r-sm, 4px); background:transparent;\r
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-normal, 400); line-height:1;\r
  text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;\r
  transition:background-color .15s ease, color .15s ease; }\r
.icn__gpv-top:hover { background:color-mix(in srgb, var(--color-charcoal-600) 50%, transparent); }\r
.icn__gpv-top.is-on { background:var(--icnw-panel, #262729); color:var(--ic-text, #ffffff); }\r
/* \u6574\u7EC4\u6CA1\u6709\u4E00\u4E2A\u4E8C\u7EA7\u6A21\u5F0F\u53EF\u7528\u65F6\uFF08\u5982\u89C6\u9891+\u56FE\u7247\u63A5\u5165\u540E\u7684 \u89C6\u9891\u5DE5\u5177\uFF09\uFF0C\u4E00\u7EA7 tab\r
   \u7F6E\u7070\u4F46\u4FDD\u7559 hover tooltip \u8BF4\u660E\u7F3A\u4EC0\u4E48\uFF0C\u548C\u4E8C\u7EA7 is-disabled \u540C\u4E00\u89C2\u611F\u3002 */\r
.icn__gpv-top.is-disabled { opacity:.5; cursor:not-allowed; }\r
.icn__gpv-top.is-disabled:hover { background:transparent; color:var(--ic-soft, #8a8a8a); }\r
/* Mode switch = Nodes 2.0 WidgetToggleSwitch (a labelled BOOLEAN widget):\r
   ToggleGroup gets WidgetInputBaseClass + "flex w-full gap-1 p-1" (bg-input\r
   #313235 / rounded-md / 4px padding & gap), each ToggleGroupItem is size sm\r
   (h-6 px-5 text-xs / rounded-sm / flex-1 truncate), inactive is transparent\r
   muted-foreground hover:bg-secondary/50, active is bg-secondary + foreground. */\r
.icn__gpv-modes { display:flex; align-items:center; justify-content:center; gap:4px;\r
  margin-bottom:8px; padding:4px; border-radius:6px; background:var(--icnw-bg, #313235); }\r
.icn__gpv-mode { display:inline-flex; align-items:center; justify-content:center;\r
  flex:1 1 0; min-width:0; height:24px; padding:0 20px; border:0;\r
  border-radius:var(--icnw-r-sm, 4px); background:transparent;\r
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-normal, 400); line-height:1;\r
  text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;\r
  transition:background-color .15s ease, color .15s ease; }\r
/* hover only shifts the background (hover:bg-secondary/50); muted-foreground\r
   text stays put \u2014 only the active item turns white. */\r
.icn__gpv-mode:hover { background:color-mix(in srgb, var(--color-charcoal-600) 50%, transparent); }\r
.icn__gpv-mode.is-on { background:var(--icnw-panel, #262729); color:var(--ic-text, #ffffff); }\r
/* Kept pointer-events on (the source uses disabled:pointer-events-none) so the\r
   disabled tab still surfaces its modeReason() tooltip on hover. */\r
.icn__gpv-mode.is-disabled { opacity:.5; cursor:not-allowed; }\r
.icn__gpv-mode.is-disabled:hover { background:transparent; color:var(--ic-soft, #8a8a8a); }\r
/* Wired-assets row: incoming thumbnails */\r
.icn__gpv-assets { display:flex; align-items:center; gap:6px; margin-bottom:9px; min-height:40px; }\r
/* Wrapper is the positioning + hover context for the floating preview. It has\r
   NO overflow clip so the 160px preview can escape the small thumbnail. */\r
.icn__gpv-slot { position:relative; flex:0 0 40px; width:40px; height:40px; cursor:pointer; }\r
.icn__gpv-asset { position:relative; box-sizing:border-box; width:40px; height:40px; flex:0 0 40px;\r
  border-radius:var(--ic-ctrl-r, 8px); border:1px solid var(--ic-line, #494a50);\r
  background:var(--ic-input, #171718); overflow:hidden;\r
  display:inline-flex; align-items:center; justify-content:center; color:var(--ic-soft, #8a8a8a); }\r
.icn__gpv-asset img { width:100%; height:100%; object-fit:cover; display:block; }\r
/* Play triangle overlaid on a video's extracted thumbnail (and shown alone\r
   before extraction completes). Dark disc keeps it legible on bright frames. */\r
.icn__gpv-asset-play { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:1;\r
  box-sizing:content-box; padding:5px 4px 5px 6px; border-radius:50%; color:var(--foreground, #fff);\r
  background:color-mix(in srgb, var(--color-black) 50%, transparent); display:inline-flex; align-items:center; justify-content:center;\r
  pointer-events:none; }\r
.icn__gpv-asset--empty { border-style:dashed; border-color:var(--ic-line, #494a50);\r
  background:transparent; color:var(--ic-soft, #8a8a8a); cursor:default; }\r
/* Per-slot name label (\u56FE\u72471 / \u89C6\u98911 / \u97F3\u98911) pinned to the bottom edge. */\r
.icn__gpv-asset-label { position:absolute; left:0; right:0; bottom:0; z-index:2;\r
  padding:2px 0 1px; text-align:center; font-size:var(--text-2xs, 10px); line-height:1.1; color:var(--foreground, #fff);\r
  background:linear-gradient(transparent, color-mix(in srgb, var(--color-black, #000) 78%, transparent)); pointer-events:none;\r
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\r
/* Hover preview popover: 160px wide, height follows media aspect ratio. Anchored\r
   above the thumbnail; a transparent bottom pad bridges the gap so the pointer\r
   can travel from thumbnail into popover without leaving the wrapper. */\r
.icn__gpv-preview { position:absolute; left:50%; bottom:calc(100% + 10px); transform:translateX(-50%);\r
  z-index:80; box-sizing:border-box; width:160px; padding:0; border-radius:var(--ic-radius, 12px);\r
  cursor:default; background:var(--ic-panel, #262729); border:1px solid var(--ic-line, #494a50);\r
  box-shadow:0 8px 28px color-mix(in srgb, var(--color-black) 60%, transparent); }\r
/* Transparent bridge below the popover covers the 10px gap up to the wrapper so\r
   the pointer can travel into the preview without firing mouseleave. */\r
.icn__gpv-preview::after { content:""; position:absolute; left:0; right:0; top:100%; height:12px; }\r
/* Media fills the CONTENT box (the card is border-box, so 160px minus the 2px\r
   border) and its top corners are the card radius minus that border \u2014 otherwise\r
   the image bleeds over the 1px frame and the corners read as a double curve. */\r
.icn__gpv-preview-media { display:block; width:100%; height:auto; max-height:360px; object-fit:contain;\r
  background:var(--color-black); border-radius:calc(var(--ic-radius, 12px) - 1px) calc(var(--ic-radius, 12px) - 1px) 0 0; }\r
/* Audio preview: no native controls. Hidden player autoplays; only duration +\r
   name are shown, matching the reference's restrained audio presentation. */\r
.icn__gpv-preview-audio-hidden { display:block; width:0; height:0; opacity:0; pointer-events:none; }\r
.icn__gpv-preview-audio-meta { display:flex; align-items:center; gap:8px; min-width:0;\r
  padding:7px 8px; background:var(--ic-input, #171718);\r
  border-radius:calc(var(--ic-radius, 12px) - 1px); }\r
/* Label (\u97F3\u98911) comes first and takes the remaining space; duration trails on\r
   the right as a small muted capsule. */\r
.icn__gpv-preview-audio-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;\r
  white-space:nowrap; font-size:var(--text-2xs, 10px); color:var(--ic-text, #ffffff); font-weight:var(--font-weight-semibold, 600); }\r
.icn__gpv-preview-audio-time { flex:0 0 auto; padding:1px 4px; border-radius:4px;\r
  background:var(--ic-hover, #313235); color:var(--ic-soft, #8a8a8a); font-size:var(--text-2xs, 10px);\r
  font-variant-numeric:tabular-nums; }\r
.icn__gpv-preview-name { padding:3px 6px 4px; font-size:var(--text-2xs, 10px); color:var(--ic-soft, #8a8a8a);\r
  background:var(--ic-input, #171718);\r
  border-radius:0 0 calc(var(--ic-radius, 12px) - 1px) calc(var(--ic-radius, 12px) - 1px); }\r
/* Prompt textarea */\r
/* Prompt box + the "@" quick-reference picker. The picker is a Nodes 2.0\r
   popover: secondary surface, 8px radius, 12px label, accent hover,\r
   20px thumbnail. It floats ABOVE the box so it never fights the param bar. */\r
/* Every exposed multiline-text field is labelled above its own box. */\r
.icn__gpv-label { display:block; margin-bottom:4px; font-size:var(--text-xs, 12px); line-height:1.4;\r
  color:var(--ic-soft, #8a8a8a); }\r
.icn__gpv-extras { display:flex; flex-direction:column; gap:8px; margin-bottom:9px; }\r
.icn__gpv-input { position:relative; margin-bottom:9px; }\r
.icn__gpv-atmenu { position:absolute; left:0; right:0; bottom:calc(100% + 6px); z-index:8;\r
  display:flex; flex-direction:column; gap:2px; padding:4px; max-height:132px; overflow:auto;\r
  border-radius:8px; border:1px solid color-mix(in srgb, var(--color-white) 9%, transparent);\r
  background:var(--icnw-panel, #262729); box-shadow:0 12px 32px color-mix(in srgb, var(--color-black) 55%, transparent); }\r
.icn__gpv-atitem { display:flex; align-items:center; gap:8px; width:100%; min-height:28px;\r
  padding:0 6px; border:0; border-radius:4px; background:transparent;\r
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-normal, 400); line-height:1;\r
  text-align:left; white-space:nowrap; cursor:pointer; }\r
.icn__gpv-atitem.is-on { background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff); }\r
.icn__gpv-atthumb { flex:0 0 20px; width:20px; height:20px; display:inline-flex;\r
  align-items:center; justify-content:center; overflow:hidden; border-radius:4px;\r
  background:var(--color-charcoal-700, #1c1d1f); color:var(--ic-soft, #8a8a8a); }\r
.icn__gpv-atthumb img { display:block; width:100%; height:100%; object-fit:cover; }\r
.icn__gpv-atlabel { flex:0 0 auto; color:inherit; font-weight:var(--font-weight-medium, 500); }\r
.icn__gpv-atname { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;\r
  white-space:nowrap; color:var(--ic-soft, #8a8a8a); font-size:var(--text-2xs, 10px); }\r
.icn__gpv-atitem.is-on .icn__gpv-atname { color:var(--muted-foreground, rgba(255,255,255,.62)); }\r
/* Prompt EDITOR: contenteditable, so a reference can be an atomic chip.\r
   Same box as the other prompt areas (input surface) and the SAME type as the\r
   rest of the node: inherited sans, 12px, 1.55 \u2014 no monospace. 104px \u2248 5 lines\r
   at that leading, so a multi-clause prompt is readable without scrolling. */\r
.icn__gpv-rich { box-sizing:border-box; width:100%; height:104px; padding:8px; overflow:auto;\r
  border-radius:var(--icnw-r, 6px); outline:none;\r
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);\r
  font-family:inherit; font-size:var(--text-xs, 12px); line-height:1.55; text-align:left; cursor:text;\r
  white-space:pre-wrap; word-break:break-word; }\r
.icn__gpv-rich:hover { background:var(--icnw-hover, #3c3d42); }\r
.icn__gpv-rich:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }\r
.icn__gpv-rich:empty::before { content:attr(data-placeholder); color:var(--ic-soft, #8a8a8a);\r
  pointer-events:none; }\r
/* Text box occupied by a wire / disabled (no workflow or no text input).\r
   Wired boxes read from the connected node, so they are visibly locked and\r
   show the incoming text in brand colour; empty workflow boxes are dimmed. */\r
.icn__gpv-rich.is-wired, .icn__gpa-area.is-wired { color:var(--ic-brand, #0b8ce9); cursor:default; }\r
.icn__gpv-rich.is-disabled, .icn__gpv-rich[contenteditable="false"] { cursor:default; }\r
.icn__gpv-rich[contenteditable="false"]:hover { background:var(--icnw-bg, #313235); }\r
.icn__gpv-rich.is-disabled:not(.is-wired) { opacity:.55; }\r
.icn__gpa-area:disabled { opacity:.75; cursor:default; }\r
.icn__gpa-area:disabled:hover { background:var(--icnw-bg, #313235); }\r
.icn__gpa-area.is-wired::placeholder, .icn__gpv-rich.is-wired[data-placeholder]::before {\r
  color:var(--ic-brand, #0b8ce9); opacity:.9; }\r
/* Reference chip: thumbnail + highlighted "@\u56FE\u72471" as ONE unit \u2014 the caret\r
   cannot enter it (contenteditable=false) and one backspace removes it.\r
   display:inline (NOT inline-flex) on purpose: Chrome treats a flex container\r
   as a block when serialising the selection, which would inject line breaks\r
   into a copied prompt. Inline keeps it inside the running text. */\r
.icn__gpv-ref { display:inline; padding:0 2px; border-radius:3px;\r
  vertical-align:baseline; user-select:text; cursor:default; }\r
.icn__gpv-ref:hover { background:color-mix(in srgb, var(--color-electric-400) 12%, transparent); }\r
.icn__gpv-ref-img { display:inline-block; width:14px; height:14px; margin-right:3px;\r
  border-radius:3px; object-fit:cover; vertical-align:-3px;\r
  user-select:none; pointer-events:none; }\r
.icn__gpv-ref-t { color:var(--icnw-ref, #c8f169); font-weight:var(--font-weight-medium, 500); }\r
/* Hover card for a chip. It reuses .icn__gpv-preview wholesale (surface,\r
   radius, media sizing, name strip); only the anchoring is overridden \u2014 a chip\r
   sits in a scrolling text run, so the card is fixed, horizontally centred on\r
   the chip and lifted 8px above it (clamped into the viewport by the caller). */\r
.icn__gpv-refprev { position:fixed; left:0; top:0; right:auto; bottom:auto; z-index:3000;\r
  /* the card lives in the canvas root, where --ic-line is a 42% tint; pin it to\r
     the node-local value so it matches the slot thumbnail card exactly. */\r
  --ic-line:var(--color-charcoal-200, #494a50);\r
  transform:translate(-50%, calc(-100% - 8px)); pointer-events:none; }\r
.icn__gpv-refprev .icn__gpv-preview-media { max-height:min(360px, 62vh); }\r
/* Placeholder frame when the media itself is unreachable (e.g. the chip was\r
   restored from saved text but its asset node is gone). */\r
.icn__gpv-refprev-ph { display:flex; align-items:center; justify-content:center;\r
  height:64px; border-radius:calc(var(--ic-radius, 12px) - 1px) calc(var(--ic-radius, 12px) - 1px) 0 0;\r
  background:var(--color-black); color:var(--ic-soft, #8a8a8a); font-size:var(--text-xs, 12px); }\r
/* Bottom bar: workflow select + param select + round send button */\r
.icn__gpv-bar { display:flex; align-items:center; gap:6px; min-width:0; }\r
.icn__gpv-send { margin-left:auto; flex:0 0 auto; height:var(--ic-ctrl-h, 30px); padding:0 12px;\r
  display:inline-flex; align-items:center; justify-content:center; border:0;\r
  border-radius:8px; background:var(--ic-brand, #0b8ce9); color:var(--foreground, #fff);\r
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; white-space:nowrap; cursor:pointer; }\r
.icn__gpv-send:hover { background:color-mix(in srgb, var(--ic-brand, #0b8ce9) 90%, transparent); }\r
.icn__gpv-send:disabled { opacity:.5; cursor:default; }\r
\r
/* ---- AUDIO generator panel -------------------------------------------\r
   Same Nodes 2.0 surfaces as the video panel (mode row / input surface /\r
   30px bottom bar). The two prompt areas are labelled boxes so the meaning of\r
   each one is explicit (\u63D0\u793A\u8BCD/\u6B4C\u8BCD vs \u8BED\u6C14/\u6717\u8BFB\u6587\u672C); the workflow's exposed\r
   API parameters live behind the gear button on the left of the API picker. */\r
.icn__genpanel.icn__gpa { width:840px; padding:10px; }\r
.icn__gpa-inputs { display:flex; flex-direction:column; gap:8px; margin-bottom:9px; }\r
.icn__gpa-box { display:flex; flex-direction:column; gap:4px; min-width:0; }\r
.icn__gpa-label { font-size:var(--text-xs, 12px); line-height:1.4; color:var(--ic-soft, #8a8a8a); }\r
/* Wired text node marker: the text is a PROMPT, it feeds this first area at\r
   run time (never the lyrics / reading-text area below). */\r
.icn__gpa-wired { color:var(--ic-brand, #0b8ce9); white-space:nowrap; }\r
.icn__gpa-area { box-sizing:border-box; width:100%; padding:8px; resize:none; border:0; outline:none;\r
  border-radius:var(--icnw-r, 6px); background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);\r
  font-family:inherit; font-size:var(--text-xs, 12px); line-height:1.55; text-align:left; cursor:text; }\r
.icn__gpa-area:hover { background:var(--icnw-hover, #3c3d42); }\r
.icn__gpa-area:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }\r
.icn__gpa-area::placeholder { color:var(--ic-soft, #8a8a8a); }\r
/* 2026-11-24 \u7528\u6237\u5B9A\u7A3F\uFF1A\u9762\u677F\u5185\u6240\u6709\u63D0\u793A\u8BCD\u8F93\u5165\u6846\u7EDF\u4E00 104px\uFF08\u539F\u6765 a \u6846\u662F 76px\uFF09\u3002 */\r
.icn__gpa-area--a { height:104px; }\r
.icn__gpa-area--b { height:104px; }\r
.icn__gpa-bar { display:flex; align-items:center; gap:6px; min-width:0; }\r
/* Both pickers keep their intrinsic width; only the run button eats the slack,\r
   so a long workflow name can never be squeezed to "\u97F3\u9891\u9762\u2026". */\r
.icn__gpa-bar > .icn__selwrap, .icn__gpa-setwrap { flex:0 0 auto; }\r
.icn__gpa-send { margin-left:auto; }\r
/* The video/image bars share the audio settings gear + API picker. Keep both\r
   at intrinsic width and cap the picker so a long workflow name truncates\r
   rather than squeezing the run button off the row. */\r
.icn__gpv-bar > .icn__selwrap, .icn__gp-bar > .icn__selwrap { flex:0 0 auto; }\r
.icn__gpv-bar > .icn__selwrap > .icn__sel, .icn__gp-bar > .icn__selwrap > .icn__sel { max-width:220px; }\r
/* The API picker may carry a full workflow filename (\u6587\u751F\u97F3\u4E50\uFF1AMiniMax Music 3),\r
   so it gets a wider cap than the shared 172px \u2014 still truncated. */\r
.icn__gpa-bar > .icn__selwrap > .icn__sel { max-width:220px; }\r
\r
/* ---- API params popover ----------------------------------------------\r
   Every row used to be hand-drawn in pixels, which is what made the card look\r
   stitched together: a 164px numeric pill sat next to a 152px select next to a\r
   40px switch, at two different heights, so no two right edges lined up.\r
   The rows are now ComfyUI's Nodes 2.0 widget grid -- the markup copies\r
   WidgetGrid.vue / WidgetLayoutField.vue / ScrubableNumberInput.vue /\r
   WidgetSelectDefault.vue / WidgetToggleSwitch.vue class for class, and the\r
   host's own Tailwind build supplies the measurements (24px controls, 4px row\r
   gap, 12px port gutter, minmax(80px,min-content) label, minmax(125px,1fr)\r
   control). Only the card chrome and the popover anchoring live here. */\r
.icn__gpa-setwrap { position:relative; display:inline-flex; }\r
.icn__gpa-set { position:relative; display:inline-flex; align-items:center; justify-content:center;\r
  width:var(--ic-ctrl-h, 30px); height:var(--ic-ctrl-h, 30px); padding:0; border:0; border-radius:8px;\r
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); cursor:pointer;\r
  transition:background-color .15s ease, color .15s ease; }\r
.icn__gpa-set:hover, .icn__gpa-set.is-open {\r
  background:var(--icnw-hover, #3c3d42); color:var(--ic-text, #ffffff); }\r
.icn__gpa-set:disabled, .icn__gpa-set.is-disabled { opacity:.45; cursor:not-allowed; }\r
.icn__gpa-set:disabled:hover, .icn__gpa-set.is-disabled:hover {\r
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); }\r
/* Dot = "this API has parameters behind the gear" (they are no longer inline). */\r
.icn__gpa-setdot { position:absolute; top:5px; right:5px; width:5px; height:5px;\r
  border-radius:50%; background:var(--ic-brand, #0b8ce9); }\r
/* The left offset here is only the fallback: placePop() measures the gear and\r
   pins the card inside the panel (it hangs off the gear, sliding left when the\r
   card would run past the panel's right edge). */\r
/* Nodes 2.0 node body is --card (#262729), NOT --background (#171718). The\r
   footer band uses the host's bg-node-header (#202121), which is DARKER than\r
   the body -- on a #171718 card the same band reads as a bright stripe, i.e.\r
   the opposite of the real node. */\r
/* Same native card frame as the API config dialog's .ac-params card\r
   (rounded-xl / border border-border / bg-card / shadow-sm). Earlier this\r
   cloned the Nodes 2.0 node shell (bg --ic-head-bg, no border, no shadow);\r
   those private tokens are unset on :root so it fell back to dark values and\r
   read as a different surface. Now every colour comes from a host token. */\r
.icn__gpa-pop { position:absolute; left:0; bottom:calc(100% + 8px); z-index:62;\r
  box-sizing:border-box; width:348px; padding:0;\r
  /* Every exposed parameter is shown at once \u2014 no height cap, no scroll bar.\r
     The card grows upward from its anchor so all rows stay visible. */\r
  text-align:left;\r
  border-radius:12px; background:var(--card, #262729);\r
  border:1px solid var(--border, #494a50);\r
  color:var(--foreground, #ffffff);\r
  box-shadow:0 1px 4px 0 var(--shadow-color, rgb(0 0 0 / .4)); }\r
/* Native card header: h-9 + border-b border-border + px-3, minus the pill row. */\r
.icn__gpa-pophead { display:flex; align-items:center; gap:6px; box-sizing:border-box;\r
  height:36px; padding:0 12px; border-bottom:1px solid var(--border, #494a50); }\r
.icn__gpa-popt { font-size:var(--text-xs, 12px); line-height:1.35; color:var(--foreground, #ffffff); }\r
/* The card is now one flat surface: no node-style band for the body to cover. */\r
.icn__gpa-body { position:relative; z-index:1; }\r
.icn__gpa-popcnt { padding:0 5px; border-radius:999px; background:var(--muted, #3c3d42);\r
  color:var(--muted-foreground, #8a8a8a); font-size:var(--text-2xs, 10px); line-height:14px; }\r
.icn__gpa-popempty { padding:4px 12px 12px; font-size:var(--text-xs, 12px); line-height:var(--text-base--line-height, 1.5);\r
  color:var(--muted-foreground, #8a8a8a); }\r
/* The exposed-parameter listbox: same card skin as the settings popover. */\r
.icn__gpa-fsel { position:absolute; z-index:66; box-sizing:border-box;\r
  display:flex; flex-direction:column; overflow:hidden; text-align:left;\r
  border-radius:8px; background:var(--card, #262729); border:1px solid var(--border, #494a50);\r
  box-shadow:0 10px 30px color-mix(in srgb, var(--color-black) 55%, transparent); }\r
/* The API field list no longer inverse-scales itself: it lives inside\r
   .icn__gpa-pop, which inherits the generator panel's whole-panel --ic-iz,\r
   so CSS px here are already 1:1 with screen px at any canvas zoom. */\r
/* The field dropdown has no padding of its own (unlike icn__selmenu), so give\r
   its pinned search row the same inset the LoRA picker uses. */\r
.icn__gpa-fsel > .icn__sel-search { margin:5px 5px 4px; }\r
/* ValueControlPopover is w-113 (452px) upstream, but next to a 348px settings\r
   card that reads as a blown-up dialog for four rows. The chooser is the card's\r
   own size, so it looks like the card grew a section rather than a second window.\r
   It is a child of .icn__gpa-pop now and inherits the panel's whole-panel\r
   --ic-iz, so it needs no transform of its own; inline top is a card CSS px,\r
   and inline left/right stretch it to the card's final width. */\r
.icn__gpa-modes { position:absolute; z-index:66; box-sizing:border-box;\r
  width:348px; overflow:hidden; text-align:left; border-radius:10px; background:var(--card, #262729);\r
  border:1px solid var(--border, #494a50); box-shadow:0 10px 30px color-mix(in srgb, var(--color-black) 55%, transparent); }\r
\r
/* Four corner resize grips \u2014 verbatim port of ComfyUI's vueNodes renderer\r
   (LGraphNode.vue + resize/resizeHandleConfig.ts). The glyph is the upstream\r
   SVG path "M11 1L1 11M11 6L6 11" in a 12x12 viewBox: one long + one short\r
   parallel diagonal. Container is h-5 w-5 (20px), SVG is size-2/5 (8px),\r
   stroke uses the host token var(--color-muted-foreground), width 2, round\r
   caps/joins. The four corners FLIP the SVG via scale (not rotate the box),\r
   exactly like upstream. Grips stay hidden until the node is hovered. */\r
.icn__rz { position:absolute; width:20px; height:20px; z-index:21;\r
  opacity:0; transition:opacity .12s ease; }\r
.icn:hover .icn__rz, .icn__rz.is-active { opacity:1; }\r
.icn__rz svg { position:absolute; width:40%; height:40%; }\r
.icn__rz svg path { fill:none; stroke:var(--color-muted-foreground, rgba(255,255,255,.62));\r
  stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }\r
.icn__rz:hover svg path, .icn__rz.is-active svg path { stroke:var(--primary, #0b8ce9); }\r
/* Corners are offset -1 (-4px) so the glyph straddles the node edge, exactly\r
   as ComfyUI's -right-1/-bottom-1 etc. positionClasses do. */\r
.icn__rz--se { right:-4px; bottom:-4px; cursor:se-resize; }\r
.icn__rz--se svg { top:4px; left:4px; }\r
.icn__rz--ne { right:-4px; top:-4px; cursor:ne-resize; }\r
.icn__rz--ne svg { bottom:4px; left:4px; transform:scaleY(-1); }\r
.icn__rz--sw { left:-4px; bottom:-4px; cursor:sw-resize; }\r
.icn__rz--sw svg { top:4px; right:4px; transform:scaleX(-1); }\r
.icn__rz--nw { left:-4px; top:-4px; cursor:nw-resize; }\r
.icn__rz--nw svg { bottom:4px; right:4px; transform:scale(-1,-1); }\r
\r
/* The console panel publishes its live height as --ic-console-h on the shared\r
   shell (infcanvas-console.js), so the minimap rides up above it when open. */\r
.ic-minimap-wrap { position:absolute; right:8px; bottom:calc(54px + var(--ic-console-h, 0px)); z-index:1000; display:flex; flex-direction:row; }\r
.ic-minimap { position:relative; width:253px; height:200px; border:1px solid var(--border,#333);\r
  border-radius:8px; background:var(--background,#1a1a1a); box-shadow:0 4px 12px color-mix(in srgb, var(--color-black) 35%, transparent); overflow:hidden; }\r
/* Vue Flow's Panel adds margin:15px + a -30px inset, which shifts the SVG\r
   up/left inside our fixed container: the viewport box then reaches the left\r
   and top edges but can never reach right/bottom. Cancel that offset so the\r
   minimap fills the frame and the box tracks all four sides symmetrically. */\r
.ic-minimap .vue-flow__minimap { background:transparent!important; margin:0!important; inset:0!important;\r
  top:0!important; left:0!important; right:0!important; bottom:0!important; width:100%; height:100%; }\r
.ic-minimap .vue-flow__minimap svg { display:block; width:100%; height:100%; }\r
/* Native MiniMap.vue viewport: a foreground outline with no dimming mask\r
   (the native one never darkens the outside; it draws the viewport rect).\r
   Vue Flow paints the OUTSIDE via this path, so keep it transparent and only\r
   keep the 2px foreground outline. CSS overrides the SVG presentation attrs. */\r
.ic-minimap .vue-flow__minimap-mask { fill:transparent!important; stroke:var(--foreground, #fff)!important; stroke-width:1.5!important; vector-effect:non-scaling-stroke!important; }\r
/* Native MiniMap paints the viewport rect with a 20% foreground fill over the\r
   nodes; Vue Flow's evenodd mask fills the OUTSIDE, so a separate inner path\r
   (kept in sync in flow-root.js) supplies the tint. */\r
.ic-minimap .vue-flow__minimap .ic-minimap__viewport-fill { fill:color-mix(in srgb, var(--foreground, #fff) 20%, transparent); stroke:none; pointer-events:none; }\r
/* Close button pinned to the top-right corner (class string on the element in\r
   flow-root.js). The border rule sits below the 32px button row so it never\r
   crosses the control. */\r
.ic-minimap__btn { position:absolute; top:0; z-index:10; }\r
.ic-minimap__close { right:0; }\r
.ic-minimap__rule { position:absolute; top:32px; left:0; z-index:5; height:1px; width:100%;\r
  margin:0; border:0; background:var(--border, #494a50); }\r
\r
/* ---- Two-row generator bottom bar -----------------------------------\r
   Row 1 = settings: the gear (opens the full API-param editor) followed by a\r
   read-only, dot-separated summary of the plain params. Row 2 = the workflow\r
   picker on the left, cancel/run on the right. The popover still anchors to\r
   .icn__gpa-setwrap, so placePop() needs no change. */\r
.icn__gp-bar, .icn__gpv-bar, .icn__gpa-bar { display:flex; flex-direction:column; align-items:stretch; gap:8px; min-width:0; }\r
.icn__bar2-row { display:flex; align-items:center; gap:6px; min-width:0; }\r
.icn__bar2-setrow > .icn__gpa-setwrap { flex:0 0 auto; }\r
.icn__bar2-runrow > .icn__selwrap { flex:0 0 auto; min-width:0; }\r
.icn__bar2-runrow > .icn__selwrap > .icn__sel { max-width:220px; }\r
.icn__bar2-runrow > .icn__gp-run { margin-left:auto; }\r
.icn__bar2-params { flex:1 1 auto; min-width:0; display:flex; align-items:center; flex-wrap:wrap;\r
  column-gap:7px; row-gap:2px; cursor:pointer; font-size:var(--text-xs, 12px); line-height:var(--text-base--line-height, 1.5);\r
  color:var(--ic-soft, #8a8a8a); }\r
/* \u53C2\u6570\u6458\u8981\u884C\u7684\u6587\u5B57\u6837\u5F0F\u7EDF\u4E00\u8D70\u5BBF\u4E3B ComfyUI class\uFF1A\u6A21\u677F\u91CC\u6807\u7B7E\u7528\r
   text-xs/font-medium/leading-tight/text-muted-foreground\uFF0C\u503C\u7528\r
   text-xs/leading-snug/text-foreground\uFF0C\u4E0E API \u53C2\u6570\u5F39\u51FA\u6846 (.icn__gpa-body)\r
   \u7684\u53C2\u6570\u6807\u7B7E/\u503C\u540C\u4E00\u5957\u505A\u6CD5\u3002\u6837\u5F0F\u53EA\u5728\u5BBF\u4E3B CSS + token \u4E00\u5904\u5B9A\u4E49\u3001\u4E24\u5904\u590D\u7528\uFF0C\r
   \u4E0D\u518D\u5404\u5199\u4E00\u4EFD\u88F8 px\u3002 */\r
.icn__bar2-params:hover .icn__bar2-param b { color:var(--foreground, #fff); }\r
/* Random-field mode badge in the read-only summary: same capsule + colour as\r
   the gear popover's ValueControlButton (bg-primary/30 + rounded-full for the\r
   active modes, transparent + muted for fixed), placed right AFTER the param\r
   name. Size/colour come from the host classes in the template; this rule only\r
   keeps the summary click-through to the gear via openSetFromBar. */\r
.icn__bar2-mode { pointer-events:none; }\r
.icn__bar2-dot { flex:0 0 auto; color:var(--border, #494a50); }\r
.icn__bar2-empty { opacity:.6; }\r
`;

// ../../web/canvas/css/infcanvas-gallery.css
var infcanvas_gallery_default = `\r
/* The menu, the delete dialog, the lightbox and the selection bar are all\r
   appended to <body>, i.e. outside the panel, so the tokens are declared on\r
   every layer instead of only on .xog. Declaring them on the panel alone left\r
   the popovers without --xog-line, which is why the menu separator rendered as\r
   an invisible strip (background: var(--xog-line) with nothing to resolve to). */\r
.xog,\r
.xog-ctx,\r
.xog-selbar,\r
.xog-lb,\r
.xog-marquee,\r
.xog-head-slot {\r
    --xog-fg: var(--text-primary, var(--fg-color, #e8e8e8));\r
    --xog-muted: var(--text-secondary, color-mix(in srgb, var(--fg-color, #e8e8e8) 62%, transparent));\r
    --xog-line: var(--interface-stroke, color-mix(in srgb, var(--fg-color, #e8e8e8) 18%, transparent));\r
    --xog-surface: var(--secondary-background, var(--comfy-input-bg, rgba(127, 127, 127, 0.14)));\r
    --xog-surface-hover: var(--secondary-background-hover, rgba(127, 127, 127, 0.22));\r
    --xog-tab-active: var(--interface-menu-component-surface-hovered, rgba(127, 127, 127, 0.22));\r
    --xog-accent: var(--border-default, var(--p-primary-color, #4a9eff));\r
    /* Native selected ring is ring-3 + ring-modal-card-border-highlighted +\r
       ring-inset. That token is a dead end at runtime: the shipped sheet\r
       defines it as var(--color-ash-400) (light) / var(--secondary-background-\r
       selected) (dark), the light block lands last and --color-ash-400 does not\r
       exist in the palette \u2192 the custom property computes to the empty string,\r
       so Tailwind's var(--tw-ring-color, currentcolor) falls back to the card's\r
       inherited text colour. Measured on 8188: rgb(255,255,255) 0 0 0 3px inset\r
       \u2014 i.e. a WHITE 3px inner frame (dark theme). Reproduce the computed\r
       result, not the broken token. */\r
    --xog-ring: currentColor;\r
    --xog-placeholder: var(--secondary-background, color-mix(in srgb, var(--fg-color, #e8e8e8) 10%, transparent));\r
    /* Native card hover tint: bg-modal-card-background-hovered/20 \u2014 the token\r
       flattened to full opacity would be a solid block, far heavier than the\r
       official panel faint lift. */\r
    --xog-card-hover: color-mix(in oklab, var(--modal-card-background-hovered, var(--secondary-background-hover, #313235)) 20%, transparent);\r
    --xog-danger: var(--destructive-background, var(--p-button-danger-background, #f75951));\r
}\r
.xog {\r
    display: flex;\r
    flex-direction: column;\r
    gap: 0;\r
    min-height: 100%;\r
    padding: 0;\r
    box-sizing: border-box;\r
    color: var(--xog-fg);\r
    font-family: inherit;\r
    font-size: var(--text-sm, 14px);\r
    line-height: var(--text-base--line-height, 1.5);\r
}\r
.xog-bar {\r
    position: sticky;\r
    top: 0;\r
    z-index: 4;\r
    display: flex;\r
    flex-direction: column;\r
    gap: 0;\r
    margin: 0;\r
    padding: 0;\r
    background: var(--comfy-menu-bg, var(--bg-color, #171718));\r
}\r
.xog-srctabs-row {\r
    display: flex;\r
    align-items: center;\r
    gap: 8px;\r
    padding: 8px 16px 1px;     /* native px-4 pt-2 pb-px */\r
}\r
/* text-xs text-muted-foreground is mounted on the DOM; only layout stays. */\r
.xog-count {\r
    flex: none;\r
    margin-left: auto;\r
    white-space: nowrap;\r
}\r
/* Header-slot variant (canvas shell title row, left of the close X): the count\r
   and refresh share one inline group with no auto margin. Uses the same\r
   .xog-count / .xog-btn base rules; only the row layout is overridden. */\r
/* The shell's title-row actions already own the 8px gap, so these wrappers\r
   must not create a second flex context (that doubled the gap between our\r
   refresh and the native close X). display:contents puts count + refresh\r
   directly into the same flex row as the close button. */\r
.xog-head-slot,\r
.xog-head-group { display: contents; }\r
.xog-head-group .xog-count { margin-left: 0; }\r
/* Button(variant=secondary|muted-textonly, size=icon) classes are mounted on\r
   the DOM \u2014 including the [&_svg...]:size-4 rule for their icons. */\r
/* Match ComfyUI's native Assets tab strip (sideToolbar): "output / input"\r
   are pill-shaped chips with a filled selected state, and there is NO rule\r
   under them. The canvas shell renders the "\u5386\u53F2\u753B\u5ECA" title; count + refresh\r
   share this row, pushed to the right of "input" (no separate header/divider). */\r
.xog-srctabs {\r
    display: flex;\r
    align-items: center;\r
    gap: 8px;\r
    min-width: 0;\r
    overflow-x: auto;\r
    scrollbar-width: none;\r
}\r
.xog-srctabs::-webkit-scrollbar { display: none; }\r
/* In the canvas shell count + refresh were moved to the title row, leaving\r
   this chip as the sole item: let it stretch across the whole row so a long\r
   folder path uses all the room instead of ellipsising at 190px. */\r
.xog--shell .xog-srctabs { flex: 1; min-width: 0; }\r
/* Visuals now come from the native Tab.vue class string mounted on the DOM\r
   (flex h-8 px-2.5 rounded-lg text-sm + bg-accent/text-foreground or the\r
   muted/off variant). Only layout hooks that UnoCSS cannot express stay here.\r
   NOTE: the old line-height:1 + font-weight:500 on the active tab were the\r
   "\u6587\u5B57\u4E0D\u5BF9" the user spotted \u2014 native is weight 400 / line-height 20px. */\r
.xog-srctab { white-space: nowrap; }\r
/* \u5A92\u4F53 panel replaces the output/input tabs with one folder chip. In the\r
   canvas shell the count + refresh live in the title row, so this chip is the\r
   only thing on the row and can use the FULL width -- no 190px cap needed.\r
   Keep the cap only for the standalone (non-shell) layout. */\r
.xog-media-path {\r
    max-width: 100%;\r
    overflow: hidden;\r
}\r
.xog:not(.xog--shell) .xog-media-path,\r
.xog:not(.xog--shell) .xog-media-path[data-active="true"] { max-width: 190px; }\r
/* A block-level inner label is required for text-overflow: ellipsis to clip\r
   the END of a long Windows path. The chip itself is inline-flex + centered,\r
   which clipped both ends of bare text (dropping "C:\\\\U" and the tail). */\r
.xog-media-label {\r
    display: block;\r
    min-width: 0;\r
    overflow: hidden;\r
    text-overflow: ellipsis;\r
    white-space: nowrap;\r
}\r
.xog-tabs {\r
    display: flex;\r
    flex-wrap: wrap;\r
    align-items: center;\r
    gap: 8px;\r
    /* Match the tab-strip\u2192search gap (~9px) on BOTH sides: searchrow already\r
       contributes pb 8px, so pt 1px gives 9px above; grid has no top padding,\r
       so pb 9px gives the same 9px below the chips. */\r
    padding: 1px 16px 9px;\r
}\r
/* The "\u5168\u90E8 / \u6587\u672C / \u56FE\u50CF / \u89C6\u9891 / \u97F3\u9891" filter row has NO native counterpart \u2014\r
   ComfyUI filters by type via a dropdown menu, not fixed chips. Kept as a\r
   canvas-only convenience, but its text now follows the native text-sm metrics\r
   (no line-height:1 compression, weight stays 400) so it reads like the tabs. */\r
/* .xog-chip is only an event hook: its visual comes from the native Tab.vue\r
   classes mounted on the DOM (NATIVE_TAB_BASE + ON/OFF), toggled on click. */\r
.xog-searchrow {\r
    display: flex;\r
    align-items: center;\r
    gap: 8px;\r
    /* Native filter bar measured on the live panel: padding 8px 16px (the\r
       search row itself carries the top gap; the tab strip's pb-px adds 1px,\r
       yielding the ~9px tab-to-search spacing). Source shows px-4 pb-2 but the\r
       shipped build also applies py-2 \u2014 trust the computed value. */\r
    padding: 8px 16px;\r
}\r
/* Native searchInputVariants(md) class is mounted on this element:\r
   relative flex w-full h-8 px-2 py-1.5 rounded-lg bg-secondary text-foreground\r
   focus-within:ring-1 focus-within:ring-ring. Only the grow/flex hook that\r
   UnoCSS cannot express stays here (the view-button sits beside it). */\r
.xog-searchbox {\r
    flex: 1;\r
    min-width: 0;\r
    box-sizing: border-box;\r
}\r
/* SearchInput.vue icon classes are mounted on the DOM; no visual rules remain. */\r
/* Native combobox input class is mounted: size-full border-none bg-transparent\r
   outline-none pl-8 text-xs (text-xs sets line-height 16px). No visual rules\r
   here \u2014 the host UnoCSS class owns size, padding, colour and text metrics. */\r
/* No placeholder colour on purpose: the native SearchInput does not set one\r
   either, so both fall through to the UA default (#757575 in Chromium). Pinning\r
   a token here made the hint noticeably brighter than the official panel. */\r
.xog-viewwrap {\r
    position: relative;\r
    flex: none;\r
}\r
/* View menu surface + item visuals come from the native class strings mounted\r
   on the DOM (NATIVE_MENU_CONTENT + NATIVE_VIEW_ITEM). Only placement stays. */\r
.xog-menu {\r
    position: absolute;\r
    /* Popover.vue sideOffset=5 + PopoverArrow height 5. Reka PopperContent offsets\r
       the surface by sideOffset + arrowHeight (offset({ mainAxis })), so the\r
       bubble sits 10px below the trigger and the arrow tip lands 5px below it.\r
       Setting only 5px made the arrow touch the button. */\r
    top: calc(100% + 10px);\r
    inset-inline-end: 0;\r
    z-index: 20;\r
    flex-direction: column;\r
    box-sizing: border-box;\r
}\r
.xog-menu[hidden] { display: none; }\r
/* Popover.vue arrow: Reka PopoverArrow sits at the top edge of a side=bottom\r
   content, centred on the trigger. Native width=10 height=5; the SVG path is a\r
   downward triangle, flipped 180deg so it points up at the trigger. */\r
.xog-menu-arrow {\r
    position: absolute;\r
    top: -5px;\r
    /* Menu is right-aligned to the 32px trigger (inset-inline-end:0); Reka\r
       centres the arrow on the trigger, i.e. 16px from the menu's right edge.\r
       Arrow is 10px wide, so its right edge sits 16-5=11px from the menu edge. */\r
    right: 11px;\r
    transform: rotate(180deg);\r
    pointer-events: none;\r
}\r
/* MediaAssetSettingsMenu.vue puts opacity-0 on the inactive check icon;\r
   that class is toggled on the SVG itself, no CSS rule here. */\r
.xog-body {\r
    flex: 1 1 auto;\r
    display: flex;\r
    flex-direction: column;\r
    min-width: 0;\r
}\r
.xog-grid {\r
    display: grid;\r
    gap: 8px;\r
    padding: 0 8px 12px;\r
}\r
.xog-grid[data-view="list"] { grid-template-columns: minmax(0, 1fr); }\r
/* Card/check/actions visuals now come from the native class strings mounted on\r
   the DOM (MediaAssetCard.vue + button.variants.ts). Only the positioning that\r
   UnoCSS cannot express for our flat DOM stays here: our overlays are direct\r
   children of the card (the native nests them in the square preview), so the\r
   16px inset is measured from the card border rather than the preview box. */\r
.xog-card {\r
    position: relative;\r
    text-align: start;\r
    box-sizing: border-box;\r
}\r
.xog-card:focus-visible { outline: 1px solid var(--ring, var(--xog-accent)); outline-offset: 0; }\r
/* The check SVG carries opacity-0 / no-opacity from MediaAssetCard.vue;\r
   .xog-check[data-on] stays only as a debug hook. */\r
.xog-check,\r
.xog-actions {\r
    position: absolute;\r
    z-index: 3;\r
}\r
.xog-check {\r
    inset-block-start: 16px;\r
    inset-inline-start: 16px;\r
}\r
.xog-actions {\r
    inset-block-start: 16px;\r
    inset-inline-end: 16px;\r
}\r
/* MediaImageTop.vue / MediaVideoTop.vue plate classes (bg-muted / bg-black)\r
   are mounted on the DOM by kind; only block layout stays here. */\r
.xog-thumb > img,\r
.xog-thumb > video { display: block; }\r
.xog-fill {\r
    position: absolute;\r
    inset: 0;\r
    display: flex;\r
    flex-direction: column;\r
    align-items: center;\r
    justify-content: center;\r
    gap: 8px;\r
    color: var(--xog-fg);\r
    transition: transform 0.3s ease;\r
}\r
.xog-fill > .xog-glyph {\r
    width: calc(var(--spacing, 4px) * 7.5);\r
    height: calc(var(--spacing, 4px) * 7.5);\r
    flex: none;\r
}\r
/* text-xs + leading-4 are mounted on the label by DOM; max-width / padding /\r
   ellipsis are layout-only hooks for narrow tiles. */\r
.xog-fill span {\r
    max-width: 100%;\r
    padding: 0 8px;\r
    text-align: center;\r
    white-space: nowrap;\r
    overflow: hidden;\r
    text-overflow: ellipsis;\r
}\r
/* MediaImageTop's group-hover:scale-105 handles the image; our face keeps the\r
   same motion because the native fallback face has no hover transform. */\r
.xog-card:hover .xog-fill { transform: scale(1.05); }\r
/* Text cards print a real snippet of the file instead of a glyph. */\r
.xog-text-body {\r
    display: none;\r
    width: 100%;\r
    height: 100%;\r
    margin: 0;\r
    padding: 8px;\r
    box-sizing: border-box;\r
    color: var(--xog-fg);\r
    font-family: inherit;\r
    text-align: start;\r
    white-space: pre-wrap;\r
    overflow-wrap: anywhere;\r
    overflow: hidden;\r
    /* The snippet stops mid-line otherwise \u2014 fade the last row out instead of\r
       cutting a glyph in half. The #000 is a mask alpha source, never a colour. */\r
    mask-image: linear-gradient(to bottom, var(--color-black, #000) calc(100% - 14px), transparent);\r
}\r
.xog-fill[data-snippet="true"] .xog-text-body { display: block; }\r
.xog-fill[data-snippet="true"] > .xog-glyph { display: none; }\r
/* bg-black/15 + text-white are mounted on the DOM; geometry stays here. */\r
.xog-play {\r
    position: absolute;\r
    inset: 0;\r
    display: flex;\r
    align-items: center;\r
    justify-content: center;\r
    pointer-events: none;\r
}\r
.xog-play > .xog-glyph {\r
    width: calc(var(--spacing, 4px) * 6);\r
    height: calc(var(--spacing, 4px) * 6);\r
}\r
/* Audio transport is the native WaveAudioPlayer compact class string mounted\r
   on the DOM; only the list-view hide hook remains in CSS. */\r
/* MediaAssetCard.vue info row (grid) / AssetsListItem.vue text stack (list)\r
   classes are mounted on the DOM and swapped by paintCardClasses. Only the\r
   ellipsis on the size \xB7 time line is kept: narrow tiles need it more than\r
   the native fixed-width card does. */\r
.xog-meta { padding: 0; }\r
.xog-name { display: block; }\r
.xog-sub {\r
    white-space: nowrap;\r
    overflow: hidden;\r
    text-overflow: ellipsis;\r
}\r
/* List-row layout only \u2014 background/ring/text now come from the native\r
   getAssetCardClass() classes mounted on the DOM (NATIVE_ROW_*), so removing\r
   these hand-drawn values is what makes selection follow the host theme. */\r
.xog-grid[data-view="list"] .xog-card {\r
    display: flex;\r
    flex-direction: row;\r
    align-items: center;\r
    gap: 8px;\r
    padding: 8px;\r
    min-height: 48px;\r
}\r
/* rounded-sm (4px) already comes from NATIVE_PREVIEW_PLATE; only the 32px\r
   list thumbnail box needs overriding. */\r
.xog-grid[data-view="list"] .xog-thumb {\r
    flex: none;\r
    width: 32px;\r
    height: 32px;\r
    aspect-ratio: auto;\r
}\r
/* flex-1 gap-1 text-xs leading-none now come from NATIVE_LIST_META. */\r
/* While the hover-only download/delete actions are revealed, reserve their\r
   full width (2\xD732 + 8 gap + 4 inset) so name/sub ellipsize before them\r
   instead of running underneath and getting clipped by the buttons. */\r
.xog-grid[data-view="list"] .xog-card:hover .xog-meta,\r
.xog-grid[data-view="list"] .xog-card:focus-within .xog-meta {\r
    padding-right: 80px;\r
}\r
/* List name/sub typography comes from NATIVE_LIST_NAME / NATIVE_LIST_SUB. */\r
/* A 32px row has no room for a snippet or a transport \u2014 glyph only. */\r
.xog-grid[data-view="list"] .xog-fill > .xog-glyph { width: calc(var(--spacing, 4px) * 3.5); height: calc(var(--spacing, 4px) * 3.5); }\r
.xog-grid[data-view="list"] .xog-fill span,\r
.xog-grid[data-view="list"] .xog-text-body,\r
.xog-grid[data-view="list"] .xog-wave { display: none; }\r
.xog-grid[data-view="list"] .xog-fill[data-snippet="true"] > .xog-glyph { display: block; }\r
.xog-grid[data-view="list"] .xog-play > .xog-glyph { width: calc(var(--spacing, 4px) * 3); height: calc(var(--spacing, 4px) * 3); }\r
/* A list row has no preview corner to hang a checkbox on \u2014 selection rides on\r
   the row itself and only the overflow control stays, docked to the row end\r
   like the native list item actions slot. */\r
.xog-grid[data-view="list"] .xog-check { display: none; }\r
.xog-grid[data-view="list"] .xog-actions {\r
    inset-block-start: 50%;\r
    inset-inline-end: 4px;\r
    transform: translateY(-50%);\r
}\r
/* gap-2 and the absence of an IconGroup plate now come from NATIVE_LIST_ACTIONS. */\r
/* Button(variant="secondary" size="icon") classes are mounted on the DOM in\r
   paintCardClasses; no colour rules here. */\r
/* text-sm text-muted-foreground is mounted on the DOM; only layout stays. */\r
.xog-status {\r
    padding: 24px 16px;\r
    text-align: center;\r
}\r
/* NoResultsPlaceholder.vue classes are mounted on the DOM (h-full p-8,\r
   flex flex-col items-center text-center, mb-4 text-5xl, mb-2 text-foreground).\r
   The native <h3> has no font-size class: it falls through to the UA default\r
   (1.17rem, normal). .xog sets a 14px base, so without this compensation the\r
   heading would inherit 1.17 x 14px and render ~2px smaller than native. */\r
.xog-empty h3 { font-size: 1.17rem; line-height: normal; }\r
.xog-sentinel { height: 1px; }\r
\r
/* Floating selection bar (MediaAssetSelectionBar): max-w-78, bottom-6, centred.\r
   It is fixed and tracked against the panel rect on purpose: as a sticky child\r
   of a long grid it stays trapped inside its own (off-screen) parent box, and\r
   the panel itself is not the scroll container \u2014 the sidebar around it is. */\r
/* MediaAssetSelectionBar.vue classes are mounted on the DOM: flex gap-2\r
   rounded-lg bg-foreground p-2 text-background shadow-md; the three buttons are\r
   inverted icon-lg with hover:bg-background/10, the count is\r
   pr-6 text-sm font-bold tabular-nums, the right group ml-auto flex gap-1 and\r
   the divider h-6 w-px bg-background/20. Only canvas-specific positioning\r
   (fixed + measured placement, higher z-index) stays here. */\r
.xog-selbar {\r
    position: fixed;\r
    bottom: 24px;\r
    z-index: 1000;\r
    width: 100%;\r
    max-width: 312px;\r
    box-sizing: border-box;\r
}\r
.xog-selbar[hidden] { display: none; }\r
.xog-selbar[data-offscreen="true"] { display: none; }\r
\r
/* Context menu \u2014 surface/items/separator visuals come from the native\r
   menuStyles.ts classes mounted on the DOM (NATIVE_MENU_*). Only the layer-\r
   external placement + high z-index (canvas root stacks at 20000) stay. */\r
.xog-ctx {\r
    position: fixed;\r
    z-index: 10050;\r
    flex-direction: column;\r
    max-width: 320px;\r
    box-sizing: border-box;\r
}\r
.xog-ctx[hidden] { display: none; }\r
/* Menu items all use the same native styling: no per-action colour override.\r
   Icon size comes from the size-4 class on the SVG. */\r
\r
/* Delete confirmation is api.confirmDialog (the host dialogService); a former\r
   hand-built xog-dlg* stylesheet was dead code and has been removed. */\r
\r
/* Marquee rectangle, teleported to <body> exactly like AssetsSidebarTab: inside\r
   the panel it would be swallowed by the cards it floats over. */\r
.xog-marquee {\r
    position: fixed;\r
    z-index: 9999;\r
    pointer-events: none;\r
    border: 1px solid var(--primary-background, var(--xog-accent));\r
    background: color-mix(in srgb, var(--primary-background, var(--xog-accent)) 20%, transparent);\r
}\r
\r
/* MediaLightbox.vue overlay classes are mounted on the DOM (fixed inset-0\r
   flex items-center justify-center bg-black/90); only the canvas z-index stays. */\r
.xog-lb {\r
    z-index: 10000;\r
}\r
.xog-lb[hidden] { display: none; }\r
.xog-lb-panel {\r
    display: flex;\r
    flex-direction: column;\r
    width: min(1600px, 96vw);\r
    height: 92vh;\r
    max-width: min(1600px, 96vw);\r
    max-height: 92vh;\r
    border: 1px solid var(--xog-line);\r
    border-radius: 8px;\r
    background: var(--comfy-menu-bg, var(--dialog-surface, #171718));\r
    color: var(--xog-fg);\r
    overflow: hidden;\r
    font-family: inherit;\r
    font-size: var(--text-sm, 14px);\r
}\r
.xog-lb-head {\r
    display: flex;\r
    align-items: center;\r
    gap: 8px;\r
    min-height: 64px;\r
    padding: 0 16px;\r
    border-bottom: 1px solid var(--xog-line);\r
}\r
.xog-lb-titles {\r
    display: flex;\r
    align-items: baseline;\r
    gap: 8px;\r
    min-width: 0;\r
}\r
/* Native text-sm/normal + truncate / text-xs + truncate classes are mounted\r
   on the DOM; only the flex sizing hooks stay here. */\r
.xog-lb-name {\r
    flex: 0 1 auto;\r
    min-width: 0;\r
}\r
.xog-lb-meta {\r
    flex: none;\r
    min-width: 0;\r
}\r
.xog-lb-actions { display: flex; gap: 8px; flex: none; margin-left: auto; }\r
/* Preview on the left, fixed-width parameter column on the right. The preview\r
   flexes with the viewport; the parameter column never shrinks. */\r
.xog-lb-main {\r
    display: flex;\r
    flex: 1 1 auto;\r
    width: 100%;\r
    min-width: 0;\r
    min-height: 0;\r
}\r
.xog-lb-stage {\r
    position: relative;\r
    display: flex;\r
    flex: 1 1 0;\r
    min-width: 0;\r
    min-height: 0;\r
}\r
/* bg-black is mounted on the DOM (closest native stage colour); geometry stays. */\r
.xog-lb-body {\r
    display: flex;\r
    flex: 1 1 0;\r
    align-items: center;\r
    justify-content: center;\r
    min-width: 0;\r
    min-height: 0;\r
    overflow: hidden;\r
    box-sizing: border-box;\r
}\r
/* MediaLightbox prev/next Button classes are mounted on the DOM (secondary,\r
   icon-lg, rounded-full, always visible). Only stage-relative placement stays. */\r
.xog-lb-nav {\r
    position: absolute;\r
    top: 50%;\r
    z-index: 2;\r
    transform: translateY(-50%);\r
}\r
.xog-lb-nav[hidden] { display: none; }\r
/* Task-result previews hide the delete action via options.hideDelete; the\r
   xog-btn base sets inline-flex, which overrides the native [hidden]. */\r
.xog-lb-delete[hidden] { display: none; }\r
.xog-lb-prev { left: 14px; }\r
.xog-lb-next { right: 14px; }\r
.xog-lb-body img,\r
.xog-lb-body video {\r
    display: block;\r
    width: 100%;\r
    height: 100%;\r
    max-width: none;\r
    max-height: none;\r
    object-fit: contain;\r
}\r
.xog-lb-body audio { width: min(480px, 80%); margin: 24px; }\r
.xog-lb-body pre {\r
    width: 100%;\r
    height: 100%;\r
    margin: 0;\r
    padding: 16px;\r
    box-sizing: border-box;\r
    overflow: auto;\r
    color: var(--xog-fg);\r
    /* font-mono + text-xs/normal are mounted on the DOM. */\r
    white-space: pre-wrap;\r
    overflow-wrap: anywhere;\r
}\r
.xog-lb-face {\r
    display: flex;\r
    flex-direction: column;\r
    align-items: center;\r
    gap: 8px;\r
    padding: 48px;\r
    color: var(--xog-fg);\r
    font-size: var(--text-sm, 14px);\r
}\r
/* Generation info: fixed-width right column, one parameter per row. Only this\r
   column scrolls; the preview on the left keeps the rest of the dialog width. */\r
.xog-lb-info {\r
    display: flex;\r
    flex-direction: column;\r
    flex: 0 0 360px;\r
    width: 360px;\r
    height: 100%;\r
    min-height: 0;\r
    padding: 16px;\r
    box-sizing: border-box;\r
    border-left: 1px solid var(--xog-line);\r
    background: var(--xog-surface, #171718);\r
    overflow-x: hidden;\r
    overflow-y: auto;\r
    scrollbar-width: thin;\r
    scrollbar-color: var(--muted, var(--xog-muted)) transparent;\r
}\r
.xog-lb-info[hidden] { display: none; }\r
.xog-lb-prompts {\r
    display: flex;\r
    flex: 0 0 auto;\r
    flex-direction: column;\r
    gap: 6px;\r
    min-width: 0;\r
}\r
.xog-lb-prompts + .xog-lb-badges { margin-top: 10px; }\r
.xog-lb-prompts-head {\r
    display: flex;\r
    align-items: center;\r
    justify-content: space-between;\r
    gap: 8px;\r
    margin-bottom: 4px;\r
}\r
/* Native micro-label: text-2xs (10px, nearest to the old 11px) + font-bold +\r
   tracking-wider (0.05em, nearest to 0.04em) are mounted on the DOM. Only the\r
   muted token stays here. */\r
.xog-lb-prompts-title {\r
    color: var(--xog-muted);\r
}\r
/* Button(variant=muted-textonly, size=icon-sm + size-7) classes are mounted\r
   on the DOM; the .xog-lb-prompt-copy hook carries no visual rules. */\r
.xog-lb-prompt {\r
    display: flex;\r
    flex-direction: column;\r
    gap: 6px;\r
    padding: 7px 8px;\r
    border: 1px solid var(--xog-line);\r
    border-radius: 6px;\r
    background: var(--xog-surface-hover, transparent);\r
    color: var(--xog-fg);\r
}\r
/* text-xs/normal (12px \xD7 --leading-normal 1.5 = 18px) is mounted on the DOM;\r
   only wrapping stays here. */\r
.xog-lb-prompt-text {\r
    white-space: pre-wrap;\r
    overflow-wrap: anywhere;\r
}\r
.xog-lb-badges {\r
    display: flex;\r
    flex-direction: column;\r
    flex-wrap: nowrap;\r
    flex: none;\r
    gap: 6px;\r
    width: 100%;\r
}\r
.xog-lb-badge {\r
    display: flex;\r
    align-items: baseline;\r
    gap: 4px;\r
    width: 100%;\r
    min-width: 0;\r
    padding: 5px 8px;\r
    border: 1px solid var(--xog-line);\r
    border-radius: 6px;\r
    background: var(--xog-surface-hover, rgba(127, 127, 127, 0.1));\r
    box-sizing: border-box;\r
}\r
/* Same native micro-label recipe as prompts-title. */\r
.xog-lb-badge-tag {\r
    flex: 0 0 auto;\r
    min-width: 46px;\r
    color: var(--xog-muted);\r
    white-space: nowrap;\r
}\r
.xog-lb-badge-val {\r
    flex: 1 1 auto;\r
    min-width: 0;\r
    color: var(--xog-fg);\r
    white-space: nowrap;\r
    overflow: hidden;\r
    text-overflow: ellipsis;\r
}\r
.xog-lb-badge-val.xog-lb-badge-lora {\r
    display: flex;\r
    align-items: baseline;\r
    gap: 6px;\r
    text-overflow: clip;\r
}\r
.xog-lb-badge-name {\r
    flex: 1 1 auto;\r
    min-width: 0;\r
    white-space: nowrap;\r
    overflow: hidden;\r
    text-overflow: ellipsis;\r
}\r
.xog-lb-badge-weight {\r
    flex: 0 0 auto;\r
    margin-left: auto;\r
    color: var(--xog-muted);\r
    white-space: nowrap;\r
}\r
/* .xog-lb-info-empty now carries text-xs text-muted-foreground directly. */\r
/* Match ComfyUI's native .scrollbar-custom exactly (SidebarTabTemplate body):\r
   thin scrollbar-color for standards browsers + 10px webkit bar whose thumb is\r
   var(--muted) with a 2px transparent border (6px visual) and a pill radius. */\r
.xog-body,\r
.xog-lb-info { scrollbar-width: thin; scrollbar-color: var(--muted, var(--xog-muted)) transparent; }\r
.xog ::-webkit-scrollbar,\r
.xog-lb ::-webkit-scrollbar { background-color: transparent; width: 10px; height: 10px; }\r
.xog ::-webkit-scrollbar-track,\r
.xog-lb ::-webkit-scrollbar-track { background: transparent; }\r
.xog ::-webkit-scrollbar-thumb,\r
.xog-lb ::-webkit-scrollbar-thumb {\r
    background: var(--muted, var(--xog-muted));\r
    border: 2px solid transparent;\r
    border-radius: 9999px;\r
}\r
.xog ::-webkit-scrollbar-thumb:hover,\r
.xog-lb ::-webkit-scrollbar-thumb:hover {\r
    background: var(--muted, var(--xog-muted));\r
}\r
.xog ::-webkit-scrollbar-corner,\r
.xog-lb ::-webkit-scrollbar-corner { background: transparent; }\r
`;

// ../../web/canvas/css/infcanvas-tools.css
var infcanvas_tools_default = `\r
.ict-mask { position:fixed; inset:0; z-index:9999; display:flex; align-items:center;\r
  justify-content:center; padding:24px; box-sizing:border-box; background:color-mix(in srgb, var(--color-black) 66%, transparent); }\r
.ict-panel { display:flex; flex-direction:column; max-width:100%; max-height:calc(100vh - 48px);\r
  box-sizing:border-box; border:1px solid var(--ic-line, #494a50); border-radius:var(--ic-radius-lg, 16px);\r
  /* Nodes 2.0 tokens \u2014 now aliased straight to ComfyUI's own theme variables\r
     so tool dialogs follow dark/light like the rest of the canvas. Fallbacks\r
     are the measured dark values; --primary-background is ACCENT (not a\r
     surface), so --icn2-primary deliberately uses --primary. */\r
  --icn2-bg:var(--background, #171718); --icn2-secondary:var(--card, #262729);\r
  --icn2-accent:var(--accent, #313235); --icn2-input:var(--accent, #313235);\r
  --icn2-fg:var(--foreground, #ffffff); --icn2-muted:var(--muted-foreground, #8a8a8a);\r
  --icn2-mutedbg:var(--muted, #3c3d42);\r
  --icn2-primary:var(--primary, #0b8ce9); --icn2-ring:var(--ring, #8a8a8a);\r
  --icn2-r:4px; --icn2-r-md:6px;\r
  background:var(--icn2-bg); color:var(--ic-text, #ffffff);\r
  box-shadow:0 24px 70px color-mix(in srgb, var(--color-black) 60%, transparent); font-size:var(--text-sm, 14px); overflow:hidden; }\r
.ict-head { flex:0 0 auto; display:flex; align-items:baseline; gap:10px; padding:14px 16px 10px;\r
  border-bottom:1px solid var(--ic-line, #494a50); }\r
.ict-head h3 { margin:0; font-size:var(--text-base, 16px); font-weight:var(--font-weight-semibold, 600); }\r
.ict-sub { color:var(--ic-soft, #8a8a8a); font-size:var(--ic-ctrl-fs, 12px); }\r
.ict-x { margin-left:auto; width:32px; height:32px; border:0; border-radius:8px;\r
  background:transparent; color:var(--icn2-muted, #8a8a8a); font-size:var(--text-base, 16px); line-height:1; cursor:pointer;\r
  transition:background-color .12s ease, color .12s ease; }\r
.ict-x:hover { background:var(--icn2-accent, #313235); color:var(--icn2-fg, #ffffff); }\r
.ict-body { flex:1 1 auto; min-height:0; overflow:auto; padding:14px 16px; }\r
.ict-foot { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:10px 16px 14px;\r
  border-top:1px solid var(--ic-line, #494a50); }\r
.ict-status { flex:1; min-width:0; color:var(--ic-soft, #8a8a8a); font-size:var(--ic-ctrl-fs, 12px);\r
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\r
.ict-actions { display:flex; gap:8px; }\r
/* Nodes 2.0 button = design-system buttonVariants size md (the default used by\r
   ConfirmationDialogContent / PromptDialogContent): h-8 / rounded-lg / p-2 /\r
   text-xs / bg-secondary / hover:bg-accent, no border. Footer buttons keep the\r
   size lg of ConfirmFooter.vue. */\r
.ict-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px;\r
  height:32px; padding:0 8px; box-sizing:border-box; border:0; border-radius:8px;\r
  background:var(--icn2-secondary, #262729); color:var(--icn2-fg, #ffffff);\r
  font-family:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-medium, 500); line-height:1; white-space:nowrap;\r
  cursor:pointer; transition:background-color .12s ease, color .12s ease; }\r
.ict-btn:hover:not(:disabled) { background:var(--icn2-accent, #313235); }\r
.ict-btn:focus-visible { outline:none; box-shadow:0 0 0 1px var(--icn2-ring, #8a8a8a); }\r
.ict-btn:disabled { opacity:.5; cursor:not-allowed; pointer-events:none; }\r
.ict-btn--primary { background:var(--icn2-primary, #0b8ce9); }\r
.ict-btn--primary:hover:not(:disabled) { background:color-mix(in srgb, var(--icn2-primary, #0b8ce9) 90%, transparent); }\r
.ict-btn.is-active { background:var(--icn2-accent, #313235); color:var(--icn2-fg, #ffffff); }\r
/* Dialog footer = ConfirmFooter.vue: size lg + variant textonly / muted-textonly,\r
   the primary action keeps the filled --primary look. */\r
.ict-actions .ict-btn { height:40px; padding:0 16px; border-radius:var(--ic-radius, 12px);\r
  background:transparent; color:var(--icn2-muted, #8a8a8a); font-size:var(--text-sm, 14px); }\r
.ict-actions .ict-btn:hover:not(:disabled) { background:var(--icn2-accent, #313235); }\r
.ict-actions .ict-btn--primary { background:var(--icn2-primary, #0b8ce9); color:var(--foreground, #fff); }\r
.ict-actions .ict-btn--primary:hover:not(:disabled) { background:color-mix(in srgb, var(--icn2-primary, #0b8ce9) 90%, transparent); color:var(--foreground, #fff); }\r
/* Body copy = text-xs 12px / muted-foreground; micro copy = text-2xs 10px. */\r
.ict-hint { margin:8px 0 0; color:var(--icn2-muted, #8a8a8a); font-size:var(--text-xs, 12px); line-height:var(--text-base--line-height, 1.5); }\r
.ict-label { margin:0 0 6px; color:var(--icn2-muted, #8a8a8a); font-size:var(--text-xs, 12px); }\r
.ict-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }\r
.ict-summary { margin:0; font-size:var(--text-xs, 12px); color:var(--icn2-muted, #8a8a8a); }\r
.ict-chips { display:flex; flex-wrap:wrap; gap:4px; }\r
/* Chip = same box as the number field (h 24 / r6 / bg-input #313235 / 12px)\r
   so a chip row and a number row read as one system; selected goes one step\r
   brighter (--muted #3c3d42) plus a hairline ring. */\r
.ict-chip { display:inline-flex; align-items:center; justify-content:center; height:24px; padding:0 8px;\r
  box-sizing:border-box; border:0; border-radius:var(--icn2-r-md, 6px); background:var(--icn2-input, #313235);\r
  color:var(--icn2-fg, #ffffff); font-family:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-normal, 400); line-height:1;\r
  cursor:pointer; transition:background-color .12s ease, color .12s ease, box-shadow .12s ease; }\r
.ict-chip:hover { background:var(--icn2-mutedbg, #3c3d42); }\r
.ict-chip.is-active { background:var(--icn2-mutedbg, #3c3d42);\r
  box-shadow:inset 0 0 0 1px var(--icn2-ring, #8a8a8a); }\r
/* Crop ratio chips: equal-width grid so \u539F\u56FE / 16:9 / 21:9 etc. all align. */\r
.ict-ratios { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }\r
.ict-ratio { padding:0 4px; text-align:center; box-sizing:border-box; }\r
/* Nodes 2.0 WidgetInputBaseClass: not-disabled:bg-input (= --accent #313235),\r
   border-none, rounded-md (6px), text-foreground; height comes from\r
   useWidgetHeight() which defaults to h-6 (24px). */\r
.ict-input { height:24px; padding:0 8px; box-sizing:border-box; border:0;\r
  border-radius:var(--icn2-r-md, 6px); background:var(--icn2-input, #313235); color:var(--icn2-fg, #ffffff);\r
  font-family:inherit; font-size:var(--text-xs, 12px); line-height:1; }\r
.ict-input:focus { outline:none; box-shadow:0 0 0 1px var(--icn2-ring, #8a8a8a); }\r
/* Number field = ComfyUI ScrubableNumberInput (the Nodes 2.0 number widget):\r
   flex row h-6 overflow-hidden rounded-md bg-input, square aspect-square -/+\r
   buttons (variant muted-textonly, hover:bg-muted), left aligned 12px input\r
   with a ew-resize overlay that scrubs the value by drag and selects the text\r
   on a plain click. */\r
.ict-num { display:flex; overflow:hidden; height:24px; box-sizing:border-box;\r
  border-radius:var(--icn2-r-md, 6px); background:var(--icn2-input, #313235);\r
  color:var(--icn2-fg, #ffffff); font-size:var(--text-xs, 12px); }\r
.ict-num > button { flex:0 0 auto; width:24px; height:24px; display:inline-flex;\r
  align-items:center; justify-content:center; padding:0; border:0; border-radius:0;\r
  background:transparent; color:var(--icn2-muted, #8a8a8a); cursor:pointer;\r
  transition:background-color .12s ease; }\r
.ict-num > button:hover:not(:disabled) { background:var(--icn2-mutedbg, #3c3d42); }\r
.ict-num > button:disabled { opacity:.3; cursor:default; pointer-events:none; }\r
.ict-num > button svg, .ict-num > button i { display:block; width:16px; height:16px; }\r
.ict-num > .ict-num-cell { position:relative; flex:1 1 auto; min-width:4ch;\r
  margin:1px 0; padding:6px 0; }\r
.ict-num > .ict-num-cell > input { position:absolute; inset:0; width:100%; height:100%;\r
  margin:0; padding:4px; box-sizing:border-box; border:0; background:transparent;\r
  color:inherit; text-align:left; font-family:inherit; font-size:var(--text-xs, 12px); line-height:1;\r
  font-variant-numeric:tabular-nums; outline:none; }\r
.ict-num > .ict-num-cell > input::-webkit-outer-spin-button,\r
.ict-num > .ict-num-cell > input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }\r
.ict-num > .ict-num-cell > input[type=number] { -moz-appearance:textfield; }\r
.ict-num > .ict-num-cell > input:focus { box-shadow:none; outline:none; }\r
.ict-num > .ict-num-cell > .ict-num-swipe { position:absolute; inset:0; z-index:1;\r
  cursor:ew-resize; touch-action:pan-y; }\r
.ict-num.is-editing > .ict-num-cell > .ict-num-swipe { display:none; }\r
/* Widget row: slider + number field side by side, exactly like InputSlider.vue\r
   (Slider w-20 + FormNumberField w-32, flex items-center gap-2). */\r
.ict-slider-field { display:flex; align-items:center; gap:8px; }\r
.ict-slider-field input[type=range] { flex:1 1 auto; min-width:0; }\r
.ict-slider-field .ict-input { flex:0 0 auto; width:112px; }\r
/* ComfyUI ui/slider: 2px pill track (muted-foreground/20), --muted-foreground\r
   fill + 14px round thumb. --ict-p is painted from the current value. */\r
.ict-body input[type=range] { -webkit-appearance:none; appearance:none; width:100%;\r
  height:14px; margin:0; background:transparent; cursor:pointer; }\r
.ict-body input[type=range]::-webkit-slider-runnable-track { height:2px; border-radius:999px;\r
  background:linear-gradient(to right, var(--icn2-muted, #8a8a8a) 0 var(--ict-p, 0%),\r
    color-mix(in srgb, var(--muted-foreground, #8a8a8a) 20%, transparent) var(--ict-p, 0%) 100%); }\r
.ict-body input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px;\r
  margin-top:-6px; border:0; border-radius:50%; background:var(--icn2-muted, #8a8a8a);\r
  box-shadow:0 1px 2px color-mix(in srgb, var(--color-black) 35%, transparent); }\r
.ict-body input[type=range]:focus-visible { outline:none; }\r
.ict-body input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 2px color-mix(in srgb, var(--color-white) 22%, transparent); }\r
.ict-body input[type=range]::-moz-range-track { height:2px; border-radius:999px; background:color-mix(in srgb, var(--color-muted-foreground) 20%, transparent); }\r
.ict-body input[type=range]::-moz-range-progress { height:2px; border-radius:999px; background:var(--icn2-muted, #8a8a8a); }\r
.ict-body input[type=range]::-moz-range-thumb { width:14px; height:14px; border:0; border-radius:50%;\r
  background:var(--icn2-muted, #8a8a8a); }\r
.ict-split { display:grid; grid-template-columns:minmax(0,1fr) 240px; gap:14px; align-items:start; }\r
/* Media previews (image crop / grid crop / video crop) use square corners:\r
   the crop rectangle itself is square, so a rounded preview clipped the image. */\r
.ict-preview { display:flex; align-items:center; justify-content:center; min-height:220px;\r
  border-radius:0; background:var(--color-black); overflow:hidden; aspect-ratio:1; }\r
.ict-preview img { display:block; max-width:100%; max-height:100%; object-fit:contain; }\r
.ict-preview canvas { display:block; width:100%; height:100%; object-fit:contain; }\r
.ict-side { display:flex; flex-direction:column; gap:10px; }\r
.ict-crop-stage { position:relative; display:inline-block; line-height:0; max-width:100%; max-height:100%;\r
  background:var(--color-black); user-select:none; touch-action:none; overflow:hidden; }\r
.ict-crop-stage img { display:block; max-width:100%; pointer-events:none; }\r
.ict-crop-frame { position:absolute; box-sizing:border-box; border:1px solid var(--color-white);\r
  box-shadow:0 0 0 9999px color-mix(in srgb, var(--color-black) 55%, transparent); cursor:move; }\r
.ict-crop-frame::before { content:""; position:absolute; inset:0; pointer-events:none;\r
  background:linear-gradient(to right, transparent 33.2%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 33.2%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 33.5%, transparent 33.5%, transparent 66.4%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 66.4%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 66.7%, transparent 66.7%),\r
             linear-gradient(to bottom, transparent 33.2%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 33.2%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 33.5%, transparent 33.5%, transparent 66.4%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 66.4%, color-mix(in srgb, var(--color-white, #fff) 35%, transparent) 66.7%, transparent 66.7%); }\r
.ict-handle { position:absolute; width:9px; height:9px; border:1px solid var(--color-white); border-radius:2px;\r
  background:var(--ic-brand, #0b8ce9); }\r
.ict-h-nw { left:-5px; top:-5px; cursor:nwse-resize; } .ict-h-n { left:calc(50% - 5px); top:-5px; cursor:ns-resize; }\r
.ict-h-ne { right:-5px; top:-5px; cursor:nesw-resize; } .ict-h-e { right:-5px; top:calc(50% - 5px); cursor:ew-resize; }\r
.ict-h-se { right:-5px; bottom:-5px; cursor:nwse-resize; } .ict-h-s { left:calc(50% - 5px); bottom:-5px; cursor:ns-resize; }\r
.ict-h-sw { left:-5px; bottom:-5px; cursor:nesw-resize; } .ict-h-w { left:-5px; top:calc(50% - 5px); cursor:ew-resize; }\r
.ict-grid-overlay { position:absolute; inset:0; pointer-events:none; }\r
.ict-cell { position:absolute; box-sizing:border-box; border:1px dashed color-mix(in srgb, var(--color-white) 70%, transparent);\r
  color:var(--foreground, #fff); font-size:var(--text-xs, 12px); line-height:1; padding:3px; text-shadow:0 1px 3px var(--color-black, #000); }\r
.ict-4 { display:grid; grid-template-columns:1fr; gap:8px; }\r
.ict-4 label { display:flex; align-items:center; gap:6px; font-size:var(--text-xs, 12px);\r
  color:var(--icn2-muted, #8a8a8a); }\r
.ict-4 .ict-input { width:100%; min-width:0; }\r
.ict-adjust { display:grid; grid-template-columns:minmax(0,1fr) 240px; gap:14px; align-items:start; }\r
.ict-sliders { display:flex; flex-direction:column; gap:calc(var(--spacing, 4px) * 2); }\r
.ict-slider { display:grid; grid-template-columns:74px minmax(0,1fr) 44px; align-items:center; gap:8px;\r
  font-size:var(--text-xs, 12px); color:var(--icn2-muted, #8a8a8a); }\r
.ict-slider output { text-align:right; font-variant-numeric:tabular-nums; color:var(--icn2-fg, #ffffff); }\r
.ict-slider output.is-changed { color:var(--icn2-primary, #0b8ce9); }\r
.ict-wave { display:block; width:100%; height:150px; border-radius:var(--ic-radius, 12px); background:var(--color-charcoal-600, #232428); }\r
.ict-seg { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; align-items:center; margin-top:6px; }\r
.ict-seg .ict-input { width:100%; }\r
.ict-media-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }\r
.ict-time-row { display:grid; grid-template-columns:70px minmax(0,1fr) 70px; align-items:center; gap:8px; margin:10px 0; }\r
.ict-time-row input[type=range] { width:100%; }\r
.ict-list { max-height:190px; overflow:auto; display:flex; flex-direction:column; gap:6px; }\r
/* ---- backend readiness / progress / anchored menu (reference: core.createProbe,\r
   progressModal, xcat-ve-menu) ---- */\r
.ict-warn { margin:10px 16px 0; padding:9px 11px; border-radius:var(--ic-radius, 12px); font-size:var(--ic-ctrl-fs, 12px); line-height:1.6;\r
  border:1px solid var(--ic-danger, #b33a3a); background:var(--ic-danger-soft, rgba(179,58,58,.16));\r
  color:var(--ic-danger, #b33a3a); }\r
.ict-warn[hidden] { display:none; }\r
.ict-warn strong { font-weight:var(--font-weight-bold, 700); }\r
.ict-status.is-error { color:var(--ic-danger, #b33a3a); }\r
.ict-progress { min-width:320px; min-height:112px; display:flex; flex-direction:column;\r
  align-items:center; justify-content:center; gap:14px; }\r
.ict-spinner { width:28px; height:28px; box-sizing:border-box; border-radius:50%;\r
  border:3px solid color-mix(in srgb, var(--color-white) 18%, transparent); border-top-color:var(--ic-brand, #0b8ce9);\r
  animation:ict-spin .8s linear infinite; }\r
@keyframes ict-spin { to { transform:rotate(360deg); } }\r
.ict-progress-text { font-size:var(--ic-ctrl-fs, 12px); color:var(--ic-soft, #8a8a8a); }\r
/* ---- video trim: preview + 10 thumbs + two handles + ruler ---- */\r
.ict-video-preview { display:flex; justify-content:center; padding:8px; border-radius:0; background:var(--color-black); }\r
.ict-video-preview video { display:block; max-width:100%; max-height:280px; }\r
.ict-tl { margin-top:12px; }\r
.ict-tl-head { display:flex; justify-content:space-between; margin-bottom:6px; font-size:var(--text-xs, 12px);\r
  color:var(--icn2-muted, #8a8a8a); }\r
.ict-track { position:relative; height:64px; border:0;\r
  border-radius:var(--icn2-r-md, 6px); overflow:hidden; background:var(--color-neutral-900, #111); touch-action:none; user-select:none; cursor:pointer; }\r
.ict-strip { position:absolute; inset:0; display:flex; }\r
.ict-strip img { flex:1 1 0; width:0; min-width:0; height:100%; object-fit:cover; opacity:.85; }\r
.ict-strip i { flex:1 1 0; background:var(--ic-panel, #262729); }\r
.ict-tl-mask { position:absolute; top:0; bottom:0; background:color-mix(in srgb, var(--color-black) 60%, transparent); pointer-events:none; }\r
.ict-tl-sel { position:absolute; top:0; bottom:0; box-sizing:border-box; border:1px solid var(--ic-brand, #0b8ce9);\r
  pointer-events:none; }\r
.ict-tl-playhead { position:absolute; top:0; bottom:0; width:2px; background:var(--color-white); pointer-events:none; }\r
.ict-tl-handle { position:absolute; top:0; bottom:0; width:12px; margin-left:-6px; padding:0; border:0;\r
  background:transparent; cursor:ew-resize; z-index:2; }\r
.ict-tl-handle span { position:absolute; top:50%; left:2px; width:8px; height:26px;\r
  transform:translateY(-50%); border-radius:4px; background:var(--ic-brand, #0b8ce9); border:1px solid var(--color-white); }\r
.ict-tl-ruler { display:flex; justify-content:space-between; margin-top:5px; font-size:var(--text-2xs, 10px);\r
  font-variant-numeric:tabular-nums; color:var(--icn2-muted, #8a8a8a); }\r
.ict-times { display:flex; gap:12px; align-items:center; margin-top:12px; font-size:var(--text-xs, 12px);\r
  color:var(--icn2-muted, #8a8a8a); }\r
.ict-times label { display:flex; align-items:center; gap:6px; }\r
.ict-times .ict-input { width:112px; }\r
.ict-times .ict-length { margin-left:auto; }\r
/* ---- audio clip: waveform + segment editor ---- */\r
.ict-clip-tl { position:relative; }\r
.ict-clip-stage { position:relative; }\r
.ict-clip-wave { display:block; width:100%; height:120px; border-radius:var(--ic-radius, 12px) 8px 0 0; background:var(--color-charcoal-600, #232428); }\r
.ict-clip-ruler { position:relative; height:16px; font-size:var(--text-2xs, 10px); line-height:16px;\r
  color:var(--icn2-muted, #8a8a8a); font-variant-numeric:tabular-nums; }\r
.ict-clip-ruler span { position:absolute; transform:translateX(-50%); }\r
/* End labels stay inside the frame instead of hanging over the padding. */\r
.ict-clip-ruler span:first-child { transform:none; }\r
.ict-clip-ruler span:last-child { transform:translateX(-100%); }\r
.ict-clip-track { position:relative; height:34px; border-radius:0 0 6px 6px;\r
  background:color-mix(in srgb, var(--color-white) 5%, transparent); overflow:hidden; }\r
/* Segment buttons follow the same Nodes 2.0 secondary contract: flat #262729\r
   chip, hover --accent, selected = filled --primary. */\r
.ict-clip-seg { position:absolute; top:3px; bottom:3px; box-sizing:border-box; border:0;\r
  border-radius:var(--icn2-r, 4px); background:var(--icn2-secondary, #262729);\r
  color:var(--icn2-muted, #8a8a8a); font-family:inherit; font-size:var(--text-2xs, 10px); font-weight:var(--font-weight-medium, 500);\r
  padding:0 6px; overflow:hidden; text-align:left; white-space:nowrap; text-overflow:ellipsis;\r
  cursor:pointer; transition:background-color .12s ease, color .12s ease; }\r
.ict-clip-seg:hover { background:var(--icn2-accent, #313235); color:var(--icn2-fg, #ffffff); }\r
.ict-clip-seg.is-selected { background:var(--icn2-primary, #0b8ce9); color:var(--foreground, #fff); }\r
/* The white playhead line is itself the drag handle: hovering it shows the\r
   left/right arrows (ew-resize), pressing and dragging it scrubs the playhead\r
   along the waveform \u2014 exactly like the reference clip editor. */\r
.ict-clip-head { position:absolute; top:0; bottom:0; width:2px; background:var(--color-white);\r
  pointer-events:auto; cursor:ew-resize; z-index:3; }\r
.ict-clip-head::after { content:""; position:absolute; left:-7px; right:-7px; top:-2px; bottom:-2px; }\r
.ict-clip-head::before { content:"\\u2039  \\u203A"; position:absolute; top:2px; left:50%;\r
  transform:translateX(-50%); background:var(--color-white); color:var(--color-neutral-900, #111); font-size:var(--text-2xs, 10px); line-height:14px;\r
  padding:0 5px; border-radius:var(--ic-ctrl-r, 8px); white-space:nowrap; opacity:0; pointer-events:none;\r
  transition:opacity .1s ease; }\r
.ict-clip-head:hover::before, .ict-clip-head.dragging::before,\r
.ict-clip-stage.is-scrubbing .ict-clip-head::before { opacity:1; }\r
.ict-clip-stage.is-scrubbing { cursor:ew-resize; }\r
.ict-toolrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px; }\r
.ict-toolrow .ict-sep { width:1px; height:20px; background:var(--ic-line, #494a50); }\r
.ict-toolrow .ict-hint { margin:0 0 0 auto; font-size:var(--text-2xs, 10px); }\r
.ict-player { display:flex; align-items:center; gap:10px; margin-top:10px; font-size:var(--text-xs, 12px); }\r
.ict-player .ict-play { width:32px; padding:0; font-size:var(--text-xs, 12px); }\r
.ict-player time { font-variant-numeric:tabular-nums; color:var(--icn2-muted, #8a8a8a); }\r
.ict-player time b { color:var(--icn2-fg, #ffffff); font-weight:var(--font-weight-medium, 500); }\r
.ict-player .ict-hint { margin:0; }\r
/* ---- grid presets / mirror buttons ---- */\r
/* Tile / list buttons: secondary surface #262729, hover --accent #313235,\r
   selected = accent + 1px --ring inset (ComfyUI toggle group look). */\r
.ict-grid-presets { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }\r
.ict-grid-preset { display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px;\r
  border:0; border-radius:var(--icn2-r-md, 6px); background:transparent;\r
  color:var(--icn2-muted, #8a8a8a); font-family:inherit; font-size:var(--text-xs, 12px); cursor:pointer;\r
  transition:background-color .12s ease, color .12s ease; }\r
.ict-grid-preset:hover { background:color-mix(in srgb, var(--color-charcoal-600) 50%, transparent); color:var(--icn2-fg, #ffffff); }\r
.ict-grid-preset.is-active { background:var(--icn2-secondary, #262729); color:var(--icn2-fg, #ffffff); }\r
.ict-grid-preset i { display:grid; gap:2px; width:30px; height:30px; }\r
.ict-grid-preset i b { border-radius:1px; background:currentColor; opacity:.7; }\r
.ict-grid-custom-btn { display:flex; align-items:center; justify-content:center; width:100%; height:32px; margin-top:8px;\r
  border:0; border-radius:8px; background:var(--icn2-secondary, #262729);\r
  color:var(--icn2-fg, #ffffff); font-family:inherit; font-size:var(--text-xs, 12px); font-weight:var(--font-weight-medium, 500); cursor:pointer;\r
  transition:background-color .12s ease, color .12s ease; }\r
.ict-grid-custom-btn:hover { background:var(--icn2-accent, #313235); }\r
.ict-grid-custom-btn.is-active { background:var(--icn2-accent, #313235); }\r
.ict-grid-custom { display:flex; flex-direction:column; gap:10px; margin-top:10px; }\r
.ict-grid-custom[hidden] { display:none; }\r
.ict-grid-slider-row { display:grid; grid-template-columns:32px minmax(0,1fr) 22px; align-items:center; gap:8px;\r
  font-size:var(--text-xs, 12px); color:var(--icn2-muted, #8a8a8a); }\r
.ict-grid-slider-row input[type=range] { width:100%; }\r
.ict-grid-slider-row output { text-align:center; font-variant-numeric:tabular-nums; color:var(--icn2-fg, #ffffff); }\r
.ict-mirror-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; }\r
.ict-mirror-btn { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px;\r
  box-sizing:border-box; border:0; border-radius:var(--icn2-r-md, 6px); background:var(--icn2-secondary, #262729);\r
  color:var(--icn2-fg, #ffffff); font-family:inherit; font-size:var(--text-xs, 12px); cursor:pointer; text-align:left;\r
  transition:background-color .12s ease; }\r
.ict-mirror-btn:hover, .ict-mirror-btn:focus-visible { background:var(--icn2-accent, #313235); outline:none; }\r
.ict-mirror-btn.is-wide { grid-column:span 2; }\r
.ict-mirror-btn svg, .ict-mirror-btn i { flex:0 0 auto; }\r
.ict-mirror-preview img { max-height:100%; transition:transform .15s ease; }\r
/* Scene split: shot cards grid, selection via .is-selected (icon toggled in JS). */\r
.ict-scene-status { margin:0 0 8px; color:var(--icn2-fg, #ffffff); font-size:var(--text-sm, 14px); }\r
.ict-scene-count { margin:0 0 10px; color:var(--icn2-muted, #8a8a8a); font-size:var(--text-xs, 12px); }\r
.ict-scene-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px; }\r
.ict-scene-grid[hidden] { display:none; }\r
.ict-scene-card { position:relative; display:flex; flex-direction:column; overflow:hidden; padding:0;\r
  box-sizing:border-box; border:1px solid var(--ic-line, #494a50); border-radius:var(--icn2-r-md, 6px);\r
  background:var(--icn2-secondary, #262729); color:var(--icn2-fg, #ffffff);\r
  font-family:inherit; text-align:left; cursor:pointer; transition:border-color .12s ease, background-color .12s ease; }\r
.ict-scene-card:hover, .ict-scene-card:focus-visible { outline:none; border-color:var(--icn2-ring, #8a8a8a); }\r
.ict-scene-card.is-selected { border-color:var(--icn2-primary, #0b8ce9); }\r
.ict-scene-thumb { display:block; width:100%; aspect-ratio:16 / 9; background:var(--icn2-accent, #313235); }\r
.ict-scene-thumb img { display:block; width:100%; height:100%; object-fit:cover; }\r
.ict-scene-meta { display:flex; flex-direction:column; gap:2px; padding:6px 8px 8px;\r
  font-size:var(--text-xs, 12px); }\r
.ict-scene-meta b { color:var(--icn2-primary, #0b8ce9); }\r
.ict-scene-meta span { color:var(--icn2-fg, #ffffff); font-variant-numeric:tabular-nums; }\r
.ict-scene-meta small { color:var(--icn2-muted, #8a8a8a); font-size:var(--text-2xs, 10px); }\r
.ict-scene-check { position:absolute; top:6px; right:6px; width:22px; height:22px;\r
  display:flex; align-items:center; justify-content:center; border-radius:var(--icn2-r, 4px);\r
  background:color-mix(in srgb, var(--color-black) 60%, transparent); color:var(--icn2-fg, #ffffff); }\r
.ict-scene-card.is-selected .ict-scene-check { background:var(--icn2-primary, #0b8ce9); color:var(--foreground, #fff); }\r
.ict-lut-block { margin-top:2px; padding-top:12px; border-top:1px solid var(--ic-line, #494a50);\r
  display:flex; flex-direction:column; gap:8px; }\r
.ict-lut-file { display:flex; align-items:center; gap:6px; }\r
.ict-lut-file input[type=file] { display:none; }\r
.ict-lut-name { margin:0; font-size:var(--text-xs, 12px); color:var(--icn2-fg, #ffffff); overflow-wrap:anywhere; }\r
.ict-lut-name.is-empty { color:var(--icn2-muted, #8a8a8a); }\r
.ict-lut-strength { display:grid; grid-template-columns:40px minmax(0,1fr) 40px; align-items:center;\r
  gap:8px; font-size:var(--text-xs, 12px); color:var(--icn2-muted, #8a8a8a); }\r
.ict-lut-strength input[type=range] { width:100%; }\r
.ict-lut-strength output { text-align:right; font-variant-numeric:tabular-nums; color:var(--icn2-fg, #ffffff); }\r
.ict-lut-detail { display:flex; flex-direction:column; gap:8px; }\r
.ict-lut-detail[hidden] { display:none; }\r
`;

// ../../web/canvas/css/infcanvas-api-config.css
var infcanvas_api_config_default = `\r
/* The dialog shell is composed from the host's own class strings\r
   (BaseModalLayout: rounded-2xl / bg-background, bg-card left panel, h-18\r
   headers; NavItem; buttonVariants), so nothing below re-draws a surface.\r
   What remains is the graph-preview canvas and the overlay masks, which have\r
   no host equivalent. */\r
.ac-config, .ac-config * { box-sizing:border-box; }\r
.ac-config { display:flex; height:100%; min-height:0; }\r
/* The host sheet does NOT make [hidden] win over a utility like .flex (it lost\r
   to inline-flex on the save button and to .flex on the field mask), so the\r
   attribute is restored here for the whole dialog. */\r
.ac-host [hidden], .ac-config [hidden] { display:none !important; }\r
/* Category dropdown. The panel's sections clip their children, so the menu is\r
   position:fixed and placed from the trigger rect (same trick as the widget\r
   dropdown in infcanvas-flow.js). Skin now follows ComfyUI settings'\r
   selectContentClass (see SELECT_CONTENT), with the height cap on an inner\r
   viewport like the native SelectViewport. */\r
.ac-catmenu { position:fixed; z-index:10005; }\r
.ac-catviewport { max-height:min(60vh, 460px); overflow-y:auto; }\r
\r
/* ---------------- graph preview ---------------- */\r
.ac-preview { position:relative; flex:1 1 auto; min-height:0; overflow:hidden; }\r
.ac-viewport { position:absolute; inset:0; overflow:hidden; cursor:grab;\r
  background-color:var(--background, #0F0F0F);\r
  background-image:radial-gradient(color-mix(in srgb, var(--color-white, #fff) 7%, transparent) 1px, transparent 1px);\r
  background-size:18px 18px; }\r
.ac-viewport.is-panning { cursor:grabbing; }\r
/* No will-change here: promoting the scaled scene to a compositor layer makes\r
   the browser rasterise text at 1x then stretch it, so zoomed nodes look\r
   blurry. Without it, text is re-rasterised at the current scale. */\r
.ac-scene { position:absolute; left:0; top:0; transform-origin:0 0; }\r
.ac-edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; z-index:0; }\r
.ac-edge { fill:none; stroke:var(--muted-foreground, #8a8a8a); stroke-width:1.2; opacity:.55; }\r
.ac-node { position:absolute; z-index:1; width:168px; padding:6px 9px;\r
  border:1px solid hsl(var(--n-hue) 42% 55% / .55); border-radius:6px;\r
  background:var(--card, #262729); box-shadow:0 4px 12px color-mix(in srgb, var(--color-black) 45%, transparent);\r
  cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease; }\r
.ac-node:hover { border-color:hsl(var(--n-hue) 55% 70%); }\r
/* Configured nodes: just a thicker white edge; no glow. Unconfigured nodes\r
   keep their original type hue. */\r
.ac-node.is-configurable { border:2px solid var(--foreground, #ffffff); }\r
.ac-node.is-configurable:hover { border-color:var(--foreground, #ffffff); }\r
/* Field\u2192node spotlight: the node owning the selected field gets a primary\r
   ring + glow so it is unmistakable in the graph. Only the border/ring colour\r
   is added; token-driven so it follows the active ComfyUI theme. */\r
.ac-node.is-spotlight { border:2px solid var(--primary, #0b8ce9); z-index:2;\r
  box-shadow:0 0 0 3px color-mix(in oklab, var(--primary, #0b8ce9) 45%, transparent), 0 4px 16px color-mix(in srgb, var(--color-black, #000) 50%, transparent); }\r
.ac-node.is-spotlight:hover { border-color:var(--primary, #0b8ce9); }\r
.ac-node-title { display:flex; align-items:baseline; justify-content:space-between; gap:6px;\r
  font-size:var(--text-xs, 12px); font-weight:var(--font-weight-semibold, 600); color:var(--text-color, #fff); white-space:nowrap; overflow:hidden; }\r
/* Long node names / type names ellipsise instead of being hard-cut, so the\r
   trailing #id and the exposed-count badge stay fully visible. */\r
.ac-node-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\r
.ac-node-id { flex:0 0 auto; font-weight:var(--font-weight-normal, 400); font-size:var(--text-2xs, 10px); color:hsl(var(--n-hue) 55% 72%); }\r
.ac-node-type { display:flex; align-items:center; gap:4px; margin-top:2px; font-size:var(--text-2xs, 10px);\r
  color:var(--muted-foreground, #8a8a8a); white-space:nowrap; overflow:hidden; }\r
.ac-node-count { margin-left:auto; flex:0 0 auto; color:var(--primary, #0b8ce9); }\r
/* Option B: "N \u5DF2\u7528" as a solid blue pill with white text. */\r
.ac-exposed { display:inline-flex; align-items:center; padding:0 5px; border-radius:9999px;\r
  background:var(--primary, #0b8ce9); color:var(--foreground, #ffffff); font-size:var(--text-2xs, 10px);\r
  font-weight:var(--font-weight-semibold, 600); line-height:14px; }\r
.ac-handle { position:absolute; top:50%; width:6px; height:6px; margin-top:-3px; border-radius:50%;\r
  background:hsl(var(--n-hue) 45% 60% / .7); }\r
.ac-handle--in { left:-4px; }\r
.ac-handle--out { right:-4px; }\r
.ac-empty { position:absolute; inset:0; display:grid; place-items:center; font-size:var(--text-xs, 12px);\r
  color:var(--muted-foreground, #8a8a8a); pointer-events:none; }\r
.ac-empty.is-tip { inset:auto 0 14px; font-size:var(--text-xs, 12px); }\r
/* Drag feedback only: the resting look of a row is NavItem's own class string. */\r
.ac-item.is-dragging { opacity:.45; }\r
.ac-item.is-drop { box-shadow:inset 0 0 0 1px var(--primary, #0b8ce9); }\r
\r
/* ---------------- exposed-parameter order panel ---------------- */\r
/* Right-hand API \u53C2\u6570 panel. The card shell is built from the host's OWN\r
   utility classes below (rounded-xl / border / bg-card / shadow-sm), not from\r
   the node popover's private .icn__gpa skin \u2014 so it reads as a native ComfyUI\r
   card. Only the grid rows keep their host utility classes; no custom skin. */\r
.ac-params { display:flex; flex-direction:column; flex:0 0 348px; min-height:0; gap:10px;\r
  overflow-y:auto; }\r
.ac-params .icn__gpa-inputs { margin-bottom:0; flex:0 0 auto; }\r
/* Prompt textarea keeps the host's OWN node textarea class (comfy-multiline-input)\r
   for font/size/bg. A standalone textarea needs its own rounded border + padding\r
   (in-node it borrows the widget container's); draw those with host tokens only\r
   so it matches a native ComfyUI input box instead of a bare flush edge. */\r
.ac-params .ac-prompt-area { box-sizing:border-box; width:100%; min-height:64px; field-sizing:content;\r
  border:1px solid var(--border); border-radius:var(--radius-md, 6px); padding:8px;\r
  font-family:inherit; font-size:var(--text-xs, 12px); line-height:1.55; }\r
.ac-params .ac-prompt-area:hover { border-color:var(--muted-foreground); }\r
.ac-params-list { position:relative; min-height:0; }\r
/* Drag feedback + grip. The grip keeps its 12px column even when hidden so the\r
   rows line up with the native WidgetGrid (which has an empty w-3 first cell). */\r
.ac-prow-grip { display:flex; visibility:hidden; align-items:center; justify-content:center;\r
  width:12px; color:var(--muted-foreground, #8a8a8a); cursor:grab; }\r
.ac-params.is-sorting .ac-prow-grip { visibility:visible; }\r
.ac-params.is-sorting .ac-prow { cursor:grab; }\r
.ac-prow.is-dragging { opacity:.45; }\r
.ac-prow.is-drop { box-shadow:inset 0 0 0 1px var(--primary, #0b8ce9); }\r
/* Selected field row: subtle primary tint + left marker, mirroring the node\r
   ring so the two ends of the mapping read as one selection. */\r
.ac-prow.is-spotlight, .ac-prompt-row.is-spotlight {\r
  background:color-mix(in oklab, var(--primary, #0b8ce9) 12%, transparent);\r
  box-shadow:inset 2px 0 0 var(--primary, #0b8ce9); }\r
.ac-prow, .ac-prompt-row { cursor:pointer; }\r
/* Standalone text boxes reorder alongside the card rows. The grip column is\r
   reserved even when hidden so boxes don't shift when sort mode toggles. */\r
.ac-prompt-row { display:flex; align-items:stretch; gap:0; }\r
.ac-prompt-row > .icn__gpa-box { flex:1; min-width:0; }\r
.ac-params.is-sorting .ac-prompt-row { cursor:grab; }\r
.ac-prompt-row.is-dragging { opacity:.45; }\r
.ac-prompt-row.is-drop .icn__gpa-box { box-shadow:inset 0 0 0 1px var(--primary, #0b8ce9); }\r
/* Widget popups (field dropdown / value-control chooser). Skin is the node's\r
   OWN listbox / chooser (icn__gpa-fsel / icn__gpa-modes, see infcanvas-flow.js)\r
   so the menus are pixel-identical. Only re-anchored to the viewport because\r
   the API \u53C2\u6570 card scrolls and would clip an in-flow menu. */\r
.ac-widget-menu { position:fixed !important; z-index:10006 !important; }\r
.icn__gpa-fsel.ac-widget-menu { display:flex; flex-direction:column; overflow:hidden;\r
  text-align:left; border-radius:8px; background:var(--card, #262729);\r
  border:1px solid var(--border, #494a50); box-shadow:0 10px 30px color-mix(in srgb, var(--color-black) 55%, transparent); }\r
.icn__gpa-fsel.ac-widget-menu > .icn__sel-search { margin:5px 5px 4px; }\r
.icn__sel-search { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:6px;\r
  flex:0 0 auto; height:28px; padding:0 8px; border-radius:6px;\r
  background:var(--muted, #3c3d42); color:var(--ic-soft, #8a8a8a); }\r
.icn__sel-searchinput { flex:1 1 auto; min-width:0; height:100%; padding:0; border:0; outline:none;\r
  background:transparent; color:var(--ic-text, #ffffff); font:inherit; font-size:var(--text-xs, 12px); }\r
.icn__sel-searchinput::placeholder { color:var(--ic-soft, #8a8a8a); }\r
.icn__gpa-modes.ac-widget-menu { overflow:hidden; text-align:left; border-radius:10px;\r
  background:var(--card, #262729); border:1px solid var(--border, #494a50);\r
  box-shadow:0 10px 30px color-mix(in srgb, var(--color-black) 55%, transparent); }\r
`;

// ../../web/canvas/css/infcanvas-control-panel.css
var infcanvas_control_panel_default = '\r\n.__XCAT_CP_P__ { box-sizing: border-box; font-family: inherit; font-size:var(--text-xs, 12px); line-height: 1.45;\r\n  color: var(--node-component-slot-text, #d8d8d8);\r\n  padding: __XCAT_CP_LIST_PAD__px; user-select: none; overflow: hidden; }\r\n.__XCAT_CP_P__ * { box-sizing: border-box; }\r\n.__XCAT_CP_P__-list { overflow: visible; }\r\n.__XCAT_CP_P__-row { position: relative; display: flex; align-items: center; gap: 10px;\r\n  height: __XCAT_CP_ROW_H__px; padding: 0 8px 0 15px; border-radius: 6px; cursor: pointer;\r\n  transition: background .12s ease; }\r\n.__XCAT_CP_P__-row::before { content: ""; position: absolute; left: 6px; top: 50%;\r\n  transform: translateY(-50%); width: 3px; height: 12px; border-radius: 2px;\r\n  background: var(--__XCAT_CP_P__-tint, transparent); }\r\n.__XCAT_CP_P__-row:hover { background: var(--node-component-surface-hovered, #2b2b2b); }\r\n.__XCAT_CP_P__-name { flex: 1 1 auto; overflow: hidden; white-space: nowrap;\r\n  text-overflow: ellipsis; font-size:var(--text-xs, 12px); }\r\n.__XCAT_CP_P__-row.off .__XCAT_CP_P__-name { color: var(--p-text-muted-color, #8a8a8a); }\r\n.__XCAT_CP_P__-sw { position: relative; flex: 0 0 auto; width: 32px; height: 18px;\r\n  border-radius: 999px; background: var(--node-component-border, #4a4a4a);\r\n  border: 1px solid var(--node-component-border, #4a4a4a);\r\n  transition: background .15s ease, border-color .15s ease; }\r\n.__XCAT_CP_P__-sw i { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;\r\n  border-radius: 50%; background: var(--node-component-slot-text, #e6e6e6);\r\n  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-black) 35%, transparent); transition: transform .15s ease; }\r\n.__XCAT_CP_P__-sw.on { background: var(--p-primary-color, #6d9dc5);\r\n  border-color: var(--p-primary-color, #6d9dc5); }\r\n.__XCAT_CP_P__-sw.on i { transform: translateX(14px); background: var(--color-white); }\r\n.__XCAT_CP_P__-foot { display: flex; justify-content: center; align-items: center;\r\n  height: __XCAT_CP_FOOT_H__px; margin-top: 4px; padding-top: 6px;\r\n  border-top: 1px solid var(--node-divider, #303030); }\r\n.__XCAT_CP_P__-gear { width: 100%; height: 26px; display: flex; align-items: center;\r\n  justify-content: center; gap: 6px; border-radius: 6px; cursor: pointer;\r\n  font-family: inherit; font-size:var(--text-xs, 12px);\r\n  background: var(--button-surface, #262626);\r\n  color: var(--button-surface-contrast, #ccc);\r\n  border: 1px solid var(--border-default, #3f3f3f);\r\n  transition: background .12s ease, border-color .12s ease; }\r\n.__XCAT_CP_P__-gear:hover { background: var(--button-hover-surface, #303030); }\r\n.__XCAT_CP_P__-gear:active { background: var(--button-active-surface, #3a3a3a); }\r\n.__XCAT_CP_P__-empty { padding: 10px; text-align: center; color: var(--p-text-muted-color, #777); }\r\n.__XCAT_CP_P__-hint { margin: -6px 0 10px; font-size:var(--text-xs, 12px);\r\n  color: var(--p-text-muted-color, #8a8a8a); }\r\n.__XCAT_CP_P__-mask { position: fixed; inset: 0; z-index: 100000; backdrop-filter: blur(2px);\r\n  background: color-mix(in srgb, var(--color-black) 55%, transparent); }\r\n.__XCAT_CP_P__-panel { position: fixed; z-index: 100001; left: 50%; top: 50%;\r\n  transform: translate(-50%, -50%); width: 340px; max-height: 86vh; overflow-y: auto;\r\n  padding: 16px; border-radius: 12px; background: var(--dialog-surface, #1f1f1f);\r\n  border: 1px solid var(--border-default, #3d3d3d);\r\n  box-shadow: 0 16px 48px color-mix(in srgb, var(--color-black) 50%, transparent); color: var(--p-text-color, #ddd);\r\n  font-family: inherit; font-size:var(--text-xs, 12px); line-height: 1.5; }\r\n.__XCAT_CP_P__-panel h3 { margin: 0 0 12px; font-size:var(--text-sm, 14px); font-weight: 600;\r\n  color: var(--p-text-color, #fff); }\r\n.__XCAT_CP_P__-field { margin-bottom: 12px; }\r\n.__XCAT_CP_P__-field > span { display: block; margin-bottom: 6px; font-size:var(--text-xs, 12px);\r\n  color: var(--p-text-muted-color, #9a9a9a); }\r\n.__XCAT_CP_P__-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }\r\n.__XCAT_CP_P__-segbtn { padding: 5px 0; border-radius: 6px; cursor: pointer;\r\n  font-family: inherit; font-size:var(--text-xs, 12px);\r\n  background: var(--button-surface, #262626);\r\n  color: var(--button-surface-contrast, #bbb);\r\n  border: 1px solid var(--border-default, #3f3f3f);\r\n  transition: background .12s ease, color .12s ease, border-color .12s ease; }\r\n.__XCAT_CP_P__-segbtn:hover { background: var(--button-hover-surface, #303030); }\r\n.__XCAT_CP_P__-segbtn.sel { background: var(--p-primary-color, #3b5a75);\r\n  border-color: var(--p-primary-color, #3b5a75); color:var(--foreground, #fff); }\r\n.__XCAT_CP_P__-input { width: 100%; padding: 6px 8px; border-radius: 6px; outline: none;\r\n  font-family: inherit; font-size:var(--text-xs, 12px);\r\n  background: var(--node-component-widget-input-surface, #141414);\r\n  color: var(--p-text-color, #ddd);\r\n  border: 1px solid var(--p-form-field-border-color, #3f3f3f); }\r\n.__XCAT_CP_P__-input:focus { border-color: var(--p-primary-color, #4d7ea1);\r\n  box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #4d7ea1) 30%, transparent); }\r\n.__XCAT_CP_P__-swatches { display: flex; flex-wrap: wrap; gap: 8px; }\r\n.__XCAT_CP_P__-swatch { width: 22px; height: 22px; border-radius: 50%; cursor: pointer;\r\n  border: 1px solid var(--border-default, #3f3f3f); transition: transform .1s ease; }\r\n.__XCAT_CP_P__-swatch:hover { transform: scale(1.08); }\r\n.__XCAT_CP_P__-swatch.sel { outline: 2px solid var(--p-primary-color, #6d9dc5); outline-offset: 2px; }\r\n.__XCAT_CP_P__-none { color: var(--p-text-muted-color, #777); }\r\n.__XCAT_CP_P__-actions { display: flex; gap: 8px; margin-top: 16px; }\r\n.__XCAT_CP_P__-actions button { flex: 1 1 0; padding: 7px 0; border-radius: 6px; cursor: pointer;\r\n  font-family: inherit; font-size:var(--text-xs, 12px);\r\n  border: 1px solid var(--border-default, #3f3f3f);\r\n  background: var(--button-surface, #262626);\r\n  color: var(--button-surface-contrast, #ccc); }\r\n.__XCAT_CP_P__-actions button:hover { background: var(--button-hover-surface, #303030); }\r\n.__XCAT_CP_P__-actions button.primary { background: var(--p-primary-color, #3b5a75);\r\n  border-color: var(--p-primary-color, #3b5a75); color:var(--foreground, #fff); }\r\n';

// style-entry.js
var CSS = [infcanvas_isolation_default, infcanvas_tokens_default, infcanvas_layout_default, infcanvas_panels_default, infcanvas_overlays_default, infcanvas_lora_default, infcanvas_console_default].join("\n");
var CSS_VUEFLOW = infcanvas_vueflow_default;
var CSS_GALLERY = infcanvas_gallery_default;
var CSS_TOOLS = infcanvas_tools_default;
var CSS_API_CONFIG = infcanvas_api_config_default;
var CSS_CONTROL_PANEL = infcanvas_control_panel_default;
(() => {
  const NS = window.InfCanvas = window.InfCanvas || {};
  NS.css = CSS;
})();
export {
  CSS_API_CONFIG,
  CSS_CONTROL_PANEL,
  CSS_GALLERY,
  CSS_TOOLS,
  CSS_VUEFLOW
};
