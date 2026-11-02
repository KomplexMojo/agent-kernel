// #677: strategy sources compared by play-sim outcome. A recorded tactic-plan reply stands in
// for the model, so nothing here needs a model host; the no-model case points at a closed port.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { compare, hasOwnTactic, renderReport, runStrategySources, sourceArgs, summarize } from "../../scripts/testing/play-sim-strategy-sources.mjs";
import { loadPlaytestScenarios } from "../../scripts/game/playtest.mjs";

const FIXTURE = resolve(__dirname, "../fixtures/llm/tactic-plan-valid.json");
const run = (scenario, seed, source, extra) => ({ scenario, seed, source, outcome: "exited", ticks: 20, tactics: ["retinue"], decidedBy: source === "llm" ? "llm" : "seeded", ...extra });

test("the source decides the --tactic arguments and nothing else", () => {
  expect(sourceArgs("catalogue")).toEqual(["--tactic", "auto"]);
  expect(sourceArgs("llm", { fixture: "r.json", model: "m", baseUrl: "http://h" })).toEqual(["--tactic", "llm", "--fixture", "r.json", "--model", "m", "--base-url", "http://h"]);
  expect(() => sourceArgs("hand")).toThrow(/unknown strategy source/);
  const catalog = loadPlaytestScenarios();
  expect(catalog.scenarios.some(hasOwnTactic)).toBe(true);
  expect(catalog.scenarios.some((entry) => !hasOwnTactic(entry))).toBe(true);
});

test("a pair counts only when the model decided; a fallback is listed, not compared", () => {
  const runs = [
    run("a", 0, "catalogue"), run("a", 0, "llm"),
    run("b", 0, "catalogue", { outcome: "defeated" }), run("b", 0, "llm", { decidedBy: "seeded", reasons: ["no model"] }),
    run("c", 0, "catalogue"), run("c", 0, "llm", { outcome: "create_failed" }),
  ];
  const result = compare(runs);
  expect(result.pairsCounted).toBe(1);
  expect(result.fellBack).toEqual([{ pair: "b#0", reasons: ["no model"] }]);
  expect(result.unpaired).toEqual(["c#0"]);
  expect(result.catalogue.runs).toBe(1);
  expect(summarize([run("a", 0, "llm"), run("a", 1, "llm", { outcome: "timeout", ticks: 200 })])).toMatchObject({ exited: 1, loops: 1, medianTicksToExit: 20 });
  expect(renderReport({ runs, comparison: result, fixture: "r.json", strategy: "dash", maxTicks: 200 })).toMatch(/Fell back \(not compared\)/);
});

test("with a recorded reply the llm source decides, and the same levels build for both sources", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "strategy-sources-"));
  try {
    const { comparison, runs } = await runStrategySources({ scenarios: ["first-look"], seeds: [0], outDir, maxTicks: 60, fixture: FIXTURE });
    expect(runs.map((entry) => [entry.source, entry.decidedBy])).toEqual([["catalogue", null], ["llm", "llm"]]);
    expect(runs[1].tactics).toEqual(["retinue", "minefield"]);
    expect(runs.every((entry) => entry.budgetTokens === runs[0].budgetTokens)).toBe(true);
    expect(comparison.pairsCounted).toBe(1);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);

test("with no reachable model the llm source falls back and is left out of the comparison", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "strategy-sources-"));
  try {
    const { comparison, runs } = await runStrategySources({ scenarios: ["first-look"], seeds: [0], outDir, maxTicks: 60, baseUrl: "http://127.0.0.1:9", model: "none" });
    expect(runs[1].decidedBy).toBe("seeded");
    expect(comparison.pairsCounted).toBe(0);
    expect(comparison.fellBack).toHaveLength(1);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);

// ## TODO: Test Permutations
// - a scenario that fixes its own --tactic is skipped with a note
// - --strategy fight
