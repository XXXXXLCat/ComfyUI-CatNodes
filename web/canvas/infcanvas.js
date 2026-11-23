/* Extension entry point. Registers menu commands/keybindings and boots the UI. */
import { app } from "../../../scripts/app.js";

// Share the exact same namespace object with the other modules, regardless
// of the order in which ComfyUI loads the files in WEB_DIRECTORY.
const NS = (window.InfCanvas = window.InfCanvas || {});
/* Lazy i18n reference: extension labels are resolved once at registration.
   Internal canvas UI switches live via NS.i18n; host menu text is fixed at
   startup (ComfyUI does not re-render command labels on demand). */
const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

const toggleCanvas = () => (NS.api?.isActive?.() ? NS.api.exit() : NS.api?.enter());

/* "导入到画布": save the CURRENTLY ACTIVE ComfyUI workflow into this plugin's
   workflow library through the same POST /infcanvas/workflows endpoint the
   API-config "api.uploadWorkflow" button uses. The backend converts the UI-format
   graph (nodes + links) to API format and stores it, so it becomes available
   to every canvas workflow selector immediately.

   Getting the active workflow (frontend 1.59.x):
   - graph data: `window.app.rootGraph.serialize()` (schema 0.4 UI format, what
     ComfyUI itself persists). `app.graph` is the legacy alias of rootGraph.
   - name: the pinia `workflow` store's `activeWorkflow.filename` (path + .json
     already stripped). Reached via the Vue root's public $pinia globalProperty;
     `_s` is a pinia internal, so it is feature-detected with a fallback name. */
async function importActiveWorkflowToCanvas() {
  const hostApp = window.app || window.comfyAPI?.app;
  const graph = hostApp?.rootGraph || hostApp?.graph;
  if (!hostApp || !graph || typeof graph.serialize !== "function" ||
      (typeof hostApp.isGraphReady === "function" && !hostApp.isGraphReady())) {
    NS.api?.toast?.("error", t("shortcuts.noWorkflowCurrentlyOpen"));
    return;
  }
  let workflow;
  try {
    /* JSON round-trip detaches from the live graph so the POST body is stable. */
    workflow = JSON.parse(JSON.stringify(graph.serialize()));
  } catch (error) {
    NS.api?.toast?.("error", t("core.failedImportCanvas"), String(error));
    return;
  }
  let name = "Imported Workflow";
  try {
    const vueRoot = document.querySelector("#vue-app")?.__vue_app__;
    const pinia = vueRoot?.config?.globalProperties?.$pinia;
    const active = pinia?._s?.get("workflow")?.activeWorkflow;
    if (active?.filename) name = active.filename;
    else if (active?.key) name = String(active.key).replace(/\.json$/i, "");
  } catch (_) { /* pinia internals unavailable — keep the fallback name */ }

  /* Rename-then-import loop. Both dialogs are host-backed (same ones the
     workflow "panel.rename" action uses): prompt returns null on Cancel AND on the
     top-right X; the 3-button confirm (dirtyClose) returns true = overwrite,
     false = rename again, null = cancel/X. Invalid characters are rejected by
     the backend's _safe_workflow_name with a toast, so no duplicate check here. */
  const prompt = NS.api?.promptDialog;
  const confirm3 = NS.api?.confirmDialog;
  const hasPrompt = typeof prompt === "function";
  const hasConfirm3 = typeof confirm3 === "function";

  /* Existing workflow names, fetched once (best-effort). If the list cannot be
     loaded we skip the duplicate check rather than block the import. */
  let existing = new Set();
  if (hasConfirm3) {
    try {
      const api = window.comfyAPI?.api?.api;
      const res = api?.fetchApi
        ? await api.fetchApi("/infcanvas/workflows")
        : await fetch("/api/infcanvas/workflows");
      if (res && res.ok) {
        const data = await res.json();
        for (const item of (data && data.workflows) || []) {
          const key = item && (item.filename || item.id || item.name);
          if (key) existing.add(String(key));
        }
      }
    } catch (_) { /* list unavailable — skip duplicate check */ }
  }

  if (hasPrompt) {
    for (;;) {
      let answer;
      try {
        answer = await prompt({
          title: t("shortcuts.importToCanvas"),
          message: t("shortcuts.canChangeWorkflowNameBefore"),
          defaultValue: name,
        });
      } catch (_) { answer = null; }
      if (answer === null || answer === undefined) return;  // Cancel or X → abort
      const renamed = String(answer).trim();
      if (renamed) name = renamed;

      /* Duplicate name → ask overwrite vs rename vs cancel. If the 3-button
         dialog is unavailable, fall back to overwrite (previous behaviour). */
      if (existing.has(name) && hasConfirm3) {
        let choice;
        try {
          choice = await confirm3({
            key: "infcanvas-import-dup",
            threeWay: true,
            title: t("shortcuts.workflowAlreadyExists"),
            message: t("shortcuts.workflowNamedAlreadyExists", { name }),
            hint: t("shortcuts.overwriteOrRenameHint"),
            itemList: [name],
            denyLabel: t("shortcuts.changeName"),
            confirmLabel: t("shortcuts.overwriteExisting"),
          });
        } catch (_) { choice = true; }
        if (choice === null || choice === undefined) return;  // middle Cancel or X → abort
        if (choice === true) break;   // overwrite → POST with this name
        // false → "修改名称" → loop back to the rename prompt
        continue;
      }
      break;  // unique name (or no confirm available) → POST
    }
  }  // prompt unavailable → import directly with the detected name

  try {
    const api = window.comfyAPI?.api?.api;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, workflow }),
    };
    const response = api?.fetchApi
      ? await api.fetchApi("/infcanvas/workflows", options)
      : await fetch("/api/infcanvas/workflows", options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) throw new Error((data && data.error) || t("api.requestFailed", { status: response.status }));
    if (data === null) throw new Error(t("api.noApiResponsePleaseFully"));
    NS.api?.toast?.("success", t("core.canvasImported"), data.name || name);
    /* Import = fresh overwrite: re-detect and persist the just-imported
       workflow's parameters. This is the only automatic parameter write (the
       user's rule: only import + explicit save may touch files). Scoped to this
       one workflow; the API-config panel need not be open. */
    try { NS.apiConfig?.resetFieldsForImport?.(data.name || name); } catch (_) { /* optional module */ }
    /* Refresh every canvas workflow selector / node list that mirrors this
       library (same event the API-config upload button fires). */
    try { window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed")); } catch (_) { /* no-op */ }
  } catch (error) {
    NS.api?.toast?.("error", t("core.failedImportCanvas"), String(error?.message || error));
  }
}

