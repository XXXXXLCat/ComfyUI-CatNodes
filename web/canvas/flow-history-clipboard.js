/* Undo/redo history + selection clipboard for the infinite canvas.
   Extracted from infcanvas-flow.js (batch 3). Reactive state, dedupeEdges,
   nextTick and the flow handle are injected so this module owns no globals. */
export function createHistoryClipboard({ state, dedupeEdges, nextTick, getFlow, NS }) {
/* ------------------------------ controller ----------------------------- */

/* Vue Flow's parseNode() copies every node it receives, so dragging updates
   the copy inside its own store while our source array keeps the old
   position -- serialising that array would save the position the node started
   at. Copy the live positions back after a drag and again before saving. */
function syncLivePositions() {
  const api = state.flow;
  if (!api) return;
  for (const src of state.nodes.value) {
    const live = api.findNode?.(src.id);
    const x = live?.position?.x;
    const y = live?.position?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x !== src.position.x || y !== src.position.y) src.position = { x, y };
  }
}

/* -------------------------------- history ------------------------------- */

/* Undo / redo the way ComfyUI's ChangeTracker does it: a stack of graph
   snapshots, coalesced by a debounce so a burst of edits (or a whole drag)
   collapses into one step. The VIEWPORT is deliberately excluded — panning
   and zooming are not edits in ComfyUI either. */
const HISTORY_LIMIT = 60;
/* MERGE_WINDOW: a change that lands shortly after the previous commit is the
   tail of the same gesture (a wire connect is followed by the node's own
   auto-fit size write, typing pauses every few hundred ms), so it EXTENDS the
   step instead of pushing a second one. Without this an undo of "connect"
   would only undo the auto-fit. */
const HISTORY_MERGE_MS = 500;
const history = { past: [], future: [], last: null, lastAt: 0, timer: 0, settle: 0, applying: false };

function historySignature() {
  /* Positions live in Vue Flow's store; pull them back first or an undone
     move would restore the coordinates the node started at. */
  syncLivePositions();
  return JSON.stringify({ nodes: state.nodes.value, edges: state.edges.value, groups: state.groups.value });
}

function historyCommit() {
  if (history.applying) return;
  if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
  let now;
  try { now = historySignature(); } catch (error) { return; }
  if (history.last === null) { history.last = now; history.lastAt = Date.now(); return; }
  if (now === history.last) return;
  const merge = history.lastAt > 0 && Date.now() - history.lastAt < HISTORY_MERGE_MS;
  if (!merge) {
    history.past.push(history.last);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
  }
  history.last = now;
  history.lastAt = Date.now();
  history.future.length = 0;
}

/* Absorb a write that is NOT a user edit (an asset auto-fitting its frame,
   a generation's status flipping to running) by moving the baseline over it
   instead of recording a step — ComfyUI never puts that kind of state into
   the undo stack either. */
function historyAbsorb() {
  if (history.applying || history.last === null) return;
  /* Drop a queued commit: it would carry this derived write into its own
     step, which is exactly the dead undo step we are avoiding. */
  if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
  try { history.last = historySignature(); } catch (error) { return; }
  history.lastAt = 0;
}

function historySchedule() {
  if (history.applying) return;
  if (history.timer) clearTimeout(history.timer);
  history.timer = setTimeout(historyCommit, 350);
}

function historyApply(text) {
  let doc = null;
  try { doc = JSON.parse(text); } catch (error) { return false; }
  history.applying = true;
  state.nodes.value = doc.nodes || [];
  state.edges.value = dedupeEdges(doc.edges || []);
  state.groups.value = Array.isArray(doc.groups) ? doc.groups : [];
  nextTick(() => {
    /* Restoring can drop nodes; re-read the live selection so the edge
       highlight never points at something that no longer exists. */
    state.selectedIds.value = (state.flow?.getSelectedNodes?.value || []).map((n) => n.id);
    NS.api?.markDirty?.();
  });
  /* Node components may write normalised fields while they remount, which is
     not a user edit: absorb those writes by re-baselining instead of pushing
     a step. Otherwise the follow-up commit would wipe the redo stack. */
  if (history.settle) clearTimeout(history.settle);
  history.settle = setTimeout(() => {
    history.settle = 0;
    if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
    try { history.last = historySignature(); } catch (error) { /* optional */ }
    /* The restored state is a step of its own: never merge the next user
       edit into it. */
    history.lastAt = 0;
    history.applying = false;
  }, 400);
  return true;
}

function historyUndo() {
  historyCommit();                       // fold a pending edit into a step
  if (!history.past.length) return false;
  const previous = history.past.pop();
  history.future.push(history.last);
  history.last = previous;
  return historyApply(previous);
}

function historyRedo() {
  historyCommit();
  if (!history.future.length) return false;
  const next = history.future.pop();
  history.past.push(history.last);
  history.last = next;
  return historyApply(next);
}

/* Called whenever a different document is loaded: the new graph is the new
   baseline, so nothing older can be undone into. */
function historyReset() {
  if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
  if (history.settle) { clearTimeout(history.settle); history.settle = 0; }
  history.applying = false;
  history.past = [];
  history.future = [];
  history.last = null;
  nextTick(() => {
    if (history.last !== null) return;
    try { history.last = historySignature(); } catch (error) { /* optional */ }
  });
}

/* -------------------------------- clipboard -------------------------------
   Selection-level copy/paste for nodes, wires and groups. The payload uses
   the same {nodes, edges, groups} shape as the history snapshots, so it
   survives a document switch; the core module also puts it on the system
   clipboard (custom MIME + a tagged text/plain fallback) for other tabs.
   Every id is regenerated on paste and group membership follows the new
   node ids — no reference is ever shared with the source graph. */
