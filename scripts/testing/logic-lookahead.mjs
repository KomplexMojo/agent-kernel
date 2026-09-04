/**
 * Stage C benefit gate — does LOOKAHEAD beat the one-step choice?
 *
 * THIS DELIBERATELY CONTAINS NO SOLVER, and that is the point. Z10's central finding was
 * that `actor_action_selection` was adopted as a solver domain without anyone first
 * checking whether search beat evaluation -- and it did not, by 0.0% over 819 points.
 * Building a Z3 lookahead and measuring afterwards would repeat exactly that mistake. So
 * this asks the prior question with no solver in it: is there anything for a search to win?
 *
 * THE HYPOTHESIS COMES FROM THE RANK ORDER, not from intuition. The Actor's tuple is
 * [intentClass, targetFinish, cover, stealth, fieldSafety, ...] compared lexicographically,
 * so `intentClass` DOMINATES `fieldSafety`: a move toward the exit scores 300 and a move
 * that is merely mobile scores 200. Field safety therefore only breaks ties between moves
 * of equal intent, and an actor will cross arbitrarily harmful ground so long as it is
 * making progress. That is defensible for one step and possibly fatal over several, which
 * is precisely the difference a horizon can measure and a single step cannot.
 *
 * WHAT IS COMPARED, per point:
 *   policy   the REAL Actor persona, driven one tick at a time for H ticks
 *   oracle   exhaustive enumeration of every H-step route, minimising cumulative harm
 *            among those that reach the exit
 *
 * The policy is driven rather than reimplemented. A reimplementation would be measuring my
 * model of the Actor against my model of optimal, which is a comparison of two guesses.
 *
 * INTERIM RESULT (2026-09-04), one 7x5 board, two hazards, 45 placements, horizon 6:
 *
 *   current policy suboptimal vs the exhaustive route ......... 19/45
 *   a safety-first ONE-STEP ordering suboptimal .............. 24/45
 *   of the current policy's 19, fixed by that reorder ........ 10
 *   suboptimal under BOTH orderings .......................... 9/45
 *
 * The last line is the only one that argues for lookahead. Half the current gap is a rank
 * ORDER problem -- intentClass dominates fieldSafety, so an actor crosses hazards that are
 * on the way -- but reordering is not free: it fixes 10 cases and breaks 14 others, because
 * a purely safety-first chooser wanders. That neither ordering dominates, and that 9 points
 * defeat both, is what a horizon could actually address.
 *
 * THIS IS A PROBE, NOT THE GATE. One board and one hazard count cannot carry an adoption
 * decision; a real gate widens the domain and lands in `logic-value-ledger.mjs` beside the
 * other three. It is recorded here because it already answers one thing: an ordering change
 * is the cheaper candidate and must be ruled out before any solver is written.
 *
 * TWO DRIVER BUGS WERE FOUND AND FIXED BEFORE THESE NUMBERS MEANT ANYTHING, both of which
 * produced confident, entirely fictional results:
 *   - `explorative` is not a motivation kind. The invalid value yielded no motivationProfile
 *     and silently dropped the actor onto the compatibility tuple.
 *   - the driver supplied its own move proposals, which an actor ranks at intentClass 600 --
 *     above its own exit_progress candidates at 300 -- so the measured "policy" was really
 *     the order the proposals were fed in.
 * The empty-board check that caught them (policy must reach the exit with no hazards) is the
 * cheapest guard here and should be run first whenever this domain is widened.
 */
import { resolveExposureVitalDeltas } from "../../packages/core-ts/src/state/affinity-spatial.ts";

const DELTAS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
];
const FIXED_CLOCK = () => "2026-09-04T00:00:00.000Z";

const key = ({ x, y }) => `${x},${y}`;
const walkable = (tiles, { x, y }) => (
  y >= 0 && y < tiles.length && x >= 0 && x < tiles[y].length && tiles[y][x] !== "#"
);

/** Total harm an actor with this affinity takes standing on this tile for one tick. */
function harmAt(fields, position, observer) {
  let harm = 0;
  for (const field of fields) {
    if (field.position.x !== position.x || field.position.y !== position.y) continue;
    for (const entry of field.vitalEffects) {
      const deltas = observer
        ? resolveExposureVitalDeltas({
          baseEffect: entry.effect,
          vital: entry.vital,
          fieldKind: field.kind,
          fieldExpression: field.expression,
          observerKind: observer.kind,
          observerExpression: observer.expression,
        })
        : [{ vital: entry.vital, effect: entry.effect }];
      for (const delta of deltas) if (delta.effect < 0) harm += -delta.effect;
    }
  }
  return harm;
}

/**
 * The best any route can do: exhaustive over every H-step sequence.
 *
 * Reaching the exit is lexicographically first because a route that dies short of it has
 * not "taken less harm", it has failed. Among routes that arrive, least cumulative harm
 * wins, then the shortest. Ties resolve by move order so the answer is deterministic.
 */
