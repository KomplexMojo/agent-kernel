/**
 * I2 — blocking=true hazards are always rejected as hazard_on_wall regardless of
 * position: failing base tests (interface-testing benchmark sweep, 2026-07-09).
 *
 * Seam driven (same seam the MCP server uses):
 *   packages/adapters-cli/src/mcp/tools/authoring.mjs ak_create buildArgs
 *   -> packages/adapters-cli/src/cli/ak-impl.mjs executeCommand("create", argv)
 *
 * GROUND TRUTH (confirmed by direct invocation during test authoring):
 *   - `--room "size=medium;count=1" --hazard "x=3;y=2;...;blocking=false"`
 *     succeeds, and the produced grid has floor (".") at (3,2).
 *   - The identical command with blocking=true throws
 *     "level-gen input invalid: hazards[0].position:hazard_on_wall".
 *   - blocking=true at (4,3) — also verified interior floor — fails the same
 *     way. No blocking-hazard coordinate was found that passes.
 *   Hypothesis for remediation: the blocking hazard converts its own tile to a
 *   wall (or is modeled as a wall overlay) before the hazard-position validation
 *   runs, so it always trips its own check. Benchmark scenarios 12, 17, 31,
 *   39, 44, 49, 50 fail on this rule with their canonical vault payloads.
 *
 * Architecture: adapters-cli seam only, fixture-first, no live LLM/network,
 * no subprocess (executeCommand runs in-process exactly like the MCP server).
 */
"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

let ak_impl;
let authoringToolsModule;

async function loadModules() {
  ak_impl ??= await import("../../packages/adapters-cli/src/cli/ak-impl.mjs");
  authoringToolsModule ??= await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  return { ak_impl, authoringToolsModule };
}

function findTool(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `expected MCP tool definition for ${name}`);
  return tool;
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
  let thrown = null;
  try {
    await executeCommand(command, argv);
  } catch (err) {
    thrown = err;
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  if (thrown) return { ok: false, error: thrown.message };
  const text = stdoutChunks.join("").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep scanning backwards for the JSON payload
    }
  }
  return { ok: false, error: `no JSON payload in stdout: ${text.slice(0, 200)}` };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function floorAt(layoutData, x, y) {
  const ch = layoutData.tiles?.[y]?.[x];
  return ch !== undefined && layoutData.legend?.[ch]?.tile !== "wall";
}

const HAZARD_COORD = { x: 3, y: 2 };

let permutationOutDir;

beforeAll(() => {
  permutationOutDir = mkdtempSync(join(os.tmpdir(), "ak-i2-permutations-"));
});

afterAll(() => {
  rmSync(permutationOutDir, { recursive: true, force: true });
});

describe("create blocking hazard placement (I2: blocking=true always hazard_on_wall)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-i2-blocking-hazard-"));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("non-blocking hazard at (3,2) succeeds and (3,2) is a floor tile (contract pin — passes today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const dir = join(outDir, "nonblocking");
    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["size=medium;count=1"],
        hazard: [`x=${HAZARD_COORD.x};y=${HAZARD_COORD.y};affinity=earth;expression=emit;stacks=2;blocking=false`],
        budgetTokens: 1500,
        runId: "i2_nonblocking_hazard",
        outDir: dir,
      }),
    );
    assert.equal(result.ok, true, `non-blocking hazard create must succeed: ${result.error}`);

    const layoutData = JSON.parse(readFileSync(join(dir, "sim-config.json"), "utf8")).layout.data;
    // Updated 2026-07-11 (Codex adversarial review): pin the MAPPED hazard
    // coordinate from layout.data.hazards, not the authored room-relative one —
    // under the room-relative contract the stored x/y are absolute grid coords.
    const storedHazard = layoutData.hazards?.[0];
    assert.ok(storedHazard, "sim-config layout.data.hazards must contain the authored hazard");
    assert.ok(
      floorAt(layoutData, storedHazard.x, storedHazard.y),
      `mapped hazard coordinate (${storedHazard.x},${storedHazard.y}) must be a floor tile in the generated grid`,
    );
  });

  test("blocking hazard coexists with an exact floorTile target (regression: blocked cell must not count as walkable)", async () => {
    // Pinned 2026-07-11 from the Codex adversarial review of M3/M4: a blocking
    // hazard's cell renders as a floor glyph but is movement-blocked, so it must
    // not count toward walkableTilesTarget — previously this shape failed with
    // "level-gen input invalid: walkableTilesTarget:target_mismatch" while the
    // identical non-blocking request succeeded.
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["size=medium;count=1"],
        floorTile: ["count=20"],
        hazard: [`x=${HAZARD_COORD.x};y=${HAZARD_COORD.y};affinity=fire;expression=emit;stacks=1;blocking=true`],
        budgetTokens: 2000,
        runId: "i2_blocking_hazard_floor_target",
        outDir: join(outDir, "blocking-floor-target"),
      }),
    );
    assert.equal(
      result.ok,
      true,
      `blocking hazard + floorTile count=20 must succeed — got error: ${result.error}`,
    );
  });

  test("blocking hazard at the same verified floor tile (3,2) succeeds (FAILS today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["size=medium;count=1"],
        hazard: [`x=${HAZARD_COORD.x};y=${HAZARD_COORD.y};affinity=earth;expression=emit;stacks=2;blocking=true`],
        budgetTokens: 1500,
        runId: "i2_blocking_hazard",
        outDir: join(outDir, "blocking"),
      }),
    );
    assert.equal(
      result.ok,
      true,
      `blocking hazard on a verified floor tile must be accepted — got error: ${result.error} ` +
        "(every blocking=true hazard is rejected as hazard_on_wall today, regardless of position; " +
        "the hazard appears to wall its own tile before position validation runs. Benchmark " +
        "scenarios 12/17/31/39/44/49/50 fail on their canonical vault payloads because of this)",
    );
  });
});

