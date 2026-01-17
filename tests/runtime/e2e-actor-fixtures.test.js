const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const FIXTURES_DIR = resolve(__dirname, "../fixtures/e2e/actors");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const EXPECTED_TIERS = new Map([
  [1, { width: 5, height: 5, count: 1 }],
  [2, { width: 10, height: 10, count: 3 }],
  [3, { width: 20, height: 20, count: 10 }],
  [4, { width: 50, height: 50, count: 20 }],
  [5, { width: 100, height: 100, count: 50 }],
  [6, { width: 1000, height: 1000, count: 500 }],
]);

test("e2e actor fixtures include deterministic, varied actor sets", async () => {
  const { AFFINITY_KINDS, AFFINITY_EXPRESSIONS } = await import(
    moduleUrl("packages/runtime/src/personas/configurator/affinity-loadouts.js")
  );
  const { MOTIVATION_KINDS } = await import(
    moduleUrl("packages/runtime/src/personas/configurator/motivation-loadouts.js")
  );

  const files = readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith("e2e-actors-") && name.endsWith(".json"))
    .sort();

  assert.ok(files.length > 0);

  const seenAffinities = new Set();
  const seenExpressions = new Set();
  const seenMotivations = new Set();

  files.forEach((name) => {
    const fixture = readJson(resolve(FIXTURES_DIR, name));
    assert.equal(fixture.schema, "agent-kernel/E2EActors");
    assert.equal(fixture.schemaVersion, 1);

    assert.ok(Number.isInteger(fixture.tier));
    assert.ok(EXPECTED_TIERS.has(fixture.tier));
    const expected = EXPECTED_TIERS.get(fixture.tier);
    assert.equal(fixture.level.width, expected.width);
    assert.equal(fixture.level.height, expected.height);
    assert.equal(fixture.actorCount, expected.count);

    assert.ok(Array.isArray(fixture.actors));
    assert.equal(fixture.actors.length, fixture.actorCount);

    const prefix = `tier${fixture.tier}_actor_`;
    const ids = new Set();
    const positions = new Set();

    fixture.actors.forEach((actor, index) => {
      assert.ok(typeof actor.id === "string" && actor.id.startsWith(prefix));
      assert.equal(actor.id, `${prefix}${index + 1}`);
      assert.ok(typeof actor.kind === "string" && actor.kind.length > 0);

      assert.ok(Number.isInteger(actor.position?.x));
      assert.ok(Number.isInteger(actor.position?.y));
      assert.ok(actor.position.x >= 0 && actor.position.x < fixture.level.width);
      assert.ok(actor.position.y >= 0 && actor.position.y < fixture.level.height);

      const vitalKeys = ["health", "mana", "stamina", "durability"];
      vitalKeys.forEach((key) => {
        const vital = actor.vitals?.[key];
        assert.ok(vital && Number.isFinite(vital.current));
        assert.ok(Number.isFinite(vital.max));
        assert.ok(Number.isFinite(vital.regen));
      });

      assert.ok(Array.isArray(actor.motivations));
      assert.ok(actor.motivations.length > 0);
      actor.motivations.forEach((entry) => {
        assert.ok(MOTIVATION_KINDS.includes(entry.kind));
        assert.ok(Number.isInteger(entry.intensity) && entry.intensity > 0);
        seenMotivations.add(entry.kind);
      });

      assert.ok(Array.isArray(actor.affinities));
      assert.ok(actor.affinities.length > 0);
      actor.affinities.forEach((entry) => {
        assert.ok(AFFINITY_KINDS.includes(entry.kind));
        assert.ok(AFFINITY_EXPRESSIONS.includes(entry.expression));
        assert.ok(Number.isInteger(entry.stacks) && entry.stacks > 0);
        seenAffinities.add(entry.kind);
        seenExpressions.add(entry.expression);
      });

      ids.add(actor.id);
      positions.add(`${actor.position.x},${actor.position.y}`);
    });

    assert.equal(ids.size, fixture.actors.length);
    assert.equal(positions.size, fixture.actors.length);
  });

  assert.ok(seenAffinities.size >= 3);
  assert.ok(seenExpressions.size >= 3);
  assert.ok(seenMotivations.size >= 3);
});
