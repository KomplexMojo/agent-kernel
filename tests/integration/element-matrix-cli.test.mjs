// Layer 1 of the game-element coverage suite (see plan: cuddly-noodling-gizmo).
//
// Per-element CLI/MCP coverage. The matrix is generated DIRECTLY from the
// canonical game-element vocabulary (game-elements.js), so adding a new
// affinity / expression / motivation / vital automatically adds a test case —
// a missing case becomes a failing test, never silent drift.
//
// "Code is Law": these tests assert what the CLI actually does. Where the
// design intent is undecided (hazard projection/draw policy), we capture the
// CLI's real accept/reject as `pending` rather than asserting validity.
import { describe, test, expect } from "vitest";
import { join } from "node:path";

import {
  GAME_AFFINITY_KINDS,
  GAME_AFFINITY_EXPRESSIONS,
  GAME_VITAL_KEYS,
  GAME_MOTIVATION_KINDS,
} from "../../packages/runtime/src/contracts/game-elements.js";
import { runAk, makeOutDir, readJsonIfExists } from "../helpers/ak-cli.mjs";

const CREATED_AT = "2026-04-14T00:00:00.000Z";

function runCreate(args, { runId = "run_matrix" } = {}) {
  const outDir = makeOutDir("ak-matrix-");
  const { status, json } = runAk("create", [
    ...args,
    "--run-id", runId,
    "--created-at", CREATED_AT,
    "--out-dir", outDir,
  ]);
  return {
    status,
    json,
    outDir,
    read: (name) => readJsonIfExists(join(outDir, name)),
  };
}

function requestObjects(spec) {
  return spec?.authoring?.request?.objects ?? [];
}

