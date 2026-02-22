import { applyMoveAction, packMoveAction, renderFrameBuffer, readObservation } from "../../bindings-ts/src/mvp-movement.js";
import {
  AFFINITY_KINDS,
  TRAP_VITAL_KEYS,
  VITAL_KEYS,
} from "../../runtime/src/contracts/domain-constants.js";

const EVENT_STREAM_LIMIT = 6;
const DEFAULT_VIEWPORT_SIZE = 50;
const DEFAULT_VISION_RADIUS = 6;
const VISIBILITY_MODE_SIMULATION_FULL = "simulation_full";
const VISIBILITY_MODE_GAMEPLAY_FOG = "gameplay_fog";
const KNOWN_VISIBILITY_MODES = new Set([
  VISIBILITY_MODE_SIMULATION_FULL,
  VISIBILITY_MODE_GAMEPLAY_FOG,
]);
const FOG_TILE_CHAR = "?";
const ASCII_ACTOR_SYMBOLS = [
  "@",
  "A",
  "C",
  "D",
  "F",
  "G",
  "H",
  "J",
  "K",
  "L",
  "M",
  "N",
  "P",
  "Q",
  "R",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "a",
  "c",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "m",
  "n",
  "p",
  "q",
  "r",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "+",
  "*",
  "%",
  "$",
  "&",
  "?",
  "!",
];
const AFFINITY_HUE_OVERRIDES = Object.freeze({
  fire: 12,
  water: 206,
  earth: 80,
  wind: 175,
  life: 140,
  decay: 280,
  corrode: 45,
  dark: 230,
});
const AFFINITY_HUES = Object.freeze(
  AFFINITY_KINDS.reduce((acc, kind, index) => {
    acc[kind] = AFFINITY_HUE_OVERRIDES[kind] ?? (index * 41) % 360;
    return acc;
  }, {}),
);
const STACK_STYLES = [
  { sat: 55, light: 55, glow: 0 },
  { sat: 65, light: 50, glow: 4 },
  { sat: 75, light: 45, glow: 6 },
  { sat: 85, light: 40, glow: 8 },
];

function escapeHtmlChar(char) {
  if (char === "&") return "&amp;";
  if (char === "<") return "&lt;";
  if (char === ">") return "&gt;";
  if (char === "\"") return "&quot;";
  if (char === "'") return "&#39;";
  return char;
}

function escapeHtml(value) {
  return String(value).split("").map(escapeHtmlChar).join("");
}

function normalizeStacks(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.max(1, Math.round(num));
}

function resolveAffinityFromTraits(traits) {
  const affinityStacks = traits?.affinities;
  if (!affinityStacks || typeof affinityStacks !== "object" || Array.isArray(affinityStacks)) {
    return null;
  }
  const entries = Object.entries(affinityStacks)
    .map(([key, stacks]) => ({
      kind: String(key).split(":")[0],
      stacks: normalizeStacks(stacks),
    }))
    .filter((entry) => entry.kind);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.stacks - a.stacks);
  return entries[0];
}

function resolveAffinityFromId(actorId) {
  if (!actorId) return null;
  const lowered = String(actorId).toLowerCase();
  return Object.keys(AFFINITY_HUES).find((key) => lowered.includes(`_${key}_`)) || null;
}

function resolveAffinityInfo(actor) {
  const fromTraits = resolveAffinityFromTraits(actor?.traits);
  if (fromTraits) return fromTraits;
  if (Array.isArray(actor?.affinities) && actor.affinities.length > 0) {
    const entries = actor.affinities.map((entry) => ({
      kind: entry?.kind,
      stacks: normalizeStacks(entry?.stacks),
    })).filter((entry) => entry.kind);
    if (entries.length > 0) {
      entries.sort((a, b) => b.stacks - a.stacks);
      return entries[0];
    }
  }
  if (typeof actor?.affinity === "string" && actor.affinity.trim()) {
    return { kind: actor.affinity.trim(), stacks: 1 };
  }
  const fromId = resolveAffinityFromId(actor?.id);
  if (fromId) {
    return { kind: fromId, stacks: 1 };
  }
  return null;
}

