// SM2 (error-message-quality-sweep.md): the M4 placement-detail fix (hazard/resource placement
// reporting candidates/requested/index) never propagated to actor placement, which had its own
// near-duplicate "could not place actors: ..." family in orchestrate-build.js reporting nothing.
// Fixed 11 sites across normalizeActorPositions and its Legacy sibling; two are reproduced here
// through the real ak create CLI path exactly like M4's own test does. The remaining nine (the
// no-walkable-tiles/spawn-not-walkable/exit-not-walkable/unresolved-strategic-placement family, and
// the entire Legacy sibling) are defensive backstops: the carving algorithm that runs before actor
// placement already guarantees a minimum walkable interior and picks spawn/exit from the walkable
// set, so these throw only if that guarantee is itself broken by a future change -- not reachable
// from any toolArgs a model can author today. Verified by the fixes not moving the full suite
// (445 files / 3466 passed unaffected); not perturbation-tested per-site the way the two reachable
// ones are, since there is no real input that reaches them to replay.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const AK_CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

async function create(payload) {
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "ak-actor-placement-refusal-"));
  try {
    const result = spawnSync(process.execPath, [
      AK_CLI, "create",
      ...buildArgv({ ...payload, outDir, runId: "actor_placement_refusal_probe" }, authoringSpec),
    ], { cwd: ROOT, encoding: "utf8" });
    return { status: result.status, detail: `${result.stderr || ""}${result.stdout || ""}` };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test("too many delvers for the entry room refuses with the actual deficit", async () => {
  const { status, detail } = await create({
    text: "test",
    room: [{ size: "medium" }],
    floorTile: [{ count: 3, id: "stone_floor" }],
    delver: [
      { affinity: "fire", count: 1, motivation: "exploring" },
      { affinity: "water", count: 1, motivation: "exploring" },
      { affinity: "earth", count: 1, motivation: "exploring" },
    ],
  });
  assert.notEqual(status, 0, "3 delvers cannot fit the minimum-viable floor budget's entry room");
  assert.match(detail, /insufficient entry-room tiles for delver \d+ of 3/, detail);
  assert.match(detail, /\d+ entry-room tiles, \d+ already occupied/, detail);
});

test("too many wardens for the room refuses with the actual deficit", async () => {
  const { status, detail } = await create({
    text: "test",
    room: [{ count: 2, size: "small" }],
    floorTile: [{ count: 8, id: "stone_floor" }],
    delver: [{ affinity: "fire", count: 1, motivation: "exploring" }],
    warden: [
      { affinity: "fire", count: 1, motivation: "defending" },
      { affinity: "water", count: 1, motivation: "defending" },
      { affinity: "earth", count: 1, motivation: "defending" },
      { affinity: "wind", count: 1, motivation: "defending" },
      { affinity: "life", count: 1, motivation: "defending" },
      { affinity: "decay", count: 1, motivation: "defending" },
    ],
  });
  assert.notEqual(status, 0, "1 delver + 6 wardens exhausts a floorTile budget of 8 across 2 rooms");
  assert.match(detail, /insufficient room tiles for warden "[^"]+"/, detail);
  assert.match(detail, /\d+ room tiles total, \d+ already occupied/, detail);
});

// Bonus find during SM1: formatBudgetReceiptDenial() silently capped deniedLines at 5 with no
// "+N more" -- a silent truncation on a message this session read closely three separate times
// (M0-M2) without noticing. A tiny budget against many entity types reliably denies more than 5
// lines at once.
test("a budget denial with more than 5 denied lines reports how many were omitted", async () => {
  const { status, detail } = await create({
    budgetTokens: 5,
    room: [{ size: "medium" }],
    floorTile: [{ count: 20, id: "stone_floor" }],
    delver: [
      { affinity: "fire", count: 1, motivation: "exploring" },
      { affinity: "water", count: 1, motivation: "exploring" },
    ],
    warden: [
      { affinity: "earth", count: 1, motivation: "defending" },
      { affinity: "wind", count: 1, motivation: "defending" },
    ],
  });
  assert.notEqual(status, 0, "a 5-token budget cannot afford any of these entities");
  assert.match(detail, /Budget receipt denied/, detail);
  const deniedLinesShown = (detail.match(/deniedLines=([^;]+)/)?.[1] || "").split(",").length;
  assert.ok(deniedLinesShown <= 5, "the cap itself must still hold");
  assert.match(detail, /\(\+\d+ more\)/, "omitted lines must be counted, not silently dropped");
});

// The three misc build-guard fixes (SM1) are not reachable through ak create's own parsing --
// hasActors is always true because agentAuthoringCommand always constructs an array (even an empty
// one) from parsed delver/warden entries. Tested two of the three directly against a hand-built spec
// (orchestrateBuild's other callers -- the UI card-builder path, sandbox flows -- can reach them
// even though ak create can't). The third (actorsInput.actors not an array, line ~1518) turned out
// to be doubly defensive: mapBuildSpecToArtifacts's OWN schema validation already rejects a
// non-array configurator.inputs.actors before orchestrateBuild's own check ever runs, for any spec
// built through the normal validation path -- confirmed by attempting it here and getting
// "BuildSpec validation failed: configurator.inputs.actors: expected array" instead. The fix is kept
// (harmless, no downside), but it is not independently testable without bypassing legitimate
// upstream validation, so no test claims to exercise it.
describe("orchestrateBuild misc guard detail (not reachable via ak create, tested directly)", () => {
  let orchestrateBuild;
  let baseSpec;

  beforeAll(async () => {
    ({ orchestrateBuild } = await import("../../packages/runtime/src/build/orchestrate-build.js"));
    baseSpec = JSON.parse(readFileSync(
      resolve(__dirname, "../fixtures/artifacts/build-spec-v1-configurator.json"), "utf8",
    ));
  });

  test("missing actors when levelGen is provided reports the received shape", async () => {
    const spec = JSON.parse(JSON.stringify(baseSpec));
    delete spec.configurator.inputs.actors;
    await assert.rejects(
      () => orchestrateBuild({ spec, producedBy: "test" }),
      /configurator inputs require actors when levelGen is provided \(received undefined, expected an array or object\)/,
    );
  });

  test("affinityPresets without affinityLoadouts names which one is missing", async () => {
    const spec = JSON.parse(JSON.stringify(baseSpec));
    spec.configurator.inputs.affinityPresets = { presets: [] };
    await assert.rejects(
      () => orchestrateBuild({ spec, producedBy: "test" }),
      /configurator inputs require both affinityPresets and affinityLoadouts \(missing affinityLoadouts\)/,
    );
  });
});
