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
export const ATTACKER_SETUP_MODES = Object.freeze(["auto", "user", "hybrid"]);
export const DEFAULT_ATTACKER_SETUP_MODE = ATTACKER_SETUP_MODES[0];
export const DEFAULT_LLM_MODEL = "phi4";
export const DEFAULT_LLM_BASE_URL = "http://localhost:11434";
export const DEFAULT_LLM_CONTEXT_WINDOW_TOKENS = 256000;
export const LAYOUT_TILE_FIELDS = Object.freeze(["floorTiles", "hallwayTiles"]);
export const DEFAULT_LAYOUT_TILE_COSTS = Object.freeze({
  floorTiles: 1,
  hallwayTiles: 1,
});
export const LAYOUT_TILE_PRICE_IDS = Object.freeze({
  floorTiles: { id: "tile_floor", kind: "tile" },
  hallwayTiles: { id: "tile_hallway", kind: "tile" },
});
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
export const ATTACKER_SETUP_MODE_SET = new Set(ATTACKER_SETUP_MODES);
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
  attacker: Object.freeze({
    setupModes: ATTACKER_SETUP_MODES,
    defaultSetupMode: DEFAULT_ATTACKER_SETUP_MODE,
  }),
});

const LLM_PROMPT_SUFFIX_JSON_ONLY =
  "Final request: return the JSON now. Output JSON only (no markdown, no commentary).";
const LLM_PROMPT_SUFFIX_REPAIR_ONLY = "Final request: return corrected JSON only.";
export const LLM_REPAIR_TEXT = Object.freeze({
  phaseLayoutRequirement: "Provide layout tile counts with non-negative integers (floorTiles).",
  phaseRoomsRequirement: "Provide at least one room entry; each count must be >= 1.",
  phaseActorsRequirement: "Provide at least one actor entry; each count must be >= 1.",
  phaseRoomsAndActorsRequirement: "Provide at least one room and one actor; each count must be >= 1.",
  tokenHintRule: "tokenHint is per-actor (unit) and must be a positive integer if provided; otherwise omit it.",
  actorMobilityRule: "For non-stationary actors, set vitals.stamina.regen to an integer > 0.",
  exampleAffinityEntry: "Example affinity entry: {\"kind\":\"water\",\"expression\":\"push\",\"stacks\":1}",
  layoutIntegerRule: "Use integers only for floorTiles; omit optional fields.",
  layoutExample: "Example layout: {\"layout\":{\"floorTiles\":60}}",
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

function normalizeSectionLines(value) {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString).map((entry) => entry.trim());
  }
  if (isNonEmptyString(value)) {
    return [value.trim()];
  }
  return [];
}

function appendPromptSection(lines, title, value, { defaultLine = "", bullet = true } = {}) {
  const entries = normalizeSectionLines(value);
  if (entries.length === 0 && isNonEmptyString(defaultLine)) {
    entries.push(defaultLine.trim());
  }
  if (entries.length === 0) {
    lines.push(`${title}:`);
    lines.push("");
    return;
  }
  if (!bullet && entries.length === 1) {
    lines.push(`${title}: ${entries[0]}`);
    lines.push("");
    return;
  }
  lines.push(`${title}:`);
  entries.forEach((entry) => {
    lines.push(`- ${entry}`);
  });
  lines.push("");
}

function buildStructuredPrompt({
  role,
  goal,
  context,
  assumption,
  constraints,
  instructions,
  responseFormat,
  finalSuffix = LLM_PROMPT_SUFFIX_JSON_ONLY,
} = {}) {
  const lines = [];
  appendPromptSection(lines, "Role", role, { bullet: false, defaultLine: "Follow the requested contract exactly." });
  appendPromptSection(lines, "Goal", goal, { bullet: false, defaultLine: "Produce a valid JSON response." });
  appendPromptSection(lines, "Context", context, { defaultLine: "No additional context provided." });
  appendPromptSection(lines, "Assumption", assumption, { bullet: false, defaultLine: "No additional assumptions provided." });
  appendPromptSection(lines, "Constraints", constraints, { defaultLine: "No additional constraints provided." });
  appendPromptSection(lines, "Instructions", instructions, { defaultLine: "Return exactly one JSON object." });
  appendPromptSection(lines, "Response format", responseFormat, { defaultLine: "Output one JSON object with no surrounding text." });
  lines.push(finalSuffix);
  return lines.join("\n");
}

