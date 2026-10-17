/**
 * Strategies (Phase 2b): standing orders an actor follows on its own turns.
 *
 * A strategy is data: an ordered list of GOALS and, optionally, conditional TACTICS.
 *   goals    reach · defeat · guard · follow · lead · take · hold · survive
 *   tactics  { when: <condition>, do: <action> }, first match wins, checked before goals
 *
 * How much of it an actor follows is set by its thinking motivation (decision 5,
 * 2026-10-14). The tiers are monotonic:
 *   none or reflexive        nothing: the actor plays its motivations as before
 *   goal_oriented            the goals, in order
 *   strategy_focused         the goals and the tactics
 *   user_controlled          the goals and the tactics, on every turn it is not commanded
 * The parts an actor cannot follow are ignored and reported, never refused.
 *
 * Goals run in order. A goal that finishes hands over to the next; a standing goal
 * (guard, follow, survive) never finishes. A goal whose target is out of sight leaves
 * the turn to the actor's motivations ("searching"); one that cannot be met ("stalled":
 * an unknown target, no route, a guarded or followed ally gone) does the same and says
 * why. Progress is kept per actor in the Actor's own serializable context.
 *
 * Everything here is pure: a function of the strategy, the actor's progress entry and
 * this turn's observation. Legality stays core's.
 */
import {
  DEFAULT_DELTAS,
  chebyshevDistance,
  isDiagonalStepAllowed,
  isOccupied,
  isPassable,
} from "./proposal-helpers.js";

export const STRATEGY_GOAL_KINDS = Object.freeze(["reach", "defeat", "guard", "follow", "lead", "take", "hold", "survive"]);
export const STRATEGY_VITALS = Object.freeze(["health", "mana", "stamina", "durability"]);
/** A tactic's `do` may name this instead of an id: the nearest hostile the actor can see. */
export const NEAREST_HOSTILE = "nearest_hostile";
/** A tactic action beyond the command vocabulary: step away from the nearest hostile. */
export const RETREAT = "retreat";

export const STRATEGY_DEPTH = Object.freeze({ NONE: "none", GOALS: "goals", FULL: "full" });
export const STRATEGY_STATUS = Object.freeze({
  ACTIVE: "active", SEARCHING: "searching", STALLED: "stalled", DONE: "done", IGNORED: "ignored",
});

const GOAL_DEFAULTS = Object.freeze({ guard: { radius: 2 }, follow: { distance: 1 }, lead: { distance: 3 }, survive: { distance: 3 } });

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && value.trim().length > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

function fail(message) {
  throw new Error(`Actor strategy: ${message}`);
}

function normalizePlace(place, label, { allowExit }) {
  if (allowExit && place === "exit") return "exit";
  if (isPlainObject(place) && isNonNegativeInteger(place.x) && isNonNegativeInteger(place.y)) {
    return { x: place.x, y: place.y };
  }
  return fail(`${label} needs a place {x, y}${allowExit ? " or \"exit\"" : ""} (received ${JSON.stringify(place)}).`);
}

function normalizeTarget(target, label) {
  if (!isId(target)) fail(`${label} needs a target actor id (received ${JSON.stringify(target)}).`);
  return target.trim();
}

function normalizeGoal(goal, index) {
  const label = `goals[${index}]`;
  if (!isPlainObject(goal)) fail(`${label} must be an object { kind, ... }.`);
  if (!STRATEGY_GOAL_KINDS.includes(goal.kind)) {
    fail(`${label} has unknown kind ${JSON.stringify(goal.kind)} (expected ${STRATEGY_GOAL_KINDS.join(", ")}).`);
  }
  const range = (key) => {
    const value = goal[key] ?? GOAL_DEFAULTS[goal.kind][key];
    if (!isPositiveInteger(value)) fail(`${label} ${goal.kind} ${key} must be a positive integer (received ${JSON.stringify(goal[key])}).`);
    return value;
  };
  switch (goal.kind) {
    case "reach":
      return { kind: "reach", place: normalizePlace(goal.place, `${label} reach`, { allowExit: true }) };
    case "defeat":
    case "take":
      return { kind: goal.kind, target: normalizeTarget(goal.target, `${label} ${goal.kind}`) };
    case "guard":
      return { kind: "guard", target: normalizeTarget(goal.target, `${label} guard`), radius: range("radius") };
    case "follow":
      return { kind: "follow", target: normalizeTarget(goal.target, `${label} follow`), distance: range("distance") };
    case "lead":
      return { kind: "lead", target: normalizeTarget(goal.target, `${label} lead`),
        place: normalizePlace(goal.place ?? "exit", `${label} lead`, { allowExit: true }), distance: range("distance") };
    case "hold": {
      if (!isPositiveInteger(goal.ticks)) fail(`${label} hold ticks must be a positive integer (received ${JSON.stringify(goal.ticks)}).`);
      return { kind: "hold", place: normalizePlace(goal.place, `${label} hold`, { allowExit: false }), ticks: goal.ticks };
    }
    default:
      return { kind: "survive", distance: range("distance") };
  }
}

