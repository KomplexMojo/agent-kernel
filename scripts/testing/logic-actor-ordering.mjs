/**
 * Actor-ordering benefit gate — does WHO GOES FIRST change the outcome?
 *
 * NOT AN ADOPTED CONSTRAINT DOMAIN, and it must not become one on a number alone. This asks
 * the prior question, with no solver in it, exactly as the lookahead gate did.
 *
 * WHY THIS IS A DIFFERENT QUESTION FROM `actor_action_selection`. That domain asks what ONE
 * actor should do, and a sort answers it because each candidate is independently legal and
 * independently scored — measured at 0.0% divergence over 819 permutations. Ordering is the
 * opposite shape: the choice is over a shared, mutually exclusive resource (who resolves
 * first), one ordering forecloses the others, and the outcome of each depends on both actors.
 *
 * WHAT DECIDES IT TODAY. Nothing does. Actor order is the alphabetical sort of actor ids
 * (`runtime-fsm.mjs:194`), so renaming an attacker from `delver_1` to `zealot_1` moves it
 * behind a warden. Core exposes no initiative, priority or turn concept. The charter assigns
 * ordering to the Moderator so that "tick semantics are policy, not accidents of the runner
 * loop", and `moderator/tick-ordering.js` does own the order of the seven PERSONAS — but
 * actor order is a different thing and is owned by no one.
 *
 * ⚠️ THE CHARTER'S REFUSAL DOES NOT COVER THIS. "Moderator tick ordering" was refused as a
 * solver domain because it is "a sort". That is true of persona order and false of actor
 * order, which is a scheduling question over a shared resource. The refusal and this gate are
 * about different subjects that share a name.
 *
 * METHOD. Actors decide independently, so their chosen actions are fixed regardless of order;
 * only APPLICATION order varies. Each permutation runs against a freshly built core so no
 * state leaks between orderings, and the outcome is compared as a canonical snapshot of every
 * actor's position and health. Real core rules apply the actions — `applyAttack`, occupancy,
 * walkability — so this measures the game's own resolution, not a model of it.
 */
const call = (fn, ...args) => {
  if (typeof fn !== "function") throw new TypeError("core API missing — check the name");
  return fn(...args);
};

/** `ActionKind.Move`, from core's validate/inputs codebook. */
const MOVE_ACTION_KIND = 8;

/** Core's Direction codes, by delta. */
const DIRECTION_BY_DELTA = new Map([
  ["0,-1", 0], ["1,-1", 1], ["1,0", 2], ["1,1", 3],
  ["0,1", 4], ["-1,1", 5], ["-1,0", 6], ["-1,-1", 7],
]);
const directionOf = (from, to) => {
  const code = DIRECTION_BY_DELTA.get(`${to.x - from.x},${to.y - from.y}`);
  if (code === undefined) throw new RangeError(`not an adjacent step: ${JSON.stringify({ from, to })}`);
  return code;
};

/** Every ordering of n indices. */
export function permutations(n) {
  const out = [];
  const walk = (picked, left) => {
    if (left.length === 0) { out.push([...picked]); return; }
    for (let i = 0; i < left.length; i += 1) {
      walk([...picked, left[i]], [...left.slice(0, i), ...left.slice(i + 1)]);
    }
  };
  walk([], Array.from({ length: n }, (_, i) => i));
  return out;
}

/** A fresh world for every ordering — state must not leak between permutations. */
async function buildWorld({ width, height, actors }) {
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const core = createCore();
  call(core.configureGrid, width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      call(core.setTileAt, x, y, edge ? 0 : 1);
    }
  }
  call(core.clearActorPlacements);
  actors.forEach((actor, index) => call(core.addActorPlacement, index + 1, actor.x, actor.y));
  call(core.applyActorPlacements);
  actors.forEach((actor, index) => {
    // Health, mana AND stamina. A move validates against stamina, so an actor given only
    // health silently fails to move and the whole harness reports "order never matters".
    call(core.setMotivatedActorVital, index, 0, actor.health, actor.health, 0);
    call(core.setMotivatedActorVital, index, 1, 10, 10, 0);
    call(core.setMotivatedActorVital, index, 2, 10, 10, 0);
  });
  return core;
}

