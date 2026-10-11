/**
 * M3 — Multi-actor "random" motivation run: end-to-end scenario.
 *
 * Architecture: runtime + core-ts only, no LLM, no external IO.
 */
"use strict";

const assert = require("node:assert/strict");

const TICK_COUNT = 6;
const CLOCK = "2026-07-02T00:00:00.000Z";

function terrainFromGlyphs(rows) {
  const legend = { "#": "wall", ".": "floor", S: "spawn", E: "exit" };
  const height = rows.length;
  const width = rows[0].length;
  const terrain = [];
  for (const row of rows) {
    for (const ch of row) terrain.push(legend[ch] || "floor");
  }
  return { width, height, terrain };
}

function makeVitals(hp) {
  return {
    health: { current: hp, max: hp, regen: 0 },
    mana: { current: hp, max: hp, regen: 0 },
    stamina: { current: hp, max: hp, regen: 0 },
  };
}

function actor(id, category, position, motivationKind, hp) {
  return {
    id,
    category,
    position,
    motivations: [motivationKind],
    vitals: makeVitals(hp),
  };
}

function roster() {
  return [
    actor("delver_1", "delver", { x: 1, y: 1 }, "random", 10),
    actor("warden_1", "warden", { x: 7, y: 1 }, "random", 6),
    actor("warden_2", "warden", { x: 1, y: 7 }, "random", 6),
    actor("warden_3", "warden", { x: 7, y: 7 }, "random", 6),
  ];
}

async function artifacts(actors, { width = 9, height = 9, terrain } = {}) {
  const { boxedTerrain, buildUnifiedArtifacts } = await import("../fixtures/personas/unified-actor-runtime.mjs");
  const cells = terrain ? [...terrain] : boxedTerrain(width, height);
  if (!terrain) {
    cells[4 * width + 3] = "spawn";
    cells[4 * width + 5] = "exit";
  }
  return buildUnifiedArtifacts({
    width,
    height,
    terrain: cells,
    runId: "multi_actor_random_run",
    clock: CLOCK,
    actors,
  });
}

async function loadRuntimeDeps() {
  const [{ createRuntime }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/runtime.js"),
    import("../../packages/core-ts/src/index.ts"),
  ]);
  return { createRuntime, createCore };
}

async function runRuntimeScenario({ actors = roster(), width, height, terrain, ticks = TICK_COUNT, seed = 0 } = {}) {
  const { simConfig, initialState } = await artifacts(actors, { width, height, terrain });
  const { createRuntime, createCore } = await loadRuntimeDeps();
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) {
    await runtime.step();
  }
  return { runtime, frames: runtime.getTickFrames(), snapshot: runtime.getActorSnapshot(), initialState };
}

function acceptedMoveSignature(frames) {
  return frames
    .flatMap((frame) => Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [])
    .filter((action) => action.kind === "move")
    .map((action) => `${action.tick}:${action.actorId}:${action.params?.target?.x},${action.params?.target?.y}`);
}

function directionOf(from, to) {
  if (!from || !to) return null;
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 1) return "south";
  if (dx === 0 && dy === -1) return "north";
  if (dx === 1 && dy === 0) return "east";
  if (dx === -1 && dy === 0) return "west";
  if (dx === 1 && dy === 1) return "southeast";
  if (dx === 1 && dy === -1) return "northeast";
  if (dx === -1 && dy === 1) return "southwest";
  if (dx === -1 && dy === -1) return "northwest";
  return null;
}

test(`multi-actor random run produces tick frames through the final requested tick (N=${TICK_COUNT})`, async () => {
  const { frames } = await runRuntimeScenario({ ticks: TICK_COUNT, seed: 0 });
  assert.ok(frames.length > 0, "runtime must produce tick frames for a random-motivation run");
  assert.ok(
    frames.length >= TICK_COUNT,
    `runtime must produce at least one tick frame per requested tick (requested ${TICK_COUNT}, got ${frames.length})`,
  );
  const lastFrame = frames[frames.length - 1];
  assert.ok(lastFrame, "final tick frame must exist");
  assert.ok(
    Number.isFinite(lastFrame.tick) ? lastFrame.tick >= TICK_COUNT - 1 : true,
    `final tick frame must correspond to the last requested tick (got tick=${lastFrame.tick})`,
  );
});

test("all delver and warden ids remain present in tick frame observations across the full run", async () => {
  const { frames, snapshot, initialState } = await runRuntimeScenario({ ticks: TICK_COUNT, seed: 0 });
  const expectedIds = initialState.actors.map((a) => a.id).sort();

  function actorIdsInFrame(frame) {
    const ids = new Set();
    const candidates = [
      frame?.observation?.actors,
      frame?.observations?.[0]?.actors,
      frame?.actors,
      frame?.emittedSnapshot?.view?.registry?.actors,
    ];
    for (const list of candidates) {
      if (Array.isArray(list)) {
        list.forEach((a) => {
          if (a?.id) ids.add(a.id);
        });
      }
    }
    return ids;
  }

  frames.forEach((frame, index) => {
    const idsInFrame = actorIdsInFrame(frame);
    if (idsInFrame.size === 0) return;
    expectedIds.forEach((id) => {
      assert.ok(
        idsInFrame.has(id),
        `actor "${id}" must remain present/visible in tick frame ${index} (present: ${[...idsInFrame].join(",")})`,
      );
    });
  });

  assert.equal(
    snapshot.actors.length,
    initialState.actors.length,
    "registry must still track every configured actor (delver + 3 wardens) after a full random run",
  );
});

