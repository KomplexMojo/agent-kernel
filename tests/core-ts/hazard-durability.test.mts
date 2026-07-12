/**
 * M3c — Hazard Durability + Destruction: failing tests
 *
 * Static hazards gain a durability vital (current / max / regen).
 * Durability-routing affinities (Earth, Corrode, Fortify) applied via
 * `applyAffinityDamageToHazard` drain or buff hazard durability.
 * When durability reaches 0 the hazard is destroyed (disarmed).
 *
 * Design choices encoded here:
 *   - `armStaticHazardAt` gains three optional trailing params for durability:
 *       armStaticHazardAt(x, y, kind, expr, stacks, mana, durCurrent?, durMax?, durRegen?)
 *   - durabilityMax == 0 → "immortal" hazard; durability damage is rejected (0)
 *   - `applyAffinityDamageToHazard(attackerIndex, hazardX, hazardY, kind, expr, stacks)`
 *       routes only affinities that target VitalKind.Durability; others return 0
 *   - Push/Pull enforce Chebyshev range ≤ stacks from attacker to (hazardX, hazardY)
 *
 * Tests MUST FAIL until M3c implements:
 *   1. Per-hazard durability arrays in `packages/core-ts/src/state/world.ts`
 *   2. `armStaticHazardAt` extended with optional durability params
 *   3. Getters: `getStaticHazardDurabilityAt`, `getStaticHazardDurabilityMaxAt`,
 *      `getStaticHazardDurabilityRegenAt`
 *   4. `applyAffinityDamageToHazard` in `packages/core-ts/src/rules/affinity-damage.ts`
 *   5. All new symbols wired into `createCore()` with `CORE_API_KEYS` alphabetical
 */
import { describe, expect, test } from "vitest";
import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
} from "../../packages/core-ts/src/state/affinity.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export — M3c must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/** 7×7 floor grid with a single actor at actorXY. */
function buildActorWorld(
  actorXY: [number, number] = [1, 1],
  actorManaMax = 10,
  actorManaCurrent = 10,
): Core {
  const core = createCore();
  call(core.configureGrid, 7, 7);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
  call(core.addActorPlacement, 1, ...actorXY);
  call(core.applyActorPlacements);
  call(core.setMotivatedActorVital, 0, VitalKind.Health,     10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Mana,       actorManaCurrent, actorManaMax, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Stamina,    10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Durability,  5,  5, 0);
  return core;
}

/** 7×7 world with actor at actorXY and a hazard at hazardXY with given durability config. */
function buildActorHazardWorld(
  actorXY: [number, number],
  hazardXY: [number, number],
  hazardKind: number,
  hazardExpr: number,
  hazardStacks: number,
  hazardMana: number,
  durCurrent: number,
  durMax: number,
  durRegen: number,
): Core {
  const core = buildActorWorld(actorXY);
  call(
    core.armStaticHazardAt,
    ...hazardXY, hazardKind, hazardExpr, hazardStacks, hazardMana,
    durCurrent, durMax, durRegen,
  );
  return core;
}

/** Also builds two actor world with a hazard (for regression testing). */
function buildTwoActorHazardWorld(
  attackerXY: [number, number] = [1, 1],
  defenderXY: [number, number] = [2, 1],
  hazardXY: [number, number] = [3, 1],
): Core {
  const core = createCore();
  call(core.configureGrid, 7, 7);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
  call(core.addActorPlacement, 1, ...attackerXY);
  call(core.addActorPlacement, 2, ...defenderXY);
  call(core.applyActorPlacements);
  for (const idx of [0, 1]) {
    call(core.setMotivatedActorVital, idx, VitalKind.Health,     10, 10, 0);
    call(core.setMotivatedActorVital, idx, VitalKind.Mana,       10, 10, 0);
    call(core.setMotivatedActorVital, idx, VitalKind.Stamina,    10, 10, 0);
    call(core.setMotivatedActorVital, idx, VitalKind.Durability,  5,  5, 0);
  }
  // Hazard with durability 6/6
  call(core.armStaticHazardAt, ...hazardXY,
    AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
    6, 6, 0,
  );
  return core;
}

