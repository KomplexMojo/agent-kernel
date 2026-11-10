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

/**
 * The named entry points (#828): `packages/engine/src/<name>.js`, published as `./<name>`. Each
 * only re-exports other modules, so its built file is its source with every specifier pointed at
 * the built module beside it; nothing is bundled twice and no module moves. One level of nesting
 * is allowed (`authoring/browser`, #846).
 */
const FACADE = /^packages\/engine\/src\/([^/]+(?:\/[^/]+)?)\.js$/;
export const isFacade = (modulePath) => FACADE.test(modulePath);

/** The repo paths a facade re-exports from. */
export function facadeTargets(modulePath) {
  const source = readFileSync(path.join(root, modulePath), "utf8");
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)]
    .map((m) => path.relative(root, path.resolve(root, path.dirname(modulePath), m[1])).split(path.sep).join("/"));
}

/** `packages/<pkg>/src/<rest>` -> public subpath `./<pkg>/<rest>`; a named entry -> `./<name>`. */
export function publicSubpath(modulePath) {
  const facade = FACADE.exec(modulePath);
  if (facade) return `./${facade[1]}`;
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
    // The stub's own `import("z3-solver")` must reach the installed package: left to this resolver
    // it resolved to the stub again, so the peer was reported missing even when it was installed.
    b.onResolve({ filter: /^(z3-solver|ws)$/ }, (args) => (args.namespace === "optional-peer"
      ? { path: args.path, external: true }
      : { path: args.path, namespace: "optional-peer" }));
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
    exports[subpath] = `./dist/${subpath.slice(2)}${isFacade(modulePath) ? ".js" : ""}`;
  }
  for (const file of DATA_FILES) {
    const subpath = publicSubpath(file.replace(/\.json$/, ".mjs")).replace(/\.js$/, ".json");
    exports[subpath] = `./dist/${subpath.slice(2)}`;
  }
  return exports;
}

export async function buildEngine({ outDir = path.join(root, "packages/engine/dist") } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  const facades = Object.keys(boundary.apiSurface).filter(isFacade);
  // Everything a named entry re-exports is built as a module of its own, listed or not.
  const all = [...new Set([...Object.keys(boundary.apiSurface).filter((m) => !isFacade(m)), ...facades.flatMap(facadeTargets)])];
  const entryName = (modulePath) => publicSubpath(modulePath).slice(2).replace(/\.m?js$/, "");
  const common = { bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "warning", plugins: [optionalPeers], external: ["jsonrepair", "@modelcontextprotocol/sdk"] };
  const libraries = Object.fromEntries(all.filter((m) => !EXECUTABLES.has(m)).map((m) => [entryName(m), path.join(root, m)]));
  await build({ ...common, entryPoints: libraries, outdir: outDir, splitting: true, outExtension: { ".js": ".js" } });
  const executables = Object.fromEntries(all.filter((m) => EXECUTABLES.has(m)).map((m) => [entryName(m), path.join(root, EXECUTABLE_SOURCE[m] ?? m)]));
  // A shebang so the `agon` bin (#822) runs as a command once npm links it.
  await build({ ...common, entryPoints: executables, outdir: outDir, outExtension: { ".js": ".mjs" }, banner: { js: "#!/usr/bin/env node" } });
  for (const file of DATA_FILES) {
    const target = path.join(outDir, publicSubpath(file.replace(/\.json$/, ".mjs")).slice(2).replace(/\.js$/, ".json"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file), target);
  }
  for (const facade of facades) {
    const built = readFileSync(path.join(root, facade), "utf8").replace(/\bfrom\s+"([^"]+)"/g, (whole, specifier) => {
      const target = path.relative(root, path.resolve(root, path.dirname(facade), specifier)).split(path.sep).join("/");
      const from = path.posix.dirname(publicSubpath(facade));
      const relative = path.posix.relative(from, publicSubpath(target));
      return `from "${relative.startsWith(".") ? relative : `./${relative}`}"`;
    });
    const builtFile = path.join(outDir, `${publicSubpath(facade).slice(2)}.js`);
    mkdirSync(path.dirname(builtFile), { recursive: true });
    writeFileSync(builtFile, built);
  }
  return { outDir, entries: [...Object.keys(libraries), ...Object.keys(executables), ...facades.map((m) => publicSubpath(m).slice(2))] };
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
