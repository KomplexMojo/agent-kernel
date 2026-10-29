import { createAnnotatorStateMachine, AnnotatorStates } from "./state-machine.js";
/**
 * CR.7 / WP-5 — the capture-artifact predicate, published for the diagnostics view.
 *
 * `ui-web/views/diagnostics-view.js` imported `annotator/llm-trace.js` directly and was an
 * allowlist row. Recognising a capture artifact is Annotator law — it owns telemetry capture and
 * normalization — and a UI view deciding for itself what counts as one is a second origin for
 * that answer. Pure predicate, so ungated.
 */
export { isLlmCaptureArtifact } from "./llm-trace.js";
import { TickPhases } from "../_shared/tick-state-machine.mts";
import { buildTelemetry } from "../_shared/persona-helpers.mts";
import { attachAnnotatorServices } from "./annotator-services.js";
import { buildBattleLogEntries } from "./battle-log.js";

const observationsOf = (payload) => (Array.isArray(payload.observations) ? payload.observations : []);

export const annotatorSubscribePhases = Object.freeze([TickPhases.EMIT, TickPhases.SUMMARIZE]);

export function createAnnotatorPersona({ initialState = AnnotatorStates.IDLE, clock, from } = {}) {
  const fsm = createAnnotatorStateMachine({ initialState, clock, from });
  const services = attachAnnotatorServices();

  function view() {
    return fsm.view();
  }

  function advance({ phase, event, payload = {}, tick } = {}) {
    if (!annotatorSubscribePhases.includes(phase) || !event) {
      const snapshot = view();
      return { ...snapshot, tick, actions: [], effects: [], telemetry: null };
    }
    const previous = fsm.view().context.lifecycles ?? {};
    const battle = phase === "emit" ? observationsOf(payload).at(-1)?.battle : undefined;
    const result = fsm.advance(event, battle ? { ...payload, lifecycles: battle.lifecycles } : payload);
    let telemetry = null;
    const observations = observationsOf(payload);
    if (observations.length > 0) {
      telemetry = buildTelemetry({
        observations,
        runId: payload.runId || "run",
        clock,
        personaRef: "annotator",
      });
      // #554: the battle log rides with the tick's telemetry, so a silent Annotator leaves none.
      if (battle) telemetry.battleLog = buildBattleLogEntries({ battle, previous, runId: payload.runId || "run", clock });
    }
    return {
      ...result,
      tick,
      actions: [],
      effects: [],
      telemetry,
    };
  }

  return {
    subscribePhases: annotatorSubscribePhases,
    advance,
    view,
    summarizeRun: services.summarizeRun,
    classifyRunOutcome: services.classifyRunOutcome,
    captureWorldState: services.captureWorldState,
  };
}
