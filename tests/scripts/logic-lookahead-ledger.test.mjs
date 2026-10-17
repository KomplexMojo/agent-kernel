import { describe, expect, it } from "vitest";
import { runPolicy } from "../../scripts/testing/logic-lookahead.mjs";
import { runLedger } from "../../scripts/testing/logic-value-ledger.mjs";

// The actor_lookahead ledger drives the REAL Actor persona a tick at a time and reads
// the move it chose. Nothing exercised it, so when the unified-actor rewrite (#216)
// renamed a move's destination from `params.to` to `params.target` the harness kept
// reading the old key, saw no move, and every policy run stood still -- the ledger
// threw its own precondition on every profile and #162's livelock count could no
// longer be measured at all.
describe("actor_lookahead ledger harness", () => {
  it("drives the Actor to the exit on an open board", async () => {
    const tiles = ["#######", "#.....#", "#.....#", "#.....#", "#######"];
    const run = await runPolicy({
      tiles,
      fields: [],
      start: { x: 1, y: 1 },
      exit: { x: 5, y: 3 },
      horizon: 7,
      grants: [],
    });
    expect(run.reached).toBe(true);
    expect(run.path.length).toBeGreaterThan(1);
  });

  // #162: lateral-vs-lateral two-cycles left the Actor short of the exit on 60 swept
  // boards. The gate profile is the fast slice of the same sweep; a returning livelock
  // shows up here as a non-zero count before anyone has to run the full sweep.
  it("reaches the exit on every gate board (no lateral livelock)", async () => {
    const result = await runLedger("actor_lookahead", { profile: "gate" });
    expect(result.counters.points).toBeGreaterThan(0);
    expect(result.counters.policyFailedToReach).toBe(0);
    expect(result.examples.policyFailedToReach ?? []).toEqual([]);
  });
});
