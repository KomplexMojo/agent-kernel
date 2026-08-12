/**
 * Configurator service surface — the synchronous API behind the controller.
 *
 * The Configurator owns configuration assembly, validation, and locking
 * (charter — "Persona Model — ENFORCED", Configurator row). This surface fronts
 * the persona-internal input-preparation logic (grid sizing, hazard placement,
 * resource mapping): nothing outside personas/configurator/ imports those
 * internals directly once the CLI is threaded (P2.3.1).
 *
 * Two planes, one persona (charter rule 3): the tick plane drives the FSM via
 * advance() in INIT/OBSERVE; the CONFIG plane uses this surface. Both move the
 * same state machine, so an assembly round is visible in view() exactly like a
 * tick round.
 *
 * State gating mirrors the Allocator's registerBudget → validateSpend and the
 * Director's beginBuild → mapPool → assembleBuildSpec:
 *   provideConfig(config)      uninitialized → pending_config
 *   prepareLevelGen(...)       requires a config (pending_config | configured)
 *   mapResources(...)          requires a config (pending_config | configured)
 *   validate()                 pending_config → configured, ONLY if the config passes
 *   lock()                     configured → locked, publishing a frozen snapshot
 *
 * CR.2 (2026-07-29) made the last two real. Both were requireState +
 * fsm.advance + return, and the production authoring path called NEITHER, so
 * "configuration assembly, validation, locking" was two thirds labels — which
 * the charter names a defect. validate() now runs config-validation.js and
 * refuses without moving the FSM; lock() publishes an immutable versioned
 * snapshot via lockedConfig().
 *
 * Shared by controller.js and controller.mts so the two entry points cannot
 * drift.
 */
import { ConfiguratorStates } from "./state-machine.js";
import { prepareLevelGen as prepareLevelGenInput, mapResources as mapResourcesInput } from "./input-preparation.js";
import { validateConfiguratorConfig } from "./config-validation.js";
import { buildRoomDesignFromRoomCards, deriveLayoutFromRoomCards } from "./card-model.js";
import { normalizeMotivations } from "./motivation-loadouts.js";
import { assessLayoutFeasibility } from "./feasibility.js";
import {
  assessDelverStructure,
  buildBudgetEnvelope,
  buildMinimumDelverCard,
  cloneVitals,
  proposeDelverCandidates,
  proposeRoomCandidates,
  reviseDelverCandidate,
} from "./candidate-authoring.js";
import { maximizeActorBudget } from "./budget-maximizer.js";
/**
 * CR.7 / WP-5 — the BUILD-PLANE helpers, published so glue stops reaching past the persona.
 *
 * `build/orchestrate-build.js`, `commands/kernel.js` and `build/mixed-room-summary.js` imported
 * these seven modules directly and were 11 of the allowlist's live rows. Level geometry, affinity
 * resolution, ambient pressure, mana upkeep and motivation rules are all Configurator law; the
 * charter names those three files glue, and glue holds no domain logic.
 *
 * Re-exported under their own names rather than renamed. The Director's card-set surface was
 * renamed because `deriveLevelGen` was ambiguous between two functions; these names are already
 * unambiguous, so a second name would be a second thing to keep in step for no gain.
 *
 * ⚠️ UNGATED, like `deriveRoomLayout` and `assessFeasibility`. Every one is a pure function of its
 * arguments: they read a config the caller already holds and stamp no provenance of their own —
 * `buildSimConfigArtifact` and `buildInitialStateArtifact` take `meta` FROM the caller, so the
 * persona is assembling an artifact, not authoring one with no round behind it. Gating them would
 * refuse the build path that has always called them and issue no decision in exchange.
 */
import { generateGridLayoutFromInput } from "./level-layout.js";
import { buildSimConfigArtifact, buildInitialStateArtifact } from "./artifact-builders.js";
import { resolveAffinityEffects } from "./affinity-effects.js";
import { normalizeAffinityRulesArtifact, resolveAffinityRules } from "./affinity-rules.js";
import { buildAmbientAffinityPressure } from "./affinity-pressure.js";
import { computeInternalManaUpkeep } from "./cost-model.js";
import { normalizeMotivationRulesArtifact, resolveMotivationRules } from "./motivation-rules.js";

