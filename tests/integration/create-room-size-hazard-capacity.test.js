/**
 * I1 — size=small room rejects hazards despite identical geometry to medium:
 * failing base tests (interface-testing benchmark sweep, 2026-07-09).
 *
 * Seam driven (same seam the MCP server uses):
 *   packages/adapters-cli/src/mcp/tools/authoring.mjs ak_create buildArgs
 *   -> packages/adapters-cli/src/cli/ak-impl.mjs executeCommand("create", argv)
 *
 * GROUND TRUTH (confirmed by direct invocation during test authoring):
 *   - `--room "size=small;count=1"` and `--room "size=medium;count=1"` generate
 *     byte-identical layouts: 9x9 grid, one 5x5 room (25 interior tiles).
 *   - `--room "size=small;count=1" --hazard <spec>` throws
 *     "room[1] size=small is too small to fit entrance, exit, and 1 hazard(s)
 *     without compression. Use size=medium or size=large."
 *   - The identical command with size=medium succeeds.
 *   The capacity validation therefore contradicts the geometry the generator
 *   actually produces. Benchmark scenarios 03, 04, 05, 14, 15, 18, 19, 33, 41,
 *   42 fail on this rule with their canonical vault payloads.
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

/**
 * Capture stdout JSON the way server.mjs invokeCliTool() does; a thrown error
 * is normalized to { ok:false, error } so assertions can surface the message.
 */
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

function countFloorTiles(layoutData) {
  let total = 0;
  for (let y = 0; y < layoutData.height; y += 1) {
    for (let x = 0; x < layoutData.width; x += 1) {
      if (floorAt(layoutData, x, y)) total += 1;
    }
  }
  return total;
}

function summarizeActors(actors) {
  return actors.map(({ id, archetype, position, motivation, traits }) => ({
    id,
    archetype,
    position,
    motivation,
    traits,
  }));
}

const HAZARD_SPEC = "id=room_1_field_1;affinity=dark;expression=emit;proximityRadius=3;mana=regen:4:4:1";

let permutationOutDir;

beforeAll(() => {
  permutationOutDir = mkdtempSync(join(os.tmpdir(), "ak-i1-permutations-"));
});

afterAll(() => {
  rmSync(permutationOutDir, { recursive: true, force: true });
});

describe("create room-size hazard capacity (I1: small rejects hazards on medium-identical geometry)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-i1-room-size-"));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("small and medium rooms generate identical layout geometry (contract pin — passes today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const layouts = {};
    for (const size of ["small", "medium"]) {
      const dir = join(outDir, `alone-${size}`);
      const result = await runCliCommand(
        ak_impl.executeCommand,
        createTool.command,
        createTool.buildArgs({
          room: [`size=${size};count=1`],
          budgetTokens: 1500,
          runId: `i1_alone_${size}`,
          outDir: dir,
        }),
      );
      assert.equal(result.ok, true, `create --room size=${size} alone must succeed: ${result.error}`);
      layouts[size] = JSON.parse(readFileSync(join(dir, "sim-config.json"), "utf8")).layout.data;
    }
    assert.deepEqual(
      { width: layouts.small.width, height: layouts.small.height, tiles: layouts.small.tiles },
      { width: layouts.medium.width, height: layouts.medium.height, tiles: layouts.medium.tiles },
      "size=small and size=medium must produce identical grids (code-is-law pin from the element coverage suite)",
    );
  });

  test("size=small room accepts one hazard exactly like size=medium does (FAILS today)", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const mediumResult = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["size=medium;count=1"],
        hazard: [HAZARD_SPEC],
        budgetTokens: 1500,
        runId: "i1_medium_hazard",
        outDir: join(outDir, "medium-hazard"),
      }),
    );
    assert.equal(mediumResult.ok, true, `medium+hazard must succeed (does today): ${mediumResult.error}`);

    const smallResult = await runCliCommand(
      ak_impl.executeCommand,
      createTool.command,
      createTool.buildArgs({
        room: ["size=small;count=1"],
        hazard: [HAZARD_SPEC],
        budgetTokens: 1500,
        runId: "i1_small_hazard",
        outDir: join(outDir, "small-hazard"),
      }),
    );
    assert.equal(
      smallResult.ok,
      true,
      "small+hazard must succeed because small generates the exact same 9x9/5x5 geometry as medium, " +
        `which accepts this hazard — got error: ${smallResult.error} ` +
        "(the room-capacity validation contradicts the generated geometry; benchmark scenarios " +
        "03/04/05/14/15/18/19/33/41/42 fail on their canonical vault payloads because of this rule)",
    );
  });
});

