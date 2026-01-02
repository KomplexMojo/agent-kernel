const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/ui-web/src/movement-ui.js");
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"),
);

test("ui formatters render affinity metadata", () => {
  const script = `
import assert from "node:assert/strict";
import { formatAffinities, formatAbilities, renderActorSummary, renderActorInspectSummary, renderTrapSummary } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(fixture)};

assert.equal(formatAffinities([]), "No affinities equipped");
const darkAffinity = formatAffinities([{ kind: "dark", expression: "pull", stacks: 1 }]);
assert.ok(darkAffinity.includes("reduces visibility"));

const abilityText = formatAbilities([
  { id: "life_surge", kind: "buff", affinityKind: "life", expression: "pull", potency: 1, manaCost: 0 },
]);
assert.ok(abilityText.includes("life/pull"));

const actorSummary = renderActorSummary({
  id: "actor_mvp",
  kind: 2,
  position: { x: 1, y: 2 },
  vitals: { health: { current: 1, max: 2, regen: 0 } },
  affinities: [],
  abilities: [],
});
assert.ok(actorSummary.includes("affinities: No affinities equipped"));
assert.ok(actorSummary.includes("abilities: No abilities"));

const inspectSummary = renderActorInspectSummary({
  id: "actor_mvp",
  kind: 2,
  position: { x: 1, y: 2 },
  vitals: { health: { current: 1, max: 2, regen: 0 } },
});
assert.ok(!inspectSummary.includes("affinities:"));

const actorWithAbilities = {
  id: "actor_mvp",
  kind: 2,
  position: { x: 1, y: 2 },
  vitals: fixture.expected.actors[0].vitals,
  affinities: [
    { kind: "fire", expression: "push", stacks: 2 },
    { kind: "life", expression: "pull", stacks: 1 },
  ],
  abilities: fixture.expected.actors[0].abilities,
};
const orderedSummary = renderActorSummary(actorWithAbilities);
const firstAbilityIndex = orderedSummary.indexOf("fire_bolt");
const secondAbilityIndex = orderedSummary.indexOf("life_surge");
assert.ok(firstAbilityIndex >= 0);
assert.ok(secondAbilityIndex > firstAbilityIndex);

const trapSummary = renderTrapSummary({
  position: { x: 2, y: 2 },
  vitals: { mana: { current: 3, max: 3, regen: 1 }, durability: { current: 5, max: 5, regen: 0 } },
  affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
  abilities: [],
});
assert.ok(trapSummary.includes("fire:push x2"));
`;
  runEsm(script);
});
