import { AFFINITY_EXPRESSIONS, AFFINITY_KINDS } from "../configurator/affinity-loadouts.js";
import { MOTIVATION_KINDS } from "../configurator/motivation-loadouts.js";

export const ALLOWED_AFFINITIES = AFFINITY_KINDS;
export const ALLOWED_AFFINITY_EXPRESSIONS = AFFINITY_EXPRESSIONS;
export const ALLOWED_MOTIVATIONS = MOTIVATION_KINDS;
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
  const errors = [];
  const warnings = [];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    addError(errors, "summary", "invalid_summary");
    return { ok: false, errors, warnings, value: null };
  }

  const value = {};
  if (summary.dungeonTheme !== undefined) {
    if (!isNonEmptyString(summary.dungeonTheme) || !ALLOWED_AFFINITIES.includes(summary.dungeonTheme)) {
      addError(errors, "dungeonTheme", "invalid_affinity");
    } else {
      value.dungeonTheme = summary.dungeonTheme;
    }
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

export function capturePromptResponse({ prompt, responseText }) {
  const errors = [];
  let responseParsed = null;
  let summary = null;
  try {
    responseParsed = JSON.parse(responseText);
    const result = normalizeSummary(responseParsed);
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
