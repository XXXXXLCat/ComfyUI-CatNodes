/* Native ComfyUI tooltip engine (shared) 🐈‍⬛
   ------------------------------------------------------------------
   ComfyUI renders tooltips with Reka UI (TooltipContent.vue): a themed bubble
   mounted on <body>, class string from the host stylesheet, with an arrow.
   A plain `title=` attribute instead falls back to the browser's unthemeable
   black bubble. This module mounts ONE reused node with the native class and
   positions it like Reka (side + sideOffset + collision padding), so every
   canvas module gets the host's real tooltip instead of a browser title.

   Export `bindTip` for ES modules (media_assets.js) and also expose it as
   `window.InfCanvas.tip.bindTip` for the IIFE modules (infcanvas-ui.js etc.),
   which all share the same InfCanvas namespace object.

   Geometry is byte-matched to the host, verified by live CDP probe:
     bubble-to-trigger = 8px, arrow-tip-to-trigger = 4px, arrow 10x5.
   sideOffset=4 is the ARROW-TIP distance; the bubble is pushed out further by
   the arrow height (5) minus its -mt-px overlap (1): 4 + 5 - 1 = 8. */

const NATIVE_TOOLTIP_CONTENT =
    "z-overlay max-w-96 rounded-md border bg-background px-3 py-2 " +
    "text-xs/tight whitespace-pre-line text-foreground shadow-md pointer-events-none";
const NATIVE_TOOLTIP_ARROW_SVG =
    '<svg width="10" height="5" viewBox="0 0 12 6" preserveAspectRatio="none" ' +
    'class="-mt-px fill-background stroke-border" style="display:block">' +
    '<path d="M0 0L6 6L12 0"></path></svg>';

const NATIVE_TIP_SIDES = ["top", "right", "bottom", "left"];
let tipNode = null;
let tipFor = null;
let tipHideTimer = 0;

function ensureTipNode() {
    if (tipNode?.isConnected) return tipNode;
    tipNode = document.createElement("div");
    tipNode.className = NATIVE_TOOLTIP_CONTENT;
    tipNode.setAttribute("role", "tooltip");
    tipNode.dataset.testid = "tooltip-content";
    /* Inline fallback tracked by CSS variables: the host utility classes above
       are the primary source, but a stale/cached page (or a module loaded before
       the host stylesheet maps `bg-background`) can render the bubble with no
       theme at all — a blank white box. These keep text/arrow visible in any
       theme while still following the native palette. Canvas-mode z-overlay
       override uses !important, so it still wins over inline z-index here. */
    tipNode.style.cssText =
        "position:fixed;left:0;top:0;z-index:1700;max-width:384px;box-sizing:border-box;" +
        "padding:8px 12px;background:var(--background);color:var(--foreground);" +
        "border:1px solid var(--border);border-radius:6px;" +
        "box-shadow:0 2px 8px color-mix(in srgb, var(--color-black) 16%, transparent);" +
        "font-size:var(--text-xs, 12px);line-height:15px;font-weight:400;" +
        "font-family:var(--font-inter,Inter,system-ui,sans-serif);" +
        "white-space:pre-line;pointer-events:none;";
    tipNode.hidden = true;
    const text = document.createElement("div");
    text.dataset.testid = "tooltip-text";
    text.style.cssText = "color:var(--foreground);font:inherit;";
    tipNode.appendChild(text);
    const arrowHolder = document.createElement("span");
    arrowHolder.style.position = "absolute";
    arrowHolder.innerHTML = NATIVE_TOOLTIP_ARROW_SVG;
    // Ensure the arrow SVG paints from the live palette even without utilities.
    const arrowSvg = arrowHolder.querySelector("svg");
    if (arrowSvg) {
        arrowSvg.style.fill = "var(--background)";
        arrowSvg.style.stroke = "var(--border)";
    }
    tipNode.appendChild(arrowHolder);
    document.body.appendChild(tipNode);
    return tipNode;
}

