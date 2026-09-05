import {
  GAME_AFFINITY_EXPRESSIONS,
  GAME_AFFINITY_KINDS,
  GAME_MOTIVATION_DISPLAY_GROUPS,
  GAME_MOTIVATION_FAMILIES,
  GAME_MOTIVATION_KINDS,
  GAME_VITAL_KEYS,
} from "./game-elements.js";

export const AFFINITY_KINDS = GAME_AFFINITY_KINDS;
export const AFFINITY_EXPRESSIONS = GAME_AFFINITY_EXPRESSIONS;
export const AFFINITY_TARGET_TYPES = Object.freeze(["self", "ally", "enemy", "area", "barrier", "floor"]);
export const DEFAULT_DUNGEON_AFFINITY = AFFINITY_KINDS[0];
export const DEFAULT_AFFINITY_EXPRESSION = AFFINITY_EXPRESSIONS[0];
export const DEFAULT_ROOM_CARD_AFFINITY = "dark";
export const DEFAULT_ROOM_AFFINITY_EXPRESSION = "emit";
export const DEFAULT_ROOM_AFFINITY_STACKS = 2;
// DS.3 — `DARKNESS_OBSCURE_STACK_THRESHOLD`, `DARKNESS_OBSCURE_RADIUS` and
// `LIGHT_SIGHT_MIN_STACK` MOVED to `core-ts/src/state/visibility.ts`.
//
// They sat here from the commit that introduced them until 2026-08-20 and were
// read by nothing in any package, test, doc or script — a visibility design with
// no visibility behaviour behind it. DS.3 built the mechanism that consumes them,
// and that mechanism is core's, so the numbers had to move: core-ts must never
// import from runtime. Moved rather than aliased, so there is exactly one origin
// — a re-export here would leave two places to edit and one of them wrong.
//
// `DEFAULT_ROOM_AFFINITY_STACKS` above stays, and now interacts with them: a
// default room emits dark at exactly the obscure threshold, so it obscures sight
// to one tile. That is a deliberate, accepted consequence, pinned by a test in
// `tests/core-ts/visibility.test.mts`.
export const DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION = Object.freeze({
  push: "enemy",
  pull: "self",
  emit: "area",
  draw: "self",
});
export const DEFAULT_AFFINITY_TARGET_TYPE = DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[DEFAULT_AFFINITY_EXPRESSION];
export const AFFINITY_EXPRESSION_PROFILES = Object.freeze({
  push: Object.freeze({
    id: "push",
    tacticalRole: "burst",
    channel: "spatial",
    polarity: "outward",
    vitalOperation: "apply_vital_affinity",
    allowsEnvironmentMutation: true,
    allowsHazardArming: true,
  }),
  pull: Object.freeze({
    id: "pull",
    tacticalRole: "control",
    channel: "spatial",
    polarity: "inward",
    vitalOperation: "apply_vital_affinity",
    allowsEnvironmentMutation: true,
    allowsHazardArming: true,
  }),
  emit: Object.freeze({
    id: "emit",
    tacticalRole: "presence",
    channel: "field",
    polarity: "outward",
    vitalOperation: "apply_vital_affinity",
    allowsEnvironmentMutation: true,
    allowsHazardArming: true,
  }),
  draw: Object.freeze({
    id: "draw",
    tacticalRole: "sustain",
    channel: "field",
    polarity: "inward",
    vitalOperation: "draw_vital_affinity",
    allowsEnvironmentMutation: false,
    allowsHazardArming: false,
  }),
});
export const AFFINITY_OPPOSITES = Object.freeze({
  fire: "water",
  water: "fire",
  earth: "wind",
  wind: "earth",
  life: "decay",
  decay: "life",
  corrode: "fortify",
  fortify: "corrode",
  light: "dark",
  dark: "light",
});
export const ROOM_AFFINITY_EMIT_PERCENT_PER_STACK = 10;
export const DELVER_SETUP_MODES = Object.freeze(["auto", "user", "hybrid"]);
export const DEFAULT_DELVER_SETUP_MODE = DELVER_SETUP_MODES[0];

