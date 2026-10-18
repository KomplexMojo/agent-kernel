import { createActorStateMachine, ActorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildAction, buildRequestActionsFromEffects, buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { requireClock } from "../_shared/require-clock.js";
import {
  RUNTIME_DECISION_CONTRACT,
  allowsLiveLlmRuntime,
  buildRuntimeDecisionEnvelope,
  projectRuntimeDecisionActor,
  resolveRuntimeDecisionProviderPolicy,
} from "../_shared/runtime-decision.mts";
import { SOLVER_REQUEST_SCHEMA } from "../../contracts/artifacts.ts";
import { buildActorIntention } from "../../contracts/actor-intention.js";
import {
  MOTIVATION_KINDS,
} from "../../contracts/domain-constants.js";
import {
  MotivationFlag,
  ReasoningClass,
  getMotivationCognitionTier,
  getMotivationCombatTier,
  getMotivationDefaultFlagMask,
  getMotivationMobilityTier,
  getMotivationReasoningClass,
} from "../../../../core-ts/src/index.ts";
import { projectActorEquipmentFields, previewActorFieldChanges } from "../../../../core-ts/src/rules/actor-fields.ts";
import { equipActorAffinity, equippedActorAffinityKeys } from "../../../../core-ts/src/state/actor-inventory.ts";
import { VitalKind } from "../../../../core-ts/src/state/vitals.ts";
import {
  DEFAULT_DELTAS,
  buildMoveProposal,
  resolveObservationView,
  resolveBaseTiles,
  resolveExit,
  findExitFromTiles,
  resolveActor,
  resolveActorRecord,
  resolveTileKinds,
  buildAdjacentMoveProposals,
  chebyshevDistance,
  findPath,
  actorCanExit,
  isDiagonalStepAllowed,
  isOccupied,
  isPassable,
} from "./proposal-helpers.js";
import { getMotivationModule } from "./motivations/index.js";
import {
  NEAREST_HOSTILE,
  RETREAT,
  STRATEGY_DEPTH,
  STRATEGY_GOAL_KINDS,
  STRATEGY_STATUS,
  followStrategy,
  ignoredStrategyParts,
  normalizeStrategy,
  strategyDepth,
} from "./strategy.js";

export { NEAREST_HOSTILE, RETREAT, STRATEGY_DEPTH, STRATEGY_GOAL_KINDS, STRATEGY_STATUS };

/**
 * Stage B — `profileAlignment` split into its two independent signals.
 *
 * v2 summed them: `coverRank + stealthRank`, cover a flat 1000 and stealth 1000 x a
 * distance delta. Two actors could therefore produce the SAME alignment number for
 * different reasons -- 1000 + 0 and 0 + 1000 are indistinguishable -- and a lexicographic
 * sort cannot separate what a sum has already merged. Adding two incommensurable signals
 * is not a ranking, it is information loss with a plausible shape.
 *
 * Separating them also removes the need for the 1000 scaling factors. Those existed only
 * to keep one signal from being swamped by the other inside a shared slot; each member is
 * now compared on its own, so the raw counts carry the meaning and there is no magic
 * constant left to explain.
 *
 * COVER BEFORE STEALTH is a real ordering decision, not an accident of how the old sum
 * read left to right: an actor that is being shot at benefits from cover this tick, while
 * a stealth gain pays off next tick. Revisit it when there IS a next tick to reason about.
 *
 * cognitionTier and reasoningClass stay diagnostic and are deliberately NOT given slots
 * here. They describe planning DEPTH, and a one-step choice gives them nothing to
 * modulate; a rank member invented to look richer would be exactly the artificial
 * introduction the charter forbids. They become meaningful with lookahead, not before.
 */
/**
 * v4 — the tuple decides, and a proposal no longer overrules it.
 *
 * `actorProposal` used to be an intentClass of 600, above every other class, so any
 * candidate matching the Actor's own deterministic proposal won outright. Measured over
 * 3,942 decision steps that was 100% of them: the ranking was computed, validated, carried
 * across the solver port, sorted, and discarded, because the decision had already been made
 * upstream. In 495 of the 498 steps that walked into harm, a harm-free candidate was on the
 * list and lost to the stamp.
 *
 * WHY THE MEMBER IS KEPT RATHER THAN DELETED. An Actor's own suggestion is real information,
 * and a genuine tie through all eight preceding members is better settled in the Actor's
 * favour than by raw candidate input order, which is deterministic but arbitrary.
 *
 * ⚠️ An earlier version of this comment justified keeping it on the grounds that deleting the
 * branch would drop a non-move proposal -- an out-of-range cast -- to intentClass 0, below
 * `wait`. THAT WAS FALSE, and adversarial review caught it. `intentClass` is computed purely
 * from `action.kind` and reachability a few lines below and never reads `actorProposal`, so an
 * out-of-range cast lands at 0 either way. Demotion prevents nothing there. The justification
 * above is the real one, and `actor-decision-objective.test.js` exercises the tiebreak it
 * claims -- the earlier rationale had no test because it described an effect that did not exist.
 */
const ACTOR_DECISION_OBJECTIVE_CONTRACT = "actor-decision-objective-v6";
const ACTOR_DECISION_OBJECTIVE_ORDER = Object.freeze([
  "intentClass",
  "targetFinish",
  "coverAlignment",
  "stealthAlignment",
  "fieldSafety",
  "fieldBenefit",
  "castReserve",
  "actorProposal",
  "inputOrder",
]);

const VITAL_KEYS_BY_CODE = Object.freeze({
  [VitalKind.Health]: "health",
  [VitalKind.Mana]: "mana",
  [VitalKind.Stamina]: "stamina",
  [VitalKind.Durability]: "durability",
});

/**
 * AM.9 — motivation name -> core's 1-based kind code, derived from the shared
 * vocabulary. core's `MotivationKind` is documented as matching this order, so
 * the index IS the mapping; a hand-written second table would drift.
 */
const MOTIVATION_KIND_CODES = Object.freeze(
  MOTIVATION_KINDS.reduce((acc, name, index) => {
    acc[name] = index + 1;
    return acc;
  }, {}),
);

function buildMotivationProfile(view, actorId, payload, rawKind = resolveActorMotivationKind(view, actorId, payload)) {
  const kind = typeof rawKind === "string" ? rawKind.trim().toLowerCase() : "";
  const kindCode = MOTIVATION_KIND_CODES[kind];
  if (!Number.isFinite(kindCode)) return undefined;

  const reasoningClass = getMotivationReasoningClass(kindCode);
  const flagMask = getMotivationDefaultFlagMask(kindCode);
  return {
    kind,
    mobilityTier: getMotivationMobilityTier(kindCode),
    combatTier: getMotivationCombatTier(kindCode),
    cognitionTier: getMotivationCognitionTier(kindCode),
    reasoningClass,
    reasoningClassName: Object.entries(ReasoningClass).find(([, value]) => value === reasoningClass)?.[0],
    flagMask,
    flags: Object.entries(MotivationFlag)
      .filter(([, flag]) => (flagMask & flag) === flag)
      .map(([name]) => name),
  };
}

/**
 * The Actor's intent classes, named once. The ranking tuple compares them per candidate, and
 * the intention the Moderator orders on reports the class of whichever candidate won — so the
 * two must not drift, and a second table of the same numbers is exactly how they would.
 *
 * The intention is COARSER than the ranking on purpose. Ranking separates exit progress from a
 * mobile fallback because that decides which candidate wins; ordering only needs to know that
 * combat resolves before movement, which the chosen action's kind settles on its own.
 */
/**
 * ⚠️ `MOBILE_FALLBACK` WAS SPLIT INTO LATERAL AND RETREAT (contract v6, 2026-09-05), and the
 * split exists to break a LIVELOCK rather than to express a preference.
 *
 * One flat class for "moves that are not progress" meant that when no move reduced the
 * distance to the exit, every direction tied at 200 and `fieldSafety` decided — which picked
 * the harm-free step BACKWARDS. From there progress was available again, so the actor stepped
 * forward, found no progress, and retreated again: a stable two-cycle, forever, taking zero
 * harm and never arriving. Measured at sweep bounds: 190 boards (0.85%), and all 12 recorded
 * examples were two-cycles with `policyHarm 0` against an oracle that reached by accepting 5.
 *
 * Grading the class by whether the move INCREASES the distance to the exit breaks the cycle
 * with no memory at all: a sideways step outranks a backwards one, so the actor stops
 * retreating into a position it has just proved unproductive. Stateless was the requirement,
 * not a convenience — an actor that needed to remember where it had been would need the
 * runner to carry that across ticks, and the context must stay serializable.
 */
const ACTOR_INTENT_CLASS = Object.freeze({
  IN_RANGE_COMBAT: 500,
  HOSTILE_PROGRESS: 400,
  EXIT_PROGRESS: 300,
  /** A move that holds its distance to the exit. */
  MOBILE_LATERAL: 200,
  /** A move that increases it. Ranked below lateral ONLY to stop the two-cycle above. */
  MOBILE_RETREAT: 150,
  WAIT: 100,
  NONE: 0,
});

/**
 * THE SINGLE AUTHORITY on what an action MEANS for this actor. One function, two callers:
 * the candidate ranking's `intentClass` member, and the intention surfaced to the Moderator.
 *
 * ⚠️ It replaced a second, coarser derivation that keyed off action KIND alone
 * (`intentClassForAction`, deleted). That one collapsed HOSTILE_PROGRESS and EXIT_PROGRESS
 * into MOBILE_FALLBACK, because kind cannot see whether a move closes on a hostile or on the
 * exit — so a delver running down a warden and an idler wandering both surfaced 200 and
 * tie-broke on actor id. Two authorities on Actor meaning is the F10 defect this codebase has
 * already paid to remove once, and `moderator/actor-ordering.js` claimed in its own header
 * that no second derivation existed while one sat 200 lines away.
 *
 * Pure: positions, profile and the visible-actor list in, `{ intentClass, intentTag }` out.
 */
export function classifyActorIntent({ action, actorPosition, actorRecord, motivationProfile, visibleActors, exit } = {}) {
  const none = { intentClass: ACTOR_INTENT_CLASS.NONE, intentTag: "profile_mismatch" };
  if (!action || !actorPosition || !motivationProfile) return none;
  const seen = Array.isArray(visibleActors) ? visibleActors : [];
  const endPosition = candidateEndPosition(action, actorPosition);
  const beforeHostile = nearestHostile(actorPosition, seen);
  const afterHostile = nearestHostile(endPosition, seen);
  const explicitTargetId = typeof action?.params?.targetId === "string" ? action.params.targetId : null;
  const explicitTarget = explicitTargetId
    ? seen.find((entry) => entry?.id === explicitTargetId && entry.hostile === true)
    : null;

  if (action.kind === "cast_affinity"
    && motivationProfile.combatTier > 0
    && actionCanReachTarget(action, actorPosition, explicitTarget, actorRecord)) {
    return { intentClass: ACTOR_INTENT_CLASS.IN_RANGE_COMBAT, intentTag: "in_range_combat" };
  }
  if (action.kind === "move" && motivationProfile.mobilityTier > 0) {
    const hostileProgress = motivationProfile.combatTier === 1
      && beforeHostile && afterHostile && afterHostile.distance < beforeHostile.distance;
    if (hostileProgress) {
      return { intentClass: ACTOR_INTENT_CLASS.HOSTILE_PROGRESS, intentTag: "hostile_progress" };
    }
    const beforeExit = chebyshevDistance(actorPosition, exit);
    const afterExit = chebyshevDistance(endPosition, exit);
    if (Number.isFinite(beforeExit) && Number.isFinite(afterExit) && afterExit < beforeExit) {
      return { intentClass: ACTOR_INTENT_CLASS.EXIT_PROGRESS, intentTag: "exit_progress" };
    }
    // Not progress. Retreating still beats being cornered, but it loses to holding ground —
    // which is the whole anti-livelock rule, and it costs one comparison.
    if (Number.isFinite(beforeExit) && Number.isFinite(afterExit) && afterExit > beforeExit) {
      return { intentClass: ACTOR_INTENT_CLASS.MOBILE_RETREAT, intentTag: "mobile_retreat" };
    }
    return { intentClass: ACTOR_INTENT_CLASS.MOBILE_LATERAL, intentTag: "mobile_lateral" };
  }
  if (action.kind === "equip_affinity" || action.kind === "take") {
    return { intentClass: ACTOR_INTENT_CLASS.WAIT, intentTag: action.kind };
  }
  if (action.kind === "wait") {
    return { intentClass: ACTOR_INTENT_CLASS.WAIT, intentTag: "wait" };
  }
  return none;
}

/**
 * The intent the winning candidate carried, read back out of the request envelope.
 *
 * WHY THIS IS READING AND NOT RE-DERIVING. The decision objective is SELF-DESCRIBING: it
 * publishes `order` (the member names) alongside each candidate's `rank` (the integers), so
 * `rank[order.indexOf("intentClass")]` is the value the posing persona itself computed and
 * published. Nothing here re-decides what an action means, which is the whole point — the
 * Actor already classified it once, and a second classifier in glue would be the second
 * authority `classifyActorIntent`'s header exists to forbid.
 *
 * WHY IT IS NEEDED AT ALL. On the runtime-decision route the persona emits NO action during
 * decide — only a solver request — so it has nothing to surface an intention from. Measured:
 * 17/17 advances on that path produced zero actions and zero intentions, which silently
 * collapsed the Moderator's actor ordering to its alphabetical tie-break on exactly the path
 * that has the richest intent data. The chosen action first exists here, so the intention
 * does too.
 *
 * Returns null rather than a default whenever the envelope cannot supply the value: an
 * intention invented from a missing rank would order actors on a fiction.
 */
export function resolveIntentFromDecision({ solverRequest, selectedActionId } = {}) {
  const nonEmpty = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  if (!isObject(solverRequest) || !nonEmpty(selectedActionId)) return null;
  const envelope = isObject(solverRequest.problem?.data) ? solverRequest.problem.data : null;
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) return null;
  const actorId = nonEmpty(envelope.actor?.id);
  if (!actorId) return null;
  const objective = isObject(envelope.objectives) ? envelope.objectives.actorDecision : null;
  if (!isObject(objective) || !Array.isArray(objective.order) || !Array.isArray(objective.candidates)) {
    return null;
  }
  const intentIndex = objective.order.indexOf("intentClass");
  if (intentIndex < 0) return null;
  const winner = objective.candidates.find(
    (row) => isObject(row) && row.candidateActionId === selectedActionId,
  );
  if (!isObject(winner) || !Array.isArray(winner.rank)) return null;
  const intentClass = winner.rank[intentIndex];
  if (!Number.isFinite(intentClass)) return null;
  const tag = Array.isArray(winner.rationaleTags) ? nonEmpty(winner.rationaleTags[0]) : null;
  return {
    actorId,
    intentClass: Number(intentClass),
    intentTag: tag || "unknown",
    tick: Number.isInteger(envelope.tick) ? envelope.tick : 0,
  };
}

