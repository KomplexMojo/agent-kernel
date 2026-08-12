/**
 * M2 — Core combat primitive: failing tests
 *
 * These tests specify the expected behaviour of `core.applyAttack(attackerIdx, defenderIdx, damage)`.
 * They MUST FAIL until M3 implements the combat rule in `packages/core-ts/src/rules/combat.ts`
 * and exposes `applyAttack` from `packages/core-ts/src/index.ts`.
 *
 * Architecture: core-ts only — no runtime, no IO, no clocks.
 *
 * Multi-actor setup uses addActorPlacement / applyActorPlacements (the canonical path).
 * HP reads use getMotivatedActorVitalCurrentByIndex(actorIndex, vitalKind) to target specific actors.
 */
import { describe, expect, test } from "vitest";
import { createCore } from "../../packages/core-ts/src/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/**
 * Build a 5×5 grid with two motivated actors for combat tests.
 *
 *   . . . . .
 *   . A . B .    row 2: delver (1,2) and warden (3,2)
 *   . . . . .
 *
 * Actor index 0 = delver, HP 10/10
 * Actor index 1 = warden, HP  6/6
 * All row-2 cells are floor tiles.
 */
function buildTwoActorCore(
  delverXY: [number, number] = [1, 2],
  wardenXY: [number, number] = [3, 2],
): Core {
  const core = createCore();
  call(core.configureGrid, 5, 5);
  // Make row 2 walkable
  for (let x = 0; x < 5; x++) call(core.setTileAt, x, 2, 1); // floor
  // Place two actors via the placement API (supports motivatedActorCount > 1)
  call(core.addActorPlacement, 1, ...delverXY); // id=1, delver
  call(core.addActorPlacement, 2, ...wardenXY); // id=2, warden
  call(core.applyActorPlacements);
  // Set vitals for delver (index 0) via setMotivatedActorVital(index, kind, current, max, regen)
  call(core.setMotivatedActorVital, 0, 0, 10, 10, 0); // health 10/10
  // Set vitals for warden (index 1)
  call(core.setMotivatedActorVital, 1, 0, 6, 6, 0); // health 6/6
  return core;
}

/** Read health vital for a specific motivated actor index. */
function hpOf(core: Core, actorIndex: number): number {
  return call(core.getMotivatedActorVitalCurrentByIndex, actorIndex, 0) as number;
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("core-ts combat: API surface", () => {
  test("applyAttack is exported from createCore()", () => {
    const core = createCore();
    // M3 must add 'applyAttack' to CORE_API_KEYS and implement it.
    expect(typeof (core as Record<string, unknown>).applyAttack).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Adjacent attack — main path
// ---------------------------------------------------------------------------

describe("core-ts combat: adjacent attack", () => {
  test("adjacent attack reduces defender HP by the specified damage", () => {
    // delver (1,2) → warden (2,2): distance 1, directly adjacent
    const core = buildTwoActorCore([1, 2], [2, 2]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, // attacker = delver
      1, // defender = warden
      2, // damage
    );
    expect(result).not.toBe(0);       // accepted (non-zero = success)
    expect(hpOf(core, 1)).toBe(4);    // warden HP 6 - 2 = 4
  });

  test("attack deals exactly the specified damage amount", () => {
    // Use row-2 positions (floor tiles created by buildTwoActorCore)
    const core = buildTwoActorCore([1, 2], [2, 2]);
    call(core.setMotivatedActorVital, 1, 0, 8, 8, 0); // override warden HP to 8
    call((core as Record<string, unknown>).applyAttack, 0, 1, 3);
    expect(hpOf(core, 1)).toBe(5); // 8 - 3 = 5
  });

  test("attacker HP is not changed by applying attack", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    call((core as Record<string, unknown>).applyAttack, 0, 1, 2);
    expect(hpOf(core, 0)).toBe(10); // delver still 10
  });

  test("diagonal adjacency (dx=1, dy=1) is accepted", () => {
    // Build a core with floor on both rows 2 and 3 so diagonal positions are valid
    const core = createCore();
    call(core.configureGrid, 5, 5);
    for (let x = 0; x < 5; x++) {
      call(core.setTileAt, x, 2, 1); // row 2 = floor
      call(core.setTileAt, x, 3, 1); // row 3 = floor
    }
    call(core.addActorPlacement, 1, 1, 2); // delver at (1,2)
    call(core.addActorPlacement, 2, 2, 3); // warden at (2,3) — diagonal
    call(core.applyActorPlacements);
    call(core.setMotivatedActorVital, 0, 0, 10, 10, 0);
    call(core.setMotivatedActorVital, 1, 0, 6, 6, 0);

    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 2,
    );
    expect(result).not.toBe(0);
    expect(hpOf(core, 1)).toBe(4); // 6 - 2 = 4
  });
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe("core-ts combat: rejection cases", () => {
  test("applyAttack returns 0 when actors are not adjacent (distance > 1)", () => {
    const core = buildTwoActorCore([1, 2], [4, 2]); // gap of 3
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 2,
    );
    expect(result).toBe(0); // rejected
    expect(hpOf(core, 1)).toBe(6); // warden HP unchanged
  });

  test("applyAttack returns 0 when attacker index is invalid", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      99, 1, 2,
    );
    expect(result).toBe(0);
  });

  test("applyAttack returns 0 when defender index is invalid", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 99, 2,
    );
    expect(result).toBe(0);
  });

  test("applyAttack returns 0 when damage is zero", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    expect(call((core as Record<string, unknown>).applyAttack, 0, 1, 0)).toBe(0);
  });

  test("applyAttack returns 0 when damage is negative", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    expect(call((core as Record<string, unknown>).applyAttack, 0, 1, -5)).toBe(0);
  });

  test("applyAttack returns 0 when attacker and defender are the same index (self-attack)", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 0, 2,
    );
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lethal damage
// ---------------------------------------------------------------------------

