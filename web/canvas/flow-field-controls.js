/* Exposed-parameter controls: the numeric widget lines (step / range /
   display / drag-scrub) plus the read-only bar summary. Extracted from
   flow-node-view.js (core-module split, 2026-11-22). All data lookups are
   injected; the composable owns only its transient edit / scrub state. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";

const { computed, ref } = VueNS;

export function useFieldControls({ fieldValue, setFieldValue, fieldId, apiBarFields, isAdvancedField, noWorkflow, t }) {
    const fieldStep = (field) => {
      const step = Number(field?.step);
      return Number.isFinite(step) && step > 0 ? step : 1;
    };
    const fieldMin = (field) => (Number.isFinite(Number(field?.min))
      ? Number(field.min) : Number.MIN_SAFE_INTEGER);
    const fieldMax = (field) => (Number.isFinite(Number(field?.max))
      ? Number(field.max) : Number.MAX_SAFE_INTEGER);
    const fieldNum = (field) => {
      const value = Number(fieldValue(field));
      return Number.isFinite(value) ? value : 0;
    };
    const decimalsOf = (step) => {
      const text = String(step);
      const dot = text.indexOf(".");
      return dot < 0 ? 0 : text.length - dot - 1;
    };
    /* Display only — 0.1 + 0.2 must still read "0.3", not 0.30000000000000004. */
    const fieldText = (field) => {
      const value = fieldValue(field);
      if (value === "" || value === null || value === undefined) return "";
      const num = Number(value);
      if (!Number.isFinite(num)) return String(value);
      const own = field?.precision;
      const digits = own === undefined || own === null || own === ""
        ? decimalsOf(fieldStep(field)) : Number(own);
      return Number.isFinite(digits) && digits > 0 ? num.toFixed(Math.min(digits, 6)) : String(num);
    };
    /* Read-only summary on the bottom settings row: plain (non-advanced) params only,
       dot-separated. Editing stays in the gear popover; clicking the summary forwards to it. */
    const plainParams = computed(() => apiBarFields.value.filter((f) => !isAdvancedField(f)));
    const paramLabel = (f) => String(f?.label || fieldId(f) || "").trim();
    const paramText = (f) => {
      if (!f) return "";
      if (f.type === "switch") return fieldValue(f) ? t("core.on") : t("core.off");
      const text = fieldText(f);
      /* Aspect-ratio values read "16:9 (Widescreen)" from the node; the
         bottom summary wants only the ratio, so drop the parenthesized
         name. Restricted to "N:N (...)" so other fields are untouched. */
      return String(text).replace(/^(\d+\s*:\s*\d+)\s*\(.*$/, "$1").trim();
    };
    const openSetFromBar = (event) => {
      if (noWorkflow.value) return;
      const btn = event?.currentTarget?.parentElement?.querySelector?.(".icn__gpa-set");
      if (btn && !btn.disabled) btn.click();
    };
    const fieldFill = (field) => {
      const min = Number(field?.min), max = Number(field?.max), step = Number(field?.step);
      if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return 0;
      if (max <= min || (max - min) / step >= 100) return 0;
      return Math.max(0, Math.min(1, (fieldNum(field) - min) / (max - min))) * 100;
    };
    const clampField = (field, value) => Math.min(fieldMax(field), Math.max(fieldMin(field), value));
    const bumpField = (field, dir) => {
      const next = fieldNum(field) + dir * fieldStep(field);
      setFieldValue(field, clampField(field, Number(next.toFixed(6))));
    };
    const commitFieldNum = (field, event) => {
      const element = event?.target || null;
      const raw = String(element?.value ?? "").trim();
      const num = Number(raw);
      if (raw === "" || !Number.isFinite(num)) {
        /* Garbage or empty: snap the field back instead of writing NaN in. */
        if (element) element.value = fieldText(field);
        return;
      }
      setFieldValue(field, clampField(field, Number(num.toFixed(6))));
      if (element) element.value = fieldText(field);
      editingField.value = "";
    };
    const stepField = (field, dir) => {
      setFieldValue(field, clampField(field,
        Number((fieldNum(field) + dir * fieldStep(field)).toFixed(6))));
    };
    /* ScrubableNumberInput disables − / + at the field's own bounds
       (canDecrement / canIncrement in the host component). */
    const canFieldDec = (field) => fieldNum(field) > fieldMin(field);
    const canFieldInc = (field) => fieldNum(field) < fieldMax(field);
    /* The value is covered by a transparent swipe layer (cursor:ew-resize):
       a horizontal drag scrubs 1 step per 10px -- right increases, left
       decreases, which is what the host does -- and a plain click switches the
       value into edit mode, focused with the text selected. */
    const editingField = ref("");
    const scrub = { field: null, startX: 0, applied: 0, moved: false };
    const scrubStart = (field, event) => {
      scrub.field = field;
      scrub.startX = event.clientX;
      scrub.applied = 0;
      scrub.moved = false;
    };
    const scrubMove = (event) => {
      if (!scrub.field) return;
      const delta = Math.trunc((event.clientX - scrub.startX) / 10);
      if (!delta || delta === scrub.applied) return;
      const diff = delta - scrub.applied;
      scrub.applied = delta;
      scrub.moved = true;
      stepField(scrub.field, diff);
    };
    const scrubCancel = () => { scrub.field = null; };
    const scrubEnd = (field, event) => {
      const moved = scrub.moved;
      scrub.field = null;
      if (moved) return;
      editingField.value = fieldId(field);
      const input = event?.currentTarget?.parentElement?.querySelector("input");
      if (input) { input.focus(); input.select(); }
    };
    return { fieldStep, fieldMin, fieldMax, fieldNum, decimalsOf, fieldText, plainParams, paramLabel, paramText, openSetFromBar, fieldFill, clampField, bumpField, commitFieldNum, stepField, canFieldDec, canFieldInc, editingField, scrubStart, scrubMove, scrubCancel, scrubEnd };
}
