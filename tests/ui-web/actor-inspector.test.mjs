import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createActorInspector,
  formatActorProfile,
  formatActorCapabilities,
  formatActorConstraints,
  formatActorLiveState,
} from "../../packages/ui-web/src/actor-inspector.js";

function makeEl() {
  return { textContent: "" };
}

function makeContainerEl() {
  return { hidden: false };
}

function makeButtonEl() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    click() {
      handlers.get("click")?.();
    },
  };
}

const baseVitals = {
  health: { current: 5, max: 10, regen: 0 },
  mana: { current: 1, max: 2, regen: 0 },
  stamina: { current: 3, max: 5, regen: 1 },
  durability: { current: 4, max: 4, regen: 0 },
};

const actorA = {
  id: "actor_alpha",
  kind: 2,
  position: { x: 1, y: 2 },
  vitals: baseVitals,
  affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
  abilities: [{ id: "burst", kind: "attack", affinityKind: "fire", expression: "push", potency: 2, manaCost: 1 }],
  capabilities: { movementCost: 1, actionCostMana: 2, actionCostStamina: 3 },
  constraints: ["no-water"],
};

const actorB = {
  id: "actor_beta",
  kind: 1,
  position: { x: 4, y: 5 },
  vitals: baseVitals,
  affinities: [],
  abilities: [],
  capabilities: { movementCost: 2, actionCostMana: 0, actionCostStamina: 1 },
};

test("formatters include profile and capabilities", () => {
  const profile = formatActorProfile(actorA);
  assert.match(profile, /id: actor_alpha/);
  assert.match(profile, /kind: motivated/);
  assert.match(profile, /affinities: fire:push x2/);

  const capabilities = formatActorCapabilities(actorA);
  assert.match(capabilities, /movementCost: 1/);
  assert.match(capabilities, /actionCostMana: 2/);
  assert.match(capabilities, /actionCostStamina: 3/);

  const constraints = formatActorConstraints(actorA);
  assert.match(constraints, /no-water/);
});

test("inspector preserves selection across updates", () => {
  const containerEl = makeContainerEl();
  const closeButtonEl = makeButtonEl();
  const statusEl = makeEl();
  const profileEl = makeEl();
  const capabilitiesEl = makeEl();
  const constraintsEl = makeEl();
  const liveStateEl = makeEl();
  const inspector = createActorInspector({
    containerEl,
    closeButtonEl,
    statusEl,
    profileEl,
    capabilitiesEl,
    constraintsEl,
    liveStateEl,
  });

  assert.equal(containerEl.hidden, true);
  inspector.setActors([actorA, actorB], { tick: 1 });
  assert.equal(containerEl.hidden, true);
  inspector.selectActorById("actor_beta");
  assert.equal(containerEl.hidden, false);
  assert.match(statusEl.textContent, /actor_beta/);

  inspector.setActors([actorB], { tick: 2 });
  assert.match(profileEl.textContent, /id: actor_beta/);
});

test("inspector renders live state when running", () => {
  const containerEl = makeContainerEl();
  const closeButtonEl = makeButtonEl();
  const statusEl = makeEl();
  const profileEl = makeEl();
  const capabilitiesEl = makeEl();
  const constraintsEl = makeEl();
  const liveStateEl = makeEl();
  const inspector = createActorInspector({
    containerEl,
    closeButtonEl,
    statusEl,
    profileEl,
    capabilitiesEl,
    constraintsEl,
    liveStateEl,
  });

  inspector.setActors([actorA], { tick: 7 });
  inspector.selectActorById("actor_alpha");
  inspector.setRunning(true);

  const liveState = formatActorLiveState(actorA, { tick: 7, running: true });
  assert.match(liveState, /tick: 7/);
  assert.match(liveState, /health: 5\/10\+0/);
  assert.match(liveStateEl.textContent, /tick: 7/);
});

test("inspector supports close and clears selection", () => {
  const containerEl = makeContainerEl();
  const closeButtonEl = makeButtonEl();
  const statusEl = makeEl();
  const profileEl = makeEl();
  const capabilitiesEl = makeEl();
  const constraintsEl = makeEl();
  const liveStateEl = makeEl();
  const inspector = createActorInspector({
    containerEl,
    closeButtonEl,
    statusEl,
    profileEl,
    capabilitiesEl,
    constraintsEl,
    liveStateEl,
  });

  inspector.setActors([actorA], { tick: 7 });
  inspector.selectActorById("actor_alpha");
  assert.equal(inspector.getSelectedId(), "actor_alpha");
  assert.equal(containerEl.hidden, false);

  closeButtonEl.click();
  assert.equal(inspector.getSelectedId(), null);
  assert.equal(containerEl.hidden, true);
  assert.match(statusEl.textContent, /Select an actor on the stage to inspect/);
});
