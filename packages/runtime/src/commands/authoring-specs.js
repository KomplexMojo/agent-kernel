/**
 * The authoring grammar and request assembly behind `ak create` and `ak configure`: the
 * `--room` / `--delver` / `--warden` / `--hazard` / `--resource` / `--floor-tile` spec
 * tokenizers, budget resolution, and the summary and request the authoring build takes.
 *
 * Moved out of the CLI adapter (#557) so a browser builds a level from the same arguments by
 * the same code. It decides nothing a persona owns: defaulting, enums and candidates are the
 * Configurator's, tactics the Director's, prices and grades the Allocator's. Its only IO is
 * the host's: `makeId` for an unnamed run and `readStrategyFile` for `strategy=<file.json>`.
 * Everything else (reading budget files, drawing a seed, an LLM tactic plan, the clock) is
 * passed to `prepareAuthoringBuild` by its caller.
 */
import {
  AFFINITY_KINDS as ALLOWED_AFFINITIES,
  AFFINITY_EXPRESSIONS as ALLOWED_AFFINITY_EXPRESSIONS,
  MOTIVATION_KINDS as ALLOWED_MOTIVATIONS,
  DEFAULT_DUNGEON_AFFINITY,
  HAZARD_VITAL_KEYS,
  ROOM_CARD_SIZE_IDS,
  VITAL_KEYS,
} from "../contracts/domain-constants.js";
import { AGENT_COMMAND_REQUEST_SCHEMA, BUDGET_ARTIFACT_SCHEMA, PRICE_LIST_SCHEMA } from "../contracts/artifacts.ts";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createDirectorPersona } from "../personas/director/persona.js";

/** The `ak` argument grammar: `--key value`, `--key=value`, bare `--flag`; repeatable keys collect. */
export function parseArgs(argv) {
  const args = { _: [] };
  const repeatable = new Set([
    "actor",
    "delver",
    "warden",
    "vital",
    "vital-default",
    "tile-wall",
    "tile-barrier",
    "tile-floor",
    "budget-pool",
    "room",
    "floor-tile",
    "hazard",
    "hazard",
    "resource",
    "place",
    "tactic",
    "file",
  ]);
  function pushArg(key, value) {
    if (!repeatable.has(key)) {
      args[key] = value;
      return;
    }
    if (args[key] === undefined) {
      args[key] = value;
      return;
    }
    if (Array.isArray(args[key])) {
      args[key].push(value);
      return;
    }
    args[key] = [args[key], value];
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        pushArg(key, arg.slice(eqIndex + 1));
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        pushArg(key, next);
        i += 1;
      } else {
        pushArg(key, true);
      }
      continue;
    }
    args._.push(arg);
  }
  return args;
}

const NO_STRATEGY_FILES = (path) => {
  throw new Error(`strategy files cannot be read here (${path}); give the strategy inline.`);
};

