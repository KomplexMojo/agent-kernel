import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
  LLM_STOP_REASONS,
  deriveAllowedOptionsFromCatalog,
} from "./prompt-contract.js";
import { runLlmSession } from "./llm-session.js";
import { mapSummaryToPool } from "../director/pool-mapper.js";
import { deriveLevelGen } from "../director/buildspec-assembler.js";
import { buildBudgetAllocation } from "../director/budget-allocation.js";
import { validateLayoutAndActors, validateLayoutCountsAndActors } from "../configurator/feasibility.js";
import { normalizePoolCatalog } from "../configurator/pool-catalog.js";
import {
  evaluateLayoutSpend,
  LAYOUT_TILE_FIELDS,
  normalizeLayoutCounts,
  resolveLayoutTileCosts,
  sumLayoutTiles,
} from "../allocator/layout-spend.js";
import { evaluateSelectionSpend } from "../allocator/selection-spend.js";
import {
  DOMAIN_CONSTRAINTS,
  LLM_REPAIR_TEXT,
  buildLlmPhasePromptTemplate,
  buildLlmRepairPromptTemplate,
} from "../../contracts/domain-constants.js";

const DEFAULT_MAX_ACTOR_ROUNDS = 2;
const MAX_EXACT_LAYOUT_FEASIBILITY_TILES = 1_000_000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function formatAffinityPhrase(affinities = []) {
  if (!Array.isArray(affinities) || affinities.length === 0) return "";
  if (affinities.length === 1) return affinities[0];
  if (affinities.length === 2) return `${affinities[0]} and ${affinities[1]}`;
  return `${affinities.slice(0, -1).join(", ")}, and ${affinities[affinities.length - 1]}`;
}

function applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs } = {}) {
  if (!Array.isArray(captures) || captures.length === 0) return;
  const phaseTiming = {};
  if (isNonEmptyString(startedAt)) phaseTiming.startedAt = startedAt;
  if (isNonEmptyString(endedAt)) phaseTiming.endedAt = endedAt;
  if (Number.isFinite(durationMs)) phaseTiming.durationMs = durationMs;
  if (Object.keys(phaseTiming).length === 0) return;
  captures.forEach((capture) => {
    if (!capture || typeof capture !== "object") return;
    if (!capture.payload || typeof capture.payload !== "object") return;
    capture.payload.phaseTiming = { ...phaseTiming };
  });
}

function deriveAllowedPairs(catalog) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : Array.isArray(catalog) ? catalog : [];
  const pairs = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const { motivation, affinity } = entry;
    if (typeof motivation !== "string" || typeof affinity !== "string") return;
    const key = `${motivation}|${affinity}`;
    if (!pairs.has(key)) {
      pairs.set(key, { motivation, affinity });
    }
  });
  return Array.from(pairs.values()).sort(
    (a, b) => a.motivation.localeCompare(b.motivation) || a.affinity.localeCompare(b.affinity),
  );
}

function formatAllowedPairs(pairs) {
  return pairs.map((pair) => `(${pair.motivation}, ${pair.affinity})`).join(", ");
}

function computeCheapestCost(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.reduce((min, entry) => {
    const cost = Number.isInteger(entry?.cost) ? entry.cost : null;
    if (!Number.isInteger(cost)) return min;
    return min === null || cost < min ? cost : min;
  }, null);
}

function countInstances(selections, kind) {
  return selections
    .filter((sel) => sel.kind === kind && Array.isArray(sel.instances))
    .reduce((sum, sel) => sum + sel.instances.length, 0);
}

function countRequestedSelections(selections, kind) {
  return selections
    .filter((sel) => sel.kind === kind)
    .reduce((sum, sel) => {
      const requested = sel?.requested;
      if (Number.isInteger(requested?.count) && requested.count > 0) {
        return sum + requested.count;
      }
      if (Array.isArray(sel?.instances)) {
        return sum + sel.instances.length;
      }
      return sum;
    }, 0);
}

function summarizeMissingSelections(selections) {
  return selections
    .filter((sel) => !sel.applied)
    .map((sel) => `${sel.kind}:${sel.requested?.motivation || "?"}/${sel.requested?.affinity || "?"}`)
    .join(", ");
}

function buildPhaseContext({ roomsSelections = [], actorSelections = [], layout } = {}) {
  const formatSelections = (label, selections) => {
    if (!Array.isArray(selections) || selections.length === 0) {
      return "";
    }
    const sorted = selections
      .slice()
      .sort((a, b) => {
        const motivationA = a?.requested?.motivation || "";
        const motivationB = b?.requested?.motivation || "";
        const affinityA = a?.requested?.affinity || "";
        const affinityB = b?.requested?.affinity || "";
        if (motivationA !== motivationB) return motivationA.localeCompare(motivationB);
        if (affinityA !== affinityB) return affinityA.localeCompare(affinityB);
        const costA = Number.isInteger(a?.applied?.cost) ? a.applied.cost : 0;
        const costB = Number.isInteger(b?.applied?.cost) ? b.applied.cost : 0;
        if (costA !== costB) return costA - costB;
        return String(a?.applied?.id || "").localeCompare(String(b?.applied?.id || ""));
      })
      .map((entry) => {
        const requested = entry.requested || {};
        const count = Number.isInteger(requested.count) ? requested.count : Array.isArray(entry.instances) ? entry.instances.length : 0;
        const cost = Number.isInteger(entry?.applied?.cost) ? entry.applied.cost : null;
        const costText = cost ? `cost ${cost}` : "cost ?";
        return `${requested.motivation || "?"}/${requested.affinity || "?"} x${count} (${costText})`;
      })
      .join("; ");
    return `${label}: ${sorted}`;
  };

  const rooms = formatSelections("Rooms approved", roomsSelections);
  const actors = formatSelections("Actors approved", actorSelections);
  const layoutLine = layout
    ? `Layout tiles: floor ${layout.floorTiles}, hallway ${layout.hallwayTiles}`
    : "";
  return [layoutLine, rooms, actors].filter(Boolean).join(" | ");
}

