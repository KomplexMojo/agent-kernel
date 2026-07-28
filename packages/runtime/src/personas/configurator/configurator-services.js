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
 *   validate()                 pending_config → configured
 *   lock()                     configured → locked
 *
 * Shared by controller.js and controller.mts so the two entry points cannot
 * drift.
 */
import { ConfiguratorStates } from "./state-machine.js";
import { prepareLevelGen as prepareLevelGenInput, mapResources as mapResourcesInput } from "./input-preparation.js";

export class ConfiguratorStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfiguratorStateError";
    this.code = "configurator_state";
  }
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
    config = providedConfig;
    fsm.advance("provide_config", { config, configRef });
    return { state: currentState() };
  }

  /** Size the grid to fit authored rooms/floor tiles/hazards; attach hazards. */
  function prepareLevelGen(args = {}) {
    requireState(CONFIGURING_STATES, "prepare level-gen input");
    const levelGen = prepareLevelGenInput(args);
    levelGenPrepared += 1;
    return levelGen;
  }

  /** Map authored resource values onto the configurator resource-input shape. */
  function mapResources(resources = []) {
    requireState(CONFIGURING_STATES, "map resources");
    const mapped = mapResourcesInput(resources);
    resourcesMapped += 1;
    return mapped;
  }

  /** Close assembly: pending_config → configured. */
  function validate() {
    requireState([ConfiguratorStates.PENDING_CONFIG], "validate the config");
    fsm.advance("validate", { config });
    return { state: currentState() };
  }

  /** Freeze the round: configured → locked. */
  function lock() {
    requireState([ConfiguratorStates.CONFIGURED], "lock the config");
    fsm.advance("lock", {});
    return { state: currentState() };
  }

  /** Serializable service-side context merged into the persona view. */
  function serviceContext() {
    return {
      hasConfig: config != null,
      levelGenPrepared,
      resourcesMapped,
    };
  }

  return {
    provideConfig,
    prepareLevelGen,
    mapResources,
    validate,
    lock,
    serviceContext,
  };
}
