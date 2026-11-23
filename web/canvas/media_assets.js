// Media Assets 🐈‍⬛ — the canvas-only media browser. It lists every file in
// the account's output/ and input/ trees, mounted in the infinite canvas's own
// sidebar drawer (infcanvas-ui.js -> window.InfCanvas.galleryPanel.mount).
// There is intentionally NO ComfyUI main-UI sidebar tab: this panel belongs to
// the canvas and only features that work inside the canvas shell are exposed.
//
// Data comes from canvas/media_assets.py:
//   GET  /xcat/gallery         manifest (each entry carries its own signed URLs)
//   GET  /xcat/gallery/file    the file itself, or a thumbnail with preview=1
//   POST /xcat/gallery/zip     multi-file download as a single archive
//   POST /xcat/gallery/delete  removes the files from disk
// Under --multi-user the server scopes everything to the signed-in account.
//
// Layout and interaction are ported from the native Assets panel — read those
// sources rather than guessing:
//   AssetsSidebarTab.vue       output/input TabList, empty-space deselect,
//                              marquee rectangle teleported to <body>, context
//                              menu opened with show(event) i.e. at the pointer
//   MediaAssetCard.vue         preview click selects, dblclick zooms, and the
//                              hover-only check / download / ellipsis controls
//   MediaAssetSelectionBar.vue floating bar: x / N selected / download / delete
//   useAssetSelection.ts       shift range, ctrl toggle, plain click collapse
//   useAssetGridSelection.ts   4px threshold, rectsIntersect, suppressNextClick
//   marqueeSelectionUtil.ts    normalise + intersect helpers
//
// The panel is plain DOM (no Vue) so it can mount into the canvas shell's
// drawer directly, independent of the frontend's Vue internals.

import { api } from "../../../scripts/api.js";
import { langCode } from "../platform/i18n.js";
import { bindTip } from "../platform/native-tip.js";
import { CSS_GALLERY as CSS } from "./infcanvas-style.js";

const LIST_URL = "/xcat/gallery";
const MEDIA_FOLDER_URL = "/xcat/media/folder";
const MEDIA_PICK_URL = "/xcat/media/folder/pick";
const PROMPT_URL = "/xcat/gallery/prompt";
const ZIP_URL = "/xcat/gallery/zip";
const DELETE_URL = "/xcat/gallery/delete";
const BATCH = 60;
const CACHE_TTL = 5000;

// ------------------------------------------------------------------ strings

const STRINGS = {
    zh: {
        // Sidebar strip label is deliberately short — the full name would wrap
        // to two lines and push the whole tab column around.
        title: "媒体资产",
        panelTitle: "媒体资产",
        tooltip: "浏览 output 与 input 目录里的所有文件",
        mediaFolder: "存放文件夹",
        chooseMediaFolder: "选择存放文件夹",
        mediaFolderNotSet: "尚未设置存放文件夹，点击上方选择",
        mediaFolderOpening: "正在打开文件夹选择…",
        mediaFolderPicked: "存放文件夹已更新",
        mediaFolderPickFailed: "选择文件夹失败",
        mediaFolderSaveFailed: "保存文件夹设置失败",
        tabOutput: "已生成",
        tabInput: "已导入",
        all: "全部",
        text: "文本",
        image: "图像",
        video: "视频",
        audio: "音频",
        other: "其他",
        // Native: $t('g.searchPlaceholder', { subject: $t('sideToolbar.labels.assets') })
        // -> "搜索 {subject}..." with subject "资产". Three dots, not an ellipsis.
        search: "搜索 资产...",
        refresh: "刷新",
        files: "个文件",
        empty: "这里还没有文件",
        noMatch: "没有符合条件的文件",
        loading: "读取中…",
        unauthorized: "登录已过期，请重新登录",
        failed: "读取失败",
        open: "打开原文件",
        close: "关闭",
        viewMenu: "查看设置",
        viewList: "列表视图",
        viewGridSmall: "网格（小）",
        viewGridLarge: "网格（大）",
        audioFace: "音频",
        threeDFace: "3D 模型",
        play: "播放",
        pause: "暂停",
        // Actions below mirror mediaAsset.actions / mediaAsset.selection in the
        // official locale pack, so both panels use the same wording.
        inspect: "查看资产",
        download: "下载",
        moreOptions: "更多选项",
        delete: "删除",
        multipleSelected: "已选择多个资源",
        downloadAll: "全部下载",
        deleteAll: "全部删除",
        deselectAll: "取消全选",
        selectedCount: "已选择资产：{count}",
        deleteItems: "删除这些项目",
        deleteToTrash: "它们将被移动到回收站。",
        cancel: "取消",
        deleteFailed: "删除失败",
        model: "模型",
        prompt: "提示词",
        params: "参数",
        noMetadata: "此文件没有可读取的生成信息",
        metadataFailed: "生成信息读取失败",
        copyPrompt: "复制提示词",
        copied: "提示词已复制",
        copyFailed: "复制失败",
        prevAsset: "上一个素材",
        nextAsset: "下一个素材",
        badgeWeightOpen: "（",
        badgeWeightClose: "）",
    },
    en: {
        title: "Media Assets",
        panelTitle: "Media Assets",
        tooltip: "Browse every file in the output and input directories",
        mediaFolder: "Storage folder",
        chooseMediaFolder: "Choose storage folder",
        mediaFolderNotSet: "No storage folder yet — click above to choose",
        mediaFolderOpening: "Opening folder picker…",
        mediaFolderPicked: "Storage folder updated",
        mediaFolderPickFailed: "Could not choose folder",
        mediaFolderSaveFailed: "Could not save folder",
        tabOutput: "Generated",
        tabInput: "Imported",
        all: "All",
        text: "Text",
        image: "Image",
        video: "Video",
        audio: "Audio",
        other: "Other",
        search: "Search Assets...",
        refresh: "Refresh",
        files: "files",
        empty: "No files here yet",
        noMatch: "No matching files",
        loading: "Loading…",
        unauthorized: "Session expired — sign in again",
        failed: "Failed to load",
        open: "Open in new tab",
        close: "Close",
        viewMenu: "View settings",
        viewList: "List view",
        viewGridSmall: "Grid (small)",
        viewGridLarge: "Grid (large)",
        audioFace: "Audio",
        threeDFace: "3D model",
        play: "Play",
        pause: "Pause",
        inspect: "Inspect asset",
        download: "Download",
        moreOptions: "More options",
        delete: "Delete",
        multipleSelected: "Multiple assets selected",
        downloadAll: "Download all",
        deleteAll: "Delete all",
        deselectAll: "Deselect all",
        selectedCount: "Selected assets: {count}",
        deleteItems: "Delete these items",
        deleteToTrash: "They will be moved to the Recycle Bin.",
        cancel: "Cancel",
        deleteFailed: "Delete failed",
        model: "Model",
        prompt: "Prompt",
        params: "Parameters",
        noMetadata: "No generation info in this file",
        metadataFailed: "Could not read generation info",
        copyPrompt: "Copy prompt",
        copied: "Prompt copied",
        copyFailed: "Could not copy prompt",
        prevAsset: "Previous asset",
        nextAsset: "Next asset",
        badgeWeightOpen: "(",
        badgeWeightClose: ")",
    },
};

// The gallery is mounted inside the canvas shell, so it must follow the SAME
// language switch as the rest of the canvas: the rail's language button calls
// Canvas i18n now mirrors ComfyUI's own `Comfy.Locale` setting, so current()
// already tracks it. `langCode()` is only a fallback for a standalone mount
// where the canvas i18n bus is absent. Resolve on every call — a value captured
// at mount time would stay stale after a language switch.
function activeLang() {
    const fromCanvas = window.InfCanvas?.i18n?.current?.();
    return fromCanvas === "en" || fromCanvas === "zh" ? fromCanvas : langCode();
}
const t = (key) => (STRINGS[activeLang()] || STRINGS.en)[key] ?? key;

// --------------------------------------------------- native class strings
// Copied byte-for-byte from the shipped ComfyUI sources (sourcemap):
//   components/tab/Tab.vue + tab/tab.variants.ts  -> generated/imported tabs
//   components/search-input/searchInput.variants.ts (md) -> search anchor/input
// The panel lives in the host DOM (there is no canvas iframe: #infcanvas-stage
// is a <main> under #infcanvas-root), so the host's UnoCSS rules apply
// directly. Mounting these classes lets ComfyUI own the typography
// (weight/line-height/colour) instead of our hand-drawn CSS.
const NATIVE_TAB_BASE =
    "flex h-8 shrink-0 items-center justify-center px-2.5 cursor-pointer " +
    "rounded-lg border-none text-sm outline-hidden transition-all duration-200 " +
    "focus-visible:ring-1 focus-visible:ring-ring";
const NATIVE_TAB_ON = "bg-accent text-foreground";
const NATIVE_TAB_OFF = "bg-transparent text-muted-foreground hover:bg-accent focus:bg-accent";
const NATIVE_SEARCH_ANCHOR =
    "relative flex w-full cursor-text items-center rounded-lg bg-secondary " +
    "text-foreground focus-within:ring-1 focus-within:ring-ring h-8 px-2 py-1.5";
const NATIVE_SEARCH_INPUT =
    "size-full border-none bg-transparent outline-none pl-8 text-xs";
// SearchInput.vue md icon slot: pointer-events-none absolute + left-2.5 +
// size-4; colour is inherited from the anchor's text-foreground.
const NATIVE_SEARCH_ICON = "pointer-events-none absolute left-2.5 size-4 text-foreground";

// Menu surface / items — menuStyles.ts verbatim (same as NS.NATIVE_MENU in
// infcanvas-ui.js). Used for BOTH the view switcher and the context menu so the
// two menus can never drift apart from ComfyUI's own dropdowns.
const NATIVE_MENU_CONTENT =
    "min-w-48 overflow-y-auto rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none";
const NATIVE_MENU_ITEM =
    "flex min-h-8 cursor-default items-center gap-2 rounded-md px-3 py-1.5 " +
    "text-sm outline-none data-disabled:opacity-50 data-highlighted:bg-accent " +
    "w-full justify-start border-0 bg-transparent text-left hover:bg-accent " +
    "focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50";
const NATIVE_MENU_SEP = "my-1 h-px bg-border/50";
// View switcher items are plain textonly Buttons (MediaAssetSettingsMenu.vue),
// not menu items: h-8 p-2 text-xs, icon size-4, trailing check ml-auto.
const NATIVE_VIEW_ITEM =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center " +
    "justify-between gap-2 rounded-lg border-none font-inter text-xs font-medium " +
    "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring " +
    "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 " +
    "w-full bg-transparent text-foreground hover:bg-accent h-8 p-2";
// Card root (MediaAssetCard.vue). Selected = grey inset ring, idle = faint
// accent hover; `.xog-card` / data-selected stay as behaviour hooks only.
const NATIVE_CARD_BASE =
    "flex cursor-pointer flex-col overflow-hidden rounded-lg p-2 transition-colors " +
    "duration-200 group gap-2 select-none";
const NATIVE_CARD_IDLE = "hover:bg-accent/20";
const NATIVE_CARD_SELECTED = "ring-3 ring-muted-foreground ring-inset";
// List row (AssetsSidebarListView.getAssetCardClass): full-width accent row,
// selected adds the same 1px grey inset ring.
const NATIVE_ROW_BASE =
    "w-full text-foreground transition-colors hover:bg-accent cursor-pointer";
const NATIVE_ROW_SELECTED = "bg-accent ring-1 ring-muted-foreground ring-inset";
// overlay-white icon Button (button.variants.ts) used by the check circle and
// the download/delete pair. Size/rounding are appended per-use so size-6 and
// size-8 never collide (UnoCSS resolves equal-specificity utilities by sheet
// order, not by the order classes appear on the element).
const NATIVE_BTN_OVERLAY_BASE =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center " +
    "justify-center gap-2 border-none font-inter text-sm font-medium " +
    "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring " +
    "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
