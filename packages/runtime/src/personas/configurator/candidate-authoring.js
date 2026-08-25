/**
 * Candidate authoring — the Configurator assembles cards; the Allocator prices them.
 *
 * CR.9 M3. Every function here was previously inside
 * `personas/allocator/budget-fulfillment.js`, where the budget maximizer built its
 * own candidate cards, filled their vitals, and encoded configuration-validity rules
 * before pricing the result. That is the Configurator's chartered role — "configuration
 * assembly, validation, locking" — and doing it inside the Allocator is why the
 * Allocator had to import `configurator/cost-model.js` and
 * `configurator/motivation-loadouts.js` to finish the job. The registry entry
 * `allocator/judges-not-authors` was blocked on exactly this: the Allocator was not
 * pricing a config it did not author, it was authoring and then pricing its own.
 *
 * WHAT THIS MODULE OWNS
 *   - Card assembly: `cloneVitals`, `fillFlexibleDelverVitals`, `buildMinimumDelverCard`.
 *   - Structural validity: affinity prerequisites, movement stamina, motivation
 *     vocabulary.
 *   - Enumeration: which candidates exist at all, and in what order.
 *   - The `preference` tuple: the Configurator's ordering intent, published as opaque
 *     numbers so the Allocator can tie-break without learning that index 0 means
 *     "mana regen".
 *
 * WHAT IT DELIBERATELY DOES NOT OWN
 *   Prices. Nothing here imports the Allocator or reads a price list. The enumeration
 *   is bounded by the BudgetEnvelope's CAP — which it must see, or the search is
 *   unbounded and termination stops being structural — and by nothing else.
 *
 * TERMINATION. The bounds below are pure functions of `perUnitCapTokens`, so the
 * candidate list is finite by construction rather than by a timeout. The Allocator
 * asserts a backstop that must never fire; if it ever does, these bounds have stopped
 * being cap-derived, which is a real defect and should be loud.
 *
 * BEHAVIOR-PRESERVING. The enumeration order, the bounds, the fill rule and the
 * tie-break are reproduced exactly as the fused loop had them. Goldens are the gate.
 */
import { ACTOR_VIABILITY_FLOOR, DEFAULT_VITALS, MOTIVATION_KINDS, ROOM_CARD_SIZE_IDS, VITAL_KEYS } from "../../contracts/domain-constants.js";
import { getMotivationMobilityTier } from "../../../../core-ts/src/index.ts";
// CR.9 M4. These three were restated as local consts here and in the Allocator, on the
// reasoning that `contracts/artifacts.ts` cannot be imported by a runtime `.js` module.
// True, and beside the point: a runtime `.js` CONTRACTS module can be, so the protocol
// vocabulary now has one home and both halves of the exchange read the same values.
import {
  BUDGET_ENVELOPE_SCHEMA,
  CONFIGURATION_CANDIDATE_SCHEMA,
  SPEND_PROTOCOL_SCHEMA_VERSION,
} from "../../contracts/spend-protocol.js";
import { validateAffinityPrereqs } from "./cost-model.js";
import { resolveAffinityManaCost } from "./affinity-rules.js";
import { normalizeMotivations } from "./motivation-loadouts.js";

/**
 * Build the envelope the Configurator enumerates against.
 *
 * The Allocator calls this so the cap arrives in one shape rather than as three loose
 * numbers, and so `perUnitCapTokens` has one definition instead of being recomputed at
 * each call site (it was, twice, with the same `Math.floor` by coincidence).
 */
export function buildBudgetEnvelope({ capTokens, count = 1 } = {}) {
  const safeCap = Number.isInteger(capTokens) && capTokens > 0 ? capTokens : 0;
  const safeCount = Number.isInteger(count) && count > 0 ? count : 1;
  return {
    schema: BUDGET_ENVELOPE_SCHEMA,
    schemaVersion: SPEND_PROTOCOL_SCHEMA_VERSION,
    capTokens: safeCap,
    perUnitCapTokens: Math.floor(safeCap / safeCount),
    count: safeCount,
  };
}

