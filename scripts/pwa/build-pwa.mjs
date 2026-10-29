#!/usr/bin/env node
/**
 * Build the Deepward playtest app (a PWA for a phone) into dist/pwa/, ready for GitHub Pages.
 *
 *   node scripts/pwa/build-pwa.mjs [--out dist/pwa] [--seeds 12] [--scenario id]...
 *
 * A static host has no Node, so the game runs in the browser: esbuild bundles the game
 * controller (packages/ui-ascii/src/browser.js, which imports runtime only, wired up by
 * app-entry.js) and every level is built here, ahead of time, by `ak create` with the playtest
 * scenarios' own arguments (scripts/game/playtest.mjs), so the Allocator prices each one exactly
 * as it does for `bash scripts/game/playtest.sh`. Seed N here is seed N there. Each level also
 * carries its `ak create` arguments and z3's recorded answers, so the character screen can build
 * it again on the phone with your own delver, by the same code (#557). No analysis console is built.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { PNG } from "pngjs";
import { affinitiesForSeed, createArgs, fillFocus, loadPlaytestScenarios, playerDelverSpec, traitsInPlay } from "../game/playtest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const STATIC_DIR = join(ROOT, "packages/ui-ascii/pwa");
export const DEFAULT_SEEDS = 12;

/** One level's catalog row: what the picker shows, and where the level file is. */
export function seedEntry(scenario, seed, created) {
  return {
    seed,
    picks: affinitiesForSeed(seed),
    traits: traitsInPlay(scenario, seed),
    focus: fillFocus(scenario, seed),
    ...(created?.cost ? { cost: { totalSpend: created.cost.totalSpend, budgetTokens: created.cost.budgetTokens, status: created.cost.status } } : {}),
    ...(created?.tactics?.length ? { tactics: created.tactics.map((entry) => entry.tactic) } : {}),
    file: `levels/${scenario.id}-s${seed}.json`,
  };
}

export function catalogFor(scenarios, createdAt, commit, seedEntries) {
  return {
    createdAt,
    commit,
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id, title: scenario.title, shows: scenario.shows ?? "",
      seeds: seedEntries.filter((entry) => entry.scenarioId === scenario.id).map(({ scenarioId, ...entry }) => entry),
    })),
  };
}

function runCreate(scenario, seed, createdAt) {
  const dir = mkdtempSync(join(tmpdir(), `pwa-${scenario.id}-${seed}-`));
  const argv = createArgs(scenario, seed, createdAt);
  // #557: z3's answers, so the phone (which has no solver) rebuilds this level with a configured character exactly.
  const answersPath = join(dir, "solver-answers.jsonl");
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [AK, "create", ...argv, "--out-dir", dir], { cwd: ROOT, env: { ...process.env, AK_SOLVER_RECORD: answersPath } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (status) => {
      let created = null;
      try { created = JSON.parse(out.trim().split("\n").at(-1)); } catch { /* reported below */ }
      if (status !== 0 || created?.ok === false) {
        rmSync(dir, { recursive: true, force: true });
        reject(new Error(`ak create refused ${scenario.id} (seed ${seed}):\n${err || out}`));
        return;
      }
      const receipt = JSON.parse(readFileSync(join(dir, "budget-receipt.json"), "utf8"));
      const level = {
        simConfig: JSON.parse(readFileSync(join(dir, "sim-config.json"), "utf8")),
        initialState: JSON.parse(readFileSync(join(dir, "initial-state.json"), "utf8")),
        // What the character screen needs to build this level again with your own delver.
        character: {
          argv,
          hero: playerDelverSpec(scenario, seed),
          allowance: receipt.poolStatuses?.find((pool) => pool.id === "delver")?.capTokens ?? null,
          solverAnswers: existsSync(answersPath) ? readFileSync(answersPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [],
        },
      };
      rmSync(dir, { recursive: true, force: true });
      resolveRun({ created, level });
    });
  });
}

