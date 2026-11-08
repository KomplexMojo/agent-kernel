/**
 * The game controller's touch-client surface (game.js): slots as buttons, tuning, list choices and
 * the screen in parts. The phone app in Primordial drives these through @agon/ui-ascii;
 * its page, build and report tests moved with it (#744).
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { createGame } = require("../../packages/ui-ascii/src/game.js");

const SRC = join(__dirname, "../../packages/ui-ascii/src");

// AK-19: the message band is combat observation (hits, sight, the annotator log), not how-to copy.
test("the battle log keeps cast-path and sprint how-to out of the message band", () => {
  const screen = readFileSync(join(SRC, "screen.js"), "utf8");
  const game = readFileSync(join(SRC, "game.js"), "utf8");
  assert.doesNotMatch(screen, /function castPathLine/);
  assert.doesNotMatch(screen, /mark where the last cast went/);
  assert.doesNotMatch(game, /your next move takes two tiles, for more stamina/);
  assert.match(game, /Sprint armed\./);
});

async function pwaGame() {
  const { loadBundledLevels } = require("../../packages/ui-ascii/src/levels.js");
  return createGame({ levels: loadBundledLevels(), showHelp: false });
}

test("slots() lists the slots and the affinities an empty one could take", async () => {
  const game = await pwaGame();
  const { slots, picks } = game.slots();
  assert.ok(slots.length >= 1);
  assert.ok(slots.every((slot) => slot.empty || (slot.key && slot.stacks.running >= 1 && slot.intensity.held >= 1)));
  const before = game.view().player.equippedAffinityKeys.length;
  if (picks.length) {
    await game.toggleSlotAffinity(picks[0].key);
    assert.equal(game.view().player.equippedAffinityKeys.length, before + 1, "equipping fills a slot");
    assert.equal(game.slots().slots.some((slot) => slot.key === picks[0].key), true);
  }
});

test("slots() gives each castable slot the mana one cast costs, and tuning it changes the mana", async () => {
  const game = await pwaGame();
  const slot = game.slots().slots.find((entry) => entry.castable);
  if (!slot) return;
  assert.equal(typeof slot.mana, "number");
  assert.ok(slot.mana > 0);
  if (slot.stacks.held > 1) {
    await game.tuneSlot(slot.key, "stacks", -1);
    assert.ok(game.slots().slots.find((entry) => entry.key === slot.key).mana < slot.mana, "a shorter range costs less");
  }
});

test("screen({ parts }) hands back the board, vitals and message band separately", async () => {
  const game = await pwaGame();
  const parts = game.screen({ color: false, parts: true });
  assert.ok(Array.isArray(parts.board) && parts.board.length > 3);
  assert.ok(parts.vitals.every((vital) => vital.label && vital.text));
  assert.equal(typeof parts.status, "string");
  assert.equal(game.screen({ color: false, parts: false }).split("\n")[0], parts.title);
});

test("tuneSlot runs an equipped affinity lower and back, as the list's - and + do", async () => {
  const game = await pwaGame();
  const slot = game.slots().slots.find((entry) => !entry.empty && entry.stacks.held > 1);
  if (!slot) return; // the first bundled level holds nothing to tune
  await game.tuneSlot(slot.key, "stacks", -1);
  assert.equal(game.slots().slots.find((entry) => entry.key === slot.key).stacks.running, slot.stacks.held - 1);
  await game.tuneSlot(slot.key, "stacks", 1);
  assert.equal(game.slots().slots.find((entry) => entry.key === slot.key).stacks.running, slot.stacks.held);
  assert.equal(game.state().panel, null, "tuning leaves no panel open");
});

test("a list panel is offered as choices, and the state names what an open panel is for", async () => {
  const game = await pwaGame();
  assert.equal(game.panelChoices(), null);
  await game.handle({ type: "affinities" });
  const choices = game.panelChoices();
  assert.equal(choices?.type, "affinities");
  assert.ok(choices.items.length >= 1);
  assert.deepEqual(game.state().panelFlags, { raise: false, inspect: false, watch: false });
  await game.handle({ type: "quit" });
  assert.equal(game.panelChoices(), null);
});

test("an empty slot offers every held affinity that is not equipped, and equipping fills it without removing another", async () => {
  const { buildUnifiedLevel, viableVitals } = await import("../fixtures/ui-ascii/unified-level.mjs");
  const affinities = [
    { kind: "fire", expression: "push", stacks: 1 }, { kind: "water", expression: "push", stacks: 1 },
    { kind: "earth", expression: "push", stacks: 1 },
  ];
  const level = buildUnifiedLevel({
    id: "free-slots", tiles: ["#####", "#...#", "#...E", "#####"],
    actors: [{ category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals(),
      affinities, affinitySlots: 3, activeAffinityKey: "fire:push" }],
  });
  const game = await createGame({ levels: [{ name: "free-slots", ...level }], fog: false, showHelp: false });
  const { slots, picks } = game.slots();
  assert.deepEqual(slots.map((slot) => Boolean(slot.empty)), [false, true, true], "three slots, one used");
  assert.deepEqual(picks.map((pick) => pick.key), ["water:push", "earth:push"], "an empty slot has something to take");
  await game.toggleSlotAffinity("earth:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["fire:push", "earth:push"], "fills the free slot, nothing removed");
  await game.toggleSlotAffinity("water:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["fire:push", "earth:push", "water:push"]);
  assert.equal(game.slots().picks.length, 0);
});

test("toggleSlotAffinity with a slot named swaps a packed affinity into it, in one turn", async () => {
  const { buildUnifiedLevel, viableVitals } = await import("../fixtures/ui-ascii/unified-level.mjs");
  const affinities = [
    { kind: "fire", expression: "push", stacks: 1 }, { kind: "water", expression: "push", stacks: 1 },
    { kind: "earth", expression: "push", stacks: 1 }, { kind: "wind", expression: "push", stacks: 1 },
  ];
  const level = buildUnifiedLevel({
    id: "pack", tiles: ["#####", "#...#", "#...E", "#####"],
    actors: [{ category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals(),
      affinities, affinitySlots: 3, activeAffinityKey: "fire:push", equippedAffinityKeys: ["fire:push", "water:push", "earth:push"] }],
  });
  const game = await createGame({ levels: [{ name: "pack", ...level }], fog: false, showHelp: false });
  assert.deepEqual(game.slots().picks.map((pick) => pick.key), ["wind:push"], "the fourth is in the pack");
  await game.toggleSlotAffinity("wind:push", "water:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["fire:push", "wind:push", "earth:push"]);
  assert.equal(game.state().turns, 1);
  await game.toggleSlotAffinity("water:push");
  assert.deepEqual(game.view().player.equippedAffinityKeys, ["wind:push", "earth:push", "water:push"], "unnamed, the oldest gives way");
});
