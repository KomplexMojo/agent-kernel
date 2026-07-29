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
   * `validated` and `locked` are DERIVED from the FSM state rather than tracked
   * as flags. The FSM offers `update_config` (configured → pending_config),
   * which the tick plane can reach via advance() without going through this
   * surface — a tracked flag would silently stay true after a reopen. Nothing
   * sends that event today, so deriving costs nothing and removes the drift.
   */
  function serviceContext() {
    const state = currentState();
    return {
      hasConfig: config != null,
      levelGenPrepared,
      resourcesMapped,
      validated: state === ConfiguratorStates.CONFIGURED || state === ConfiguratorStates.LOCKED,
      locked: state === ConfiguratorStates.LOCKED,
      configVersion,
    };
  }

  return {
    provideConfig,
    prepareLevelGen,
    mapResources,
    validate,
    lock,
    lockedConfig,
    serviceContext,
  };
}
