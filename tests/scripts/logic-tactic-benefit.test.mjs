import { describe, expect, it } from "vitest";
import {
  REACT_WINDOW,
  TACTIC_BENEFIT_VERDICT,
  buildWorld,
  catalogueStrategies,
  createHoldingPricer,
  judgeTacticBenefit,
  loadTacticCatalogue,
  oracleFrontier,
  outcomeBeats,
  paretoInsert,
  runActorPolicy,
  runReorderControl,
  runWeightedControl,
  scoreRun,
} from "../../scripts/testing/logic-tactic-benefit.mjs";
import { runLedger } from "../../scripts/testing/logic-value-ledger.mjs";

// #674 (AI T2): the tactic benefit gate. The verdict rule is fixed before any run, every mover
// acts through core's own tick, and the score is the delver's own (token value, non-renewable
// use, vital pressure), never collapsed.

const BOARD = { width: 7, height: 5, start: { x: 1, y: 1 }, exit: { x: 5, y: 3 } };
const HORIZON = 9;
const exitedRun = (tokenValueAcquired, nonRenewableUse) => ({ exited: true, defeated: false, tokenValueAcquired, nonRenewableUse });

describe("the verdict rule, fixed before the run", () => {
  it("adopts only when the residual reaches the agreed share of points", () => {
    expect(TACTIC_BENEFIT_VERDICT.minResidualShare).toBe(0.10);
    expect(judgeTacticBenefit({ points: 100, gap: 40, residual: 10 }).verdict).toBe("adopt");
    expect(judgeTacticBenefit({ points: 100, gap: 40, residual: 9 }).verdict).toBe("reject");
  });

  it("names the control that closed most of the gap when it rejects", () => {
    const verdict = judgeTacticBenefit({ points: 100, gap: 40, residual: 2, closedBy: { reorder: 30, "strategy:x": 5 } });
    expect(verdict.verdict).toBe("reject");
    expect(verdict.reason).toContain("reorder closes 30/40");
  });

  it("has nothing to say with no decision points, and that reads as no", () => {
    expect(judgeTacticBenefit({ points: 0, gap: 0, residual: 0 }).verdict).toBe("unmeasured");
  });
});

describe("the score", () => {
  it("beats a run only by exiting alive and doing no worse on token value or non-renewable use", () => {
    expect(outcomeBeats(exitedRun(30, 5), exitedRun(0, 5))).toBe(true);
    expect(outcomeBeats(exitedRun(0, 0), exitedRun(0, 5))).toBe(true);
    // A trade is not a win: more tokens for more harm leaves both on the frontier.
    expect(outcomeBeats(exitedRun(30, 10), exitedRun(0, 5))).toBe(false);
    expect(outcomeBeats(exitedRun(0, 20), { ...exitedRun(30, 0), exited: false })).toBe(true);
    expect(outcomeBeats(exitedRun(0, 20), { ...exitedRun(30, 0), defeated: true })).toBe(true);
    expect(paretoInsert([exitedRun(30, 10)], exitedRun(0, 5))).toHaveLength(2);
    expect(paretoInsert([exitedRun(30, 10), exitedRun(0, 5)], exitedRun(30, 5))).toEqual([exitedRun(30, 5)]);
  });

  it("charges only vitals with no regen, and flags an actor that keeps doing the same thing under 25%", () => {
    const vitals = (health, stamina) => ({ health: { current: health, max: 20, regen: 0 }, stamina: { current: stamina, max: 8, regen: 1 } });
    const frame = (signature, before, after) => ({ signature, before, after });
    const frames = [
      frame("move:1,0", vitals(20, 8), vitals(15, 7)),
      frame("move:1,0", vitals(15, 7), vitals(15, 1)),
      ...Array.from({ length: REACT_WINDOW }, () => frame("move:1,0", vitals(15, 1), vitals(15, 1))),
    ];
    const final = { actors: [{ id: "delver", lifecycle: "exited", vitals: vitals(15, 1), holdings: [] }] };
    const run = scoreRun({ frames, final, roles: {} }, { tokenValueOf: () => 0, optionsLost: { stamina: ["retreat", "move"] } });
    expect(run.nonRenewableUse).toBe(5); // health only: the stamina it spent regenerates
    const stamina = run.vitalPressure.find((entry) => entry.vital === "stamina");
    expect(stamina).toMatchObject({ renewable: true, turnsBelow25: REACT_WINDOW + 1, reactedAt25: false, repeatedUnder25: true });
    expect(stamina.optionsLost.actionNeeded).toEqual(["retreat", "move"]);
  });
});

