// Pure decision rules for the Gameplay tab launch flow, extracted so they can be
// unit-tested independently of main.js (the app entry point, which is not importable
// in isolation). See tests/ui-web/gameplay-launch.test.mjs.

/**
 * Envelope metadata that is regenerated on every publish whether or not the
 * design changed: a fresh `runId`/`id`, a fresh `createdAt` from the injected
 * clock, and the call site's `source` / `producedBy` label.
 *
 * These are provenance (ArtifactMeta), not design. Comparing raw spec text
 * therefore never matched across two publishes of the *same* design, which
 * silently disabled run reuse altogether — every entry into the Gameplay tab
 * rebuilt the level from the design, discarding whatever run was loaded.
 */
const VOLATILE_META_KEYS = Object.freeze(
  new Set(["id", "runId", "createdAt", "source", "producedBy"]),
);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const out = {};
  // Sorted keys: serialization order is not a design change either.
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    const isMetaBlock = key === "meta" && child && typeof child === "object" && !Array.isArray(child);
    if (!isMetaBlock) {
      out[key] = canonicalize(child);
      continue;
    }
    const meta = {};
    for (const metaKey of Object.keys(child).sort()) {
      // Nested envelopes carry their own meta (e.g. budget.budget.meta), so this
      // strips at every depth rather than only at the root.
      if (!VOLATILE_META_KEYS.has(metaKey)) meta[metaKey] = canonicalize(child[metaKey]);
    }
    out[key] = meta;
  }
  return out;
}

/**
 * The identity of a design, independent of when it was published.
 *
 * Non-JSON input is returned unchanged so callers holding an opaque token still
 * compare by equality.
 *
 * @param {string} specText
 * @returns {string} A stable key for the design, or "" when there is no spec.
 */
export function designIdentity(specText) {
  if (typeof specText !== "string" || specText.length === 0) return "";
  try {
    return JSON.stringify(canonicalize(JSON.parse(specText)));
  } catch {
    return specText;
  }
}

/**
 * Decide whether re-entering the Gameplay tab should reuse the run already loaded
 * there, or rebuild from the current design.
 *
 * The run is reused ONLY when a run is active AND the freshly published design has
 * the same identity as the design that produced the active run. Any real design
 * change (e.g. room size) yields a different identity, forcing a rebuild — that is
 * the regression this guards: editing the design must be reflected in Gameplay.
 *
 * @param {object} params
 * @param {string} params.specText - Spec text published from the current design.
 * @param {string} params.lastGameplaySpecText - Spec text of the active gameplay run.
 * @param {boolean} params.isRunActive - Whether a run is currently loaded in Gameplay.
 * @returns {boolean} true to keep the active run, false to rebuild.
 */
export function shouldReuseActiveRun({ specText, lastGameplaySpecText, isRunActive } = {}) {
  if (!isRunActive) return false;
  const current = designIdentity(specText);
  if (!current) return false;
  return current === designIdentity(lastGameplaySpecText);
}