function filterSummaryByPhase(summary, phase) {
  if (!summary || typeof summary !== "object") return {};
  const next = {};
  if (summary.dungeonAffinity !== undefined) next.dungeonAffinity = summary.dungeonAffinity;
  if (summary.budgetTokens !== undefined) next.budgetTokens = summary.budgetTokens;
  if (summary.phase !== undefined) next.phase = summary.phase;
  if (summary.remainingBudgetTokens !== undefined) next.remainingBudgetTokens = summary.remainingBudgetTokens;
  if (summary.stop !== undefined) next.stop = summary.stop;
  if (Array.isArray(summary.missing)) next.missing = summary.missing;
  if (phase === "layout_only" && summary.layout && typeof summary.layout === "object") {
    next.layout = summary.layout;
  }
  if (phase === "layout_only" && summary.roomDesign && typeof summary.roomDesign === "object") {
    next.roomDesign = summary.roomDesign;
  }
  if (phase === "actors_only") next.actors = Array.isArray(summary.actors) ? summary.actors : [];
  return next;
}

function buildPhaseRepairPrompt({
  basePrompt,
  phase,
  errors,
  responseText,
  allowedOptions,
  allowedPairsText,
  missingSelections,
  layoutCosts,
} = {}) {
  const affinities = allowedOptions?.affinities?.length ? allowedOptions.affinities : ALLOWED_AFFINITIES;
  const motivations = allowedOptions?.motivations?.length ? allowedOptions.motivations : ALLOWED_MOTIVATIONS;
  const expressions = ALLOWED_AFFINITY_EXPRESSIONS;
  const phaseRequirement =
    phase === "layout_only"
      ? LLM_REPAIR_TEXT.phaseLayoutRequirement
      : LLM_REPAIR_TEXT.phaseActorsRequirement;
  return buildLlmRepairPromptTemplate({
    basePrompt,
    errors,
    responseText,
    affinities,
    affinityExpressions: expressions,
    motivations,
    allowedPairsText: phase === "layout_only" ? "" : allowedPairsText,
    phaseRequirement,
    extraLines: [
      phase === "layout_only"
        ? `Tile costs: floor ${layoutCosts?.floorTiles ?? 1}, hallway ${layoutCosts?.hallwayTiles ?? 1} tokens each.`
        : null,
      missingSelections ? `Unmatched picks: ${missingSelections}` : null,
      phase === "layout_only"
        ? LLM_REPAIR_TEXT.layoutIntegerRule
        : LLM_REPAIR_TEXT.tokenHintRule,
      phase === "actors_only" ? LLM_REPAIR_TEXT.actorMobilityRule : null,
      phase === "layout_only"
        ? LLM_REPAIR_TEXT.layoutExample
        : LLM_REPAIR_TEXT.exampleAffinityEntry,
    ].filter(Boolean),
  });
}

function validatePhaseSelections(selections, phase) {
  const errors = [];
  const missingSelections = selections.filter((sel) => !sel.applied);
  if (missingSelections.length > 0) {
    errors.push({ field: "selections", code: "missing_catalog_match" });
  }
  if (phase === "actors_only" && countInstances(selections, "actor") <= 0) {
    errors.push({ field: "actors", code: "missing_actors" });
  }
  return {
    ok: errors.length === 0,
    errors,
    missingSelections,
  };
}

function hasValidationCode(errors, code) {
  if (!Array.isArray(errors) || !code) return false;
  return errors.some((entry) => entry && entry.code === code);
}

function chooseCatalogEntryByHint(entries, tokenHint, maxCost, { allowAboveBudget = true } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const sorted = entries
    .slice()
    .sort((a, b) => (a.cost - b.cost) || String(a.id || "").localeCompare(String(b.id || "")));
  const affordable = Number.isInteger(maxCost) && maxCost > 0
    ? sorted.filter((entry) => Number.isInteger(entry?.cost) && entry.cost <= maxCost)
    : [];
  const pool = affordable.length > 0
    ? affordable
    : (allowAboveBudget ? sorted : []);
  if (pool.length === 0) {
    return null;
  }
  if (!Number.isInteger(tokenHint) || tokenHint <= 0) {
    return pool[0];
  }
  const under = pool.filter((entry) => Number.isInteger(entry?.cost) && entry.cost <= tokenHint);
  if (under.length > 0) {
    return under[under.length - 1];
  }
  return pool[0];
}

function selectFallbackCatalogEntry(catalogEntries, pick, { maxCost, allowedOptions } = {}) {
  const entries = Array.isArray(catalogEntries)
    ? catalogEntries.filter((entry) => entry?.type === "actor")
    : [];
  if (entries.length === 0) return null;
  const allowedAffinities = Array.isArray(allowedOptions?.affinities) && allowedOptions.affinities.length > 0
    ? new Set(allowedOptions.affinities)
    : null;
  const allowedMotivations = Array.isArray(allowedOptions?.motivations) && allowedOptions.motivations.length > 0
    ? new Set(allowedOptions.motivations)
    : null;
  const scoped = entries.filter((entry) => {
    const affinityAllowed = !allowedAffinities || allowedAffinities.has(entry.affinity);
    const motivationAllowed = !allowedMotivations || allowedMotivations.has(entry.motivation);
    return affinityAllowed && motivationAllowed;
  });
  const workingEntries = scoped.length > 0 ? scoped : entries;
  const motivation = typeof pick?.motivation === "string" ? pick.motivation : "";
  const affinity = typeof pick?.affinity === "string" ? pick.affinity : "";
  const tokenHint = Number.isInteger(pick?.tokenHint) ? pick.tokenHint : undefined;
  const exact = workingEntries.filter((entry) => entry.motivation === motivation && entry.affinity === affinity);
  const byAffinity = affinity ? workingEntries.filter((entry) => entry.affinity === affinity) : [];
  const byMotivation = motivation ? workingEntries.filter((entry) => entry.motivation === motivation) : [];
  const groups = [exact, byAffinity, byMotivation];

  // Prefer in-budget catalog options first, then relax to any option.
  for (const group of groups) {
    const chosen = chooseCatalogEntryByHint(group, tokenHint, maxCost, { allowAboveBudget: false });
    if (chosen) return chosen;
  }
  const anyBudget = chooseCatalogEntryByHint(workingEntries, tokenHint, maxCost, { allowAboveBudget: false });
  if (anyBudget) return anyBudget;
  for (const group of groups) {
    const chosen = chooseCatalogEntryByHint(group, tokenHint, maxCost, { allowAboveBudget: true });
    if (chosen) return chosen;
  }
  return chooseCatalogEntryByHint(workingEntries, tokenHint, maxCost, { allowAboveBudget: true });
}