export function cloneVitals(vitals = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    const max = Number.isInteger(source?.max) ? source.max : DEFAULT_VITALS[key].max;
    const current = Number.isInteger(source?.current) ? source.current : max;
    const regen = Number.isInteger(source?.regen) ? source.regen : DEFAULT_VITALS[key].regen;
    acc[key] = {
      current: Math.max(0, current),
      max: Math.max(0, max),
      regen: Math.max(0, regen),
    };
    return acc;
  }, {});
}

export function hasNonStationaryMobilityMotivation(motivations = []) {
  return motivations.some((motivation) => motivationMoves(motivation));
}

/**
 * Does this motivation move the actor? core already knows.
 *
 * This used to be a hand-kept list of three kinds -- random, exploring, patrolling -- which is a
 * second home for something core states authoritatively in PROFILE_MOBILITY, and it disagreed with
 * core: `attacking` has mobility tier 1 there and was absent here. Delvers never noticed, because
 * requiresMovementStamina short-circuited on archetype and gave every delver stamina regardless.
 * Wardens did notice: an attacking warden got stamina {0,0,0} and could not take a step -- the F12
 * defect, fixed for delvers and still live on the warden side.
 *
 * The kind ordering is the contract that makes this work: GAME_MOTIVATION_KINDS is mobility +
 * posture + cognition + control, which is exactly core's 1-based PROFILE_MOBILITY ordering. A test
 * pins that correspondence, because nothing else would notice it drifting.
 */
function motivationMoves(motivation) {
  const index = MOTIVATION_KINDS.indexOf(motivation);
  if (index < 0) return false;
  return getMotivationMobilityTier(index + 1) > 0;
}

/**
 * A warden is a delver with a different aim. Whether an actor needs stamina is a question about its
 * MOTIVATION, never its archetype -- the docblock below states the rule as a capability ("an actor
 * whose motivation implies movement must be able to move every tick"), and `type === "delver"` was
 * a proxy for it that made the same configuration cost two different amounts depending on which
 * label it wore.
 *
 * Dropping the proxy moves two cases, both toward what core says: an attacking WARDEN now gets the
 * stamina it always needed, and a stationary DELVER stops paying for stamina it never used.
 */
export function requiresMovementStamina(card = null) {
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  return motivations.some((motivation) => motivationMoves(motivation));
}

// ── AM.2b — movement stamina: the POOL, not just the regen ──────────────────
//
// The movement-stamina requirement existed before this and was enforced as
// `stamina.regen >= 1`, in three places, none of which touched `stamina.max`.
// `DEFAULT_VITALS.stamina` is `{0, 0, 0}`, and core's
// computeNextStaminaAfterRegen clamps to max — `min(current + regen, max)` — so
// with `max === 0` the regen never accumulates and stamina is permanently 0.
// core's applyMove then rejects every move with InsufficientStamina. The result:
// no actor authored through `ak create` could move, ever, in any run (F12).
//
// The rule was written against one SPELLING of the requirement (regen) rather
// than the capability it exists to guarantee (can this actor take a step?), so
// it passed while the capability was absent. Stated as a capability instead:
//
//   an actor whose motivation implies movement must be able to move EVERY tick,
//   including the most expensive single move it can make (a diagonal).
//
// so the pool must cover one worst-case move and regen must refill it.
// Both derive from movementCost — no second constant to drift.

const DEFAULT_MOVEMENT_COST = 1;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Worst-case cost of one step: core charges a diagonal extra (rules/move.ts computeMovementCost). */
export function resolveWorstCaseMoveCost(movementCost = DEFAULT_MOVEMENT_COST) {
  const cardinal = Number.isInteger(movementCost) && movementCost > 0
    ? movementCost
    : DEFAULT_MOVEMENT_COST;
  const diagonalExtra = cardinal > 1 ? Math.max(1, Math.trunc(cardinal / 2)) : 1;
  return cardinal + diagonalExtra;
}

