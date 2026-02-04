import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS } from "../configurator/affinity-loadouts.js";
import { MOTIVATION_KINDS } from "../configurator/motivation-loadouts.js";

export const ALLOWED_AFFINITIES = AFFINITY_KINDS;
export const ALLOWED_AFFINITY_EXPRESSIONS = AFFINITY_EXPRESSIONS;
export const ALLOWED_MOTIVATIONS = MOTIVATION_KINDS;
export const LLM_PHASES = Object.freeze(["rooms_only", "layout_only", "actors_only"]);
export const LLM_STOP_REASONS = Object.freeze(["done", "missing", "no_viable_spend"]);
export const LAYOUT_TILE_FIELDS = Object.freeze(["wallTiles", "floorTiles", "hallwayTiles"]);
const DEFAULT_LAYOUT_COSTS = Object.freeze({
  wallTiles: 1,
  floorTiles: 1,
  hallwayTiles: 1,
});
export function deriveAllowedOptionsFromCatalog(catalog = {}) {
  const entries = Array.isArray(catalog.entries) ? catalog.entries : Array.isArray(catalog) ? catalog : [];
  const affinities = new Set(ALLOWED_AFFINITIES);
  const motivations = new Set(ALLOWED_MOTIVATIONS);
  const ids = new Set();

  entries.forEach((entry) => {
    if (entry?.affinity && typeof entry.affinity === "string") affinities.add(entry.affinity);
    if (entry?.motivation && typeof entry.motivation === "string") motivations.add(entry.motivation);
    if (entry?.id && typeof entry.id === "string") ids.add(entry.id);
  });

  const sorted = (set) => Array.from(set).sort();
  return {
    affinities: sorted(affinities),
    motivations: sorted(motivations),
    poolIds: sorted(ids),
  };
}

function addError(errors, field, code) {
  errors.push({ field, code });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addWarning(warnings, field, code, detail) {
  const entry = { field, code };
  if (detail !== undefined) entry.detail = detail;
  warnings.push(entry);
}

function normalizeLayoutCounts(layout, errors) {
  if (layout === undefined) return undefined;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    addError(errors, "layout", "invalid_layout");
    return undefined;
  }
  const normalized = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    if (layout[field] === undefined) return;
    if (!Number.isInteger(layout[field]) || layout[field] < 0) {
      addError(errors, `layout.${field}`, "invalid_tile_count");
      return;
    }
    normalized[field] = layout[field];
  });
  return normalized;
}

function normalizeLayoutCosts(layoutCosts) {
  const costs = { ...DEFAULT_LAYOUT_COSTS };
  if (!layoutCosts || typeof layoutCosts !== "object" || Array.isArray(layoutCosts)) {
    return costs;
  }
  LAYOUT_TILE_FIELDS.forEach((field) => {
    const value = layoutCosts[field];
    if (Number.isInteger(value) && value > 0) {
      costs[field] = value;
    }
  });
  return costs;
}

function formatLayoutCostLine(layoutCosts) {
  const costs = normalizeLayoutCosts(layoutCosts);
  return `Tile costs: wall ${costs.wallTiles}, floor ${costs.floorTiles}, hallway ${costs.hallwayTiles} tokens each.`;
}

