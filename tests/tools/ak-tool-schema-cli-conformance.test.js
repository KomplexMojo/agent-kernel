const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const { AK_CREATE_TOOL } = require("../../tools/remote-ollama-control/scripts/lib/ak-tool-schema");

const ROOT = resolve(__dirname, "../..");
const AK_CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

// Every shape the tool schema advertises must be one the CLI can execute.
//
// The benchmark hands this schema to a model and ships whatever comes back to `ak create`. A branch
// the parser rejects is therefore not a documentation slip -- it is a trap the model is steered
// into. Two of them cost 57 of 700 attempts on 2026-08-23, and because both were reported as bad
// enum VALUES for fields that were simply absent, they read as model error rather than as a
// contract mismatch.
//
// The existing alignment test checks field NAMES. This checks the shapes those names form, by
// DERIVING a minimal object from the schema and running the real CLI with it. Derivation is the
// point: a hand-written sample passes against a defective schema too, which makes it a mirror of
// the schema rather than a guard on it.

const ENTITY_FLAGS = {
  room: "--room",
  floorTile: "--floor-tile",
  hazard: "--hazard",
  resource: "--resource",
  delver: "--delver",
  warden: "--warden",
};

// A value the CLI should accept, derived from the constraint the schema states. The order is the
// contract: a field whose legal values cannot be reached from `enum`, `examples` or `default` is
// under-specified, and `sampleValue` says so rather than guessing -- that is how hazard.mana was
// caught, carrying its grammar in prose where nothing could read it.
function sampleValue(field, spec = {}) {
  if (Array.isArray(spec.enum) && spec.enum.length > 0) return spec.enum[0];
  if (Array.isArray(spec.examples) && spec.examples.length > 0) return spec.examples[0];
  if (spec.default !== undefined) return spec.default;
  if (spec.type === "integer" || spec.type === "number") {
    return Math.max(Number.isFinite(spec.minimum) ? spec.minimum : 1, 1);
  }
  if (spec.type === "boolean") return false;
  if (spec.type === "string") {
    assert.equal(
      spec.pattern, undefined,
      `${field} constrains its value with a pattern but offers no examples to satisfy it — `
      + "a generator, and a model, can only guess",
    );
    return `sample_${field}`;
  }
  return null; // arrays and objects get their own coverage; not sampled here
}

// A branch may nest its own anyOf (a resource vital payload needs delta OR regen), so each nested
// alternative becomes a separate executable case instead of collapsing into one.
function branchFieldSets(branch) {
  const base = branch.required || [];
  if (!Array.isArray(branch.anyOf) || branch.anyOf.length === 0) return [base];
  return branch.anyOf.flatMap((nested) => branchFieldSets(nested).map((set) => [...base, ...set]));
}

function requiredFieldSets(items) {
  const base = items.required || [];
  if (!Array.isArray(items.anyOf) || items.anyOf.length === 0) return [base];
  return items.anyOf.flatMap((branch) => branchFieldSets(branch).map((set) => [...base, ...set]));
}

// dependentRequired states that one field drags others in. Honouring it is what separates a real
// schema client from a naive one: `resource.affinity` alone is invalid, and the schema says so.
function withDependents(fields, items) {
  const dependents = items.dependentRequired || {};
  const out = new Set(fields);
  let grew = true;
  while (grew) {
    grew = false;
    for (const field of [...out]) {
      for (const dependent of dependents[field] || []) {
        if (!out.has(dependent)) { out.add(dependent); grew = true; }
      }
    }
  }
  return [...out];
}

function buildSpec(fields, items) {
  const parts = [];
  for (const field of fields) {
    const value = sampleValue(field, (items.properties || {})[field]);
    if (value !== null) parts.push(`${field}=${value}`);
  }
  return parts.join(";");
}

function createWith(flag, spec) {
  const outDir = mkdtempSync(join(tmpdir(), "ak-conformance-"));
  return spawnSync(process.execPath, [
    AK_CLI, "create", flag, spec,
    "--run-id", "run_schema_conformance",
    "--created-at", "2026-08-24T00:00:00.000Z",
    "--out-dir", outDir,
  ], { cwd: ROOT, encoding: "utf8" });
}

