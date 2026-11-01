// #654: the LLM seat driver. A picker (a model, or here a fixture) plays a whole level through a
// seat that offers look / act / end, choosing only from the legal list. Illegal picks are refused
// and retried to a cap, core refusals are counted, and the run ends exited, defeated, stuck or at
// the tick cap. The row it writes is the M2 run-record shape, so play-sim-report reads it.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createPlaySession } from "../../packages/runtime/src/runner/play-session.js";
import { listLegalPlayCommands } from "../../packages/runtime/src/runner/play-legal-commands.js";
import { runSeat, seatRecord, writeSeatRun, modelSeatPicker } from "../../scripts/testing/play-sim-seat.mjs";
import { report } from "../../scripts/testing/play-sim-report.mjs";

const require = createRequire(import.meta.url);
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const level = () => buildUnifiedLevel({
  id: "seat", tiles: ["#######", "#.....E", "#######"],
  actors: [{ category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals: viableVitals(), affinities: [] }],
});

// An in-process seat with the same look/act/end shape as the CLI-backed one.
async function memorySeat() {
  const session = await createPlaySession({ ...level(), fog: false });
  return {
    async look() { const view = session.view(); return { status: view.status, legal: listLegalPlayCommands(view), view }; },
    async act(command) { const result = await session.act(command); return { status: result.status, rejected: result.rejected || [] }; },
    async end() {},
  };
}

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

test("a picker that always steps east walks the level to the exit", async () => {
  const log = await runSeat({ seat: await memorySeat(), picker: async ({ actions }) => actions.find((a) => a.id === "move:east")?.id ?? "wait", maxTicks: 40 });
  expect(log.outcome).toBe("exited");
  expect(log.picks.length).toBeGreaterThan(0);
  expect(log.illegal).toBe(0);
  expect(log.ticks).toBe(log.picks.length);
});

test("an id outside the legal list is refused and retried; past the cap the run ends illegal", async () => {
  const seen = [];
  const flaky = async ({ actions, problem }) => { seen.push(problem); return seen.length === 1 ? "teleport" : actions[0].id; };
  const ok = await runSeat({ seat: await memorySeat(), picker: flaky, maxTicks: 1, retries: 2 });
  expect(ok.illegal).toBe(1);
  expect(seen[1]).toMatch(/teleport/); // the picker is told what was refused
  const bad = await runSeat({ seat: await memorySeat(), picker: async () => "teleport", maxTicks: 5, retries: 2 });
  expect(bad.outcome).toBe("illegal");
  expect(bad.illegal).toBe(3);
  expect(bad.picks).toEqual([]);
});

test("a run that never exits stops at the tick cap", async () => {
  const log = await runSeat({ seat: await memorySeat(), picker: async () => "wait", maxTicks: 6 });
  expect(log.outcome).toBe("timeout");
  expect(log.ticks).toBe(6);
});

test("core refusals of a listed command are counted, not hidden", async () => {
  const seat = await memorySeat();
  const refusing = { ...seat, act: async () => ({ status: { exited: false }, rejected: [{ reason: "nope" }] }) };
  const log = await runSeat({ seat: refusing, picker: async () => "wait", maxTicks: 3 });
  expect(log.refusedByCore).toBe(3);
});

test("the row is the M2 record shape and play-sim-report reads it; rule hits are not computed", async () => {
  const log = await runSeat({ seat: await memorySeat(), picker: async ({ actions }) => actions.find((a) => a.id === "move:east")?.id ?? "wait", maxTicks: 40 });
  const record = seatRecord({ scenario: "seat", seed: 1, model: "fixture", log });
  expect(record).toMatchObject({ scenario: "seat", seed: 1, arm: "baseline", strategy: "llm-seat", outcome: "exited", ruleHits: [] });
  expect(record.seat).toMatchObject({ model: "fixture", illegal: 0, rulesChecked: false });
  const dir = mkdtempSync(join(tmpdir(), "seat-"));
  dirs.push(dir);
  const file = writeSeatRun(dir, record);
  expect(readdirSync(dir)).toContain(file);
  expect(JSON.parse(readFileSync(join(dir, file), "utf8")).outcome).toBe("exited");
  const out = report(dir);
  expect(out.cohort.arms.baseline).toMatchObject({ runs: 1, exitRate: 1, ruleHitRate: 0 });
});

test("modelSeatPicker asks the model with the screen and the list, and returns its id", async () => {
  const prompts = [];
  const adapter = { generate: async ({ prompt }) => { prompts.push(prompt); return { response: "{\"action\":\"move:east\"}" }; } };
  const picker = modelSeatPicker({ adapter, model: "m" });
  const view = { screen: "SCREEN-TEXT", hud: "HUD-TEXT", inSight: [] };
  const id = await picker({ view, actions: [{ id: "move:east", label: "step east" }, { id: "wait", label: "wait a turn" }] });
  expect(id).toBe("move:east");
  expect(prompts[0]).toContain("SCREEN-TEXT");
  expect(prompts[0]).toContain("move:east: step east");
  expect(await modelSeatPicker({ adapter: { generate: async () => ({ response: "not json" }) }, model: "m" })({ view, actions: [] })).toBeNull();
});

// ## TODO: Test Permutations
// - a defeated seat ends "defeated"
// - a look with an empty legal list ends "no_actions"
// - the CLI-backed seat (cliSeat) against a bundled level with a scripted picker
