/* Built-in workflow manager view, embedded in the canvas Settings dialog.
 *
 * Rendered as a dedicated navigation group inside infcanvas-settings.js — it is
 * NOT a standalone dialog and has no sidebar button. Lists the shipped
 * (read-only) workflows with per-user visibility toggles, a per-category default
 * control and the model files each workflow references (filename + expected
 * ComfyUI folder + empty URL).
 *
 * The list is intentionally self-drawn: ComfyUI's native settings panel only
 * renders single-value controls (switch/number/combo) and has no composite
 * grouped-list view. Every class below is a host utility class or official
 * token — no custom colours. All copy goes through NS.i18n; no inline language
 * pairs. Data comes from /api/infcanvas/builtins/manage; visibility changes and
 * default pins call the backend, then dispatch infcanvas:workflows-changed so
 * the generate-node selectors refresh.
 */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  const bindTip = (node, text, side) => {
    if (!node) return node;
    if (NS.tip?.bindTip) return NS.tip.bindTip(node, text, side);
    return node;
  };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const BTN = "relative inline-flex cursor-pointer touch-manipulation appearance-none "
    + "items-center justify-center gap-2 border-none font-inter font-medium "
    + "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring "
    + "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
  /* Switch markup: verbatim from infcanvas-settings.js (ui/switch/Switch.vue). */
  const SWITCH_BTN = "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation "
    + "items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none "
    + "transition-shadow focus-visible:ring-1 focus-visible:ring-ring";
  const SWITCH_TRACK = "pointer-events-none inline-flex h-5 w-9 items-center rounded-full "
    + "border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary";
  const SWITCH_KNOB = "pointer-events-none block size-4 rounded-full bg-background shadow-sm "
    + "transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0";

  async function api(path, options) {
    const call = NS.backend?.call;
    if (typeof call === "function") return call(path, options);
    const response = await fetch("/api/infcanvas" + path, options);
    return response.json();
  }
  const jsonOptions = (method, body) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let mountHost = null;
  let items = [];
  let categories = [];
  let pending = false;

  function notifyError(message) {
    NS.api?.toast?.("error", message);
  }
  function changed() {
    try { window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed")); } catch (_) { /* no-op */ }
  }

  function makeSwitch(on, onToggle) {
    const btn = el("button", SWITCH_BTN);
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.dataset.state = on ? "checked" : "unchecked";
    const track = el("span", SWITCH_TRACK);
    const knob = el("span", SWITCH_KNOB);
    knob.dataset.state = btn.dataset.state;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (pending || btn.disabled) return;
      onToggle(btn.dataset.state !== "checked", btn, knob);
    });
    track.appendChild(knob);
    btn.appendChild(track);
    return btn;
  }

  function categoryLabel(category) {
    return (NS.i18n?.cat ? NS.i18n.cat(category) : null) || category;
  }

  function renderList() {
    const host = mountHost?.querySelector?.("[data-builtin-mgr-list]");
    if (!host) return;
    host.replaceChildren();
    const grouped = new Map();
    for (const item of items) {
      const key = item.category || "";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    if (!items.length) {
      host.appendChild(el("p", "py-8 text-center text-sm text-muted-foreground", t("builtinMgr.none")));
      return;
    }
    for (const [category, group] of grouped) {
      const section = el("section", "mb-6");
      const head = el("h4", "mb-2 text-sm font-bold text-foreground",
        category ? categoryLabel(category) : t("builtinMgr.uncategorized"));
      section.appendChild(head);
      for (const item of group) {
        section.appendChild(renderRow(item));
      }
      host.appendChild(section);
    }
  }

  function renderRow(item) {
    const row = el("div", "mb-2 rounded-lg border bg-card p-4");
    /* Header: display name + default pill + visibility switch. */
    const head = el("div", "flex items-center gap-2");
    const name = el("span", "min-w-0 flex-1 truncate text-sm text-foreground", item.name);
    head.appendChild(name);
    if (item.is_default) {
      const pill = el("span", "shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-foreground",
        t("builtinMgr.default"));
      head.appendChild(pill);
    }
    /* The last usable workflow of a category cannot be hidden. Compute the
       category's available count from the current list, mirroring the backend
       guard; disable the switch when this item is the only one left. */
    const availableInCategory = items.filter((w) =>
      (w.category || "") === (item.category || "") && !w.hidden && !w.shadowed).length;
    const lockHide = !item.hidden && availableInCategory <= 1;
    const sw = makeSwitch(!item.hidden, async (show, btn, knob) => {
      if (show === !item.hidden) return;
      pending = true;
      btn.disabled = true;
      try {
        const data = await api("/builtins/" + encodeURIComponent(item.id) + "/visibility",
          jsonOptions("POST", { hidden: !show }));
        applyData(data);
        changed();
      } catch (error) {
        notifyError(error?.message || t("builtinMgr.saveFailed"));
        btn.dataset.state = show ? "checked" : "unchecked";
        knob.dataset.state = btn.dataset.state;
      } finally {
        pending = false;
      }
    });
    sw.setAttribute("aria-label", t("builtinMgr.toggleVisible", { name: item.name }));
    bindTip(sw, () => t(lockHide ? "builtinMgr.lastOne" : "builtinMgr.toggleVisible", { name: item.name }), "top");
    if (lockHide) {
      sw.disabled = true;
      sw.classList.add("cursor-not-allowed", "opacity-50");
    }
    head.appendChild(sw);
    row.appendChild(head);

    /* Default control: a radio-like button, one default per category. */
    const defaultBar = el("div", "mt-3 flex items-center gap-2");
    if (item.is_default) {
      const marker = el("i", "icon-[lucide--check] size-4 text-primary");
      defaultBar.appendChild(marker);
      defaultBar.appendChild(el("span", "text-xs text-muted-foreground", t("builtinMgr.currentDefault")));
    } else if (!item.hidden) {
      const btn = el("button", BTN + " h-8 rounded-lg bg-secondary px-3 py-1 text-xs text-foreground hover:bg-accent",
        t("builtinMgr.setDefault"));
      btn.type = "button";
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (pending) return;
        pending = true;
        try {
          await api("/workflows/" + encodeURIComponent(item.id) + "/default", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
          });
          /* The /default endpoint returns the workflow list, not manage data;
             reload the manage view to refresh the default flags. */
          await reload();
          changed();
        } catch (error) {
          notifyError(error?.message || t("builtinMgr.saveFailed"));
        } finally {
          pending = false;
        }
      });
      defaultBar.appendChild(btn);
    }
    row.appendChild(defaultBar);

    /* Model manifest: filename + expected folder + empty URL placeholder. */
    if (item.models?.length) {
      const modelBox = el("div", "mt-3 border-t pt-3");
      modelBox.appendChild(el("div", "mb-1 text-xs font-bold text-muted-foreground", t("builtinMgr.models")));
      for (const model of item.models) {
        const line = el("div", "flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs text-foreground");
        line.appendChild(el("span", "font-mono", model.name));
        line.appendChild(el("span", "text-muted-foreground",
          "models/" + (model.folder || "other") + "/"));
        if (model.url) {
          const link = el("a", "text-primary underline", t("builtinMgr.download"));
          link.href = model.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          line.appendChild(link);
        } else {
          line.appendChild(el("span", "text-muted-foreground", t("builtinMgr.noUrl")));
        }
        modelBox.appendChild(line);
      }
      row.appendChild(modelBox);
    }
    return row;
  }

  function applyData(data) {
    if (!data) return;
    if (Array.isArray(data.workflows)) items = data.workflows;
    if (Array.isArray(data.categories)) categories = data.categories;
    renderList();
  }

  async function reload() {
    applyData(await api("/builtins/manage"));
  }

  /* Called by the Settings dialog when its "built-in workflows" nav group is
     shown. Builds the view inside the given host; no overlay, no own close. */
  function mount(host) {
    if (!host) return;
    mountHost = host;
    host.setAttribute("data-testid", "builtin-manager-view");
    host.replaceChildren();
    const title = el("h3", "text-base", t("builtinMgr.title"));
    title.style.marginBottom = "calc(var(--spacing, 4px) * 2)";
    const hint = el("p", "mb-6 text-xs text-muted-foreground", t("builtinMgr.hint"));
    const list = el("div", "w-full");
    list.setAttribute("data-builtin-mgr-list", "");
    host.append(title, hint, list);
    reload().catch((error) => notifyError(error?.message || t("builtinMgr.loadFailed")));
  }

  function unmount() {
    mountHost = null;
  }

  function repaintLocale() {
    if (!mountHost) return;
    mount(mountHost);
  }

  NS.builtinMgr = {
    mount, unmount, repaintLocale,
    isMounted: () => !!mountHost,
  };
})();
