import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
  LLM_STOP_REASONS,
  deriveAllowedOptionsFromCatalog,
} from "./prompt-contract.js";
import { requireClock } from "../_shared/require-clock.js";
import { deriveLevelGen } from "../director/buildspec-assembler.js";
import { buildCardSetFromSummary } from "../director/summary-selections.js";
import { validateLayoutAndActors, validateLayoutCountsAndActors } from "../configurator/feasibility.js";
import { normalizePoolCatalog } from "../../contracts/pool-catalog.js";
// CR.4 M5b.2b/M5b.2c/M5b.2d: `resolveLayoutTileCosts`, `buildBudgetAllocation`,
// `evaluateSelectionSpend`, the whole auto-fit search and now `evaluateLayoutSpend` are GONE
// from this file — they are Allocator decisions, asked of the Director.
//
// ✅ THE `allocator/layout-spend.js` IMPORT IS GONE, AND ITS ALLOWLIST ROW WITH IT. That one
// row outlived THREE separate fixes (M5b.2b's `resolveLayoutTileCosts`, M5b.2c's auto-fit
// search, D8-V's layout vocabulary) because each time it was dispositioned as "absorbed by
// finding X" while a different importer still stood behind it. A row's disposition describes
// its current importer, not its remaining work.
import {
  DOMAIN_CONSTRAINTS,
  LLM_REPAIR_TEXT,
  buildLlmPhasePromptTemplate,
  buildLlmRepairPromptTemplate,
  // D8-V: layout counting is vocabulary and now lives here, not in the Allocator.
  normalizeLayoutCounts,
  sumLayoutTiles,
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
  const layoutLine = (() => {
    if (!layout) return "";
    const floorTiles = Number.isInteger(layout.floorTiles) ? layout.floorTiles : 0;
    const hallwayTiles = Number.isInteger(layout.hallwayTiles) ? layout.hallwayTiles : 0;
    return `Layout tiles: floor ${floorTiles}, walkable total ${floorTiles + hallwayTiles}`;
  })();
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
  const isLayoutPhase = phase === "layout_only";
  const affinities = !isLayoutPhase
    ? (allowedOptions?.affinities?.length ? allowedOptions.affinities : ALLOWED_AFFINITIES)
    : [];
  const motivations = !isLayoutPhase
    ? (allowedOptions?.motivations?.length ? allowedOptions.motivations : ALLOWED_MOTIVATIONS)
    : [];
  const expressions = !isLayoutPhase ? ALLOWED_AFFINITY_EXPRESSIONS : [];
  const phaseRequirement =
    isLayoutPhase
      ? LLM_REPAIR_TEXT.phaseLayoutRequirement
      : LLM_REPAIR_TEXT.phaseActorsRequirement;
  return buildLlmRepairPromptTemplate({
    basePrompt,
    errors,
    responseText,
    affinities,
    affinityExpressions: expressions,
    motivations,
    allowedPairsText: isLayoutPhase ? "" : allowedPairsText,
    phaseRequirement,
    extraLines: [
      // CR.9 M5: was `layoutCosts?.floorTiles ?? 1`. The caller resolves these from the
      // Allocator's PriceList before the loop starts, so the fallback could only ever fire
      // by quoting the model a price nobody set — a second origin, in prompt text, where a
      // wrong number becomes wrong content rather than a loud failure. The WORDING is
      // unchanged (floor only): the response contract has no hallway field, so quoting its
      // price would add noise to a benchmark-gated prompt for no decision the model makes.
      phase === "layout_only"
        ? `Tile costs: floor ${layoutCosts.floorTiles} tokens each.`
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
      if (Number.isInteger(actorCount) && actorCount > 0) {
        const floorTiles = normalizedLayout.floorTiles || 0;
        if (floorTiles < actorCount) {
          errors.push({
            field: "actors",
            code: "insufficient_floor_tiles",
            detail: {
              actorCount,
              floorTiles,
            },
          });
        }
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

function validateLayoutSummary({
  summary,
  remainingBudgetTokens,
  priceList,
  layoutCosts,
  // CR.4 M5b.2d: threaded, not imported. Pricing the LLM's proposed layout is the
  // Allocator's answer; this function only decides what to do with it.
  evaluateLayoutSpend,
}) {
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
  // CR.4 M5b: threaded from runLlmBudgetLoop. runPhase drives both sessions (primary and
  // its own repair), so it is where the IO used to happen inside the persona.
  runSession,
  // CR.4 M5b.2a′: mapping an LLM summary onto catalog pools is the DIRECTOR's decision.
  // runPhase serves both phases, so all four mapping sites migrate together.
  mapPool,
  fitLayout,
  evaluateLayoutSpend,
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
    affinities: promptAffinities,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: promptMotivations,
  });

  const session = await runSession({
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
      evaluateLayoutSpend,
    });
    layoutPlan = layoutValidation.layout;
    layoutSpend = layoutValidation.spend;
    validation = { ok: layoutValidation.ok, errors: layoutValidation.errors || [], missingSelections: [] };
    if (!validation.ok && !strict) {
      const fitted = fitLayout({
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
    const mapped = mapPool({ summary: phaseSummary, catalog });
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
          const remapped = mapPool({ summary: snapped.summary, catalog });
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
    const recovered = fitLayout({
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
        evaluateLayoutSpend,
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

  const repairSession = await runSession({
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
      evaluateLayoutSpend,
    });
    repairLayoutPlan = layoutValidation.layout;
    repairLayoutSpend = layoutValidation.spend;
    repairValidation = { ok: layoutValidation.ok, errors: layoutValidation.errors || [], missingSelections: [] };
    if (!repairValidation.ok && !strict) {
      const fitted = fitLayout({
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
    const repairMapped = mapPool({ summary: repairSummary, catalog });
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
          const remapped = mapPool({ summary: snapped.summary, catalog });
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

function applyActorTypeToSelections(selections = [], actorType) {
  if (actorType !== "delver" && actorType !== "warden") return selections;
  return selections.map((selection) => {
    if (selection?.kind !== "actor") return selection;
    const next = { ...selection };
    if (next.requested && typeof next.requested === "object") {
      next.requested = { ...next.requested, actorType: next.requested.actorType || actorType };
    }
    if (Array.isArray(next.instances)) {
      next.instances = next.instances.map((instance) => ({
        ...instance,
        actorType: instance.actorType || actorType,
      }));
    }
    return next;
  });
}

function buildActorPhaseGoal({ baseGoal, dungeonAffinity, wardenAffinities } = {}) {
  const wardenPhrase = formatAffinityPhrase(wardenAffinities);
  if (isNonEmptyString(wardenPhrase)) {
    return `Create dungeon wardens for a ${wardenPhrase} themed dungeon.`;
  }
  if (isNonEmptyString(dungeonAffinity)) {
    return `Create dungeon wardens for a ${dungeonAffinity} themed dungeon.`;
  }
  if (isNonEmptyString(baseGoal)) {
    const trimmed = baseGoal.trim();
    if (/warden/i.test(trimmed)) {
      return trimmed;
    }
    const affinityMatch = trimmed.match(/\b([a-z]+)\s+affinity\b/i);
    if (affinityMatch) {
      return `Create dungeon wardens for a ${affinityMatch[1].toLowerCase()} themed dungeon.`;
    }
  }
  return "Create dungeon wardens for this dungeon.";
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
  wardenAffinities,
  layoutPhaseContext = "",
  // CR.9 M3: selection spend prices raw actor motivations, and motivation vocabulary
  // is Configurator law. It is threaded in from the composition root rather than
  // imported here — the Orchestrator has no business importing the Configurator, and
  // the Allocator no longer owns a second copy of the rules.
  normalizeMotivations,
  // CR.4 M5b stage 1: the loop no longer performs LLM IO itself. It drives TWO sessions —
  // a primary and its own repair session — and each used to await the session helper
  // directly, which awaits `adapter.generate` inline inside the persona. The runner is
  // threaded in from the composition root instead, exactly as `normalizeMotivations` is
  // above: glue supplies `commands/llm-host.js`, which drives an Orchestrator round and
  // dispatches its requests through ports/effects.js.
  //
  // REQUIRED, with no default. Defaulting to the old helper would leave the inline IO in
  // place as a silent fallback — the defect class this branch has now found six times —
  // and a caller that forgot to thread it would silently keep the old path. PX.3 made the
  // same call for the clock, and requiring it exposed four callers that never passed one.
  runSession,
  // CR.4 M5b.2a′: mapping an LLM summary onto catalog pools is a DIRECTOR decision, and
  // `director.mapPool` is FSM-gated behind an open build round. Until now the loop mapped
  // summaries with no Director round existing at all — an artifact produced with no round,
  // the same defect as CR.4's `producedBy` stamp and CR.3's discarded plan.
  //
  // REQUIRED, no default, for the same reason as `runSession`: falling back to the
  // Director's internals would leave TWO live mappers and a caller that silently kept the
  // ungated one.
  mapPool,
  // CR.4 M5b.2b: pricing is the ALLOCATOR's, and this loop was doing three pieces of it
  // inline — resolving layout tile costs, splitting the budget, and judging selection
  // spend — by importing that persona's internals. Under Option 1 (maintainer decision,
  // 2026-08-07) the loop's sole counterpart is the DIRECTOR, which asks the Allocator
  // through its public barrel and hands the answer back.
  //
  // REQUIRED, no defaults, for the reason `runSession` and `mapPool` are: a default would
  // keep the inline pricing live as a silent fallback. This class of defect is especially
  // invisible here — a wrongly-priced build still returns a well-formed number, so no
  // schema, no guard and no golden would notice. Only the absence of a fallback does.
  resolveTileCosts,
  allocateBudget,
  evaluateSelectionSpend,
  // CR.4 M5b.2c: the auto-fit search — revise an over-budget layout until it fits. It lived
  // here as ~150 lines until 2026-08-08, and it was never merely a caller of Allocator
  // pricing: its reduction policy chose which tile to drop BY THAT TILE'S COST. Deciding
  // what a token is best spent on is the Allocator's, so the whole search moved there
  // (`allocator/layout-fit.js`) and the loop asks the Director for a fitted layout.
  //
  // REQUIRED, no default, like its four siblings. A fallback to a local copy would be worse
  // here than anywhere else in this file: a drifted search still returns a well-formed
  // layout that is still under budget — just a different one — so nothing downstream could
  // tell. `tests/personas/allocator/allocator-layout-fit.test.js` pins 660 cases for exactly
  // that reason.
  fitLayout,
  // CR.4 M5b.2d: the LAST piece of pricing this loop performed itself — what a proposed
  // layout costs, and whether it fits what is left of the budget. `fitLayout` above revises
  // a layout; this one only judges it, which is why they are separate answers rather than
  // one. With this threaded, `allocator/layout-spend.js` is no longer imported here at all
  // and the allowlist row dies rather than moves.
  //
  // REQUIRED, no default, like its five siblings — and here the silent-fallback risk is at
  // its worst: a stale local copy would report a well-formed `spentTokens` on a layout the
  // Allocator would have judged over budget, so the build would proceed and every artifact
  // downstream would look correct.
  evaluateLayoutSpend,
} = {}) {
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return { ok: false, errors: [{ field: "budgetTokens", code: "missing_budget_tokens" }], captures: [] };
  }
  if (typeof mapPool !== "function") {
    return {
      ok: false,
      errors: [{ field: "mapPool", code: "missing_pool_mapper" }],
      captures: [],
    };
  }
  if (typeof runSession !== "function") {
    // Required, not defaulted: see the `runSession` note in the signature. Reported
    // rather than thrown, because every caller reads `{ ok, errors }` and a throw would
    // change how failures surface rather than where IO happens.
    return {
      ok: false,
      errors: [{ field: "runSession", code: "missing_session_runner" }],
      captures: [],
    };
  }
  // CR.4 M5b.2b — the three Allocator answers. Refused before any LLM request is made, so
  // a misconfigured caller cannot spend tokens on a build it could never price.
  if (typeof resolveTileCosts !== "function") {
    return {
      ok: false,
      errors: [{ field: "resolveTileCosts", code: "missing_tile_cost_resolver" }],
      captures: [],
    };
  }
  if (typeof allocateBudget !== "function") {
    return {
      ok: false,
      errors: [{ field: "allocateBudget", code: "missing_budget_allocator" }],
      captures: [],
    };
  }
  if (typeof evaluateSelectionSpend !== "function") {
    return {
      ok: false,
      errors: [{ field: "evaluateSelectionSpend", code: "missing_selection_spend_evaluator" }],
      captures: [],
    };
  }
  if (typeof fitLayout !== "function") {
    return {
      ok: false,
      errors: [{ field: "fitLayout", code: "missing_layout_fitter" }],
      captures: [],
    };
  }
  if (typeof evaluateLayoutSpend !== "function") {
    return {
      ok: false,
      errors: [{ field: "evaluateLayoutSpend", code: "missing_layout_spend_evaluator" }],
      captures: [],
    };
  }
  // PX.3 (M6): the ternary here was a wall-clock fallback in the persona that stamps
  // every LLM capture and the budget allocation — the timestamps most likely to reach
  // a persisted artifact and a replay. Required now, loud when absent.
  const clockFn = requireClock(clock, "orchestrator");
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
  const wardenAffinityChoices = Array.isArray(wardenAffinities)
    ? wardenAffinities
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter(Boolean)
    : [];
  const wardenAffinitySet = new Set(allowedOptions.affinities || []);
  const filteredWardenAffinities = wardenAffinityChoices.filter((value) => wardenAffinitySet.has(value));
  const wardenAllowedOptions = filteredWardenAffinities.length > 0
    ? { ...allowedOptions, affinities: filteredWardenAffinities }
    : allowedOptions;
  const allowedPairs = deriveAllowedPairs(catalog);
  const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
  const cheapestCost = computeCheapestCost(entries);
  const layoutCostResult = resolveTileCosts({ priceList });
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
  const allocationResult = allocateBudget({
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
  const playerBudgetTokens = poolMap.get("delver") || 0;
  const layoutBudgetTokens = poolMap.get("rooms") || 0;
  const wardensBudgetTokens = poolMap.get("wardens") || 0;
  const resourceBudgetTokens = poolMap.get("resources") || 0;

  const captures = [];
  const trace = [];
  const approvedSelections = [];

  let remainingBudgetTokens = layoutBudgetTokens;

  const layoutPhase = await runPhase({
    runSession,
    mapPool,
    fitLayout,
    evaluateLayoutSpend,
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
    wardenAffinities: filteredWardenAffinities,
  });
  const wardenBudgetWithRollover = wardensBudgetTokens + layoutSpendResult.remainingBudgetTokens;
  remainingBudgetTokens = wardenBudgetWithRollover;
  // `resolveLayoutTileCosts` no longer returns warnings: a missing tile price used to be a
  // `missing_tile_cost` warning nothing read, on a spend that still looked well-formed.
  // It now throws `allocator_tile_price_required` (CR.9 M5).
  const layoutWarnings = [...(layoutSpendResult.warnings || [])].filter(Boolean);
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
    runSession,
    mapPool,
    fitLayout,
    evaluateLayoutSpend,
      adapter,
      model,
      baseUrl,
      goal: actorGoal,
      notes,
      budgetTokens,
      remainingBudgetTokens,
      allowedPairsText,
      allowedOptions: wardenAllowedOptions,
      phase: "actors_only",
      phaseContext,
      layoutCosts,
      affinities: filteredWardenAffinities.length > 0 ? filteredWardenAffinities : undefined,
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

    const actorSelections = applyActorTypeToSelections(actorsPhase.selections, "warden");
    const actorSpend = evaluateSelectionSpend({
      selections: actorSelections,
      budgetTokens: remainingBudgetTokens,
      priceList,
      normalizeMotivations,
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
  summary.cardSet = buildCardSetFromSummary(summary);

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
      delver: playerBudgetTokens,
      rooms: layoutBudgetTokens,
      wardens: wardensBudgetTokens,
      resources: resourceBudgetTokens,
    },
    poolPolicy: budgetAllocation.policy,
  };
}
