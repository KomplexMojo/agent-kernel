// The published engine bundle (@agon-engine/engine) must cover exactly the public API and
// load as plain Node ESM with no TypeScript stripping (Node never strips types in node_modules).
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
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

  it("the playtest module finds its data file and a working ak command line (#796)", async () => {
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "agon-engine-")), "dist");
    await buildEngine({ outDir });
    const mod = await import(pathToFileURL(path.join(outDir, "adapters-cli/cli/playtest-scenarios.js")).href);
    expect(existsSync(mod.AK_CLI), mod.AK_CLI).toBe(true);
    expect(mod.loadPlaytestScenarios().scenarios.length).toBeGreaterThan(0);
    const work = mkdtempSync(path.join(tmpdir(), "agon-engine-run-"));
    const out = execFileSync(process.execPath, [mod.AK_CLI, "create", "--room", "size=small;count=1", "--delver", "count=1;affinity=fire;motivation=attacking", "--warden", "count=1;affinity=dark;motivation=defending", "--out-dir", work], { encoding: "utf8" });
    expect(out.match(/"command":"create"/g)).toHaveLength(1); // the command ran once, not twice
    expect(JSON.parse(out).ok).toBe(true);
  }, 60000);
});