function resolveStackStyle(stacks) {
  const normalized = normalizeStacks(stacks);
  const index = Math.min(STACK_STYLES.length - 1, normalized - 1);
  return { ...STACK_STYLES[index], stacks: normalized };
}

function buildActorSymbolMap(actors = [], symbols, fallbackSymbols) {
  const ids = actors.map((actor) => String(actor?.id || "")).sort();
  const map = new Map();
  ids.forEach((id, index) => {
    const primary = symbols && symbols.length ? (index < symbols.length ? symbols[index] : null) : null;
    const fallback = fallbackSymbols?.[index % fallbackSymbols.length];
    map.set(id, primary || fallback || "@");
  });
  return map;
}

function buildActorOverlay(baseTiles, actors = []) {
  if (!Array.isArray(baseTiles) || baseTiles.length === 0) {
    return { text: "", html: "" };
  }
  const sortedActors = actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  const textGrid = baseTiles.map((row) => String(row).split(""));
  const htmlGrid = baseTiles.map((row) => String(row).split("").map(escapeHtmlChar));
  const asciiSymbols = buildActorSymbolMap(sortedActors, ASCII_ACTOR_SYMBOLS, ASCII_ACTOR_SYMBOLS);

  sortedActors.forEach((actor) => {
    const position = actor?.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const rowText = textGrid[position.y];
    const rowHtml = htmlGrid[position.y];
    if (!rowText || !rowHtml || position.x < 0 || position.x >= rowText.length) return;
    const actorId = String(actor?.id || "");
    const asciiSymbol = asciiSymbols.get(actorId) || "@";
    textGrid[position.y][position.x] = asciiSymbol;

    const affinityInfo = resolveAffinityInfo(actor);
    const hue = affinityInfo?.kind ? AFFINITY_HUES[affinityInfo.kind] : null;
    const safeActorId = escapeHtml(actorId);
    const actorAttr = ` data-actor-id="${safeActorId}"`;
    let style = "";
    let dataAttr = "";
    if (hue !== undefined && hue !== null) {
      const stackStyle = resolveStackStyle(affinityInfo.stacks);
      style = `--actor-hue:${hue};--actor-sat:${stackStyle.sat}%;--actor-light:${stackStyle.light}%;--actor-glow:${stackStyle.glow}px;`;
      dataAttr = ` data-affinity="${escapeHtml(affinityInfo.kind)}" data-stacks="${stackStyle.stacks}"`;
    }
    const styleAttr = style ? ` style="${style}"` : "";
    rowHtml[position.x] = `<span class="actor-cell"${actorAttr}${dataAttr}${styleAttr}>${escapeHtmlChar(asciiSymbol)}</span>`;
  });

  return {
    text: textGrid.map((row) => row.join("")).join("\n"),
    html: htmlGrid.map((row) => row.join("")).join("\n"),
  };
}

function kindLabel(kind) {
  if (kind === 0) return "stationary";
  if (kind === 1) return "barrier";
  if (kind === 2) return "motivated";
  return `kind:${kind}`;
}

function formatVitals(vitals = {}) {
  return VITAL_KEYS
    .map((key) => {
      const record = vitals[key] || { current: 0, max: 0, regen: 0 };
      return `${key[0].toUpperCase()}:${record.current}/${record.max}+${record.regen}`;
    })
    .join(" ");
}

function formatTrapVitals(vitals = {}) {
  return TRAP_VITAL_KEYS
    .map((key) => {
      const record = vitals[key] || { current: 0, max: 0, regen: 0 };
      return `${key}:${record.current}/${record.max}+${record.regen}`;
    })
    .join(" ");
}

