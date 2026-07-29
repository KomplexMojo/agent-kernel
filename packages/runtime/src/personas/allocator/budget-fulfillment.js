/**
 * Budget fulfillment — the Allocator's budget-maximization + feasibility policy.
 *
 * Charter: "budget maximization is Allocator policy". Given a budget cap and a
 * set of room/delver/warden cards, this module decides (a) whether the request
 * is feasible under the budget (assessFeasibility → throws structured errors)
 * and (b) how large to grow each card to spend the budget (maximizeFulfillment).
 *
 * OWNERSHIP SPLIT (P2.3.4, maintainer decision D1): the *policy* — the search,
 * the fill, the feasibility verdict — lives HERE, in the Allocator. The *card
 * costing* it consults (calculateActorConfigurationUnitCost / calculateRoomCardUnitCost
 * / validateAffinityPrereqs / ROOM_CARD_SIZE_IDS) stays Configurator-owned; this
 * module imports it exactly as allocator/selection-spend.js already does. The
 * Allocator never authors a card's price — it asks the Configurator, then decides.
 *
 * Relocated verbatim from adapters-cli/ak-impl.mjs (behavior-preserving; goldens
 * are the parity gate). Exposed to the CLI only through allocator-services.js →
 * the persona controller; nothing outside personas/allocator/ imports this file.
 */
import {
  DEFAULT_ROOM_AFFINITY_EXPRESSION,
  DEFAULT_VITALS,
  ROOM_CARD_SIZE_IDS,
  VITAL_KEYS,
} from "../../contracts/domain-constants.js";
import { calculateActorConfigurationUnitCost, calculateRoomCardUnitCost } from "../configurator/spend-proposal.js";
import { validateAffinityPrereqs } from "../configurator/cost-model.js";
import { normalizePriceItems } from "./validate-spend.js";
import { buildDefaultPriceList } from "./default-price-list.js";

const AUTHORING_VALIDATION_OUTCOMES = Object.freeze({
  valid: "valid",
  invalidRequirements: "invalid_requirements",
  conflictingRequirements: "conflicting_requirements",
  insufficientBudget: "insufficient_budget",
});

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

function hasNonStationaryMobilityMotivation(motivations = []) {
  return motivations.some((motivation) => motivation === "random" || motivation === "exploring" || motivation === "patrolling");
}

function requiresMovementStamina(card = null) {
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];
  return card?.type === "delver" || hasNonStationaryMobilityMotivation(motivations);
}

