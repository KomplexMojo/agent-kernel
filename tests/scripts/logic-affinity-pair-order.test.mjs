import { describe, expect, it } from "vitest";
import { OPPOSED_PAIRS, isOrderDependent, measure, runScenario } from "../../scripts/testing/logic-affinity-pair-order.mjs";

// #163 asks whether actor id order decides affinity field outcomes, measured before any
// rule is adopted. These pin the harness so its numbers keep meaning something: a
// renaming that should not matter must not register, one that does must, and every
// opposed pair is enumerated alike.
describe("affinity pair-order measurement (#163)", () => {
  it("keys outcomes by role, so renaming a lone source and receiver changes nothing", () => {
    for (const [kind] of OPPOSED_PAIRS) {
      const roles = [{ x: 0, slot: { kind, expression: "emit", stacks: 2 } }, { x: 1, slot: null }];
      expect(isOrderDependent(roles), kind).toBe(false);
      expect(runScenario(roles, ["actor-a", "actor-b"])).toEqual(runScenario(roles, ["actor-b", "actor-a"]));
    }
  });

  it("finds no emit budget shared by two receivers in id order, for every kind (#347 holds)", () => {
    // #347 gave every receiver its own exposure, so two receivers of one emitter take the
    // same outcome and renaming them changes nothing. Before #347 this probe found the
    // id-order sharing; it now guards against that sharing coming back (#393).
    for (const kinds of OPPOSED_PAIRS) for (const kind of kinds) {
      const roles = [{ x: 0, slot: null }, { x: 0, slot: null }, { x: 0, slot: { kind, expression: "emit", stacks: 1 } }];
      const [first, second] = runScenario(roles, ["actor-a", "actor-b", "actor-c"]);
      expect(second, kind).toEqual(first);
      expect(isOrderDependent(roles), kind).toBe(false);
    }
  });

  it("finds no order dependence with two actors for one pair, and reports every enumerated pair", () => {
    const report = measure({ pairs: [OPPOSED_PAIRS[0]], actorCounts: [2] });
    expect(report.totals.two).toEqual({ scenarios: 432, dependent: 0 });
    expect(Object.keys(report.pairs)).toEqual([OPPOSED_PAIRS[0].join("/")]);
    expect(OPPOSED_PAIRS.flat().sort()).toEqual(
      ["corrode", "dark", "decay", "earth", "fire", "fortify", "growth", "light", "water", "wind"]);
  });
});
