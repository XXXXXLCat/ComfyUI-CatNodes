/* LoRA stack node: the per-node model list (add / remove / weight / enable),
   its searched name combobox, the content-driven height helper, and the
   trigger-word read-back (trainedWords from each LoRA's sidecar json).
   Extracted from flow-node-view.js (core-module split, 2026-11-22). Runtime
   dependencies (data / patch / NS / isLora / sizing constants / popover
   math) are injected so this module stays a pure composable. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";
import { ensureLoraMeta, combinedTriggers } from "./lora-meta.js";

const { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } = VueNS;

export function useLoraStack({ data, patch, NS, isLora, HEAD_H, ASSET_MIN_W, pickMenuSide, menuTopLocal }) {
    /* The LoRA stack is content-driven: its height follows the enabled row
       count (one row per model, like ComfyUI's auto-sized nodes). Growing a
       stack grows the card rather than hiding rows behind a scrollbar.
       loraFitHeight returns the TOTAL height (header included). */
    const LORA_MIN_W = ASSET_MIN_W;              // 320: same floor as asset nodes
    const LORA_DEF_BODY_H = 80;                  // default body -> total 108, same floor as other nodes
    const LORA_CHROME = 74;                      // padding(16) + head(20) + 2 gaps(12) + add(24) + slack
    const LORA_ROW_H = 24, LORA_ROW_GAP = 4;   // matches the API panel's gap-y-1
    const LORA_GAP = 6;                          // .icn__lora flex gap, one per extra block
    /* Measured height of the trigger-word box (0 while it is hidden). It is
       read straight from the DOM because the text wraps to as many lines as
       the words need — no row count can predict that. */
    const triggerH = ref(0);
    const loraFitHeight = (n) => HEAD_H + Math.max(
      LORA_DEF_BODY_H, LORA_CHROME + Math.max(0, n) * LORA_ROW_H + Math.max(0, n - 1) * LORA_ROW_GAP
    ) + (triggerH.value > 0 ? triggerH.value + LORA_GAP : 0);
    /* ---- LoRA stack: list / add / remove / weight / enable ----
       All writes go through patch() so the Vue Flow copy AND the document
       array stay in sync (see the comment above). Entries are always rebuilt
       as a NEW array and re-read from data by index — a closure that holds an
       old entry object becomes an orphan after updateNodeData swaps `data`. */
    const loras = computed(() => Array.isArray(data.loras) ? data.loras : []);
    /* Grow the stored height with the row count (silent = normalisation, not
       a user edit). bodyH already renders the larger of stored/content height
       so there is never a frame with covered rows; this just keeps data.size
       in sync so a later manual resize starts from the grown baseline. */
    watch(() => loras.value.length, () => {
      if (!isLora) return;
      const cur = Array.isArray(data.size) ? data.size : [LORA_MIN_W, LORA_DEF_BODY_H + HEAD_H];
      const need = loraFitHeight(loras.value.length);
      if (cur[1] < need) patch({ size: [Math.max(LORA_MIN_W, cur[0]), need] }, { silent: true });
    });
    /* ---- trigger words (trainedWords) ----
       Only ENABLED entries contribute, in stack order, de-duplicated: the box
       below the list shows exactly what an enabled stack would inject. Fetch
       and caching live in lora-meta.js so the prompt compiler can await the
       same request before building a workflow. */
    watch(
      () => loras.value.map((item) => String(item?.name || "")).join("\n"),
      () => { if (isLora) ensureLoraMeta(loras.value, NS.backend); },
      { immediate: true }
    );
    const enabledTriggers = computed(() => combinedTriggers(
      loras.value.filter((item) => item && item.enabled !== false)
    ).join(", "));
    /* The box wraps to as many lines as the words need, so its height cannot
       be predicted — measure it and fold it into loraFitHeight (bodyH reads
       that). The stored size follows by the DELTA only, so a manually enlarged
       card keeps its extra room instead of snapping back to the fitted size. */
    let triggerObserver = null;
    let triggerEl = null;
    let triggerMeasured = false;
    let lastTriggerExtra = 0;
    const setTriggerEl = (el) => {
      if (el === triggerEl) return;   /* Vue 3 re-invokes fn refs on every patch */
      triggerEl = el || null;
      if (triggerObserver) {
        try { triggerObserver.disconnect(); } catch (error) { /* ignore */ }
        triggerObserver = null;
      }
      if (!el) { triggerH.value = 0; return; }
      const measure = () => { triggerH.value = el.offsetHeight || 0; };
      measure();
      if (typeof ResizeObserver !== "undefined") {
        triggerObserver = new ResizeObserver(measure);
        triggerObserver.observe(el);
      }
    };
    onBeforeUnmount(() => {
      if (triggerObserver) {
        try { triggerObserver.disconnect(); } catch (error) { /* ignore */ }
        triggerObserver = null;
      }
    });
    watch(triggerH, (h) => {
      if (!isLora) return;
      const extra = h > 0 ? h + LORA_GAP : 0;
      const cur = Array.isArray(data.size) ? data.size : [LORA_MIN_W, LORA_DEF_BODY_H + HEAD_H];
      const fitted = loraFitHeight(loras.value.length);
      let need;
      if (!triggerMeasured) {
        /* First non-zero measurement: the stored size may already contain this
           box (a re-opened canvas), so only ever grow to the fitted height. */
        if (h > 0) triggerMeasured = true;
        need = Math.max(cur[1], fitted);
      } else {
        need = Math.max(fitted, cur[1] + (extra - lastTriggerExtra));
      }
      lastTriggerExtra = extra;
      if (Math.round(need) !== Math.round(cur[1])) {
        patch({ size: [Math.max(LORA_MIN_W, cur[0]), need] }, { silent: true });
      }
    });
    const loraOptions = ref([]);
    const loadLoraOptions = () => Promise.resolve(NS.api?.loraNames?.())
      .then((names) => { loraOptions.value = Array.isArray(names) ? names : []; })
      .catch(() => { loraOptions.value = []; });
    if (isLora) onMounted(loadLoraOptions);
    const addLora = (name = "") => {
      const next = loras.value.map((item) => ({ ...item }));
      next.push({ name: name || loraOptions.value[0] || "", strength: 1, enabled: true });
      patch({ loras: next });
    };
    const removeLora = (index) => {
      const next = loras.value.map((item) => ({ ...item }));
      if (index < 0 || index >= next.length) return;
      next.splice(index, 1);
      patch({ loras: next });
    };
    const setLoraName = (index, name) => {
      const next = loras.value.map((item) => ({ ...item }));
      if (index < 0 || index >= next.length) return;
      next[index].name = name;
      patch({ loras: next });
    };
    const setLoraStrength = (index, value) => {
      const next = loras.value.map((item) => ({ ...item }));
      if (index < 0 || index >= next.length) return;
      const num = Number(value);
      next[index].strength = Number.isFinite(num) ? Math.max(-100, Math.min(100, num)) : 0;
      patch({ loras: next });
    };
    const stepLora = (index, delta) => {
      const current = Number(loras.value[index]?.strength) || 0;
      setLoraStrength(index, Math.round((current + delta) * 100) / 100);
    };
    const toggleLora = (index) => {
      const next = loras.value.map((item) => ({ ...item }));
      if (index < 0 || index >= next.length) return;
      next[index].enabled = next[index].enabled === false;
      patch({ loras: next });
    };
    const loraStrengthText = (value) => {
      const num = Number(value) || 0;
      return num.toFixed(2);
    };
    /* Searched combobox for the LoRA name. The option list hangs off the
       node ROOT (below this setup's body, which clips overflow) exactly like
       the API-parameter listbox: we measure the trigger against .icn and
       position a floating menu in the node's unscaled layout units. */
    const loraSelIndex = ref(null);              // open row index, or null
    const loraQuery = ref("");
    const loraSelStyle = ref({});
    const loraSearchEl = ref(null);
    const loraSelName = (index) => loras.value[index]?.name || "";
    const filteredLoraOptions = computed(() => {
      const q = String(loraQuery.value || "").trim().toLowerCase();
      if (!q) return loraOptions.value;
      return loraOptions.value.filter((name) => String(name).toLowerCase().includes(q));
    });
    const closeLoraSel = () => { loraSelIndex.value = null; loraQuery.value = ""; };
    const setLoraSearchEl = (el) => { loraSearchEl.value = el; };
    const toggleLoraSel = (index, event) => {
      if (loraSelIndex.value === index) { closeLoraSel(); return; }
      loraSelIndex.value = index;
      loraQuery.value = "";
      /* Anchor exactly like the API panel's toggleSel(): resolve the field
         ROW, then use the combobox's parent wrapper as the anchor — NOT the
         clicked element. The name button and the chevron are two different
         targets; anchoring on currentTarget made the popover jump left/right
         depending on which one you pressed. */
      const rowEl = event?.currentTarget?.closest?.(".icn__lora-row");
      const anchor = rowEl?.querySelector?.('[role="combobox"]')?.parentElement;
      const root = anchor?.closest?.(".icn");
      if (anchor && root) {
        const rr = root.getBoundingClientRect();
        const scale = root.offsetWidth ? rr.width / root.offsetWidth : 1;
        const ar = anchor.getBoundingClientRect();
        const place = () => {
          const menu = root.querySelector("[data-lora-sel]");
          const side = menu ? pickMenuSide(ar, menu.getBoundingClientRect()) : "down";
          const menuH = menu ? menu.getBoundingClientRect().height : 0;
          loraSelStyle.value = {
            left: Math.round((ar.left - rr.left) / scale) + "px",
            top: menuTopLocal(side, rr, ar, scale, 4, menuH) + "px",
            width: Math.round(Math.max(ar.width, 160) / scale) + "px",
          };
        };
        place();
        nextTick(place); /* re-measure once the v-if list is in the DOM */
      }
      nextTick(() => loraSearchEl.value?.focus?.());
    };
    const pickLoraSel = (name) => {
      if (loraSelIndex.value == null) return;
      setLoraName(loraSelIndex.value, name);
      closeLoraSel();
    };

  return { loras, loraOptions, loadLoraOptions, addLora, removeLora, setLoraName, setLoraStrength, stepLora, toggleLora, loraStrengthText, loraSelIndex, loraQuery, loraSelStyle, loraSearchEl, loraSelName, filteredLoraOptions, closeLoraSel, setLoraSearchEl, toggleLoraSel, pickLoraSel, loraFitHeight, LORA_MIN_W, enabledTriggers, setTriggerEl, triggerH };
}
