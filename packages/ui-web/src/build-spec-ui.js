import { normalizeBuildSpecForUi } from "../../runtime/src/commands/ui-flow.js";

export const DESIGN_HYDRATION_BUNDLE_SOURCES = Object.freeze(["file", "ipfs", "snapshot"]);

function stableCardKey(card, index) {
  const id = typeof card?.id === "string" ? card.id.trim() : "";
  if (id) return `id:${id}`;
  return `index:${index}:${JSON.stringify(card || {})}`;
}

function mergeCardArrays(...sources) {
  const merged = new Map();
  sources.forEach((cards) => {
    if (!Array.isArray(cards)) return;
    cards.forEach((card, index) => {
      if (!card || typeof card !== "object" || Array.isArray(card)) return;
      const key = stableCardKey(card, index);
      const previous = merged.get(key);
      merged.set(key, previous ? { ...previous, ...card } : { ...card });
    });
  });
  return Array.from(merged.values());
}

function poolWeightToPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function normalizeBuildSpecForEditor(specInput) {
  const normalized = normalizeBuildSpecForUi(specInput);
  const spec = normalized?.spec;
  return {
    spec,
    changed: Boolean(normalized?.changed),
    specText: spec ? JSON.stringify(spec, null, 2) : "",
  };
}

export function collectBuildSpecCardSet(specInput) {
  const { spec } = normalizeBuildSpecForEditor(specInput);
  return mergeCardArrays(
    spec?.configurator?.inputs?.cardSet,
    spec?.plan?.hints?.cardSet,
  );
}

export function extractDesignStateFromBuildSpec(specInput) {
  const { spec, changed, specText } = normalizeBuildSpecForEditor(specInput);
  const poolWeights = Array.isArray(spec?.intent?.hints?.poolWeights) ? spec.intent.hints.poolWeights : [];
  const weights = Object.fromEntries(
    poolWeights
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => [String(entry.id || ""), poolWeightToPercent(entry.weight)]),
  );

  const budgetSplitPercent = [
    weights.layout,
    weights.player,
    weights.wardens,
  ].every((value) => Number.isFinite(value))
    ? {
      room: weights.layout,
      delver: weights.player,
      warden: weights.wardens,
    }
    : null;

  return {
    spec,
    changed,
    specText,
    cards: collectBuildSpecCardSet(spec),
    budgetTokens: Number.isFinite(spec?.intent?.hints?.budgetTokens)
      ? Math.floor(spec.intent.hints.budgetTokens)
      : null,
    budgetSplitPercent,
  };
}

export function shouldHydrateDesignFromBundleSource(source) {
  return DESIGN_HYDRATION_BUNDLE_SOURCES.includes(source);
}
