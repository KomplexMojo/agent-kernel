/**
 * The Configurator capabilities the Allocator needs injected (CR.9 M2/M3).
 *
 * The Allocator refuses to price room geometry, to assemble candidate cards, or to
 * normalize raw motivations without them — deliberately, with no default, because a
 * second silently-diverging author of a chartered Configurator decision is the CR.1
 * defect class and would be invisible in a well-formed price.
 *
 * Tests that exercise the pricing surface therefore have to wire what production
 * wires. This helper exists so they wire the SAME thing: a hand-rolled stub in a test
 * would be exactly the second implementation the refusal exists to prevent, and it
 * would drift silently. Everything here comes from the Configurator's real public
 * persona surface.
 */
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const CONFIGURATOR_PERSONA = pathToFileURL(
  resolve(__dirname, "../../packages/runtime/src/personas/configurator/persona.js"),
).href;

const CAPABILITY_CLOCK = () => "2026-08-04T00:00:00.000Z";

let cached = null;
let roomGeometry = null;

/** `{ deriveRoomLayout, authorCandidates, normalizeMotivations }` from a real Configurator. */
async function configuratorCapabilities() {
  if (!cached) {
    const { createConfiguratorPersona } = await import(CONFIGURATOR_PERSONA);
    const configurator = createConfiguratorPersona({ clock: CAPABILITY_CLOCK });
    cached = {
      deriveRoomLayout: configurator.deriveRoomLayout,
      authorCandidates: configurator.authorCandidates,
      normalizeMotivations: configurator.normalizeMotivations,
    };
  }
  return cached;
}

/** Just the motivation vocabulary — the common case for pricing-surface tests. */
async function configuratorNormalizeMotivations() {
  return (await configuratorCapabilities()).normalizeMotivations;
}

/**
 * `{ deriveRoomLayout, buildRoomDesign }` — what the DIRECTOR needs to resolve a card set
 * containing room cards (D8.3).
 *
 * Same rule as everything else here: tests wire what production wires. `ui-flow.js`,
 * `card-authoring.js`, `ak-impl.mjs` and the Director persona itself all build this exact
 * pair off `createConfiguratorPersona`, so a test that hand-rolled a stub would be the
 * second author of room geometry that `DirectorRoomGeometryError` exists to prevent.
 */
async function configuratorRoomGeometry() {
  if (!roomGeometry) {
    const { createConfiguratorPersona } = await import(CONFIGURATOR_PERSONA);
    const configurator = createConfiguratorPersona({ clock: CAPABILITY_CLOCK });
    roomGeometry = Object.freeze({
      deriveRoomLayout: configurator.deriveRoomLayout,
      buildRoomDesign: configurator.buildRoomDesign,
    });
  }
  return roomGeometry;
}

module.exports = {
  configuratorCapabilities,
  configuratorNormalizeMotivations,
  configuratorRoomGeometry,
};