function snapActorsSummaryToCatalog({ summary, catalogEntries, remainingBudgetTokens, allowedOptions } = {}) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return { summary, changed: false };
  }
  if (!Array.isArray(summary.actors) || summary.actors.length === 0) {
    return { summary, changed: false };
  }
  let changed = false;
  const actors = summary.actors.map((pick) => {
    if (!pick || typeof pick !== "object" || Array.isArray(pick)) return pick;
    const fallback = selectFallbackCatalogEntry(catalogEntries, pick, {
      maxCost: remainingBudgetTokens,
      allowedOptions,
    });
    if (!fallback) return pick;
    if (fallback.motivation === pick.motivation && fallback.affinity === pick.affinity) {
      return pick;
    }
    changed = true;
    return {
      ...pick,
      motivation: fallback.motivation,
      affinity: fallback.affinity,
    };
  });
  if (!changed) {
    return { summary, changed: false };
  }
  return {
    summary: {
      ...summary,
      actors,
    },
    changed: true,
  };
}

function validateFeasibility({ roomCount, actorCount, layout }) {
  if (layout) {
    const normalizationWarnings = [];
    const normalizedLayout = normalizeLayoutCounts(layout, normalizationWarnings);
    const hasInvalidCounts = normalizationWarnings.some((warning) => (
      warning?.code === "invalid_layout" || warning?.code === "invalid_tile_count"
    ));
    const walkableTiles = sumLayoutTiles(normalizedLayout);
    if (normalizedLayout && !hasInvalidCounts && walkableTiles > MAX_EXACT_LAYOUT_FEASIBILITY_TILES) {
      const errors = [];
      if (walkableTiles <= 0) {
        errors.push({ field: "layout", code: "empty_layout" });
      }
      if (Number.isInteger(actorCount) && actorCount > 0 && walkableTiles < actorCount) {
        errors.push({
          field: "actors",
          code: "insufficient_walkable_tiles",
          detail: {
            actorCount,
            walkableTiles,
          },
        });
      }
      return { ok: errors.length === 0, errors };
    }
    const result = validateLayoutCountsAndActors({ layout, actorCount });
    return { ok: result.ok, errors: result.errors || [] };
  }
  const levelGen = deriveLevelGen({ roomCount });
  const result = validateLayoutAndActors({ levelGen, actorCount });
  return { ok: result.ok, errors: result.errors || [] };
}

function isAmbulatoryMotivation(motivation) {
  return typeof motivation === "string" && motivation.trim() !== "" && motivation !== "stationary";
}

function validateActorMobilityVitals(selections = []) {
  const errors = [];
  selections
    .filter((selection) => selection?.kind === "actor")
    .forEach((selection, selectionIndex) => {
      const instances = Array.isArray(selection?.instances) ? selection.instances : [];
      if (instances.length === 0) return;
      instances.forEach((instance, instanceIndex) => {
        if (!isAmbulatoryMotivation(instance?.motivation)) return;
        const staminaRegen = instance?.vitals?.stamina?.regen;
        if (!Number.isInteger(staminaRegen) || staminaRegen <= 0) {
          errors.push({
            field: `actors[${selectionIndex}].instances[${instanceIndex}].vitals.stamina.regen`,
            code: "missing_stamina_regen_for_ambulatory",
          });
        }
      });
    });
  return {
    ok: errors.length === 0,
    errors,
  };
}

function validateLayoutSummary({ summary, remainingBudgetTokens, priceList, layoutCosts }) {
  const errors = [];
  const layout = normalizeLayoutCounts(summary?.layout);
  if (!layout) {
    errors.push({ field: "layout", code: "missing_layout" });
    return { ok: false, errors, layout: null, spend: null };
  }
  const totalTiles = sumLayoutTiles(layout);
  if (totalTiles <= 0) {
    errors.push({ field: "layout", code: "empty_layout" });
  }
  const spend = evaluateLayoutSpend({
    layout,
    budgetTokens: remainingBudgetTokens,
    priceList,
    tileCosts: layoutCosts,
  });
  if (spend.overBudget) {
    errors.push({
      field: "layout",
      code: "layout_over_budget",
      detail: { spentTokens: spend.spentTokens, remainingBudgetTokens },
    });
  }
  return { ok: errors.length === 0, errors, layout, spend };
}

function isWalkableField(field) {
  return field === "floorTiles" || field === "hallwayTiles";
}

function resolveTileCost(costs, field) {
  const value = costs && Number.isInteger(costs[field]) && costs[field] > 0 ? costs[field] : 1;
  return value;
}

function pickCheapestField({ costs, fields, budgetTokens }) {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const affordable = Number.isInteger(budgetTokens)
    ? fields.filter((field) => resolveTileCost(costs, field) <= budgetTokens)
    : fields.slice();
  const pool = affordable.length > 0 ? affordable : fields;
  return pool.reduce((best, field) => {
    if (!best) return field;
    const currentCost = resolveTileCost(costs, field);
    const bestCost = resolveTileCost(costs, best);
    if (currentCost < bestCost) return field;
    return best;
  }, null);
}

function selectReductionField(layout, costs) {
  const fieldsWithTiles = LAYOUT_TILE_FIELDS.filter((field) => Number.isInteger(layout?.[field]) && layout[field] > 0);
  if (fieldsWithTiles.length === 0) return null;
  const walkableTiles = (layout.floorTiles || 0) + (layout.hallwayTiles || 0);
  const safeCandidates = fieldsWithTiles.filter((field) => {
    if (!isWalkableField(field)) return true;
    return walkableTiles > 1;
  });
  const pool = safeCandidates.length > 0 ? safeCandidates : fieldsWithTiles;
  return pool.reduce((best, field) => {
    if (!best) return field;
    const currentCost = resolveTileCost(costs, field);
    const bestCost = resolveTileCost(costs, best);
    if (currentCost > bestCost) return field;
    if (currentCost < bestCost) return best;
    return layout[field] > layout[best] ? field : best;
  }, null);
}

