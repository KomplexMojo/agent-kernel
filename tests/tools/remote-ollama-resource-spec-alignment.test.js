const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { AK_CREATE_TOOL } = require("../../tools/remote-ollama-control/scripts/lib/ak-tool-schema");
const { normalizeToolArgs, REPO_ROOT } = require("../../tools/remote-ollama-control/scripts/lib/ak-runner");

// The CLI is the authority on which resource fields exist. Read its allow-list out of the
// source rather than restating it here: a copy would keep passing after the CLI moved on,
// which is exactly how the 2026-08-22 run lost 73 of 700 attempts to fields the benchmark
// advertised and the parser rejected.
function cliV3ResourceFields() {
  const source = readFileSync(
    join(REPO_ROOT, "packages/adapters-cli/src/cli/ak-impl.mjs"),
    "utf8",
  );
  const marker = "// V3: a vital payload";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "the V3 resource branch moved — this test must be re-anchored");
  const block = source.slice(start, source.indexOf("]);", start));
  const fields = [...block.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((match) => match[1]);
  assert.ok(fields.length >= 5, "failed to read the V3 allow-list out of the CLI");
  return new Set(fields);
}

function schemaResourceFields() {
  const resource = AK_CREATE_TOOL.function.parameters.properties.resource;
  return new Set(Object.keys(resource.items.properties));
}

test("every resource field offered to the model is one the CLI's V3 parser accepts", () => {
  const allowed = cliV3ResourceFields();
  const offered = [...schemaResourceFields()];
  const rejected = offered.filter((field) => !allowed.has(field));
  assert.deepEqual(
    rejected,
    [],
    `the tool schema offers resource fields the CLI rejects: ${rejected.join(", ")}`,
  );
});

test("no required-field combination steers the model into a shape the CLI rejects", () => {
  const allowed = cliV3ResourceFields();
  const resource = AK_CREATE_TOOL.function.parameters.properties.resource;
  const required = (resource.items.anyOf || []).flatMap((branch) => branch.required || []);
  const rejected = required.filter((field) => !allowed.has(field));
  assert.deepEqual(rejected, [], `anyOf demands fields the CLI rejects: ${rejected.join(", ")}`);
});

test("the resource description does not promise support the CLI withdrew", () => {
  const resource = AK_CREATE_TOOL.function.parameters.properties.resource;
  const allowed = cliV3ResourceFields();
  for (const field of ["tier", "stat", "dropRate"]) {
    if (allowed.has(field)) continue;
    assert.doesNotMatch(
      resource.description,
      new RegExp(field, "i"),
      `the description advertises "${field}", which the CLI no longer accepts`,
    );
  }
});

