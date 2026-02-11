export const AFFINITY_KINDS = Object.freeze([
  "fire",
  "water",
  "earth",
  "wind",
  "life",
  "decay",
  "corrode",
  "dark",
]);

export const AFFINITY_EXPRESSIONS = Object.freeze(["push", "pull", "emit"]);
export const DEFAULT_DUNGEON_AFFINITY = AFFINITY_KINDS[0];
export const DEFAULT_AFFINITY_EXPRESSION = AFFINITY_EXPRESSIONS[0];
export const DEFAULT_LLM_MODEL = "phi4";
export const DEFAULT_LLM_BASE_URL = "http://localhost:11434";
export const DEFAULT_LLM_CONTEXT_WINDOW_TOKENS = 256000;
export const PHI4_MODEL_CONTEXT_WINDOW_TOKENS = 16384;
export const PHI4_LAYOUT_MAX_LATENCY_MS = 10000;
export const PHI4_RESPONSE_TOKEN_BUDGET = Object.freeze({
  designSummary: 220,
  layoutPhase: 160,
  actorsPhase: 320,
});
export const PHI4_OLLAMA_OPTIONS = Object.freeze({
  num_ctx: PHI4_MODEL_CONTEXT_WINDOW_TOKENS,
  temperature: 0.15,
  top_p: 0.9,
  repeat_penalty: 1.05,
});

export const VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability"]);
export const TRAP_VITAL_KEYS = Object.freeze(["mana", "durability"]);

function buildLookup(list) {
  const out = Object.create(null);
  for (let i = 0; i < list.length; i += 1) {
    out[list[i]] = i;
  }
  return Object.freeze(out);
}

export const VITAL_KIND = buildLookup(VITAL_KEYS);
export const VITAL_COUNT = VITAL_KEYS.length;

export const AFFINITY_KIND_SET = new Set(AFFINITY_KINDS);
export const AFFINITY_EXPRESSION_SET = new Set(AFFINITY_EXPRESSIONS);
export const DOMAIN_CONSTRAINTS = Object.freeze({
  llm: Object.freeze({
    model: DEFAULT_LLM_MODEL,
    baseUrl: DEFAULT_LLM_BASE_URL,
    contextWindowTokens: DEFAULT_LLM_CONTEXT_WINDOW_TOKENS,
    modelContextTokens: PHI4_MODEL_CONTEXT_WINDOW_TOKENS,
    outputFormat: "json",
    targetLatencyMs: Object.freeze({
      layoutPhase: PHI4_LAYOUT_MAX_LATENCY_MS,
    }),
    responseTokenBudget: PHI4_RESPONSE_TOKEN_BUDGET,
    options: PHI4_OLLAMA_OPTIONS,
  }),
});

const LLM_PROMPT_SUFFIX_JSON_ONLY =
  "Final request: return the JSON now. Output JSON only (no markdown, no commentary).";
const LLM_PROMPT_SUFFIX_REPAIR_ONLY = "Final request: return corrected JSON only.";
export const LLM_REPAIR_TEXT = Object.freeze({
  phaseLayoutRequirement: "Provide layout tile counts with non-negative integers (wallTiles, floorTiles, hallwayTiles).",
  phaseRoomsRequirement: "Provide at least one room entry; each count must be >= 1.",
  phaseActorsRequirement: "Provide at least one actor entry; each count must be >= 1.",
  phaseRoomsAndActorsRequirement: "Provide at least one room and one actor; each count must be >= 1.",
  tokenHintRule: "tokenHint must be a positive integer if provided; otherwise omit it.",
  exampleAffinityEntry: "Example affinity entry: {\"kind\":\"water\",\"expression\":\"push\",\"stacks\":1}",
  layoutIntegerRule: "Use integers only for tile counts; omit optional fields.",
  layoutExample: "Example layout: {\"layout\":{\"wallTiles\":40,\"floorTiles\":60,\"hallwayTiles\":20}}",
});

export const DEFAULT_VITALS = Object.freeze({
  health: Object.freeze({ current: 1, max: 1, regen: 0 }),
  mana: Object.freeze({ current: 0, max: 0, regen: 0 }),
  stamina: Object.freeze({ current: 0, max: 0, regen: 0 }),
  durability: Object.freeze({ current: 1, max: 1, regen: 0 }),
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asPositiveInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(Number(value));
  return normalized > 0 ? normalized : fallback;
}

function asList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value;
}

