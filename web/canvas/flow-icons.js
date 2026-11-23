/* Canvas icon glyphs: local SVG paths + host lucide glyph table + the
   IcIcon renderer. Extracted from infcanvas-flow.js (batch 1a); pure data
   plus one renderer, depends only on the bundled Vue runtime. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";

  /* Default glyph size for IcIcon. The control bar itself no longer uses
     layout tokens: its metrics come straight from ComfyUI's AudioPreviewPlayer
     (64 / 16 / 16 / 8 / 24 / 2 px), see the .icn__bar block below. */
  export const ICON = 14;

  /* -------------------------------- icons -------------------------------- */

  export const ICONS = {
    /* lucide play / pause (official 24x24 paths) for the media control bar. */
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    pause: '<rect x="14" y="3" width="5" height="18" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>'
      + '<rect x="5" y="3" width="5" height="18" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>',
    volume: '<path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14 H4 Z" fill="currentColor"/>'
      + '<path d="M15.5 8.5 A5 5 0 0 1 15.5 15.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 6 A8.5 8.5 0 0 1 18 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    mute: '<path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14 H4 Z" fill="currentColor"/>'
      + '<path d="M16 9.5 L21 14.5 M21 9.5 L16 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    upload: '<path d="M12 15.5 V5.5 M8 9 L12 5 L16 9" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M5 15.5 V18.5 H19 V15.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    sparkles: '<path d="M12 3 L13.7 9.3 L20 11 L13.7 12.7 L12 19 L10.3 12.7 L4 11 L10.3 9.3 Z" fill="currentColor"/>'
      + '<path d="M19 16 L19.8 18.2 L22 19 L19.8 19.8 L19 22 L18.2 19.8 L16 19 L18.2 18.2 Z" fill="currentColor"/>',
    /* lucide `settings` (v1.34) verbatim: eight-lobed cog + centre hole. The
       hand-drawn gear this replaces read as a jagged star at 14px. */
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>',
    send: '<path d="M12 20 V5 M6 11 L12 5 L18 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide chevron-down / check — used by the Nodes 2.0 style select
       (SelectTrigger's SelectIcon + SelectItemIndicator). */
    "chevron-down": '<path d="M6 9.5 L12 15.5 L18 9.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide chevron-up / settings-2 — footer of the 显示·隐藏高级输入 toggle,
       settings popover. ComfyUI's NodeFooter.vue pairs chevron-up with the
       expanded state and settings-2 with the collapsed one; kept identical. */
    "chevron-up": '<path d="M6 14.5 L12 8.5 L18 14.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "settings-2": '<path d="M14 17 H5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
      + '<path d="M19 7 H10" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
      + '<circle cx="17" cy="17" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/>'
      + '<circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/>',
    check: '<path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide tag — the header's "add label" control. One colour capsule per
       node, picked from NODE_TAGS; the tag replaces this icon in place. */
    tag: '<path d="M12.586 2.586a2 2 0 0 0-1.414-.586H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/>',
    /* lucide minus / plus — ScrubableNumberInput's decrement & increment */
    minus: '<path d="M5 12 H19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    plus: '<path d="M12 5 V19 M5 12 H19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    /* lucide refresh-cw / eye / eye-off / trash-2 / search — the LoRA-stack
       card's action glyphs. Kept verbatim at 24x24 so they match the other
       toolbar icons instead of the earlier mismatched gear/mute/pencil set. */
    "refresh-cw": '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M3 3v5h5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M16 16h5v5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" stroke="currentColor" stroke-width="2" fill="none"/>'
      + '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>',
    "eye-off": '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.83" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m2 2 20 20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    "trash-2": '<path d="M3 6h18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M10 11v6 M14 11v6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    search: '<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2" fill="none"/>'
      + '<path d="m21 21-4.3-4.3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    /* lucide image / video / audio-lines / text-pen — the big glyph a generator
       node shows in place of its former "run a workflow" caption, one per
       medium. Stroked at 1.6 (not lucide's default 2) because these are drawn
       at ~56px, where a 2px stroke reads as heavy. */
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="1.6" fill="none"/>'
      + '<circle cx="9" cy="9" r="2" stroke="currentColor" stroke-width="1.6" fill="none"/>'
      + '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<rect x="2" y="6" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    "volume-2": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M16 9a5 5 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M19.364 18.364a9 9 0 0 0 0-12.728" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    /* lucide volume-x — the muted state of the control-bar speaker. */
    "volume-x": '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m16.5 14.5 5-5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="m16.5 9.5 5 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    /* lucide audio-lines — the six vertical bars used for an empty audio node
       and the audio entry in the add-node menu. */
    "audio-lines": '<path d="M2 10v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M6 6v11" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M10 3v18" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M14 8v7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 5v13" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M22 10v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    "text-pen": '<path d="M12 12H3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M21 5H3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M21.377 14.626a1 1 0 10-3.004-3.004l-5.01 5.012a2 2 0 00-.506.854l-.837 2.87a.5.5 0 00.62.62l2.87-.837a2 2 0 00.854-.506z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M8 19H3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    /* lucide shuffle — the value-control badge (ValueControlButton randomize) */
    shuffle: '<path d="M18 14 L22 18 L18 22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M18 2 L22 6 L18 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M2 18 H3.97 A4 4 0 0 0 7.27 16.3 L12.72 7.7 A4 4 0 0 1 16.02 6 H22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M2 6 H3.97 A4 4 0 0 1 7.57 8.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M22 18 H15.96 A4 4 0 0 1 12.66 16.2 L12.3 15.75" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide pencil-off — ValueControlButton's glyph for the "fixed" mode */
    "pencil-off": '<path d="M10 10 L3.843 16.162 A2 2 0 0 0 3.343 16.995 L2.021 21.355 A0.5 0.5 0 0 0 2.643 21.979 L7.001 20.656 A2 2 0 0 0 7.831 20.156 L14 13.982" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M12.829 7.172 L17.188 2.826 A1 1 0 1 1 21.174 6.812 L16.821 11.165" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M15 5 L19 9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'
      + '<path d="M2 2 L22 22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    /* Lucide glyphs for the node action toolbar. Stroked at 1.8 so the 14px
       rendering stays legible next to 12px labels. Names are stable internal
       ids from TOOL_ICONS; the visible tool label is the localised one. */
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M18 22V8a2 2 0 0 0-2-2H2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "grid-3x3": '<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    /* lucide layout-grid — glyph for the 宫格裁剪 tool (four equal detached cells),
       distinct from grid-3x3's continuous snap/group grid. */
    "layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<rect width="7" height="7" x="14" y="3" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<rect width="7" height="7" x="14" y="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<rect width="7" height="7" x="3" y="14" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    /* lucide layout-dashboard — glyph for the 排列 toolbar: four uneven dashboard
       panels, not the equal-cell layout-grid used by 宫格裁剪. */
    "layout-dashboard": '<rect width="7" height="9" x="3" y="3" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<rect width="7" height="5" x="14" y="3" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<rect width="7" height="9" x="14" y="12" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<rect width="7" height="5" x="3" y="16" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    "rotate-cw": '<path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M21 3v6h-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide rotate-3d — 3D orbit glyph for the 旋转 tool. */
    "rotate-3d": '<path d="m15.194 13.707 3.814 1.86-1.86 3.814" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M16.47214 7.52786 A 5 10 0 1 0 13 21.79796" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M21.79796 11 A 10 5 0 1 0 19 15.57071" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    rewind: '<path d="M12 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 12 18z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M22 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 22 18z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide aperture (verbatim official 24x24): outer ring r=10 + six
       independent blade paths. Keep the original coordinates — do not merge
       into one d attribute (two segments used to be mis-transcribed and drew outside
       the viewBox, showing a stray tail). */
    aperture: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>'
      + '<path d="m14.31 8 5.74 9.94" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M9.69 8h11.48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m7.38 12 5.74-9.94" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M9.69 16 3.95 6.06" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M14.31 16H2.83" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m16.62 12-5.74 9.94" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "music-2": '<circle cx="9" cy="18" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="21" cy="16" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    "audio-split": '<path d="M2 10v3M6 6v11M10 3v18M14 7v9M18 5v13M22 10v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    /* lucide audio-lines-off — the 音频分离 tool: audio bars crossed out. */
    "audio-lines-off": '<path d="M10 10v11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M10 3v1.35" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M14 14v1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M14 8v.35" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 5v7.35" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M2 10v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="m2 2 20 20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M22 10v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M6 6v11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    scissors: '<circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M20 4 8.1 15.9M8.1 8.1 20 20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    gauge: '<path d="m12 14 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M3.34 19a10 10 0 1 1 17.32 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 21h16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide copy (official 24x24) — text-result copy button. Not in the
       host prebuilt sheet, so draw locally like the other non-host glyphs. */
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide languages — text-result translate button. Drawn locally like copy
       (not in the host prebuilt sheet). */
    translate: '<path d="m5 8 6 6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M4 14c7.5 0 12-4 14-11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M2 5h10M7 2v3c0 5-3 8.5-5 10" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m14 14 2.5 2.5L20 22M20 14l-6 8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide bookmark — glyph for the 添加到收藏 toolbar action. */
    bookmark: '<path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide grid-3x3-off — 解组, the crossed-out counterpart of 打组's
       grid-3x3. Added upstream after our bundled Iconify CSS, so draw locally. */
    "grid-3x3-off": '<path d="M15 9.344V3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m2 2 20 20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M20.414 20.414A2 2 0 0119 21H5a2 2 0 01-2-2V5a2 2 0 01.586-1.414" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M20.656 15H21" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M21 9h-6.344" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M3 15h12v6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M3 9h6v12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M8.656 3H19a2 2 0 012 2v10.343" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M9 3v.344" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "trash-2": '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  /* Official ComfyUI lucide glyphs that ship in the host prebuilt sheet
     (verified against main-*.css, 257 glyphs). For these names IcIcon renders
     the host's mask class `icon-[lucide--*]` instead of an inlined <svg> path,
     so the glyph, stroke weight (host = 2) and colour all come from ComfyUI.
     Names NOT in this table (volume/mute/send/text-pen/layout-dashboard/
     rewind/aperture/music-2/audio-split/audio-lines-off/scissors/bookmark/
     grid-3x3-off) have no host glyph and keep their local SVG above. */
  export const HOST_GLYPH = {
    play: 1, pause: 1, upload: 1, sparkles: 1, settings: 1,
    "chevron-down": 1, "chevron-up": 1, "settings-2": 1, check: 1, tag: 1,
    minus: 1, plus: 1, "refresh-cw": 1, eye: 1, "eye-off": 1, "trash-2": 1,
    search: 1, image: 1, video: 1, "volume-2": 1, "volume-x": 1,
    "audio-lines": 1, shuffle: 1, "pencil-off": 1, crop: 1, "grid-3x3": 1,
    "layout-grid": 1, "rotate-cw": 1, "rotate-3d": 1, camera: 1, gauge: 1,
    download: 1,
  };

  export const IcIcon = {
    props: { name: { type: String, required: true }, size: { type: Number, default: ICON } },
    setup(props, { attrs }) {
      return () => {
        /* Host glyph class: `width:1.2em;height:1.2em` + CSS mask. When a
           caller sized via :size (px), convert px -> em (1.2em == size px).
           When a caller sized via a host size-* class in attrs.class, leave
           font-size alone so that class wins and the two stay pixel-identical. */
        if (HOST_GLYPH[props.name]) {
          const cls = attrs.class || "";
          const sizedByClass = /(?:^|\s)size-[\d.]+(?:\s|$)/.test(cls);
          return VueNS.h("i", {
            class: "icon-[lucide--" + props.name + "]",
            style: sizedByClass ? null : { fontSize: (props.size / 1.2) + "px" },
            "aria-hidden": "true",
          });
        }
        return VueNS.h("svg", {
          viewBox: "0 0 24 24",
          width: props.size,
          height: props.size,
          innerHTML: ICONS[props.name] || "",
        });
      };
    },
  };