const CLIPBOARD_APP = "InfCanvas.Clipboard";
let lastPasteAt = { x: NaN, y: NaN, n: 0 };

/* Strict "what you selected is what you copy": a selected group copies the
   rectangle alone — its member nodes are NOT pulled in unless they are
   themselves selected. Likewise a wire only travels when both endpoints are
   in the selection, so a lone wire is not silently expanded. */
function copySelection() {
  syncLivePositions();
  const wanted = new Set(state.selectedIds.value);
  const groupIds = state.selectedGroupIds.value.slice();
  if (!wanted.size && !groupIds.length) return null;
  const nodes = JSON.parse(JSON.stringify(state.nodes.value)).filter((node) => wanted.has(node.id));
  const edges = JSON.parse(JSON.stringify(state.edges.value))
    .filter((edge) => wanted.has(edge.source) && wanted.has(edge.target));
  const groups = JSON.parse(JSON.stringify(state.groups.value))
    .filter((group) => groupIds.includes(group.id))
    .map((group) => ({ ...group, nodes: (group.nodes || []).filter((id) => wanted.has(id)) }));
  return { app: CLIPBOARD_APP, version: 1, nodes, edges, groups };
}

function pasteGraph(payload, point) {
  if (!payload || payload.app !== CLIPBOARD_APP || !Array.isArray(payload.nodes)) return null;
  syncLivePositions();
  const src = payload.nodes.filter((node) => node && node.id && node.position && node.data);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of src) {
    const x = Number(node.position.x), y = Number(node.position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const size = node.data.size || [160, 30];
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (Number(size[0]) || 160));
    maxY = Math.max(maxY, y + (Number(size[1]) || 30));
  }
  const srcGroups = (Array.isArray(payload.groups) ? payload.groups : [])
    .filter((group) => group && [group.x, group.y, group.w, group.h].every(Number.isFinite));
  for (const group of srcGroups) {
    minX = Math.min(minX, group.x); minY = Math.min(minY, group.y);
    maxX = Math.max(maxX, group.x + group.w); maxY = Math.max(maxY, group.y + group.h);
  }
  /* A group-only copy has no nodes: the rectangle alone is still pasteable. */
  if (!src.length && !srcGroups.length) return null;
  if (!Number.isFinite(minX)) return null;
  /* Same grip as a file/text paste: the TOP-LEFT NODE's top-left corner sits
     30px ABOVE the pointer, its left edge aligned to the pointer's x. The
     rest of the graph keeps its original layout by sharing this delta.
     (This used to centre the whole bounding box on the pointer.) */
  let anchorNode = null;
  for (const node of src) {
    const x = Number(node.position.x), y = Number(node.position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!anchorNode || x < anchorNode.x || (x === anchorNode.x && y < anchorNode.y)) {
      anchorNode = { x, y };
    }
  }
  const anchorX = anchorNode ? anchorNode.x : minX;
  const anchorY = anchorNode ? anchorNode.y : minY;
  const at = point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? point : { x: anchorX, y: anchorY + 30 };
  let dx = at.x - anchorX;
  let dy = (at.y - 30) - anchorY;
  /* Repeated pastes at the same spot stair-step instead of stacking exactly. */
  if (Math.hypot(at.x - lastPasteAt.x, at.y - lastPasteAt.y) < 12) {
    lastPasteAt.n += 1;
    dx += (lastPasteAt.n % 5) * 24;
    dy += (lastPasteAt.n % 5) * 24;
  } else {
    lastPasteAt = { x: at.x, y: at.y, n: 0 };
  }
  const idMap = new Map();
  const newNodes = src.map((node) => {
    const id = "n_" + Math.random().toString(36).slice(2, 10);
    idMap.set(node.id, id);
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = id;
    copy.type = "ic";
    copy.position = { x: node.position.x + dx, y: node.position.y + dy };
    /* A copy is idle: never carry the source node's running/error state over. */
    copy.data.status = "idle";
    copy.data.error = "";
    return copy;
  });
  const newEdges = (Array.isArray(payload.edges) ? payload.edges : [])
    .filter((edge) => edge && idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => ({
      id: "e_" + Math.random().toString(36).slice(2, 10),
      source: idMap.get(edge.source), target: idMap.get(edge.target),
      sourceHandle: edge.sourceHandle || "out",
      targetHandle: edge.targetHandle || "in",
      type: "ic",
    }));
  const newGroups = srcGroups.map((group) => ({
    ...JSON.parse(JSON.stringify(group)),
    id: "grp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    x: group.x + dx, y: group.y + dy,
    nodes: (group.nodes || []).map((id) => idMap.get(id)).filter(Boolean),
  }));
  state.nodes.value = state.nodes.value.concat(newNodes);
  state.edges.value = dedupeEdges(state.edges.value.concat(newEdges));
  state.groups.value = state.groups.value.concat(newGroups);
  nextTick(() => {
    getFlow().selectNodes(newNodes.map((node) => node.id));
    if (newGroups.length) state.selectedGroupIds.value = newGroups.map((group) => group.id);
  });
  historySchedule();
  NS.api?.markDirty?.();
  return { nodes: newNodes.length, edges: newEdges.length, groups: newGroups.length };
}

  return {
    syncLivePositions,
    historySchedule, historyCommit, historyReset, historyUndo, historyRedo,
    historyAbsorb, history,
    copySelection, pasteGraph,
  };
}
