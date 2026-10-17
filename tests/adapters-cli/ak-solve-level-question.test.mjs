import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// #300 — `ak solve --dir <level> --question ...` poses a real domain problem through the
// owning persona, instead of a free-text scenario every adapter defers.
const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return result;
}

function runCliJson(args, env) {
  const result = runCli(args, env);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const workDir = mkdtempSync(join(tmpdir(), "agent-kernel-solve-question-"));
const levelDir = join(workDir, "level");
runCliJson([
  "create",
  "--room", "size=small;count=2",
  "--hazard", "affinity=water;expression=emit;proximityRadius=1",
  "--hazard", "affinity=earth;expression=push;proximityRadius=1",
  "--resource", "permanenceMode=consumable;vital=health;delta=5",
  "--delver", "count=1;affinity=wind;motivation=user_controlled",
  "--budget-tokens", "3000",
  "--created-at", "2026-10-17T00:00:00.000Z",
  "--out-dir", levelDir,
]);
const levelActors = JSON.parse(readFileSync(join(levelDir, "initial-state.json"), "utf8")).actors;

test("place-objects asks the Configurator's solver to re-place the level's objects", () => {
  const outDir = join(workDir, "place");
  const output = runCliJson(["solve", "--dir", levelDir, "--question", "place-objects", "--out-dir", outDir]);
  expect(output).toMatchObject({ ok: true, solved: true, status: "fulfilled" });
  expect(output.answer).toMatchObject({ question: "place-objects", ok: true, source: "solver" });
  expect(output.answer.placements.map(({ id }) => id).sort()).toEqual(["hazard_1", "hazard_2", "resource_1"]);

  const request = JSON.parse(readFileSync(output.artifactPaths.solver_request, "utf8"));
  expect(request.problem).toMatchObject({ domain: "configurator_satisfiability", posedBy: "configurator" });
  expect(JSON.parse(readFileSync(output.artifactPaths.answer, "utf8"))).toEqual(output.answer);
  // The level itself is untouched: solve answers a question, it does not rewrite the build.
  expect(JSON.parse(readFileSync(join(levelDir, "initial-state.json"), "utf8")).actors).toEqual(levelActors);
}, 60_000);

test("place-objects says the fallback decided when the engine cannot serve the domain", () => {
  const output = runCliJson(
    ["solve", "--dir", levelDir, "--question", "place-objects", "--out-dir", join(workDir, "place-stub")],
    { AK_SOLVER_ENGINE: "stub" },
  );
  expect(output).toMatchObject({ solved: false, status: "deferred", reason: "solver_domain_unavailable" });
  expect(output.answer).toMatchObject({ ok: true, source: "fallback" });
  expect(output.artifactPaths.solver_request).toBeUndefined();
}, 60_000);

test("budget-fit asks the Allocator to fit the level's billed tiles to a budget", () => {
  const terrain = JSON.parse(readFileSync(join(levelDir, "sim-config.json"), "utf8")).layout.data.terrain;
  const floors = terrain.filter((cell) => cell === "floor").length;

  const tight = runCliJson(["solve", "--dir", levelDir, "--question", "budget-fit", "--budget-tokens", "10",
    "--out-dir", join(workDir, "fit-tight")]);
  expect(tight).toMatchObject({ solved: true, status: "fulfilled" });
  expect(tight.answer.requestedLayout).toEqual({ floorTiles: floors, hallwayTiles: 0 });
  expect(tight.answer.ok).toBe(true);
  expect(tight.answer.layoutSpend.spentTokens).toBeLessThanOrEqual(10);
  const request = JSON.parse(readFileSync(tight.artifactPaths.solver_request, "utf8"));
  expect(request.problem).toMatchObject({ domain: "allocator_budget_fit", posedBy: "allocator" });

  const roomy = runCliJson(["solve", "--dir", levelDir, "--question", "budget-fit", "--budget-tokens", "100000",
    "--out-dir", join(workDir, "fit-roomy")]);
  expect(roomy).toMatchObject({ solved: false, status: "not_posed", reason: "no_search_needed" });
  expect(roomy.answer.layout).toEqual({ floorTiles: floors, hallwayTiles: 0 });
  expect(existsSync(join(workDir, "fit-roomy", "solver-request.json"))).toBe(false);
}, 60_000);

test("an unknown question is refused with the accepted values; a missing budget is the Allocator's refusal", () => {
  const unknown = runCli(["solve", "--dir", levelDir, "--question", "route", "--out-dir", join(workDir, "bad")]);
  expect(unknown.status).not.toBe(0);
  expect(unknown.stderr + unknown.stdout).toMatch(/place-objects, budget-fit/);
  const noBudget = runCliJson(["solve", "--dir", levelDir, "--question", "budget-fit", "--out-dir", join(workDir, "bad2")]);
  expect(noBudget).toMatchObject({ solved: false, status: "not_posed", reason: "invalid_budget_tokens" });
  expect(noBudget.answer.ok).toBe(false);
});

// ## TODO: Test Permutations
// - place-objects on a level whose objects cannot all fit reports ok:false with the unsat reason.
// - --question without --dir names the missing flag.
// - ak_solve over MCP with dir/question/budgetTokens returns the same answer as the CLI.
