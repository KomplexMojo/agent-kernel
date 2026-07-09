// Complexity-ladder coverage (see plan: cuddly-noodling-gizmo).
//
// Drives the escalating fixture ladder (T0 smoke -> T3 budget-edge) through the
// full CLI pipeline: author (create) -> build sim-config/initial-state -> run
// (simulate). T2 is the "extremely complex, high-token-cost level".
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { ROOT, runAk, makeOutDir, readJsonIfExists } from "../helpers/ak-cli.mjs";

const LADDER_DIR = resolve(ROOT, "tests/fixtures/scenarios/complexity-ladder");

function loadTiers() {
  return readdirSync(LADDER_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(LADDER_DIR, f), "utf8")));
}

describe("complexity ladder (author -> build -> run)", () => {
  for (const tier of loadTiers()) {
    test(`${tier.id} (${tier.tier})`, () => {
      const outDir = makeOutDir(`ak-ladder-${tier.id}-`);
      const create = runAk("create", [
        ...tier.createArgs,
        "--run-id", `run_ladder_${tier.id}`,
        "--created-at", "2026-04-14T00:00:00.000Z",
        "--out-dir", outDir,
      ]);

      expect(create.json.ok, JSON.stringify(create.json.errors || create.json.error)).toBe(tier.expect.ok);
      if (!tier.expect.ok) {
        if (tier.expect.errorIncludes) {
          expect(String(create.json.error)).toContain(tier.expect.errorIncludes);
        }
        return;
      }

      const state = readJsonIfExists(join(outDir, "initial-state.json"));
      const spec = readJsonIfExists(join(outDir, "spec.json"));

      if (typeof tier.expect.minActors === "number") {
        expect((state?.actors ?? []).length).toBeGreaterThanOrEqual(tier.expect.minActors);
      }
      if (typeof tier.expect.minHazards === "number") {
        const hazards = spec?.configurator?.inputs?.levelGen?.hazards ?? [];
        expect(hazards.length).toBeGreaterThanOrEqual(tier.expect.minHazards);
      }
      if (typeof tier.expect.minResources === "number") {
        const resources = spec?.configurator?.inputs?.resources ?? [];
        expect(resources.length).toBeGreaterThanOrEqual(tier.expect.minResources);
      }

      // Budget-edge tier: create still succeeds, but the receipt is denied/overspent.
      if (tier.expect.budgetStatus) {
        const receipt = readJsonIfExists(join(outDir, "budget-receipt.json"));
        expect(receipt?.status).toBe(tier.expect.budgetStatus);
        if (tier.expect.budgetOverspent) {
          expect(receipt.remaining).toBeLessThan(0);
        }
      }

      // Simulate the built level.
      if (tier.expect.runnable) {
        const runOut = makeOutDir(`ak-ladder-run-${tier.id}-`);
        const run = runAk("run", [
          "--sim-config", join(outDir, "sim-config.json"),
          "--initial-state", join(outDir, "initial-state.json"),
          "--ticks", "8",
          "--seed", "0",
          "--out-dir", runOut,
        ]);
        expect(run.json.ok, JSON.stringify(run.json.errors || run.json.error)).toBe(true);
        const frames = readJsonIfExists(join(runOut, "tick-frames.json"));
        const frameList = frames?.frames ?? frames?.ticks ?? (Array.isArray(frames) ? frames : []);
        expect(frameList.length).toBeGreaterThan(0);
      }
    });
  }
});

// ## TODO: Test Permutations
// - Replay determinism: run each tier twice with the same seed, assert identical tick-frames.
// - Vary --seed across the ladder and assert structurally valid (non-empty) frames each time.
// - T3 variants that trigger hard insufficient_budget / conflicting_requirements via a supplied --budget artifact.
// - T2 narrate pass: assert narrative.json turn count matches tick-frames.
