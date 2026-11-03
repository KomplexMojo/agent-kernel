import { describe, expect, it } from "vitest";
import { AFFINITY_TABLE } from "../../packages/core-ts/src/state/affinity-table.ts";
import { affinityRole, hasAttackOption } from "../../packages/runtime/src/render/affinity-role.js";
import { affinitiesForSeed, playerDelverSpec, loadPlaytestScenarios } from "../../scripts/game/playtest.mjs";
import { createCharacterSheet } from "../../packages/runtime/src/runner/character-sheet.js";

const EXPRESSIONS = ["push", "pull", "emit", "draw"];

describe("affinity role (attack / defence / support)", () => {
  it("labels every kind and expression from its table row", () => {
    for (const row of AFFINITY_TABLE) {
      for (const expression of EXPRESSIONS) {
        const role = affinityRole(row.kind, expression);
        if (row.outward === "damage") expect(role).toBe("attack");
        else expect(role).toBe(["push", "emit"].includes(expression) ? "support" : "defence");
      }
    }
  });

  it("a loadout needs a harmful kind to have an attack option", () => {
    expect(hasAttackOption([{ kind: "growth", expression: "push" }, { kind: "light", expression: "emit" }])).toBe(false);
    expect(hasAttackOption([{ kind: "growth", expression: "push" }, { kind: "fire", expression: "pull" }])).toBe(true);
  });

  it("the playtest never hands the player a loadout with no offence", () => {
    const scenario = loadPlaytestScenarios().scenarios?.find((entry) => entry.id === "first-look")
      ?? loadPlaytestScenarios().find?.((entry) => entry.id === "first-look");
    for (let seed = 0; seed < 40; seed += 1) {
      const spec = playerDelverSpec(scenario, seed);
      const held = [...spec.match(/affinities=([^;]*)/)[1].split(",")].map((entry) => entry.split(":"));
      expect(hasAttackOption(held.map(([kind, expression]) => ({ kind, expression })))).toBe(true);
    }
  });

  it("the sheet tags each slot and warns when nothing held can harm", () => {
    const sheet = createCharacterSheet({ budgetTokens: 3000 });
    sheet.choose(0, "kind", "growth");
    let view = sheet.view();
    expect(view.rows[0].role).toBe("support");
    expect(view.warnings).toHaveLength(1);
    sheet.choose(1, "kind", "fire");
    view = sheet.view();
    expect(view.rows[1].role).toBe("attack");
    expect(view.warnings).toHaveLength(0);
  });
});