/** Position + health of every actor, order-independent, as a comparable string. */
function snapshot(core, count) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push([
      call(core.getMotivatedActorXByIndex, index),
      call(core.getMotivatedActorYByIndex, index),
      call(core.getMotivatedActorVitalCurrentByIndex, index, 0),
    ].join(","));
  }
  return rows.join("|");
}

/**
 * Apply one ordering and return the resulting world snapshot.
 * `actions` are indexed by actor; `order` is the sequence they resolve in.
 */
async function resolve({ width, height, actors, actions, order }) {
  const core = await buildWorld({ width, height, actors });
  for (const index of order) {
    const action = actions[index];
    if (!action) continue;
    if (action.kind === "attack") {
      call(core.applyAttack, index, action.target, action.damage);
    } else if (action.kind === "move") {
      // `setMoveAction` takes the 1-based actorId, not the index, and core rejects a move
      // onto an occupied or unwalkable tile. That rejection IS the order-dependence being
      // measured, so nothing is pre-filtered: the second actor to claim a tile simply fails.
      const from = {
        x: call(core.getMotivatedActorXByIndex, index),
        y: call(core.getMotivatedActorYByIndex, index),
      };
      // Two calls, not one: `setMoveAction` only STAGES the move, and `applyAction` performs
      // it. Staging alone is a silent no-op — the actor simply does not move and no error is
      // raised, which the empty-board precondition below exists to catch.
      // Three preconditions, each of which fails SILENTLY if omitted — the actor simply does
      // not move and no error is raised. Found one at a time by the precondition check below,
      // which is the only reason this harness measures anything at all:
      //   setActiveMotivatedActor — a move applies to the ACTIVE actor, not the id passed in
      //   tick = getCurrentTick() + 1 — a stale tick fails move identity/timing validation
      //   stamina — a move validates against it, and health alone is not enough
      call(core.setActiveMotivatedActor, index + 1);
      const tick = call(core.getCurrentTick) + 1;
      call(core.setMoveAction, index + 1, from.x, from.y, action.to.x, action.to.y,
        directionOf(from, action.to), tick);
      call(core.applyAction, MOVE_ACTION_KIND, 0);
    }
  }
  return snapshot(core, actors.length);
}

/** Does ANY ordering of these actions produce a different world than another? */
export async function orderingDivergence({ width, height, actors, actions }) {
  const outcomes = new Map();
  for (const order of permutations(actors.length)) {
    const key = await resolve({ width, height, actors, actions, order });
    if (!outcomes.has(key)) outcomes.set(key, []);
    outcomes.get(key).push(order.join(">"));
  }
  return { distinctOutcomes: outcomes.size, outcomes };
}

/**
 * The scenario family. Kinds are named because the per-kind breakdown is the finding: an
 * aggregate "N% order-dependent" hides that mutual attack is order-INdependent (both actors
 * die either way, since nothing gates a downed actor from acting) while attack-versus-retreat
 * is decided entirely by it.
 */
export function* enumerateOrderingScenarios({ width, height, damages, healths }) {
  const mid = { x: 2, y: 2 };
  for (const health of healths) {
    for (const damage of damages) {
      // Two actors converging on one tile from opposite corners.
      yield {
        kind: "tile_contention", width, height,
        actors: [{ x: 1, y: 1, health }, { x: 3, y: 3, health }],
        actions: [{ kind: "move", to: mid }, { kind: "move", to: mid }],
      };
      // Adjacent, each striking the other.
      yield {
        kind: "mutual_attack", width, height,
        actors: [{ x: 1, y: 1, health }, { x: 2, y: 1, health }],
        actions: [{ kind: "attack", target: 1, damage }, { kind: "attack", target: 0, damage }],
      };
      // One strikes while the other retreats out of reach — the case where going first
      // decides whether the blow lands at all.
      yield {
        kind: "attack_vs_retreat", width, height,
        actors: [{ x: 1, y: 1, health }, { x: 2, y: 1, health }],
        actions: [{ kind: "attack", target: 1, damage }, { kind: "move", to: { x: 3, y: 1 } }],
      };
      // Contention and combat at once, three actors.
      yield {
        kind: "contention_plus_combat", width, height,
        actors: [{ x: 1, y: 1, health }, { x: 3, y: 3, health }, { x: 2, y: 1, health }],
        actions: [{ kind: "move", to: mid }, { kind: "move", to: mid },
          { kind: "attack", target: 0, damage }],
      };
    }
  }
}
