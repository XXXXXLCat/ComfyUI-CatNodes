/* Shared trigger-word cache for LoRA sidecar metadata.

   The model manager writes ``<stem>.metadata.json`` next to every LoRA; the
   ``trainedWords`` list in it is the model's activation prompt. Two consumers
   need the same data at different times:

     - the LoRA stack card, which shows the words of its ENABLED rows;
     - the prompt compiler, which merges those words into the POSITIVE text
       encoder of the generated workflow.

   Keeping one cache here means a single HTTP round trip per name and, more
   importantly, lets buildPrompt() await a fetch that the UI started but has
   not finished — otherwise an immediate Generate could silently omit words.
   A serial queue is used so every caller awaiting ensureLoraMeta() waits for
   all earlier requests, not just the ones it started itself. */
import { Vue as VueNS } from "./vendor/vueflow.bundle.mjs";

const { ref } = VueNS;

export const loraMetaCache = ref({});
let queue = Promise.resolve();

export function triggersOf(name) {
  const list = loraMetaCache.value[String(name || "")];
  return Array.isArray(list) ? list : [];
}

/* Order-preserving, de-duplicated concatenation over LoRA names (or over
   entries with a .name) — the same text the stack card displays. */
export function combinedTriggers(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries || []) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (!name) continue;
    for (const word of triggersOf(name)) {
      const text = String(word || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

/* Fetch any names not yet cached. Safe to call repeatedly and from several
   places at once; failures are left uncached so a later call retries. */
export function ensureLoraMeta(entries, backend) {
  const want = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const name = typeof entry === "string" ? entry : entry?.name;
    const key = String(name || "");
    if (!key || key in loraMetaCache.value || seen.has(key)) continue;
    seen.add(key);
    want.push(key);
  }
  if (!want.length) return Promise.resolve();

  queue = queue.then(async () => {
    /* Earlier jobs in the queue may have filled some of these already. */
    const missing = want.filter((name) => !(name in loraMetaCache.value));
    if (!missing.length) return;
    try {
      const res = await backend?.loraMeta?.(missing);
      const items = (res && res.items) || {};
      const next = { ...loraMetaCache.value };
      for (const name of missing) {
        const list = items[name]?.triggers;
        next[name] = Array.isArray(list)
          ? list.map((word) => String(word || "").trim()).filter(Boolean)
          : [];
      }
      loraMetaCache.value = next;
    } catch (error) {
      /* leave uncached: the next name change / generation retries */
    }
  });
  return queue;
}
