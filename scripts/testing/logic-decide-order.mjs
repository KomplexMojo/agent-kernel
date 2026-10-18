/**
 * Measurement for #164 -- does DECIDE order (the initialState.actors array order) decide
 * outcomes?
 *
 * The Moderator rules resolution order, but the runner still asks actors to propose in
 * initialState.actors order, and each actor sees `reservedTargets`: tiles claimed by actors
 * that decided EARLIER in the same tick. Whoever decides first gets a contested tile before
 * resolution order is consulted.
 *
 * FIRST FINDING: the array order is no longer the build's order. The Configurator's
 * `buildInitialStateArtifact` normalizes the roster sorted by id, so the decide order is
 * the ID order, and reordering the authored array changes nothing (`arrayOrder` below
 * stays at 0). The measurement therefore RENAMES the actors (every permutation of the ids
 * over the same roles) and keys outcomes by role. Renaming also moves any id tie-break
 * downstream of deciding, so this is an upper bound on what decide order alone decides.
 *
 * WHAT IS ENUMERATED, on a 5x3 room with one exit (the boards are data, not rules):
 *   2 actors  every pair of start cells x every pair of motivations from
 *             {exploring, patrolling, attacking} x {delver+delver, delver+warden}
 *   3 actors  every triple of start cells x every motivation triple from
 *             {exploring, patrolling, attacking}; one warden, two delvers
 * Each runs TICKS ticks with a fixed seed. The outcome, keyed by role, is every accepted
 * action plus each actor's final position, lifecycle and vitals. A scenario is
 * order-dependent when two namings disagree.
 *
 * SINCE #164 the Moderator orders deciders by the previous tick's intent class, then id.
 * The contested cases measured here are mostly equal intents (two delvers making exit
 * progress), so they still fall to the id tie-break and the rates did not move.
 *
 * THIS CHANGES NO BEHAVIOUR. Run: `node scripts/testing/logic-decide-order.mjs`
 * (`--json` for the full report).
 */
import { createRuntime } from "../../packages/runtime/src/runner/runtime.js";
import { createCore } from "../../packages/core-ts/src/index.ts";
import { createConfiguratorPersona } from "../../packages/runtime/src/personas/configurator/controller.js";

const CLOCK = "2026-10-18T00:00:00.000Z";
const WIDTH = 7;
const HEIGHT = 5;
const EXIT = { x: 5, y: 2 };
export const TICKS = 4;
export const START_CELLS = Object.freeze([
  { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 2 }, { x: 3, y: 2 },
]);
// `random` is left out on purpose: its draws are a pure function of (seed, actorId, tick),
// so renaming an actor re-seeds it and every random scenario "changes" (210/210 when it was
// included) for a reason that has nothing to do with decide order.
export const TWO_ACTOR_MOTIVATIONS = Object.freeze(["exploring", "patrolling", "attacking"]);
export const THREE_ACTOR_MOTIVATIONS = Object.freeze(["exploring", "patrolling", "attacking"]);

function terrain() {
  const cells = Array(WIDTH * HEIGHT).fill("floor");
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    if (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1) cells[y * WIDTH + x] = "wall";
  }
  cells[EXIT.y * WIDTH + EXIT.x] = "exit";
  return cells;
}

function buildArtifacts(actors) {
  const configurator = createConfiguratorPersona({ clock: () => CLOCK });
  const cells = terrain();
  const simConfig = configurator.buildSimConfigArtifact({
    meta: { id: "decide_order_sim", runId: "decide_order", createdAt: CLOCK, producedBy: "test" },
    planRef: { id: "plan", schema: "agent-kernel/PlanArtifact", schemaVersion: 1 },
    layout: { width: WIDTH, height: HEIGHT, terrain: cells, exitApproach: { ...EXIT } },
    movementStamina: Object.fromEntries(actors.map(actor => [actor.id, 0])),
  });
  const initialState = configurator.buildInitialStateArtifact({
    meta: { id: "decide_order_state", runId: "decide_order", createdAt: CLOCK, producedBy: "test" },
    simConfigRef: { id: simConfig.meta.id, schema: simConfig.schema, schemaVersion: 1 },
    dimensions: { width: WIDTH, height: HEIGHT },
    terrain: cells,
    actors,
  });
  return { simConfig, initialState };
}

/**
 * Outcome of one run with role i named ids[i] (default: each role's own id), keyed by role.
 * `order` lists role indices in the order the roster is authored.
 */