export class ConfiguratorStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfiguratorStateError";
    this.code = "configurator_state";
  }
}

/** Raised when validate() rejects the assembled config. Carries every problem. */
export class ConfiguratorValidationError extends Error {
  constructor(errors) {
    super(`Configurator rejected the config: ${errors.join("; ")}`);
    this.name = "ConfiguratorValidationError";
    this.code = "configurator_invalid";
    this.errors = errors;
  }
}

/**
 * The Configurator takes its own copy of a provided config (CR.2): it stored
 * the caller's object by reference, so the config it "validated" and "locked"
 * was whatever the caller had since mutated it into. That matters here because
 * glue genuinely does keep writing to spec.configurator.inputs after the
 * assembly round — orchestrate-build.js writes affinityRules, motivationRules
 * and actors back into it. A copy makes the locked snapshot a record of what
 * the Configurator actually approved.
 *
 * Serializability is charter law for persona context, so a config that cannot
 * round-trip is a structured error rather than a silent partial clone.
 */
function cloneConfig(config) {
  try {
    return structuredClone(config);
  } catch (error) {
    throw new ConfiguratorStateError(
      `provideConfig requires a serializable config object (${error.message}).`,
    );
  }
}

/** Recursively freeze a plain-data config so the published lock cannot drift. */
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

/** States in which a config exists and assembly may proceed. */
const CONFIGURING_STATES = Object.freeze([
  ConfiguratorStates.PENDING_CONFIG,
  ConfiguratorStates.CONFIGURED,
]);

