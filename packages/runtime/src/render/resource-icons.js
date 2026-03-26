const TYPE_ICON_MAP = Object.freeze({
  room: "🏛️",
  delver: "🗝️",
  warden: "🏰",
  untyped: "◻️",
});

const AFFINITY_ICON_MAP = Object.freeze({
  fire: "🔥",
  water: "💧",
  earth: "🪨",
  wind: "🌪️",
  life: "🌿",
  decay: "🧪",
  corrode: "🧫",
  fortify: "🧱",
  light: "🌟",
  dark: "🌑",
});

const EXPRESSION_ICON_MAP = Object.freeze({
  push: "⬆️",
  pull: "⬇️",
  emit: "📡",
  draw: "🌀",
});

const MOTIVATION_ICON_MAP = Object.freeze({
  random: "🎲",
  stationary: "🧱",
  exploring: "🧭",
  attacking: "⚔️",
  defending: "🛡️",
  patrolling: "👣",
  reflexive: "⚡",
  goal_oriented: "🎯",
  strategy_focused: "♟️",
});

const VITAL_ICON_MAP = Object.freeze({
  health: "❤️",
  mana: "🔷",
  stamina: "👟",
  durability: "🛡️",
});

const REASONING_CLASS_ICON_MAP = Object.freeze({
  strategic: "♟️",
  tactical: "🎯",
  instinctual: "⚡",
});

function normalizeResourceKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function getCardTypeIcon(type) {
  const normalized = normalizeResourceKey(type);
  return TYPE_ICON_MAP[normalized] || TYPE_ICON_MAP.untyped;
}

export function getAffinityIcon(kind) {
  const normalized = normalizeResourceKey(kind);
  return AFFINITY_ICON_MAP[normalized] || "◈";
}

export function getExpressionIcon(expression) {
  const normalized = normalizeResourceKey(expression);
  return EXPRESSION_ICON_MAP[normalized] || "✦";
}

export function getMotivationIcon(motivation) {
  const normalized = normalizeResourceKey(motivation);
  return MOTIVATION_ICON_MAP[normalized] || "❖";
}

export function getVitalIcon(vital) {
  const normalized = normalizeResourceKey(vital);
  return VITAL_ICON_MAP[normalized] || "◦";
}

export function getReasoningClassIcon(reasoningClass) {
  const normalized = normalizeResourceKey(reasoningClass);
  return REASONING_CLASS_ICON_MAP[normalized] || REASONING_CLASS_ICON_MAP.instinctual;
}