function durOf(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardDurabilityAt, x, y) as number;
}

function durMaxOf(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardDurabilityMaxAt, x, y) as number;
}

function durRegenOf(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardDurabilityRegenAt, x, y) as number;
}

function hazardExists(core: Core, x: number, y: number): boolean {
  return (call(core.getStaticHazardAffinityAt, x, y) as number) > 0;
}

function actorDurOf(core: Core, idx: number): number {
  return call(core.getMotivatedActorVitalCurrentByIndex, idx, VitalKind.Durability) as number;
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("M3c API surface", () => {
  test("getStaticHazardDurabilityAt is exported from createCore()", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).getStaticHazardDurabilityAt).toBe("function");
  });

  test("getStaticHazardDurabilityMaxAt is exported from createCore()", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).getStaticHazardDurabilityMaxAt).toBe("function");
  });

  test("getStaticHazardDurabilityRegenAt is exported from createCore()", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).getStaticHazardDurabilityRegenAt).toBe("function");
  });

  test("applyAffinityDamageToHazard is exported from createCore()", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).applyAffinityDamageToHazard).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Spawn-time durability configuration
// ---------------------------------------------------------------------------

describe("armStaticHazardAt: durability configuration", () => {
  test("arm with (5, 5, 0) → getters return correct values", () => {
    const core = buildActorWorld([1, 1]);
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      5, 5, 0,
    );
    expect(durOf(core, 2, 1)).toBe(5);
    expect(durMaxOf(core, 2, 1)).toBe(5);
    expect(durRegenOf(core, 2, 1)).toBe(0);
  });

  test("arm with (3, 10, 1) → getters return correct values", () => {
    const core = buildActorWorld([1, 1]);
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 2, 4,
      3, 10, 1,
    );
    expect(durOf(core, 2, 1)).toBe(3);
    expect(durMaxOf(core, 2, 1)).toBe(10);
    expect(durRegenOf(core, 2, 1)).toBe(1);
  });

  test("arm with (0, 0, 0) → immortal hazard; getters return 0/0/0", () => {
    const core = buildActorWorld([1, 1]);
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 3,
      0, 0, 0,
    );
    expect(durOf(core, 2, 1)).toBe(0);
    expect(durMaxOf(core, 2, 1)).toBe(0);
    expect(durRegenOf(core, 2, 1)).toBe(0);
  });

  test("arm without durability params (legacy 6-arg call) → durability defaults to 0/0/0", () => {
    const core = buildActorWorld([1, 1]);
    // Original 6-arg call — must still work (no breaking change)
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
    );
    expect(durOf(core, 2, 1)).toBe(0);
    expect(durMaxOf(core, 2, 1)).toBe(0);
  });

  test("getStaticHazardDurabilityAt returns 0 for a cell with no hazard", () => {
    const core = buildActorWorld([1, 1]);
    expect(durOf(core, 4, 4)).toBe(0);
  });

  test("disarm clears durability getters", () => {
    const core = buildActorWorld([1, 1]);
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      8, 8, 1,
    );
    call(core.disarmStaticHazardAt, 2, 1);
    expect(durOf(core, 2, 1)).toBe(0);
    expect(durMaxOf(core, 2, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyAffinityDamageToHazard: durability routing
// ---------------------------------------------------------------------------

describe("applyAffinityDamageToHazard: durability drain (Corrode+Push)", () => {
  test("Corrode+Push at stacks=1 drains hazard durability by 2", () => {
    // actor at (1,1), hazard at (2,1), durability 6/6, Corrode push range=1
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      6, 6, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(result).not.toBe(0);
    expect(durOf(core, 2, 1)).toBe(4); // 6 - 2
  });

  test("Corrode+Push at stacks=2 drains durability by 4", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      10, 10, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 2,
    );
    expect(durOf(core, 2, 1)).toBe(6); // 10 - 4
  });

  test("Corrode+Pull BUFFS hazard durability (sign-reversed)", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      3, 10, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Pull, 1,
    );
    expect(durOf(core, 2, 1)).toBe(5); // 3 + 2
  });

  test("Fortify+Push buffs hazard durability by 2 per stack", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      2, 10, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Fortify, AffinityExpression.Push, 1,
    );
    expect(durOf(core, 2, 1)).toBe(4); // 2 + 2
  });

  test("buff clamps at durabilityMax", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      9, 10, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Fortify, AffinityExpression.Push, 5, // +10 vs max 10
    );
    expect(durOf(core, 2, 1)).toBe(10); // clamped at max
  });
});