for (const [entity, flag] of Object.entries(ENTITY_FLAGS)) {
  const property = AK_CREATE_TOOL.function.parameters.properties[entity];

  test(`the schema still offers a ${entity} entity`, () => {
    assert.ok(property && property.items, `${entity} vanished from the tool schema`);
  });

  const items = (property && property.items) || {};
  requiredFieldSets(items).forEach((fields, index) => {
    const resolved = withDependents(fields, items);
    test(`every ${entity} branch the schema advertises is executable [${index}: ${resolved.join(" + ") || "no required fields"}]`, () => {
      const spec = buildSpec(resolved, items);
      assert.notEqual(spec, "", `derived an empty ${entity} spec — the branch requires nothing`);
      const result = createWith(flag, spec);
      assert.equal(
        result.status, 0,
        `the tool schema advertises this ${entity} shape but the CLI rejects it:\n`
        + `  ${spec}\n  ${(result.stderr || result.stdout || "").trim().split("\n").pop()}`,
      );
    });
  });

  // Optional scalars are offered to the model on equal footing with required ones, so each has to
  // be executable too. This is where a field carrying its grammar in prose surfaces.
  const optional = Object.entries(items.properties || {})
    .filter(([field, spec]) => !(items.required || []).includes(field)
      && spec.type !== "array" && spec.type !== "object");

  for (const [field, spec] of optional) {
    test(`${entity}.${field} is executable alongside its required fields`, () => {
      const base = withDependents(requiredFieldSets(items)[0], items);
      const fields = withDependents([...new Set([...base, field])], items);
      const built = buildSpec(fields, items);
      const value = sampleValue(field, spec);
      if (value === null) return; // not a scalar after all
      const result = createWith(flag, built);
      assert.equal(
        result.status, 0,
        `the tool schema offers ${entity}.${field} but the CLI rejects it:\n`
        + `  ${built}\n  ${(result.stderr || result.stdout || "").trim().split("\n").pop()}`,
      );
    });
  }
}

// The other direction: a shape the CLI refuses must be one the schema refuses too. Conformance is
// two-sided, and this side is what the whole `create requires at least one authored object` class
// was — a call the schema called valid and the CLI always rejected.
test("a call that authors nothing is rejected by the CLI and unrepresentable in the schema", () => {
  const outDir = mkdtempSync(join(tmpdir(), "ak-conformance-empty-"));
  const result = spawnSync(process.execPath, [
    AK_CLI, "create",
    "--text", "Create eight rooms, three hazards and a delver party",
    "--run-id", "run_authors_nothing",
    "--created-at", "2026-08-24T00:00:00.000Z",
    "--out-dir", outDir,
  ], { cwd: ROOT, encoding: "utf8" });

  assert.notEqual(result.status, 0, "the CLI should refuse a create that authors nothing");
  assert.match(`${result.stdout}${result.stderr}`, /at least one authored object/);

  // ...and the schema must no longer offer it. Prose in `text` authors nothing, and the parameters
  // now say so structurally rather than trusting the model to infer it.
  const parameters = AK_CREATE_TOOL.function.parameters;
  const entityBranches = (parameters.anyOf || []).flatMap((branch) => branch.required || []);
  assert.deepEqual(
    [...entityBranches].sort(),
    ["delver", "floorTile", "hazard", "resource", "room", "warden"],
    "the top-level anyOf must require at least one authored entity",
  );

  // Every branch names a property that actually exists, or the constraint is unsatisfiable.
  for (const entity of entityBranches) {
    assert.ok(
      parameters.properties[entity],
      `the anyOf requires "${entity}" but the schema has no such property`,
    );
  }
});

test("the text field does not present itself as a place to author entities", () => {
  const text = AK_CREATE_TOOL.function.parameters.properties.text;
  // It is the one required string, so a model under load reaches for it. It has to say outright
  // that describing an entity here creates nothing.
  assert.match(text.description, /not where the dungeon is authored/i);
  for (const entity of ["room", "hazard", "resource", "delver", "warden"]) {
    assert.match(text.description, new RegExp(entity, "i"));
  }
});
