import { createActorStateMachine, ActorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildAction, buildRequestActionsFromEffects, buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { EIGHT_WAY_DELTAS } from "../_shared/movement-directions.js";
import { requireClock } from "../_shared/require-clock.js";
import {
  RUNTIME_DECISION_CONTRACT,
  allowsLiveLlmRuntime,
  buildRuntimeDecisionEnvelope,
  resolveRuntimeDecisionProviderPolicy,
} from "../_shared/runtime-decision.mts";
import { SOLVER_REQUEST_SCHEMA } from "../../contracts/artifacts.ts";
import { buildActorIntention } from "../../contracts/actor-intention.js";
import {
  AFFINITY_EXPRESSIONS,
  AFFINITY_KINDS,
  AFFINITY_OPPOSITES,
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
  resolveExposureVitalDeltas,
} from "../../../../core-ts/src/index.ts";
import { VitalKind } from "../../../../core-ts/src/state/vitals.ts";

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

/**
 * Affinity name -> core code. Positional, derived from the ordered vocabulary arrays
 * exactly as `runner/core-setup.mjs` derives its own copy: the authority is the ORDER
 * of `AFFINITY_KINDS` / `AFFINITY_EXPRESSIONS`, not either derived map, so adding a
 * kind cannot leave the two disagreeing.
 */
const AFFINITY_KIND_CODE_BY_NAME = Object.freeze(
  AFFINITY_KINDS.reduce((acc, kind, index) => {
    acc[kind] = index + 1;
    return acc;
  }, {}),
);
const AFFINITY_EXPRESSION_CODE_BY_NAME = Object.freeze(
  AFFINITY_EXPRESSIONS.reduce((acc, expression, index) => {
    acc[expression] = index + 1;
    return acc;
  }, {}),
);

/** Accept either a core numeric code or a vocabulary name; 0 means "not an affinity". */
function affinityKindCode(value) {
  if (Number.isInteger(value)) return value > 0 && value <= AFFINITY_KINDS.length ? value : 0;
  return AFFINITY_KIND_CODE_BY_NAME[String(value || "").trim().toLowerCase()] || 0;
}

function affinityExpressionCode(value) {
  if (Number.isInteger(value)) return value > 0 && value <= AFFINITY_EXPRESSIONS.length ? value : 0;
  return AFFINITY_EXPRESSION_CODE_BY_NAME[String(value || "").trim().toLowerCase()] || 0;
}

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

function buildMotivationProfile(view, actorId, payload) {
  const rawKind = resolveActorMotivationKind(view, actorId, payload);
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
export function classifyActorIntent({ action, actorPosition, motivationProfile, visibleActors, exit } = {}) {
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

  if ((action.kind === "attack" || action.kind === "cast_affinity")
    && motivationProfile.combatTier > 0
    && actionCanReachTarget(action, actorPosition, explicitTarget)) {
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

const DEFAULT_DELTAS = EIGHT_WAY_DELTAS;

const MOTIVATED_KIND = 2;

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

function isMotivatedKind(kind) {
  if (typeof kind === "number") return kind === MOTIVATED_KIND;
  // The actor contract only uses "stationary" | "ambulatory".
  // "ambulatory" actors CAN move and should have their proposals accepted.
  // Treat both "motivated" (legacy) and "ambulatory" as proposal-eligible.
  if (typeof kind === "string") {
    const k = kind.toLowerCase();
    return k === "motivated" || k === "ambulatory";
  }
  return false;
}

function resolveActorKind(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected && selected.kind !== undefined) {
      return selected.kind;
    }
  }
  if (view?.actor && (!actorId || view.actor.id === actorId)) {
    if (view.actor.kind !== undefined) {
      return view.actor.kind;
    }
  }
  if (!actorId && observation?.actorId && observation?.kind !== undefined) {
    return observation.kind;
  }
  return null;
}

function isMotivatedActor(actorId, view, observation) {
  if (!actorId) return false;
  const kind = resolveActorKind(view, actorId, observation);
  return isMotivatedKind(kind);
}

function findExitFromTiles(baseTiles) {
  if (!Array.isArray(baseTiles)) {
    return null;
  }
  for (let y = 0; y < baseTiles.length; y += 1) {
    const row = String(baseTiles[y]);
    const x = row.indexOf("E");
    if (x !== -1) {
      return { x, y };
    }
  }
  return null;
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

function resolveObservationView(observation) {
  if (!observation || typeof observation !== "object") {
    return null;
  }
  if (observation.view && typeof observation.view === "object") {
    return observation.view;
  }
  return observation;
}

// CR.6 — the `if (lastBaseTiles) return lastBaseTiles` rung is gone; tiles come
// from this call's payload, this call's observation view, or this call's simConfig.
function resolveBaseTiles(payload, view, simConfig) {
  const fromPayload = payload?.baseTiles || payload?.tiles?.baseTiles;
  if (fromPayload) return fromPayload;
  if (view?.baseTiles) return view.baseTiles;
  if (view?.tiles?.baseTiles) return view.tiles.baseTiles;
  if (view?.tiles?.tiles) return view.tiles.tiles;
  const config = payload?.simConfig || simConfig;
  if (config?.layout?.data?.tiles) return config.layout.data.tiles;
  return null;
}

function resolveExit(payload, view, baseTiles, simConfigInput) {
  if (payload?.exit) return payload.exit;
  if (view?.exit) return view.exit;
  const simConfig = payload?.simConfig || simConfigInput;
  if (simConfig?.layout?.data?.exit) return simConfig.layout.data.exit;
  if (baseTiles) return findExitFromTiles(baseTiles);
  return null;
}

function resolveActor(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected?.position) {
      return { id: selected.id, position: selected.position };
    }
  }
  if (view?.actor) {
    const pos = view.actor.position || (Number.isFinite(view.actor.x) && Number.isFinite(view.actor.y) ? { x: view.actor.x, y: view.actor.y } : null);
    if (pos) {
      return { id: view.actor.id || actorId, position: pos };
    }
  }
  if (view?.position) {
    return { id: actorId || observation?.actorId, position: view.position };
  }
  return null;
}

function resolveActorRecord(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected) {
      return selected;
    }
  }
  if (view?.actor) {
    return view.actor;
  }
  return null;
}