function normalizePick(entry, base, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    addError(errors, base, "invalid_pick");
    return null;
  }
  const { motivation, affinity, count, tokenHint } = entry;
  const expression = entry.expression ?? entry.affinityExpression;
  const stacks = entry.stacks ?? entry.affinityStacks;
  if (!isNonEmptyString(motivation) || !ALLOWED_MOTIVATIONS.includes(motivation)) {
    addError(errors, `${base}.motivation`, "invalid_motivation");
  }
  if (!isNonEmptyString(affinity) || !ALLOWED_AFFINITIES.includes(affinity)) {
    addError(errors, `${base}.affinity`, "invalid_affinity");
  }
  if (!Number.isInteger(count) || count <= 0) {
    addError(errors, `${base}.count`, "invalid_count");
  }
  let normalizedTokenHint;
  if (tokenHint !== undefined) {
    if (!Number.isInteger(tokenHint) || tokenHint <= 0) {
      addError(errors, `${base}.tokenHint`, "invalid_token_hint");
    } else {
      normalizedTokenHint = tokenHint;
    }
  }

  let normalizedExpression;
  if (expression !== undefined) {
    if (!isNonEmptyString(expression) || !ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
      addError(errors, `${base}.expression`, "invalid_expression");
    } else {
      normalizedExpression = expression;
    }
  }

  let normalizedStacks;
  if (stacks !== undefined) {
    if (!Number.isInteger(stacks) || stacks <= 0) {
      addError(errors, `${base}.stacks`, "invalid_stacks");
    } else {
      normalizedStacks = stacks;
    }
  }

  let normalizedAffinities;
  if (entry.affinities !== undefined) {
    if (!Array.isArray(entry.affinities)) {
      addError(errors, `${base}.affinities`, "invalid_affinities");
      normalizedAffinities = [];
    } else {
      normalizedAffinities = [];
      entry.affinities.forEach((entryAffinity, index) => {
        const affinityBase = `${base}.affinities[${index}]`;
        if (!entryAffinity || typeof entryAffinity !== "object" || Array.isArray(entryAffinity)) {
          addError(errors, affinityBase, "invalid_affinity");
          return;
        }
        const kind = entryAffinity.kind || entryAffinity.affinity;
        const affinityExpression = entryAffinity.expression ?? entryAffinity.affinityExpression;
        if (!isNonEmptyString(kind) || !ALLOWED_AFFINITIES.includes(kind)) {
          addError(errors, `${affinityBase}.kind`, "invalid_affinity");
        }
        if (!isNonEmptyString(affinityExpression) || !ALLOWED_AFFINITY_EXPRESSIONS.includes(affinityExpression)) {
          addError(errors, `${affinityBase}.expression`, "invalid_expression");
        }
        const stacksValue = entryAffinity.stacks ?? entryAffinity.affinityStacks;
        const stacksParsed = Number.isInteger(stacksValue) ? stacksValue : 1;
        if (!Number.isInteger(stacksValue) && stacksValue !== undefined) {
          addError(errors, `${affinityBase}.stacks`, "invalid_stacks");
        }
        if (Number.isInteger(stacksValue) && stacksValue <= 0) {
          addError(errors, `${affinityBase}.stacks`, "invalid_stacks");
        }
        normalizedAffinities.push({
          kind,
          expression: affinityExpression,
          stacks: Number.isInteger(stacksValue) && stacksValue > 0 ? stacksValue : stacksParsed,
        });
      });
    }
  } else if (normalizedExpression) {
    normalizedAffinities = [
      {
        kind: affinity,
        expression: normalizedExpression,
        stacks: normalizedStacks || 1,
      },
    ];
  } else if (normalizedStacks !== undefined) {
    addError(errors, `${base}.expression`, "missing_expression");
  }

  const result = {
    motivation,
    affinity,
    count,
    tokenHint: normalizedTokenHint,
  };
  if (normalizedExpression) result.expression = normalizedExpression;
  if (normalizedStacks !== undefined) result.stacks = normalizedStacks;
  if (normalizedAffinities && normalizedAffinities.length > 0) {
    result.affinities = normalizedAffinities;
  }
  return result;
}

export function normalizeSummary(summary) {
  return normalizeSummaryWithOptions(summary);
}

