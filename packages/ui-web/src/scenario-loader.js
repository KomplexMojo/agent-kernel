/**
 * M7 — Scenario loader for the UI sandbox.
 *
 * Compiles a scenario JSON (matching tests/fixtures/scenarios/*-v1-*.json) into a
 * gameplay bundle that the existing gameplay-view loadRun(bundle) can consume.
 *
 * The bundle includes:
 *   - artifacts[]: sim-config, initial-state (so the gameplay view can find them)
 *   - tickFrames: the recorded per-tick frames from running the runtime
 *
 * This is UI playback over precomputed tickFrames (M1 contract decision):
 * the runtime is run synchronously to completion at load time, and the UI
 * then steps through the frames without re-executing simulation logic.
 */

import { compileScenarioPlaybackBundle } from "../../runtime/src/runner/core-facade.js";

/**
 * Compile a scenario into a gameplay bundle by running it through the runtime.
 *
 * @param {object} scenario - Parsed scenario JSON (sim config + initial state + tick count)
 * @returns {Promise<object>} A gameplay bundle compatible with __ak_loadGameplayBundle
 */
export async function compileScenarioToBundle(scenario) {
  if (!scenario?.simConfig || !scenario?.initialState) {
    throw new Error("compileScenarioToBundle: scenario must include simConfig and initialState");
  }

  return compileScenarioPlaybackBundle(scenario);
}

/**
 * Convenience: fetch a scenario JSON from a URL and compile it.
 * Used by the UI's optional "Load Scenario" affordance and by the
 * Playwright test to inject a scenario without a server-side step.
 */
export async function loadScenarioFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadScenarioFromUrl: ${url} returned ${res.status}`);
  const scenario = await res.json();
  return compileScenarioToBundle(scenario);
}
