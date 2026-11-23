/* API 配置弹窗.

   A 1:1 port of the reference project's "工作流配置" dialog:
     frontend/src/components/dialogs/WorkflowConfig.vue
     frontend/src/components/FloatingWindow/index.vue
     frontend/src/components/WorkflowPreview/index.vue
     frontend/src/components/WorkflowPreview/PreviewNode.vue
     frontend/src/components/WorkflowPreview/NodeFields.vue

   The rail entry (labelled "API", see infcanvas-ui.js) opens this dialog;
   the dialog title is "api.apiConfig" (renamed from 工作流配置 as requested).
   The reference gates its "COMFYUI 后端地址" input behind import.meta.env.DEV
   (WorkflowConfig.vue: showAddress); this build ships INSIDE ComfyUI, so that
   dev-only field is intentionally omitted - every request already goes to the
   current ComfyUI server. All shipped features are kept: drag-to-reorder
   workflow list, multi-file upload with API-format validation, delete, message toast,
   "N 个节点 · 已暴露 M 个字段" head, save/delete actions, a zoomable node-graph
   preview with a fit button, click-a-node field inspector (all 11 field types,
   select options, number ranges, media notes), field persistence into
   <name>.fields.json, and the workflows-changed event that refreshes the
   workflow selector inside every generate node.

   The shell is NS.tools.openModal (mounts inside #infcanvas-root, swallows
   canvas gestures, Escape to close, NS.tools.isOpen() guards core.js).
   The graph preview is plain DOM + SVG rather than a second VueFlow app: the
   layout algorithm, hue mapping, node card and zoom controls are ported
   verbatim from WorkflowPreview/PreviewNode. */