export function attachConfiguratorServices({ fsm } = {}) {
  let config = null;
  let levelGenPrepared = 0;
  let resourcesMapped = 0;
  let serviceValidated = false;
  let lockedSnapshot = null;
  let configVersion = 0;

  const currentState = () => fsm.view().state;

  function requireState(allowed, operation) {
    const state = currentState();
    if (!allowed.includes(state)) {
      const hint = state === ConfiguratorStates.UNINITIALIZED
        ? " Call provideConfig(config) first."
        : "";
      throw new ConfiguratorStateError(
        `Configurator cannot ${operation} in state "${state}" (requires ${allowed.join("|")}).${hint}`,
      );
    }
  }

  /** Opens an assembly round: uninitialized → pending_config. */
  function provideConfig(providedConfig, { configRef } = {}) {
    requireState([ConfiguratorStates.UNINITIALIZED], "provide a config");
    if (!providedConfig || typeof providedConfig !== "object") {
      throw new ConfiguratorStateError("provideConfig requires a config object.");
    }
    config = cloneConfig(providedConfig);
    fsm.advance("provide_config", { config, configRef });
    return { state: currentState() };
  }

  /**
   * Size the grid to fit authored rooms/floor tiles/hazards; attach hazards.
   * The result is recorded on the persona's own config so validate()/lock()
   * judge the assembled output rather than depending on the caller assigning
   * the return value back onto a shared object.
   */
  function prepareLevelGen(args = {}) {
    requireState(CONFIGURING_STATES, "prepare level-gen input");
    const levelGen = prepareLevelGenInput(args);
    config.levelGen = levelGen;
    levelGenPrepared += 1;
    return levelGen;
  }

  /** Map authored resource values onto the configurator resource-input shape. */
  function mapResources(resources = []) {
    requireState(CONFIGURING_STATES, "map resources");
    const mapped = mapResourcesInput(resources);
    config.resources = mapped;
    resourcesMapped += 1;
    return mapped;
  }

  /**
   * Close assembly: pending_config → configured, but only if the assembled
   * config actually passes its structural and invariant checks (CR.2). A
   * rejection must not move the FSM — otherwise the refusal is cosmetic.
   */
  function validate() {
    requireState([ConfiguratorStates.PENDING_CONFIG], "validate the config");
    const result = validateConfiguratorConfig(config);
    if (!result.ok) {
      throw new ConfiguratorValidationError(result.errors);
    }
    fsm.advance("validate", { config });
    serviceValidated = true;
    return { state: currentState() };
  }

  /**
   * Freeze the round: configured → locked, publishing an immutable versioned
   * snapshot of the approved config. Downstream consumers get a record of what
   * the Configurator signed off, which cannot drift when glue keeps editing the
   * spec afterwards.
   */
  function lock() {
    requireState([ConfiguratorStates.CONFIGURED], "lock the config");
    fsm.advance("lock", {});
    configVersion += 1;
    lockedSnapshot = deepFreeze(cloneConfig(config));
    return { state: currentState(), config: lockedSnapshot, version: configVersion };
  }

  /** The published locked config, or null before lock(). */
  function lockedConfig() {
    return lockedSnapshot;
  }

  /**
   * Serializable service-side context merged into the persona view.
   *
   * `validated` and `locked` are the CONJUNCTION of "this surface did the work" and
   * "the FSM is in the matching state". Neither half alone is honest:
   *
   *   - Deriving from FSM state alone LIES. There are two independent paths into
   *     this FSM — `advance({event: "validate"})` reaches it directly, and the tick
   *     plane uses exactly that (runtime-fsm.mjs walks provide_config → validate →
   *     lock as raw FSM events). So a malformed config can reach `locked` with no
   *     check performed, and a state-derived flag reports `validated: true` for it.
   *     An earlier version of this function did precisely that; see finding PX.5.
   *   - A tracked flag alone goes STALE. `update_config` (configured →
   *     pending_config) would leave `validated` true after the round reopened.
   *
   * The conjunction is correct in both directions and needs no event hook.
   */
  function serviceContext() {
    const state = currentState();
    const configured = state === ConfiguratorStates.CONFIGURED || state === ConfiguratorStates.LOCKED;
    return {
      hasConfig: config != null,
      levelGenPrepared,
      resourcesMapped,
      validated: serviceValidated && configured,
      locked: lockedSnapshot != null && state === ConfiguratorStates.LOCKED,
      configVersion,
    };
  }

  /**
   * Derive room geometry from a card set: `{ floorTiles, connectorFloorTiles,
   * billableFloorTiles }`, or null when the set holds no room cards.
   *
   * CR.9 M2. The Allocator has to price room layouts, and it used to reach into
   * `configurator/card-model.js` to work out how many tiles a card set is — reading
   * the SIZE -> LAYOUT table (small 24, medium 48, large 96) that `card-model.js`
   * explicitly records as Configurator geometry, not shared vocabulary. That is a
   * persona computing structure it does not own, purely to have something to charge
   * for.
   *
   * Publishing it here makes the Allocator a CONSUMER of the geometry instead of a
   * second author of it, and the capability is INJECTED into the Allocator at the
   * composition root — the same shape as CR.6's `admitProposals` going the other way
   * (`createActorPersona({ admitProposals: allocator.admitProposals })`). Stateless
   * and ungated on purpose: it reads a card set the caller already holds and touches
   * no FSM state, so gating it behind provideConfig would be a label, not a rule.
   */
  function deriveRoomLayout(cardSet) {
    return deriveLayoutFromRoomCards(cardSet);
  }

  /**
   * Room SHAPE from a card set: `{ roomCount, roomMinSize, roomMaxSize, corridorWidth,
   * rooms }`, or null when the set holds no room cards.
   *
   * D8.3, 2026-08-08 — the sibling of `deriveRoomLayout`, published for the same reason
   * one milestone later. `director/summary-selections.js` imported
   * `card-model.js#buildRoomDesignFromRoomCards` and stamped the result into the summary
   * it was resolving, which made the Director a second author of the SIZE → LAYOUT table
   * (small 3–5, medium 5–8, large 8–12) that `card-model.js` records as Configurator
   * geometry. Identical defect to CR.9 M2's, in the last remaining leg of the
   * Director↔Configurator cycle.
   *
   * `deriveRoomLayout` answers "how many tiles"; this answers "what shape". They are
   * separate questions with separate callers — the Allocator prices tiles and never asks
   * for shape — so they are published separately rather than bundled.
   *
   * Stateless and ungated, exactly like `deriveRoomLayout` and `authorCandidates`: it
   * reads a card set the caller already holds, touches no FSM state and issues no
   * artifact. Gating it behind `provideConfig` would be a label, not a rule.
   */
  function buildRoomDesign(cardSet, options) {
    return buildRoomDesignFromRoomCards(cardSet, options);
  }

  /**
   * CR.4 M5b.2f — "can this level host these actors?"
   *
   * `llm-budget-loop.js` answered this itself, importing `feasibility.js` for the two
   * `validateLayout*` entry points AND choosing between them by a 1,000,000-tile threshold
   * it owned. The choice was the part that mattered: above it the Orchestrator decided what
   * "feasible" means with an approximation of this persona's law.
   *
   * The caller passes `levelGen` rather than a `roomCount` — deriving level geometry from an
   * intent is the Director's translation, and asking the Director for it from here would be
   * a reverse edge, the leg D8.1 removed.
   *
   * Stateless and ungated, like `deriveRoomLayout` and `authorCandidates`: it judges the
   * layout it is handed against the actor count it is handed, touching no FSM state and
   * issuing no artifact. Gating it behind `provideConfig` would be a label.
   */
  function assessFeasibility(args) {
    return assessLayoutFeasibility(args);
  }

  /**
   * The candidate-authoring surface the Allocator's budget maximizer consumes (CR.9
   * M3). Assembly, structural validity and enumeration order all live behind here;
   * the Allocator receives it injected and prices what it is given.
   *
   * Stateless and ungated for the same reason `deriveRoomLayout` is: these are pure
   * functions of a card the caller already holds, touching no FSM state, so gating
   * them behind provideConfig would be a label rather than a rule — and the charter
   * calls label-only states a defect.
   */
  const authorCandidates = Object.freeze({
    buildBudgetEnvelope,
    proposeDelverCandidates,
    reviseDelverCandidate,
    proposeRoomCandidates,
    assessDelverStructure,
    buildMinimumDelverCard,
    /**
     * "What are this card's vitals, with defaults applied?" — a question about card
     * shape, which is why the Allocator asks it rather than answering it. It priced
     * cards through its own copy of this before M3.
     */
    readCardVitals: cloneVitals,
    /**
     * Scale authored actors to exhaust an unspent budget (WP-5/D10).
     *
     * Published so `build/orchestrate-build.js` stops importing
     * `configurator/budget-maximizer.js` directly. Scaling a card's vitals is
     * authoring, which is why it is the Configurator's to do — but the PRICES it
     * scales against are the Allocator's, so the caller passes
     * `createAllocatorPersona().pricing` output in. The maximizer refuses to run
     * on an unpriced vital rather than assuming a number.
     */
    maximizeActorBudget,
  });

  return {
    provideConfig,
    prepareLevelGen,
    mapResources,
    validate,
    lock,
    lockedConfig,
    deriveRoomLayout,
    buildRoomDesign,
    // CR.4 M5b.2f — the layout feasibility verdict the budget loop used to reach by
    // importing `feasibility.js`, threshold and all.
    assessFeasibility,
    authorCandidates,
    /**
     * Motivation vocabulary, published so the Allocator stops importing it (CR.9 M3).
     *
     * The candidate path above hands over motivations already normalized, which is the
     * real fix. This exists for the pricing paths that still receive RAW actor data
     * straight from glue — spend ledgers, selection spend, `commands/card-authoring.js`
     * — where the normalization is load-bearing and dropping it would change prices.
     * Those callers now get the Configurator's own function rather than the Allocator
     * owning a second copy of the exclusive-group rules.
     */
    normalizeMotivations,
    // CR.7 / WP-5 — the build-plane helpers; see the import block for why they are ungated.
    generateGridLayoutFromInput,
    buildSimConfigArtifact,
    buildInitialStateArtifact,
    resolveAffinityEffects,
    normalizeAffinityRulesArtifact,
    resolveAffinityRules,
    buildAmbientAffinityPressure,
    computeInternalManaUpkeep,
    normalizeMotivationRulesArtifact,
    resolveMotivationRules,
    serviceContext,
  };
}