// ---------------------------------------------------------------------------
// Destruction rule
// ---------------------------------------------------------------------------

describe("applyAffinityDamageToHazard: destruction (durability reaches 0)", () => {
  test("lethal Corrode+Push destroys the hazard (durability to 0 → disarmed)", () => {
    // hazard durability 3/3, Corrode+Push stacks=2 → -4 → clamp to 0 → destroyed
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      3, 3, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 2,
    );
    expect(hazardExists(core, 2, 1)).toBe(false); // hazard disarmed
  });

  test("after destruction, durability getters return 0", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      2, 2, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 2,
    );
    expect(durOf(core, 2, 1)).toBe(0);
    expect(durMaxOf(core, 2, 1)).toBe(0);
  });

  test("subsequent operation against destroyed cell is rejected (0)", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      1, 1, 0,
    );
    // First hit destroys
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    // Second hit should be rejected
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
  });

  test("non-lethal hit leaves hazard armed", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      5, 5, 0,
    );
    call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1, // -2 → durability 3
    );
    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(durOf(core, 2, 1)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Immortal hazard (durabilityMax == 0)
// ---------------------------------------------------------------------------

describe("applyAffinityDamageToHazard: immortal hazard (durabilityMax == 0)", () => {
  test("Corrode+Push against immortal hazard (max=0) is rejected (0)", () => {
    // arm with (0,0,0) durability — immortal
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      0, 0, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
    expect(hazardExists(core, 2, 1)).toBe(true); // still armed
  });

  test("legacy-armed hazard (no durability params) is also immortal", () => {
    const core = buildActorWorld([1, 1]);
    call(core.armStaticHazardAt, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1, 5);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
    expect(hazardExists(core, 2, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Range semantics (Push/Pull)
// ---------------------------------------------------------------------------

describe("applyAffinityDamageToHazard: range semantics", () => {
  test("Push at stacks=1 accepted when hazard is 1 tile away (Chebyshev = 1)", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      4, 4, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(result).not.toBe(0);
  });

  test("Push at stacks=1 rejected when hazard is 2 tiles away", () => {
    const core = buildActorHazardWorld(
      [1, 1], [3, 1],
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      4, 4, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 3, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
    expect(durOf(core, 3, 1)).toBe(4); // unchanged
  });

  test("Emit has no range constraint", () => {
    // actor at (1,1), hazard at (5,5), Chebyshev = 4, Emit ignores range
    const core = buildActorHazardWorld(
      [1, 1], [5, 5],
      AffinityKind.Corrode, AffinityExpression.Emit, 1, 5,
      6, 6, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 5, 5, AffinityKind.Corrode, AffinityExpression.Emit, 1,
    );
    expect(result).not.toBe(0);
    expect(durOf(core, 5, 5)).toBe(5); // 6 - 1 (emit base = 1)
  });
});

// ---------------------------------------------------------------------------
// Routing isolation
// ---------------------------------------------------------------------------

describe("applyAffinityDamageToHazard: routing isolation", () => {
  test("Fire+Push (routes to Health) targeting hazard is rejected (0) — hazards have no Health", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      4, 4, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
    expect(durOf(core, 2, 1)).toBe(4); // unchanged
  });

  test("applyAffinityDamage (actor target) Corrode+Push still drains actor durability, not hazard", () => {
    const core = buildTwoActorHazardWorld([1, 1], [2, 1], [3, 1]);
    const hazardDurBefore = durOf(core, 3, 1);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    // Actor 1's durability is drained
    expect(actorDurOf(core, 1)).toBe(3); // 5 - 2
    // Hazard durability is untouched
    expect(durOf(core, 3, 1)).toBe(hazardDurBefore);
  });
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe("applyAffinityDamageToHazard: rejection cases", () => {
  test("invalid attacker index → 0", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Push, 1, 5, 6, 6, 0,
    );
    expect(call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      99, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    )).toBe(0);
  });

  test("invalid affinity kind → 0", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Push, 1, 5, 6, 6, 0,
    );
    expect(call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, 99, AffinityExpression.Push, 1,
    )).toBe(0);
  });

  test("invalid expression → 0", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Push, 1, 5, 6, 6, 0,
    );
    expect(call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, 99, 1,
    )).toBe(0);
  });

  test("zero stacks → 0", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Push, 1, 5, 6, 6, 0,
    );
    expect(call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 0,
    )).toBe(0);
  });

  test("no hazard at target cell → 0", () => {
    const core = buildActorWorld([1, 1]);
    expect(call(
      (core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 3, 3, AffinityKind.Corrode, AffinityExpression.Push, 1,
    )).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PR #42 + M3b regression
// ---------------------------------------------------------------------------

describe("M3c: prior milestone non-regression", () => {
  test("applyAttack still works and is unaffected by hazard durability changes", () => {
    const core = buildTwoActorHazardWorld([1, 1], [2, 1], [3, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 3,
    );
    expect(result).not.toBe(0);
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 1, VitalKind.Health)).toBe(7);
  });

  test("applyAffinityDamage (actor target) still passes all existing matrix routing", () => {
    const core = buildTwoActorHazardWorld([1, 1], [2, 1], [3, 1]);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 1, VitalKind.Health)).toBe(8); // -2
  });

  test("applyAffinityPullFromHazard (M3b) drains hazard mana to 0, structure preserved", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Fire, AffinityExpression.Emit, 1, 6,
      0, 0, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result).not.toBe(0);
    expect(call(core.getStaticHazardManaReserveAt, 2, 1)).toBe(0); // mana drained
    expect(hazardExists(core, 2, 1)).toBe(true);                   // structure intact
  });
});

