/**
 * The Director capabilities the Allocator needs injected (D8 follow-up, 2026-08-08).
 *
 * `buildDesignSpendLedger` used to translate a card set into a summary itself, by
 * importing `director/summary-selections.js`. That edge pointed backwards along the
 * order D8 settled — orchestrator → director → configurator → allocator — so the
 * translation is now injected and the Allocator REFUSES without it whenever the summary
 * it is handed actually carries cards.
 *
 * Same reasoning as `configurator-capabilities.js`: tests wire what production wires,
 * from one place, because a hand-rolled stub here would be exactly the second
 * silently-diverging implementation the refusal exists to prevent.
 *
 * ⚠️ This reaches the Director's INTERNAL module rather than its controller, unlike the
 * Configurator helper. `extractSummaryFromCardSet` is not published on the controller
 * yet, and deliberately so: it is the function D8.3 is about (it calls
 * `deriveLayoutFromRoomCards` / `buildRoomDesignFromRoomCards`, the Director→Configurator
 * forward edges). Production wires it the same way, from `commands/card-authoring.js`,
 * which is an existing allowlist row. When D8.3 publishes it, change both together.
 */
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const DIRECTOR_SUMMARY_SELECTIONS = pathToFileURL(
  resolve(__dirname, "../../packages/runtime/src/personas/director/summary-selections.js"),
).href;

let cached = null;

/** The Director's card-set → summary translation, as the ledger's `resolveSummary`. */
async function directorResolveSummary() {
  if (!cached) {
    const { extractSummaryFromCardSet } = await import(DIRECTOR_SUMMARY_SELECTIONS);
    cached = extractSummaryFromCardSet;
  }
  return cached;
}

module.exports = {
  directorResolveSummary,
};
