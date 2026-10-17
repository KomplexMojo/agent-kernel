import { createRequire } from "node:module";
import { resolve } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { cancelAffinityOverlap, OPPOSITE_EXPOSURE_AMPLIFICATION, resolveExposureVitalDeltas } from "../../packages/core-ts/src/state/affinity-spatial.ts";
import { getOppositeAffinityKind, resolveAffinityRelationshipCode } from "../../packages/core-ts/src/state/affinity.ts";
import { AffinityExpression, AffinityKind, AffinityRelationship } from "../../packages/core-ts/src/state/affinity.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";
import { OVERWHELM_NET_INTENSITY, readActorOverwhelms } from "../../packages/core-ts/src/rules/actor-fields.ts";
import { actorAffinityMagnitude } from "../../packages/core-ts/src/rules/actor-affinity.ts";
import { createActorRegistry } from "../../packages/core-ts/src/state/actor-registry.ts";

// #305 — Z3 proofs that the opposed-pair rules hold for every pair and ANY intensity.
// Since #340 cancellation and overwhelm compare intensity (range only sets reach), and a
// hit's strength is base × intensity². Samples cover small values; these quantify over
// all non-negative integers, which is what a sample cannot. Each formula restates core's
// integer arithmetic and is cross-checked against core on a grid of sampled values, so a
// proof is about the code, not about a paraphrase of it. A failed proof reports Z3's
// counterexample. Test-only: z3-solver is resolved through adapters-cli, which already
// depends on it; core and runtime gain no Z3 dependency, and play never runs Z3.
const requireFromCli = createRequire(resolve(import.meta.dirname, "../../packages/adapters-cli/package.json"));
const { init } = requireFromCli("z3-solver");

const PAIRS = [["fire", "water"], ["earth", "wind"], ["growth", "decay"], ["corrode", "fortify"], ["light", "dark"]];
const KIND_CODE = {
  fire: AffinityKind.Fire, water: AffinityKind.Water, earth: AffinityKind.Earth, wind: AffinityKind.Wind,
  growth: AffinityKind.Growth, decay: AffinityKind.Decay, corrode: AffinityKind.Corrode,
  fortify: AffinityKind.Fortify, light: AffinityKind.Light, dark: AffinityKind.Dark,
};

let ctx;
beforeAll(async () => {
  const { Context } = await init();
  ctx = new Context("affinity_rule_proofs");
}, 60_000);

/** Prove `claim` for all values of its free variables: its negation must be unsat. */
async function prove(claim, variables) {
  const solver = new ctx.Solver();
  solver.add(ctx.Not(claim));
  const verdict = await solver.check();
  if (verdict === "unsat") return { proved: true };
  if (verdict !== "sat") return { proved: false, counterexample: `z3 answered ${verdict}` };
  const model = solver.model();
  const counterexample = Object.entries(variables)
    .map(([name, variable]) => `${name}=${model.eval(variable, true).toString()}`)
    .join(", ");
  return { proved: false, counterexample };
}

async function expectProved(name, claim, variables) {
  const result = await prove(claim, variables);
  expect(result.proved, `${name} fails at ${result.counterexample}`).toBe(true);
}

/** Evaluate a formula at concrete values: the cross-check between encoding and core. */
async function evaluateAt(expression, assignments) {
  const solver = new ctx.Solver();
  for (const [variable, value] of assignments) {
    solver.add(variable.eq(Number.isInteger(value) ? value : ctx.Real.val(value)));
  }
  expect(await solver.check()).toBe("sat");
  const value = solver.model().eval(expression, true);
  if (typeof value.value !== "function") return Number(value.toString());
  const exact = value.value();
  return typeof exact === "bigint" ? Number(exact) : Number(exact.numerator) / Number(exact.denominator);
}

/** core's cancelAffinityOverlap, restated over Z3 integers (intensity, #340). */
function cancelFormula(sourceIntensity, targetIntensity) {
  const net = sourceIntensity.sub(targetIntensity);
  return {
    sourceIntensity: ctx.If(net.gt(0), net, ctx.Int.val(0)),
    targetIntensity: ctx.If(net.lt(0), net.neg(), ctx.Int.val(0)),
  };
}

function cancelVariables() {
  const m = ctx.Int.const("source_intensity");
  const n = ctx.Int.const("target_intensity");
  const domain = ctx.And(m.ge(0), n.ge(0));
  return { m, n, domain, variables: { m, n } };
}

