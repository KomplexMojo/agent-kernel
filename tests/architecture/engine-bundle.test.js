// The published engine bundle (@agon-engine/engine) must cover exactly the public API and
// load as plain Node ESM with no TypeScript stripping (Node never strips types in node_modules).
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
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
      const mod = await import(pathToFileURL(file).href);
      expect(Object.keys(mod).length, target).toBeGreaterThan(0);
    }
  }, 60000);
});
