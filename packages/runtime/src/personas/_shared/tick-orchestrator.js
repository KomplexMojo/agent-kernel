import { createTickStateMachine, TickPhases } from "./tick-state-machine.js";

// Pure tick orchestrator that advances the tick FSM and dispatches phase events to personas.
// Personas must declare subscribePhases and expose advance/view methods.
export function createTickOrchestrator({
  clock = () => new Date().toISOString(),
  onActions = () => {},
  debug = false,
  logger = null,
} = {}) {
  const fsm = createTickStateMachine({ clock, debug, logger });
  const personas = new Map();
  const personaStates = new Map();
  const history = [];

  function registerPersona(name, persona) {
    if (!name || typeof name !== "string") {
      throw new Error("Persona name is required.");
    }
    if (!persona || !Array.isArray(persona.subscribePhases)) {
      throw new Error(`Persona ${name} must declare subscribePhases array.`);
    }
    if (typeof persona.advance !== "function" || typeof persona.view !== "function") {
      throw new Error(`Persona ${name} must implement advance() and view().`);
    }
    personas.set(name, persona);
    personaStates.set(name, persona.view());
  }

  function view() {
    const tickView = fsm.view();
    const snapshot = {};
    for (const [name, state] of personaStates.entries()) {
      snapshot[name] = state;
    }
    return {
      tick: tickView.tick,
      phase: tickView.phase,
      personaStates: snapshot,
    };
  }

  function stepPhase(event, payload = {}) {
    const tickResult = fsm.advance(event, payload);
    const phase = tickResult.phase;
    const currentTick = tickResult.tick;
    const personaViews = {};
    const actions = [];
    const effects = [];
    const telemetry = [];

    for (const [name, persona] of personas.entries()) {
      let result;
      if (persona.subscribePhases.includes(phase)) {
        result = persona.advance({
          phase,
          event,
          tick: currentTick,
          inputs: payload.inputs,
          clock,
        });
      } else {
        result = persona.view();
      }
      personaStates.set(name, { state: result.state, context: result.context });
      personaViews[name] = { state: result.state, context: result.context };
      if (Array.isArray(result.actions)) {
        actions.push(...result.actions);
      }
      if (Array.isArray(result.effects)) {
        effects.push(...result.effects);
      }
      if (result.telemetry) {
        telemetry.push(result.telemetry);
      }
    }

    if (actions.length) {
      onActions(actions);
    }

    const record = {
      tick: currentTick,
      phase,
      personaViews,
      actions,
      effects,
      telemetry,
    };

    history.push(record);
    if (debug && typeof logger === "function") {
      logger({
        kind: "tick_orchestrator_record",
        phase,
        tick: currentTick,
        actions: record.actions.length,
        effects: record.effects.length,
        personas: Object.keys(personaViews),
      });
    }
    return record;
  }

  function getHistory() {
    return history.map((entry) => ({
      tick: entry.tick,
      phase: entry.phase,
      personaViews: { ...entry.personaViews },
      actions: [...entry.actions],
      effects: [...entry.effects],
      telemetry: Array.isArray(entry.telemetry) ? [...entry.telemetry] : entry.telemetry,
    }));
  }

  return {
    registerPersona,
    stepPhase,
    view,
    phases: TickPhases,
    history: getHistory,
  };
}