const NATIVE_BTN_OVERLAY_ON = NATIVE_BTN_OVERLAY_BASE + " rounded-lg bg-white text-gray-600 hover:bg-white/90 size-8";
// List-row actions are secondary icon Buttons (bg-secondary + hover:bg-accent).
const NATIVE_BTN_SECONDARY = NATIVE_BTN_OVERLAY_BASE + " rounded-lg bg-secondary text-foreground hover:bg-accent size-8";
// Unselected check circle adds the transparent + white ring treatment.
const NATIVE_CHECK_BASE = NATIVE_BTN_OVERLAY_BASE + " rounded-full size-6";
const NATIVE_CHECK_OFF = "bg-transparent text-white shadow-sm ring-2 ring-white ring-inset hover:bg-white/20";
// Selected check keeps the overlay-white fill but stays a 24px circle.
const NATIVE_CHECK_ON = "bg-white text-gray-600 hover:bg-white/90";
// MediaAssetCard.vue toggles opacity-0 on the check SVG itself when unselected.
const NATIVE_CHECK_ICON_OFF = "size-4 shrink-0 opacity-0";
const NATIVE_CHECK_ICON_ON = "size-4 shrink-0";
// IconGroup(background-class="bg-white") — the white plate behind the actions.
const NATIVE_ICON_GROUP =
    "flex shrink-0 items-center justify-center rounded-lg border-none bg-white p-0 " +
    "shadow-sm outline-hidden transition-all duration-200";
// Hover/focus reveal (MediaAssetCard.vue): overlays stay invisible until the
// card is hovered or focused. `.xog-card` now carries the native `group` class.
const NATIVE_REVEAL =
    "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto " +
    "group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";
// Button.vue + button.variants.ts — mounted on every toolbar / lightbox /
// selection-bar button so hover, focus ring and typography come from the host.
const NATIVE_BTN_BASE =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none items-center " +
    "justify-center gap-2 border-none font-inter text-sm font-medium " +
    "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring " +
    "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([width]):not([height])]:size-4";
const NATIVE_BTN_ICON = NATIVE_BTN_BASE + " size-8 rounded-lg";
const NATIVE_BTN_SECONDARY_ICON = NATIVE_BTN_ICON + " bg-secondary text-foreground hover:bg-accent";
const NATIVE_BTN_MUTED_ICON = NATIVE_BTN_ICON + " bg-transparent text-muted-foreground hover:bg-accent";
// ErrorNodeCard.vue header copy: Button(variant=muted-textonly, size=icon-sm,
// class="size-7 shrink-0 hover:text-foreground focus-visible:ring-inset").
// Used by the lightbox "Prompt" row's copy action.
const NATIVE_BTN_COPY_SM =
    NATIVE_BTN_BASE + " size-7 shrink-0 rounded-md bg-transparent p-0 " +
    "text-muted-foreground hover:bg-accent hover:text-foreground " +
    "focus-visible:ring-inset";
// MediaAssetSelectionBar.vue: inverted icon-lg plus the bar's own
// hover:bg-background/10 (cn() drops the inverted hover:bg-foreground/80).
const NATIVE_BTN_INVERTED_LG =
    NATIVE_BTN_BASE + " size-10 rounded-lg bg-foreground text-background hover:bg-background/10";
// MediaLightbox.vue prev/next: secondary icon-lg, rounded-full after cn() merge.
const NATIVE_BTN_NAV =
    NATIVE_BTN_BASE + " size-10 rounded-full bg-secondary text-foreground hover:bg-accent";
// MediaAssetCard.vue info row / MediaImageTop.vue preview plate.
const NATIVE_CARD_META = "flex min-w-0 flex-col gap-1";
const NATIVE_CARD_NAME = "truncate text-sm text-foreground";
const NATIVE_CARD_SUB = "flex items-center gap-1.5 text-xs text-muted-foreground";
// AssetsListItem.vue (list view) text stack: the row itself is text-xs
// leading-none, with plain block/truncate lines inside. This is the native
// reason the old CSS override used 12px/12px in list mode.
const NATIVE_LIST_META = "flex min-w-0 flex-1 flex-col gap-1 text-xs leading-none";
const NATIVE_LIST_NAME = "block truncate text-foreground";
const NATIVE_LIST_SUB = "block truncate text-muted-foreground";
// AssetsListItem.vue actions slot carries no IconGroup plate — just a flex row.
const NATIVE_LIST_ACTIONS = "flex shrink-0 items-center gap-2";
// JobDetailsPopover.vue header/value rows — the closest native typography for
// our canvas-only lightbox header (MediaLightbox.vue itself has no title bar).
const NATIVE_LB_TITLE = "truncate text-sm/normal font-normal text-foreground";
const NATIVE_LB_META = "truncate text-xs text-muted-foreground";
// Generic muted helper text (loading/error rows).
const NATIVE_TEXT_SM_MUTED = "text-sm text-muted-foreground";
// MediaAssetSettingsButton.vue wraps MediaAssetSettingsMenu.vue in Popover.vue
// (NOT a DropdownMenu). Popover.vue content class + its PopoverArrow (default
// width=10 height=5, side=bottom, sideOffset=5) are the real source of the
// view-switcher menu. Distinct from NATIVE_MENU_CONTENT (menuStyles.ts) which
// stays for the bulk context menu. p-2 / border-border/50 / shadow-sm, and no
// min-width — the surface hugs its widest item.
const NATIVE_POPOVER_CONTENT =
    "z-overlay rounded-lg border border-border/50 bg-background p-2 shadow-sm " +
    "will-change-[transform,opacity] text-foreground";
const NATIVE_POPOVER_ARROW_SVG =
    '<svg width="10" height="5" viewBox="0 0 12 6" preserveAspectRatio="none" ' +
    'class="fill-background stroke-border/50" style="display:block">' +
    '<path d="M0 0L6 6L12 0"></path></svg>';
// MediaImageTop.vue plate (bg-muted) and MediaVideoTop.vue (bg-black) differ
// only in the plate colour — pick by kind so the black is a native class,
// never a hard-coded #000.
const NATIVE_PREVIEW_PLATE = "relative aspect-square overflow-hidden rounded-sm bg-muted";
// MediaAudioTop.vue placeholder + WaveAudioPlayer.vue compact (bar-count 40,
// height 32, align=bottom). The host's own tokens drive every colour.
const NATIVE_AUDIO_FACE =
    "xog-fill absolute inset-0 flex flex-col items-center justify-center gap-2 " +
    "bg-muted text-foreground transition-transform duration-300 group-hover:scale-105";
const NATIVE_AUDIO_PLAYER = "flex w-full gap-2 items-end";
const NATIVE_AUDIO_BTN =
    NATIVE_BTN_BASE + " size-7 shrink-0 rounded-full p-0 " +
    "bg-muted-foreground/15 hover:bg-muted-foreground/25 text-foreground";
const NATIVE_AUDIO_WAVE = "flex min-w-0 flex-1 cursor-pointer gap-px items-end";
const NATIVE_AUDIO_BAR = "min-h-0.5 flex-1 rounded-full bg-muted-foreground/20";
const NATIVE_AUDIO_BAR_READY = "min-h-0.5 flex-1 rounded-full bg-muted-foreground/40";
const NATIVE_AUDIO_BAR_PLAYED = "min-h-0.5 flex-1 rounded-full bg-foreground";
const NATIVE_AUDIO_TIME = "shrink-0 text-xs text-muted-foreground tabular-nums";
const NATIVE_VIDEO_PLATE = "relative aspect-square overflow-hidden rounded-sm bg-black";
const NATIVE_PREVIEW_IMG =
    "size-full object-contain transition-transform duration-300 group-hover:scale-105";
// NoResultsPlaceholder.vue / MediaAssetSelectionBar.vue / MediaLightbox.vue.
const NATIVE_EMPTY_ROOT = "h-full p-8 flex flex-col items-center text-center";
const NATIVE_EMPTY_ICON = "mb-4 text-5xl";
const NATIVE_EMPTY_TITLE = "mb-2 text-foreground";
const NATIVE_SELBAR =
    "flex items-center gap-2 rounded-lg bg-foreground p-2 text-background shadow-md";
const NATIVE_SELCOUNT = "pr-6 text-sm font-bold whitespace-nowrap tabular-nums";
const NATIVE_SELRIGHT = "ml-auto flex shrink-0 items-center gap-1";
const NATIVE_SELDIV = "h-6 w-px bg-background/20";

// ------------------------------------------------------------------- icons



/* Native glyphs only: ComfyUI inlines lucide SVGs into its build-time CSS as
   icon-[lucide--*] (mask-image + currentColor). Every name below was verified
   to exist in main-*.css. Keeping the old svgIcon(name, cls) call signature so
   no call site changes shape; only the element/classes differ. */
const LUCIDE_NAME = {
    search: "search",
    settings: "settings-2",
    list: "list",
    gridSmall: "grid-2x2",
    gridLarge: "grid-3x3",
    check: "check",
    refresh: "refresh-cw",
    play: "play",
    pause: "pause",
    music: "music",
    box: "box",
    text: "text",
    file: "file",
    image: "image",
    video: "video",
    download: "download",
    copy: "copy",
    externalLink: "external-link",
    trash: "trash-2",
    x: "x",
    zoomIn: "zoom-in",
    ellipsis: "ellipsis",
    chevronLeft: "chevron-left",
    chevronRight: "chevron-right",
    zoomIn_face: "zoom-in",
};
function svgIcon(name, cls) {
    const el = document.createElement("i");
    // Delete uses PrimeIcons `pi pi-trash` — the same glyph the canvas
    // management context menus draw, so all delete actions look alike.
    if (name === "trash") {
        el.className = "pi pi-trash" + (cls ? " " + cls : "");
    } else {
        const glyph = LUCIDE_NAME[name] || "file";
        el.className = "icon-[lucide--" + glyph + "]" + (cls ? " " + cls : "");
    }
    el.setAttribute("aria-hidden", "true");
    return el;
}

// Tooltip engine lives in ./native-tip.js (shared by all canvas modules).

// Mirrors the native panel's three view modes. Kept under our own key so the
// two sidebars can be set independently.
const VIEW_KEY = "xcat.gallery.view";
const VIEW_MODES = ["list", "grid-small", "grid"];

// Five media chips: 全部 / 文本 / 图像 / 视频 / 音频 (All / Text / Image / Video / Audio).
// `all` is the default and maps to null (no kind restriction), so 3D and other
// files that have no dedicated chip stay reachable there.
const FILTER_GROUPS = {
    all: null,
    text: ["text"],
    image: ["image"],
    video: ["video"],
    audio: ["audio"],
};

// Marquee constants, straight from useAssetGridSelection.ts.
const DRAG_THRESHOLD_PX = 4;
const CARD_SELECTOR = "[data-asset-id]";
const INTERACTIVE_SELECTOR =
    'button, input, textarea, select, a[href], [role="slider"], [role="tab"], [contenteditable]';

function getViewMode() {
    const v = window.InfCanvas?.prefs?.get(VIEW_KEY, "");
    return VIEW_MODES.includes(v) ? v : "grid-small";
}

// getMediaAssetGridColumns() from the frontend source, verbatim.
function gridColumns(mode) {
    const minWidth = mode === "grid-small" ? 128 : 240;
    return `repeat(auto-fill, minmax(min(${minWidth}px, 30vw), 1fr))`;
}

// ------------------------------------------------------------------ helpers