// ── Motivation vocabulary (P5.1 D1: promoted out of personas/) ──────────────
// These are the runtime-facing names for the game-elements motivation registry,
// exactly as AFFINITY_KINDS is for GAME_AFFINITY_KINDS above.
//
// They previously lived in personas/configurator/motivation-loadouts.js, which
// created a three-hop alias chain — GAME_MOTIVATION_KINDS -> MOTIVATION_KINDS
// (Configurator) -> ALLOWED_MOTIVATIONS (Orchestrator prompt-contract) -> glue —
// so one value wore three names across two personas and every consumer outside
// the Configurator had to reach into it. Neither persona added anything; the
// boundary crossings existed purely because of the renaming.
export const MOTIVATION_KINDS = GAME_MOTIVATION_KINDS;
export const MOTIVATION_DISPLAY_GROUPS = GAME_MOTIVATION_DISPLAY_GROUPS;
export const MOTIVATION_FAMILIES = GAME_MOTIVATION_FAMILIES;

// Mutual exclusivity is a DERIVED property of the vocabulary: pick two kinds from
// one family and they conflict. `control` (user_controlled) is deliberately absent
// — it coexists with any other kind, which is what lets delver cards carry it as a
// synthetic extra tag.
export const MOTIVATION_EXCLUSIVE_GROUPS = Object.freeze([
  Object.freeze({ id: "mobility", kinds: MOTIVATION_FAMILIES.mobility }),
  Object.freeze({ id: "posture", kinds: MOTIVATION_FAMILIES.posture }),
  Object.freeze({ id: "cognition", kinds: MOTIVATION_FAMILIES.cognition }),
]);

const MOTIVATION_EXCLUSIVE_GROUP_BY_KIND = Object.freeze(
  MOTIVATION_EXCLUSIVE_GROUPS.reduce((acc, group) => {
    group.kinds.forEach((kind) => {
      acc[kind] = group;
    });
    return acc;
  }, {}),
);

/** Canonicalize one motivation kind, or null if it is not in the vocabulary. */
export function normalizeMotivationKind(raw) {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (MOTIVATION_KINDS.includes(normalized)) return normalized;
  return null;
}

export function getMotivationExclusiveGroup(kind) {
  const normalized = normalizeMotivationKind(kind);
  if (!normalized) return null;
  return MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[normalized] || null;
}

/** The kinds that cannot coexist with `kind` (its family, minus itself). */
export function getConflictingMotivationKinds(kind) {
  const normalized = normalizeMotivationKind(kind);
  if (!normalized) return [];
  const group = MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[normalized];
  if (!group) return [];
  return group.kinds.filter((entry) => entry !== normalized);
}

/**
 * Best-effort coercion of user-ish input into a clean motivation-kind list:
 * canonicalize, drop unknown kinds, dedupe, first-wins on an intra-family
 * conflict, and apply `fallback` if nothing survives.
 *
 * **This is the SALVAGING form — it never reports why anything was dropped.**
 * It exists because that is what all three cross-boundary callers were already
 * doing: card-authoring, director/summary-selections and ui-web/actor-inspector
 * each called the Configurator's `normalizeMotivationKindList` and used only
 * `.value`, discarding `ok`/`errors`/`warnings` (P5.1 D2, decision D-n). Ingesting
 * loose input is not a persona decision, so it lives here.
 *
 * The REJECTING form — structured errors for a caller that should refuse invalid
 * input — stays with the Configurator as `normalizeMotivationKindList`, because
 * "is this configuration valid?" is that persona's chartered call.
 * `tests/personas/configurator/configurator-motivation-coercion-agreement.test.js` pins the two forms to the
 * same `value` so this split cannot become another "two codebooks, one concept".
 */
export function coerceMotivationKinds(input, { fallback = "", allowEmpty = false } = {}) {
  if (input === undefined) {
    const fallbackKind = normalizeMotivationKind(fallback);
    return allowEmpty || !fallbackKind ? [] : [fallbackKind];
  }

  const list = Array.isArray(input) ? input : typeof input === "string" ? [input] : null;
  if (!list) return [];

  const value = [];
  const seen = new Set();
  const selectedGroupKinds = new Map();
  for (const entry of list) {
    const kind = normalizeMotivationKind(entry);
    if (!kind) continue;
    if (seen.has(kind)) continue;
    const group = MOTIVATION_EXCLUSIVE_GROUP_BY_KIND[kind];
    if (group) {
      const selectedKind = selectedGroupKinds.get(group.id);
      if (selectedKind && selectedKind !== kind) continue;
      selectedGroupKinds.set(group.id, kind);
    }
    seen.add(kind);
    value.push(kind);
  }

  if (value.length === 0 && !allowEmpty) {
    const fallbackKind = normalizeMotivationKind(fallback);
    if (fallbackKind) value.push(fallbackKind);
  }

  return value;
}

