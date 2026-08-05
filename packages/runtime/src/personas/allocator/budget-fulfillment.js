/**
 * Budget fulfillment — the Allocator's budget-maximization + feasibility policy.
 *
 * Charter: "budget maximization is Allocator policy". Given a budget cap and a
 * set of room/delver/warden cards, this module decides (a) whether the request
 * is feasible under the budget (assessFeasibility → throws structured errors)
 * and (b) how large to grow each card to spend the budget (maximizeFulfillment).
 *
 * ═══ CR.9 M3 — THE PROPOSE/JUDGE PROTOCOL ═══════════════════════════════════
 *
 * The finding CR.9 named: "the Allocator prices a config it did not author" was
 * FALSE here. This module built its own candidate cards, filled their vitals, and
 * encoded configuration-validity rules — all chartered Configurator work — and then
 * priced its own output. It imported `configurator/cost-model.js` and (through
 * spend-proposal) `configurator/motivation-loadouts.js` precisely because it was
 * doing the Configurator's job and needed the Configurator's rules to do it.
 *
 * The loop CR.9 asked for was not missing. It was FUSED, inside one function:
 * propose `(manaRegen, manaMax)` → price → reject if over → revise → re-price →
 * re-check. M3 is therefore an EXTRACTION, not an invention — the halves are now on
 * opposite sides of the persona line:
 *
 *   Allocator    → Configurator   BudgetEnvelope         "spend up to this"
 *   Configurator → Allocator      ConfigurationCandidate "here is a valid card"
 *   Allocator    → Configurator   SpendVerdict           "approved at N / rejected"
 *
 * WHAT THIS MODULE STILL OWNS, and should: the cap (how many tokens this card gets),
 * the verdict (what a candidate costs and whether that fits), the incumbent (which
 * approved candidate is winning), and the infeasibility verdict. What it no longer
 * owns: what a card IS, whether a card is valid, and which candidates exist.
 *
 * TIE-BREAKING WITHOUT LEARNING INTENT. Candidates carry an opaque `preference`
 * tuple. This module compares it lexicographically as plain numbers and never learns
 * that index 0 means "mana regen" — which is what keeps `optimizationGoals`
 * (Director/Configurator intent) out of Allocator policy while reproducing today's
 * exact ordering.
 *
 * TERMINATION is structural, not a timeout: the outer walk is a fixed single pass
 * over a known card list, and the candidate list is finite because its bounds are
 * pure functions of the cap. `assertJudgementBudget` is a backstop that must never
 * fire; if it does, enumeration has stopped being cap-derived, which is a real defect.
 *
 * Behavior-preserving: enumeration order, bounds, fill rule and tie-break are
 * reproduced exactly. Goldens are the parity gate.
 */
// ROOM_CARD_SIZE_IDS is deliberately NOT imported any more: enumerating cards from
// the size vocabulary was this module authoring configurations, and that enumeration
// now belongs to configurator/candidate-authoring.js.
import { DEFAULT_ROOM_AFFINITY_EXPRESSION } from "../../contracts/domain-constants.js";
// CR.9 M4. This module used to declare its own `SPEND_VERDICT_SCHEMA`, its own copy of
// the authoring-validation vocabulary, and its own validation builders — a private
// third copy of a vocabulary the Allocator does not own, plus two bare string literals
// for the reject reasons. The protocol's values now have one published home, and this
// persona reads them like every other consumer. What stays here is the only part that
// was ever the Allocator's: deciding WHICH refusal applies.
import {
  AUTHORING_VALIDATION_OUTCOMES,
  SPEND_VERDICT_REJECT_REASONS,
  approveSpend,
  createAuthoringValidation,
  createAuthoringValidationIssue,
  rejectSpend,
} from "../../contracts/spend-protocol.js";
import { calculateActorConfigurationUnitCost, calculateRoomCardUnitCost } from "./spend-proposal.js";
import { normalizePriceItems } from "./validate-spend.js";
import { buildDefaultPriceList } from "./default-price-list.js";

