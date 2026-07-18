/**
 * P0.2 — GOLDEN RECEIPTS (Persona Enforcement Program, local-codex/Plan.md)
 *
 * Reruns three canonical `ak create` builds and deep-compares every
 * economy-relevant artifact against committed goldens in
 * tests/fixtures/goldens/create-g{1,2,3}/. The builds are fully deterministic
 * (verified byte-identical across runs on 2026-07-18), so ANY diff here means
 * a migration step changed build output. That is only allowed in a milestone
 * that says so — regenerate the goldens in that same diff and cite it.
 *
 * Regenerate (only when a milestone deliberately changes output):
 *   run the three commands below with --out-dir pointing at the fixture dirs,
 *   then delete bundle.json and resource-bundle.json (excluded: ~1 MB each).
 *
 * g1: dungeon mix (room + hazard + delver) — the typical build.
 * g2: resources (affinity resource + permanent vital+regen resource) — the
 *     feat/resources charging path. PINS A BUG: see below.
 * g3: maximizer-goal delver (goals=max_mana:high,mana_regen:high, capped
 *     budget) — the output P1.4 is EXPECTED to change (motivation overcharge
 *     fix); its golden documents the before.
 * g4: resource-plan with the SAME affinity resource as g2 — the path that
 *     charges it correctly (538 tokens).
 *
 * KNOWN BUG pinned by g2 vs g4 (found 2026-07-18 while building these
 * goldens): `ak create` charges an affinity-only resource NOTHING (empty
 * receipt, remaining untouched) while `resource-plan` charges the identical
 * payload 538. Two glue paths assemble spend proposals independently and only
 * one wires the affinity payload in — the exact failure mode the Persona
 * Enforcement Program (P1.3/P1.4: one Allocator entry point) exists to end.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const GOLDENS = resolve(ROOT, "tests/fixtures/goldens");
const CREATED_AT = "2026-07-18T00:00:00.000Z";

const SPECS = {
  "create-g1": [
    "create",
    "--room", "size=small;count=1",
    "--hazard", "affinity=fire;expression=emit;proximityRadius=2",
    "--delver", "count=1;affinity=water;motivation=attacking",
    "--budget-tokens", "5000",
    "--run-id", "golden_g1",
  ],
  "create-g2": [
    "create",
    "--resource", "affinity=water;expression=emit;stacks=2;mana=50;manaRegen=5",
    "--resource", "permanenceMode=permanent;vital=health;delta=5;regen=2",
    "--budget-tokens", "5000",
    "--run-id", "golden_g2",
  ],
  "create-g3": [
    "create",
    "--delver", "count=1;affinity=water;motivation=attacking;goals=max_mana:high,mana_regen:high",
    "--delver-budget-tokens", "550",
    "--budget-tokens", "2000",
    "--run-id", "golden_g3",
  ],
  "resource-plan-g4": [
    "resource-plan",
    "--resource", "affinity=water;expression=emit;stacks=2;mana=50;manaRegen=5",
    "--budget-tokens", "5000",
    "--run-id", "golden_g4",
  ],
};

function runGolden(name) {
  const dir = mkdtempSync(join(os.tmpdir(), `ak-golden-${name}-`));
  const result = spawnSync(
    process.execPath,
    [CLI, ...SPECS[name], "--created-at", CREATED_AT, "--out-dir", dir],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  return dir;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

for (const name of Object.keys(SPECS)) {
  test(`golden ${name}: build output matches committed fixtures exactly`, () => {
    const goldenDir = join(GOLDENS, name);
    const files = readdirSync(goldenDir).filter((f) => f.endsWith(".json"));
    assert.ok(files.includes("budget-receipt.json"), "golden set includes the receipt");
    const outDir = runGolden(name);
    for (const file of files) {
      assert.deepEqual(
        readJson(join(outDir, file)),
        readJson(join(goldenDir, file)),
        `${name}/${file} drifted from golden — only a milestone that declares a ` +
          "behavior change may regenerate goldens, in the same diff",
      );
    }
  });
}

test("golden receipts charge: g1/g3/g4 spend nonzero and remaining reconciles", () => {
  for (const name of Object.keys(SPECS)) {
    const receipt = readJson(join(GOLDENS, name, "budget-receipt.json"));
    const lineItems = Array.isArray(receipt.lineItems) ? receipt.lineItems : [];
    const summed = lineItems.reduce((s, l) => s + (l.totalCost ?? 0), 0);
    assert.equal(summed, receipt.totalCost, `${name}: line items sum to totalCost`);
    if (name !== "create-g2") {
      assert.ok(receipt.totalCost > 0, `${name} receipt shows zero spend`);
    }
  }
});

test("BUG pinned: create charges the affinity resource 0; resource-plan charges the identical payload 538", () => {
  // g2's affinity resource (resource_1) contributes NO line items — only the
  // vital resource (resource_2) is charged. g4 proves the same payload prices
  // at 538 on the resource-plan path. Fix lands in P1 (single Allocator entry
  // point); this pin is deleted in that diff.
  const g2 = readJson(join(GOLDENS, "create-g2", "budget-receipt.json"));
  const g2AffinityLines = g2.lineItems.filter((l) => l.subjectRef?.id === "resource_1");
  assert.equal(g2AffinityLines.length, 0, "pinning the bug: affinity resource uncharged in create");
  assert.equal(g2.totalCost, 132, "only the vital resource is charged");

  const g4 = readJson(join(GOLDENS, "resource-plan-g4", "budget-receipt.json"));
  assert.equal(g4.totalCost, 538, "resource-plan charges the same payload fully");
  const g4Ids = g4.lineItems.map((l) => l.id).sort();
  assert.deepEqual(g4Ids, [
    "resource_affinity_base",
    "resource_affinity_expression_localized",
    "resource_affinity_stack",
    "resource_vital_mana_point",
    "resource_vital_mana_regen_tick",
  ]);
});

// ## TODO: Test Permutations
// - a golden with --price-list override: receipt honors the provided list
// - a golden that exhausts the budget: denial shape is stable
// - stability of manifest.json ordering when artifact count changes
