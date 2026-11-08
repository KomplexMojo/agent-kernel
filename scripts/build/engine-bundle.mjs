// Builds the publishable engine bundle (@agon-engine/engine): every module in the public
// API (`apiSurface` in tests/architecture/framework-game-boundary.json) compiled to plain
// ESM JavaScript, with core-ts and the other workspace packages inlined. Development keeps
// running the unbuilt source; only the published artifact is built.
//
//   node scripts/build/engine-bundle.mjs            # build into packages/engine/dist
//   node scripts/build/engine-bundle.mjs --out DIR  # build somewhere else
//   node scripts/build/engine-bundle.mjs --write-exports   # rewrite packages/engine/package.json exports
import { build } from "esbuild";
import { readFileSync, writeFileSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const boundary = JSON.parse(readFileSync(path.join(root, "tests/architecture/framework-game-boundary.json"), "utf8"));

/**
 * Command-line entry points a game spawns (`node <path> ...`). Each is built as one
 * self-contained `.mjs` file and keeps its name; every other module is a library `.js`.
 */
export const EXECUTABLES = new Set([
  "packages/adapters-cli/src/cli/agon.mjs",
  "packages/ui-ascii/src/character-cli.mjs",
]);

/**
 * `agon.mjs` is a two-line shim that awaits `main()`, and `agon-impl.mjs` also runs `main()` when it
 * is the entry file. Bundled together they would run twice, so the built `agon.mjs` is `agon-impl.mjs`.
 */
const EXECUTABLE_SOURCE = { "packages/adapters-cli/src/cli/agon.mjs": "packages/adapters-cli/src/cli/agon-impl.mjs" };

/** Data files the built modules read from beside themselves, copied next to them. */
const DATA_FILES = ["packages/adapters-cli/src/cli/playtest-scenarios.json"];

/** `packages/<pkg>/src/<rest>` -> public subpath `./<pkg>/<rest>`. */
export function publicSubpath(modulePath) {
  const match = /^packages\/([^/]+)\/src\/(.+)$/.exec(modulePath);
  if (!match) throw new Error(`apiSurface entry is not under packages/<pkg>/src: ${modulePath}`);
  return `./${match[1]}/${EXECUTABLES.has(modulePath) ? match[2] : match[2].replace(/\.mjs$/, ".js")}`;
}

/**
 * Optional runtime packages (declared as optional peers of the bundle). The built code
 * imports them lazily and fails with a clear message only when a command needs one.
 */
const OPTIONAL_STUBS = {
  "z3-solver": ["init"],
  ws: ["WebSocketServer"],
};

const optionalPeers = {
  name: "optional-peers",
  setup(b) {
    b.onResolve({ filter: /^(z3-solver|ws)$/ }, (args) => ({ path: args.path, namespace: "optional-peer" }));
    b.onLoad({ filter: /.*/, namespace: "optional-peer" }, (args) => {
      const names = OPTIONAL_STUBS[args.path];
      const lines = [
        `let mod = null;`,
        `try { mod = await import(${JSON.stringify(args.path)}); } catch { mod = null; }`,
        ...names.map((n) => `export const ${n} = (...a) => { if (!mod) throw new Error(${JSON.stringify(`${args.path} is not installed; install it to use this command`)}); return typeof mod.${n} === "function" && !/^[A-Z]/.test(${JSON.stringify(n)}) ? mod.${n}(...a) : new mod.${n}(...a); };`),
      ];
      return { contents: lines.join("\n"), loader: "js" };
    });
  },
};

export function engineExports() {
  const exports = { "./package.json": "./package.json" };
  for (const modulePath of Object.keys(boundary.apiSurface).sort()) {
    const subpath = publicSubpath(modulePath);
    exports[subpath] = `./dist/${subpath.slice(2)}`;
  }
  for (const file of DATA_FILES) {
    const subpath = publicSubpath(file.replace(/\.json$/, ".mjs")).replace(/\.js$/, ".json");
    exports[subpath] = `./dist/${subpath.slice(2)}`;
  }
  return exports;
}

export async function buildEngine({ outDir = path.join(root, "packages/engine/dist") } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  const all = Object.keys(boundary.apiSurface);
  const entryName = (modulePath) => publicSubpath(modulePath).slice(2).replace(/\.m?js$/, "");
  const common = { bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "warning", plugins: [optionalPeers], external: ["jsonrepair", "@modelcontextprotocol/sdk"] };
  const libraries = Object.fromEntries(all.filter((m) => !EXECUTABLES.has(m)).map((m) => [entryName(m), path.join(root, m)]));
  await build({ ...common, entryPoints: libraries, outdir: outDir, splitting: true, outExtension: { ".js": ".js" } });
  const executables = Object.fromEntries(all.filter((m) => EXECUTABLES.has(m)).map((m) => [entryName(m), path.join(root, EXECUTABLE_SOURCE[m] ?? m)]));
  await build({ ...common, entryPoints: executables, outdir: outDir, outExtension: { ".js": ".mjs" } });
  for (const file of DATA_FILES) {
    const target = path.join(outDir, publicSubpath(file.replace(/\.json$/, ".mjs")).slice(2).replace(/\.js$/, ".json"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file), target);
  }
  return { outDir, entries: [...Object.keys(libraries), ...Object.keys(executables)] };
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
