// #185: one vital shape everywhere. Actors author vitals as a map keyed by name
// (`vitals: { health: { max, regen } }`); a resource grants one vital and was only
// accepted flat (`vital: "health", delta, regen`). Models copy the actor map into
// resources, and the nested object reached the CLI as `vital=[object Object]`.
// A resource now takes the same map, under `vital` or `vitals`, and lands exactly
// where the flat contract does; anything the map cannot say plainly is refused.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/agon.mjs");

const loadShared = () => import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");

async function createFromMcp(resource) {
  const { buildArgv } = await loadShared();
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const dir = mkdtempSync(join(tmpdir(), "agon-resource-vital-"));
  const argv = buildArgv({ room: [{ size: "small", count: 1 }], resource: [resource], runId: "vital_shape",
    createdAt: "2026-11-07T00:00:00.000Z", outDir: dir }, authoringSpec);
  const result = spawnSync(process.execPath, [CLI, "create", ...argv], { cwd: ROOT, encoding: "utf8" });
  const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  return { result, read, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the actor-style vital map on a resource serializes to the flat contract", async () => {
  const { resourceSpecToString } = await loadShared();
  const flat = "permanenceMode=level;vital=health;delta=10";
  assert.equal(resourceSpecToString({ permanenceMode: "level", vital: "health", delta: 10 }), flat);
  assert.equal(resourceSpecToString({ vital: { health: { delta: 10, permanenceMode: "level" } } }), flat);
  assert.equal(resourceSpecToString({ permanenceMode: "level", vital: { health: { delta: 10 } } }), flat);
  assert.equal(resourceSpecToString({ permanenceMode: "level", vitals: { health: { delta: 10 } } }), flat);
  // A bare number is the amount, as `delta`.
  assert.equal(resourceSpecToString({ permanenceMode: "level", vital: { health: 10 } }), flat);
  assert.equal(resourceSpecToString({ permanenceMode: "permanent", vitals: { mana: { regen: 2 } } }),
    "permanenceMode=permanent;vital=mana;regen=2");
  // A spec string passes through untouched.
  assert.equal(resourceSpecToString(flat), flat);
});

test("a vital map the flat contract cannot say plainly is refused by the CLI, naming the shape", async () => {
  const refused = [
    { permanenceMode: "level", vital: { health: { delta: 1 }, mana: { delta: 1 } } },
    { permanenceMode: "level", vital: {} },
    { permanenceMode: "level", vital: { health: { delta: 1 } }, vitals: { mana: { delta: 1 } } },
    { permanenceMode: "level", vital: { health: { delta: 1, permanenceMode: "permanent" } } },
    { permanenceMode: "level", delta: 3, vital: { health: { delta: 1 } } },
    // The actor's `max` is not a grant amount; guessing it meant delta would be silent repair (bf-023).
    { permanenceMode: "level", vital: { health: { max: 20 } } },
  ];
  for (const resource of refused) {
    const run = await createFromMcp(resource);
    try {
      assert.notEqual(run.result.status, 0, JSON.stringify(resource));
      assert.match(`${run.result.stderr}${run.result.stdout}`, /A resource grants one vital/, JSON.stringify(resource));
    } finally {
      run.cleanup();
    }
  }
});

test("agon_create builds the same level from the nested map as from the flat contract", async () => {
  const flat = await createFromMcp({ permanenceMode: "level", vital: "health", delta: 10 });
  const nested = await createFromMcp({ vital: { health: { delta: 10, permanenceMode: "level" } } });
  const plural = await createFromMcp({ permanenceMode: "level", vitals: { health: { delta: 10 } } });
  try {
    for (const run of [flat, nested, plural]) assert.equal(run.result.status, 0, `${run.result.stderr}${run.result.stdout}`);
    const actors = (run) => run.read("initial-state.json").actors;
    assert.deepEqual(actors(nested), actors(flat));
    assert.deepEqual(actors(plural), actors(flat));
  } finally {
    for (const run of [flat, nested, plural]) run.cleanup();
  }
});

test("a vital map with no amount still fails closed at the CLI", async () => {
  const run = await createFromMcp({ permanenceMode: "level", vital: { health: {} } });
  try {
    assert.notEqual(run.result.status, 0);
    assert.match(`${run.result.stderr}${run.result.stdout}`, /delta is required unless regen is given/);
  } finally {
    run.cleanup();
  }
});

test("the benchmark keeps a resource's vital map for the shared serializer", () => {
  const { normalizeToolArgs } = require("../../tools/remote-ollama-control/scripts/lib/agon-runner.js");
  const [resource] = normalizeToolArgs({ resource: [{ permanenceMode: "level", vitals: { health: { delta: 10 } } }] }).resource;
  assert.deepEqual(resource.vitals, { health: { delta: 10 } });
});

// ## TODO: Test Permutations
// - stamina and mana maps with both delta and regen
// - consumable permanence through the map
// - a resource spec mixing the vital map with an affinity payload
// - agon_resource_plan with a structured resource object