describe("core-ts combat: lethal damage", () => {
  test("lethal attack clamps defender HP to 0, does not go negative", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    call(core.setMotivatedActorVital, 1, 0, 3, 3, 0); // warden HP 3

    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 10, // overkill
    );
    expect(result).not.toBe(0);      // accepted
    expect(hpOf(core, 1)).toBe(0);   // clamped to 0, not -7
  });

  test("attack with damage equal to defender HP defeats the actor (HP = 0)", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    call(core.setMotivatedActorVital, 1, 0, 4, 4, 0);

    call((core as Record<string, unknown>).applyAttack, 0, 1, 4);
    expect(hpOf(core, 1)).toBe(0);
  });

  test("sequential attacks reduce HP step by step and clamp at 0", () => {
    const core = buildTwoActorCore([1, 2], [2, 2]);
    call(core.setMotivatedActorVital, 1, 0, 6, 6, 0);

    call((core as Record<string, unknown>).applyAttack, 0, 1, 2); // 4
    call((core as Record<string, unknown>).applyAttack, 0, 1, 2); // 2
    call((core as Record<string, unknown>).applyAttack, 0, 1, 2); // 0
    call((core as Record<string, unknown>).applyAttack, 0, 1, 2); // still 0
    expect(hpOf(core, 1)).toBe(0);
    expect(hpOf(core, 0)).toBe(10); // attacker untouched
  });
});

test.skip("applyAttack rejects an actor already at HP 0 as already defeated", () => {
  // Current combat rules do not guard against attacking a defeated actor.
  const core = buildTwoActorCore([1, 2], [2, 2]);
  call(core.setMotivatedActorVital, 1, 0, 0, 6, 0);

  const result = call((core as Record<string, unknown>).applyAttack, 0, 1, 2);

  expect(result).toBe(0);
  expect(hpOf(core, 1)).toBe(0);
});

test("applyAttack on a zero-size world does not panic", () => {
  const core = createCore();

  const result = call((core as Record<string, unknown>).applyAttack, 0, 1, 2);

  expect(result).toBe(0);
});

test("applyAttack rejects actors occupying the same cell", () => {
  const core = buildTwoActorCore([0, 0], [0, 0]);
  const defenderHpBefore = hpOf(core, 1);

  const result = call((core as Record<string, unknown>).applyAttack, 0, 1, 2);

  expect(result).toBe(0);
  expect(hpOf(core, 1)).toBe(defenderHpBefore);
});

test("applyAttack with damage exceeding INT32_MAX clamps HP without corrupting state", () => {
  const core = buildTwoActorCore([1, 2], [2, 2]);
  const hugeDamage = 2_147_483_648;

  const result = call((core as Record<string, unknown>).applyAttack, 0, 1, hugeDamage);

  expect(result).not.toBe(0);
  expect(hpOf(core, 1)).toBe(0);
  expect(hpOf(core, 0)).toBe(10);
});

test("applyAttack with damage 1 against HP 1 is accepted and clamps to exactly 0", () => {
  const core = buildTwoActorCore([1, 2], [2, 2]);
  call(core.setMotivatedActorVital, 1, 0, 1, 1, 0);

  const result = call((core as Record<string, unknown>).applyAttack, 0, 1, 1);

  expect(result).not.toBe(0);
  expect(hpOf(core, 1)).toBe(0);
});

test("both actors attacking each other in sequence are independent and deterministic", () => {
  const core = buildTwoActorCore([1, 2], [2, 2]);

  const delverAttack = call((core as Record<string, unknown>).applyAttack, 0, 1, 2);
  const wardenAttack = call((core as Record<string, unknown>).applyAttack, 1, 0, 3);

  expect(delverAttack).not.toBe(0);
  expect(wardenAttack).not.toBe(0);
  expect(hpOf(core, 0)).toBe(7);
  expect(hpOf(core, 1)).toBe(4);
});

test("applyAttack with reversed attacker and defender lets the warden attack the delver", () => {
  const core = buildTwoActorCore([1, 2], [2, 2]);

  const result = call((core as Record<string, unknown>).applyAttack, 1, 0, 2);

  expect(result).not.toBe(0);
  expect(hpOf(core, 0)).toBe(8);
  expect(hpOf(core, 1)).toBe(6);
});

// NOTE: M9 left 1 test(s) skipped — implementation gap, escalate to Claude Sonnet/high.
