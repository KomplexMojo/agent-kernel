import { createTickStateMachine, TickPhases } from "./tick-state-machine.mts";
import { buildLlmCaptureArtifact } from "../orchestrator/llm-capture.js";
import {
  allowsLiveLlmRuntime,
  buildRuntimeDecisionLlmPrompt,
  extractLlmResponseText,
  parseRuntimeDecisionResponseText,
  resolveActionFromLlmCapture,
  resolveActionFromSolverResult,
  resolveRuntimeDecisionProviderPolicy,
} from "./runtime-decision.mts";

// Pure tick orchestrator that advances the tick FSM and dispatches phase events to personas.
// Personas must declare subscribePhases and expose advance/view methods.
export function createTickOrchestrator({
  clock = () => new Date().toISOString(),
  onActions = () => {},
  debug = false,
  logger = null,
  solverPort = null,
  solverAdapter = null,
  llmAdapter = null,
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

  async function fulfillLlmRuntimeRequest(entry, tickValue) {
    const envelope = entry?.request?.problem?.data;
    const providerPolicy = resolveRuntimeDecisionProviderPolicy(envelope?.providerPolicy);
    if (!allowsLiveLlmRuntime(providerPolicy)) {
      return {
        result: {
          status: "deferred",
          reason: "llm_live_runtime_disabled",
          provider: {
            selected: "llm",
            status: "deferred",
            deterministic: false,
          },
        },
        fulfilled: {
          status: "deferred",
          reason: "llm_live_runtime_disabled",
          tick: tickValue,
        },
        action: null,
        artifact: null,
      };
    }
    if (!llmAdapter?.generate) {
      return {
        result: {
          status: "deferred",
          reason: "missing_llm",
          provider: {
            selected: "llm",
            status: "deferred",
            deterministic: false,
          },
        },
        fulfilled: {
          status: "deferred",
          reason: "missing_llm",
          tick: tickValue,
        },
        action: null,
        artifact: null,
      };
    }

    const prompt = buildRuntimeDecisionLlmPrompt({ requestEnvelope: envelope });
    try {
      const response = await llmAdapter.generate({
        model: providerPolicy.model,
        prompt,
        options: providerPolicy.options || {},
        stream: false,
        format: providerPolicy.format,
      });
      const responseText = extractLlmResponseText(response);
      const parsed = parseRuntimeDecisionResponseText(responseText, {
        defaultDecisionKind: envelope?.decisionKind,
      });
      const captureResult = buildLlmCaptureArtifact({
        prompt,
        responseText,
        responseParsed: parsed.responseParsed || undefined,
        parseErrors: parsed.errors.length > 0 ? parsed.errors : undefined,
        requestEnvelope: envelope,
        model: providerPolicy.model,
        baseUrl: providerPolicy.baseUrl,
        options: providerPolicy.options,
        stream: false,
        requestId: entry?.request?.id || entry?.request?.requestId,
        runId: entry?.request?.meta?.runId,
        producedBy: "runtime-llm",
        phase: envelope?.phase || "decide",
        phaseContext: envelope?.decisionKind || "next_move",
        clock,
      });
      const capture = captureResult.capture;
      if (!capture) {
        const reason = Array.isArray(captureResult.errors) && captureResult.errors.length > 0
          ? captureResult.errors.join(",")
          : "invalid_llm_capture";
        return {
          result: {
            status: "error",
            reason,
            provider: {
              selected: "llm",
              status: "error",
              deterministic: false,
            },
          },
          fulfilled: {
            status: "error",
            reason,
            tick: tickValue,
          },
          action: null,
          artifact: null,
        };
      }

      const normalized = resolveActionFromLlmCapture({ captureArtifact: capture });
      const status = normalized.ok ? "fulfilled" : "error";
      const result = normalized.ok
        ? {
            status,
            provider: {
              selected: "llm",
              status,
              deterministic: false,
            },
            captureRef: {
              id: capture.meta?.id,
              schema: capture.schema,
              schemaVersion: capture.schemaVersion,
            },
            decision: normalized.decision,
            action: normalized.action,
          }
        : {
            status,
            reason: Array.isArray(normalized.errors) ? normalized.errors.join(",") : "invalid_llm_runtime_decision",
            provider: {
              selected: "llm",
              status,
              deterministic: false,
            },
            captureRef: {
              id: capture.meta?.id,
              schema: capture.schema,
              schemaVersion: capture.schemaVersion,
            },
          };
      return {
        result,
        fulfilled: {
          status,
          result,
          reason: result.reason,
          tick: tickValue,
        },
        action: normalized.ok ? normalized.action : null,
        artifact: capture,
      };
    } catch (error) {
      const reason = error?.message || "llm_runtime_error";
      return {
        result: {
          status: "error",
          reason,
          provider: {
            selected: "llm",
            status: "error",
            deterministic: false,
          },
        },
        fulfilled: {
          status: "error",
          reason,
          tick: tickValue,
        },
        action: null,
        artifact: null,
      };
    }
  }

  async function handleSolverRequests(effects, tickValue) {
    if (!Array.isArray(effects) || effects.length === 0) {
      return { results: [], fulfilled: [], actions: [], artifacts: [] };
    }
    const requests = effects.filter((effect) => effect?.kind === "solver_request" && effect.request);
    if (requests.length === 0) {
      return { results: [], fulfilled: [], actions: [], artifacts: [] };
    }
    const results = [];
    const fulfilled = [];
    const actions = [];
    const artifacts = [];
    for (const entry of requests) {
      const envelope = entry?.request?.problem?.data;
      const providerPolicy = resolveRuntimeDecisionProviderPolicy(envelope?.providerPolicy);
      const prefersLlm = providerPolicy.preferred === "llm" || providerPolicy.mode === "llm";
      const useLiveLlm = allowsLiveLlmRuntime(providerPolicy);
      if (prefersLlm && useLiveLlm) {
        const llmOutcome = await fulfillLlmRuntimeRequest(entry, tickValue);
        results.push(llmOutcome.result);
        fulfilled.push(llmOutcome.fulfilled);
        if (llmOutcome.action) {
          actions.push(llmOutcome.action);
        }
        if (llmOutcome.artifact) {
          artifacts.push(llmOutcome.artifact);
        }
      } else if (prefersLlm) {
        const result = {
          status: "deferred",
          reason: "llm_runtime_requires_capture_or_manual_mode",
          provider: {
            selected: "llm",
            status: "deferred",
            deterministic: false,
          },
        };
        results.push(result);
        fulfilled.push({ status: "deferred", reason: result.reason, result, tick: tickValue });
      } else if (solverPort && solverAdapter) {
        const res = await solverPort.solve(solverAdapter, entry.request);
        const normalized = resolveActionFromSolverResult({
          solverRequest: entry.request,
          solverResult: res,
        });
        const solverStatus = typeof res?.status === "string" && res.status.trim()
          ? res.status.trim()
          : "fulfilled";
        const fallbackRequested = providerPolicy.allowLlmFallback === true;
        const fallbackStatus = {
          requested: fallbackRequested,
          performed: false,
          reason: fallbackRequested ? "auto_llm_fallback_disabled" : "not_requested",
        };
        const result = normalized.ok
          ? {
              ...res,
              provider: {
                selected: "solver",
                status: solverStatus,
                deterministic: true,
              },
              decision: normalized.decision,
              action: normalized.action,
            }
          : {
              ...res,
              provider: {
                selected: "solver",
                status: solverStatus,
                deterministic: true,
              },
              fallback: fallbackStatus,
              reason: (typeof res?.reason === "string" && res.reason.trim())
                ? res.reason.trim()
                : fallbackStatus.reason,
            };
        results.push(result);
        fulfilled.push({ status: solverStatus, result, tick: tickValue });
        if (normalized.ok) {
          actions.push(normalized.action);
        }
      } else {
        fulfilled.push({ status: "deferred", reason: "missing_solver", tick: tickValue });
      }
    }
    return { results, fulfilled, actions, artifacts };
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
    if (solverOutcome.actions.length > 0) {
      actions.push(...solverOutcome.actions);
    }
    if (solverOutcome.artifacts.length > 0) {
      artifacts.push(...solverOutcome.artifacts);
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