function normalizeTileCosts(tileCosts = {}) {
  return {
    wallTiles: asPositiveInt(tileCosts.wallTiles, 1),
    floorTiles: asPositiveInt(tileCosts.floorTiles, 1),
    hallwayTiles: asPositiveInt(tileCosts.hallwayTiles, 1),
  };
}

export function appendLlmPromptSuffix(promptText, { suffix = LLM_PROMPT_SUFFIX_JSON_ONLY } = {}) {
  if (!isNonEmptyString(promptText)) {
    return promptText;
  }
  if (promptText.includes(suffix)) {
    return promptText;
  }
  return `${promptText}\n\n${suffix}`;
}

function buildPromptPreamble({
  goal,
  notes,
  budgetTokens,
  modelContextTokens = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens || DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens,
} = {}) {
  const lines = [];
  if (isNonEmptyString(goal)) lines.push(`Goal: ${goal}`);
  if (isNonEmptyString(notes)) lines.push(`Notes: ${notes}`);
  if (Number.isInteger(budgetTokens) && budgetTokens > 0) lines.push(`Budget tokens: ${budgetTokens}`);
  if (Number.isInteger(modelContextTokens) && modelContextTokens > 0) {
    lines.push(`Model context window token limit: ${modelContextTokens}`);
  }
  return lines;
}

export function buildLlmLevelPromptTemplate({
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  context,
  layoutCosts,
  modelContextTokens = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens || DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens,
  layoutLatencyMs = DOMAIN_CONSTRAINTS?.llm?.targetLatencyMs?.layoutPhase,
  finalSuffix = LLM_PROMPT_SUFFIX_JSON_ONLY,
} = {}) {
  const normalizedCosts = normalizeTileCosts(layoutCosts);
  const lines = buildPromptPreamble({ goal, notes, budgetTokens, modelContextTokens });
  lines.push("You are a dungeon level planner.");
  lines.push("Plan the dungeon layout using tile counts only.");
  lines.push("Rooms and actors are configured in a separate actor phase.");
  lines.push(`Tile costs: wall ${normalizedCosts.wallTiles}, floor ${normalizedCosts.floorTiles}, hallway ${normalizedCosts.hallwayTiles} tokens each.`);
  if (Number.isInteger(layoutLatencyMs) && layoutLatencyMs > 0) {
    lines.push(`Layout phase latency target: ${layoutLatencyMs} ms.`);
  }
  if (Number.isInteger(remainingBudgetTokens) && remainingBudgetTokens >= 0) {
    lines.push(`Remaining budget tokens: ${remainingBudgetTokens}`);
  }
  if (isNonEmptyString(context)) {
    lines.push(`Context: ${context}`);
  }
  lines.push("");
  lines.push("Phase instructions:");
  lines.push("- Phase: layout_only");
  lines.push("- Return layout tile counts and a room layout summary; omit actors.");
  lines.push("- Use non-negative integers for wallTiles, floorTiles, and hallwayTiles.");
  lines.push("- Include roomDesign.profile as one of: rooms, sparse_islands, clustered_islands, rectangular.");
  lines.push("- For sparse_islands, include roomDesign.density in [0,1].");
  lines.push("- For clustered_islands, include roomDesign.clusterSize as an integer >= 1.");
  lines.push("- Include a brief room design summary that explains how wall/floor/hallway tiles are used.");
  lines.push("- If profile is rooms, include room ids plus how rooms connect (adjacency list or connections list).");
  lines.push("- Example: 3 rooms (R1 large 10x10, R2 medium 20x3, R3 small 5x5) with connections R1-R2, R2-R3.");
  lines.push("- Keep the response concise; allow more detail only if needed to describe room structure.");
  lines.push("");
  lines.push("Response shape:");
  lines.push("{ \"phase\": \"layout_only\", \"remainingBudgetTokens\": <int>, \"layout\": {\"wallTiles\": <int>, \"floorTiles\": <int>, \"hallwayTiles\": <int>}, \"roomDesign\": {\"profile\":\"rooms\"|\"sparse_islands\"|\"clustered_islands\"|\"rectangular\",\"density\":<number?>,\"clusterSize\":<int?>,\"rooms\":[{\"id\":\"R1\",\"size\":\"large\"|\"medium\"|\"small\",\"width\":<int>,\"height\":<int>}],\"connections\":[{\"from\":\"R1\",\"to\":\"R2\",\"type\":\"hallway\"|\"door\"|\"open\"}],\"hallways\":\"<short description>\"}, \"missing\": [], \"stop\": \"done\" | \"missing\" | \"no_viable_spend\" }");
  lines.push("");
  lines.push(finalSuffix);
  return lines.join("\n");
}