import { CSS_API_CONFIG as CSS } from "./infcanvas-style.js";
import {
  detectFields as detectFieldsCore, refreshDefs as refreshDefsCore,
  apiNodes, isApiWorkflow, hueOf, guessType, toNum, clampZoom,
  fieldKey, defaultAdvanced,
} from "./infcanvas-api-config-detect.js";
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* Native ComfyUI tooltip (shared engine in native-tip.js) — replaces every
     `el.title = ...` with the host's themed Reka tooltip. */
  const bindTip = (el, text, side) => {
    if (!el) return el;
    if (NS.tip?.bindTip) return NS.tip.bindTip(el, text, side);
    return el; // native-tip.js is always installed; no browser title fallback
  };
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* Category display: normalise legacy backend names, then translate. */
  const cat = (name) => (NS.i18n?.cat ? NS.i18n.cat(name) : t(name || "api.uncategorized"));


  /* --------------------------- constants --------------------------- */

  /* This module loads BEFORE infcanvas-i18n.js, so t() at module scope would
     freeze every label to Chinese. Keep the Chinese source keys here and
     translate at the render site (and again on language change). The first
     element of each pair is the stored type identifier and stays as-is. */
  const TYPE_OPTIONS = [
    ["text", "field.text"], ["textarea", "field.multilineText"], ["number", "field.number"], ["slider", "field.slider"],
    ["select", "field.dropdown"], ["switch", "field.toggle"], ["image", "field.imageSingle"],
    ["image_list", "field.imageList"], ["audio", "field.audio"], ["video", "field.video"], ["random", "field.random"],
  ];
  const MEDIA_LABELS = {
    image: "field.firstImage", image_list: "field.allImagesUpstreamFirstSelf",
    audio: "field.firstAudio", video: "field.firstVideo",
  };
  /* WorkflowPreview/index.vue */
  const COL_STEP = 220, ROW_STEP = 62;
  /* PreviewNode.vue */
  const NODE_W = 168, NODE_H = 42;
  const MIN_ZOOM = 0.2, MAX_ZOOM = 2;

  let injected = false;
  function injectStyles() {
    if (injected) return;
    const style = document.createElement("style");
    style.dataset.owner = "infcanvas-api-config";
    style.textContent = CSS;
    document.head.appendChild(style);
    injected = true;
  }

  /* ----------------------------- helpers ----------------------------- */

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  /* Native ComfyUI icons: host prebuilt sheet ships 257 lucide glyphs; every
     icon here is a host icon-[lucide--*] class, so glyph/size/colour all live
     on host tokens. `grip` uses lucide grip-vertical (2x3 dots, the closest
     host match to the old filled 6-dot WidgetGrid handle). Category text /
     file-question glyphs likewise use the closest host equivalents below. */
  const ICO = {
    minus: '<i class="icon-[lucide--minus] size-4" aria-hidden="true"></i>',
    plus: '<i class="icon-[lucide--plus] size-4" aria-hidden="true"></i>',
    chevron: '<i class="icon-[lucide--chevron-down] size-4" aria-hidden="true"></i>',
    shuffle: '<i class="icon-[lucide--shuffle] size-4" aria-hidden="true"></i>',
    grip: '<i class="icon-[lucide--grip-vertical] size-3.5" aria-hidden="true"></i>',
    chevronUp: '<i class="icon-[lucide--chevron-up] size-4" aria-hidden="true"></i>',
    settings2: '<i class="icon-[lucide--settings-2] size-4" aria-hidden="true"></i>',
    search: '<i class="icon-[lucide--search] size-4" aria-hidden="true"></i>',
    check: '<i class="icon-[lucide--check] size-4" aria-hidden="true"></i>',
    pencilOff: '<i class="icon-[lucide--pencil-off] size-4" aria-hidden="true"></i>',
    x: '<i class="icon-[lucide--x] size-4" aria-hidden="true"></i>',
  };
  /* Native lucide `tag` (default-workflow marker) from host sheet. */
  const TAG_SVG = '<i class="icon-[lucide--tag] size-4" aria-hidden="true"></i>';

  /* Native lucide `chevron-down` disclosure. Rotated -90deg when collapsed
     (see apply()); the <i> is caretWrap's firstElementChild. */
  const CHEVRON_SVG = '<i class="icon-[lucide--chevron-down] size-4" aria-hidden="true"></i>';

  /* 2026-11-21 用户「二级图标要与一级对齐」：二级分类不再按语义单独分配图标，
     而是直接复用其所属一级分组的 glyph，保证一级展开前后的图标完全一致。
     「未分类」是独立一级，沿用 circle-question-mark。所有 class 均为宿主已内联
     的 lucide（TOP_ICONS 各项已在宿主主 CSS 核实）。 */
  const CAT_ICON_FILE = '<i class="icon-[lucide--circle-question-mark] size-4" aria-hidden="true"></i>';
  function catIcon(title) {
    const key = NS.i18n?.normalizeCategory ? NS.i18n.normalizeCategory(title) : String(title || "");
    if (!key) return "";
    if (key === "api.uncategorized") return CAT_ICON_FILE;
    /* TOP_GROUPS / TOP_ICONS 定义在下方，但 catIcon 只在渲染时调用，此时已初始化。 */
    for (const top of TOP_GROUPS) {
      if (top.cats.includes(key)) return TOP_ICONS[top.icon] || "";
    }
    return "";
  }

  /* 2026-11-21：一级分组（纯展示层）。二级分类名仍是存储值/后端 category，
     一级只用于左栏列表的视觉归类，不影响 fields.json / 生成节点过滤 / 下拉。
     cats 覆盖全部 27 个后端 WORKFLOW_CATEGORIES；未分类不在此表，单独排最前。
     图标严格照抄 ComfyUI 原生模板侧栏的分类图标：真值来自前端
     categoryUtil-*.js 的 getCategoryIcon()（image/maximize-2/film/
     sliders-horizontal/volume-2/message-square-text）；「音乐」是新增的展示
     一级（原生无此分组），图标取宿主已内联的 lucide--music。不是自行挑选的
     wrench/hammer/audio-lines/brain。所有 class 已确认在主 CSS 内联。 */
  const TOP_GROUPS = [
    { name: "group.image", icon: "image", cats: ["cat.textToImage", "cat.imageEdit", "cat.inpaint", "cat.panorama", "cat.outpaint"] },
    { name: "group.imageTools", icon: "maximize", cats: ["cat.imageUpscale", "cat.removeBackground", "cat.imageRelight", "cat.multiAngle", "cat.removeWatermark", "cat.cutout"] },
    { name: "group.video", icon: "film", cats: ["cat.refToVideo", "cat.textToVideo", "cat.imageToVideo", "cat.firstLastFrame"] },
    { name: "group.videoTools", icon: "sliders", cats: ["cat.videoInterpolation", "cat.videoEdit", "cat.videoUpscale"] },
    { name: "group.music", icon: "music", cats: ["cat.textToMusic", "cat.musicCover", "cat.textToSfx"] },
    { name: "group.audio", icon: "volume", cats: ["cat.textToSpeech", "cat.voiceClone"] },
    { name: "group.llm", icon: "message", cats: ["cat.llmChat", "cat.imageToPrompt", "cat.videoToPrompt", "cat.speechToText"] },
  ];
  const TOP_ICONS = {
    image: '<i class="icon-[lucide--image] size-4" aria-hidden="true"></i>',
    maximize: '<i class="icon-[lucide--maximize-2] size-4" aria-hidden="true"></i>',
    film: '<i class="icon-[lucide--film] size-4" aria-hidden="true"></i>',
    sliders: '<i class="icon-[lucide--sliders-horizontal] size-4" aria-hidden="true"></i>',
    volume: '<i class="icon-[lucide--volume-2] size-4" aria-hidden="true"></i>',
    music: '<i class="icon-[lucide--music] size-4" aria-hidden="true"></i>',
    message: '<i class="icon-[lucide--message-square-text] size-4" aria-hidden="true"></i>',
  };

  /* 2026-11-21：默认全部折叠（一级、二级、未分类都是）。只记录用户主动展开的
     内部键，toggle 结果跨 renderList() 重建保留（select / drag / 语言切换）。
     二级键用原始中文分类名，绝不用翻译后的 label。 */
  const DEFAULT_EXPANDED = new Set();
  const expandedGroups = new Set(DEFAULT_EXPANDED);
  /* 一级分组的折叠状态，独立于二级分类。默认全部折叠；
     键为一级中文名，与二级状态一样跨 renderList() 重建保留。 */
  const expandedTopGroups = new Set();

  /* buttonVariants() base verbatim (incl. the three [&_svg] rule classes that
     the host carries on every Button). Only rounded-md is dropped: each size
     overrides it with rounded-lg (cn() in the host does the same merge).
     text-sm stays in base; size md/lg override it with text-xs/text-sm.
     2026-11-21: the three [&_svg] classes were missing vs native — restored so
     the toolbar buttons match buttonVariants() byte-for-byte. ui.js BTN_BASE
     is the same verbatim string. */
  const BTN = "relative inline-flex cursor-pointer touch-manipulation appearance-none "
    + "items-center justify-center gap-2 border-none font-inter text-sm font-medium "
    + "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring "
    + "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 "
    + "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([width]):not([height])]:size-4";
  const BTN_MD = BTN + " h-8 rounded-lg p-2 text-xs";
  const BTN_LG = BTN + " h-10 rounded-lg px-4 py-2 text-sm";
  const BTN_SECONDARY = BTN_MD + " bg-secondary text-foreground hover:bg-accent";
  const BTN_PRIMARY = BTN_MD + " bg-primary text-foreground hover:bg-primary/90";
  const BTN_MUTED = BTN_MD + " bg-transparent text-muted-foreground hover:bg-accent";
  /* 2026-11-21：右栏工具栏按钮按用户给的原生截图放大到 40px（原生 size=lg，
     h-10 rounded-lg px-4 py-2 text-sm），对齐截图里「管理账单/添加积分」的
     按钮规格；圆角/底色仍走原生 buttonVariants（rounded-lg + bg-secondary）。 */
  const BTN_LG_SECONDARY = BTN_LG + " bg-secondary text-foreground hover:bg-accent";
  const BTN_LG_PRIMARY = BTN_LG + " bg-primary text-foreground hover:bg-primary/90";
  const BTN_ICON = BTN + " size-8 rounded-lg bg-transparent text-muted-foreground hover:bg-accent";
  /* BaseModalLayout's close button (headerPadding=symmetric): <Button size="lg"
     class="w-10" variant="secondary">, measured at 40x40 / rounded-lg with a
     16px `pi pi-times` glyph and a solid bg-secondary square (rgb 38,39,41). */
  const BTN_CLOSE = BTN + " h-10 rounded-lg px-4 py-2 text-sm "
    + "bg-secondary text-foreground hover:bg-accent w-10";
  /* 2026-11-21：分类下拉照 infcanvas-settings.js 的语言下拉改，真值来自
     select.variants.ts（selectContentClass + selectItemVariants layout=single）。
     之前误用 menuContentClass（p-1/shadow-lg/min-w-48），与设置里的下拉不同款。 */
  const SELECT_CONTENT = "z-overlay overflow-hidden rounded-lg p-2 bg-background text-foreground "
    + "border border-solid shadow-md data-[state=closed]:animate-out "
    + "data-[state=open]:animate-in data-[state=closed]:fade-out-0 "
    + "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 "
    + "data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 "
    + "min-w-(--reka-select-trigger-width)";
  const SELECT_ITEM = "flex cursor-pointer items-center px-2 outline-none hover:bg-accent "
    + "relative w-full justify-between gap-3 rounded-sm py-3 text-sm select-none "
    + "focus:bg-accent data-[state=checked]:bg-muted data-[state=checked]:hover:bg-muted";

  /* Reference request(): reads the body as text, throws the backend's own
     error message, and complains when the endpoint returned nothing (which is
     what an un-restarted ComfyUI looks like for the new routes). */
  async function request(route, options = {}) {
    const api = window.comfyAPI?.api?.api;
    const path = "/infcanvas" + route;
    const response = api?.fetchApi
      ? await api.fetchApi(path, options)
      : await fetch("/api" + path, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) throw new Error((data && data.error) || t("api.requestFailed", { status: response.status }));
    if (data === null) throw new Error(t("api.noApiResponsePleaseFully"));
    return data;
  }

  const jsonOptions = (method, payload) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });


  /* This project's list returns `name` as a display label and `filename`/`id`
     as the actual file stem; every REST path must use the stem. */
  const wfKey = (item) => item.filename || item.id || item.name;

  /* --------------------- node-first parameter detection ---------------------

     先认节点、再认 key。泛型 key（value/text/prompt/caption/style/lyrics）在
     不同节点里含义完全不同 —— PrimitiveStringMultiline.value 是提示词，
     TextGenerate 的 sampling_mode.seed 是 LLM 的解码种子而不是图像种子。
     旧版只按 key/title 全局扫，靠一条 autoExcluded 补丁堵漏，误判率高。

     现在分两层，两边都不认的 key 留给用户在节点检查器里手动勾选：
       1) STRONG_KEYS —— 含义在任何节点都唯一的 key，直接按 key 认；
       2) NODE_ROLES  —— 文本类泛型 key，必须先认出节点身份(class_type /
                        title)才解释成对应参数，认不出的节点一律不自动暴露。

     同一 nodeId:key 只保留第一条命中的规则，所以角色表的顺序即优先级。 */


  /* Per-workflow memory of the auto rows the user explicitly unticked, so the
     defaults never fight with a deliberate removal. */
  const OFF_KEY = "infcanvas:auto-fields-off";
  /* Per-workflow "unticked auto rows" memory lives in the per-user prefs file. */
  const offStore = () => {
    const value = NS.prefs?.get(OFF_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };
  function offFields(name) {
    const all = offStore();
    return new Set(Array.isArray(all[name]) ? all[name] : []);
  }
  function setOffField(name, id, off) {
    if (!name) return;
    const all = offStore();
    const list = new Set(Array.isArray(all[name]) ? all[name] : []);
    if (off) list.add(id); else list.delete(id);
    writeOffFields(name, list, all);
  }
  function writeOffFields(name, list, all) {
    const store = all || {};
    store[name] = [...list];
    NS.prefs?.set(OFF_KEY, store);
  }

  /* ------------------------------ state ------------------------------ */

  let ui = null;
  const D = {};                 // DOM refs
  let entries = [];             // NodeFields inspector rows
  let inspectorSnapshot = null; // state before the inspector was opened (for 取消)
  let catDocDown = null;        // document handlers while the category menu is open
  let catDocKey = null;
  let panDrag = null;

  const S = {
    workflows: [], currentName: "", currentWorkflow: null,
    dragIndex: -1, dropIndex: -1,
    fields: [], fieldsDirty: false, inspecting: "",
    /* Baseline copy of S.fields as last loaded/saved. The right-hand panel's
       「保存为默认参数」stays disabled until the live fields differ from this
       snapshot; 「取消」(the revert button, NOT the sort-mode cancel) restores
       it. Deep-compared so every edit entry point (setFieldDefault, control
       mode, inspector) is covered without a fragile per-entry dirty flag. */
    paramSnapshot: null,
    /* Exposed-parameter order editing (right panel). */
    orderEditing: false, orderSnapshot: null, orderDrag: -1, orderDrop: -1,
    /* The 1:1 screenshot shows all 11 fields expanded ("隐藏高级输入" footer
       with the ⌄ dropdowns visible), so the right panel starts expanded too. */
    paramsShowAdvanced: true,
    autoAdded: 0, autoKeys: new Set(),
    category: "", categories: [],
    zoom: 1, panX: 0, panY: 0,
    /* Field→node spotlight: nodeId currently highlighted in the preview when
       the user selects an exposed field on the right. "" = none. */
    spotlight: "",
  };

  const nodeCount = () => Object.keys(apiNodes(S.currentWorkflow)).length;
  const inspectNode = () => apiNodes(S.currentWorkflow)[S.inspecting] || null;
  const inspectFields = () => S.fields.filter((f) => String(f.nodeId) === S.inspecting);




  /* Feedback goes to the HOST toast dock, not to a line of text under the
     sidebar: the host renders it as the standard card (status icon + title +
     optional description + close button) and we hand it a 3 s life so it
     disappears by itself. `notify(text, true)` is an error toast; the second
     argument may also be a detail line. */
  function notify(text, opts) {
    const isError = opts === true || (opts && opts.error === true);
    const detail = opts && typeof opts === "object" ? (opts.detail || "") : "";
    NS.api?.toast?.(isError ? "error" : "success", text, detail);
  }

  /* --------------------------- dialog shell ---------------------------

     Shell = ComfyUI's BaseModalLayout, class for class: the card is
     rounded-2xl + bg-background, the left panel is bg-card with a h-18 header
     (LeftPanelHeader) holding an icon + text-base font-semibold title, its rows
     are NavItem (rounded-md px-4 py-3 text-sm, active bg-muted / hover
     bg-accent) and every button carries buttonVariants' own string. Nothing in
     this function invents a surface. */

  function buildUI(body) {
    body.classList.add("ac-host");
    body.classList.add("flex", "flex-col", "overflow-hidden", "p-0", "min-h-0");

    const config = el("div", "ac-config");
    const left = el("nav", "flex h-full shrink-0 flex-col overflow-hidden bg-card");
    /* 2026-11-21 用户要求左栏与设置弹窗 / 原生 BaseModalLayout 默认一致：
       14rem = 224px = host w-56（原为 w-60/240px）。 */
    left.classList.add("w-56"); /* 14rem = host w-56 */
    const right = el("section", "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background");
    config.append(left, right);
    body.appendChild(config);

    /* ---- left: panel title (BaseModalLayout #leftPanelHeaderTitle) ---- */
    const listHead = el("header", "flex h-18 w-full shrink-0 items-center-safe gap-2 pr-3 pl-6");
    /* SettingDialog #leftPanelHeaderTitle 真值：裸 icon class（无 size/包裹），
       mask 继承 currentColor，实测 19px（同设置弹窗标题齿轮）。
       2026-11-21 用户「不用加框」：去掉曾加的 32x32 bg-muted 圆角方块，
       回到与设置弹窗一致的裸 19px sliders 图标。 */
    const brand = el("i", "icon-[lucide--sliders-horizontal]");
    brand.setAttribute("aria-hidden", "true");
    listHead.append(brand, el("h2", "text-base font-semibold text-foreground", t("api.apiConfig")));
    left.appendChild(listHead);

    /* ---- left: upload action, directly under the "API 配置" header ----
       Mirrors the right action row: same top edge (both headers are h-18) and
       the same 32px button height (BTN_MD / h-8), with the left panel's own
       px-4 gutter. The file input is hidden and rides along in this row. */
    const listAction = el("div", "flex shrink-0 items-center px-3 pb-2");
    D.upload = el("button", BTN_MD + " w-full bg-primary text-foreground hover:bg-primary/90", t("api.uploadWorkflow"));
    D.upload.type = "button";
    D.upload.addEventListener("click", () => D.fileInput.click());
    listAction.appendChild(D.upload);
    D.fileInput = document.createElement("input");
    D.fileInput.type = "file";
    D.fileInput.accept = ".json,application/json";
    D.fileInput.multiple = true;
    D.fileInput.hidden = true;
    D.fileInput.addEventListener("change", onFiles);
    listAction.appendChild(D.fileInput);
    left.appendChild(listAction);

    /* ---- left: workflow list (LeftSidePanel + NavItem) ----
       ComfyUI 插件直接跑在 ComfyUI 内部，没有可填的后端地址；参考项目的
       「COMFYUI 后端地址」是 import.meta.env.DEV 才显示的调试项，上线形态省略。 */
    D.list = el("div", "scrollbar-hide flex min-h-0 w-full flex-auto flex-col gap-2 overflow-y-auto bg-card px-3 pb-2");
    left.appendChild(D.list);

    /* ---- right: header, BaseModalLayout #header (headerPadding=symmetric →
       px-6 py-5, 高 80px). Title sits at the left edge of headerContentClass;
       the close button is the last child and gets pushed to the far right by
       justify-between. ---- */
    const head = el("header", "flex w-full items-center justify-between gap-2 px-6 py-5");
    /* headerContentClass = flex min-w-0 flex-1 gap-2. min-w-0 on both text items
       is what lets `truncate` kick in instead of pushing the close button out. */
    const headInfo = el("div", "flex min-w-0 flex-1 items-center gap-2");
    D.name = el("div", "min-w-0 shrink truncate text-base font-medium text-foreground", t("api.noWorkflowSelected"));
    D.sub = el("div", "min-w-0 truncate text-xs text-muted-foreground");
    headInfo.append(D.name, D.sub);
    /* The action row is its own line under the header, not part of it. */
    /* 2026-11-21：工具栏行下方留白加大（pb-3 12px → pb-4 16px）；上方保持
       原样 0 padding（用户要求上面间距改回去，只保留下方加大）。 */
    const actions = el("div", "flex shrink-0 items-center gap-3 px-6 pb-4");
    /* Rename edits the title, which IS the workflow's file stem, so the dialog
       owns this action here. Field edits are saved inside their own inspector
       now (保存 / 取消); there is no dialog-wide save button any more. */
    D.rename = el("button", BTN_LG_SECONDARY, t("panel.rename"));
    D.rename.type = "button";
    bindTip(D.rename, () => t("api.renameWorkflowHint"));
    D.rename.addEventListener("click", renameWorkflow);
    /* One default workflow per category. The list response already resolves the
       fallback (first workflow of the category), so this only pins a choice. */
    D.favorite = el("button", BTN_LG_SECONDARY, t("api.setDefault"));
    D.favorite.type = "button";
    bindTip(D.favorite, () => t("api.setWorkflowItsCategoryDefault"));
    /* Solid secondary surface (--secondary #262729) reads clearly against the
       header's --background #171718 -- the same look as the host's 应用 button. */
    D.danger = el("button", BTN_LG_SECONDARY, t("panel.delete"));
    D.danger.type = "button";
    D.danger.addEventListener("click", removeWorkflow);
    D.favorite.addEventListener("click", setDefaultWorkflow);
    /* 2026-11-21：改为 ComfyUI 设置里下拉的原生样式——selectTriggerVariants()
       默认档 (size=lg, border=none) verbatim：实心 bg-secondary + 2.5px 透明边框
       （仅 focus-visible / data-[state=open] 时显示 border-border）。之前是照
       Templates dialog 的 trigger-class 覆盖成 bg-transparent + border-border/50，
       用户指出颜色不对，改回原生设置下拉的外观。min-w-0/shrink/basis-40 是布局需要。 */
    D.catBtn = el("button", "relative inline-flex cursor-pointer items-center "
      + "rounded-lg border-[2.5px] border-solid bg-secondary text-foreground "
      + "transition-all duration-200 ease-in-out outline-none select-none "
      + "hover:bg-accent disabled:cursor-default disabled:opacity-30 disabled:hover:bg-secondary "
      + "h-10 border-transparent focus-visible:border-border "
      + "data-[state=open]:border-border min-w-0 shrink basis-40");
    D.catBtn.type = "button";
    /* 原生 SelectTrigger 是 button：computed padding 1px 6px / font 16px。
       我们挂在 #infcanvas-root（继承 14px），不写回箭头会贴右且缩到 12px。 */
    D.catBtn.style.padding = "1px 6px";
    D.catBtn.style.fontSize = "16px";
    D.catBtn.dataset.state = "closed";
    bindTip(D.catBtn, () => t("api.workflowCategoryHint"));
    /* SingleSelect.vue 内部结构：值容器 flex-1 overflow-hidden py-2 pl-2 text-sm
       + truncate，箭头容器 pl-3 + 裸 lucide chevron-down（不写 size-4）。 */
    const catText = el("div", "flex flex-1 items-center gap-2 overflow-hidden py-2 pl-2 text-sm");
    D.catLabel = el("span", "truncate", t("api.uncategorized"));
    catText.appendChild(D.catLabel);
    const catChev = el("div", "flex shrink-0 cursor-pointer items-center justify-center pl-3");
    const catChevIcon = el("i", "icon-[lucide--chevron-down] text-muted-foreground");
    catChevIcon.setAttribute("aria-hidden", "true");
    catChev.appendChild(catChevIcon);
    D.catBtn.append(catText, catChev);
    D.catBtn.setAttribute("aria-haspopup", "menu");
    D.catBtn.setAttribute("aria-expanded", "false");
    D.catBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (D.catMenu.hidden) openCatMenu(); else closeCatMenu();
    });

    /* 与语言下拉同一个 selectContentClass；fixed 定位由 .ac-catmenu 提供，
       高度上限放到内层 .ac-catviewport（原生 SelectViewport 的做法）。 */
    D.catMenu = el("div", "ac-catmenu " + SELECT_CONTENT);
    D.catMenu.setAttribute("role", "menu");
    D.catMenu.hidden = true;
    /* Fixed-positioned, so it is not clipped by the panel; kept inside the
       dialog so the [hidden] rule above applies. */
    config.appendChild(D.catMenu);
    /* Host close button: 40x40, textonly, pi pi-times, last child of the header. */
    const closeBtn = el("button", BTN_CLOSE);
    closeBtn.type = "button";
    bindTip(closeBtn, () => t("settings.close"));
    closeBtn.setAttribute("aria-label", t("settings.close"));
    const closeGlyph = el("i", "pi pi-times");
    closeGlyph.setAttribute("aria-hidden", "true");
    closeBtn.appendChild(closeGlyph);
    closeBtn.addEventListener("click", () => close());
    head.append(headInfo, closeBtn);
    right.appendChild(head);
    /* Two groups on one toolbar row: the workflow actions (重命名/设为默认/删除)
       hug the LEFT; the param actions (保存为默认参数/调整顺序) hug the RIGHT.
       A flex-1 spacer between the two groups creates the gap. */
    const actionsSpacer = el("div", "min-w-4 flex-1");
    actions.append(D.catBtn, D.rename, D.favorite, D.danger, actionsSpacer);
    right.appendChild(actions);

    /* ---- right: content (BaseModalLayout #content, px-6 pb-10) ----
       pb is matched to the horizontal px (24px each) so the preview frame
       sits with equal right/bottom breathing room instead of floating high. */
    const content = el("main", "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6");
    right.appendChild(content);

    /* Graph preview on the left, exposed-parameter order panel on the right. */
    const contentRow = el("div", "flex min-h-0 flex-1 flex-row gap-3");
    content.appendChild(contentRow);

    const preview = el("div", "ac-preview flex-1 rounded-lg border border-border/50 bg-card");
    /* 320px has no generated min-h utility (min-h-80 absent); keep inline. */
    preview.style.minHeight = "320px";
    D.viewport = el("div", "ac-viewport");
    D.scene = el("div", "ac-scene");
    D.viewport.appendChild(D.scene);
    preview.appendChild(D.viewport);

    const tools = el("div", "absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border bg-card/90 p-1 backdrop-blur");
    const zoomOut = el("button", BTN_ICON); zoomOut.innerHTML = ICO.minus;
    zoomOut.type = "button"; bindTip(zoomOut, () => t("shortcuts.zoomOut"));
    zoomOut.addEventListener("click", () => zoomTo(S.zoom - 0.2));
    D.zoomLabel = el("span", "min-w-10 text-center text-xs text-muted-foreground", "100%");
    const zoomIn = el("button", BTN_ICON); zoomIn.innerHTML = ICO.plus;
    zoomIn.type = "button"; bindTip(zoomIn, () => t("shortcuts.zoomIn"));
    zoomIn.addEventListener("click", () => zoomTo(S.zoom + 0.2));
    const fitBtn = el("button", BTN_MUTED, t("api.fit"));
    fitBtn.type = "button"; bindTip(fitBtn, () => t("api.fitCanvas"));
    fitBtn.addEventListener("click", fit);
    tools.append(zoomOut, D.zoomLabel, zoomIn, fitBtn);
    preview.appendChild(tools);

    D.empty = el("div", "ac-empty", t("api.selectWorkflowLeftPreview"));
    D.tip = el("div", "ac-empty is-tip", t("api.clickNodeHint"));
    D.tip.hidden = true;
    preview.append(D.empty, D.tip);
    contentRow.appendChild(preview);

    /* ---- API 参数 panel (right of the preview) ----
       The card shell uses the host's OWN utility classes (rounded-xl / border /
       bg-card / shadow-sm), so it reads as a native ComfyUI card. Only the
       WidgetGrid rows keep their host utility classes; no custom skin remains.
       Below the card sit two buttons: 保存为默认参数 (left) / 调整顺序 (right). */
    D.params = el("div", "ac-params");
    D.paramsCard = el("div", "flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm");
    const paramsHead = el("div", "flex h-9 shrink-0 items-center gap-2 border-b border-border px-3");
    paramsHead.append(
      el("span", "text-xs font-semibold text-foreground", t("core.apiParams")),
      D.paramsCount = el("span", "inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-2xs leading-4 text-muted-foreground"),
    );
    D.paramsList = el("div", "ac-params-list");
    D.paramsEmpty = el("div", "px-4 pb-3 pt-1 text-xs text-muted-foreground",
      t("core.noApiParametersExposedSelect"));
    D.paramsList.appendChild(D.paramsEmpty);
    /* Footer band, host utility classes only (border-t / bg-muted / text-xs).
       It sits inside the card's overflow-hidden rounded shell, so no separate
       rounding is needed here. */
    D.paramsMore = el("div", "box-border flex w-full shrink-0");
    D.paramsMoreBtn = el("button", "pointer-events-auto relative inline-flex box-border h-8 w-full "
      + "cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 "
      + "border-none border-t border-border bg-muted px-2 py-0 text-xs font-normal "
      + "whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground "
      + "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none "
      + "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0");
    D.paramsMoreBtn.type = "button";
    D.paramsMoreBtn.addEventListener("click", toggleParamsAdvanced);
    D.paramsMoreLabel = el("span", "truncate", "");
    D.paramsMoreIcon = el("span", "flex size-4 shrink-0 items-center justify-center");
    const moreInner = el("div", "flex size-full items-center justify-center gap-2");
    moreInner.append(D.paramsMoreLabel, D.paramsMoreIcon);
    D.paramsMoreBtn.appendChild(moreInner);
    D.paramsMore.appendChild(D.paramsMoreBtn);
    /* The prompt is the node's OWN main text area — not a widget-grid row
       (apiBarFields skips it). It sits at the TOP of the API 参数 card, right
       under the title, separated from the parameter grid by a native border-b.
       The textarea uses the host's own node class. */
    D.promptBox = el("div", "icn__gpa-inputs border-b border-border px-3 py-3");
    D.promptBox.hidden = true;
    D.paramsCard.append(paramsHead, D.promptBox, D.paramsList, D.paramsMore);

    /* Right-hand group of the toolbar: 取消修改(恢复参数) + 保存为默认参数 + 调整顺序.
       取消修改 sits immediately LEFT of 保存为默认参数 and only appears once a
       parameter has been edited; clicking it restores the saved baseline.
       In sort mode these swap to 确定顺序 + 取消 (visibility driven by
       syncParamActions() / renderParamOrder()). */
    D.paramsRevert = el("button", BTN_LG_SECONDARY, t("api.cancelChanges"));
    D.paramsRevert.type = "button";
    D.paramsRevert.hidden = true;
    bindTip(D.paramsRevert, () => t("api.restoreDefaults"));
    D.paramsRevert.addEventListener("click", revertDefaultParams);
    D.paramsSave = el("button", BTN_LG_SECONDARY, t("api.saveDefault"));
    D.paramsSave.type = "button";
    D.paramsSave.disabled = true;
    D.paramsSave.addEventListener("click", saveDefaultParams);
    D.paramsEdit = el("button", BTN_LG_SECONDARY, t("api.reorder"));
    D.paramsEdit.type = "button";
    D.paramsEdit.addEventListener("click", toggleParamOrder);
    D.paramsConfirm = el("button", BTN_LG_PRIMARY, t("api.confirmOrder"));
    D.paramsConfirm.type = "button";
    D.paramsConfirm.addEventListener("click", confirmParamOrder);
    D.paramsCancel = el("button", BTN_LG_SECONDARY, t("api.cancel"));
    D.paramsCancel.type = "button";
    bindTip(D.paramsCancel, () => t("api.cancelReorder"));
    D.paramsCancel.addEventListener("click", cancelParamOrder);
    actions.append(D.paramsRevert, D.paramsSave, D.paramsEdit, D.paramsConfirm, D.paramsCancel);
    D.params.append(D.paramsCard);
    contentRow.appendChild(D.params);

    /* wheel zoom + background pan, matching Vue Flow's default preview gestures */
    D.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = D.viewport.getBoundingClientRect();
      const px = event.clientX - rect.left, py = event.clientY - rect.top;
      const next = clampZoom(S.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
      const ratio = next / S.zoom;
      S.panX = px - (px - S.panX) * ratio;
      S.panY = py - (py - S.panY) * ratio;
      S.zoom = next;
      applyTransform();
    }, { passive: false });
    D.viewport.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".ac-node") || event.button !== 0) return;
      clearSpotlight();
      panDrag = { x: event.clientX, y: event.clientY, panX: S.panX, panY: S.panY };
      D.viewport.classList.add("is-panning");
      D.viewport.setPointerCapture?.(event.pointerId);
    });
    D.viewport.addEventListener("pointermove", (event) => {
      if (!panDrag) return;
      S.panX = panDrag.panX + event.clientX - panDrag.x;
      S.panY = panDrag.panY + event.clientY - panDrag.y;
      applyTransform();
    });
    const endPan = () => { panDrag = null; D.viewport.classList.remove("is-panning"); };
    D.viewport.addEventListener("pointerup", endPan);
    D.viewport.addEventListener("pointercancel", endPan);

    /* ---- node fields inspector: a dialog on top of the dialog ----
       Same surface as BaseModalLayout (rounded-2xl / border / bg-background) and
       the same Button recipes, so it reads as one more host dialog. */
    D.nfMask = el("div", "absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6");
    D.nfMask.hidden = true;
    D.nfCard = el("div", "flex max-h-full max-w-full flex-col overflow-hidden rounded-xl border bg-background shadow-lg");
    /* w-[520px] is an arbitrary value the host never emits, so it is not in the
       prebuilt sheet; the width is set inline instead. */
    D.nfCard.style.width = "520px";
    D.nfCard.dataset.nfCard = "1";
    const nfHead = el("header", "flex items-start justify-between gap-2 px-6 pt-5 pb-3");
    const nfHeadText = el("div", "flex min-w-0 flex-1 flex-col gap-1");
    D.nfTitle = el("div", "flex items-center gap-2 text-base font-semibold text-foreground");
    D.nfTitleDot = el("i", "size-2 rounded-sm bg-primary");
    D.nfTitleText = el("span", "truncate", "");
    D.nfTitle.append(D.nfTitleDot, D.nfTitleText);
    D.nfSub = el("div", "truncate text-xs text-muted-foreground");
    nfHeadText.append(D.nfTitle, D.nfSub);
    const nfClose = el("button", BTN_ICON); nfClose.innerHTML = ICO.x;
    nfClose.type = "button"; bindTip(nfClose, () => t("settings.close"));
    nfClose.addEventListener("click", cancelNodeFields);
    nfHead.append(nfHeadText, nfClose);
    D.nfList = el("div", "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-4");
    const nfFoot = el("footer", "flex items-center justify-between gap-2 border-t px-6 py-3");
    D.nfCount = el("span", "text-xs text-muted-foreground", t("api.0FieldsEnabled"));
    /* Save lives INSIDE the inspector now: the dialog no longer has a global
       保存配置 button. 取消 rolls the field table back to what it was when this
       inspector opened, including the localStorage memory of unticked auto rows. */
    const nfActions = el("div", "flex items-center gap-2");
    const nfSave = el("button", BTN_PRIMARY, t("panel.save"));
    nfSave.type = "button";
    nfSave.addEventListener("click", () => { saveFields().then((ok) => { if (ok) closeNodeFields(); }); });
    const nfCancel = el("button", BTN_SECONDARY, t("api.cancel"));
    nfCancel.type = "button";
    nfCancel.addEventListener("click", cancelNodeFields);
    nfActions.append(nfSave, nfCancel);
    nfFoot.append(D.nfCount, nfActions);
    D.nfCard.append(nfHead, D.nfList, nfFoot);
    D.nfMask.appendChild(D.nfCard);
    /* Over the WHOLE dialog, not just the right column: a mask that leaves the
       left panel bright reads as two unrelated surfaces. */
    body.appendChild(D.nfMask);

    renderList();
    renderHead();
    renderPreview();
  }

  /* --------------------------- backend readiness --------------------------- */

  /* 插件运行在 ComfyUI 内部，请求天然发往当前 ComfyUI，没有后端地址可配。
     保留 GET /settings 只作为「新增 Python 路由是否已加载」的探针：未完全
     重启 ComfyUI 时会 404，弹窗据此显示重启横幅。返回值一律忽略。 */
  async function probeBackend() {
    try {
      await request("/settings");
    } catch (error) {
      if (/404|No API response|Request failed|无响应|请求失败/.test(String(error?.message || "")) && ui?.setApiReady) ui.setApiReady(false);
      notify(error.message, true);
    }
  }

  /* --------------------------- workflow list --------------------------- */

  async function loadWorkflows() {
    try {
      const data = await request("/workflows");
      S.workflows = data.workflows || [];
      if (Array.isArray(data.categories)) S.categories = data.categories;
      const exists = S.workflows.some((item) => wfKey(item) === S.currentName);
      if (!exists) {
        S.currentName = ""; S.currentWorkflow = null; S.fields = []; S.fieldsDirty = false;
        closeNodeFields();
        if (S.workflows.length) await selectWorkflow(wfKey(S.workflows[0]));
      }
      renderList(); renderHead(); renderPreview();
      /* Reference: let the canvas pick up the newest order / first workflow. */
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
    } catch (error) {
      if (/404|No API response|Request failed|无响应|请求失败/.test(String(error?.message || "")) && ui?.setApiReady) ui.setApiReady(false);
      notify(error.message, true);
    }
  }

  function renderList() {
    if (!D.list) return;
    D.list.replaceChildren();
    /* Group workflows by their (second-level) category. Built from real workflows
       for drag/drop addressing; the full category tree is rendered below. */
    const groups = new Map();
    S.workflows.forEach((item, index) => {
      const key = (item.category || "").trim() || "api.uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ item, index });
    });
    /* Within each group the workflows are sorted by name. `index` stays the
       item's index in S.workflows so drag/drop keeps addressing the real array. */
    const byName = (a, b) => String(a.item.name || wfKey(a.item))
      .localeCompare(String(b.item.name || wfKey(b.item)), "zh-Hans-CN");
    for (const entries of groups.values()) entries.sort(byName);

    /* Render ONE second-level category group (disclosure head + workflow rows)
       into `host`. Extracted so it can be reused under a fixed first-level head
       and for the standalone 未分类 bucket. Collapse state stays keyed by the
       raw category title, so toggles survive renderList() rebuilds. */
    /* level='top' 时按一级分类渲染（灰小字 + 图标 + chevron，用于「未分类」）；
       默认 'second' 为二级分类（白字 14px + count 徽章）。两级的展开状态各自
       独立：一级用 expandedTopGroups，二级用 expandedGroups。 */
    const renderCategory = (title, host, level) => {
      const isTop = level === "top";
      const expandedSet = isTop ? expandedTopGroups : expandedGroups;
      const entries = groups.get(title) || [];
      const group = el("div", "flex flex-col gap-2");
      /* Clickable disclosure head. 2026-11-21 起按用户要求对齐设置弹窗
         NavItem 真值：pl-4 → 图标 x=29、headLeft gap-2 → 文字 x=53、
         h-11(44px) → 行高 44px（原 pl-2/gap-1.5/pt-2：文字偏左约 10px、行高 48px）。
         用固定高度而非 py-3：内部 count 徽章会把内容撑到 40px，py-3 会涨到 64px；
         h-11 + items-center 与设置弹窗 NavItem 的 py-3(44px) 逐像素一致。
         chevron 仍在末端 justify-between；group gap-2 对齐设置弹窗 nav 的分组间距。
         一级（未分类）用 h-10，与六个一级分组头高度一致。 */
      const head = el("div", (isTop
        ? "m-0 flex h-10 w-full cursor-pointer items-center justify-between gap-2 pr-2"
        : "m-0 flex h-11 w-full cursor-pointer items-center justify-between gap-2 pr-2"));
      head.classList.add("pl-4");
      /* Title + a small count badge share the left side; the chevron stays at
         the trailing edge. The count is a SIBLING of the title (not its text) so
         the group title stays a clean category name for sorting / a11y checks. */
      const headLeft = el("div", "flex min-w-0 items-center gap-2");
      /* 图标颜色跟随文字：一级（灰字）用 text-muted-foreground，二级（白字）
         用 text-foreground。glyph 本身仍是 host lucide。 */
      const iconWrap = el("span", "flex size-4 shrink-0 items-center justify-center "
        + (isTop ? "text-muted-foreground" : "text-foreground"));
      iconWrap.innerHTML = catIcon(title);
      headLeft.appendChild(iconWrap);
      if (isTop) {
        /* 一级文字 = 图1「基础」灰小字大写：h3 text-xs font-bold text-muted-foreground uppercase。 */
        headLeft.appendChild(el("h3", "text-xs font-bold text-muted-foreground uppercase", cat(title)));
      } else {
        /* 二级文字 = 图2「图像」白字 14px 常规；用 span 而非 h3，避免 h3 默认 700 粗体。 */
        headLeft.appendChild(el("span", "text-sm text-foreground", cat(title)));
      }
      const count = el("span", "shrink-0 leading-none text-muted-foreground",
        String(entries.length));
      /* Inline styles: the host's Tailwind is prebuilt, so arbitrary-value
         classes like text-[10px] resolve to nothing. Use host CSS vars. */
      count.className += " text-2xs font-semibold leading-none rounded-full bg-muted";
      count.style.padding = "2px 6px"; /* px-1.5/py-0.5 absent from host sheet */
      count.setAttribute("aria-label", entries.length + t("api.workflows"));
      if (!isTop) headLeft.appendChild(count); /* 一级分组头不显示数量，对齐其它一级 */
      head.appendChild(headLeft);
      /* chevron 同样跟随文字颜色：一级灰、二级白。 */
      const caretWrap = el("span", "flex size-5 shrink-0 items-center justify-center "
        + (isTop ? "text-muted-foreground" : "text-foreground"));
      caretWrap.innerHTML = CHEVRON_SVG;
      head.appendChild(caretWrap);
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      group.appendChild(head);

      /* Workflow rows live in their own container so the disclosure can show /
         hide them without rebuilding the DOM (keeps drag state and scroll). */
      const items = el("div", "flex flex-col gap-2");

      for (const { item, index } of entries) {
        /* NavItem.vue verbatim: rounded-md px-4 py-3 text-sm, active bg-muted,
           hover bg-accent. "ac-item" is kept as the drag marker so the drag
           handlers can toggle classes without rebuilding the list. */
        /* treeStyles.ts treeItemClass (rounded-lg / py-3 / pr-2 / hover:bg-accent),
           no leading icon: the workflow name is the whole row, so the text starts
           at the group label's indent. A <button> would paint the UA buttonface on
           top of these classes, so the row is a div with role="button". */
        const button = el("div", "ac-item group/tree-node flex w-full min-w-0 cursor-pointer "
          + "items-center rounded-lg py-3 pr-2 text-left text-sm text-foreground "
          + "outline-none select-none transition-colors hover:bg-accent");
        button.classList.add("pl-4");
        button.setAttribute("role", "button");
        button.draggable = true;
        button.dataset.index = String(index);
        /* Name + optional 默认 tag. The tag is per-row state from the list
           endpoint: `is_default` is true for the pinned workflow, or for the
           first workflow of the category while nothing is pinned. */
        const label = el("div", "flex min-w-0 flex-1 items-center gap-1.5");
        label.appendChild(el("span", "min-w-0 truncate", item.name || wfKey(item)));
        button.appendChild(label);
        /* The tag sits at the row's trailing edge, not next to the name: the
           label above is flex-1, so a sibling appended after it is pushed to the
           right (button's own pr-2 sets the inset). */
        if (item.is_default) {
          const tag = el("i", "ml-2 flex size-4 shrink-0 items-center justify-center text-primary");
          tag.innerHTML = TAG_SVG;
          tag.setAttribute("role", "img");
          tag.setAttribute("aria-label", item.default_pinned ? t("api.defaultWorkflow") : t("api.firstWorkflowNoDefaultSet"));
          bindTip(tag, () => (item.default_pinned
            ? t("api.defaultWorkflowCategory")
            : t("api.noDefaultSetCategoryUsing")));
          button.appendChild(tag);
        }
        bindTip(button, () => (item.name || wfKey(item)) + " · " + cat(item.category)
          + " · " + (item.nodes ?? 0) + t("core.nodes"));        button.classList.toggle("bg-muted", wfKey(item) === S.currentName);
        button.classList.toggle("is-dragging", S.dragIndex === index);
        button.classList.toggle("is-drop", S.dropIndex === index && S.dragIndex !== index);
        button.addEventListener("click", () => selectWorkflow(wfKey(item)));
        button.addEventListener("dragstart", (event) => onDragStart(event, index));
        button.addEventListener("dragover", (event) => onDragOver(event, index));
        button.addEventListener("drop", (event) => onDrop(event, index));
        button.addEventListener("dragend", onDragEnd);
        items.appendChild(button);
      }

      /* Disclosure state. Default collapsed; apply() is the single place that
         syncs the caret rotation, items visibility and a11y title together. */
      const apply = () => {
        const open = expandedSet.has(title);
        items.style.display = open ? "flex" : "none";
        caretWrap.firstElementChild.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
        head.setAttribute("aria-expanded", open ? "true" : "false");
        bindTip(head, () => ((open ? (isTop ? t("api.collapseGroup") : t("api.collapseCategory"))
          : (isTop ? t("api.expandGroup") : t("api.expandCategory"))) + " · " + cat(title)));
      };
      const toggle = () => {
        if (expandedSet.has(title)) expandedSet.delete(title);
        else expandedSet.add(title);
        apply();
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
      });
      apply();
      group.appendChild(items);
      host.appendChild(group);
    };

    /* ---- 2026-11-21 二级结构渲染 ----
       一级（固定、不可折叠）= 视觉分组标题；其下是该一级的二级分类（保持原有
       可折叠 disclosure）。未分类是特殊 bucket，始终单独排在最前。
       一级只做展示归类：二级 title 仍是存储值，拖拽/默认/折叠逻辑完全不变。 */
    const seen = new Set();

    /* 未分类 bucket 排最前，按用户要求提升为一级分类（灰小字 + 图标 + chevron，
       与其它一级分组同级；独立折叠状态，默认折叠）。 */
    if (S.categories.includes("api.uncategorized") || groups.has("api.uncategorized")) {
      renderCategory("api.uncategorized", D.list, "top");
      seen.add("api.uncategorized");
    }

    /* 一级分组：可折叠头（图标 + 名称 + chevron）+ 其下的二级分类。
       一级状态独立于二级，默认全部折叠（用户 2026-11-21 要求）；折叠只隐藏
       children 容器，不重建 DOM，避免打断正在进行的拖拽。
       一级文字 = 图1「基础」灰小字；二级文字 = 图2「图像」白色 14px。 */
    for (const top of TOP_GROUPS) {
      const section = el("div", "flex flex-col gap-2");
      const topHead = el("div", "flex h-10 w-full cursor-pointer items-center justify-between gap-2 px-4");
      const headLeft = el("div", "flex min-w-0 items-center gap-2");
      /* 图标跟随文字颜色：一级是灰字，图标也用 text-muted-foreground。 */
      const topIcon = el("span", "flex size-4 shrink-0 items-center justify-center text-muted-foreground");
      topIcon.innerHTML = TOP_ICONS[top.icon] || "";
      headLeft.appendChild(topIcon);
      /* 一级文字按用户给的图1真值（节点库「基础」分组小标题）：
         text-xs font-bold text-muted-foreground uppercase（12px/700/灰/大写）。 */
      headLeft.appendChild(el("h3", "text-xs font-bold text-muted-foreground uppercase", t(top.name)));
      topHead.appendChild(headLeft);
      const topCaret = el("span", "flex size-5 shrink-0 items-center justify-center text-muted-foreground");
      topCaret.innerHTML = CHEVRON_SVG;
      topHead.appendChild(topCaret);
      topHead.setAttribute("role", "button");
      topHead.setAttribute("tabindex", "0");
      section.appendChild(topHead);

      const children = el("div", "flex flex-col gap-2");
      let hasChild = false;
      for (const c of top.cats) {
        /* 只渲染后端声明的分类，或工作流实际携带的分类（stray 分类在下方兜底）。 */
        if (!S.categories.includes(c) && !groups.has(c)) continue;
        renderCategory(c, children);
        seen.add(c);
        hasChild = true;
      }
      if (!hasChild) continue;

      /* Disclosure state for the first level. apply() is the single place that
         syncs caret rotation, children visibility, a11y and tooltip together. */
      const applyTop = () => {
        const open = expandedTopGroups.has(top.name);
        children.style.display = open ? "flex" : "none";
        topCaret.firstElementChild.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
        topHead.setAttribute("aria-expanded", open ? "true" : "false");
        bindTip(topHead, () => (open ? t("api.collapseGroup") : t("api.expandGroup")) + " · " + t(top.name));
      };
      const toggleTop = () => {
        if (expandedTopGroups.has(top.name)) expandedTopGroups.delete(top.name);
        else expandedTopGroups.add(top.name);
        applyTop();
      };
      topHead.addEventListener("click", toggleTop);
      topHead.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleTop(); }
      });
      applyTop();
      section.appendChild(children);
      D.list.appendChild(section);
    }

    /* 兜底：后端新增但尚未归入任何一级的分类，或工作流带来的 stray 分类，
       追加到末尾，确保没有工作流因展示分组而消失。 */
    for (const c of S.categories) {
      if (!seen.has(c) && c !== "api.uncategorized") { renderCategory(c, D.list); seen.add(c); }
    }
    for (const c of groups.keys()) {
      if (!seen.has(c) && c !== "api.uncategorized") { renderCategory(c, D.list); seen.add(c); }
    }
  }

  /* Drag state must only toggle classes. Rebuilding the list here would remove
     the very element being dragged and cancel the HTML5 drag immediately. */
  function updateDragClasses() {
    if (!D.list) return;
    D.list.querySelectorAll(".ac-item").forEach((item) => {
      const index = Number(item.dataset.index);
      item.classList.toggle("is-dragging", S.dragIndex === index);
      item.classList.toggle("is-drop", S.dropIndex === index && S.dragIndex !== index);
    });
  }
  function onDragStart(event, index) {
    S.dragIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      /* Firefox needs data before it actually starts a drag. */
      event.dataTransfer.setData("text/plain", String(index));
    }
    updateDragClasses();
  }
  function onDragOver(event, index) {
    if (S.dragIndex < 0) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (S.dropIndex !== index) { S.dropIndex = index; updateDragClasses(); }
  }
  async function onDrop(event, index) {
    event.preventDefault();
    const from = S.dragIndex;
    S.dragIndex = -1; S.dropIndex = -1;
    if (from < 0 || from === index) { renderList(); return; }
    const list = [...S.workflows];
    const [moved] = list.splice(from, 1);
    list.splice(index, 0, moved);
    S.workflows = list;
    renderList();
    try {
      const data = await request("/workflows/order", jsonOptions("PUT", { names: list.map(wfKey) }));
      if (data.workflows) S.workflows = data.workflows;
      notify(t("api.orderSaved"));
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
    } catch (error) {
      notify(error.message, true);
      await loadWorkflows();
    }
    renderList();
  }
  function onDragEnd() {
    S.dragIndex = -1; S.dropIndex = -1;
    updateDragClasses();
  }

  /* ------------------------- selection / fields ------------------------- */

  async function selectWorkflow(name) {
    try {
      let data;
      try {
        data = await request("/workflows/" + encodeURIComponent(name));
      } catch (error) {
        /* Before ComfyUI is restarted the new REST route is missing. Fall back
           to the original read-only template endpoint so the preview still
           renders; the banner keeps asking for a full restart. */
        if (!/404/.test(String(error?.message || ""))) throw error;
        const tpl = await request("/workflow?name=" + encodeURIComponent(name));
        data = { name, workflow: tpl };
        if (ui?.setApiReady) ui.setApiReady(false);
      }
      S.currentName = data.name;
      S.currentWorkflow = data.workflow;
      closeNodeFields();
      clearSpotlight();
      await loadFields(name);
      renderList(); renderHead(); renderPreview();
    } catch (error) {
      notify(error.message, true);
    }
  }

  /* Loading a workflow's fields is STRICTLY READ-ONLY now. By the user's rule,
     the only things allowed to write a workflow's parameters are (1) importing
     it and (2) an explicit save click. Auto-detecting + PUT here used to fire on
     every selection (switch / open / refresh / another workflow's import event)
     and rewrote whatever the user had tuned — the root of the "参数自动恢复 /
     顺序变了 / 导入别的却改了原来的" reports. Detection + persistence now live
     only in resetFieldsForImport(), called from the two import entry points. */
  async function loadFields(name) {
    try {
      const data = await request("/workflows/" + encodeURIComponent(name) + "/fields");
      S.fields = data.fields || [];
      S.category = data.category || "";
      if (Array.isArray(data.categories)) S.categories = data.categories;
    } catch (_) {
      S.fields = [];
      S.category = "";
    }
    S.fieldsDirty = false;
    S.autoAdded = 0;
    S.autoKeys = new Set();
    snapshotParams();
  }

  /* Import = fresh overwrite. Every import (even over a workflow that already
     has parameters) re-detects the common parameters from scratch and PUTs them,
     replacing the old fields.json; the per-workflow "unticked" memory is cleared
     so nothing survives a re-import. This is the ONLY automatic write left, and
     it is scoped strictly to the workflow named here — never another one. */
  async function resetFieldsForImport(name) {
    if (!name) return;
    let workflow;
    try {
      const data = await request("/workflows/" + encodeURIComponent(name));
      workflow = data.workflow;
    } catch (_) { return; }
    if (!workflow) return;
    let added;
    try {
      added = await detectFieldsCore(apiNodes(workflow), [], new Set());
    } catch (_) { return; }
    /* Fresh overwrite: drop this workflow's unticked memory so a re-import
       starts clean (no stale "hidden" flags carried over). */
    const all = offStore();
    if (all[name]) { delete all[name]; NS.prefs?.set(OFF_KEY, all); }
    try {
      const saved = await request("/workflows/" + encodeURIComponent(name) + "/fields",
        jsonOptions("PUT", { fields: added }));
      if (S.currentName === name) {
        S.fields = saved.fields || added;
        S.autoAdded = added.length;
        S.autoKeys = new Set(added.map((field) => fieldKey(field.nodeId, field.key)));
        S.fieldsDirty = false;
        snapshotParams();
        renderHead(); renderList(); renderPreview(); updateExposedCounts();
      }
      if (added.length) notify(t("api.autoDetectedCommonParameters", { n: added.length }));
    } catch (_) {
      /* Backend route not restarted yet — leave fields visible, user can save. */
    }
    try { window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed")); } catch (_) { /* no-op */ }
  }

  function renderHead() {
    if (!D.name) return;
    D.name.textContent = S.currentName || t("api.noWorkflowSelected");
    D.sub.textContent = S.currentName
      ? t("api.nodesFieldsExposed", { n: nodeCount(), f: S.fields.length })
        + (S.autoAdded ? t("api.autoDetected", { n: S.autoAdded }) : "")
      : "";
    D.favorite.hidden = !S.currentName;
    D.rename.hidden = !S.currentName;
    D.danger.hidden = !S.currentName;
    if (D.catBtn) {
      D.catBtn.disabled = !S.currentName;
      D.catLabel.textContent = cat(S.category);
      if (D.catMenu && !D.catMenu.hidden) openCatMenu();
    }
    renderParamOrder();
  }

  /* ------------------------- category dropdown ------------------------- */

  function openCatMenu() {
    if (!D.catMenu || !D.catBtn) return;
    /* menuContentClass (host) + min-h-8 px-3 py-1.5 text-sm; the checked entry
       uses menuStyles' selectedMenuButtonClass. */
    const viewport = el("div", "ac-catviewport scrollbar-custom w-full");
    D.catMenu.replaceChildren(viewport);
    const entry = (label, value) => {
      const active = (S.category || "") === value;
      /* selectItemVariants({ layout: 'single' }) verbatim; `<button>` brings the
         UA text-align:center with it, so text-left is spelled out. */
      /* <button> 的 UA 背景要显式透明；data-[state=checked]:bg-muted 会覆盖它。 */
      const item = el("button", SELECT_ITEM + " border-0 bg-transparent text-left");
      item.appendChild(el("span", "truncate", label));
      item.type = "button";
      item.dataset.state = active ? "checked" : "unchecked";
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-checked", active ? "true" : "false");
      if (active) item.appendChild(el("i", "icon-[lucide--check] text-foreground"));
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        closeCatMenu();
        if (!active) saveCategory(value);
      });
      viewport.appendChild(item);
    };
    entry(cat(""), "");
    for (const c of S.categories) entry(cat(c), c);

    D.catMenu.hidden = false;
    D.catBtn.setAttribute("aria-expanded", "true");
    D.catBtn.dataset.state = "open";
    if (!catDocDown) {
      /* Outside-click / Escape close, bound only while the menu is open so a
         closed dialog leaves nothing listening on document. */
      catDocDown = (event) => {
        if (D.catMenu.hidden) return;
        if (D.catMenu.contains(event.target) || D.catBtn.contains(event.target)) return;
        closeCatMenu();
      };
      catDocKey = (event) => {
        if (event.key !== "Escape" || D.catMenu.hidden) return;
        /* Capture on window: the modal listens for Escape on window/document too,
           and a later-registered document listener never gets the first word. */
        event.stopImmediatePropagation(); event.preventDefault();
        closeCatMenu();
      };
      document.addEventListener("pointerdown", catDocDown, true);
      window.addEventListener("keydown", catDocKey, true);
    }
    const r = D.catBtn.getBoundingClientRect();
    /* selectContentClass 的 min-w-(--reka-select-trigger-width) 需要 Reka 注入的
       CSS 变量；我们是手搭浮层，自己写回 trigger 宽度，不再强制老值 192px。 */
    D.catMenu.style.setProperty("--reka-select-trigger-width", Math.round(r.width) + "px");
    D.catMenu.style.width = "";
    const w = Math.max(D.catMenu.offsetWidth, Math.round(r.width));
    const h = D.catMenu.offsetHeight;
    D.catMenu.style.width = w + "px";
    /* Right-aligned to the trigger: the list is wider than the button, and
       growing rightwards pushed it past the panel edge. */
    D.catMenu.style.left = Math.round(Math.min(Math.max(8, r.right - w), innerWidth - w - 8)) + "px";
    /* Flip above the trigger when the list would run off the bottom. */
    D.catMenu.style.top = (r.bottom + h > innerHeight - 8
      ? Math.max(8, Math.round(r.top - h - 6))
      : Math.round(r.bottom + 6)) + "px";
  }

  function closeCatMenu() {
    if (!D.catMenu) return;
    D.catMenu.hidden = true;
    if (D.catBtn) {
      D.catBtn.setAttribute("aria-expanded", "false");
      D.catBtn.dataset.state = "closed";
    }
    if (catDocDown) {
      document.removeEventListener("pointerdown", catDocDown, true);
      window.removeEventListener("keydown", catDocKey, true);
      catDocDown = null; catDocKey = null;
    }
  }

  async function saveCategory(category) {
    if (!S.currentName) return;
    try {
      await request("/workflows/" + encodeURIComponent(S.currentName) + "/category",
        jsonOptions("PUT", { category }));
      S.category = category;
      await loadWorkflows();
      renderList(); renderHead();
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
      notify(category ? t("api.categorySet", { category: cat(category) }) : t("api.categoryCleared"));
    } catch (error) {
      notify(error.message, true);
      renderHead();
    }
  }

  async function saveFields() {
    if (!S.currentName) return false;
    try {
      const data = await request("/workflows/" + encodeURIComponent(S.currentName) + "/fields",
        jsonOptions("PUT", { fields: S.fields }));
      S.fields = data.fields || [];
      S.fieldsDirty = false;
      /* Saved state becomes the new baseline: 保存为默认参数 disables again
         and the left 取消(revert) hides until the next edit. */
      snapshotParams();
      /* 默认值可能被后端夹进 min/max（或者解析成了别的写法），以落盘值为准
         回填，免得输入框还显示一个早就被改掉的数。 */
      for (const entry of entries) {
        const hit = S.fields.find((field) => String(field.nodeId) === String(S.inspecting)
          && String(field.key) === entry.key);
        if (!hit) continue;
        entry.original = hit.default;
        entry.draft = hit.default === null || hit.default === undefined ? "" : String(hit.default);
      }
      if (entries.length) paintNodeFields();
      renderHead(); updateExposedCounts();
      /* 画布上已建的节点要重新取一次字段表，才会显示新的默认值。 */
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
      /* Title + description is the host toast's own two-line form: the title
         says what happened, the second line says to what. */
      notify(t("api.configSaved"), { detail: S.currentName });
      return true;
    } catch (error) {
      notify(error.message, true);
      return false;
    }
  }

  /* ---------------------- upload / delete ---------------------- */

  async function onFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    for (const file of files) {
      try {
        let workflow;
        try { workflow = JSON.parse(await file.text()); }
        catch (_) { throw new Error(t("api.notValidJson", { name: file.name })); }
        const isUiWorkflow = !!workflow && typeof workflow === "object" &&
          Array.isArray(workflow.nodes) && Array.isArray(workflow.links);
        if (!isApiWorkflow(workflow) && !isUiWorkflow) {
          throw new Error(t("core.notWorkflowJsonExpectedRegular", { name: file.name }));
        }
        const name = file.name.replace(/\.json$/i, "");
        const saved = await request("/workflows", jsonOptions("POST", { name, workflow }));
        /* Import = fresh overwrite: re-detect and persist this workflow's
           parameters now (the only automatic write allowed). Do it before the
           read-only selectWorkflow so the panel shows the freshly saved fields. */
        await resetFieldsForImport(saved.name);
        await loadWorkflows();
        await selectWorkflow(saved.name);
        if (saved.converted) {
          notify(t("core.convertedToApi", { name: saved.name }));
          for (const warning of saved.warnings || []) notify(String(warning), true);
        } else {
          notify(t("api.saved", { name: saved.name }));
        }
      } catch (error) {
        notify(error.message, true);
      }
    }
  }

  /* ------------------------------ rename ------------------------------

     The title is the workflow's file stem. Renaming moves <name>.json and
     <name>.fields.json on the backend; nodes hold the same stem, so they are
     retargeted here (NS.flow.renameWorkflowRefs) before the shared list is
     refreshed — that event is also what makes every API selector show the new
     label without a reload. */

  const WF_NAME_RE = /^[^/\\:*?"<>|]{1,120}$/;

  function checkWorkflowName(name) {
    if (!name) return t("core.nameCannotEmpty");
    if (!WF_NAME_RE.test(name)) return t("core.nameCannotContain");
    if (name === "." || name === ".." || name.includes("..")) return t("api.nameCannotContain");
    if (name.toLowerCase().endsWith(".fields")) return t("api.nameCannotEndFields");
    return "";
  }

  /* ---------------------------- default workflow ----------------------------

     api_settings.json keeps one pinned default per category; the list endpoint
     resolves the fallback (first workflow of the category in drag order) when
     nothing is pinned, so `is_default` is always present on the rows. Pinning
     only writes that map -- the node selectors keep their own behaviour. */

  async function setDefaultWorkflow() {
    if (!S.currentName) return;
    const category = (S.category || "").trim();
    if (!category) { notify(t("api.setCategoryWorkflowFirst"), true); return; }
    const current = S.workflows.find((item) => wfKey(item) === S.currentName);
    if (current && current.default_pinned) {
      notify(t("api.alreadyDefault", { category: cat(category) }));
      return;
    }
    try {
      const data = await request(
        "/workflows/" + encodeURIComponent(S.currentName) + "/default",
        jsonOptions("POST", {}));
      if (data && Array.isArray(data.workflows)) S.workflows = data.workflows;
      renderList(); renderHead();
      /* The generate nodes mirror this list: the event is what makes every node
         that still follows its category default switch to the new one. */
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
      notify(t("api.setDefaultWorkflow"), { detail: t("api.category", { name: S.currentName, category: cat(category) }) });
    } catch (error) {
      notify(error.message, true);
    }
  }

  async function renameWorkflow() {
    if (!S.currentName) return;
    const from = S.currentName;
    const answer = await NS.api?.promptDialog?.({
      title: t("api.renameWorkflow"),
      message: "api.newWorkflowNameAllNodes",
      defaultValue: from,
    });
    if (answer === null || answer === undefined) return;
    const to = String(answer).trim();
    if (!to || to === from) return;
    const invalid = checkWorkflowName(to);
    if (invalid) { notify(invalid, true); return; }
    try {
      await request("/workflows/" + encodeURIComponent(from) + "/rename",
        jsonOptions("POST", { to }));
    } catch (error) {
      notify(error.message, true);
      return;
    }
    /* The template name IS the workflow id, so between the API call and the list
       refresh every referencing node holds a name the list does not know yet.
       Mute the nodes' "adopt the category default" watcher for that window or it
       rewrites all of them to the default and the rename silently disappears. */
    S.currentName = to;
    NS.flow?.setRenaming?.(true);
    let changed = 0;
    try {
      changed = NS.flow?.renameWorkflowRefs?.(from, to) || 0;
      await loadWorkflows();
    } finally {
      /* loadWorkflows already awaited, so the pending watchers have flushed. */
      NS.flow?.setRenaming?.(false);
    }
    renderHead();
    notify(t("api.renamed"), { detail: changed ? t("api.nodesUpdated", { to, n: changed }) : to });
  }

  async function removeWorkflow() {
    if (!S.currentName) return;
    const ok = await NS.api?.confirmDialog?.({
      title: t("api.deleteWorkflow"),
      message: t("core.sureWantDeleteWorkflow"),
      itemList: [S.currentName],
      type: "delete", key: "infcanvas-delete-workflow",
    });
    if (!ok) return;
    const name = S.currentName;
    try {
      await request("/workflows/" + encodeURIComponent(name), { method: "DELETE" });
      S.currentName = ""; S.currentWorkflow = null; S.fields = []; S.fieldsDirty = false;
      closeNodeFields();
      await loadWorkflows();
      renderHead(); renderPreview();
      notify(t("api.workflowDeleted"), { detail: name });
    } catch (error) {
      notify(error.message, true);
    }
  }

  /* ---------------------- graph preview ---------------------- */

  /* WorkflowPreview: auto-layout by dependency depth, columns offset so the
     longest column is centred. Edges are de-duplicated source->target. */
  function layout() {
    const workflow = apiNodes(S.currentWorkflow);
    const ids = Object.keys(workflow);
    const sourceOf = (id) => {
      const found = new Set();
      const inputs = workflow[id]?.inputs || {};
      for (const value of Object.values(inputs)) {
        if (Array.isArray(value) && value.length === 2 && workflow[String(value[0])]) {
          found.add(String(value[0]));
        }
      }
      return [...found];
    };
    const depth = new Map(), visiting = new Set();
    const visit = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      let level = 0;
      for (const up of sourceOf(id)) level = Math.max(level, visit(up) + 1);
      visiting.delete(id);
      depth.set(id, level);
      return level;
    };
    ids.forEach(visit);

    const levelCount = new Map();
    for (const id of ids) {
      const level = depth.get(id) || 0;
      levelCount.set(level, (levelCount.get(level) || 0) + 1);
    }
    const maxCount = Math.max(...levelCount.values(), 1);
    const rows = new Map();
    const exposed = new Map();
    for (const field of S.fields) {
      const id = String(field.nodeId);
      exposed.set(id, (exposed.get(id) || 0) + 1);
    }
    const nodes = ids.map((id) => {
      const level = depth.get(id) || 0;
      const row = rows.get(level) || 0;
      rows.set(level, row + 1);
      const offset = (maxCount - levelCount.get(level)) / 2;
      const info = workflow[id] || {};
      return {
        id,
        x: level * COL_STEP, y: (offset + row) * ROW_STEP,
        title: info._meta?.title || info.class_type || id,
        classType: info.class_type || "",
        hue: hueOf(info.class_type || id),
        exposed: exposed.get(id) || 0,
      };
    });

    const seen = new Set(), edges = [];
    for (const [id, info] of Object.entries(workflow)) {
      for (const value of Object.values(info?.inputs || {})) {
        if (!Array.isArray(value) || value.length !== 2) continue;
        const source = String(value[0]);
        if (!workflow[source]) continue;
        const key = `${source}->${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source, target: id });
      }
    }
    return { nodes, edges };
  }

  /* ---------------- exposed-parameter order panel ---------------- */

  /* One row per exposed field, in S.fields order (= fields.json = the node's
     settings popover order). Each row is a verbatim port of the node popover's
     WidgetGrid row, so the controls here look EXACTLY like the node's
     「API 参数」panel (number steppers / combobox / switch / text input). The
     only extra is the grip column, revealed while reordering. */
  const FIELD_VALUE = (field) => (field && field.default !== undefined && field.default !== null
    ? field.default : (field?.options?.[0] ?? ""));

  /* ---- default-parameter baseline / dirty tracking --------------------
     The right panel edits S.fields in place (default values, control modes,
     label/type via the inspector). We keep a deep snapshot of the last
     loaded/saved state so 「保存为默认参数」can stay disabled until something
     actually changed, and 「取消」can restore the exact prior parameters.

     Only the persisted field attributes matter for "changed"; React-style
     render churn never enters S.fields, so a plain structural JSON compare is
     both cheap (tens of rows) and exact. */
  function snapshotParams() {
    S.paramSnapshot = JSON.parse(JSON.stringify(S.fields));
  }
  function paramsChanged() {
    if (!S.paramSnapshot) return false;
    try {
      return JSON.stringify(S.fields) !== JSON.stringify(S.paramSnapshot);
    } catch (_) { return false; }
  }
  /* Restore the last loaded/saved parameter baseline. Returns true if a
     snapshot existed (so callers know a revert actually happened). */
  function revertDefaultParams() {
    if (!S.paramSnapshot) return false;
    S.fields = JSON.parse(JSON.stringify(S.paramSnapshot));
    S.fieldsDirty = false;
    /* renderHead() -> renderParamOrder() -> renderPromptArea() rebuilds every
       control (including the prompt textarea) from the restored fields. */
    renderHead();
    updateExposedCounts();
    return true;
  }

  /* Mutating a field object in place would also mutate orderSnapshot's shallow
     copy (see toggleParamOrder) and lose the ability to cancel. So every edit
     REPLACES the array slot with a new object carrying the new default. */
  const setFieldDefault = (index, value, silent) => {
    const field = S.fields[index];
    if (!field) return;
    const next = S.fields.slice();
    next[index] = { ...field, default: value };
    S.fields = next;
    S.fieldsDirty = true;
    /* The prompt textarea edits while typing — rebuilding the list here would
       steal focus on every keystroke. Its value is already in the DOM; only the
       action buttons need refreshing (save enabled, revert visible). */
    if (!silent) renderParamOrder();
    else syncParamActions();
  };
  /* Numeric controls step by the field's own step, clamped to min/max. */
  const stepFieldNum = (field, dir) => {
    const cur = Number(FIELD_VALUE(field));
    const step = Number(field?.step) > 0 ? Number(field.step) : 1;
    let value = (Number.isFinite(cur) ? cur : 0) + dir * step;
    const min = Number(field?.min), max = Number(field?.max);
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);
    /* Match the current value's integer/float nature (seed is an int). */
    const base = FIELD_VALUE(field);
    if (typeof base === "number" && Number.isInteger(base)) value = Math.round(value);
    return value;
  };

  function fieldTextLocal(field) {
    const value = FIELD_VALUE(field);
    if (typeof value === "boolean") return value ? t("core.on") : t("core.off");
    if (value === "" || value === null || value === undefined) return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    const step = String(field?.step ?? "");
    const dot = step.indexOf(".");
    const digits = dot < 0 ? 0 : step.length - dot - 1;
    return digits > 0 ? num.toFixed(Math.min(digits, 6)) : String(num);
  }
  function fieldFillLocal(field) {
    const min = Number(field?.min), max = Number(field?.max), step = Number(field?.step);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return 0;
    if (max <= min || (max - min) / step >= 100) return 0;
    return Math.max(0, Math.min(1, (Number(FIELD_VALUE(field)) - min) / (max - min))) * 100;
  }

  /* ---------------- widget popups (field dropdown / control chooser) ------
     The node's combobox and the 随机 button both OPEN a menu hosted on the
     node root (the settings card scrolls, so an in-menu child would be
     clipped). Do the same here: one menu at a time, mounted on the dialog's
     panel, positioned from the trigger rect, closed by outside press / Escape.
     Skins are the node's own class strings — 1:1 with the node. */
  let widgetMenu = null, widgetAnchor = null, widgetDocDown = null, widgetDocKey = null;
  function closeWidgetMenu() {
    if (widgetMenu) { widgetMenu.remove(); widgetMenu = null; }
    if (widgetAnchor) { delete widgetAnchor.dataset.acOpen; widgetAnchor = null; }
    if (widgetDocDown) {
      document.removeEventListener("pointerdown", widgetDocDown, true);
      widgetDocDown = null;
    }
    if (widgetDocKey) {
      window.removeEventListener("keydown", widgetDocKey, true);
      widgetDocKey = null;
    }
  }
  function openWidgetMenu(anchor, menu) {
    const reopening = widgetAnchor === anchor && widgetMenu && widgetMenu.className === menu.className;
    closeWidgetMenu();
    if (reopening) return null;
    (ui?.panel || document.body).appendChild(menu);
    widgetMenu = menu; widgetAnchor = anchor; anchor.dataset.acOpen = "1";
    /* Keep gestures inside the menu off the dialog (mask / Escape / close). */
    ["pointerdown", "mousedown", "dblclick", "wheel"].forEach((kind) =>
      menu.addEventListener(kind, (event) => event.stopPropagation()));
    widgetDocDown = (event) => {
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeWidgetMenu();
    };
    widgetDocKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation(); event.preventDefault();
      closeWidgetMenu();
    };
    document.addEventListener("pointerdown", widgetDocDown, true);
    window.addEventListener("keydown", widgetDocKey, true);
    /* Flush into layout before measuring so the menu has its real size. */
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.round(Math.min(Math.max(8, r.left), innerWidth - mw - 8)) + "px";
    menu.style.top = (r.bottom + mh > innerHeight - 8
      ? Math.max(8, Math.round(r.top - mh - 4))
      : Math.round(r.bottom + 4)) + "px";
    return menu;
  }
  /* The node's searchable combobox listbox, verbatim classes. */
  function openSelectMenu(anchor, field, index) {
    const menu = el("div", "icn__gpa-fsel ac-widget-menu");
    const searchRow = el("div", "icn__sel-search");
    const searchIcon = el("span", "shrink-0"); searchIcon.innerHTML = ICO.search;
    const search = el("input", "icn__sel-searchinput");
    search.type = "text"; search.placeholder = t("core.searchOptions"); search.spellcheck = false;
    searchRow.append(searchIcon, search);
    const list = el("div", "max-h-56 overflow-y-auto p-1 text-xs");
    menu.append(searchRow, list);
    if (!openWidgetMenu(anchor, menu)) return;
    const opts = (S.fields[index]?.options || []).map(String);
    const paint = () => {
      list.replaceChildren();
      const q = String(search.value || "").trim().toLowerCase();
      const hits = q ? opts.filter((o) => o.toLowerCase().includes(q)) : opts;
      hits.forEach((opt) => {
        const current = String(FIELD_VALUE(S.fields[index]) ?? "") === opt;
        const item = el("button", "flex h-8 w-full cursor-pointer items-center justify-between gap-3 "
          + "rounded-sm border-0 bg-transparent p-2 text-left outline-none select-none hover:bg-secondary "
          + (current ? "bg-primary/20 hover:bg-primary/20" : ""));
        item.type = "button";
        item.appendChild(el("span", "truncate", opt));
        if (current) { const tick = el("span", "size-3.5 shrink-0"); tick.innerHTML = ICO.check; item.appendChild(tick); }
        item.addEventListener("click", (event) => {
          event.stopPropagation(); closeWidgetMenu();
          setFieldDefault(index, opt);
        });
        list.appendChild(item);
      });
      if (!hits.length) list.appendChild(el("div", "p-2 text-xs text-muted-foreground", t("core.noMatchingOption")));
    };
    search.addEventListener("input", paint);
    paint();
    search.focus();
  }
  /* The node's ValueControlPopover: what happens to this 随机数 each run.
     The chosen mode is stored on the exposed field and saved with fields.json. */
  const CONTROL_MODES = [
    { mode: "fixed", icon: "pencilOff", title: "prompt.fixed", desc: "prompt.valueUnchanged" },
    { mode: "increment", text: "+1", title: "prompt.increment", desc: "prompt.value1MoveNextOption" },
    { mode: "decrement", text: "-1", title: "prompt.decrement", desc: "prompt.value1MovePreviousOption" },
    { mode: "randomize", icon: "shuffle", title: "prompt.randomize", desc: "prompt.randomizeValueAfterEachRun" },
  ];
  const fieldMode = (field) => field?.controlMode || "randomize";
  function openControlMenu(anchor, field, index) {
    const menu = el("div", "icn__gpa-modes ac-widget-menu");
    const inner = el("div", "w-full space-y-2 p-2");
    const intro = el("div", "px-1 pb-0.5 text-xs/tight text-muted-foreground");
    intro.append(document.createTextNode(t("core.autoUpdateValue") + " "),
      el("span", "font-medium text-foreground", t("core.after")),
      document.createTextNode(" " + t("core.runningWorkflow")));
    const group = el("div", "flex flex-col gap-0.5");
    inner.append(intro, group); menu.appendChild(inner);
    if (!openWidgetMenu(anchor, menu)) return;
    CONTROL_MODES.forEach((entry) => {
      const active = fieldMode(S.fields[index]) === entry.mode;
      const row = el("div", "flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left");
      const main = el("button", "flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 "
        + "bg-transparent p-0 text-left text-wrap");
      const tile = el("span", "flex size-6 shrink-0 items-center justify-center rounded-md border "
        + "border-solid border-border/50 bg-secondary");
      if (entry.icon) tile.innerHTML = ICO[entry.icon];
      else tile.appendChild(el("span", "text-xs font-normal text-foreground", entry.text));
      const copy = el("span", "flex min-w-0 flex-1 flex-col text-xs/tight font-normal");
      copy.append(el("span", "text-foreground", t(entry.title)), el("span", "text-muted-foreground", t(entry.desc)));
      main.append(tile, copy);
      const radio = el("button", "inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center "
        + "rounded-full border border-solid bg-transparent outline-none "
        + (active ? "border-primary" : "border-border"));
      if (active) radio.appendChild(el("span", "block size-1.5 rounded-full bg-primary"));
      const pick = (event) => {
        event.stopPropagation(); closeWidgetMenu();
        const next = S.fields.slice();
        next[index] = { ...next[index], controlMode: entry.mode };
        S.fields = next; S.fieldsDirty = true;
        renderParamOrder();
      };
      main.addEventListener("click", pick); radio.addEventListener("click", pick);
      row.append(main, radio); group.appendChild(row);
    });
  }

  /* Build the control cell exactly as the node popover does — but LIVE: every
     control writes its edited value back to field.default via setFieldDefault.
     The index is needed because that helper replaces the array slot. */
  function buildFieldControl(field, index) {
    const iconBtn = (glyph, title, onClick) => {
      const b = el("button", "relative flex shrink-0 cursor-pointer items-center justify-center "
        + "border-none h-full w-6 rounded-none bg-transparent p-0 text-muted-foreground "
        + "hover:bg-accent disabled:pointer-events-none disabled:opacity-30");
      b.type = "button"; bindTip(b, () => t(title)); b.innerHTML = glyph;
      b.tabIndex = -1;
      if (onClick) b.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
      return b;
    };
    const type = field?.type;
    if (type === "number" || type === "slider" || type === "random") {
      const box = el("div", "relative flex w-full items-stretch overflow-hidden rounded-lg "
        + "bg-secondary text-xs text-foreground h-7.5 hover:bg-accent");
      const clip = el("span", "pointer-events-none absolute inset-0 overflow-clip rounded-lg");
      const fill = el("span", "block size-full bg-primary/15");
      fill.style.width = fieldFillLocal(field) + "%";
      clip.appendChild(fill);
      const numWrap = el("div", "relative my-0.25 min-w-[4ch] flex-1 py-1.5");
      const input = el("input", "absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0");
      input.type = "text"; input.inputMode = "decimal";
      input.value = fieldTextLocal(field);
      input.spellcheck = false;
      const commit = () => {
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) { input.value = fieldTextLocal(S.fields[index]); return; }
        setFieldDefault(index, parsed);
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "ArrowUp") { event.preventDefault(); setFieldDefault(index, stepFieldNum(S.fields[index], 1)); }
        if (event.key === "ArrowDown") { event.preventDefault(); setFieldDefault(index, stepFieldNum(S.fields[index], -1)); }
      });
      numWrap.appendChild(input);
      box.append(clip,
        iconBtn(ICO.minus, "core.decrease", () => setFieldDefault(index, stepFieldNum(S.fields[index], -1))),
        numWrap);
      if (type === "random") {
        const modeEntry = CONTROL_MODES.find((m) => m.mode === fieldMode(field)) || CONTROL_MODES[3];
        /* Match the node's ValueControlButton: 固定值 = transparent/grey glyph,
           every other mode = blue capsule. Glyph size-3 (12px), not 16px. */
        const badge = el("button", "mr-1 flex h-4.5 w-8 shrink-0 cursor-pointer items-center "
          + "justify-center self-center rounded-full border-none "
          + (modeEntry.mode === "fixed"
            ? "bg-transparent text-muted-foreground hover:bg-accent"
            : "bg-primary/30 text-primary hover:bg-primary/27"));
        badge.type = "button"; badge.tabIndex = -1;
        bindTip(badge, () => t(modeEntry.title) + t("prompt.clickChangeMode"));
        if (modeEntry.icon) {
          badge.innerHTML = ICO[modeEntry.icon].replace("size-4", "size-3");
        } else badge.appendChild(el("span", "text-xs font-normal", modeEntry.text));
        /* The badge is NOT "randomize now" — it OPENS the value-control chooser,
           exactly like the host's ValueControlButton. */
        badge.addEventListener("click", (event) => {
          event.stopPropagation(); openControlMenu(badge, field, index);
        });
        box.appendChild(badge);
      }
      box.appendChild(iconBtn(ICO.plus, "controls.increase", () => setFieldDefault(index, stepFieldNum(S.fields[index], 1))));
      return box;
    }
    if (type === "select") {
      const box = el("div", "flex w-full min-w-0 items-center overflow-hidden rounded-lg "
        + "bg-secondary text-foreground h-7.5 hover:bg-accent");
      const btn = el("button", "flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden "
        + "border-none bg-transparent p-0 outline-none");
      btn.type = "button";
      const label = el("span", "min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs",
        String(FIELD_VALUE(field) ?? ""));
      btn.appendChild(label);
      const chev = el("button", "flex h-full w-6 shrink-0 cursor-pointer items-center justify-center "
        + "border-none bg-transparent outline-none");
      chev.type = "button"; chev.innerHTML = ICO.chevron;
      /* Host WidgetSelectDefault: click OPENS a searchable listbox (never a
         silent cycle), with the same classes as the node's own dropdown. */
      const pick = (event) => { event.stopPropagation(); openSelectMenu(box, field, index); };
      btn.setAttribute("role", "combobox");
      btn.addEventListener("click", pick);
      chev.addEventListener("click", pick);
      box.append(btn, chev);
      return box;
    }
    if (type === "switch") {
      const wrap = el("div", "-m-1 ml-auto flex w-fit items-center gap-2 rounded-full p-1");
      const on = FIELD_VALUE(field) === true || FIELD_VALUE(field) === "true";
      const btn = el("button", "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation "
        + "items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none "
        + "transition-shadow focus-visible:ring-1 focus-visible:ring-ring");
      btn.type = "button"; btn.dataset.state = on ? "checked" : "unchecked";
      const track = el("span", "pointer-events-none inline-flex h-5 w-9 items-center rounded-full "
        + "border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary");
      const knob = el("span", "pointer-events-none block size-4 rounded-full bg-background shadow-sm "
        + "transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0");
      knob.dataset.state = on ? "checked" : "unchecked";
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        setFieldDefault(index, !(FIELD_VALUE(S.fields[index]) === true || FIELD_VALUE(S.fields[index]) === "true"));
      });
      track.appendChild(knob); btn.appendChild(track); wrap.appendChild(btn);
      return wrap;
    }
    /* text / textarea / fallback */
    const input = el("input", "flex w-full min-w-0 appearance-none rounded-lg border-none bg-secondary "
      + "px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 "
      + "focus-visible:ring-ring focus-visible:outline-none");
    input.value = String(FIELD_VALUE(field) ?? "");
    input.spellcheck = false;
    input.addEventListener("change", (event) => setFieldDefault(index, event.target.value));
    return input;
  }

  /* Same advanced/basic split as infcanvas-flow.js: an explicit `advanced`
     flag wins; legacy fields fall back to the basic-label whitelist. */
  const BASIC_LABELS = [
    "field.promptEnhancement", "field.prompt", "field.aspectRatio", "field.megapixels", "field.upscaleFactor", "field.seed",
    "Prompt", "Style", "Lyrics", "Caption",
    "Aspect Ratio", "Megapixels", "Multiple", "Width", "Height", "Seed",
  ];
  const isAdvancedField = (field) => (typeof field?.advanced === "boolean"
    ? field.advanced
    : !BASIC_LABELS.includes(String(field?.label || "").trim()));

  /* EVERY exposed multiline-text field gets its own large standalone box — we
     no longer pick just one. Whatever the user exposes (by type text/textarea)
     is rendered below the card, in S.fields order, each bound to its own index.
     Names are irrelevant (no 提示词 lock), so 风格描述 / 歌词 / 描述 all work,
     and re-ordering the boxes re-orders the underlying fields. Returns
     [{ field, index }] for every text/textarea field.
     NOTE: infcanvas-flow.js has its own promptField() with the old single-box
     name lock; keep the two in sync if that one is changed too. */
  function findPromptFields() {
    const isText = (f) => f?.type === "text" || f?.type === "textarea";
    return S.fields.map((field, index) => ({ field, index })).filter((e) => isText(e.field));
  }

  /* Standalone textareas below the card, one per exposed text/textarea field.
     The label stack keeps the node panel classes (icn__gpa-box/label); the
     textarea itself uses the host's own comfy-multiline-input class so it is
     pixel-identical to a native ComfyUI prompt box. In sort mode each row grows
     a grip and joins the SAME global-index drag reordering the card rows use. */
  function renderPromptArea() {
    if (!D.promptBox) return;
    const hits = findPromptFields();
    D.promptBox.replaceChildren();
    if (!hits.length) { D.promptBox.hidden = true; return; }
    D.promptBox.hidden = false;
    const editing = S.orderEditing;
    hits.forEach(({ field, index }) => {
      const row = el("div", "ac-prompt-row"
        + (!editing && S.orderDrag === index ? " is-dragging" : "")
        + (editing && S.orderDrop === index && S.orderDrag !== index ? " is-drop" : ""));
      row.dataset.index = String(index);
      row.dataset.nodeId = String(field.nodeId);
      if (S.spotlight === String(field.nodeId)) row.classList.add("is-spotlight");
      row.addEventListener("click", () => spotlightNode(field.nodeId));
      const grip = el("div", "ac-prow-grip");
      grip.innerHTML = ICO.grip;
      row.appendChild(grip);
      const box = el("label", "icn__gpa-box");
      box.appendChild(el("span", "text-xs font-normal text-foreground", field.label || t("field.prompt")));
      /* Host's own node textarea class — pixel-identical to a ComfyUI prompt
         box (mono 10px, var(--input) bg, no radius). ac-prompt-area only adds
         layout min-height; placeholder uses the host muted-foreground token. */
      const area = el("textarea", "comfy-multiline-input ac-prompt-area placeholder:text-muted-foreground");
      area.value = String(FIELD_VALUE(field) ?? "");
      area.spellcheck = false;
      area.placeholder = t("core.describeWhatWantGenerate");
      area.addEventListener("input", (event) => setFieldDefault(index, event.target.value, true));
      box.appendChild(area);
      row.appendChild(box);
      if (editing) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => onOrderDragStart(event, index));
        row.addEventListener("dragover", (event) => onOrderDragOver(event, index));
        row.addEventListener("drop", (event) => onOrderDrop(event, index));
        row.addEventListener("dragend", onOrderDragEnd);
      }
      D.promptBox.appendChild(row);
    });
  }

  function toggleParamsAdvanced() {
    S.paramsShowAdvanced = !S.paramsShowAdvanced;
    renderParamOrder();
  }

  /* Refresh just the parameter action buttons without rebuilding the field
     rows (used on every keystroke of the prompt textarea, where a full render
     would steal focus). Sort mode wins: while sorting only 确定顺序/取消顺序
     are shown. Otherwise 保存为默认参数 is enabled only when params actually
     differ from the baseline, and 取消(恢复参数) mirrors that state on its left. */
  function syncParamActions() {
    if (!D.paramsSave || !D.paramsRevert) return;
    const editing = S.orderEditing;
    const changed = paramsChanged() && !!S.fields.length;
    D.paramsRevert.hidden = editing || !changed;
    D.paramsSave.hidden = editing;
    D.paramsSave.disabled = !changed;
    D.paramsEdit.hidden = editing || !S.fields.length;
    D.paramsEdit.disabled = !S.fields.length;
    D.paramsConfirm.hidden = !editing;
    D.paramsCancel.hidden = !editing;
  }

  function renderParamOrder() {
    if (!D.paramsList) return;
    const editing = S.orderEditing;
    D.params.classList.toggle("is-sorting", editing);

    /* Every exposed text/textarea field is rendered as its own textarea below
       the card — never a settings row. Exclude ALL of them from the card (list,
       badge, ordering); they are handled by renderPromptArea instead. */
    renderPromptArea();
    const promptSet = new Set(findPromptFields().map((e) => e.field));
    const cardFields = S.fields.filter((f) => !promptSet.has(f));
    /* Node's widget split: visible fields = all when expanded, else basics. */
    const advanced = cardFields.filter(isAdvancedField);
    const visible = S.paramsShowAdvanced ? cardFields : cardFields.filter((f) => !isAdvancedField(f));
    /* Badge shows the VISIBLE count, exactly like the node's popcnt. */
    D.paramsCount.textContent = visible.length ? String(visible.length) : "";

    /* Normal mode: 保存为默认参数 (enabled only when params changed) + its left
       取消(revert) + reorder entry. Sort mode: confirm/cancel. */
    syncParamActions();

    /* NodeFooter band: only when there are advanced fields, and its label/icon
       mirror the node (隐藏/显示高级输入 + chevron-up / settings-2). */
    D.paramsMore.hidden = !advanced.length;
    if (advanced.length) {
      D.paramsMoreLabel.textContent = t(S.paramsShowAdvanced ? "core.hideAdvancedInputs" : "core.showAdvancedInputs");
      D.paramsMoreIcon.innerHTML = S.paramsShowAdvanced ? ICO.chevronUp : ICO.settings2;
      bindTip(D.paramsMoreBtn, () => (D.paramsMoreLabel.textContent) + "（" + advanced.length + " " + t("core.items") + "）");
    }

    /* WidgetGrid rows: host bg/text utility classes verbatim. Shell is now the
       native card above, so only the row grid itself lives here. */
    const grid = el("div", "relative grid "
      + "grid-cols-[min-content_minmax(80px,min-content)_minmax(125px,1fr)] gap-y-1 "
      + "bg-card px-3 py-3 text-xs text-foreground");
    D.paramsList.replaceChildren();
    if (!cardFields.length) {
      D.paramsEmpty.hidden = false;
      D.paramsList.appendChild(D.paramsEmpty);
      return;
    }
    D.paramsEmpty.hidden = true;
    /* Iterate visible fields but keep the ORIGINAL index for drag + edits. */
    visible.forEach((field) => {
      const index = S.fields.indexOf(field);
      const row = el("div", "group col-span-full grid grid-cols-subgrid items-stretch ac-prow"
        + (!editing && S.orderDrag === index ? " is-dragging" : "")
        + (editing && S.orderDrop === index && S.orderDrag !== index ? " is-drop" : ""));
      row.dataset.index = String(index);
      row.dataset.nodeId = String(field.nodeId);
      if (S.spotlight === String(field.nodeId)) row.classList.add("is-spotlight");
      row.addEventListener("click", () => spotlightNode(field.nodeId));
      /* native WidgetGrid has an empty w-3 first cell; the grip lives there. */
      const grip = el("div", "ac-prow-grip z-10 flex items-stretch w-3");
      grip.innerHTML = ICO.grip;
      const wrap = el("div", "col-span-2 grid min-w-0 grid-cols-subgrid justify-between gap-2");
      const label = el("div", "content-center-safe truncate", field.label || fieldKey(field.nodeId, field.key));
      bindTip(label, field.label || fieldKey(field.nodeId, field.key));
      const cell = el("div", "relative min-w-0 flex-1");
      const inner = el("div", "min-w-0 cursor-default rounded-lg transition-all");
      inner.appendChild(buildFieldControl(field, index));
      cell.appendChild(inner);
      wrap.append(label, cell);
      row.append(grip, wrap);
      if (editing) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => onOrderDragStart(event, index));
        row.addEventListener("dragover", (event) => onOrderDragOver(event, index));
        row.addEventListener("drop", (event) => onOrderDrop(event, index));
        row.addEventListener("dragend", onOrderDragEnd);
      }
      grid.appendChild(row);
    });
    D.paramsList.appendChild(grid);
  }

  function toggleParamOrder() {
    if (!S.fields.length) return;
    S.orderEditing = true;
    S.orderSnapshot = S.fields.slice();
    S.orderDrag = -1; S.orderDrop = -1;
    renderParamOrder();
  }

  function restoreOrderClasses() {
    /* Both the card rows and the standalone text boxes share the same global
       S.fields index, so highlight them together during a drag. */
    const rows = [
      ...(D.paramsList ? D.paramsList.querySelectorAll(".ac-prow") : []),
      ...(D.promptBox ? D.promptBox.querySelectorAll(".ac-prompt-row") : [])
    ];
    rows.forEach((row) => {
      const index = Number(row.dataset.index);
      row.classList.toggle("is-dragging", S.orderDrag === index);
      row.classList.toggle("is-drop", S.orderDrop === index && S.orderDrag !== index);
    });
  }
  function onOrderDragStart(event, index) {
    S.orderDrag = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    }
    restoreOrderClasses();
  }
  function onOrderDragOver(event, index) {
    if (S.orderDrag < 0) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (S.orderDrop !== index) { S.orderDrop = index; restoreOrderClasses(); }
  }
  function onOrderDrop(event, index) {
    event.preventDefault();
    const from = S.orderDrag;
    S.orderDrag = -1; S.orderDrop = -1;
    if (from < 0 || from === index) { renderParamOrder(); return; }
    const list = [...S.fields];
    const [moved] = list.splice(from, 1);
    list.splice(index, 0, moved);
    S.fields = list;
    renderParamOrder();
  }
  function onOrderDragEnd() {
    S.orderDrag = -1; S.orderDrop = -1;
    restoreOrderClasses();
  }

  /* Save the default values edited in the right-hand panel (S.fields carries
     the new defaults). saveFields() persists both the defaults and the current
     row order to the workflow; the editor stays in normal mode. */
  async function saveDefaultParams() {
    if (S.orderEditing || !S.fields.length) return;
    const ok = await saveFields();
    if (ok) notify(t("api.defaultParametersSaved"));
  }

  async function confirmParamOrder() {
    if (!S.orderEditing) return;
    const ok = await saveFields();
    if (!ok) return;                       /* save failed: stay in edit mode */
    S.orderEditing = false;
    S.orderSnapshot = null;
    S.orderDrag = -1; S.orderDrop = -1;
    renderParamOrder();
    notify(t("api.parameterOrderSaved"));
  }

  function cancelParamOrder() {
    if (S.orderSnapshot) S.fields = S.orderSnapshot.slice();
    S.orderEditing = false;
    S.orderSnapshot = null;
    S.orderDrag = -1; S.orderDrop = -1;
    renderParamOrder();
  }

  function renderPreview() {
    if (!D.scene) return;
    const { nodes, edges } = layout();
    D.scene.replaceChildren();

    const maxX = Math.max(0, ...nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(0, ...nodes.map((n) => n.y + NODE_H));
    D.scene.style.width = maxX + "px";
    D.scene.style.height = maxY + "px";

    const NS_SVG = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS_SVG, "svg");
    svg.setAttribute("class", "ac-edges");
    svg.setAttribute("width", String(maxX));
    svg.setAttribute("height", String(maxY));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const sx = a.x + NODE_W, sy = a.y + NODE_H / 2;
      const tx = b.x, ty = b.y + NODE_H / 2;
      const bend = Math.max(30, Math.abs(tx - sx) * 0.5);
      const path = document.createElementNS(NS_SVG, "path");
      path.setAttribute("class", "ac-edge");
      path.setAttribute("d", `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`);
      svg.appendChild(path);
    }
    D.scene.appendChild(svg);

    for (const node of nodes) {
      const card = el("div", "ac-node" + (node.exposed ? " is-configurable" : ""));
      card.style.left = node.x + "px";
      card.style.top = node.y + "px";
      card.style.setProperty("--n-hue", String(node.hue));
      card.dataset.nodeId = node.id;
      const title = el("div", "ac-node-title");
      title.appendChild(el("span", "ac-node-label", node.title));
      title.appendChild(el("span", "ac-node-id", "#" + node.id));
      const type = el("div", "ac-node-type");
      type.appendChild(el("span", "ac-node-label", node.classType));
      if (node.exposed) type.appendChild(el("span", "ac-node-count ac-exposed", node.exposed + t("core.used")));
      card.append(title, type, el("span", "ac-handle ac-handle--in"), el("span", "ac-handle ac-handle--out"));
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        clearSpotlight();
        openNodeFields(node.id);
      });
      D.scene.appendChild(card);
    }

    D.empty.hidden = !!S.currentWorkflow;
    D.tip.hidden = !S.currentWorkflow || !!S.fields.length;
    fit();
  }

  function updateExposedCounts() {
    if (!D.scene) return;
    const counts = new Map();
    for (const field of S.fields) {
      const id = String(field.nodeId);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const card of D.scene.querySelectorAll(".ac-node")) {
      const id = card.dataset.nodeId;
      const count = counts.get(id) || 0;
      card.classList.toggle("is-configurable", count > 0);
      const type = card.querySelector(".ac-node-type");
      if (!type) continue;
      const badge = type.querySelector(".ac-exposed");
      if (badge) badge.remove();
      if (count) type.appendChild(el("span", "ac-node-count ac-exposed", count + t("core.used")));
    }
    if (D.tip) D.tip.hidden = !S.currentWorkflow || !!S.fields.length;
  }

  /* Field→node spotlight. Selecting an exposed field on the right highlights
     the node that owns it in the preview, and pans that node into view if it is
     off-screen. Selecting the same field again clears it. Pure DOM state, no
     data mutation — safe to call during render. */
  function spotlightNode(nodeId) {
    const id = nodeId == null ? "" : String(nodeId);
    if (!id) return;
    /* Clicking a field always SELECTS its node (never toggles off) — textarea
       fields are clicked repeatedly while typing, so a toggle would make the
       ring blink. Clearing happens on blank/node click or workflow switch. */
    S.spotlight = id;
    // node cards
    if (D.scene) {
      for (const card of D.scene.querySelectorAll(".ac-node")) {
        card.classList.toggle("is-spotlight", card.dataset.nodeId === id);
      }
    }
    // all fields owned by that node light up together, making it obvious which
    // parameters live in the highlighted node
    for (const scope of [D.paramsList, D.promptBox]) {
      if (!scope) continue;
      for (const row of scope.querySelectorAll("[data-node-id]")) {
        row.classList.toggle("is-spotlight", row.dataset.nodeId === id);
      }
    }
    revealNode(id);
  }

  function clearSpotlight() {
    if (!S.spotlight && !D.scene?.querySelector(".ac-node.is-spotlight")) return;
    S.spotlight = "";
    if (D.scene) for (const c of D.scene.querySelectorAll(".ac-node")) c.classList.remove("is-spotlight");
    for (const scope of [D.paramsList, D.promptBox])
      if (scope) for (const r of scope.querySelectorAll(".is-spotlight")) r.classList.remove("is-spotlight");
  }

  /* Pan (never zoom) so the node sits in the viewport centre when it is not
     already fully visible. Keeps the user's zoom level intact. */
  function revealNode(nodeId) {
    if (!D.scene || !D.viewport) return;
    const card = [...D.scene.querySelectorAll(".ac-node")].find((c) => c.dataset.nodeId === nodeId);
    if (!card) return;
    const nx = parseFloat(card.style.left) || 0;
    const ny = parseFloat(card.style.top) || 0;
    const rect = D.viewport.getBoundingClientRect();
    const sx = S.panX + nx * S.zoom;
    const sy = S.panY + ny * S.zoom;
    const w = NODE_W * S.zoom, h = NODE_H * S.zoom;
    const visible = sx >= 0 && sy >= 0 && sx + w <= rect.width && sy + h <= rect.height;
    if (visible) return;
    S.panX = rect.width / 2 - (nx + NODE_W / 2) * S.zoom;
    S.panY = rect.height / 2 - (ny + NODE_H / 2) * S.zoom;
    applyTransform();
  }

  function applyTransform() {
    if (!D.scene || !D.viewport) return;
    D.scene.style.transform = `translate(${S.panX}px, ${S.panY}px) scale(${S.zoom})`;
    if (D.zoomLabel) D.zoomLabel.textContent = Math.round(S.zoom * 100) + "%";
    const gap = 18 * S.zoom;
    D.viewport.style.backgroundSize = `${gap}px ${gap}px`;
    D.viewport.style.backgroundPosition = `${S.panX}px ${S.panY}px`;
  }

  function setZoom(next) {
    S.zoom = clampZoom(next);
    applyTransform();
  }
  function zoomTo(next) {
    const rect = D.viewport.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const z = clampZoom(next);
    const ratio = z / S.zoom;
    S.panX = cx - (cx - S.panX) * ratio;
    S.panY = cy - (cy - S.panY) * ratio;
    S.zoom = z;
    applyTransform();
  }
  function fit() {
    if (!D.viewport || !D.scene) return;
    const rect = D.viewport.getBoundingClientRect();
    const w = parseFloat(D.scene.style.width) || 0;
    const h = parseFloat(D.scene.style.height) || 0;
    if (!w || !h || !rect.width || !rect.height) { setZoom(1); return; }
    /* VueFlow fitView({ padding:0.1, maxZoom:1 }) */
    const z = clampZoom(Math.min(rect.width * 0.9 / w, rect.height * 0.9 / h, 1));
    S.zoom = z;
    S.panX = (rect.width - w * z) / 2;
    S.panY = (rect.height - h * z) / 2;
    applyTransform();
  }

  /* ---------------------- node fields inspector ---------------------- */

  function openNodeFields(nodeId) {
    const node = apiNodes(S.currentWorkflow)[String(nodeId)];
    if (!node) return;
    inspectorSnapshot = {
      name: S.currentName,
      nodeId: String(nodeId),
      fields: JSON.parse(JSON.stringify(S.fields)),
      fieldsDirty: S.fieldsDirty,
      autoKeys: new Set(S.autoKeys),
      off: offFields(S.currentName),
    };
    S.inspecting = String(nodeId);
    renderNodeFields();
  }
  function closeNodeFields() {
    inspectorSnapshot = null;
    S.inspecting = "";
    if (D.nfMask) D.nfMask.hidden = true;
  }
  /* 取消 = 把这次打开面板后的所有改动丢掉：字段表、脏标记、自动识别集合，
     以及取消勾选自动字段时写进 localStorage 的「不再自动暴露」名单。 */
  function cancelNodeFields() {
    const snap = inspectorSnapshot;
    if (snap && snap.name === S.currentName) {
      S.fields = JSON.parse(JSON.stringify(snap.fields));
      S.fieldsDirty = snap.fieldsDirty;
      S.autoKeys = new Set(snap.autoKeys);
      writeOffFields(snap.name, snap.off);
    }
    closeNodeFields();
    renderHead();
    updateExposedCounts();
  }

  function renderNodeFields() {
    if (!D.nfMask) return;
    const node = inspectNode();
    if (!node || !S.inspecting) { D.nfMask.hidden = true; return; }
    D.nfMask.hidden = false;
    D.nfTitleText.textContent = node._meta?.title || node.class_type || "#" + S.inspecting;
    D.nfSub.textContent = `${node.class_type || ""} · #${S.inspecting}`;

    /* NodeFields.buildEntries(): only literal inputs; links (arrays) and
       nested objects cannot be exposed through a form. */
    const saved = new Map(inspectFields().map((field) => [field.key, field]));
    entries = [];
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) || (value !== null && typeof value === "object")) continue;
      const field = saved.get(key);
      let options = [...(field?.options || [])];
      if (!options.length && typeof value === "string" && value) options = [value];
      /* 默认值优先取 S.fields 里的那份：它可能是刚改过、还没保存的值。直接读
         模板 `value` 会让「改 → 完成 → 再打开」又跳回模板里的旧数，看起来像
         没有改成功。 */
      const shown = field && field.default !== undefined ? field.default : value;
      entries.push({
        key, enabled: !!field,
        /* Filled by the default-parameter pass, not by the user: unticking it
           has to be remembered or the next open would resurrect it. */
        auto: S.autoKeys.has(fieldKey(S.inspecting, key)),
        type: field?.type || guessType(value, key),
        label: field?.label || "", options,
        /* 高级参数。文件里写了布尔值就以它为准；老文件没有这个键，按标签
           白名单兜底——这样勾选框显示的状态和节点里「显不显示」是一致的。
           还没暴露的参数默认算普通，用户刚勾上就应当看得见。 */
        advanced: field
          ? (typeof field.advanced === "boolean" ? field.advanced : defaultAdvanced(field.label))
          : false,
        min: field?.min ?? "", max: field?.max ?? "", step: field?.step ?? "",
        /* 默认值 = 模板里这个输入自己存的值，改它就是改模板（保存时写回）。
           `original` 留着做类型判断：后端要按它的类型把文本解析回去，否则
           INT 字段会写成 "20"，ComfyUI 直接拒。`draft` 是输入框里的文本。 */
        original: shown,
        draft: shown === null || shown === undefined ? "" : String(shown),
        /* {{image}} / {{prompt}} 这类占位符在运行时由连线或节点内容填，
           改它会破坏替换，所以这一行禁用编辑。 */
        placeholder: typeof value === "string" && value.includes("{{"),
      });
    }
    paintNodeFields();
  }

  /* Checkbox.vue's string, with our own data-state: the host drives it with
     reka-ui, we write the same attribute from the change handler. Shared by the
     「启用」and the「高级」box so the two can never drift apart. */
  function checkboxEl(checked) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "inline-flex size-4 shrink-0 cursor-pointer appearance-none items-center "
      + "justify-center rounded-sm border bg-transparent text-background outline-none "
      + "focus-visible:ring-1 focus-visible:ring-ring "
      + "data-[state=checked]:border-primary data-[state=checked]:bg-primary";
    box.checked = checked;
    box.setAttribute("data-state", checked ? "checked" : "unchecked");
    return box;
  }

  function paintNodeFields() {
    D.nfList.replaceChildren();
    if (!entries.length) {
      D.nfList.appendChild(el("div", "rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground",
        t("api.nodeHasNoDirectlyEditable")));
    }
    for (const entry of entries) {
      const item = el("div", "rounded-lg border bg-card px-3 py-2.5");
      const head = el("div", "flex items-center gap-2");
      const enable = el("label", "flex min-w-0 flex-1 cursor-pointer items-center gap-2");
      const check = checkboxEl(entry.enabled);
      const tick = el("i", "icon-[lucide--check] size-3 text-background");
      tick.hidden = !entry.enabled;
      check.addEventListener("change", () => {
        entry.enabled = check.checked;
        check.setAttribute("data-state", check.checked ? "checked" : "unchecked");
        tick.hidden = !check.checked;
        /* 记「不再自动暴露」：不限 auto 字段。任何被用户主动取消勾选的
           字段（含原有存量字段）都要记，否则切换工作流时 loadFields →
           detectFields 会把它当新字段重新检测出来并写回，看起来像「去掉
           的字段又出现了」。重新勾选则清掉这条记忆。 */
        const id = fieldKey(S.inspecting, entry.key);
        setOffField(S.currentName, id, !check.checked);
        if (!check.checked) S.autoKeys.delete(id);
        paintNodeFields(); syncNodeFields();
      });
      const checkWrap = el("span", "relative flex size-4 shrink-0 items-center justify-center");
      checkWrap.append(check, tick);
      const key = el("span", "min-w-0 truncate text-sm text-foreground", entry.key);
      bindTip(key, entry.key);
      enable.append(checkWrap, key);
      head.appendChild(enable);

      /* 高级参数：勾上的在节点面板里折进「显示高级输入」，不勾的直接摆在
         底栏齿轮里。只有「已启用」才出现——没暴露的参数谈不上高级，而勾选
         状态留在 entry 上，所以取消再勾回来不会丢。 */
      if (entry.enabled) {
        const advLabel = el("label", "ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground");
        bindTip(advLabel, () => t("api.advancedFlagHint"));
        const adv = checkboxEl(entry.advanced);
        const advTick = el("i", "icon-[lucide--check] size-3 text-background");
        advTick.hidden = !entry.advanced;
        adv.addEventListener("change", () => {
          entry.advanced = adv.checked;
          adv.setAttribute("data-state", adv.checked ? "checked" : "unchecked");
          advTick.hidden = !adv.checked;
          syncNodeFields();
        });
        const advWrap = el("span", "relative flex size-4 shrink-0 items-center justify-center");
        advWrap.append(adv, advTick);
        advLabel.append(advWrap, el("span", "", t("api.advanced")));
        head.appendChild(advLabel);
      }

      /* Default value is edited ONLY in the right-hand API 参数 panel now;
         the inspector no longer shows an inline default row. */
      item.appendChild(head);

      const detail = el("div", "mt-2 flex flex-col gap-2 border-t pt-2");
      detail.hidden = !entry.enabled;
      if (entry.enabled) {
        const row = el("div", "flex gap-2");
        const select = el("select", "h-6 w-28 shrink-0 cursor-pointer rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
        for (const [value, label] of TYPE_OPTIONS) {
          const option = document.createElement("option");
          option.value = value; option.textContent = t(label);
          if (value === entry.type) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener("change", () => {
          entry.type = select.value;
          paintNodeFields(); syncNodeFields();
        });
        const labelInput = el("input", "h-6 min-w-0 flex-1 rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
        labelInput.placeholder = t("api.displayName");
        labelInput.spellcheck = false;
        labelInput.value = entry.label;
        labelInput.addEventListener("input", () => { entry.label = labelInput.value; syncNodeFields(); });
        row.append(select, labelInput);
        detail.appendChild(row);

        /* Default value is edited in the right-hand API 参数 panel, not here. */
        if (entry.type === "select") {
          const options = el("div", "flex flex-col gap-2");
          entry.options.forEach((value, index) => {
            const optionRow = el("div", "flex gap-2");
            const input = el("input", "h-6 min-w-0 flex-1 rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
            input.placeholder = t("api.option", { n: index + 1 });
            input.spellcheck = false;
            input.value = value;
            input.addEventListener("input", () => { entry.options[index] = input.value; syncNodeFields(); });
            const remove = el("button", "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-muted-foreground hover:bg-accent"); remove.innerHTML = ICO.x;
            remove.type = "button"; bindTip(remove, () => t("api.deleteOption"));
            remove.addEventListener("click", () => {
              entry.options.splice(index, 1); paintNodeFields(); syncNodeFields();
            });
            optionRow.append(input, remove);
            options.appendChild(optionRow);
          });
          const add = el("button", "" + BTN_SECONDARY + " w-full", t("api.addOption"));
          add.type = "button";
          add.addEventListener("click", () => {
            entry.options.push(""); paintNodeFields(); syncNodeFields();
          });
          options.appendChild(add);
          detail.appendChild(options);
        }

        if (["slider", "number", "random"].includes(entry.type)) {
          const nums = el("div", "flex gap-2");
          for (const [prop, text] of [["min", t("api.min")], ["max", t("api.max")], ["step", t("api.step")]]) {
            const wrap = el("label", "flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground", text);
            const input = el("input", "h-6 min-w-0 flex-1 rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
            input.type = "number"; input.value = entry[prop];
            input.addEventListener("input", () => { entry[prop] = input.value; syncNodeFields(); });
            wrap.appendChild(input);
            nums.appendChild(wrap);
          }
          detail.appendChild(nums);
        }

        if (MEDIA_LABELS[entry.type]) {
          detail.appendChild(el("div", "rounded-md bg-muted px-2 py-1.5 text-xs leading-relaxed text-muted-foreground",
            t("core.runtimeLabelHint",
              { label: t(MEDIA_LABELS[entry.type]) })));
        }
      }
      item.appendChild(detail);
      D.nfList.appendChild(item);
    }
    D.nfCount.textContent = countText(entries.filter((e) => e.enabled));
  }

  /* 底栏一句话：启用几个、其中几个是高级（高级的在节点里折进「显示高级输入」）。
     有未保存的改动时补一句——默认值就在这一层里改，按「取消」会整表回滚，
     按「保存」才落到工作流文件。 */
  function countText(list) {
    const advanced = list.filter((entry) => entry.advanced).length;
    const base = t("api.fieldsEnabled", { n: list.length })
      + (advanced ? t("api.advancedCount", { n: advanced }) : "");
    return S.fieldsDirty ? base + t("core.unsaved") : base;
  }

  /* NodeFields.collect(): emit the full field table for the inspected node. */
  function collectNodeFields() {
    return entries.filter((entry) => entry.enabled).map((entry) => {
      const field = {
        nodeId: S.inspecting, key: entry.key, type: entry.type,
        label: entry.label.trim() || entry.key,
        /* 一律写明确的布尔值：以后改了节点面板的兜底表也不会把已经定好的
           参数悄悄挪到另一边。 */
        advanced: !!entry.advanced,
      };
      /* 默认值以文本回传，由后端按模板现有值的类型解析回去（int / float /
         bool / str）。没改过时传的就是原值，后端比对后不会重复写。占位符
         字段整行禁用，不参与。 */
      if (!entry.placeholder) field.default = entry.draft;
      if (entry.type === "select") {
        field.options = entry.options.map((item) => String(item).trim()).filter(Boolean);
      }
      if (entry.type === "number" || entry.type === "slider" || entry.type === "random") {
        const min = toNum(entry.min), max = toNum(entry.max), step = toNum(entry.step);
        if (min !== undefined) field.min = min;
        if (max !== undefined) field.max = max;
        if (step !== undefined) field.step = step;
      }
      return field;
    });
  }

  function syncNodeFields() {
    const list = collectNodeFields();
    /* Keep the user's parameter order intact. Replacing the inspected node's
       fields wholesale (`[...others, ...list]`) used to MOVE that node's rows
       to the end of S.fields, so any inspector edit silently reordered the
       right-hand panel after a save — even when only a label/type/minmax
       changed. Instead treat the existing order as the skeleton: swap each
       slot's content by key in place, drop rows the user unticked, and insert
       newly-enabled rows next to this node's last remaining row. */
    const byKey = new Map(list.map((field) => [String(field.key), field]));
    const used = new Set();
    const next = [];
    let lastOwnIndex = -1;
    for (const field of S.fields) {
      if (String(field.nodeId) === S.inspecting) {
        const fresh = byKey.get(String(field.key));
        if (fresh) {
          next.push(fresh);
          used.add(String(field.key));
          lastOwnIndex = next.length - 1;
        }
        /* key not in list = user unticked it: drop, keep the rest in place. */
      } else {
        next.push(field);
      }
    }
    const additions = list.filter((field) => !used.has(String(field.key)));
    if (additions.length) {
      const at = lastOwnIndex >= 0 ? lastOwnIndex + 1 : next.length;
      next.splice(at, 0, ...additions);
    }
    S.fields = next;
    S.fieldsDirty = true;
    renderHead();
    updateExposedCounts();
    D.nfCount.textContent = countText(list);
  }

  /* ------------------------------- open ------------------------------- */

  function open() {
    injectStyles();
    /* Subscribe on first open: i18n.js loads after this module alphabetically,
       so a top-level subscription would be skipped. */
    if (!NS._i18nApiCfgSubscribed && NS.i18n?.onChange) {
      NS.i18n.onChange(() => {
        if (ui?.mask?.isConnected) {
          const keep = S.currentName;
          close();
          open();
          if (keep) setTimeout(() => { try { selectWorkflow(keep); } catch (e) {} }, 400);
        }
      });
      NS._i18nApiCfgSubscribed = true;
    }
    close();
    const host = document.getElementById("infcanvas-root") || document.body;
    /* DialogOverlay + BaseModalLayout size "md", class for class. The dialog is
       NOT built on NS.tools.openModal any more: that shell carries the tools'
       own ict-* skin (14px radius, #494a50 border, 15px head), which is exactly
       what this rewrite is getting rid of. */
    const mask = el("div", "fixed inset-0 flex items-center justify-center bg-black/70 p-6");
    mask.style.zIndex = "9999";
    const panel = el("div", "relative flex h-[80vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden rounded-xl border bg-background shadow-lg");
    /* 同设置弹窗：原生对话框挂 body 继承 Inter, Arial, sans-serif；本弹窗挂
       #infcanvas-root，root 的 var(--font-inter,...) 命中宿主无-Arial 定义 →
       丢 Arial。显式写回原生真值覆盖继承，不改挂载层级。 */
    panel.style.fontFamily = "Inter, Arial, sans-serif";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("api.apiConfig"));
    mask.appendChild(panel);

    const banner = el("div", "shrink-0 border-b bg-destructive/10 px-6 py-2 text-xs leading-relaxed text-destructive");
    banner.textContent = t("api.pleaseFullyRestartComfyuiApi")
      + t("api.reopenDialogAfterRestarting");
    banner.hidden = true;
    panel.appendChild(banner);

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (!D.nfMask?.hidden) { cancelNodeFields(); return; }
      close();
    };
    document.addEventListener("keydown", onKey, true);
    const onMaskDown = (event) => { if (event.target === mask) close(); };
    mask.addEventListener("pointerdown", onMaskDown);

    buildUI(panel);
    host.appendChild(mask);

    ui = {
      mask, panel,
      setApiReady(ready) { banner.hidden = ready !== false; },
      close() {
        closeWidgetMenu();
        closeCatMenu && closeCatMenu();
        document.removeEventListener("keydown", onKey, true);
        mask.remove();
        ui = null;
      },
    };
    probeBackend();
    loadWorkflows();
  }

  function close() { ui?.close?.(); }

  /* Rebuild the open dialog on language change so its commandeered host-class
     strings are re-created with the new language. The selected workflow is kept
     in S and reselected by open()->loadWorkflows. */
  NS.apiConfig = {
    open, close, isOpen: () => !!ui?.mask?.isConnected,
    /* Called by the top-bar 「导入到画布」 entry point: re-detect + persist the
       just-imported workflow's parameters (fresh overwrite). The only automatic
       write allowed; scoped to the named workflow. */
    resetFieldsForImport,
    /* R (refresh node definitions): drop the session object_info cache so the
       next field read fetches the host's freshly registered node defs. */
    refreshDefs: refreshDefsCore,
  };
})();