export const actorSubscribePhases = Object.freeze([TickPhases.OBSERVE, TickPhases.DECIDE]);

const SOLVER_ENGINE = "z3";


// CR.6 — AFFINITY_EXPRESSION_IDS, MOTIVATION_IDS, normalizeMotivationTier,
// resolveMotivationId, resolveAffinityExpressionId, hasBudgetAllowance and
// filterBudgetedProposals all moved to
// personas/allocator/proposal-admissibility.js. They existed only to serve the
// budget filter, and they resolved ids priced in the Allocator's base-costs.json —
// the Actor was reading the Allocator's price-list vocabulary to judge its own
// proposals. The Actor now emits candidates and the runner asks the Allocator.

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEligibleActor(actorId, view, observation) {
  if (!actorId) return false;
  const actor = resolveActorRecord(view, actorId, observation);
  return Boolean(actor) && actor.lifecycle !== "defeated" && actor.lifecycle !== "exited";
}


// CR.6 — resolves from the payload ONLY. This used to fall back to a
// `lastObservation` cached in the persona closure, which meant a propose could be
// decided from an observation the caller had not supplied on that call.
function resolveObservation(payload) {
  if (payload?.observation) return payload.observation;
  if (Array.isArray(payload?.observations) && payload.observations.length > 0) {
    return payload.observations[0];
  }
  if (payload?.view) return payload.view;
  return null;
}


// CR.6 — the `if (lastBaseTiles) return lastBaseTiles` rung is gone; tiles come
// from this call's payload, this call's observation view, or this call's simConfig.



function resolveConfiguredActor(payload, actorId) {
  const actors = Array.isArray(payload?.initialState?.actors) ? payload.initialState.actors : [];
  if (!actorId) return actors[0] || null;
  return actors.find((actor) => actor?.id === actorId) || null;
}



function buildCandidateActionId(proposal, index, actorPosition = null) {
  if (!proposal || typeof proposal !== "object") {
    return `candidate_${index + 1}`;
  }
  if (typeof proposal.candidateId === "string" && proposal.candidateId.trim()) {
    return proposal.candidateId.trim();
  }
  const kind = typeof proposal.kind === "string" && proposal.kind.trim()
    ? proposal.kind.trim().toLowerCase()
    : "candidate";
  const params = isObject(proposal.params) ? proposal.params : proposal;
  if (kind === "move") {
    const target = isObject(params.target) ? params.target : null;
    if (actorPosition && Number.isInteger(target?.x) && Number.isInteger(target?.y)) {
      const direction = DEFAULT_DELTAS.find((entry) => entry.dx === target.x - actorPosition.x
        && entry.dy === target.y - actorPosition.y)?.direction;
      if (direction) return `move_${direction}`;
    }
  }
  const targetId = typeof params.targetId === "string" && params.targetId.trim()
    ? params.targetId.trim()
    : null;
  if (targetId) {
    if (kind === "take") return `take:${encodeURIComponent(targetId)}:${encodeURIComponent(params.holdingId)}`;
    return `${kind}_${targetId}`;
  }
  return `${kind}_${index + 1}`;
}

function cloneCandidateParams(proposal) {
  if (!proposal || typeof proposal !== "object") {
    return {};
  }
  if (isObject(proposal.params)) {
    return { ...proposal.params };
  }
  return { ...proposal };
}

function buildRuntimeDecisionCandidateActions({ actor, actorId, tick, proposals = [], tileKinds, baseTiles }) {
  const baseCandidates = [];
  const seen = new Set();
  const addCandidate = (candidateId, action) => {
    const signature = `${action.kind}:${JSON.stringify(action.params || {})}`;
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    baseCandidates.push({
      id: candidateId,
      action,
    });
  };

  const proposalList = Array.isArray(proposals) ? proposals : [];
  proposalList.forEach((proposal, index) => {
    if (!proposal || typeof proposal !== "object") {
      return;
    }
    const kind = typeof proposal.kind === "string" && proposal.kind.trim() ? proposal.kind.trim() : "custom";
    addCandidate(
      buildCandidateActionId(proposal, index, actor?.position),
      buildAction({
        tick,
        kind,
        actorId,
        personaRef: "actor",
        params: cloneCandidateParams(proposal),
      }),
    );
  });

  const movementCandidates = buildAdjacentMoveProposals({ actor, tileKinds, baseTiles });
  movementCandidates.forEach((proposal, index) => {
    addCandidate(
      buildCandidateActionId(proposal, proposalList.length + index, actor?.position),
      buildAction({
        tick,
        kind: proposal.kind,
        actorId,
        personaRef: "actor",
        params: { ...proposal.params },
      }),
    );
  });

  addCandidate(
    "wait_here",
    buildAction({
      tick,
      kind: "wait",
      actorId,
      personaRef: "actor",
    }),
  );

  return baseCandidates;
}

/**
 * The other actors this one can see, each carrying the Actor's own hostility
 * ruling for it.
 *
 * ⚠️ **`hostile` is stamped here so the SOLVER path cannot reach a different
 * answer than the deterministic one.** `resolveNearestHostile` below applies
 * `alignmentsAreAllied` and skips allies; the Z3 adapter ranks `visibleActors` and
 * had no faction concept at all, so a run routed through the solver kept
 * closing on its own allies after DS.2 fixed the other path. Sending the ruling
 * rather than the raw alignments keeps ONE allegiance authority: an adapter that
 * compared alignments itself would be free to disagree with this function — and
 * would have to re-derive the fail-safe in `alignmentsAreAllied`, which is exactly
 * the kind of quietly divergent second rule (F10) this codebase has removed
 * once already.
 *
 * The self alignment is read from the observation, the same source
 * `resolveNearestHostile` reads, so the two paths agree by construction rather
 * than by coincidence. `hostile` is always present and always a boolean:
 * unknown alignments resolve to `true`, never to a missing field, because a consumer
 * defaulting an absent flag has to guess and half of them would guess "allied".
 */
function alignmentsAreAllied(selfAlignment, otherAlignment) {
  if (typeof selfAlignment !== "string" || typeof otherAlignment !== "string") return false;
  const self = selfAlignment.trim().toLowerCase();
  const other = otherAlignment.trim().toLowerCase();
  return Boolean(self && other && self === other);
}

function decisionActorRecord(actor) {
  return projectRuntimeDecisionActor(actor);
}