/**
 * Raise a card's stamina to the floor its motivation requires. Single origin —
 * every site that used to write `stamina.regen = max(regen, 1)` calls this, so
 * the pool and the regen can never again be set in one place and forgotten in
 * another. Pure: returns the mutated vitals object it was handed.
 *
 * The Allocator prices the result through the existing vitals price path; this
 * module still reads no price list.
 */
export function applyMovementStaminaFloor(vitals, card = null) {
  if (!vitals?.stamina || !requiresMovementStamina(card)) return vitals;
  const floor = resolveWorstCaseMoveCost(card?.capabilities?.movementCost);
  vitals.stamina.max = Math.max(vitals.stamina.max, floor);
  vitals.stamina.current = Math.max(vitals.stamina.current, vitals.stamina.max);
  vitals.stamina.regen = Math.max(vitals.stamina.regen, floor);
  return vitals;
}

/**
 * Raise a card's vitals to the floor an actor needs to be worth simulating, in place.
 *
 * Single origin, for the reason the movement floor states one function above: the last time a
 * floor in this file was applied field-by-field it "came to be enforced on `regen` and missed on
 * `max`". Every vital in ACTOR_VIABILITY_FLOOR gets max, current and regen raised together here,
 * so a future vital added to the constant cannot be half-applied.
 *
 * Raises, never lowers -- an author who asked for health 50 keeps 50. Stamina is untouched: its
 * floor is derived from movement, not from this constant.
 *
 * The Allocator prices the result through the existing vitals path; this module reads no prices.
 */
export function applyActorViabilityFloor(vitals) {
  if (!vitals || typeof vitals !== "object") return vitals;
  for (const [key, floor] of Object.entries(ACTOR_VIABILITY_FLOOR)) {
    const vital = vitals[key];
    if (!vital || typeof vital !== "object") continue;
    const max = Math.max(Number.isInteger(vital.max) ? vital.max : 0, floor.max);
    const current = Number.isInteger(vital.current) ? vital.current : 0;
    vital.max = max;
    // Fill to the FLOOR, not to max. `current < max` is a damaged actor, and filling to max would
    // silently heal one: an author who wrote health 40/50 means 40, and this floor has no business
    // topping it up. Only a vital sitting below the floor gets brought up to it.
    vital.current = Math.max(current, Math.min(max, floor.max));
    vital.regen = Math.max(Number.isInteger(vital.regen) ? vital.regen : 0, floor.regen);
  }
  return vitals;
}

/**
 * Apply the requirements an actor's MOTIVATION implies to its vitals, in place.
 *
 * The card-level helpers above only run inside budget-driven candidate
 * enumeration. A plain `ak create` with no budget never enters that path, so its
 * actors kept `DEFAULT_VITALS` — stamina {0,0,0} — and could not move (F12).
 * Motivation is not known until it is patched onto the actor record, so this is
 * the funnel every authoring path passes through once the kind is resolved.
 *
 * Glue calls this; the Configurator decides. Configuration validity is chartered
 * Configurator authority (charter §288, "a mobility motivation requires
 * stamina") — that sentence has been in the charter with nothing enforcing the
 * part that matters.
 *
 * Accepts either shape a motivated entity carries in this codebase: the singular
 * `motivation: { kind }` patched onto InitialState actors, or the
 * `motivations: [{ kind, intensity }]` / `motivations: ["random"]` list the
 * Configurator's actor generator and the parsed CLI cards use. One function for
 * both, so the requirement cannot be enforced on one shape and missed on the
 * other — which is how it came to be enforced on `regen` and missed on `max`.
 *
 * @param {{archetype?: string, type?: string, motivation?: {kind?: string}, motivations?: Array, vitals?: object, capabilities?: object}} actor
 * @returns {boolean} true when the actor's vitals were raised.
 */
