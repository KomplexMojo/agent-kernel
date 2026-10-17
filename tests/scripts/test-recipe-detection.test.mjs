import { describe, expect, it } from "vitest";
import { collectTestInventory } from "../../scripts/testing/shared.mjs";
import { SCAFFOLDABLE_RECIPES } from "../../scripts/testing/recipe-catalog.mjs";

// A recipe ak_test_scaffold_case can author but the inventory can never detect is
// worse than either whole state: the scaffolded case is classified as some other
// family the moment it lands (#167, after #160 moved tests/allocator/ under
// tests/personas/allocator/ and left budget_policy_invariant pointing at nothing).
describe("test recipe detection", () => {
  const inventory = collectTestInventory();

  it("detects every scaffoldable recipe on at least one test file", () => {
    const detected = new Set(inventory.files.map((entry) => entry.recipe));
    const undetectable = SCAFFOLDABLE_RECIPES.filter((recipe) => !detected.has(recipe));
    expect(undetectable).toEqual([]);
  });

  it("classifies Allocator policy tests as budget_policy_invariant and its FSM tests as persona transitions", () => {
    const byPath = new Map(inventory.files.map((entry) => [entry.path, entry.recipe]));
    expect(byPath.get("tests/personas/allocator/allocator-everything-costs.test.js")).toBe("budget_policy_invariant");
    expect(byPath.get("tests/personas/allocator/allocator-state-machine.test.js")).toBe("runtime_persona_transition");
  });
});
