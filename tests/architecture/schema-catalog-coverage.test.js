/**
 * PA.5a — the schema classification is a MIRROR of artifacts.ts, and this is what
 * keeps it one.
 *
 * The PA.5 census (2026-08-13) found that "artifacts.ts defines too many schemas" was
 * partly a MEASUREMENT problem: the count is of `agent-kernel/*` strings, and those
 * strings name three different kinds of thing — persisted artifacts that carry
 * `meta: ArtifactMeta` and get written to disk, in-process protocol messages that
 * deliberately carry no meta and are never persisted, and constants with no envelope
 * interface at all (two of which, ActorArtifact and LayoutArtifact, are not artifacts
 * but the type half of a `subjectRef`).
 *
 * `SCHEMA_KIND_BY_SCHEMA` records that classification so the surface can be counted
 * honestly. But a hand-maintained table beside the code it describes is the second
 * origin this branch has now watched rot in four separate forms — the `.mts` READMEs,
 * the orphaned allowlist dispositions, the stale CR.4 registry entry, the persona
 * README/registry pair. So the table is never trusted: every assertion below DERIVES
 * the answer from artifacts.ts's own text and fails when the table disagrees.
 *
 * ⚠️ The orphan test is the one that matters most in a year. An entry that outlives the
 * schema it describes is the orphaned-disposition failure this board has recorded four
 * times, and it is invisible in the safe-looking direction: a stale row reads as coverage.
 *
 * ⚠️ **Honest note on that one's perturbation.** It could not be triggered by editing the
 * classification, because `SCHEMA_KIND_BY_SCHEMA` is keyed by the IMPORTED CONSTANTS
 * rather than by string literals (M9 forbids the literals in production anyway) — so
 * deleting a schema from artifacts.ts breaks schema-catalog.js's import first, loudly,
 * before an orphan can exist. That is a good property, not a gap. Its teeth were proven
 * instead by making the deriver skip one schema, simulating artifacts.ts no longer
 * declaring it: exactly this test fails, and no other.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const ARTIFACTS = resolve(ROOT, "packages/runtime/src/contracts/artifacts.ts");

/**
 * Derive, from artifacts.ts alone, what kind each schema is.
 *
 * The rule is structural, not editorial:
 *   an envelope interface declaring `meta: ArtifactMeta`  -> persisted_artifact
 *   an envelope interface without it                      -> protocol_message
 *   no envelope interface                                 -> untyped
 */
