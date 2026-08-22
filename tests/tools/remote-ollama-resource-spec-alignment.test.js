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
