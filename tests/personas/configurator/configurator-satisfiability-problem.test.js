/**
 * Z8.0 — executable benefit and policy lock for Configurator logical validity.
 *
 * Current-source audit found bounded validation, not combinatorial search. These
 * tests lock the exact diagnostic families and keep solver machinery out of
 * normalization. The Configurator constraint domain remains adopted for Z9's
 * genuine object-placement search.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFixture } = require("../../helpers/fixtures");

const LOGICAL_DIAGNOSTICS = Object.freeze({
  motivationExclusiveGroup: Object.freeze(["conflicting_kind"]),
  affinityManaPrerequisite: Object.freeze([
    "affinity_requires_mana",
    "affinity_requires_mana_regen",
  ]),
  movementStaminaPrerequisite: Object.freeze([
    "movement_requires_stamina_pool",
    "movement_requires_stamina_regen",
  ]),
  affinitySlotLimit: Object.freeze(["affinity_slot_limit_exceeded"]),
  affinityStackTier: Object.freeze(["stacks_exceed_max"]),
});

function zeroVitals() {
  return Object.fromEntries(
    ["health", "mana", "stamina", "durability"].map((key) => [
      key,
      { current: 0, max: 0, regen: 0 },
    ]),
  );
}

test("the Z8 logical layer is bounded validation with no objective or choice search", async () => {
  const { AFFINITY_KINDS, MOTIVATION_KINDS } = await import(
    "../../../packages/runtime/src/contracts/domain-constants.js"
  );
  const benefitCensus = [
    { id: "motivation_exclusive_group", bound: MOTIVATION_KINDS.length ** 2 },
    { id: "affinity_mana_prerequisite", bound: AFFINITY_KINDS.length },
    { id: "movement_stamina_prerequisite", bound: MOTIVATION_KINDS.length },
    { id: "affinity_slot_limit", bound: AFFINITY_KINDS.length },
    { id: "affinity_stack_tier", bound: 5 },
  ];

  assert.equal(benefitCensus.every(({ bound }) => Number.isInteger(bound) && bound <= 144), true);
  assert.equal(benefitCensus.some((entry) => Object.hasOwn(entry, "objective")), false);
  assert.equal(benefitCensus.some((entry) => Object.hasOwn(entry, "choiceVariables")), false);
});

test("hard-authored motivation, mana, and stamina conflicts retain exact diagnostics", async () => {
  const { normalizeMotivations } = await import(
    "../../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );
  const { assessDelverStructure } = await import(
    "../../../packages/runtime/src/personas/configurator/candidate-authoring.js"
  );
  const motivations = normalizeMotivations(["stationary", "patrolling"]);
  assert.equal(motivations.ok, false);
  assert.deepEqual(motivations.errors.map(({ code }) => code), [
    ...LOGICAL_DIAGNOSTICS.motivationExclusiveGroup,
  ]);

  const card = {
    motivations: ["patrolling"],
    affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
    vitals: zeroVitals(),
  };
  const before = JSON.parse(JSON.stringify(card));
  const codes = assessDelverStructure({ card }).map(({ code }) => code).sort();
  assert.deepEqual(codes, [
    ...LOGICAL_DIAGNOSTICS.affinityManaPrerequisite,
    ...LOGICAL_DIAGNOSTICS.movementStaminaPrerequisite,
  ].sort());
  assert.deepEqual(card, before, "validity checks may not repair authored values in place");
});

test("the existing Configurator public surface delegates every actor logical diagnostic", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/controller.js"
  );
  const { assessActorLogicalValidity } = await import(
    "../../../packages/runtime/src/personas/configurator/logical-validation.js"
  );
  const card = {
    motivations: ["stationary", "patrolling"],
    affinities: Array.from({ length: 11 }, () => ({
      kind: "fire",
      expression: "emit",
      stacks: 1,
    })),
    vitals: zeroVitals(),
  };
  const before = JSON.parse(JSON.stringify(card));
  const configurator = createConfiguratorPersona({ clock: () => "fixed" });
  const direct = assessActorLogicalValidity({ card, path: "actor" });
  const publicResult = configurator.authorCandidates.assessDelverStructure({ card, path: "actor" });

  assert.deepEqual(publicResult, direct);
  assert.deepEqual(direct.map(({ code }) => code), [
    "conflicting_kind",
    "affinity_requires_mana",
    "affinity_requires_mana_regen",
    "movement_requires_stamina_pool",
    "movement_requires_stamina_regen",
    "affinity_slot_limit_exceeded",
  ]);
  assert.deepEqual(card, before, "the consolidated public path may not repair authored values");
});

test("stack bounds retain the existing diagnostic and configured slots use vocabulary size", async () => {
  const { AFFINITY_KINDS } = await import(
    "../../../packages/runtime/src/contracts/domain-constants.js"
  );
  const {
    normalizeActorLoadoutCatalog,
    normalizeAffinityPresetCatalog,
  } = await import(
    "../../../packages/runtime/src/personas/configurator/affinity-loadouts.js"
  );
  const presets = normalizeAffinityPresetCatalog(
    readFixture("affinity-presets-artifact-v1-basic.json"),
  );
  const stackResult = normalizeActorLoadoutCatalog(
    readFixture("invalid/actor-loadouts-artifact-v1-stacks-exceed.json"),
    { presets: presets.value.presets },
  );
  const slotFixture = readFixture(
    "invalid/actor-loadouts-artifact-v1-affinity-slot-limit.json",
  );
  const slotBefore = JSON.parse(JSON.stringify(slotFixture));
  const slotResult = normalizeActorLoadoutCatalog(
    slotFixture,
    { presets: presets.value.presets },
  );
  assert.equal(stackResult.ok, false);
  assert.equal(
    stackResult.errors.some(({ code }) => LOGICAL_DIAGNOSTICS.affinityStackTier.includes(code)),
    true,
  );

  assert.equal(slotResult.ok, false);
  assert.deepEqual(
    slotResult.errors.filter(({ code }) => LOGICAL_DIAGNOSTICS.affinitySlotLimit.includes(code)),
    [{
      field: "loadouts[0].affinities",
      code: "affinity_slot_limit_exceeded",
      actorId: "actor_overloaded",
    }],
  );
  assert.deepEqual(slotFixture, slotBefore, "slot validation may not mutate its artifact");
  assert.equal(AFFINITY_KINDS.length, 10, "configured slots derive from the canonical affinity vocabulary");
});

test("omitted values have one approved default or floor rather than a solver choice", async () => {
  const { normalizeAffinityList } = await import(
    "../../../packages/runtime/src/personas/configurator/cost-model.js"
  );
  const { buildMinimumDelverCard } = await import(
    "../../../packages/runtime/src/personas/configurator/candidate-authoring.js"
  );
  const errors = [];
  const affinities = normalizeAffinityList(
    [{ kind: "fire", expression: "emit" }],
    errors,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(affinities, [{ kind: "fire", expression: "emit", stacks: 1 }]);

  const card = { motivations: ["patrolling"], affinities, vitals: zeroVitals() };
  assert.deepEqual(buildMinimumDelverCard(card), buildMinimumDelverCard(card));
});

test("the Configurator constraint domain remains reserved for Z9 object-placement search", async () => {
  const {
    buildConstraintProblem,
    CONSTRAINT_DOMAINS,
    validateConstraintProblem,
  } = await import("../../../packages/runtime/src/contracts/constraint-problem.js");
  const problem = buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY,
    posedBy: "configurator",
    variables: [],
    constraints: [],
    context: { problemKind: "object_placement" },
  });

  assert.deepEqual(validateConstraintProblem(problem), { ok: true, errors: [] });
  assert.equal(problem.context.problemKind, "object_placement");
});

// ## TODO: Test Permutations
// - affinity-slot validation with malformed entries still reports one bounded slot error
// - a new Configurator solver route must demonstrate an unbounded or combinatorial choice first