function deriveKinds() {
  const src = readFileSync(ARTIFACTS, "utf8");
  const blocks = [...src.matchAll(/export interface ([A-Za-z0-9_]+)[^{]*\{([\s\S]*?)\n\}/g)];
  const kinds = new Map();
  for (const m of src.matchAll(/export const ([A-Z0-9_]+)\s*=\s*"(agent-kernel\/[A-Za-z0-9_]+)"/g)) {
    const [, constName, value] = m;
    const block = blocks.find((b) => new RegExp(`schema:\\s*typeof ${constName}\\b`).test(b[2]));
    if (!block) kinds.set(value, "untyped");
    else if (/\n\s*meta\??:\s*ArtifactMeta/.test(block[2])) kinds.set(value, "persisted_artifact");
    else kinds.set(value, "protocol_message");
  }
  return kinds;
}

test("every schema declared in artifacts.ts is classified", async () => {
  const { SCHEMA_KIND_BY_SCHEMA } = await import("../../packages/runtime/src/contracts/schema-catalog.js");
  const derived = deriveKinds();

  assert.ok(derived.size > 0, "precondition: the deriver must actually find schemas, or every assertion below is vacuous");

  const unclassified = [...derived.keys()].filter((schema) => !(schema in SCHEMA_KIND_BY_SCHEMA));
  assert.deepEqual(
    unclassified,
    [],
    "schemas declared in artifacts.ts with no entry in SCHEMA_KIND_BY_SCHEMA. An unclassified "
      + "schema puts the surface back to an uncountable pile of strings, which is the measurement "
      + "problem PA.5a exists to end",
  );
});

test("no classification entry outlives the schema it describes", async () => {
  const { SCHEMA_KIND_BY_SCHEMA } = await import("../../packages/runtime/src/contracts/schema-catalog.js");
  const derived = deriveKinds();

  const orphans = Object.keys(SCHEMA_KIND_BY_SCHEMA).filter((schema) => !derived.has(schema));
  assert.deepEqual(
    orphans,
    [],
    "classified schemas that artifacts.ts no longer declares. A row that outlives its subject "
      + "reads as coverage — the orphaned-disposition failure this branch has recorded four times, "
      + "and it always fails in the safe-looking direction",
  );
});

test("the classification agrees with artifacts.ts, kind for kind", async () => {
  const { SCHEMA_KIND_BY_SCHEMA } = await import("../../packages/runtime/src/contracts/schema-catalog.js");
  const derived = deriveKinds();

  const disagreements = [];
  for (const [schema, kind] of derived) {
    if (SCHEMA_KIND_BY_SCHEMA[schema] !== kind) {
      disagreements.push(`${schema}: artifacts.ts says ${kind}, the catalog says ${SCHEMA_KIND_BY_SCHEMA[schema]}`);
    }
  }
  assert.deepEqual(
    disagreements,
    [],
    "the catalog is a MIRROR of artifacts.ts, not a second declaration of the same fact. "
      + "Adding `meta: ArtifactMeta` to a protocol message, or removing it from an artifact, "
      + "changes what the schema IS and must change its classification in the same diff",
  );
});

/**
 * ⚠️ THE EMITTED CATALOG MUST NOT CARRY THE KIND, and this test is here to keep it that
 * way rather than to check that it does.
 *
 * PA.5a's first attempt attached `kind` to every emitted entry — one derived field, one
 * origin, apparently free. Four golden manifests failed on the spot: `createSchemaCatalog`'s
 * output is EMBEDDED in the build manifest, so an entry's shape is a persisted,
 * golden-pinned artifact and adding a field to it is a `schemaVersion` question about the
 * manifest. Every emitted entry is still classified — through `schemaKindOf`, which reads
 * the map — but the classification stays out of the bytes that get written.
 */
test("the classification does not leak into the emitted (golden-pinned) catalog", async () => {
  const { createSchemaCatalog, schemaKindOf } = await import("../../packages/runtime/src/contracts/schema-catalog.js");

  const catalog = createSchemaCatalog({ clock: () => "2026-08-13T00:00:00.000Z" });
  assert.ok(catalog.schemas.length > 0, "precondition: the catalog must emit entries");

  const leaked = catalog.schemas.filter((entry) => "kind" in entry);
  assert.deepEqual(
    leaked.map((e) => e.schema),
    [],
    "a `kind` field reached the emitted catalog, which is embedded in golden-pinned build "
      + "manifests. Adding a field there is a manifest schemaVersion decision, not a "
      + "side effect of classifying schemas",
  );

  // Classified all the same — the map answers for every entry the catalog emits.
  const unclassified = catalog.schemas.filter((entry) => !schemaKindOf(entry.schema));
  assert.deepEqual(unclassified.map((e) => e.schema), []);
});

test("the counts the review actually turns on", async () => {
  const { SCHEMA_KIND_BY_SCHEMA, SCHEMA_KINDS } = await import("../../packages/runtime/src/contracts/schema-catalog.js");

  const tally = { persisted_artifact: 0, protocol_message: 0, untyped: 0 };
  for (const kind of Object.values(SCHEMA_KIND_BY_SCHEMA)) tally[kind] += 1;

  // Not pinned to exact numbers: PA.5b may legitimately move them, and a test that fails
  // on every new schema teaches people to edit the test. What is pinned is the DISTINCTION
  // — that all three kinds are populated, so nobody can quietly collapse the classification
  // back into "65 schemas" by classifying everything the same way.
  assert.ok(tally[SCHEMA_KINDS.PERSISTED_ARTIFACT] > 0);
  assert.ok(tally[SCHEMA_KINDS.PROTOCOL_MESSAGE] > 0, "protocol messages are a real kind; see BudgetEnvelope's note in artifacts.ts");
  assert.ok(tally[SCHEMA_KINDS.UNTYPED] > 0, "M8 relocated seven constants without inventing interfaces; that is still true");
  assert.equal(
    tally.persisted_artifact + tally.protocol_message + tally.untyped,
    Object.keys(SCHEMA_KIND_BY_SCHEMA).length,
    "every classified schema must land in exactly one kind",
  );
});

// ## TODO: Test Permutations
// - a schema whose interface gains `meta` without its classification changing
// - a new schema const added to artifacts.ts with no catalog entry
// - a classification entry for a schema deleted from artifacts.ts
// - a fourth kind added to SCHEMA_KINDS without the deriver learning it