function placeTip(anchor, side) {
    const el = ensureTipNode();
    const pad = 8;
    // Native sideOffset=4 is arrow-tip→trigger; bubble→trigger = 4 + 5 - 1 = 8.
    const ARROW_TIP_OFFSET = 4;
    const ARROW_H = 5;
    const ARROW_OVERLAP = 1;
    // An anchor may opt into a larger gap via data-tip-offset (px). Default is
    // the native 8. Used by the floating selection bar whose 8px padding would
    // otherwise make the bubble sit flush on the bar's top edge.
    const custom = Number(anchor.dataset.tipOffset);
    const offset = Number.isFinite(custom) && custom > 0
        ? custom
        : ARROW_TIP_OFFSET + ARROW_H - ARROW_OVERLAP; // = 8
    const ar = anchor.getBoundingClientRect();
    el.hidden = false; // measure at 0,0 (fixed, no layout influence)
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fits = {
        top: ar.top - th - offset >= pad,
        bottom: ar.bottom + th + offset <= vh - pad,
        left: ar.left - tw - offset >= pad,
        right: ar.right + tw + offset <= vw - pad,
    };
    let s = side;
    if (!fits[s]) {
        const flip = { top: "bottom", bottom: "top", left: "right", right: "left" }[s];
        if (fits[flip]) s = flip;
        else s = NATIVE_TIP_SIDES.find((k) => fits[k]) || s;
    }
    const arrow = el.lastElementChild;
    const svg = arrow.firstElementChild;
    const cx = ar.left + ar.width / 2;
    const cy = ar.top + ar.height / 2;
    let x, y;
    if (s === "top" || s === "bottom") {
        /* Reka TooltipContent `align` along the side axis: default centre (as
           before), but an anchor may opt into start/end via data-tip-align.
           Node titles use "start" so the bubble reads from the title's left
           edge instead of floating centred over the whole node. The arrow
           keeps pointing at the trigger centre, same as Reka's sticky arrow. */
        const align = anchor.dataset.tipAlign;
        const baseX = align === "start" ? ar.left
            : align === "end" ? ar.right - tw
            : cx - tw / 2;
        x = Math.min(Math.max(baseX, pad), vw - tw - pad);
        y = s === "top" ? ar.top - th - offset : ar.bottom + offset;
        const ax = Math.min(Math.max(cx - x, 10), tw - 10);
        arrow.style.cssText =
            `position:absolute;left:${ax}px;${s === "top" ? "bottom" : "top"}:-5px;` +
            `transform:translateX(-50%)${s === "bottom" ? " rotate(180deg)" : ""};`;
    } else {
        x = s === "left" ? ar.left - tw - offset : ar.right + offset;
        y = Math.min(Math.max(cy - th / 2, pad), vh - th - pad);
        const ay = Math.min(Math.max(cy - y, 10), th - 10);
        /* Horizontal arrows rotate 90deg, so the SVG's -mt-px (-1px margin)
           becomes a horizontal shift: +1px for rotate(90) (side right, tip
           points left) and -1px for rotate(-90) (side left, tip points right).

           Native ComfyUI/Reka arrow is an OPEN notch: the arrow's fill (same
           colour as the bubble) overlaps the bubble border by ~1.5px, so the
           border line breaks at the arrow and the two strokes continue into a
           "<" tip. If the triangle sits fully outside (cover <= 0) the bubble
           border stays intact and reads as a CLOSED triangle stuck on the side.
           Measured by live CDP sweep: cover = svgRight - bubbleLeft should be
           ~1.5px with a 4px protruding tip (native sideOffset=4, bubble gap 8).
           right side -> left:-8 (one more pixel left, per visual check);
           left side mirrors to -7. */
        const edge = s === "right" ? -8 : -7;
        arrow.style.cssText =
            `position:absolute;top:${ay}px;${s === "left" ? "right" : "left"}:${edge}px;` +
            `transform:translateY(-50%) rotate(${s === "left" ? -90 : 90}deg);`;
    }
    svg.style.display = "block";
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.dataset.side = s;
}

function showTip(anchor, text, side) {
    clearTimeout(tipHideTimer);
    // Never paint an empty bubble. An unresolved i18n key / transient empty
    // text source must not leave a themed-but-blank box floating over the UI.
    if (text == null || String(text).trim() === "") {
        hideTip();
        return;
    }
    const el = ensureTipNode();
    /* Canvas mode tags the children of every body>div.z-overlay with
       data-infcanvas-suppressed to hide ComfyUI's own leftover dialogs, and the
       stylesheet turns that into visibility:hidden!important. Our bubble reuses
       the host's z-overlay class, so a node created before entering the canvas
       gets its text + arrow hidden while the themed box still paints — an empty
       bubble over every button. Strip the flag on each show: even a session that
       was already suppressed recovers as soon as it re-renders a tooltip. */
    for (const child of el.children) child.removeAttribute("data-infcanvas-suppressed");
    if (tipFor === anchor && !el.hidden) {
        el.firstElementChild.textContent = text; // keep live text fresh
        return;
    }
    tipFor = anchor;
    el.firstElementChild.textContent = text;
    placeTip(anchor, side);
}

function hideTip() {
    clearTimeout(tipHideTimer);
    tipHideTimer = window.setTimeout(() => {
        if (tipNode) tipNode.hidden = true;
        tipFor = null;
    }, 60); // tiny grace so pointer can cross from trigger to menu
}

/* Bind a native tooltip to any element; returns the anchor. `getText` may be a
   function so dynamic labels stay live. Idempotent: re-binding replaces the
   text source rather than stacking listeners. `title` is removed so the
   browser bubble can never show through. */
const TIP_TEXT = Symbol("xcatTipText");
function bindTip(anchor, getText, side = "top") {
    if (!anchor) return anchor;
    anchor.removeAttribute("title");
    const textOf = () => (typeof getText === "function" ? getText() : getText);
    if (anchor[TIP_TEXT]) {
        anchor[TIP_TEXT] = textOf;
        return anchor; // already bound — just refresh the dynamic text source
    }
    anchor[TIP_TEXT] = textOf;
    anchor.addEventListener("mouseenter", () => showTip(anchor, anchor[TIP_TEXT](), side));
    anchor.addEventListener("mouseleave", hideTip);
    anchor.addEventListener("focus", () => showTip(anchor, anchor[TIP_TEXT](), side));
    anchor.addEventListener("blur", hideTip);
    return anchor;
}

/* Shared with the IIFE modules (no ES imports there). */
const NS = (window.InfCanvas = window.InfCanvas || {});
NS.tip = NS.tip || {};
NS.tip.bindTip = bindTip;

export { bindTip };