function fitLayoutToBudget({
  layout,
  remainingBudgetTokens,
  priceList,
  layoutCosts,
} = {}) {
  if (!Number.isInteger(remainingBudgetTokens) || remainingBudgetTokens < 0) {
    return { ok: false };
  }
  const normalized = normalizeLayoutCounts(layout);
  if (!normalized) {
    return { ok: false };
  }

  let working = { ...normalized };
  let spend = evaluateLayoutSpend({
    layout: working,
    budgetTokens: remainingBudgetTokens,
    priceList,
    tileCosts: layoutCosts,
  });
  if (!spend.overBudget && sumLayoutTiles(working) > 0) {
    return { ok: true, layout: spend.layout || working, layoutSpend: spend, adjusted: false };
  }

  const costs = spend.tileCosts || layoutCosts || {};
  const originalSpent = spend.spentTokens;
  const scale = originalSpent > 0 ? remainingBudgetTokens / originalSpent : 0;
  if (scale > 0 && scale < 1) {
    LAYOUT_TILE_FIELDS.forEach((field) => {
      const count = Number.isInteger(working[field]) ? working[field] : 0;
      working[field] = Math.max(0, Math.floor(count * scale));
    });
  }

  const cheapestWalkableField = pickCheapestField({
    costs,
    fields: ["floorTiles", "hallwayTiles"],
    budgetTokens: remainingBudgetTokens,
  });
  const cheapestAnyField = pickCheapestField({
    costs,
    fields: LAYOUT_TILE_FIELDS,
    budgetTokens: remainingBudgetTokens,
  });
  const ensureNonEmpty = () => {
    if (sumLayoutTiles(working) > 0) return;
    if (cheapestAnyField) {
      working[cheapestAnyField] = (working[cheapestAnyField] || 0) + 1;
    }
  };

  ensureNonEmpty();
  spend = evaluateLayoutSpend({
    layout: working,
    budgetTokens: remainingBudgetTokens,
    priceList,
    tileCosts: layoutCosts,
  });

  let guard = 0;
  const maxGuard = Math.max(100, sumLayoutTiles(working) * 2 + 10);
  while (spend.overBudget && guard < maxGuard) {
    const field = selectReductionField(working, costs);
    if (!field) break;
    working[field] -= 1;
    if (working[field] < 0) working[field] = 0;
    ensureNonEmpty();
    spend = evaluateLayoutSpend({
      layout: working,
      budgetTokens: remainingBudgetTokens,
      priceList,
      tileCosts: layoutCosts,
    });
    guard += 1;
  }

  const walkableTiles = (working.floorTiles || 0) + (working.hallwayTiles || 0);
  if (walkableTiles <= 0 && cheapestWalkableField) {
    const walkableCost = resolveTileCost(costs, cheapestWalkableField);
    while (spend.spentTokens + walkableCost > remainingBudgetTokens) {
      const field = selectReductionField(working, costs);
      if (!field) break;
      working[field] -= 1;
      if (working[field] < 0) working[field] = 0;
      spend = evaluateLayoutSpend({
        layout: working,
        budgetTokens: remainingBudgetTokens,
        priceList,
        tileCosts: layoutCosts,
      });
    }
    if (spend.spentTokens + walkableCost <= remainingBudgetTokens) {
      working[cheapestWalkableField] = (working[cheapestWalkableField] || 0) + 1;
      spend = evaluateLayoutSpend({
        layout: working,
        budgetTokens: remainingBudgetTokens,
        priceList,
        tileCosts: layoutCosts,
      });
    }
  }

  if (spend.overBudget || sumLayoutTiles(working) <= 0) {
    return { ok: false };
  }
  return { ok: true, layout: spend.layout || working, layoutSpend: spend, adjusted: true };
}

function fitLayoutToPhaseConstraints({
  layout,
  remainingBudgetTokens,
  priceList,
  layoutCosts,
} = {}) {
  return fitLayoutToBudget({
    layout,
    remainingBudgetTokens,
    priceList,
    layoutCosts,
  });
}

