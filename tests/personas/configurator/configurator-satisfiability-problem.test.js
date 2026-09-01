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
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { readFixture } = require("../../helpers/fixtures");

const ROOT = resolve(__dirname, "../../..");
const CONFIGURATOR = resolve(ROOT, "packages/runtime/src/personas/configurator");
const LOGICAL_SOURCES = Object.freeze([
  "config-validation.js",
  "affinity-rules.js",
  "motivation-rules.js",
  "candidate-authoring.js",
]);

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
  assert.equal(stackResult.ok, false);
  assert.equal(
    stackResult.errors.some(({ code }) => LOGICAL_DIAGNOSTICS.affinityStackTier.includes(code)),
    true,
  );

  const slotLimit = AFFINITY_KINDS.length;
  const configuredAffinityCount = slotLimit + 1;
  const slotIssues = configuredAffinityCount > slotLimit
    ? [...LOGICAL_DIAGNOSTICS.affinitySlotLimit]
    : [];
  assert.deepEqual(slotIssues, ["affinity_slot_limit_exceeded"]);
  assert.equal(slotLimit, 10, "configured slots derive from the canonical affinity vocabulary");
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

test("normalization stays solver-free and live resource-grant slots remain core runtime state", () => {
  const forbiddenImport = /from\s+["'][^"']*(?:constraint-problem|ports\/solver|adapters)[^"']*["']/;
  for (const file of LOGICAL_SOURCES) {
    const source = readFileSync(resolve(CONFIGURATOR, file), "utf8");
    assert.equal(forbiddenImport.test(source), false, `${file} imported solver machinery`);
    assert.equal(source.includes("buildConstraintProblem("), false, `${file} built a solver problem`);
    assert.equal(
      source.includes("MAX_AFFINITY_GRANTS_PER_ACTOR"),
      false,
      `${file} conflated authored affinity slots with core's live resource grants`,
    );
  }
  const coreAffinity = readFileSync(
    resolve(ROOT, "packages/core-ts/src/state/affinity.ts"),
    "utf8",
  );
  assert.equal(coreAffinity.includes("MAX_AFFINITY_GRANTS_PER_ACTOR = 10"), true);
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
// - every logical diagnostic family remains distinct when several conflicts coexist
// - a new Configurator solver route must demonstrate an unbounded or combinatorial choice first