/**
 * Raised when budget work is requested without the Configurator's authoring surface.
 *
 * CR.9 M3, decision D-o shape: REQUIRED AND THROWING, never a quiet fallback — the
 * same rule `AllocatorRoomGeometryError` enforces for room geometry, and for the same
 * reason. A fallback that assembled cards here would restore the exact defect CR.9
 * names, and it would be invisible: the maximizer would still return a well-formed
 * card at a plausible price. So absence is a loud construction error.
 *
 * This refusal is the milestone's real detector. A differential ("does the Allocator
 * agree with the Configurator?") is satisfiable by a façade that computes the right
 * answer for the wrong reason — proven by M2's own perturbation test. A façade that
 * authors its own fallback cannot refuse.
 */
export class AllocatorCandidateAuthoringError extends Error {
  constructor() {
    super(
      "Allocator cannot maximize a budget without the Configurator's candidate "
      + "authoring: pass { authorCandidates } from createConfiguratorPersona(). "
      + "Assembling cards, filling vitals and deciding configuration validity are "
      + "Configurator work (candidate-authoring.js); the Allocator prices what it is "
      + "given and never authors what it prices (finding CR.9).",
    );
    this.name = "AllocatorCandidateAuthoringError";
    this.code = "allocator_candidate_authoring_required";
  }
}

function requireAuthoring(authorCandidates) {
  if (
    !authorCandidates
    || typeof authorCandidates.proposeDelverCandidates !== "function"
    || typeof authorCandidates.reviseDelverCandidate !== "function"
    || typeof authorCandidates.proposeRoomCandidates !== "function"
    || typeof authorCandidates.assessDelverStructure !== "function"
    || typeof authorCandidates.buildMinimumDelverCard !== "function"
    || typeof authorCandidates.buildBudgetEnvelope !== "function"
    || typeof authorCandidates.readCardVitals !== "function"
  ) {
    throw new AllocatorCandidateAuthoringError();
  }
  return authorCandidates;
}

// Generic pure helpers, reproduced locally (the CLI keeps its own copies for its
// many other call sites; these are trivial coercions, not domain constants).
function normalizeList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Equivalent to the CLI's allocatorPriceItems: the persona's normalized price map
// from the supplied PriceList artifact, or the canonical default when absent.
// (createAllocatorPersona({priceList}).pricing.priceMap() === normalizePriceItems(priceList);
// only the items matter for the map, so the default's meta/clock is irrelevant.)
const allocatorPriceItems = (priceListArtifact) =>
  normalizePriceItems(priceListArtifact || buildDefaultPriceList({}));

function cardCount(card) {
  return Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
}

/**
 * Price one delver-shaped card.
 *
 * The vitals are read through the Configurator's canonical reading rather than
 * normalized here: "what are this card's vitals, with defaults applied" is a question
 * about card shape, and card shape is not the Allocator's to answer.
 */
function calculateDelverCardUnitCost(card, priceMap, { authoring, normalizeMotivations }) {
  return calculateActorConfigurationUnitCost({
    entry: {
      motivations: Array.isArray(card?.motivations) ? card.motivations : [],
      affinities: Array.isArray(card?.affinities) ? card.affinities : [],
      vitals: authoring.readCardVitals(card?.vitals),
    },
    priceMap,
    normalizeMotivations,
  }).cost;
}

function formatAffinityList(affinities = []) {
  return normalizeList(affinities)
    .map((entry) => {
      const kind = String(entry?.kind || "affinity").trim().toLowerCase();
      const expression = String(entry?.expression || DEFAULT_ROOM_AFFINITY_EXPRESSION).trim().toLowerCase();
      const stacks = Number.isInteger(entry?.stacks) && entry.stacks > 0 ? entry.stacks : 1;
      return `${kind}:${expression}:${stacks}`;
    })
    .join(", ");
}

