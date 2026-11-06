/**
 * The game's element VOCABULARY: affinity kinds, expressions, vitals and motivations.
 *
 * These are framework contracts (the rules stay in agent-kernel; Darren, 2026-11-06, #740).
 * Personas and the runner import them from here. The SKIN (palette, element visuals, asset
 * and icon ids) is `game-elements.js`, which re-exports this vocabulary for compatibility
 * and is the part the game may restyle. Charter -> "Framework vs Game".
 */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

export const GAME_AFFINITY_KINDS = Object.freeze([
  "fire",
  "water",
  "earth",
  "wind",
  "growth",
  "decay",
  "corrode",
  "fortify",
  "light",
  "dark",
]);

export const GAME_AFFINITY_EXPRESSIONS = Object.freeze(["push", "pull", "emit", "draw"]);
export const GAME_VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability"]);

export const GAME_MOTIVATION_FAMILIES = deepFreeze({
  mobility: ["random", "stationary", "exploring", "patrolling", "escorting"],
  posture: ["attacking", "defending", "stealthy", "friendly"],
  cognition: ["reflexive", "goal_oriented", "strategy_focused"],
  control: ["user_controlled", "ai_controlled"],
});

// THE ORDER IS CORE'S CODE: kind n here is core-ts `MotivationKind` n + 1, and callers map
// by index. The first twelve run family by family; a kind added later is APPENDED in the
// order it was added (#251), never slotted into its family, or every later code shifts.
const MOTIVATION_KINDS_ADDED_LATER = Object.freeze(["escorting", "ai_controlled"]);

export const GAME_MOTIVATION_KINDS = Object.freeze([
  ...[
    ...GAME_MOTIVATION_FAMILIES.mobility,
    ...GAME_MOTIVATION_FAMILIES.posture,
    ...GAME_MOTIVATION_FAMILIES.cognition,
    ...GAME_MOTIVATION_FAMILIES.control,
  ].filter((kind) => !MOTIVATION_KINDS_ADDED_LATER.includes(kind)),
  ...MOTIVATION_KINDS_ADDED_LATER,
]);

export const GAME_MOTIVATION_KIND_IDS = deepFreeze(
  Object.fromEntries(GAME_MOTIVATION_KINDS.map((kind) => [kind, `motivation_${kind}`])),
);

export const GAME_MOTIVATION_DISPLAY_GROUPS = deepFreeze([
  { id: "mobility_random_stationary", kinds: ["random", "stationary"] },
  { id: "mobility_exploring_patrolling", kinds: ["exploring", "patrolling"] },
  { id: "mobility_escorting", kinds: ["escorting"] },
  { id: "posture_attacking_defending", kinds: ["attacking", "defending"] },
  { id: "posture_stealthy_friendly", kinds: ["stealthy", "friendly"] },
  { id: "cognition_reflexive_goal_oriented", kinds: ["reflexive", "goal_oriented"] },
  { id: "cognition_strategy_focused", kinds: ["strategy_focused"] },
  { id: "control_user_controlled", kinds: ["user_controlled"] },
  { id: "control_ai_controlled", kinds: ["ai_controlled"] },
]);
