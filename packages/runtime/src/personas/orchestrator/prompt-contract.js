import { AFFINITY_KINDS } from "../configurator/affinity-loadouts.js";
import { MOTIVATION_KINDS } from "../configurator/motivation-loadouts.js";

export const ALLOWED_AFFINITIES = AFFINITY_KINDS;
export const ALLOWED_MOTIVATIONS = MOTIVATION_KINDS;

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

  return {
    motivation,
    affinity,
    count,
    tokenHint: normalizedTokenHint,
  };
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

export function buildMenuPrompt({ goal, notes } = {}) {
  const affinityMenu = ALLOWED_AFFINITIES.join(", ");
  const motivationMenu = ALLOWED_MOTIVATIONS.join(", ");
  const goalLine = goal ? `Goal: ${goal}\n` : "";
  const notesLine = notes ? `Notes: ${notes}\n` : "";
  return (
    `${goalLine}${notesLine}` +
    "You are a dungeon master setting up a dungeon.\n" +
    "You will receive information over several turns; acknowledge with `ready`, list what is missing, and wait for final JSON request.\n" +
    "Choose only from the allowed lists; do not invent new affinities or motivations.\n" +
    `Affinities: ${affinityMenu}\n` +
    `Motivations: ${motivationMenu}\n` +
    "Return JSON only when asked, shaped as:\n" +
    "{ \"dungeonTheme\": <affinity>, \"budgetTokens\": <int>, \"rooms\": [{\"motivation\":<motivation>,\"affinity\":<affinity>,\"count\":<int>,\"tokenHint\":<int?>}], \"actors\": [{\"motivation\":<motivation>,\"affinity\":<affinity>,\"count\":<int>,\"tokenHint\":<int?>}], \"missing\": [] }\n" +
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
