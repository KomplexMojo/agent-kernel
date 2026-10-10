#!/usr/bin/env node
/**
 * Regenerates packages/ui-ascii/levels/ from recipes.json by running `ak create`
 * for each recipe. The bundled levels are its output byte for byte, so the
 * Configurator lays out every room and corridor; nothing is hand-written.
 *
 *   node scripts/ui-ascii/generate-levels.mjs           write the level files
 *   node scripts/ui-ascii/generate-levels.mjs --check   exit 1 if any file drifted
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const LEVELS_DIR = join(ROOT, "packages/ui-ascii/levels");
const OUTPUTS = [
  ["sim-config.json", "sim-config.json"],
  ["initial-state.json", "initial-state.json"],
];

function createLevel({ name, args }, createdAt) {
  const outDir = mkdtempSync(join(tmpdir(), `ui-ascii-level-${name}-`));
  try {
    const result = spawnSync(
      process.execPath,
      [AK, "create", ...args, "--run-id", name, "--created-at", createdAt, "--out-dir", outDir],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`ak create failed for ${name}:\n${result.stderr || result.stdout}`);
    }
    return OUTPUTS.map(([from, suffix]) => ({
      path: join(LEVELS_DIR, `${name}.${suffix}`),
      text: readFileSync(join(outDir, from), "utf8"),
    }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  const recipes = JSON.parse(readFileSync(join(LEVELS_DIR, "recipes.json"), "utf8"));
  const drifted = [];
  for (const recipe of recipes.levels) {
    for (const { path, text } of createLevel(recipe, recipes.createdAt)) {
      let current = null;
      try {
        current = readFileSync(path, "utf8");
      } catch {
        current = null;
      }
      if (current === text) continue;
      if (check) drifted.push(path);
      else writeFileSync(path, text);
    }
  }
  if (drifted.length > 0) {
    console.error(`Bundled levels differ from \`ak create\` output; run \`pnpm run levels:ascii\`:\n${drifted.join("\n")}`);
    return 1;
  }
  console.log(check ? "Bundled levels match `ak create`." : `Wrote ${recipes.levels.length} levels to ${LEVELS_DIR}`);
  return 0;
}

process.exitCode = main();
