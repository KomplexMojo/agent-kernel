/**
 * I4 — multi-room levels declare + bill rooms that are never carved: failing
 * base tests (interface-testing benchmark sweep, 2026-07-09).
 *
 * Seam driven (same seam the MCP server uses):
 *   packages/adapters-cli/src/mcp/tools/authoring.mjs ak_create buildArgs
 *   -> packages/adapters-cli/src/cli/ak-impl.mjs executeCommand("create", argv)
 *
 * GROUND TRUTH (confirmed by direct invocation during test authoring):
 *   - `--room "count=3;size=medium"` WITHOUT a floorTile spec carves all three
 *     5x5 rooms fully (25/25 floor tiles inside each declared rectangle).
 *   - `--room "count=2;size=medium" --floor-tile "count=24"` carves exactly 24
 *     floor tiles, ALL inside R1 (24/25); R2 is declared in layout.data.rooms
 *     and billed on the budget receipt but its rectangle contains ZERO floor —
 *     it does not exist in the playable map.
 *   The floorTile count acts as a global carve cap instead of being validated
 *   against (or distributed across) the declared room area. Every multi-room
 *   benchmark scenario that reaches create-success is affected: 13, 24, 43,
 *   45, 46, 47, 48 (all combine count>=2 rooms with a floorTile budget smaller
 *   than the total interior area). The UI renders the uncarved rooms as solid
 *   wall while the inventory panel bills ROOM x2/x3.
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

function carvedInRoom(layoutData, room) {
  let carved = 0;
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      if (floorAt(layoutData, x, y)) carved += 1;
    }
  }
  return carved;
}

let permutationOutDir;

beforeAll(() => {
  permutationOutDir = mkdtempSync(join(os.tmpdir(), "ak-i4-permutations-"));
});

afterAll(() => {
  rmSync(permutationOutDir, { recursive: true, force: true });
});

describe("create multi-room carving (I4: floorTile cap leaves declared rooms uncarved)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-i4-carving-"));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("count=3 without floorTile carves every declared room (contract pin — passes today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const dir = join(outDir, "no-cap");
    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["count=3;size=medium"],
        budgetTokens: 3000,
        runId: "i4_no_cap",
        outDir: dir,
      }),
    );
    assert.equal(result.ok, true, `create must succeed: ${result.error}`);

    const layoutData = JSON.parse(readFileSync(join(dir, "sim-config.json"), "utf8")).layout.data;
    assert.equal(layoutData.rooms?.length, 3, "3 rooms must be declared");
    for (const room of layoutData.rooms) {
      assert.ok(
        carvedInRoom(layoutData, room) > 0,
        `room ${room.id} must contain carved floor (does today without a floorTile spec)`,
      );
    }
  });

  test("count=2 with floorTile count=24 still carves floor inside EVERY declared room (FAILS today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const dir = join(outDir, "capped");
    const result = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["count=2;size=medium"],
        floorTile: ["count=24"],
        budgetTokens: 3000,
        runId: "i4_capped",
        outDir: dir,
      }),
    );
    assert.equal(result.ok, true, `create must succeed (does today): ${result.error}`);

    const layoutData = JSON.parse(readFileSync(join(dir, "sim-config.json"), "utf8")).layout.data;
    const rooms = layoutData.rooms ?? [];
    assert.equal(rooms.length, 2, `2 rooms must be declared, got ${rooms.length}`);

    for (const room of rooms) {
      const carved = carvedInRoom(layoutData, room);
      assert.ok(
        carved > 0,
        `room ${room.id} at (${room.x},${room.y}) ${room.width}x${room.height} must contain carved floor — ` +
          `got ${carved} floor tiles in bounds. Today the floorTile count acts as a global carve cap: ` +
          "all 24 tiles land in one room and the other is declared in layout.data.rooms and billed " +
          "on the budget receipt while being 100% wall in the playable map (benchmark scenarios " +
          "13/24/43/45/46/47/48). Either the request must be rejected as under-budgeted for the " +
          "declared rooms, or carving must cover every declared room",
      );
    }
  });
});

// ## TODO: Test Permutations (expanded 2026-07-11 — M5)
test("i4 floorTile count below one room interior is rejected with a structured message", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=3;size=medium"],
      floorTile: ["count=10"],
      budgetTokens: 5000,
      runId: "i4_under_budget_reject",
      outDir: join(permutationOutDir, "under-budget-reject"),
    }),
  );

  assert.equal(result.ok, false, "count=10 should still be below the minimum viable three-room carve budget");
  assert.match(result.error, /floor_tile_budget_insufficient/, "current rejection path should stay structured");
});

test("i4 floorTile count at the minimum viable three-room budget splits evenly across rooms", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "three-room-minimum");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=3;size=medium"],
      floorTile: ["count=15"],
      budgetTokens: 5000,
      runId: "i4_three_room_minimum",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `minimum viable three-room budget must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  assert.deepEqual(
    layoutData.rooms.map((room) => carvedInRoom(layoutData, room)),
    [3, 3, 3],
    "current behavior splits the minimum viable three-room budget evenly across the declared rooms",
  );
});

test("i4 floorTile count 20 still spreads carve budget across all declared rooms", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "three-room-twenty");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=3;size=medium"],
      floorTile: ["count=20"],
      budgetTokens: 5000,
      runId: "i4_three_room_twenty",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `count=20 must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  assert.deepEqual(
    layoutData.rooms.map((room) => carvedInRoom(layoutData, room)),
    [5, 5, 4],
    "current carve distribution is 5/5/4 across the three rooms",
  );
});

test("i4 floorTile count 24 keeps every room carved and balanced", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "three-room-twenty-four");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=3;size=medium"],
      floorTile: ["count=24"],
      budgetTokens: 5000,
      runId: "i4_three_room_twenty_four",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `count=24 must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  assert.deepEqual(
    layoutData.rooms.map((room) => carvedInRoom(layoutData, room)),
    [6, 6, 6],
    "current behavior spreads a 24-tile floor budget evenly across all three rooms",
  );
});

test("i4 budget receipt bills the same carve total that the map actually contains", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const dir = join(permutationOutDir, "three-room-fifty");
  const result = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["count=3;size=medium"],
      floorTile: ["count=50"],
      budgetTokens: 5000,
      runId: "i4_three_room_fifty",
      outDir: dir,
    }),
  );
  assert.equal(result.ok, true, `count=50 must succeed: ${result.error}`);

  const layoutData = readJson(join(dir, "sim-config.json")).layout.data;
  const receipt = readJson(join(dir, "budget-receipt.json"));
  const carvedByRoom = layoutData.rooms.map((room) => carvedInRoom(layoutData, room));
  assert.deepEqual(carvedByRoom, [15, 15, 14], "current full-budget carve distribution should be preserved");
  assert.equal(receipt.lineItems.length, 1, "current receipt shape should stay a single floor-tile line item");
  assert.equal(receipt.lineItems[0].id, "tile_floor", "receipt should bill floor tiles as the only line item");
  assert.equal(receipt.lineItems[0].quantity, 50, "receipt should bill the same floor-tile total the request asked for");
  assert.equal(
    receipt.scenarioSpendReport?.categories?.rooms?.actual,
    50,
    "room spend in the receipt should match the carved multi-room map",
  );
});
