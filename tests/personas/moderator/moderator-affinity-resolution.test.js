/**
 * G1 moderator/affinity-target-resolution (A1 + A2) — P5.4, 2026-08-12.
 *
 * The behavior had one origin (`moderator/affinity-target-effects.js`) and a planning event
 * the runner sends (`resolve_affinity`, APPLY phase) — but its only test drove
 * `resolveAffinityTargetEffectsForList` **directly**. That proves the function computes what
 * it should and says nothing about whether production consults the persona at all. Routing
 * versus authority is the whole distinction this registry exists for, so the entry stayed
 * blocked until the two checks below existed.
 *
 *   1. **ABLATION (A2).** A Moderator that plans no affinity actions must leave the core
 *      untouched. If the runner carried any fallback — a copy of the resolver, a "well, we
 *      know what water:emit does" branch — tiles would still be set.
 *   2. **DIFFERENTIAL (A1).** What production applied must equal what a FRESH standalone
 *      Moderator plans from the payload production actually sent. Capturing the payload is
 *      the point: asserting against a hand-written payload would test the fixture, not the
 *      seam. If the runner post-processed, reordered or topped up the plan, the two diverge.
 *
 * ⚠️ The control in the ablation is `runtime-moderator-affinity-actions.test.js` and is
 * repeated here rather than cited: an ablation whose control lives in another file silently
 * becomes vacuous the day that file changes its fixture.
 *
 * ⚠️ **TEETH, MEASURED — AND THE DIFFERENTIAL IS NOT THE DETECTOR.** Perturbation: make the
 * runner call `planModeratorAffinityActions` itself and apply that instead of the persona's
 * plan. The **ablation FAILS** (the core is mutated while the Moderator planned nothing);
 * the **differential still PASSES**, because a runner that duplicates the persona's own
 * function agrees with it by construction. Recorded rather than papered over: the
 * differential's job is catching post-processing and substitution, and only the ablation
 * answers A2. Same lesson as CR.8's provenance pair, where the output test could not see the
 * façade and the refusal could.
 */
const assert = require("node:assert/strict");

const RUNTIME = "../../../packages/runtime/src/runner/runtime.js";
const MODERATOR = "../../../packages/runtime/src/personas/moderator/persona.js";
const CLOCK = () => "2026-08-12T00:00:00.000Z";

const AFFINITY_EFFECTS = Object.freeze({
  actors: [
    {
      actorId: "actor",
      resolvedEffects: [
        {
          id: "water:emit:barrier:destroy_barrier",
          category: "environment",
          operation: "destroy_barrier",
          sourceType: "actor",
          kind: "water",
          expression: "emit",
          stacks: 3,
          targetType: "barrier",
        },
        {
          id: "water:emit:floor:arm_static_hazard",
          category: "environment",
          operation: "arm_static_hazard",
          sourceType: "actor",
          kind: "water",
          expression: "emit",
          stacks: 3,
          targetType: "floor",
          manaReserve: 2,
        },
      ],
    },
  ],
});

/** A core that records the two mutations affinity resolution can cause. */
function recordingCore() {
  const setTiles = [];
  const armedHazards = [];
  return {
    setTiles,
    armedHazards,
    init() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return 0; },
    getEffectKind() { return 0; },
    getEffectValue() { return 0; },
    clearEffects() {},
    getMapWidth() { return 3; },
    getMapHeight() { return 3; },
    getActorX() { return 1; },
    getActorY() { return 1; },
    getActorKind() { return 2; },
    getActorVitalCurrent(kind) { return kind === 1 ? 3 : 10; },
    getActorVitalMax() { return 10; },
    getActorVitalRegen() { return 0; },
    getTileActorKind(x, y) { return x === 1 && y === 0 ? 1 : 0; },
    getCurrentTick() { return 0; },
    setTileAt(x, y, tile) { setTiles.push({ x, y, tile }); },
    armStaticHazardAt(x, y, affinityKind, expression, stacks, manaReserve) {
      armedHazards.push({ x, y, affinityKind, expression, stacks, manaReserve });
      return 1;
    },
  };
}

async function runWith(moderator) {
  const { createRuntime } = await import(RUNTIME);
  const core = recordingCore();
  const runtime = createRuntime({
    core,
    adapters: { logger: { log() {}, warn() {}, error() {} } },
    personas: { moderator },
  });
  await runtime.init({ seed: 0, affinityEffects: AFFINITY_EFFECTS });
  await runtime.step();
  return core;
}

test("G1 moderator/affinity-target-resolution: a Moderator that plans nothing leaves the core untouched", async () => {
  const { createModeratorPersona } = await import(MODERATOR);

  // CONTROL — the real persona resolves the two environment effects.
  const withModerator = await runWith(createModeratorPersona({ clock: CLOCK }));
  assert.equal(withModerator.setTiles.length, 1, "precondition: the fixture must resolve to a real mutation");
  assert.equal(withModerator.armedHazards.length, 1);

  // ABLATION — same everything, except affinity resolution answers with no actions.
  const real = createModeratorPersona({ clock: CLOCK });
  const silent = {
    subscribePhases: real.subscribePhases,
    view: real.view,
    advance(input) {
      const result = real.advance(input);
      if (input?.event === "resolve_affinity") return { ...result, actions: [] };
      return result;
    },
  };
  const withoutModerator = await runWith(silent);

  assert.deepEqual(
    withoutModerator.setTiles,
    [],
    "the core was mutated while the Moderator planned no affinity actions — the runner is "
      + "resolving affinity targets itself, which is the second implementation A1 forbids",
  );
  assert.deepEqual(withoutModerator.armedHazards, []);
});

test("G1 moderator/affinity-target-resolution: production applies exactly the plan the persona gave", async () => {
  const { createModeratorPersona } = await import(MODERATOR);

  // A proxy over the REAL persona, capturing what production asked and what it was told.
  const real = createModeratorPersona({ clock: CLOCK });
  const asked = [];
  const proxy = {
    subscribePhases: real.subscribePhases,
    view: real.view,
    advance(input) {
      const result = real.advance(input);
      if (input?.event === "resolve_affinity") {
        asked.push({ input, actions: result.actions });
      }
      return result;
    },
  };

  const core = await runWith(proxy);
  assert.equal(asked.length, 1, "production must ask the Moderator to resolve affinity exactly once per tick");

  // The same question, to an instance that has seen nothing else.
  const standalone = createModeratorPersona({ clock: CLOCK });
  const replay = standalone.advance(asked[0].input);

  assert.deepEqual(
    replay.actions,
    asked[0].actions,
    "a fresh Moderator given the payload production sent planned something different — the "
      + "answer depends on state the runner carried, not on the persona's own decision",
  );
  assert.ok(replay.actions.length > 0, "precondition: the replayed plan must not be empty");
  // And the plan is what reached the core: two environment actions, two mutations.
  assert.equal(core.setTiles.length + core.armedHazards.length, replay.actions.length);
});

// ## TODO: Test Permutations
// - maxAffinityActions: production must respect the persona's cap, not its own
// - an effects list the persona REFUSES (unknown operation): production must not improvise
// - two actors with conflicting environment effects: ordering comes from the Moderator
