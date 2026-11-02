/**
 * `ai_controlled` (Darren, 2026-11-02): any actor, hazards included, may be driven by an AI
 * through the seat a player uses. It is not the player's party, it is priced by the Allocator
 * as the playable premium, and it excludes `user_controlled` on the same actor.
 */
const assert = require("node:assert/strict");

const { createPlaySession, aiControlledActorIds } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = ["#########", "S.......#", "#.......#", "#.......E", "#########"];
const delver = (id, position, motivations) => ({ category: "delver", id, position, vitals: viableVitals(), motivations });
const warden = (id, position, motivations) => ({ category: "warden", id, position, vitals: viableVitals(), motivations });

function level(actors) {
  return buildUnifiedLevel({ id: "ai_room", tiles: ROOM, actors });
}

test("an ai_controlled warden can be seated and commanded; it is not in the player's party", async () => {
  const hero = delver("hero", { x: 1, y: 1 }, ["user_controlled"]);
  const guard = warden("guard", { x: 6, y: 2 }, ["ai_controlled"]);
  const session = await createPlaySession(level([hero, guard]));
  assert.deepEqual(aiControlledActorIds(level([hero, guard]).initialState), ["guard"]);
  assert.deepEqual(session.view().party.map((member) => member.id), ["hero"]);
  assert.deepEqual(session.view().aiControlled.map((member) => member.id), ["guard"]);

  const switched = session.switchTo("guard");
  assert.equal(switched.ok, true);
  const result = await session.act({ kind: "move", params: { direction: "west" } });
  assert.equal(result.accepted.length, 1, JSON.stringify(result.rejected));
  assert.equal(result.accepted[0].actorId, "guard");
});

test("an actor without ai_controlled or user_controlled is still refused", async () => {
  const hero = delver("hero", { x: 1, y: 1 }, ["user_controlled"]);
  const guard = warden("guard", { x: 6, y: 2 }, ["stationary"]);
  const session = await createPlaySession(level([hero, guard]));
  assert.equal(session.view().aiControlled, undefined);
  assert.equal(session.switchTo("guard").reason, "not_playable");
});

test("a level with only ai_controlled actors seats the first of them", async () => {
  const bot = delver("bot", { x: 1, y: 1 }, ["ai_controlled", "exploring"]);
  const guard = warden("guard", { x: 6, y: 2 }, ["stationary"]);
  const session = await createPlaySession(level([bot, guard]));
  assert.equal(session.activeActorId(), "bot");
});