function joinConstraintClauses(clauses = []) {
  const filtered = clauses.filter((entry) => isNonEmptyString(entry));
  if (filtered.length === 0) {
    return "";
  }
  if (filtered.length === 1) {
    return filtered[0];
  }
  if (filtered.length === 2) {
    return `${filtered[0]} and ${filtered[1]}`;
  }
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered.at(-1)}`;
}

function formatAuthoringValidationMessage(commandName, validation) {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const details = issues.map((issue) => issue.message).join("; ");
  return `${commandName} infeasible (${validation.outcome}): ${validation.summary}${details ? ` Blocking constraints: ${details}` : ""}`;
}

/**
 * Does this card's own configuration contradict itself?
 *
 * The QUESTION is the Configurator's and is asked through its authoring surface; what
 * a contradiction MEANS for a budget stays here. Before M3 this function imported
 * `configurator/cost-model.js#validateAffinityPrereqs` and encoded the movement-stamina
 * rule inline — the Allocator deciding what a valid configuration is.
 */
function collectBudgetedDelverConflictIssues(entry, delverIndex, authoring) {
  if (entry?.vitalsFlexible === true) {
    return [];
  }
  return authoring.assessDelverStructure({
    card: entry?.value,
    path: `delver[${delverIndex}]`,
  });
}

function assessBudgetedRoomRequirement(entry, roomIndex, priceListArtifact, deriveRoomLayout, authoring) {
  const sizeFlexible = entry?.sizeFlexible === true;
  const candidates = authoring.proposeRoomCandidates({
    card: entry?.value,
    sizeFlexible,
    path: `room[${roomIndex}]`,
  });
  let minimum = null;

  candidates.forEach((candidate) => {
    const candidateCard = candidate.card;
    const totalCost = calculateRoomCardUnitCost({
      card: candidateCard,
      priceList: priceListArtifact,
      deriveRoomLayout,
    }).cost * cardCount(candidateCard);
    const requirementSummary = sizeFlexible
      ? `requested affinities ${formatAffinityList(candidateCard.affinities)} at the smallest supported room size`
      : `requested room size ${candidateCard.roomSize} with affinities ${formatAffinityList(candidateCard.affinities)}`;
    const assessment = {
      path: `room[${roomIndex}]`,
      totalCost,
      requirementSummary,
      // The Configurator's opaque ordering signal. Read as a number for the
      // smallest-size tie-break; its MEANING is never interpreted here.
      sizeIndex: candidate.preference[0],
    };
    if (!minimum || assessment.totalCost < minimum.totalCost || (
      assessment.totalCost === minimum.totalCost && assessment.sizeIndex < minimum.sizeIndex
    )) {
      minimum = assessment;
    }
  });

  return minimum;
}

function assessBudgetedDelverRequirement(entry, delverIndex, priceListArtifact, authoring, normalizeMotivations) {
  const candidateCard = authoring.buildMinimumDelverCard(entry.value);
  const priceMap = allocatorPriceItems(priceListArtifact);
  const totalCost = calculateDelverCardUnitCost(candidateCard, priceMap, { authoring, normalizeMotivations })
    * cardCount(candidateCard);
  const requirementParts = [];
  if (Array.isArray(candidateCard?.affinities) && candidateCard.affinities.length > 0) {
    requirementParts.push(`affinities ${formatAffinityList(candidateCard.affinities)}`);
    requirementParts.push("mana.max >= 1");
    requirementParts.push("mana.regen >= 1");
  }
  if (!(Array.isArray(candidateCard?.motivations) ? candidateCard.motivations : []).includes("stationary")) {
    requirementParts.push("stamina.regen >= 1");
  }
  return {
    path: `delver[${delverIndex}]`,
    totalCost,
    requirementSummary: requirementParts.length > 0
      ? `requested ${joinConstraintClauses(requirementParts)}`
      : "requested delver configuration",
  };
}

function assessBudgetedWardenRequirement(entry, wardenIndex, priceListArtifact, authoring, normalizeMotivations) {
  const card = entry?.value && typeof entry.value === "object" ? entry.value : {};
  const priceMap = allocatorPriceItems(priceListArtifact);
  const totalCost = calculateDelverCardUnitCost(card, priceMap, { authoring, normalizeMotivations })
    * cardCount(card);
  const requirementParts = [];
  if (Array.isArray(card?.affinities) && card.affinities.length > 0) {
    requirementParts.push(`affinities ${formatAffinityList(card.affinities)}`);
  }
  if (card?.vitals && typeof card.vitals === "object") {
    requirementParts.push("explicit vitals");
  }
  return {
    path: `warden[${wardenIndex}]`,
    totalCost,
    requirementSummary: requirementParts.length > 0
      ? `requested ${joinConstraintClauses(requirementParts)}`
      : "requested warden configuration",
  };
}