function normalizeCondition(when, label) {
  if (!isPlainObject(when)) fail(`${label} when must be an object.`);
  const keys = Object.keys(when);
  if (keys.includes("vital")) {
    if (!STRATEGY_VITALS.includes(when.vital)) fail(`${label} when.vital must be one of ${STRATEGY_VITALS.join(", ")}.`);
    if (!Number.isFinite(when.below) || when.below <= 0 || when.below > 100) {
      fail(`${label} when.below must be a percentage in (0, 100] (received ${JSON.stringify(when.below)}).`);
    }
    return { vital: when.vital, below: when.below };
  }
  if (keys.includes("hostileWithin")) {
    if (!isNonNegativeInteger(when.hostileWithin)) fail(`${label} when.hostileWithin must be a whole number of tiles.`);
    return { hostileWithin: when.hostileWithin };
  }
  if (keys.includes("defeated")) return { defeated: normalizeTarget(when.defeated, `${label} when.defeated`) };
  if (keys.includes("tickAtLeast")) {
    if (!isNonNegativeInteger(when.tickAtLeast)) fail(`${label} when.tickAtLeast must be a whole tick number.`);
    return { tickAtLeast: when.tickAtLeast };
  }
  return fail(`${label} when must name vital/below, hostileWithin, defeated or tickAtLeast.`);
}

/**
 * Check a strategy's shape and return its canonical form. Only the shape: whether a
 * target exists or a place is reachable is decided turn by turn ("stalled"). The tactic
 * actions are the Actor's command vocabulary, checked by `normalizeCommand`.
 */
export function normalizeStrategy(strategy, normalizeCommand) {
  if (!isPlainObject(strategy)) fail("must be an object { goals, tactics? }.");
  const unknown = Object.keys(strategy).filter((key) => !["goals", "tactics"].includes(key));
  if (unknown.length) fail(`unknown field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")} (expected goals, tactics).`);
  const goals = strategy.goals ?? [];
  const tactics = strategy.tactics ?? [];
  if (!Array.isArray(goals)) fail("goals must be an array.");
  if (!Array.isArray(tactics)) fail("tactics must be an array.");
  if (goals.length === 0 && tactics.length === 0) fail("needs at least one goal or tactic.");
  const normalized = { goals: goals.map(normalizeGoal) };
  if (tactics.length > 0) {
    normalized.tactics = tactics.map((tactic, index) => {
      const label = `tactics[${index}]`;
      if (!isPlainObject(tactic)) fail(`${label} must be an object { when, do }.`);
      const action = tactic.do;
      if (isPlainObject(action) && action.kind === RETREAT) {
        return { when: normalizeCondition(tactic.when, label), do: { kind: RETREAT } };
      }
      // A nearest-hostile target is resolved each turn; the rest is a plain command.
      const command = normalizeCommand(action);
      if (command.kind === "cast_affinity" && action.params?.targetId === NEAREST_HOSTILE) command.params.targetId = NEAREST_HOSTILE;
      return { when: normalizeCondition(tactic.when, label), do: command };
    });
  }
  return normalized;
}

/** How deep this actor's thinking reaches into a strategy, from its motivations. */
export function strategyDepth(motivationKinds = []) {
  const kinds = new Set(motivationKinds);
  if (kinds.has("strategy_focused") || kinds.has("user_controlled")) return STRATEGY_DEPTH.FULL;
  if (kinds.has("goal_oriented")) return STRATEGY_DEPTH.GOALS;
  return STRATEGY_DEPTH.NONE;
}

/** The parts of `strategy` an actor at `depth` ignores: [] | ["tactics"] | ["goals", "tactics"]. */
export function ignoredStrategyParts(strategy, depth) {
  const parts = [];
  if (depth === STRATEGY_DEPTH.NONE && strategy.goals.length > 0) parts.push("goals");
  if (depth !== STRATEGY_DEPTH.FULL && Array.isArray(strategy.tactics) && strategy.tactics.length > 0) parts.push("tactics");
  return parts;
}