function cloneVitals(vitals = DEFAULT_VITALS) {
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

function calculateDelverCardUnitCost(card, priceMap) {
  return calculateActorConfigurationUnitCost({
    entry: {
      motivations: Array.isArray(card?.motivations) ? card.motivations : [],
      affinities: Array.isArray(card?.affinities) ? card.affinities : [],
      vitals: cloneVitals(card?.vitals),
    },
    priceMap,
  }).cost;
}

function createAuthoringValidationIssue({ code, message, path } = {}) {
  const issue = {
    code,
    message,
  };
  if (path) {
    issue.path = path;
  }
  return issue;
}

function createAuthoringValidation({ outcome, summary, issues = [] } = {}) {
  return {
    outcome,
    summary,
    issues: issues
      .filter((issue) => issue && typeof issue === "object")
      .map((issue) => createAuthoringValidationIssue(issue))
      .sort((left, right) => {
        const leftPath = left.path || "";
        const rightPath = right.path || "";
        if (leftPath !== rightPath) {
          return leftPath.localeCompare(rightPath);
        }
        return left.code.localeCompare(right.code);
      }),
  };
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

function buildMinimumRequiredDelverCard(card) {
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
  if (requiresMovementStamina(card)) {
    next.vitals.stamina.regen = Math.max(next.vitals.stamina.regen, 1);
  }

  return next;
}

function collectBudgetedDelverConflictIssues(entry, delverIndex) {
  const issues = [];
  if (entry?.vitalsFlexible === true) {
    return issues;
  }

  const card = entry?.value;
  const path = `delver[${delverIndex}]`;
  const vitals = cloneVitals(card?.vitals);
  const prereqResult = validateAffinityPrereqs({
    vitals: toRequirementVitals(vitals),
    regen: toRequirementRegen(vitals),
    affinities: Array.isArray(card?.affinities) ? card.affinities : [],
    fieldBase: `${path}.affinities`,
  });

  prereqResult.errors.forEach((error) => {
    if (error.code === "affinity_requires_mana") {
      issues.push(createAuthoringValidationIssue({
        code: error.code,
        path: `${path}.vitals.mana.max`,
        message: `${path} affinities require mana.max >= 1.`,
      }));
      return;
    }
    if (error.code === "affinity_requires_mana_regen") {
      issues.push(createAuthoringValidationIssue({
        code: error.code,
        path: `${path}.vitals.mana.regen`,
        message: `${path} affinities require mana.regen >= 1.`,
      }));
    }
  });

  if (requiresMovementStamina(card) && vitals?.stamina?.regen <= 0) {
    issues.push(createAuthoringValidationIssue({
      code: "movement_requires_stamina_regen",
      path: `${path}.vitals.stamina.regen`,
      message: `${path} movement requires stamina.regen >= 1.`,
    }));
  }

  return issues;
}

function assessBudgetedRoomRequirement(entry, roomIndex, priceListArtifact) {
  const candidateSizes = entry?.sizeFlexible === true
    ? ROOM_CARD_SIZE_IDS
    : [String(entry?.value?.roomSize || entry?.value?.size || "medium").trim().toLowerCase()];
  let minimum = null;

  candidateSizes.forEach((roomSize, sizeIndex) => {
    if (!ROOM_CARD_SIZE_IDS.includes(roomSize)) {
      return;
    }
    const candidateCard = {
      ...entry.value,
      size: roomSize,
      roomSize,
    };
    const count = Number.isInteger(candidateCard?.count) && candidateCard.count > 0 ? candidateCard.count : 1;
    const totalCost = calculateRoomCardUnitCost({
      card: candidateCard,
      priceList: priceListArtifact,
    }).cost * count;
    const requirementSummary = entry?.sizeFlexible === true
      ? `requested affinities ${formatAffinityList(candidateCard.affinities)} at the smallest supported room size`
      : `requested room size ${roomSize} with affinities ${formatAffinityList(candidateCard.affinities)}`;
    const assessment = {
      path: `room[${roomIndex}]`,
      totalCost,
      requirementSummary,
      sizeIndex,
    };
    if (!minimum || assessment.totalCost < minimum.totalCost || (
      assessment.totalCost === minimum.totalCost && assessment.sizeIndex < minimum.sizeIndex
    )) {
      minimum = assessment;
    }
  });

  return minimum;
}

function assessBudgetedDelverRequirement(entry, delverIndex, priceListArtifact) {
  const candidateCard = buildMinimumRequiredDelverCard(entry.value);
  const count = Number.isInteger(candidateCard?.count) && candidateCard.count > 0 ? candidateCard.count : 1;
  const priceMap = allocatorPriceItems(priceListArtifact);
  const totalCost = calculateDelverCardUnitCost(candidateCard, priceMap) * count;
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

function assessBudgetedWardenRequirement(entry, wardenIndex, priceListArtifact) {
  const card = entry?.value && typeof entry.value === "object" ? entry.value : {};
  const count = Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
  const priceMap = allocatorPriceItems(priceListArtifact);
  const totalCost = calculateDelverCardUnitCost(card, priceMap) * count;
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
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return;
  }

  const conflictIssues = delvers.flatMap((entry, index) => collectBudgetedDelverConflictIssues(entry, index + 1));
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

  const roomRequirements = rooms.map((entry, index) => assessBudgetedRoomRequirement(entry, index + 1, priceListArtifact)).filter(Boolean);
  const delverRequirements = delvers.map((entry, index) => assessBudgetedDelverRequirement(entry, index + 1, priceListArtifact)).filter(Boolean);
  const wardenRequirements = wardens.map((entry, index) => assessBudgetedWardenRequirement(entry, index + 1, priceListArtifact)).filter(Boolean);
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

function resolveDelverGoalOrder(goals = []) {
  const ordered = [];
  normalizeList(goals).forEach((goal) => {
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

function fillFlexibleDelverVitals(vitals, remainingTokens) {
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

function maximizeBudgetCappedDelverCard(card, {
  availableTokens,
  priceListArtifact,
  optimizationGoals = [],
  allowVitalTuning = false,
} = {}) {
  if (!allowVitalTuning || !Number.isInteger(availableTokens) || availableTokens <= 0) {
    return card;
  }

  const count = Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
  const perUnitBudget = Math.floor(availableTokens / count);
  if (perUnitBudget <= 0) {
    return card;
  }

  const priceMap = allocatorPriceItems(priceListArtifact);
  const goals = resolveDelverGoalOrder(optimizationGoals);
  const baseVitals = cloneVitals(card?.vitals);
  const affinities = Array.isArray(card?.affinities) ? card.affinities : [];
  const motivations = Array.isArray(card?.motivations) ? card.motivations : [];

  if (affinities.length > 0) {
    baseVitals.mana.max = Math.max(baseVitals.mana.max, 1);
    baseVitals.mana.current = baseVitals.mana.max;
    baseVitals.mana.regen = Math.max(baseVitals.mana.regen, 1);
  }
  if (requiresMovementStamina(card)) {
    baseVitals.stamina.regen = Math.max(baseVitals.stamina.regen, 1);
  }

  const maximumManaRegen = Math.max(
    baseVitals.mana.regen,
    Math.floor(Math.sqrt(Math.max(0, perUnitBudget) / 5)) + 2,
  );
  const maximumMana = Math.max(
    baseVitals.mana.max,
    Math.floor(Math.max(0, perUnitBudget) / 2) + baseVitals.mana.max,
  );

  let best = null;
  for (let manaRegen = baseVitals.mana.regen; manaRegen <= maximumManaRegen; manaRegen += 1) {
    for (let manaMax = baseVitals.mana.max; manaMax <= maximumMana; manaMax += 1) {
      const candidateVitals = cloneVitals(baseVitals);
      candidateVitals.mana.max = manaMax;
      candidateVitals.mana.current = manaMax;
      candidateVitals.mana.regen = manaRegen;

      const candidateCost = calculateActorConfigurationUnitCost({
        entry: {
          motivations,
          affinities,
          vitals: candidateVitals,
        },
        priceMap,
      }).cost;
      if (!Number.isInteger(candidateCost) || candidateCost <= 0 || candidateCost > perUnitBudget) {
        continue;
      }

      const filledVitals = fillFlexibleDelverVitals(candidateVitals, perUnitBudget - candidateCost);
      const filledCost = calculateActorConfigurationUnitCost({
        entry: {
          motivations,
          affinities,
          vitals: filledVitals,
        },
        priceMap,
      }).cost;
      if (!Number.isInteger(filledCost) || filledCost <= 0 || filledCost > perUnitBudget) {
        continue;
      }

      const goalTuple = goals.map((goal) => (
        goal === "mana_regen"
          ? filledVitals.mana.regen
          : filledVitals.mana.max
      ));
      const candidate = {
        card: {
          ...card,
          vitals: filledVitals,
        },
        totalCost: filledCost * count,
        goalTuple,
      };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.totalCost !== best.totalCost) {
        if (candidate.totalCost > best.totalCost) best = candidate;
        continue;
      }
      if (compareNumericTuple(candidate.goalTuple, best.goalTuple) > 0) {
        best = candidate;
      }
    }
  }

  return best?.card || card;
}

function maximizeBudgetCappedRoomCard(card, {
  availableTokens,
  priceListArtifact,
  allowSizeTuning = false,
} = {}) {
  if (!allowSizeTuning || !Number.isInteger(availableTokens) || availableTokens <= 0) {
    return card;
  }
  const count = Number.isInteger(card?.count) && card.count > 0 ? card.count : 1;
  let best = null;

  ROOM_CARD_SIZE_IDS.forEach((roomSize, sizeIndex) => {
    const candidateCard = {
      ...card,
      size: roomSize,
      roomSize,
    };
    const unitCost = calculateRoomCardUnitCost({
      card: candidateCard,
      priceList: priceListArtifact,
    }).cost;
    const totalCost = unitCost * count;
    if (!Number.isInteger(totalCost) || totalCost <= 0 || totalCost > availableTokens) {
      return;
    }
    const candidate = {
      card: candidateCard,
      totalCost,
      sizeIndex,
    };
    if (!best || candidate.totalCost > best.totalCost || (
      candidate.totalCost === best.totalCost && candidate.sizeIndex > best.sizeIndex
    )) {
      best = candidate;
    }
  });

  return best?.card || card;
}

export function applyBudgetCappedFulfillment({
  rooms = [],
  delvers = [],
  priceListArtifact,
  budgetTokens,
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return {
      rooms: rooms.map((entry) => ({ ...entry })),
      delvers: delvers.map((entry) => ({ ...entry })),
    };
  }

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
    }).cost * (entry?.value?.count || 1), 0);
    const delverTotal = nextDelvers.reduce((sum, entry) => sum + calculateDelverCardUnitCost(entry.value, priceMap) * (entry?.value?.count || 1), 0);
    return roomTotal + delverTotal;
  };

  nextRooms.forEach((entry, roomIndex) => {
    const currentCardCost = calculateRoomCardUnitCost({
      card: entry.value,
      priceList: priceListArtifact,
    }).cost * (entry?.value?.count || 1);
    const otherCost = calculateCurrentTotal() - currentCardCost;
    const availableTokens = Math.max(0, budgetTokens - otherCost);
    nextRooms[roomIndex].value = maximizeBudgetCappedRoomCard(entry.value, {
      availableTokens,
      priceListArtifact,
      allowSizeTuning: entry?.sizeFlexible === true,
    });
  });

  nextDelvers.forEach((entry, delverIndex) => {
    const currentCardCost = calculateDelverCardUnitCost(entry.value, priceMap) * (entry?.value?.count || 1);
    const otherCost = calculateCurrentTotal() - currentCardCost;
    const availableTokens = Math.max(0, budgetTokens - otherCost);
    nextDelvers[delverIndex].value = maximizeBudgetCappedDelverCard(entry.value, {
      availableTokens,
      priceListArtifact,
      optimizationGoals: entry.optimizationGoals,
      allowVitalTuning: entry?.vitalsFlexible === true,
    });
  });

  return {
    rooms: nextRooms,
    delvers: nextDelvers,
  };
}