// Motivation kind -> core-ts code (1-based); the reverse of core-ts's
// MOTIVATION_KIND_BY_CODE. Moved from personas/allocator/motivation-price-policy.js,
// whose own comment already said "this is codebook data … not pricing" — it had
// no business in the Allocator, and the Configurator had to cross a persona
// boundary to read it.
export const MOTIVATION_KIND_TO_CODE = Object.freeze(
  GAME_MOTIVATION_KINDS.reduce((acc, kind, index) => {
    acc[kind] = index + 1;
    return acc;
  }, {}),
);

// ── Card vocabulary (P5.1 D1: promoted out of personas/configurator/) ───────
// Type/size identifiers and their normalizers. The SIZE->LAYOUT table
// (roomFloorTiles/roomMinSize/…) deliberately stays in the Configurator: those
// are level-geometry decisions, not vocabulary.
export const CARD_TYPE_IDS = Object.freeze(["room", "delver", "warden", "hazard", "resource"]);
export const ROOM_CARD_SIZE_IDS = Object.freeze(["small", "medium", "large"]);
export const DEFAULT_ROOM_CARD_SIZE = "medium";

/**
 * Coerce a value to a positive integer, accepting numeric strings.
 *
 * Moved verbatim from card-model.js. **NOT interchangeable with this module's
 * private `asPositiveInt()`**, which rejects numeric STRINGS outright
 * (`Number.isFinite("3")` is false). Card counts and grid dimensions arrive from
 * CLI text, so the coercing form is required — swapping them would silently make
 * every string-valued count fall back to its default.
 */
export function coercePositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

/** Canonicalize a card type to a domain term ("attacker" -> "delver"). */
export function normalizeCardType(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "attacker") return "delver";
  if (normalized === "defender") return "warden";
  return CARD_TYPE_IDS.includes(normalized) ? normalized : "";
}

/**
 * DS.1 — which side is this actor on, read from its CONFIGURED record.
 *
 * Shared vocabulary, deliberately not persona-owned: the Actor consumes it to
 * decide hostility, the runtime uses it to enrich the observation, and neither
 * of them should own what "delver" means — that is what this module is for
 * (same reasoning as decision D8-V, which moved the pool catalog here).
 *
 * ⚠️ **Reads `role` OR `archetype`, because production data only has the
 * latter.** `role` appears in `contracts/artifacts.ts` solely on BUILD-SPEC
 * HINT types; a generated `initialState` actor carries `archetype: "delver"`.
 * Hand-authored test fixtures often set both. Checking only one field would
 * work in the fixtures and silently fail in every real run — which is exactly
 * how DS.2's rule came to be correct and unreachable at the same time.
 *
 * Returns `""` when no faction can be determined. Callers must treat that as
 * UNKNOWN, never as a faction — see `rolesAreAllied` in the Actor controller,
 * where unknown deliberately means "still hostile" rather than "allied".
 */
export function resolveActorFaction(configuredActor) {
  if (!configuredActor || typeof configuredActor !== "object") return "";
  for (const candidate of [configuredActor.role, configuredActor.archetype]) {
    // normalizeCardType also folds the "attacker"/"defender" synonyms, so those
    // resolve here without this function restating the mapping.
    const normalized = normalizeCardType(candidate);
    if (normalized === "delver" || normalized === "warden") return normalized;
  }
  return "";
}

export function normalizeRoomCardSize(value) {
  if (typeof value !== "string") return DEFAULT_ROOM_CARD_SIZE;
  const normalized = value.trim().toLowerCase();
  return ROOM_CARD_SIZE_IDS.includes(normalized) ? normalized : DEFAULT_ROOM_CARD_SIZE;
}

