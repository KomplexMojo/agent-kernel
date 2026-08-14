/**
 * P2.1a — the Director owns intent translation on the BUILD plane.
 *
 * The persona audit found the Director's FSM never initializes in production:
 * the build pipeline imported buildspec-assembler and pool-mapper directly and
 * the persona sat in "uninitialized" forever. This surface gives the build
 * plane a persona round (charter rule 3: two planes, same personas), gated by
 * the FSM exactly as the Allocator's spend round is.
 *
 * P2.1b threads kernel.js through this API; until then both paths coexist.
 */
const assert = require("node:assert/strict");

const DIRECTOR = "../../../packages/runtime/src/personas/director/persona.js";

const INTENT = Object.freeze({
  schema: "agent-kernel/IntentEnvelope",
  schemaVersion: 1,
  meta: { id: "intent_test", runId: "run_p21", createdAt: "2026-07-20T00:00:00.000Z" },
  intent: { goal: "a small dark room with one warden", tags: ["dark"] },
});

async function makeDirector() {
  const { createDirectorPersona } = await import(DIRECTOR);
  return createDirectorPersona({ clock: () => "2026-07-20T00:00:00.000Z" });
}

test("tick interface is unchanged (both planes drive one FSM)", async () => {
  const d = await makeDirector();
  assert.deepEqual([...d.subscribePhases], ["decide"]);
  assert.equal(d.view().state, "uninitialized");
});

test("beginBuild moves uninitialized → draft_plan and emits the PlanArtifact", async () => {
  const d = await makeDirector();
  const { state, planArtifact } = d.beginBuild(INTENT);
  assert.equal(state, "draft_plan");
  assert.equal(d.view().state, "draft_plan");
  assert.equal(planArtifact.schema, "agent-kernel/PlanArtifact");
  assert.equal(planArtifact.meta.producedBy, "director");
  assert.equal(planArtifact.intentRef.id, "intent_test");
  // The goal survives translation into the objective.
  assert.equal(planArtifact.plan.objectives[0].description, INTENT.intent.goal);
  assert.deepEqual(planArtifact.plan.theme.tags, ["dark"]);
  assert.equal(d.currentPlan(), planArtifact);
});

test("translation REFUSES before a build begins — the state gates real behavior", async () => {
  const d = await makeDirector();
  assert.throws(
    () => d.mapPool({ summary: {}, catalog: {} }),
    (e) => e.code === "director_state" && /uninitialized/.test(e.message),
  );
  assert.throws(
    () => d.assembleBuildSpec({ summary: {} }),
    (e) => e.code === "director_state",
  );
  // CR.4 M5b.2d: the relayed Allocator answers are gated for the same reason `mapPool` is —
  // pricing a build no round has begun is an artifact produced with no round. Without this
  // the relay would be a pass-through with a state check nothing exercised.
  assert.throws(
    () => d.evaluateLayoutSpend({ layout: { floorTiles: 1 }, budgetTokens: 100 }),
    (e) => e.code === "director_state",
  );
  // CR.4 M5b.2e. This assertion is here because the perturbation said so: with the gate
  // deleted the whole suite stayed green, so `buildCardSet`'s `requireState` was a label.
  // Every caller passes an open round, which is exactly what leaves a gate unexercised.
  assert.throws(
    () => d.buildCardSet({ actors: [] }),
    (e) => e.code === "director_state",
  );
  // CR.4 M5b.2f. Gated like the pricing relays: judging a build's layout against its actors
  // before any round exists is the same "artifact produced with no round" defect.
  assert.throws(
    () => d.assessFeasibility({ layout: { floorTiles: 10 }, actorCount: 1 }),
    (e) => e.code === "director_state",
  );
  assert.equal(d.view().state, "uninitialized", "a refusal does not move the FSM");
});

