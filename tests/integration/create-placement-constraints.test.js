// #301: `ak create --place` / `ak_create { place }` hand relational placement constraints to the
// Configurator's solver-backed placement. The level they build honours them, the create result
// reports how each held, and one that cannot hold refuses the level with the constraint named.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK_CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

async function create(payload) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "ak-place-"));
  try {
    const result = spawnSync(process.execPath, [
      AK_CLI, "create",
      ...buildArgv({ ...payload, outDir, runId: "place_probe", createdAt: "2026-10-18T00:00:00.000Z" }, authoringSpec),
    ], { cwd: ROOT, encoding: "utf8" });
    const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
    return {
      status: result.status,
      output: `${result.stderr || ""}${result.stdout || ""}`,
      summary: result.status === 0 ? JSON.parse(result.stdout.trim().split("\n").pop()) : null,
      initialState: result.status === 0 ? read("initial-state.json") : null,
      simConfig: result.status === 0 ? read("sim-config.json") : null,
      telemetry: result.status === 0 ? read("telemetry.json") : null,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const level = {
  room: ["size=medium;count=2"],
  hazard: [
    "affinity=fire;expression=emit;stacks=2;intensity=1;proximityRadius=1;mana=regen:30:30:6",
    "affinity=water;expression=emit;stacks=2;intensity=1;proximityRadius=1;mana=regen:30:30:6",
  ],
  delver: ["count=1;affinity=wind;motivation=exploring+user_controlled"],
  warden: ["count=3;affinity=earth;motivation=stationary"],
};

test("a level built with --place honours every constraint and reports each one", async () => {
  const { status, output, summary, initialState, simConfig, telemetry } = await create({
    ...level,
    place: ["hazard:1;near=exit:1", "hazard:2;far=hazard:1:6", "warden:*;near=hazard:2:2;count=2"],
  });
  assert.equal(status, 0, output);
  const at = new Map(initialState.actors.map((actor) => [actor.id, actor.position]));
  const exit = simConfig.layout.data.exitApproach;
  assert.ok(chebyshev(at.get("hazard_1"), exit) <= 1);
  assert.ok(chebyshev(at.get("hazard_1"), at.get("hazard_2")) >= 6);
  const wardens = initialState.actors.filter((actor) => actor.id.startsWith("card_warden"));
  assert.equal(wardens.length, 3);
  assert.ok(wardens.filter(({ position }) => chebyshev(position, at.get("hazard_2")) <= 2).length >= 2);
  const cells = initialState.actors.map(({ position }) => `${position.x},${position.y}`);
  assert.equal(new Set(cells).size, cells.length, "no two actors share a cell");
  assert.deepEqual(summary.placementReport.map(({ constraint, held }) => ({ constraint, held })), [
    { constraint: "hazard:1;near=exit:1", held: true },
    { constraint: "hazard:2;far=hazard:1:6", held: true },
    { constraint: "warden:*;near=hazard:2:2;count=2", held: true },
  ]);
  const decision = telemetry.data.solverDecisions.find(({ domain }) => domain === "configurator_satisfiability");
  assert.equal(decision.decision, "solver");
  assert.deepEqual(decision.placementReport, summary.placementReport);
});

test("a constraint that cannot hold refuses the level and names it", async () => {
  const { status, output } = await create({ ...level, place: ["hazard:1;near=exit:0"] });
  assert.notEqual(status, 0);
  assert.match(output, /placement_constraint/);
  assert.match(output, /"hazard:1;near=exit:0" leaves hazard_1 no free cell/);
});

test("a malformed constraint or an unknown reference is refused before anything is placed", async () => {
  const malformed = await create({ ...level, place: ["hazard:1;nearby=exit:1"] });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.output, /place\[1\] clause "nearby=exit:1"/);
  const unknown = await create({ ...level, place: ["warden:9;near=exit:2"] });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.output, /no warden "9" in this level/);
});

// ## TODO: Test Permutations
// - onRoute on a level whose rooms are joined by single-cell corridors
// - spread over all wardens on a large level
// - configure accepts --place the same way create does