// ## TODO: Test Permutations (expanded 2026-07-11 — M5)
test("i1 small room accepts two hazards when medium accepts the same pair", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");
  const hazardSpecs = [
    HAZARD_SPEC,
    "id=room_1_field_2;affinity=water;expression=emit;proximityRadius=2;mana=regen:2:2:1",
  ];

  const smallDir = join(permutationOutDir, "small-two-hazards");
  const mediumDir = join(permutationOutDir, "medium-two-hazards");
  const smallResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=small;count=1"],
      hazard: hazardSpecs,
      budgetTokens: 2000,
      runId: "i1_small_two_hazards",
      outDir: smallDir,
    }),
  );
  const mediumResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: hazardSpecs,
      budgetTokens: 2000,
      runId: "i1_medium_two_hazards",
      outDir: mediumDir,
    }),
  );

  assert.equal(smallResult.ok, true, `small+2 hazards must succeed: ${smallResult.error}`);
  assert.equal(mediumResult.ok, true, `medium+2 hazards must succeed: ${mediumResult.error}`);

  const smallLayout = readJson(join(smallDir, "sim-config.json")).layout.data;
  const mediumLayout = readJson(join(mediumDir, "sim-config.json")).layout.data;
  assert.deepEqual(smallLayout.rooms, mediumLayout.rooms, "small and medium rooms should share the same geometry");
  assert.deepEqual(smallLayout.tiles, mediumLayout.tiles, "small and medium rooms should share the same carved grid");
  assert.deepEqual(smallLayout.hazards, mediumLayout.hazards, "small and medium hazard placement should match");
  assert.equal(countFloorTiles(smallLayout), countFloorTiles(mediumLayout), "small and medium floor counts should match");
});

test("i1 small room + hazard + delver + warden matches medium acceptance", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const sharedArgs = {
    hazard: [HAZARD_SPEC],
    delver: ["count=1;affinity=water;motivation=random"],
    warden: ["count=1;affinity=earth;motivation=defending"],
    budgetTokens: 2000,
  };

  const smallDir = join(permutationOutDir, "small-actors");
  const mediumDir = join(permutationOutDir, "medium-actors");
  const smallResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=small;count=1"],
      runId: "i1_small_hazard_delver_warden",
      outDir: smallDir,
      ...sharedArgs,
    }),
  );
  const mediumResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      runId: "i1_medium_hazard_delver_warden",
      outDir: mediumDir,
      ...sharedArgs,
    }),
  );

  assert.equal(smallResult.ok, true, `small+hzd+delver+warden must succeed: ${smallResult.error}`);
  assert.equal(mediumResult.ok, true, `medium+hzd+delver+warden must succeed: ${mediumResult.error}`);

  const smallSim = readJson(join(smallDir, "sim-config.json")).layout.data;
  const mediumSim = readJson(join(mediumDir, "sim-config.json")).layout.data;
  const smallInitial = readJson(join(smallDir, "initial-state.json")).actors;
  const mediumInitial = readJson(join(mediumDir, "initial-state.json")).actors;
  assert.deepEqual(smallSim.hazards, mediumSim.hazards, "hazard placement should be identical between small and medium");
  assert.deepEqual(
    summarizeActors(smallInitial),
    summarizeActors(mediumInitial),
    "small and medium should produce the same actor roster on the same geometry",
  );
});

