/**
 * M14 — Resource vital + regen payload: failing tests
 *
 * A resource's payload is not only affinity. It may be a vital (e.g. health), or a
 * vital + regen, or an affinity, or any combination.
 *
 * Resolved semantics (second dictation, 2026-07-16):
 *   - `regen` is a THIRD, INDEPENDENT grant. It does not replace or reinterpret
 *     permanenceMode. permanenceMode still governs the DELTA only:
 *       mode 0 (consumable)      → delta raises the actor's CURRENT vital
 *       mode 1/2 (level/perm)    → delta raises the actor's MAX vital
 *     …and regen is simply handed over on top, whatever the mode.
 *   - A granted vital regen is PERMANENT. The actor keeps it; it has no pool and
 *     never expires. This deliberately differs from affinity grants — core already
 *     stores actor vital regen as a plain rate (motivatedActorVitalRegen), and no
 *     pool machinery is being built for vitals.
 *   - A regen-only vital resource (delta 0, regen > 0) is legal.
 *   - Granted regen ADDS to the actor's existing regen; it does not replace it.
 *
 * Note `ResourceVitalGrant.regen?` already exists in the artifact contract —
 * declared long ago, never implemented. Same vestigial pattern as the rest of
 * resources.
 *
 * Tests MUST FAIL until M15 implements:
 *   1. `resourceVitalRegenByCell` in world.ts
 *   2. `placeResourceAt(x, y, vitalKind, delta, mode, regen?)` + getResourceVitalRegenAt
 *   3. applyResourceCaptureAt adding the granted regen to the actor's vital regen
 */
import { describe, expect, test } from "vitest";
import { createCore } from "../../packages/core-ts/src/index.ts";
import { Direction } from "../../packages/core-ts/src/rules/move.ts";
import { ActionKind } from "../../packages/core-ts/src/validate/inputs.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export — M15 must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

const DELVER = 10;
const WARDEN = 20;

function buildWorld(): Core {
  const core = createCore();
  call(core.configureGrid, 7, 7);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
  call(core.clearActorPlacements);
  call(core.addActorPlacement, DELVER, 1, 1);
  call(core.addActorPlacement, WARDEN, 4, 4);
  call(core.applyActorPlacements);
  for (const i of [0, 1]) {
    call(core.setMotivatedActorVital, i, VitalKind.Health, 6, 10, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Mana, 5, 10, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Stamina, 60, 60, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Durability, 5, 5, 0);
  }
  return core;
}

function directionFor(dx: number, dy: number): number {
  if (dx === 0 && dy === -1) return Direction.North;
  if (dx === 1 && dy === -1) return Direction.NorthEast;
  if (dx === 1 && dy === 0) return Direction.East;
  if (dx === 1 && dy === 1) return Direction.SouthEast;
  if (dx === 0 && dy === 1) return Direction.South;
  if (dx === -1 && dy === 1) return Direction.SouthWest;
  if (dx === -1 && dy === 0) return Direction.West;
  if (dx === -1 && dy === -1) return Direction.NorthWest;
  throw new Error(`not an adjacent step: ${dx},${dy}`);
}

function stepTo(core: Core, actorId: number, x: number, y: number): void {
  call(core.setActiveMotivatedActor, actorId);
  const fromX = call(core.getActorX) as number;
  const fromY = call(core.getActorY) as number;
  const tick = (call(core.getCurrentTick) as number) + 1;
  call(core.setMoveAction, actorId, fromX, fromY, x, y,
    directionFor(x - fromX, y - fromY), tick);
  call(core.applyAction, ActionKind.Move, 0);
}

/** placeResourceAt(x, y, vitalKind, delta, mode, regen?) */
function placeVital(
  core: Core,
  x: number,
  y: number,
  vitalKind: number,
  delta: number,
  mode: number,
  regen?: number,
): number {
  const args: unknown[] = [x, y, vitalKind, delta, mode];
  if (regen !== undefined) args.push(regen);
  return call((core as Record<string, unknown>).placeResourceAt, ...args) as number;
}

const cur = (core: Core, i: number, k: number) =>
  call(core.getMotivatedActorVitalCurrentByIndex, i, k) as number;
const max = (core: Core, i: number, k: number) =>
  call(core.getMotivatedActorVitalMaxByIndex, i, k) as number;
const rgn = (core: Core, i: number, k: number) =>
  call(core.getMotivatedActorVitalRegenByIndex, i, k) as number;

// ---------------------------------------------------------------------------
// API + placement
// ---------------------------------------------------------------------------