export function normalizeCardCount(value, fallback = 1) {
  return coercePositiveInt(value, fallback);
}
export const DEFAULT_LLM_MODEL = "phi4";
export const DEFAULT_LLM_BASE_URL = "http://localhost:11434";
export const DEFAULT_LLM_CONTEXT_WINDOW_TOKENS = 256000;
export const LAYOUT_TILE_FIELDS = Object.freeze(["floorTiles", "hallwayTiles"]);
/**
 * CR.1's LAST CENSUS ENTRY, closed 2026-08-05 by DELETION rather than by retune.
 *
 * `DEFAULT_LAYOUT_TILE_COSTS` used to sit here — floor 1, hallway 1 — beside
 * `base-costs.json`'s floor 1, hallway 3. Two codebooks for one price, disagreeing, with
 * nothing able to notice: the divergence never reached the build path, so goldens held
 * and the suite stayed green. Aligning the numbers would have left the second origin in
 * place to diverge again on the next edit, so the constant is gone. Tile prices come from
 * the Allocator's PriceList and their absence raises `allocator_tile_price_required`
 * (`personas/allocator/layout-spend.js`). The charter's rule is literal here: "an
 * incomplete price list is a structured error, never a quiet default."
 *
 * What stays in contracts is VOCABULARY, not economy: which tile fields exist, and which
 * price id each maps to. That is the same line P5.1 D1 drew for card types and sizes.
 */
export const LAYOUT_TILE_PRICE_IDS = Object.freeze({
  floorTiles: { id: "tile_floor", kind: "tile" },
  hallwayTiles: { id: "tile_hallway", kind: "tile" },
});

/**
 * Layout tile COUNTS — the lenient reader, relocated 2026-08-08 (D8-V).
 *
 * ⚠️ MOVED from `personas/allocator/layout-spend.js` by maintainer decision: counting
 * tiles is shared vocabulary, not the Allocator's. It normalizes and counts; it **prices
 * nothing**. `normalizeLayoutTileCosts` (prices, below) is its sibling and always lived
 * here — the counts sitting one directory deeper inside a persona was the anomaly.
 *
 * 🔴 THIS IS NOT THE ONLY `normalizeLayoutCounts` IN THE TREE, AND THE OTHERS ARE NOT
 * EQUIVALENT. Two personas carry private copies under the same name, and they behave
 * differently on every interesting input:
 *
 * | | this (was allocator) | `prompt-contract.js#normalizeLayoutCountsStrict` | `feasibility.js#normalizeLayoutCountsOrZero` |
 * |---|---|---|---|
 * | missing field | `0` | **omitted from the result** | `0` |
 * | numeric string `"5"` | **coerced to 5** | rejected | rejected |
 * | bad value | warn, then `0` | error, field **omitted** | error, then `0` |
 * | bad layout | warn, `null` | `invalid_layout`, `undefined` | `missing_layout`, `null` |
 * | diagnostics | `warnings` | `errors` | `errors` |
 *
 * They were **deliberately not merged** in D8-V: collapsing them changes prompt text and
 * feasibility verdicts, which is benchmark-relevant, and a relocation that also changes
 * behavior is the one shape this branch has repeatedly failed to unpick afterwards. The
 * other two were RENAMED instead, so nothing can mistake them for this, and
 * `single-origin.test.js` now fails if the bare name reappears under `personas/`.
 * ⇒ *Three functions with one name is a single-origin violation that no vocabulary guard
 * could see, because none of them declared a vocabulary.*
 */
function normalizeTileCount(value, field, warnings) {
  if (value === undefined) return 0;
  let parsed = value;
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      parsed = numeric;
    }
  }
  if (!Number.isInteger(parsed) || parsed < 0) {
    if (warnings) warnings.push({ code: "invalid_tile_count", field, value });
    return 0;
  }
  return parsed;
}

export function normalizeLayoutCounts(layout, warnings) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    if (warnings) warnings.push({ code: "invalid_layout" });
    return null;
  }
  const counts = {};
  LAYOUT_TILE_FIELDS.forEach((field) => {
    counts[field] = normalizeTileCount(layout[field], field, warnings);
  });
  return counts;
}

/**
 * Walkable tiles, which today means floor tiles only.
 *
 * ⚠️ The name over-promises and the body is the contract: hallway tiles are walkable and
 * are CHARGED (CR.9 M5 deleted the filter that made them free), but they are deliberately
 * not counted here — the auto-fit search and the budget loop both use this as "how much
 * room area is there", and connectors are not room area. Left exactly as it behaved inside
 * the Allocator; D8-V was a relocation, not a redefinition.
 */