/**
 * ITEM C (2026-08-12) — `assessFeasibility` names the CALLER's omission, not derived geometry.
 *
 * The no-layout path derives a levelGen from `roomCount` via `deriveLevelGen`, which computes
 * `Math.max(5, roomCount * 2 + 5)` — `NaN` for any non-integer roomCount. The verdict that came
 * back therefore blamed `levelGen.width` and `levelGen.height`: two fields the caller never
 * supplied, describing an internal derivation instead of the missing input. No production caller
 * reaches it (both budget-loop sites pass a layout), which is precisely why it survived the move.
 *
 * ⚠️ **THE SCOPE OF THE REFUSAL IS THE POINT**, as with D8.3's card-free geometry. A guard that
 * fired whenever a layout was absent would delete the no-layout capability rather than fix it —
 * a supplied roomCount derives valid geometry and answers normally, so only the NaN case refuses.
 */
test("assessFeasibility refuses when it has neither a layout nor a usable roomCount", async () => {
  const d = await makeDirector();
  d.beginBuild(INTENT);

  const verdict = d.assessFeasibility({ actorCount: 1 });
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.errors,
    [{ field: "roomCount", code: "missing_layout_or_room_count" }],
    "the refusal names what the caller omitted, not the NaN geometry it would have derived",
  );

  // An integer roomCount still derives and still answers. `0` is included deliberately:
  // `Math.max(5, ...)` floors the side length, so zero rooms is a valid derivation rather than
  // the broken input, and a guard keyed on truthiness would have wrongly caught it.
  assert.deepEqual(d.assessFeasibility({ roomCount: 3, actorCount: 1 }), { ok: true, errors: [] });
  assert.deepEqual(d.assessFeasibility({ roomCount: 0, actorCount: 1 }), { ok: true, errors: [] });

  // And the path production actually takes is untouched.
  assert.deepEqual(
    d.assessFeasibility({ layout: { floorTiles: 10 }, actorCount: 1 }),
    { ok: true, errors: [] },
  );
});

test("beginBuild is idempotent-guarded: a second call in-round throws", async () => {
  const d = await makeDirector();
  d.beginBuild(INTENT);
  assert.throws(() => d.beginBuild(INTENT), (e) => e.code === "director_state");
});

test("beginBuild rejects a missing/invalid intent envelope", async () => {
  const d = await makeDirector();
  assert.throws(() => d.beginBuild(null), (e) => e.code === "director_state");
  assert.equal(d.view().state, "uninitialized");
});

test("assembleBuildSpec completes the round: draft_plan → ready", async () => {
  const d = await makeDirector();
  d.beginBuild(INTENT);
  const spec = d.assembleBuildSpec({
    summary: { dungeonAffinity: "dark", budgetTokens: 500 },
    runId: "run_p21",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  assert.ok(spec, "a build spec is produced");
  assert.equal(d.view().state, "ready", "the round closes");
  assert.equal(d.view().context.buildSpecCount, 1);
  assert.equal(d.view().context.planId, "plan_run_p21_0");
});

test("mapPool matches a direct pool-mapper call — the persona adds gating, not translation", async () => {
  const { mapSummaryToPool } = await import(
    "../../../packages/runtime/src/personas/director/pool-mapper.js"
  );
  const d = await makeDirector();
  d.beginBuild(INTENT);
  const summary = { dungeonAffinity: "dark", actors: [] };
  const catalog = { entries: [] };
  assert.deepEqual(d.mapPool({ summary, catalog }), mapSummaryToPool({ summary, catalog }));
});

test("view() stays JSON-serializable with the build-round context", async () => {
  const d = await makeDirector();
  d.beginBuild(INTENT);
  const v = d.view();
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
});

// ## TODO: Test Permutations
// - beginBuild with an intent lacking a goal: objective falls back to the ref id
// - a plan supplied directly (ingest_plan) instead of an intent
// - mapPool/assembleBuildSpec in REFINE and READY states
// - tick advance interleaved with a build round on the same persona instance