function resolveConfiguredActor(payload, actorId) {
  const actors = Array.isArray(payload?.initialState?.actors) ? payload.initialState.actors : [];
  if (!actorId) return actors[0] || null;
  return actors.find((actor) => actor?.id === actorId) || null;
}

function resolveTileKinds(view, payload) {
  if (Array.isArray(view?.tiles?.kinds)) return view.tiles.kinds;
  if (Array.isArray(view?.kinds)) return view.kinds;
  if (Array.isArray(payload?.tiles?.kinds)) return payload.tiles.kinds;
  return null;
}

function buildAdjacentMoveProposals({ actor, tileKinds, baseTiles }) {
  if (!actor?.position) {
    return [];
  }
  const proposals = [];
  for (const delta of DEFAULT_DELTAS) {
    const to = {
      x: actor.position.x + delta.dx,
      y: actor.position.y + delta.dy,
    };
    if (!isPassable(to, tileKinds, baseTiles)) {
      continue;
    }
    proposals.push({
      kind: "move",
      params: {
        direction: delta.direction,
        from: actor.position,
        to,
      },
    });
  }
  return proposals;
}

function buildCandidateActionId(proposal, index) {
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
    const direction = typeof params.direction === "string" && params.direction.trim()
      ? params.direction.trim().toLowerCase()
      : null;
    if (direction) return `move_${direction}`;
  }
  const targetId = typeof params.targetId === "string" && params.targetId.trim()
    ? params.targetId.trim()
    : null;
  if (targetId) {
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
      buildCandidateActionId(proposal, index),
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
      buildCandidateActionId(proposal, proposalList.length + index),
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
      params: {},
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
 * `rolesAreAllied` and skips allies; the Z3 adapter ranks `visibleActors` and
 * had no faction concept at all, so a run routed through the solver kept
 * closing on its own allies after DS.2 fixed the other path. Sending the ruling
 * rather than the raw roles keeps ONE allegiance authority: an adapter that
 * compared roles itself would be free to disagree with this function — and
 * would have to re-derive the fail-safe in `rolesAreAllied`, which is exactly
 * the kind of quietly divergent second rule (F10) this codebase has removed
 * once already.
 *
 * The self role is read from the observation, the same source
 * `resolveNearestHostile` reads, so the two paths agree by construction rather
 * than by coincidence. `hostile` is always present and always a boolean:
 * unknown roles resolve to `true`, never to a missing field, because a consumer
 * defaulting an absent flag has to guess and half of them would guess "allied".
 */
function resolveVisibleActors(view, actorId) {
  const actors = Array.isArray(view?.actors) ? view.actors : [];
  const selfRole = actors.find((entry) => entry && entry.id === actorId)?.role;
  return actors
    .filter((entry) => entry && entry.id && entry.id !== actorId)
    .map((entry) => {
      const next = {
        id: entry.id,
      };
      if (entry.kind !== undefined) next.kind = entry.kind;
      if (entry.role !== undefined) next.role = entry.role;
      if (entry.position) next.position = { ...entry.position };
      if (entry.vitals) next.vitals = JSON.parse(JSON.stringify(entry.vitals));
      next.hostile = !rolesAreAllied(selfRole, entry.role);
      return next;
    });
}

function resolveHazards(payload, view) {
  const hazards = [];
  const seen = new Set();

  function addHazard(entry) {
    if (!entry || typeof entry !== "object") return;
    const position = isObject(entry.position)
      ? { ...entry.position }
      : Number.isFinite(entry.x) && Number.isFinite(entry.y)
        ? { x: entry.x, y: entry.y }
        : null;
    if (!position) return;
    const kind = "hazard";
    const id = typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : `${kind}_${position.x}_${position.y}`;
    const key = `${id}:${position.x}:${position.y}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const next = { id, kind, position };
    const affinity = typeof entry.affinity === "string" && entry.affinity.trim()
      ? entry.affinity.trim()
      : typeof entry.affinity?.kind === "string" && entry.affinity.kind.trim()
        ? entry.affinity.kind.trim()
        : null;
    const expression = typeof entry.expression === "string" && entry.expression.trim()
      ? entry.expression.trim()
      : typeof entry.affinity?.expression === "string" && entry.affinity.expression.trim()
        ? entry.affinity.expression.trim()
        : null;
    const stacks = Number.isFinite(entry.stacks)
      ? entry.stacks
      : Number.isFinite(entry.affinity?.stacks)
        ? entry.affinity.stacks
        : null;
    if (expression) next.expression = expression;
    if (affinity) next.affinity = affinity;
    if (Number.isFinite(stacks)) next.stacks = Math.max(1, Math.trunc(stacks));
    hazards.push(next);
  }

  const explicitHazards = Array.isArray(payload?.hazards) ? payload.hazards : [];
  explicitHazards.forEach((entry) => addHazard(entry));

  const viewHazards = Array.isArray(view?.hazards) ? view.hazards : [];
  viewHazards.forEach((entry) => addHazard(entry));

  const affinityHazards = Array.isArray(payload?.affinityEffects?.hazards) ? payload.affinityEffects.hazards : [];
  affinityHazards.forEach((entry) => addHazard(entry));

  return hazards;
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
  const role = typeof configuredActor?.role === "string" && configuredActor.role.trim()
    ? configuredActor.role.trim()
    : null;
  if (role) {
    objectives.role = role;
  }
  if (visibleActors.length > 0) {
    objectives.primary = role === "boss" ? "control_visible_opponents" : "resolve_visible_contacts";
    objectives.visibleContactCount = visibleActors.length;
  } else if (exit) {
    objectives.primary = "advance_to_exit";
  }
  if (exit) {
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

function chebyshevDistance(left, right) {
  if (!left || !right) return null;
  return Math.max(Math.abs(right.x - left.x), Math.abs(right.y - left.y));
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
  return action?.kind === "move" && isObject(action?.params?.to)
    ? action.params.to
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
  const affinityKind = typeof action?.params?.kind === "string"
    ? action.params.kind.trim().toLowerCase()
    : "";
  const grant = (Array.isArray(actorRecord?.affinityGrants) ? actorRecord.affinityGrants : [])
    .find((entry) => typeof entry?.kind === "string" && entry.kind.trim().toLowerCase() === affinityKind);
  if (grant) return { rank: reserveRatio(grant.mana, grant.manaMax), source: "affinity_grant" };
  const mana = actorRecord?.vitals?.mana;
  return { rank: reserveRatio(mana?.current, mana?.max), source: "actor_mana" };
}

function actionCanReachTarget(action, origin, target) {
  const distance = chebyshevDistance(origin, target?.position);
  if (!Number.isFinite(distance)) return false;
  if (action?.kind === "attack") return distance <= 1;
  if (action?.kind !== "cast_affinity") return false;
  const expression = typeof action?.params?.expression === "string"
    ? action.params.expression.trim().toLowerCase()
    : "push";
  const stacks = Number.isInteger(action?.params?.stacks) && action.params.stacks > 0
    ? action.params.stacks
    : 1;
  return expression === "push" || expression === "pull" ? distance <= stacks : distance <= 1;
}

/**
 * The observer's live affinity for a field of `fieldKind`, or null when it has none
 * that relates to it.
 *
 * LIVE GRANTS, NOT CONFIGURED ABILITIES (maintainer, 2026-09-04). `affinityGrants` is
 * read from core and carries real per-grant `stacks`, so resistance tracks what the
 * actor actually holds right now rather than what it was authored with.
 *
 * A grant of the field's OWN kind is preferred over one of its opposite, because an
 * actor holding both should read the field as its own rather than as its enemy —
 * immunity is the more specific claim. Beyond that the first match wins, in grant
 * order, which is stable because the grant list is read from core in slot order.
 */
function observerAffinityForField(actorRecord, fieldKindCode) {
  if (!fieldKindCode) return null;
  const grants = Array.isArray(actorRecord?.affinityGrants) ? actorRecord.affinityGrants : [];
  const usable = grants.filter((grant) => Number.isInteger(grant?.stacks) && grant.stacks > 0
    && affinityKindCode(grant?.kind) > 0);
  const oppositeName = AFFINITY_OPPOSITES[AFFINITY_KINDS[fieldKindCode - 1]];
  const oppositeCode = affinityKindCode(oppositeName);
  return usable.find((grant) => affinityKindCode(grant.kind) === fieldKindCode)
    || usable.find((grant) => affinityKindCode(grant.kind) === oppositeCode)
    || null;
}

function fieldUtilityRanks({ endPosition, affinityFields, actorRecord }) {
  const effectsByVital = new Map();
  const fields = Array.isArray(affinityFields) ? affinityFields : [];
  for (const field of fields) {
    const position = field?.position;
    if (!position || position.x !== endPosition?.x || position.y !== endPosition?.y) continue;
    const effects = Array.isArray(field?.vitalEffects) ? field.vitalEffects : [];
    // Stage A: the same tile is not equally dangerous to everyone. Where the actor holds
    // an affinity related to this field, core re-resolves the effect against it; where it
    // does not, `resolveExposureVitalEffect` returns the field's own number and this is
    // exactly the previous behavior.
    // Fields and grants speak different dialects of the same vocabulary: core's field
    // readers emit NUMERIC kind/expression codes, while grant records carry lowercase
    // NAMES. Normalizing both here rather than assuming one is what keeps this from
    // silently doing nothing — an earlier draft read only names and resolved no field
    // at all, which every existing test still passed.
    const fieldKindCode = affinityKindCode(field?.kind);
    const fieldExpressionCode = affinityExpressionCode(field?.expression);
    const observer = observerAffinityForField(actorRecord, fieldKindCode);
    const observerKindCode = observer ? affinityKindCode(observer.kind) : 0;
    const observerExpressionCode = observer ? affinityExpressionCode(observer.expression) : 0;
    const canResolve = observerKindCode > 0 && fieldKindCode > 0
      && fieldExpressionCode > 0 && observerExpressionCode > 0;

    for (const entry of effects) {
      if (!Number.isInteger(entry?.vital) || !Number.isInteger(entry?.effect)) continue;
      if (!Object.hasOwn(VITAL_KEYS_BY_CODE, entry.vital)) continue;
      // A.2: one field effect can land on a DIFFERENT vital than the one it would have
      // harmed -- a draw-expression actor converts a same-kind field into mana rather
      // than taking the hit -- so this accumulates a set of deltas, not one number.
      const deltas = canResolve
        ? resolveExposureVitalDeltas({
          baseEffect: entry.effect,
          vital: entry.vital,
          fieldKind: fieldKindCode,
          fieldExpression: fieldExpressionCode,
          observerKind: observerKindCode,
          observerExpression: observerExpressionCode,
        })
        : [{ vital: entry.vital, effect: entry.effect }];
      for (const delta of deltas) {
        if (!Object.hasOwn(VITAL_KEYS_BY_CODE, delta.vital)) continue;
        effectsByVital.set(delta.vital, (effectsByVital.get(delta.vital) || 0) + delta.effect);
      }
    }
  }

  let harmfulMagnitude = 0;
  let beneficialMagnitude = 0;
  const effects = [...effectsByVital.entries()]
    .sort(([left], [right]) => left - right)
    .map(([vital, effect]) => ({ vital, effect }));
  for (const { vital, effect } of effects) {
    if (effect < 0) {
      harmfulMagnitude += -effect;
      continue;
    }
    const vitalRecord = actorRecord?.vitals?.[VITAL_KEYS_BY_CODE[vital]];
    const missingCapacity = Number.isFinite(vitalRecord?.max) && Number.isFinite(vitalRecord?.current)
      ? Math.max(0, Math.trunc(vitalRecord.max) - Math.trunc(vitalRecord.current))
      : 0;
    beneficialMagnitude += Math.min(effect, missingCapacity);
  }
  return {
    safety: -harmfulMagnitude,
    benefit: beneficialMagnitude,
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
function buildCompatibilityDecisionRows({ actor, actorRecord, visibleActors, candidateActions, exit, affinityFields }) {
  const visiblePositions = visibleActors
    .filter((entry) => entry?.hostile !== false && entry?.position)
    .map((entry) => entry.position);
  return candidateActions.map((candidate, index) => {
    const action = candidate.action;
    const endPosition = candidateEndPosition(action, actor.position);
    let score = ACTOR_INTENT_CLASS.NONE;
    let ruleId = "no_match";
    if (action?.kind === "attack") {
      score = ACTOR_INTENT_CLASS.IN_RANGE_COMBAT;
      ruleId = "attack";
    } else if (action?.kind === "move" && visiblePositions.some((target) => {
      const before = chebyshevDistance(actor.position, target);
      const after = chebyshevDistance(endPosition, target);
      return Number.isFinite(before) && Number.isFinite(after) && after < before;
    })) {
      score = ACTOR_INTENT_CLASS.HOSTILE_PROGRESS;
      ruleId = "move_toward_hostile";
    } else if (action?.kind === "move" && exit) {
      const before = chebyshevDistance(actor.position, exit);
      const after = chebyshevDistance(endPosition, exit);
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
    const field = fieldUtilityRanks({ endPosition, affinityFields, actorRecord });
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

function buildActorDecisionObjective({
  actor,
  actorRecord,
  motivationProfile,
  visibleActors,
  affinityFields,
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
    const field = fieldUtilityRanks({ endPosition, affinityFields, actorRecord });
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
  const hazards = resolveHazards(payload, view);
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
    visibleActors,
    affinityFields,
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
    actor: {
      id: actorId,
      role: decisionConfig.configuredActor?.role || actorRecord?.role,
      kind: actorRecord?.kind,
      position: actor.position ? { ...actor.position } : undefined,
      vitals: isObject(actorRecord?.vitals) ? JSON.parse(JSON.stringify(actorRecord.vitals)) : undefined,
      affinities: Array.isArray(actorRecord?.affinities)
        ? JSON.parse(JSON.stringify(actorRecord.affinities))
        : [],
      affinityGrants: Array.isArray(actorRecord?.affinityGrants)
        ? JSON.parse(JSON.stringify(actorRecord.affinityGrants))
        : [],
      motivationProfile,
    },
    visibleActors,
    hazards,
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

function isPassable({ x, y }, tileKinds, baseTiles) {
  if (tileKinds) {
    const row = tileKinds[y];
    if (!Array.isArray(row)) return false;
    return row[x] === 0;
  }
  if (baseTiles) {
    if (y < 0 || y >= baseTiles.length) return false;
    const row = String(baseTiles[y]);
    const cell = row[x];
    if (!cell) return false;
    return cell !== "#" && cell !== "B";
  }
  return false;
}

function isDiagonalStepAllowed(current, next, tileKinds, baseTiles) {
  const dx = next.x - current.x;
  const dy = next.y - current.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
    return true;
  }
  return isPassable({ x: current.x + dx, y: current.y }, tileKinds, baseTiles)
    && isPassable({ x: current.x, y: current.y + dy }, tileKinds, baseTiles);
}

function findPath(start, goal, tileKinds, baseTiles) {
  if (!start || !goal) return null;
  if (start.x === goal.x && start.y === goal.y) return [start];
  const height = tileKinds ? tileKinds.length : baseTiles ? baseTiles.length : 0;
  const width = tileKinds && Array.isArray(tileKinds[0]) ? tileKinds[0].length : baseTiles && baseTiles[0] ? String(baseTiles[0]).length : 0;
  if (width === 0 || height === 0) return null;

  const queue = [start];
  const cameFrom = {};
  const startKey = `${start.x},${start.y}`;
  cameFrom[startKey] = null;
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current.x === goal.x && current.y === goal.y) {
      const path = [];
      let key = `${goal.x},${goal.y}`;
      while (key) {
        const [x, y] = key.split(",").map((v) => Number(v));
        path.unshift({ x, y });
        key = cameFrom[key];
      }
      return path;
    }
    for (const delta of DEFAULT_DELTAS) {
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      const key = `${next.x},${next.y}`;
      if (Object.prototype.hasOwnProperty.call(cameFrom, key)) {
        continue;
      }
      if (!isPassable(next, tileKinds, baseTiles) || !isDiagonalStepAllowed(current, next, tileKinds, baseTiles)) {
        continue;
      }
      cameFrom[key] = `${current.x},${current.y}`;
      queue.push(next);
    }
  }
  return null;
}

function buildMoveProposal({ observation, payload, simConfig }) {
  const view = resolveObservationView(observation);
  if (!view) return [];
  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const exit = resolveExit(payload, view, baseTiles, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const actor = resolveActor(view, payload?.actorId, observation);
  if (!actor || !actor.position || !exit) return [];
  const actorRecord = resolveActorRecord(view, payload?.actorId, observation);
  if (actorRecord?.motivation?.mobility === "stationary") {
    return [{ kind: "wait", params: { reason: "stationary" } }];
  }
  const path = findPath(actor.position, exit, tileKinds, baseTiles);
  if (!path || path.length < 2) return [];
  const from = path[0];
  const to = path[1];
  const delta = { dx: to.x - from.x, dy: to.y - from.y };
  const direction = DEFAULT_DELTAS.find((entry) => entry.dx === delta.dx && entry.dy === delta.dy)?.direction;
  if (!direction) return [];
  return [
    {
      kind: "move",
      params: {
        direction,
        from,
        to,
      },
    },
  ];
}

// ── M5: Simple motivation helpers ──────────────────────────────────────────

const DEFAULT_ATTACK_DAMAGE = 2; // M1 contract: fixed deterministic damage

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
  if (view?.actors && Array.isArray(view.actors)) {
    const self = view.actors.find((a) => a && a.id === actorId);
    if (self?.motivation?.kind) return self.motivation.kind;
  }
  const configActors = payload?.initialState?.actors;
  if (Array.isArray(configActors)) {
    const configActor = configActors.find((a) => a && a.id === actorId);
    if (configActor?.motivation?.kind) return configActor.motivation.kind;
  }
  return null;
}

/**
 * DS.2 — are these two actors on the same side?
 *
 * Maintainer ruling 2026-08-20: delvers are friendly to delvers, wardens are
 * friendly to wardens, delvers and wardens are hostile to each other. There are
 * only ever two actor roles in this game (`contracts/artifacts.ts` types the
 * category as `"delver" | "warden"`), so `role` already IS a complete faction
 * system and no new field was introduced to represent one.
 *
 * ⚠️ **Unknown roles are treated as HOSTILE, deliberately.** The tempting
 * formulation is `selfRole === otherRole -> allied`, but two *missing* roles
 * compare equal, which would make every actor in a run without role data
 * everyone else's ally and quietly pacify the entire game — combat would stop,
 * and every test asserting "does not attack an ally" would still pass. So this
 * answers "allied" only when BOTH roles are actually known and equal, and the
 * caller's default is to remain hostile. Fail-safe toward the previous
 * behaviour, never toward a silent ceasefire.
 */
function rolesAreAllied(selfRole, otherRole) {
  if (typeof selfRole !== "string" || typeof otherRole !== "string") return false;
  const self = selfRole.trim().toLowerCase();
  const other = otherRole.trim().toLowerCase();
  if (!self || !other) return false;
  return self === other;
}

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
    if (rolesAreAllied(selfActor.role, other.role)) continue;
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
 * Motivation-aware proposal builder. Routes to attack or hostile pursuit
 * before falling back to the existing exit pathfinding.
 *
 * Rules (from M1 contract):
 *   attacking  + adjacent hostile  → attack
 *   attacking  + non-adjacent      → move toward hostile
 *   defending  + adjacent hostile  → attack
 *   defending  + non-adjacent      → wait (no action)
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

function resolveActorRandomSeed(view, actorId, payload, personaSeed) {
  if (view?.actors && Array.isArray(view.actors)) {
    const self = view.actors.find((a) => a && a.id === actorId);
    if (self?.motivation?.seed !== undefined && self.motivation.seed !== null) {
      return self.motivation.seed;
    }
  }
  const configActors = payload?.initialState?.actors;
  if (Array.isArray(configActors)) {
    const configActor = configActors.find((a) => a && a.id === actorId);
    if (configActor?.motivation?.seed !== undefined && configActor.motivation.seed !== null) {
      return configActor.motivation.seed;
    }
  }
  if (payload?.seed !== undefined && payload?.seed !== null) return payload.seed;
  if (personaSeed !== undefined && personaSeed !== null) return personaSeed;
  return 0;
}

/** Deterministic 32-bit hash of a seed/actorId/tick tuple (no Math.random, no clock). */
function hashRandomInputs(seed, actorId, tick) {
  const text = `${String(seed)}:${String(actorId)}:${String(Number.isFinite(tick) ? tick : 0)}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Final mix (mulberry32-style) so nearby hashes decorrelate before use.
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
}

/** Pure deterministic RNG value in [0, 1) derived from seed + actorId + tick + salt. */
function deterministicRandom(seed, actorId, tick, salt = 0) {
  const hashed = hashRandomInputs(seed, actorId, (Number.isFinite(tick) ? tick : 0) * 2654435761 + salt);
  return hashed / 4294967296;
}

function isOccupied(position, view, actorId) {
  if (!view?.actors || !Array.isArray(view.actors)) return false;
  return view.actors.some(
    (other) => other && other.id !== actorId && other.position
      && other.position.x === position.x && other.position.y === position.y,
  );
}

function isReserved(position, reservedTargets) {
  if (!Array.isArray(reservedTargets) || reservedTargets.length === 0) return false;
  return reservedTargets.some((target) => target && target.x === position.x && target.y === position.y);
}

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

function buildAffinityCastProposal({ actor, affinities: rawAffinities, hostile }) {
  const affinities = Array.isArray(rawAffinities) ? rawAffinities : [];
  if (affinities.length === 0) return null;

  const distance = Number.isFinite(hostile?.distance)
    ? hostile.distance
    : Math.max(
      Math.abs((hostile?.actor?.position?.x ?? 0) - actor.position.x),
      Math.abs((hostile?.actor?.position?.y ?? 0) - actor.position.y),
    );

  const ordered = affinities
    .filter((entry) => typeof entry?.kind === "string" && entry.kind.trim())
    .slice()
    .sort((a, b) => String(a.kind).localeCompare(String(b.kind))
      || String(a.expression || "").localeCompare(String(b.expression || "")));

  for (const entry of ordered) {
    const expression = typeof entry.expression === "string" && entry.expression.trim()
      ? entry.expression.trim().toLowerCase()
      : "push";
    const stacks = Number.isInteger(entry.stacks) && entry.stacks > 0 ? entry.stacks : 1;
    const focused = expression === "push" || expression === "pull";
    const canReach = focused ? distance <= stacks : distance <= 1;
    if (!canReach) continue;
    return {
      kind: "cast_affinity",
      params: {
        kind: entry.kind.trim().toLowerCase(),
        expression,
        stacks,
        targetId: hostile.actor.id,
      },
    };
  }
  return null;
}

function buildRandomMoveProposals({ observation, payload, simConfig, personaSeed }) {
  const view = resolveObservationView(observation);
  const actorId = payload?.actorId;
  const actor = resolveActor(view, actorId, observation);
  if (!actor?.position) return [{ kind: "wait", params: { reason: "random" } }];

  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const reservedTargets = payload?.reservedTargets;
  const candidates = buildAdjacentMoveProposals({ actor, tileKinds, baseTiles })
    .filter((proposal) => !isOccupied(proposal.params.to, view, actorId))
    .filter((proposal) => !isReserved(proposal.params.to, reservedTargets));

  if (candidates.length === 0) {
    return [{ kind: "wait", params: { reason: "random" } }];
  }

  const seed = resolveActorRandomSeed(view, actorId, payload, personaSeed);
  const roll = deterministicRandom(seed, actorId, payload?.tick, 0);
  const index = Math.floor(roll * candidates.length) % candidates.length;
  const chosen = candidates[index];

  return [
    {
      kind: "move",
      params: {
        direction: chosen.params.direction,
        from: chosen.params.from,
        to: chosen.params.to,
        reason: "random",
      },
    },
  ];
}

function buildMotivatedProposals({ observation, payload, simConfig, personaSeed }) {
  const view = resolveObservationView(observation);
  if (!view) return buildMoveProposal({ observation, payload, simConfig });

  const actorId = payload?.actorId;
  const actor = resolveActor(view, actorId, observation);
  if (!actor?.position) return buildMoveProposal({ observation, payload, simConfig });

  const motivationKind = resolveActorMotivationKind(view, actorId, payload);

  // AM.9 — gate on the motivation's PROFILE, not on its name.
  //
  // This read `motivationKind === "stationary"`. Every other kind fell through
  // to movement by default, so a kind whose profile says it holds position — and
  // core's table says `defending`, `reflexive`, `goal_oriented`,
  // `strategy_focused` and `user_controlled` all do — moved anyway, because
  // nobody had written an `if` for it. The behavior lived in the list of names
  // someone remembered, not in the data.
  //
  // Mobility tier 0 means stationary; 1 exploring; 2 patrolling. Asking core
  // means a new motivation kind gets correct movement behavior from its profile
  // row, with no branch to add here.
  //
  // Holding position suppresses MOVEMENT, not every proposal. `defending` has
  // mobility 0 and combat 2: it holds ground and still strikes what comes to it
  // (charter §382). Returning early for everything that holds position is the
  // mistake this comment exists to prevent — it silenced defending actors
  // entirely, and three tests said so.
  const holdsPosition = motivationHoldsPosition(motivationKind);
  const hasCombatRole = motivationHasCombatRole(motivationKind);
  if (holdsPosition && !hasCombatRole) {
    return [];
  }

  // Random: seed-derived deterministic movement to a legal adjacent tile
  if (motivationKind === "random") {
    return buildRandomMoveProposals({ observation, payload, simConfig, personaSeed });
  }

  const hostile = resolveNearestHostile(view, actorId);

  if (hostile) {
    const adjacent = hostile.distance <= 1;

    // AM.6 — an actor that HOLDS an affinity able to reach this hostile expresses
    // it, in preference to a generic attack.
    //
    // Before this, an actor's affinities were data it carried and never used:
    // the only combat proposal was `attack` with a flat damage number, so the
    // whole affinity system — kinds, expressions, stacks, the vital matrix — sat
    // outside play entirely (F5). Range matches core's own rule for push/pull
    // (Chebyshev distance <= stacks, rules/affinity-damage.ts), so a proposal
    // this makes is one core will accept rather than one it will refuse.
    if (motivationKind === "attacking" || motivationKind === "defending") {
      // `resolveActor` deliberately returns only id + position, so the affinity
      // list comes from the full record. Reading it off the trimmed one would
      // silently find no affinities and never cast — the failure would look
      // exactly like an actor that simply has none.
      const record = resolveActorRecord(view, actorId, observation);
      const cast = buildAffinityCastProposal({
        actor,
        affinities: record?.affinities,
        hostile,
      });
      if (cast) return [cast];
    }

    // Adjacent hostile + attacking or defending → attack
    if (adjacent && (motivationKind === "attacking" || motivationKind === "defending")) {
      return [
        {
          kind: "attack",
          params: {
            targetId: hostile.actor.id,
            attackerPosition: { ...actor.position },
            targetPosition: { ...hostile.actor.position },
            damage: DEFAULT_ATTACK_DAMAGE,
          },
        },
      ];
    }

    // Non-adjacent + a motivation that both fights and MOVES → close distance.
    // Gated on the profile: a combat motivation with mobility 0 holds its ground
    // instead of pursuing, which is what separates defending from attacking.
    if (!adjacent && hasCombatRole && !holdsPosition) {
      const baseTiles = resolveBaseTiles(payload, view, simConfig);
      const tileKinds = resolveTileKinds(view, payload);
      const path = findPath(actor.position, hostile.actor.position, tileKinds, baseTiles);
      if (path && path.length >= 2) {
        const from = path[0];
        const to = path[1];
        const delta = { dx: to.x - from.x, dy: to.y - from.y };
        const direction = DEFAULT_DELTAS.find(
          (e) => e.dx === delta.dx && e.dy === delta.dy,
        )?.direction;
        if (direction) {
          return [{ kind: "move", params: { direction, from, to } }];
        }
      }
    }

    // Non-adjacent + a combat motivation that holds position → wait it out
    if (!adjacent && hasCombatRole && holdsPosition) {
      return [];
    }
  }

  // Fallback: existing exit pathfinding
  return buildMoveProposal({ observation, payload, simConfig });
}

/**
 * @param {object} options
 * @param {(proposals: Array, budget: object) => Array} [options.admitProposals]
 *   The Allocator's budget-admissibility judge, wired in by the runner. CR.6: the
 *   Actor no longer OWNS this policy — it does not define it, cannot reach a
 *   different verdict than the Allocator, and refuses to guess if a budget shows up
 *   with no judge attached (see below).
 */
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
    const derivedProposals = shouldEmitActions ? buildMotivatedProposals({ observation, payload: { ...payload, tick }, simConfig, personaSeed }) : [];
    // CR.6 — the Actor derives CANDIDATE proposals. Budget admissibility used to
    // be decided here by a local filterBudgetedProposals; the policy now lives in
    // personas/allocator/proposal-admissibility.js and reaches the Actor only as
    // the Allocator's own injected judge, wired by the runner.
    const candidates = shouldEmitActions
      ? (Array.isArray(payload.proposals) && payload.proposals.length > 0 ? payload.proposals : derivedProposals)
      : [];
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
    const exit = resolveExit(payload, observationView, baseTiles, simConfig);
    const runtimeDecisionEffect = shouldEmitActions
      ? buildRuntimeDecisionEffect({
          payload: {
            ...payload,
            proposals: candidateProposals,
            affinityEffects: payload.affinityEffects,
            hazards: payload.hazards,
            clock,
          },
          observation,
          view: observationView,
          actorId: payload.actorId || observation?.actorId || "actor",
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
    const fsmPayload = shouldEmitActions && Array.isArray(transitionProposals)
      ? { ...payload, proposals: transitionProposals }
      : payload;
    const result = fsm.advance(event, fsmPayload);
    if (!shouldEmitActions) {
      return { ...result, tick, actions: [], effects: [], telemetry: null };
    }

    const baseActorId = payload.actorId || observation?.actorId || "actor";
    const baseIsMotivated = isMotivatedActor(baseActorId, observationView, observation);
    const actions = [];
    const effects = [];
    const proposalList = Array.isArray(candidateProposals) ? candidateProposals : [];
    if (!runtimeDecisionEffect) {
      for (let i = 0; i < proposalList.length; i += 1) {
        const proposal = proposalList[i];
        const proposalActorId = proposal.actorId || baseActorId;
        if (!isMotivatedActor(proposalActorId, observationView, observation)) {
          continue;
        }
        actions.push(
          buildAction({
            tick,
            kind: proposal.kind || "custom",
            actorId: proposalActorId,
            personaRef: "actor",
            params: proposal.params || proposal,
          }),
        );
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

    // Surface the intention (maintainer ruling, 2026-09-04). This reports WHAT the actor means
    // to do so the Moderator can decide who resolves first; it commits to nothing and reaches no
    // adapter. The Moderator is deliberately never handed the actions themselves — one holding
    // actions could reorder outcomes rather than actors.
    //
    // ⚠️ AN EARLIER VERSION OF THIS COMMENT CLAIMED A BLOCKER THAT DOES NOT EXIST. It said an
    // actor emits several actions per tick so "the first non-telemetry action" is unreliable,
    // and that "a delver that attacks reports wait". Measured with the derivation instrumented
    // across tests/runtime + tests/personas + tests/integration: every actor emits EXACTLY ONE
    // gameplay action per advance (360 × `move`, 20 × `attack` in the combat suite), and the
    // single multi-action case in the whole suite is `move,wait` — first-wins already picks the
    // meaningful one. The claim was inferred from reading the emit sequence and never run.
    //
    // The real hole the measurement DID find is the envelope path, and it is the opposite
    // shape: on the runtime-decision route this branch never runs at all (17/17 advances
    // emitted zero actions and zero intentions), because the chosen action does not exist yet —
    // it is resolved from the solver result in `tick-orchestrator`. That path surfaces its own
    // intention there, from the rank the Actor published.
    //
    // ONE INTENTION PER ACTOR, not one per advance. A single Actor advance emits actions for
    // EVERY motivated actor it decided for, not only the `baseActorId` the payload names. An
    // earlier version keyed off baseActorId alone, so in a two-actor tick exactly one actor
    // surfaced an intention and the other sorted last at class 0 — which silently handed
    // resolution order to whichever actor happened to be named in the payload. Caught by
    // `runtime-combat-application`, where it reversed an attacking delver and a defending warden.
    const chosenByActor = new Map();
    for (const action of actions) {
      const actorId = action?.actorId;
      if (typeof actorId !== "string" || !actorId) continue;
      if (action.kind === "emit_log" || action.kind === "emit_telemetry") continue;
      if (!chosenByActor.has(actorId)) chosenByActor.set(actorId, action);
    }
    // The SAME classifier the ranking uses, per actor — not a second, kind-only derivation.
    // Each actor gets its own profile and visible-actor list: a shared one would score every
    // actor as if it were `baseActorId`, which is the bug class the paragraph above records.
    const intentions = [...chosenByActor.entries()].map(([actorId, action]) => buildActorIntention({
      actorId,
      ...classifyActorIntent({
        action,
        actorPosition: resolveActor(observationView, actorId, observation)?.position,
        motivationProfile: buildMotivationProfile(observationView, actorId, payload),
        visibleActors: resolveVisibleActors(observationView, actorId),
        exit,
      }),
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