function bestRoute({ tiles, fields, start, exit, horizon, observer }) {
  let best = null;
  const consider = (position, stepsUsed, harm, reached) => {
    const candidate = { reached, harm, steps: stepsUsed };
    if (best === null
      || (candidate.reached && !best.reached)
      || (candidate.reached === best.reached && candidate.harm < best.harm)
      || (candidate.reached === best.reached && candidate.harm === best.harm
        && candidate.steps < best.steps)) {
      best = candidate;
    }
  };
  const walk = (position, step, harm) => {
    const atExit = position.x === exit.x && position.y === exit.y;
    if (atExit) {
      consider(position, step, harm, true);
      return;
    }
    if (step === horizon) {
      consider(position, step, harm, false);
      return;
    }
    for (const { dx, dy } of [{ dx: 0, dy: 0 }, ...DELTAS]) {
      const next = { x: position.x + dx, y: position.y + dy };
      if (!walkable(tiles, next)) continue;
      walk(next, step + 1, harm + harmAt(fields, next, observer));
    }
  };
  walk(start, 0, harmAt(fields, start, observer));
  return best;
}

/** Drive the REAL Actor persona one tick and return where it chose to stand. */
async function policyStep({ persona, TickPhases, tiles, fields, position, exit, grants, tick }) {
  const self = {
    id: "delver_1",
    kind: 2,
    role: "delver",
    position,
    // `exploring`, not `explorative`: an invalid kind yields no motivationProfile and
    // silently drops the actor onto the compatibility tuple, which ranks differently.
    // That typo made an empty board unreachable and would have been reported as the
    // Actor's myopia rather than mine.
    motivation: { kind: "exploring" },
    vitals: { health: { current: 20, max: 20, regen: 0 }, mana: { current: 2, max: 9, regen: 0 } },
    affinityGrants: grants,
  };
  // NO PROPOSALS. An actor ranks a supplied proposal at intentClass 600, above its own
  // exit_progress candidates at 300, so feeding it moves means measuring the order they
  // were fed in rather than the Actor's policy. An earlier version did exactly that and
  // reported the resulting wandering as the Actor failing to reach the exit.
  const proposals = [];
  const observation = {
    actors: [self],
    tiles: {
      baseTiles: tiles,
      kinds: tiles.map((line) => Array.from(line, (tile) => (tile === "#" ? 1 : 0))),
    },
    exit,
    affinityFields: fields,
  };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles: tiles,
    initialState: { actors: [{ id: self.id, role: self.role, kind: "motivated", runtimeDecisioning: true }] },
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
    proposals,
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
  const effect = result.effects.find((entry) => entry?.kind === "solver_request");
  const rows = effect?.request?.problem?.data?.objectives?.actorDecision?.candidates;
  const actions = effect?.request?.problem?.data?.candidateActions;
  if (!rows || !actions) return null;
  // The adapter's own comparison: highest tuple wins, input order breaks ties.
  let winner = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const a = rows[index].rank;
    const b = rows[winner].rank;
    for (let m = 0; m < a.length; m += 1) {
      if (a[m] !== b[m]) { if (a[m] > b[m]) winner = index; break; }
    }
  }
  const chosen = actions[winner]?.action;
  const to = chosen?.params?.to;
  return to && walkable(tiles, to) ? { x: to.x, y: to.y } : position;
}

async function runPolicy({ tiles, fields, start, exit, horizon, grants }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../packages/runtime/src/personas/actor/persona.js"),
    import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const observer = grants.length > 0
    ? { kind: grants[0].kindCode, expression: grants[0].expressionCode }
    : null;
  let position = { ...start };
  let harm = harmAt(fields, position, observer);
  let reached = position.x === exit.x && position.y === exit.y;
  for (let tick = 0; tick < horizon && !reached; tick += 1) {
    const persona = createActorPersona({ clock: FIXED_CLOCK });
    const next = await policyStep({
      persona, TickPhases, tiles, fields, position, exit, grants, tick,
    });
    if (!next) break;
    position = next;
    harm += harmAt(fields, position, observer);
    if (position.x === exit.x && position.y === exit.y) reached = true;
  }
  return { harm, reached };
}

export { bestRoute, harmAt, runPolicy, walkable, DELTAS, key };

/**
 * The swept domain: one fixed board, every placement of N harmful tiles.
 *
 * The board is fixed and the HAZARDS vary, rather than the reverse, because the question
 * is whether any arrangement of danger defeats a one-step chooser -- not whether some
 * hand-drawn maze does. An earlier probe hand-built a corridor "obviously" fatal to a
 * myopic actor and the policy walked around it cleanly: with eight-way movement and
 * Chebyshev distance, "exit progress" is a wide class, so field safety has room to
 * operate inside it. Enumerating placements is what stops the result being a board I
 * tuned until it agreed with me.
 */
export function* enumerateHazardBoards({ tiles, start, exit, hazardCount, harm }) {
  const cells = [];
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[y].length; x += 1) {
      const at = { x, y };
      if (!walkable(tiles, at)) continue;
      if (key(at) === key(start) || key(at) === key(exit)) continue;
      cells.push(at);
    }
  }
  const choose = (startIndex, picked) => {
    if (picked.length === hazardCount) {
      return [picked.map((cell) => ({
        position: { ...cell },
        kind: 1,
        expression: 3,
        stacks: 3,
        vitalEffects: [{ vital: 0, effect: -harm }],
      }))];
    }
    const out = [];
    for (let index = startIndex; index < cells.length; index += 1) {
      out.push(...choose(index + 1, [...picked, cells[index]]));
    }
    return out;
  };
  yield* choose(0, []);
}