function resolveVisibleActors(view, actorId) {
  const actors = Array.isArray(view?.actors) ? view.actors : [];
  const selfAlignment = actors.find(entry => entry?.id === actorId)?.alignment;
  return actors.filter(entry => entry?.id && entry.id !== actorId).map(entry => ({
    ...decisionActorRecord(entry),
    hostile: !["defeated", "exited"].includes(entry.lifecycle)
      && !alignmentsAreAllied(selfAlignment, entry.alignment),
  }));
}

function extractMotivationGoals(configuredActor) {
  const motivations = configuredActor?.motivations || configuredActor?.traits?.motivations;
  if (!Array.isArray(motivations)) return [];
  const goals = [];
  for (const entry of motivations) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.goal || typeof entry.goal !== "object") continue;
    const goal = { kind: entry.kind };
    if (typeof entry.goal.type === "string") goal.type = entry.goal.type;
    if (typeof entry.goal.objective === "string") goal.objective = entry.goal.objective;
    if (entry.goal.params && typeof entry.goal.params === "object") {
      goal.params = { ...entry.goal.params };
    }
    goals.push(goal);
  }
  return goals;
}

function buildRuntimeDecisionObjectives({ configuredActor, visibleActors, exit }) {
  const objectives = {};
  const alignment = typeof configuredActor?.alignment === "string" && configuredActor.alignment.trim()
    ? configuredActor.alignment.trim()
    : null;
  if (alignment) {
    objectives.alignment = alignment;
  }
  const seeksExit = Boolean(exit) && actorCanExit(configuredActor);
  if (visibleActors.length > 0) {
    objectives.primary = "resolve_visible_contacts";
    objectives.visibleContactCount = visibleActors.length;
  } else if (seeksExit) {
    objectives.primary = "advance_to_exit";
  }
  if (seeksExit) {
    objectives.exit = { ...exit };
  }
  const goals = extractMotivationGoals(configuredActor);
  if (goals.length > 0) {
    objectives.goals = goals;
  }
  return Object.keys(objectives).length > 0 ? objectives : undefined;
}

function candidateSignature(kind, params) {
  const normalizedKind = typeof kind === "string" && kind.trim()
    ? kind.trim().toLowerCase()
    : "custom";
  return `${normalizedKind}:${JSON.stringify(isObject(params) ? params : {})}`;
}


function nearestHostile(position, visibleActors) {
  if (!position) return null;
  let nearest = null;
  let distance = Infinity;
  for (const actor of visibleActors) {
    if (actor?.hostile !== true || !actor.position) continue;
    const nextDistance = chebyshevDistance(position, actor.position);
    if (Number.isFinite(nextDistance) && nextDistance < distance) {
      nearest = actor;
      distance = nextDistance;
    }
  }
  return nearest ? { actor: nearest, distance } : null;
}

function candidateEndPosition(action, actorPosition) {
  return action?.kind === "move" && isObject(action?.params?.target)
    ? action.params.target
    : actorPosition;
}

function targetFinishRank(target) {
  const health = target?.vitals?.health;
  if (!isObject(health) || !Number.isFinite(health.current)
    || !Number.isFinite(health.max) || health.max <= 0) return 0;
  const rank = 10000 - Math.floor((10000 * health.current) / health.max);
  return Number.isFinite(rank) ? rank : 0;
}

function isOpaqueCell(position, tileKinds, baseTiles) {
  if (!position) return false;
  if (Array.isArray(tileKinds)) return tileKinds[position.y]?.[position.x] === 1;
  const cell = Array.isArray(baseTiles) ? String(baseTiles[position.y] || "")[position.x] : null;
  return cell === "#" || cell === "B";
}

/**
 * How many of the eight neighbours are opaque, 0-8.
 *
 * Stage B: this used to be a boolean. A tile with one wall beside it and a tile wedged in
 * a corner with five scored identically, so an actor that "prefers cover" could not tell
 * good cover from technical cover and had no reason to prefer the corner. Counting is the
 * smallest change that makes the preference mean what its name says.
 */
function coverCount(position, tileKinds, baseTiles) {
  if (!position) return 0;
  return DEFAULT_DELTAS.reduce((total, { dx, dy }) => total + (isOpaqueCell(
    { x: position.x + dx, y: position.y + dy },
    tileKinds,
    baseTiles,
  ) ? 1 : 0), 0);
}

function reserveRatio(current, max) {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  const rank = Math.floor((1000 * current) / max);
  return Number.isFinite(rank) ? rank : 0;
}

function castReserveRank(action, actorRecord) {
  if (action?.kind !== "cast_affinity") return { rank: 0, source: "not_cast" };
  const mana = actorRecord?.vitals?.mana;
  return { rank: reserveRatio(mana?.current, mana?.max), source: "actor_mana" };
}

function actionCanReachTarget(action, origin, target, actorRecord) {
  const distance = chebyshevDistance(origin, target?.position);
  if (!Number.isFinite(distance)) return false;
  if (action?.kind !== "cast_affinity") return false;
  const named = action.params?.affinityKey;
  const pair = named === undefined ? castableSlots(actorRecord)[0]
    : equippedSlots(actorRecord).find(entry => `${entry.kind}:${entry.expression}` === named);
  return actorRecord?.capabilities?.canCast !== false
    && Boolean(pair && ["push", "pull"].includes(pair.expression) && distance <= pair.stacks);
}

/**
 * The record's equipped affinity entries, in equip order (the first is the active key), at
 * the stacks they run at: a slot run below what is held reaches and costs that level (#230).
 */
function equippedSlots(actorRecord) {
  const affinities = Array.isArray(actorRecord?.affinities) ? actorRecord.affinities : [];
  const running = actorRecord?.equippedAffinityStacks ?? {};
  return equippedActorAffinityKeys(actorRecord).flatMap((key) => {
    const wanted = String(key).trim().toLowerCase();
    const entry = affinities.find((pair) =>
      `${String(pair?.kind).trim().toLowerCase()}:${String(pair?.expression).trim().toLowerCase()}` === wanted);
    if (!entry) return [];
    return [Number.isInteger(running[key]) ? { ...entry, stacks: running[key] } : entry];
  });
}

/** Equipped push/pull slots in equip order; core casts the first unless a cast names one. */
function castableSlots(actorRecord) {
  return equippedSlots(actorRecord).filter((entry) =>
    ["push", "pull"].includes(String(entry.expression).trim().toLowerCase()));
}

/** The record as core's equip would leave it: a free slot, the named one, or the oldest replaced. */
function recordAfterEquip(actorRecord, params) {
  const next = structuredClone(actorRecord);
  if (!equipActorAffinity(next, params.affinityKey, params.replaceKey, params.stacks)) {
    return { ...actorRecord, activeAffinityKey: params.affinityKey };
  }
  return next;
}

function fieldUtilityRanks({ endPosition, affinityFields, affinityContributions, actorRecord, action }) {
  const receiver = action?.kind === "equip_affinity" && actorRecord
    ? recordAfterEquip(actorRecord, action.params) : actorRecord;
  const fields = Array.isArray(affinityContributions) && receiver
    ? projectActorEquipmentFields({ ...receiver, position: endPosition }, endPosition, affinityContributions)
    : (Array.isArray(affinityFields) ? affinityFields : []).filter(field =>
    field.position?.x === endPosition?.x && field.position?.y === endPosition?.y);
  const changes = fields.length && receiver
    ? previewActorFieldChanges(receiver, fields) : [];
  const effectsByVital = new Map();
  for (const { vital, delta } of changes) {
    const code = Number(Object.keys(VITAL_KEYS_BY_CODE).find(key => VITAL_KEYS_BY_CODE[key] === vital));
    effectsByVital.set(code, (effectsByVital.get(code) || 0) + delta);
  }
  const effects = [...effectsByVital.entries()].sort(([left], [right]) => left - right)
    .map(([vital, effect]) => ({ vital, effect }));
  return {
    safety: -changes.reduce((sum, change) => sum + Math.max(0, -change.delta), 0),
    benefit: changes.reduce((sum, change) => sum + Math.max(0, change.delta), 0),
    effects,
  };
}

/**
 * The no-motivation-profile branch: an actor whose motivation kind core does not recognize.
 * Kept because removing it would silently drop those actors out of ranking entirely.
 *
 * ⚠️ ITS `intentClass` NOW USES `ACTOR_INTENT_CLASS`, NOT ITS OWN 100/80/50/20/10 SCALE
 * (contract v5). Two scales under one member name was harmless while nothing read the value —
 * adapters only stable-sort the tuple lexicographically, and both scales rank their own branch
 * identically. It stopped being harmless the moment the Moderator began ORDERING ACTORS by
 * rank[0]: a legacy attacker (100) and a motivated waiter (100) would have tied, and a legacy
 * attacker would have resolved after a motivated actor's mere movement (200). A value only has
 * to be internally consistent until someone compares it ACROSS producers.
 *
 * The remap is strictly monotonic (100→500, 80→400, 50→300, 20→200, 10→100, 0→0), so which
 * candidate this branch selects is unchanged — proved by `actor-decision-objective`'s legacy
 * rows, which assert the selected candidate rather than the raw score.
 */