function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = n / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function fmtTime(ts) {
    const d = new Date((Number(ts) || 0) * 1000);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const pad = (v) => String(v).padStart(2, "0");
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return sameYear
        ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtCount(template, count) {
    return String(template).replace("{count}", String(count));
}

// Every URL the grid needs is minted by the server (signed), so a native
// <img> / <a download> can fetch it without carrying any identity header.
function fileUrl(file, preview) {
    if (preview) return file?.preview_url || file?.url || "";
    return file?.url || "";
}

function relPath(file) {
    return file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
}

// "app.json" → "JSON"; a dot-less name has no format to show.
function fileExt(file) {
    const name = file.filename || "";
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return "";
    return name.slice(dot + 1).toUpperCase();
}

function payload(files) {
    return { files: files.map((f) => ({ source: f.source, path: f.path })) };
}

// The canvas shell is a separate IIFE with its own drop contract: it accepts
// `application/x-infcanvas-asset` carrying a flat asset record, NOT ComfyUI's
// main-UI `x-comfy-asset-info`. Rebuild that record from the gallery entry and
// keep its signed URL verbatim — re-deriving a /view? URL would 404 for
// multi-user files and for thumbnails served by the gallery route.
function toCanvasAsset(file) {
    return {
        name: file.filename,
        filename: file.filename,
        subfolder: file.subfolder || "",
        type: file.source === "input" ? "input" : "output",
        kind: file.kind || "other",
        size: file.size,
        mtime: file.mtime,
        path: file.path,
        url: fileUrl(file),
    };
}

// formatUtil.ts formatTime(), used by WaveAudioPlayer's compact time readout.
function formatTime(seconds) {
    if (Number.isNaN(seconds) || !seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ":" + String(secs).padStart(2, "0");
}

// Waveform peaks for an audio tile. Decoding a whole file into an AudioBuffer is
// the only way to get real amplitudes (that is what the native player does too),
// so the call is gated on visibility and on a size ceiling.
const WAVE_DECODE_LIMIT = 40 * 1024 * 1024;

async function decodeWaveform(file, barList) {
    if ((Number(file.size) || 0) > WAVE_DECODE_LIMIT) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    let ctx;
    try {
        const res = await fetch(fileUrl(file, false), {
            credentials: "same-origin",
        });
        if (!res.ok) return;
        const bytes = await res.arrayBuffer();
        ctx = new Ctor();
        const buffer = await ctx.decodeAudioData(bytes);
        const data = buffer.getChannelData(0);
        if (!data.length) return;

        const peaks = [];
        for (let i = 0; i < barList.length; i += 1) {
            const start = Math.floor((i * data.length) / barList.length);
            const end = Math.max(
                start + 1,
                Math.floor(((i + 1) * data.length) / barList.length)
            );
            let sum = 0;
            for (let j = start; j < end && j < data.length; j += 1) {
                sum += Math.abs(data[j]);
            }
            peaks.push(sum / (end - start));
        }
        const max = Math.max(...peaks) || 1;
        peaks.forEach((peak, i) => {
            barList[i].style.height = `${Math.max(8, (peak / max) * 100)}%`;
        });
    } catch {
        /* codec unsupported or decode failed — keep the placeholder bars */
    } finally {
        try {
            await ctx?.close();
        } catch {
            /* already closed */
        }
    }
}

// ------------------------------------------------------------------ styles


function ensureStyle() {
    if (document.getElementById("xog-style")) return;
    const style = document.createElement("style");
    style.id = "xog-style";
    style.textContent = CSS;
    document.head.appendChild(style);
}

// ------------------------------------------------------------------ lightbox

let lightbox = null;
// The file currently shown, so the header's delete button always acts on the
// asset the user is looking at (it changes with the prev/next arrows too).
let currentLbFile = null;
// Bumped every time the lightbox opens or closes so a slow metadata response
// for a previous file cannot overwrite the info strip of the current one.
let infoSeq = 0;
let lbSeq = 0;

function ensureLightbox() {
    if (lightbox) return lightbox;
    ensureStyle();

    const el = document.createElement("div");
    el.className = "xog-lb fixed inset-0 flex items-center justify-center bg-black/90";
    el.hidden = true;
    el.innerHTML = `
        <div class="xog-lb-panel">
            <div class="xog-lb-head">
                <div class="xog-lb-titles">
                    <span class="xog-lb-name ${NATIVE_LB_TITLE}"></span>
                    <span class="xog-lb-meta ${NATIVE_LB_META}"></span>
                </div>
                <div class="xog-lb-actions">
                    <button class="xog-btn xog-lb-open ${NATIVE_BTN_SECONDARY_ICON}" type="button"></button>
                    <button class="xog-btn xog-lb-download ${NATIVE_BTN_SECONDARY_ICON}" type="button"></button>
                    <button class="xog-btn xog-lb-delete ${NATIVE_BTN_SECONDARY_ICON}" type="button"></button>
                    <button class="xog-btn xog-lb-close ${NATIVE_BTN_SECONDARY_ICON}" type="button"></button>
                </div>
            </div>
            <div class="xog-lb-main">
                <div class="xog-lb-stage">
                    <button class="xog-lb-nav xog-lb-prev ${NATIVE_BTN_NAV}" type="button" hidden></button>
                    <div class="xog-lb-body bg-black"></div>
                    <button class="xog-lb-nav xog-lb-next ${NATIVE_BTN_NAV}" type="button" hidden></button>
                </div>
                <div class="xog-lb-info" hidden></div>
            </div>
        </div>`;
    document.body.appendChild(el);

    const openBtn = el.querySelector(".xog-lb-open");
    const downloadBtn = el.querySelector(".xog-lb-download");
    const deleteBtn = el.querySelector(".xog-lb-delete");
    const closeBtn = el.querySelector(".xog-lb-close");
    bindTip(openBtn, () => t("open"));
    openBtn.appendChild(svgIcon("externalLink", "size-4"));
    bindTip(downloadBtn, () => t("download"));
    downloadBtn.appendChild(svgIcon("download", "size-4"));
    bindTip(deleteBtn, () => t("delete"));
    deleteBtn.setAttribute("aria-label", t("delete"));
    deleteBtn.appendChild(svgIcon("trash", "size-4"));
    bindTip(closeBtn, () => t("close"));
    closeBtn.appendChild(svgIcon("x", "size-4"));

    deleteBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (deleteBtn.disabled) return;
        const file = currentLbFile;
        if (!file) return;
        deleteBtn.disabled = true;
        try {
            const done = await deleteFiles([file]);
            if (!done) return;
            document.dispatchEvent(new CustomEvent("xog-lightbox-deleted", { detail: { file } }));
            close();
        } finally {
            deleteBtn.disabled = false;
        }
    });

    const close = () => {
        infoSeq++;
        currentLbFile = null;
        el.hidden = true;
        el.querySelector(".xog-lb-body").replaceChildren();
        const info = el.querySelector(".xog-lb-info");
        info.hidden = true;
        info.replaceChildren();
        navFiles = [];
        navIndex = -1;
        updateNav();
    };
    closeBtn.addEventListener("click", close);
    el.addEventListener("click", (ev) => {
        if (ev.target === el) close();
    });
    document.addEventListener("keydown", (ev) => {
        if (el.hidden) return;
        if (ev.key === "Escape") close();
        else if (ev.key === "ArrowLeft" && navIndex > 0) {
            ev.preventDefault();
            lightbox.step(-1);
        } else if (ev.key === "ArrowRight" && navIndex < navFiles.length - 1) {
            ev.preventDefault();
            lightbox.step(1);
        }
    });

    const infoEl = el.querySelector(".xog-lb-info");

    // Short, stable labels for the badges. The backend already collapses the
    // widget names to Checkpoint/UNet/LoRA/strength and cfg/steps/seed; keep a
    // fallback for any other spelling a custom node might use.
    const BADGE_ORDER = { CHECKPOINT: 0, UNET: 0, LORA: 1, SEED: 2, STEP: 3, CFG: 4 };
    function badgeTag(field) {
        const key = String(field.key || "").toLowerCase();
        if (key.includes("checkpoint")) return "CHECKPOINT";
        if (key.includes("unet")) return "UNET";
        if (key.includes("lora")) return "LORA";
        if (key === "strength" || key === "强度") return "强度";
        if (key === "step" || key === "steps") return "STEP";
        if (key === "seed") return "SEED";
        if (key === "cfg") return "CFG";
        return String(field.key || "").toUpperCase();
    }

    async function loadInfo(file) {
        const seq = ++infoSeq;
        infoEl.hidden = true;
        infoEl.replaceChildren();
        // Reuse the signed file URL's query (source/path/token) so the prompt
        // route is scoped to exactly the file this lightbox is showing.
        // Canvas task results carry no signed token (their preview is a plain
        // /view? link), so use the explicit source/path the caller supplied:
        // the prompt route falls back to the Comfy-User request header.
        let query;
        if (file.metaSource && file.metaPath) {
            const q = new URLSearchParams({
                source: file.metaSource,
                path: file.metaPath,
            });
            query = "?" + q.toString();
        } else {
            try {
                query = new URL(file.url || "", location.href).search;
            } catch {
                return;
            }
        }
        if (!query) return;
        try {
            const res = await api.fetchApi(PROMPT_URL + query, { cache: "no-store" });
            if (seq !== infoSeq || el.hidden) return;
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            if (seq !== infoSeq || el.hidden) return;
            const models = data.models || [];
            const prompts = data.prompts || [];
            const params = data.params || [];
            if (!data.found || (!models.length && !prompts.length && !params.length)) {
                const empty = document.createElement("div");
                empty.className = "xog-lb-info-empty text-xs text-muted-foreground";
                empty.textContent = t("noMetadata");
                infoEl.appendChild(empty);
            } else {
                // Prompt text gets a dedicated, readable block of its own,
                // with the label and copy button inside that box.
                if (prompts.length) {
                    const box = document.createElement("div");
                    box.className = "xog-lb-prompts";
                    const card = document.createElement("div");
                    card.className = "xog-lb-prompt";
                    const head = document.createElement("div");
                    head.className = "xog-lb-prompts-head";
                    const title = document.createElement("span");
                    title.className = "xog-lb-prompts-title text-2xs font-bold tracking-wider";
                    title.textContent = t("prompt");
                    const copyBtn = document.createElement("button");
                    copyBtn.type = "button";
                    copyBtn.className = `xog-btn xog-lb-prompt-copy ${NATIVE_BTN_COPY_SM}`;
                    bindTip(copyBtn, () => t("copyPrompt"));
                    copyBtn.setAttribute("aria-label", t("copyPrompt"));
                    copyBtn.appendChild(svgIcon("copy", "size-4"));
                    copyBtn.addEventListener("click", async () => {
                        const text = prompts.map((field) => String(field.value ?? "")).join("\n");
                        try {
                            await navigator.clipboard.writeText(text);
                            window.InfCanvas?.api?.toast?.("success", t("copied"));
                        } catch {
                            window.InfCanvas?.api?.toast?.("error", t("copyFailed"));
                        }
                    });
                    head.append(title, copyBtn);
                    card.appendChild(head);
                    for (const field of prompts) {
                        const item = document.createElement("div");
                        item.className = "xog-lb-prompt-text text-xs/normal";
                        item.textContent = String(field.value ?? "");
                        card.appendChild(item);
                    }
                    box.appendChild(card);
                    infoEl.appendChild(box);
                }

                // Everything else is a badge. LoRA strength is a separate
                // widget on the same node, so fold it into the filename badge
                // as "（0.2）" rather than showing a second, orphan chip.
                // Pair by the SAME LoRA row (node id + entry index), not by
                // display title: one loader can hold several rows, and a
                // disabled row must not shift the strength onto the next one.
                const entryKey = (field) => `${field.id || field.node || ""}::${field.group || ""}`;
                const strengthByEntry = new Map();
                for (const field of models) {
                    if (badgeTag(field) !== "强度") continue;
                    const key = entryKey(field);
                    const list = strengthByEntry.get(key) || [];
                    list.push(String(field.value ?? ""));
                    strengthByEntry.set(key, list);
                }
                const loraSeen = new Map();
                const badges = [];
                const addBadge = (tag, value, weight = "") => {
                    // Model/LoRA selectors store "folder/name.safetensors";
                    // both the folder and the model extension are noise in a
                    // badge. Numeric params have neither and stay intact. The
                    // strength is kept separately so it can sit at the right
                    // edge while the name ellipsizes on one line.
                    const text = String(value ?? "")
                        .split(/[\\/]/).pop()
                        .replace(/\.(safetensors|ckpt|pt|pth|bin|onnx)/gi, "");
                    if (!badges.some((b) => b.tag === tag && b.value === text && b.weight === weight)) {
                        badges.push({ tag, value: text, weight });
                    }
                };
                for (const field of models) {
                    const tag = badgeTag(field);
                    if (tag === "强度") continue;
                    const value = String(field.value ?? "");
                    let weight = "";
                    if (tag === "LORA") {
                        const key = entryKey(field);
                        const i = loraSeen.get(key) || 0;
                        loraSeen.set(key, i + 1);
                        const strength = (strengthByEntry.get(key) || [])[i];
                        if (strength) weight = String(strength);
                    }
                    addBadge(tag, value, weight);
                }
                for (const field of params) addBadge(badgeTag(field), field.value);
                badges.sort((a, b) => (BADGE_ORDER[a.tag] ?? 9) - (BADGE_ORDER[b.tag] ?? 9));
                if (badges.length) {
                    const box = document.createElement("div");
                    box.className = "xog-lb-badges";
                    for (const badge of badges) {
                        const chip = document.createElement("span");
                        chip.className = "xog-lb-badge text-xs/normal";
                        const tag = document.createElement("span");
                        tag.className = "xog-lb-badge-tag text-2xs font-bold tracking-wide";
                        tag.textContent = `${badge.tag}:`;
                        const val = document.createElement("span");
                        val.className = "xog-lb-badge-val";
                        if (badge.weight) {
                            val.classList.add("xog-lb-badge-lora");
                            const name = document.createElement("span");
                            name.className = "xog-lb-badge-name";
                            name.textContent = badge.value;
                            bindTip(name, () => badge.value);
                            const weight = document.createElement("span");
                            weight.className = "xog-lb-badge-weight";
                            weight.textContent = t("badgeWeightOpen") + badge.weight + t("badgeWeightClose");
                            val.append(name, weight);
                        } else {
                            val.textContent = badge.value;
                            bindTip(val, () => badge.value);
                        }
                        chip.append(tag, val);
                        box.appendChild(chip);
                    }
                    infoEl.appendChild(box);
                }
            }
            infoEl.hidden = false;
        } catch {
            if (seq !== infoSeq || el.hidden) return;
            const empty = document.createElement("div");
            empty.className = "xog-lb-info-empty text-xs text-muted-foreground";
            empty.textContent = t("metadataFailed");
            infoEl.appendChild(empty);
            infoEl.hidden = false;
        }
    }

    // Ordered list backing the prev/next arrows. The caller passes the current
    // (filtered) gallery view so stepping follows exactly what the user sees.
    let navFiles = [];
    let navIndex = -1;
    const prevBtn = el.querySelector(".xog-lb-prev");
    const nextBtn = el.querySelector(".xog-lb-next");
    prevBtn.appendChild(svgIcon("chevronLeft", "size-6"));
    nextBtn.appendChild(svgIcon("chevronRight", "size-6"));
    bindTip(prevBtn, () => t("prevAsset"));
    bindTip(nextBtn, () => t("nextAsset"));
    prevBtn.setAttribute("aria-label", t("prevAsset"));
    nextBtn.setAttribute("aria-label", t("nextAsset"));

    function sameFile(a, b) {
        if (!a || !b) return false;
        if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
        return a.source === b.source && a.path === b.path && a.filename === b.filename;
    }

    function updateNav() {
        prevBtn.hidden = navIndex <= 0;
        nextBtn.hidden = navIndex < 0 || navIndex >= navFiles.length - 1;
    }

    lightbox = {
        el,
        open(file, files, options) {
            // Task-result previews are read-only: hide the gallery "delete"
            // action (it would POST a fake source/path to the asset delete
            // route). The 资产 grid calls open() without options → unchanged.
            deleteBtn.hidden = !!(options && options.hideDelete);
            navFiles = Array.isArray(files) && files.length ? files : [file];
            navIndex = navFiles.findIndex((f) => sameFile(f, file));
            if (navIndex < 0) {
                navFiles = [file];
                navIndex = 0;
            }
            updateNav();
            this.show(file);
        },
        step(delta) {
            const next = navIndex + delta;
            if (next < 0 || next >= navFiles.length) return;
            navIndex = next;
            updateNav();
            this.show(navFiles[next]);
        },
        show(file) {
            currentLbFile = file;
            const url = fileUrl(file, false);
            const seq = ++lbSeq;
            el.querySelector(".xog-lb-name").textContent = file.filename || "";
            const metaEl = el.querySelector(".xog-lb-meta");
            const baseMeta = `${fmtSize(file.size)} · ${fmtTime(file.mtime)}`;
            metaEl.textContent = baseMeta;
            const setDims = (w, h) => {
                if (seq !== lbSeq || !w || !h) return;
                metaEl.textContent = `${w}×${h} · ${baseMeta}`;
            };

            const body = el.querySelector(".xog-lb-body");
            body.replaceChildren();
            let node;
            if (file.kind === "image") {
                node = document.createElement("img");
                node.addEventListener("load", () => setDims(node.naturalWidth, node.naturalHeight));
                node.src = url;
                node.alt = file.filename || "";
                if (node.complete && node.naturalWidth) setDims(node.naturalWidth, node.naturalHeight);
            } else if (file.kind === "video") {
                node = document.createElement("video");
                node.addEventListener("loadedmetadata", () => setDims(node.videoWidth, node.videoHeight));
                node.src = url;
                node.controls = true;
                node.autoplay = true;
                node.loop = true;
                node.playsInline = true;
            } else if (file.kind === "audio") {
                node = document.createElement("audio");
                node.src = url;
                node.controls = true;
                node.autoplay = true;
            } else if (file.kind === "text") {
                node = document.createElement("pre");
                // font-mono + text-xs/normal = the native monospace 12px/18px.
                node.className = "font-mono text-xs/normal";
                node.textContent = t("loading");
                fetch(url, { credentials: "same-origin" })
                    .then((res) => (res.ok ? res.text() : ""))
                    .then((text) => {
                        node.textContent = text.slice(0, 200000) || file.filename;
                    })
                    .catch(() => {
                        node.textContent = file.filename;
                    });
            } else {
                // 3D models and unknown files have no in-browser preview; show
                // the same glyph the grid tile uses, plus the open/download pair
                // in the header.
                node = document.createElement("div");
                node.className = "xog-lb-face";
                node.appendChild(svgIcon(file.kind === "3d" ? "box" : "file", "size-12"));
                const label = document.createElement("span");
                label.textContent =
                    file.kind === "3d" ? t("threeDFace") : fileExt(file);
                node.appendChild(label);
            }
            body.appendChild(node);

            openBtn.onclick = () => window.open(url, "_blank", "noopener");
            downloadBtn.onclick = () => triggerDownload([file]);
            el.hidden = false;
            // Images, videos and audio saved by ComfyUI all carry the same
            // prompt/workflow graph in their metadata. Text and unknown kinds
            // have no such graph, so don't flash an empty strip for them.
            if (["image", "video", "audio"].includes(file.kind)) loadInfo(file);
        },
    };
    prevBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        lightbox.step(-1);
    });
    nextBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        lightbox.step(1);
    });

    // The lightbox is a module-level singleton: a language switch only rebuilds
    // the drawer panel, not this element. Repaint its own static labels and any
    // metadata strip already on screen. Subscribe once, outside the panel's
    // cleanup lifetime, so it keeps working across panel remounts.
    if (!window.InfCanvas?._xogLbLocaleSubscribed && window.InfCanvas?.i18n?.onChange) {
        window.InfCanvas.i18n.onChange(() => {
            bindTip(openBtn, () => t("open"));
            bindTip(downloadBtn, () => t("download"));
            bindTip(deleteBtn, () => t("delete"));
            deleteBtn.setAttribute("aria-label", t("delete"));
            bindTip(closeBtn, () => t("close"));
            bindTip(prevBtn, () => t("prevAsset"));
            bindTip(nextBtn, () => t("nextAsset"));
            prevBtn.setAttribute("aria-label", t("prevAsset"));
            nextBtn.setAttribute("aria-label", t("nextAsset"));
            if (currentLbFile && !el.hidden &&
                ["image", "video", "audio"].includes(currentLbFile.kind)) {
                void loadInfo(currentLbFile);
            }
        });
        window.InfCanvas._xogLbLocaleSubscribed = true;
    }
    return lightbox;
}