/* Expose to the monitor bar's persistent "导入到画布" button (web/monitor.js)
   so both entry points share the exact same upload implementation. */
NS.importActiveWorkflow = importActiveWorkflowToCanvas;

app.registerExtension({
  name: "InfCanvas.EmbeddedCanvas",

  commands: [
    {
      id: "InfCanvas.Open",
      /* Function-form getter: the host re-evaluates `command.label` on each
         read (shortcuts panel, selection toolbox), so it follows live i18n.
         The View menu snapshots menubarLabel once at registration, which is a
         host limitation shared by all commands — see the menu patch in setup. */
      label: () => t("shortcuts.toggleCanvas"),
      /* Function-form tooltip: ComfyCommandImpl re-evaluates `tooltip` on each
         read, so the View-menu bubble follows live i18n. Missing in the original
         registration, which left all View-menu canvas items without a tooltip. */
      tooltip: () => t("menu.tooltip.openCanvas"),
      icon: "pi pi-th-large",
      function: toggleCanvas,
    },
    {
      id: "InfCanvas.Save",
      label: () => t("sidebar.saveCurrentCanvas"),
      tooltip: () => t("menu.tooltip.saveCanvas"),
      icon: "pi pi-save",
      function: () => NS.api?.saveActive(false),
    },
    {
      id: "InfCanvas.CloseTab",
      label: () => t("sidebar.closeCurrentCanvasTab"),
      tooltip: () => t("menu.tooltip.closeCanvasTab"),
      icon: "pi pi-times",
      function: () => {
        const id = NS.api?.activeId?.();
        if (id) NS.api.closeDoc(id);
      },
    },
    {
      id: "InfCanvas.ImportWorkflow",
      label: () => t("shortcuts.importToCanvas"),
      tooltip: () => t("menu.tooltip.importWorkflow"),
      icon: "pi pi-upload",
      function: importActiveWorkflowToCanvas,
    },
  ],

  menuCommands: [
    { path: ["View"], commands: ["InfCanvas.Open", "InfCanvas.Save", "InfCanvas.CloseTab"] },
  ],

  keybindings: [
    { commandId: "InfCanvas.Open", combo: { key: "i", ctrl: true, shift: true } },
  ],

  /* Autosave / preview-text settings now live in the canvas' own settings panel
     (sidebar 设置 → infcanvas-settings.js); no longer ComfyUI native settings. */
  settings: [],

  async setup() {
    /* The host snapshots menubar labels AND tooltips to plain strings at
       registration and never re-renders them on locale change (true of its own
       commands too). Repatch our View-menu items to function-form label/tooltip
       so each menu render re-reads live i18n via toValue(). Internal pinia
       shape — guarded. Both fields need the same patch: a function-form command
       tooltip is already flattened to a string by commandIdToMenuItem(). */
    try {
      const vueApp = document.querySelector("#vue-app")?.__vue_app__;
      const pinia = vueApp?.config?.globalProperties?.$pinia;
      const items = pinia?._s?.get("menuItem")?.menuItems;
      if (Array.isArray(items)) {
        const keyOf = {
          "InfCanvas.Open": "shortcuts.toggleCanvas",
          "InfCanvas.Save": "sidebar.saveCurrentCanvas",
          "InfCanvas.CloseTab": "sidebar.closeCurrentCanvasTab",
        };
        const tipKeyOf = {
          "InfCanvas.Open": "menu.tooltip.openCanvas",
          "InfCanvas.Save": "menu.tooltip.saveCanvas",
          "InfCanvas.CloseTab": "menu.tooltip.closeCanvasTab",
        };
        const walk = (arr) => {
          for (const it of arr || []) {
            if (it && keyOf[it.commandId]) {
              const key = keyOf[it.commandId];
              it.label = () => t(key);
            }
            if (it && tipKeyOf[it.commandId]) {
              const key = tipKeyOf[it.commandId];
              it.tooltip = () => t(key);
            }
            if (it && Array.isArray(it.items)) walk(it.items);
          }
        };
        walk(items);
      }
    } catch (_) { /* internal store unavailable — keep the host snapshot */ }

    // ComfyUI imports all extension JS files in parallel / with a late-loading
    // deadline, so core/ui/style may arrive after this module. Keep the app
    // reference around; core.js calls init() itself once everything is ready.
    NS.pendingApp = app;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (NS.ready) return;
      if (NS.api?.init && NS.ui?.injectStyles && NS.css) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!NS.api?.init || !NS.ui?.injectStyles || !NS.css) {
      console.warn("[InfCanvas] core modules not ready yet; waiting for their on-load init");
      return;
    }
    NS.api.init(app);
  },
});
