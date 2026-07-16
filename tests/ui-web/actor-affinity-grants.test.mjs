/**
 * M9 — Inspector surfacing of affinity grants: failing tests
 *
 * An actor's affinity is no longer a single fixed value: it is the sum of grants,
 * some of which expire. The inspector must show the effective magnitude AND make
 * the perishable part legible — a delver reading "water+3" needs to know that 2 of
 * those stacks vanish when a pool runs dry.
 *
 * Grant categories stay derived from the data, never flagged — using the SAME rule
 * core uses, keyed on manaMax, so the UI cannot disagree with the simulation:
 *   manaMax === 0              → innate    (no pool, always contributes)
 *   manaMax > 0, manaRegen = 0 → temporary (contributes while mana > 0, then lost)
 *   manaMax > 0, manaRegen > 0 → permanent (refills; contributes while mana > 0)
 *
 * manaMax is load-bearing: without it a drained temporary grant (mana 0) would be
 * indistinguishable from an innate one, and the inspector would show stacks the
 * actor no longer has.
 *
 * Tests MUST FAIL until M10 implements summarizeActorAffinityGrants().
 */
import assert from "node:assert/strict";
import { summarizeActorAffinityGrants } from "../../packages/ui-web/src/actor-inspector.js";

const innate = { kind: "water", expression: "emit", stacks: 1, mana: 0, manaMax: 0, manaRegen: 0 };
const temporary = { kind: "water", expression: "emit", stacks: 2, mana: 30, manaMax: 30, manaRegen: 0 };
const permanent = { kind: "fire", expression: "push", stacks: 2, mana: 10, manaMax: 10, manaRegen: 5 };

test("summarizeActorAffinityGrants is exported", () => {
  assert.equal(typeof summarizeActorAffinityGrants, "function");
});

test("effective magnitude sums grants of the same kind", () => {
  const summary = summarizeActorAffinityGrants({ affinities: [innate, temporary] });
  const water = summary.find((e) => e.kind === "water");
  assert.equal(water.stacks, 3);
});

test("the perishable portion is reported separately from the permanent one", () => {
  const summary = summarizeActorAffinityGrants({ affinities: [innate, temporary] });
  const water = summary.find((e) => e.kind === "water");
  assert.equal(water.temporaryStacks, 2); // the part that will vanish
  assert.equal(water.permanentStacks, 1); // innate, stays
});

test("a regenerating grant counts as permanent, not temporary", () => {
  const summary = summarizeActorAffinityGrants({ affinities: [permanent] });
  const fire = summary.find((e) => e.kind === "fire");
  assert.equal(fire.stacks, 2);
  assert.equal(fire.temporaryStacks, 0);
  assert.equal(fire.permanentStacks, 2);
});

test("remaining mana is surfaced for temporary grants", () => {
  const summary = summarizeActorAffinityGrants({ affinities: [temporary] });
  const water = summary.find((e) => e.kind === "water");
  assert.equal(water.temporaryMana, 30);
});

test("an actor with no affinities summarizes to an empty list", () => {
  assert.deepEqual(summarizeActorAffinityGrants({}), []);
  assert.deepEqual(summarizeActorAffinityGrants({ affinities: [] }), []);
  assert.deepEqual(summarizeActorAffinityGrants(null), []);
});

test("a drained temporary grant contributes nothing", () => {
  const drained = { kind: "water", expression: "emit", stacks: 2, mana: 0, manaMax: 30, manaRegen: 0 };
  const summary = summarizeActorAffinityGrants({ affinities: [innate, drained] });
  const water = summary.find((e) => e.kind === "water");
  assert.equal(water.stacks, 1); // only the innate grant still counts
  assert.equal(water.temporaryStacks, 0);
});

test("a regenerating grant sitting at 0 mana is retained but contributes nothing", () => {
  const empty = { kind: "fire", expression: "push", stacks: 3, mana: 0, manaMax: 3, manaRegen: 2 };
  const summary = summarizeActorAffinityGrants({ affinities: [empty] });
  const fire = summary.find((e) => e.kind === "fire");
  assert.equal(fire.stacks, 0);
  assert.equal(fire.permanentStacks, 0);
});

test("multiple kinds are summarized independently and sorted by kind", () => {
  const summary = summarizeActorAffinityGrants({
    affinities: [permanent, innate, temporary],
  });
  assert.deepEqual(summary.map((e) => e.kind), ["fire", "water"]);
});

test("the summary is derived — no is_permanent or tier field is read or emitted", () => {
  const summary = summarizeActorAffinityGrants({ affinities: [innate, temporary, permanent] });
  for (const entry of summary) {
    for (const key of Object.keys(entry)) {
      assert.ok(!/is_?permanent|tier/i.test(key), `unexpected key: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations
//
// Hand to Ollama (/ollama-test-permutations) once M10 is green. Expand:
//   - All 10 kinds × 4 expressions summarize correctly.
//   - Mixed innate + temporary + permanent of the same kind in every ordering.
//   - Ten grants of one kind sum without loss.
//   - Malformed entries (missing kind, negative stacks, string mana) are skipped.
// ---------------------------------------------------------------------------