// ---------------------------------------------------------------------------
// M3d regression — durability regen and destroyed-is-terminal
// ---------------------------------------------------------------------------

describe("M3d regression: hazard durability regen via advanceTick", () => {
  test("partially damaged hazard with durRegen=1 heals back each tick", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      3, 8, 1, // durCurrent=3, durMax=8, durRegen=1
    );
    // One tick → durability 3 + 1 = 4
    call(core.advanceTick);
    expect(durOf(core, 2, 1)).toBe(4);
    // Another tick → 5
    call(core.advanceTick);
    expect(durOf(core, 2, 1)).toBe(5);
  });

  test("destroyed hazard (durability → 0) stays destroyed across many ticks", () => {
    const core = buildActorHazardWorld(
      [1, 1], [2, 1],
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      1, 1, 2, // durability: current=1, max=1, regen=2 (would regen if not terminal)
    );
    call((core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(hazardExists(core, 2, 1)).toBe(false);
    for (let i = 0; i < 5; i++) call(core.advanceTick);
    expect(hazardExists(core, 2, 1)).toBe(false);
    expect(durOf(core, 2, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Permutations: all 3 durability affinities × 4 expressions — routing and sign
// ---------------------------------------------------------------------------

describe("permutations: all 3 durability affinities × 4 expressions route correctly to hazard durability", () => {
  // Durability polarity: Earth=+1, Corrode=−1, Fortify=+1
  const DUR_ROUTE = [
    { kind: AffinityKind.Earth,   polarity: +1 },
    { kind: AffinityKind.Corrode, polarity: -1 },
    { kind: AffinityKind.Fortify, polarity: +1 },
  ];
  const ALL_EXPRS = [
    AffinityExpression.Push, AffinityExpression.Pull,
    AffinityExpression.Emit, AffinityExpression.Draw,
  ];

  test("each (durability-affinity × expression) changes hazard durability by the matrix-predicted amount", () => {
    // Actor at (1,1), hazard at (2,1); distance=1 satisfies Push/Pull range for stacks=1
    const DUR_START = 5;
    const DUR_MAX = 10;

    for (const { kind, polarity } of DUR_ROUTE) {
      for (const expr of ALL_EXPRS) {
        const core = buildActorHazardWorld([1, 1], [2, 1], kind, AffinityExpression.Emit, 1, 4, DUR_START, DUR_MAX, 0);
        const base = (expr === AffinityExpression.Push || expr === AffinityExpression.Pull) ? 2 : 1;
        const sign = (expr === AffinityExpression.Pull || expr === AffinityExpression.Draw) ? -polarity : polarity;
        const effect = sign * base;
        const expectedDur = Math.max(0, Math.min(DUR_MAX, DUR_START + effect));

        const result = call(
          (core as Record<string, unknown>).applyAffinityDamageToHazard,
          0, 2, 1, kind, expr, 1,
        ) as number;

        if (expectedDur === 0) {
          // Destruction case: hazard no longer exists
          expect(result).not.toBe(0);
          expect(hazardExists(core, 2, 1)).toBe(false);
        } else {
          expect(result).not.toBe(0);
          expect(durOf(core, 2, 1)).toBe(expectedDur);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: step-by-step drain to exactly 0 — destruction on the final hit
// ---------------------------------------------------------------------------

describe("permutations: drain sequence — destruction happens on the hit that reaches 0, not before", () => {
  test("Corrode+Push: durability 6 → 4 → 2 → destroyed on third hit (not on the second)", () => {
    const core = buildActorHazardWorld([1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 6, 6, 0);
    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);
    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(durOf(core, 2, 1)).toBe(4);

    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);
    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(durOf(core, 2, 1)).toBe(2);

    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);
    expect(hazardExists(core, 2, 1)).toBe(false); // destroyed on the third hit
  });
});

// ---------------------------------------------------------------------------
// Permutations: buff after partial damage does not exceed durabilityMax
// ---------------------------------------------------------------------------

describe("permutations: Fortify+Push repairs durability but clamps at durabilityMax", () => {
  test("partial Corrode drain then Fortify repair — durability clamped at max, does not overflow", () => {
    // Start dur 6/8; Corrode-2 → 4; then Fortify+Push×3 buffs by +6 → clamped at 8
    const core = buildActorHazardWorld([1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 6, 8, 0);
    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);
    expect(durOf(core, 2, 1)).toBe(4);

    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Fortify, AffinityExpression.Push, 3);
    expect(durOf(core, 2, 1)).toBe(8); // clamped at max
    expect(durMaxOf(core, 2, 1)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Permutations: stacks=1..5 → magnitude scales linearly (base × stacks)
// ---------------------------------------------------------------------------

describe("permutations: magnitude scales linearly with stacks for durability affinities", () => {
  for (const stacks of [1, 2, 3, 4, 5]) {
    test(`Earth+Emit at stacks=${stacks} increases hazard durability by ${stacks}`, () => {
      const DUR_START = 5;
      const DUR_MAX = 20; // large enough to never clamp for stacks=1..5
      const core = buildActorHazardWorld([1, 1], [2, 1], AffinityKind.Earth, AffinityExpression.Emit, 1, 4, DUR_START, DUR_MAX, 0);
      call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Earth, AffinityExpression.Emit, stacks);
      expect(durOf(core, 2, 1)).toBe(DUR_START + stacks); // Emit base=1 × stacks
    });
  }
});

// ---------------------------------------------------------------------------
// Permutations: non-durability affinities return 0 and leave hazard unchanged
// ---------------------------------------------------------------------------

describe("permutations: non-durability affinities return 0 and do not affect hazard durability", () => {
  const NON_DUR_KINDS = [
    AffinityKind.Fire, AffinityKind.Water, AffinityKind.Wind,
    AffinityKind.Life, AffinityKind.Decay, AffinityKind.Light, AffinityKind.Dark,
  ];

  test("all 7 non-durability affinities return 0 from applyAffinityDamageToHazard with Push", () => {
    for (const kind of NON_DUR_KINDS) {
      const core = buildActorHazardWorld([1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 6, 6, 0);
      const durBefore = durOf(core, 2, 1);
      const result = call(
        (core as Record<string, unknown>).applyAffinityDamageToHazard,
        0, 2, 1, kind, AffinityExpression.Push, 1,
      ) as number;
      expect(result).toBe(0);
      expect(durOf(core, 2, 1)).toBe(durBefore); // unchanged
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: grid corner cells — no off-by-one in getters or damage
// ---------------------------------------------------------------------------

describe("permutations: applyAffinityDamageToHazard and getters work at grid boundary cells", () => {
  test("hazard at (1,1) — minimum walkable corner — is hit and durability changes correctly", () => {
    const core = buildActorWorld([2, 1]);
    call(core.armStaticHazardAt, 1, 1, AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 6, 6, 0);
    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 1, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);
    expect(durOf(core, 1, 1)).toBe(4);
  });

  test("hazard at (5,5) — maximum walkable corner — is hit and durability changes correctly", () => {
    const core = buildActorWorld([1, 1]);
    // Use Emit (no range constraint) since actor at (1,1) is 4 tiles from (5,5)
    call(core.armStaticHazardAt, 5, 5, AffinityKind.Earth, AffinityExpression.Emit, 1, 4, 3, 10, 0);
    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 5, 5, AffinityKind.Earth, AffinityExpression.Emit, 1);
    expect(durOf(core, 5, 5)).toBe(4); // Earth+Emit+stacks=1: effect=+1, 3+1=4
  });
});

// ---------------------------------------------------------------------------
// Permutations: re-arm after destruction resets durability to new values
// ---------------------------------------------------------------------------

describe("permutations: re-arming a destroyed hazard starts with the newly-specified durability", () => {
  test("hazard destroyed by Corrode drain; re-armed on same cell with new durability=8/8 resets cleanly", () => {
    const core = buildActorHazardWorld([1, 1], [2, 1], AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 2, 2, 0);
    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);
    expect(hazardExists(core, 2, 1)).toBe(false);

    call(core.armStaticHazardAt, 2, 1, AffinityKind.Earth, AffinityExpression.Emit, 1, 4, 8, 8, 0);
    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(durOf(core, 2, 1)).toBe(8);
    expect(durMaxOf(core, 2, 1)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Permutations: multiple hazards on the grid — only the targeted cell is affected
// ---------------------------------------------------------------------------

describe("permutations: applyAffinityDamageToHazard only modifies the targeted hazard cell", () => {
  test("damaging hazard at (2,1) does not change durability of hazard at (4,1)", () => {
    const core = buildActorWorld([1, 1]);
    call(core.armStaticHazardAt, 2, 1, AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 8, 8, 0);
    call(core.armStaticHazardAt, 4, 1, AffinityKind.Corrode, AffinityExpression.Emit, 1, 4, 8, 8, 0);

    call((core as Record<string, unknown>).applyAffinityDamageToHazard, 0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1);

    expect(durOf(core, 2, 1)).toBe(6); // targeted: drained by 2
    expect(durOf(core, 4, 1)).toBe(8); // bystander: unchanged
  });
});
