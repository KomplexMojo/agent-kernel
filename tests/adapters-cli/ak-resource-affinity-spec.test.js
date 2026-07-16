/**
 * M7 — CLI resource affinity spec: failing tests
 *
 * The --resource V3 spec today is vital-only:
 *   permanenceMode=<consumable|level|permanent>;vital=<health|mana|stamina>;delta=<n>
 * There is no way to author a resource that grants an affinity, which is the whole
 * point of a resource as a lure.
 *
 * M8 extends V3 additively so a resource may carry an affinity payload, a vital
 * payload, or both:
 *   --resource "affinity=water;expression=emit;stacks=2;mana=50;manaRegen=5"
 *
 * manaRegen > 0 is what makes the granted affinity permanent — there is no tier or
 * permanent flag on the affinity payload. permanenceMode stays what it always was:
 * the VITAL payload's mode (current vs max). The two are orthogonal.
 *
 * Tests MUST FAIL until M8 implements:
 *   1. `affinity` as a V3 trigger key + affinity/expression/stacks/mana/manaRegen fields
 *   2. an affinity-only resource (vitals: []) accepted without permanenceMode/vital
 *   3. optional `affinity` on ResourceArtifactV3 (additive — no version bump)
 *   4. help text documenting the affinity fields
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

function outDir() {
  return mkdtempSync(join(os.tmpdir(), "ak-resource-affinity-"));
}

function planResource(spec, extra = []) {
  const dir = outDir();
  const result = runCli([
    "resource-plan",
    "--resource", spec,
    "--out-dir", dir,
    "--run-id", "test_run",
    "--created-at", "2026-07-16T00:00:00.000Z",
    ...extra,
  ]);
  return { result, dir };
}

function readArtifacts(dir) {
  // resource-plan writes its artifact set under the out dir; find the resource one.
  const { readdirSync } = require("node:fs");
  const files = readdirSync(dir, { recursive: true });
  const match = files
    .filter((f) => typeof f === "string" && f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return match;
}

function findResourceArtifacts(dir) {
  const all = readArtifacts(dir);
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.schema === "agent-kernel/ResourceArtifact") found.push(node);
    Object.values(node).forEach(walk);
  };
  all.forEach(walk);
  return found;
}

test("an affinity-only resource spec is accepted", () => {
  const { result } = planResource("affinity=water;expression=emit;stacks=2;mana=50;manaRegen=0");
  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
});

test("the affinity payload round-trips onto the ResourceArtifact", () => {
  const { result, dir } = planResource(
    "affinity=water;expression=emit;stacks=2;mana=50;manaRegen=5",
  );
  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  const resources = findResourceArtifacts(dir);
  assert.ok(resources.length > 0, "expected a ResourceArtifact to be written");
  const affinityResource = resources.find((r) => r.affinity);
  assert.ok(affinityResource, "expected a resource carrying an affinity payload");
  assert.equal(affinityResource.affinity.kind, "water");
  assert.equal(affinityResource.affinity.expression, "emit");
  assert.equal(affinityResource.affinity.stacks, 2);
  assert.equal(affinityResource.affinity.mana, 50);
  assert.equal(affinityResource.affinity.manaRegen, 5);
});

test("manaRegen defaults to 0 (temporary) when omitted", () => {
  const { result, dir } = planResource("affinity=water;expression=emit;stacks=1;mana=10");
  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  const affinityResource = findResourceArtifacts(dir).find((r) => r.affinity);
  assert.ok(affinityResource);
  assert.equal(affinityResource.affinity.manaRegen, 0);
});

test("a resource may carry both a vital and an affinity payload", () => {
  const { result, dir } = planResource(
    "permanenceMode=consumable;vital=health;delta=3;affinity=fire;expression=push;stacks=1;mana=20",
  );
  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  const both = findResourceArtifacts(dir).find((r) => r.affinity && Array.isArray(r.vitals) && r.vitals.length > 0);
  assert.ok(both, "expected a resource with both payloads");
  assert.equal(both.affinity.kind, "fire");
  assert.equal(both.vitals[0].key, "health");
  assert.equal(both.vitals[0].delta, 3);
});

test("an affinity-only resource carries an empty vitals array, not a missing one", () => {
  const { dir } = planResource("affinity=water;expression=emit;stacks=1;mana=10");
  const affinityResource = findResourceArtifacts(dir).find((r) => r.affinity);
  assert.ok(Array.isArray(affinityResource.vitals), "vitals must stay present for V3 readers");
  assert.equal(affinityResource.vitals.length, 0);
});

test("the artifact stays schemaVersion 3 — the affinity field is additive", () => {
  const { dir } = planResource("affinity=water;expression=emit;stacks=1;mana=10");
  const affinityResource = findResourceArtifacts(dir).find((r) => r.affinity);
  assert.equal(affinityResource.schemaVersion, 3);
});

test("invalid affinity kind is rejected", () => {
  const { result } = planResource("affinity=nonsense;expression=emit;stacks=1;mana=10");
  assert.notEqual(result.status, 0);
  assert.match([result.stdout, result.stderr].join("\n"), /affinity/i);
});

test("invalid expression is rejected", () => {
  const { result } = planResource("affinity=water;expression=nonsense;stacks=1;mana=10");
  assert.notEqual(result.status, 0);
  assert.match([result.stdout, result.stderr].join("\n"), /expression/i);
});

test("affinity without an expression is rejected", () => {
  const { result } = planResource("affinity=water;stacks=1;mana=10");
  assert.notEqual(result.status, 0);
});

test("non-integer or negative stacks/mana/manaRegen are rejected", () => {
  for (const spec of [
    "affinity=water;expression=emit;stacks=0;mana=10",
    "affinity=water;expression=emit;stacks=-1;mana=10",
    "affinity=water;expression=emit;stacks=1;mana=-5",
    "affinity=water;expression=emit;stacks=1;mana=10;manaRegen=-2",
    "affinity=water;expression=emit;stacks=abc;mana=10",
  ]) {
    const { result } = planResource(spec);
    assert.notEqual(result.status, 0, `expected rejection for: ${spec}`);
  }
});

test("regen with no mana pool is rejected — regen would refill nothing", () => {
  const { result } = planResource("affinity=water;expression=emit;stacks=1;mana=0;manaRegen=3");
  assert.notEqual(result.status, 0);
});

// ---------------------------------------------------------------------------
// End-to-end budget charging.
//
// These exist because the unit tests LIED. buildSpendProposal priced affinity
// resources correctly in isolation while the CLI still charged nothing, because
// buildspec-assembler's resource normalizer is an ALLOWLIST and silently dropped
// the affinity payload between authoring and the spend proposal. Nothing failed —
// the resource was simply free.
//
// Assert against the real budget receipt, not an internal function.
// ---------------------------------------------------------------------------

function receiptFor(spec) {
  const { dir, result } = planResource(spec, ["--budget-tokens", "5000"]);
  assert.equal(result.status, 0, [result.stdout, result.stderr].join("\n"));
  return JSON.parse(readFileSync(join(dir, "budget-receipt.json"), "utf8"));
}

test("an affinity resource is actually charged against the build budget", () => {
  const receipt = receiptFor("affinity=water;expression=emit;stacks=2;mana=50;manaRegen=0");
  const charged = 5000 - receipt.remaining;
  assert.ok(charged > 0, `affinity resource must not be free (charged ${charged})`);
});

test("a permanent resource costs significantly more than the identical temporary one", () => {
  const temporary = 5000 - receiptFor("affinity=water;expression=emit;stacks=2;mana=50;manaRegen=0").remaining;
  const permanent = 5000 - receiptFor("affinity=water;expression=emit;stacks=2;mana=50;manaRegen=5").remaining;
  assert.ok(
    permanent > temporary,
    `permanent (${permanent}) must cost more than temporary (${temporary})`,
  );
  // The gap is what makes permanent resources naturally scarce within a budget.
  // If this ever collapses, the no-hard-cap design silently stops working.
  assert.ok(
    permanent - temporary >= 100,
    `gap of ${permanent - temporary} is too small to limit anything`,
  );
});

test("a budget too small for a permanent resource denies it — scarcity is emergent", () => {
  const { result } = planResource(
    "affinity=water;expression=emit;stacks=2;mana=50;manaRegen=5",
    ["--budget-tokens", "50"],
  );
  const output = [result.stdout, result.stderr].join("\n");
  assert.ok(
    result.status !== 0 || /denied/i.test(output),
    "a 50-token budget must not afford a 538-token permanent resource",
  );
});

test("the vital regen of a vital+regen resource reaches the budget", () => {
  const withRegen = 5000 - receiptFor("permanenceMode=consumable;vital=health;delta=5;regen=3").remaining;
  const without = 5000 - receiptFor("permanenceMode=consumable;vital=health;delta=5").remaining;
  assert.ok(withRegen > without, `regen must be charged (${withRegen} vs ${without})`);
});

test("help documents the affinity resource fields", () => {
  const result = runCli(["--help"]);
  const output = [result.stdout, result.stderr].join("\n");
  assert.match(output, /affinity=/);
  assert.match(output, /manaRegen/);
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations
//
// Hand to Ollama (/ollama-test-permutations) once M8 is green. Expand:
//   - All 10 affinity kinds × 4 expressions parse and round-trip.
//   - Field ordering within the spec string does not matter.
//   - Repeated --resource flags produce distinct ids.
//   - Explicit id= is honoured on affinity resources.
//   - The legacy V1 spec (tier=;stat=;delta=;dropRate=) still parses unchanged.
//   - create/configure accept affinity resources, not just resource-plan.
// ---------------------------------------------------------------------------