function collectMotivationKinds(actor) {
  const kinds = [];
  if (isNonEmptyString(actor?.motivation?.kind)) kinds.push(actor.motivation.kind);
  if (Array.isArray(actor?.motivations)) {
    actor.motivations.forEach((entry) => {
      const kind = typeof entry === "string" ? entry : entry?.kind;
      if (isNonEmptyString(kind)) kinds.push(kind);
    });
  }
  return kinds;
}

/**
 * AM.5/F14 — an actor that HOLDS an affinity must be able to express it.
 *
 * The same defect as F12, one vital over. `DEFAULT_VITALS.mana` is
 * `{0, 0, 0}`, so a `create`-authored actor carrying `water:push` had no mana
 * and every cast it proposed was refused `insufficient_affinity_mana`. The
 * Configurator already had the rule — `assessDelverStructure` reports
 * `affinity_requires_mana` — but, exactly like the stamina rule, it only ran
 * inside budget-driven candidate enumeration, so the plain path never saw it.
 *
 * The floor is the authored cost of one cast at the tier the actor holds, taken
 * from the rules artifact (AM.4), plus regen so the actor can cast again. A
 * pool sized to a cost we did not read would be a second price.
 */
export function applyAffinityDerivedVitalRequirements(actor) {
  const affinities = Array.isArray(actor?.affinities) ? actor.affinities : [];
  if (affinities.length === 0 || !actor?.vitals?.mana) return false;

  let required = 0;
  for (const affinity of affinities) {
    const kind = typeof affinity?.kind === "string" ? affinity.kind.trim().toLowerCase() : "";
    if (!kind) continue;
    const expression = typeof affinity?.expression === "string" && affinity.expression.trim()
      ? affinity.expression.trim().toLowerCase()
      : "push";
    const stacks = Number.isInteger(affinity?.stacks) && affinity.stacks > 0 ? affinity.stacks : 1;
    const cost = resolveAffinityManaCost({ rules: null, kind, expression, stacks });
    if (Number.isInteger(cost) && cost > required) required = cost;
  }
  if (required <= 0) return false;

  const before = { ...actor.vitals.mana };
  actor.vitals.mana.max = Math.max(actor.vitals.mana.max, required);
  actor.vitals.mana.current = Math.max(actor.vitals.mana.current, actor.vitals.mana.max);
  actor.vitals.mana.regen = Math.max(actor.vitals.mana.regen, 1);
  return (
    before.max !== actor.vitals.mana.max
    || before.current !== actor.vitals.mana.current
    || before.regen !== actor.vitals.mana.regen
  );
}

/**
 * Glue-facing form of the viability floor, shaped like its two siblings so orchestrate-build
 * applies all three at one point rather than knowing which are card-level and which are actor-level.
 */
export function applyViabilityDerivedVitalRequirements(actor) {
  if (!actor?.vitals || typeof actor.vitals !== "object") return false;
  const before = JSON.stringify(actor.vitals);
  applyActorViabilityFloor(actor.vitals);
  return before !== JSON.stringify(actor.vitals);
}

export function applyMotivationDerivedVitalRequirements(actor) {
  const kinds = collectMotivationKinds(actor);
  if (kinds.length === 0 || !actor?.vitals?.stamina) return false;
  const card = {
    type: actor.archetype || actor.type,
    motivations: kinds,
    capabilities: actor.capabilities,
  };
  if (!requiresMovementStamina(card)) return false;
  const before = { ...actor.vitals.stamina };
  applyMovementStaminaFloor(actor.vitals, card);
  return (
    before.max !== actor.vitals.stamina.max
    || before.current !== actor.vitals.stamina.current
    || before.regen !== actor.vitals.stamina.regen
  );
}

