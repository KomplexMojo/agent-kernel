/**
 * #263 — a hazard authored with no affinity gets one picked from the run seed.
 *
 * No affinity is a default (affinity-agnostic rule). A hazard's whole effect is its
 * affinity, so one authored without a kind would do nothing; Darren chose (2026-10-17)
 * that the run seed picks one of the kinds evenly instead. Design cards exist before
 * there is a run seed, so they keep "none" while authored; the Configurator names the
 * kind here, when it builds the level. The same seed builds the same level.
 */
import { AFFINITY_KINDS } from "../../contracts/domain-constants.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// One LCG step over the seed mixed with the entry's index, so each hazard draws on its
// own and every kind is equally likely.
function mix(seed, index) {
  let state = ((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  state ^= state >>> 16;
  return state >>> 0;
}

/** The kind the run seed picks for the entry at `index`. */
export function pickUnnamedAffinityKind(seed, index) {
  const base = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return AFFINITY_KINDS[mix(base, index) % AFFINITY_KINDS.length];
}

function namesKind(entry) {
  const stack = Array.isArray(entry?.affinityStacks) ? entry.affinityStacks[0] : null;
  if (isNonEmptyString(stack?.kind)) return true;
  if (isNonEmptyString(entry?.affinity)) return true;
  return isNonEmptyString(entry?.affinity?.kind);
}

/**
 * Returns the hazards with every unnamed affinity named from `seed`. Entries that name
 * a kind come back unchanged (same object).
 */
export function nameUnnamedHazardAffinities(hazards = [], { seed } = {}) {
  if (!Array.isArray(hazards)) return [];
  return hazards.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || namesKind(entry)) return entry;
    const kind = pickUnnamedAffinityKind(seed, index);
    if (entry.affinity && typeof entry.affinity === "object" && !Array.isArray(entry.affinity)) {
      return { ...entry, affinity: { ...entry.affinity, kind } };
    }
    return { ...entry, affinity: kind };
  });
}
