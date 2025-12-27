import { applyBudgetCaps } from "../ports/budget.js";
import { dispatchEffect } from "../ports/effects.js";

// Moderator-owned runner module: executes ticks and records execution frames.

export function createRuntime({ core, adapters = {} }) {
  if (!core) {
    throw new Error("Runtime requires a core instance.");
  }

  let tick = 0;
  const effectLog = [];
  const tickFrames = [];
  const runId = `run_${Date.now().toString(36)}`;
  let frameCounter = 0;
  const EXECUTION_PHASES = ["observe", "collect", "apply", "emit"];

  function nextFrameMeta() {
    frameCounter += 1;
    return {
      id: `frame_${frameCounter}`,
      runId,
      createdAt: new Date().toISOString(),
      producedBy: "moderator",
    };
  }

  function buildEffect(kind, value) {
    return {
      schema: "agent-kernel/Effect",
      schemaVersion: 1,
      tick,
      fulfillment: "deterministic",
      kind: "custom",
      data: { kind, value },
    };
  }

  function flushEffects() {
    const count = core.getEffectCount();
    const fulfilledEffects = [];
    const emittedEffects = [];
    for (let i = 0; i < count; i += 1) {
      const kind = core.getEffectKind(i);
      const value = core.getEffectValue(i);
      const effect = buildEffect(kind, value);
      const outcome = dispatchEffect(adapters, kind, value);
      emittedEffects.push(effect);
      fulfilledEffects.push({
        effect,
        status: outcome?.status || "fulfilled",
        result: outcome?.result,
        reason: outcome?.reason,
      });
      effectLog.push({
        tick,
        kind,
        value,
        status: outcome?.status || "fulfilled",
        result: outcome?.result,
        reason: outcome?.reason,
      });
    }
    core.clearEffects();
    return { emittedEffects, fulfilledEffects };
  }

  function recordTickFrame({ emittedEffects, fulfilledEffects, phaseDetail }) {
    tickFrames.push({
      schema: "agent-kernel/TickFrame",
      schemaVersion: 1,
      meta: nextFrameMeta(),
      tick,
      phase: "execute",
      phaseDetail,
      acceptedActions: [],
      emittedEffects,
      fulfilledEffects,
    });
  }

  return {
    init(seedOrOptions = 0) {
      const options = typeof seedOrOptions === "object" && seedOrOptions !== null
        ? seedOrOptions
        : { seed: seedOrOptions };
      const seed = Number.isFinite(options.seed) ? options.seed : 0;
      tick = 0;
      effectLog.length = 0;
      tickFrames.length = 0;
      core.init(seed);
      applyBudgetCaps(core, options.simConfig);
      const frameEffects = flushEffects();
      recordTickFrame({ ...frameEffects, phaseDetail: "init" });
    },
    step() {
      tick += 1;
      recordTickFrame({ emittedEffects: [], fulfilledEffects: [], phaseDetail: EXECUTION_PHASES[0] });
      recordTickFrame({ emittedEffects: [], fulfilledEffects: [], phaseDetail: EXECUTION_PHASES[1] });
      if (core.applyAction) {
        core.applyAction(1, 1);
      } else {
        core.step();
      }
      recordTickFrame({ emittedEffects: [], fulfilledEffects: [], phaseDetail: EXECUTION_PHASES[2] });
      const frameEffects = flushEffects();
      recordTickFrame({ ...frameEffects, phaseDetail: EXECUTION_PHASES[3] });
      return core.getCounter();
    },
    getState() {
      return { counter: core.getCounter() };
    },
    getEffectLog() {
      return effectLog.slice();
    },
    getTickFrames() {
      return tickFrames.slice();
    },
  };
}
