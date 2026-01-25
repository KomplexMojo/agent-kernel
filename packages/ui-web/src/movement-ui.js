import { applyMoveAction, packMoveAction, renderFrameBuffer, readObservation } from "../../bindings-ts/src/mvp-movement.js";

const VITAL_KEYS = ["health", "mana", "stamina", "durability"];
const TRAP_VITAL_KEYS = ["mana", "durability"];
const UNICODE_ACTOR_SYMBOLS = [
  "●",
  "◆",
  "▲",
  "■",
  "★",
  "⬟",
  "⬢",
  "⬣",
  "⬤",
  "⬥",
  "◇",
  "△",
  "□",
  "☆",
];
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
const AFFINITY_HUES = Object.freeze({
  fire: 12,
  water: 206,
  earth: 80,
  wind: 175,
  life: 140,
  decay: 280,
  corrode: 45,
  dark: 230,
});
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
  return char;
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
  const unicodeSymbols = buildActorSymbolMap(sortedActors, UNICODE_ACTOR_SYMBOLS, ASCII_ACTOR_SYMBOLS);

  sortedActors.forEach((actor) => {
    const position = actor?.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const rowText = textGrid[position.y];
    const rowHtml = htmlGrid[position.y];
    if (!rowText || !rowHtml || position.x < 0 || position.x >= rowText.length) return;
    const actorId = String(actor?.id || "");
    const asciiSymbol = asciiSymbols.get(actorId) || "@";
    const unicodeSymbol = unicodeSymbols.get(actorId) || asciiSymbol;
    textGrid[position.y][position.x] = asciiSymbol;

    const affinityInfo = resolveAffinityInfo(actor);
    const hue = affinityInfo?.kind ? AFFINITY_HUES[affinityInfo.kind] : null;
    let style = "";
    let dataAttr = "";
    if (hue !== undefined && hue !== null) {
      const stackStyle = resolveStackStyle(affinityInfo.stacks);
      style = `--actor-hue:${hue};--actor-sat:${stackStyle.sat}%;--actor-light:${stackStyle.light}%;--actor-glow:${stackStyle.glow}px;`;
      dataAttr = ` data-affinity="${escapeHtmlChar(affinityInfo.kind)}" data-stacks="${stackStyle.stacks}"`;
    }
    const styleAttr = style ? ` style="${style}"` : "";
    rowHtml[position.x] = `<span class="actor-cell"${dataAttr}${styleAttr}>${escapeHtmlChar(unicodeSymbol)}</span>`;
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
}) {
  let currentIndex = 0;
  let playing = false;
  let timer = null;

  function render() {
    const frame = renderFrameBuffer(core, { actorIdLabel });
    const obs = readObservation(core, { actorIdLabel, affinityEffects });
    const overlay = buildActorOverlay(frame.baseTiles, obs.actors);
    if (elements.frame) {
      if ("innerHTML" in elements.frame) {
        elements.frame.innerHTML = overlay.html || overlay.text;
      } else {
        elements.frame.textContent = overlay.text;
      }
    }
    if (elements.baseTiles) elements.baseTiles.textContent = frame.baseTiles.join("\n");
    if (elements.actorId) elements.actorId.textContent = actorIdLabel;
    if (elements.actorPos) elements.actorPos.textContent = `(${obs.actor.x}, ${obs.actor.y})`;
    if (elements.actorHp) elements.actorHp.textContent = `${obs.actor.hp}/${obs.actor.maxHp}`;
    if (elements.tick) elements.tick.textContent = String(frame.tick);
    if (elements.status) {
      const exit = findExit(frame.baseTiles);
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
      const list = obs.actors || [];
      elements.actorList.textContent = list.length
        ? list.map((entry) => renderActorInspectSummary(entry)).join("\n")
        : "-";
    }
    if (elements.affinityList) {
      const list = obs.actors || [];
      const hasAffinityData = list.some((entry) => (entry.affinities && entry.affinities.length) || (entry.abilities && entry.abilities.length));
      elements.affinityList.textContent = list.length && hasAffinityData
        ? list.map((entry) => renderActorSummary(entry)).join("\n")
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
    for (let i = 0; i < clamped; i += 1) {
      applyAction(actions[i]);
    }
    currentIndex = clamped;
    render();
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

  resetCore();
  render();

  return {
    stepForward,
    stepBack,
    play,
    pause: stop,
    toggle,
    reset,
    gotoIndex,
    getIndex: () => currentIndex,
    isPlaying: () => playing,
  };
}