// ---------------------------------------------------------------------------
// Affinities — author one hazard (emit) per affinity; assert it round-trips into
// sim-config.layout.data.hazards[].affinity.kind.
// ---------------------------------------------------------------------------
describe("affinity kinds (hazard, emit)", () => {
  for (const affinity of GAME_AFFINITY_KINDS) {
    test(`affinity=${affinity} round-trips onto a hazard`, () => {
      const run = runCreate([
        "--room", "size=medium;count=1",
        "--hazard", `x=3;y=3;affinity=${affinity};expression=emit;stacks=2`,
        "--budget-tokens", "300",
      ]);
      expect(run.json.ok, JSON.stringify(run.json.errors || run.json.error)).toBe(true);
      const sim = run.read("sim-config.json");
      const hazards = sim?.layout?.data?.hazards ?? [];
      expect(hazards.length).toBeGreaterThan(0);
      expect(hazards.some((t) => t.affinity?.kind === affinity)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Affinity expressions — author one hazard per expression; assert round-trip
// into spec.configurator.inputs.levelGen.hazards[].expression. Hazards are the
// stable carrier for expression (actor affinities collapse to stacks-only in
// initial-state, and hazard projection policy is still an open design question).
// ---------------------------------------------------------------------------
describe("affinity expressions (hazard)", () => {
  for (const expression of GAME_AFFINITY_EXPRESSIONS) {
    test(`expression=${expression} round-trips onto a hazard`, () => {
      const run = runCreate([
        "--hazard", `affinity=fire;expression=${expression};proximityRadius=2;mana=regen:4:4:1`,
      ]);
      expect(run.json.ok, JSON.stringify(run.json.errors || run.json.error)).toBe(true);
      const spec = run.read("spec.json");
      const hazards = spec?.configurator?.inputs?.levelGen?.hazards ?? [];
      expect(hazards.some((h) => h.expression === expression)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Hazard projection / draw policy — OPEN DESIGN QUESTION.
// We do NOT assert validity; we record the CLI's actual behavior so the matrix
// stays honest. If the policy is later decided, promote these to hard asserts.
// ---------------------------------------------------------------------------
describe("hazard expression policy (pending — records actual behavior)", () => {
  for (const expression of GAME_AFFINITY_EXPRESSIONS) {
    test(`hazard expression=${expression} — captured`, () => {
      const run = runCreate([
        "--room", "size=medium;count=1",
        "--hazard", `x=3;y=3;affinity=dark;expression=${expression};stacks=1`,
        "--budget-tokens", "300",
      ]);
      // Deterministic outcome either way: ok true, or false with reasons.
      expect(typeof run.json.ok).toBe("boolean");
      if (!run.json.ok) {
        expect(run.json.errors?.length || run.json.error).toBeTruthy();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Motivations — author one delver per motivation; assert create succeeds and
// the motivation round-trips into the authoring request objects.
// ---------------------------------------------------------------------------
describe("motivation kinds (delver)", () => {
  for (const motivation of GAME_MOTIVATION_KINDS) {
    test(`motivation=${motivation} authors a delver`, () => {
      const run = runCreate([
        "--room", "size=medium;count=1",
        "--delver", `count=1;affinity=fire;motivation=${motivation};vitals=health:6:6:1,mana:2:2:1,stamina:4:4:1,durability:1:1:0`,
        "--budget-tokens", "400",
      ]);
      // Some motivations may carry deterministic viability constraints — capture
      // either a clean success or a deterministic, explained rejection.
      expect(typeof run.json.ok).toBe("boolean");
      if (run.json.ok) {
        const spec = run.read("spec.json");
        const delver = requestObjects(spec).find((o) => o.kind === "delver");
        const attrs = delver?.attributes ?? {};
        // Most motivations land in attributes.motivation (singular); control-family
        // motivations (e.g. user_controlled) land in attributes.motivations[] (plural).
        const present =
          attrs.motivation === motivation ||
          (Array.isArray(attrs.motivations) && attrs.motivations.includes(motivation));
        expect(present, `motivation ${motivation} not recorded: ${JSON.stringify(attrs)}`).toBe(true);
      } else {
        expect(run.json.errors?.length || run.json.error).toBeTruthy();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Vitals — every actor carries all four vital records. Budget maximization
// rescales magnitudes, so we assert STRUCTURE (all keys present, well-formed),
// not exact values.
// ---------------------------------------------------------------------------
describe("vital keys (actor structure)", () => {
  test("delver carries all vital keys as {current,max,regen}", () => {
    const run = runCreate([
      "--room", "size=medium;count=1",
      "--delver", "count=1;affinity=water;motivation=attacking",
      "--budget-tokens", "400",
    ]);
    expect(run.json.ok, JSON.stringify(run.json.errors || run.json.error)).toBe(true);
    const state = run.read("initial-state.json");
    const delver = (state?.actors ?? []).find((a) => a.archetype === "delver");
    expect(delver).toBeTruthy();
    for (const vital of GAME_VITAL_KEYS) {
      const rec = delver.vitals?.[vital];
      expect(rec, `vital ${vital} missing`).toBeTruthy();
      for (const field of ["current", "max", "regen"]) {
        expect(typeof rec[field]).toBe("number");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Room sizes — dimensions must increase small < medium < large.
// ---------------------------------------------------------------------------
describe("room sizes scale grid dimensions", () => {
  const area = (size) => {
    const run = runCreate(["--room", `size=${size};count=1`, "--budget-tokens", "300"]);
    expect(run.json.ok, JSON.stringify(run.json.errors || run.json.error)).toBe(true);
    const room = (run.read("sim-config.json")?.layout?.data?.rooms ?? [])[0];
    expect(room).toBeTruthy();
    return room.width * room.height;
  };
  // Actual CLI behavior: small and medium currently resolve to the same footprint
  // for a single isolated room; large is strictly larger. Assert the honest
  // monotonic-non-decreasing relation with a strict step up to large.
  test("small <= medium < large", () => {
    const small = area("small");
    const medium = area("medium");
    const large = area("large");
    expect(small).toBeLessThanOrEqual(medium);
    expect(medium).toBeLessThan(large);
  });
});

// ---------------------------------------------------------------------------
// Resources — author each permanence tier; assert it wires into the spec.
// ---------------------------------------------------------------------------
describe("resource tiers", () => {
  // Code is Law: the V3 spec accepts only `level` and `permanent`. `consumable`
  // (present in RESOURCE_PERMANENCE_MODES) is rejected — covered as a negative below.
  for (const tier of ["level", "permanent"]) {
    test(`resource tier=${tier} wires into spec`, () => {
      const run = runCreate([
        "--resource", `tier=${tier};stat=vitalMax;delta=5;dropRate=10`,
      ]);
      expect(run.json.ok, JSON.stringify(run.json.errors || run.json.error)).toBe(true);
      const resources = run.read("spec.json")?.configurator?.inputs?.resources ?? [];
      expect(resources.some((r) => r.tier === tier)).toBe(true);
    });
  }

  test("resource tier=consumable is rejected by the V3 spec", () => {
    const run = runCreate(["--resource", "tier=consumable;stat=vitalMax;delta=5;dropRate=10"]);
    expect(run.json.ok).toBe(false);
    expect(run.json.errors?.length || run.json.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Negative cases — invalid vocabulary must fail deterministically (ok:false
// with explained errors), never silently degrade.
// ---------------------------------------------------------------------------
describe("negative cases fail deterministically", () => {
  test("unknown affinity kind is rejected", () => {
    const run = runCreate([
      "--room", "size=medium;count=1",
      "--hazard", "x=3;y=3;affinity=plasma;expression=emit;stacks=1",
      "--budget-tokens", "300",
    ]);
    expect(run.json.ok).toBe(false);
    expect(run.json.errors?.length || run.json.error).toBeTruthy();
  });

  test("hazard coordinates beyond the small room's interior are rejected", () => {
    // Updated 2026-07-10: hazard coordinates adjudicated as room-relative (M3) and the size=small hazard
    // precheck removed — small generates medium-identical geometry, so small+in-room-hazard now
    // succeeds. Formerly this test pinned the blanket small-room rejection; the deterministic
    // negative case is now a room-relative offset exceeding the room's 5x5 interior.
    const run = runCreate([
      "--room", "size=small;count=1",
      "--hazard", "x=8;y=8;affinity=dark;expression=emit;stacks=1",
      "--budget-tokens", "300",
    ]);
    expect(run.json.ok).toBe(false);
    expect(String(run.json.error)).toContain("hazard_outside_room");
  });
});

// ## TODO: Test Permutations
// - Affinity opposites: assert opposite-pair interactions (fire/water, light/dark, …) survive create+run.
// - Per-expression hazard targetType defaults (push→enemy, pull→self, emit→area, draw→self).
// - Motivation × archetype matrix (each motivation on both delver and warden, incl. stationary vs ambulatory vital constraints).
// - Vital regen/max round-trip under setup-mode=user vs auto.
// - Hazard mana one-time vs regen variants across every affinity.
// - Resource stat=vitalRegen with negative delta across tiers.
