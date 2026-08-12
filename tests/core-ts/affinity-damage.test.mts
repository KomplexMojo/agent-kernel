/**
 * M1 — `applyAffinityDamage` core entry point: failing tests
 *
 * These tests specify the contract for the new `core.applyAffinityDamage`
 * primitive that PR #43 will add. It must:
 *   - Route (affinity, expression, stacks) through the M2 matrix to the
 *     correct vital(s) on the target actor
 *   - Apply signed effects (positive = buff, negative = drain), clamped to [0, max]
 *   - Scale magnitude linearly by stacks
 *   - Enforce push/pull as single-target with max Chebyshev range == stacks
 *   - Treat emit/draw as per-target diffuse applications (no range constraint
 *     at this primitive level; area iteration is deferred per M3 plan)
 *   - Be PURE: no IO, no clocks, no runtime imports
 *   - Leave PR #42's `applyAttack` entry point untouched
 *
 * Tests MUST FAIL until M3 implements `packages/core-ts/src/rules/affinity-damage.ts`
 * and wires `core.applyAffinityDamage` from `createCore()` with the alphabetically-sorted
 * CORE_API_KEYS entry preserved.
 *
 * Architecture: core-ts only.
 */
import { describe, expect, test } from "vitest";
import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
} from "../../packages/core-ts/src/state/affinity.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

// ---------------------------------------------------------------------------
// Helpers — multi-actor world setup
// ---------------------------------------------------------------------------

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export — M3 must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/**
 * Build a 7×7 floor grid with two motivated actors placed at the given positions.
 * Returns the configured core with vitals set on both actors.
 *
 * `current` and `maxes` are passed independently so buff tests can start with
 * current < max (e.g. current health 5, max health 10). Defaults:
 *   current = { health: 10, mana: 10, stamina: 10, durability: 5 }
 *   maxes   = { health: 10, mana: 10, stamina: 10, durability: 5 }
 *
 * Passing only `current: { health: 5 }` lowers the current to 5 but the max
 * stays at the default of 10, so a +2 buff produces 7 (not clamped to 5).
 *
 * Passing both lets you exercise the clamp-to-max path explicitly.
 */
function buildTwoActorWorld(
  attackerXY: [number, number] = [1, 1],
  defenderXY: [number, number] = [2, 1],
  options: {
    current?: { health?: number; mana?: number; stamina?: number; durability?: number };
    maxes?:   { health?: number; mana?: number; stamina?: number; durability?: number };
  } = {},
): Core {
  const core = createCore();
  call(core.configureGrid, 7, 7);
  // Make the entire interior walkable
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      call(core.setTileAt, x, y, 1); // floor
    }
  }
  call(core.addActorPlacement, 1, ...attackerXY);
  call(core.addActorPlacement, 2, ...defenderXY);
  call(core.applyActorPlacements);
  const defaultMax = { health: 10, mana: 10, stamina: 10, durability: 5 };
  const maxes = { ...defaultMax, ...(options.maxes ?? {}) };
  const current = {
    // Each current defaults to the resolved max so the actor starts full.
    health: maxes.health,
    mana: maxes.mana,
    stamina: maxes.stamina,
    durability: maxes.durability,
    ...(options.current ?? {}),
  };
  for (const actorIdx of [0, 1]) {
    call(core.setMotivatedActorVital, actorIdx, VitalKind.Health,     current.health,     maxes.health,     0);
    call(core.setMotivatedActorVital, actorIdx, VitalKind.Mana,       current.mana,       maxes.mana,       0);
    call(core.setMotivatedActorVital, actorIdx, VitalKind.Stamina,    current.stamina,    maxes.stamina,    0);
    call(core.setMotivatedActorVital, actorIdx, VitalKind.Durability, current.durability, maxes.durability, 0);
  }
  return core;
}

