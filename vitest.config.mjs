import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

function collectDuplicateJsWrappers(dir = "tests", results = []) {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      collectDuplicateJsWrappers(absolutePath, results);
      continue;
    }
    if (!absolutePath.endsWith(".test.js")) {
      continue;
    }
    const pairedMjs = absolutePath.replace(/\.test\.js$/, ".test.mjs");
    try {
      if (statSync(pairedMjs).isFile()) {
        results.push(absolutePath);
      }
    } catch {}
  }
  return results;
}

const duplicateJsWrappers = collectDuplicateJsWrappers();

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.js",
      "tests/**/*.test.mjs",
      "tests/**/*.test.ts",
      "tests/**/*.test.mts",
    ],
    exclude: [
      "tests/playwright/**",
      "tests/scripts/serve-ui.test.js",
      "tests/ui-web/budget-input-validation.test.mjs",
      ...duplicateJsWrappers,
    ],
    environment: "node",
    globals: true,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    reporters: "default",
  },
});