describe("one world for every mover", () => {
  it("prices a holding at the Allocator's resource price, and refuses one it cannot price", async () => {
    const price = await createHoldingPricer();
    expect(price({ id: "r", kind: "vital", permanenceMode: "permanent", vitals: [{ key: "mana", delta: 3 }] })).toBeGreaterThan(0);
    expect(() => price({ id: "a", kind: "affinity" })).toThrow(/prices vital holdings only/);
  });

  it("precondition: the policy exits an open board, and a take goal claims the resource beside it", async () => {
    const price = await createHoldingPricer();
    const open = scoreRun(await runActorPolicy(buildWorld(BOARD), { horizon: HORIZON }), { tokenValueOf: price });
    expect(open.exited).toBe(true);
    const world = buildWorld({ ...BOARD, resources: [{ position: { x: 2, y: 2 } }],
      delver: { motivations: ["exploring", "strategy_focused"] } });
    const taking = scoreRun(await runActorPolicy(world, { horizon: HORIZON,
      strategy: { goals: [{ kind: "take", target: "resource_1" }] } }), { tokenValueOf: price });
    expect(taking.tokenValueAcquired).toBeGreaterThan(0);
  });

  it("finds the frontier through core, and nothing a one-step mover does beats it", async () => {
    // A fire hazard whose reach closes column 3 from wall to wall: every route takes one hit.
    const world = buildWorld({ ...BOARD, hazards: [{ position: { x: 3, y: 2 } }], resources: [{ position: { x: 2, y: 3 } }] });
    const tokenValueOf = await createHoldingPricer();
    const { frontier } = oracleFrontier(world, { horizon: HORIZON, tokenValueOf });
    const resourcePrice = tokenValueOf(world.snapshot.actors.find((actor) => actor.id === "resource_1").holdings[0]);
    expect(frontier).toEqual([expect.objectContaining({ tokenValueAcquired: resourcePrice, nonRenewableUse: 5 })]);
    const runs = [
      await runActorPolicy(world, { horizon: HORIZON }),
      await runReorderControl(world, { horizon: HORIZON, tokenValueOf }),
      await runWeightedControl(world, { horizon: HORIZON, tokenValueOf, weight: 1 }),
    ].map((trace) => scoreRun(trace, { tokenValueOf }));
    for (const run of runs) expect(outcomeBeats(run, frontier[0])).toBe(false);
  });

  it("poses the catalogue's strategy data with this domain's resource ids", async () => {
    const strategies = catalogueStrategies(await loadTacticCatalogue());
    const take = strategies.find((entry) => entry.id === "do-not-burn-your-own-resource");
    expect(take.strategy.goals[0]).toEqual({ kind: "take", target: "resource_1" });
    expect(strategies.find((entry) => entry.id === "leave-hurting-tile").strategy.tactics).toHaveLength(1);
  });
});

describe("actor_tactic_benefit ledger", () => {
  it("answers every catalogue entry, and the probe stays unmeasured in a full-sight domain", async () => {
    const result = await runLedger("actor_tactic_benefit", { profile: "gate", limit: 2 });
    expect(result.counters.points).toBe(2);
    expect(result.verdicts.map((entry) => entry.id)).toEqual((await loadTacticCatalogue()).entries.map((entry) => entry.id));
    expect(result.verdicts.find((entry) => entry.id === "probe-before-entering-a-guarded-corridor").verdict).toBe("unmeasured");
    expect(["adopt", "reject"]).toContain(result.verdicts.find((entry) => entry.id === "route-around-a-guards-reach").verdict);
  });
});

// ## TODO: Test Permutations
// - a board where the only frontier run trades token value for harm (two frontier points)
// - a two-hazard board where the reorder control never exits (refuses every hit)
// - the information gap on a board where the resource is out of the delver's sight
// - a strategy tactic (retreat under 50% health) that fires and is scored worse than the policy
