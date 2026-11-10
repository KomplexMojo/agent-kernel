// #725: the recipe ladder plays each configuration recipe as the scenario's delver under each
// strategy recipe it pairs with, by the T0 driver (no model), and flags pins and outliers.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { recipeOrder, recipePlan, runRecipeLadder } from "../../scripts/testing/play-sim-recipe-ladder.mjs";

test("a strategy recipe is ordered with its tactics and the exit as its goal; each recipe adds fight as a baseline", () => {
  const kite = recipeOrder("kite");
  expect(kite.goals).toEqual([{ kind: "reach", place: "exit" }]);
  expect(kite.tactics.length).toBeGreaterThan(0);
  expect(recipeOrder("structure-breaker").goals).toEqual([{ kind: "reach", place: "exit" }]);
  expect(recipePlan(["tank"])).toEqual([{ name: "tank", roles: expect.any(Object), strategies: ["hold-the-chokepoint", "guard-the-leader", "break-off", "fight"] }]);
  expect(() => recipePlan(["necromancer"])).toThrow(/unknown recipe necromancer/);
});

test("one recipe is built, priced and played under each of its strategies beside the baseline delver", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "recipe-ladder-"));
  try {
    const { summary } = await runRecipeLadder({ recipes: ["tank"], seeds: [0], maxTicks: 3, outDir });
    expect(summary.rows.map((row) => `${row.recipe}/${row.strategy}`)).toEqual(
      ["baseline/fight", "tank/hold-the-chokepoint", "tank/guard-the-leader", "tank/break-off", "tank/fight"]);
    expect(summary.rows.find((row) => row.recipe === "tank").delverTokens).toBe(430);
    const report = readFileSync(join(outDir, "report.md"), "utf8");
    expect(report).toMatch(/\| tank \| break-off \| 0\/1 \|/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);
