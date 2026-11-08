/**
 * AI T2 (#674) — the tactic benefit gate: does a horizon beat the one-step Actor on the
 * delver's own score, and does anything cheaper do as well?
 *
 * THE VERDICT RULE IS FIXED BEFORE ANY RUN (`TACTIC_BENEFIT_VERDICT`, below). A ledger that
 * cannot return "no" is advocacy: `actor_action_selection` was adopted without this question
 * and measured 0.0% divergence over 819 points afterwards (retired 2026-09-05).
 *
 * WHAT IS SCORED (Darren, 2026-11-02, #674 comments; `docs/design/actor-tactic-catalogue.json`
 * → `scoring`). Per run, reported separately and never collapsed:
 *   1. tokenValueAcquired  holdings the delver claimed, at the Allocator's price for that
 *                          resource (`calculateObjectCardUnitCost`, no second table)
 *   2. nonRenewable        points lost from vitals with regen 0, plus defeat itself
 *   3. vitalPressure       per vital: turns under 50% (warning) and 25% (action needed), the
 *                          options each line removes, and whether the actor changed what it
 *                          was doing within REACT_WINDOW turns of crossing 25%
 *   4. kills               warden and hazard defeats (supporting evidence only)
 *   5. turns               recorded only; 200 moves instead of 100 is fine
 * A run is beaten when another reaches the exit too and has (1) no lower and (2) no higher,
 * with one strictly better. Renewable spending is never charged.
 *
 * ONE WORLD FOR EVERYONE. Every mover here acts in core's own rules: `createActorRegistry`,
 * then `createActorTurn` → apply → closeActions → resolveFields → regenerate → resolveExits,
 * the sequence `runtime-fsm.mjs` runs each tick. Harm comes from real emitting hazards, takes
 * from core's claim rule, stamina from core's movement price, exit from core's two-tick dwell.
 * The earlier lookahead probe modelled harm with its own field list; the policy and oracle
 * then agreed with each other about a world the game does not have. Here a mover only
 * PROPOSES; core decides what happened.
 *
 *   policy    the real Actor persona, one persona for the whole run (its memory and strategy
 *             progress persist, as in a level), deciding from its scoped observation
 *   controls  the cheap alternatives the issue names, each one step deep:
 *               reorder   lexicographic [defeat, harm, token, exit distance]: the rank reorder
 *               weighted  harm × w against progress and token, one w for the whole domain
 *               strategy  the real Actor given a catalogue entry's `covers.strategy` data
 *   oracle    every action sequence within the horizon through the same core, kept as the
 *             Pareto frontier of (token ↑, nonRenewable ↓) over runs that exit
 *
 * PRECONDITIONS, run first (the two earlier driver bugs each produced confident fiction):
 *   - on the open board the policy exits (an invalid motivation or a missing exit reads as
 *     the Actor's myopia, not the harness's);
 *   - beside a resource, the take-goal strategy control claims it (a driver that cannot take
 *     would report every token gap as the Actor's).
 *
 * BOUNDS STATED, NOT HIDDEN. Hazards stay lit (no upkeep table), the delver casts nothing and
 * sees the whole of these small boards, so the probe tactic (#674's catalogue entry
 * `probe-before-entering-a-guarded-corridor`) is out of this domain: a full-information
 * oracle cannot value looking. Its verdict is `unmeasured`, which the rule reads as "no".
 */
import { createActorRegistry } from "../../packages/core-ts/src/state/actor-registry.ts";
import { createActorTurn } from "../../packages/core-ts/src/rules/actor-turn.ts";
import {
  readActorRegistryObservation,
  scopeActorRegistryObservation,
} from "../../packages/core-ts/src/rules/actor-observation.ts";
import { EXIT_DWELL_TICKS } from "../../packages/core-ts/src/rules/actor-exit.ts";

const FIXED_CLOCK = () => "2026-11-08T00:00:00.000Z";
export const DELVER_ID = "delver";
const MOVE_DELTAS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
];

/**
 * THE VERDICT RULE, written before the first run (#674: "write the verdict rule first").
 *
 * A point is a board whose oracle frontier is non-empty: some route exits alive in the horizon.
 * The policy's GAP is the points where the oracle beats it. A control CLOSES a gap point when
 * no frontier run beats the control there. The RESIDUAL is the gap no cheap control closes,
 * and only the residual argues for a horizon.
 *
 *   adopt   residual ≥ minResidualShare of points
 *   reject  otherwise; the reason names the control that closed most of the gap
 *
 * 10% is my default for "an agreed share" (the issue left it open; Darren can change it). The
 * 2026-09 probe's 9/45 (20%) would have passed it; its follow-up gate measured 3.4%, which
 * would not.
 */
export const TACTIC_BENEFIT_VERDICT = Object.freeze({
  minResidualShare: 0.10,
  rejectRepeatingUnder25: true,
});

/** Turns after crossing 25% within which the actor must change what it is doing. */
export const REACT_WINDOW = 3;
export const PRESSURE_LINES = Object.freeze({ warning: 0.5, actionNeeded: 0.25 });