/**
 * Spend leftover room on stamina, then mana. Pure, applied exactly once per candidate.
 *
 * The odd token goes to stamina because mana costs 2 and stamina 1, so an odd
 * remainder is otherwise unspendable — that asymmetry is load-bearing for goldens.
 */
export function fillFlexibleDelverVitals(vitals, remainingTokens) {
  const next = cloneVitals(vitals);
  let remaining = Number.isInteger(remainingTokens) ? remainingTokens : 0;
  if (remaining <= 0) {
    return next;
  }
  if (remaining % 2 === 1) {
    next.stamina.max += 1;
    next.stamina.current = next.stamina.max;
    remaining -= 1;
  }
  if (remaining <= 0) {
    return next;
  }
  const manaIncrease = Math.floor(remaining / 2);
  if (manaIncrease > 0) {
    next.mana.max += manaIncrease;
    next.mana.current = next.mana.max;
  }
  return next;
}

/** The smallest card that still satisfies the author's hard requirements. */
export function buildMinimumDelverCard(card) {
  const next = {
    ...card,
    vitals: cloneVitals(card?.vitals),
  };
  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];

  if (affinities.length > 0) {
    next.vitals.mana.max = Math.max(next.vitals.mana.max, 1);
    next.vitals.mana.current = next.vitals.mana.max;
    next.vitals.mana.regen = Math.max(next.vitals.mana.regen, 1);
  }
  applyMovementStaminaFloor(next.vitals, card);
  applyActorViabilityFloor(next.vitals);

  return next;
}

function toRequirementVitals(vitals = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    acc[key] = Number.isInteger(source?.max) ? source.max : 0;
    return acc;
  }, {});
}

function toRequirementRegen(vitals = DEFAULT_VITALS) {
  return VITAL_KEYS.reduce((acc, key) => {
    const source = vitals?.[key] && typeof vitals[key] === "object"
      ? vitals[key]
      : DEFAULT_VITALS[key];
    acc[key] = Number.isInteger(source?.regen) ? source.regen : 0;
    return acc;
  }, {});
}

/**
 * Does this card's explicit configuration contradict what it needs to function?
 *
 * Returns `{ code, path, message }` issues. This is the check the Allocator used to
 * run by importing `configurator/cost-model.js#validateAffinityPrereqs` directly —
 * the crossing CR.9 M3 removes. The Allocator still decides what a conflict MEANS for
 * a budget (it raises the infeasibility error); it no longer decides what a conflict IS.
 */
export function assessDelverStructure({ card, path = "delver" } = {}) {
  const issues = [];
  const vitals = cloneVitals(card?.vitals);
  const prereqResult = validateAffinityPrereqs({
    vitals: toRequirementVitals(vitals),
    regen: toRequirementRegen(vitals),
    affinities: Array.isArray(card?.affinities) ? card.affinities : [],
    fieldBase: `${path}.affinities`,
  });

  prereqResult.errors.forEach((error) => {
    if (error.code === "affinity_requires_mana") {
      issues.push({
        code: error.code,
        path: `${path}.vitals.mana.max`,
        message: `${path} affinities require mana.max >= 1.`,
      });
      return;
    }
    if (error.code === "affinity_requires_mana_regen") {
      issues.push({
        code: error.code,
        path: `${path}.vitals.mana.regen`,
        message: `${path} affinities require mana.regen >= 1.`,
      });
    }
  });

  if (requiresMovementStamina(card)) {
    const floor = resolveWorstCaseMoveCost(card?.capabilities?.movementCost);
    // AM.2b — the POOL check is the one that matters: core clamps regen to max,
    // so `regen >= 1` with `max === 0` still yields an actor that can never
    // move. Checking regen alone is what let F12 stand. Both are asserted.
    if (!(vitals?.stamina?.max >= floor)) {
      issues.push({
        code: "movement_requires_stamina_pool",
        path: `${path}.vitals.stamina.max`,
        message: `${path} movement requires stamina.max >= ${floor} (one worst-case move); `
          + "regen alone cannot accumulate past max.",
      });
    }
    if (vitals?.stamina?.regen <= 0) {
      issues.push({
        code: "movement_requires_stamina_regen",
        path: `${path}.vitals.stamina.regen`,
        message: `${path} movement requires stamina.regen >= 1.`,
      });
    }
  }

  return issues;
}