async function runPhase({
  adapter,
  model,
  baseUrl,
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  allowedPairsText,
  allowedOptions,
  phase,
  phaseContext,
  layoutCosts,
  layoutProfiles,
  affinities,
  strict,
  format,
  stream,
  runId,
  producedBy,
  clock,
  requestId,
  catalog,
  catalogEntries,
  priceList,
  maxRepairs = 1,
  nextCaptureMeta,
  extraValidator,
  options,
} = {}) {
  const startedAt = typeof clock === "function" ? clock() : undefined;
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const captures = [];
  let validationErrors = [];
  const promptAffinities = Array.isArray(affinities) && affinities.length > 0
    ? affinities
    : allowedOptions?.affinities;
  const promptMotivations = allowedOptions?.motivations || ALLOWED_MOTIVATIONS;
  const basePrompt = buildLlmPhasePromptTemplate({
    goal,
    notes,
    budgetTokens,
    phase,
    remainingBudgetTokens,
    allowedPairsText,
    context: phaseContext,
    layoutCosts,
    layoutProfiles,
    affinities: promptAffinities,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: promptMotivations,
  });

  const session = await runLlmSession({
    adapter,
    model,
    baseUrl,
    prompt: basePrompt,
    goal,
    notes,
    budgetTokens,
    remainingBudgetTokens,
    phase,
    phaseContext,
    strict,
    repairPromptBuilder: ({ errors, responseText }) => buildPhaseRepairPrompt({
      basePrompt,
      phase,
      errors,
      responseText,
      allowedOptions,
      allowedPairsText,
      layoutCosts,
    }),
    requireSummary: phase === "actors_only" ? { minActors: 1 } : undefined,
    options,
    runId,
    producedBy,
    clock,
    requestId,
    meta: typeof nextCaptureMeta === "function" ? nextCaptureMeta(phase) : undefined,
    format,
    stream,
  });

  if (session.capture) {
    captures.push(session.capture);
  }
  if (!session.ok) {
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const endMs = endedAt ? Date.parse(endedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
    applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
    return { ok: false, errors: session.errors || [], captures, session, startedAt, endedAt, durationMs };
  }

  let phaseSummary = filterSummaryByPhase(session.summary, phase);
  let selections = [];
  let layoutPlan = null;
  let layoutSpend = null;
  let validation = { ok: true, errors: [], missingSelections: [] };
  let autoFitApplied = false;
  let autoFitSourceErrors = [];
  if (phase === "layout_only") {
    const layoutValidation = validateLayoutSummary({
      summary: phaseSummary,
      remainingBudgetTokens,
      priceList,
      layoutCosts,
    });
    layoutPlan = layoutValidation.layout;
    layoutSpend = layoutValidation.spend;
    validation = { ok: layoutValidation.ok, errors: layoutValidation.errors || [], missingSelections: [] };
    if (!validation.ok && !strict) {
      const fitted = fitLayoutToBudget({
        layout: layoutPlan,
        remainingBudgetTokens,
        priceList,
        layoutCosts,
      });
      if (fitted.ok && fitted.adjusted) {
        autoFitApplied = true;
        autoFitSourceErrors = validation.errors || [];
        layoutPlan = fitted.layout;
        layoutSpend = fitted.layoutSpend;
        phaseSummary = { ...phaseSummary, layout: fitted.layout };
        validation = { ok: true, errors: [], missingSelections: [] };
      }
    }
  } else {
    const mapped = mapSummaryToPool({ summary: phaseSummary, catalog });
    selections = mapped.selections;
    validation = validatePhaseSelections(mapped.selections, phase);
    if (!strict && phase === "actors_only" && hasValidationCode(validation.errors, "missing_catalog_match")) {
      const actorCount = countInstances(selections, "actor");
      if (actorCount <= 0) {
        const snapped = snapActorsSummaryToCatalog({
          summary: phaseSummary,
          catalogEntries,
          remainingBudgetTokens,
          allowedOptions,
        });
        if (snapped.changed) {
          const remapped = mapSummaryToPool({ summary: snapped.summary, catalog });
          const revalidated = validatePhaseSelections(remapped.selections, phase);
          if (countInstances(remapped.selections, "actor") > 0) {
            validationErrors = [...validationErrors, ...(validation.errors || [])];
            phaseSummary = snapped.summary;
            selections = remapped.selections;
            validation = revalidated;
          }
        }
      }
      const recoveredActorCount = countInstances(selections, "actor");
      if (recoveredActorCount > 0 && hasValidationCode(validation.errors, "missing_catalog_match")) {
        const residual = (validation.errors || []).filter((entry) => entry?.code !== "missing_catalog_match");
        validationErrors = [...validationErrors, ...(validation.errors || [])];
        validation = {
          ok: residual.length === 0,
          errors: residual,
          missingSelections: validation.missingSelections || [],
        };
      }
    }
  }
  const extra = typeof extraValidator === "function"
    ? extraValidator({ selections, summary: phaseSummary, phase, layout: layoutPlan })
    : { ok: true, errors: [] };
  const combinedErrors = [...validation.errors, ...(extra.errors || [])];
  if (autoFitApplied && validationErrors.length === 0) {
    validationErrors = autoFitSourceErrors;
  }
  if (validation.ok && extra.ok) {
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const endMs = endedAt ? Date.parse(endedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
    applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
    return {
      ok: true,
      summary: phaseSummary,
      selections,
      layout: layoutPlan,
      layoutSpend,
      captures,
      session,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      startedAt,
      endedAt,
      durationMs,
    };
  }

  if (phase === "layout_only" && !strict) {
    const recovered = fitLayoutToPhaseConstraints({
      layout: layoutPlan || phaseSummary?.layout,
      remainingBudgetTokens,
      priceList,
      layoutCosts,
    });
    if (recovered.ok) {
      const recoveredSummary = {
        ...phaseSummary,
        layout: recovered.layout,
      };
      const recoveredValidationResult = validateLayoutSummary({
        summary: recoveredSummary,
        remainingBudgetTokens,
        priceList,
        layoutCosts,
      });
      const recoveredValidation = {
        ok: recoveredValidationResult.ok,
        errors: recoveredValidationResult.errors || [],
      };
      const recoveredExtra = typeof extraValidator === "function"
        ? extraValidator({ selections, summary: recoveredSummary, phase, layout: recovered.layout })
        : { ok: true, errors: [] };
      if (recoveredValidation.ok && recoveredExtra.ok) {
        const endedAt = typeof clock === "function" ? clock() : undefined;
        const endMs = endedAt ? Date.parse(endedAt) : NaN;
        const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
        applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
        return {
          ok: true,
          summary: recoveredSummary,
          selections,
          layout: recovered.layout,
          layoutSpend: recovered.layoutSpend || recoveredValidationResult.spend,
          captures,
          session,
          validationErrors: combinedErrors.length > 0 ? combinedErrors : undefined,
          startedAt,
          endedAt,
          durationMs,
        };
      }
    }
  }

  if (maxRepairs <= 0) {
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const endMs = endedAt ? Date.parse(endedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
    applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
    return {
      ok: false,
      errors: combinedErrors,
      captures,
      session,
      selections,
      layout: layoutPlan,
      startedAt,
      endedAt,
      durationMs,
    };
  }

  validationErrors = combinedErrors;
  const missingSelections = summarizeMissingSelections(selections);
  const repairPrompt = buildPhaseRepairPrompt({
    basePrompt,
    phase,
    errors: combinedErrors,
    responseText: session.responseText,
    allowedOptions,
    allowedPairsText,
    missingSelections,
    layoutCosts,
  });

  const repairSession = await runLlmSession({
    adapter,
    model,
    baseUrl,
    prompt: repairPrompt,
    goal,
    notes,
    budgetTokens,
    remainingBudgetTokens,
    phase,
    phaseContext,
    strict,
    repairPromptBuilder: ({ errors, responseText }) => buildPhaseRepairPrompt({
      basePrompt,
      phase,
      errors,
      responseText,
      allowedOptions,
      allowedPairsText,
      layoutCosts,
    }),
    options,
    runId,
    producedBy,
    clock,
    requestId,
    meta: typeof nextCaptureMeta === "function" ? nextCaptureMeta(phase) : undefined,
    format,
    stream,
  });

  if (repairSession.capture) {
    captures.push(repairSession.capture);
  }

  if (!repairSession.ok) {
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const endMs = endedAt ? Date.parse(endedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
    applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
    return { ok: false, errors: repairSession.errors || [], captures, session: repairSession, startedAt, endedAt, durationMs };
  }

  let repairSummary = filterSummaryByPhase(repairSession.summary, phase);
  let repairSelections = [];
  let repairLayoutPlan = null;
  let repairLayoutSpend = null;
  let repairValidation = { ok: true, errors: [], missingSelections: [] };
  let repairAutoFitApplied = false;
  let repairAutoFitSourceErrors = [];
  if (phase === "layout_only") {
    const layoutValidation = validateLayoutSummary({
      summary: repairSummary,
      remainingBudgetTokens,
      priceList,
      layoutCosts,
    });
    repairLayoutPlan = layoutValidation.layout;
    repairLayoutSpend = layoutValidation.spend;
    repairValidation = { ok: layoutValidation.ok, errors: layoutValidation.errors || [], missingSelections: [] };
    if (!repairValidation.ok && !strict) {
      const fitted = fitLayoutToBudget({
        layout: repairLayoutPlan,
        remainingBudgetTokens,
        priceList,
        layoutCosts,
      });
      if (fitted.ok && fitted.adjusted) {
        repairAutoFitApplied = true;
        repairAutoFitSourceErrors = repairValidation.errors || [];
        repairLayoutPlan = fitted.layout;
        repairLayoutSpend = fitted.layoutSpend;
        repairSummary = { ...repairSummary, layout: fitted.layout };
        repairValidation = { ok: true, errors: [], missingSelections: [] };
      }
    }
  } else {
    const repairMapped = mapSummaryToPool({ summary: repairSummary, catalog });
    repairSelections = repairMapped.selections;
    repairValidation = validatePhaseSelections(repairMapped.selections, phase);
    if (!strict && phase === "actors_only" && hasValidationCode(repairValidation.errors, "missing_catalog_match")) {
      const actorCount = countInstances(repairSelections, "actor");
      if (actorCount <= 0) {
        const snapped = snapActorsSummaryToCatalog({
          summary: repairSummary,
          catalogEntries,
          remainingBudgetTokens,
          allowedOptions,
        });
        if (snapped.changed) {
          const remapped = mapSummaryToPool({ summary: snapped.summary, catalog });
          const revalidated = validatePhaseSelections(remapped.selections, phase);
          if (countInstances(remapped.selections, "actor") > 0) {
            validationErrors = [...validationErrors, ...(repairValidation.errors || [])];
            repairSummary = snapped.summary;
            repairSelections = remapped.selections;
            repairValidation = revalidated;
          }
        }
      }
      const recoveredActorCount = countInstances(repairSelections, "actor");
      if (recoveredActorCount > 0 && hasValidationCode(repairValidation.errors, "missing_catalog_match")) {
        const residual = (repairValidation.errors || []).filter((entry) => entry?.code !== "missing_catalog_match");
        validationErrors = [...validationErrors, ...(repairValidation.errors || [])];
        repairValidation = {
          ok: residual.length === 0,
          errors: residual,
          missingSelections: repairValidation.missingSelections || [],
        };
      }
    }
  }
  const repairExtra = typeof extraValidator === "function"
    ? extraValidator({ selections: repairSelections, summary: repairSummary, phase, layout: repairLayoutPlan })
    : { ok: true, errors: [] };
  const repairCombinedErrors = [...repairValidation.errors, ...(repairExtra.errors || [])];
  if (repairAutoFitApplied) {
    validationErrors = [...validationErrors, ...repairAutoFitSourceErrors];
  }
  if (repairValidation.ok && repairExtra.ok) {
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const endMs = endedAt ? Date.parse(endedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
    applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
    return {
      ok: true,
      summary: repairSummary,
      selections: repairSelections,
      layout: repairLayoutPlan,
      layoutSpend: repairLayoutSpend,
      captures,
      session: repairSession,
      validationErrors,
      startedAt,
      endedAt,
      durationMs,
    };
  }
  const endedAt = typeof clock === "function" ? clock() : undefined;
  const endMs = endedAt ? Date.parse(endedAt) : NaN;
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
  applyPhaseTimingToCaptures(captures, { startedAt, endedAt, durationMs });
  return { ok: false, errors: repairCombinedErrors, captures, session: repairSession, startedAt, endedAt, durationMs };
}

function resolvePhaseLlmOptions({ phase, optionsByPhase } = {}) {
  const base = DOMAIN_CONSTRAINTS?.llm?.options && typeof DOMAIN_CONSTRAINTS.llm.options === "object"
    ? { ...DOMAIN_CONSTRAINTS.llm.options }
    : {};
  const responseTokenBudget = DOMAIN_CONSTRAINTS?.llm?.responseTokenBudget || {};
  if (phase === "layout_only" && Number.isInteger(responseTokenBudget.layoutPhase) && responseTokenBudget.layoutPhase > 0) {
    base.num_predict = responseTokenBudget.layoutPhase;
  } else if (phase === "actors_only" && Number.isInteger(responseTokenBudget.actorsPhase) && responseTokenBudget.actorsPhase > 0) {
    base.num_predict = responseTokenBudget.actorsPhase;
  }

  const phaseOverrides = optionsByPhase?.[phase];
  if (phaseOverrides && typeof phaseOverrides === "object") {
    return { ...base, ...phaseOverrides };
  }
  return base;
}

function resolveStopReason({ summary, remainingBudgetTokens, cheapestCost, ignoreDoneIfBudgetRemains } = {}) {
  if (summary?.stop && LLM_STOP_REASONS.includes(summary.stop)) {
    if (
      summary.stop === "done"
      && ignoreDoneIfBudgetRemains
      && Number.isInteger(remainingBudgetTokens)
      && Number.isInteger(cheapestCost)
      && remainingBudgetTokens >= cheapestCost
    ) {
      // Budget remains and we can still afford a catalog entry; keep iterating.
    } else {
      return summary.stop;
    }
  }
  if (Array.isArray(summary?.missing) && summary.missing.length > 0) {
    return "missing";
  }
  if (Number.isInteger(remainingBudgetTokens) && remainingBudgetTokens <= 0) {
    return "done";
  }
  if (Number.isInteger(remainingBudgetTokens) && Number.isInteger(cheapestCost) && remainingBudgetTokens < cheapestCost) {
    return "no_viable_spend";
  }
  return null;
}

function buildCombinedSummary({ baseSummary, selections, layout } = {}) {
  const summary = { ...(baseSummary || {}) };
  if (layout && typeof layout === "object") {
    summary.layout = { ...layout };
  }
  summary.rooms = selections
    .filter((sel) => sel.kind === "room" && sel.requested)
    .map((sel) => ({ ...sel.requested }));
  summary.actors = selections
    .filter((sel) => sel.kind === "actor" && sel.requested)
    .map((sel) => ({ ...sel.requested }));
  if (summary.rooms.length === 0) delete summary.rooms;
  if (summary.actors.length === 0) delete summary.actors;
  return summary;
}

function buildActorPhaseGoal({ baseGoal, dungeonAffinity, defenderAffinities } = {}) {
  const defenderPhrase = formatAffinityPhrase(defenderAffinities);
  if (isNonEmptyString(defenderPhrase)) {
    return `Create dungeon defenders for a ${defenderPhrase} themed dungeon.`;
  }
  if (isNonEmptyString(dungeonAffinity)) {
    return `Create dungeon defenders for a ${dungeonAffinity} themed dungeon.`;
  }
  if (isNonEmptyString(baseGoal)) {
    const trimmed = baseGoal.trim();
    if (/defender/i.test(trimmed)) {
      return trimmed;
    }
    const affinityMatch = trimmed.match(/\b([a-z]+)\s+affinity\b/i);
    if (affinityMatch) {
      return `Create dungeon defenders for a ${affinityMatch[1].toLowerCase()} themed dungeon.`;
    }
  }
  return "Create dungeon defenders for this dungeon.";
}

export async function runLlmBudgetLoop({
  adapter,
  model,
  baseUrl,
  catalog,
  goal,
  notes,
  budgetTokens,
  priceList,
  poolWeights,
  poolPolicy,
  strict = false,
  format,
  stream,
  runId,
  producedBy = "orchestrator",
  clock,
  requestId,
  maxActorRounds = DEFAULT_MAX_ACTOR_ROUNDS,
  optionsByPhase,
  defenderAffinities,
  layoutProfiles,
  layoutPhaseContext = "",
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return { ok: false, errors: [{ field: "budgetTokens", code: "missing_budget_tokens" }], captures: [] };
  }
  const clockFn = typeof clock === "function" ? clock : () => new Date().toISOString();
  const resolvedRunId = isNonEmptyString(runId) ? runId : "run_budget_loop";
  let captureIndex = 0;
  const nextCaptureMeta = (phase) => {
    captureIndex += 1;
    const suffix = String(captureIndex).padStart(2, "0");
    const phaseTag = isNonEmptyString(phase) ? phase : "phase";
    return {
      id: `capture_llm_${resolvedRunId}_${suffix}_${phaseTag}`,
      runId: resolvedRunId,
      createdAt: clockFn(),
      producedBy,
    };
  };
  const { ok: catalogOk, entries, errors: catalogErrors } = normalizePoolCatalog(catalog || {});
  if (!catalogOk) {
    return { ok: false, errors: catalogErrors || [], captures: [] };
  }
  const llmFormat = isNonEmptyString(format) ? format : DOMAIN_CONSTRAINTS?.llm?.outputFormat;

  const allowedOptions = deriveAllowedOptionsFromCatalog(catalog);
  const defenderAffinityChoices = Array.isArray(defenderAffinities)
    ? defenderAffinities
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter(Boolean)
    : [];
  const defenderAffinitySet = new Set(allowedOptions.affinities || []);
  const filteredDefenderAffinities = defenderAffinityChoices.filter((value) => defenderAffinitySet.has(value));
  const defenderAllowedOptions = filteredDefenderAffinities.length > 0
    ? { ...allowedOptions, affinities: filteredDefenderAffinities }
    : allowedOptions;
  const allowedPairs = deriveAllowedPairs(catalog);
  const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
  const cheapestCost = computeCheapestCost(entries);
  const layoutCostResult = resolveLayoutTileCosts(priceList);
  const layoutCosts = layoutCostResult.costs;

  const allocationMeta = {
    id: `budget_allocation_${resolvedRunId}`,
    runId: resolvedRunId,
    createdAt: clockFn(),
    producedBy,
  };
  const budgetRef = Number.isInteger(budgetTokens)
    ? { id: `budget_${resolvedRunId}`, schema: "agent-kernel/BudgetArtifact", schemaVersion: 1 }
    : undefined;
  const priceListRef = priceList
    ? undefined
    : { id: `price_list_${resolvedRunId}`, schema: "agent-kernel/PriceList", schemaVersion: 1 };
  const allocationResult = buildBudgetAllocation({
    budgetTokens,
    priceList,
    meta: allocationMeta,
    poolWeights,
    policy: poolPolicy,
    budgetRef,
    priceListRef,
  });
  if (!allocationResult.ok) {
    return { ok: false, errors: allocationResult.errors || [], captures: [] };
  }
  const budgetAllocation = allocationResult.allocation;
  const normalizedPoolWeights = allocationResult.poolWeights;
  const poolMap = new Map(budgetAllocation.pools.map((pool) => [pool.id, pool.tokens]));
  const playerBudgetTokens = poolMap.get("player") || 0;
  const layoutBudgetTokens = poolMap.get("layout") || 0;
  const defendersBudgetTokens = poolMap.get("defenders") || 0;
  const lootBudgetTokens = poolMap.get("loot") || 0;

  const captures = [];
  const trace = [];
  const approvedSelections = [];

  let remainingBudgetTokens = layoutBudgetTokens;

  const layoutPhase = await runPhase({
    adapter,
    model,
    baseUrl,
    goal,
    notes,
    budgetTokens,
    remainingBudgetTokens,
    allowedPairsText,
    allowedOptions,
    phase: "layout_only",
    phaseContext: layoutPhaseContext,
    layoutCosts,
    layoutProfiles,
    strict,
    format: llmFormat,
    stream,
    runId: resolvedRunId,
    producedBy,
    clock: clockFn,
    requestId,
    catalog,
    catalogEntries: entries,
    priceList,
    nextCaptureMeta,
    options: resolvePhaseLlmOptions({ phase: "layout_only", optionsByPhase }),
    extraValidator: ({ summary, layout }) => {
      const layoutPlan = layout || normalizeLayoutCounts(summary?.layout);
      return validateFeasibility({ layout: layoutPlan, actorCount: 1 });
    },
  });

  captures.push(...layoutPhase.captures);
  if (!layoutPhase.ok) {
    return { ok: false, errors: layoutPhase.errors || [], captures, trace };
  }

  const layoutPlan = normalizeLayoutCounts(layoutPhase.summary?.layout || layoutPhase.layout);
  const layoutSpendResult = layoutPhase.layoutSpend || evaluateLayoutSpend({
    layout: layoutPlan,
    budgetTokens: remainingBudgetTokens,
    priceList,
    tileCosts: layoutCosts,
  });
  const actorGoal = buildActorPhaseGoal({
    baseGoal: goal,
    dungeonAffinity: layoutPhase.summary?.dungeonAffinity,
    defenderAffinities: filteredDefenderAffinities,
  });
  const defenderBudgetWithRollover = defendersBudgetTokens + layoutSpendResult.remainingBudgetTokens;
  remainingBudgetTokens = defenderBudgetWithRollover;
  const layoutWarnings = [
    ...(layoutCostResult.warnings || []),
    ...(layoutSpendResult.warnings || []),
  ].filter(Boolean);
  trace.push({
    phase: "layout_only",
    spentTokens: layoutSpendResult.spentTokens,
    remainingBudgetTokens,
    layout: layoutPlan || undefined,
    warnings: layoutWarnings.length > 0 ? layoutWarnings : undefined,
    validationWarnings: layoutPhase.validationErrors || undefined,
    startedAt: layoutPhase.startedAt,
    endedAt: layoutPhase.endedAt,
    durationMs: layoutPhase.durationMs,
  });

  let stopReason = resolveStopReason({
    summary: layoutPhase.summary,
    remainingBudgetTokens,
    cheapestCost,
    ignoreDoneIfBudgetRemains: true,
  });

  let actorRounds = 0;
  let lastActorSummary = null;
  while (!stopReason && actorRounds < maxActorRounds) {
    if (!Number.isInteger(remainingBudgetTokens) || !Number.isInteger(cheapestCost)) {
      break;
    }
    if (remainingBudgetTokens < cheapestCost) {
      stopReason = "no_viable_spend";
      break;
    }

    const phaseContext = buildPhaseContext({
      layout: layoutPlan,
      actorSelections: approvedSelections.filter((sel) => sel.kind === "actor"),
    });
    const approvedActors = approvedSelections.filter((sel) => sel.kind === "actor");

    const actorsPhase = await runPhase({
      adapter,
      model,
      baseUrl,
      goal: actorGoal,
      notes,
      budgetTokens,
      remainingBudgetTokens,
      allowedPairsText,
      allowedOptions: defenderAllowedOptions,
      phase: "actors_only",
      phaseContext,
      layoutCosts,
      affinities: filteredDefenderAffinities.length > 0 ? filteredDefenderAffinities : undefined,
      strict,
      format: llmFormat,
      stream,
      runId: resolvedRunId,
      producedBy,
      clock: clockFn,
      requestId,
      catalog,
      catalogEntries: entries,
      priceList,
      nextCaptureMeta,
      options: resolvePhaseLlmOptions({ phase: "actors_only", optionsByPhase }),
      extraValidator: ({ selections }) => {
        const mobility = validateActorMobilityVitals(selections);
        const actorCount = countRequestedSelections(approvedActors, "actor")
          + countRequestedSelections(selections, "actor");
        const feasibility = validateFeasibility({ layout: layoutPlan, actorCount });
        return {
          ok: mobility.ok && feasibility.ok,
          errors: [...mobility.errors, ...(feasibility.errors || [])],
        };
      },
    });

    captures.push(...actorsPhase.captures);
    if (!actorsPhase.ok) {
      return { ok: false, errors: actorsPhase.errors || [], captures, trace };
    }

    const actorSpend = evaluateSelectionSpend({
      selections: actorsPhase.selections,
      budgetTokens: remainingBudgetTokens,
      priceList,
    });

    remainingBudgetTokens = actorSpend.remainingBudgetTokens;
    approvedSelections.push(...actorSpend.approvedSelections);
    trace.push({
      phase: "actors_only",
      spentTokens: actorSpend.spentTokens,
      remainingBudgetTokens,
      decisions: actorSpend.decisions,
      warnings: actorSpend.warnings,
      validationWarnings: actorsPhase.validationErrors || undefined,
      startedAt: actorsPhase.startedAt,
      endedAt: actorsPhase.endedAt,
      durationMs: actorsPhase.durationMs,
    });

    lastActorSummary = actorsPhase.summary;
    const cheapestRoundCost = Number.isInteger(actorSpend?.cheapestRequestedUnitCost)
      ? actorSpend.cheapestRequestedUnitCost
      : cheapestCost;
    stopReason = resolveStopReason({
      summary: actorsPhase.summary,
      remainingBudgetTokens,
      cheapestCost: cheapestRoundCost,
      ignoreDoneIfBudgetRemains: true,
    });
    if (
      !stopReason
      && actorSpend.approvedSelections.length === 0
      && actorSpend.rejectedSelections.length > 0
    ) {
      stopReason = "no_viable_spend";
    }

    actorRounds += 1;
  }

  const baseSummary = {
    dungeonAffinity: layoutPhase.summary?.dungeonAffinity || lastActorSummary?.dungeonAffinity,
    budgetTokens: layoutPhase.summary?.budgetTokens || budgetTokens,
    layout: layoutPlan || layoutPhase.summary?.layout,
    roomDesign: layoutPhase.summary?.roomDesign,
  };

  const summary = buildCombinedSummary({
    baseSummary,
    selections: approvedSelections,
    layout: layoutPlan,
  });

  if (stopReason) {
    summary.stop = stopReason;
  }

  return {
    ok: true,
    summary,
    selections: approvedSelections,
    captures,
    trace,
    remainingBudgetTokens,
    stopReason,
    budgetAllocation,
    poolWeights: normalizedPoolWeights,
    poolBudgets: {
      player: playerBudgetTokens,
      layout: layoutBudgetTokens,
      defenders: defendersBudgetTokens,
      loot: lootBudgetTokens,
    },
    poolPolicy: budgetAllocation.policy,
  };
}
