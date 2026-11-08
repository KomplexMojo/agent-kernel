import { describe, expect, it } from "vitest";
import { DM_DEFAULTS, fakeMaster, runDungeonMaster } from "../../scripts/testing/play-sim-dungeon-master.mjs";
import { createHoldingPricer } from "../../scripts/testing/logic-tactic-benefit.mjs";
import { buildUnifiedLevel, viableVitals } from "../fixtures/ui-ascii/unified-level.mjs";

// #681 (AI L3): a dungeon master orders the ai_controlled side every few ticks, sees only what its
// actors' seats see, and the run is scored on the delver's terms. Fake master only: no model here.

const ROOM = [
  "############",
  "S..........#",
  "#..........#",
  "#..........#",
  "#..........E",
  "############",
];
const warden = (id, x) => ({ category: "warden", id, position: { x, y: 2 }, vitals: viableVitals(),
  motivations: ["ai_controlled", "exploring", "goal_oriented"] });
function level() {
  return buildUnifiedLevel({ id: "dm", tiles: ROOM, actors: [
    { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["exploring", "goal_oriented"] },
    warden("keeper", 4), warden("keeper-2", 9),
  ] });
}
const run = async (master, options = {}) => runDungeonMaster({ level: level(), master, tokenValueOf: await createHoldingPricer(), ...options });

describe("the dungeon-master seat", () => {
  it("states its defaults: a call every 5 ticks, 12 a run", () => {
    expect(DM_DEFAULTS).toEqual({ cadence: 5, callBudget: 12, maxTicks: 60 });
  });

  it("sees only what each of its actors' seats sees", async () => {
    const seen = [];
    await run(async ({ observations }) => { seen.push(observations); return { orders: [] }; }, { maxTicks: 6 });
    const [first] = seen;
    expect(first.map((obs) => obs.id).sort()).toEqual(["keeper", "keeper-2"]);
    for (const obs of first) {
      expect(Object.keys(obs).sort()).toEqual(["hud", "id", "inSight", "label", "order", "screen"]);
      expect(obs.hud).toContain(obs.id);
      // Others are a label, a role and a seen position: never their vitals.
      for (const other of obs.inSight) expect(Object.keys(other).sort()).toEqual(["label", "position", "role"]);
    }
  });

  it("orders only its own side; anything else is refused and counted, never played", async () => {
    let call = 0;
    const report = await run(async () => (call++ === 0
      ? { orders: [{ actor: "hero", goals: [{ kind: "survive" }] }, { actor: "nobody", goals: [{ kind: "survive" }] },
        { actor: "keeper", goals: [{ kind: "dance" }] }, { actor: "keeper", goals: [{ kind: "follow", target: "keeper-2" }] }] }
      : { orders: [] }), { maxTicks: 8 });
    const [first] = report.master.log;
    expect(first.orders.map((entry) => entry.refused ?? "given")).toEqual(["not_yours", "not_yours", "invalid_strategy", "given"]);
    expect(report.master.refused).toBe(3);
  });

  it("keeps to its cadence and its call budget", async () => {
    const report = await run(async () => ({ orders: [] }), { maxTicks: 20, cadence: 4, callBudget: 3 });
    expect(report.master.calls).toBe(3);
    expect(report.master.log.map((entry) => entry.tick)).toEqual([0, 4, 8]);
  });

  it("scores the delver per run, in parts, never one number", async () => {
    const report = await run(fakeMaster(), { maxTicks: 30 });
    expect(report.delverId).toBe("hero");
    expect(Object.keys(report.score).sort()).toEqual(["defeated", "exited", "kills", "nonRenewableUse", "tokenValueAcquired", "turns", "vitalPressure"]);
    expect(["ticks", "delver_exited", "delver_defeated", "master_has_no_actors"]).toContain(report.stoppedBy);
  });
});

// ## TODO: Test Permutations
// - the seated actor is defeated: the seat moves to another living ai actor
// - a master that throws: the error is logged and the world still runs a tick
// - the llmMaster prompt holds no exit position and no vitals of others (seat prompt rule)
