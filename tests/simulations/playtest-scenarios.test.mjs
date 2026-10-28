// Playtest scenarios (scripts/game/playtest.sh): every scenario must build through `ak create`
// and run headless for every affinity as the player's, breaking no simulation rule beyond the
// ones it lists as known. The report a playtest writes must replay to the same game.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  affinitiesForSeed,
  decodeReplay,
  encodeReplay,
  loadPlaytestScenarios,
  parseReport,
  renderReport,
  runPlay,
  scenarioArgs,
  traitKinds,
} from "../../scripts/game/playtest.mjs";
import { RULES, checkRules, compareWithKnown, runScenarios } from "../../scripts/testing/simulation-lib.mjs";
import { AFFINITY_KINDS, AFFINITY_OPPOSITES } from "../../packages/runtime/src/contracts/domain-constants.js";

const catalog = loadPlaytestScenarios();
// Seeds 0-9 give every affinity once as the player's. Each scenario takes two of them (one opposed
// pair, either way round), so the catalogue covers every affinity without 50 builds in the suite;
// a script run over all seeds is cheap to do by hand when the catalogue changes.
const SEEDS = Array.from({ length: AFFINITY_KINDS.length }, (_, seed) => seed);
const PAIRS = AFFINITY_KINDS.length / 2;
const seedsFor = (index) => [index % PAIRS, (index % PAIRS) + PAIRS];
const runs = catalog.scenarios.flatMap((scenario, index) => seedsFor(index).map((seed) => ({
  id: `playtest-${scenario.id}-s${seed}`,
  ticks: 40,
  args: scenarioArgs(scenario, seed),
  knownIssues: scenario.knownIssues,
})));
let results;

beforeAll(async () => {
  results = await runScenarios(runs, { concurrency: 2 });
}, 480_000);

test("seeds pick an opposed pair for the player and a different opposed pair besides", () => {
  const players = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const { A, B, C, D } = affinitiesForSeed(seed);
    expect(AFFINITY_OPPOSITES[A]).toBe(B);
    expect(AFFINITY_OPPOSITES[C]).toBe(D);
    expect([A, B]).not.toContain(C);
    if (seed < SEEDS.length) players.add(A);
  }
  expect([...players].sort()).toEqual([...AFFINITY_KINDS].sort());
});

test("seeds pick two different trait kinds, and every trait kind comes up", () => {
  const seen = new Set();
  for (let seed = 0; seed < SEEDS.length; seed += 1) {
    const { T1, T2 } = affinitiesForSeed(seed);
    expect(T1).not.toBe(T2);
    seen.add(T1);
  }
  expect([...seen].sort()).toEqual(traitKinds().map((row) => row.kind).sort());
});

test("a scenario with a tactic is built at its own seed, so the placement replays", () => {
  for (const scenario of catalog.scenarios.filter((entry) => entry.args.includes("--tactic"))) {
    const args = scenarioArgs(scenario, 7);
    expect(args[args.indexOf("--seed") + 1]).toBe("7");
  }
});

test("the catalogue is well formed", () => {
  const ids = catalog.scenarios.map((scenario) => scenario.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const scenario of catalog.scenarios) {
    expect(scenario.focus.length).toBeGreaterThan(0);
    expect(scenario.shows).toBeTruthy();
    expect(scenario.args.some((arg) => arg.includes("motivation=user_controlled"))).toBe(true);
    for (const entry of scenario.knownIssues ?? []) {
      expect(Object.keys(RULES)).toContain(entry.rule);
      expect(entry.issue).toMatch(/^#\d+$/);
    }
  }
});

test("a report carries its scenario, seed and replay back out", () => {
  const commands = [{ tick: 1, actorId: "hero-1", command: { kind: "move", params: { direction: "east" } } }];
  expect(decodeReplay(encodeReplay(commands))).toEqual(commands);
  const scenario = catalog.scenarios[0];
  const report = renderReport({
    scenario, seed: 7, commit: "abc1234", branch: "main", createdAt: catalog.createdAt, playedAt: "2026-10-18T00:00:00.000Z",
    picks: affinitiesForSeed(7), final: { turns: 1, status: { exited: false }, screen: "board" },
    notes: ["turn 1: something odd"], replayCode: encodeReplay(commands), cost: null,
  });
  expect(report).toContain("1. turn 1: something odd");
  expect(parseReport(report)).toEqual({ scenario: scenario.id, seed: 7, commit: "abc1234", createdAt: catalog.createdAt, commands });
});

// #483: a crash in `ak play` still gets a report, with the exit code and the last stderr lines.
test("a failing ak play is reported as a crash, not lost", () => {
  const dir = mkdtempSync(join(tmpdir(), "ak-fake-play-"));
  try {
    const fake = join(dir, "fake-ak.mjs");
    writeFileSync(fake, "process.stderr.write('boom line 1\\nTypeError: no such slot\\n'); process.exit(3);\n");
    const played = runPlay(["--dir", dir], { akPath: fake });
    expect(played.status).toBe(3);
    expect(played.stderrTail).toContain("TypeError: no such slot");
    const scenario = catalog.scenarios[0];
    const commands = [{ tick: 1, actorId: "hero-1", command: { kind: "move", params: { direction: "east" } } }];
    const report = renderReport({
      scenario, seed: 7, commit: "abc1234", branch: "main", createdAt: catalog.createdAt, playedAt: "2026-10-18T00:00:00.000Z",
      picks: affinitiesForSeed(7), final: null, notes: [], replayCode: encodeReplay(commands), cost: null, crash: played,
    });
    expect(report).toContain("## Crash");
    expect(report).toContain("exited with code 3");
    expect(report).toContain("TypeError: no such slot");
    expect(parseReport(report).commands).toEqual(commands);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a grade (#422) takes the place of the scenario's budget, and rides in the report", () => {
  const scenario = catalog.scenarios[0];
  const graded = scenarioArgs(scenario, 7, "C");
  expect(graded.slice(0, 2)).toEqual(["--grade", "C"]);
  expect(graded).not.toContain("--budget-tokens");
  const report = renderReport({
    scenario, seed: 7, grade: "C", commit: "abc1234", branch: "main", createdAt: catalog.createdAt, playedAt: "2026-10-18T00:00:00.000Z",
    picks: affinitiesForSeed(7), final: null, notes: [], replayCode: encodeReplay([]), cost: null,
  });
  expect(report).toContain("- Grade: C");
  expect(parseReport(report).grade).toBe("C");
});

describe.each(runs.map((run, index) => [run.id, index]))("%s", (_id, index) => {
  test("builds, runs and breaks no rule beyond its known issues", () => {
    const run = runs[index];
    const { unexpected } = compareWithKnown(run, checkRules(run, results[index]));
    expect(unexpected.map((violation) => `${violation.rule}${violation.actor ? ` ${violation.actor}` : ""}: `
      + `${RULES[violation.rule]}${violation.detail ? ` (${violation.detail})` : ""}`)).toEqual([]);
  });
});
