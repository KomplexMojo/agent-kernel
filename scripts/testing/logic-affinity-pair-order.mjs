/**
 * Measurement for #163 -- does ACTOR ID ORDER decide affinity field outcomes?
 *
 * One field pass (`resolveActorFields`) walks sources, tiles and targets in actor-id order:
 * the stronger of two equal same-kind fields on a tile goes to the lower id, and an emit's
 * finite per-turn budget is spent on targets in id order (#347). Nothing about the
 * affinities decides either. The repo's rule is to measure before adopting a rule, so this
 * enumerates small scenarios and counts how often RENAMING the actors changes the result.
 *
 * WHAT IS ENUMERATED, for every opposed pair (fire/water, earth/wind, growth/decay,
 * corrode/fortify, light/dark) -- every pair is enumerated alike, none is special:
 *   2 actors  each holds one slot from {kind A, kind B} x {emit, draw} x stacks {1,2,3},
 *             at distance 0, 1 or 2
 *   3 actors  each holds nothing or one slot from {A, B} x {emit, draw} x stacks {1,3},
 *             in four layouts (stacked, adjacent pair, line, spread)
 * Each scenario runs once per permutation of the ids. The outcome is every actor's
 * lifecycle and vitals after the pass, keyed by the actor's ROLE, not its id. A scenario is
 * order-dependent when two permutations disagree.
 *
 * THIS CHANGES NO BEHAVIOUR. It only reads core. Run: `node scripts/testing/logic-affinity-pair-order.mjs`
 * (add `--json` for the full report, including one example per order-dependent class).
 */
import { createActorRegistry } from "../../packages/core-ts/src/state/actor-registry.ts";
import { resolveActorFields } from "../../packages/core-ts/src/rules/actor-fields.ts";

export const OPPOSED_PAIRS = Object.freeze([
  ["fire", "water"], ["earth", "wind"], ["growth", "decay"], ["corrode", "fortify"], ["light", "dark"],
]);
const WIDTH = 5;
const TWO_ACTOR_DISTANCES = [0, 1, 2];
const THREE_ACTOR_LAYOUTS = Object.freeze({ stacked: [0, 0, 0], pair: [0, 0, 1], line: [0, 1, 2], spread: [0, 2, 4] });

function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
    .map(rest => [item, ...rest]));
}

function slotOptions(kinds, stacks, withNone) {
  const options = withNone ? [null] : [];
  for (const kind of kinds) for (const expression of ["emit", "draw"]) for (const s of stacks) {
    options.push({ kind, expression, stacks: s });
  }
  return options;
}

function product(lists) {
  return lists.reduce((acc, list) => acc.flatMap(prefix => list.map(item => [...prefix, item])), [[]]);
}

function makeActor(id, x, slot) {
  const vital = () => ({ current: 5, max: 10, regen: 0 });
  return {
    id, alignment: "dungeon", lifecycle: "alive", position: { x, y: 0 }, defeatVital: "health",
    vitals: { health: vital(), mana: vital(), durability: vital(), stamina: vital() },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: false, blocksSight: false },
    motivations: [], affinities: slot ? [{ ...slot }] : [],
    activeAffinityKey: slot ? `${slot.kind}:${slot.expression}` : null, holdings: [],
  };
}

/** Outcome of one pass with role i named ids[i], keyed back by role. */
export function runScenario(roles, ids) {
  const actors = roles.map((role, index) => makeActor(ids[index], role.x, role.slot));
  const registry = createActorRegistry({ dimensions: { width: WIDTH, height: 1 }, terrain: Array(WIDTH).fill("floor"), actors });
  resolveActorFields(registry);
  return roles.map((_, index) => {
    const actor = registry.getActor(ids[index]);
    const vitals = Object.fromEntries(Object.entries(actor.vitals).map(([name, v]) => [name, Math.round(v.current * 1000) / 1000]));
    return { lifecycle: actor.lifecycle, vitals };
  });
}

/** True when some renaming of the actors changes any role's outcome. */
export function isOrderDependent(roles) {
  const ids = roles.map((_, index) => `actor-${String.fromCharCode(97 + index)}`);
  const outcomes = permutations(ids).map(perm => JSON.stringify(runScenario(roles, perm)));
  return new Set(outcomes).size > 1;
}

function describe(roles) {
  return roles.map(role => `${role.slot ? `${role.slot.kind}:${role.slot.expression}:${role.slot.stacks}` : "none"}@${role.x}`).join(" ");
}

/**
 * A label for the shape of a dependent scenario, not proof of its cause: two equal
 * same-kind emits can tie for "stronger field"; anything else is an emit budget shared
 * by several receivers (#347) or a capped vital met in a different order.
 */
function classify(roles) {
  const emits = roles.filter(role => role.slot?.expression === "emit");
  const equalSameKind = emits.some((a, i) => emits.some((b, j) => j > i
    && a.slot.kind === b.slot.kind && a.slot.stacks === b.slot.stacks));
  return equalSameKind ? "equal same-kind emits" : "shared emit budget or capped vital";
}

export function measure({ pairs = OPPOSED_PAIRS, actorCounts = [2, 3] } = {}) {
  const report = { pairs: {}, totals: { two: { scenarios: 0, dependent: 0 }, three: { scenarios: 0, dependent: 0 } }, classes: {} };
  for (const kinds of pairs) {
    const key = kinds.join("/");
    const entry = { two: { scenarios: 0, dependent: 0 }, three: { scenarios: 0, dependent: 0 } };
    const tally = (bucket, roles) => {
      const dependent = isOrderDependent(roles);
      entry[bucket].scenarios++; report.totals[bucket].scenarios++;
      if (!dependent) return;
      entry[bucket].dependent++; report.totals[bucket].dependent++;
      const cls = classify(roles);
      report.classes[cls] ??= { count: 0, example: describe(roles) };
      report.classes[cls].count++;
    };
    const two = actorCounts.includes(2) ? slotOptions(kinds, [1, 2, 3], false) : [];
    for (const [first, second] of product([two, two])) for (const distance of TWO_ACTOR_DISTANCES) {
      tally("two", [{ x: 0, slot: first }, { x: distance, slot: second }]);
    }
    const three = actorCounts.includes(3) ? slotOptions(kinds, [1, 3], true) : [];
    for (const slots of product([three, three, three])) {
      if (!slots.some(Boolean)) continue;
      for (const layout of Object.values(THREE_ACTOR_LAYOUTS)) {
        tally("three", slots.map((slot, index) => ({ x: layout[index], slot })));
      }
    }
    report.pairs[key] = entry;
  }
  return report;
}

const rate = ({ scenarios, dependent }) => `${dependent}/${scenarios} (${scenarios ? (100 * dependent / scenarios).toFixed(1) : "0.0"}%)`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = measure();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("affinity field outcomes that change when actors are renamed (#163)");
    for (const [pair, entry] of Object.entries(report.pairs)) {
      console.log(`  ${pair.padEnd(16)} 2 actors ${rate(entry.two).padEnd(18)} 3 actors ${rate(entry.three)}`);
    }
    console.log(`  ${"all pairs".padEnd(16)} 2 actors ${rate(report.totals.two).padEnd(18)} 3 actors ${rate(report.totals.three)}`);
    for (const [cls, { count, example }] of Object.entries(report.classes)) console.log(`  ${cls}: ${count}, e.g. ${example}`);
  }
}
