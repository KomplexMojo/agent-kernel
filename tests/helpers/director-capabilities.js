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
 * ✅ **NOW REACHES THE CONTROLLER, as this note asked (CR.7 / WP-5, 2026-08-12).** It used to
 * import the Director's INTERNAL `summary-selections.js`, because
 * `extractSummaryFromCardSet` was not published on the controller — deliberately, pending
 * D8.3, with the instruction "when D8.3 publishes it, change both together".
 *
 * ⚠️ **D8.3 SHIPPED (`7bdd1c8b`) AND THE PUBLICATION NEVER HAPPENED**, so this helper and
 * `commands/card-authoring.js` both went on reaching for an internal on a promise nothing was
 * tracking. `director.resolveSummary` is now published and both moved in one diff — which is
 * what "change both together" meant. ⇒ *A deferral whose trigger is another milestone needs
 * something that fails when that milestone lands; a comment is not that.*
 *
 * `resolveSummary` also fetches the Configurator's room geometry itself now, so this helper no
 * longer assembles the `deriveRoomLayout`/`buildRoomDesign` pair by hand.
 */
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const DIRECTOR_PERSONA = pathToFileURL(
  resolve(__dirname, "../../packages/runtime/src/personas/director/persona.js"),
).href;

let cached = null;

/** The Director's card-set → summary translation, as the ledger's `resolveSummary`. */
async function directorResolveSummary() {
  if (!cached) {
    const { createDirectorPersona } = await import(DIRECTOR_PERSONA);
    // Bound exactly as `commands/card-authoring.js` binds it in production: from the PUBLIC
    // barrel, with no round opened, because `resolveSummary` is ungated — it reads a card set
    // the caller already holds. The Director fetches the Configurator's room geometry itself
    // (D8.3), so nothing is assembled here; a ledger built from room cards is the common case.
    cached = createDirectorPersona({ clock: () => "2026-08-08T00:00:00.000Z" }).resolveSummary;
  }
  return cached;
}

module.exports = {
  directorResolveSummary,
};