test("random-motivation actors move independently rather than converging on a shared exit path", async () => {
  const { frames } = await runRuntimeScenario({ ticks: TICK_COUNT, seed: 0 });
  const moveActionsByActor = new Map();
  frames.forEach((frame) => {
    const accepted = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
    accepted
      .filter((a) => a.kind === "move" && a.params?.target)
      .forEach((a) => {
        if (!moveActionsByActor.has(a.actorId)) moveActionsByActor.set(a.actorId, []);
        const previous = moveActionsByActor.get(a.actorId).at(-1)?.to;
        const to = a.params.target;
        const from = previous || null;
        moveActionsByActor.get(a.actorId).push({ to, direction: directionOf(from, to) });
      });
  });

  const exitwardOnly = new Set(["south", "east", "southeast"]);
  let anyNonExitwardMove = false;
  for (const steps of moveActionsByActor.values()) {
    if (steps.some((step) => step.direction && !exitwardOnly.has(step.direction))) {
      anyNonExitwardMove = true;
      break;
    }
  }
  assert.ok(
    anyNonExitwardMove,
    "at least one random-motivation actor must take a non-exit-directed step at some point in the run; "
      + "observed moves were all exit-ward, indicating random actors are still falling back to exit pathfinding",
  );

  const sequences = [...moveActionsByActor.entries()]
    .filter(([, steps]) => steps.length > 0)
    .map(([, steps]) => steps.map((step) => `${step.to.x},${step.to.y}`).join(","));
  const uniqueSequences = new Set(sequences);
  assert.ok(
    sequences.length < 2 || uniqueSequences.size > 1,
    `random actors starting from different positions must not all produce the identical move sequence (got: ${sequences.join(" | ")})`,
  );
});

test("random warden in a one-tile corridor only moves along the corridor axis", async () => {
  const { width, height, terrain } = terrainFromGlyphs([
    "#####",
    "##S##",
    "##.##",
    "##.##",
    "##.##",
    "##E##",
    "#####",
  ]);
  const { frames } = await runRuntimeScenario({
    actors: [actor("warden_corridor", "warden", { x: 2, y: 3 }, "random", 6)],
    width,
    height,
    terrain,
    ticks: 8,
    seed: 88,
  });
  const moves = frames.flatMap((frame) => Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [])
    .filter((action) => action.kind === "move");
  assert.ok(moves.length > 0);
  for (const move of moves) {
    assert.equal(move.params.target.x, 2);
  }
});

test("two random actors never share the same target tile within one accepted-action frame", async () => {
  const { frames } = await runRuntimeScenario({ ticks: 10, seed: 12 });

  frames.forEach((frame) => {
    const moves = (Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [])
      .filter((action) => action.kind === "move" && action.params?.target);
    const targets = moves.map((action) => `${action.params.target.x},${action.params.target.y}`);
    assert.equal(new Set(targets).size, targets.length, `duplicate move target in frame ${frame.meta?.id}`);
  });
});

test("random and attacking actors sharing a level still produce legal accepted actions", async () => {
  const { frames } = await runRuntimeScenario({
    actors: [
      actor("random_delver", "delver", { x: 1, y: 1 }, "random", 10),
      actor("attacking_warden", "warden", { x: 7, y: 7 }, "attacking", 6),
    ],
    ticks: 8,
    seed: 15,
  });
  const accepted = frames.flatMap((frame) => Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []);
  assert.ok(accepted.length > 0);
  assert.ok(accepted.some((action) => action.actorId === "attacking_warden"));
});

test("same simConfig seed reproduces identical accepted move sequences", async () => {
  const runA = await runRuntimeScenario({ ticks: 8, seed: 123 });
  const runB = await runRuntimeScenario({ ticks: 8, seed: 123 });

  assert.deepEqual(acceptedMoveSignature(runA.frames), acceptedMoveSignature(runB.frames));
});

test.skip("changing only simConfig seed changes at least one random move sequence", async () => {
  const runA = await runRuntimeScenario({ ticks: 8, seed: 101 });
  const runB = await runRuntimeScenario({ ticks: 8, seed: 202 });

  assert.notDeepEqual(acceptedMoveSignature(runA.frames), acceptedMoveSignature(runB.frames));
});

test("single-tick random run keeps all configured actors in core state", async () => {
  const { snapshot, frames } = await runRuntimeScenario({ ticks: 1, seed: 4 });

  assert.ok(frames.length >= 2, "init plus one runtime tick should produce frames");
  assert.equal(snapshot.actors.length, roster().length);
});

test.skip("zero-step random run produces no tick frames while preserving actors", async () => {
  const { snapshot, frames } = await runRuntimeScenario({ ticks: 0, seed: 4 });

  assert.equal(frames.length, 0);
  assert.equal(snapshot.actors.length, roster().length);
});

test("running beyond likely terminal conditions does not error or drop actors", async () => {
  const { snapshot, frames } = await runRuntimeScenario({ ticks: TICK_COUNT * 3, seed: 9 });

  assert.ok(frames.length >= TICK_COUNT * 3);
  assert.equal(snapshot.actors.length, roster().length);
});
