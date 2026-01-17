import { applyMoveAction, packMoveAction, renderFrameBuffer, readObservation } from "../../bindings-ts/src/mvp-movement.js";

const VITAL_KEYS = ["health", "mana", "stamina", "durability"];
const TRAP_VITAL_KEYS = ["mana", "durability"];

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
    if (elements.frame) elements.frame.textContent = frame.buffer.join("\n");
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