function formatEventEntry(action, index) {
  if (!action) return null;
  const tick = Number.isFinite(action.tick) ? action.tick : "?";
  const actorId = action.actorId || "actor";
  const kind = action.kind || "event";
  if (kind === "move") {
    const from = action.params?.from;
    const to = action.params?.to;
    const direction = action.params?.direction ? ` ${action.params.direction}` : "";
    if (from && to) {
      return `${index + 1}. t${tick} ${actorId} move${direction} (${from.x},${from.y}) -> (${to.x},${to.y})`;
    }
  }
  return `${index + 1}. t${tick} ${actorId} ${kind}`;
}

function findExit(baseTiles) {
  if (!Array.isArray(baseTiles)) return null;
  for (let y = 0; y < baseTiles.length; y += 1) {
    const row = baseTiles[y];
    if (typeof row !== "string") continue;
    const x = row.indexOf("E");
    if (x !== -1) return { x, y };
  }
  return null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
}

function normalizeVisibilityMode(mode) {
  return KNOWN_VISIBILITY_MODES.has(mode) ? mode : VISIBILITY_MODE_SIMULATION_FULL;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function keyForCell(x, y) {
  return `${x},${y}`;
}

function resolveBaseDimensions(baseTiles = []) {
  const height = Array.isArray(baseTiles) ? baseTiles.length : 0;
  const width = Array.isArray(baseTiles)
    ? baseTiles.reduce((max, row) => Math.max(max, String(row || "").length), 0)
    : 0;
  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
    totalTiles: Math.max(0, width * height),
  };
}

function collectVisionForActor({ baseTiles = [], actor = null, radius = DEFAULT_VISION_RADIUS } = {}) {
  if (!actor?.position) return new Set();
  const { width, height } = resolveBaseDimensions(baseTiles);
  if (width <= 0 || height <= 0) return new Set();
  const centerX = Number.isFinite(actor.position.x) ? actor.position.x : 0;
  const centerY = Number.isFinite(actor.position.y) ? actor.position.y : 0;
  const normalizedRadius = Math.max(1, parsePositiveInt(radius, DEFAULT_VISION_RADIUS));
  const cells = new Set();
  for (let y = centerY - normalizedRadius; y <= centerY + normalizedRadius; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = centerX - normalizedRadius; x <= centerX + normalizedRadius; x += 1) {
      if (x < 0 || x >= width) continue;
      const distance = Math.abs(centerX - x) + Math.abs(centerY - y);
      if (distance <= normalizedRadius) {
        cells.add(keyForCell(x, y));
      }
    }
  }
  return cells;
}

function fogTilesByExploration(baseTiles = [], exploredCells = new Set()) {
  if (!Array.isArray(baseTiles) || baseTiles.length === 0) return [];
  return baseTiles.map((rowText, y) => {
    const row = String(rowText || "");
    let output = "";
    for (let x = 0; x < row.length; x += 1) {
      output += exploredCells.has(keyForCell(x, y)) ? row[x] : FOG_TILE_CHAR;
    }
    return output;
  });
}

function resolveViewportWindow({
  width,
  height,
  center = null,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
} = {}) {
  const normalizedWidth = Math.max(0, Number(width) || 0);
  const normalizedHeight = Math.max(0, Number(height) || 0);
  const targetSize = Math.max(1, parsePositiveInt(viewportSize, DEFAULT_VIEWPORT_SIZE));
  const viewportWidth = Math.min(targetSize, normalizedWidth || targetSize);
  const viewportHeight = Math.min(targetSize, normalizedHeight || targetSize);
  const centerX = Number.isFinite(center?.x) ? center.x : Math.floor(normalizedWidth / 2);
  const centerY = Number.isFinite(center?.y) ? center.y : Math.floor(normalizedHeight / 2);
  const maxStartX = Math.max(0, normalizedWidth - viewportWidth);
  const maxStartY = Math.max(0, normalizedHeight - viewportHeight);
  const startX = clamp(Math.floor(centerX - viewportWidth / 2), 0, maxStartX);
  const startY = clamp(Math.floor(centerY - viewportHeight / 2), 0, maxStartY);
  return {
    startX,
    startY,
    width: viewportWidth,
    height: viewportHeight,
    endX: startX + viewportWidth,
    endY: startY + viewportHeight,
  };
}