export function normalizeSummaryWithOptions(summary, { phase } = {}) {
  const errors = [];
  const warnings = [];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    addError(errors, "summary", "invalid_summary");
    return { ok: false, errors, warnings, value: null };
  }

  const value = {};
  if (summary.phase !== undefined) {
    if (!isNonEmptyString(summary.phase) || !LLM_PHASES.includes(summary.phase)) {
      addError(errors, "phase", "invalid_phase");
    } else {
      value.phase = summary.phase;
    }
  }
  if (phase && value.phase && value.phase !== phase) {
    addError(errors, "phase", "phase_mismatch");
  }
  if (phase && !value.phase) {
    addWarning(warnings, "phase", "missing_phase", phase);
  }
  if (summary.remainingBudgetTokens !== undefined) {
    if (!Number.isInteger(summary.remainingBudgetTokens) || summary.remainingBudgetTokens < 0) {
      addError(errors, "remainingBudgetTokens", "invalid_budget");
    } else {
      value.remainingBudgetTokens = summary.remainingBudgetTokens;
    }
  }
  const stopReason = summary.stop ?? summary.stopReason;
  if (stopReason !== undefined) {
    if (!isNonEmptyString(stopReason) || !LLM_STOP_REASONS.includes(stopReason)) {
      addError(errors, "stop", "invalid_stop_reason");
    } else {
      value.stop = stopReason;
    }
  }
  if (summary.dungeonTheme !== undefined) {
    if (!isNonEmptyString(summary.dungeonTheme) || !ALLOWED_AFFINITIES.includes(summary.dungeonTheme)) {
      addError(errors, "dungeonTheme", "invalid_affinity");
    } else {
      value.dungeonTheme = summary.dungeonTheme;
    }
  }
  const layout = normalizeLayoutCounts(summary.layout, errors);
  if (layout && Object.keys(layout).length > 0) {
    value.layout = layout;
  }
  if (summary.budgetTokens !== undefined) {
    if (!Number.isInteger(summary.budgetTokens) || summary.budgetTokens <= 0) {
      addError(errors, "budgetTokens", "invalid_budget");
    } else {
      value.budgetTokens = summary.budgetTokens;
    }
  }

  const roomsInput = Array.isArray(summary.rooms) ? summary.rooms : [];
  const actorsInput = Array.isArray(summary.actors) ? summary.actors : [];

  value.rooms = [];
  roomsInput.forEach((entry, index) => {
    const normalized = normalizePick(entry, `rooms[${index}]`, errors);
    if (normalized) value.rooms.push(normalized);
  });

  value.actors = [];
  actorsInput.forEach((entry, index) => {
    const normalized = normalizePick(entry, `actors[${index}]`, errors);
    if (normalized) value.actors.push(normalized);
  });

  if (Array.isArray(summary.missing)) {
    value.missing = summary.missing.filter(isNonEmptyString);
  }

  return { ok: errors.length === 0, errors, warnings, value };
}

export function buildMenuPrompt({ goal, notes, budgetTokens } = {}) {
  const affinityMenu = ALLOWED_AFFINITIES.join(", ");
  const expressionMenu = ALLOWED_AFFINITY_EXPRESSIONS.join(", ");
  const motivationMenu = ALLOWED_MOTIVATIONS.join(", ");
  const goalLine = goal ? `Goal: ${goal}\n` : "";
  const notesLine = notes ? `Notes: ${notes}\n` : "";
  const budgetLine = Number.isInteger(budgetTokens) && budgetTokens > 0 ? `Budget tokens: ${budgetTokens}\n` : "";
  return (
    `${goalLine}${notesLine}${budgetLine}` +
    "You are a dungeon master strategist shaping a dungeon layout and the actors that populate it.\n" +
    "You may receive information over several turns; acknowledge with `ready`, list what is missing, and wait for the final JSON request.\n" +
    "Choose only from the allowed lists; do not invent new affinities, expressions, or motivations.\n" +
    `Affinities: ${affinityMenu}\n` +
    `Affinity expressions: ${expressionMenu}\n` +
    `Motivations: ${motivationMenu}\n` +
    "Return JSON only when asked, shaped as:\n" +
    "{ \"dungeonTheme\": <affinity>, \"budgetTokens\": <int>, \"rooms\": [{\"motivation\":<motivation>,\"affinity\":<affinity>,\"count\":<int>,\"tokenHint\":<int?>,\"affinities\":[{\"kind\":<affinity>,\"expression\":<expression>,\"stacks\":<int?>}]}], \"actors\": [{\"motivation\":<motivation>,\"affinity\":<affinity>,\"count\":<int>,\"tokenHint\":<int?>,\"affinities\":[{\"kind\":<affinity>,\"expression\":<expression>,\"stacks\":<int?>}]}], \"missing\": [] }\n" +
    "If unsure, populate `missing` instead of inventing values."
  );
}

