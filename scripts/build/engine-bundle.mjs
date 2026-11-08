// Builds the publishable engine bundle (@agon-engine/engine): every module in the public
// API (`apiSurface` in tests/architecture/framework-game-boundary.json) compiled to plain
// ESM JavaScript, with core-ts and the other workspace packages inlined. Development keeps
// running the unbuilt source; only the published artifact is built.
//
//   node scripts/build/engine-bundle.mjs            # build into packages/engine/dist
//   node scripts/build/engine-bundle.mjs --out DIR  # build somewhere else
//   node scripts/build/engine-bundle.mjs --write-exports   # rewrite packages/engine/package.json exports
import { build } from "esbuild";
import { readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const boundary = JSON.parse(readFileSync(path.join(root, "tests/architecture/framework-game-boundary.json"), "utf8"));

/** `packages/<pkg>/src/<rest>` -> public subpath `./<pkg>/<rest>`. */
export function publicSubpath(modulePath) {
  const match = /^packages\/([^/]+)\/src\/(.+)$/.exec(modulePath);
  if (!match) throw new Error(`apiSurface entry is not under packages/<pkg>/src: ${modulePath}`);
  return `./${match[1]}/${match[2].replace(/\.mjs$/, ".js")}`;
}

export function engineExports() {
  const exports = { "./package.json": "./package.json" };
  for (const modulePath of Object.keys(boundary.apiSurface).sort()) {
    const subpath = publicSubpath(modulePath);
    exports[subpath] = `./dist/${subpath.slice(2)}`;
  }
  return exports;
}

export async function buildEngine({ outDir = path.join(root, "packages/engine/dist") } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  const entryPoints = Object.fromEntries(
    Object.keys(boundary.apiSurface).map((modulePath) => [publicSubpath(modulePath).slice(2).replace(/\.m?js$/, ""), path.join(root, modulePath)]),
  );
  await build({
    entryPoints,
    outdir: outDir,
    outExtension: { ".js": ".js" },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node22",
    external: ["z3-solver", "ws", "jsonrepair", "@modelcontextprotocol/sdk"],
    logLevel: "warning",
  });
  return { outDir, entries: Object.keys(entryPoints) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--write-exports")) {
    const file = path.join(root, "packages/engine/package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    pkg.exports = engineExports();
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  copyFileSync(path.join(root, "LICENSE.md"), path.join(root, "packages/engine/LICENSE.md"));
  const outIndex = args.indexOf("--out");
  const result = await buildEngine(outIndex >= 0 ? { outDir: path.resolve(args[outIndex + 1]) } : {});
  console.log(`engine bundle: ${result.entries.length} entries -> ${result.outDir}`);
}