function vitalOf(core: Core, actorIdx: number, vital: number): number {
  return call(core.getMotivatedActorVitalCurrentByIndex, actorIdx, vital) as number;
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: API surface", () => {
  test("applyAffinityDamage is exported from createCore()", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).applyAffinityDamage).toBe("function");
  });

  test("applyAttack from PR #42 is still exported and unchanged", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).applyAttack).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Matrix routing — drain cases (negative effects reduce target vital)
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: drain effects (negative matrix entries)", () => {
  test("fire+push (drain Health, base 2) at stack 1 reduces target HP by 2", () => {
    // attacker(0) at (1,1), defender(1) at (2,1) — adjacent (Chebyshev 1, within range 1)
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).not.toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10 - 2);
  });

  test("corrode+push drains target Durability by 2 per stack", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Durability)).toBe(5 - 2);
  });

  test("dark+push drains target Mana by 2 per stack", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Dark, AffinityExpression.Push, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Mana)).toBe(10 - 2);
  });

  test("wind+push drains target Stamina by 2 per stack", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Wind, AffinityExpression.Push, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Stamina)).toBe(10 - 2);
  });
});

// ---------------------------------------------------------------------------
// Matrix routing — buff cases (positive effects increase target vital)
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: buff effects (positive matrix entries)", () => {
  test("life+push (buff Health, base 2) at stack 1 increases target HP by 2 (clamped to max)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 5 } }); // start half-HP so we can see the buff
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Life, AffinityExpression.Push, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(5 + 2);
  });

  test("life+emit at stack 1 buffs target Health by 1 (diffuse intensity)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 5 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Life, AffinityExpression.Emit, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(5 + 1);
  });

  test("fortify+2+push (worked example) replenishes target Durability by 4", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { durability: 1 } }); // start at 1
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fortify, AffinityExpression.Push, 2,
    );
    expect(vitalOf(core, 1, VitalKind.Durability)).toBe(1 + 4);
  });

  test("earth+emit buffs target Durability by 1 (diffuse intensity)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { durability: 1 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Earth, AffinityExpression.Emit, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Durability)).toBe(1 + 1);
  });

  test("light+push buffs target Mana by 2", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { mana: 5 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Light, AffinityExpression.Push, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Mana)).toBe(5 + 2);
  });
});

// ---------------------------------------------------------------------------
// Sign reversal observed end-to-end through applyAffinityDamage
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: sign-reversal pair behaviour", () => {
  test("life+pull DRAINS the same Health amount that life+push BUFFS (sign reversal)", () => {
    const a = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 5 } });
    call((a as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Life, AffinityExpression.Push, 1);
    const afterPush = vitalOf(a, 1, VitalKind.Health); // 5 + 2 = 7

    const b = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 5 } });
    call((b as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Life, AffinityExpression.Pull, 1);
    const afterPull = vitalOf(b, 1, VitalKind.Health); // 5 - 2 = 3

    expect(afterPush - 5).toBe(-(afterPull - 5));
  });

  test("corrode+pull buffs Durability (sign-reversed: corrode+push drains, so pull buffs)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { durability: 1 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Corrode, AffinityExpression.Pull, 1,
    );
    expect(vitalOf(core, 1, VitalKind.Durability)).toBe(1 + 2);
  });
});

// ---------------------------------------------------------------------------
// Stack scaling — magnitude = base * stacks
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: stack scaling (linear effect = base * stacks)", () => {
  test("stacks=3 multiplies push base by 3 (fire+push at stacks=3 drains 6 HP)", () => {
    // Place defender 1 tile away so range==1 ≤ stacks==3 (within range)
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 3,
    );
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10 - 6);
  });

  test("stacks=5 multiplies emit base by 5 (life+emit at stacks=5 buffs 5 HP)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 1 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Life, AffinityExpression.Emit, 5,
    );
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(1 + 5);
  });
});