export function buildLlmActorConfigPromptTemplate({
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  allowedPairsText,
  context,
  affinities = AFFINITY_KINDS,
  affinityExpressions = AFFINITY_EXPRESSIONS,
  motivations = [],
  modelContextTokens = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens || DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens,
  finalSuffix = LLM_PROMPT_SUFFIX_JSON_ONLY,
} = {}) {
  const affinityMenu = asList(affinities, AFFINITY_KINDS).join(", ");
  const expressionMenu = asList(affinityExpressions, AFFINITY_EXPRESSIONS).join(", ");
  const motivationMenu = asList(motivations, []).join(", ");
  const hasPhaseBudget = Number.isInteger(remainingBudgetTokens) && remainingBudgetTokens >= 0;
  const lines = buildPromptPreamble({
    goal,
    notes,
    budgetTokens: hasPhaseBudget ? undefined : budgetTokens,
    modelContextTokens,
  });
  if (hasPhaseBudget && Number.isInteger(budgetTokens) && budgetTokens > 0) {
    lines.push(`Total budget tokens: ${budgetTokens}`);
  }
  if (hasPhaseBudget) {
    lines.push(`Defender phase budget tokens: ${remainingBudgetTokens}`);
  }
  lines.push("You are a dungeon defender strategist.");
  lines.push("Configure defender actors and affinity stacks only.");
  lines.push("The level layout is already planned and must not be changed.");
  lines.push("Choose only from the allowed lists; do not invent new affinities, expressions, or motivations.");
  lines.push(`Affinities: ${affinityMenu}`);
  lines.push(`Affinity expressions: ${expressionMenu}`);
  lines.push(`Motivations: ${motivationMenu}`);
  if (isNonEmptyString(allowedPairsText)) {
    lines.push(`Allowed defender profiles (motivation, affinity): ${allowedPairsText}`);
  }
  if (isNonEmptyString(context)) {
    lines.push(`Context: ${context}`);
  }
  lines.push("");
  lines.push("Phase instructions:");
  lines.push("- Phase: actors_only");
  lines.push("- Return defenders only; omit rooms and layout.");
  lines.push("- Include at least one defender entry (count >= 1).");
  lines.push("- Use valid JSON with double quotes only; no trailing commas.");
  lines.push("- Spend as much of the remaining budget as possible while staying feasible.");
  lines.push("");
  lines.push("Defender viability guardrails:");
  lines.push("- If you include affinities or stacks, include vitals with mana > 0 and mana regen > 0.");
  lines.push("- Ensure defenders have non-trivial health (current/max >= 6).");
  lines.push("- Keep affinity stacks modest (1-3) unless mana and regen are higher.");
  lines.push("- You may include per-actor vitals: health/mana/stamina/durability each with current/max/regen.");
  lines.push("");
  lines.push("Response shape:");
  lines.push("{ \"phase\": \"actors_only\", \"remainingBudgetTokens\": <int>, \"actors\": [{\"motivation\":<motivation>,\"affinity\":<affinity>,\"count\":<int>,\"tokenHint\":<int?>,\"affinities\":[{\"kind\":<affinity>,\"expression\":<expression>,\"stacks\":<int?>}],\"vitals\":{\"health\":{\"current\":<int>,\"max\":<int>,\"regen\":<int>},\"mana\":{\"current\":<int>,\"max\":<int>,\"regen\":<int>},\"stamina\":{\"current\":<int>,\"max\":<int>,\"regen\":<int>},\"durability\":{\"current\":<int>,\"max\":<int>,\"regen\":<int>}}}], \"missing\": [], \"stop\": \"done\" | \"missing\" | \"no_viable_spend\" }");
  lines.push("");
  lines.push(finalSuffix);
  return lines.join("\n");
}