/** Run `task` over `items`, `limit` at a time. */
async function pool(items, limit, task) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

/** A home-screen icon: a lit doorway in the dark, drawn in pixels (no image tooling needed). */
export function iconPng(size) {
  const png = new PNG({ width: size, height: size });
  const put = (x, y, [r, g, b]) => { const i = (size * y + x) * 4; png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255; };
  const inArch = (dx, dy, half) => Math.abs(dx) < half && (dy > -0.05 ? dy < 0.3 : dx * dx + (dy + 0.05) * (dy + 0.05) < half * half);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const dx = (x - size / 2) / size;
    const dy = (y - size / 2) / size;
    put(x, y, inArch(dx, dy, 0.22) ? [240, 196, 90] : inArch(dx, dy, 0.3) ? [90, 90, 110] : [13, 13, 15]);
  }
  return PNG.sync.write(png);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

export async function buildPwa({ out = join(ROOT, "dist/pwa"), seeds = DEFAULT_SEEDS, only = [], log = console.log } = {}) {
  const catalogSource = loadPlaytestScenarios();
  const scenarios = catalogSource.scenarios.filter((scenario) => only.length === 0 || only.includes(scenario.id));
  if (scenarios.length === 0) throw new Error(`no such scenario: ${only.join(", ")}`);
  const commit = process.env.PWA_COMMIT || git(["rev-parse", "--short", "HEAD"]);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "levels"), { recursive: true });

  const jobs = scenarios.flatMap((scenario) => Array.from({ length: seeds }, (_, seed) => ({ scenario, seed })));
  log(`Building ${jobs.length} levels (${scenarios.length} scenarios x ${seeds} seeds)...`);
  const entries = await pool(jobs, 4, async ({ scenario, seed }) => {
    const { created, level } = await runCreate(scenario, seed, catalogSource.createdAt);
    const entry = seedEntry(scenario, seed, created);
    writeFileSync(join(out, entry.file), JSON.stringify(level));
    return { scenarioId: scenario.id, ...entry };
  });
  const catalog = catalogFor(scenarios, catalogSource.createdAt, commit, entries);
  writeFileSync(join(out, "catalog.json"), JSON.stringify(catalog));

  // The page reads its own build from the bundle, and version.json (never cached) says which build is live.
  writeFileSync(join(out, "version.json"), JSON.stringify({ commit, builtAt: new Date().toISOString().slice(0, 10) }));
  await esbuild({ entryPoints: [join(ROOT, "scripts/pwa/app-entry.js")], bundle: true, format: "iife", minify: true,
    define: { __BUILD__: JSON.stringify(commit) },
    target: "es2022", outfile: join(out, "app.js"), legalComments: "none", logLevel: "warning" });
  cpSync(STATIC_DIR, out, { recursive: true });
  for (const size of [180, 192, 512]) writeFileSync(join(out, `icon-${size}.png`), iconPng(size));

  // The service worker caches the shell and every level, under a name that changes with the commit.
  const shell = ["./", "index.html", "style.css", "app.js", "catalog.json", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"];
  const precache = [...shell, ...entries.map((entry) => entry.file)];
  const sw = readFileSync(join(STATIC_DIR, "sw.js"), "utf8")
    .replace("__CACHE__", `deepward-${commit}`).replace("__PRECACHE__", JSON.stringify(precache));
  writeFileSync(join(out, "sw.js"), sw);
  writeFileSync(join(out, ".nojekyll"), "");
  log(`Done: ${out} (commit ${commit}, ${precache.length} cached files).`);
  return { out, catalog };
}

function parseArgs(argv) {
  const options = { only: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") options.out = resolve(argv[++i]);
    else if (argv[i] === "--seeds") options.seeds = Number(argv[++i]);
    else if (argv[i] === "--scenario") options.only.push(argv[++i]);
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPwa(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
