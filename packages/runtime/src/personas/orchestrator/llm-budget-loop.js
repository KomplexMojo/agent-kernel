import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
  LLM_STOP_REASONS,
  buildPhasePrompt,
  deriveAllowedOptionsFromCatalog,
} from "./prompt-contract.js";
import { runLlmSession } from "./llm-session.js";
import { mapSummaryToPool } from "../director/pool-mapper.js";
import { deriveLevelGen } from "../director/buildspec-assembler.js";
import { buildBudgetAllocation } from "../director/budget-allocation.js";
import { validateLayoutAndActors, validateLayoutCountsAndActors } from "../configurator/feasibility.js";
import { normalizePoolCatalog } from "../configurator/pool-catalog.js";
import { evaluateLayoutSpend, normalizeLayoutCounts, resolveLayoutTileCosts, sumLayoutTiles } from "../allocator/layout-spend.js";
import { evaluateSelectionSpend } from "../allocator/selection-spend.js";

const DEFAULT_MAX_ACTOR_ROUNDS = 2;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
    ? `Layout tiles: wall ${layout.wallTiles}, floor ${layout.floorTiles}, hallway ${layout.hallwayTiles}`
    : "";
  return [layoutLine, rooms, actors].filter(Boolean).join(" | ");
}

function filterSummaryByPhase(summary, phase) {
  if (!summary || typeof summary !== "object") return {};
  const next = {};
  if (summary.dungeonTheme !== undefined) next.dungeonTheme = summary.dungeonTheme;
  if (summary.budgetTokens !== undefined) next.budgetTokens = summary.budgetTokens;
  if (summary.phase !== undefined) next.phase = summary.phase;
  if (summary.remainingBudgetTokens !== undefined) next.remainingBudgetTokens = summary.remainingBudgetTokens;
  if (summary.stop !== undefined) next.stop = summary.stop;
  if (Array.isArray(summary.missing)) next.missing = summary.missing;
  if (phase === "layout_only" && summary.layout && typeof summary.layout === "object") {
    next.layout = summary.layout;
  }
  if (phase === "rooms_only") next.rooms = Array.isArray(summary.rooms) ? summary.rooms : [];
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
      ? "Provide layout tile counts with non-negative integers (wallTiles, floorTiles, hallwayTiles)."
      : phase === "rooms_only"
        ? "Provide at least one room entry; each count must be >= 1."
        : "Provide at least one actor entry; each count must be >= 1.";
  const preview = String(responseText || "").slice(0, 4000);
  return [
    basePrompt,
    "",
    "Your previous response failed validation. Fix it and return corrected JSON only.",
    `Errors: ${JSON.stringify(errors)}`,
    phase === "layout_only"
      ? `Tile costs: wall ${layoutCosts?.wallTiles ?? 1}, floor ${layoutCosts?.floorTiles ?? 1}, hallway ${layoutCosts?.hallwayTiles ?? 1} tokens each.`
      : `Allowed affinities: ${affinities.join(", ")}`,
    phase === "layout_only" ? null : `Allowed expressions: ${expressions.join(", ")}`,
    phase === "layout_only" ? null : `Allowed motivations: ${motivations.join(", ")}`,
    phase === "layout_only" ? null : allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
    missingSelections ? `Unmatched picks: ${missingSelections}` : null,
    phaseRequirement,
    phase === "layout_only" ? "Use integers only for tile counts; omit optional fields." : "tokenHint must be a positive integer if provided; otherwise omit it.",
    phase === "layout_only" ? "Example layout: {\"layout\":{\"wallTiles\":40,\"floorTiles\":60,\"hallwayTiles\":20}}" : "Example affinity entry: {\"kind\":\"water\",\"expression\":\"push\",\"stacks\":1}",
    "Invalid response JSON (fix to match schema):",
    preview,
    "",
    "Final request: return corrected JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function validatePhaseSelections(selections, phase) {
  const errors = [];
  const missingSelections = selections.filter((sel) => !sel.applied);
  if (missingSelections.length > 0) {
    errors.push({ field: "selections", code: "missing_catalog_match" });
  }
  if (phase === "rooms_only" && countInstances(selections, "room") <= 0) {
    errors.push({ field: "rooms", code: "missing_rooms" });
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

function validateFeasibility({ roomCount, actorCount, layout }) {
  if (layout) {
    const result = validateLayoutCountsAndActors({ layout, actorCount });
    return { ok: result.ok, errors: result.errors || [] };
  }
  const levelGen = deriveLevelGen({ roomCount });
  const result = validateLayoutAndActors({ levelGen, actorCount });
  return { ok: result.ok, errors: result.errors || [] };
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
  strict,
  format,
  stream,
  runId,
  producedBy,
  clock,
  requestId,
  catalog,
  priceList,
  maxRepairs = 1,
  nextCaptureMeta,
  extraValidator,
} = {}) {
  const startedAt = typeof clock === "function" ? clock() : undefined;
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const captures = [];
  let validationErrors = [];
  const basePrompt = buildPhasePrompt({
    goal,
    notes,
    budgetTokens,
    phase,
    remainingBudgetTokens,
    allowedPairsText,
    context: phaseContext,
    layoutCosts,
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
    requireSummary: phase === "rooms_only"
      ? { minRooms: 1 }
      : phase === "actors_only"
        ? { minActors: 1 }
        : undefined,
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

  const phaseSummary = filterSummaryByPhase(session.summary, phase);
  let selections = [];
  let layoutPlan = null;
  let layoutSpend = null;
  let validation = { ok: true, errors: [], missingSelections: [] };
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
  } else {
    const mapped = mapSummaryToPool({ summary: phaseSummary, catalog });
    selections = mapped.selections;
    validation = validatePhaseSelections(mapped.selections, phase);
  }
  const extra = typeof extraValidator === "function"
    ? extraValidator({ selections, summary: phaseSummary, phase, layout: layoutPlan })
    : { ok: true, errors: [] };
  const combinedErrors = [...validation.errors, ...(extra.errors || [])];
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
      startedAt,
      endedAt,
      durationMs,
    };
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

  const repairSummary = filterSummaryByPhase(repairSession.summary, phase);
  let repairSelections = [];
  let repairLayoutPlan = null;
  let repairLayoutSpend = null;
  let repairValidation = { ok: true, errors: [], missingSelections: [] };
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
  } else {
    const repairMapped = mapSummaryToPool({ summary: repairSummary, catalog });
    repairSelections = repairMapped.selections;
    repairValidation = validatePhaseSelections(repairMapped.selections, phase);
  }
  const repairExtra = typeof extraValidator === "function"
    ? extraValidator({ selections: repairSelections, summary: repairSummary, phase, layout: repairLayoutPlan })
    : { ok: true, errors: [] };
  const repairCombinedErrors = [...repairValidation.errors, ...(repairExtra.errors || [])];
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

  const allowedOptions = deriveAllowedOptionsFromCatalog(catalog);
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
    phaseContext: "",
    layoutCosts,
    strict,
    format,
    stream,
    runId: resolvedRunId,
    producedBy,
    clock: clockFn,
    requestId,
    catalog,
    priceList,
    nextCaptureMeta,
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
      goal,
      notes,
      budgetTokens,
      remainingBudgetTokens,
      allowedPairsText,
      allowedOptions,
      phase: "actors_only",
      phaseContext,
      layoutCosts,
      strict,
      format,
      stream,
      runId: resolvedRunId,
      producedBy,
      clock: clockFn,
      requestId,
      catalog,
      priceList,
      nextCaptureMeta,
      extraValidator: ({ selections }) => {
        const actorCount = countRequestedSelections(approvedActors, "actor")
          + countRequestedSelections(selections, "actor");
        return validateFeasibility({ layout: layoutPlan, actorCount });
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
    stopReason = resolveStopReason({
      summary: actorsPhase.summary,
      remainingBudgetTokens,
      cheapestCost,
      ignoreDoneIfBudgetRemains: true,
    });

    actorRounds += 1;
  }

  const baseSummary = {
    dungeonTheme: layoutPhase.summary?.dungeonTheme || lastActorSummary?.dungeonTheme,
    budgetTokens: layoutPhase.summary?.budgetTokens || budgetTokens,
    layout: layoutPlan || layoutPhase.summary?.layout,
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