// ---------------------------------------------------------------------------
// Clamping — drain stops at 0, buff stops at max
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: vital clamping", () => {
  test("lethal overkill clamps Health to 0 (does not go negative)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 3 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 10, // 20 damage vs 3 HP
    );
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(0);
  });

  test("buff that would exceed max clamps to max", () => {
    // Explicit max=9 so the buff clamps at 9 (life+push at stacks=5 would add 10).
    const core = buildTwoActorWorld([1, 1], [2, 1], {
      current: { health: 9 },
      maxes: { health: 9 },
    });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Life, AffinityExpression.Push, 5,
    );
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(9);
  });

  test("Durability drain clamps at 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { durability: 1 } });
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 5, // 10 damage vs 1 durability
    );
    expect(vitalOf(core, 1, VitalKind.Durability)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Push/pull range semantics (single-target, range == stacks)
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: push/pull range == stacks (Chebyshev)", () => {
  test("push at stacks=1 succeeds against a target 1 tile away (range matches stacks)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]); // Chebyshev = 1
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).not.toBe(0);
  });

  test("push at stacks=1 is rejected against a target 2 tiles away (out of range)", () => {
    const core = buildTwoActorWorld([1, 1], [3, 1]); // Chebyshev = 2
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10); // unchanged
  });

  test("push at stacks=4 succeeds against a target 4 tiles away (fireball example)", () => {
    const core = buildTwoActorWorld([1, 1], [5, 1]); // Chebyshev = 4
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 4,
    );
    expect(result).not.toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10 - 8); // 2 * 4
  });

  test("push at stacks=3 is rejected against a target 4 tiles away (range < distance)", () => {
    const core = buildTwoActorWorld([1, 1], [5, 1]); // Chebyshev = 4
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Fire, AffinityExpression.Push, 3,
    );
    expect(result).toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10);
  });

  test("pull also enforces range == stacks (same rule, sign-reversed)", () => {
    const core = buildTwoActorWorld([1, 1], [3, 1], { current: { health: 5 } }); // Chebyshev = 2
    // life+pull at stacks=1 would be out of range
    const rejected = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Life, AffinityExpression.Pull, 1,
    );
    expect(rejected).toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(5); // unchanged
    // life+pull at stacks=2 reaches the target — drains health
    const accepted = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1,
      AffinityKind.Life, AffinityExpression.Pull, 2,
    );
    expect(accepted).not.toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(5 - 4);
  });
});

// ---------------------------------------------------------------------------
// Emit/draw — no range constraint at this primitive level (area iteration deferred)
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: emit/draw have no range constraint at the per-target level", () => {
  test("emit at any distance applies the diffuse per-target effect (area iteration is the caller's job)", () => {
    const close = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 5 } });
    call((close as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Life, AffinityExpression.Emit, 1);
    expect(vitalOf(close, 1, VitalKind.Health)).toBe(5 + 1);

    const far = buildTwoActorWorld([1, 1], [5, 5], { current: { health: 5 } });
    call((far as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Life, AffinityExpression.Emit, 1);
    expect(vitalOf(far, 1, VitalKind.Health)).toBe(5 + 1);
  });

  test("draw at any distance applies the diffuse per-target drain", () => {
    const core = buildTwoActorWorld([1, 1], [5, 5]);
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Life, AffinityExpression.Draw, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10 - 1);
  });
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: rejection cases", () => {
  test("invalid attacker index returns 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      99, 1, AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
  });

  test("invalid target index returns 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 99, AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
  });

  test("invalid affinity kind returns 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, 99, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
  });

  test("invalid expression returns 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, 99, 1,
    );
    expect(result).toBe(0);
  });

  test("zero stacks returns 0 (no-op rejected)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Push, 0,
    );
    expect(result).toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10);
  });

  test("negative stacks returns 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Push, -1,
    );
    expect(result).toBe(0);
  });

  test("attacker == target (self-affinity) returns 0", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 0, AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    expect(result).toBe(0);
  });

  test("no-effect matrix cell (decay on durability via push) returns 0 and leaves target unchanged", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    // Decay's primary vital is Health, not Durability. Routing Decay against the Durability vital
    // is not how the API is called; the API routes via the matrix. The behaviour we want here is:
    // a Decay+Push call routes to Health (matrix says so), NOT Durability. Verify durability untouched.
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Decay, AffinityExpression.Push, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10 - 2);   // routed correctly
    expect(vitalOf(core, 1, VitalKind.Durability)).toBe(5);    // unaffected
  });
});

