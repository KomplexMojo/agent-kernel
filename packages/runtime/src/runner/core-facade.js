// PX.3 extended beyond personas: this module defaulted its clock to
// `() => new Date().toISOString()`, the exact pattern require-clock.js removed from
// every persona. The rule was enforced on personas/ only, so five modules kept the
// default and nothing objected. UNUSED_CLOCK is the repo's deterministic marker: a
// caller that forgets to inject now gets a reproducible value, not wall-clock time.
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { createCore } from "../../../core-ts/src/index.ts";
import { GAMEPLAY_BUNDLE_SCHEMA } from "../contracts/artifacts.ts";
import { initializeCoreFromArtifacts } from "./core-setup.mjs";
import { createRuntime } from "./runtime.js";
import { readActorRegistryObservation } from "../../../core-ts/src/rules/actor-observation.ts";

export function createRuntimeCore() {
  return createCore();
}

export function createPlaybackRuntime(options = {}) {
  const core = options.core || createRuntimeCore();
  const adapters = options.adapters || {};
  return createRuntime({ ...options, core, adapters });
}

export function readCoreAffinityFieldRecordsFromArtifacts(core, { simConfig, initialState } = {}) {
  const { registry } = initializeCoreFromArtifacts({ simConfig, initialState });
  const snapshot = registry.snapshot();
  const observation = readActorRegistryObservation(registry, 0);
  const source = (observation.affinityContributions && observation.affinityContributions.length > 0)
    ? observation.affinityContributions
    : (observation.affinityFields || []);
  const fieldRecords = source.map((field) => ({
    x: field.position.x,
    y: field.position.y,
    kind: field.kind,
    intensity: field.falloff,
    stacks: field.stacks,
    expression: field.expression,
    expressionName: field.expression,
    contributionCount: 1,
  }));
  return {
    ok: fieldRecords.length >= 0,
    layout: { ok: true, dimensions: snapshot.dimensions },
    dimensions: snapshot.dimensions,
    fieldRecords,
  };
}

export async function compileScenarioPlaybackBundle(scenario, { now = UNUSED_CLOCK } = {}) {
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
    schema: GAMEPLAY_BUNDLE_SCHEMA,
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