function buildCompatibilityDecisionRows({ actor, actorRecord, visibleActors, candidateActions, exit, affinityFields, affinityContributions }) {
  const visiblePositions = visibleActors
    .filter((entry) => entry?.hostile !== false && entry?.position)
    .map((entry) => entry.position);
  const exitTarget = actorCanExit(actorRecord) && actorCanExit(actor) ? exit : null;
  return candidateActions.map((candidate, index) => {
    const action = candidate.action;
    const endPosition = candidateEndPosition(action, actor.position);
    let score = ACTOR_INTENT_CLASS.NONE;
    let ruleId = "no_match";
    if (action?.kind === "cast_affinity" && actionCanReachTarget(action, actor.position,
      visibleActors.find((entry) => entry?.id === action?.params?.targetId), actorRecord)) {
      score = ACTOR_INTENT_CLASS.IN_RANGE_COMBAT;
      ruleId = "cast_affinity";
    } else if (action?.kind === "move" && visiblePositions.some((target) => {
      const before = chebyshevDistance(actor.position, target);
      const after = chebyshevDistance(endPosition, target);
      return Number.isFinite(before) && Number.isFinite(after) && after < before;
    })) {
      score = ACTOR_INTENT_CLASS.HOSTILE_PROGRESS;
      ruleId = "move_toward_hostile";
    } else if (action?.kind === "move" && exitTarget) {
      const before = chebyshevDistance(actor.position, exitTarget);
      const after = chebyshevDistance(endPosition, exitTarget);
      if (Number.isFinite(before) && Number.isFinite(after) && after < before) {
        score = ACTOR_INTENT_CLASS.EXIT_PROGRESS;
        ruleId = "move_toward_exit";
      } else if (Number.isFinite(before) && Number.isFinite(after) && after > before) {
        score = ACTOR_INTENT_CLASS.MOBILE_RETREAT;
        ruleId = "move_retreat";
      } else {
        score = ACTOR_INTENT_CLASS.MOBILE_LATERAL;
        ruleId = "move_lateral";
      }
    } else if (action?.kind === "move") {
      // No exit to measure against, so nothing distinguishes lateral from retreat.
      score = ACTOR_INTENT_CLASS.MOBILE_LATERAL;
      ruleId = "move_lateral";
    } else if (action?.kind === "wait") {
      score = ACTOR_INTENT_CLASS.WAIT;
      ruleId = "wait";
    }
    const field = fieldUtilityRanks({ endPosition, affinityFields, affinityContributions, actorRecord, action });
    return {
      candidateActionId: candidate.id,
      rank: [score, 0, 0, 0, field.safety, field.benefit, 0, 0, -index],
      features: {
        actionKind: action?.kind,
        compatibilityRule: ruleId,
        endPosition: endPosition ? { ...endPosition } : null,
        fieldEffectsByVital: field.effects,
        fieldSafety: field.safety,
        fieldBenefit: field.benefit,
      },
      rationaleTags: [
        `legacy_${ruleId}`,
        ...(field.safety < 0 ? ["field_harm"] : []),
        ...(field.benefit > 0 ? ["field_benefit"] : []),
      ],
    };
  });
}

function compareDecisionRanks(left, right) {
  const slot = left.findIndex((value, index) => value !== right[index]);
  return slot < 0 ? 0 : left[slot] - right[slot];
}

function buildActorDecisionObjective({ motivationProfiles, ...inputs }) {
  const profiles = Array.isArray(motivationProfiles) && motivationProfiles.length > 0
    ? motivationProfiles
    : [inputs.motivationProfile];
  const objectives = profiles.map((motivationProfile) => buildProfileDecisionObjective({
    ...inputs, motivationProfile,
  }));
  const objective = objectives[0];
  if (!objective) return undefined;
  return {
    ...objective,
    candidates: objective.candidates.map((row, index) => {
      let best = row;
      for (const alternative of objectives.slice(1)) {
        const candidate = alternative?.candidates[index];
        if (!candidate) continue;
        if (compareDecisionRanks(candidate.rank, best.rank) > 0) best = candidate;
      }
      return best;
    }),
  };
}

function buildProfileDecisionObjective({
  actor,
  actorRecord,
  motivationProfile,
  visibleActors,
  affinityFields,
  affinityContributions,
  candidateActions,
  proposals,
  exit,
  tileKinds,
  baseTiles,
}) {
  if (!motivationProfile) {
    const rows = buildCompatibilityDecisionRows({
      actor,
      actorRecord,
      visibleActors,
      candidateActions,
      exit,
      affinityFields,
      affinityContributions,
    });
    if (new Set(rows.map((entry) => entry.candidateActionId)).size !== rows.length) return undefined;
    return {
      contract: ACTOR_DECISION_OBJECTIVE_CONTRACT,
      order: [...ACTOR_DECISION_OBJECTIVE_ORDER],
      candidates: rows,
    };
  }
  const proposalSignatures = new Set((Array.isArray(proposals) ? proposals : [])
    .filter(isObject)
    .map((proposal) => candidateSignature(proposal.kind, isObject(proposal.params) ? proposal.params : proposal)));
  const flags = Array.isArray(motivationProfile.flags) ? motivationProfile.flags : [];
  const beforeHostile = nearestHostile(actor.position, visibleActors);
  const rows = candidateActions.map((candidate, index) => {
    const action = candidate.action;
    const endPosition = candidateEndPosition(action, actor.position);
    const afterHostile = nearestHostile(endPosition, visibleActors);
    const explicitTargetId = typeof action?.params?.targetId === "string" ? action.params.targetId : null;
    const explicitTarget = explicitTargetId
      ? visibleActors.find((entry) => entry?.id === explicitTargetId && entry.hostile === true)
      : null;
    const target = explicitTarget || (action?.kind === "move" ? afterHostile?.actor : null);
    const actorProposal = proposalSignatures.has(candidateSignature(action?.kind, action?.params));
    const { intentClass, intentTag } = classifyActorIntent({
      action,
      actorPosition: actor.position,
      actorRecord,
      motivationProfile,
      visibleActors,
      exit,
    });
    // Raw counts, not scaled: each is its own lexicographic member now, so nothing can
    // swamp anything. An actor without the flag scores 0 and is simply indifferent.
    const coverRank = flags.includes("PrefersCover")
      ? coverCount(endPosition, tileKinds, baseTiles)
      : 0;
    const stealthRank = flags.includes("PrefersStealth") && beforeHostile && afterHostile
      ? afterHostile.distance - beforeHostile.distance
      : 0;
    const field = fieldUtilityRanks({ endPosition, affinityFields, affinityContributions, actorRecord, action });
    const reserve = castReserveRank(action, actorRecord);
    const rationaleTags = [intentTag];
    if (actorProposal) rationaleTags.push("actor_proposal");
    if (coverRank) rationaleTags.push("prefers_cover");
    if (stealthRank) rationaleTags.push("prefers_stealth");
    if (field.safety < 0) rationaleTags.push("field_harm");
    if (field.benefit > 0) rationaleTags.push("field_benefit");
    if (action?.kind === "cast_affinity") rationaleTags.push(`${reserve.source}_reserve`);
    return {
      candidateActionId: candidate.id,
      rank: [
        intentClass,
        targetFinishRank(target),
        coverRank,
        stealthRank,
        field.safety,
        field.benefit,
        reserve.rank,
        actorProposal ? 1 : 0,
        -index,
      ],
      features: {
        actionKind: action?.kind,
        actorProposal,
        endPosition: endPosition ? { ...endPosition } : null,
        targetId: target?.id || null,
        mobilityTier: motivationProfile.mobilityTier,
        combatTier: motivationProfile.combatTier,
        cognitionTier: motivationProfile.cognitionTier,
        reasoningClass: motivationProfile.reasoningClass,
        reasoningClassName: motivationProfile.reasoningClassName,
        flags: [...flags],
        beforeMinHostileDistance: beforeHostile?.distance ?? null,
        afterMinHostileDistance: afterHostile?.distance ?? null,
        fieldEffectsByVital: field.effects,
        fieldSafety: field.safety,
        fieldBenefit: field.benefit,
        castReserveSource: reserve.source,
      },
      rationaleTags,
    };
  });
  if (new Set(rows.map((entry) => entry.candidateActionId)).size !== rows.length) return undefined;
  return {
    contract: ACTOR_DECISION_OBJECTIVE_CONTRACT,
    order: [...ACTOR_DECISION_OBJECTIVE_ORDER],
    candidates: rows,
  };
}

