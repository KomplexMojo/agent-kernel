/**
 * M6 — Delver vs Warden battle: end-to-end scenario run
 *
 * Loads the deterministic scenario fixture (delver-warden-battle-v1-basic.json),
 * runs it through the runtime for the fixture's specified tick count, and
 * verifies the expected movement → battle → defeat progression.
 *
 * This is the canonical sandbox scenario from the M1 contract:
 *   - 5×5 single-row room
 *   - delver_1 (attacking) at (1,2), HP 10
 *   - warden_1 (defending) at (3,2), HP 6
 *   - delver moves east toward warden, then attacks until HP 0
 *
 * Architecture: runtime + core-ts only, no LLM, no external IO.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const FIXTURE_PATH = resolve(
  __dirname,
  "../fixtures/scenarios/delver-warden-battle-v1-basic.json",
);

function loadScenario() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

// ---------------------------------------------------------------------------
// Fixture schema validation
// ---------------------------------------------------------------------------

test("scenario fixture has required structure for runtime ingestion", () => {
  const s = loadScenario();
  assert.equal(s.$schema, "agent-kernel/Scenario");
  assert.equal(s.simConfig?.schema, "agent-kernel/SimConfigArtifact");
  assert.equal(s.initialState?.schema, "agent-kernel/InitialStateArtifact");
  assert.ok(Array.isArray(s.initialState.actors), "initialState.actors is an array");
  assert.equal(s.initialState.actors.length, 2, "exactly 2 actors (delver + warden)");
  const delver = s.initialState.actors.find((a) => a.id === "delver_1");
  const warden = s.initialState.actors.find((a) => a.id === "warden_1");
  assert.ok(delver && warden, "both delver_1 and warden_1 are present");
  assert.equal(delver.motivation?.kind, "attacking");
  assert.equal(warden.motivation?.kind, "defending");
});

// ---------------------------------------------------------------------------
// CLI authoring compatibility — motivation kinds used by the fixture must be
// valid CLI motivation strings recognized by the delver/warden parsers.
// ---------------------------------------------------------------------------

test("fixture motivations match CLI-allowed motivation kinds", async () => {
  const { ALLOWED_MOTIVATIONS } = await import(
    "../../packages/runtime/src/personas/orchestrator/prompt-contract.js"
  );
  const s = loadScenario();
  for (const actor of s.initialState.actors) {
    const m = actor.motivation?.kind;
    assert.ok(
      ALLOWED_MOTIVATIONS.includes(m),
      `motivation "${m}" must be in ALLOWED_MOTIVATIONS (${ALLOWED_MOTIVATIONS.join(",")})`,
    );
  }
});

// ---------------------------------------------------------------------------
// End-to-end runtime execution
// ---------------------------------------------------------------------------

test("scenario runs from initial state to terminal/max-tick completion with movement and battle frames", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const s = loadScenario();
  const core = createCore();
  const runtime = createRuntime({ core, adapters: {} });

  await runtime.init({
    seed: 0,
    simConfig: s.simConfig,
    initialState: s.initialState,
  });

  // Step through every tick declared in the scenario
  const ticks = s.ticks;
  assert.ok(ticks >= 4, "scenario must declare at least 4 ticks for full battle");
  for (let t = 0; t < ticks; t++) {
    await runtime.step();
  }

  const frames = runtime.getTickFrames();
  assert.ok(frames.length > 0, "runtime must produce tick frames");

  // ── 1. Movement frame: delver_1 moves east on first tick ──
  const moveFrames = frames.filter(
    (f) => Array.isArray(f?.acceptedActions) &&
           f.acceptedActions.some((a) => a.kind === "move" && a.actorId === "delver_1"),
  );
  assert.ok(moveFrames.length > 0, "scenario must contain at least one accepted move frame for delver");

  const firstMove = moveFrames[0].acceptedActions.find(
    (a) => a.kind === "move" && a.actorId === "delver_1",
  );
  assert.equal(
    firstMove.params.direction,
    s.expected.expectedFirstMoveDirection,
    `first delver move should be ${s.expected.expectedFirstMoveDirection}`,
  );

  // ── 2. Battle frames: at least 3 accepted attack actions targeting warden_1 ──
  const attackFrames = frames.filter(
    (f) => Array.isArray(f?.acceptedActions) &&
           f.acceptedActions.some(
             (a) => a.kind === "attack" &&
                    a.actorId === "delver_1" &&
                    a.params?.targetId === "warden_1",
           ),
  );
  assert.ok(
    attackFrames.length >= s.expected.minAttackFrames,
    `expected at least ${s.expected.minAttackFrames} attack frames, got ${attackFrames.length}`,
  );

  // ── 3. Warden HP reaches expected final value via core state ──
  // Actor index 1 is warden (sorted: delver_1, warden_1), vital kind 0 = health
  const wardenFinalHp = core.getMotivatedActorVitalCurrentByIndex(1, 0);
  assert.equal(
    wardenFinalHp,
    s.expected.wardenFinalHp,
    `warden HP should be exactly ${s.expected.wardenFinalHp}, got ${wardenFinalHp}`,
  );

  // ── 4. Delver final position matches expected (adjacent to warden) ──
  const delverFinalX = core.getMotivatedActorXByIndex(0);
  const delverFinalY = core.getMotivatedActorYByIndex(0);
  assert.deepEqual(
    { x: delverFinalX, y: delverFinalY },
    s.expected.delverFinalPosition,
    "delver final position should match scenario expectation",
  );
});

// ---------------------------------------------------------------------------
// Determinism: re-running the scenario from the same fixture must produce the
// same tick frame summary.
// ---------------------------------------------------------------------------

test("scenario is deterministic: two independent runs produce identical accepted-action sequences", async () => {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  const s = loadScenario();

  async function runOnce() {
    const core = createCore();
    const runtime = createRuntime({ core, adapters: {} });
    await runtime.init({ seed: 0, simConfig: s.simConfig, initialState: s.initialState });
    for (let t = 0; t < s.ticks; t++) await runtime.step();
    const frames = runtime.getTickFrames();
    return frames
      .flatMap((f) => f?.acceptedActions || [])
      .map((a) => ({ kind: a.kind, actorId: a.actorId, params: a.params }));
  }

  const a = await runOnce();
  const b = await runOnce();
  assert.deepEqual(a, b, "two independent runs must produce identical accepted-action sequences");
});