export function judgeTacticBenefit({ points, gap, residual, closedBy = {} }, rule = TACTIC_BENEFIT_VERDICT) {
  if (points === 0) return { verdict: "unmeasured", reason: "no decision points: nothing for a horizon to win" };
  const share = residual / points;
  const best = Object.entries(closedBy).sort((a, b) => b[1] - a[1])[0] ?? null;
  if (share >= rule.minResidualShare) {
    return { verdict: "adopt", reason: `residual ${residual}/${points} (${pct(share)}) ≥ ${pct(rule.minResidualShare)}` };
  }
  const control = best && gap > 0 ? `; ${best[0]} closes ${best[1]}/${gap} of the policy gap` : "";
  return { verdict: "reject", reason: `residual ${residual}/${points} (${pct(share)}) < ${pct(rule.minResidualShare)}${control}` };
}

const pct = (value) => `${(100 * value).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

/** Run outcome A beats B: both exit alive, A no worse on token and nonRenewable, better on one. */
export function outcomeBeats(a, b) {
  if (!a.exited || a.defeated) return false;
  if (!b.exited || b.defeated) return true;
  const tokenNoWorse = a.tokenValueAcquired >= b.tokenValueAcquired;
  const useNoWorse = a.nonRenewableUse <= b.nonRenewableUse;
  return tokenNoWorse && useNoWorse
    && (a.tokenValueAcquired > b.tokenValueAcquired || a.nonRenewableUse < b.nonRenewableUse);
}

/** The frontier keeps only outcomes no other outcome beats. */
export function paretoInsert(frontier, outcome) {
  if (frontier.some((kept) => outcomeBeats(kept, outcome) || sameScore(kept, outcome))) return frontier;
  return [...frontier.filter((kept) => !outcomeBeats(outcome, kept)), outcome];
}

const sameScore = (a, b) => a.tokenValueAcquired === b.tokenValueAcquired && a.nonRenewableUse === b.nonRenewableUse;

/** Score one traced run: the five parts, never collapsed. */
export function scoreRun(trace, { tokenValueOf, optionsLost = {}, delverId = DELVER_ID }) {
  const { frames, final } = trace;
  const delver = final.actors.find((actor) => actor.id === delverId);
  const exited = delver.lifecycle === "exited";
  const defeated = delver.lifecycle === "defeated";

  let tokenValueAcquired = 0;
  for (const actor of final.actors) {
    for (const holding of actor.holdings ?? []) {
      if (holding.claimedBy === delverId) tokenValueAcquired += tokenValueOf(holding, actor);
    }
  }

  let nonRenewableUse = 0;
  for (const frame of frames) {
    for (const [vital, before] of Object.entries(frame.before)) {
      const after = frame.after[vital];
      if (!after || before.regen > 0) continue;
      nonRenewableUse += Math.max(0, before.current - after.current);
    }
  }

  const vitalPressure = Object.keys(frames[0]?.before ?? delver.vitals).map((vital) => {
    let turnsBelow50 = 0;
    let turnsBelow25 = 0;
    let crossedAt = null;
    frames.forEach((frame, index) => {
      const record = frame.after[vital];
      if (!record || record.max <= 0) return;
      const share = record.current / record.max;
      if (share < PRESSURE_LINES.warning) turnsBelow50 += 1;
      if (share < PRESSURE_LINES.actionNeeded) {
        turnsBelow25 += 1;
        if (crossedAt === null) crossedAt = index;
      }
    });
    const reaction = crossedAt === null ? null : reactionAfter(frames, crossedAt);
    return {
      vital,
      renewable: (frames[0]?.before[vital]?.regen ?? 0) > 0,
      turnsBelow50,
      turnsBelow25,
      optionsLost: { warning: turnsBelow50 > 0 ? optionsLost[vital] ?? [] : [], actionNeeded: turnsBelow25 > 0 ? optionsLost[vital] ?? [] : [] },
      reactedAt25: reaction?.reacted ?? null,
      repeatedUnder25: reaction?.repeated ?? false,
    };
  });

  const kills = { warden: 0, hazard: 0 };
  for (const actor of final.actors) {
    const role = trace.roles?.[actor.id];
    if ((role === "warden" || role === "hazard") && actor.lifecycle === "defeated") kills[role] += 1;
  }

  return { exited, defeated, tokenValueAcquired, nonRenewableUse,
    vitalPressure, kills, turns: frames.length };
}

/**
 * Whether the actor changed what it was doing within REACT_WINDOW turns of crossing 25%.
 * `null` when the run ended inside the window by exiting (nothing left to react to).
 */
function reactionAfter(frames, crossedAt) {
  const at = frames[crossedAt]?.signature;
  const window = frames.slice(crossedAt + 1, crossedAt + 1 + REACT_WINDOW);
  if (window.length === 0) return null;
  const reacted = window.some((frame) => frame.signature !== at);
  return { reacted, repeated: !reacted && window.length === REACT_WINDOW };
}

/** What a turn did, coarse enough that "the same action again" is a direction, not a tile. */
function actionSignature(action, from) {
  if (!action) return "none";
  if (action.kind === "move" && action.params?.target && from) {
    return `move:${Math.sign(action.params.target.x - from.x)},${Math.sign(action.params.target.y - from.y)}`;
  }
  return action.kind;
}

// ---------------------------------------------------------------------------
// The world: core, one tick at a time
// ---------------------------------------------------------------------------

const capabilities = (overrides) => ({ canMove: false, canCast: false, canEquip: false, canTake: false,
  canExit: false, blocksMovement: false, blocksSight: false, ...overrides });

/**
 * One board as core actors. The delver's health has regen 0, so harm is non-renewable here;
 * stamina regenerates, so movement is free and only its pressure lines are scored.
 */
export function buildWorld({ width, height, walls = [], start, exit, hazards = [], resources = [], delver = {} }) {
  const blocked = new Set(walls.map(({ x, y }) => `${x},${y}`));
  const terrain = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      terrain.push(edge || blocked.has(`${x},${y}`) ? "wall" : x === exit.x && y === exit.y ? "exit" : "floor");
    }
  }
  const roles = { [DELVER_ID]: "delver" };
  const actors = [{
    id: DELVER_ID, alignment: "external", lifecycle: "alive", position: { ...start }, defeatVital: "health",
    vitals: {
      health: { current: delver.health ?? 20, max: delver.health ?? 20, regen: 0 },
      mana: { current: 0, max: 0, regen: 0 },
      stamina: { current: delver.stamina ?? 6, max: delver.stamina ?? 6, regen: delver.staminaRegen ?? 1 },
    },
    capabilities: capabilities({ canMove: true, canTake: true, canExit: true }),
    motivations: delver.motivations ?? ["exploring"], affinities: [], activeAffinityKey: null, holdings: [],
  }];
  hazards.forEach((hazard, index) => {
    const id = `hazard_${index + 1}`;
    roles[id] = "hazard";
    const pair = { kind: hazard.kind ?? "fire", expression: "emit", stacks: hazard.range ?? 1, intensity: hazard.intensity ?? 3 };
    actors.push({ id, alignment: "dungeon", lifecycle: "alive", position: { ...hazard.position }, defeatVital: "durability",
      vitals: { durability: { current: 5, max: 5, regen: 0 }, mana: { current: 10, max: 10, regen: 10 } },
      capabilities: capabilities({ canCast: true }), motivations: ["stationary"],
      affinities: [pair], activeAffinityKey: `${pair.kind}:${pair.expression}`, holdings: [] });
  });
  resources.forEach((resource, index) => {
    const id = `resource_${index + 1}`;
    roles[id] = "resource";
    actors.push({ id, alignment: "dungeon", lifecycle: "alive", position: { ...resource.position }, defeatVital: "durability",
      vitals: { durability: { current: resource.durability ?? 1, max: resource.durability ?? 1, regen: 0 } },
      capabilities: capabilities({}), motivations: ["stationary"], affinities: [], activeAffinityKey: null,
      holdings: [{ id: `${id}_mana`, kind: "vital", claimedBy: null, permanenceMode: "permanent",
        vitals: [{ key: "mana", delta: resource.mana ?? 3 }] }] });
  });
  const snapshot = createActorRegistry({ dimensions: { width, height }, terrain, actors }).snapshot();
  const simConfig = { layout: { kind: "grid", data: { width, height, terrain } } };
  return { snapshot, simConfig, roles, exit: { ...exit },
    costs: { castManaBase: {}, movementStamina: { [DELVER_ID]: delver.moveStamina ?? 1 } } };
}

const vitalsOf = (snapshot) => structuredClone(snapshot.actors.find((actor) => actor.id === DELVER_ID).vitals);

/** One core tick from a snapshot with the delver's one action; nothing else acts. */
export function stepWorld(world, snapshot, tick, action) {
  const registry = createActorRegistry(snapshot);
  const turn = createActorTurn(registry, tick, world.costs);
  const accepted = action ? turn.apply({ ...action, actorId: DELVER_ID, tick }) : false;
  turn.closeActions();
  turn.resolveFields();
  turn.regenerate();
  turn.resolveExits();
  return { snapshot: registry.snapshot(), accepted, rejection: accepted ? null : turn.lastRejection() };
}

/**
 * Every action the delver could propose; core refuses the ones it cannot do. Two kinds are
 * skipped before asking core because core refuses them by a static rule (a wall cell, a take
 * from beyond the adjacent ring), which halves the oracle's work and changes no answer.
 */
export function candidateActions(world, snapshot) {
  const self = snapshot.actors.find((actor) => actor.id === DELVER_ID);
  const { width, height, terrain } = world.simConfig.layout.data;
  const actions = [{ kind: "wait" }];
  for (const { dx, dy } of MOVE_DELTAS) {
    const x = self.position.x + dx;
    const y = self.position.y + dy;
    if (x < 0 || y < 0 || x >= width || y >= height || terrain[(y * width) + x] === "wall") continue;
    actions.push({ kind: "move", params: { target: { x, y } } });
  }
  for (const source of snapshot.actors) {
    if (source.id === DELVER_ID || cheb(source.position, self.position) > 1) continue;
    for (const holding of source.holdings ?? []) {
      if (holding.claimedBy === null) actions.push({ kind: "take", params: { targetId: source.id, holdingId: holding.id } });
    }
  }
  return actions;
}

const samePlace = (a, b) => a.x === b.x && a.y === b.y;
const delverOf = (snapshot) => snapshot.actors.find((actor) => actor.id === DELVER_ID);
const alive = (snapshot) => delverOf(snapshot).lifecycle === "alive";

/** Run any chooser through core for up to `horizon` ticks and trace it. */
async function traceRun(world, horizon, choose) {
  let snapshot = world.snapshot;
  const frames = [];
  for (let tick = 0; tick < horizon && alive(snapshot); tick += 1) {
    const action = await choose(snapshot, tick);
    const from = delverOf(snapshot).position;
    const before = vitalsOf(snapshot);
    const result = stepWorld(world, snapshot, tick, action);
    snapshot = result.snapshot;
    frames.push({ tick, action, accepted: result.accepted, signature: actionSignature(action, from),
      before, after: vitalsOf(snapshot), position: { ...delverOf(snapshot).position } });
  }
  return { frames, final: snapshot, roles: world.roles };
}

// ---------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------

/**
 * The real Actor persona, one persona per run. `strategy` is catalogue data or none.
 *
 * `sight: "full"` (the default here) hands it the whole board; `"seen"` hands it core's scoped
 * observation, as the runtime does. The verdict compares on full sight because a tactic solver
 * may use only what the actor observes (the seat rule), so it cannot close a gap that fog made:
 * the oracle sees everything, and comparing it with a fogged policy would credit the horizon
 * with the value of information. The seen run is still taken and its shortfall reported as the
 * information gap, which is the probe tactic's question and not this gate's.
 *
 * ⚠️ THE SHIPPED POLICY IS THE DETERMINISTIC PATH. Nothing in the runtime, the build or the CLI
 * sets `runtimeDecisioning`, so in a level the Actor ranks only its motivations' own proposals,
 * and an `exploring` delver proposes one step along its route: field safety has nothing to
 * choose between. The solver request path expands the candidates (every step, and a wait) and
 * ranks them with the same objective. The 2026-09 lookahead probe drove THAT path and read the
 * winner off the rows, so its 19/45 and the `actor_lookahead` gate measure an Actor the game
 * does not run. `expand: true` reproduces that path here as a control — "expand the candidates,
 * keep the order" — which is the cheapest fix there is.
 */
export async function runActorPolicy(world, { horizon, strategy = null, sight = "full", expand = false }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../packages/runtime/src/personas/actor/controller.js"),
    import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: FIXED_CLOCK });
  const initialState = {
    ...(strategy ? { strategies: { [DELVER_ID]: strategy } } : {}),
    ...(expand ? { actors: [{ id: DELVER_ID, runtimeDecisioning: true }] } : {}),
  };
  const solver = expand ? { runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" } } : {};
  return traceRun(world, horizon, (snapshot, tick) => {
    const registry = createActorRegistry(snapshot);
    const full = readActorRegistryObservation(registry, tick);
    const observation = sight === "seen" ? scopeActorRegistryObservation(full, DELVER_ID) : full;
    const payload = { actorId: DELVER_ID, observation, simConfig: world.simConfig, tick,
      ...(Object.keys(initialState).length > 0 ? { initialState } : {}), ...solver };
    persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
    persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
    const proposed = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
    persona.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
    // The expanded rows do not model core's two-tick exit dwell (they rank a wait on the exit
    // below a step off it), so the control holds the exit once there. Generous to the control.
    const onExit = expand && samePlace(delverOf(snapshot).position, world.exit);
    const action = onExit ? { kind: "wait" } : expand ? bestExpandedCandidate(proposed) : proposed?.actions?.[0];
    return action ? { kind: action.kind, ...(action.params ? { params: action.params } : {}) } : null;
  });
}

/** The solver request's best row by the objective's own order; input order breaks ties. */
function bestExpandedCandidate(proposed) {
  const data = proposed?.effects?.find((effect) => effect?.kind === "solver_request")?.request?.problem?.data;
  const rows = data?.objectives?.actorDecision?.candidates;
  if (!Array.isArray(rows) || rows.length === 0) return proposed?.actions?.[0] ?? null;
  let best = rows[0];
  for (const row of rows.slice(1)) {
    const slot = row.rank.findIndex((value, index) => value !== best.rank[index]);
    if (slot >= 0 && row.rank[slot] > best.rank[slot]) best = row;
  }
  return data.candidateActions.find((candidate) => candidate.id === best.candidateActionId)?.action ?? null;
}

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The one-tick consequence of each candidate, through core. */
function lookOneTick(world, snapshot, tick, tokenValueOf) {
  const before = vitalsOf(snapshot);
  const tokenBefore = claimedValue(snapshot, tokenValueOf);
  return candidateActions(world, snapshot).flatMap((action) => {
    const result = stepWorld(world, snapshot, tick, action);
    if (!result.accepted) return [];
    const after = vitalsOf(result.snapshot);
    let harm = 0;
    for (const [vital, record] of Object.entries(before)) {
      if (record.regen === 0 && after[vital]) harm += Math.max(0, record.current - after[vital].current);
    }
    const self = delverOf(result.snapshot);
    return [{ action, harm, defeated: self.lifecycle === "defeated", exited: self.lifecycle === "exited",
      token: claimedValue(result.snapshot, tokenValueOf) - tokenBefore, position: { ...self.position },
      distance: self.lifecycle === "exited" ? -1 : cheb(self.position, world.exit) }];
  });
}

function claimedValue(snapshot, tokenValueOf) {
  let total = 0;
  for (const actor of snapshot.actors) {
    for (const holding of actor.holdings ?? []) if (holding.claimedBy === DELVER_ID) total += tokenValueOf(holding, actor);
  }
  return total;
}

/**
 * One step of memory for the controls: on a tie, the cell visited fewest times wins. A one-step
 * chooser with no memory stalls or two-cycles between equal cells (the #162 livelock shape), and
 * a gap that one step of memory closes is not evidence for a horizon. Generous to the control.
 */
function createVisits() {
  const visits = new Map();
  return {
    note(position) { visits.set(`${position.x},${position.y}`, (visits.get(`${position.x},${position.y}`) ?? 0) + 1); },
    of(position) { return visits.get(`${position.x},${position.y}`) ?? 0; },
  };
}

/** Control: the rank reorder, safety above progress, one step deep. */
export function runReorderControl(world, { horizon, tokenValueOf }) {
  const visits = createVisits();
  return traceRun(world, horizon, (snapshot, tick) => {
    visits.note(delverOf(snapshot).position);
    const options = lookOneTick(world, snapshot, tick, tokenValueOf);
    options.sort((a, b) => (a.defeated - b.defeated) || (a.harm - b.harm) || (b.token - a.token) || (a.distance - b.distance)
      || (visits.of(a.position) - visits.of(b.position)));
    return options[0]?.action ?? null;
  });
}

/**
 * Control: one scalar, harm × weight against one step of progress and token value at
 * `tokenPerStep` tokens per step. The best single weight over the domain is reported, which
 * favours the control: the conservative direction for a gate that must be able to say no.
 *
 * `goals: true` is the composite the catalogue's two cheap answers make together: the take
 * goal's ORDER (strategy.js data: the nearest unclaimed resource, then the exit) stepped by
 * this weighted rank instead of strategy.js's field-blind `stepToward`. Still one step deep,
 * so if it closes the gap, the fix is data plus a rank change and no horizon is needed.
 */
export function runWeightedControl(world, { horizon, tokenValueOf, weight, tokenPerStep = 10, goals = false }) {
  const visits = createVisits();
  return traceRun(world, horizon, (snapshot, tick) => {
    const self = delverOf(snapshot);
    visits.note(self.position);
    const target = goals ? nextGoalPlace(snapshot, self, world.exit) : world.exit;
    const here = cheb(self.position, target);
    const options = lookOneTick(world, snapshot, tick, tokenValueOf);
    const distance = (o) => (o.exited ? -1 : cheb(o.position, target));
    const cost = (o) => (o.defeated ? Infinity : (o.harm * weight) - (here - distance(o)) - (o.token / tokenPerStep));
    options.sort((a, b) => (cost(a) - cost(b)) || (distance(a) - distance(b)) || (visits.of(a.position) - visits.of(b.position)));
    return options[0]?.action ?? null;
  });
}

/** The take goal, then the reach goal: the nearest source with an unclaimed holding, else the exit. */
function nextGoalPlace(snapshot, self, exit) {
  const sources = snapshot.actors.filter((actor) => actor.id !== DELVER_ID
    && (actor.holdings ?? []).some((holding) => holding.claimedBy === null));
  if (sources.length === 0) return exit;
  sources.sort((a, b) => cheb(self.position, a.position) - cheb(self.position, b.position) || (a.id < b.id ? -1 : 1));
  return sources[0].position;
}

/**
 * The oracle: every action sequence through core, kept as the Pareto frontier over runs that
 * exit alive. Two reductions, both exact for this domain:
 *   - states are merged when the world is identical apart from the delver's current health and
 *     stamina, keeping only those no other beats on (nonRenewable ↓, stamina ↑, health ↑): more
 *     of a vital never removes an option in core, so a beaten state has no better future;
 *   - a state that cannot reach the exit and dwell in the ticks left is dropped.
 */
export function oracleFrontier(world, { horizon, tokenValueOf }) {
  let layer = [{ snapshot: world.snapshot, nonRenewableUse: 0 }];
  let frontier = [];
  let expanded = 0;
  for (let tick = 0; tick < horizon && layer.length > 0; tick += 1) {
    const next = new Map();
    for (const { snapshot, nonRenewableUse } of layer) {
      const before = vitalsOf(snapshot);
      for (const action of candidateActions(world, snapshot)) {
        const result = stepWorld(world, snapshot, tick, action);
        expanded += 1;
        if (!result.accepted) continue;
        const after = vitalsOf(result.snapshot);
        let use = nonRenewableUse;
        for (const [vital, record] of Object.entries(before)) {
          if (record.regen === 0 && after[vital]) use += Math.max(0, record.current - after[vital].current);
        }
        const self = delverOf(result.snapshot);
        if (self.lifecycle === "defeated") continue;
        if (self.lifecycle === "exited") {
          frontier = paretoInsert(frontier, { exited: true, defeated: false,
            tokenValueAcquired: claimedValue(result.snapshot, tokenValueOf), nonRenewableUse: use, turns: tick + 1 });
          continue;
        }
        if (ticksToExit(self, world.exit) > horizon - (tick + 1)) continue;
        const entry = { snapshot: result.snapshot, nonRenewableUse: use,
          health: self.vitals.health.current, stamina: self.vitals.stamina?.current ?? 0 };
        const key = mergeKey(result.snapshot);
        const kept = next.get(key) ?? [];
        if (kept.some((other) => stateNoWorse(other, entry))) continue;
        next.set(key, [...kept.filter((other) => !stateNoWorse(entry, other)), entry]);
      }
    }
    layer = [...next.values()].flat();
  }
  return { frontier, expanded };
}

const stateNoWorse = (a, b) => a.nonRenewableUse <= b.nonRenewableUse && a.stamina >= b.stamina && a.health >= b.health;

/** The world with the delver's current health and stamina left out (they are compared, not keyed). */
function mergeKey(snapshot) {
  return JSON.stringify(snapshot.actors, (key, value) => (key === "vitals" && value?.health && value?.stamina
    ? { ...value, health: { ...value.health, current: null }, stamina: { ...value.stamina, current: null } }
    : value));
}

/** The fewest ticks from here to exited: the steps, then the dwell (arrival counts as one). */
function ticksToExit(self, exit) {
  const distance = cheb(self.position, exit);
  return distance > 0 ? distance + EXIT_DWELL_TICKS - 1 : EXIT_DWELL_TICKS - (self.exitDwell ?? 0);
}


// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** Every placement of `hazardCount` hazards and `resourceCount` resources on interior floor. */
export function* enumerateTacticBoards({ width, height, maxWalls, hazardCounts, resourceCounts, start, exit }) {
  const interior = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if ((x === start.x && y === start.y) || (x === exit.x && y === exit.y)) continue;
      interior.push({ x, y });
    }
  }
  const choose = function* (cells, count, from = 0, picked = []) {
    if (picked.length === count) { yield picked; return; }
    for (let index = from; index < cells.length; index += 1) yield* choose(cells, count, index + 1, [...picked, cells[index]]);
  };
  const at = (cell) => `${cell.x},${cell.y}`;
  for (let wallCount = 0; wallCount <= maxWalls; wallCount += 1) {
    for (const walls of choose(interior, wallCount)) {
      const wallKeys = new Set(walls.map(at));
      const floor = interior.filter((cell) => !wallKeys.has(at(cell)));
      for (const hazardCount of hazardCounts) {
        for (const hazards of choose(floor, hazardCount)) {
          const hazardKeys = new Set(hazards.map(at));
          const free = floor.filter((cell) => !hazardKeys.has(at(cell)));
          for (const resourceCount of resourceCounts) {
            for (const resources of choose(free, resourceCount)) {
              yield { width, height, start, exit, walls,
                hazards: hazards.map((position) => ({ position })), resources: resources.map((position) => ({ position })) };
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The ledger domain: actor_tactic_benefit
// ---------------------------------------------------------------------------

const CATALOGUE_URL = new URL("../../docs/design/actor-tactic-catalogue.json", import.meta.url);
/** The catalogue names a resource `R1`; boards here number theirs from `resource_1`. */
const CATALOGUE_TARGETS = Object.freeze({ R1: "resource_1" });
/** A delver that follows authored tactics needs this thinking motivation (strategy.js tiers). */
const STRATEGY_MOTIVATION = "strategy_focused";

/**
 * The catalogue entries this domain can pose as `strategy.js` data: `covers.strategy` is either
 * one tactic (`{ when, do }`) or a goal list. Targets are renamed to this domain's ids.
 */
export function catalogueStrategies(catalogue) {
  const rename = (value) => JSON.parse(JSON.stringify(value), (key, entry) => (
    key === "target" && typeof entry === "string" && CATALOGUE_TARGETS[entry] ? CATALOGUE_TARGETS[entry] : entry));
  return catalogue.entries.filter((entry) => entry.covers?.strategy).map((entry) => {
    const data = rename(entry.covers.strategy);
    return { id: entry.id, class: entry.class, strategy: data.when ? { tactics: [data] } : data };
  });
}

export async function loadTacticCatalogue() {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(CATALOGUE_URL, "utf8"));
}

/** The Allocator's price for a holding, priced as the resource card it came from. */
export async function createHoldingPricer() {
  const { calculateObjectCardUnitCost } = await import("../../packages/runtime/src/personas/allocator/controller.js");
  const cache = new Map();
  return (holding) => {
    if (holding.kind !== "vital") {
      // No silent fallback: a holding this domain cannot price is a harness defect, not 0 tokens.
      throw new Error(`actor_tactic_benefit prices vital holdings only, got ${holding.kind} (${holding.id})`);
    }
    const key = JSON.stringify([holding.permanenceMode, holding.vitals]);
    if (!cache.has(key)) {
      cache.set(key, calculateObjectCardUnitCost({ card: { type: "resource", id: holding.id,
        permanenceMode: holding.permanenceMode, vitals: holding.vitals } }).cost);
    }
    return cache.get(key);
  };
}

const MAX_EXAMPLES = 8;

/**
 * Preconditions, then every board: oracle frontier, the policy, every control. Counters are
 * per point; the verdict is applied once at the end by the rule fixed above.
 */
export async function runTacticBenefitLedger({ bounds, limit = 0, log = null, offset = 0 }) {
  const { width, height, horizon, weights } = bounds;
  const start = { x: 1, y: 1 };
  const exit = { x: width - 2, y: height - 2 };
  const tokenValueOf = await createHoldingPricer();
  const catalogue = await loadTacticCatalogue();
  const optionsLost = catalogue.scoring?.vitalOptionsLost ?? {};
  const strategies = catalogueStrategies(catalogue);
  const score = (trace) => scoreRun(trace, { tokenValueOf, optionsLost });

  // PRECONDITION 1: the policy exits an open board.
  const open = buildWorld({ width, height, start, exit });
  const openRun = score(await runActorPolicy(open, { horizon }));
  if (!openRun.exited) {
    throw new Error("actor_tactic_benefit precondition failed: the policy did not exit an open board, so every "
      + "gap below would measure the harness, not the Actor.");
  }
  // PRECONDITION 2: the driver can take. A take goal beside a resource on an open board claims it.
  const takeWorld = buildWorld({ width, height, start, exit, resources: [{ position: { x: start.x + 1, y: start.y + 1 } }],
    delver: { motivations: ["exploring", STRATEGY_MOTIVATION] } });
  const takeRun = score(await runActorPolicy(takeWorld, { horizon,
    strategy: { goals: [{ kind: "take", target: "resource_1" }] } }));
  if (takeRun.tokenValueAcquired <= 0) {
    throw new Error("actor_tactic_benefit precondition failed: a take goal beside a resource claimed nothing, so "
      + "every token gap below would measure the harness, not the Actor.");
  }

  const counters = {
    points: 0, unreachable: 0, gap: 0, tokenGap: 0, harmGap: 0, residual: 0,
    policyDefeated: 0, policyFailedToExit: 0, informationGap: 0,
    reorderCloses: 0, expandedCloses: 0, strategyBetterThanPolicy: {}, strategyWorseThanPolicy: {},
    policyRepeatedUnder25: 0, policyTurnsBelow50: {}, policyTurnsBelow25: {},
    kills: { warden: 0, hazard: 0 },
  };
  const weightCloses = Object.fromEntries(weights.map((weight) => [weight, 0]));
  const goalWeightCloses = Object.fromEntries(weights.map((weight) => [weight, 0]));
  const strategyCloses = Object.fromEntries(strategies.map((entry) => [entry.id, 0]));
  const gapRows = [];
  // Two questions share these boards. ROUTE boards hold no resource: the only thing to win is
  // harm, which is the catalogue's `route-around-a-guards-reach`. FETCH boards hold one: the
  // win is the token value, reached without crossing reach. Each is judged on its own points.
  const byClass = { route: { points: 0, gap: 0, residual: 0 }, fetch: { points: 0, gap: 0, residual: 0 } };
  const examples = { residual: [], strategyWorse: [] };
  const startedAt = Date.now();
  let seen = 0;

  for (const board of enumerateTacticBoards({ ...bounds, start, exit })) {
    seen += 1;
    if (seen <= offset) continue;
    if (limit && counters.points >= limit) break;
    const world = buildWorld(board);
    const { frontier } = oracleFrontier(world, { horizon, tokenValueOf });
    if (frontier.length === 0) { counters.unreachable += 1; continue; }
    counters.points += 1;
    const boardClass = board.resources.length > 0 ? "fetch" : "route";
    byClass[boardClass].points += 1;
    if (log && counters.points % 50 === 0) log(`  … ${counters.points} points (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    const beaten = (outcome) => frontier.some((best) => outcomeBeats(best, outcome));

    const policy = score(await runActorPolicy(world, { horizon }));
    const seenPolicy = score(await runActorPolicy(world, { horizon, sight: "seen" }));
    if (outcomeBeats(policy, seenPolicy)) counters.informationGap += 1;
    for (const pressure of policy.vitalPressure) {
      counters.policyTurnsBelow50[pressure.vital] = (counters.policyTurnsBelow50[pressure.vital] ?? 0) + pressure.turnsBelow50;
      counters.policyTurnsBelow25[pressure.vital] = (counters.policyTurnsBelow25[pressure.vital] ?? 0) + pressure.turnsBelow25;
      if (pressure.repeatedUnder25) counters.policyRepeatedUnder25 += 1;
    }
    counters.kills.warden += policy.kills.warden;
    counters.kills.hazard += policy.kills.hazard;

    const strategyRuns = {};
    const strategyWorld = buildWorld({ ...board, delver: { motivations: ["exploring", STRATEGY_MOTIVATION] } });
    for (const entry of strategies) {
      const run = score(await runActorPolicy(strategyWorld, { horizon, strategy: entry.strategy }));
      strategyRuns[entry.id] = run;
      if (outcomeBeats(run, policy)) counters.strategyBetterThanPolicy[entry.id] = (counters.strategyBetterThanPolicy[entry.id] ?? 0) + 1;
      if (outcomeBeats(policy, run)) {
        counters.strategyWorseThanPolicy[entry.id] = (counters.strategyWorseThanPolicy[entry.id] ?? 0) + 1;
        if (examples.strategyWorse.length < MAX_EXAMPLES) examples.strategyWorse.push({ tactic: entry.id, board, policy: brief(policy), strategy: brief(run) });
      }
    }

    if (!beaten(policy)) continue;
    counters.gap += 1;
    byClass[boardClass].gap += 1;
    if (policy.defeated) counters.policyDefeated += 1;
    else if (!policy.exited) counters.policyFailedToExit += 1;
    if (frontier.some((best) => best.tokenValueAcquired > policy.tokenValueAcquired)) counters.tokenGap += 1;
    if (frontier.some((best) => best.nonRenewableUse < policy.nonRenewableUse)) counters.harmGap += 1;

    const reorder = score(await runReorderControl(world, { horizon, tokenValueOf }));
    const expanded = score(await runActorPolicy(world, { horizon, expand: true }));
    const row = { board, boardClass, policy: brief(policy), frontier, reorder: !beaten(reorder), expanded: !beaten(expanded),
      weighted: {}, goalWeighted: {}, strategy: {} };
    if (row.reorder) counters.reorderCloses += 1;
    if (row.expanded) counters.expandedCloses += 1;
    for (const weight of weights) {
      row.weighted[weight] = !beaten(score(await runWeightedControl(world, { horizon, tokenValueOf, weight })));
      if (row.weighted[weight]) weightCloses[weight] += 1;
      row.goalWeighted[weight] = !beaten(score(await runWeightedControl(world, { horizon, tokenValueOf, weight, goals: true })));
      if (row.goalWeighted[weight]) goalWeightCloses[weight] += 1;
    }
    for (const entry of strategies) {
      row.strategy[entry.id] = !beaten(strategyRuns[entry.id]);
      if (row.strategy[entry.id]) strategyCloses[entry.id] += 1;
    }
    gapRows.push(row);
  }

  // One weight for the whole domain, the best one: generous to the control, never per point.
  const bestOf = (closes) => weights.reduce((best, weight) => (closes[weight] > closes[best] ? weight : best), weights[0]);
  const bestWeight = bestOf(weightCloses);
  const bestGoalWeight = bestOf(goalWeightCloses);
  for (const row of gapRows) {
    const closed = row.reorder || row.expanded || row.weighted[bestWeight] || row.goalWeighted[bestGoalWeight]
      || Object.values(row.strategy).some(Boolean);
    if (closed) continue;
    counters.residual += 1;
    byClass[row.boardClass].residual += 1;
    if (examples.residual.length < MAX_EXAMPLES) {
      examples.residual.push({ board: row.board, policy: row.policy, frontier: row.frontier });
    }
  }

  const closedBy = { "expanded candidates (same order)": counters.expandedCloses, reorder: counters.reorderCloses, [`weighted(w=${bestWeight})`]: weightCloses[bestWeight],
    [`take-then-exit weighted(w=${bestGoalWeight})`]: goalWeightCloses[bestGoalWeight],
    ...Object.fromEntries(Object.entries(strategyCloses).map(([id, count]) => [`strategy:${id}`, count])) };
  const domainVerdict = judgeTacticBenefit({ points: counters.points, gap: counters.gap, residual: counters.residual, closedBy });
  const classVerdicts = Object.fromEntries(Object.entries(byClass).map(([name, tally]) => [name, { ...tally,
    ...judgeTacticBenefit(tally) }]));
  const verdicts = catalogue.entries.map((entry) => tacticVerdict(entry, { classVerdicts, counters, strategyCloses }));

  return {
    domain: "actor_tactic_benefit",
    bounds,
    rule: TACTIC_BENEFIT_VERDICT,
    elapsedMs: Date.now() - startedAt,
    counters,
    closedBy,
    weightCloses,
    bestWeight,
    goalWeightCloses,
    bestGoalWeight,
    derived: {
      gapFraction: counters.points === 0 ? 0 : counters.gap / counters.points,
      residualFraction: counters.points === 0 ? 0 : counters.residual / counters.points,
      informationGapFraction: counters.points === 0 ? 0 : counters.informationGap / counters.points,
    },
    verdict: domainVerdict,
    classVerdicts,
    verdicts,
    examples,
  };
}

