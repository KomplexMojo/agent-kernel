const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");

const ROOT = resolve(__dirname, "..", "..");
const BUNDLE_DIR = resolve(ROOT, "tests/fixtures/ui/build-spec-bundle");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeJsonText(text) {
  return text.replace(/\s+$/, "");
}

function assertSortedSchemas(schemaEntries) {
  const names = schemaEntries.map((entry) => entry.schema);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted);
}

test("build spec bundle fixture preserves spec serialization order", () => {
  const specPath = join(BUNDLE_DIR, "spec.json");
  const raw = normalizeJsonText(readFileSync(specPath, "utf8"));
  const parsed = JSON.parse(raw);
  const serialized = JSON.stringify(parsed, null, 2);
  assert.equal(serialized, raw);
});

test("build spec bundle manifest and bundle are consistent", () => {
  const manifest = readJson(join(BUNDLE_DIR, "manifest.json"));
  const bundle = readJson(join(BUNDLE_DIR, "bundle.json"));
  const spec = readJson(join(BUNDLE_DIR, manifest.specPath));

  assert.deepEqual(bundle.spec, spec);
  assert.equal(Array.isArray(manifest.schemas), true);
  assertSortedSchemas(manifest.schemas);
  const expectedSchemas = new Set([spec.schema]);
  manifest.artifacts.forEach((entry) => expectedSchemas.add(entry.schema));
  const expectedSchemaNames = [...expectedSchemas].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(manifest.schemas.map((entry) => entry.schema), expectedSchemaNames);
  assert.deepEqual(bundle.schemas, manifest.schemas);
  assert.equal(Array.isArray(manifest.artifacts), true);
  assert.equal(Array.isArray(bundle.artifacts), true);
  assert.equal(bundle.artifacts.length, manifest.artifacts.length);

  const sorted = [...manifest.artifacts].sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });
  assert.deepEqual(manifest.artifacts, sorted);

  manifest.artifacts.forEach((entry, index) => {
    const artifact = bundle.artifacts[index];
    const fromFile = readJson(join(BUNDLE_DIR, entry.path));

    assert.equal(artifact.schema, entry.schema);
    assert.equal(artifact.schemaVersion, entry.schemaVersion);
    assert.equal(artifact.meta?.id, entry.id);
    assert.deepEqual(artifact, fromFile);
  });
});