export function sumLayoutTiles(layout) {
  if (!layout) return 0;
  return layout.floorTiles || 0;
}
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

export const VITAL_KEYS = GAME_VITAL_KEYS;

// Per-actor-type vital constraints
export const HAZARD_VITAL_KEYS = Object.freeze(["mana", "durability"]);
export const ROOM_TILE_VITAL_KEYS = Object.freeze(["durability"]);
export const DELVER_VITAL_KEYS = VITAL_KEYS;
export const WARDEN_VITAL_KEYS = VITAL_KEYS;
export const RESOURCE_VITAL_KEYS = Object.freeze(["health", "mana", "stamina"]);

// Resource permanence modes
export const RESOURCE_PERMANENCE_MODES = Object.freeze(["consumable", "level", "permanent"]);

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
export const AFFINITY_TARGET_TYPE_SET = new Set(AFFINITY_TARGET_TYPES);
export const DELVER_SETUP_MODE_SET = new Set(DELVER_SETUP_MODES);

export function normalizeAffinityExpression(rawExpression, fallback = DEFAULT_AFFINITY_EXPRESSION) {
  if (AFFINITY_EXPRESSION_SET.has(rawExpression)) {
    return rawExpression;
  }
  return fallback;
}

export function resolveAffinityExpressionProfile(rawExpression, fallback = DEFAULT_AFFINITY_EXPRESSION) {
  const expression = normalizeAffinityExpression(rawExpression, fallback);
  return AFFINITY_EXPRESSION_PROFILES[expression] || AFFINITY_EXPRESSION_PROFILES[fallback];
}
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
  delver: Object.freeze({
    setupModes: DELVER_SETUP_MODES,
    defaultSetupMode: DEFAULT_DELVER_SETUP_MODE,
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

/**
 * The least an actor can be and still be worth simulating.
 *
 * DEFAULT_VITALS above is a ZERO, not a floor: health 1 with regen 0 dies to a single point of
 * damage and never comes back, and the budget-minimum path deliberately authored exactly that
 * because it was the cheapest thing that passed. Benchmark scenario 92 has the model writing
 * `{durability:{max:1},health:{max:1},mana:{max:1},stamina:{max:1}}` on purpose.
 *
 * Stamina is absent on purpose. Its floor is not a constant -- it is derived from the worst-case
 * move cost of the actor's own motivation (applyMovementStaminaFloor), and a fixed number here
 * would either undercut a fast actor or overcharge a stationary one.
 *
 * regen 1 rather than 0 is the cheapest non-zero point on a QUADRATIC curve: n regen costs n*n per
 * vital, so 1 costs 3 tokens across the three vitals here and 3 would cost 27. It buys "recovers
 * eventually" and leaves real recovery to resources, which are placed in the level and walked to.
 */
export const ACTOR_VIABILITY_FLOOR = Object.freeze({
  health: Object.freeze({ max: 10, regen: 1 }),
  mana: Object.freeze({ max: 10, regen: 1 }),
  durability: Object.freeze({ max: 10, regen: 1 }),
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

/**
 * Tile prices for prompt text, or `null` when the caller has none to state.
 *
 * CR.9 M5: this used to complete a partial `tileCosts` from `DEFAULT_LAYOUT_TILE_COSTS`,
 * so a caller that passed nothing still got a prompt asserting "floor tiles cost 1 tokens
 * each" on no authority at all. In prompt text a wrong price does not fail — it becomes
 * wrong content, and the model spends against a number the Allocator never set.
 *
 * Returning `null` rather than throwing is deliberate. A missing price here is not a
 * caller bug (several prompt paths legitimately have no PriceList in hand); it is simply
 * nothing to say, and the template omits the line. Production threads the real prices from
 * `resolveLayoutTileCosts(priceList)`, so the omission is a fallback, not the norm.
 */
export function normalizeLayoutTileCosts(tileCosts) {
  if (!tileCosts || typeof tileCosts !== "object") return null;
  const normalized = {};
  for (const field of LAYOUT_TILE_FIELDS) {
    const value = asPositiveInt(tileCosts[field], 0);
    if (value <= 0) return null;
    normalized[field] = value;
  }
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
    "Levels are made up of rooms connected by hallways and populated with delvers and wardens.",
    "This phase focuses on creating rooms and laying them out. Delvers and wardens are configured in separate phases.",
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
    "Create defensible chokepoints and key junctions for stationary wardens.",
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
    "Example valid response: {\"remainingBudgetTokens\":4200,\"layout\":{\"floorTiles\":1300},\"roomDesign\":{\"totalRooms\":4,\"totalFloorTilesUsed\":1300,\"entryRoomId\":\"R1\",\"exitRoomId\":\"R4\",\"rooms\":[{\"id\":\"R1\",\"affinity\":\"water\",\"size\":\"medium\",\"startX\":2,\"startY\":3,\"endX\":18,\"endY\":16},{\"id\":\"R2\",\"affinity\":\"decay\",\"size\":\"small\",\"startX\":22,\"startY\":5,\"endX\":32,\"endY\":13},{\"id\":\"R3\",\"affinity\":\"light\",\"size\":\"large\",\"startX\":8,\"startY\":20,\"endX\":28,\"endY\":38},{\"id\":\"R4\",\"affinity\":\"decay\",\"size\":\"medium\",\"startX\":34,\"startY\":24,\"endX\":50,\"endY\":38}]},\"missing\":[],\"stop\":\"done\"}.",
    "Return exactly one JSON object, starting with { and ending with }, with no surrounding text.",
  ];
  return buildStructuredPrompt({
    role: "You are a dungeon level planner.",
    goal: "Plan the dungeon layout using rooms only.",
    context: contextLines,
    // Stated only when the caller supplied real prices. The wording is unchanged from
    // before CR.9 M5 on purpose: prompt text is the benchmark surface, and this milestone
    // is about where the number COMES FROM, not about telling the model something new.
    assumption: normalizedCosts
      ? [`floor tiles cost ${normalizedCosts.floorTiles} tokens each.`]
      : [],
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
    "Delvers start at level entry and try to reach a hidden level exit.",
    "Wardens must explore to locate likely exit routes, then hold them.",
    "Fog-of-war semantics: light affinity extends sight and discovery range.",
    "Fog-of-war semantics: dark affinity supports self-obscuration and blinding pressure.",
    "Durability semantics: corrode pressure reduces durability.",
    "Durability semantics: fortify reinforces any target that has durability.",
  ];
  if (isNonEmptyString(context)) {
    contextLines.push(context);
  }
  const constraints = [
    hasPhaseBudget
      ? `Warden phase budget tokens: ${remainingBudgetTokens}.`
      : null,
    "Choose only from the allowed lists; do not invent new affinities, expressions, or motivations.",
    `Affinities: ${affinityMenu}.`,
    `Affinity expressions: ${expressionMenu}.`,
    `Motivations: ${motivationMenu}.`,
  ].filter(Boolean);
  if (isNonEmptyString(allowedPairsText)) {
    constraints.push(`Allowed warden profiles (motivation, affinity): ${allowedPairsText}.`);
  }
  const instructions = [
    "Phase: actors_only.",
    "Return wardens only; omit rooms and layout.",
    "Include at least one warden entry (count >= 1).",
    "Use valid JSON with double quotes only and no trailing commas.",
    "Spend as much of the remaining budget as possible while staying feasible.",
    "tokenHint is per warden unit; total base spend for an entry is tokenHint * count.",
    "Warden viability guardrails:",
    "If you include affinities or stacks, include vitals with mana > 0 and mana regen > 0.",
    "For non-stationary wardens, require stamina regen > 0.",
    "Stationary/hazard-like wardens may use zero regen.",
    "Place stationary wardens at chokepoints (narrow halls, doors, key junctions).",
    "Ensure wardens have non-trivial health (current/max >= 6).",
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
    role: "You are a dungeon warden strategist.",
    goal: "Configure warden actors and affinity stacks only.",
    context: contextLines,
    assumption: [
      "The level topology already exists and cannot be modified in this phase.",
      "Stationary wardens may use zero stamina regen; ambulatory wardens require stamina regen > 0.",
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

export const EXPRESSION_SPATIAL_DEFAULTS = Object.freeze({
  push: { buffer: 0, baseRadius: 0.5 },
  pull: { buffer: 0, baseRadius: 0.5 },
  emit: { buffer: 1, baseRadius: 1.0 },
  draw: { buffer: 0, baseRadius: 1.0 },
});
