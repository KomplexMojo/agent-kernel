/**
 * Motivation registry: one module per kind, keyed by core\'s vocabulary.
 *
 * Adding a motivation is adding a file here plus its row in core\'s profile tables.
 * `motivation-registry-complete.test.js` fails if the two ever disagree — which is the
 * trap that let `patrolling` behave identically to `exploring` unnoticed.
 */
import attacking from "./attacking.js";
import defending from "./defending.js";
import exploring from "./exploring.js";
import friendly from "./friendly.js";
import goalOriented from "./goal-oriented.js";
import patrolling from "./patrolling.js";
import random from "./random.js";
import reflexive from "./reflexive.js";
import stationary from "./stationary.js";
import stealthy from "./stealthy.js";
import strategyFocused from "./strategy-focused.js";
import userControlled from "./user-controlled.js";

const MODULES = Object.freeze([
  attacking,
  defending,
  exploring,
  friendly,
  goalOriented,
  patrolling,
  random,
  reflexive,
  stationary,
  stealthy,
  strategyFocused,
  userControlled,
]);

export const MOTIVATION_MODULES = Object.freeze(
  Object.fromEntries(MODULES.map((m) => [m.kind, m])),
);

export function getMotivationModule(kind) {
  if (typeof kind !== "string" || !kind) return null;
  return MOTIVATION_MODULES[kind] || null;
}
