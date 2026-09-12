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
      ...duplicateJsWrappers,
    ],
    environment: "node",
    globals: true,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    reporters: "default",
    pool: "forks",
    poolOptions: {
      forks: {
        // Unbounded, this defaults to one forked process per CPU core. Several
        // test files spawn real subprocesses (pnpm install, git, ak.mjs builds),
        // and individual workers have been observed at ~3GB RSS -- uncapped on a
        // 12-core/36GB machine that ran the whole box out of memory with zero
        // swap configured. Capped well under core count so a full run can't get
        // close to exhausting RAM.
        maxForks: 6,
      },
    },
    coverage: {
      provider: "v8",
      include: ["packages/core-ts/src/**/*.ts"],
      exclude: ["packages/core-ts/src/**/*.test.ts"],
      reporter: ["text", "json", "json-summary", "html"],
      reportsDirectory: "coverage/core-ts",
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 90,
        lines: 85,
      },
    },
  },
});