test("normalization never adds a resource field the CLI would reject", () => {
  const allowed = cliV3ResourceFields();
  // The shape the model actually produced in the 2026-08-22 run: a V3 payload with legacy
  // fields blended in. Normalization is the last chance to drop them before argv is built.
  const normalized = normalizeToolArgs({
    resource: [
      { permanenceMode: "permanent", vital: "mana", stat: "vitalRegen", delta: 1 },
      { tier: "level", stat: "vitalMax", delta: 8 },
      { affinity: "life", expression: "emit", stacks: 1, mana: 4, dropRate: 10 },
    ],
  });
  for (const spec of normalized.resource) {
    const rejected = Object.keys(spec).filter((field) => !allowed.has(field));
    assert.deepEqual(
      rejected,
      [],
      `normalization emitted ${rejected.join(", ")} for ${JSON.stringify(spec)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Combination-level conformance.
//
// The tests above check that every field NAME the schema offers is one the CLI accepts. That is
// necessary and was not sufficient: on 2026-08-23 the schema offered only legal names in two
// COMBINATIONS the parser rejects, and 57 of 700 benchmark attempts died on them. Worse, both were
// reported as bad enum VALUES for fields that were simply absent, so they read as model error --
// 71% of the best configuration's failures were this, not capability.
//
// So these drive the real CLI with objects the schema calls valid. A schema branch that cannot be
// executed is a promise to the model that the parser will break.

const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");

const AK_CLI = join(REPO_ROOT, "packages/adapters-cli/src/cli/ak.mjs");

// The benchmark hands the model an object and ships `key=value;key=value` to the CLI. Go through
// the same shape, so the test exercises the path the run actually takes.
function toSegments(resource) {
  return Object.entries(resource).map(([k, v]) => `${k}=${v}`).join(";");
}

function createWithResource(resource) {
  const outDir = mkdtempSync(join(tmpdir(), "ak-resource-conformance-"));
  return spawnSync(process.execPath, [
    AK_CLI, "create",
    "--resource", toSegments(resource),
    "--run-id", "run_resource_conformance",
    "--created-at", "2026-08-24T00:00:00.000Z",
    "--out-dir", outDir,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
}

// Derived from the schema, not hand-written to match it. A hand-written mirror passes even after
// someone adds a branch the parser cannot execute -- which is precisely the failure being guarded.
// Synthesising the minimal object for each branch means a NEW branch is exercised automatically.
function sampleValue(name, propertySchema) {
  const spec = propertySchema || {};
  if (Array.isArray(spec.enum)) return spec.enum[0];
  if (spec.type === "integer" || spec.type === "number") {
    return Number.isFinite(spec.minimum) ? Math.max(spec.minimum, 1) : 1;
  }
  return `sample_${name}`;
}

// A branch may nest its own anyOf (the vital payload needs delta OR regen), so each nested
// alternative becomes its own executable case rather than being collapsed to one.
function branchCases(branch, path = []) {
  const base = branch.required || [];
  if (!Array.isArray(branch.anyOf) || branch.anyOf.length === 0) {
    return [{ fields: base, label: path.join(" + ") || base.join(" + ") }];
  }
  return branch.anyOf.flatMap((nested, i) => branchCases(
    { ...nested, anyOf: nested.anyOf },
    [...path, `${base.join(" + ")} + ${(nested.required || []).join(" + ") || `alt${i}`}`],
  ).map((c) => ({ fields: [...base, ...c.fields], label: c.label })));
}

const RESOURCE_ITEMS = AK_CREATE_TOOL.function.parameters.properties.resource.items;
const DERIVED_CASES = (RESOURCE_ITEMS.anyOf || []).flatMap((b) => branchCases(b));

assert.ok(DERIVED_CASES.length >= 2, "failed to derive executable cases from the resource schema");

for (const { fields, label } of DERIVED_CASES) {
  test(`every schema branch is executable by the CLI: ${label}`, () => {
    const resource = {};
    for (const field of fields) {
      resource[field] = sampleValue(field, RESOURCE_ITEMS.properties[field]);
    }
    const result = createWithResource(resource);
    assert.equal(
      result.status, 0,
      `the tool schema advertises this branch but the CLI rejects it:\n`
      + `  ${toSegments(resource)}\n  ${(result.stderr || result.stdout || "").trim()}`,
    );
  });
}

// The two shapes that actually cost the run. Both are now unrepresentable in the schema, and both
// must stay rejected by the CLI -- if either starts passing, the schema branches above are the
// thing to re-derive, not these expectations.
test("the two shapes that cost 57 attempts are rejected by the CLI and unrepresentable in the schema", () => {
  const affinityWithPermanence = { affinity: "fire", expression: "emit", stacks: 1, mana: 25, permanenceMode: "consumable" };
  const vitalWithoutPermanence = { vital: "health", delta: 15, expression: "emit", stacks: 3 };

  assert.notEqual(createWithResource(affinityWithPermanence).status, 0,
    "an affinity payload carrying permanenceMode should still be rejected");
  assert.notEqual(createWithResource(vitalWithoutPermanence).status, 0,
    "a vital payload without permanenceMode should still be rejected");

  // ...and the schema must no longer advertise them.
  const items = AK_CREATE_TOOL.function.parameters.properties.resource.items;
  const branches = items.anyOf || [];
  const vitalBranch = branches.find((b) => (b.required || []).includes("vital"));
  const affinityBranch = branches.find((b) => (b.required || []).includes("affinity"));

  assert.ok(vitalBranch.required.includes("permanenceMode"),
    "the vital branch must require permanenceMode — the parser validates it as an enum and absent fails");
  assert.ok(affinityBranch.not,
    "the affinity-only branch must exclude the vital-payload keys the parser reads as a vital declaration");
  const excluded = (affinityBranch.not.anyOf || []).flatMap((b) => b.required || []);
  assert.deepEqual([...excluded].sort(), ["delta", "permanenceMode", "regen", "vital"]);
});
