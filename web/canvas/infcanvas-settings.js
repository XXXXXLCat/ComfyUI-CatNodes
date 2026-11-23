/* 画布设置面板（可扩展框架）。
 *
 * 侧栏「设置」按钮打开本弹窗。所有设置项都在下面的 SETTINGS 注册表里声明：
 * 以后新增设置只需往 SETTINGS 追加一项，面板会自动渲染，open()/渲染逻辑不用改。
 *
 * 外观 1:1 复刻 ComfyUI 原生 SettingDialog.vue（size="md"）+ BaseModalLayout：
 *   - 外壳 relative overflow-hidden rounded-2xl border bg-background shadow-lg
 *     + h-[80vh] w-[90vw] max-w-[1400px]（BaseModalLayout SIZE_CLASSES.md）
 *   - 内部 grid 两列 leftPanelWidth=14rem / 1fr
 *   - 左栏 nav(bg-card)：h-18 标题头 + px-3 搜索框 + nav(NavTitle/NavItem)
 *   - 右栏(bg-background)：h-18 头(关闭按钮) + content(px-6 pb-10)
 *   - 设置行 FormItem：flex min-h-8 gap-2 / label text-sm text-muted-foreground
 * 外壳与控件逐字复用宿主 class，不引入自定义配色。设置值由 NS.prefs 写入
 * user/<用户>/Cat-Nodes/prefs.json，键名即设置项 id，core 侧走同一份缓存。
 */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* Model names are literal file names, not i18n keys: route them through
     optLabel() so the i18n layer never logs a "missing key" warning. */
  const optLabel = (opt) => (opt && opt.labelKey ? t(opt.labelKey) : String(opt?.label ?? opt?.value ?? ""));
  /* Native ComfyUI tooltip (shared engine in native-tip.js). */
  const bindTip = (el, text, side) => {
    if (!el) return el;
    if (NS.tip?.bindTip) return NS.tip.bindTip(el, text, side);
    return el;
  };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  /* ---- 原生 class 常量：逐字抄自宿主前端（见 sourcemap）---- */
  /* buttonVariants() base + size md / lg（api-config.js 已验证的同款串）。 */
  const BTN = "relative inline-flex cursor-pointer touch-manipulation appearance-none "
    + "items-center justify-center gap-2 border-none font-inter font-medium "
    + "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring "
    + "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
  /* BaseModalLayout 关闭按钮真值（实测 40×40 / rounded-lg / bg-secondary 实心
     方块 / pi pi-times 16px）：variant=secondary(默认) + size=lg + w-10。 */
  const BTN_CLOSE = BTN + " h-10 rounded-lg px-4 py-2 text-sm "
    + "bg-secondary text-foreground hover:bg-accent w-10";
  /* SearchInput.vue md（searchInput.variants.ts base + size.md）。 */
  const SEARCH_ANCHOR = "relative flex w-full cursor-text items-center rounded-lg "
    + "bg-secondary text-foreground focus-within:ring-1 focus-within:ring-ring h-8 px-2 py-1.5";
  /* sizeConfig.md: icon size-4 / iconPos left-2.5 / inputPl pl-8 / inputText text-xs。
     注意 icon 与 clear 互斥：有输入时左侧放大镜换成 X 按钮，不是右侧另放一个。 */
  const SEARCH_ICON = "pointer-events-none absolute left-2.5 size-4 icon-[lucide--search]";
  const SEARCH_ICON_POS = "absolute left-2.5";
  const SEARCH_INPUT = "size-full border-none bg-transparent outline-none pl-8 text-xs";
  /* Button variant=textonly + size=icon-sm（size-5 p-0）落成清除按钮。
     刻意不用 BTN 常量：其 base 带 `relative`，会压掉这里的 `absolute`。 */
  const BTN_ICON_SM = "absolute inline-flex cursor-pointer touch-manipulation appearance-none "
    + "items-center justify-center border-none rounded-md bg-transparent text-foreground "
    + "font-inter text-sm font-medium transition-colors hover:bg-accent "
    + "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none size-5 p-0";
  /* NavItem.vue（active → bg-muted，否则 hover:bg-accent）。 */
  const NAV_ITEM = "flex cursor-pointer items-center-safe gap-2 rounded-md px-4 py-3 "
    + "text-sm text-foreground transition-colors select-none";
  /* 设置项 name-prefix 图标（Comfy.Locale 的 pi pi-language）：原生是 Tag
     severity=primary，实测 30x22 / rounded-md px-2 py-1 / text-sm font-bold /
     bg-primary/10 / text-foreground，嵌在 label span 内、文字前面。 */
  const SETTING_ICON = "inline-flex shrink-0 items-center justify-center gap-1 "
    + "whitespace-nowrap rounded-md px-2 py-1 text-sm font-bold bg-primary/10 text-foreground ";
  /* 语言 combo 下拉真值（从 sourcemap 提取，勿改）：
     FormItem.vue 对 combo 用 AppSingleSelect → SingleSelect，size 默认 'lg'，
     class=w-44。select.variants.ts selectTriggerVariants({size:'lg',border:'none'}):
       base: relative inline-flex cursor-pointer items-center rounded-lg
             border-[2.5px] border-solid bg-secondary text-foreground
             transition-all duration-200 ease-in-out outline-none select-none hover:bg-accent
       lg:   h-10   |   border none: border-transparent focus-visible/data-[state=open]:border-border
     内部值容器（SingleSelect.vue）: flex flex-1 items-center gap-2 overflow-hidden py-2 pl-2 + text-sm(lg)
     箭头容器 selectDropdownClass: flex shrink-0 cursor-pointer items-center justify-center pl-3
     箭头图标: icon-[lucide--chevron-down] text-muted-foreground
     实测截图 176x40 / 圆角8 / bg-secondary(38,39,41) / 白字14 / 灰箭头。
     ★真机量原生 Comfy.Locale trigger：computed padding=1px 6px、font=16px，
     故箭头右边距 = 6+2.5(border)=8.5px、icon=19px；我们的 root 继承 14px，
     必须在 makeSelect 里显式写回 1px 6px / 16px，否则箭头贴右且偏小。 */
  const SELECT_TRIGGER = "relative inline-flex h-10 w-44 cursor-pointer items-center "
    + "rounded-lg border-[2.5px] border-solid border-transparent bg-secondary "
    + "text-foreground transition-all duration-200 ease-in-out outline-none "
    + "select-none hover:bg-accent focus-within:border-border "
    + "data-[state=open]:border-border";
  const SELECT_DROPDOWN = "flex shrink-0 cursor-pointer items-center justify-center pl-3";
  /* SingleSelect.vue → SelectPortal/SelectContent（selectContentClass + 原生
     min-w-(--reka-select-trigger-width)）：popper sideOffset=8 / align=start，
     z-overlay + rounded-lg p-2 bg-background border shadow-md，条目 layout=single。
     挂 body 后由 infcanvas-style.js 现有的 body > div.z-overlay 白名单抬到
     2147483000（高于画布根 20000），不要另设 inline z-index 去压它。 */
  const SELECT_CONTENT = "z-overlay overflow-hidden rounded-lg p-2 bg-background text-foreground "
    + "border border-solid shadow-md data-[state=closed]:animate-out "
    + "data-[state=open]:animate-in data-[state=closed]:fade-out-0 "
    + "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 "
    + "data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 "
    + "min-w-(--reka-select-trigger-width)";
  const SELECT_ITEM = "flex cursor-pointer items-center px-2 outline-none hover:bg-accent "
    + "relative w-full justify-between gap-3 rounded-sm py-3 text-sm select-none "
    + "focus:bg-accent data-[state=checked]:bg-muted data-[state=checked]:hover:bg-muted";
  const SELECT_ITEM_CHECK = "flex shrink-0 items-center justify-center";
  /* NavIcon.vue：尺寸来自 text-sm(14px)，不是 size-3.5。 */
  const NAV_ICON = "shrink-0 text-sm text-foreground";
  /* NavTitle.vue：外层 div 承担 px-3/pt-5 与排布，h3 只负责字号字重。 */
  const NAV_TITLE_WRAP = "m-0 flex items-center justify-between px-3 py-0 pt-5";
  /* NavTitle.vue 的 h3。真机实测（未进画布打开原生 SettingDialog）：原生 h3
     保留浏览器默认样式——12px/700 + margin 12px 上下，故外层 wrap 高 60px。
     画布内 DOM 环境与原生一致，**不要**再补 m-0 / font-normal。 */
  const NAV_TITLE = "text-xs font-bold text-muted-foreground uppercase";

  /* 读的是内存缓存、写的是 per-user prefs.json，键名不变。 */
  const readVal = (id, def) => (NS.prefs ? NS.prefs.get(id, def) : def);
  const writeVal = (id, value) => NS.prefs?.set(id, value);

  /* 翻译模型下拉：选项来自 ComfyUI 自己的 text_encoders 目录（CLIPLoader 的
     clip_name combo）。复用宿主 object_info 缓存，不加后端接口；模型名是文件
     名不是 i18n key，故 options 用 label 原样承载。 */
  const TRANSLATE_MODEL_ID = "InfCanvas.TranslateModel";
  const translateDefault = () => (NS.translate?.defaultModel || "qwen3.5_2b_bf16.safetensors");
  let translateOptionsReady = false;
  let translateOptionsPromise = null;

  async function loadTranslateOptions() {
    const item = SETTINGS.find((s) => s.id === TRANSLATE_MODEL_ID);
    if (!item) return;
    let names = [];
    try {
      const api = window.comfyAPI?.api?.api;
      let defs = null;
      if (api?.getNodeDefs) defs = await api.getNodeDefs();
      else if (api?.fetchApi) {
        const response = await api.fetchApi("/object_info/CLIPLoader");
        if (response.ok) defs = await response.json();
      }
      const raw = defs?.CLIPLoader?.input?.required?.clip_name;
      if (Array.isArray(raw?.[0])) names = raw[0];
      else if (Array.isArray(raw?.[1]?.options)) names = raw[1].options;
    } catch (error) { /* object_info 不可用时保留当前值作为唯一选项 */ }
    const unique = [...new Set(names.filter((n) => typeof n === "string" && n.trim()))];
    unique.sort((a, b) => a.localeCompare(b));
    const current = item.get();
    if (typeof current === "string" && current && !unique.includes(current)) unique.unshift(current);
    item.options = unique.map((name) => ({ value: name, label: name }));
    translateOptionsReady = true;
  }

  function ensureTranslateOptions() {
    if (!translateOptionsPromise) translateOptionsPromise = loadTranslateOptions();
    return translateOptionsPromise;
  }

  /* prefs 是异步加载的：首次拉列表时它可能还没回来。打开面板时再确认一次
     已保存的模型仍在选项里，避免下拉显示空白。 */
  function syncCurrentTranslateOption() {
    const item = SETTINGS.find((s) => s.id === TRANSLATE_MODEL_ID);
    const current = item?.get();
    if (!item || typeof current !== "string" || !current.trim()) return;
    if (!(item.options || []).some((o) => String(o.value) === current)) {
      item.options = [{ value: current, label: current }].concat(item.options || []);
    }
  }

  /* ---- 设置注册表：新增设置往这里加一项即可 ----
     type 支持 "switch" / "number" / "select"；group 决定它落在左侧哪个分类。 */
  const SETTINGS = [
    {
      id: "InfCanvas.ShowPreviewText",
      type: "switch",
      group: "canvas",
      label: "settings.showPreviewText",
      desc: "settings.generatingImagesVideosAlsoShow",
      def: false,
      get: () => readVal("InfCanvas.ShowPreviewText", false),
      set: (value) => writeVal("InfCanvas.ShowPreviewText", value),
    },
    {
      id: "InfCanvas.Setting.WriteLoraTriggers",
      type: "switch",
      group: "canvas",
      label: "settings.writeLoraTriggers",
      desc: "settings.writeLoraTriggersHint",
      def: true,
      get: () => readVal("InfCanvas.Setting.WriteLoraTriggers", true),
      set: (value) => writeVal("InfCanvas.Setting.WriteLoraTriggers", value),
    },
    {
      id: "InfCanvas.Setting.AutoSave",
      type: "switch",
      group: "canvas",
      label: "sidebar.autoSaveCanvas",
      desc: "settings.enabledCanvasAutoSavesAfter",
      def: false,
      get: () => readVal("InfCanvas.Setting.AutoSave", false),
      set: (value) => writeVal("InfCanvas.Setting.AutoSave", value),
    },
    {
      id: "InfCanvas.Setting.AutoSaveDelay",
      type: "number",
      group: "canvas",
      label: "settings.autoSaveIntervalSeconds",
      desc: "settings.autoSaveDelayHint",
      def: 3,
      min: 1,
      max: 3600,
      get: () => readVal("InfCanvas.Setting.AutoSaveDelay", 3),
      set: (value) => writeVal("InfCanvas.Setting.AutoSaveDelay", value),
    },
    {
      id: TRANSLATE_MODEL_ID,
      type: "select",
      group: "translation",
      label: "settings.translateModel",
      desc: "settings.translateModelDesc",
      hint: "settings.translateModelHint",
      def: translateDefault(),
      options: [{ value: translateDefault(), label: translateDefault() }],
      get: () => readVal(TRANSLATE_MODEL_ID, translateDefault()),
      set: (value) => writeVal(TRANSLATE_MODEL_ID, value),
    },
  ];
  /* 提前拉取模型列表；面板打开时若还没回来，open() 会等它并补一次重绘。 */
  void ensureTranslateOptions();

  /* 左侧导航分组（useSettingUI.ts navGroups 的简化版）。每一项 id 对应一个
     分类；点击后右侧只渲染 group===id 的设置。 */
  const NAV_GROUPS = [
    {
      title: "sidebar.canvas",
      items: [
        { id: "canvas", label: "shortcuts.canvasSettings", icon: "icon-[lucide--settings]" },
        { id: "builtinWorkflows", label: "builtinMgr.title", icon: "icon-[lucide--workflow]" },
        { id: "translation", label: "settings.translationCategory", icon: "icon-[lucide--languages]" },
      ],
    },
  ];

  let ui = null;
  let activeGroup = NAV_GROUPS[0].items[0].id;
  let searchQuery = "";
  /* 当前展开的原生式下拉浮层（同一时刻只允许一个）。 */
  let selectMenu = null;

  /* Switch：class 逐字抄自 ui/switch/Switch.vue（FormItem 直接渲染 SwitchRoot，
     中间没有包装 div——原实现多套了一层 flex 容器）。 */
  function makeSwitch(item) {
    const on = item.get() === true;
    const btn = el("button",
      "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation "
      + "items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none "
      + "transition-shadow focus-visible:ring-1 focus-visible:ring-ring");
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-label", t(item.label));
    btn.dataset.state = on ? "checked" : "unchecked";
    const track = el("span", "pointer-events-none inline-flex h-5 w-9 items-center rounded-full "
      + "border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary");
    const knob = el("span", "pointer-events-none block size-4 rounded-full bg-background shadow-sm "
      + "transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0");
    knob.dataset.state = on ? "checked" : "unchecked";
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = item.get() !== true;
      item.set(next);
      btn.dataset.state = next ? "checked" : "unchecked";
      knob.dataset.state = next ? "checked" : "unchecked";
    });
    track.appendChild(knob);
    btn.appendChild(track);
    return btn;
  }

  /* 数字输入：1:1 复刻 FormNumberField.vue → NumberField.vue（shadcn 风格）。
     NumberFieldRoot: flex h-10 w-32 items-center rounded-lg bg-secondary
       text-foreground focus-within:ring-1 focus-within:ring-ring hover:bg-accent
     Decrement/Increment: h-full w-6 shrink-0 rounded-l-lg / rounded-r-lg,
       默认图标 icon-[lucide--minus] / icon-[lucide--plus] size-4
     Input: min-w-0 flex-1 border-none bg-transparent text-center text-base
     原生没有单位后缀（单位写在 label 里），故不再追加「秒」。 */
  function makeNumber(item) {
    const min = item.min ?? 1;
    const max = item.max ?? 3600;
    const fallback = item.def ?? 3;
    const clamp = (value) => Math.max(min, Math.min(max, value));
    const wrap = el("div", "flex h-10 w-32 items-center rounded-lg bg-secondary "
      + "text-foreground focus-within:ring-1 focus-within:ring-ring hover:bg-accent");
    const input = el("input", "min-w-0 flex-1 border-none bg-transparent text-center "
      + "text-base text-foreground outline-none focus-visible:outline-none");
    /* 原生 NumberFieldInput 用的是 text，不是 number（避免浏览器自带步进箭头）。 */
    input.type = "text";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", t(item.label));
    const current = Number(item.get());
    input.value = String(Number.isFinite(current) && current > 0 ? current : fallback);
    const read = () => {
      const parsed = Number.parseInt(input.value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const commit = (next) => {
      const value = clamp(next);
      input.value = String(value);
      item.set(value);
    };
    input.addEventListener("change", () => commit(read()));
    input.addEventListener("blur", () => commit(read()));
    const stepBtn = (icon, delta, radius, label) => {
      const btn = el("button", "flex h-full w-6 shrink-0 cursor-pointer items-center "
        + "justify-center border-none bg-transparent text-muted-foreground "
        + "hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring "
        + "focus-visible:outline-none focus-visible:ring-inset " + radius);
      btn.type = "button";
      btn.setAttribute("aria-label", t(label));
      btn.appendChild(el("i", "icon-[lucide--" + icon + "] size-4"));
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        commit(read() + delta);
      });
      return btn;
    };
    wrap.append(
      stepBtn("minus", -1, "rounded-l-lg", "core.decrease"),
      input,
      stepBtn("plus", 1, "rounded-r-lg", "controls.increase"),
    );
    return wrap;
  }

  /* 原生 <select> 弹的是系统菜单，不是 ComfyUI 的 SelectContent 浮层。这里改成
     SingleSelect.vue 同款：trigger 显示选中值 + chevron，展开后往 body portal
     一个 z-overlay / rounded-lg / p-2 / bg-background / border / shadow-md 的列表，
     条目 layout=single（py-3 text-sm，选中项 data-state=checked:bg-muted + check）。 */
  function closeSelectMenu() {
    if (!selectMenu) return;
    const menu = selectMenu;
    selectMenu = null;
    document.removeEventListener("pointerdown", menu.onDown, true);
    document.removeEventListener("keydown", menu.onKey, true);
    window.removeEventListener("scroll", menu.onPlace, true);
    window.removeEventListener("resize", menu.onPlace);
    menu.trigger.removeAttribute("data-state");
    menu.trigger.setAttribute("aria-expanded", "false");
    menu.node.remove();
    if (ui) ui.dropdownOpen = false;
  }

  function openSelectMenu(item, trigger) {
    closeSelectMenu();
    const node = el("div", SELECT_CONTENT);
    node.setAttribute("role", "listbox");
    node.style.position = "fixed";
    /* z-overlay 已由 infcanvas-style.js 抬到画布根之上，这里不覆盖 z-index。 */
    node.style.fontFamily = "Inter, Arial, sans-serif";
    const current = item.get();
    const viewport = el("div", "scrollbar-custom w-full");
    viewport.style.maxHeight = "min(28rem, 50vh)";
    for (const opt of item.options || []) {
      const row = el("div", SELECT_ITEM);
      const checked = String(opt.value) === String(current);
      row.setAttribute("role", "option");
      row.setAttribute("data-state", checked ? "checked" : "unchecked");
      row.appendChild(el("span", "truncate", optLabel(opt)));
      if (checked) {
        const indicator = el("div", SELECT_ITEM_CHECK);
        indicator.appendChild(el("i", "icon-[lucide--check] text-foreground"));
        row.appendChild(indicator);
      }
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        closeSelectMenu();
        item.set(opt.value);
      });
      viewport.appendChild(row);
    }
    node.appendChild(viewport);
    document.body.appendChild(node);
    const place = () => {
      const r = trigger.getBoundingClientRect();
      node.style.left = Math.round(r.left) + "px";
      node.style.top = Math.round(r.bottom + 8) + "px";
      node.style.minWidth = Math.round(r.width) + "px";
    };
    place();
    trigger.setAttribute("data-state", "open");
    trigger.setAttribute("aria-expanded", "true");
    if (ui) ui.dropdownOpen = true;
    const onDown = (event) => {
      if (node.contains(event.target) || trigger.contains(event.target)) return;
      /* 原生 dismissable layer：第一次外部指针只收浮层，不吃掉整个设置弹窗。 */
      event.stopPropagation();
      closeSelectMenu();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      /* 原生 stopEscapeToDocument：先吃掉 Escape，别连带关掉整个设置弹窗。 */
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeSelectMenu();
      trigger.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    selectMenu = { node, trigger, onDown, onKey, onPlace: place };
  }

  function makeSelect(item) {
    const trigger = el("div", SELECT_TRIGGER);
    /* 原生 SelectTrigger 是 button：computed padding 1px 6px / font 16px。
       我们是 div 且挂在 #infcanvas-root（继承 14px），不写回这两项箭头会
       贴右 6px 且从 19px 缩到 12px——用户说的「箭头位置不对」即此处。 */
    trigger.style.padding = "1px 6px";
    trigger.style.fontSize = "16px";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.tabIndex = 0;
    let selectedLabel = "";
    for (const opt of item.options || []) {
      if (String(opt.value) === String(item.get())) selectedLabel = optLabel(opt);
    }
    const valueBox = el("div", "flex flex-1 items-center gap-2 overflow-hidden py-2 pl-2 text-sm");
    valueBox.appendChild(el("span", "truncate", selectedLabel));
    const arrowBox = el("div", SELECT_DROPDOWN + " pointer-events-none");
    arrowBox.appendChild(el("i", "icon-[lucide--chevron-down] text-muted-foreground"));
    trigger.append(valueBox, arrowBox);
    const toggle = (event) => {
      event.stopPropagation();
      if (selectMenu) closeSelectMenu();
      else openSelectMenu(item, trigger);
    };
    trigger.addEventListener("click", toggle);
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle(event);
    });
    return trigger;
  }

  function makeControl(item) {
    if (item.type === "number") return makeNumber(item);
    if (item.type === "select") return makeSelect(item);
    return makeSwitch(item);
  }

  /* FormItem.vue：<div class="flex min-h-8 items-center gap-2"> + label
     span(text-sm text-muted-foreground) + 右侧控件。原生的 tooltip 触发
     `pi pi-info-circle` 在 label span **内部**、紧跟名字（模板换行 = 一个空格，
     约 4px），继承 text-sm(14px)——不是 span 外的兄弟节点（那样会继承 16px
     且多出 6px 间距）。 */
  function makeFormItem(item) {
    const row = el("div", "flex min-h-8 items-center gap-2");
    const labelBox = el("div", "flex grow items-center");
    const label = el("span", "text-sm text-muted-foreground");
    label.setAttribute("id", item.id + "-label");
    /* 原生 name-prefix：Comfy.Locale 前置 language Tag，嵌在 label span 内、
       文字前面（源码 id==='Comfy.Locale' 时塞 pi pi-language severity=primary）。 */
    if (item.icon) {
      /* 2026-11-21 用户定稿：语言行这一块（图标+文字+info）上移 4px。
         inline-flex 图标把 label 撑到 22px 高，视觉重心比右侧下拉框偏低。 */
      label.style.transform = "translateY(-4px)";
      label.appendChild(el("i", SETTING_ICON + item.icon));
      label.appendChild(document.createTextNode(" "));
    }
    label.appendChild(document.createTextNode(t(item.label)));
    if (item.desc) {
      label.appendChild(document.createTextNode(" "));
      const info = el("i", "pi pi-info-circle");
      bindTip(info, () => t(item.desc));
      label.appendChild(info);
    }
    labelBox.appendChild(label);
    const controlBox = el("div", "flex flex-col items-end gap-1");
    controlBox.appendChild(makeControl(item));
    /* 可选的行内提醒：用宿主 utility class，不引入自绘样式。翻译模型行用它
       常驻提示「模型越大越慢」，不必悬停 info 图标才看得到。 */
    if (item.hint) controlBox.appendChild(el("span", "text-xs text-muted-foreground text-right", t(item.hint)));
    row.append(labelBox, controlBox);
    return row;
  }

  /* SettingGroup.vue：<h3 class="text-base">标题 + 每个 setting 一个
     .setting-item.mb-3 行；分组之间 divider my-8 border-t。 */
  function renderGroups(host) {
    const query = searchQuery.trim().toLowerCase();
    /* 内置工作流管理是复合视图，不是单值设置项：它有自己的导航分组，直接把
       视图挂进右栏 content。搜索态下让普通设置项照常跨分类匹配，不显示本视图。 */
    if (activeGroup === "builtinWorkflows" && !query) {
      NS.builtinMgr?.mount?.(host);
      return;
    }
    NS.builtinMgr?.unmount?.();
    const frag = document.createDocumentFragment();
    /* 搜索态：跨分类显示所有匹配项（ComfyUI 的 searchResults）。 */
    const matched = SETTINGS.filter((s) => {
      if (query && !(t(s.label).toLowerCase().includes(query)
        || t(s.desc || "").toLowerCase().includes(query))) return false;
      if (!query && s.group !== activeGroup) return false;
      return true;
    });
    if (matched.length === 0) {
      /* NoResultsPlaceholder.vue: outer h-full p-8 > inner flex flex-col
         items-center bg-(--surface-ground) text-center, icon mb-4 text-5xl,
         title h3 mb-2 text-foreground, message p mb-4 whitespace-pre-line。 */
      const outer = el("div", "h-full p-8");
      const inner = el("div", "flex flex-col items-center text-center");
      inner.style.background = "var(--surface-ground, transparent)";
      inner.append(
        el("i", "pi pi-search mb-4 text-5xl"),
        /* 原生 NoResultsPlaceholder 的 h3/p 没有尺寸 class，保留浏览器默认
           （h3 = 1.17em/700 + 默认 margin）——与原生一致，勿补 m-0。 */
        el("h3", "mb-2 text-foreground", t("settings.noMatchingSettingsFound")),
        el("p", "mb-4 text-center whitespace-pre-line", t("settings.noMatchingSettingsTryDifferent")),
      );
      outer.appendChild(inner);
      host.replaceChildren(outer);
      return;
    }
    const groupBox = el("div", "setting-group");
    const title = NAV_GROUPS.flatMap((g) => g.items).find((it) => it.id === activeGroup);
    /* SettingGroup.vue: <h3 class="text-base">。原生 h3 是 16px/700 + 上下 margin
       16px（真机实测 y 差 16），不要补 m-0/font-normal。
       2026-11-21：仅「画布设置」标题与首个设置项之间的间距按用户要求调整
       （原生 16px → 18px → 20px）；标题上边距、项间距 mb-3(12px) 均保持原生。 */
    const groupTitle = el("h3", "text-base", query ? t("settings.searchResults") : t(title ? title.label: "shortcuts.canvasSettings"));
    groupTitle.style.marginBottom = "calc(var(--spacing, 4px) * 5)";
    groupBox.appendChild(groupTitle);
    for (const item of matched) {
      const rowWrap = el("div", "setting-item mb-3");
      rowWrap.appendChild(makeFormItem(item));
      groupBox.appendChild(rowWrap);
    }
    frag.appendChild(groupBox);
    host.replaceChildren(frag);
  }

  function renderNav(navEl) {
    const frag = document.createDocumentFragment();
    for (const group of NAV_GROUPS) {
      const box = el("div", "flex flex-col gap-2");
      const titleWrap = el("div", NAV_TITLE_WRAP);
      titleWrap.appendChild(el("h3", NAV_TITLE, t(group.title)));
      box.appendChild(titleWrap);
      for (const item of group.items) {
        const active = item.id === activeGroup;
        const nav = el("div", NAV_ITEM + (active ? " bg-muted" : " hover:bg-accent"));
        nav.setAttribute("role", "button");
        nav.dataset.navId = item.id;
        const glyph = el("i", NAV_ICON);
        glyph.setAttribute("aria-hidden", "true");
        glyph.className += " " + item.icon;
        nav.appendChild(glyph);
        nav.appendChild(el("span", "min-w-0 truncate", t(item.label)));
        nav.addEventListener("click", () => {
          if (activeGroup === item.id) return;
          activeGroup = item.id;
          searchQuery = "";
          if (ui?.searchInput) ui.searchInput.value = "";
          repaint();
        });
        box.appendChild(nav);
      }
      frag.appendChild(box);
    }
    navEl.replaceChildren(frag);
  }

  function repaint() {
    if (!ui) return;
    /* 重绘会换掉 trigger 节点，浮层必须一起收掉，别留孤儿菜单。 */
    closeSelectMenu();
    renderNav(ui.nav);
    renderGroups(ui.content);
    /* 搜索框的放大镜/清除按钮互斥由 syncClear 统一维护（输入、清空、重置都走它）。 */
    ui.syncClear?.();
  }

  function open() {
    close();
    const host = document.getElementById("infcanvas-root") || document.body;
    const mask = el("div", "fixed inset-0 flex items-center justify-center bg-black/70 p-6");
    mask.style.zIndex = "9999";
    /* BaseModalLayout root: size md = h-[80vh] w-[90vw] max-w-[1400px]. */
    const panel = el("div", "relative overflow-hidden rounded-2xl border bg-background shadow-lg "
      + "h-[80vh] w-[90vw] max-w-[1400px]");
    /* 原生对话框挂 document.body，字体栈 = body 的 Inter, Arial, sans-serif。
       本弹窗挂 #infcanvas-root，root 用 var(--font-inter,...) 而宿主把该变量
       定义成 "Inter", sans-serif（无 Arial），var() 命中后 fallback 失效 →
       丢 Arial、文字基线偏。这里显式写回原生真值，覆盖继承（不改挂载层级）。 */
    panel.style.fontFamily = "Inter, Arial, sans-serif";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("data-testid", "settings-dialog");
    panel.setAttribute("aria-label", t("shortcuts.canvasSettings"));
    mask.appendChild(panel);

    /* grid size-full; gridTemplateColumns = 14rem 1fr (leftPanelWidth 默认). */
    const grid = el("div", "grid size-full");
    grid.style.gridTemplateColumns = "14rem 1fr";
    panel.appendChild(grid);

    /* ---- 左栏 nav ---- */
    const left = el("nav", "flex h-full flex-col overflow-hidden bg-card");
    const leftHead = el("header", "flex h-18 w-full shrink-0 items-center-safe gap-2 pr-3 pl-6");
    /* SettingDialog #leftPanelHeaderTitle 真值：<i class="icon-[lucide--settings]">
       （裸 class，无 size/包裹；mask 继承 currentColor，实测 19px）+ h2.text-base。
       真机实测原生 h2 为 16px/700、margin 上下 13.28px，勿补 m-0/font-normal。 */
    const settingsGlyph = el("i", "icon-[lucide--settings]");
    settingsGlyph.setAttribute("aria-hidden", "true");
    leftHead.append(settingsGlyph, el("h2", "text-base text-foreground", t("settings.settings")));
    left.appendChild(leftHead);

    /* px-3 内放原生 SearchInput md（SettingDialog #leftPanel）。 */
    const searchWrap = el("div", "px-3");
    const search = el("div", SEARCH_ANCHOR);
    const searchIcon = el("i", SEARCH_ICON);
    const searchInput = el("input", SEARCH_INPUT);
    searchInput.type = "text";
    /* 2026-11-21 用户要求搜索框文字下移 1px。input 是 size-full 且被 flex
       items-center 居中，用 transform 只挪文字、不动框高/对齐/清除按钮。 */
    searchInput.style.transform = "translateY(1px)";
    searchInput.placeholder = t("settings.searchSettings") + "...";
    searchInput.setAttribute("aria-label", t("settings.search"));
    /* SearchInput.vue：清除按钮是「替换左侧放大镜」的 X（absolute left-2.5，
       size-5 p-0），不是右侧另放一个；两者按有无输入互斥。 */
    const clearBtn = el("button", BTN_ICON_SM);
    clearBtn.type = "button";
    clearBtn.setAttribute("aria-label", t("core.clear"));
    clearBtn.appendChild(el("i", "icon-[lucide--x] size-4"));
    const syncClear = () => {
      const hasValue = !!searchInput.value;
      searchIcon.style.display = hasValue ? "none" : "inline-block";
      clearBtn.style.display = hasValue ? "inline-flex" : "none";
    };
    syncClear();
    clearBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      searchQuery = "";
      searchInput.value = "";
      syncClear();
      repaint();
      searchInput.focus();
    });
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      syncClear();
      repaint();
    });
    search.append(searchIcon, searchInput, clearBtn);
    searchWrap.appendChild(search);
    left.appendChild(searchWrap);

    const nav = el("div", "scrollbar-hide flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4");
    left.appendChild(nav);

    /* ---- 右栏 ---- */
    const right = el("div", "flex flex-col overflow-hidden bg-background");
    /* BaseModalLayout headerPadding="symmetric" => flex w-full items-center
       justify-between gap-2 px-6 py-5（实测高 80px，关闭按钮 y=112）。 */
    const head = el("header", "flex w-full items-center justify-between gap-2 px-6 py-5");
    /* headerContentClass: flex min-w-0 flex-1 gap-2 + symmetric 时 min-h-10 items-center。 */
    head.appendChild(el("div", "flex min-w-0 flex-1 gap-2 min-h-10 items-center"));
    const closeBtn = el("button", BTN_CLOSE);
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t("settings.close"));
    bindTip(closeBtn, () => t("settings.close"));
    closeBtn.appendChild(el("i", "pi pi-times"));
    closeBtn.addEventListener("click", (event) => { event.stopPropagation(); close(); });
    head.appendChild(closeBtn);
    right.appendChild(head);

    /* BaseModalLayout contentContainer: contentPadding=default => px-6 pt-0 pb-10. */
    const content = el("main", "scrollbar-custom flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-0 pb-10");
    right.appendChild(content);

    grid.append(left, right);
    panel.appendChild(grid);
    host.appendChild(mask);

    ui = { mask, nav, content, searchInput, clearBtn, searchIcon, syncClear };
    syncCurrentTranslateOption();
    repaint();
    /* 首开时 object_info 可能还没回来；回来后重绘一次让下拉拿到完整列表。 */
    if (!translateOptionsReady) {
      void ensureTranslateOptions().then(() => { if (ui) repaint(); });
    }

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      /* 浮层自己处理 Escape（原生 stopEscapeToDocument），别连设置弹窗一起关。 */
      if (selectMenu) return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    mask.addEventListener("pointerdown", (event) => { if (event.target === mask) close(); });
    ui.onKey = onKey;
    /* 搜索框 autofocus（SettingDialog SearchInput :autofocus）。 */
    requestAnimationFrame(() => searchInput?.focus());
  }

  function close() {
    closeSelectMenu();
    NS.builtinMgr?.unmount?.();
    if (!ui) return;
    document.removeEventListener("keydown", ui.onKey, true);
    ui.mask.remove();
    ui = null;
  }

  function repaintLocale() {
    if (!ui) return;
    ui.searchInput.placeholder = t("settings.searchSettings") + "...";
    ui.searchInput.setAttribute("aria-label", t("settings.search"));
    ui.clearBtn.setAttribute("aria-label", t("core.clear"));
    repaint();
  }

  NS.settings = {
    open, close, repaintLocale,
    isOpen: () => !!ui?.mask?.isConnected,
    /* 暴露注册表，core 侧/其他模块若需读取默认值可引用。 */
    SETTINGS,
  };
})();
