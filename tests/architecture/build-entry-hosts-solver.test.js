// #296 — one persona question, one answer. The Configurator's object placement is a solver
// domain: a build entry point that calls orchestrateBuild without a `placeObjects` host
// silently gets the reading-order fallback while the others get the solver, which is a
// parallel path under #275. Every call site must pass `placeObjects`, or be listed here
// with the reason it cannot.
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const ROOTS = ["packages/runtime/src", "packages/adapters-cli/src", "packages/adapters-web/src", "packages/ui-web/src", "packages/ui-ascii/src"];
const DEFINITION = "packages/runtime/src/build/orchestrate-build.js";

// path -> reason. Keep empty unless a caller genuinely has no solver host to offer.
const UNHOSTED_ALLOWED = {};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(m?js|ts)$/.test(name)) out.push(path);
  }
  return out;
}

function callArguments(source, start) {
  let depth = 0;
  for (let i = source.indexOf("(", start); i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")" && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

test("every orchestrateBuild call site hosts object placement", () => {
  const unhosted = [];
  let sites = 0;
  for (const root of ROOTS) {
    let files;
    try { files = walk(resolve(ROOT, root)); } catch { continue; }
    for (const file of files) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (rel === DEFINITION) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\borchestrateBuild\(/g)) {
        sites += 1;
        const call = callArguments(source, match.index);
        if (/\bplaceObjects\b/.test(call)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        if (!UNHOSTED_ALLOWED[rel]) unhosted.push(`${rel}:${line}`);
      }
    }
  }
  assert.ok(sites > 0, "found no orchestrateBuild call sites; the scan is broken");
  assert.deepEqual(unhosted, [], "orchestrateBuild called without a placeObjects host");
});