// ------------------------------------------------------------- download / zip

function filenameFromDisposition(header) {
    const match = /filename\*?=(?:"([^"]+)"|([^;]+))/i.exec(header || "");
    if (!match) return "";
    return decodeURIComponent((match[1] || match[2] || "").trim());
}

function triggerDownload(files) {
    if (!files.length) return;
    if (files.length === 1) {
        const file = files[0];
        const a = document.createElement("a");
        a.href = fileUrl(file, false);
        a.download = file.filename || "download";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }
    void downloadZip(files);
}

async function downloadZip(files) {
    try {
        const res = await api.fetchApi(ZIP_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload(files)),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download =
            filenameFromDisposition(res.headers.get("Content-Disposition")) ||
            "comfyui-gallery.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch {
        /* download aborted or server refused — nothing to surface here */
    }
}

// ------------------------------------------------------------ delete confirm

let confirmDialog = null;

function ensureConfirmDialog() {
    if (confirmDialog) return confirmDialog;
    /* Every delete in the product uses ComfyUI's own dialog.confirm(type:delete)
       so the look matches ComfyUI exactly — no hand-rolled dialog. Keep the
       .ask(files) shape so all callers stay unchanged. */
    confirmDialog = {
        /** Resolves true when the user confirms; mirrors dialogService.confirm. */
        async ask(files) {
            const paths = files.slice(0, 50).map((file) => relPath(file));
            if (files.length > 50) paths.push(`… +${files.length - 50}`);
            const api = window.InfCanvas?.api;
            if (api?.confirmDialog) {
                return await api.confirmDialog({
                    title: t("deleteItems"),
                    message: t("deleteToTrash"),
                    itemList: paths,
                    type: "delete", key: "xog-delete-items",
                });
            }
            /* Fallback (canvas API not ready): plain confirm. */
            return window.confirm(t("deleteItems") + "\n\n" + t("deleteToTrash") +
                "\n\n" + paths.join("\n"));
        },
    };
    return confirmDialog;
}

async function deleteFiles(files) {
    if (!files.length) return false;
    const ok = await ensureConfirmDialog().ask(files);
    if (!ok) return false;
    try {
        const res = await api.fetchApi(DELETE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload(files)),
        });
        if (!res.ok) {
            notify(t("deleteFailed"), { severity: "error" });
            return false;
        }
        // The batch reaches the Recycle Bin in one shell call, so the reply is
        // all-or-nothing; failures still carry a reason worth showing.
        const data = await res.json().catch(() => null);
        const failed = Array.isArray(data?.failed) ? data.failed : [];
        if (failed.length) {
            // A failed item is echoed back as {source, path, error}, not as the
            // manifest entry, so relPath() would print "undefined".
            const names = failed
                .map((f) => f.path || f.filename || "")
                .filter(Boolean);
            notify(t("deleteFailed"), {
                detail: names.join(" · "),
                severity: "error",
            });
        }
        return true;
    } catch {
        notify(t("deleteFailed"), { severity: "error" });
        return false;
    }
}