test("the cancellation encoding matches core on sampled intensities", async () => {
  const { m, n } = cancelVariables();
  const formula = cancelFormula(m, n);
  for (const [sm, tn] of [[3, 1], [1, 3], [2, 2], [5, 0], [0, 4], [7, 4]]) {
    const core = cancelAffinityOverlap(sm, tn);
    const at = [[m, sm], [n, tn]];
    for (const key of ["sourceIntensity", "targetIntensity"]) {
      expect(await evaluateAt(formula[key], at), `${key} at m=${sm} n=${tn}`).toBe(core[key]);
    }
  }
}, 60_000);

test("cancellation is symmetric: swapping the sides swaps the outcome, for any intensity", async () => {
  const { m, n, domain, variables } = cancelVariables();
  const forward = cancelFormula(m, n);
  const swapped = cancelFormula(n, m);
  await expectProved("symmetry", ctx.Implies(domain, ctx.And(
    forward.sourceIntensity.eq(swapped.targetIntensity),
    forward.targetIntensity.eq(swapped.sourceIntensity),
  )), variables);
}, 60_000);

test("cancellation never goes negative, never strengthens a side, and at most one side survives", async () => {
  const { m, n, domain, variables } = cancelVariables();
  const out = cancelFormula(m, n);
  await expectProved("non-negative", ctx.Implies(domain, ctx.And(
    out.sourceIntensity.ge(0), out.targetIntensity.ge(0),
  )), variables);
  await expectProved("never stronger than it arrived", ctx.Implies(domain, ctx.And(
    out.sourceIntensity.le(m), out.targetIntensity.le(n),
  )), variables);
  await expectProved("one survivor, by the intensity difference", ctx.Implies(domain, ctx.And(
    ctx.Or(out.sourceIntensity.eq(0), out.targetIntensity.eq(0)),
    out.sourceIntensity.add(out.targetIntensity).eq(ctx.If(m.ge(n), m.sub(n), n.sub(m))),
  )), variables);
  await expectProved("equal intensity cancels to nothing", ctx.Implies(ctx.And(domain, m.eq(n)), ctx.And(
    out.sourceIntensity.eq(0), out.targetIntensity.eq(0),
  )), variables);
}, 60_000);

// Overwhelm (#289): kind beats its opposite on a tile by OVERWHELM_NET_INTENSITY or more.
const overwhelms = (intensity, oppositeIntensity) => intensity.sub(oppositeIntensity).ge(OVERWHELM_NET_INTENSITY);

function overwhelmRegistry(kind, intensity, opposite, oppositeIntensity) {
  const actor = (id, x, pair) => ({
    id, alignment: "dungeon", lifecycle: "alive", position: { x, y: 0 }, defeatVital: "health",
    vitals: Object.fromEntries(["health", "mana", "stamina", "durability"].map((key) => [key, { current: 5, max: 10, regen: 1 }])),
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true, blocksMovement: false, blocksSight: false },
    motivations: [], affinities: pair ? [pair] : [], activeAffinityKey: pair ? `${pair.kind}:${pair.expression}` : null, holdings: [],
  });
  // Range 1 throughout: only intensity decides overwhelm.
  const emit = (k, i) => (i > 0 ? { kind: k, expression: "emit", stacks: 1, intensity: i } : undefined);
  return createActorRegistry({
    dimensions: { width: 5, height: 1 },
    terrain: Array(5).fill("floor"),
    actors: [actor("trap", 1, emit(kind, intensity)), actor("hero", 2, emit(opposite, oppositeIntensity))],
  });
}

test("the overwhelm encoding matches core for every kind of every pair, on both sides of the threshold", async () => {
  const x = ctx.Int.const("intensity");
  const y = ctx.Int.const("opposite_intensity");
  for (const pair of PAIRS) {
    for (const [kind, opposite] of [pair, [...pair].reverse()]) {
      for (const [sx, sy] of [[1, 0], [2, 0], [3, 1], [3, 2], [4, 1], [5, 3]]) {
        const core = readActorOverwhelms(overwhelmRegistry(kind, sx, opposite, sy))
          .some((entry) => entry.actorId === "hero" && entry.kind === kind);
        expect(await evaluateAt(ctx.If(overwhelms(x, y), ctx.Int.val(1), ctx.Int.val(0)), [[x, sx], [y, sy]]),
          `${kind} x${sx} vs ${opposite} x${sy}`).toBe(core ? 1 : 0);
      }
    }
  }
}, 60_000);

