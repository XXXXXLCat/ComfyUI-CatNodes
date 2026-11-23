/* Prompt "@" quick-reference editor: atomic chips (thumbnail + highlighted
   "@image1") inside a contenteditable surface, plus the hover preview card.
   Extracted from flow-node-view.js (core-module split, 2026-11-22). The node
   owns only four runtime inputs: the node data, the wired-asset list, a
   "is this a rich prompt" getter and the prompt writer; the composable owns
   its own DOM state, IME guard, caret operations and chip serialisation. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";
import { videoThumbs } from "./flow-components.js";
import { fmtTime } from "./flow-rules.js";

const { computed, ref, watch, nextTick } = VueNS;

export function usePromptMention({ data, incomingAssets, isRich, setPrompt, bindTip }) {
    /* ---- "@" quick reference (atomic chips) ----------------------------
       The prompt is a contenteditable surface, not a textarea: a reference
       has to read as ONE object — thumbnail + highlighted "@图片1" — that
       the caret cannot enter and that deletes in a single backspace. The
       stored value stays PLAIN TEXT ("... @图片1 ..."), so saves, the
       backend and the chip rendering all agree; a parse pass turns every
       @kind+number token back into a chip on load.
       Typing "@" at a line start / after whitespace opens the picker over
       the assets wired into this node; ↑/↓ moves, Enter/Tab or a click
       inserts the chip, Esc closes. Typing "@" mid-word never triggers. */
    const promptEl = ref(null);
    const mention = ref(null);            // { query, deleteCount, items, index }
    const refPreview = ref(null);         // hover preview of a chip
    let composing = false;                // IME guard: never open a picker mid-composition
    let lastSynced = null;                // last text we wrote, so external writes can re-render
    /* Candidates come from EVERY wired asset, not from the active mode's slots:
       "@" should stay usable while the user is still deciding on a mode. */
    const mentionItems = computed(() =>
      incomingAssets.value.map((asset) => ({
        key: asset.id,
        label: asset.label,
        name: asset.name,
        kind: asset.kind,
        url: asset.url || "",
        thumb: asset.kind === "image"
          ? asset.url
          : asset.kind === "video" ? (videoThumbs[asset.url] || "") : "",
      })));

    const escapeText = (value) => String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapeAttr = (value) => escapeText(value).replace(/"/g, "&quot;");
    /* A token written in one language must still find its asset after a
       language switch: @图片1 and @Image1 address the same first image. */
    const MENTION_KIND = {
      "图片": "image", "视频": "video", "音频": "audio",
      "image": "image", "video": "video", "audio": "audio",
    };
    const MENTION_RE = /@(图片|视频|音频|Image|Video|Audio)(\d+)\s?/gi;
    const mentionItem = (ref) => {
      const hit = /^(.+?)(\d+)$/.exec(String(ref || ""));
      if (hit) {
        const kind = MENTION_KIND[hit[1]] || MENTION_KIND[hit[1].toLowerCase()];
        if (kind) {
          const sameKind = mentionItems.value.filter((entry) => entry.kind === kind);
          const found = sameKind[Number(hit[2]) - 1];
          if (found) return found;
        }
      }
      return mentionItems.value.find((entry) => entry.label === ref);
    };
    const chipHtml = (item) => '<span class="icn__gpv-ref" contenteditable="false"'
      + ' data-ref="' + escapeAttr(item.label) + '" data-kind="' + escapeAttr(item.kind || "image") + '"'
      + ' data-name="' + escapeAttr(item.name || item.label) + '"'
      + '>'
      + (item.thumb ? '<img class="icn__gpv-ref-img" src="' + escapeAttr(item.thumb) + '" alt="" draggable="false">' : "")
      + '<span class="icn__gpv-ref-t">@' + escapeText(item.label) + "</span></span>";
    /* Live chip element, used when inserting (Enter or paste). */
    const buildChip = (item) => {
      const chip = document.createElement("span");
      chip.className = "icn__gpv-ref";
      chip.contentEditable = "false";
      chip.dataset.ref = item.label;
      chip.dataset.kind = item.kind || "image";
      bindTip(chip, item.name || item.label);
      if (item.thumb) {
        const img = document.createElement("img");
        img.className = "icn__gpv-ref-img";
        img.src = item.thumb;
        img.alt = "";
        img.draggable = false;
        chip.appendChild(img);
      }
      const label = document.createElement("span");
      label.className = "icn__gpv-ref-t";
      label.textContent = "@" + item.label;
      chip.appendChild(label);
      return chip;
    };
    /* Plain text -> rich markup. The separator space after a token is kept as
       a real text node (NOT inside the chip) so selecting and copying the
       prompt yields exactly the same string that gets stored. */
    const toRich = (text) => {
      const src = String(text || "");
      MENTION_RE.lastIndex = 0;
      let html = "";
      let last = 0;
      let hit;
      while ((hit = MENTION_RE.exec(src))) {
        html += escapeText(src.slice(last, hit.index)).replace(/\n/g, "<br>");
        const label = hit[1] + hit[2];
        const item = mentionItem(label);
        html += chipHtml(item || { label, kind: "image", name: label, thumb: "" }) + " ";
        last = hit.index + hit[0].length;
      }
      return html + escapeText(src.slice(last)).replace(/\n/g, "<br>");
    };
    /* Rich markup -> plain text. Chips become "@图片1 " again. */
    const fromRich = (node) => {
      let out = "";
      const walk = (parent) => {
        for (const child of parent.childNodes) {
          if (child.nodeType === 3) { out += child.data; continue; }
          if (child.nodeType !== 1) continue;
          const ref = child.dataset?.ref;
          if (ref) { out += "@" + ref; continue; }
          if (child.tagName === "BR") { out += "\n"; continue; }
          const block = child.tagName === "DIV" || child.tagName === "P";
          if (block && out && !out.endsWith("\n")) out += "\n";
          walk(child);
        }
      };
      walk(node);
      return out.replace(/\n$/, "");
    };
    const renderPrompt = () => {
      const el = promptEl.value;
      if (!el) return;
      const text = data.prompt || "";
      el.innerHTML = toRich(text);
      el.querySelectorAll(".icn__gpv-ref").forEach((chip) => {
        bindTip(chip, chip.dataset.name || chip.dataset.ref || "");
      });
      lastSynced = text;
    };
    const syncPrompt = () => {
      const el = promptEl.value;
      if (!el) return;
      const text = fromRich(el);
      lastSynced = text;
      setPrompt(text);
    };
    /* Re-render only when the value changed from OUTSIDE (load / undo), so
       typing never has its DOM rewritten underneath the caret. */
    watch(() => data.prompt, (value) => {
      if (value === lastSynced) return;
      lastSynced = value;
      renderPrompt();
    });
    /* Both rich-prompt owners (video and image) paint stored chips once their
       box exists; the audio/text generators keep plain text areas. */
    watch(() => isRich.value, (on) => {
      if (on) nextTick(renderPrompt);
    }, { immediate: true });

    const closeMention = () => { mention.value = null; };
    /* Plain text up to the caret, but only when the caret is inside the box. */
    const caretBefore = () => {
      const el = promptEl.value;
      const sel = window.getSelection();
      if (!el || !sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return null;
      const pre = range.cloneRange();
      pre.selectNodeContents(el);
      pre.setEnd(range.startContainer, range.startOffset);
      return { text: fromRich(pre.cloneContents()), range };
    };
    /* The "@token" run that ends at the caret — "@" must start a line or follow
       whitespace, and no whitespace may sit between it and the caret (else the
       user is just writing prose). Returns null when there is no live token. */
    const mentionAtCaret = (before) => {
      const at = before.lastIndexOf("@");
      if (at < 0) return null;
      if (at > 0 && !/[\s\u3000]/.test(before.charAt(at - 1))) return null;
      const query = before.slice(at + 1);
      if (/[\s\u3000]/.test(query)) return null;
      return { query, deleteCount: 1 + query.length };
    };
    const openMention = () => {
      if (composing) return;
      const ctx = caretBefore();
      if (!ctx) { closeMention(); return; }
      const hit = mentionAtCaret(ctx.text);
      if (!hit) { closeMention(); return; }
      const q = hit.query.toLowerCase();
      const items = mentionItems.value.filter((item) =>
        !q
        || item.label.toLowerCase().includes(q)
        || String(item.name || "").toLowerCase().includes(q));
      if (!items.length) { closeMention(); return; }
      mention.value = { query: hit.query, deleteCount: hit.deleteCount, items, index: 0 };
    };
    const onPromptInput = () => {
      /* contenteditable=false only blocks the caret; a selection that covers a
         chip's label can still be typed over. Restore the label text. */
      const el = promptEl.value;
      el?.querySelectorAll(".icn__gpv-ref").forEach((chip) => {
        const want = "@" + (chip.dataset.ref || "");
        const label = chip.querySelector(".icn__gpv-ref-t");
        if (label && label.textContent !== want) label.textContent = want;
      });
      syncPrompt();
      openMention();
    };
    const onComposeStart = () => { composing = true; };
    const onComposeEnd = () => {
      composing = false;
      syncPrompt();
      openMention();
    };
    /* Paste is normalized exactly like typing: a copied prompt keeps its chips
       instead of degrading to literal "@图片1" text. The clipboard string is
       split on tokens and inserted as text nodes + chips, so the caret lands
       right after the last inserted node. */
    const insertRichText = (text) => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return false;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      MENTION_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let hit;
      while ((hit = MENTION_RE.exec(text))) {
        if (hit.index > last) frag.appendChild(document.createTextNode(text.slice(last, hit.index)));
        const label = hit[1] + hit[2];
        frag.appendChild(buildChip(mentionItem(label)
          || { label, kind: "image", name: label, thumb: "" }));
        frag.appendChild(document.createTextNode(" "));
        last = hit.index + hit[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      const anchor = document.createTextNode("");
      frag.appendChild(anchor);
      range.insertNode(frag);
      const after = document.createRange();
      after.setStart(anchor, 0);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      return true;
    };
    const onPromptPaste = (event) => {
      const text = event.clipboardData?.getData("text") || "";
      if (!text) return;
      if (!insertRichText(text)) {
        try { document.execCommand("insertText", false, text); }
        catch (error) { /* older browsers: ignore */ }
      }
      syncPrompt();
      openMention();
    };
    const hoverMention = (index) => {
      if (mention.value) mention.value = { ...mention.value, index };
    };
    /* Replace the live "@query" run with a chip and park the caret after it. */
    const pickMention = (item) => {
      const state = mention.value;
      const el = promptEl.value;
      const sel = window.getSelection();
      if (!state || !item || !el || !sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) { closeMention(); return; }
      const chip = buildChip(item);

      const container = range.startContainer;
      /* A trailing space goes AFTER the chip as a plain text node, so the
         copied / stored string reads "... @图片1 女玩家" like normal prose. */
      const space = document.createTextNode(" ");
      if (container.nodeType === 3) {
        const offset = range.startOffset;
        const start = Math.max(0, offset - state.deleteCount);
        container.deleteData(start, offset - start);
        const tail = container.splitText(start);
        tail.parentNode.insertBefore(chip, tail);
        chip.parentNode.insertBefore(space, tail);
      } else {
        range.insertNode(chip);
        chip.parentNode.insertBefore(space, chip.nextSibling);
      }
      const after = document.createRange();
      after.setStart(space, 1);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      closeMention();
      syncPrompt();
      el.focus();
    };
    /* Deleting a chip also swallows the separator space we inserted behind it,
       so a removed reference never leaves a double space in the sentence. */
    const eatChipBehind = (event) => {
      if (event.key !== "Backspace") return false;
      const sel = window.getSelection();
      const el = promptEl.value;
      if (!sel || !sel.rangeCount || !sel.isCollapsed || !el) return false;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3 || !el.contains(node) || range.startOffset !== 0) return false;
      const prev = node.previousSibling;
      if (!prev || prev.nodeType !== 1 || !prev.classList.contains("icn__gpv-ref")) return false;
      event.preventDefault();
      if (node.data.startsWith(" ")) node.deleteData(0, 1);
      prev.parentNode.removeChild(prev);
      const after = document.createRange();
      after.setStart(node, 0);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      syncPrompt();
      return true;
    };
    const onPromptKeydown = (event) => {
      const state = mention.value;
      if (!state) { eatChipBehind(event); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const total = state.items.length;
        hoverMention((state.index + step + total) % total);
      } else if (event.key === "Enter" || event.key === "Tab") {
        if (composing) return;
        event.preventDefault();
        pickMention(state.items[state.index]);
      } else if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        closeMention();
      }
    };
    /* Hover preview for an inserted chip: SAME card as the slot thumbnails
       (160px, same surface / radius / name strip, media autoplays), only the
       anchoring differs — a chip lives inside a scrolling text run, so the
       card is teleported to the canvas root and pinned above the chip. */
    const refMetaDuration = ref("0:00");
    const onRefMeta = (event) => {
      refMetaDuration.value = fmtTime(event?.target?.duration);
    };
    const onRefOver = (event) => {
      const chip = event.target?.closest?.(".icn__gpv-ref");
      if (!chip) return;
      const item = mentionItem(chip.dataset.ref);
      if (!item) return;
      if (refPreview.value?.label === item.label) return;   // same chip: keep the player alive
      const box = chip.getBoundingClientRect();
      const half = 84;                                      // card half width + viewport margin
      const center = box.left + box.width / 2;
      const left = Math.round(Math.min(Math.max(center, half), window.innerWidth - half));
      const top = Math.round(box.top);
      if (refPreview.value?.left === left && refPreview.value?.top === top) return; // same chip: keep the player alive
      refMetaDuration.value = "0:00";
      refPreview.value = { ...item, left, top };
    };
    const onRefOut = (event) => {
      /* Keep the card only while the pointer is still inside SOME chip: moving
         between the thumbnail and the label must not flicker, everything else
         (including leaving the editor, where relatedTarget may be null) closes
         it. Do NOT require the outgoing target to be a chip — the DOM is
         rebuilt on every re-render, so the element under the pointer can be
         gone by the time mouseout fires and the card used to be left behind. */
      if (event.relatedTarget?.closest?.(".icn__gpv-ref")) return;
      refPreview.value = null;
    };

  return { promptEl, mention, mentionItems, closeMention, onPromptInput, hoverMention, pickMention, onPromptKeydown, refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut };
}
