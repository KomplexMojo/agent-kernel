import { applyBudgetCaps } from "../ports/budget.js";
import * as effects from "../ports/effects.js";
import { applyInitialStateToCore, applySimConfigToCore } from "./core-setup.mjs";

// Moderator-owned runner module: executes ticks and records execution frames.

export function createRuntime({ core, adapters = {}, effectFactory, runId, clock } = {}) {
  if (!core) {
    throw new Error("Runtime requires a core instance.");
  }

  let tick = 0;
  const effectLog = [];
  const tickFrames = [];
  let activeRunId = typeof runId === "string" && runId.length > 0 ? runId : `run_${Date.now().toString(36)}`;
  let activeClock = typeof clock === "function" ? clock : () => new Date().toISOString();
  let frameCounter = 0;
  const EXECUTION_PHASES = ["observe", "collect", "apply", "emit"];

  function nextFrameMeta() {
    frameCounter += 1;
    return {
      id: `frame_${frameCounter}`,
      runId: activeRunId,
      createdAt: activeClock(),
      producedBy: "moderator",
    };
  }

  function buildEffectRecord(kind, value, index) {
    const buildEffectFromCore = typeof effects.buildEffectFromCore === "function"
      ? effects.buildEffectFromCore
      : ({ tick: t, index: i, kind: k, value: v }) => ({
          schema: "agent-kernel/Effect",
          schemaVersion: 1,
          id: `eff_${t}_${i}_${k}_${v}`,
          tick: t,
          fulfillment: "deterministic",
          kind: "custom",
          data: { kind: k, value: v },
        });
    const fallback = buildEffectFromCore({ tick, index, kind, value });
    if (typeof effectFactory === "function") {
      const customEffect = effectFactory({ tick, kind, value, index });
      if (customEffect) {
        return { ...fallback, ...customEffect, id: customEffect.id || fallback.id };
      }
    }
    return fallback;
  }

  function normalizeEffectKind(effect) {
    if (!effect || typeof effect.kind === "string" || typeof effect.kind === "number") {
      return;
    }
    if (effect.kind && typeof effect.kind.kind === "string") {
      effect.kind = effect.kind.kind;
      return;
    }
    if (effect.kind && typeof effect.kind.type === "string") {
      effect.kind = effect.kind.type;
      return;
    }
    effect.kind = String(effect.kind);
  }

  function flushEffects() {
    const count = core.getEffectCount();
    const records = [];
    for (let i = 0; i < count; i += 1) {
      const kind = core.getEffectKind(i);
      const value = core.getEffectValue(i);
      const effect = buildEffectRecord(kind, value, i);
      normalizeEffectKind(effect);
      let outcome;
      if (effect?.kind === "need_external_fact") {
        if (effect.sourceRef) {
          effect.fulfillment = "deterministic";
          outcome = {
            status: "fulfilled",
            result: { sourceRef: effect.sourceRef, requestId: effect.requestId, targetAdapter: effect.targetAdapter },
          };
        } else {
          effect.fulfillment = "deferred";
          outcome = { status: "deferred", reason: "missing_source_ref" };
        }
      } else if (effect?.fulfillment === "deferred") {
        outcome = { status: "deferred", reason: "deferred_effect" };
      } else {
        const dispatch = typeof effects.dispatchEffect === "function"
          ? effects.dispatchEffect
          : () => ({ status: "deferred", reason: "missing_dispatchEffect" });
        outcome = dispatch(adapters, effect);
      }
      records.push({
        effect,
        outcome,
        index: i,
        coreKind: kind,
        coreValue: value,
      });
    }
    core.clearEffects();

    records.sort((a, b) => {
      const left = a.effect?.id || "";
      const right = b.effect?.id || "";
      if (left === right) {
        return a.index - b.index;
      }
      return left < right ? -1 : 1;
    });

    const emittedEffects = records.map((record) => record.effect);
    const fulfilledEffects = records.map((record) => ({
      effect: record.effect,
      status: record.outcome?.status || "fulfilled",
      result: record.outcome?.result,
      reason: record.outcome?.reason,
      requestId: record.effect?.requestId,
    }));

    for (const record of records) {
      effectLog.push({
        tick,
        kind: record.effect?.kind ?? record.coreKind,
        value: record.coreValue,
        effectId: record.effect?.id,
        requestId: record.effect?.requestId,
        status: record.outcome?.status || "fulfilled",
        result: record.outcome?.result,
        reason: record.outcome?.reason,
      });
    }

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
      if (typeof options.runId === "string" && options.runId.length > 0) {
        activeRunId = options.runId;
      }
      if (typeof options.clock === "function") {
        activeClock = options.clock;
      }
      const seed = Number.isFinite(options.seed) ? options.seed : 0;
      tick = 0;
      effectLog.length = 0;
      tickFrames.length = 0;
      core.init(seed);
      if (options.simConfig?.layout) {
        const layoutResult = applySimConfigToCore(core, options.simConfig);
        if (!layoutResult.ok) {
          throw new Error(`Failed to apply sim config layout: ${layoutResult.reason || "unknown"}`);
        }
        if (options.initialState) {
          const actorResult = applyInitialStateToCore(core, options.initialState, { spawn: layoutResult.spawn });
          if (!actorResult.ok) {
            throw new Error(`Failed to apply initial state: ${actorResult.reason || "unknown"}`);
          }
        }
      } else if (options.initialState) {
        const actorResult = applyInitialStateToCore(core, options.initialState);
        if (!actorResult.ok) {
          throw new Error(`Failed to apply initial state: ${actorResult.reason || "unknown"}`);
        }
      }
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
