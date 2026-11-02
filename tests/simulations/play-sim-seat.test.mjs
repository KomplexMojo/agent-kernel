// Play-sim seat driver (#654): a fixture picker plays a whole level through `ak play-session`
// (the command behind the MCP tools). No live model, no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildArm } from "../../scripts/testing/play-sim.mjs";
import { createCliTransport, runSeat, vitalsFromHud } from "../../scripts/testing/play-sim-seat.mjs";
import { loadPlaytestScenarios } from "../../scripts/game/playtest.mjs";

const built = () => {
  const catalog = loadPlaytestScenarios();
  const scenario = catalog.scenarios.find((entry) => entry.id === "first-look") ?? catalog.scenarios[0];
  const work = mkdtempSync(join(tmpdir(), "seat-test-"));
  const arm = buildArm(scenario, 0, { arm: "baseline", budgetTokens: scenario.budgetTokens }, work, catalog.createdAt);
  expect(arm.ok, arm.error).toBe(true);
  return { work, dir: arm.dir };
};

test("the HUD line is read back into vitals", () => {
  expect(vitalsFromHud("D1 hero-1 · HP 30/30 (+1) MP 6/60 (+4) ST 9/10 (+2) DU 10/10 (+1) · tick 0")).toEqual({ health: 30, mana: 6, stamina: 9, durability: 10 });
});

test("a picker plays turns from the legal list; illegal ids are refused, retried and counted", async () => {
  const { work, dir } = built();
  const transport = createCliTransport();
  try {
    let calls = 0;
    const picker = async ({ actions }) => {
      calls += 1;
      if (calls === 1) return "teleport:home"; // not in the list
      return actions.find((action) => action.id === "wait")?.id;
    };
    const log = await runSeat({ transport, levelDir: dir, picker, maxTurns: 3 });
    expect(log.illegal).toBe(1);
    expect(log.picks).toBe(3);
    expect(log.transcript.map((entry) => entry.pick)).toEqual(["wait", "wait", "wait"]);
    expect(log.seat).toMatch(/\S/);
    expect(Object.keys(log.finalVitals)).toContain("health");
    expect(log.outcome).toBe("timeout");
  } finally {
    transport.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}, 120000);

test("a picker that never names a listed id ends the run as illegal", async () => {
  const { work, dir } = built();
  const transport = createCliTransport();
  try {
    const log = await runSeat({ transport, levelDir: dir, picker: async () => "nope", maxTurns: 5, retries: 1 });
    expect(log.outcome).toBe("illegal");
    expect(log.illegal).toBe(2);
    expect(log.picks).toBe(0);
    expect(log.rejectedAnswers).toEqual(["nope", "nope"]);
  } finally {
    transport.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}, 120000);

test("play-sim --driver seat writes a record with the seat log, ready for the anomaly cards", async () => {
  const { runPlaySim } = await import("../../scripts/testing/play-sim.mjs");
  const outDir = mkdtempSync(join(tmpdir(), "seat-out-"));
  try {
    const seatPicker = async ({ actions }) => actions.find((action) => action.id === "wait").id;
    const { runs } = await runPlaySim({ scenarios: ["first-look"], seeds: [0], treatment: false, maxTicks: 2, outDir, seatPicker });
    expect(runs).toHaveLength(1);
    expect(runs[0].driver).toBe("seat");
    expect(runs[0].seatLog.turns).toBe(2);
    expect(runs[0].outcome).toBe("timeout");
    expect(runs[0].ruleHits.map((hit) => hit.rule)).toContain("no_exit");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);

test("the model picker asks for a direct answer (think:false) and keeps what the model said", async () => {
  const { llmSeatPicker } = await import("../../scripts/testing/play-sim-seat.mjs");
  const seen = [];
  const adapter = { generate: async (request) => { seen.push(request); return { response: "", thinking: "hmm" }; } };
  const picker = llmSeatPicker({ adapter, model: "m" });
  const id = await picker({ result: { screen: "", hud: "", inSight: [] }, actions: [{ id: "wait", label: "wait" }] });
  expect(id).toBeNull();
  expect(seen[0].think).toBe(false);
  expect(picker.lastRaw).toMatch(/empty response; the model only produced thinking/);
});

test("the model sees its recent turns, so it can notice a loop or a tile that hurts", async () => {
  const { llmSeatPicker } = await import("../../scripts/testing/play-sim-seat.mjs");
  const prompts = [];
  const adapter = { generate: async (request) => { prompts.push(request.prompt); return { response: '{"action":"wait"}' }; } };
  const picker = llmSeatPicker({ adapter, model: "m" });
  const history = [{ pick: "move:east", refused: false, hud: "HP 20/20 tick 1" }, { pick: "move:west", refused: true, hud: "HP 18/20 tick 2" }];
  await picker({ result: { screen: "", hud: "HP 18/20", inSight: [] }, actions: [{ id: "wait", label: "wait" }], history });
  expect(prompts[0]).toMatch(/move:east -> HP 20\/20 tick 1/);
  expect(prompts[0]).toMatch(/move:west \(refused\) -> HP 18\/20 tick 2/);
});