export function normalizeLayoutTileCosts(tileCosts = {}) {
  const normalized = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    normalized[field] = asPositiveInt(tileCosts[field], DEFAULT_LAYOUT_TILE_COSTS[field]);
  });
  return normalized;
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
  includeBudgetTokens = true,
  includeModelContextTokens = true,
} = {}) {
  const lines = [];
  if (isNonEmptyString(goal)) lines.push(`Scenario goal: ${goal}`);
  if (isNonEmptyString(notes)) lines.push(`Notes: ${notes}`);
  if (includeBudgetTokens && Number.isInteger(budgetTokens) && budgetTokens > 0) {
    lines.push(`Budget tokens: ${budgetTokens}`);
  }
  if (includeModelContextTokens && Number.isInteger(modelContextTokens) && modelContextTokens > 0) {
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
  finalSuffix = LLM_PROMPT_SUFFIX_JSON_ONLY,
} = {}) {
  const normalizedCosts = normalizeLayoutTileCosts(layoutCosts);
  const preamble = buildPromptPreamble({
    goal,
    notes,
    budgetTokens,
    modelContextTokens,
    includeBudgetTokens: false,
    includeModelContextTokens: false,
  });
  const contextLines = [
    ...preamble,
    "Levels are made up of rooms connected by hallways and populated with attackers and defenders.",
    "This phase focuses on creating rooms and laying them out. Attackers and defenders are configured in separate phases.",
  ];
  if (isNonEmptyString(context)) {
    contextLines.push(`Selected room affinities and descriptions: ${context}`);
  }
  const constraints = [];
  if (Number.isInteger(remainingBudgetTokens) && remainingBudgetTokens >= 0) {
    constraints.push(`Constraint: budget tokens available for room design: ${remainingBudgetTokens}.`);
  }
  const instructions = [
    "Phase: layout_only.",
    "Return layout tile counts and a room layout summary.",
    "Design for a clear level entry to level exit journey and keep routes meaningful.",
    "Entry and exit should be separated enough to require exploration.",
    "Create defensible chokepoints and key junctions for stationary defenders.",
    "Use inclusive room bounds: startX/startY and endX/endY are both part of the room footprint.",
    "Include a brief room design summary explaining room placement and strategic flow.",
    "Keep the response concise; allow more detail only when needed to describe room structure.",
  ];
  const responseFormat = [
    "Return exactly one JSON object with keys: remainingBudgetTokens, layout, roomDesign, missing, stop.",
    "stop must be one of: \"done\", \"missing\", \"no_viable_spend\".",
    "remainingBudgetTokens and layout.floorTiles must be integers >= 0.",
    "roomDesign.totalRooms and roomDesign.totalFloorTilesUsed must be integers > 0.",
    "roomDesign.rooms must be a non-empty array; each room must include id, startX, startY, endX, endY as integers.",
    "Optional room fields: affinity, size, width, height.",
    "If present, roomDesign.entryRoomId and roomDesign.exitRoomId must match ids in roomDesign.rooms.",
    "Example valid response: {\"remainingBudgetTokens\":4200,\"layout\":{\"floorTiles\":1300},\"roomDesign\":{\"totalRooms\":4,\"totalFloorTilesUsed\":1300,\"entryRoomId\":\"R1\",\"exitRoomId\":\"R4\",\"rooms\":[{\"id\":\"R1\",\"affinity\":\"water\",\"size\":\"medium\",\"startX\":2,\"startY\":3,\"endX\":18,\"endY\":16},{\"id\":\"R2\",\"affinity\":\"decay\",\"size\":\"small\",\"startX\":22,\"startY\":5,\"endX\":32,\"endY\":13},{\"id\":\"R3\",\"affinity\":\"corrode\",\"size\":\"large\",\"startX\":8,\"startY\":20,\"endX\":28,\"endY\":38},{\"id\":\"R4\",\"affinity\":\"decay\",\"size\":\"medium\",\"startX\":34,\"startY\":24,\"endX\":50,\"endY\":38}]},\"missing\":[],\"stop\":\"done\"}.",
    "Return exactly one JSON object, starting with { and ending with }, with no surrounding text.",
  ];
  return buildStructuredPrompt({
    role: "You are a dungeon level planner.",
    goal: "Plan the dungeon layout using rooms only.",
    context: contextLines,
    assumption: [`floor tiles cost ${normalizedCosts.floorTiles} tokens each.`],
    constraints,
    instructions,
    responseFormat,
    finalSuffix,
  });
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
  const preamble = buildPromptPreamble({
    goal,
    notes,
    budgetTokens: hasPhaseBudget ? undefined : budgetTokens,
    modelContextTokens,
    includeModelContextTokens: !hasPhaseBudget,
  });
  const contextLines = [
    ...preamble,
    "The level layout is already planned and must not be changed.",
    "Attackers start at level entry and try to reach a hidden level exit.",
    "Defenders must explore to locate likely exit routes, then hold them.",
  ];
  if (isNonEmptyString(context)) {
    contextLines.push(context);
  }
  const constraints = [
    hasPhaseBudget
      ? `Defender phase budget tokens: ${remainingBudgetTokens}.`
      : null,
    "Choose only from the allowed lists; do not invent new affinities, expressions, or motivations.",
    `Affinities: ${affinityMenu}.`,
    `Affinity expressions: ${expressionMenu}.`,
    `Motivations: ${motivationMenu}.`,
  ].filter(Boolean);
  if (isNonEmptyString(allowedPairsText)) {
    constraints.push(`Allowed defender profiles (motivation, affinity): ${allowedPairsText}.`);
  }
  const instructions = [
    "Phase: actors_only.",
    "Return defenders only; omit rooms and layout.",
    "Include at least one defender entry (count >= 1).",
    "Use valid JSON with double quotes only and no trailing commas.",
    "Spend as much of the remaining budget as possible while staying feasible.",
    "tokenHint is per defender unit; total base spend for an entry is tokenHint * count.",
    "Defender viability guardrails:",
    "If you include affinities or stacks, include vitals with mana > 0 and mana regen > 0.",
    "For non-stationary defenders, require stamina regen > 0.",
    "Stationary/trap-like defenders may use zero regen.",
    "Place stationary defenders at chokepoints (narrow halls, doors, key junctions).",
    "Ensure defenders have non-trivial health (current/max >= 6).",
    "Keep affinity stacks modest (1-3) unless mana and regen are higher.",
  ];
  const responseFormat = [
    "Return exactly one JSON object with keys: phase, remainingBudgetTokens, actors, missing, stop.",
    "phase must be \"actors_only\".",
    "stop must be one of: \"done\", \"missing\", \"no_viable_spend\".",
    "Each actor must include motivation, affinity, count, and may include tokenHint, affinities[], and vitals.",
    "If provided, tokenHint must be an integer > 0.",
    "Response shape: { \"phase\": \"actors_only\", \"remainingBudgetTokens\": <int>, \"actors\": [{\"motivation\": <motivation>, \"affinity\": <affinity>, \"count\": <int>, \"tokenHint\": <int?>, \"affinities\": [{\"kind\": <affinity>, \"expression\": <expression>, \"stacks\": <int?>}], \"vitals\": {\"health\": {\"current\": <int>, \"max\": <int>, \"regen\": <int>}, \"mana\": {\"current\": <int>, \"max\": <int>, \"regen\": <int>}, \"stamina\": {\"current\": <int>, \"max\": <int>, \"regen\": <int>}, \"durability\": {\"current\": <int>, \"max\": <int>, \"regen\": <int>}}}], \"missing\": [], \"stop\": \"done\" | \"missing\" | \"no_viable_spend\" }.",
  ];
  return buildStructuredPrompt({
    role: "You are a dungeon defender strategist.",
    goal: "Configure defender actors and affinity stacks only.",
    context: contextLines,
    assumption: [
      "The level topology already exists and cannot be modified in this phase.",
      "Stationary defenders may use zero stamina regen; ambulatory defenders require stamina regen > 0.",
    ],
    constraints,
    instructions,
    responseFormat,
    finalSuffix,
  });
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
  affinities,
  affinityExpressions,
  motivations,
  allowedPairsText,
  phaseRequirement,
  extraLines = [],
  finalSuffix = LLM_PROMPT_SUFFIX_REPAIR_ONLY,
} = {}) {
  const preview = String(responseText || "").slice(0, 4000);
  const affinityList = asList(affinities, []);
  const expressionList = asList(affinityExpressions, []);
  const motivationList = asList(motivations, []);
  return buildStructuredPrompt({
    role: "You are a JSON repair assistant.",
    goal: "Repair the previous response so it validates against the required schema.",
    context: [
      "Original prompt (must preserve intent):",
      String(basePrompt || "").slice(0, 4000),
      "Invalid response JSON preview:",
      preview,
    ],
    assumption: "Preserve semantic intent from the original prompt while fixing structure, typing, and schema compliance.",
    constraints: [
      `Validation errors: ${JSON.stringify(errors || [])}`,
      affinityList.length > 0 ? `Allowed affinities: ${affinityList.join(", ")}.` : null,
      expressionList.length > 0 ? `Allowed expressions: ${expressionList.join(", ")}.` : null,
      motivationList.length > 0 ? `Allowed motivations: ${motivationList.join(", ")}.` : null,
      allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
      phaseRequirement || null,
    ].filter(Boolean),
    instructions: [
      "Fix all schema and validation issues in a single pass.",
      "Return corrected JSON only.",
      ...asList(extraLines, []),
    ],
    responseFormat: [
      "Return exactly one corrected JSON object with no markdown and no commentary.",
      "Do not include explanations or additional text.",
    ],
    finalSuffix,
  });
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
  return buildStructuredPrompt({
    role: "You are a catalog-constrained JSON repair assistant.",
    goal: "Repair the previous response so every actor selection matches the pool catalog.",
    context: [
      "Original prompt (must preserve intent):",
      String(basePrompt || "").slice(0, 4000),
    ],
    assumption: "Catalog compliance is mandatory for all repaired actor selections.",
    constraints: [
      allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
      missingSelections ? `Unmatched picks from previous response: ${missingSelections}.` : null,
    ].filter(Boolean),
    instructions: [
      "Choose only from the allowed catalog profiles.",
      "Provide at least one actor entry with count >= 1.",
      "Return corrected JSON only.",
    ],
    responseFormat: [
      "Return exactly one corrected JSON object with no markdown and no commentary.",
    ],
    finalSuffix,
  });
}

export function buildBuildSpecPromptTemplate({ schema, schemaVersion } = {}) {
  return buildStructuredPrompt({
    role: "You are an agent that returns a single JSON object that conforms to the BuildSpec contract.",
    goal: "Produce a valid BuildSpec payload.",
    context: [`Target schema: "${schema}" version ${schemaVersion}.`],
    assumption: "If a value is unknown, omit optional fields instead of inventing data.",
    constraints: [
      "Required keys: schema, schemaVersion, meta (id, runId, createdAt, source), intent (goal).",
      "Include configurator.inputs.levelGen and configurator.inputs.actors so the UI can build a new layout.",
      "actorGroups must be an array of objects; actors and rooms must be arrays when provided.",
      "budget refs must be objects with id + schema + schemaVersion (or omit budget entirely).",
      "Keep values concise.",
    ],
    instructions: [
      "Output JSON only (no markdown fences, no commentary).",
      "Follow the BuildSpec contract exactly.",
    ],
    responseFormat: [
      "Return exactly one JSON object conforming to BuildSpec.",
    ],
    finalSuffix: "Final request: return the BuildSpec JSON now. Output JSON only (no markdown, no commentary).",
  });
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