// ## TODO: Test Permutations (expanded 2026-07-11 — M5)
test("i2 blocking hazard on an actual wall coordinate is remapped into the room interior and accepted", async () => {
  // Updated 2026-07-11: the stubbed rejection no longer matches current behavior.
  // A blocking hazard authored at (0,0) is accepted and stored at the room's
  // interior origin instead of failing hazard_on_wall.
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "wall-coordinate");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: ["x=0;y=0;affinity=earth;expression=emit;stacks=2;blocking=true"],
      budgetTokens: 1500,
      runId: "i2_blocking_hazard_wall_coordinate",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `blocking hazard at the authored wall coordinate must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  const room = layoutData.rooms?.[0];
  const storedHazard = layoutData.hazards?.[0];
  assert.ok(room, "sim-config layout must declare a room");
  assert.ok(storedHazard, "blocking hazard should be present in layout.data.hazards");
  assert.equal(storedHazard.x, room.x, "wall-authored blocking hazard should map to the room's interior origin x");
  assert.equal(storedHazard.y, room.y, "wall-authored blocking hazard should map to the room's interior origin y");
  assert.ok(floorAt(layoutData, storedHazard.x, storedHazard.y), "mapped blocking hazard must land on a floor tile");
});

test("i2 blocking and non-blocking hazards coexist on adjacent floor tiles", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "adjacent-mixed");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: [
        "x=0;y=0;affinity=earth;expression=emit;stacks=2;blocking=true",
        "x=1;y=0;affinity=fire;expression=emit;stacks=1;blocking=false",
      ],
      budgetTokens: 1600,
      runId: "i2_blocking_and_nonblocking_adjacent",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `adjacent blocking/non-blocking hazards must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  assert.equal(layoutData.hazards?.length, 2, "both hazards should be preserved");
  for (const hazard of layoutData.hazards) {
    assert.ok(floorAt(layoutData, hazard.x, hazard.y), `hazard at (${hazard.x},${hazard.y}) must sit on a floor tile`);
  }
  assert.notDeepEqual(
    layoutData.hazards[0],
    layoutData.hazards[1],
    "adjacent authored hazards should remain distinct after mapping into the room",
  );
});

test("i2 blocking hazard accepted in small and large rooms at interior coordinates", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const smallDir = join(permutationOutDir, "small-blocking");
  const largeDir = join(permutationOutDir, "large-blocking");
  const smallResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=small;count=1"],
      hazard: ["x=0;y=0;affinity=earth;expression=emit;stacks=2;blocking=true"],
      budgetTokens: 1500,
      runId: "i2_small_blocking",
      outDir: smallDir,
    }),
  );
  const largeResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=large;count=1"],
      hazard: ["x=0;y=0;affinity=earth;expression=emit;stacks=2;blocking=true"],
      budgetTokens: 1500,
      runId: "i2_large_blocking",
      outDir: largeDir,
    }),
  );

  assert.equal(smallResult.ok, true, `small blocking hazard must succeed: ${smallResult.error}`);
  assert.equal(largeResult.ok, true, `large blocking hazard must succeed: ${largeResult.error}`);

  const smallHazard = readJson(join(smallDir, "sim-config.json")).layout.data.hazards?.[0];
  const largeHazard = readJson(join(largeDir, "sim-config.json")).layout.data.hazards?.[0];
  assert.equal(smallHazard.blocking, true, "small blocking hazard must preserve blocking=true");
  assert.equal(largeHazard.blocking, true, "large blocking hazard must preserve blocking=true");
  assert.equal(smallHazard.affinity?.targetType, "floor", "small blocking hazard should target floor tiles");
  assert.equal(largeHazard.affinity?.targetType, "floor", "large blocking hazard should target floor tiles");
});

test("i2 two blocking hazards at distinct floor tiles are both accepted", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "two-blocking");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: [
        "x=0;y=0;affinity=earth;expression=emit;stacks=2;blocking=true",
        "x=1;y=0;affinity=water;expression=emit;stacks=1;blocking=true",
      ],
      budgetTokens: 1600,
      runId: "i2_two_blocking",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `two blocking hazards on distinct floor tiles must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  assert.equal(layoutData.hazards?.length, 2, "both blocking hazards should remain in the final layout");
  for (const hazard of layoutData.hazards) {
    assert.ok(floorAt(layoutData, hazard.x, hazard.y), `blocking hazard at (${hazard.x},${hazard.y}) must sit on floor`);
    assert.equal(hazard.blocking, true, "both hazards should preserve blocking=true");
  }
});

test("i2 accepted blocking hazards keep the floor target metadata used by downstream movement", async () => {
  // Downstream pathing is out of scope for the create seam, so this pins the
  // actual persisted metadata the runtime would consume instead of simulating
  // movement through the grid here.
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "blocking-metadata");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: ["x=0;y=0;affinity=earth;expression=emit;stacks=2;blocking=true"],
      floorTile: ["count=20"],
      budgetTokens: 2000,
      runId: "i2_blocking_metadata",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `blocking hazard + floorTile budget must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  const hazard = layoutData.hazards?.[0];
  assert.ok(hazard, "blocking hazard should be present in the final layout");
  assert.equal(hazard.blocking, true, "blocking hazard metadata must persist as blocking=true");
  assert.equal(hazard.affinity?.targetType, "floor", "blocking hazard should continue to target floor tiles");
  assert.ok(floorAt(layoutData, hazard.x, hazard.y), "persisted blocking hazard should land on a floor tile");
});
