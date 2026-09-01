import { createConfiguratorStateMachine, ConfiguratorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildSolverRequestEffect } from "../_shared/persona-helpers.mts";
import { attachConfiguratorServices } from "./configurator-services.js";

export const configuratorSubscribePhases = Object.freeze([TickPhases.INIT, TickPhases.OBSERVE]);

export function createConfiguratorPersona({ initialState = ConfiguratorStates.UNINITIALIZED, clock, from } = {}) {
  const fsm = createConfiguratorStateMachine({ initialState, clock, from });
  const services = attachConfiguratorServices({ fsm });

  function view() {
    const snapshot = fsm.view();
    return { ...snapshot, context: { ...snapshot.context, ...services.serviceContext() } };
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!configuratorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const effects = [];
    const solverEffect = buildSolverRequestEffect({
      solverRequest: payload.solver || payload.solverRequest,
      intentRef: payload.intentRef,
      planRef: payload.planRef,
      personaRef: "configurator",
      targetAdapter: payload.targetAdapter,
    });
    if (solverEffect) {
      effects.push(solverEffect);
      result.context = { ...result.context, lastSolverRequest: solverEffect.request };
    }
    return {
      ...result,
      tick,
      actions: [],
      effects,
      telemetry: null,
    };
  }

  return {
    subscribePhases: configuratorSubscribePhases,
    advance,
    view,
    provideConfig: services.provideConfig,
    prepareLevelGen: services.prepareLevelGen,
    mapResources: services.mapResources,
    validate: services.validate,
    lock: services.lock,
    lockedConfig: services.lockedConfig,
    deriveRoomLayout: services.deriveRoomLayout,
    // CR.4 M5b.2f — layout feasibility, reached through the Director on the budget loop's
    // behalf (Option 1: the loop's sole counterpart is the Director).
    assessFeasibility: services.assessFeasibility,
    // D8.3 — the Director asks for room SHAPE instead of deriving it from card sizes itself.
    buildRoomDesign: services.buildRoomDesign,
    authorCandidates: services.authorCandidates,
    // configurator/actors (2026-08-18) — a build/run request's delver roster entry.
    authorDelverCandidate: services.authorDelverCandidate,
    normalizeMotivations: services.normalizeMotivations,
    // CR.7 / WP-5 — the BUILD-PLANE helpers. `orchestrate-build.js`, `kernel.js` and
    // `mixed-room-summary.js` imported these seven modules directly and were 11 allowlist rows.
    // Ungated, like `deriveRoomLayout` above: pure functions of their arguments that stamp no
    // provenance. See the import-block note in configurator-services.js.
    generateGridLayoutFromInput: services.generateGridLayoutFromInput,
    buildSimConfigArtifact: services.buildSimConfigArtifact,
    buildInitialStateArtifact: services.buildInitialStateArtifact,
    resolveAffinityEffects: services.resolveAffinityEffects,
    normalizeAffinityRulesArtifact: services.normalizeAffinityRulesArtifact,
    resolveAffinityRules: services.resolveAffinityRules,
    // AM.5 — the authored per-cast mana price, needed on the tick plane.
    resolveAffinityManaCost: services.resolveAffinityManaCost,
    buildAmbientAffinityPressure: services.buildAmbientAffinityPressure,
    computeInternalManaUpkeep: services.computeInternalManaUpkeep,
    // RB2.1 — room-profile assignment and affinity-hazard synthesis are Configurator policy.
    composeMixedRooms: services.composeMixedRooms,
    // RB2.2 — actor grouping, role inference, and placement are Configurator policy.
    placeActors: services.placeActors,
    normalizeMotivationRulesArtifact: services.normalizeMotivationRulesArtifact,
    resolveMotivationRules: services.resolveMotivationRules,
    // CR.7 / WP-5 — the third card-model derivation; its siblings are `deriveRoomLayout` and
    // `buildRoomDesign` above, which `card-authoring.js` can now use instead of the internal.
    deriveLevelGenFromRoomCards: services.deriveLevelGenFromRoomCards,
    // CR.7 / WP-5 — level preview rendering, for the web level-builder adapter.
    buildLevelPreviewFromGuidanceSummary: services.buildLevelPreviewFromGuidanceSummary,
    buildLevelPreviewFromLevelGen: services.buildLevelPreviewFromLevelGen,
    buildLevelRenderArtifactsFromTiles: services.buildLevelRenderArtifactsFromTiles,
  };
}
