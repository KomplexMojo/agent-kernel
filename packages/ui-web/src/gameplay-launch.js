// Pure decision rules for the Gameplay tab launch flow, extracted so they can be
// unit-tested independently of main.js (the app entry point, which is not importable
// in isolation). See tests/ui-web/gameplay-launch.test.mjs.

/**
 * Decide whether re-entering the Gameplay tab should reuse the run already loaded
 * there, or rebuild from the current design.
 *
 * The run is reused ONLY when a run is active AND the freshly published design spec
 * is byte-identical to the spec that produced the active run. Any design change
 * (e.g. room size) yields a different spec, forcing a rebuild — that is the
 * regression this guards: editing the design must be reflected in Gameplay.
 *
 * @param {object} params
 * @param {string} params.specText - Spec text published from the current design.
 * @param {string} params.lastGameplaySpecText - Spec text of the active gameplay run.
 * @param {boolean} params.isRunActive - Whether a run is currently loaded in Gameplay.
 * @returns {boolean} true to keep the active run, false to rebuild.
 */
export function shouldReuseActiveRun({ specText, lastGameplaySpecText, isRunActive } = {}) {
  if (!isRunActive) return false;
  if (typeof specText !== "string" || specText.length === 0) return false;
  return specText === lastGameplaySpecText;
}