/**
 * Order the goal tuple. Director/Configurator intent — `optimizationGoals` names
 * which vital to favour when two candidates cost the same — turned into positions.
 * The Allocator receives only the positions.
 */
function resolveDelverGoalOrder(goals = []) {
  const ordered = [];
  const list = goals === undefined || goals === null
    ? []
    : Array.isArray(goals) ? goals : [goals];
  list.forEach((goal) => {
    if (goal?.kind === "maximize_vital_max" && goal?.vital === "mana") {
      ordered.push("mana_max");
      return;
    }
    if (goal?.kind === "maximize_vital_regen" && goal?.vital === "mana") {
      ordered.push("mana_regen");
    }
  });
  if (ordered.length > 0) return ordered;
  return ["mana_max", "mana_regen"];
}

function preferenceTuple(goals, vitals) {
  return goals.map((goal) => (
    goal === "mana_regen" ? vitals.mana.regen : vitals.mana.max
  ));
}

function buildCandidate({ candidateId, card, vitals, affinities, normalizedMotivations, preference }) {
  return {
    schema: CONFIGURATION_CANDIDATE_SCHEMA,
    schemaVersion: SPEND_PROTOCOL_SCHEMA_VERSION,
    candidateId,
    // The card keeps the AUTHORED motivations, because this object is what flows
    // downstream if the candidate wins. Only `priceable` carries the normalized form.
    card: { ...card, vitals },
    priceable: {
      normalizedMotivations,
      affinities,
      vitals,
    },
    preference,
  };
}

/**
 * DECISION (c), settled 2026-08-04: the author refuses; the pricer does not coerce.
 *
 * `normalizeMotivations` detects `conflicting_kind` and exclusive-group violations.
 * The old pricing path called it and then threw `ok`/`errors` away, returning
 * `value || []` — so a delver asking to be both `stealthy` and `friendly` was silently
 * coerced into one of them on every card priced, and the budget maximizer then grew
 * that coerced card. Nothing anywhere reported it.
 *
 * Refusing HERE is the narrow, honest fix: a card whose motivations contradict each
 * other never becomes a ConfigurationCandidate, so the Allocator never prices it and
 * the maximizer leaves the card at its authored size. The legacy raw-data pricing
 * paths (spend ledgers, selection spend, glue) still coerce; that residue is recorded
 * in `allocator/spend-proposal.js` and is NOT closed by this milestone.
 */
function normalizedMotivationsOrNull(card) {
  const raw = card?.motivations || card?.traits?.motivations;
  const result = normalizeMotivations(raw);
  return result.ok ? (result.value || []) : null;
}

/**
 * Enumerate the delver cards worth pricing under this envelope.
 *
 * BOUNDS ARE CAP-DERIVED, which is what makes the search finite:
 *   maximumManaRegen = floor(sqrt(perUnitCap / 5)) + 2
 *   maximumMana      = floor(perUnitCap / 2) + baseManaMax
 * Both were derived in the Allocator before M3; they are configuration-shape
 * decisions ("how big could this card usefully get"), not pricing.
 */