// ------------------------------------------------------------------ panel

// Last manifest, so switching tabs repaints instantly instead of flashing.
let cache = { at: 0, data: null };

function buildPanel(host, options = {}) {
    const mediaMode = options.mode === "media";
    ensureStyle();
    host.classList.add("xog");
    host.classList.toggle("xog-media", mediaMode);
    host.classList.toggle("xog--shell", !!options.headSlot);

    host.innerHTML = `
        <div class="xog-bar">
            <div class="xog-srctabs-row">
                <div class="xog-srctabs" role="tablist"></div>
                <span class="xog-count text-xs text-muted-foreground"></span>
                <button class="xog-btn xog-refresh ${NATIVE_BTN_MUTED_ICON}" type="button"></button>
            </div>
            <div class="xog-searchrow">
                <div class="xog-searchbox ${NATIVE_SEARCH_ANCHOR}">
                    <span class="xog-search-icon ${NATIVE_SEARCH_ICON}"></span>
                    <input class="xog-search ${NATIVE_SEARCH_INPUT}" type="search" />
                </div>
                <div class="xog-viewwrap">
                    <button class="xog-btn xog-viewbtn ${NATIVE_BTN_SECONDARY_ICON}" type="button" aria-haspopup="menu" aria-expanded="false"></button>
                    <div class="xog-menu ${NATIVE_POPOVER_CONTENT}" role="menu" hidden></div>
                </div>
            </div>
            <div class="xog-tabs"></div>
        </div>
        <div class="xog-body">
            <div class="xog-grid"></div>
            <div class="xog-status ${NATIVE_TEXT_SM_MUTED}"></div>
            <div class="xog-sentinel"></div>
        </div>`;

    const refreshBtn = host.querySelector(".xog-refresh");
    bindTip(refreshBtn, () => t("refresh"));
    refreshBtn.setAttribute("aria-label", t("refresh"));
    refreshBtn.replaceChildren(svgIcon("refresh", "size-4"));

    const search = host.querySelector(".xog-search");
    search.placeholder = t("search");
    host.querySelector(".xog-search-icon").appendChild(svgIcon("search", "size-4"));

    // Output / input switch, the same pair the native panel puts above its
    // filter bar (sideToolbar.labels.generated / imported).
    const srcTabs = host.querySelector(".xog-srctabs");
    let folderBtn = null;
    let folderLabel = null;
    if (mediaMode) {
        // Same pill row as output/input, but one chip: the chosen save folder.
        // It is deliberately not a source tab (no dataset.source), so the
        // generic tab switch below never mistakes it for "output".
        folderBtn = document.createElement("button");
        folderBtn.type = "button";
        folderBtn.className = "xog-srctab xog-media-path " + NATIVE_TAB_BASE + " " + NATIVE_TAB_ON;
        folderBtn.dataset.active = "true";
        folderLabel = document.createElement("span");
        folderLabel.className = "xog-media-label";
        folderLabel.textContent = t("chooseMediaFolder");
        folderBtn.appendChild(folderLabel);
        bindTip(folderBtn, () => t("mediaFolder"));
        srcTabs.replaceChildren(folderBtn);
    } else {
        const sources = [
            { source: "output", label: "tabOutput" },
            { source: "input", label: "tabInput" },
        ];
        srcTabs.replaceChildren(
            ...sources.map((item) => {
                const btn = document.createElement("button");
                btn.type = "button";
                const active = item.source === "output";
                btn.className = "xog-srctab " + NATIVE_TAB_BASE + " " + (active ? NATIVE_TAB_ON : NATIVE_TAB_OFF);
                btn.setAttribute("role", "tab");
                btn.dataset.source = item.source;
                btn.dataset.active = String(active);
                btn.textContent = t(item.label);
                return btn;
            })
        );
    }

    const filters = host.querySelector(".xog-tabs");
    const kinds = ["all", "text", "image", "video", "audio"];
    filters.replaceChildren(
        ...kinds.map((kind) => {
            const btn = document.createElement("button");
            btn.type = "button";
            // Same native Tab.vue class as the output/input pills above;
            // h-8 px-2.5 rounded-lg + text-sm are all from the host.
            btn.className = "xog-chip " + NATIVE_TAB_BASE + " " +
                (kind === "all" ? NATIVE_TAB_ON : NATIVE_TAB_OFF);
            btn.dataset.kind = kind;
            btn.dataset.active = String(kind === "all");
            btn.textContent = t(kind);
            return btn;
        })
    );

    // View switcher — same trigger (lucide settings-2) and menu entries as the
    // native Assets panel MediaAssetSettingsMenu.
    const viewBtn = host.querySelector(".xog-viewbtn");
    bindTip(viewBtn, () => t("viewMenu"));
    viewBtn.setAttribute("aria-label", t("viewMenu"));
    viewBtn.appendChild(svgIcon("settings", "size-4"));

    const menu = host.querySelector(".xog-menu");
    menu.replaceChildren(
        ...[
            { mode: "list", icon: "list", label: "viewList" },
            { mode: "grid-small", icon: "gridSmall", label: "viewGridSmall" },
            { mode: "grid", icon: "gridLarge", label: "viewGridLarge" },
        ].map((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "xog-menu-item " + NATIVE_VIEW_ITEM;
            btn.dataset.mode = item.mode;
            btn.setAttribute("role", "menuitemradio");
            const label = document.createElement("span");
            label.className = "xog-menu-label flex min-w-0 items-center gap-2";
            label.appendChild(svgIcon(item.icon, "size-4 shrink-0"));
            const text = document.createElement("span");
            text.textContent = t(item.label);
            label.appendChild(text);
            const check = svgIcon(
                "check",
                "xog-menu-check ml-auto size-4 shrink-0" +
                    (item.mode === getViewMode() ? "" : " opacity-0")
            );
            btn.append(label, check);
            btn.addEventListener("click", () => {
                applyView(item.mode);
                closeViewMenu();
            });
            return btn;
        })
    );
    // Popover.vue renders a PopoverArrow at the content's top edge, centred on
    // the settings trigger. Match it with the native SVG/class so the arrow
    // inherits bg-background + stroke-border/50 from the host theme.
    const menuArrow = document.createElement("span");
    menuArrow.className = "xog-menu-arrow";
    menuArrow.innerHTML = NATIVE_POPOVER_ARROW_SVG;
    menu.appendChild(menuArrow);

    function openViewMenu() {
        menu.hidden = false;
        viewBtn.setAttribute("aria-expanded", "true");
    }

    function closeViewMenu() {
        menu.hidden = true;
        viewBtn.setAttribute("aria-expanded", "false");
    }

    viewBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (menu.hidden) openViewMenu();
        else closeViewMenu();
    });

    const grid = host.querySelector(".xog-grid");
    const status = host.querySelector(".xog-status");
    const count = host.querySelector(".xog-count");
    const sentinel = host.querySelector(".xog-sentinel");

    /* Canvas shell offers a slot in the panel title row (left of the close X).
       Move count + refresh there; a DOM move keeps their listeners and our
       node references intact. Without a slot (standalone) they stay in the bar. */
    if (options.headSlot) {
        const head = document.createElement("div");
        head.className = "xog-head-group";
        head.append(count, refreshBtn);
        options.headSlot.replaceChildren(head);
    }

    // The bar floats above the panel, so it lives on <body> — the sidebar
    // around the panel is the scroll container and clips nothing, but a sticky
    // child would be trapped inside its own parent box.
    const selbar = document.createElement("div");
    selbar.className = "xog-selbar " + NATIVE_SELBAR;
    selbar.hidden = true;
    selbar.innerHTML = `
        <button class="xog-selbtn xog-sel-clear ${NATIVE_BTN_INVERTED_LG}" type="button"></button>
        <span class="xog-selcount ${NATIVE_SELCOUNT}"></span>
        <div class="xog-selright ${NATIVE_SELRIGHT}">
            <button class="xog-selbtn xog-sel-download ${NATIVE_BTN_INVERTED_LG}" type="button"></button>
            <span class="xog-seldiv ${NATIVE_SELDIV}"></span>
            <button class="xog-selbtn xog-sel-delete ${NATIVE_BTN_INVERTED_LG}" type="button"></button>
        </div>`;
    document.body.appendChild(selbar);
    const selCount = selbar.querySelector(".xog-selcount");
    const selClear = selbar.querySelector(".xog-sel-clear");
    const selDownload = selbar.querySelector(".xog-sel-download");
    const selDelete = selbar.querySelector(".xog-sel-delete");

    // Fixed positioning needs the panel rect: the sidebar can be scrolled away
    // or resized, and the bar must follow it (and disappear with it).
    function syncSelbar() {
        if (selbar.hidden) return;
        const r = host.getBoundingClientRect();
        const visible = r.bottom > 64 && r.top < window.innerHeight - 32;
        selbar.dataset.offscreen = String(!visible);
        if (!visible) return;
        selbar.style.left = `${Math.round(r.left + 8)}px`;
        selbar.style.width = `${Math.round(Math.max(140, Math.min(312, r.width - 16)))}px`;
    }
    window.addEventListener("scroll", syncSelbar, true);
    window.addEventListener("resize", syncSelbar);

    // The bar floats on <body>; lift its tooltips clear of the bar's top edge
    // and pin the side to top (Reka default) so they never flip below the bar.
    for (const b of [selClear, selDownload, selDelete]) b.dataset.tipOffset = "12";
    bindTip(selClear, () => t("deselectAll"), "top");
    selClear.setAttribute("aria-label", t("deselectAll"));
    selClear.replaceChildren(svgIcon("x", "size-4"));
    // The bar labels match mediaAsset.selection.downloadSelected / deleteSelected;
    // the bulk context menu is the one that reads "全部下载 / 全部删除".
    bindTip(selDownload, () => t("download"), "top");
    selDownload.setAttribute("aria-label", t("download"));
    selDownload.replaceChildren(svgIcon("download", "size-4"));
    bindTip(selDelete, () => t("delete"), "top");
    selDelete.setAttribute("aria-label", t("delete"));
    selDelete.replaceChildren(svgIcon("trash", "size-4"));

    const state = {
        files: [],
        source: mediaMode ? "media" : "output",
        filter: "all",
        query: "",
        matched: [],
        shown: 0,
    };
    let mediaFolder = "";

    // ---- selection (useAssetSelection.ts)

    const selection = new Set();
    let anchorIndex = -1;
    let anchorIdValue = null;

    function listForSelection() {
        return state.matched;
    }

    function setAnchor(index, id) {
        anchorIndex = index;
        anchorIdValue = id;
    }

    function syncAnchorFromSelection() {
        const list = listForSelection();
        if (!selection.size) {
            setAnchor(-1, null);
            return;
        }
        for (let i = list.length - 1; i >= 0; i -= 1) {
            if (selection.has(list[i].id)) {
                setAnchor(i, list[i].id);
                return;
            }
        }
        setAnchor(-1, null);
    }

    // Recompute the native class set for a card from view mode + selection.
    // Grid cards use the ring-3 grey selected frame / hover:bg-accent/20 idle;
    // list rows use the bg-accent + ring-1 selected treatment. Kept in one
    // place so paintSelection and applyView cannot disagree.
    function paintCardClasses(card, on) {
        const list = grid.dataset.view === "list";
        const base = list ? NATIVE_ROW_BASE : NATIVE_CARD_BASE;
        const state = on
            ? (list ? NATIVE_ROW_SELECTED : NATIVE_CARD_SELECTED)
            : (list ? "" : NATIVE_CARD_IDLE);
        card.className = "xog-card " + base + " " + state;
        const meta = card.querySelector(".xog-meta");
        if (meta) meta.className = "xog-meta " + (list ? NATIVE_LIST_META : NATIVE_CARD_META);
        const name = card.querySelector(".xog-name");
        if (name) name.className = "xog-name " + (list ? NATIVE_LIST_NAME : NATIVE_CARD_NAME);
        const sub = card.querySelector(".xog-sub");
        if (sub) sub.className = "xog-sub " + (list ? NATIVE_LIST_SUB : NATIVE_CARD_SUB);
        const check = card.querySelector(".xog-check");
        if (check) {
            check.dataset.on = String(on);
            check.className =
                "xog-check " + NATIVE_CHECK_BASE + " " +
                (on ? NATIVE_CHECK_ON : NATIVE_CHECK_OFF) + " " + NATIVE_REVEAL;
            // svgIcon() renders an <i class="icon-[lucide--check] ...">, not
            // an <svg>. Match both so the tick's opacity-0 is removed on
            // selection. setAttribute replaces the WHOLE class list, so the
            // glyph class must be re-added or the <i> has no mask and the
            // white circle renders empty (a check with no tick).
            const icon = check.querySelector("i, svg");
            if (icon)
                icon.setAttribute(
                    "class",
                    "icon-[lucide--check] " +
                    (on ? NATIVE_CHECK_ICON_ON : NATIVE_CHECK_ICON_OFF)
                );
        }
        const actions = card.querySelector(".xog-actions");
        if (actions)
            actions.className =
                "xog-actions " + (list ? NATIVE_LIST_ACTIONS : NATIVE_ICON_GROUP) + " " + NATIVE_REVEAL;
        const actCls = "xog-act " + (list ? NATIVE_BTN_SECONDARY : NATIVE_BTN_OVERLAY_ON);
        for (const act of card.querySelectorAll(".xog-act")) act.className = actCls;
    }

    function paintSelection() {
        for (const card of grid.querySelectorAll(CARD_SELECTOR)) {
            const on = selection.has(card.dataset.assetId);
            card.dataset.selected = String(on);
            paintCardClasses(card, on);
        }
        if (selection.size) {
            selbar.hidden = false;
            selCount.textContent = fmtCount(t("selectedCount"), selection.size);
            syncSelbar();
        } else {
            selbar.hidden = true;
        }
    }

    function setSelection(ids) {
        selection.clear();
        for (const id of ids) selection.add(id);
        syncAnchorFromSelection();
        paintSelection();
    }

    function clearSelection() {
        if (!selection.size) return;
        selection.clear();
        setAnchor(-1, null);
        paintSelection();
    }

    function toggleSelection(id, index) {
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        setAnchor(index, id);
        paintSelection();
    }

    function handleCardClick(file, index, ev) {
        const list = listForSelection();
        if (ev.shiftKey && anchorIndex >= 0) {
            const start = Math.min(anchorIndex, index);
            const end = Math.max(anchorIndex, index);
            // A shift range replaces the selection and leaves the anchor put.
            setSelection(list.slice(start, end + 1).map((f) => f.id));
            return;
        }
        if (ev.ctrlKey || ev.metaKey) {
            toggleSelection(file.id, index);
            return;
        }
        // Clicking the only selected asset does not clear the selection.
        if (selection.has(file.id) && selection.size === 1) return;
        setSelection([file.id]);
        setAnchor(index, file.id);
    }

    function selectedFiles() {
        return state.matched.filter((file) => selection.has(file.id));
    }

    // ---- context menu (AssetsSidebarTab.handleAssetContextMenu)

    let ctxMenu = null;

    function ensureCtxMenu() {
        if (ctxMenu) return ctxMenu;
        const el = document.createElement("div");
        // Layer-external context menu: native surface classes + a high z-index
        // hook (the canvas root stacks at 20000, native z-overlay is far lower).
        el.className = "xog-ctx " + NATIVE_MENU_CONTENT;
        el.hidden = true;
        document.body.appendChild(el);
        ctxMenu = el;

        const close = () => {
            el.hidden = true;
        };
        const onDown = (ev) => {
            if (el.hidden) return;
            if (el.contains(ev.target)) return;
            close();
        };
        const onKey = (ev) => {
            if (ev.key === "Escape" && !el.hidden) close();
        };
        // Native dismisses the overlay on scroll too.
        const onScroll = () => {
            if (!el.hidden) close();
        };
        document.addEventListener("pointerdown", onDown, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        return el;
    }

    function menuItem({ icon, label, disabled, onClick }) {
        if (label === "-") {
            const sep = document.createElement("div");
            sep.className = "xog-ctx-sep " + NATIVE_MENU_SEP;
            return sep;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "xog-ctx-item " + NATIVE_MENU_ITEM;
        if (disabled) btn.disabled = true;
        if (icon) btn.appendChild(svgIcon(icon, "size-4 shrink-0"));
        const text = document.createElement("span");
        text.textContent = label;
        btn.appendChild(text);
        btn.addEventListener("click", () => {
            ctxMenu.hidden = true;
            onClick?.();
        });
        return btn;
    }

    function openContextMenu(event, file) {
        const el = ensureCtxMenu();
        const chosen = selection.size > 1 && selection.has(file.id)
            ? selectedFiles()
            : [file];
        const isBulk = chosen.length > 1;

        const items = isBulk
            ? [
                  menuItem({ label: t("multipleSelected"), disabled: true }),
                  menuItem({
                      icon: "download",
                      label: t("downloadAll"),
                      onClick: () => {
                          triggerDownload(chosen);
                          clearSelection();
                      },
                  }),
                  menuItem({
                      icon: "trash",
                      label: t("deleteAll"),
                      onClick: async () => {
                          const ids = new Set(chosen.map((f) => f.id));
                          const done = await deleteFiles(chosen);
                          if (done) {
                              clearSelection();
                              state.files = state.files.filter(
                                  (f) => !ids.has(f.id)
                              );
                              await load();
                          }
                      },
                  }),
              ]
            : [
                  menuItem({
                      icon: "zoomIn",
                      label: t("inspect"),
                      onClick: () => ensureLightbox().open(file, state.matched),
                  }),
                  menuItem({
                      icon: "download",
                      label: t("download"),
                      onClick: () => triggerDownload([file]),
                  }),
                  menuItem({
                      icon: "trash",
                      label: t("delete"),
                      onClick: async () => {
                          const done = await deleteFiles([file]);
                          if (done) await load();
                      },
                  }),
              ];

        el.replaceChildren(...items);
        el.hidden = false;

        // The native menu opens at the pointer (contextMenuRef.show(event));
        // clamp so it never hangs off the viewport.
        const rect = el.getBoundingClientRect();
        const x = Math.min(
            event.clientX,
            Math.max(0, window.innerWidth - rect.width - 8)
        );
        const y = Math.min(
            event.clientY,
            Math.max(0, window.innerHeight - rect.height - 8)
        );
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }

    // ---- marquee (useAssetGridSelection.ts + marqueeSelectionUtil.ts)

    const marquee = document.createElement("div");
    marquee.className = "xog-marquee";
    marquee.hidden = true;
    document.body.appendChild(marquee);

    let drag = null;
    let suppressNextClick = false;
    let suppressTimer = null;
    let pointerX = 0;
    let pointerY = 0;
    let hasPointerSample = false;

    function normaliseRect(startX, startY, endX, endY) {
        return {
            left: Math.min(startX, endX),
            top: Math.min(startY, endY),
            right: Math.max(startX, endX),
            bottom: Math.max(startY, endY),
        };
    }

    function clipRect(rect, bounds) {
        return {
            left: Math.max(rect.left, bounds.left),
            top: Math.max(rect.top, bounds.top),
            right: Math.min(rect.right, bounds.right),
            bottom: Math.min(rect.bottom, bounds.bottom),
        };
    }

    function rectsIntersect(a, b) {
        return !(
            a.right < b.left ||
            a.left > b.right ||
            a.bottom < b.top ||
            a.top > b.bottom
        );
    }

    function collectCards() {
        return [...grid.querySelectorAll(CARD_SELECTOR)].flatMap((el) => {
            const id = el.dataset.assetId;
            return id ? [{ id, rect: el.getBoundingClientRect() }] : [];
        });
    }

    function applyMarquee(clientX, clientY) {
        if (!drag) return;
        const rect = clipRect(
            normaliseRect(drag.startX, drag.startY, clientX, clientY),
            drag.bounds
        );
        marquee.hidden = false;
        marquee.style.left = `${rect.left}px`;
        marquee.style.top = `${rect.top}px`;
        marquee.style.width = `${Math.max(0, rect.right - rect.left)}px`;
        marquee.style.height = `${Math.max(0, rect.bottom - rect.top)}px`;

        const hits = new Set(drag.baseIds);
        for (const card of drag.cards) {
            if (!rectsIntersect(card.rect, rect)) continue;
            if (drag.subtract) hits.delete(card.id);
            else hits.add(card.id);
        }
        setSelection([...hits]);
    }

    function onPointerMove(ev) {
        pointerX = ev.clientX;
        pointerY = ev.clientY;
        hasPointerSample = true;
        if (!drag) return;
        if (
            !drag.active &&
            Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) <
                DRAG_THRESHOLD_PX
        ) {
            return;
        }
        if (!drag.active) {
            drag.active = true;
            drag.cards = collectCards();
            drag.bounds = host.getBoundingClientRect();
            try {
                host.setPointerCapture(drag.pointerId);
            } catch {
                /* stale pointer id — window listeners still end the drag */
            }
        }
        applyMarquee(ev.clientX, ev.clientY);
    }

    function endDrag() {
        if (!drag) return;
        const wasActive = drag.active;
        drag = null;
        marquee.hidden = true;
        if (wasActive) {
            // Swallow the click the drag ends with, or it would collapse the
            // selection we just made.
            suppressNextClick = true;
            if (suppressTimer) clearTimeout(suppressTimer);
            suppressTimer = setTimeout(() => {
                suppressNextClick = false;
                suppressTimer = null;
            }, 0);
        }
    }

    function onPointerDown(ev) {
        if (ev.button !== 0 || drag) return;
        if (!grid.querySelector(CARD_SELECTOR)) return;
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest(INTERACTIVE_SELECTOR)) return;
        // Pressing on a card starts a marquee only with a modifier held.
        if (target.closest(CARD_SELECTOR) && !ev.ctrlKey && !ev.metaKey) return;

        drag = {
            startX: ev.clientX,
            startY: ev.clientY,
            pointerId: ev.pointerId,
            baseIds: ev.shiftKey || ev.ctrlKey || ev.metaKey ? [...selection] : [],
            subtract: (ev.ctrlKey || ev.metaKey) && ev.shiftKey,
            active: false,
            cards: [],
            bounds: null,
        };
        if (suppressTimer) clearTimeout(suppressTimer);
        suppressNextClick = false;
    }

    function onClickCapture(ev) {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        if (suppressTimer) clearTimeout(suppressTimer);
        ev.stopImmediatePropagation();
        ev.preventDefault();
    }

    function onDragStart(ev) {
        if (drag) ev.preventDefault();
    }

    function onSelectStart(ev) {
        if (!drag) return;
        if (ev.target instanceof Node && host.contains(ev.target)) {
            ev.preventDefault();
        }
    }

    function isTextEntryTarget(el) {
        return (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            (el instanceof HTMLElement && el.isContentEditable)
        );
    }

    function pointerInsidePanel() {
        if (!hasPointerSample) return false;
        const { left, top, right, bottom } = host.getBoundingClientRect();
        return (
            pointerX >= left &&
            pointerX <= right &&
            pointerY >= top &&
            pointerY <= bottom
        );
    }

    function onKeydown(ev) {
        if (!(ev.ctrlKey || ev.metaKey) || (ev.key !== "a" && ev.key !== "A")) return;
        if (!pointerInsidePanel()) return;
        if (isTextEntryTarget(document.activeElement)) return;
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const list = listForSelection();
        setSelection(list.map((f) => f.id));
    }

    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("click", onClickCapture, true);
    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("selectstart", onSelectStart, true);

    // ---- rendering

    // Column tracks come from the frontend own getMediaAssetGridColumns().
    function applyView(mode) {
        grid.dataset.view = mode;
        grid.style.gridTemplateColumns =
            mode === "list" ? "minmax(0, 1fr)" : gridColumns(mode);
        for (const btn of menu.children) {
            const active = btn.dataset.mode === mode;
            btn.dataset.active = String(active);
            const check = btn.querySelector(".xog-menu-check");
            if (check) check.classList.toggle("opacity-0", !active);
        }
        /* Gallery view mode is a canvas parameter: per-user prefs.json. */
        window.InfCanvas?.prefs?.set(VIEW_KEY, mode);
        // A different column count changes how many cards fill the first screen,
        // then re-skin every card for the new view (grid ring-3 vs list bg-accent).
        fillViewport();
        paintSelection();
    }

    function setStatus(text) {
        status.replaceChildren();
        status.textContent = text || "";
        status.style.display = text ? "" : "none";
    }

    // Mirrors the native Assets panel empty state: info glyph + heading.
    function setEmpty() {
        const box = document.createElement("div");
        box.className = "xog-empty " + NATIVE_EMPTY_ROOT;
        const icon = document.createElement("i");
        icon.className = "pi pi-info-circle " + NATIVE_EMPTY_ICON;
        const heading = document.createElement("h3");
        heading.className = NATIVE_EMPTY_TITLE;
        heading.textContent = mediaMode && !mediaFolder ? t("mediaFolderNotSet") : t("empty");
        box.append(icon, heading);
        status.replaceChildren(box);
        status.style.display = "";
    }

    // Heavy per-tile work — decoding an audio waveform, reading a text snippet —
    // waits until the tile is actually on screen. A 500-file grid must not fire
    // 500 downloads the moment it paints.
    const lazy = (() => {
        const jobs = new WeakMap();
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    io.unobserve(entry.target);
                    const job = jobs.get(entry.target);
                    jobs.delete(entry.target);
                    job?.();
                }
            },
            { root: null, rootMargin: "200px" }
        );
        return {
            run(el, job) {
                jobs.set(el, job);
                io.observe(el);
            },
            stop() {
                io.disconnect();
            },
        };
    })();

    // Every non-previewable kind gets the same face the native panel draws:
    // a centred glyph plus (for audio / 3D) a one-word label.
    const FACE_ICON = {
        image: "image",
        video: "video",
        audio: "music",
        "3d": "box",
        text: "text",
        other: "file",
    };
    const FACE_LABEL = { audio: "audioFace", "3d": "threeDFace" };

    function makeFace(kind) {
        const fill = document.createElement("div");
        fill.className = "xog-fill absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted";
        fill.dataset.snippet = "false";
        fill.appendChild(svgIcon(FACE_ICON[kind] || "file", "xog-glyph"));
        const key = FACE_LABEL[kind];
        if (key) {
            const label = document.createElement("span");
            // text-xs + leading-4 = 12px/16px, the native label metrics.
            label.className = "text-xs leading-4";
            label.textContent = t(key);
            fill.appendChild(label);
        }
        return fill;
    }

    // MediaAudioTop.vue: icon-[lucide--music] text-3xl + native label colour.
    function makeAudioFace() {
        const fill = document.createElement("div");
        fill.className = NATIVE_AUDIO_FACE;
        fill.dataset.snippet = "false";
        fill.appendChild(svgIcon("music", "text-3xl text-foreground"));
        const label = document.createElement("span");
        // MediaAudioTop.vue's label has no font-size class: it inherits the
        // host's 16px body default. Our gallery root sets text-sm (14px), so
        // restore text-base (16px) to match the native label exactly.
        label.className = "text-base text-foreground";
        label.textContent = t("audioFace");
        fill.appendChild(label);
        return fill;
    }

    function addPreviewImage(thumb, file) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = file.filename;
        // Native MediaImageTop ships :draggable="false" — an image that is its
        // own drag source overwrites text/uri-list with the thumbnail URL, which
        // is how a webp preview used to land in input/.
        img.draggable = false;
        img.className = NATIVE_PREVIEW_IMG;
        img.src = fileUrl(file, true);
        // Undecodable file (or a preview the server could not build) — show the
        // placeholder face instead of an empty tile.
        img.addEventListener("error", () => {
            img.remove();
            thumb.appendChild(makeFace(file.kind === "video" ? "video" : "image"));
        });
        thumb.appendChild(img);
        return img;
    }

    // A frame from the clip plus the native play scrim. Clicking still opens the
    // player in the lightbox rather than playing in a 128px cell.
    function addVideoThumb(thumb, file) {
        addPreviewImage(thumb, file);
        const play = document.createElement("span");
        play.className = "xog-play bg-black/15 text-white";
        play.appendChild(svgIcon("play", "xog-glyph"));
        thumb.appendChild(play);
    }

    function addAudioThumb(thumb, file) {
        thumb.appendChild(makeAudioFace());

        // MediaAudioTop.vue: absolute bottom-0 left-0 w-full p-2 > player.
        const wave = document.createElement("div");
        wave.className = "xog-wave absolute bottom-0 left-0 w-full p-2";
        const player = document.createElement("div");
        player.className = NATIVE_AUDIO_PLAYER;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = NATIVE_AUDIO_BTN;
        bindTip(btn, () => t("play"));
        btn.setAttribute("aria-label", t("play"));
        btn.appendChild(svgIcon("play", "ml-0.5 size-3 text-foreground"));

        const bars = document.createElement("div");
        bars.className = NATIVE_AUDIO_WAVE;
        bars.style.height = "32px";
        const barList = [];
        for (let i = 0; i < 40; i += 1) {
            const bar = document.createElement("div");
            // generatePlaceholderBars() in useWaveAudioPlayer.ts: 10–70%.
            bar.className = NATIVE_AUDIO_BAR;
            bar.style.height = (Math.random() * 60 + 10) + "%";
            bars.appendChild(bar);
            barList.push(bar);
        }

        const time = document.createElement("span");
        time.className = NATIVE_AUDIO_TIME;
        time.textContent = "0:00 / 0:00";

        const audio = document.createElement("audio");
        audio.preload = "metadata";
        audio.className = "hidden";
        audio.src = fileUrl(file, false);

        let decoded = false;
        const paint = () => {
            const dur = audio.duration;
            const played =
                dur > 0 ? Math.floor((audio.currentTime / dur) * barList.length) - 1 : -1;
            barList.forEach((bar, i) => {
                if (decoded) bar.className = i <= played ? NATIVE_AUDIO_BAR_PLAYED : NATIVE_AUDIO_BAR_READY;
            });
            time.textContent = formatTime(audio.currentTime) + " / " + formatTime(audio.duration);
        };
        const setPlaying = (playing) => {
            btn.replaceChildren(svgIcon(playing ? "pause" : "play",
                (playing ? "" : "ml-0.5 ") + "size-3 text-foreground"));
            const label = t(playing ? "pause" : "play");
            bindTip(btn, () => label);
            btn.setAttribute("aria-label", label);
        };

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (audio.paused) void audio.play().catch(() => setPlaying(false));
            else audio.pause();
        });
        bars.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const rect = bars.getBoundingClientRect();
            if (!audio.duration || !rect.width) return;
            const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            audio.currentTime = ratio * audio.duration;
            paint();
        });
        audio.addEventListener("play", () => setPlaying(true));
        audio.addEventListener("pause", () => setPlaying(false));
        audio.addEventListener("ended", () => setPlaying(false));
        audio.addEventListener("loadedmetadata", paint);
        audio.addEventListener("timeupdate", paint);

        // The transport lives inside the card, so its presses must not open the
        // lightbox.
        wave.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        wave.addEventListener("click", (ev) => ev.stopPropagation());
        player.append(btn, bars, time);
        wave.appendChild(player);
        thumb.appendChild(wave);
        thumb.appendChild(audio);

        lazy.run(thumb, async () => {
            await decodeWaveform(file, barList);
            decoded = true;
            paint();
        });
    }

    // Text files print their opening lines, exactly like the native panel
    // MediaTextTop (first 1000 characters).
    function addTextThumb(thumb, file) {
        const fill = makeFace("text");
        const body = document.createElement("p");
        body.className = "xog-text-body text-xs leading-4";
        fill.appendChild(body);
        thumb.appendChild(fill);

        lazy.run(thumb, async () => {
            try {
                const res = await fetch(fileUrl(file, true), {
                    credentials: "same-origin",
                });
                if (!res.ok) return;
                const text = (await res.text()).slice(0, 1000).trim();
                if (!text) return;
                body.textContent = text;
                fill.dataset.snippet = "true";
            } catch {
                /* keep the glyph */
            }
        });
    }

    function makeCard(file, index) {
        const card = document.createElement("div");
        card.className = "xog-card"; // native classes applied at the end via paintCardClasses
        card.dataset.assetId = file.id;
        card.dataset.selected = "false";
        // Native cards show format + size only; the tile is too narrow for a
        // timestamp, so full path + mtime hang off the filename text alone
        // (hovering the whole tile is noisy) and below it, not on the card.
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", file.filename);
        // Drag a card onto the canvas to create a matching asset node. The
        // payload is the canvas shell's own contract (see toCanvasAsset), not
        // ComfyUI's main-UI asset-info one.
        card.draggable = true;
        card.addEventListener("dragstart", (ev) => {
            if (!ev.dataTransfer) return;
            ev.dataTransfer.setData(
                "application/x-infcanvas-asset",
                JSON.stringify(toCanvasAsset(file))
            );
            ev.dataTransfer.effectAllowed = "copy";
        });

        const thumb = document.createElement("div");
        const kind = file.kind || "other";
        thumb.className = "xog-thumb " + (kind === "video" ? NATIVE_VIDEO_PLATE : NATIVE_PREVIEW_PLATE);
        thumb.dataset.kind = kind;

        if (file.kind === "image") {
            addPreviewImage(thumb, file);
        } else if (file.kind === "video") {
            addVideoThumb(thumb, file);
        } else if (file.kind === "audio") {
            addAudioThumb(thumb, file);
        } else if (file.kind === "text") {
            addTextThumb(thumb, file);
        } else {
            // 3D models and unknown files are not previewable here — same face
            // the native panel falls back to.
            thumb.appendChild(makeFace(file.kind === "3d" ? "3d" : "other"));
        }

        // Selection checkbox, top-left (MediaAssetCard).
        const check = document.createElement("button");
        check.type = "button";
        check.className =
            "xog-check " + NATIVE_CHECK_BASE + " " + NATIVE_CHECK_OFF + " " + NATIVE_REVEAL;
        check.dataset.on = "false";
        check.tabIndex = -1;
        check.appendChild(svgIcon("check", NATIVE_CHECK_ICON_OFF));
        check.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleSelection(file.id, index);
        });

        // Download + delete, top-right — a fixed pair, no overflow menu.
        // No tooltips on these two (user request): the card is already busy and
        // the icon + aria-label is enough; a bubble here also fights the
        // filename tooltip underneath.
        const actions = document.createElement("div");
        actions.className = "xog-actions " + NATIVE_ICON_GROUP + " " + NATIVE_REVEAL;
        const dl = document.createElement("button");
        dl.type = "button";
        dl.className = "xog-act " + NATIVE_BTN_OVERLAY_ON;
        dl.tabIndex = -1;
        dl.setAttribute("aria-label", t("download"));
        dl.appendChild(svgIcon("download", "size-4"));
        dl.addEventListener("click", (ev) => {
            ev.stopPropagation();
            triggerDownload([file]);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "xog-act " + NATIVE_BTN_OVERLAY_ON;
        del.tabIndex = -1;
        del.setAttribute("aria-label", t("delete"));
        del.appendChild(svgIcon("trash", "size-4"));
        del.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const done = await deleteFiles([file]);
            if (done) await load();
        });
        actions.append(dl, del);

        const meta = document.createElement("div");
        meta.className = "xog-meta " + NATIVE_CARD_META;
        const name = document.createElement("span");
        name.className = "xog-name " + NATIVE_CARD_NAME;
        name.textContent = file.filename;
        // Tooltip on the filename only (no path, no date — user request),
        // dropping below the text; placeTip flips it up if there is no room.
        bindTip(name, () => file.filename, "bottom");
        const sub = document.createElement("span");
        sub.className = "xog-sub " + NATIVE_CARD_SUB;
        // Size + timestamp: the extension is already visible in the filename and
        // a third field would push the line past the tile width.
        sub.textContent = `${fmtSize(file.size)} · ${fmtTime(file.mtime)}`;
        meta.append(name, sub);

        // Native card: the preview area selects, a double click inspects, and
        // the info row selects as well.
        thumb.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleCardClick(file, index, ev);
        });
        thumb.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            ensureLightbox().open(file, state.matched);
        });
        meta.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleCardClick(file, index, ev);
        });
        card.addEventListener("click", (ev) => ev.stopPropagation());
        card.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openContextMenu(ev, file);
        });
        card.addEventListener("keydown", (ev) => {
            if (ev.key !== "Enter" && ev.key !== " ") return;
            ev.preventDefault();
            handleCardClick(file, index, ev);
        });

        // Overlays belong to the card, not the preview: a 32px list thumb would
        // clip them, and the list row docks them to its own end instead.
        card.append(thumb, meta, check, actions);
        paintCardClasses(card, selection.has(file.id));
        return card;
    }

    function renderNext() {
        if (state.shown >= state.matched.length) {
            if (state.matched.length > 0) setStatus("");
            return;
        }
        const start = state.shown;
        const slice = state.matched.slice(start, start + BATCH);
        const frag = document.createDocumentFragment();
        // The card keeps its index in the current view: shift-range selection
        // works on those positions, not on render order.
        slice.forEach((file, i) => frag.appendChild(makeCard(file, start + i)));
        grid.appendChild(frag);
        state.shown = start + slice.length;
        if (state.shown >= state.matched.length) setStatus("");
    }

    // A tall sidebar can show more than one batch at once; the IntersectionObserver
    // only fires on transitions, so top up until the sentinel is safely below the
    // fold (or everything is rendered).
    function fillViewport() {
        for (let guard = 0; guard < 40; guard += 1) {
            if (state.shown >= state.matched.length) break;
            if (sentinel.getBoundingClientRect().top > window.innerHeight + 300) break;
            renderNext();
        }
    }

    function applyFilter() {
        const q = state.query.trim().toLowerCase();
        const group = FILTER_GROUPS[state.filter];
        state.matched = state.files.filter((file) => {
            if (file.source !== state.source) return false;
            if (group && !group.includes(file.kind)) return false;
            if (!q) return true;
            return `${file.subfolder || ""}/${file.filename}`.toLowerCase().includes(q);
        });
        state.shown = 0;
        grid.replaceChildren();

        // Selection is scoped to what this view can act on, like the native
        // reconcileSelection pass.
        const visible = new Set(state.matched.map((f) => f.id));
        for (const id of [...selection]) {
            if (!visible.has(id)) selection.delete(id);
        }
        syncAnchorFromSelection();

        if (state.matched.length === 0) {
            if (state.files.length === 0) setEmpty();
            else setStatus(t("noMatch"));
        } else {
            setStatus("");
        }
        renderNext();
        fillViewport();
        paintSelection();
    }

    function paintCount() {
        const inSource = state.files.filter((f) => f.source === state.source).length;
        let text = `${state.matched.length} / ${inSource} ${t("files")}`;
        if (cache.data?.truncated) text += ` (${cache.data.total})`;
        count.textContent = text;
    }

    async function load() {
        count.textContent = "";
        if (!state.files.length) setStatus(t("loading"));
        try {
            const res = await api.fetchApi(LIST_URL, { cache: "no-store" });
            if (res.status === 401) {
                setStatus(t("unauthorized"));
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            cache = { at: Date.now(), data };
            state.files = Array.isArray(data.files) ? data.files : [];
            applyFilter();
            paintCount();
        } catch (err) {
            setStatus(`${t("failed")}: ${err?.message || err}`);
        }
    }

    // Infinite scroll: pull the next batch when the sentinel enters the viewport.
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            if (state.shown < state.matched.length) {
                renderNext();
                fillViewport();
            }
        },
        { root: null, rootMargin: "200px" }
    );
    observer.observe(sentinel);

    // Dismiss the view menu the way the native popover does: outside press, Esc,
    // or picking an entry.
    const onDocDown = (ev) => {
        if (menu.hidden) return;
        if (menu.contains(ev.target) || viewBtn.contains(ev.target)) return;
        closeViewMenu();
    };
    const onDocKey = (ev) => {
        if (ev.key === "Escape" && !menu.hidden) closeViewMenu();
    };
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onDocKey);

    // Clicking empty space inside the body clears the selection, the way the
    // native panel body handler does.
    grid.addEventListener("click", (ev) => {
        if (ev.target.closest(CARD_SELECTOR)) return;
        clearSelection();
    });

    refreshBtn.addEventListener("click", () => {
        cache = { at: 0, data: null };
        load();
    });

    if (folderBtn) {
        const toast = (kind, message) => window.InfCanvas?.api?.toast?.(kind, message);
        let pickerBusy = false;
        const paintFolder = (folder) => {
            // The initial GET may resolve while the dialog is opening; never
            // let it overwrite the visible "opening…" feedback.
            if (pickerBusy) return;
            mediaFolder = folder || "";
            folderLabel.textContent = mediaFolder || t("chooseMediaFolder");
            bindTip(folderBtn, () => mediaFolder || t("mediaFolder"));
        };
        folderBtn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            pickerBusy = true;
            folderBtn.disabled = true;
            folderLabel.textContent = t("mediaFolderOpening");
            try {
                const pickRes = await api.fetchApi(MEDIA_PICK_URL, { method: "POST" });
                if (!pickRes.ok) throw new Error(`HTTP ${pickRes.status}`);
                const picked = (await pickRes.json()).folder || "";
                if (!picked) return; // native dialog cancelled: leave everything alone
                const saveRes = await api.fetchApi(MEDIA_FOLDER_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder: picked }),
                });
                if (!saveRes.ok) {
                    const body = await saveRes.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${saveRes.status}`);
                }
                const saved = (await saveRes.json()).folder || picked;
                mediaFolder = saved;
                cache = { at: 0, data: null };
                await load();
            } catch (err) {
                toast("error", `${t("mediaFolderPickFailed")}: ${err?.message || err}`);
            } finally {
                pickerBusy = false;
                folderBtn.disabled = false;
                paintFolder(mediaFolder);
            }
        });
        // Initial folder label; the manifest load that follows supplies files.
        api.fetchApi(MEDIA_FOLDER_URL, { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : {}))
            .then((data) => paintFolder(data.folder || ""))
            .catch(() => {})
            .finally(() => { applyFilter(); paintCount(); });
    }

    search.addEventListener("input", () => {
        state.query = search.value;
        applyFilter();
        paintCount();
    });

    srcTabs.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".xog-srctab");
        if (!btn || btn === folderBtn) return;
        state.source = btn.dataset.source || "output";
        for (const tab of srcTabs.children) {
            const on = tab === btn;
            tab.dataset.active = String(on);
            // Mirror Tab.vue's class-level active state (bg/text), not just the
            // data attribute — the host UnoCSS classes carry the real styling.
            tab.className = "xog-srctab " + NATIVE_TAB_BASE + " " + (on ? NATIVE_TAB_ON : NATIVE_TAB_OFF);
        }
        // Switching tabs starts from a clean selection, like the native panel.
        clearSelection();
        applyFilter();
        paintCount();
    });

    filters.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".xog-chip");
        if (!btn) return;
        state.filter = btn.dataset.kind || "all";
        for (const chip of filters.children) {
            const on = chip === btn;
            chip.dataset.active = String(on);
            chip.classList.toggle("bg-accent", on);
            chip.classList.toggle("text-foreground", on);
            chip.classList.toggle("bg-transparent", !on);
            chip.classList.toggle("text-muted-foreground", !on);
        }
        applyFilter();
        paintCount();
    });

    selClear.addEventListener("click", clearSelection);
    selDownload.addEventListener("click", () => {
        triggerDownload(selectedFiles());
        clearSelection();
    });
    selDelete.addEventListener("click", async () => {
        const chosen = selectedFiles();
        const ids = new Set(chosen.map((f) => f.id));
        const done = await deleteFiles(chosen);
        if (done) {
            clearSelection();
            state.files = state.files.filter((f) => !ids.has(f.id));
            await load();
        }
    });

    applyView(getViewMode());

    // A deletion from the lightbox must repaint this panel too; the lightbox
    // lives at module scope, so it announces the removal instead of reaching
    // back into the mounted panel.
    const onLbDeleted = () => { void load(); };
    document.addEventListener("xog-lightbox-deleted", onLbDeleted);

    // An "add to 收藏" from a canvas node announces the new asset. Drop the warm
    // cache and reload so an open 收藏 panel shows it without a manual refresh.
    const onFavChanged = () => { cache = { at: 0, data: null }; void load(); };
    document.addEventListener("xcat-favorites-changed", onFavChanged);

    // Warm-start from the previous fetch, then revalidate in the background.
    if (cache.data && Date.now() - cache.at < CACHE_TTL) {
        state.files = Array.isArray(cache.data.files) ? cache.data.files : [];
        applyFilter();
        paintCount();
        load();
    } else {
        load();
    }

    return () => {
        document.removeEventListener("xog-lightbox-deleted", onLbDeleted);
        document.removeEventListener("xcat-favorites-changed", onFavChanged);
        observer.disconnect();
        lazy.stop();
        document.removeEventListener("pointerdown", onDocDown, true);
        document.removeEventListener("keydown", onDocKey);
        window.removeEventListener("scroll", syncSelbar, true);
        window.removeEventListener("resize", syncSelbar);
        selbar.remove();
        host.removeEventListener("pointerdown", onPointerDown);
        host.removeEventListener("dragstart", onDragStart, true);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("click", onClickCapture, true);
        window.removeEventListener("keydown", onKeydown, true);
        window.removeEventListener("selectstart", onSelectStart, true);
        marquee.remove();
    };
}

// Canvas bridge: the embedded canvas shell (infcanvas-ui.js, a separate IIFE)
// cannot import this ES module, so publish the panel builder on the shared
// namespace for the canvas rail's "画廊" entry. This is the ONLY entry point —
// there is no ComfyUI main-UI tab; the gallery is canvas-only. The caller owns
// the returned cleanup and must run it when the panel is switched or the canvas
// is exited.
(window.InfCanvas = window.InfCanvas || {}).galleryPanel = {
    mount(host, options) {
        return buildPanel(host, options);
    },
    // Reuse the exact same MediaLightbox the 资产 grid uses. Callers pass a
    // file-like record ({ url, filename, kind, size?, mtime? }) and the ordered
    // sibling list for prev/next. No second lightbox implementation.
    openLightbox(file, files, options) {
        if (!file || !file.url) return;
        ensureLightbox().open(file, files, options);
    },
};
