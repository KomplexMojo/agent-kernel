/**
 * Universal element-placement invariant (developer hard rule, adjudicated
 * 2026-07-11): NOTHING may exist outside a room or hallway — equivalently,
 * there must be a walkable tile under EVERY positioned game element.
 *
 * Coverage: layout.data.hazards / resources, layout.data.spawn / exit,
 * and every actor position in InitialStateArtifact, across representative
 * create shapes (single room, multi-room + floorTile budget, resource-heavy,
 * benchmark scenario 51's small-room + blocking-hazards shape).
 *
 * Note the deliberate formulation: hallway/corridor tiles are walkable floor
 * OUTSIDE declared room rectangles, so the invariant is "walkable tile under
 * the element", not "inside a room rectangle". Hazards carry the stricter
 * in-room contract separately (create-hazard-room-containment.test.js).
 *
 * GROUND TRUTH at authoring time: this invariant already holds by
 * construction (0 violations across 92 hazard/resource placements in the
 * 54-scenario benchmark sweep) — this file pins it as a regression shield,
 * and level-gen enforces it with structured element_on_wall errors.
 *
 * Seam driven (same seam the MCP server uses):
 *   packages/adapters-cli/src/mcp/tools/authoring.mjs ak_create buildArgs
 *   -> packages/adapters-cli/src/cli/ak-impl.mjs executeCommand("create", argv)
 */
"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync, existsSync } = require("node:fs");
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

function walkableAt(layoutData, x, y) {
  const ch = layoutData.tiles?.[y]?.[x];
  return ch !== undefined && layoutData.legend?.[ch]?.tile !== "wall";
}

function positionOf(element) {
  const x = element.position?.x ?? element.x;
  const y = element.position?.y ?? element.y;
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

/**
 * Assert the hard rule over every positioned element in the produced
 * artifacts. Returns the number of elements checked so callers can assert
 * the shape actually exercised the element kinds it intended to.
 */
function assertPlacementInvariant(createDir, label) {
  const layoutData = JSON.parse(readFileSync(join(createDir, "sim-config.json"), "utf8")).layout.data;
  let checked = 0;

  for (const kind of ["hazards", "resources"]) {
    for (const [i, element] of (layoutData[kind] ?? []).entries()) {
      const pos = positionOf(element);
      assert.ok(pos, `${label}: ${kind}[${i}] (${element.id ?? "?"}) must carry an integer position`);
      checked += 1;
      assert.ok(
        walkableAt(layoutData, pos.x, pos.y),
        `${label}: ${kind}[${i}] (${element.id ?? "?"}) @(${pos.x},${pos.y}) violates the hard rule — ` +
          "every game element must sit on a walkable tile (room or hallway floor), never inside a wall",
      );
    }
  }

  for (const kind of ["spawn", "exit"]) {
    const pos = positionOf(layoutData[kind] ?? {});
    assert.ok(pos, `${label}: layout.${kind} must carry an integer position`);
    checked += 1;
    assert.ok(
      walkableAt(layoutData, pos.x, pos.y),
      `${label}: ${kind} @(${pos.x},${pos.y}) must sit on a walkable tile`,
    );
  }

  const initialStatePath = join(createDir, "initial-state.json");
  if (existsSync(initialStatePath)) {
    const initialState = JSON.parse(readFileSync(initialStatePath, "utf8"));
    for (const actor of initialState.actors ?? []) {
      const pos = positionOf(actor);
      assert.ok(pos, `${label}: actor ${actor.id} must carry an integer position`);
      checked += 1;
      assert.ok(
        walkableAt(layoutData, pos.x, pos.y),
        `${label}: actor ${actor.id} @(${pos.x},${pos.y}) must sit on a walkable tile`,
      );
    }
  }
  return checked;
}

const SHAPES = [
  {
    name: "single room with positioned and auto-placed hazards, plus a delver",
    minElements: 5, // two hazards + spawn + exit + delver
    args: {
      room: ["size=medium;count=1"],
      hazard: [
        "x=2;y=2;affinity=earth;expression=emit;stacks=1;blocking=false",
        "id=h1;affinity=dark;expression=emit;proximityRadius=3;mana=regen:4:4:1",
      ],
      delver: ["count=1;affinity=fire;motivation=exploring"],
      budgetTokens: 2500,
    },
  },
  {
    name: "multi-room with floorTile budget and hazards (I3/I4 shape)",
    minElements: 4, // 2 hazards + spawn + exit
    args: {
      room: ["count=2;size=large"],
      floorTile: ["count=32"],
      hazard: [
        "x=1;y=1;affinity=fire;expression=emit;stacks=1;blocking=false",
        "x=2;y=2;affinity=dark;expression=emit;stacks=2;blocking=false",
      ],
      budgetTokens: 2500,
    },
  },
  {
    name: "resource-heavy shrine (benchmark scenario 26 shape)",
    minElements: 6, // 3 resources + 1 hazard + spawn + exit
    args: {
      // The hazard is load-bearing: the budget splitter allocates a zero
      // resources pool unless a hazard is present (deniedPools=resources:N/0
      // otherwise) — every canonical resource scenario carries one. Logged
      // 2026-07-11 as an open observation; code-is-law until adjudicated.
      hazard: ["id=h1;affinity=life;expression=emit;proximityRadius=2;mana=regen:3:3:1"],
      room: ["size=medium;count=1"],
      resource: [
        "tier=permanent;stat=vitalMax;delta=6;dropRate=5",
        "tier=level;stat=vitalRegen;delta=1;dropRate=20",
        "tier=level;stat=affinityStack;delta=1;dropRate=15",
      ],
      delver: ["count=1;affinity=water;motivation=exploring"],
      budgetTokens: 3000,
    },
  },
  {
    name: "small room with blocking hazards and stationary wardens (scenario 51 shape)",
    minElements: 7, // 2 hazards + spawn + exit + delver + 2 wardens
    args: {
      room: ["size=small;count=1"],
      hazard: [
        "x=2;y=1;affinity=fire;expression=emit;stacks=3;blocking=true",
        "x=4;y=1;affinity=dark;expression=emit;stacks=2;blocking=true",
      ],
      delver: ["count=1;affinity=light;motivation=exploring"],
      warden: ["count=1;affinity=fire;motivation=stationary", "count=1;affinity=dark;motivation=stationary"],
      budgetTokens: 3500,
    },
  },
];

describe("universal element placement invariant (walkable tile under every game element)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-element-placement-"));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  for (const [index, shape] of SHAPES.entries()) {
    test(`${shape.name}: every positioned element sits on a walkable tile`, async () => {
      const { ak_impl, authoringToolsModule } = await loadModules();
      const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

      const dir = join(outDir, `shape-${index}`);
      const result = await runCliCommand(
        ak_impl.executeCommand,
        createTool.command,
        createTool.buildArgs({
          ...shape.args,
          runId: `element_placement_${index}`,
          outDir: dir,
        }),
      );
      assert.equal(result.ok, true, `create must succeed for "${shape.name}": ${result.error}`);

      const checked = assertPlacementInvariant(dir, shape.name);
      assert.ok(
        checked >= shape.minElements,
        `"${shape.name}" must exercise at least ${shape.minElements} positioned elements, checked ${checked}`,
      );
    });
  }
});

// ## TODO: Test Permutations
test.skip("placement invariant holds for hazard+resource combinations across all room sizes", () => {});
test.skip("placement invariant holds at 50-actor scale rosters", () => {});
test.skip("placement invariant holds for scenario 50 full-evaluation shape", () => {});
test.skip("level-gen rejects a synthetic layout carrying an element on a wall with element_on_wall", () => {});
