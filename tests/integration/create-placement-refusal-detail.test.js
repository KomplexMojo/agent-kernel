// M4 (coding-issues-affecting-benchmarking.md): assignPositionedLayoutObjects' refusal used to say
// only "insufficient unoccupied walkable tiles" with no numbers. Every recorded benchmark failure
// on this path turned out to be the model requesting a floorTile.count far below what its own
// hazard/actor count needs -- the placer itself scales cleanly to hundreds of tiles across many
// rooms (verified by replaying the recorded requests with only floorTile.count raised). Pinning
// that the refusal now reports the actual deficit, so a future change to this throw site can't
// silently drop it back to an uninvestigable message the way it silently was before.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK_CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

async function create(payload) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "ak-placement-refusal-"));
  try {
    const result = spawnSync(process.execPath, [
      AK_CLI, "create",
      ...buildArgv({ ...payload, outDir, runId: "placement_refusal_probe" }, authoringSpec),
    ], { cwd: ROOT, encoding: "utf8" });
    return { status: result.status, detail: `${result.stderr || ""}${result.stdout || ""}` };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test("a single room with too few floor tiles for its hazards refuses with the actual deficit", async () => {
  const { status, detail } = await create({
    text: "test",
    room: [{ size: "medium" }],
    floorTile: [{ count: 1, id: "stone_floor" }],
    hazard: [
      { affinity: "fire", expression: "emit", proximityRadius: 2 },
      { affinity: "water", expression: "pull", proximityRadius: 2 },
      { affinity: "earth", expression: "push", proximityRadius: 2 },
    ],
  });

  assert.notEqual(status, 0, "one floor tile cannot hold three hazards plus spawn/exit");
  assert.match(detail, /insufficient unoccupied walkable tiles/);
  assert.match(detail, /\d+ available, 3 requested, \d+ placed before running out/, detail);
  assert.match(detail, /raise floorTile\.count/, "the refusal must name the field that fixes it");
});

test("the same request succeeds once floorTile.count covers the request", async () => {
  const { status } = await create({
    text: "test",
    room: [{ size: "medium" }],
    floorTile: [{ count: 20, id: "stone_floor" }],
    hazard: [
      { affinity: "fire", expression: "emit", proximityRadius: 2 },
      { affinity: "water", expression: "pull", proximityRadius: 2 },
      { affinity: "earth", expression: "push", proximityRadius: 2 },
    ],
  });
  assert.equal(status, 0, "the only change is floorTile.count -- the placer itself is not the limit");
});
