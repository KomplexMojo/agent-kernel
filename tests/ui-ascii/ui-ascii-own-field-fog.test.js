/**
 * Darren, 2026-10-29: your own emit field's reach shows through fog. You know where your own
 * aura reaches; out of sight a cell keeps only the kind of your field (no strength, no other
 * source), and another actor's field out of sight stays hidden.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const level = () => buildUnifiedLevel({
  id: "aura-fog", tiles: ["###############", "#.............E", "###############"],
  actors: [
    { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
      vitals: viableVitals({ mana: 80 }), affinities: [{ kind: "dark", expression: "emit", stacks: 3 }] },
    { category: "warden", id: "warden_1", position: { x: 12, y: 1 }, motivations: ["stationary"],
      vitals: viableVitals({ mana: 80 }), affinities: [{ kind: "fire", expression: "emit", stacks: 2 }] },
  ],
});

test("out of sight, a cell keeps only your own field's kind; another's field stays hidden", async () => {
  const session = await createPlaySession({ ...level(), fog: true });
  await session.act({ kind: "equip_affinity", params: { affinityKey: "dark:emit" } });
  const view = session.view();
  const at = (x) => view.field?.[1]?.[x] ?? [];
  assert.equal(view.rows[1][4], "?", "precondition: three tiles off is out of sight");
  assert.deepEqual(at(4).map((entry) => ({ kind: entry.kind, own: entry.own, sources: entry.sources })), [{ kind: "dark", own: true, sources: ["delver_1"] }]);
  assert.ok(at(4).every((entry) => entry.stacks === undefined && entry.intensity === undefined), "no strength out of sight");
  assert.deepEqual(at(11), [], "another actor's field out of sight stays hidden");
  assert.deepEqual(at(5), [], "past your reach, nothing");
});
