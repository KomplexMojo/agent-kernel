/**
 * #673 — the tactic catalogue is data the benefit gate (#674) reads. Check its shape and that
 * every strategy snippet it quotes is something the Actor's strategy normaliser accepts.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const catalogue = JSON.parse(readFileSync(join(__dirname, "../../docs/design/actor-tactic-catalogue.json"), "utf8"));

test("every entry has the fields the gate reads", () => {
  assert.equal(catalogue.schema, "agon/ActorTacticCatalogue");
  const ids = new Set();
  for (const entry of catalogue.entries) {
    assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(catalogue.classes.includes(entry.class), `${entry.id} class`);
    assert.ok(catalogue.classes.includes(entry.observed), `${entry.id} observed`);
    for (const key of ["trigger", "action", "gap"]) assert.equal(typeof entry[key], "string", `${entry.id} ${key}`);
    assert.ok(entry.evidence.length > 0, `${entry.id} cites a run`);
    for (const item of entry.evidence) assert.ok(catalogue.evidence.runs[item.run], `${entry.id} run ${item.run}`);
    for (const pressure of entry.vitalPressure) {
      assert.ok(["health", "mana", "stamina", "durability"].includes(pressure.vital));
      assert.ok(Array.isArray(pressure.optionsLost));
      assert.equal(typeof pressure.reactedAt25, "boolean");
    }
  }
});

test("quoted strategy snippets are valid Actor strategy data", async () => {
  const { normalizeStrategy } = await import("../../packages/runtime/src/personas/actor/strategy.js");
  const normalizeCommand = (action) => ({ kind: action.kind, params: action.params ?? {} });
  for (const entry of catalogue.entries) {
    const strategy = entry.covers?.strategy;
    if (!strategy) continue;
    const body = strategy.when ? { tactics: [strategy] } : strategy;
    assert.doesNotThrow(() => normalizeStrategy(body, normalizeCommand), entry.id);
  }
});

// ## TODO: Test Permutations
// - a winning run adds a `works` entry with measured token value
// - each vitalPressure turn count matches a recorded seat-run log
