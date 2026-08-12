import { resolve } from "node:path";
import { collectTestInventory, LOCAL_CODEX_DIR, writeText } from "./shared.mjs";

const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(LOCAL_CODEX_DIR, "test-classification.md");

const inventory = collectTestInventory();
const missed = inventory.files.filter((entry) => !entry.currentDefaultIncluded);
const browser = inventory.files.filter((entry) => entry.runner === "playwright");

const lines = [
  "# Test Classification",
  "",
  `Generated: ${inventory.generatedAt}`,
  "",
  "## Summary",
  "",
  `- Total test files: ${inventory.summary.total}`,
  `- Covered by current default script: ${inventory.summary.currentDefaultIncluded}`,
  `- Missed by current default script: ${inventory.summary.currentDefaultMissed}`,
  `- Targeted for Vitest: ${inventory.summary.byRunner.vitest ?? 0}`,
  `- Targeted for Playwright: ${inventory.summary.byRunner.playwright ?? 0}`,
  "",
  "## Suites",
  "",
  "| Suite | Files |",
  "| --- | ---: |",
  ...Object.entries(inventory.summary.bySuite).map(([suite, count]) => `| ${suite} | ${count} |`),
  "",
  "## Recipes",
  "",
  "| Recipe | Files |",
  "| --- | ---: |",
  ...Object.entries(inventory.summary.byRecipe).map(([recipe, count]) => `| ${recipe} | ${count} |`),
  "",
  "## Missed By Current Default Script",
  "",
];

if (missed.length === 0) {
  lines.push("- None");
} else {
  lines.push(...missed.map((entry) => `- ${entry.path} -> ${entry.runner}`));
}

lines.push("", "## Browser-Native Candidates", "");
if (browser.length === 0) {
  lines.push("- None");
} else {
  lines.push(...browser.map((entry) => `- ${entry.path} (${entry.recipe})`));
}

writeText(outputPath, `${lines.join("\n")}\n`);
console.log(JSON.stringify({
  ok: true,
  outputPath,
  missed: missed.length,
  browserCandidates: browser.length,
}, null, 2));
