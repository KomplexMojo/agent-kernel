/**
 * I3 — explicit hazard coordinates land outside every declared room, carving
 * stray floor in the void: failing base tests (interface-testing benchmark
 * sweep, 2026-07-09).
 *
 * Seam driven (same seam the MCP server uses):
 *   packages/adapters-cli/src/mcp/tools/authoring.mjs ak_create buildArgs
 *   -> packages/adapters-cli/src/cli/ak-impl.mjs executeCommand("create", argv)
 *
 * GROUND TRUTH (confirmed by direct invocation during test authoring, and
 * rendered visually by index_c.html via ak_push_to_ui):
 *   - Benchmark scenario 24 ("Hazard Gauntlet": 2 rooms + 4 non-blocking hazards
 *     at (1,1),(2,2),(3,3),(4,4)) produces a 30x30 grid where all 4 hazards sit
 *     on a disconnected diagonal of carved floor in the top-left corner —
 *     outside both declared rooms and unreachable from spawn. The UI renders
 *     floating hazard icons in the void.
 *   - A hazard at (0,0) IS rejected as hazard_on_wall, so raw coordinates are
 *     validated against the pre-carve border only: they are neither translated
 *     into room space nor validated against the final generated geometry.
 *   ADJUDICATED CONTRACT (developer decision, 2026-07-09): authored hazard x/y
 *   are ROOM-RELATIVE. The generator maps them into the target room's
 *   interior, rejects coordinates exceeding the room's bounds with a
 *   structured error, never carves floor outside declared rooms, and
 *   validates the mapped in-room tile after carving. The assertions below are
 *   outcome-level (on-floor, in-room, reachable) so they hold regardless of
 *   which room a hazard is mapped into.
 *   ADDITIONAL GROUND TRUTH: a hazard at raw (99,99) on a size=medium room
 *   today succeeds and silently inflates the grid to 102x102 to contain the
 *   coordinate — grid size is driven by raw hazard coords. Under the adjudicated
 *   contract that request must instead be rejected as out of the room's
 *   bounds (see the second test).
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

function inAnyRoom(rooms, x, y) {
  return rooms.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

function reachableFrom(layoutData, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const { x, y } = stack.pop();
    const key = `${x},${y}`;
    if (seen.has(key) || !floorAt(layoutData, x, y)) continue;
    seen.add(key);
    stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return seen;
}

let permutationOutDir;

beforeAll(() => {
  permutationOutDir = mkdtempSync(join(os.tmpdir(), "ak-i3-permutations-"));
});

afterAll(() => {
  rmSync(permutationOutDir, { recursive: true, force: true });
});

describe("create hazard room containment (I3: explicit hazard coords escape the level)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-i3-hazard-containment-"));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("every authored hazard lands inside a declared room and reachable from spawn (FAILS today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    // Scenario-24-shaped request: multi-room level with explicit hazard coords.
    // The floorTile spec is load-bearing: WITHOUT it the same hazard coordinates
    // are rejected as hazard_on_wall (the border is uncarved), and WITH it the
    // generator carves floor underneath the raw hazard coordinates in the void —
    // confirming coordinates are stamped, not mapped into room space.
    const dir = join(outDir, "gauntlet");
    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["count=2;size=large"],
        floorTile: ["count=32"],
        hazard: [
          "x=1;y=1;affinity=fire;expression=emit;stacks=1;blocking=false",
          "x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false",
        ],
        budgetTokens: 2500,
        runId: "i3_hazard_containment",
        outDir: dir,
      }),
    );
    assert.equal(result.ok, true, `create must succeed (does today): ${result.error}`);

    const layoutData = JSON.parse(readFileSync(join(dir, "sim-config.json"), "utf8")).layout.data;
    const rooms = layoutData.rooms ?? [];
    const hazards = layoutData.hazards ?? [];
    assert.equal(hazards.length, 2, `expected 2 hazards in sim-config, got ${hazards.length}`);
    assert.ok(rooms.length >= 1, "expected declared rooms in layout.data.rooms");

    const spawn = layoutData.spawn;
    assert.ok(Number.isInteger(spawn?.x), `layout must declare an integer spawn, got ${JSON.stringify(spawn)}`);
    const reachable = reachableFrom(layoutData, spawn);

    for (const [i, hazard] of hazards.entries()) {
      assert.ok(
        floorAt(layoutData, hazard.x, hazard.y),
        `hazard[${i}] @(${hazard.x},${hazard.y}) must be on a floor tile of the final grid`,
      );
      assert.ok(
        inAnyRoom(rooms, hazard.x, hazard.y),
        `hazard[${i}] @(${hazard.x},${hazard.y}) must lie inside a declared room — today raw authored ` +
          `coordinates are stamped onto the grid unmapped (rooms: ${JSON.stringify(rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.width, h: r.height })))}), ` +
          "carving stray floor in the void (benchmark scenarios 24/45/46/47)",
      );
      assert.ok(
        reachable.has(`${hazard.x},${hazard.y}`),
        `hazard[${i}] @(${hazard.x},${hazard.y}) must be reachable from spawn (${spawn.x},${spawn.y}) — ` +
          "an unreachable hazard can never trigger and violates the authored intent",
      );
    }
  });

  test("hazard coordinates exceeding the room's interior are rejected with a structured error (FAILS today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    // GROUND TRUTH: today this SUCCEEDS and silently inflates the grid to
    // 102x102 so the raw coordinate fits — the level dimensions are driven by
    // unvalidated hazard coords. Under the adjudicated room-relative contract a
    // coordinate that exceeds every declared room's interior must be a
    // structured rejection, never a silent grid inflation.
    const dir = join(outDir, "oob");
    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["size=medium;count=1"],
        floorTile: ["count=20"],
        hazard: ["x=99;y=99;affinity=fire;expression=emit;stacks=1;blocking=false"],
        budgetTokens: 2000,
        runId: "i3_hazard_oob",
        outDir: dir,
      }),
    );
    assert.equal(
      result.ok,
      false,
      "a hazard at room-relative (99,99) exceeds a medium room's interior and must be rejected " +
        "with a structured error — today create succeeds and inflates the grid to 102x102 " +
        "to contain the raw coordinate",
    );
  });
});

// ## TODO: Test Permutations (expanded 2026-07-11 — M5)
test("i3 hazard coords beyond grid bounds are rejected with a structured error", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "oob-hazard");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      floorTile: ["count=20"],
      hazard: ["x=99;y=99;affinity=fire;expression=emit;stacks=1;blocking=false"],
      budgetTokens: 2000,
      runId: "i3_hazard_oob",
      outDir: dir,
    }),
  );

  assert.equal(result.ok, false, "a hazard at (99,99) must be rejected");
  assert.match(result.error, /out_of_bounds/, "current rejection path is hazards[0].position:out_of_bounds");
});

test("i3 single-room level maps hazard coords into the carved interior", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "single-room-map");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: ["x=1;y=1;affinity=earth;expression=emit;stacks=2;blocking=false"],
      budgetTokens: 1500,
      runId: "i3_single_room_mapping",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `single-room hazard mapping must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  const room = layoutData.rooms?.[0];
  const hazard = layoutData.hazards?.[0];
  assert.ok(room, "expected one declared room");
  assert.ok(hazard, "expected one mapped hazard");
  assert.ok(floorAt(layoutData, hazard.x, hazard.y), "mapped hazard should land on a floor tile");
  assert.ok(
    inAnyRoom([room], hazard.x, hazard.y),
    `mapped hazard should land inside the declared room, got (${hazard.x},${hazard.y}) in ${JSON.stringify(room)}`,
  );
});

test("i3 hazards at the same coordinate are rejected, not stacked silently", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "duplicate-hazards");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: [
        "x=1;y=1;affinity=fire;expression=emit;stacks=1;blocking=false",
        "x=1;y=1;affinity=water;expression=emit;stacks=2;blocking=false",
      ],
      budgetTokens: 1500,
      runId: "i3_duplicate_hazards",
      outDir: dir,
    }),
  );

  assert.equal(result.ok, false, "duplicate hazard coordinates should be rejected");
  assert.match(result.error, /duplicate_hazard/, "current behavior rejects duplicates explicitly");
});

test("i3 positioned and auto-placed hazards obey the same room-containment contract", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "hazard-containment");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=2;size=large"],
      floorTile: ["count=32"],
      hazard: [
        "x=1;y=1;affinity=fire;expression=emit;stacks=1;blocking=false",
        "affinity=fire;expression=emit;proximityRadius=1;mana=regen:2:2:1",
      ],
      budgetTokens: 2500,
      runId: "i3_hazard_containment",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `mixed hazard placement create must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  const rooms = layoutData.rooms ?? [];
  for (const hazard of layoutData.hazards ?? []) {
    assert.ok(floorAt(layoutData, hazard.x, hazard.y), `hazard @(${hazard.x},${hazard.y}) must sit on floor`);
    assert.ok(inAnyRoom(rooms, hazard.x, hazard.y), `hazard @(${hazard.x},${hazard.y}) must stay inside a declared room`);
  }
  for (const hazard of layoutData.hazards ?? []) {
    assert.ok(floorAt(layoutData, hazard.x, hazard.y), `hazard @(${hazard.x},${hazard.y}) must sit on floor`);
    assert.ok(inAnyRoom(rooms, hazard.x, hazard.y), `hazard @(${hazard.x},${hazard.y}) must stay inside a declared room`);
  }
});

test("i3 push_to_ui bundle renders every hazard inside a room outline", async () => {
  // The create-time bundle is the artifact the UI pipeline consumes here, so
  // this pins the same room-contained hazard geometry on the bundle/manifest
  // side rather than inventing a separate render-only seam.
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "bundle-hazards");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=2;size=large"],
      floorTile: ["count=32"],
      hazard: [
        "x=1;y=1;affinity=fire;expression=emit;stacks=1;blocking=false",
        "x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false",
      ],
      budgetTokens: 2500,
      runId: "i3_bundle_hazards",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `bundle create must succeed: ${result.error}`);

  const bundle = readJson(join(dir, "bundle.json"));
  const manifest = readJson(join(dir, "manifest.json"));
  assert.ok(bundle.spec, "bundle.json should contain the spec envelope for the generated create run");
  assert.ok(Array.isArray(bundle.artifacts), "bundle.json should expose artifact metadata");
  assert.ok(
    manifest.artifacts.some((entry) => entry.path === "sim-config.json" && entry.schema === "agent-kernel/SimConfigArtifact"),
    "manifest.json should expose the sim-config artifact consumed by the UI pipeline",
  );

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  const rooms = layoutData.rooms ?? [];
  for (const hazard of layoutData.hazards ?? []) {
    assert.ok(floorAt(layoutData, hazard.x, hazard.y), `hazard @(${hazard.x},${hazard.y}) must remain on floor in the bundle payload`);
    assert.ok(inAnyRoom(rooms, hazard.x, hazard.y), `hazard @(${hazard.x},${hazard.y}) must remain inside a room outline`);
  }
});
