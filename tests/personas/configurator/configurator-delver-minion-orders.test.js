/**
 * Player minions (delver retinue) must be able to follow mid-game orders.
 *
 * Trace (playtest generate-random seed 12, Orders: "D3 ignores its orders"):
 *   composeRetinue authored delver minions as escorting+friendly only
 *   → Actor strategyDepth → none (needs goal_oriented / strategy_focused / user_controlled)
 *   → followStrategy returns status "ignored"
 *   → UI: "ignores its orders"
 * Product intent (retinue.js): "escort it and take its orders".
 */
"use strict";

const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const ROOM = [
  "############",
  "S..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........E",
  "############",
];

async function composeDelverMinions() {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  const hero = {
    id: "hero-1",
    category: "delver",
    motivations: ["user_controlled"],
    vitals: { health: { current: 10, max: 10, regen: 1 } },
    affinities: [{ kind: "corrode", expression: "push", stacks: 3 }],
    activeAffinityKey: "corrode:push",
  };
  return configurator.compileTactics({
    tactics: [{ tactic: "retinue", params: { leader: "hero-1", roles: "support+striker+shield" } }],
    layout: { rooms: [{ id: "R1", x: 1, y: 1, width: 8, height: 8 }] },
    actors: [hero],
    seed: 12,
  });
}

test("a delver minion is authored with goal_oriented so Actor can follow orders", async () => {
  const { actors, report } = await composeDelverMinions();
  const minions = report[0].minions.map(({ id }) => actors.find((actor) => actor.id === id));
  assert.ok(minions.length >= 1);
  for (const minion of minions) {
    assert.ok(minion.motivations.includes("escorting"), `${minion.id} escorts`);
    assert.ok(minion.motivations.includes("friendly"), `${minion.id} is orderable`);
    assert.ok(minion.motivations.includes("goal_oriented"),
      `${minion.id} motivations ${JSON.stringify(minion.motivations)} must reach strategy goals`);
    assert.equal(minion.motivations.includes("user_controlled"), false, "minions are never playable");
  }
});

test("a delver minion given a reach order follows it instead of ignoring it", async () => {
  const { actors, report } = await composeDelverMinions();
  const minionSpec = report[0].minions[0];
  const authored = actors.find((actor) => actor.id === minionSpec.id);
  const hero = {
    category: "delver",
    id: "hero-1",
    position: { x: 1, y: 1 },
    vitals: viableVitals(),
    motivations: ["user_controlled"],
  };
  const minion = {
    ...authored,
    position: { x: 1, y: 3 },
    vitals: viableVitals(),
  };
  const session = await createPlaySession(buildUnifiedLevel({
    id: "minion_orders",
    tiles: ROOM,
    actors: [hero, minion],
  }));
  const ordered = await session.order(minion.id, { goals: [{ kind: "reach", place: { x: 5, y: 3 } }] });
  assert.equal(ordered.ok, true);
  const result = await session.advance({ ticks: 20, until: "orders_done" });
  const entry = session.view().orders.find((row) => row.id === minion.id);
  assert.notEqual(entry?.status, "ignored",
    `authored minion must not ignore orders; got ${JSON.stringify(entry)}`);
  assert.equal(result.stoppedBy, "orders_done", JSON.stringify(session.view().orders));
  const at = session.view().actors.find((actor) => actor.id === minion.id)?.position
    ?? session.view().player?.position;
  assert.ok(at && Math.max(Math.abs(at.x - 5), Math.abs(at.y - 3)) <= 1,
    `minion should reach the ordered place, at ${JSON.stringify(at)}`);
});
