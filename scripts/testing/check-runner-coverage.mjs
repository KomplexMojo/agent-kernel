import { collectTestInventory } from "./shared.mjs";

const inventory = collectTestInventory();
const uncategorized = inventory.files.filter((entry) => entry.recipe === "general");

console.log(JSON.stringify({
  ok: uncategorized.length === 0,
  total: inventory.summary.total,
  uncategorized: uncategorized.map((entry) => entry.path),
  missedByCurrentDefault: inventory.files
    .filter((entry) => !entry.currentDefaultIncluded)
    .map((entry) => entry.path),
}, null, 2));

process.exit(uncategorized.length === 0 ? 0 : 1);