// ── turn-by-turn following ────────────────────────────────────────────────────

function samePosition(left, right) {
  return Boolean(left && right) && left.x === right.x && left.y === right.y;
}

/**
 * Walking distance to `to` from every cell that can reach it (eight-way, no corner
 * cutting), counted back from `to`. `to` and `from` count even when they read as
 * blocked (an actor stands there); other actors' cells are walked round.
 */
function distancesTo(to, from, tileKinds, baseTiles) {
  const key = (cell) => `${cell.x},${cell.y}`;
  const distances = new Map([[key(to), 0]]);
  const queue = [to];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const next = distances.get(key(current)) + 1;
    for (const delta of DEFAULT_DELTAS) {
      const cell = { x: current.x + delta.dx, y: current.y + delta.dy };
      // The mover's own cell reads as blocked (it stands there); it still counts.
      if (distances.has(key(cell)) || (!samePosition(cell, from) && !isPassable(cell, tileKinds, baseTiles))
        || !isDiagonalStepAllowed(cell, current, tileKinds, baseTiles)) continue;
      distances.set(key(cell), next);
      queue.push(cell);
    }
  }
  return (cell) => distances.get(key(cell));
}

const squared = (left, right) => (left.x - right.x) ** 2 + (left.y - right.y) ** 2;

/**
 * One step from `from` toward `to`: the free neighbour nearest `to` by walking distance,
 * straightest first. A neighbour another actor stands on (or has claimed this tick) is
 * passed over, so a step goes round a crowd when it can. Never steps onto `to` itself
 * when `stopAdjacent` (`to` is an actor's cell). `route: false` when `to` cannot be
 * reached at all.
 */
function stepToward(from, to, context, { stopAdjacent = false } = {}) {
  const { tileKinds, baseTiles, view, actorId, reservedTargets } = context;
  const distanceOf = distancesTo(to, from, tileKinds, baseTiles);
  const here = distanceOf(from);
  if (here === undefined) return { route: false };
  if (here === 0 || (stopAdjacent && here <= 1)) return { route: true, move: null };
  const taken = (cell) => isOccupied(cell, view, actorId)
    || (Array.isArray(reservedTargets) && reservedTargets.some((entry) => samePosition(entry, cell)));
  let best = null;
  for (const delta of DEFAULT_DELTAS) {
    const cell = { x: from.x + delta.dx, y: from.y + delta.dy };
    const distance = distanceOf(cell);
    if (distance === undefined || distance >= here || (stopAdjacent && distance === 0)) continue;
    if (!isDiagonalStepAllowed(from, cell, tileKinds, baseTiles) || taken(cell)) continue;
    if (!best || distance < best.distance || (distance === best.distance && squared(cell, to) < squared(best.cell, to))) {
      best = { cell, distance };
    }
  }
  return { route: true, move: best ? { kind: "move", params: { target: best.cell } } : null };
}