export async function runScenario(roles, { ids = roles.map(role => role.id), order = roles.map((_, i) => i),
  ticks = TICKS, seed = 0 } = {}) {
  const actors = order.map(index => ({ ...structuredClone(roles[index]), id: ids[index] }));
  const { simConfig, initialState } = buildArtifacts(actors);
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed, simConfig, initialState });
  for (let t = 0; t < ticks; t += 1) await runtime.step();
  const actions = {};
  for (const frame of runtime.getTickFrames()) {
    for (const action of frame.acceptedActions || []) {
      (actions[action.actorId] ??= []).push(`${frame.tick}:${action.kind}:${JSON.stringify(action.params ?? {})}`);
    }
  }
  const final = new Map(runtime.getActorSnapshot().actors.map(actor => [actor.id,
    { position: actor.position, lifecycle: actor.lifecycle, vitals: actor.vitals }]));
  return roles.map((_, index) => ({ actions: actions[ids[index]] ?? [], ...final.get(ids[index]) }));
}

function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
    .map(rest => [item, ...rest]));
}

function combinations(items, size) {
  if (size === 0) return [[]];
  return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map(rest => [item, ...rest]));
}

function product(lists) {
  return lists.reduce((acc, list) => acc.flatMap(prefix => list.map(item => [...prefix, item])), [[]]);
}

/** True when some renaming of the actors changes any role's outcome. */
export async function isOrderDependent(roles, options) {
  const outcomes = new Set();
  for (const ids of permutations(roles.map((_, i) => `actor_${String.fromCharCode(97 + i)}`))) {
    outcomes.add(JSON.stringify(await runScenario(roles, { ...options, ids })));
  }
  return outcomes.size > 1;
}

/** True when authoring the roster in a different array order (same ids) changes any outcome. */
export async function isArrayOrderDependent(roles, options) {
  const outcomes = new Set();
  for (const order of permutations(roles.map((_, i) => i))) {
    outcomes.add(JSON.stringify(await runScenario(roles, { ...options, order })));
  }
  return outcomes.size > 1;
}

function actor(id, category, position, motivation) {
  return { id, category, position: { ...position }, motivations: [motivation], vitals: { health: { current: 6, max: 6, regen: 0 } } };
}

export function twoActorScenarios() {
  const out = [];
  for (const [a, b] of combinations(START_CELLS, 2)) {
    for (const [ma, mb] of product([TWO_ACTOR_MOTIVATIONS, TWO_ACTOR_MOTIVATIONS])) {
      out.push([actor("delver_1", "delver", a, ma), actor("delver_2", "delver", b, mb)]);
      out.push([actor("delver_1", "delver", a, ma), actor("warden_1", "warden", b, mb)]);
    }
  }
  return out;
}

export function threeActorScenarios() {
  const out = [];
  for (const [a, b, c] of combinations(START_CELLS, 3)) {
    for (const [ma, mb, mc] of product([THREE_ACTOR_MOTIVATIONS, THREE_ACTOR_MOTIVATIONS, THREE_ACTOR_MOTIVATIONS])) {
      out.push([actor("delver_1", "delver", a, ma), actor("delver_2", "delver", b, mb), actor("warden_1", "warden", c, mc)]);
    }
  }
  return out;
}

function describe(actors) {
  return actors.map(a => `${a.id}:${a.motivations[0]}@${a.position.x},${a.position.y}`).join(" ");
}

export async function measure({ two = twoActorScenarios(), three = threeActorScenarios() } = {}) {
  const report = { two: { scenarios: 0, dependent: 0, byMotivation: {} }, three: { scenarios: 0, dependent: 0, byMotivation: {} },
    arrayOrder: { scenarios: 0, dependent: 0 }, examples: [] };
  for (const [bucket, scenarios] of [["two", two], ["three", three]]) {
    for (const actors of scenarios) {
      report.arrayOrder.scenarios += 1;
      if (await isArrayOrderDependent(actors)) report.arrayOrder.dependent += 1;
      const dependent = await isOrderDependent(actors);
      const entry = report[bucket];
      entry.scenarios += 1;
      for (const motivation of new Set(actors.map(a => a.motivations[0]))) {
        const m = entry.byMotivation[motivation] ??= { scenarios: 0, dependent: 0 };
        m.scenarios += 1;
        if (dependent) m.dependent += 1;
      }
      if (!dependent) continue;
      entry.dependent += 1;
      if (report.examples.length < 3) report.examples.push(describe(actors));
    }
  }
  return report;
}

const rate = ({ scenarios, dependent }) => `${dependent}/${scenarios} (${scenarios ? (100 * dependent / scenarios).toFixed(1) : "0.0"}%)`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await measure();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`outcomes that change when the actors are renamed (decide order: last tick's intent, then id) (#164), ${TICKS} ticks`);
    console.log(`  authored array order alone: ${rate(report.arrayOrder)}`);
    for (const bucket of ["two", "three"]) {
      console.log(`  ${bucket === "two" ? "2" : "3"} actors: ${rate(report[bucket])}`);
      for (const [motivation, entry] of Object.entries(report[bucket].byMotivation)) {
        console.log(`    with ${motivation.padEnd(12)} ${rate(entry)}`);
      }
    }
    for (const example of report.examples) console.log(`  e.g. ${example}`);
  }
}
