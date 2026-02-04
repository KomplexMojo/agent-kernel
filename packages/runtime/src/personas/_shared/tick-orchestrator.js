import { createTickStateMachine, TickPhases } from "./tick-state-machine.js";

// Pure tick orchestrator that advances the tick FSM and dispatches phase events to personas.
// Personas must declare subscribePhases and expose advance/view methods.
export function createTickOrchestrator({
  clock = () => new Date().toISOString(),
  onActions = () => {},
  debug = false,
  logger = null,
  solverPort = null,
  solverAdapter = null,
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

  async function handleSolverRequests(effects, tickValue) {
    if (!Array.isArray(effects) || effects.length === 0) {
      return { results: [], fulfilled: [] };
    }
    const requests = effects.filter((effect) => effect?.kind === "solver_request" && effect.request);
    if (requests.length === 0) {
      return { results: [], fulfilled: [] };
    }
    const results = [];
    const fulfilled = [];
    for (const entry of requests) {
      if (solverPort && solverAdapter) {
        const res = await solverPort.solve(solverAdapter, entry.request);
        results.push(res);
        fulfilled.push({ status: res.status || "fulfilled", result: res, tick: tickValue });
      } else {
        fulfilled.push({ status: "deferred", reason: "missing_solver", tick: tickValue });
      }
    }
    return { results, fulfilled };
  }

  async function collectPhaseRecord({ phase, event, payload = {}, tickValue }) {
    const currentTick = tickValue ?? fsm.view().tick;
    const personaViews = {};
    const actions = [];
    const effects = [];
    const telemetry = [];
    const artifacts = [];
    const personaEvents = payload?.personaEvents || payload?.events || null;
    const hasPersonaEvents = personaEvents !== null && personaEvents !== undefined;
    const personaPayloads = payload?.personaPayloads || payload?.payloads || null;
    const basePayload = payload?.payload ?? payload?.inputs ?? payload;
    const personaTick = payload?.personaTick ?? payload?.tick;

    for (const [name, persona] of personas.entries()) {
      let result = null;
      if (persona.subscribePhases.includes(phase)) {
        const personaPayload = personaPayloads && Object.prototype.hasOwnProperty.call(personaPayloads, name)
          ? personaPayloads[name]
          : basePayload;
        const requested = hasPersonaEvents
          ? Object.prototype.hasOwnProperty.call(personaEvents, name)
            ? personaEvents[name]
            : null
          : event;
        const eventSequence = Array.isArray(requested) ? requested : [requested];
        const events = eventSequence.filter((entry) => entry !== null && entry !== undefined);
        if (events.length === 0) {
          result = persona.view();
        } else {
          for (const personaEvent of events) {
            result = persona.advance({
              phase,
              event: personaEvent,
              payload: personaPayload,
              inputs: payload.inputs,
              tick: personaTick ?? currentTick,
              clock,
            });
            if (Array.isArray(result?.actions)) {
              actions.push(...result.actions);
            }
            if (Array.isArray(result?.effects)) {
              effects.push(...result.effects);
            }
            if (result?.telemetry) {
              telemetry.push(result.telemetry);
            }
            if (Array.isArray(result?.artifacts)) {
              artifacts.push(...result.artifacts);
            }
          }
        }
      } else {
        result = persona.view();
      }
      personaStates.set(name, { state: result.state, context: result.context });
      personaViews[name] = { state: result.state, context: result.context };
    }

    // Handle solver requests emitted by personas
    const solverOutcome = await handleSolverRequests(effects, currentTick);

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
      artifacts,
      solverResults: solverOutcome.results,
      solverFulfilled: solverOutcome.fulfilled,
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

  async function stepPhase(event, payload = {}) {
    const tickResult = fsm.advance(event, payload);
    return collectPhaseRecord({
      phase: tickResult.phase,
      event,
      payload,
      tickValue: tickResult.tick,
    });
  }

  async function dispatchPhase({ phase = null, event = null, payload = {} } = {}) {
    const view = fsm.view();
    const activePhase = phase || view.phase;
    const activeTick = view.tick;
    return collectPhaseRecord({
      phase: activePhase,
      event,
      payload,
      tickValue: activeTick,
    });
  }

  function getHistory() {
    return history.map((entry) => ({
      tick: entry.tick,
      phase: entry.phase,
      personaViews: { ...entry.personaViews },
      actions: [...entry.actions],
        effects: [...entry.effects],
        telemetry: Array.isArray(entry.telemetry) ? [...entry.telemetry] : entry.telemetry,
        artifacts: Array.isArray(entry.artifacts) ? [...entry.artifacts] : [],
    }));
  }

  return {
    registerPersona,
    stepPhase,
    dispatchPhase,
    view,
    phases: TickPhases,
    history: getHistory,
  };
}