/** The neighbour that puts the most distance between the actor and `threat`, if any is better than staying. */
function stepAway(from, threat, context) {
  const { tileKinds, baseTiles, view, actorId } = context;
  let best = null;
  let bestDistance = chebyshevDistance(from, threat);
  for (const delta of DEFAULT_DELTAS) {
    const cell = { x: from.x + delta.dx, y: from.y + delta.dy };
    if (!isPassable(cell, tileKinds, baseTiles) || !isDiagonalStepAllowed(from, cell, tileKinds, baseTiles)
      || isOccupied(cell, view, actorId)) continue;
    const distance = chebyshevDistance(cell, threat);
    if (distance > bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best ? { kind: "move", params: { target: best } } : null;
}

const WAIT = Object.freeze({ kind: "wait" });
const gone = (actor) => actor?.lifecycle === "defeated" || actor?.lifecycle === "exited";

function visibleActor(view, id) {
  return (Array.isArray(view?.actors) ? view.actors : []).find((actor) => actor?.id === id) || null;
}

/** Cast at `target` if a slot reaches, and close in when not adjacent. */
function attackProposals(self, target, context) {
  const distance = chebyshevDistance(self.position, target.position);
  const proposals = [];
  const cast = context.castAt(target, distance);
  if (cast) proposals.push(cast);
  if (distance > 1) {
    const step = stepToward(self.position, target.position, context, { stopAdjacent: true });
    if (step.move) proposals.push(step.move);
  }
  return proposals.length > 0 ? proposals : [WAIT];
}

/**
 * One goal's verdict for this turn:
 *   { done: true }                                     move on to the next goal
 *   { status, proposals | null, reason?, keepNear?, heldSince? }
 * `proposals: null` hands the turn to the actor's motivations; `keepNear` lets them
 * play but keeps their moves within `distance` of `center`.
 */
function evaluateGoal(goal, entry, context) {
  const { self, view, configuredIds, tick } = context;
  const target = goal.target ? visibleActor(view, goal.target) : null;
  const unknownTarget = goal.target && !configuredIds.has(goal.target);
  const searching = { status: STRATEGY_STATUS.SEARCHING, proposals: null, reason: "target_out_of_sight" };
  const stalled = (reason) => ({ status: STRATEGY_STATUS.STALLED, proposals: null, reason });
  const active = (proposals, extra = {}) => ({ status: STRATEGY_STATUS.ACTIVE, proposals, ...extra });
  if (unknownTarget) return stalled("unknown_target");

  switch (goal.kind) {
    case "reach": {
      // Standing on the exit, the last wait leaves the level: the goal is met.
      if (goal.place === "exit") return context.onExit() ? { status: STRATEGY_STATUS.DONE, proposals: [WAIT] } : active(context.exitStep());
      if (samePosition(self.position, goal.place)) return { done: true };
      const step = stepToward(self.position, goal.place, context);
      if (!step.route) return stalled("no_route");
      return active(step.move ? [step.move] : [WAIT]);
    }
    case "defeat": {
      if (target && target.lifecycle === "defeated") return { done: true };
      if (!target) return searching;
      if (target.lifecycle === "exited") return stalled("target_gone");
      return active(attackProposals(self, target, context));
    }
    case "take": {
      if (!target) return searching;
      if (target.lifecycle === "exited") return stalled("target_gone");
      if (target.lifecycle !== "defeated") return active(attackProposals(self, target, context));
      const loot = (Array.isArray(target.holdings) ? target.holdings : [])
        .filter((holding) => holding.claimedBy === null)
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      if (loot.length === 0) return { done: true };
      if (chebyshevDistance(self.position, target.position) <= 1) {
        return active([{ kind: "take", params: { targetId: target.id, holdingId: loot[0].id } }]);
      }
      const step = stepToward(self.position, target.position, context, { stopAdjacent: true });
      if (!step.route) return stalled("no_route");
      return active(step.move ? [step.move] : [WAIT]);
    }
    case "guard": {
      if (!target) return searching;
      if (gone(target)) return stalled("target_gone");
      const threat = context.hostiles
        .filter((hostile) => chebyshevDistance(hostile.position, target.position) <= goal.radius)
        .sort((left, right) => chebyshevDistance(self.position, left.position) - chebyshevDistance(self.position, right.position)
          || (left.id < right.id ? -1 : 1))[0];
      if (threat) return active(attackProposals(self, threat, context));
      if (chebyshevDistance(self.position, target.position) > goal.radius) {
        const step = stepToward(self.position, target.position, context, { stopAdjacent: true });
        if (!step.route) return stalled("no_route");
        return active(step.move ? [step.move] : [WAIT]);
      }
      return active([WAIT]);
    }
    case "follow": {
      if (!target) return searching;
      if (gone(target)) return stalled("target_gone");
      if (chebyshevDistance(self.position, target.position) > goal.distance) {
        const step = stepToward(self.position, target.position, context, { stopAdjacent: true });
        if (!step.route) return stalled("no_route");
        return active(step.move ? [step.move] : [WAIT]);
      }
      return active(null, { keepNear: { center: { ...target.position }, distance: goal.distance } });
    }
    case "lead": {
      const place = goal.place === "exit" ? null : goal.place;
      if (place && samePosition(self.position, place)) return { done: true };
      if (!place && context.onExit()) return { status: STRATEGY_STATUS.DONE, proposals: [WAIT] };
      // The ally sets the pace: the leader waits for one that falls behind or out of sight.
      if (!gone(target) && (!target || chebyshevDistance(self.position, target.position) > goal.distance)) {
        return active([WAIT], { reason: "waiting_for_ally" });
      }
      if (!place) return active(context.exitStep());
      const step = stepToward(self.position, place, context);
      if (!step.route) return stalled("no_route");
      return active(step.move ? [step.move] : [WAIT]);
    }
    case "hold": {
      if (!samePosition(self.position, goal.place)) {
        const step = stepToward(self.position, goal.place, context);
        if (!step.route) return stalled("no_route");
        return active(step.move ? [step.move] : [WAIT]);
      }
      const heldSince = Number.isInteger(entry.heldSince) ? entry.heldSince : tick;
      if (tick - heldSince >= goal.ticks) return { done: true };
      return active([WAIT], { heldSince });
    }
    default: {
      const threat = context.nearestHostile;
      if (!threat || chebyshevDistance(self.position, threat.position) > goal.distance) return active(null);
      const away = stepAway(self.position, threat.position, context);
      return active(away ? [away] : null);
    }
  }
}

function vitalBelow(record, vital, percent) {
  const entry = record?.vitals?.[vital];
  if (!entry || !Number.isFinite(entry.current) || !Number.isFinite(entry.max) || entry.max <= 0) return false;
  return (entry.current / entry.max) * 100 < percent;
}

function conditionHolds(when, context) {
  if (when.vital) return vitalBelow(context.record, when.vital, when.below);
  if (when.hostileWithin !== undefined) {
    return Boolean(context.nearestHostile)
      && chebyshevDistance(context.self.position, context.nearestHostile.position) <= when.hostileWithin;
  }
  if (when.defeated) return visibleActor(context.view, when.defeated)?.lifecycle === "defeated";
  return context.tick >= when.tickAtLeast;
}

function tacticProposal(action, context) {
  if (action.kind === RETREAT) {
    return context.nearestHostile ? stepAway(context.self.position, context.nearestHostile.position, context) : null;
  }
  if (action.kind === "cast_affinity" && action.params.targetId === NEAREST_HOSTILE) {
    if (!context.nearestHostile) return null;
    return { kind: "cast_affinity", params: { ...action.params, targetId: context.nearestHostile.id } };
  }
  return context.commandProposal(action);
}

/**
 * Follow `strategy` for one turn.
 *
 * @param {object} args.strategy   canonical strategy (normalizeStrategy)
 * @param {string} args.depth      STRATEGY_DEPTH
 * @param {object} args.entry      this actor's progress entry from the Actor context
 * @param {object} args.context    self, record, view, hostiles, nearestHostile, configuredIds,
 *                                 tick, tileKinds, baseTiles, reservedTargets, actorId,
 *                                 castAt(target, distance), exitStep(), onExit(), commandProposal(command)
 * @returns {{ proposals: object[] | null, keepNear?: object, entry: object }}
 */
export function followStrategy({ strategy, depth, entry = {}, context }) {
  const ignored = ignoredStrategyParts(strategy, depth);
  const report = (fields) => ({
    ...(entry.order ? { order: entry.order } : {}),
    ...fields,
    ...(ignored.length > 0 ? { ignored } : {}),
  });
  if (depth === STRATEGY_DEPTH.NONE) {
    return { proposals: null, entry: report({ goal: 0, status: STRATEGY_STATUS.IGNORED }) };
  }

  if (depth === STRATEGY_DEPTH.FULL && Array.isArray(strategy.tactics)) {
    for (let index = 0; index < strategy.tactics.length; index += 1) {
      const tactic = strategy.tactics[index];
      if (!conditionHolds(tactic.when, context)) continue;
      const proposal = tacticProposal(tactic.do, context);
      if (!proposal) continue;
      const goal = Number.isInteger(entry.goal) ? entry.goal : 0;
      return {
        proposals: [proposal],
        entry: report({ goal, status: STRATEGY_STATUS.ACTIVE, tactic: index,
          ...(Number.isInteger(entry.heldSince) ? { heldSince: entry.heldSince } : {}) }),
      };
    }
  }

  let goal = Number.isInteger(entry.goal) ? entry.goal : 0;
  let heldSince = entry.heldSince;
  while (goal < strategy.goals.length) {
    const verdict = evaluateGoal(strategy.goals[goal], { heldSince }, context);
    if (verdict.done) {
      goal += 1;
      heldSince = undefined;
      continue;
    }
    return {
      proposals: verdict.proposals,
      ...(verdict.keepNear ? { keepNear: verdict.keepNear } : {}),
      entry: report({
        goal,
        status: verdict.status,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
        ...(Number.isInteger(verdict.heldSince) ? { heldSince: verdict.heldSince } : {}),
      }),
    };
  }
  return { proposals: null, entry: report({ goal, status: STRATEGY_STATUS.DONE }) };
}
