/**
 * P5.1 D2 / decision D-n — the two motivation-list forms must not drift.
 *
 * The salvaging form `coerceMotivationKinds` (contracts/domain-constants.js) and the
 * rejecting form `normalizeMotivationKindList` (personas/configurator/motivation-loadouts.js)
 * are deliberately separate: ingesting loose input is not a persona decision, but
 * deciding whether input is VALID is the Configurator's chartered call. All three
 * cross-boundary callers took only `.value`, so they now call the contracts form.
 *
 * That split is exactly how "two codebooks, one concept" starts — the defect class
 * this program has already recorded three times (P1.5a's budget category ids, PA.3's
 * shadowing BUDGET_RECEIPT_SCHEMA, PX.1's duplicated EffectKind). So the two forms are
 * pinned here: for every input, `coerceMotivationKinds(x, o)` must equal
 * `normalizeMotivationKindList(x, o).value`. If someone changes the conflict rule,
 * the dedupe order or the fallback behavior in one and not the other, this fails.
 *
 * It also documents the CURRENT production behavior honestly: invalid and
 * intra-family-conflicting motivations are silently coerced, not refused. Whether
 * they should be refused is an open decision — see the note on
 * normalizeMotivationKindList.
 */
const assert = require("node:assert/strict");

const CONTRACTS = "../../packages/runtime/src/contracts/domain-constants.js";
const LOADOUTS = "../../packages/runtime/src/personas/configurator/motivation-loadouts.js";

// [input, options] pairs spanning every branch both implementations have:
// undefined, non-list, unknown kind, casing/separator variants, duplicates,
// intra-family conflicts, cross-family combinations, and fallback handling.
const CASES = [
  [undefined, {}],
  [undefined, { fallback: "defending" }],
  [undefined, { fallback: "defending", allowEmpty: true }],
  [undefined, { fallback: "not_a_kind" }],
  [null, {}],
  [42, { fallback: "attacking" }],
  [{}, {}],
  ["attacking", {}],
  ["  ATTACKING  ", {}],
  ["goal oriented", {}],
  ["goal-oriented", {}],
  ["not_a_kind", {}],
  ["not_a_kind", { fallback: "defending" }],
  ["not_a_kind", { allowEmpty: true }],
  [[], {}],
  [[], { fallback: "defending" }],
  [[], { allowEmpty: true }],
  [["attacking"], {}],
  [["attacking", "attacking"], {}],
  [["attacking", "defending"], {}],                       // posture conflict
  [["stationary", "patrolling"], {}],                     // mobility conflict
  [["reflexive", "strategy_focused"], {}],                // cognition conflict
  [["attacking", "patrolling", "reflexive"], {}],         // three families, no conflict
  [["attacking", "user_controlled"], {}],                 // control is not exclusive
  [["user_controlled", "attacking", "defending"], {}],
  [["not_a_kind", "attacking"], {}],
  [["attacking", "not_a_kind"], { fallback: "defending" }],
  [["not_a_kind", "also_bad"], { fallback: "defending" }],
  [["not_a_kind", "also_bad"], { allowEmpty: true }],
  [[null, "attacking", 7], {}],
  [["Attacking", "attacking"], {}],
];

test("coerceMotivationKinds agrees with normalizeMotivationKindList on every value", async () => {
  const { coerceMotivationKinds } = await import(CONTRACTS);
  const { normalizeMotivationKindList } = await import(LOADOUTS);

  for (const [input, options] of CASES) {
    const coerced = coerceMotivationKinds(input, options);
    const validated = normalizeMotivationKindList(input, options).value;
    assert.deepEqual(
      coerced,
      validated,
      `drift for input ${JSON.stringify(input)} options ${JSON.stringify(options)}: `
        + `coerce=${JSON.stringify(coerced)} validate=${JSON.stringify(validated)}`,
    );
  }
});

test("the rejecting form still reports what the salvaging form drops silently", async () => {
  const { coerceMotivationKinds } = await import(CONTRACTS);
  const { normalizeMotivationKindList } = await import(LOADOUTS);

  // An unknown kind: coerced away without comment, reported as invalid_kind.
  assert.deepEqual(coerceMotivationKinds(["not_a_kind", "attacking"], {}), ["attacking"]);
  const invalid = normalizeMotivationKindList(["not_a_kind", "attacking"], {});
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, [{ field: "motivations[0]", code: "invalid_kind" }]);

  // An intra-family conflict: first wins silently, reported as conflicting_kind.
  assert.deepEqual(coerceMotivationKinds(["attacking", "defending"], {}), ["attacking"]);
  const conflicting = normalizeMotivationKindList(["attacking", "defending"], {});
  assert.equal(conflicting.ok, false);
  assert.deepEqual(conflicting.errors, [{ field: "motivations[1]", code: "conflicting_kind" }]);

  // A non-list: emptied silently, reported as invalid_list.
  assert.deepEqual(coerceMotivationKinds(42, {}), []);
  const notAList = normalizeMotivationKindList(42, {});
  assert.equal(notAList.ok, false);
  assert.deepEqual(notAList.errors, [{ field: "motivations", code: "invalid_list" }]);
});

test("the vocabulary lookups moved to contracts and still derive from the families", async () => {
  const {
    getConflictingMotivationKinds,
    getMotivationExclusiveGroup,
    MOTIVATION_FAMILIES,
  } = await import(CONTRACTS);

  // Exclusivity is derived from the families, not authored per-kind.
  assert.deepEqual(getConflictingMotivationKinds("attacking"), ["defending", "stealthy", "friendly"]);
  assert.equal(getMotivationExclusiveGroup("patrolling").id, "mobility");
  assert.deepEqual(getConflictingMotivationKinds("not_a_kind"), []);

  // `control` is deliberately NOT an exclusive group: user_controlled coexists with
  // anything, which is what lets delver cards carry it as a synthetic extra tag.
  assert.deepEqual(MOTIVATION_FAMILIES.control, ["user_controlled"]);
  assert.equal(getMotivationExclusiveGroup("user_controlled"), null);
  assert.deepEqual(getConflictingMotivationKinds("user_controlled"), []);
});

// ## TODO: Test Permutations