function requirementKind(path = "") {
  if (path.startsWith("room[")) return "room";
  if (path.startsWith("warden[")) return "warden";
  return "delver";
}

export function ensureBudgetedFulfillmentFeasible({
  commandName,
  budgetTokens,
  rooms = [],
  delvers = [],
  wardens = [],
  priceListArtifact,
  deriveRoomLayout,
  authorCandidates,
  normalizeMotivations,
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return;
  }
  const authoring = requireAuthoring(authorCandidates);

  const conflictIssues = delvers.flatMap((entry, index) => collectBudgetedDelverConflictIssues(entry, index + 1, authoring));
  if (conflictIssues.length > 0) {
    const validation = createAuthoringValidation({
      outcome: AUTHORING_VALIDATION_OUTCOMES.conflictingRequirements,
      summary: "explicit hard requirements conflict with the minimum support needed for the requested configuration.",
      issues: conflictIssues,
    });
    const error = new Error(formatAuthoringValidationMessage(commandName, validation));
    error.validation = validation;
    throw error;
  }

  const roomRequirements = rooms.map((entry, index) => assessBudgetedRoomRequirement(entry, index + 1, priceListArtifact, deriveRoomLayout, authoring)).filter(Boolean);
  const delverRequirements = delvers.map((entry, index) => assessBudgetedDelverRequirement(entry, index + 1, priceListArtifact, authoring, normalizeMotivations)).filter(Boolean);
  const wardenRequirements = wardens.map((entry, index) => assessBudgetedWardenRequirement(entry, index + 1, priceListArtifact, authoring, normalizeMotivations)).filter(Boolean);
  const requirements = [...roomRequirements, ...delverRequirements, ...wardenRequirements];
  const minimumRequiredTokens = requirements.reduce((sum, entry) => sum + entry.totalCost, 0);

  if (minimumRequiredTokens > budgetTokens) {
    const validation = createAuthoringValidation({
      outcome: AUTHORING_VALIDATION_OUTCOMES.insufficientBudget,
      summary: `hard budget is ${budgetTokens} tokens but minimum required spend is ${minimumRequiredTokens} tokens.`,
      issues: requirements.map((entry) => createAuthoringValidationIssue({
        code: `${requirementKind(entry.path)}_minimum_cost_exceeds_budget`,
        path: entry.path,
        message: `${entry.path} requires at least ${entry.totalCost} tokens to preserve ${entry.requirementSummary}.`,
      })),
    });
    const error = new Error(formatAuthoringValidationMessage(commandName, validation));
    error.validation = validation;
    throw error;
  }
}

