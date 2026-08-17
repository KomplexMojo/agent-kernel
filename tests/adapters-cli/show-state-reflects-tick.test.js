/**
 * AM.0b — `ak_show_state` must show the state at the cursor tick (F11, part 2).
 *
 * Two defects, both invisible from the outside because the output always looked
 * like a plausible map:
 *
 *   1. `renderAscii(runDir)` took NO tick. It rebuilt core from
 *      `initial-state.json` and rendered that, so the answer to "show me the
 *      state" was the STARTING state at every cursor position.
 *   2. It called `renderBaseTiles`, which draws terrain only — so no actor was
 *      ever drawn on the map it returned.
 *
 * Together, a caller stepping the cursor forward saw a map that never changed
 * and never contained an actor, with nothing in the payload admitting it.
 *
 * These tests drive the same `renderAscii` the MCP `ak_show_state` tool and the
 * CLI `show-state` path both call.
 */
"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, existsSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

let impl;
async function loadImpl() {
  impl ??= await import("../../packages/adapters-cli/src/cli/ak-impl.mjs");
  return impl;
}

async function runCli(executeCommand, command, argv) {
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  console.log = (...parts) => chunks.push(`${parts.map(String).join(" ")}\n`);
  try {
    await executeCommand(command, argv);
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  const lines = chunks.join("").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* keep scanning */ }
  }
  return null;
}

function countGlyph(ascii, glyph) {
  return ascii.split("").filter((c) => c === glyph).length;
}

describe("ak_show_state reflects the cursor tick", () => {
  let workDir;
  let runDir;

  beforeAll(async () => {
    const { executeCommand } = await loadImpl();
    workDir = mkdtempSync(join(os.tmpdir(), "ak-show-state-"));
    // The session layout `renderAscii` reads: build artifacts under
    // <runDir>/create, run outputs under <runDir>/run (see resolveBuildArtifact
    // in packages/adapters-cli/src/tick-session.mjs).
    runDir = workDir;

    const created = await runCli(executeCommand, "create", [
      "--room", "size=medium;count=1",
      "--delver", "count=1;affinity=water;motivation=random",
      "--warden", "count=2;affinity=fire;motivation=random",
      "--run-id", "show_state_probe",
      "--out-dir", join(runDir, "create"),
    ]);
    assert.equal(created?.ok, true, "create must succeed");

    const ran = await runCli(executeCommand, "run", [
      "--sim-config", join(runDir, "create", "sim-config.json"),
      "--initial-state", join(runDir, "create", "initial-state.json"),
      "--ticks", "12",
      "--run-id", "show_state_probe_run",
      "--out-dir", join(runDir, "run"),
    ]);
    assert.equal(ran?.ok, true, "run must succeed");
  });

  afterAll(() => {
    if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  });

  test("the run writes a world-state artifact recording where every actor ended up", () => {
    const worldState = JSON.parse(readFileSync(join(runDir, "run", "world-state.json"), "utf8"));
    const initialState = JSON.parse(readFileSync(join(runDir, "create", "initial-state.json"), "utf8"));

    assert.equal(worldState.schema, "agent-kernel/WorldStateArtifact");
    assert.equal(worldState.tick, 12, "the snapshot's tick must equal the ticks the run was asked for");
    assert.equal(worldState.actors.length, initialState.actors.length);

    const moved = worldState.actors.filter((entry) => {
      const start = initialState.actors.find((a) => a.id === entry.id)?.position;
      return start && (start.x !== entry.position.x || start.y !== entry.position.y);
    });
    assert.ok(
      moved.length > 0,
      "a 12-tick run of random-motivation actors must move somebody, and the artifact must show it",
    );
  });

  test("renderAscii draws actors on the map", async () => {
    const { renderAscii } = await import("../../packages/adapters-cli/src/tick-session.mjs");
    const ascii = await renderAscii(runDir, 12);
    assert.ok(ascii.length > 0, "the run must render");
    assert.ok(
      countGlyph(ascii, "@") > 0,
      "actors must appear on the map — renderBaseTiles alone draws terrain only, "
        + `so 'show me the state' returned a map with nobody in it:\n${ascii}`,
    );
  });

  test("the rendered map CHANGES between an early tick and a late one", async () => {
    const { renderAscii } = await import("../../packages/adapters-cli/src/tick-session.mjs");
    const early = await renderAscii(runDir, 0);
    const late = await renderAscii(runDir, 12);

    assert.ok(early.length > 0 && late.length > 0, "both ticks must render");
    assert.notEqual(
      late,
      early,
      "the map at tick 12 must differ from tick 0. Identical output means the tick argument is "
        + "being ignored and the caller is always being shown the starting state.",
    );
  });

  test("tick 0 shows every actor at its authored spawn", async () => {
    const { renderAscii } = await import("../../packages/adapters-cli/src/tick-session.mjs");
    const initialState = JSON.parse(readFileSync(join(runDir, "create", "initial-state.json"), "utf8"));
    const rows = (await renderAscii(runDir, 0)).split("\n");

    initialState.actors.forEach((actor) => {
      const { x, y } = actor.position;
      assert.equal(
        rows[y]?.[x],
        "@",
        `${actor.id} must be drawn at its spawn ${x},${y} when the cursor is at tick 0`,
      );
    });
  });
});

// ## TODO: Test Permutations
//
// - cursor ticks 1, 2, mid-run, final, and beyond the final tick (must clamp,
//   not throw, and must not silently fall back to the starting state)
// - a single-actor run, and an 11-actor run
// - a roster of only stationary actors: the map must be IDENTICAL across ticks,
//   which is the honest version of the bug this file pins — prove it is the
//   actors holding still and not the tick being ignored, by comparing against a
//   random-motivation run over the same layout
// - a run whose moves core rejected: the glyph must stay at spawn, because
//   renderAscii follows acceptedActions and AM.1 keeps rejections out of them
