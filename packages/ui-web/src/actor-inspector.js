import { formatAffinities, formatAbilities } from "./movement-ui.js";
import { VITAL_KEYS } from "../../runtime/src/contracts/domain-constants.js";

function kindLabel(kind) {
  if (kind === 0) return "stationary";
  if (kind === 1) return "barrier";
  if (kind === 2) return "motivated";
  return `kind:${kind}`;
}

function formatVitals(vitals = {}) {
  return VITAL_KEYS.map((key) => {
    const record = vitals?.[key];
    if (!record) return `${key}: -`;
    return `${key}: ${record.current}/${record.max}+${record.regen}`;
  }).join("\n");
}

export function formatActorProfile(actor) {
  if (!actor) return "No actor selected.";
  const lines = [];
  lines.push(`id: ${actor.id ?? "-"}`);
  lines.push(`kind: ${kindLabel(actor.kind)}`);
  if (actor.position) {
    lines.push(`position: (${actor.position.x}, ${actor.position.y})`);
  }
  lines.push(`affinities: ${formatAffinities(actor.affinities)}`);
  lines.push(`abilities: ${formatAbilities(actor.abilities)}`);
  return lines.join("\n");
}

export function formatActorCapabilities(actor) {
  if (!actor) return "No actor selected.";
  const capabilities = actor.capabilities;
  if (!capabilities || typeof capabilities !== "object") {
    return "No capabilities recorded.";
  }
  const lines = [];
  if (Number.isFinite(capabilities.movementCost)) {
    lines.push(`movementCost: ${capabilities.movementCost}`);
  }
  if (Number.isFinite(capabilities.actionCostMana)) {
    lines.push(`actionCostMana: ${capabilities.actionCostMana}`);
  }
  if (Number.isFinite(capabilities.actionCostStamina)) {
    lines.push(`actionCostStamina: ${capabilities.actionCostStamina}`);
  }
  return lines.length ? lines.join("\n") : "No capabilities recorded.";
}

export function formatActorConstraints(actor) {
  if (!actor) return "No actor selected.";
  const constraints = actor.constraints ?? actor.traits?.constraints;
  if (!constraints) return "No constraints recorded.";
  if (Array.isArray(constraints)) {
    return constraints.length ? constraints.map((entry) => String(entry)).join("\n") : "No constraints recorded.";
  }
  if (typeof constraints === "object") {
    const entries = Object.entries(constraints);
    if (entries.length === 0) return "No constraints recorded.";
    return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n");
  }
  return String(constraints);
}

export function formatActorLiveState(actor, { tick, running } = {}) {
  if (!actor) return "No actor selected.";
  if (!running) return "Simulation paused.";
  const lines = [];
  if (Number.isFinite(tick)) {
    lines.push(`tick: ${tick}`);
  }
  if (actor.position) {
    lines.push(`position: (${actor.position.x}, ${actor.position.y})`);
  }
  if (actor.vitals) {
    lines.push(formatVitals(actor.vitals));
  }
  return lines.length ? lines.join("\n") : "No live state available.";
}

export function createActorInspector({
  statusEl,
  profileEl,
  capabilitiesEl,
  constraintsEl,
  liveStateEl,
} = {}) {
  let actors = [];
  let selectedId = null;
  let running = false;
  let tick = null;

  function getSelectedActor() {
    return actors.find((actor) => actor?.id === selectedId) || null;
  }

  function render() {
    const actor = getSelectedActor();
    if (statusEl) {
      statusEl.textContent = actor ? `Selected: ${actor.id}` : "Select an actor on the stage to inspect.";
    }
    if (profileEl) profileEl.textContent = formatActorProfile(actor);
    if (capabilitiesEl) capabilitiesEl.textContent = formatActorCapabilities(actor);
    if (constraintsEl) constraintsEl.textContent = formatActorConstraints(actor);
    if (liveStateEl) liveStateEl.textContent = formatActorLiveState(actor, { tick, running });
  }

  function setActors(nextActors = [], { tick: nextTick } = {}) {
    actors = Array.isArray(nextActors) ? nextActors : [];
    if (typeof nextTick !== "undefined") {
      tick = Number.isFinite(nextTick) ? nextTick : null;
    }
    if (selectedId && !actors.some((actor) => actor?.id === selectedId)) {
      selectedId = null;
    }
    if (!selectedId && actors.length) {
      selectedId = actors[0]?.id ?? null;
    }
    render();
  }

  function selectActorById(id) {
    if (!id) return;
    selectedId = id;
    render();
  }

  function setRunning(value) {
    running = Boolean(value);
    render();
  }

  render();

  return {
    setActors,
    selectActorById,
    setRunning,
    getSelectedId: () => selectedId,
  };
}