function buildRuntimeDecisionConstraints({ actorRecord }) {
  const vitals = isObject(actorRecord?.vitals) ? actorRecord.vitals : null;
  if (!vitals) {
    return undefined;
  }
  const constraints = {};
  ["health", "mana", "stamina", "durability"].forEach((key) => {
    if (isObject(vitals[key])) {
      constraints[key] = {
        current: Number.isFinite(vitals[key].current) ? vitals[key].current : 0,
        max: Number.isFinite(vitals[key].max) ? vitals[key].max : 0,
      };
    }
  });
  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function resolveRuntimeDecisionConfig({ payload, actorId, view, observation }) {
  const configuredActor = resolveConfiguredActor(payload, actorId);
  const actorRecord = resolveActorRecord(view, actorId, observation);
  const actorTraits = isObject(configuredActor?.traits) ? configuredActor.traits : {};
  const runtimeDecisioning = payload?.runtimeDecisioning;
  const payloadDecisioning = runtimeDecisioning === true ? { enabled: true } : isObject(runtimeDecisioning) ? runtimeDecisioning : {};
  const configuredPolicy = isObject(configuredActor?.providerPolicy)
    ? configuredActor.providerPolicy
    : isObject(actorTraits.providerPolicy)
      ? actorTraits.providerPolicy
      : {};
  const mode = payloadDecisioning.mode
    || configuredActor?.decisionMode
    || actorTraits.decisionMode
    || configuredActor?.decisionProvider
    || actorTraits.decisionProvider
    || configuredPolicy.mode
    || configuredPolicy.preferred;
  const preferred = payloadDecisioning.preferred
    || configuredActor?.decisionProvider
    || actorTraits.decisionProvider
    || configuredPolicy.preferred;
  const enabled = payloadDecisioning.enabled === true
    || configuredActor?.runtimeDecisioning === true
    || actorTraits.runtimeDecisioning === true
    || Boolean(mode)
    || Boolean(preferred);
  if (!enabled) {
    return null;
  }
  const providerPolicy = resolveRuntimeDecisionProviderPolicy({
    ...configuredPolicy,
    ...(isObject(payloadDecisioning.providerPolicy) ? payloadDecisioning.providerPolicy : {}),
    ...(mode ? { mode } : {}),
    ...(preferred ? { preferred } : {}),
    ...(payloadDecisioning.liveLlmMode ? { liveLlmMode: payloadDecisioning.liveLlmMode } : {}),
    ...(payloadDecisioning.model ? { model: payloadDecisioning.model } : {}),
    ...(payloadDecisioning.baseUrl ? { baseUrl: payloadDecisioning.baseUrl } : {}),
    ...(payloadDecisioning.format ? { format: payloadDecisioning.format } : {}),
    ...(isObject(payloadDecisioning.options) ? { options: payloadDecisioning.options } : {}),
  });
  return {
    actorRecord,
    configuredActor,
    providerPolicy,
    liveLlmRuntime: allowsLiveLlmRuntime(providerPolicy),
    targetAdapter: payloadDecisioning.targetAdapter
      || payload?.targetAdapter
      || (providerPolicy.preferred === "llm" ? "ollama" : undefined),
  };
}

function buildArtifactRef(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return undefined;
  }
  if (!artifact.schema || !artifact.schemaVersion || !artifact.meta?.id) {
    return undefined;
  }
  return {
    id: artifact.meta.id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

function buildRuntimeDecisionSolverRequest({ envelope, payload, actorId, tick, clock }) {
  const requestId = `solver_runtime_decision_${actorId || "actor"}_${tick}`;
  const providerPolicy = resolveRuntimeDecisionProviderPolicy(envelope?.providerPolicy);
  const request = {
    schema: SOLVER_REQUEST_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: requestId,
      runId: payload?.runId || "run_runtime_decision",
      createdAt: clock(),
      producedBy: "actor",
    },
    problem: {
      language: "custom",
      data: envelope,
    },
    options: {
      engine: providerPolicy.preferred === "llm" ? "custom" : SOLVER_ENGINE,
      params: {
        contract: RUNTIME_DECISION_CONTRACT,
        decisionKind: envelope.decisionKind,
        actorId,
        provider: providerPolicy.preferred,
      },
    },
  };
  const intentRef = buildArtifactRef(payload?.intentEnvelope) || payload?.intentRef;
  const planRef = buildArtifactRef(payload?.planArtifact) || payload?.planRef;
  const simConfigRef = buildArtifactRef(payload?.simConfig);
  if (intentRef) request.intentRef = intentRef;
  if (planRef) request.planRef = planRef;
  if (simConfigRef) request.simConfigRef = simConfigRef;
  return request;
}

function buildRuntimeDecisionEffect({ payload, observation, view, actorId, tick, baseTiles, exit }) {
  const decisionConfig = resolveRuntimeDecisionConfig({ payload, actorId, view, observation });
  if (!decisionConfig) {
    return null;
  }
  const actor = resolveActor(view, actorId, observation);
  const actorRecord = decisionConfig.actorRecord || resolveActorRecord(view, actorId, observation);
  if (!actor || !actorRecord) {
    return null;
  }
  const tileKinds = resolveTileKinds(view, payload);
  const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const candidateActions = buildRuntimeDecisionCandidateActions({
    actor,
    actorId,
    tick,
    proposals,
    tileKinds,
    baseTiles,
  });
  if (candidateActions.length === 0) {
    return null;
  }
  const visibleActors = resolveVisibleActors(view, actorId);
  const affinityFields = Array.isArray(observation?.affinityFields) ? observation.affinityFields : [];
  const motivationProfile = buildMotivationProfile(view, actorId, payload);
  const baseObjectives = buildRuntimeDecisionObjectives({
    configuredActor: decisionConfig.configuredActor,
    visibleActors,
    exit,
  });
  const actorDecision = buildActorDecisionObjective({
    actor,
    actorRecord,
    motivationProfile,
    motivationProfiles: resolveActorMotivationKinds(view, actorId, payload)
      .map((kind) => buildMotivationProfile(view, actorId, payload, kind))
      .filter(Boolean),
    visibleActors,
    affinityFields,
    affinityContributions: observation?.affinityContributions,
    candidateActions,
    proposals,
    exit,
    tileKinds,
    baseTiles,
  });
  const objectives = actorDecision
    ? { ...(baseObjectives || {}), actorDecision }
    : baseObjectives;
  const envelope = buildRuntimeDecisionEnvelope({
    decisionKind: "next_move",
    phase: "decide",
    tick,
    actor: { ...decisionActorRecord(actorRecord), id: actorId, motivationProfile },
    visibleActors,
    candidateActions,
    objectives,
    constraints: buildRuntimeDecisionConstraints({ actorRecord }),
    providerPolicy: decisionConfig.providerPolicy,
  });
  const solverEffect = buildSolverRequestEffect({
    solverRequest: buildRuntimeDecisionSolverRequest({
      envelope,
      payload,
      actorId,
      tick,
      // PX.3: no wall-clock fallback. advance() spreads the persona's own
      // requireClock-validated clock into this payload, so the old `||` default was
      // unreachable — and it stamped the solver request's createdAt, which crosses
      // the adapter boundary.
      clock: requireClock(payload?.clock, "actor"),
    }),
    intentRef: payload?.intentRef,
    planRef: payload?.planRef,
    personaRef: "actor",
    targetAdapter: decisionConfig.targetAdapter,
  });
  if (!solverEffect) {
    return null;
  }
  return {
    envelope,
    solverEffect,
  };
}





/**
 * PATROLLING: a clockwise circuit of the actor's own room.
 *
 * Before this, `patrolling` had no branch at all. Core's profile table gives it mobility
 * 2 — the highest tier — and combat 0, so it cleared the holds-position guard, matched no
 * combat branch, and fell through to `buildMoveProposal`: shortest path to the level
 * exit. Every patrolling actor walked to the one exit tile alongside everybody else. In a
 * measured 100-tick run that produced 579 `ActorCollision` rejections and three wardens
 * that never moved (#169). The motivation named for patrolling left the fastest.
 *
 * ⚠️ STATELESS BY REQUIREMENT, NOT BY PREFERENCE. The next cell is a pure function of the
 * current cell and the room rectangle. Persona context must stay serializable and the
 * Actor carries nothing between ticks, so a patrol that remembered its next waypoint
 * would need the runner to thread that state — the problem #162 is still open on. A
 * circuit needs no memory because the ring itself encodes the order.
 */





// ── M5: Simple motivation helpers ──────────────────────────────────────────

/**
 * Read the motivation kind string from the self-actor in the observation view.
 * Returns null if not found.
 */
/**
 * Resolve the motivation.kind for the actor.
 * Checks (in order):
 *   1. observation view actors (motivation set inline, e.g. in tests)
 *   2. payload.initialState.actors (runtime path — motivation stored in config, not core)
 */
function resolveActorMotivationKind(view, actorId, payload) {
  const kinds = resolveActorMotivationKinds(view, actorId, payload);
  return kinds[0] || null;
}

/**
 * Every motivation this actor carries, primary first. Prefers the plural
 * `motivations` list when present; falls back to the singular `motivation.kind`.
 */
function resolveActorMotivationKinds(view, actorId, payload) {
  const fromView = Array.isArray(view?.actors)
    ? view.actors.find((a) => a && a.id === actorId)
    : null;
  const fromConfig = Array.isArray(payload?.initialState?.actors)
    ? payload.initialState.actors.find((a) => a && a.id === actorId)
    : null;
  const record = fromView || fromConfig;
  const list = record?.motivations;
  if (Array.isArray(list) && list.length > 0) {
    const kinds = [];
    const seen = new Set();
    for (const entry of list) {
      const kind = typeof entry === "string" ? entry : entry?.kind;
      if (typeof kind !== "string" || !kind) continue;
      if (seen.has(kind)) continue;
      seen.add(kind);
      kinds.push(kind);
    }
    if (kinds.length > 0) return kinds;
  }
  const single = fromView?.motivation?.kind || fromConfig?.motivation?.kind || null;
  return single ? [single] : [];
}

function resolveActorMotivationParams(view, actorId, payload, kind) {
  const fromView = Array.isArray(view?.actors)
    ? view.actors.find((a) => a && a.id === actorId)
    : null;
  const fromConfig = Array.isArray(payload?.initialState?.actors)
    ? payload.initialState.actors.find((a) => a && a.id === actorId)
    : null;
  const record = fromView || fromConfig;
  const list = record?.motivations;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (entry && typeof entry === "object" && entry.kind === kind) {
        return {
          pattern: entry.pattern || null,
          flags: entry.flags,
          goal: entry.goal,
        };
      }
    }
  }
  if (record?.motivation?.kind === kind) {
    return {
      pattern: record.motivation.pattern || null,
      flags: record.motivation.flags,
      goal: record.motivation.goal,
    };
  }
  return null;
}

/**
/**
 * Find the nearest HOSTILE actor by Chebyshev distance, skipping allies.
 * Returns { actor, distance } or null if no hostile actor exists.
 *
 * Before DS.2 this took "any actor other than self", which was not merely
 * imprecise — it was wrong: with two delvers on the board, delver A closed on
 * and attacked delver B whenever B was nearer than a warden.
 */
function resolveNearestHostile(view, actorId) {
  if (!view?.actors || !Array.isArray(view.actors)) return null;
  const selfActor = view.actors.find((a) => a && a.id === actorId);
  if (!selfActor?.position) return null;

  let nearest = null;
  let nearestDist = Infinity;
  for (const other of view.actors) {
    if (!other || other.id === actorId || !other.position) continue;
    if (["defeated", "exited"].includes(other.lifecycle)) continue;
    if (alignmentsAreAllied(selfActor.alignment, other.alignment)) continue;
    const dist = Math.max(
      Math.abs(other.position.x - selfActor.position.x),
      Math.abs(other.position.y - selfActor.position.y),
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { actor: other, distance: dist };
    }
  }
  return nearest;
}

/**
 * Motivation-aware proposal builder. Routes to an affinity cast or hostile
 * pursuit before falling back to the existing exit pathfinding. There is no
 * conventional attack: harm is an equipped push or pull (range = stacks).
 *
 * Rules (from M1 contract):
 *   attacking  + hostile in cast range  → cast_affinity
 *   attacking  + out of range           → move toward hostile
 *   defending  + hostile in cast range  → cast_affinity
 *   defending  + out of range           → wait (no action)
 *   stationary                     → wait (no action)
 *   any        + no hostile        → existing exit pathfinding
 */
// ── M3: Random motivation helpers ──────────────────────────────────────────
//
// Deterministic, seed-derived pseudo-random selection — never Math.random(),
// never a clock read. The RNG is a pure function of (seed, actorId, tick):
// same inputs always produce the same output, independent of instance or
// call history, satisfying both the "identical seed -> identical trajectory"
// and "no shared mutable RNG state" requirements.


/** Deterministic 32-bit hash of a seed/actorId/tick tuple (no Math.random, no clock). */

/** Pure deterministic RNG value in [0, 1) derived from seed + actorId + tick + salt. */



/**
 * Random motivation: choose among legal adjacent walkable, unoccupied tiles
 * using a deterministic seed-derived RNG. If the first choice is blocked,
 * bounce to another legal candidate (deterministically re-ordered, not
 * re-rolled with fresh entropy). If no legal adjacent tile exists, wait.
 *
 * `payload.reservedTargets` (array of {x,y}) carries move targets already
 * claimed by other actors earlier in the same DECIDE phase — the runtime
 * advances the actor persona once per actor per tick (see
 * packages/runtime/src/runner/runtime-fsm.mjs), so without this, two
 * actors evaluated in the same tick could both choose an identical
 * currently-unoccupied tile before core state is updated at APPLY time.
 */
/**
 * AM.6 — choose an affinity this actor can actually land on `hostile`, if any.
 *
 * Deterministic: affinities are compared in a stable order (kind, then
 * expression) and the first that can reach wins, so two Actors given the same
 * observation propose the same cast.
 *
 * Reach mirrors core exactly (rules/affinity-damage.ts):
 *   push / pull  single target, Chebyshev distance <= stacks
 *   emit / draw  diffuse; the caller iterates an area, so a directed cast at a
 *                specific target is only proposed when already adjacent
 * Proposing something core would refuse would show up as an accepted action that
 * changed nothing, which is the class of lie AM.1 exists to prevent.
 */