export function proposeDelverCandidates({ card, envelope, optimizationGoals = [], path = "delver" } = {}) {
  const perUnitCap = Number.isInteger(envelope?.perUnitCapTokens) ? envelope.perUnitCapTokens : 0;
  if (perUnitCap <= 0) return [];

  const normalizedMotivations = normalizedMotivationsOrNull(card);
  if (normalizedMotivations === null) return [];

  const goals = resolveDelverGoalOrder(optimizationGoals);
  const baseVitals = cloneVitals(card?.vitals);
  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];

  if (affinities.length > 0) {
    baseVitals.mana.max = Math.max(baseVitals.mana.max, 1);
    baseVitals.mana.current = baseVitals.mana.max;
    baseVitals.mana.regen = Math.max(baseVitals.mana.regen, 1);
  }
  applyMovementStaminaFloor(baseVitals, card);
  applyActorViabilityFloor(baseVitals);

  const maximumManaRegen = Math.max(
    baseVitals.mana.regen,
    Math.floor(Math.sqrt(Math.max(0, perUnitCap) / 5)) + 2,
  );
  const maximumMana = Math.max(
    baseVitals.mana.max,
    Math.floor(Math.max(0, perUnitCap) / 2) + baseVitals.mana.max,
  );

  const candidates = [];
  for (let manaRegen = baseVitals.mana.regen; manaRegen <= maximumManaRegen; manaRegen += 1) {
    for (let manaMax = baseVitals.mana.max; manaMax <= maximumMana; manaMax += 1) {
      const vitals = cloneVitals(baseVitals);
      vitals.mana.max = manaMax;
      vitals.mana.current = manaMax;
      vitals.mana.regen = manaRegen;
      candidates.push(buildCandidate({
        candidateId: `${path}#r${manaRegen}m${manaMax}`,
        card,
        vitals,
        affinities,
        normalizedMotivations,
        preference: preferenceTuple(goals, vitals),
      }));
    }
  }
  return candidates;
}

/**
 * Revise a candidate to absorb the room the Allocator reports as still unspent.
 *
 * This is the second half of the propose/judge round trip, and it exists as a
 * round trip because the fill amount is a function of the candidate's PRICE: the
 * Configurator cannot compute it up front without pricing, which is the one thing it
 * must not do. So the Allocator judges, publishes `remainingTokens`, and asks the
 * author to revise. The Allocator still never assembles a card.
 */
export function reviseDelverCandidate({ candidate, remainingTokens, optimizationGoals = [], path = "delver" } = {}) {
  if (!candidate?.priceable?.vitals) return null;
  const goals = resolveDelverGoalOrder(optimizationGoals);
  const vitals = fillFlexibleDelverVitals(candidate.priceable.vitals, remainingTokens);
  return buildCandidate({
    candidateId: `${candidate.candidateId}+fill`,
    card: candidate.card,
    vitals,
    affinities: candidate.priceable.affinities,
    normalizedMotivations: candidate.priceable.normalizedMotivations,
    preference: preferenceTuple(goals, vitals),
  });
}

/**
 * Enumerate the room cards worth pricing.
 *
 * `sizeFlexible` decides whether the author is offering every supported size or
 * standing on the one requested. The `preference` tuple is the size index, which is
 * how both Allocator consumers tie-break — the maximizer prefers the LARGER index at
 * equal cost, the feasibility assessor the SMALLER. Same enumeration, two selection
 * policies, and the selection policy is the Allocator's.
 */
export function proposeRoomCandidates({ card, sizeFlexible = false, path = "room" } = {}) {
  const requestedSize = String(card?.roomSize || card?.size || "medium").trim().toLowerCase();
  const sizes = sizeFlexible === true ? ROOM_CARD_SIZE_IDS : [requestedSize];

  const candidates = [];
  sizes.forEach((roomSize, sizeIndex) => {
    if (!ROOM_CARD_SIZE_IDS.includes(roomSize)) return;
    candidates.push({
      schema: CONFIGURATION_CANDIDATE_SCHEMA,
      schemaVersion: SPEND_PROTOCOL_SCHEMA_VERSION,
      candidateId: `${path}#${roomSize}`,
      card: { ...card, size: roomSize, roomSize },
      priceable: {
        normalizedMotivations: [],
        affinities: Array.isArray(card?.affinities) ? card.affinities : [],
        vitals: {},
      },
      preference: [sizeIndex],
    });
  });
  return candidates;
}
