/**
 * #437 — sprint: two tiles in one turn for more stamina than regen returns. Shift with a move
 * key (an upper-case letter or shift+arrow) sprints; `x` arms a sprint for the next move, for
 * a keyboard or a phone without shift. The play session takes `{ kind: "move", params:
 * { direction, sprint: true } }` and core prices it; any actor may sprint.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { createGame } = require("../../packages/ui-ascii/src/game.js");
const { intentForKey, splitKeys, INTENT, HELP_LINES } = require("../../packages/ui-ascii/src/keymap.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const HALL = ["############", "S..........E", "############"];
const level = (motivations = ["user_controlled"]) => buildUnifiedLevel({ id: "sprint", tiles: HALL,
  actors: [{ category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals({ stamina: 30 }), motivations }] });

test("shift with a move key sprints; x arms a sprint; the help line says so", () => {
  assert.deepEqual(intentForKey("L"), { type: INTENT.MOVE, direction: "east", sprint: true });
  assert.deepEqual(intentForKey("D"), { type: INTENT.MOVE, direction: "east", sprint: true });
  assert.deepEqual(intentForKey("\u001b[1;2C"), { type: INTENT.MOVE, direction: "east", sprint: true });
  assert.deepEqual(intentForKey("l"), { type: INTENT.MOVE, direction: "east" });
  assert.deepEqual(intentForKey("x"), { type: INTENT.SPRINT });
  assert.deepEqual(splitKeys("l\u001b[1;2Cq"), ["l", "\u001b[1;2C", "q"]);
  assert.match(HELP_LINES.join("\n"), /Sprint 2 tiles: shift\+move, or x then a move/);
});

test("a sprint moves two tiles in one turn and costs more stamina than regen returns", async () => {
  const session = await createPlaySession(level());
  const staminaOf = (player) => player.vitals.find((vital) => vital.key === "stamina");
  const before = session.view().player;
  const stamina = staminaOf(before).current;
  const result = await session.act({ kind: "move", params: { direction: "east", sprint: true } });
  assert.equal(result.accepted.length, 1);
  const after = session.view().player;
  assert.deepEqual(after.position, { x: before.position.x + 2, y: 1 });
  assert.ok(staminaOf(after).current < stamina, "a net drain, after this turn's regen");
});

test("the game sprints on shift+move and on x then a move, then walks again", async () => {
  const game = await createGame({ levels: [{ name: "sprint", ...level() }], createSession: createPlaySession });
  const x = () => game.view().player.position.x;
  const start = x();
  await game.handle(intentForKey("L"));
  assert.equal(x(), start + 2);
  await game.handle(intentForKey("x"));
  await game.handle(intentForKey("l"));
  assert.equal(x(), start + 4);
  await game.handle(intentForKey("l"));
  assert.equal(x(), start + 5, "x arms one move only");
});

test("a malformed sprint flag is refused before a tick", async () => {
  const session = await createPlaySession(level());
  await assert.rejects(() => session.act({ kind: "move", params: { direction: "east", sprint: "yes" } }), /sprint/);
});

// ## TODO: Test Permutations
// - x pressed twice turns the sprint off
// - a sprint into a wall one tile away is refused and takes the turn
// - a companion ordered with a sprint command sprints