/**
 * AM.9 — does this motivation hold position?
 *
 * Answered from core's profile table rather than a name list here. `random`,
 * `exploring`, `patrolling`, `attacking`, `stealthy` and `friendly` carry a
 * mobility tier above 0; the rest hold position. An unknown name is treated as
 * mobile, which preserves the previous default for anything outside the
 * vocabulary rather than silently freezing it.
 */
function motivationHoldsPosition(motivationKind) {
  if (typeof motivationKind !== "string" || !motivationKind.trim()) return false;
  const code = MOTIVATION_KIND_CODES[motivationKind.trim().toLowerCase()];
  if (!Number.isFinite(code)) return false;
  return getMotivationMobilityTier(code) === 0;
}

/** AM.9 — combat tier: none=0, attacking=1, defending=2. */
function motivationHasCombatRole(motivationKind) {
  if (typeof motivationKind !== "string" || !motivationKind.trim()) return false;
  const code = MOTIVATION_KIND_CODES[motivationKind.trim().toLowerCase()];
  if (!Number.isFinite(code)) return false;
  return getMotivationCombatTier(code) > 0;
}

function buildAffinityCastProposal({ actor, actorRecord, hostile }) {
  if (actorRecord?.capabilities?.canCast === false) return null;
  const slots = castableSlots(actorRecord);
  if (slots.length === 0) return null;

  const distance = Number.isFinite(hostile?.distance)
    ? hostile.distance
    : Math.max(
      Math.abs((hostile?.actor?.position?.x ?? 0) - actor.position.x),
      Math.abs((hostile?.actor?.position?.y ?? 0) - actor.position.y),
    );

  // The first equipped push/pull that reaches; named only when core would not pick it.
  const reaching = slots.find((entry) => distance <= (Number.isInteger(entry.stacks) && entry.stacks > 0 ? entry.stacks : 1));
  if (!reaching) return null;
  if (reaching === slots[0]) return { kind: "cast_affinity", params: { targetId: hostile.actor.id } };
  return { kind: "cast_affinity", params: { targetId: hostile.actor.id,
    affinityKey: `${String(reaching.kind).trim().toLowerCase()}:${String(reaching.expression).trim().toLowerCase()}` } };
}


function buildTakingProposals(receiver, view) {
  if (receiver?.lifecycle !== "alive" || !receiver.capabilities?.canTake) return [];
  const sources = (Array.isArray(view?.actors) ? view.actors : [])
    .filter(source => source.lifecycle === "defeated"
      && chebyshevDistance(receiver.position, source.position) <= 1)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return sources.flatMap(source => (Array.isArray(source.holdings) ? source.holdings : [])
    .filter(holding => holding.claimedBy === null)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map(holding => ({ kind: "take", params: { targetId: source.id, holdingId: holding.id } })));
}

function buildEquipmentProposals(actorRecord, observation, view, payload) {
  if (actorRecord?.lifecycle !== "alive" || !actorRecord.capabilities?.canEquip
    || !Array.isArray(observation?.affinityContributions)) return [];
  const evaluation = { endPosition: actorRecord.position, actorRecord,
    affinityFields: observation.affinityFields, affinityContributions: observation.affinityContributions };
  const hostile = resolveNearestHostile(view, actorRecord.id);
  const profiles = resolveActorMotivationKinds(view, actorRecord.id, payload)
    .map(kind => buildMotivationProfile(view, actorRecord.id, payload, kind)).filter(Boolean);
  const readiness = (receiver) => {
    const cast = hostile && buildAffinityCastProposal({ actor: receiver, actorRecord: receiver, hostile });
    if (!cast) return ACTOR_INTENT_CLASS.WAIT;
    return Math.max(ACTOR_INTENT_CLASS.WAIT, ...profiles.map(motivationProfile => classifyActorIntent({
      action: cast, actorPosition: receiver.position, actorRecord: receiver, motivationProfile,
      visibleActors: [{ ...hostile.actor, hostile: true }],
    }).intentClass));
  };
  // Same target and position: readiness, field safety and benefit are the tuple
  // members that can differ across equipment. The equip itself still takes a turn.
  const currentField = fieldUtilityRanks(evaluation);
  const current = [readiness(actorRecord), currentField.safety, currentField.benefit];
  // A free slot is filled; with full slots the oldest makes way, so the
  // comparison against the current loadout already prices what would be lost.
  const equipped = equippedActorAffinityKeys(actorRecord);
  return actorRecord.affinities.flatMap(pair => {
    const affinityKey = `${pair.kind}:${pair.expression}`;
    if (equipped.includes(affinityKey)) return [];
    const action = { kind: "equip_affinity", params: { affinityKey } };
    const alternative = fieldUtilityRanks({ ...evaluation, action });
    return compareDecisionRanks([readiness(recordAfterEquip(actorRecord, action.params)), alternative.safety, alternative.benefit], current) > 0
      ? [action] : [];
  });
}

