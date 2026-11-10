// The published engine bundle (@agon-engine/engine) must cover exactly the public API and
// load as plain Node ESM with no TypeScript stripping (Node never strips types in node_modules).
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildEngine, engineExports } from "../../scripts/build/engine-bundle.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "packages/engine/package.json"), "utf8"));

describe("engine bundle", () => {
  it("package.json exports equal the apiSurface-derived map (run build:engine -- --write-exports)", () => {
    expect(pkg.exports).toEqual(engineExports());
  });

  it("builds and every export loads without TypeScript source", async () => {
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "agon-engine-")), "dist");
    await buildEngine({ outDir });
    for (const target of Object.values(engineExports())) {
      if (target === "./package.json") continue;
      const file = path.join(outDir, target.replace("./dist/", ""));
      expect(existsSync(file), file).toBe(true);
      if (!/\.m?js$/.test(file) || /\.mjs$/.test(file)) continue; // executables run below; data files are not modules
      const mod = await import(pathToFileURL(file).href);
      expect(Object.keys(mod).length, target).toBeGreaterThan(0);
    }
  }, 60000);

  // #822: the package installs an `agon` command and says how to use the entries.
  it("the agon bin is a built executable with a shebang, and the README names every entry", async () => {
    expect(pkg.bin).toEqual({ agon: "./dist/adapters-cli/cli/agon.mjs" });
    expect(Object.values(engineExports())).toContain(pkg.bin.agon);
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "agon-engine-")), "dist");
    await buildEngine({ outDir });
    expect(readFileSync(path.join(outDir, pkg.bin.agon.replace("./dist/", "")), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    const readme = readFileSync(path.join(root, "packages/engine/README.md"), "utf8");
    for (const key of Object.keys(pkg.exports).filter((k) => /^\.\/[a-z]+(\/browser)?$/.test(k))) {
      expect(readme, key).toContain(`@agon-engine/engine/${key.slice(2)}`);
    }
  }, 60000);

  it("the playtest module finds its data file and a working agon command line (#796)", async () => {
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "agon-engine-")), "dist");
    await buildEngine({ outDir });
    const mod = await import(pathToFileURL(path.join(outDir, "adapters-cli/cli/playtest-scenarios.js")).href);
    expect(existsSync(mod.AGON_CLI), mod.AGON_CLI).toBe(true);
    expect(mod.loadPlaytestScenarios().scenarios.length).toBeGreaterThan(0);
    const work = mkdtempSync(path.join(tmpdir(), "agon-engine-run-"));
    const out = execFileSync(process.execPath, [mod.AGON_CLI, "create", "--room", "size=small;count=1", "--delver", "count=1;affinity=fire;motivation=attacking", "--warden", "count=1;affinity=dark;motivation=defending", "--out-dir", work], { encoding: "utf8" });
    expect(out.match(/"command":"create"/g)).toHaveLength(1); // the command ran once, not twice
    expect(JSON.parse(out).ok).toBe(true);
  }, 60000);

  // The optional-peer shim once imported itself instead of the installed package, so the published
  // `agon create` refused every level that needs the solver ("z3-solver is not installed") and the
  // game's deploy failed. Built beside packages/engine so `z3-solver` resolves as it does for a game.
  it("the built agon command line reaches an installed z3-solver (optional peer)", async () => {
    const outDir = mkdtempSync(path.join(root, "packages/engine/dist-peer-test-"));
    try {
      await buildEngine({ outDir });
      const work = mkdtempSync(path.join(tmpdir(), "agon-engine-peer-"));
      const cli = path.join(outDir, "adapters-cli/cli/agon.mjs");
      const args = ["create", "--seed", "1", "--budget-tokens", "5000", "--room", "size=medium;count=3",
        "--delver", "count=1;affinity=earth;motivation=attacking",
        "--hazard", "affinity=wind;expression=emit;stacks=2;intensity=2;proximityRadius=1;mana=regen:40:40:6",
        "--tactic", "minefield;hazards=3", "--out-dir", work];
      let out;
      try { out = execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
      catch (error) { out = `${error.stdout}${error.stderr}`; }
      expect(out).not.toMatch(/is not installed|placement_constraints_need_solver/);
      expect(JSON.parse(out.trim().split("\n").at(-1)).ok).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 90000);
});
