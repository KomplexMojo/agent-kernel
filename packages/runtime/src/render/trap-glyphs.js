import { AFFINITY_COLOR_HEX, resolveStackIntensity } from "./affinity-palette.js";

export const TRAP_AFFINITY_GLYPHS = Object.freeze({
  fire: "f",
  water: "w",
  earth: "e",
  wind: "n",
  life: "l",
  decay: "d",
  corrode: "c",
  fortify: "t",
  light: "i",
  dark: "k",
});

export function normalizeTrapAffinityKind(value) {
  const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
  return kind && AFFINITY_COLOR_HEX[kind] ? kind : "";
}

export function normalizeTrapStacks(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.round(parsed));
}

export function resolveTrapGlyph(affinity = null) {
  const kind = normalizeTrapAffinityKind(affinity?.kind);
  if (!kind) return ".";
  const base = TRAP_AFFINITY_GLYPHS[kind] || ".";
  const style = resolveStackIntensity(normalizeTrapStacks(affinity?.stacks));
  return style.stacks >= 2 ? base.toUpperCase() : base;
}

export function resolveTrapGlyphMarker(affinity = null) {
  const kind = normalizeTrapAffinityKind(affinity?.kind);
  if (!kind) return null;
  const stacks = normalizeTrapStacks(affinity?.stacks);
  return {
    kind,
    stacks,
    glyph: resolveTrapGlyph({ kind, stacks }),
  };
}