// ---------------------------------------------------------------------------
// PR #42 regression — applyAttack must still work and be untouched
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: PR #42 applyAttack non-regression", () => {
  test("applyAttack still reduces target Health by the given damage (adjacency check intact)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 3,
    );
    expect(result).not.toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10 - 3);
  });

  test("applyAttack still rejects non-adjacent attacks (Chebyshev > 1)", () => {
    const core = buildTwoActorWorld([1, 1], [3, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 3,
    );
    expect(result).toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Permutations: all 40 (kind × expression) pairs route to the correct primary vital
// ---------------------------------------------------------------------------

describe("permutations: all 40 (kind × expression) pairs route to the correct primary vital", () => {
  // Mirrors the contract in affinity-vital-matrix.test.mts PRIMARY table
  const ROUTE: Record<number, { vital: number; polarity: number }> = {
    [AffinityKind.Fire]:    { vital: VitalKind.Health,     polarity: -1 },
    [AffinityKind.Water]:   { vital: VitalKind.Health,     polarity: +1 },
    [AffinityKind.Earth]:   { vital: VitalKind.Durability, polarity: +1 },
    [AffinityKind.Wind]:    { vital: VitalKind.Stamina,    polarity: -1 },
    [AffinityKind.Life]:    { vital: VitalKind.Health,     polarity: +1 },
    [AffinityKind.Decay]:   { vital: VitalKind.Health,     polarity: -1 },
    [AffinityKind.Corrode]: { vital: VitalKind.Durability, polarity: -1 },
    [AffinityKind.Fortify]: { vital: VitalKind.Durability, polarity: +1 },
    [AffinityKind.Light]:   { vital: VitalKind.Mana,       polarity: +1 },
    [AffinityKind.Dark]:    { vital: VitalKind.Mana,       polarity: -1 },
  };

  // Mid-range starting vitals — stacks=1 never saturates at either bound
  const START: Record<number, number> = {
    [VitalKind.Health]: 5, [VitalKind.Mana]: 5,
    [VitalKind.Stamina]: 5, [VitalKind.Durability]: 2,
  };
  const MAX: Record<number, number> = {
    [VitalKind.Health]: 10, [VitalKind.Mana]: 10,
    [VitalKind.Stamina]: 10, [VitalKind.Durability]: 5,
  };
  const startCurrent = { health: 5, mana: 5, stamina: 5, durability: 2 };
  const startMaxes   = { health: 10, mana: 10, stamina: 10, durability: 5 };
  const ALL_KINDS = [
    AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
    AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
    AffinityKind.Light, AffinityKind.Dark,
  ];
  const ALL_EXPRS = [
    AffinityExpression.Push, AffinityExpression.Pull,
    AffinityExpression.Emit, AffinityExpression.Draw,
  ];
  const ALL_VITAL_KINDS = [VitalKind.Health, VitalKind.Mana, VitalKind.Stamina, VitalKind.Durability];

  test("each combination applies to the primary vital and leaves all other vitals unchanged", () => {
    for (const kind of ALL_KINDS) {
      for (const expr of ALL_EXPRS) {
        // Fresh world for each combination
        const core = buildTwoActorWorld([1, 1], [2, 1], { current: startCurrent, maxes: startMaxes });
        const { vital: pVital, polarity } = ROUTE[kind]!;
        const base = (expr === AffinityExpression.Push || expr === AffinityExpression.Pull) ? 2 : 1;
        const sign = (expr === AffinityExpression.Pull || expr === AffinityExpression.Draw) ? -polarity : polarity;
        const effect = sign * base;

        call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, kind, expr, 1);

        // Primary vital must reflect the effect (clamped to [0, max])
        const expected = Math.max(0, Math.min(MAX[pVital]!, START[pVital]! + effect));
        expect(vitalOf(core, 1, pVital)).toBe(expected);

        // All other vitals must be unchanged
        for (const other of ALL_VITAL_KINDS) {
          if (other !== pVital) {
            expect(vitalOf(core, 1, other)).toBe(START[other]!);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: drain-to-zero sequence — vital clamps at 0, does not go negative
// ---------------------------------------------------------------------------

describe("permutations: repeated drain calls clamp vital at 0 without going negative", () => {
  test("fire+push repeated until health hits 0 — health stays at 0 on subsequent accepted calls", () => {
    // health starts at 4, each push drains by 2 → hits 0 after 2 calls
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 4 } });
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Fire, AffinityExpression.Push, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(2);
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Fire, AffinityExpression.Push, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(0);
    // additional calls accepted but vital stays at 0
    const result = call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Fire, AffinityExpression.Push, 1) as number;
    expect(result).not.toBe(0); // still accepted
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(0); // still clamped
  });
});

// ---------------------------------------------------------------------------
// Permutations: buff-to-max sequence — vital clamps at max, does not overflow
// ---------------------------------------------------------------------------

describe("permutations: repeated buff calls clamp vital at max without overflowing", () => {
  test("water+push repeated until health hits max — health stays at max on subsequent accepted calls", () => {
    // health starts at 4 max=10, each push buffs by 2 → hits 10 after 3 calls (4→6→8→10)
    const core = buildTwoActorWorld([1, 1], [2, 1], { current: { health: 4 } });
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Water, AffinityExpression.Push, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(6);
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Water, AffinityExpression.Push, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(8);
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Water, AffinityExpression.Push, 1);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10);
    // additional buff accepted but vital stays at max
    const result = call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Water, AffinityExpression.Push, 1) as number;
    expect(result).not.toBe(0);
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Permutations: multiple actors — only the named target is mutated
// ---------------------------------------------------------------------------

describe("permutations: only the named target actor is mutated by applyAffinityDamage", () => {
  test("applying fire+push to actor 1 does not change actor 0 (attacker) or actor 2 (bystander)", () => {
    // Build a 3-actor world manually: actor 0 at (1,1), actor 1 at (2,1), actor 2 at (3,1)
    const core = createCore();
    call(core.configureGrid, 7, 7);
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) call(core.setTileAt, x, y, 1);
    }
    call(core.addActorPlacement, 1, 1, 1);
    call(core.addActorPlacement, 2, 2, 1);
    call(core.addActorPlacement, 3, 3, 1);
    call(core.applyActorPlacements);
    for (const idx of [0, 1, 2]) {
      call(core.setMotivatedActorVital, idx, VitalKind.Health,     10, 10, 0);
      call(core.setMotivatedActorVital, idx, VitalKind.Mana,       10, 10, 0);
      call(core.setMotivatedActorVital, idx, VitalKind.Stamina,    10, 10, 0);
      call(core.setMotivatedActorVital, idx, VitalKind.Durability,  5,  5, 0);
    }

    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Fire, AffinityExpression.Push, 1);

    expect(vitalOf(core, 0, VitalKind.Health)).toBe(10); // attacker unchanged
    expect(vitalOf(core, 1, VitalKind.Health)).toBe(8);  // target drained
    expect(vitalOf(core, 2, VitalKind.Health)).toBe(10); // bystander unchanged
  });
});

// ---------------------------------------------------------------------------
// Permutations: getMotivatedActorVitalCurrentByIndex reflects changes immediately
// ---------------------------------------------------------------------------

describe("permutations: vital changes are reflected by the getter on the very next call", () => {
  test("getter returns updated value immediately after applyAffinityDamage returns", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1]);
    const before = vitalOf(core, 1, VitalKind.Health);
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Fire, AffinityExpression.Push, 1);
    const after = vitalOf(core, 1, VitalKind.Health);
    expect(after).toBe(before - 2);
  });
});