function cropTilesToViewport(baseTiles = [], viewport = null) {
  if (!Array.isArray(baseTiles) || baseTiles.length === 0 || !viewport) return [];
  const rows = [];
  for (let y = viewport.startY; y < viewport.endY; y += 1) {
    const row = String(baseTiles[y] || "");
    rows.push(row.slice(viewport.startX, viewport.endX));
  }
  return rows;
}

function projectActorsForViewport(
  actors = [],
  { viewport = null, visibilityMask = null } = {},
) {
  if (!Array.isArray(actors) || !viewport) return [];
  return actors
    .filter((actor) => {
      const x = actor?.position?.x;
      const y = actor?.position?.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (x < viewport.startX || x >= viewport.endX) return false;
      if (y < viewport.startY || y >= viewport.endY) return false;
      if (visibilityMask && !visibilityMask.has(keyForCell(x, y))) return false;
      return true;
    })
    .map((actor) => ({
      ...actor,
      position: {
        x: actor.position.x - viewport.startX,
        y: actor.position.y - viewport.startY,
      },
    }));
}

export function formatAffinities(affinities = []) {
  if (!Array.isArray(affinities) || affinities.length === 0) {
    return "No affinities equipped";
  }
  return affinities.map((affinity) => {
    const kind = affinity?.kind || "unknown";
    const expression = affinity?.expression || "unknown";
    const stacks = Number.isFinite(affinity?.stacks) ? affinity.stacks : 1;
    const note = kind === "dark" ? " (reduces visibility)" : "";
    return `${kind}:${expression} x${stacks}${note}`;
  }).join(", ");
}

export function formatAbilities(abilities = []) {
  if (!Array.isArray(abilities) || abilities.length === 0) {
    return "No abilities";
  }
  return abilities.map((ability) => {
    const id = ability?.id || "ability";
    const kind = ability?.kind || "unknown";
    const affinityKind = ability?.affinityKind || "unknown";
    const expression = ability?.expression || "unknown";
    const potency = Number.isFinite(ability?.potency) ? ability.potency : 0;
    const manaCost = Number.isFinite(ability?.manaCost) ? ability.manaCost : 0;
    return `${id} (${kind}, ${affinityKind}/${expression}, pot ${potency}, mana ${manaCost})`;
  }).join("; ");
}

export function renderActorSummary(entry) {
  const base = `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`;
  return `${base}\n  affinities: ${formatAffinities(entry.affinities)}\n  abilities: ${formatAbilities(entry.abilities)}`;
}

export function renderActorInspectSummary(entry) {
  return `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`;
}

export function renderTrapSummary(trap) {
  const position = trap?.position || { x: 0, y: 0 };
  const vitals = formatTrapVitals(trap?.vitals || {});
  const affinities = formatAffinities(trap?.affinities || []);
  const abilities = formatAbilities(trap?.abilities || []);
  return `trap @(${position.x},${position.y}) ${vitals}\n  affinities: ${affinities}\n  abilities: ${abilities}`;
}

