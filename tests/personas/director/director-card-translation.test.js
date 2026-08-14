/**
 * CR.7 / WP-5 — the Director's card-set TRANSLATION surface, and why it is ungated.
 *
 * `commands/card-authoring.js` imported `extractSummaryFromCardSet`, `normalizeCardEntry` and
 * `buildCardSetFromSummary` from `director/summary-selections.js` and was the last of the eight
 * orphaned allowlist rows. All three are now published on the controller, ungated.
 *
 * 🔴 THE RISK THIS FILE EXISTS TO CONTAIN: `cardSetFromSummary` is an UNGATED SIBLING of the
 * gated `buildCardSet`, and they call the same function. `buildCardSet`'s gate was a LABEL until
 * M5b.2e's perturbation forced it to be real, so an ungated twin is exactly the shape that could
 * quietly restore it. Two things therefore have to stay true at once, and both are asserted here:
 *
 *   1. the translation surface answers with NO build round — gating it would refuse the
 *      card-authoring and preview paths, an outage rather than a boundary (the D8.3 trap);
 *   2. `buildCardSet` is STILL GATED, and the ungated sibling returns exactly what it returns —
 *      so this is one origin with two entry points, not a second implementation free to drift.
 *
 * The gate itself is additionally pinned in `director-build-round.test.js`; asserting it again
 * here is deliberate, because that is the assertion whose failure would mean this file's
 * sibling had become a bypass.
 */
const assert = require("node:assert/strict");

const DIRECTOR = "../../../packages/runtime/src/personas/director/persona.js";

const INTENT = Object.freeze({
  schema: "agent-kernel/IntentEnvelope",
  schemaVersion: 1,
  meta: { id: "intent_translation", runId: "run_translation", createdAt: "2026-08-12T00:00:00.000Z" },
  intent: { goal: "a small room with one warden" },
});

const ROOM_SUMMARY = Object.freeze({
  dungeonAffinity: "fire",
  budgetTokens: 1000,
  cardSet: [
    { id: "room_a", type: "room", roomSize: "medium", affinity: "fire", count: 2 },
    { id: "warden_a", type: "warden", affinity: "fire", count: 1, motivations: ["defending"] },
  ],
});

async function makeDirector() {
  const { createDirectorPersona } = await import(DIRECTOR);
  return createDirectorPersona({ clock: () => "2026-08-12T00:00:00.000Z" });
}

test("the translation surface answers with NO build round — gating it would be an outage", async () => {
  const d = await makeDirector();
  assert.equal(d.view().state, "uninitialized", "no round has been opened");

  // `resolveSummary` reads a card set into a summary, fetching the Configurator's room
  // geometry itself (D8.3) rather than making the caller assemble it.
  const resolved = d.resolveSummary(ROOM_SUMMARY);
  assert.ok(resolved.layout, "room cards resolve into a layout");
  assert.equal(resolved.roomDesign.roomCount, 2);

  // `normalizeCard` normalizes one entry.
  const normalized = d.normalizeCard({ type: "warden", affinity: "wind" }, { index: 0 });
  assert.equal(normalized.type, "warden");

  // `cardSetFromSummary` renders a summary back into cards.
  assert.ok(Array.isArray(d.cardSetFromSummary(ROOM_SUMMARY)));

  assert.equal(d.view().state, "uninitialized", "translation moves no FSM state");
});

/**
 * ⚠️ THE LOAD-BEARING ASSERTION. If `buildCardSet` ever stops throwing here, the ungated
 * sibling above has become a way around a gate that M5b.2e had to fight for.
 */
test("buildCardSet is STILL gated, and the ungated sibling is the same origin", async () => {
  const d = await makeDirector();

  assert.throws(
    () => d.buildCardSet(ROOM_SUMMARY),
    (e) => e.code === "director_state",
    "a cardSet bound for a persisted BuildSpec still requires an open round",
  );

  // Same origin, not a second implementation: with a round open, the gated path returns
  // exactly what the ungated one does. A drifting copy fails this even while both stay green
  // against their own callers.
  const ungated = d.cardSetFromSummary(ROOM_SUMMARY);
  d.beginBuild(INTENT);
  assert.deepEqual(d.buildCardSet(ROOM_SUMMARY), ungated);
});

// ## TODO: Test Permutations