export function buildLlmPhasePromptTemplate({
  phase = "actors_only",
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  allowedPairsText,
  context,
  layoutCosts,
  affinities = AFFINITY_KINDS,
  affinityExpressions = AFFINITY_EXPRESSIONS,
  motivations = [],
  modelContextTokens = DOMAIN_CONSTRAINTS?.llm?.modelContextTokens || DOMAIN_CONSTRAINTS?.llm?.contextWindowTokens,
  layoutLatencyMs = DOMAIN_CONSTRAINTS?.llm?.targetLatencyMs?.layoutPhase,
  finalSuffix = LLM_PROMPT_SUFFIX_JSON_ONLY,
} = {}) {
  const resolvedPhase = phase === "layout_only" ? "layout_only" : "actors_only";
  if (resolvedPhase === "layout_only") {
    return buildLlmLevelPromptTemplate({
      goal,
      notes,
      budgetTokens,
      remainingBudgetTokens,
      context,
      layoutCosts,
      modelContextTokens,
      layoutLatencyMs,
      finalSuffix,
    });
  }
  return buildLlmActorConfigPromptTemplate({
    goal,
    notes,
    budgetTokens,
    remainingBudgetTokens,
    allowedPairsText,
    context,
    affinities,
    affinityExpressions,
    motivations,
    modelContextTokens,
    finalSuffix,
  });
}

export function buildLlmRepairPromptTemplate({
  basePrompt,
  errors,
  responseText,
  affinities = AFFINITY_KINDS,
  affinityExpressions = AFFINITY_EXPRESSIONS,
  motivations = [],
  allowedPairsText,
  phaseRequirement,
  extraLines = [],
  finalSuffix = LLM_PROMPT_SUFFIX_REPAIR_ONLY,
} = {}) {
  const preview = String(responseText || "").slice(0, 4000);
  return [
    basePrompt,
    "",
    "Your previous response failed validation. Fix it and return corrected JSON only.",
    `Errors: ${JSON.stringify(errors || [])}`,
    `Allowed affinities: ${asList(affinities, AFFINITY_KINDS).join(", ")}`,
    `Allowed expressions: ${asList(affinityExpressions, AFFINITY_EXPRESSIONS).join(", ")}`,
    `Allowed motivations: ${asList(motivations, []).join(", ")}`,
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
    phaseRequirement || null,
    ...asList(extraLines, []),
    "Invalid response JSON (fix to match schema):",
    preview,
    "",
    finalSuffix,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLlmConstraintSection({ allowedPairsText } = {}) {
  return [
    "Constraints:",
    "- In affinities[] entries, kind must be from Affinities and expression must be from Affinity expressions.",
    "- Omit optional fields instead of using null.",
    "- Provide at least one actor; counts must be > 0.",
    allowedPairsText ? `- Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLlmCatalogRepairPromptTemplate({
  basePrompt,
  allowedPairsText,
  missingSelections,
  finalSuffix = LLM_PROMPT_SUFFIX_REPAIR_ONLY,
} = {}) {
  return [
    basePrompt,
    "",
    "Your previous response did not match the pool catalog. Choose only from the allowed profiles below.",
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
    missingSelections ? `Unmatched picks: ${missingSelections}` : null,
    "Provide at least one actor entry with count >= 1.",
    finalSuffix,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildBuildSpecPromptTemplate({ schema, schemaVersion } = {}) {
  return [
    "You are an agent that returns a single JSON object that conforms to the BuildSpec contract.",
    "- Output JSON only (no markdown fences, no commentary).",
    `- Use schema "${schema}" version ${schemaVersion}.`,
    "- Required keys: schema, schemaVersion, meta (id, runId, createdAt, source), intent (goal).",
    "- Include configurator.inputs.levelGen and configurator.inputs.actors so the UI can build a new layout.",
    "- actorGroups must be an array of objects; actors and rooms must be arrays when provided.",
    "- budget refs must be objects with id + schema + schemaVersion (or omit budget entirely).",
    "- Keep values concise; omit optional fields you cannot infer.",
  ].join("\n");
}

function asFiniteInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.floor(num);
}

export function normalizeVitalRecord(value, fallback = { current: 0, max: 0, regen: 0 }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const current = Math.max(0, asFiniteInt(source.current, fallback.current));
  const max = Math.max(current, Math.max(0, asFiniteInt(source.max, fallback.max)));
  const regen = Math.max(0, asFiniteInt(source.regen, fallback.regen));
  return { current, max, regen };
}

export function normalizeVitals(vitals, defaults = DEFAULT_VITALS) {
  const source = vitals && typeof vitals === "object" && !Array.isArray(vitals) ? vitals : {};
  return VITAL_KEYS.reduce((acc, key) => {
    acc[key] = normalizeVitalRecord(source[key], defaults[key] || { current: 0, max: 0, regen: 0 });
    return acc;
  }, {});
}
