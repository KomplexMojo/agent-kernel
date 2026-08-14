// Moderator-owned tick ordering policy (CR.5).
//
// The charter assigns "ordering" to the Moderator: "So tick semantics are policy,
// not accidents of the runner loop." Until CR.5 this order lived in the runner as
// a private DEFAULT_PERSONA_ORDER constant plus a local orderPersonas() helper, so
// production picked an execution order without ever consulting the persona that
// supposedly owns it.
//
// This module is the SINGLE origin of that order. It is pure: names in, names out,
// no IO, no clock, no persona instances. The runner maps the returned names back to
// the registry it holds and registers in exactly that order.
//
// Order is load-bearing, not cosmetic — the tick orchestrator keeps personas in a
// Map and iterates it in insertion order, so this decides both the order personas
// advance in and the order their actions and effects accumulate.

export const MODERATOR_PERSONA_ORDER = Object.freeze([
  "orchestrator",
  "director",
  "configurator",
  "allocator",
  "actor",
  "moderator",
  "annotator",
]);

/**
 * Order the personas a runtime holds.
 *
 * Names the Moderator recognises come first, in canonical order. Anything else
 * follows in the order it was supplied — an unrecognised persona is not dropped,
 * because dropping it would silently remove a participant from the tick.
 *
 * @param {{ personaNames?: string[] }} params
 * @returns {string[]} the names, in the order they must advance
 */
export function planPersonaOrder({ personaNames = [] } = {}) {
  const supplied = Array.isArray(personaNames) ? personaNames : [];
  const present = new Set(supplied);
  const ordered = [];

  for (const name of MODERATOR_PERSONA_ORDER) {
    if (present.has(name)) {
      ordered.push(name);
    }
  }
  const known = new Set(ordered);
  for (const name of supplied) {
    if (!known.has(name)) {
      ordered.push(name);
    }
  }
  return ordered;
}
