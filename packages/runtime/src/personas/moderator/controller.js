import { createModeratorStateMachine, ModeratorStates } from "./state-machine.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { planModeratorAffinityActions } from "./affinity-target-effects.js";
import { planPersonaOrder } from "./tick-ordering.js";
import { planEffectFulfillment, FulfillmentDispositions } from "./effect-fulfillment.js";
import { planTickClose } from "./tick-close.js";
import { planAffinityInteractions } from "./affinity-interactions.js";

// Published on the controller surface so the runner can execute a fulfilment plan
// without importing persona internals (charter: external code imports persona
// controllers only).
export { FulfillmentDispositions };
export { describeActorOrdering, orderActorsByIntention } from "./actor-ordering.js";

/**
 * CR.7 / WP-5 — affinity TARGET resolution, published for the Configurator.
 *
 * `configurator/affinity-effects.js` imported `moderator/affinity-target-effects.js` directly —
 * the one persona-to-persona row left in this direction. Which entities an affinity targets, and
 * what it does to them, is Moderator law: it plans affinity actions during the tick. The
 * Configurator resolves affinity effects at build time and needs the same vocabulary, so it now
 * asks through this barrel rather than holding a second route to it.
 */
export {
  normalizeAffinityTargetType,
  resolveAffinityTargetEffectsForEntry,
} from "./affinity-target-effects.js";

export const moderatorSubscribePhases = Object.freeze([
  TickPhases.INIT,
  TickPhases.OBSERVE,
  TickPhases.DECIDE,
  TickPhases.APPLY,
  TickPhases.EMIT,
  TickPhases.SUMMARIZE,
]);
const CONTROL_EVENTS = new Set(["start", "pause", "resume", "stop"]);

export function createModeratorPersona({ initialState = ModeratorStates.INITIALIZING, clock, from } = {}) {
  const fsm = createModeratorStateMachine({ initialState, clock, from });

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!moderatorSubscribePhases.includes(phase)) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    // CR.5 — tick-control decisions the runner used to make for itself. Like
    // resolve_affinity below, these are PLANNING events: they answer a question
    // as data and deliberately do not transition the FSM, because deciding an
    // order or a disposition is not a lifecycle change.
    if (phase === TickPhases.INIT && event === "plan_persona_order") {
      const snapshot = view();
      return {
        ...snapshot,
        tick,
        actions: [],
        effects: [],
        telemetry: null,
        personaOrder: planPersonaOrder({ personaNames: payload?.personaNames }),
      };
    }
    // AM.3b + AM.7 — closing the tick is a Moderator DECISION, not a fixed point
    // in the runner. Advancing the core tick and recomputing the affinity field
    // both describe the same instant, and both are the Moderator's authority
    // (charter §29/§81); until this event existed, glue did the first
    // unconditionally and nobody did the second at all after setup.
    if (phase === TickPhases.SUMMARIZE && event === "plan_tick_close") {
      const snapshot = view();
      return {
        ...snapshot,
        tick,
        actions: [],
        effects: [],
        telemetry: null,
        tickClose: planTickClose({ state: snapshot.state }),
      };
    }
    if (phase === TickPhases.EMIT && event === "plan_effect_fulfillment") {
      const snapshot = view();
      return {
        ...snapshot,
        tick,
        actions: [],
        effects: [],
        telemetry: null,
        fulfillmentPlan: planEffectFulfillment({ effects: payload?.effects }),
      };
    }
    // AM.8 — which affinity fields are in contact this tick. A planning event
    // like the others: it answers as data, and the runner resolves each pair
    // through core's interaction matrix.
    if (phase === TickPhases.APPLY && event === "plan_affinity_interactions") {
      const snapshot = view();
      return {
        ...snapshot,
        tick,
        actions: [],
        effects: [],
        telemetry: null,
        affinityInteractions: planAffinityInteractions({
          actors: payload?.actors,
          computeRadius: payload?.computeRadius,
        }),
      };
    }
    if (phase === TickPhases.APPLY && event === "resolve_affinity") {
      const snapshot = view();
      const actions = planModeratorAffinityActions({
        observation: payload?.observation,
        affinityEffects: payload?.affinityEffects,
        tick,
        maxActions: payload?.maxAffinityActions,
      });
      return { ...snapshot, tick, actions, effects: [], telemetry: null };
    }
    if (!event || !CONTROL_EVENTS.has(event)) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const result = fsm.advance(event, payload);
    const effects = [];
    if (payload.solverRequest) {
      effects.push({ kind: "solver_request", request: payload.solverRequest });
      result.context = { ...result.context, lastSolverRequest: payload.solverRequest };
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
    subscribePhases: moderatorSubscribePhases,
    advance,
    view,
  };
}