test("overwhelm is one threshold for every kind: never mutual, and it always leaves its side surviving cancellation", async () => {
  const x = ctx.Int.const("intensity");
  const y = ctx.Int.const("opposite_intensity");
  const domain = ctx.And(x.ge(0), y.ge(0));
  await expectProved("never mutual", ctx.Implies(domain, ctx.Not(ctx.And(overwhelms(x, y), overwhelms(y, x)))), { x, y });
  const out = cancelFormula(x, y);
  await expectProved("overwhelm implies the cancellation survivor has the threshold's intensity", ctx.Implies(
    ctx.And(domain, overwhelms(x, y)),
    ctx.And(out.sourceIntensity.ge(OVERWHELM_NET_INTENSITY), out.targetIntensity.eq(0)),
  ), { x, y });
}, 60_000);

test("every kind has exactly one opposite, both ways, and the pairs are the five opposed pairs", () => {
  const kinds = Object.values(KIND_CODE);
  for (const kind of kinds) {
    const opposite = getOppositeAffinityKind(kind);
    expect(opposite).not.toBe(kind);
    expect(getOppositeAffinityKind(opposite)).toBe(kind);
    expect(resolveAffinityRelationshipCode(kind, opposite)).toBe(AffinityRelationship.Opposite);
    expect(resolveAffinityRelationshipCode(opposite, kind)).toBe(AffinityRelationship.Opposite);
  }
  for (const [a, b] of PAIRS) expect(getOppositeAffinityKind(KIND_CODE[a])).toBe(KIND_CODE[b]);
});

test("opposite exposure is the same rule for every pair: harm is amplified, never turned into benefit, for any base", async () => {
  const base = ctx.Int.const("base_effect");
  const formula = ctx.If(base.lt(0), base.mul(OPPOSITE_EXPOSURE_AMPLIFICATION), base);
  const expressions = [AffinityExpression.Push, AffinityExpression.Pull, AffinityExpression.Emit, AffinityExpression.Draw];
  for (const pair of PAIRS) {
    for (const [field, observer] of [pair, [...pair].reverse()]) {
      for (const fieldExpression of expressions) {
        for (const observerExpression of expressions) {
          for (const sample of [-7, -1, 3]) {
            const [delta] = resolveExposureVitalDeltas({
              baseEffect: sample, vital: VitalKind.Health, fieldKind: KIND_CODE[field], fieldExpression,
              observerKind: KIND_CODE[observer], observerExpression,
            });
            expect(delta, `${field} on ${observer}`).toEqual({ vital: VitalKind.Health, effect: await evaluateAt(formula, [[base, sample]]) });
          }
        }
      }
    }
  }
  await expectProved("sign kept, harm never softened", ctx.And(
    ctx.Implies(base.lt(0), ctx.And(formula.lt(0), formula.le(base))),
    ctx.Implies(base.ge(0), formula.eq(base)),
  ), { base });
}, 120_000);

test("a hit's strength is base × intensity²: matches core, and every point of intensity adds more than the last (#340)", async () => {
  const i = ctx.Int.const("intensity");
  for (const [expression, base] of [["push", 2], ["pull", 2], ["emit", 1], ["draw", 1]]) {
    const formula = ctx.Int.val(base).mul(i).mul(i);
    for (const sample of [0, 1, 2, 3, 6]) {
      expect(await evaluateAt(formula, [[i, sample]]), `${expression} at ${sample}`).toBe(actorAffinityMagnitude(expression, sample));
    }
    const next = ctx.Int.val(base).mul(i.add(1)).mul(i.add(1));
    const after = ctx.Int.val(base).mul(i.add(2)).mul(i.add(2));
    await expectProved(`${expression} grows quadratically`, ctx.Implies(i.ge(0),
      after.sub(next).gt(next.sub(formula))), { i });
  }
}, 60_000);

// ## TODO: Test Permutations
// - stack scaling (scaleAffinityVitalEffect): for any base and stacks >= 0, effect = base * stacks with base's sign.
// - overwhelm with the opposite reaching the tile from two sources: the strongest single source counts.
// - cancellation where falloffs differ wildly (emit tile reads 1, edge tile reads near 0): still decided by intensity.