export function setupPlayback({
  core,
  actions,
  actorIdLabel = "actor_mvp",
  actorIdValue = 1,
  intervalMs = 500,
  elements,
  affinityEffects,
  initCore,
  visibility = {},
  onObservation,
}) {
  let currentIndex = 0;
  let playing = false;
  let timer = null;
  let visibilityMode = normalizeVisibilityMode(visibility?.mode);
  let viewportSize = parsePositiveInt(visibility?.viewportSize, DEFAULT_VIEWPORT_SIZE);
  let visionRadius = parsePositiveInt(visibility?.visionRadius, DEFAULT_VISION_RADIUS);
  let viewerActorId = typeof visibility?.viewerActorId === "string" ? visibility.viewerActorId : actorIdLabel;
  const exploredByActor = new Map();
  const visibleNowByActor = new Map();
  let latestVisibilitySummary = {
    mode: visibilityMode,
    viewerActorId: viewerActorId || null,
    map: { width: 0, height: 0, totalTiles: 0 },
    viewport: { startX: 0, startY: 0, width: 0, height: 0, endX: 0, endY: 0 },
    actorStats: [],
    viewer: null,
  };

  function clearVisibilityTracking() {
    exploredByActor.clear();
    visibleNowByActor.clear();
  }

  function ensureExploredSet(actorId) {
    const normalized = String(actorId || "");
    if (!normalized) return new Set();
    if (!exploredByActor.has(normalized)) {
      exploredByActor.set(normalized, new Set());
    }
    return exploredByActor.get(normalized);
  }

  function sortedActors(actors = []) {
    if (!Array.isArray(actors)) return [];
    return actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  }

  function toPercent(part, total) {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
    return Number(((part / total) * 100).toFixed(2));
  }

  function recordVisibilitySnapshot(frame, obs) {
    const baseTiles = Array.isArray(frame?.baseTiles) ? frame.baseTiles : [];
    const actors = sortedActors(obs?.actors || []);
    const map = resolveBaseDimensions(baseTiles);

    visibleNowByActor.clear();
    actors.forEach((actor) => {
      const actorId = String(actor?.id || "");
      if (!actorId || !actor?.position) return;
      const currentVision = collectVisionForActor({
        baseTiles,
        actor,
        radius: visionRadius,
      });
      visibleNowByActor.set(actorId, currentVision);
      const explored = ensureExploredSet(actorId);
      currentVision.forEach((cellKey) => explored.add(cellKey));
    });

    if (!viewerActorId && actors.length > 0) {
      viewerActorId = String(actors[0]?.id || "");
    }

    const actorStats = actors.map((actor) => {
      const actorId = String(actor?.id || "");
      const explored = exploredByActor.get(actorId) || new Set();
      const visibleNow = visibleNowByActor.get(actorId) || new Set();
      return {
        id: actorId,
        exploredTiles: explored.size,
        visibleNowTiles: visibleNow.size,
        exploredPercent: toPercent(explored.size, map.totalTiles),
      };
    });

    return {
      actors,
      map,
      actorStats,
    };
  }

  function resolveViewerActor(actors = []) {
    const normalizedViewer = String(viewerActorId || "");
    if (normalizedViewer) {
      const match = actors.find((actor) => String(actor?.id || "") === normalizedViewer);
      if (match) return match;
    }
    const primary = actors.find((actor) => String(actor?.id || "") === String(actorIdLabel || ""));
    if (primary) {
      viewerActorId = String(primary.id || "");
      return primary;
    }
    if (actors.length > 0) {
      viewerActorId = String(actors[0]?.id || "");
      return actors[0];
    }
    return null;
  }

  function cloneVisibilitySummary(summary = null) {
    if (!summary || typeof summary !== "object") return null;
    return {
      ...summary,
      map: summary.map ? { ...summary.map } : { width: 0, height: 0, totalTiles: 0 },
      viewport: summary.viewport ? { ...summary.viewport } : null,
      viewer: summary.viewer ? { ...summary.viewer } : null,
      actorStats: Array.isArray(summary.actorStats)
        ? summary.actorStats.map((entry) => ({ ...entry }))
        : [],
    };
  }

  function readSnapshot() {
    const frame = renderFrameBuffer(core, { actorIdLabel });
    const obs = readObservation(core, { actorIdLabel, affinityEffects });
    const visibilityData = recordVisibilitySnapshot(frame, obs);
    return { frame, obs, visibilityData };
  }

  function renderFromSnapshot({ frame, obs, visibilityData }) {
    const baseTiles = Array.isArray(frame?.baseTiles) ? frame.baseTiles : [];
    const map = visibilityData?.map || resolveBaseDimensions(baseTiles);
    const allActors = visibilityData?.actors || sortedActors(obs?.actors || []);
    const viewerActor = resolveViewerActor(allActors);
    const viewerKey = viewerActor ? String(viewerActor.id || "") : "";
    const viewerExplored = viewerKey ? (exploredByActor.get(viewerKey) || new Set()) : new Set();
    const viewerVisibleNow = viewerKey ? (visibleNowByActor.get(viewerKey) || new Set()) : new Set();

    let renderTiles = baseTiles;
    let renderActors = allActors;
    let actorListEntries = allActors;
    let viewport = resolveViewportWindow({
      width: map.width,
      height: map.height,
      center: viewerActor?.position || null,
      viewportSize: Math.max(map.width, map.height, 1),
    });

    if (visibilityMode === VISIBILITY_MODE_GAMEPLAY_FOG) {
      const fogged = fogTilesByExploration(baseTiles, viewerExplored);
      viewport = resolveViewportWindow({
        width: map.width,
        height: map.height,
        center: viewerActor?.position || null,
        viewportSize,
      });
      renderTiles = cropTilesToViewport(fogged, viewport);
      renderActors = projectActorsForViewport(allActors, {
        viewport,
        visibilityMask: viewerExplored,
      });
      actorListEntries = allActors.filter((actor) => {
        const x = actor?.position?.x;
        const y = actor?.position?.y;
        return Number.isFinite(x) && Number.isFinite(y) && viewerExplored.has(keyForCell(x, y));
      });
    }

    const overlay = buildActorOverlay(renderTiles, renderActors);
    if (elements.frame) {
      if ("innerHTML" in elements.frame) {
        elements.frame.innerHTML = overlay.html || overlay.text;
      } else {
        elements.frame.textContent = overlay.text;
      }
    }
    if (elements.baseTiles) elements.baseTiles.textContent = renderTiles.join("\n");
    if (elements.actorId) elements.actorId.textContent = actorIdLabel;
    if (elements.actorPos) elements.actorPos.textContent = `(${obs.actor.x}, ${obs.actor.y})`;
    if (elements.actorHp) elements.actorHp.textContent = `${obs.actor.hp}/${obs.actor.maxHp}`;
    if (elements.tick) elements.tick.textContent = String(frame.tick);
    if (elements.status) {
      const exit = findExit(baseTiles);
      const atExit = exit && obs.actor.x === exit.x && obs.actor.y === exit.y;
      elements.status.textContent = atExit ? "Reached exit" : currentIndex >= actions.length ? "Out of actions" : "Ready";
    }
    if (elements.playButton) {
      elements.playButton.textContent = playing ? "Pause" : "Play";
      elements.playButton.disabled = currentIndex >= actions.length && !playing;
    }
    if (elements.stepBack) elements.stepBack.disabled = currentIndex <= 0;
    if (elements.stepForward) elements.stepForward.disabled = currentIndex >= actions.length;
    if (elements.reset) elements.reset.disabled = false;
    if (elements.actorList) {
      elements.actorList.textContent = actorListEntries.length
        ? actorListEntries.map((entry) => renderActorInspectSummary(entry)).join("\n")
        : "-";
    }
    if (elements.affinityList) {
      const hasAffinityData = actorListEntries.some(
        (entry) => (entry.affinities && entry.affinities.length) || (entry.abilities && entry.abilities.length),
      );
      elements.affinityList.textContent = actorListEntries.length && hasAffinityData
        ? actorListEntries.map((entry) => renderActorSummary(entry)).join("\n")
        : "No affinities resolved";
    }
    if (elements.tileActorList) {
      const tiles = obs.tileActors || [];
      elements.tileActorList.textContent = tiles.length
        ? tiles.map((entry) => `${entry.id} [${kindLabel(entry.kind)}] @(${entry.position.x},${entry.position.y}) ${formatVitals(entry.vitals)}`).join("\n")
        : "-";
      if (elements.tileActorCount) elements.tileActorCount.textContent = String(tiles.length);
    }
    if (elements.trapList) {
      const traps = obs.traps || [];
      elements.trapList.textContent = traps.length
        ? traps.map((trap) => renderTrapSummary(trap)).join("\n")
        : "No traps detected";
      if (elements.trapCount) elements.trapCount.textContent = String(traps.length);
    }
    if (elements.eventStream) {
      const completed = actions.slice(0, currentIndex);
      if (!completed.length) {
        elements.eventStream.textContent = "No events yet.";
      } else {
        const start = Math.max(0, completed.length - EVENT_STREAM_LIMIT);
        const lines = completed.slice(start).map(formatEventEntry).filter(Boolean);
        elements.eventStream.textContent = lines.join("\n");
      }
    }
    if (elements.eventStreamCount) {
      elements.eventStreamCount.textContent = String(actions.length);
    }

    latestVisibilitySummary = {
      mode: visibilityMode,
      viewerActorId: viewerKey || null,
      map,
      viewport,
      actorStats: Array.isArray(visibilityData?.actorStats) ? visibilityData.actorStats : [],
      viewer: viewerActor
        ? {
          id: viewerKey,
          exploredTiles: viewerExplored.size,
          visibleNowTiles: viewerVisibleNow.size,
          exploredPercent: toPercent(viewerExplored.size, map.totalTiles),
        }
        : null,
    };

    if (typeof onObservation === "function") {
      onObservation({
        observation: obs,
        frame,
        overlay,
        playing,
        index: currentIndex,
        actorIdLabel,
        visibility: cloneVisibilitySummary(latestVisibilitySummary),
      });
    }
  }

  function render() {
    const snapshot = readSnapshot();
    renderFromSnapshot(snapshot);
  }

  function resetCore() {
    if (typeof initCore === "function") {
      initCore();
      core.clearEffects?.();
      return;
    }
    core.init(1337);
    core.loadMvpScenario();
    core.clearEffects?.();
  }

  function applyAction(action) {
    const packed = packMoveAction({
      actorId: actorIdValue,
      from: action.params.from,
      to: action.params.to,
      direction: action.params.direction,
      tick: action.tick,
    });
    applyMoveAction(core, packed);
    core.clearEffects?.();
  }

  function gotoIndex(target) {
    const clamped = Math.max(0, Math.min(actions.length, target));
    resetCore();
    clearVisibilityTracking();
    let snapshot = readSnapshot();
    for (let i = 0; i < clamped; i += 1) {
      applyAction(actions[i]);
      snapshot = readSnapshot();
    }
    currentIndex = clamped;
    renderFromSnapshot(snapshot);
  }

  function stepForward() {
    if (currentIndex >= actions.length) {
      stop();
      return;
    }
    applyAction(actions[currentIndex]);
    currentIndex += 1;
    render();
  }

  function stepBack() {
    gotoIndex(currentIndex - 1);
  }

  function stop() {
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    render();
  }

  function play() {
    if (playing || currentIndex >= actions.length) {
      return;
    }
    playing = true;
    render();
    timer = setInterval(() => {
      stepForward();
      if (currentIndex >= actions.length) {
        stop();
      }
    }, intervalMs);
  }

  function toggle() {
    if (playing) {
      stop();
    } else {
      play();
    }
  }

  function reset() {
    stop();
    gotoIndex(0);
  }

  function setVisibilityMode(mode) {
    visibilityMode = normalizeVisibilityMode(mode);
    render();
  }

  function setViewerActor(actorId) {
    if (!actorId) return;
    viewerActorId = String(actorId);
    render();
  }

  function setViewportSize(size) {
    viewportSize = Math.max(1, parsePositiveInt(size, DEFAULT_VIEWPORT_SIZE));
    render();
  }

  function setVisionRadius(size) {
    visionRadius = Math.max(1, parsePositiveInt(size, DEFAULT_VISION_RADIUS));
    gotoIndex(currentIndex);
  }

  resetCore();
  clearVisibilityTracking();
  render();

  return {
    stepForward,
    stepBack,
    play,
    pause: stop,
    toggle,
    reset,
    gotoIndex,
    setVisibilityMode,
    setViewerActor,
    setViewportSize,
    setVisionRadius,
    getVisibilitySummary: () => cloneVisibilitySummary(latestVisibilitySummary),
    getIndex: () => currentIndex,
    isPlaying: () => playing,
  };
}