export function buildPhasePrompt({
  goal,
  notes,
  budgetTokens,
  phase,
  remainingBudgetTokens,
  allowedPairsText,
  context,
  layoutCosts,
} = {}) {
  const resolvedPhase = LLM_PHASES.includes(phase) ? phase : "rooms_only";
  const basePrompt = resolvedPhase === "layout_only"
    ? [
        goal ? `Goal: ${goal}` : null,
        notes ? `Notes: ${notes}` : null,
        Number.isInteger(budgetTokens) && budgetTokens > 0 ? `Budget tokens: ${budgetTokens}` : null,
        "Plan the dungeon layout using tile counts only. Rooms do not have affinities or motivations.",
        formatLayoutCostLine(layoutCosts),
        "Leave budget for actors; do not spend the entire budget on layout.",
      ]
        .filter(Boolean)
        .join("\n")
    : buildMenuPrompt({ goal, notes, budgetTokens });
  const remainingLine = Number.isInteger(remainingBudgetTokens)
    ? `Remaining budget tokens: ${remainingBudgetTokens}`
    : "";
  const allowedPairsLine = isNonEmptyString(allowedPairsText)
    ? `Allowed profiles (motivation, affinity): ${allowedPairsText}`
    : "";
  const phaseInstruction =
    resolvedPhase === "layout_only"
      ? "Return layout tile counts only; omit rooms and actors."
      : resolvedPhase === "rooms_only"
        ? "Return rooms only; omit actors unless explicitly asked."
      : "Return actors only; omit rooms unless explicitly asked.";
  const responseShape =
    resolvedPhase === "layout_only"
      ? "{ \"phase\": \"layout_only\", \"remainingBudgetTokens\": <int>, \"layout\": {\"wallTiles\": <int>, \"floorTiles\": <int>, \"hallwayTiles\": <int>}, \"missing\": [], \"stop\": \"done\" | \"missing\" | \"no_viable_spend\" }"
      : resolvedPhase === "rooms_only"
        ? "{ \"phase\": \"rooms_only\", \"remainingBudgetTokens\": <int>, \"rooms\": [ ... ], \"missing\": [], \"stop\": \"done\" | \"missing\" | \"no_viable_spend\" }"
        : "{ \"phase\": \"actors_only\", \"remainingBudgetTokens\": <int>, \"actors\": [ ... ], \"missing\": [], \"stop\": \"done\" | \"missing\" | \"no_viable_spend\" }";
  const contextLine = isNonEmptyString(context) ? `Context: ${context}` : "";
  const suffix = "Final request: return the JSON now. Output JSON only (no markdown, no commentary).";
  return [
    basePrompt,
    "",
    "Phase instructions:",
    `- Phase: ${resolvedPhase}`,
    remainingLine ? `- ${remainingLine}` : "",
    allowedPairsLine ? `- ${allowedPairsLine}` : "",
    contextLine ? `- ${contextLine}` : "",
    `- ${phaseInstruction}`,
    resolvedPhase === "actors_only" ? "- Spend as much of the remaining budget as possible while staying feasible." : "",
    "",
    "Response shape:",
    responseShape,
    "",
    suffix,
  ]
    .filter(Boolean)
    .join("\n");
}

export function capturePromptResponse({ prompt, responseText, phase } = {}) {
  const errors = [];
  let responseParsed = null;
  let summary = null;
  try {
    responseParsed = JSON.parse(responseText);
    const result = normalizeSummaryWithOptions(responseParsed, { phase });
    if (!result.ok) {
      errors.push(...result.errors);
    } else {
      summary = result.value;
    }
  } catch (err) {
    errors.push({ field: "response", code: "invalid_json", message: err.message });
  }

  return {
    prompt,
    responseRaw: responseText,
    responseParsed,
    summary,
    errors,
  };
}
