/**
 * M7 — CLI `create` + `run` path must move EVERY actor, not just actors[0].
 *
 * The runtime DECIDE-phase fix (tests/runtime/multi-actor-orchestration.test.js)
 * loops all tracked actors, and it works through createPlaybackRuntime. But the
 * CLI `run` command reaches the runtime through createCommandRuntimeCore()
 * (packages/runtime/src/commands/kernel.js), which exposes a hand-picked subset
 * of the core surface. Capability checks in the runtime (applyInitialStateToCore
 * and friends) silently degrade to the legacy single-actor spawn path when the
 * functions they probe for are missing from that subset — so a CLI-authored
 * multi-actor run still moves only initialState.actors[0].
 *
 * This test drives the exact executeCommand seam the MCP server uses (same
 * harness as mcp-cli-ui-random-scenario.test.js) and asserts per-actor action
 * coverage, which no other test pins at this seam.
 */
"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, existsSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

let ak_impl;

async function loadImpl() {
  ak_impl ??= await import("../../packages/adapters-cli/src/cli/ak-impl.mjs");
  return ak_impl;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function runCliCommand(executeCommand, command, argv) {
  const stdoutChunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  console.log = (...parts) => {
    stdoutChunks.push(`${parts.map(String).join(" ")}\n`);
  };
  try {
    await executeCommand(command, argv);
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  const lines = stdoutChunks.join("").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep scanning backwards for the JSON payload
    }
  }
  throw new Error(`runCliCommand(${command}): no JSON payload found in stdout`);
}