describe("M14 API surface", () => {
  test("getResourceVitalRegenAt is exported", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).getResourceVitalRegenAt).toBe("function");
  });

  test("placeResourceAt stores a trailing regen", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 5, 0, 2);
    expect(call((core as Record<string, unknown>).getResourceVitalRegenAt, 2, 1)).toBe(2);
  });

  test("regen defaults to 0 when omitted — existing 5-arg calls are unchanged", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 5, 0);
    expect(call((core as Record<string, unknown>).getResourceVitalRegenAt, 2, 1)).toBe(0);
  });

  test("negative regen is rejected", () => {
    const core = buildWorld();
    expect(placeVital(core, 2, 1, VitalKind.Health, 5, 0, -1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The dictated case: a vital, or a vital + regen
// ---------------------------------------------------------------------------

describe("passing over a vital resource grants the vital", () => {
  test("a health resource raises current health (consumable)", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 3, 0);
    stepTo(core, DELVER, 2, 1);
    expect(cur(core, 0, VitalKind.Health)).toBe(9); // 6 + 3
    expect(rgn(core, 0, VitalKind.Health)).toBe(0); // no regen granted
  });

  test("a vital + regen resource grants BOTH the delta and the regen", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 3, 0, 2);
    stepTo(core, DELVER, 2, 1);
    expect(cur(core, 0, VitalKind.Health)).toBe(9); // delta still applies
    expect(rgn(core, 0, VitalKind.Health)).toBe(2); // and regen is granted
  });

  test("a regen-only resource (delta 0) grants regen and nothing else", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 0, 0, 3);
    stepTo(core, DELVER, 2, 1);
    expect(cur(core, 0, VitalKind.Health)).toBe(6); // unchanged
    expect(rgn(core, 0, VitalKind.Health)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// regen is independent of permanenceMode
// ---------------------------------------------------------------------------

describe("regen is independent of permanenceMode", () => {
  test("consumable + regen: delta hits current, regen is granted on top", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 2, 0, 1);
    stepTo(core, DELVER, 2, 1);
    expect(cur(core, 0, VitalKind.Health)).toBe(8); // 6 + 2
    expect(max(core, 0, VitalKind.Health)).toBe(10); // max untouched by consumable
    expect(rgn(core, 0, VitalKind.Health)).toBe(1);
  });

  test("level + regen: delta hits max, regen is granted on top", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 4, 1, 1);
    stepTo(core, DELVER, 2, 1);
    expect(max(core, 0, VitalKind.Health)).toBe(14); // 10 + 4
    expect(rgn(core, 0, VitalKind.Health)).toBe(1);
  });

  test("permanenceMode semantics are unchanged when no regen is present", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 4, 1);
    stepTo(core, DELVER, 2, 1);
    expect(max(core, 0, VitalKind.Health)).toBe(14);
    expect(rgn(core, 0, VitalKind.Health)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Granted regen is permanent and additive
// ---------------------------------------------------------------------------

describe("granted vital regen is permanent and additive", () => {
  test("the regen persists and actually heals across ticks", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 0, 0, 2);
    stepTo(core, DELVER, 2, 1);
    const afterPickup = cur(core, 0, VitalKind.Health);
    call(core.advanceTick);
    expect(cur(core, 0, VitalKind.Health)).toBe(Math.min(10, afterPickup + 2));
  });

  test("it never expires — still regenerating many ticks later", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 0, 0, 1);
    stepTo(core, DELVER, 2, 1);
    for (let i = 0; i < 20; i++) call(core.advanceTick);
    expect(rgn(core, 0, VitalKind.Health)).toBe(1); // rate intact
    expect(cur(core, 0, VitalKind.Health)).toBe(10); // healed to max
  });

  test("granted regen ADDS to existing regen rather than replacing it", () => {
    const core = buildWorld();
    call(core.setMotivatedActorVital, 0, VitalKind.Health, 6, 20, 1); // already regen 1
    placeVital(core, 2, 1, VitalKind.Health, 0, 0, 2);
    stepTo(core, DELVER, 2, 1);
    expect(rgn(core, 0, VitalKind.Health)).toBe(3); // 1 + 2
  });

  test("two regen resources accumulate", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 0, 0, 1);
    placeVital(core, 3, 1, VitalKind.Health, 0, 0, 2);
    stepTo(core, DELVER, 2, 1);
    stepTo(core, DELVER, 3, 1);
    expect(rgn(core, 0, VitalKind.Health)).toBe(3);
  });

  test("regen on one vital does not leak into another", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Mana, 0, 0, 2);
    stepTo(core, DELVER, 2, 1);
    expect(rgn(core, 0, VitalKind.Mana)).toBe(2);
    expect(rgn(core, 0, VitalKind.Health)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Actor parity and independence
// ---------------------------------------------------------------------------

describe("delvers and wardens both take vital regen resources", () => {
  test("a warden gains regen the same way a delver does", () => {
    const core = buildWorld();
    placeVital(core, 4, 3, VitalKind.Health, 0, 0, 2);
    stepTo(core, WARDEN, 4, 3);
    expect(rgn(core, 1, VitalKind.Health)).toBe(2);
    expect(rgn(core, 0, VitalKind.Health)).toBe(0); // delver unaffected
  });
});

// ---------------------------------------------------------------------------
// Combined payloads
// ---------------------------------------------------------------------------

describe("a resource may carry a vital+regen payload and an affinity payload", () => {
  test("both are granted on one pass-over", () => {
    const core = buildWorld();
    placeVital(core, 2, 1, VitalKind.Health, 2, 0, 1);
    call((core as Record<string, unknown>).placeAffinityResourceAt,
      2, 1, 2 /* water */, 3 /* emit */, 2, 20, 0);

    stepTo(core, DELVER, 2, 1);

    expect(cur(core, 0, VitalKind.Health)).toBe(8);
    expect(rgn(core, 0, VitalKind.Health)).toBe(1);
    expect(call((core as Record<string, unknown>).getMotivatedActorAffinityStacksForKind, 0, 2)).toBe(2);
    expect(call((core as Record<string, unknown>).hasResourceAt, 2, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations
//
// Hand to Ollama (/ollama-test-permutations) once M15 is green. Expand:
//   - All 4 VitalKinds × 3 permanenceModes × regen 0..3.
//   - Regen clamping at max across many ticks for each vital.
//   - Durability regen (core skips durability in actor regen — verify the granted
//     rate is stored even if the tick loop ignores it).
//   - Negative delta with positive regen (a damaging resource that grants regen).
//   - Ten actors each taking their own regen resource independently.
// ---------------------------------------------------------------------------