export function createAuthoringSpecs({ makeId, readStrategyFile = NO_STRATEGY_FILES } = {}) {
  const AUTHORING_GOAL_PRIORITIES = new Set(["low", "medium", "high"]);

  function normalizeList(value) {
    if (value === undefined || value === null) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  function normalizeAuthoringToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  function buildOptimizationGoal({ kind, scope, priority = "high", vital, source } = {}) {
    const goal = { kind, scope, priority };
    if (vital) goal.vital = vital;
    if (source) goal.source = source;
    return goal;
  }

  function parseOptimizationPriority(value, label) {
    const normalized = normalizeAuthoringToken(value);
    if (AUTHORING_GOAL_PRIORITIES.has(normalized)) {
      return normalized;
    }
    throw new Error(`${label} priority must be one of: ${Array.from(AUTHORING_GOAL_PRIORITIES).join(", ")}.`);
  }

  function parseOptimizationGoalEntry(value, { label, defaultScope, source = "object_flag" } = {}) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`${label} goal must be non-empty.`);
    }

    let goalId = raw;
    let priority = "high";
    const segments = raw.split(":").map((part) => part.trim()).filter(Boolean);
    if (segments.length === 2 && AUTHORING_GOAL_PRIORITIES.has(normalizeAuthoringToken(segments[1]))) {
      [goalId] = segments;
      priority = parseOptimizationPriority(segments[1], `${label} goal "${raw}"`);
    } else if (segments.length > 2) {
      throw new Error(`${label} goal "${raw}" is invalid.`);
    }

    const normalized = normalizeAuthoringToken(goalId);
    switch (normalized) {
      case "maximize_budget_spend":
      case "maximize_spend":
      case "max_spend":
      case "full_budget":
        return buildOptimizationGoal({
          kind: "maximize_budget_spend",
          scope: "shared_config",
          priority,
          source,
        });
      case "maximize_vital_max":
      case "max_mana":
      case "mana_max":
      case "high_max_mana":
      case "high_mana_max":
        return buildOptimizationGoal({
          kind: "maximize_vital_max",
          scope: defaultScope,
          priority,
          vital: "mana",
          source,
        });
      case "maximize_vital_regen":
      case "mana_regen":
      case "high_mana_regen":
      case "max_mana_regen":
        return buildOptimizationGoal({
          kind: "maximize_vital_regen",
          scope: defaultScope,
          priority,
          vital: "mana",
          source,
        });
      default:
        throw new Error(`${label} goal "${raw}" is not supported. Use max_mana[:priority], mana_regen[:priority], or maximize_spend[:priority].`);
    }
  }

  function parseOptimizationGoalList(value, { label, defaultScope, source = "object_flag" } = {}) {
    if (!isNonEmptyString(value)) {
      return [];
    }
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => parseOptimizationGoalEntry(entry, {
        label: `${label}[${index + 1}]`,
        defaultScope,
        source,
      }));
  }

  function dedupeOptimizationGoals(goals) {
    const deduped = new Map();
    normalizeList(goals)
      .flat()
      .filter(Boolean)
      .forEach((goal) => {
        const key = [goal.kind, goal.scope, goal.vital || "", goal.priority || "high"].join(":");
        const existing = deduped.get(key);
        if (!existing || (!existing.source && goal.source)) {
          deduped.set(key, goal);
        }
      });
    return Array.from(deduped.values());
  }

  function extractBudgetTokensFromText(text, label = "freeform text") {
    if (!isNonEmptyString(text)) {
      return undefined;
    }
    const matches = [];
    const patterns = [
      /\b(?:total\s+)?budget\s+(?:of\s+)?(\d+)\s+tokens?\b/gi,
      /\b(\d+)\s+tokens?\s+budget\b/gi,
      /\bcap(?:ped)?\s+(?:at|to)\s+(\d+)\s+tokens?\b/gi,
    ];
    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        matches.push(Number.parseInt(match[1], 10));
      }
    });
    const unique = Array.from(new Set(matches));
    if (unique.length > 1) {
      throw new Error(`${label} contains conflicting budget directives: ${unique.join(", ")}.`);
    }
    return unique[0];
  }

  function textIncludesMaximizeSpend(text) {
    if (!isNonEmptyString(text)) {
      return false;
    }
    const normalized = text.toLowerCase();
    return /\bmaximize\s+(?:valid\s+)?spend\b/.test(normalized)
      || /\bspend as much as possible\b/.test(normalized)
      || /\buse the full budget\b/.test(normalized)
      || /\bmaximize\s+budget\b/.test(normalized);
  }

  function textMentionsVitalGoals(text) {
    if (!isNonEmptyString(text)) {
      return false;
    }
    const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
    return /\b(?:high|higher|maximi[sz]e)\s+(?:max\s+mana|mana\s+max)\b/.test(normalized)
      || /\b(?:high|higher|maximi[sz]e)\s+mana\s+regen\b/.test(normalized);
  }

  function extractVitalOptimizationGoalsFromText(text, { scope } = {}) {
    if (!isNonEmptyString(text) || !scope) {
      return [];
    }
    const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
    const goals = [];
    if (/\b(?:high|higher|maximi[sz]e)\s+(?:max\s+mana|mana\s+max)\b/.test(normalized)) {
      goals.push(buildOptimizationGoal({
        kind: "maximize_vital_max",
        scope,
        priority: "high",
        vital: "mana",
        source: "text",
      }));
    }
    if (/\b(?:high|higher|maximi[sz]e)\s+mana\s+regen\b/.test(normalized)) {
      goals.push(buildOptimizationGoal({
        kind: "maximize_vital_regen",
        scope,
        priority: "high",
        vital: "mana",
        source: "text",
      }));
    }
    return dedupeOptimizationGoals(goals);
  }

  function resolveTextVitalOptimizationGoals({ commandName, text, scope } = {}) {
    if (!textMentionsVitalGoals(text)) {
      return [];
    }
    if (!scope) {
      throw new Error(`${commandName} freeform text mentions vitals goals, but they must target exactly one authored actor kind. Use delver goals=... or keep the request to a single actor kind.`);
    }
    return extractVitalOptimizationGoalsFromText(text, { scope });
  }

  function resolveAuthoringBudget({
    commandName,
    textBudgetTokens,
    flagBudgetTokens,
    budgetArtifact,
  } = {}) {
    const budgetArtifactTokens = Number.isInteger(budgetArtifact?.budget?.tokens)
      ? budgetArtifact.budget.tokens
      : undefined;
    const inputs = [];
    if (Number.isInteger(textBudgetTokens)) inputs.push({ source: "text", totalTokens: textBudgetTokens });
    if (Number.isInteger(flagBudgetTokens)) inputs.push({ source: "flag", totalTokens: flagBudgetTokens });
    if (Number.isInteger(budgetArtifactTokens)) inputs.push({ source: "budget_artifact", totalTokens: budgetArtifactTokens });

    const distinct = Array.from(new Set(inputs.map((entry) => entry.totalTokens)));
    if (distinct.length > 1) {
      const detail = inputs.map((entry) => `${entry.source}=${entry.totalTokens}`).join(", ");
      throw new Error(`${commandName} hard budget inputs disagree: ${detail}. Freeform text, --budget-tokens, and budget artifact tokens must agree.`);
    }

    // No budget given: the Allocator's reference budget applies (#274). An input picks a
    // default, never skips the Allocator.
    if (inputs.length === 0) {
      inputs.push({ source: "allocator_default", totalTokens: allocatorWithGeometry().pricing.levelAuthoring().referenceBudgetTokens });
    }

    return {
      resolvedBudgetTokens: inputs[0].totalTokens,
      // The budget the caller named, if any. The reference default caps a plan but is not a
      // budget to fill: maximizing toward it would inflate every unbudgeted plan.
      requestedBudgetTokens: inputs[0].source === "allocator_default" ? undefined : inputs[0].totalTokens,
      constraints: {
        hardBudget: {
          totalTokens: inputs[0].totalTokens,
          sources: Array.from(new Set(inputs.map((entry) => entry.source))),
        },
      },
    };
  }

  function buildSharedOptimizationGoals({ text, hardBudgetConstraint } = {}) {
    if (!textIncludesMaximizeSpend(text)) {
      return [];
    }
    return dedupeOptimizationGoals([
      buildOptimizationGoal({
        kind: "maximize_budget_spend",
        scope: "shared_config",
        priority: "high",
        source: "text",
      }),
    ]);
  }

  function buildAuthoringSection({
    objectKinds,
    request,
    constraints,
    sharedOptimizationGoals = [],
    objectOptimizationGoals = [],
  } = {}) {
    const normalizedKinds = Array.from(new Set(normalizeList(objectKinds).filter(Boolean)));
    const aggregatedGoals = dedupeOptimizationGoals([
      ...sharedOptimizationGoals,
      ...objectOptimizationGoals,
    ]);
    if ((constraints || sharedOptimizationGoals.length > 0) && !normalizedKinds.includes("shared_config")) {
      normalizedKinds.push("shared_config");
    }

    if (!request && !constraints && aggregatedGoals.length === 0) {
      return undefined;
    }

    const authoring = {
      objectKinds: normalizedKinds,
    };
    if (request) {
      authoring.request = request;
    }
    if (constraints) {
      authoring.constraints = constraints;
    }
    if (aggregatedGoals.length > 0) {
      authoring.optimizationGoals = aggregatedGoals;
    }
    return authoring;
  }

  function parsePositiveIntStrict(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
  }

  function parseNonNegativeIntStrict(value, label) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    return parsed;
  }

  function parseActorAffinityTuple(value, actorType, actorIndex, affinityIndex) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] is empty.`);
    }
    const parts = raw.split(":").map((part) => part.trim()).filter((part) => part.length > 0);
    if (parts.length === 0 || parts.length > 4) {
      throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] must be kind[:expression[:range[:intensity]]].`);
    }

    const kind = parts[0].toLowerCase();
    if (!ALLOWED_AFFINITIES.includes(kind)) {
      throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] has invalid affinity kind "${parts[0]}".`);
    }

    const expression = (parts[1] || "emit").toLowerCase();
    if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
      throw new Error(`${actorType}[${actorIndex}] affinity[${affinityIndex}] has invalid affinity expression "${parts[1]}".`);
    }

    const stacks = parts[2] === undefined
      ? 1
      : parsePositiveIntStrict(parts[2], `${actorType}[${actorIndex}] affinity[${affinityIndex}] range`);
    // #340: the fourth part is intensity; omitted, the entry carries none and reads as 1.
    if (parts[3] === undefined) return { kind, expression, stacks };
    const intensity = parsePositiveIntStrict(parts[3], `${actorType}[${actorIndex}] affinity[${affinityIndex}] intensity`);
    return { kind, expression, stacks, intensity };
  }

  function parseActorAffinities(value, actorType, actorIndex) {
    if (!isNonEmptyString(value)) {
      return null;
    }
    const entries = String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      return null;
    }
    const merged = new Map();
    entries.forEach((entry, index) => {
      const tuple = parseActorAffinityTuple(entry, actorType, actorIndex, index + 1);
      const key = `${tuple.kind}:${tuple.expression}`;
      const existing = merged.get(key);
      if (existing) {
        existing.stacks += tuple.stacks;
        // Range adds up; the stronger intensity is kept.
        const intensity = Math.max(existing.intensity ?? 1, tuple.intensity ?? 1);
        if (intensity > 1) existing.intensity = intensity;
        return;
      }
      merged.set(key, { ...tuple });
    });
    return Array.from(merged.values());
  }

  // `equip=kind:expression[:stacks],...`: the starting equips, in equip order. Only the
  // tuple syntax is checked here; what may be equipped is the Configurator's call.
  function parseActorEquip(value, actorType, actorIndex) {
    if (!isNonEmptyString(value)) return undefined;
    return String(value).split(",").map((entry) => entry.trim()).filter(Boolean).map((entry, index) => {
      const parts = entry.split(":").map((part) => part.trim());
      if (parts.length !== 2 && parts.length !== 3) {
        throw new Error(`${actorType}[${actorIndex}] equip[${index + 1}] must be kind:expression[:stacks], got "${entry}".`);
      }
      const [kind, expression] = parts.map((part) => part.toLowerCase());
      if (!ALLOWED_AFFINITIES.includes(kind)) {
        throw new Error(`${actorType}[${actorIndex}] equip[${index + 1}] has invalid affinity kind "${parts[0]}".`);
      }
      if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
        throw new Error(`${actorType}[${actorIndex}] equip[${index + 1}] has invalid affinity expression "${parts[1]}".`);
      }
      return parts[2] === undefined
        ? { kind, expression }
        : { kind, expression, stacks: parsePositiveIntStrict(parts[2], `${actorType}[${actorIndex}] equip[${index + 1}] stacks`) };
    });
  }

  // `strategy=` on a delver or warden spec (Phase 2b): a JSON strategy, a path to a .json
  // file holding one, or compact goals `kind[:arg[:n]],...` in order:
  //   reach:exit | reach:<x>/<y> · defeat:<id> · take:<id> · guard:<id>[:radius]
  //   follow:<id>[:distance] · lead:<id>[:distance] (to the exit) · hold:<x>/<y>:<ticks> · survive[:distance]
  // Only the text is read here; what a strategy means is the Actor's (normalizeActorStrategy),
  // and attaching it to the level is the Configurator's.
  function parseCompactPlace(text, label) {
    if (text === "exit") return "exit";
    const match = /^(\d+)\/(\d+)$/.exec(String(text ?? ""));
    if (!match) throw new Error(`${label} place must be exit or <x>/<y>, got "${text ?? ""}".`);
    return { x: Number(match[1]), y: Number(match[2]) };
  }

  // `escort=<id>[:<distance>]` on a delver or warden spec (#251): who an `escorting` actor
  // keeps near and within how many tiles. `escort=:<distance>` keeps the default ally (the
  // playable delver). Only the text is read here; the Configurator checks the ally exists.
  function parseActorEscort(value, actorType, actorIndex) {
    if (!isNonEmptyString(value)) return undefined;
    const [target, distance, ...rest] = String(value).trim().split(":").map((part) => part.trim());
    const label = `${actorType}[${actorIndex}] escort`;
    if (rest.length > 0) throw new Error(`${label} must be <id>[:<distance>], got "${value}".`);
    return {
      ...(target ? { target } : {}),
      ...(distance !== undefined ? { distance: parsePositiveIntStrict(distance, `${label} distance`) } : {}),
    };
  }

  function parseActorStrategy(value, actorType, actorIndex) {
    if (!isNonEmptyString(value)) return undefined;
    const text = String(value).trim();
    const label = `${actorType}[${actorIndex}] strategy`;
    if (text.startsWith("{")) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`${label} is not valid JSON (${error.message}).`);
      }
    }
    if (text.toLowerCase().endsWith(".json")) {
      try {
        return JSON.parse(readStrategyFile(text));
      } catch (error) {
        throw new Error(`${label} file ${text} could not be read as JSON (${error.message}).`);
      }
    }
    const number = (raw, name) => (raw === undefined ? undefined : parsePositiveIntStrict(raw, `${label} ${name}`));
    const goals = text.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry, index) => {
      const [kind, first, second, ...rest] = entry.split(":").map((part) => part.trim());
      const at = `${label} goal ${index + 1}`;
      if (rest.length > 0) throw new Error(`${at} has too many parts: "${entry}".`);
      switch (kind) {
        case "reach": return { kind, place: parseCompactPlace(first, at) };
        case "defeat":
        case "take": return { kind, target: first };
        case "guard": return { kind, target: first, ...(second ? { radius: number(second, "radius") } : {}) };
        case "follow":
        case "lead": return { kind, target: first, ...(second ? { distance: number(second, "distance") } : {}) };
        case "hold": return { kind, place: parseCompactPlace(first, at), ticks: number(second, "ticks") };
        case "survive": return { kind, ...(first ? { distance: number(first, "distance") } : {}) };
        default: throw new Error(`${at} has unknown kind "${kind}" (expected reach, defeat, take, guard, follow, lead, hold, survive).`);
      }
    });
    return { goals };
  }

  // `slots=` and `equip=` on a delver or warden spec, authored by the Configurator into the
  // card's slot and equip fields.
  function readActorEquipment(fields, role, index, card) {
    const slots = fields.has("slots") ? parsePositiveIntStrict(fields.get("slots"), `${role}[${index}] slots`) : undefined;
    return configurator.authorActorEquipment({
      role,
      index,
      slots,
      equip: parseActorEquip(fields.get("equip"), role, index),
      affinity: card.affinity,
      affinities: card.affinities,
    });
  }

  function parseActorVitals(value, actorType, actorIndex) {
    if (!isNonEmptyString(value)) {
      return null;
    }
    const entries = String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      return null;
    }
    const vitals = {};
    entries.forEach((entry, index) => {
      const parts = entry.split(":").map((part) => part.trim());
      if (parts.length !== 3 && parts.length !== 4) {
        throw new Error(`${actorType}[${actorIndex}] vital[${index + 1}] must be vital:max:regen or vital:current:max:regen.`);
      }
      const vital = String(parts[0] || "").toLowerCase();
      if (!VITAL_KEYS.includes(vital)) {
        throw new Error(`${actorType}[${actorIndex}] vital[${index + 1}] has invalid vital kind "${parts[0]}".`);
      }

      let current;
      let max;
      let regen;
      if (parts.length === 3) {
        max = parseNonNegativeIntStrict(parts[1], `${actorType}[${actorIndex}] vital[${index + 1}] max`);
        regen = parseNonNegativeIntStrict(parts[2], `${actorType}[${actorIndex}] vital[${index + 1}] regen`);
        current = max;
      } else {
        current = parseNonNegativeIntStrict(parts[1], `${actorType}[${actorIndex}] vital[${index + 1}] current`);
        max = parseNonNegativeIntStrict(parts[2], `${actorType}[${actorIndex}] vital[${index + 1}] max`);
        regen = parseNonNegativeIntStrict(parts[3], `${actorType}[${actorIndex}] vital[${index + 1}] regen`);
      }
      if (current > max) {
        throw new Error(`${actorType}[${actorIndex}] vital[${index + 1}] current cannot exceed max.`);
      }
      vitals[vital] = { current, max, regen };
    });
    return vitals;
  }

  function parseRoomSpec(value, roomIndex) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`room[${roomIndex}] requires a non-empty spec.`);
    }

    const allowedFields = new Set(["size", "count"]);
    const fields = new Map();
    const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`room[${roomIndex}] requires at least one field.`);
    }

    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        const shorthand = segment.toLowerCase();
        if (!ROOM_CARD_SIZE_IDS.includes(shorthand)) {
          throw new Error(`room[${roomIndex}] segment "${segment}" is invalid; expected key=value.`);
        }
        fields.set("size", shorthand);
        return;
      }

      const separator = segment.indexOf("=");
      const key = segment.slice(0, separator).trim().toLowerCase();
      const fieldValue = segment.slice(separator + 1).trim();
      if (key === "affinity" || key === "affinities") {
        throw new Error(`room[${roomIndex}] field "${key}" is not supported — rooms are generic containers; use --hazard to place affinity in a room.`);
      }
      if (!allowedFields.has(key)) {
        throw new Error(`room[${roomIndex}] field "${key}" is not supported.`);
      }
      if (!fieldValue) {
        throw new Error(`room[${roomIndex}] field "${key}" requires a value.`);
      }
      fields.set(key, fieldValue);
    });

    const size = String(fields.get("size") || "medium").trim().toLowerCase();
    if (!ROOM_CARD_SIZE_IDS.includes(size)) {
      throw new Error(`room[${roomIndex}] size must be one of: ${ROOM_CARD_SIZE_IDS.join(", ")}.`);
    }
    const count = fields.has("count")
      ? parsePositiveIntStrict(fields.get("count"), `room[${roomIndex}] count`)
      : 1;

    return {
      value: { size, count },
      sizeFlexible: !fields.has("size"),
    };
  }

  function parseRoomSpecs(rawRooms) {
    const values = normalizeList(rawRooms)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      throw new Error("room-plan requires at least one --room entry.");
    }
    return values.map((value, index) => parseRoomSpec(value, index + 1));
  }

  function parseFloorTileSpec(value, floorTileIndex) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`floor-tile[${floorTileIndex}] requires a non-empty spec.`);
    }

    const allowedFields = new Set(["id", "count", "tiles", "walkable-target"]);
    const fields = new Map();
    const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`floor-tile[${floorTileIndex}] requires at least one field.`);
    }

    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        throw new Error(`floor-tile[${floorTileIndex}] segment "${segment}" is invalid; expected key=value.`);
      }
      const separator = segment.indexOf("=");
      const key = segment.slice(0, separator).trim().toLowerCase();
      const fieldValue = segment.slice(separator + 1).trim();
      if (!allowedFields.has(key)) {
        throw new Error(`floor-tile[${floorTileIndex}] field "${key}" is not supported.`);
      }
      if (!fieldValue) {
        throw new Error(`floor-tile[${floorTileIndex}] field "${key}" requires a value.`);
      }
      fields.set(key, fieldValue);
    });

    const countValue = fields.get("count") || fields.get("tiles") || fields.get("walkable-target");
    if (!countValue) {
      throw new Error(`floor-tile[${floorTileIndex}] requires count=<n>.`);
    }

    return {
      id: isNonEmptyString(fields.get("id"))
        ? String(fields.get("id")).trim()
        : `floor_tile_${floorTileIndex}`,
      count: parsePositiveIntStrict(countValue, `floor-tile[${floorTileIndex}] count`),
    };
  }

  function parseFloorTileSpecs(rawFloorTiles) {
    const values = normalizeList(rawFloorTiles)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      return [];
    }
    return values.map((value, index) => parseFloorTileSpec(value, index + 1));
  }

  function parsePlacedHazardVitals(value, hazardIndex) {
    if (!isNonEmptyString(value)) {
      return undefined;
    }
    const entries = String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      return undefined;
    }

    const vitals = {};
    entries.forEach((entry, index) => {
      const parts = entry.split(":").map((part) => part.trim());
      if (parts.length !== 3 && parts.length !== 4) {
        throw new Error(`hazard[${hazardIndex}] vital[${index + 1}] must be vital:max:regen or vital:current:max:regen.`);
      }
      const vital = String(parts[0] || "").toLowerCase();
      if (!HAZARD_VITAL_KEYS.includes(vital)) {
        throw new Error(`hazard[${hazardIndex}] vital[${index + 1}] has invalid vital kind "${parts[0]}".`);
      }

      let current;
      let max;
      let regen;
      if (parts.length === 3) {
        max = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] vital[${index + 1}] max`);
        regen = parseNonNegativeIntStrict(parts[2], `hazard[${hazardIndex}] vital[${index + 1}] regen`);
        current = max;
      } else {
        current = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] vital[${index + 1}] current`);
        max = parseNonNegativeIntStrict(parts[2], `hazard[${hazardIndex}] vital[${index + 1}] max`);
        regen = parseNonNegativeIntStrict(parts[3], `hazard[${hazardIndex}] vital[${index + 1}] regen`);
      }
      if (current > max) {
        throw new Error(`hazard[${hazardIndex}] vital[${index + 1}] current cannot exceed max.`);
      }
      vitals[vital] = { current, max, regen };
    });

    return vitals;
  }

  function parseBooleanStrict(value, label) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error(`${label} must be true or false.`);
  }

  function parsePlacedHazardSpec(value, hazardIndex) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`hazard[${hazardIndex}] requires a non-empty spec.`);
    }

    const allowedFields = new Set(["id", "x", "y", "affinity", "expression", "stacks", "intensity", "blocking", "vitals"]);
    const fields = new Map();
    const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`hazard[${hazardIndex}] requires at least one field.`);
    }

    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        throw new Error(`hazard[${hazardIndex}] segment "${segment}" is invalid; expected key=value.`);
      }
      const separator = segment.indexOf("=");
      const key = segment.slice(0, separator).trim().toLowerCase();
      const fieldValue = segment.slice(separator + 1).trim();
      if (!allowedFields.has(key)) {
        throw new Error(`hazard[${hazardIndex}] field "${key}" is not supported.`);
      }
      if (!fieldValue) {
        throw new Error(`hazard[${hazardIndex}] field "${key}" requires a value.`);
      }
      fields.set(key, fieldValue);
    });

    const affinity = String(fields.get("affinity") || "").trim().toLowerCase();
    if (!ALLOWED_AFFINITIES.includes(affinity)) {
      throw new Error(`hazard[${hazardIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
    }
    const expression = String(fields.get("expression") || "emit").trim().toLowerCase();
    if (!ALLOWED_AFFINITY_EXPRESSIONS.includes(expression)) {
      throw new Error(`hazard[${hazardIndex}] expression must be one of: ${ALLOWED_AFFINITY_EXPRESSIONS.join(", ")}.`);
    }

    return {
      id: isNonEmptyString(fields.get("id"))
        ? String(fields.get("id")).trim()
        : `hazard_${hazardIndex}`,
      x: parseNonNegativeIntStrict(fields.get("x"), `hazard[${hazardIndex}] x`),
      y: parseNonNegativeIntStrict(fields.get("y"), `hazard[${hazardIndex}] y`),
      blocking: fields.has("blocking")
        ? parseBooleanStrict(fields.get("blocking"), `hazard[${hazardIndex}] blocking`)
        : false,
      affinity: {
        kind: affinity,
        expression,
        stacks: fields.has("stacks")
          ? parsePositiveIntStrict(fields.get("stacks"), `hazard[${hazardIndex}] stacks`)
          : 1,
        ...(fields.has("intensity")
          ? { intensity: parsePositiveIntStrict(fields.get("intensity"), `hazard[${hazardIndex}] intensity`) }
          : {}),
        targetType: "floor",
      },
      vitals: parsePlacedHazardVitals(fields.get("vitals"), hazardIndex),
    };
  }

  function parsePlacedHazardSpecs(rawHazards) {
    const values = normalizeList(rawHazards)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      return [];
    }
    return values.map((value, index) => parsePlacedHazardSpec(value, index + 1));
  }

  function parseHazardVitalSpec(value, field, hazardIndex) {
    if (!value) {
      return { kind: "one-time", amount: 0 };
    }
    const parts = value.split(":").map((s) => s.trim());
    // A bare amount means one-time:<amount>. Models write `mana=10` overwhelmingly and always have:
    // the field is called `mana` on hazard and on resource, and on resource it IS an integer. The
    // prefixed grammar exists for the regen case, not the common one, so requiring it everywhere
    // taxes the ordinary spelling. Accepting the shorthand removes the mismatch instead of
    // documenting it -- 14 of 21 failures in a 43-attempt sample were exactly this.
    if (parts.length === 1 && /^[0-9]+$/.test(parts[0])) {
      return {
        kind: "one-time",
        amount: parseNonNegativeIntStrict(parts[0], `hazard[${hazardIndex}] ${field} amount`),
      };
    }
    if (parts[0] === "one-time" && parts.length === 2) {
      const amount = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] ${field} amount`);
      return { kind: "one-time", amount };
    }
    if (parts[0] === "regen" && parts.length === 4) {
      const current = parseNonNegativeIntStrict(parts[1], `hazard[${hazardIndex}] ${field} current`);
      const max = parseNonNegativeIntStrict(parts[2], `hazard[${hazardIndex}] ${field} max`);
      const regen = parseNonNegativeIntStrict(parts[3], `hazard[${hazardIndex}] ${field} regen`);
      if (current > max) {
        throw new Error(`hazard[${hazardIndex}] ${field} current cannot exceed max.`);
      }
      return { kind: "regen", current, max, regen };
    }
    throw new Error(`hazard[${hazardIndex}] ${field} must be a plain amount, one-time:<amount>, or regen:<current>:<max>:<regen>; got "${value}".`);
  }

  function placementVitalToHazardVital(vital) {
    if (!vital || typeof vital !== "object") {
      return undefined;
    }
    const current = Number.isFinite(vital.current) ? vital.current : 0;
    const max = Number.isFinite(vital.max) ? vital.max : current;
    const regen = Number.isFinite(vital.regen) ? vital.regen : 0;
    return { kind: "regen", current, max, regen };
  }

  function buildCanonicalHazard({
    id,
    affinity,
    expression,
    stacks = 1,
    intensity,
    proximityRadius = 0,
    mana,
    durability,
    x,
    y,
    blocking,
  } = {}) {
    const resolvedStacks = Number.isInteger(stacks) && stacks > 0 ? stacks : 1;
    return {
      id,
      affinity,
      expression,
      proximityRadius,
      affinityStacks: [{
        kind: affinity,
        expression,
        stacks: resolvedStacks,
        ...(Number.isInteger(intensity) && intensity > 0 ? { intensity } : {}),
        targetType: "floor",
      }],
      vitals: {
        mana: mana || { kind: "one-time", amount: 0 },
        durability: durability || { kind: "one-time", amount: 1 },
      },
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
      ...(blocking !== undefined ? { blocking: blocking === true } : {}),
      _schemaVersion: 3,
    };
  }

  function canonicalizePlacedHazard(hazard, hazardIndex) {
    const affinity = hazard?.affinity || {};
    const id = isNonEmptyString(hazard?.id) ? hazard.id : `hazard_${hazardIndex}`;
    return buildCanonicalHazard({
      id,
      affinity: affinity.kind,
      expression: affinity.expression || "emit",
      stacks: affinity.stacks,
      intensity: affinity.intensity,
      proximityRadius: 0,
      mana: placementVitalToHazardVital(hazard?.vitals?.mana),
      durability: placementVitalToHazardVital(hazard?.vitals?.durability),
      x: hazard?.x,
      y: hazard?.y,
      blocking: hazard?.blocking,
    });
  }

  function parseHazardSpec(value, hazardIndex) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`hazard[${hazardIndex}] requires a non-empty spec.`);
    }
    const allowedFields = new Set(["id", "affinity", "expression", "stacks", "intensity", "proximityRadius", "blocking", "mana", "durability"]);
    const fields = new Map();
    const segments = raw.split(";").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`hazard[${hazardIndex}] requires at least one field.`);
    }
    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        throw new Error(`hazard[${hazardIndex}] segment "${segment}" is invalid; expected key=value.`);
      }
      const eqIdx = segment.indexOf("=");
      const key = segment.slice(0, eqIdx).trim();
      const val = segment.slice(eqIdx + 1).trim();
      if (!allowedFields.has(key)) {
        throw new Error(`hazard[${hazardIndex}] field "${key}" is not supported.`);
      }
      if (!val) {
        throw new Error(`hazard[${hazardIndex}] field "${key}" requires a value.`);
      }
      fields.set(key, val);
    });
    if (!fields.has("affinity") || !ALLOWED_AFFINITIES.includes(fields.get("affinity"))) {
      throw new Error(`hazard[${hazardIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
    }
    if (!fields.has("expression") || !ALLOWED_AFFINITY_EXPRESSIONS.includes(fields.get("expression"))) {
      throw new Error(`hazard[${hazardIndex}] expression must be one of: ${ALLOWED_AFFINITY_EXPRESSIONS.join(", ")}.`);
    }
    if (!fields.has("proximityRadius")) {
      throw new Error(`hazard[${hazardIndex}] proximityRadius is required.`);
    }
    const affinity = fields.get("affinity");
    const expression = fields.get("expression");
    const stacks = fields.has("stacks")
      ? parsePositiveIntStrict(fields.get("stacks"), `hazard[${hazardIndex}] stacks`)
      : 1;
    return buildCanonicalHazard({
      id: fields.has("id") ? fields.get("id") : `hazard_${hazardIndex}`,
      affinity,
      expression,
      stacks,
      intensity: fields.has("intensity")
        ? parsePositiveIntStrict(fields.get("intensity"), `hazard[${hazardIndex}] intensity`)
        : undefined,
      proximityRadius: parseNonNegativeIntStrict(fields.get("proximityRadius"), `hazard[${hazardIndex}] proximityRadius`),
      mana: parseHazardVitalSpec(fields.get("mana"), "mana", hazardIndex),
      durability: fields.has("durability")
        ? parseHazardVitalSpec(fields.get("durability"), "durability", hazardIndex)
        : undefined,
      blocking: fields.has("blocking")
        ? parseBooleanStrict(fields.get("blocking"), `hazard[${hazardIndex}] blocking`)
        : undefined,
    });
  }

  function parseHazardSpecs(rawHazards) {
    const values = normalizeList(rawHazards)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      throw new Error("hazard-plan requires at least one --hazard entry.");
    }
    return values.map((value, index) => ({
      prompt: value,
      value: parseHazardSpec(value, index + 1),
    }));
  }

  function parseAuthoringHazardSpec(value, hazardIndex) {
    const raw = String(value || "").trim();
    const hasPlacementFields = /(?:^|;)\s*(?:x|y|vitals)\s*=/i.test(raw);
    return hasPlacementFields
      ? canonicalizePlacedHazard(parsePlacedHazardSpec(raw, hazardIndex), hazardIndex)
      : parseHazardSpec(raw, hazardIndex);
  }

  const RESOURCE_ALLOWED_PERMANENCE_MODES = new Set(["consumable", "level", "permanent"]);
  const RESOURCE_ALLOWED_VITAL_KEYS = new Set(["health", "mana", "stamina"]);
  const RESOURCE_ALLOWED_AFFINITY_KINDS = new Set([
    "fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark",
  ]);
  const RESOURCE_ALLOWED_AFFINITY_EXPRESSIONS = new Set(["push", "pull", "emit", "draw"]);

  function readResourceInt(fields, key, resourceIndex, { required = false, min = 0 } = {}) {
    if (!fields.has(key)) {
      if (required) {
        throw new Error(`resource[${resourceIndex}] ${key} is required for an affinity payload.`);
      }
      return 0;
    }
    const raw = fields.get(key);
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new Error(`resource[${resourceIndex}] ${key} must be an integer; got "${raw}".`);
    }
    if (value < min) {
      throw new Error(`resource[${resourceIndex}] ${key} must be >= ${min}; got ${value}.`);
    }
    return value;
  }

  /**
   * Parses the affinity payload of a resource spec.
   *
   * manaRegen is what makes the granted affinity permanent — there is no tier field.
   * It defaults to 0, which yields a temporary grant that ends when its mana runs out.
   */
  function parseResourceAffinityPayload(fields, resourceIndex) {
    const kind = fields.get("affinity");
    if (!RESOURCE_ALLOWED_AFFINITY_KINDS.has(kind)) {
      throw new Error(`resource[${resourceIndex}] affinity must be one of: ${[...RESOURCE_ALLOWED_AFFINITY_KINDS].join(", ")}.`);
    }
    const expression = fields.get("expression");
    if (!expression) {
      throw new Error(`resource[${resourceIndex}] expression is required for an affinity payload.`);
    }
    if (!RESOURCE_ALLOWED_AFFINITY_EXPRESSIONS.has(expression)) {
      throw new Error(`resource[${resourceIndex}] expression must be one of: ${[...RESOURCE_ALLOWED_AFFINITY_EXPRESSIONS].join(", ")}.`);
    }
    const stacks = readResourceInt(fields, "stacks", resourceIndex, { required: true, min: 1 });
    const mana = readResourceInt(fields, "mana", resourceIndex, { required: true, min: 0 });
    const manaRegen = readResourceInt(fields, "manaRegen", resourceIndex, { min: 0 });
    if (manaRegen > 0 && mana <= 0) {
      throw new Error(`resource[${resourceIndex}] manaRegen requires mana > 0 — regen would refill nothing.`);
    }
    return { kind, expression, stacks, mana, manaRegen };
  }

  function parseResourceSpec(value, resourceIndex) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`resource[${resourceIndex}] requires a non-empty spec.`);
    }
    const fields = new Map();
    const segments = raw.split(";").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`resource[${resourceIndex}] requires at least one field.`);
    }

    // Detect schema version from first key seen
    const isV3 = segments.some((seg) => {
      const key = seg.split("=")[0].trim();
      return key === "permanenceMode" || key === "vital" || key === "affinity" || key === "slots";
    });

    if (isV3) {
      // V3: a vital payload (permanenceMode + vital + delta), an affinity payload
      // (affinity + expression + stacks + mana [+ manaRegen]), or both.
      const allowedFields = new Set([
        "id", "permanenceMode", "vital", "delta", "regen",
        "affinity", "expression", "stacks", "mana", "manaRegen", "slots",
      ]);
      segments.forEach((segment) => {
        if (!segment.includes("=")) {
          throw new Error(`resource[${resourceIndex}] segment "${segment}" is invalid; expected key=value.`);
        }
        const eqIdx = segment.indexOf("=");
        const key = segment.slice(0, eqIdx).trim();
        const val = segment.slice(eqIdx + 1).trim();
        if (!allowedFields.has(key)) {
          throw new Error(`resource[${resourceIndex}] field "${key}" is not supported in V3 spec.`);
        }
        if (!val) {
          throw new Error(`resource[${resourceIndex}] field "${key}" requires a value.`);
        }
        fields.set(key, val);
      });

      const hasVitalPayload = fields.has("permanenceMode") || fields.has("vital")
        || fields.has("delta") || fields.has("regen");
      const hasAffinityPayload = fields.has("affinity");
      const hasSlotPayload = fields.has("slots");
      if (!hasVitalPayload && !hasAffinityPayload && !hasSlotPayload) {
        throw new Error(`resource[${resourceIndex}] requires a vital payload, an affinity payload, a slots payload, or a combination.`);
      }

      let vitals = [];
      let permanenceMode = "consumable";
      if (hasVitalPayload) {
        // Which key put us in this branch. Without it the messages below are unanswerable: an author
        // who set only permanenceMode on an affinity resource is told a vital is required and has no
        // way to see why. Naming the trigger turns "what?" into "drop this key, or complete the set".
        const trigger = ["permanenceMode", "vital", "delta", "regen"].filter((key) => fields.has(key));
        const because = `read as a vital payload because ${trigger.join(", ")} ${trigger.length === 1 ? "is" : "are"} set`;

        // MISSING and INVALID are different faults and were reported identically. A missing field was
        // announced as "must be one of <enum>", which sends the reader hunting for a bad value that
        // was never sent -- it misled a whole failure analysis before anyone read this function.
        if (!fields.has("permanenceMode")) {
          throw new Error(`resource[${resourceIndex}] permanenceMode is required for a vital payload (${because}); it governs how long the vital delta persists.`);
        }
        permanenceMode = fields.get("permanenceMode");
        if (!RESOURCE_ALLOWED_PERMANENCE_MODES.has(permanenceMode)) {
          throw new Error(`resource[${resourceIndex}] permanenceMode must be one of: ${[...RESOURCE_ALLOWED_PERMANENCE_MODES].join(", ")}; got "${permanenceMode}".`);
        }
        if (!fields.has("vital")) {
          throw new Error(`resource[${resourceIndex}] vital is required for a vital payload (${because}). For an affinity-only resource, omit ${trigger.join(", ")}.`);
        }
        const vitalKey = fields.get("vital");
        if (!RESOURCE_ALLOWED_VITAL_KEYS.has(vitalKey)) {
          throw new Error(`resource[${resourceIndex}] vital must be one of: ${[...RESOURCE_ALLOWED_VITAL_KEYS].join(", ")}; got "${vitalKey}".`);
        }
        // delta is optional once regen is present: a regen-only resource is legal.
        if (!fields.has("delta") && !fields.has("regen")) {
          throw new Error(`resource[${resourceIndex}] delta is required unless regen is given.`);
        }
        let delta = 0;
        if (fields.has("delta")) {
          delta = Number(fields.get("delta"));
          if (!Number.isFinite(delta)) {
            throw new Error(`resource[${resourceIndex}] delta must be a number.`);
          }
        }
        // regen is a third, independent grant — permanenceMode governs delta only.
        // Omitted when absent so existing vital-only artifacts stay byte-identical
        // (ResourceVitalGrant.regen is optional).
        const vitalGrant = { key: vitalKey, delta };
        if (fields.has("regen")) {
          vitalGrant.regen = readResourceInt(fields, "regen", resourceIndex, { min: 0 });
        }
        vitals = [vitalGrant];
      }

      const parsed = {
        id: fields.has("id") ? fields.get("id") : `resource_${resourceIndex}`,
        permanenceMode,
        vitals,
        _schemaVersion: 3,
      };

      if (hasAffinityPayload) {
        parsed.affinity = parseResourceAffinityPayload(fields, resourceIndex);
      }
      if (hasSlotPayload) {
        // Slot-unlock loot: opens this many more affinity slots (core caps an actor at 6).
        parsed.slotGrant = readResourceInt(fields, "slots", resourceIndex, { min: 1 });
      }
      return parsed;
    }

    if (!isV3) {
      throw new Error(`resource[${resourceIndex}] requires V3 permanenceMode or affinity payload; leftover tier/stat/dropRate is not supported.`);
    }
  }

  function parseResourceSpecs(rawResources) {
    const values = normalizeList(rawResources)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      throw new Error("resource-plan requires at least one --resource entry.");
    }
    return values.map((value, index) => ({
      prompt: value,
      value: parseResourceSpec(value, index + 1),
    }));
  }

  function parseDelverSpec(value, delverIndex, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`delver[${delverIndex}] requires a non-empty spec.`);
    }

    const allowedFields = new Set(["id", "count", "affinity", "affinities", "motivation", "vitals", "setup-mode", "setupmode", "goals", "slots", "equip", "strategy", "escort", "minions"]);
    const fields = new Map();
    const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`delver[${delverIndex}] requires at least one field.`);
    }

    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        const shorthand = segment.trim().toLowerCase();
        if (ALLOWED_AFFINITIES.includes(shorthand)) {
          fields.set("affinity", shorthand);
          return;
        }
        if (ALLOWED_MOTIVATIONS.includes(shorthand)) {
          if (fields.has("motivation")) {
            throw new Error(`delver[${delverIndex}] motivation may only be specified once.`);
          }
          fields.set("motivation", shorthand);
          return;
        }
        throw new Error(`delver[${delverIndex}] segment "${segment}" is invalid; expected key=value.`);
      }

      const separator = segment.indexOf("=");
      const key = segment.slice(0, separator).trim().toLowerCase();
      const fieldValue = segment.slice(separator + 1).trim();
      if (!allowedFields.has(key)) {
        throw new Error(`delver[${delverIndex}] field "${key}" is not supported.`);
      }
      if (!fieldValue) {
        throw new Error(`delver[${delverIndex}] field "${key}" requires a value.`);
      }
      if (key === "motivation" && fields.has("motivation")) {
        throw new Error(`delver[${delverIndex}] motivation may only be specified once.`);
      }
      fields.set(key, fieldValue);
    });

    // configurator/actors (2026-08-18) — the CLI still tokenizes the `;`-delimited spec
    // (above) and the generic value-format tuples (below); defaulting, enum validation
    // and candidate assembly are the Configurator's, via authorDelverCandidate.
    const count = fields.has("count")
      ? parsePositiveIntStrict(fields.get("count"), `delver[${delverIndex}] count`)
      : 1;
    const affinities = parseActorAffinities(fields.get("affinities"), "delver", delverIndex);
    const vitals = parseActorVitals(fields.get("vitals"), "delver", delverIndex);
    const optimizationGoals = parseOptimizationGoalList(fields.get("goals"), {
      label: `delver[${delverIndex}].goals`,
      defaultScope: "delver",
      source: "object_flag",
    });

    const delver = configurator.authorDelverCandidate({
      index: delverIndex,
      rawAffinity: fields.get("affinity"),
      rawMotivation: fields.get("motivation"),
      rawId: fields.get("id"),
      rawSetupMode: fields.get("setup-mode") || fields.get("setupmode"),
      defaultAffinity,
      count,
      affinities,
      vitals,
    });

    Object.assign(delver, readActorEquipment(fields, "delver", delverIndex, delver));
    const delverStrategy = parseActorStrategy(fields.get("strategy"), "delver", delverIndex);
    if (delverStrategy !== undefined) delver.strategy = delverStrategy;
    const delverEscort = parseActorEscort(fields.get("escort"), "delver", delverIndex);
    if (delverEscort !== undefined) delver.escort = delverEscort;
    // 2026-10-29: `minions=shield+support`, the delver's own retinue (the Configurator composes it).
    if (fields.has("minions") && count !== 1) {
      throw new Error(`delver[${delverIndex}] minions need count=1: they follow one delver.`);
    }

    return {
      value: delver,
      optimizationGoals,
      vitalsFlexible: !fields.has("vitals"),
      ...(fields.has("minions") ? { minions: fields.get("minions") } : {}),
    };
  }

  function parseDelverSpecs(rawDelvers, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
    const values = normalizeList(rawDelvers)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      throw new Error("delver-plan requires at least one --delver entry.");
    }
    return values.map((value, index) => parseDelverSpec(value, index + 1, { defaultAffinity }));
  }

  function parseWardenSpec(value, wardenIndex, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
    const raw = String(value || "").trim();
    if (!raw) {
      throw new Error(`warden[${wardenIndex}] requires a non-empty spec.`);
    }

    const allowedFields = new Set(["id", "count", "affinity", "affinities", "motivation", "vitals", "slots", "equip", "strategy", "escort"]);
    const fields = new Map();
    const segments = raw.split(";").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      throw new Error(`warden[${wardenIndex}] requires at least one field.`);
    }

    segments.forEach((segment) => {
      if (!segment.includes("=")) {
        const shorthand = segment.trim().toLowerCase();
        if (ALLOWED_AFFINITIES.includes(shorthand)) {
          fields.set("affinity", shorthand);
          return;
        }
        if (ALLOWED_MOTIVATIONS.includes(shorthand)) {
          if (fields.has("motivation")) {
            throw new Error(`warden[${wardenIndex}] motivation may only be specified once.`);
          }
          fields.set("motivation", shorthand);
          return;
        }
        throw new Error(`warden[${wardenIndex}] segment "${segment}" is invalid; expected key=value.`);
      }

      const separator = segment.indexOf("=");
      const key = segment.slice(0, separator).trim().toLowerCase();
      const fieldValue = segment.slice(separator + 1).trim();
      if (!allowedFields.has(key)) {
        throw new Error(`warden[${wardenIndex}] field "${key}" is not supported.`);
      }
      if (!fieldValue) {
        throw new Error(`warden[${wardenIndex}] field "${key}" requires a value.`);
      }
      if (key === "motivation" && fields.has("motivation")) {
        throw new Error(`warden[${wardenIndex}] motivation may only be specified once.`);
      }
      fields.set(key, fieldValue);
    });

    const rawAffinity = fields.get("affinity") || defaultAffinity;
    const affinity = isNonEmptyString(rawAffinity) ? String(rawAffinity).trim().toLowerCase() : null;
    if (affinity !== null && !ALLOWED_AFFINITIES.includes(affinity)) {
      throw new Error(`warden[${wardenIndex}] affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
    }

    const motivations = configurator.authorMotivations({ role: "warden", index: wardenIndex, raw: fields.get("motivation") });

    const count = fields.has("count")
      ? parsePositiveIntStrict(fields.get("count"), `warden[${wardenIndex}] count`)
      : 1;
    const id = isNonEmptyString(fields.get("id"))
      ? String(fields.get("id")).trim()
      : `card_warden_${wardenIndex}`;
    const affinities = parseActorAffinities(fields.get("affinities"), "warden", wardenIndex);
    const vitals = parseActorVitals(fields.get("vitals"), "warden", wardenIndex);

    const warden = {
      id,
      type: "warden",
      source: "actor",
      count,
      affinity,
      motivations,
    };
    if (affinities && affinities.length > 0) {
      warden.affinities = affinities;
    }
    if (vitals && Object.keys(vitals).length > 0) {
      warden.vitals = vitals;
    }
    Object.assign(warden, readActorEquipment(fields, "warden", wardenIndex, warden));
    const wardenStrategy = parseActorStrategy(fields.get("strategy"), "warden", wardenIndex);
    if (wardenStrategy !== undefined) warden.strategy = wardenStrategy;
    const wardenEscort = parseActorEscort(fields.get("escort"), "warden", wardenIndex);
    if (wardenEscort !== undefined) warden.escort = wardenEscort;
    return warden;
  }

  function parseWardenSpecs(rawWardens, { defaultAffinity = DEFAULT_DUNGEON_AFFINITY } = {}) {
    const values = normalizeList(rawWardens)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      throw new Error("warden-plan requires at least one --warden entry.");
    }
    return values.map((value, index) => parseWardenSpec(value, index + 1, { defaultAffinity }));
  }

  // Budget maximization + feasibility are Allocator policy (charter: "budget
  // maximization is Allocator policy"). The CLI reaches them only through the
  // persona surface; the maximizer/assessor domain logic itself lives in
  // personas/allocator/budget-fulfillment.js (moved there in P2.3.4).
  // CR.9 M2: both price ROOM cards, and room tile counts are Configurator geometry.
  // The Allocator is handed the Configurator's own derivation instead of computing a
  // second answer — the wiring mirrors CR.6's
  // `createActorPersona({ admitProposals: allocator.admitProposals })`, one persona's
  // capability injected into another at the composition root, through public surfaces
  // on both sides.
  // CR.9 M3: the maximizer also ASSEMBLES cards and the assessor decides configuration
  // validity, so the Configurator's candidate-authoring surface and motivation
  // vocabulary are injected alongside the geometry. The Allocator refuses all three
  // jobs without them rather than answering a Configurator question itself.
  const configurator = createConfiguratorPersona({ clock: UNUSED_CLOCK });
  // #396: the Director's tactic grammar, ungated (it stamps nothing).
  const tacticDirector = createDirectorPersona({ clock: UNUSED_CLOCK });
  // #422: the Allocator's level grades (read-only pricing, ungated).
  const gradeAllocator = createAllocatorPersona({ clock: UNUSED_CLOCK });
  const configuratorGeometry = configurator.deriveRoomLayout;

  function allocatorWithGeometry() {
    return createAllocatorPersona({
      clock: UNUSED_CLOCK,
      deriveRoomLayout: configuratorGeometry,
      authorCandidates: configurator.authorCandidates,
      normalizeMotivations: configurator.normalizeMotivations,
    });
  }

  function ensureBudgetedFulfillmentFeasible(args) {
    return allocatorWithGeometry().assessFeasibility(args);
  }

  function applyBudgetCappedFulfillment(args) {
    return allocatorWithGeometry().maximizeFulfillment(args);
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function assertSchema(artifact, expectedSchema, acceptedVersions = [1]) {
    if (!artifact || typeof artifact !== "object") {
      throw new Error(`Expected ${expectedSchema} artifact.`);
    }
    if (artifact.schema !== expectedSchema) {
      throw new Error(`Expected schema ${expectedSchema}, got ${artifact.schema || "missing"}.`);
    }
    if (!acceptedVersions.includes(artifact.schemaVersion)) {
      throw new Error(`Expected schemaVersion ${acceptedVersions.join(" or ")} for ${expectedSchema}.`);
    }
  }

  function assertAllowedAgentAuthoringArgs(command, args, { allowDryRun = false } = {}) {
    const allowed = new Set([
      "text",
      "room",
      "floor-tile",
      "hazard",
      "hazard",
      "resource",
      "delver",
      "warden",
      "place",
      "tactic",
      "fixture",
      "model",
      "base-url",
      "seed",
      "goal",
      "dungeon-affinity",
      "budget-tokens",
      "dungeon-budget-tokens",
      "delver-budget-tokens",
      "grade",
      "budget",
      "price-list",
      "out-dir",
      "run-id",
      "created-at",
      "emit-intermediates",
    ]);
    if (allowDryRun) {
      allowed.add("dry-run");
    }
    const unknown = [];
    for (const key of Object.keys(args)) {
      if (key === "_" || key === "help") {
        continue;
      }
      if (!allowed.has(key)) {
        unknown.push(`--${key}`);
      }
    }
    if (Array.isArray(args._) && args._.length > 0) {
      unknown.push(...args._);
    }
    if (unknown.length > 0) {
      throw new Error(`${command} only accepts --text, --room, --floor-tile, --hazard, --resource, --delver, --warden, --place, --tactic, --fixture, --model, --base-url, --seed, --goal, --dungeon-affinity, --budget-tokens, --dungeon-budget-tokens, --delver-budget-tokens, --grade, --budget, --price-list, --out-dir, --run-id, --created-at, --emit-intermediates${allowDryRun ? ", and --dry-run" : ""}. Unknown: ${unknown.join(", ")}`);
    }
  }

  function makeAgentCommandRoutes(kind) {
    switch (kind) {
      case "room":
        return [
          { target: "build_spec_plan", path: "plan.hints.rooms", legacyFlow: "room-plan" },
          { target: "build_spec_configurator", path: "configurator.inputs.cardSet", legacyFlow: "room-plan" },
        ];
      case "floor_tile":
        return [
          { target: "build_spec_configurator", path: "configurator.inputs.levelGen.walkableTilesTarget", legacyFlow: "configurator" },
        ];
      case "hazard":
        return [
          { target: "build_spec_configurator", path: "configurator.inputs.levelGen.hazards", legacyFlow: "hazard-plan" },
        ];
      case "resource":
        return [
          { target: "build_spec_configurator", path: "configurator.inputs.resources", legacyFlow: "resource-plan" },
        ];
      case "delver":
        return [
          { target: "build_spec_plan", path: "plan.hints.cardSet", legacyFlow: "delver-plan" },
          { target: "build_spec_configurator", path: "configurator.inputs.actors", legacyFlow: "delver-plan" },
        ];
      case "warden":
        return [
          { target: "build_spec_plan", path: "plan.hints.cardSet", legacyFlow: "warden-plan" },
          { target: "build_spec_configurator", path: "configurator.inputs.actors", legacyFlow: "warden-plan" },
        ];
      case "shared_config":
        return [
          { target: "build_spec_intent", path: "intent.hints" },
          { target: "build_spec_configurator", path: "configurator.inputs" },
        ];
      default:
        return [];
    }
  }

  function buildAgentCommandRequestArtifact({
    action,
    commandText,
    runId,
    createdAt,
    objectRequests,
    sharedConfig,
  } = {}) {
    const kinds = Array.from(new Set(objectRequests.map((entry) => entry.kind)));
    return {
      schema: AGENT_COMMAND_REQUEST_SCHEMA,
      schemaVersion: 1,
      meta: {
        id: `agent_command_${action}_${runId}`,
        runId,
        createdAt,
        producedBy: `cli-${action}`,
      },
      command: {
        action,
        text: commandText,
        source: `cli-${action}`,
        taxonomyVersion: 1,
      },
      objects: objectRequests,
      sharedConfig: sharedConfig && Object.keys(sharedConfig).length > 0 ? sharedConfig : undefined,
      compilation: {
        rules: kinds.map((kind) => ({
          kind,
          compileTo: makeAgentCommandRoutes(kind),
        })),
      },
      compatibility: {
        preserveExistingCommands: true,
        supportedLegacyFlows: Array.from(new Set(
          kinds.flatMap((kind) => makeAgentCommandRoutes(kind).map((route) => route.legacyFlow).filter(Boolean)).concat(["build", "configurator"]),
        )),
      },
    };
  }

  function describeAgentCommandText({ action, text, objects }) {
    if (isNonEmptyString(text)) {
      return text.trim();
    }
    const counts = {};
    objects.forEach((entry) => {
      counts[entry.kind] = (counts[entry.kind] || 0) + (Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1);
    });
    const summary = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `${count} ${kind.replaceAll("_", "-")}${count === 1 ? "" : "s"}`)
      .join(", ");
    return `${action === "configure" ? "Configure" : "Create"} ${summary}.`;
  }

  function deriveGoalForAgentCommand({ action, goal, objects }) {
    if (isNonEmptyString(goal)) {
      return goal.trim();
    }
    const labels = Array.from(new Set(objects.map((entry) => entry.kind.replaceAll("_", "-"))));
    return `${action === "configure" ? "Configure" : "Author"} ${labels.join(", ")} into a playable dungeon bundle.`;
  }

  /**
   * The per-kind budget split, READ FROM THE ALLOCATOR — never declared here.
   *
   * ⚠️ CR.1, found again at CR.9 M5 and this time in glue. This was a hardcoded object
   * (`rooms: 0.44, hazards: 0.12, wardens: 0.16, resources: 0.08, delver: 0.20`) — a FOURTH
   * copy of the split, in an adapter, and the one that actually drives `ak create`. It hid
   * through the whole milestone that closed CR.1 because the single-origin guard was scoped
   * to `packages/runtime/src` and stopped at the runtime package boundary. The proof it was
   * load-bearing: retuning the canonical split in `base-costs.json` (hazard 12 -> 15) changed
   * nothing on the real path, because this copy answered instead.
   *
   * The charter's rule is that the Director — and glue even more so — may CALL the Allocator
   * for a split, never define one. So this asks. The guard now scopes to all of `packages`.
   */
  const AUTHORING_POOL_WEIGHT_DEFAULTS = Object.freeze(Object.fromEntries(
    createAllocatorPersona({ clock: UNUSED_CLOCK })
      .pricing.defaultPoolWeights()
      .map((pool) => [pool.id, pool.weight]),
  ));

  function buildPoolWeightsForAuthoredKinds({
    rooms = [],
    floorTiles = [],
    placedHazards = [],
    hazards = [],
    resources = [],
    delvers = [],
    wardens = [],
    carvesLevel = false,
    tacticPools = [],
  } = {}) {
    const weights = [];
    // A create that names hazards but no room still carves a room for them, so its floor
    // tiles need the rooms pool or the Allocator denies them (bf-042).
    if (carvesLevel || rooms.length > 0 || floorTiles.length > 0 || placedHazards.length > 0) {
      weights.push({ id: "rooms", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.rooms });
    }
    // #418: a tactic that adds hazards (minefield, shrine #486) needs the hazard share as authored ones do.
    if (hazards.length > 0 || tacticPools.includes("hazards")) weights.push({ id: "hazards", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.hazards });
    if (wardens.length > 0) weights.push({ id: "wardens", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.wardens });
    if (resources.length > 0) weights.push({ id: "resources", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.resources });
    if (delvers.length > 0) weights.push({ id: "delver", weight: AUTHORING_POOL_WEIGHT_DEFAULTS.delver });
    return weights;
  }

  /**
   * Everything `ak create` / `ak configure` decide before the build: arguments checked, specs
   * parsed, budgets resolved, the request and summary assembled. Its IO is the host's: reading a
   * budget or price-list file, drawing a seed, an LLM tactic plan, the clock and ids.
   */
  async function prepareAuthoringBuild(args, { commandName, action, allowDryRun = false } = {}, { readArtifact, drawSeed, planTacticsWithLlm, now }) {
    assertAllowedAgentAuthoringArgs(commandName, args, { allowDryRun });

    const runId = args["run-id"] || makeId("run");
    const createdAt = args["created-at"] || now();
    const budgetPath = args.budget || null;
    const priceListPath = args["price-list"] || null;

    const dungeonAffinity = isNonEmptyString(args["dungeon-affinity"])
      ? args["dungeon-affinity"].trim().toLowerCase()
      : (DEFAULT_DUNGEON_AFFINITY ?? undefined);
    if (dungeonAffinity !== undefined && !ALLOWED_AFFINITIES.includes(dungeonAffinity)) {
      throw new Error(`${commandName} --dungeon-affinity must be one of: ${ALLOWED_AFFINITIES.join(", ")}.`);
    }

    let budgetTokensFlag;
    if (args["budget-tokens"] !== undefined) {
      budgetTokensFlag = parsePositiveIntStrict(args["budget-tokens"], `${commandName} --budget-tokens`);
    }
    let dungeonBudgetTokensFlag;
    if (args["dungeon-budget-tokens"] !== undefined) {
      dungeonBudgetTokensFlag = parsePositiveIntStrict(args["dungeon-budget-tokens"], `${commandName} --dungeon-budget-tokens`);
    }
    let delverBudgetTokensFlag;
    if (args["delver-budget-tokens"] !== undefined) {
      delverBudgetTokensFlag = parsePositiveIntStrict(args["delver-budget-tokens"], `${commandName} --delver-budget-tokens`);
    }
    // #422: a grade is the Allocator's: its budget, and the dungeon/delver split applied to the
    // pools below. An explicit --budget-tokens still wins, and the result says it overrode.
    const levelGrade = args.grade !== undefined ? gradeAllocator.pricing.levelGrade(String(args.grade)) : null;
    budgetTokensFlag ??= levelGrade?.budgetTokens;
    if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
      throw new Error(`${commandName} requires both --budget and --price-list.`);
    }

    let budgetArtifact = null;
    let priceListArtifact = null;
    if (budgetPath) {
      budgetArtifact = await readArtifact(budgetPath);
      assertSchema(budgetArtifact, BUDGET_ARTIFACT_SCHEMA);
    }
    if (priceListPath) {
      priceListArtifact = await readArtifact(priceListPath);
      assertSchema(priceListArtifact, PRICE_LIST_SCHEMA);
    }

    const authoringText = [args.text, args.goal].filter(isNonEmptyString).join("\n");
    const textBudgetTokens = extractBudgetTokensFromText(authoringText, `${commandName} freeform text`);
    const {
      resolvedBudgetTokens,
      constraints: authoringConstraints,
    } = resolveAuthoringBudget({
      commandName,
      textBudgetTokens,
      flagBudgetTokens: budgetTokensFlag,
      budgetArtifact,
    });

    const parsedRooms = normalizeList(args.room)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => ({ prompt: value, ...parseRoomSpec(value, index + 1) }));
    const parsedFloorTiles = normalizeList(args["floor-tile"])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => ({ prompt: value, value: parseFloorTileSpec(value, index + 1) }));
    const parsedHazards = normalizeList(args.hazard)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => ({ prompt: value, value: parseAuthoringHazardSpec(value, index + 1) }));
    const canonicalHazardEntries = parsedHazards;
    const occupiedHazardPositions = new Set();
    for (const entry of canonicalHazardEntries) {
      const hazard = entry.value;
      if (!Number.isFinite(hazard?.x) || !Number.isFinite(hazard?.y)) continue;
      const positionKey = `${hazard.x},${hazard.y}`;
      if (occupiedHazardPositions.has(positionKey)) {
        throw new Error(`duplicate_hazard: multiple hazards occupy room-relative position (${positionKey})`);
      }
      occupiedHazardPositions.add(positionKey);
    }
    const parsedResources = normalizeList(args.resource)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => ({ prompt: value, value: parseResourceSpec(value, index + 1) }));
    const parsedDelvers = normalizeList(args.delver)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => ({ prompt: value, ...parseDelverSpec(value, index + 1, { defaultAffinity: dungeonAffinity }) }));
    const parsedWardens = normalizeList(args.warden)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => ({ prompt: value, value: parseWardenSpec(value, index + 1, { defaultAffinity: dungeonAffinity }) }));
    // #301: relational placement constraints, parsed by the Configurator's own grammar.
    const placementConstraints = normalizeList(args.place)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((value, index) => configurator.parsePlacementConstraint(value, index));
    // #396: tactics, read by the Director's own grammar. A tactic with no --seed draws one
    // here, in the adapter, so no persona ever reads randomness.
    const tacticSpecs = normalizeList(args.tactic)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    // #401/#402: `--tactic auto` or `--tactic llm` stands alone; the mix is picked from the build seed below.
    const tacticMode = tacticSpecs.find((value) => value === "auto" || value === "llm");
    const autoTactics = tacticMode !== undefined;
    if (autoTactics && tacticSpecs.length > 1) {
      throw new Error(`${commandName}: --tactic ${tacticMode} picks the whole mix, so it can't be combined with other tactics.`);
    }
    let tactics = autoTactics ? [] : tacticSpecs.map((value) => tacticDirector.parseTactic(value));
    let buildSeed;
    if (args.seed !== undefined) {
      buildSeed = Number(args.seed);
      if (!Number.isSafeInteger(buildSeed) || buildSeed < 0) {
        throw new Error(`${commandName} requires --seed to be a non-negative integer.`);
      }
    } else if (tactics.length > 0 || autoTactics) {
      buildSeed = drawSeed();
    }
    let tacticPlan;
    if (autoTactics) {
      const levelCounts = {
        wardens: parsedWardens.reduce((sum, entry) => sum + (Number(entry.value.count) || 1), 0),
        resources: parsedResources.length,
      };
      tactics = tacticDirector.pickSeededTactics(buildSeed, levelCounts);
      if (tacticMode === "llm") {
        ({ tactics, tacticPlan } = await planTacticsWithLlm({
          args, seededTactics: tactics, levelCounts, rooms: normalizeList(args.room).length,
        }));
      }
    }
    // 2026-10-29: a delver's own minions are a retinue it leads, added after the mix is picked, so
    // they join any tactic (`auto` included) and draw no seed (a named leader and roles pick nothing).
    parsedDelvers.forEach((entry) => {
      if (entry.minions) tactics = [...tactics, { tactic: "retinue", params: { leader: `${entry.value.id}-1`, roles: entry.minions } }];
    });

    // No size=small precheck for placed hazards: the Configurator's input preparation
    // bumps roomMinSize to MIN_ROOM_SIZE_WITH_ITEMS when placedHazards are present, so a
    // small room still fits them and rejecting it would contradict the geometry the
    // generator actually produces. Hazard
    // placement is validated against the real generated room: room-relative
    // coordinates that exceed the room's interior are rejected with a structured
    // hazard_outside_room error by the level-gen layer (level-layout.js).

    if (
      parsedRooms.length === 0
      && parsedFloorTiles.length === 0
      && parsedHazards.length === 0
      && parsedResources.length === 0
      && parsedDelvers.length === 0
      && parsedWardens.length === 0
    ) {
      throw new Error(`${commandName} requires at least one authored object via --room, --floor-tile, --hazard, --resource, --delver, or --warden.`);
    }

    const textVitalScope = parsedDelvers.length > 0 && parsedWardens.length === 0
      ? "delver"
      : parsedWardens.length > 0 && parsedDelvers.length === 0
        ? "warden"
        : null;
    const textVitalGoals = resolveTextVitalOptimizationGoals({
      commandName,
      text: authoringText,
      scope: textVitalScope,
    });
    const sharedOptimizationGoals = buildSharedOptimizationGoals({
      text: authoringText,
      hardBudgetConstraint: authoringConstraints,
    });
    const shouldMaximizeSpend = sharedOptimizationGoals.some((entry) => entry.kind === "maximize_budget_spend");
    const textDelverGoals = textVitalScope === "delver" ? textVitalGoals : [];
    const textWardenGoals = textVitalScope === "warden" ? textVitalGoals : [];
    // Resolve split budgets: explicit split flags take priority over combined budget.
    const resolvedDungeonBudgetTokens = dungeonBudgetTokensFlag !== undefined
      ? dungeonBudgetTokensFlag
      : (delverBudgetTokensFlag !== undefined ? undefined : resolvedBudgetTokens);
    const resolvedDelverBudgetTokens = delverBudgetTokensFlag !== undefined
      ? delverBudgetTokensFlag
      : (dungeonBudgetTokensFlag !== undefined ? undefined : resolvedBudgetTokens);
    const hasSplitBudget = dungeonBudgetTokensFlag !== undefined || delverBudgetTokensFlag !== undefined;

    if (hasSplitBudget) {
      // Split-budget feasibility: check dungeon and delver sides independently.
      if (Number.isInteger(resolvedDungeonBudgetTokens) && parsedFloorTiles.length === 0 && parsedHazards.length === 0) {
        ensureBudgetedFulfillmentFeasible({
          commandName,
          budgetTokens: resolvedDungeonBudgetTokens,
          rooms: parsedRooms,
          delvers: [],
          wardens: [],
          priceListArtifact,
        });
      }
      if (Number.isInteger(resolvedDelverBudgetTokens)) {
        ensureBudgetedFulfillmentFeasible({
          commandName,
          budgetTokens: resolvedDelverBudgetTokens,
          rooms: [],
          delvers: parsedDelvers.map((entry) => ({
            ...entry,
            optimizationGoals: dedupeOptimizationGoals([
              ...(entry.optimizationGoals || []),
              ...textDelverGoals,
            ]),
          })),
          wardens: parsedWardens,
          priceListArtifact,
        });
      }
    } else if (
      Number.isInteger(resolvedBudgetTokens)
      && parsedFloorTiles.length === 0
      && parsedHazards.length === 0
      && parsedHazards.length === 0
      && parsedResources.length === 0
    ) {
      ensureBudgetedFulfillmentFeasible({
        commandName,
        budgetTokens: resolvedBudgetTokens,
        rooms: parsedRooms,
        delvers: parsedDelvers.map((entry) => ({
          ...entry,
          optimizationGoals: dedupeOptimizationGoals([
            ...(entry.optimizationGoals || []),
            ...textDelverGoals,
          ]),
        })),
        wardens: parsedWardens,
        priceListArtifact,
      });
    }

    let fulfilled;
    if (hasSplitBudget) {
      // Split-budget fulfillment: maximize each side against its own budget.
      const dungeonFulfilled = (shouldMaximizeSpend && parsedFloorTiles.length === 0 && parsedHazards.length === 0)
        ? applyBudgetCappedFulfillment({
          rooms: parsedRooms,
          delvers: [],
          priceListArtifact,
          budgetTokens: resolvedDungeonBudgetTokens,
        })
        : { rooms: parsedRooms, delvers: [] };
      const delverFulfilled = shouldMaximizeSpend && parsedWardens.length === 0
        ? applyBudgetCappedFulfillment({
          rooms: [],
          delvers: parsedDelvers.map((entry) => ({
            ...entry,
            optimizationGoals: dedupeOptimizationGoals([
              ...(entry.optimizationGoals || []),
              ...textDelverGoals,
            ]),
          })),
          priceListArtifact,
          budgetTokens: resolvedDelverBudgetTokens,
        })
        : { rooms: [], delvers: parsedDelvers };
      fulfilled = { rooms: dungeonFulfilled.rooms, delvers: delverFulfilled.delvers };
    } else {
      fulfilled = (
        shouldMaximizeSpend
        && parsedFloorTiles.length === 0
        && parsedHazards.length === 0
        && parsedHazards.length === 0
        && parsedResources.length === 0
        && parsedWardens.length === 0
      )
        ? applyBudgetCappedFulfillment({
          rooms: parsedRooms,
          delvers: parsedDelvers.map((entry) => ({
            ...entry,
            optimizationGoals: dedupeOptimizationGoals([
              ...(entry.optimizationGoals || []),
              ...textDelverGoals,
            ]),
          })),
          priceListArtifact,
          budgetTokens: resolvedBudgetTokens,
        })
        : { rooms: parsedRooms, delvers: parsedDelvers };
    }

    const summary = {
      goal: deriveGoalForAgentCommand({
        action,
        goal: args.goal,
        objects: [
          ...parsedRooms.map((entry) => ({ kind: "room" })),
          ...parsedFloorTiles.map((entry) => ({ kind: "floor_tile" })),
          ...canonicalHazardEntries.map((entry) => ({ kind: "hazard" })),
          ...parsedResources.map((entry) => ({ kind: "resource" })),
          ...parsedDelvers.map((entry) => ({ kind: "delver" })),
          ...parsedWardens.map((entry) => ({ kind: "warden" })),
        ],
      }),
      dungeonAffinity,
      rooms: fulfilled.rooms.map((entry) => entry.value),
      actors: [...fulfilled.delvers.map((entry) => entry.value), ...parsedWardens.map((entry) => entry.value)],
      poolWeights: buildPoolWeightsForAuthoredKinds({
        // No room, floor tile or hazard is a budget scaffold (no floor); a hazard needs a room.
        carvesLevel: canonicalHazardEntries.length > 0,
        rooms: fulfilled.rooms,
        floorTiles: parsedFloorTiles,
        // Was written twice, `parsedHazards` then `canonicalHazardEntries`. Inert here only
        // by coincidence: `canonicalHazardEntries` IS `parsedHazards` (same binding, line
        // ~4809), so the two keys held the same reference. The last one wins regardless.
        hazards: canonicalHazardEntries,
        resources: parsedResources,
        delvers: fulfilled.delvers,
        wardens: parsedWardens,
        tacticPools: tacticDirector.tacticBudgetPools(tactics),
      }),
    };
    if (levelGrade) {
      summary.poolWeights = gradeAllocator.pricing.levelGradePoolWeights(summary.poolWeights, levelGrade.grade);
      summary.grade = levelGrade.grade;
    }
    if (parsedRooms.length === 0 && parsedFloorTiles.length === 0 && parsedHazards.length === 0) {
      summary.budgetScaffold = true;
    }
    if (resolvedBudgetTokens !== undefined) {
      summary.budgetTokens = resolvedBudgetTokens;
    }
    if (dungeonBudgetTokensFlag !== undefined) {
      summary.dungeonBudgetTokens = dungeonBudgetTokensFlag;
    }
    if (delverBudgetTokensFlag !== undefined) {
      summary.delverBudgetTokens = delverBudgetTokensFlag;
    }

    const sharedConfig = {
      dungeonAffinity,
      budgetTokens: resolvedBudgetTokens,
      roomCount: fulfilled.rooms.reduce((sum, entry) => sum + entry.value.count, 0) || undefined,
      constraints: authoringConstraints,
      optimizationGoals: sharedOptimizationGoals.length > 0 ? sharedOptimizationGoals : undefined,
    };
    Object.keys(sharedConfig).forEach((key) => {
      if (sharedConfig[key] === undefined) delete sharedConfig[key];
    });

    const objectRequests = [
      ...fulfilled.rooms.map((entry) => ({
        kind: "room",
        prompt: entry.prompt,
        count: entry.value.count,
        attributes: {
          size: entry.value.size,
          affinity: entry.value.affinity,
          affinities: entry.value.affinities,
        },
      })),
      ...parsedFloorTiles.map((entry) => ({
        kind: "floor_tile",
        prompt: entry.prompt,
        count: entry.value.count,
        id: entry.value.id,
        attributes: {
          count: entry.value.count,
        },
      })),
      ...parsedHazards.map((entry) => ({
        kind: "hazard",
        prompt: entry.prompt,
        id: entry.value.id,
        attributes: {
          affinity: entry.value.affinity,
          expression: entry.value.expression,
          proximityRadius: entry.value.proximityRadius,
          affinityStacks: entry.value.affinityStacks,
          vitals: entry.value.vitals,
        },
      })),
      ...parsedResources.map((entry) => ({
        kind: "resource",
        prompt: entry.prompt,
        id: entry.value.id,
        attributes: {
          tier: entry.value.tier,
          stat: entry.value.stat,
          delta: entry.value.delta,
          dropRate: entry.value.dropRate,
        },
      })),
      ...fulfilled.delvers.map((entry) => ({
        kind: "delver",
        prompt: entry.prompt,
        id: entry.value.id,
        count: entry.value.count,
        attributes: {
          affinity: entry.value.affinity,
          motivations: entry.value.motivations,
          affinities: entry.value.affinities,
          vitals: entry.value.vitals,
          setupMode: entry.value.setupMode,
        },
        optimizationGoals: dedupeOptimizationGoals([
          ...(entry.optimizationGoals || []),
          ...textDelverGoals,
        ]),
      })),
      ...parsedWardens.map((entry) => ({
        kind: "warden",
        prompt: entry.prompt,
        id: entry.value.id,
        count: entry.value.count,
        attributes: {
          affinity: entry.value.affinity,
          motivations: entry.value.motivations,
          affinities: entry.value.affinities,
          vitals: entry.value.vitals,
        },
        optimizationGoals: dedupeOptimizationGoals(textWardenGoals),
      })),
    ];
    objectRequests.forEach((entry) => {
      if (!entry.optimizationGoals || entry.optimizationGoals.length === 0) {
        delete entry.optimizationGoals;
      }
    });
    if (Object.keys(sharedConfig).length > 0) {
      objectRequests.push({
        kind: "shared_config",
        prompt: isNonEmptyString(args.text) ? args.text.trim() : `shared config for ${commandName}`,
        attributes: { ...sharedConfig },
      });
    }

    const requestArtifact = buildAgentCommandRequestArtifact({
      action,
      commandText: describeAgentCommandText({ action, text: args.text, objects: objectRequests }),
      runId,
      createdAt,
      objectRequests,
      sharedConfig,
    });
    const authoring = buildAuthoringSection({
      objectKinds: Array.from(new Set(objectRequests.map((entry) => entry.kind))),
      request: requestArtifact,
      constraints: authoringConstraints,
      sharedOptimizationGoals,
      objectOptimizationGoals: objectRequests.flatMap((entry) => entry.optimizationGoals || []),
    });

    return {
      runId,
      createdAt,
      resolvedBudgetTokens,
      tacticPlan,
      requestArtifact,
      hazards: canonicalHazardEntries,
      resources: parsedResources,
      buildInput: {
      summary,
      authoring,
      requestArtifact,
      commandName,
      runId,
      createdAt,
      budgetArtifact,
      priceListArtifact,
      rooms: parsedRooms,
      floorTiles: parsedFloorTiles,
      hazards: canonicalHazardEntries,
      resources: parsedResources.map((entry) => entry.value),
      maximizeBudget: shouldMaximizeSpend,
      parsedDelvers,
      parsedWardens,
      placement: placementConstraints,
      tactics,
      ...(buildSeed !== undefined ? { seed: buildSeed } : {}),
      },
    };
  }

  return {
    applyBudgetCappedFulfillment,
    assertSchema,
    buildAuthoringSection,
    buildPoolWeightsForAuthoredKinds,
    buildSharedOptimizationGoals,
    configurator,
    dedupeOptimizationGoals,
    ensureBudgetedFulfillmentFeasible,
    extractBudgetTokensFromText,
    gradeAllocator,
    isNonEmptyString,
    parseActorStrategy,
    parseDelverSpecs,
    parseHazardSpecs,
    parsePositiveIntStrict,
    parseResourceSpecs,
    parseRoomSpecs,
    parseWardenSpecs,
    prepareAuthoringBuild,
    resolveAuthoringBudget,
    resolveTextVitalOptimizationGoals,
    tacticDirector,
  };
}