function buildMotivatedProposals({ observation, payload, simConfig, personaSeed }) {
  const view = resolveObservationView(observation);
  if (!view) return buildMoveProposal({ observation, payload, simConfig });

  const actorId = payload?.actorId;
  const actor = resolveActor(view, actorId, observation);
  if (!actor?.position) return buildMoveProposal({ observation, payload, simConfig });

  const kinds = resolveActorMotivationKinds(view, actorId, payload);
  // Each motivation contributes candidates; only the actor's capability vetoes
  // movement across the union. A stationary preference cannot erase a patrol.
  const record = resolveActorRecord(view, actorId, observation);
  const holdsPosition = record?.capabilities?.canMove === false
    || (kinds.length > 0 && kinds.every((kind) => motivationHoldsPosition(kind)));
  const hasCombatRole = kinds.some((kind) => motivationHasCombatRole(kind));

  const composed = [];
  const seen = new Set();
  const pushUnique = (proposals) => {
    if (!Array.isArray(proposals)) return;
    for (const proposal of proposals) {
      if (!proposal || typeof proposal !== "object") continue;
      const signature = `${proposal.kind}:${JSON.stringify(proposal.params || {})}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      composed.push(proposal);
    }
  };

  for (const kind of kinds) {
    const motivationModule = getMotivationModule(kind);
    if (!motivationModule) continue;
    const params = resolveActorMotivationParams(view, actorId, payload, kind);
    pushUnique(motivationModule.propose({
      actor,
      view,
      observation,
      payload,
      simConfig,
      personaSeed,
      params,
    }));
  }

  pushUnique(buildEquipmentProposals(record, observation, view, payload));
  pushUnique(buildTakingProposals(record, view));

  // Combat stays owned by the controller for now (MC.3/MC.5): collect proposals
  // into the same candidate set so the existing intentClass tuple can arbitrate
  // between an affinity cast and a patrol step.
  if (hasCombatRole) {
    pushUnique(buildCombatProposals({
      observation,
      payload,
      simConfig,
      view,
      actor,
      actorId,
      kinds,
      holdsPosition,
      hasCombatRole,
    }));
  }

  const filtered = holdsPosition
    ? composed.filter((proposal) => proposal.kind !== "move")
    : composed;
  if (filtered.length > 0) return filtered;
  if (holdsPosition) return [];

  return buildMoveProposal({ observation, payload, simConfig });
}

export const ACTOR_COMMAND_KINDS = Object.freeze(["move", "wait", "equip_affinity", "unequip_affinity", "cast_affinity", "take"]);

const AFFINITY_KEY_PATTERN = /^[a-z]+:[a-z]+$/;

function commandParam(command, name, valid) {
  const value = command.params?.[name];
  if (!valid(value)) {
    throw new Error(`Actor command: ${command.kind} needs params.${name} (received ${JSON.stringify(value)}).`);
  }
  return value;
}

const isId = (value) => typeof value === "string" && value.trim().length > 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isAffinityKey = (value) => typeof value === "string" && AFFINITY_KEY_PATTERN.test(value);

/**
 * The command vocabulary is the Actor's:
 *   - `{ kind: "move", params: { direction } }` (an EIGHT_WAY direction name)
 *   - `{ kind: "wait" }`
 *   - `{ kind: "equip_affinity", params: { affinityKey, replaceKey?, stacks? } }` ("<kind>:<expression>";
 *     `replaceKey` names the equipped slot to swap out, else core fills a free slot or the oldest;
 *     `stacks` runs it below what is held, and re-equipping an equipped key re-levels it)
 *   - `{ kind: "unequip_affinity", params: { affinityKey } }`
 *   - `{ kind: "cast_affinity", params: { targetId, affinityKey? } }` (`affinityKey` names the
 *     equipped slot; without it core casts the first equipped push or pull)
 *   - `{ kind: "take", params: { targetId, holdingId } }`
 * Only the SHAPE is checked here; whether the actor knows that affinity, can reach that
 * target or afford the cast is core's call. Exported so the runner can refuse a malformed
 * command BEFORE a tick starts rather than half-way through DECIDE. Throws rather than
 * letting a controlled actor fall back to autonomous play.
 */
export function normalizeActorCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("Actor command must be an object { kind, params }.");
  }
  if (!ACTOR_COMMAND_KINDS.includes(command.kind)) {
    throw new Error(`Actor command: unknown command kind ${JSON.stringify(command.kind)} (expected ${ACTOR_COMMAND_KINDS.join(", ")}).`);
  }
  switch (command.kind) {
    case "wait":
      return { kind: "wait" };
    case "equip_affinity": {
      const params = { affinityKey: commandParam(command, "affinityKey", isAffinityKey) };
      if (command.params?.replaceKey !== undefined) params.replaceKey = commandParam(command, "replaceKey", isAffinityKey);
      if (command.params?.stacks !== undefined) params.stacks = commandParam(command, "stacks", isPositiveInteger);
      return { kind: "equip_affinity", params };
    }
    case "unequip_affinity":
      return { kind: "unequip_affinity", params: { affinityKey: commandParam(command, "affinityKey", isAffinityKey) } };
    case "cast_affinity": {
      const params = { targetId: commandParam(command, "targetId", isId) };
      if (command.params?.affinityKey !== undefined) params.affinityKey = commandParam(command, "affinityKey", isAffinityKey);
      return { kind: "cast_affinity", params };
    }
    case "take":
      return { kind: "take", params: {
        targetId: commandParam(command, "targetId", isId),
        holdingId: commandParam(command, "holdingId", isId),
      } };
    default: {
      const direction = command.params?.direction;
      if (!DEFAULT_DELTAS.some((entry) => entry.direction === direction)) {
        throw new Error(`Actor command: unknown direction ${JSON.stringify(direction)} (expected ${DEFAULT_DELTAS.map((e) => e.direction).join(", ")}).`);
      }
      return { kind: "move", params: { direction } };
    }
  }
}

/**
 * Translate a command into the actor's proposal. A move is proposed even into a wall,
 * and an affinity command even when it cannot succeed: core rejects it.
 */
function buildCommandProposals({ command, observationView, observation, actorId }) {
  const normalized = normalizeActorCommand(command);
  if (normalized.kind === "wait") {
    return [{ kind: "wait" }];
  }
  if (normalized.kind !== "move") {
    return [{ kind: normalized.kind, params: { ...normalized.params } }];
  }
  const { direction } = normalized.params;
  const delta = DEFAULT_DELTAS.find((entry) => entry.direction === direction);
  const from = resolveActor(observationView, actorId, observation)?.position;
  if (!from) return [];
  return [{
    kind: "move",
    params: { target: { x: from.x + delta.dx, y: from.y + delta.dy } },
  }];
}

/**
 * Check a strategy's shape and return its canonical form (Phase 2b). The goal and tactic
 * vocabulary is the Actor's, like the command vocabulary; whether a target exists or a
 * place can be reached is found out turn by turn. Throws on a malformed strategy.
 */
export function normalizeActorStrategy(strategy) {
  return normalizeStrategy(strategy, normalizeActorCommand);
}

/** How much of a strategy an actor with these motivations follows: none, goals, or full. */
export function actorStrategyDepth(motivationKinds) {
  return strategyDepth(motivationKinds);
}

/** The parts of a strategy an actor with these motivations ignores (reported, never refused). */
export function actorStrategyIgnoredParts(strategy, motivationKinds) {
  return ignoredStrategyParts(normalizeActorStrategy(strategy), strategyDepth(motivationKinds));
}

/**
 * This actor's turn under its strategy, if it has one: the ordered strategy (a mid-game
 * order, kept in the Actor context) or else the level's (`initialState.strategies`).
 * Returns null for an actor with no strategy.
 */
function resolveStrategyTurn({ entry, payload, observation, observationView, simConfig, actorId, tick, baseTiles, adopted }) {
  const strategy = adopted ?? entry?.order ?? payload?.initialState?.strategies?.[actorId];
  if (!strategy) return null;
  const actor = resolveActor(observationView, actorId, observation);
  const record = resolveActorRecord(observationView, actorId, observation);
  if (!actor?.position) return null;
  const canonical = normalizeActorStrategy(strategy);
  const depth = strategyDepth(resolveActorMotivationKinds(observationView, actorId, payload));
  const allActors = Array.isArray(observationView?.actors) ? observationView.actors : [];
  const hostiles = allActors.filter((other) => other?.id !== actorId && other?.position
    && !["defeated", "exited"].includes(other.lifecycle) && !alignmentsAreAllied(actor.alignment, other.alignment));
  const configured = Array.isArray(payload?.initialState?.actors) ? payload.initialState.actors : allActors;
  const context = {
    actorId,
    self: actor,
    record,
    view: observationView,
    hostiles,
    nearestHostile: resolveNearestHostile(observationView, actorId)?.actor ?? null,
    configuredIds: new Set(configured.map((other) => other?.id).filter(Boolean)),
    tick: Number.isFinite(tick) ? tick : 0,
    tileKinds: resolveTileKinds(observationView, payload),
    baseTiles,
    reservedTargets: payload?.reservedTargets,
    castAt: (target, distance) => buildAffinityCastProposal({ actor, actorRecord: record, hostile: { actor: target, distance } }),
    exitStep: () => {
      const step = buildMoveProposal({ observation, payload, simConfig });
      return step.length > 0 ? step : [{ kind: "wait" }];
    },
    onExit: () => {
      const portal = findExitFromTiles(baseTiles);
      return Boolean(portal) && actor.position.x === portal.x && actor.position.y === portal.y;
    },
    commandProposal: (command) => buildCommandProposals({ command, observationView, observation, actorId })[0] ?? null,
  };
  return { depth, ...followStrategy({ strategy: canonical, depth, entry: entry ?? {}, context }) };
}

/**
 * #308 — the goal a thinking actor adopts from its other motivations when nobody gave it
 * an order or a strategy (Darren, 2026-10-17, option A): an attacker that sees a hostile
 * goes to defeat the nearest one; an explorer goes to reach the exit. Anything else adopts
 * nothing and plays its motivations as before. The same for every affinity.
 */
function defaultCognitionGoal(kinds, nearestHostile) {
  if (kinds.includes("attacking") && nearestHostile?.id) return { kind: "defeat", target: nearestHostile.id };
  if (kinds.includes("exploring")) return { kind: "reach", place: "exit" };
  return null;
}

/**
 * #308 — a thinking actor's turn with no order and no strategy. `goal_oriented` adopts a
 * goal once and follows it to the end (a planned route, not one-step ranking);
 * `strategy_focused` re-plans every turn, so it changes goal when the situation changes.
 * A `user_controlled` actor is the player's, so it adopts nothing. Returns null when no
 * goal applies; the turn then goes to the actor's motivations.
 */
function resolveCognitionTurn({ entry, payload, observationView, actorId, ...rest }) {
  const kinds = resolveActorMotivationKinds(observationView, actorId, payload);
  if (kinds.includes("user_controlled")) return null;
  const depth = strategyDepth(kinds);
  if (depth === STRATEGY_DEPTH.NONE) return null;
  const replans = depth === STRATEGY_DEPTH.FULL;
  const keeps = !replans && entry?.adopted
    && ![STRATEGY_STATUS.DONE, STRATEGY_STATUS.STALLED].includes(entry.status);
  const goal = keeps
    ? entry.adopted
    : defaultCognitionGoal(kinds, resolveNearestHostile(observationView, actorId)?.actor);
  if (!goal) return null;
  const sameGoal = Boolean(entry?.adopted) && JSON.stringify(entry.adopted) === JSON.stringify(goal);
  const turn = resolveStrategyTurn({ ...rest, payload, observationView, actorId,
    entry: sameGoal ? entry : {}, adopted: { goals: [goal] } });
  if (!turn) return null;
  return { ...turn, entry: { ...turn.entry, adopted: goal } };
}

/**
 * #308 — `reflexive` reacts to what touches it this tick: standing in a field that harms
 * it, it steps to the adjacent free cell that harms it least (the first in direction order
 * on a tie), or holds when no step is better. Unharmed, it has no reflex to add.
 */
function buildReflexProposals({ record, observation, view, payload, baseTiles }) {
  if (!record?.position || record.lifecycle === "defeated") return [];
  const evaluate = (endPosition) => fieldUtilityRanks({ endPosition, actorRecord: record,
    affinityFields: observation?.affinityFields, affinityContributions: observation?.affinityContributions }).safety;
  const here = evaluate(record.position);
  if (here >= 0) return [];
  if (record.capabilities?.canMove === false) return [{ kind: "wait" }];
  const tileKinds = resolveTileKinds(view, payload);
  let best = null;
  for (const delta of DEFAULT_DELTAS) {
    const cell = { x: record.position.x + delta.dx, y: record.position.y + delta.dy };
    if (!isPassable(cell, tileKinds, baseTiles) || isOccupied(cell, view, record.id)
      || !isDiagonalStepAllowed(record.position, cell, tileKinds, baseTiles)) continue;
    const safety = evaluate(cell);
    if (safety > here && (!best || safety > best.safety)) best = { cell, safety };
  }
  return best ? [{ kind: "move", params: { target: best.cell } }] : [{ kind: "wait" }];
}

/** Keep a follower's own moves within `distance` of `center`; everything else stays. */
function keepProposalsNear(proposals, { center, distance }) {
  return proposals.filter((proposal) => proposal?.kind !== "move" || !proposal.params?.target
    || chebyshevDistance(proposal.params.target, center) <= distance);
}

function buildCombatProposals({
  observation,
  payload,
  simConfig,
  view,
  actor,
  actorId,
  kinds,
  holdsPosition,
  hasCombatRole,
}) {
  const combatKinds = kinds.filter((kind) => motivationHasCombatRole(kind));
  if (combatKinds.length === 0) return [];

  const hostile = resolveNearestHostile(view, actorId);
  if (!hostile) return [];

  const adjacent = hostile.distance <= 1;
  const proposals = [];

  if (combatKinds.some((kind) => kind === "attacking" || kind === "defending")) {
    const record = resolveActorRecord(view, actorId, observation);
    const cast = buildAffinityCastProposal({
      actor,
      actorRecord: record,
      hostile,
    });
    if (cast) proposals.push(cast);
  }

  if (!adjacent && hasCombatRole && !holdsPosition) {
    const baseTiles = resolveBaseTiles(payload, view, simConfig);
    const tileKinds = resolveTileKinds(view, payload);
    const path = findPath(actor.position, hostile.actor.position, tileKinds, baseTiles);
    if (path && path.length >= 2) {
      const to = path[1];
      proposals.push({ kind: "move", params: { target: to } });
    }
  }

  return proposals;
}


export function createActorPersona({ initialState = ActorStates.IDLE, clock, seed: personaSeed, admitProposals, from } = {}) {
  const fsm = createActorStateMachine({ initialState, clock, from });
  // CR.6 — this persona holds NO state outside `fsm`. It used to cache
  // lastObservation / lastBaseTiles / lastSimConfig / lastAffinityEffects /
  // lastHazards here; none appeared in view(), so two Actors with identical
  // serialized views could decide differently, which is an A4 violation and
  // breaks deterministic replay. The decision is now a pure function of
  // (fsm state, event, payload) — everything decision-relevant arrives in the
  // payload, and everything carried is in view().
  //
  // Measured before removing: across the whole suite the caches were read 430
  // times and EVERY read came from a direct persona-test caller — none through
  // the runner, which supplies observation/baseTiles/simConfig/affinityEffects on
  // every DECIDE payload and never supplies `hazards` at all.

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!actorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const observation = resolveObservation(payload);
    const observationView = resolveObservationView(observation);
    const simConfig = payload.simConfig || null;
    const baseTiles = resolveBaseTiles(payload, observationView, simConfig);

    const shouldEmitActions = event === "propose";
    const decidingActor = resolveActorRecord(observationView, payload.actorId || observation?.actorId, observation);
    if (shouldEmitActions && ["defeated", "exited"].includes(decidingActor?.lifecycle)) {
      return { ...view(), tick, actions: [], effects: [], telemetry: null };
    }
    // A COMMANDED actor (a player's turn) proposes exactly the command: motivations are
    // not consulted and the actor is not posed to the solver, because the decision has
    // already been made by whoever issued it. Legality stays with core.
    const commandProposals = shouldEmitActions && payload.command !== undefined
      ? buildCommandProposals({ command: payload.command, observationView, observation, actorId: payload.actorId })
      : null;
    // Phase 2b — a strategy the actor follows on its own turns. A mid-game order replaces
    // it and starts over at the first goal; the turn the order is given is spent taking it.
    const strategyActorId = payload.actorId || observation?.actorId;
    let strategyEntry = null;
    let strategyTurn = null;
    if (shouldEmitActions && strategyActorId) {
      const progress = view().context.strategies?.[strategyActorId];
      if (payload.strategyOrder !== undefined) {
        strategyEntry = { order: normalizeActorStrategy(payload.strategyOrder), goal: 0, status: STRATEGY_STATUS.ACTIVE };
      } else if (!commandProposals) {
        strategyTurn = resolveStrategyTurn({ entry: progress, payload, observation, observationView, simConfig,
          actorId: strategyActorId, tick, baseTiles });
        if (strategyTurn) strategyEntry = strategyTurn.entry;
      }
    }
    const followsStrategy = strategyTurn && strategyTurn.depth !== STRATEGY_DEPTH.NONE;
    // #308 — with no order and no strategy, a thinking actor adopts a goal of its own.
    const cognitionTurn = shouldEmitActions && strategyActorId && !commandProposals && !strategyTurn
      && payload.strategyOrder === undefined
      ? resolveCognitionTurn({ entry: view().context.cognition?.[strategyActorId], payload, observation,
        observationView, simConfig, actorId: strategyActorId, tick, baseTiles })
      : null;
    let derivedProposals = [];
    if (shouldEmitActions) {
      if (commandProposals) derivedProposals = commandProposals;
      else if (followsStrategy && strategyTurn.proposals) derivedProposals = strategyTurn.proposals;
      else if (cognitionTurn?.proposals) derivedProposals = cognitionTurn.proposals;
      else {
        const reflex = strategyActorId
          && resolveActorMotivationKinds(observationView, strategyActorId, payload).includes("reflexive")
          ? buildReflexProposals({ record: resolveActorRecord(observationView, strategyActorId, observation),
            observation, view: observationView, payload, baseTiles })
          : [];
        derivedProposals = reflex.length > 0
          ? reflex
          : buildMotivatedProposals({ observation, payload: { ...payload, tick }, simConfig, personaSeed });
        if (followsStrategy && strategyTurn.keepNear) derivedProposals = keepProposalsNear(derivedProposals, strategyTurn.keepNear);
      }
      // An actor with a strategy always takes its turn, so its progress is always kept.
      if (strategyTurn && derivedProposals.length === 0) derivedProposals = [{ kind: "wait" }];
    }
    // CR.6 — the Actor derives CANDIDATE proposals. Budget admissibility used to
    // be decided here by a local filterBudgetedProposals; the policy now lives in
    // personas/allocator/proposal-admissibility.js and reaches the Actor only as
    // the Allocator's own injected judge, wired by the runner.
    const candidates = !shouldEmitActions
      ? []
      : commandProposals
        || (Array.isArray(payload.proposals) && payload.proposals.length > 0 ? payload.proposals : derivedProposals);
    const budgetReceipt = payload.budgetReceipt || payload.budget?.receipt || payload.budget?.receiptArtifact || null;
    const budgetAllocation = payload.budgetAllocation || payload.budget?.allocation || null;
    const hasBudget = Boolean(budgetReceipt || budgetAllocation);
    if (hasBudget && typeof admitProposals !== "function") {
      // A budget arrived with nothing authorised to judge it. Silently admitting
      // everything is exactly the quiet degradation this program keeps removing
      // (PX.3's D-o: required and throwing, never a permissive default).
      const error = new Error(
        "Actor received a budget but no Allocator admissibility judge: budget admissibility is "
        + "Allocator policy (CR.6). Construct the Actor with `admitProposals` from the Allocator.",
      );
      error.code = "actor_admissibility_required";
      throw error;
    }
    const candidateProposals = hasBudget
      ? admitProposals(candidates, { budgetReceipt, budgetAllocation })
      : candidates;
    const actorIdForExit = payload.actorId || observation?.actorId || "actor";
    const actorRecordForExit = resolveActorRecord(observationView, actorIdForExit, observation)
      || resolveConfiguredActor(payload, actorIdForExit);
    const exit = actorCanExit(actorRecordForExit)
      ? resolveExit(payload, observationView, baseTiles, simConfig)
      : null;
    const runtimeDecisionEffect = shouldEmitActions && !commandProposals
      ? buildRuntimeDecisionEffect({
          payload: {
            ...payload,
            proposals: candidateProposals,
            clock,
          },
          observation,
          view: observationView,
          actorId: actorIdForExit,
          tick,
          baseTiles,
          exit,
        })
      : null;
    if (shouldEmitActions && (!Array.isArray(candidateProposals) || candidateProposals.length === 0) && !runtimeDecisionEffect) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }

    const runtimeCandidates = runtimeDecisionEffect?.envelope?.candidateActions;
    const transitionProposals = Array.isArray(candidateProposals) && candidateProposals.length > 0
      ? candidateProposals
      : Array.isArray(runtimeCandidates)
        ? runtimeCandidates.map((entry) => entry.action)
        : candidateProposals;
    const fsmPayload = {
      ...(shouldEmitActions && Array.isArray(transitionProposals) ? { ...payload, proposals: transitionProposals } : payload),
      ...(strategyEntry ? { strategyEntry: { actorId: strategyActorId, entry: strategyEntry } } : {}),
      ...(cognitionTurn ? { cognitionEntry: { actorId: strategyActorId, entry: cognitionTurn.entry } } : {}),
    };
    const result = fsm.advance(event, fsmPayload);
    if (!shouldEmitActions) {
      return { ...result, tick, actions: [], effects: [], telemetry: null };
    }

    const baseActorId = payload.actorId || observation?.actorId || "actor";
    const baseIsMotivated = isEligibleActor(baseActorId, observationView, observation);
    const actions = [];
    const effects = [];
    const selectedRanks = new Map();
    const proposalList = Array.isArray(candidateProposals) ? candidateProposals : [];
    if (!runtimeDecisionEffect) {
      const candidatesByActor = new Map();
      for (let i = 0; i < proposalList.length; i += 1) {
        const proposal = proposalList[i];
        const proposalActorId = proposal.actorId || baseActorId;
        if (!isEligibleActor(proposalActorId, observationView, observation)) {
          continue;
        }
        const actorCandidates = candidatesByActor.get(proposalActorId) || [];
        const action = buildAction({
            tick,
            kind: proposal.kind || "custom",
            actorId: proposalActorId,
            personaRef: "actor",
            params: proposal.params || proposal,
        });
        if (!actorCandidates.some((candidate) => candidateSignature(candidate.action.kind, candidate.action.params)
          === candidateSignature(action.kind, action.params))) {
          actorCandidates.push({ id: String(i), action });
        }
        candidatesByActor.set(proposalActorId, actorCandidates);
      }
      for (const [actorId, candidateActions] of candidatesByActor) {
        const actor = resolveActor(observationView, actorId, observation);
        const actorRecord = resolveActorRecord(observationView, actorId, observation);
        const objective = buildActorDecisionObjective({
          actor, actorRecord, candidateActions,
          proposals: proposalList.filter((proposal) => (proposal.actorId || baseActorId) === actorId),
          motivationProfiles: resolveActorMotivationKinds(observationView, actorId, payload)
            .map((kind) => buildMotivationProfile(observationView, actorId, payload, kind)).filter(Boolean),
          visibleActors: resolveVisibleActors(observationView, actorId),
          affinityFields: Array.isArray(observation?.affinityFields) ? observation.affinityFields : [],
          affinityContributions: observation?.affinityContributions,
          exit: actorCanExit(actorRecord) ? resolveExit(payload, observationView, baseTiles, simConfig) : null,
          tileKinds: resolveTileKinds(observationView, payload), baseTiles,
        });
        const winner = objective.candidates.reduce((best, row) =>
          compareDecisionRanks(row.rank, best.rank) > 0 ? row : best);
        const selected = candidateActions.find((candidate) => candidate.id === winner.candidateActionId);
        actions.push(selected.action);
        selectedRanks.set(actorId, winner);
      }
    } else {
      effects.push(runtimeDecisionEffect.solverEffect);
      result.context = {
        ...result.context,
        lastSolverRequest: runtimeDecisionEffect.solverEffect.request,
        lastRuntimeDecisionEnvelope: runtimeDecisionEffect.envelope,
      };
    }

    const log = payload.trace;
    if (log && baseIsMotivated) {
      actions.push(
        buildAction({
          tick,
          kind: "emit_log",
          actorId: baseActorId,
          personaRef: "actor",
          params: { severity: log.severity || "info", message: log.message || "actor_log" },
        }),
      );
    }

    if (payload.telemetry && baseIsMotivated) {
      actions.push(
        buildAction({
          tick,
          kind: "emit_telemetry",
          actorId: baseActorId,
          personaRef: "actor",
          params: { data: payload.telemetry },
        }),
      );
    }

    if (baseIsMotivated) {
      const fromEffects = buildRequestActionsFromEffects(payload.effects, {
        tick,
        personaRef: "actor",
        actorId: baseActorId,
        budgetRemaining: typeof payload?.budget?.effects === "number" ? payload.budget.effects : Number.MAX_SAFE_INTEGER,
      });
      actions.push(...fromEffects.actions);
    }

    // Report one intention per actor from the selected objective row. Solver
    // selections report later, when their selected candidate ID is available.
    const chosenByActor = new Map();
    for (const action of actions) {
      const actorId = action?.actorId;
      if (typeof actorId !== "string" || !actorId) continue;
      if (action.kind === "emit_log" || action.kind === "emit_telemetry") continue;
      if (!chosenByActor.has(actorId)) chosenByActor.set(actorId, action);
    }
    // Effect-only output has no selected gameplay row; retain its classifier.
    const intentions = [...chosenByActor.entries()].map(([actorId, action]) => buildActorIntention({
      actorId,
      ...(selectedRanks.has(actorId) ? {
        intentClass: selectedRanks.get(actorId).rank[0],
        intentTag: selectedRanks.get(actorId).rationaleTags[0],
      } : classifyActorIntent({
        action,
        actorPosition: resolveActor(observationView, actorId, observation)?.position,
        actorRecord: resolveActorRecord(observationView, actorId, observation),
        motivationProfile: buildMotivationProfile(observationView, actorId, payload),
        visibleActors: resolveVisibleActors(observationView, actorId),
        exit,
      })),
      tick,
    }));

    return {
      ...result,
      tick,
      actions,
      effects,
      intentions,
      telemetry: null,
    };
  }

  return {
    subscribePhases: actorSubscribePhases,
    advance,
    view,
  };
}
