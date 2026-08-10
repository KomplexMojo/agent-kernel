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
  assert.equal(d.view().state, "uninitialized", "a refusal does not move the FSM");
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