describe("CLI create+run moves every actor (kernel command-core surface)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-cli-multi-actor-"));
  });

  afterAll(() => {
    if (outDir && existsSync(outDir)) {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("every random-motivation actor from create appears in accepted actions across a CLI run", async () => {
    const impl = await loadImpl();

    const createResult = await runCliCommand(impl.executeCommand, "create", [
      "--room", "count=1;size=medium",
      "--delver", "count=1;affinity=water;motivation=random",
      "--warden", "count=2;affinity=fire;motivation=random",
      "--run-id", "cli_multi_actor_movement",
      "--out-dir", outDir,
    ]);
    assert.equal(createResult.ok, true, `create must succeed: ${JSON.stringify(createResult)}`);

    const initialState = readJson(join(outDir, "initial-state.json"));
    const actorIds = (initialState.actors || []).map((a) => a.id);
    assert.equal(actorIds.length, 3, `expected 3 actors, got ${actorIds.length}`);

    const runOutDir = join(outDir, "run");
    const runResult = await runCliCommand(impl.executeCommand, "run", [
      "--sim-config", join(outDir, "sim-config.json"),
      "--initial-state", join(outDir, "initial-state.json"),
      "--ticks", "24",
      "--run-id", "cli_multi_actor_movement_run",
      "--out-dir", runOutDir,
    ]);
    assert.equal(runResult.ok, true, `run must succeed: ${JSON.stringify(runResult)}`);

    const tickFrames = readJson(join(runOutDir, "tick-frames.json"));
    const frames = Array.isArray(tickFrames?.frames) ? tickFrames.frames : tickFrames;
    assert.ok(Array.isArray(frames) && frames.length > 0, "run must produce tick frames");

    // Every actor must be the subject of at least one accepted action (move or
    // wait) somewhere in the run. With the command-core subset bug, only
    // actors[0] ever gets actions.
    const actedActorIds = new Set();
    for (const frame of frames) {
      const actions = Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : [];
      for (const action of actions) {
        if (typeof action?.actorId === "string") {
          actedActorIds.add(action.actorId);
        }
      }
    }

    for (const actorId of actorIds) {
      assert.ok(
        actedActorIds.has(actorId),
        `actor ${actorId} never received an accepted action across ${frames.length} frames — ` +
          `acting actors were ${JSON.stringify([...actedActorIds])}; the CLI run path is ` +
          "degrading to single-actor orchestration (createCommandRuntimeCore subset)",
      );
    }
  });
});

// ── Permutations expanded from TODO stubs ──

describe("CLI create+run multi-actor permutations", () => {
  let permOutRoot;

  beforeAll(() => {
    permOutRoot = mkdtempSync(join(os.tmpdir(), "ak-cli-multi-actor-perm-"));
  });

  afterAll(() => {
    if (permOutRoot && existsSync(permOutRoot)) {
      rmSync(permOutRoot, { recursive: true, force: true });
    }
  });

  async function createAndRun(name, { createArgs, ticks }) {
    const impl = await loadImpl();
    const outDir = join(permOutRoot, name);
    const createResult = await runCliCommand(impl.executeCommand, "create", [
      "--room", "count=1;size=medium",
      ...createArgs,
      "--run-id", `perm_${name}`,
      "--out-dir", outDir,
    ]);
    assert.equal(createResult.ok, true, `create must succeed: ${JSON.stringify(createResult)}`);
    const initialState = readJson(join(outDir, "initial-state.json"));
    const runOutDir = join(outDir, "run");
    const runResult = await runCliCommand(impl.executeCommand, "run", [
      "--sim-config", join(outDir, "sim-config.json"),
      "--initial-state", join(outDir, "initial-state.json"),
      "--ticks", String(ticks),
      "--run-id", `perm_${name}_run`,
      "--out-dir", runOutDir,
    ]);
    assert.equal(runResult.ok, true, `run must succeed: ${JSON.stringify(runResult)}`);
    const tickFrames = readJson(join(runOutDir, "tick-frames.json"));
    const frames = Array.isArray(tickFrames?.frames) ? tickFrames.frames : tickFrames;
    return { initialState, frames };
  }

  function collectActedActorIds(frames) {
    const acted = new Set();
    for (const frame of frames) {
      for (const action of Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []) {
        if (typeof action?.actorId === "string") acted.add(action.actorId);
      }
    }
    return acted;
  }

  test("warden-only roster (no delver): every warden acts", async () => {
    const { initialState, frames } = await createAndRun("warden_only", {
      createArgs: ["--warden", "count=3;affinity=fire;motivation=random"],
      ticks: 24,
    });
    const wardenIds = initialState.actors.map((a) => a.id);
    assert.equal(wardenIds.length, 3, `expected 3 wardens, got ${wardenIds.length}`);
    const acted = collectActedActorIds(frames);
    for (const id of wardenIds) {
      assert.ok(acted.has(id), `warden ${id} never acted; acting: ${JSON.stringify([...acted])}`);
    }
  });

  test("acceptance scale: 11-actor roster all act across 100 ticks", async () => {
    const { initialState, frames } = await createAndRun("acceptance_scale", {
      createArgs: [
        "--delver", "count=1;affinity=water;motivation=random",
        "--warden", "count=10;affinity=fire;motivation=random",
      ],
      ticks: 100,
    });
    const ids = initialState.actors.map((a) => a.id);
    assert.equal(ids.length, 11, `expected 11 actors, got ${ids.length}`);
    const acted = collectActedActorIds(frames);
    for (const id of ids) {
      assert.ok(acted.has(id), `actor ${id} never acted across 100 ticks`);
    }
  });

  test("mixed motivations: random actors act while a stationary actor holds position", async () => {
    const { initialState, frames } = await createAndRun("mixed_motivation", {
      createArgs: [
        "--delver", "count=1;affinity=water;motivation=random",
        "--warden", "count=1;affinity=fire;motivation=random",
        "--warden", "count=1;affinity=earth;motivation=stationary",
      ],
      ticks: 24,
    });
    const stationary = initialState.actors.find((a) => a?.motivation?.kind === "stationary");
    const randoms = initialState.actors.filter((a) => a?.motivation?.kind === "random");
    assert.ok(stationary, "roster must include the stationary warden");
    assert.equal(randoms.length, 2, "roster must include both random actors");

    const acted = collectActedActorIds(frames);
    for (const actor of randoms) {
      assert.ok(acted.has(actor.id), `random actor ${actor.id} never acted`);
    }
    // Stationary means never proposing movement: no accepted move action, and
    // its position in every frame's accepted moves stays untouched.
    const stationaryMoves = [];
    for (const frame of frames) {
      for (const action of Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []) {
        if (action?.actorId === stationary.id && action?.kind === "move") {
          stationaryMoves.push(action);
        }
      }
    }
    assert.equal(stationaryMoves.length, 0,
      `stationary actor must not move, saw ${JSON.stringify(stationaryMoves)}`);
  });

  test("tick count 1 boundary: every actor receives its DECIDE pass in the single tick", async () => {
    const { initialState, frames } = await createAndRun("single_tick", {
      createArgs: [
        "--delver", "count=1;affinity=water;motivation=random",
        "--warden", "count=2;affinity=fire;motivation=random",
      ],
      ticks: 1,
    });
    const ids = initialState.actors.map((a) => a.id);
    assert.equal(ids.length, 3);
    const acted = collectActedActorIds(frames);
    for (const id of ids) {
      assert.ok(acted.has(id), `actor ${id} did not act in the single tick`);
    }
  });
});
