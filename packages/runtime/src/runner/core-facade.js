import {
  AFFINITY_KIND_BY_CODE,
  applyMoveAction,
  createCore,
  packMoveAction,
  readAffinityFieldAt,
  readObservation,
  renderBaseTiles,
  renderFrameBuffer,
} from "../../../core-ts/src/index.ts";
import { initializeCoreFromArtifacts } from "./core-setup.mjs";
import { createRuntime } from "./runtime.js";

const ALL_AFFINITY_KIND_CODES = Object.freeze(Object.keys(AFFINITY_KIND_BY_CODE).map(Number));

export function createRuntimeCore() {
  return createCore();
}

export function createPlaybackRuntime(options = {}) {
  const core = options.core || createRuntimeCore();
  const adapters = options.adapters || {};
  return createRuntime({ ...options, core, adapters });
}

export function renderCoreFrame(core, options = {}) {
  return renderFrameBuffer(core, options);
}

export function renderCoreBaseTiles(core) {
  return renderBaseTiles(core);
}

export function readCoreObservation(core, options = {}) {
  return readObservation(core, options);
}

export function applyCoreMove(core, action = {}) {
  const packed = packMoveAction({
    actorId: action.actorId,
    from: action.from,
    to: action.to,
    direction: action.direction,
    tick: action.tick,
  });
  return applyMoveAction(core, packed);
}

export function readCoreAffinityFieldRecords(core, { width = 0, height = 0 } = {}) {
  const records = [];
  const maxX = Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0;
  const maxY = Number.isFinite(height) ? Math.max(0, Math.trunc(height)) : 0;
  for (let y = 0; y < maxY; y += 1) {
    for (let x = 0; x < maxX; x += 1) {
      for (const kindCode of ALL_AFFINITY_KIND_CODES) {
        const field = readAffinityFieldAt(core, x, y, kindCode);
        // A fully cancelled cell has zero net intensity but still carries
        // contributions. Preserve those records so the presentation layer can
        // expose the cancellation zone instead of treating it as untouched.
        if (field.intensity > 0 || field.contributionCount > 0) {
          records.push({
            x,
            y,
            kind: AFFINITY_KIND_BY_CODE[kindCode] || "unknown",
            kindCode,
            intensity: field.intensity,
            stacks: field.stacks,
            expression: field.expression,
            expressionName: field.expressionName,
            contributionCount: field.contributionCount,
          });
        }
      }
    }
  }
  return records;
}

export function readCoreAffinityFieldRecordsFromArtifacts(core, { simConfig, initialState } = {}) {
  const result = initializeCoreFromArtifacts(core, { simConfig, initialState });
  const width = result.layout?.dimensions?.width || 0;
  const height = result.layout?.dimensions?.height || 0;
  const fieldRecords = result.layout?.ok && width > 0 && height > 0
    ? readCoreAffinityFieldRecords(core, { width, height })
    : [];
  return {
    ok: Boolean(result.layout?.ok),
    layout: result.layout,
    dimensions: { width, height },
    fieldRecords,
  };
}

export async function compileScenarioPlaybackBundle(scenario, { now = () => new Date().toISOString() } = {}) {
  if (!scenario?.simConfig || !scenario?.initialState) {
    throw new Error("compileScenarioPlaybackBundle: scenario must include simConfig and initialState");
  }

  const ticks = Number.isInteger(scenario.ticks) && scenario.ticks > 0 ? scenario.ticks : 10;
  const runtime = createPlaybackRuntime();
  await runtime.init({
    seed: 0,
    simConfig: scenario.simConfig,
    initialState: scenario.initialState,
  });
  for (let i = 0; i < ticks; i += 1) {
    await runtime.step();
  }

  return {
    schema: "agent-kernel/GameplayBundle",
    schemaVersion: 1,
    meta: {
      id: scenario.id || "scenario_bundle",
      scenarioId: scenario.id || null,
      ticks,
      createdAt: now(),
    },
    artifacts: [
      scenario.simConfig,
      scenario.initialState,
    ],
    spec: { scenario: { id: scenario.id, name: scenario.name } },
    tickFrames: runtime.getTickFrames(),
  };
}