test("i1 capacity rule counts entrance/exit tiles consistently across sizes", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const smallDir = join(permutationOutDir, "small-floor-count");
  const mediumDir = join(permutationOutDir, "medium-floor-count");
  const smallResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=small;count=1"],
      floorTile: ["count=8"],
      budgetTokens: 1500,
      runId: "i1_small_floor_count",
      outDir: smallDir,
    }),
  );
  const mediumResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      floorTile: ["count=8"],
      budgetTokens: 1500,
      runId: "i1_medium_floor_count",
      outDir: mediumDir,
    }),
  );

  assert.equal(smallResult.ok, true, `small floorTile budget must succeed: ${smallResult.error}`);
  assert.equal(mediumResult.ok, true, `medium floorTile budget must succeed: ${mediumResult.error}`);

  const smallReceipt = readJson(join(smallDir, "budget-receipt.json"));
  const mediumReceipt = readJson(join(mediumDir, "budget-receipt.json"));
  assert.equal(smallReceipt.lineItems[0].quantity, 8, "small should bill the requested floor tile count");
  assert.equal(mediumReceipt.lineItems[0].quantity, 8, "medium should bill the requested floor tile count");
  assert.deepEqual(
    readJson(join(smallDir, "sim-config.json")).layout.data.rooms,
    readJson(join(mediumDir, "sim-config.json")).layout.data.rooms,
    "small and medium room geometry should remain identical when the floorTile budget changes",
  );
});

test("i1 large room accepts hazard counts proportional to its larger interior", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

  const hazardSpecs = [
    HAZARD_SPEC,
    "id=room_1_field_2;affinity=water;expression=emit;proximityRadius=2;mana=regen:2:2:1",
    "id=room_1_field_3;affinity=earth;expression=emit;proximityRadius=1;mana=regen:1:1:1",
  ];

  const mediumDir = join(permutationOutDir, "medium-three-hazards");
  const largeDir = join(permutationOutDir, "large-three-hazards");
  const mediumResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: hazardSpecs,
      budgetTokens: 2000,
      runId: "i1_medium_three_hazards",
      outDir: mediumDir,
    }),
  );
  const largeResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=large;count=1"],
      hazard: hazardSpecs,
      budgetTokens: 2000,
      runId: "i1_large_three_hazards",
      outDir: largeDir,
    }),
  );

  assert.equal(mediumResult.ok, true, `medium+3 hazards must succeed: ${mediumResult.error}`);
  assert.equal(largeResult.ok, true, `large+3 hazards must succeed: ${largeResult.error}`);

  const mediumLayout = readJson(join(mediumDir, "sim-config.json")).layout.data;
  const largeLayout = readJson(join(largeDir, "sim-config.json")).layout.data;
  assert.equal(mediumLayout.hazards.length, 3, "medium should preserve all three hazards");
  assert.equal(largeLayout.hazards.length, 3, "large should preserve all three hazards");
  assert.ok(largeLayout.width > mediumLayout.width, "large should expose a larger grid than medium");
  assert.ok(countFloorTiles(largeLayout) > countFloorTiles(mediumLayout), "large should carve more floor than medium");
});

test("i1 small and medium both accept the same dense 10-hazard request", async () => {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");
  const hazardSpecs = Array.from({ length: 10 }, (_, index) =>
    `id=room_1_field_${index + 1};affinity=${["fire", "water", "earth", "wind"][index % 4]};expression=emit;proximityRadius=${
      (index % 3) + 1
    };mana=regen:${index + 1}:${index + 1}:1`,
  );

  const smallDir = join(permutationOutDir, "small-dense-hazards");
  const mediumDir = join(permutationOutDir, "medium-dense-hazards");
  const smallResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=small;count=1"],
      hazard: hazardSpecs,
      budgetTokens: 5000,
      runId: "i1_small_dense_hazards",
      outDir: smallDir,
    }),
  );
  const mediumResult = await runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({
      room: ["size=medium;count=1"],
      hazard: hazardSpecs,
      budgetTokens: 5000,
      runId: "i1_medium_dense_hazards",
      outDir: mediumDir,
    }),
  );

  assert.equal(smallResult.ok, true, `small dense-hazard create must succeed: ${smallResult.error}`);
  assert.equal(mediumResult.ok, true, `medium dense-hazard create must succeed: ${mediumResult.error}`);
  assert.deepEqual(
    readJson(join(smallDir, "sim-config.json")).layout.data.hazards,
    readJson(join(mediumDir, "sim-config.json")).layout.data.hazards,
    "small and medium should accept the same hazard matrix on their identical geometry",
  );
});