const brief = (run) => ({ exited: run.exited, defeated: run.defeated, tokenValueAcquired: run.tokenValueAcquired,
  nonRenewableUse: run.nonRenewableUse, turns: run.turns });

/**
 * Each catalogue entry's answer. Only `z3_solve` entries ask for a solver; a `list` entry's
 * question is whether its data helps, which is reported and never adopts anything.
 */
function tacticVerdict(entry, { classVerdicts, counters, strategyCloses }) {
  const strategyLine = Object.hasOwn(strategyCloses, entry.id)
    ? { closesGap: strategyCloses[entry.id], betterThanPolicy: counters.strategyBetterThanPolicy[entry.id] ?? 0,
      worseThanPolicy: counters.strategyWorseThanPolicy[entry.id] ?? 0 }
    : null;
  if (entry.class !== "z3_solve") {
    return { id: entry.id, class: entry.class, verdict: "not_a_solver_question", strategy: strategyLine };
  }
  if (entry.id === "probe-before-entering-a-guarded-corridor") {
    return { id: entry.id, class: entry.class, verdict: "unmeasured", strategy: strategyLine,
      reason: "the value of looking needs an oracle that does not see everything; this domain's oracle does. "
        + `Context: full sight beat the policy's own sight on ${counters.informationGap}/${counters.points} points. `
        + "Unmeasured reads as no: no solver." };
  }
  const route = classVerdicts.route;
  return { id: entry.id, class: entry.class, verdict: route.verdict, reason: `route boards: ${route.reason}`, strategy: strategyLine };
}
