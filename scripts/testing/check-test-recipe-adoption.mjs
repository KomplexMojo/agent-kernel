import { collectTestInventory } from "./shared.mjs";
import { RECIPE_CATALOG, SCAFFOLDABLE_RECIPES } from "./recipe-catalog.mjs";

const inventory = collectTestInventory();
const counts = new Map();

for (const entry of inventory.files) {
  counts.set(entry.recipe, (counts.get(entry.recipe) ?? 0) + 1);
}

const usedRecipes = [...counts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, fileCount]) => ({
    name,
    fileCount,
    scaffoldable: Boolean(RECIPE_CATALOG[name]?.scaffoldable),
    runner: RECIPE_CATALOG[name]?.runner ?? null,
    description: RECIPE_CATALOG[name]?.description ?? null,
  }));

const uncataloged = inventory.files
  .filter((entry) => !RECIPE_CATALOG[entry.recipe])
  .map((entry) => entry.path);

console.log(JSON.stringify({
  ok: uncataloged.length === 0,
  totalFiles: inventory.summary.total,
  usedRecipeCount: usedRecipes.length,
  scaffoldableRecipeCount: SCAFFOLDABLE_RECIPES.length,
  scaffoldCoverage: usedRecipes
    .filter((entry) => entry.scaffoldable)
    .reduce((sum, entry) => sum + entry.fileCount, 0),
  uncataloged,
  usedRecipes,
}, null, 2));

process.exit(uncataloged.length === 0 ? 0 : 1);