/** Lexicographic comparison of two opaque preference tuples. */
function compareNumericTuple(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

/**
 * Price exactly one candidate and return a verdict.
 *
 * This is the whole of the Allocator's half of the protocol. Note what it reads:
 * `candidate.priceable` and nothing else. It never touches `candidate.card` — the
 * assembled card is the Configurator's product, and the Allocator's only interest in
 * it is handing it back if it wins.
 *
 * A rejection is a RESULT, not a `continue`. In the fused loop both over-cap outcomes
 * were bare `continue` statements, so "why did this budget go unspent?" had no answer
 * anywhere in the system.
 *
 * CR.9 M4 gave the two refusals a published vocabulary
 * (`contracts/spend-protocol.js#SPEND_VERDICT_REJECT_REASONS`) instead of two inline
 * string literals, and EXPORTED this function. The export is the milestone's gate: a
 * reject reason that can only be produced inside a loop that discards it cannot be
 * asserted per kind, and a vocabulary no test can reach is how the previous copy of
 * it stayed dead and unnoticed through three milestones.
 */
export function judgeCandidate(candidate, { priceMap, envelope }) {
  const unitCost = calculateActorConfigurationUnitCost({
    entry: {
      normalizedMotivations: candidate.priceable.normalizedMotivations,
      affinities: candidate.priceable.affinities,
      vitals: candidate.priceable.vitals,
    },
    priceMap,
  }).cost;

  if (!Number.isInteger(unitCost) || unitCost <= 0) {
    return rejectSpend({
      candidateId: candidate.candidateId,
      reason: SPEND_VERDICT_REJECT_REASONS.notPriceable,
    });
  }
  if (unitCost > envelope.perUnitCapTokens) {
    return rejectSpend({
      candidateId: candidate.candidateId,
      reason: SPEND_VERDICT_REJECT_REASONS.overCap,
    });
  }
  return approveSpend({
    candidateId: candidate.candidateId,
    unitCostTokens: unitCost,
    costTokens: unitCost * envelope.count,
    remainingTokens: envelope.perUnitCapTokens - unitCost,
  });
}

/**
 * Backstop that must never fire.
 *
 * Deliberately NOT a copy of the Configurator's bound formula: replicating that here
 * would rebuild the very coupling M3 removes, and it would go stale the moment the
 * author's bounds change legitimately. It only has to be an upper bound a genuinely
 * cap-derived enumeration cannot reach — today's is about
 * `(sqrt(cap/5)+2)·(cap/2+1)`, comfortably under `cap²`.
 *
 * If this ever throws, enumeration has stopped being cap-derived and termination is
 * no longer structural. That is a real defect and should be loud rather than slow.
 */
function assertJudgementBudget(judged, envelope) {
  const ceiling = Math.max(4096, envelope.perUnitCapTokens * envelope.perUnitCapTokens);
  if (judged > ceiling) {
    throw new Error(
      `Allocator judged ${judged} candidates for a per-unit cap of ${envelope.perUnitCapTokens}, `
      + `exceeding the ${ceiling} backstop. Candidate enumeration is no longer bounded by the `
      + "budget envelope, so the maximizer's termination is no longer structural (CR.9 M3).",
    );
  }
}

function maximizeBudgetCappedDelverCard(card, {
  availableTokens,
  priceListArtifact,
  optimizationGoals = [],
  allowVitalTuning = false,
  authoring,
  path = "delver",
} = {}) {
  if (!allowVitalTuning || !Number.isInteger(availableTokens) || availableTokens <= 0) {
    return card;
  }

  const envelope = authoring.buildBudgetEnvelope({ capTokens: availableTokens, count: cardCount(card) });
  if (envelope.perUnitCapTokens <= 0) {
    return card;
  }

  const priceMap = allocatorPriceItems(priceListArtifact);
  const candidates = authoring.proposeDelverCandidates({ card, envelope, optimizationGoals, path });

  let best = null;
  let judged = 0;

  for (const candidate of candidates) {
    judged += 1;
    assertJudgementBudget(judged, envelope);

    const verdict = judgeCandidate(candidate, { priceMap, envelope });
    if (!verdict.approved) continue;

    // The revision round trip: the Allocator publishes the room still unspent and the
    // Configurator decides what to do with it. The fill is price-dependent, so it
    // cannot be offered up front without the author pricing — the one thing it must
    // not do.
    const revised = authoring.reviseDelverCandidate({
      candidate,
      remainingTokens: verdict.remainingTokens,
      optimizationGoals,
      path,
    });
    if (!revised) continue;

    judged += 1;
    assertJudgementBudget(judged, envelope);

    const revisedVerdict = judgeCandidate(revised, { priceMap, envelope });
    if (!revisedVerdict.approved) continue;

    const contender = {
      card: revised.card,
      totalCost: revisedVerdict.costTokens,
      preference: revised.preference,
    };
    if (!best) {
      best = contender;
      continue;
    }
    if (contender.totalCost !== best.totalCost) {
      if (contender.totalCost > best.totalCost) best = contender;
      continue;
    }
    if (compareNumericTuple(contender.preference, best.preference) > 0) {
      best = contender;
    }
  }

  return best?.card || card;
}

function maximizeBudgetCappedRoomCard(card, {
  availableTokens,
  priceListArtifact,
  allowSizeTuning = false,
  deriveRoomLayout,
  authoring,
  path = "room",
} = {}) {
  if (!allowSizeTuning || !Number.isInteger(availableTokens) || availableTokens <= 0) {
    return card;
  }
  const count = cardCount(card);
  let best = null;

  authoring.proposeRoomCandidates({ card, sizeFlexible: true, path }).forEach((candidate) => {
    const unitCost = calculateRoomCardUnitCost({
      card: candidate.card,
      priceList: priceListArtifact,
      deriveRoomLayout,
    }).cost;
    const totalCost = unitCost * count;
    if (!Number.isInteger(totalCost) || totalCost <= 0 || totalCost > availableTokens) {
      return;
    }
    const contender = {
      card: candidate.card,
      totalCost,
      preference: candidate.preference,
    };
    if (!best || contender.totalCost > best.totalCost || (
      contender.totalCost === best.totalCost
      && compareNumericTuple(contender.preference, best.preference) > 0
    )) {
      best = contender;
    }
  });

  return best?.card || card;
}

export function applyBudgetCappedFulfillment({
  rooms = [],
  delvers = [],
  priceListArtifact,
  budgetTokens,
  deriveRoomLayout,
  authorCandidates,
  normalizeMotivations,
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return {
      rooms: rooms.map((entry) => ({ ...entry })),
      delvers: delvers.map((entry) => ({ ...entry })),
    };
  }
  const authoring = requireAuthoring(authorCandidates);

  const nextRooms = rooms.map((entry) => ({
    ...entry,
    value: entry?.value && typeof entry.value === "object" ? { ...entry.value } : entry?.value,
  }));
  const nextDelvers = delvers.map((entry) => ({
    ...entry,
    value: entry?.value && typeof entry.value === "object" ? { ...entry.value } : entry?.value,
    optimizationGoals: Array.isArray(entry?.optimizationGoals) ? entry.optimizationGoals.slice() : [],
  }));
  const priceMap = allocatorPriceItems(priceListArtifact);

  const calculateCurrentTotal = () => {
    const roomTotal = nextRooms.reduce((sum, entry) => sum + calculateRoomCardUnitCost({
      card: entry.value,
      priceList: priceListArtifact,
      deriveRoomLayout,
    }).cost * (entry?.value?.count || 1), 0);
    const delverTotal = nextDelvers.reduce((sum, entry) => sum
      + calculateDelverCardUnitCost(entry.value, priceMap, { authoring, normalizeMotivations })
      * (entry?.value?.count || 1), 0);
    return roomTotal + delverTotal;
  };

  nextRooms.forEach((entry, roomIndex) => {
    const currentCardCost = calculateRoomCardUnitCost({
      card: entry.value,
      priceList: priceListArtifact,
      deriveRoomLayout,
    }).cost * (entry?.value?.count || 1);
    const otherCost = calculateCurrentTotal() - currentCardCost;
    const availableTokens = Math.max(0, budgetTokens - otherCost);
    nextRooms[roomIndex].value = maximizeBudgetCappedRoomCard(entry.value, {
      availableTokens,
      priceListArtifact,
      allowSizeTuning: entry?.sizeFlexible === true,
      deriveRoomLayout,
      authoring,
      path: `room[${roomIndex + 1}]`,
    });
  });

  nextDelvers.forEach((entry, delverIndex) => {
    const currentCardCost = calculateDelverCardUnitCost(entry.value, priceMap, { authoring, normalizeMotivations })
      * (entry?.value?.count || 1);
    const otherCost = calculateCurrentTotal() - currentCardCost;
    const availableTokens = Math.max(0, budgetTokens - otherCost);
    nextDelvers[delverIndex].value = maximizeBudgetCappedDelverCard(entry.value, {
      availableTokens,
      priceListArtifact,
      optimizationGoals: entry.optimizationGoals,
      allowVitalTuning: entry?.vitalsFlexible === true,
      authoring,
      path: `delver[${delverIndex + 1}]`,
    });
  });

  return {
    rooms: nextRooms,
    delvers: nextDelvers,
  };
}
