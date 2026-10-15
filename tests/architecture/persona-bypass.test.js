// No parallel paths (#275): every flow goes through every persona its charter step names, and
// an input chooses a persona's default, never skips the persona. Two guards:
//
// 1. Receipt invariant (behavioural): each level-producing command run with no budget still
//    leaves an Allocator receipt and price list. #274 was a level built with neither, which every
//    static guard passed. A known bypass is listed with its issue and must STILL be one, so the
//    list cannot outlive its fix.
// 2. Budget-gated conditionals in glue are ratcheted per file: a new `if (budget …)` in glue is
//    how a persona step gets made optional. Counts may only go down.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { extname, join, relative, resolve, sep } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const ALLOWLIST = JSON.parse(readFileSync(resolve(__dirname, "persona-bypass-allowlist.json"), "utf8"));

const GLUE_ROOTS = [
  "packages/adapters-cli/src", "packages/adapters-web/src", "packages/adapters-test/src",
  "packages/runtime/src/build", "packages/runtime/src/commands", "packages/runtime/src/runner",
  "packages/ui-ascii/src", "packages/ui-web/src",
];
const BUDGET_GATE = /(if \(|\? |&& )[^;]*\b(budget|priceList|budgetTokens|budgetArtifact|priceListArtifact|resolvedPriceList|budgetLoopEnabled)\b/;

function ak(args, dir, { stamp = true } = {}) {
  return spawnSync(process.execPath, [CLI, ...args, ...(stamp ? ["--created-at", "2026-10-15T00:00:00.000Z"] : []), "--out-dir", dir],
    { cwd: ROOT, encoding: "utf8" });
}

function priced(dir) {
  return existsSync(join(dir, "budget-receipt.json")) && existsSync(join(dir, "price-list.json"));
}

const AUTHORING = [
  ["create", "--room", "size=small;count=1", "--delver", "count=1;id=hero;motivation=user_controlled"],
  ["configure", "--room", "size=small;count=1"],
  ["room-plan", "--room", "size=small;count=1"],
  ["hazard-plan", "--hazard", "affinity=fire;expression=emit;proximityRadius=2"],
  ["resource-plan", "--resource", "permanenceMode=consumable;vital=health;delta=5"],
  ["delver-plan", "--delver", "count=1;motivation=exploring"],
  ["warden-plan", "--warden", "count=1;motivation=stationary"],
];

test.each(AUTHORING.map((args) => [args[0], args]))("%s with no budget is priced by the Allocator", (_name, args) => {
  const dir = mkdtempSync(join(tmpdir(), "persona-bypass-"));
  try {
    const result = ak(args, dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(priced(dir), `${args[0]} wrote no Allocator receipt and price list: a parallel path around the Allocator`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build --spec without a budget is still a known bypass (#276): lift it from the allowlist when fixed", () => {
  const dir = mkdtempSync(join(tmpdir(), "persona-bypass-build-"));
  try {
    assert.equal(ak(AUTHORING[0], join(dir, "create")).status, 0);
    const spec = JSON.parse(readFileSync(join(dir, "create", "spec.json"), "utf8"));
    delete spec.budget;
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
    const result = ak(["build", "--spec", join(dir, "spec.json")], join(dir, "build"), { stamp: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(ALLOWLIST.unpricedEntrypoints["build --spec without a budget"], 276);
    assert.equal(priced(join(dir, "build")), false,
      "build --spec is priced now: remove it from unpricedEntrypoints and add it to the priced list above");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function collect(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") collect(path, files);
    } else if ([".js", ".mjs", ".ts", ".mts"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

test("budget-gated conditionals in glue only go down", () => {
  const counts = {};
  for (const root of GLUE_ROOTS) {
    for (const file of collect(resolve(ROOT, root))) {
      const n = readFileSync(file, "utf8").split("\n").filter((line) => BUDGET_GATE.test(line)).length;
      if (n) counts[relative(ROOT, file).split(sep).join("/")] = n;
    }
  }
  const problems = [];
  for (const [file, n] of Object.entries(counts)) {
    const max = ALLOWLIST.gates[file]?.max ?? 0;
    if (n > max) {
      problems.push(`${file}: ${n} budget-gated conditionals (allowed ${max}). Gating on caller budget input skips a persona; apply the persona's default instead (#275).`);
    }
  }
  for (const [file, { max }] of Object.entries(ALLOWLIST.gates)) {
    if ((counts[file] ?? 0) < max) problems.push(`${file}: down to ${counts[file] ?? 0}; lower its max in persona-bypass-allowlist.json from ${max}.`);
  }
  assert.deepEqual(problems, []);
});

// ## TODO: Test Permutations
// - ak configurator with --level-gen/--actors and no budget: still unpriced (#276); add as a known bypass.
// - MCP ak_create and ak_build with no budget behave as their CLI commands.
// - sandbox-create --budget: its budgetReceiptRef names a receipt that exists (#277).
// - a play session on a level with no receipt (#279).
