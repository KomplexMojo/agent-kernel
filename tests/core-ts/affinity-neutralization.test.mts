/**
 * M3b — Same-affinity Pull neutralization + mana transfer: failing tests
 *
 * When an actor uses Pull with the same AffinityKind as the target's active
 * expression (Emit or Push), `applyAffinityDamage` branches to a
 * neutralization-and-transfer path instead of the standard matrix lookup.
 *
 * Two target types:
 *   - Actor target  : `applyAffinityDamage(attacker, target, kind, Pull, stacks)`
 *                     detects target's active affinity internally.
 *   - Hazard target : `applyAffinityPullFromHazard(attacker, x, y, kind, stacks)`
 *                     new function; reads the static trap at (x, y).
 *
 * Mana transfer contract:
 *   - Attacker gains min(sourceMana, maxMana - currentMana) of the attacker
 *   - Excess is discarded (not refunded to source)
 *   - Source mana is always set to 0 on accepted neutralization
 *
 * Tests MUST FAIL until M3b implements:
 *   1. Neutralization branch in `packages/core-ts/src/rules/affinity-damage.ts`
 *   2. New `applyAffinityPullFromHazard` rule in the same file
 *   3. `applyAffinityPullFromHazard` wired into `createCore()` with
 *      `CORE_API_KEYS` kept alphabetical
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
    throw new Error("expected callable core export — M3b must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/**
 * 7×7 walkable interior, two motivated actors with default vitals.
 * current defaults equal max so each actor starts full.
 */
function buildTwoActorWorld(
  attackerXY: [number, number] = [1, 1],
  defenderXY: [number, number] = [2, 1],
  options: {
    attackerVitals?: { mana?: number; manaCurrent?: number };
    defenderVitals?: { mana?: number; manaCurrent?: number };
  } = {},
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

  const attackerManaMax     = options.attackerVitals?.mana        ?? 10;
  const attackerManaCurrent = options.attackerVitals?.manaCurrent ?? attackerManaMax;
  const defenderManaMax     = options.defenderVitals?.mana        ?? 10;
  const defenderManaCurrent = options.defenderVitals?.manaCurrent ?? defenderManaMax;

  call(core.setMotivatedActorVital, 0, VitalKind.Health,     10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Mana,       attackerManaCurrent, attackerManaMax, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Stamina,    10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Durability,  5,  5, 0);

  call(core.setMotivatedActorVital, 1, VitalKind.Health,     10, 10, 0);
  call(core.setMotivatedActorVital, 1, VitalKind.Mana,       defenderManaCurrent, defenderManaMax, 0);
  call(core.setMotivatedActorVital, 1, VitalKind.Stamina,    10, 10, 0);
  call(core.setMotivatedActorVital, 1, VitalKind.Durability,  5,  5, 0);

  return core;
}

/**
 * Build a world with one actor (index 0) and one static trap at (trapX, trapY).
 */
function buildTrapWorld(
  actorXY: [number, number] = [1, 1],
  trapXY: [number, number] = [3, 1],
  trapKind: number = AffinityKind.Fire,
  trapExpression: number = AffinityExpression.Emit,
  trapStacks: number = 2,
  trapMana: number = 8,
  actorManaMax: number = 10,
  actorManaCurrent: number = 2,
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

  call(core.armStaticTrapAt, ...trapXY, trapKind, trapExpression, trapStacks, trapMana);
  return core;
}

function manaOf(core: Core, actorIdx: number): number {
  return call(core.getMotivatedActorVitalCurrentByIndex, actorIdx, VitalKind.Mana) as number;
}

function affinityExprOf(core: Core, actorIdx: number): number {
  return call(core.getMotivatedActorAffinityExpressionByIndex, actorIdx) as number;
}

function trapManaOf(core: Core, x: number, y: number): number {
  return call(core.getStaticTrapManaReserveAt, x, y) as number;
}

function trapExistsAt(core: Core, x: number, y: number): boolean {
  // armStaticTrapAt stores affinity > 0; 0 means no trap
  return (call(core.getStaticTrapAffinityAt, x, y) as number) > 0;
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("applyAffinityPullFromHazard: API surface", () => {
  test("applyAffinityPullFromHazard is exported from createCore()", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).applyAffinityPullFromHazard).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Actor-vs-actor neutralization via applyAffinityDamage
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: actor-vs-actor neutralization (Pull + matching Emit)", () => {
  test("Fire+Pull vs actor with Fire+Emit active → neutralizes; target mana drained to 0", () => {
    const core = buildTwoActorWorld();
    // Actor 1 has an active Fire+Emit affinity
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);

    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );

    expect(result).not.toBe(0);                  // accepted
    expect(manaOf(core, 1)).toBe(0);              // target mana fully drained
  });

  test("actor target's active affinity expression is cleared after neutralization", () => {
    const core = buildTwoActorWorld();
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    // Sentinel value is 0 (no active expression)
    expect(affinityExprOf(core, 1)).toBe(0);
  });

  test("Fire+Pull vs actor with Fire+Push active → also neutralizes (Push is also neutralizable)", () => {
    const core = buildTwoActorWorld();
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Push, 3);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    expect(result).not.toBe(0);
    expect(manaOf(core, 1)).toBe(0);
  });

  test("mana transferred to attacker: min(targetMana, attackerManaCapacity)", () => {
    // attacker has 2 of 10 mana (capacity = 8); target has 10 mana → transfer 8, discard 2
    const core = buildTwoActorWorld(
      [1, 1], [2, 1],
      { attackerVitals: { manaCurrent: 2, mana: 10 } },
    );
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    // Attacker: 2 + min(10, 10-2=8) = 2 + 8 = 10 (capped at max)
    expect(manaOf(core, 0)).toBe(10);
    // Target: fully drained
    expect(manaOf(core, 1)).toBe(0);
  });

  test("excess mana is discarded when transfer would exceed attacker max", () => {
    // attacker max=10, current=6 → capacity=4; target has 10 mana → transfer only 4, discard 6
    const core = buildTwoActorWorld(
      [1, 1], [2, 1],
      { attackerVitals: { manaCurrent: 6, mana: 10 } },
    );
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    expect(manaOf(core, 0)).toBe(10);  // 6 + 4, clamped to max
    expect(manaOf(core, 1)).toBe(0);   // source always fully drained
  });

  test("neutralization does NOT drain target health — only mana is affected", () => {
    const core = buildTwoActorWorld();
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    // Health should be unchanged (neutralization doesn't deal matrix damage)
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 1, VitalKind.Health)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Non-matching Pull falls back to matrix path
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: non-matching Pull uses matrix (no neutralization)", () => {
  test("Fire+Pull vs actor with Water+Emit (different kind) → matrix path, no mana drain", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { defenderVitals: { mana: 10 } });
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Water, AffinityExpression.Emit, 2);

    const beforeMana = manaOf(core, 1);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    // Fire+Pull on the matrix drains Health (sign-reversed fire = negative Health)
    // Target mana should NOT be drained (no neutralization)
    expect(manaOf(core, 1)).toBe(beforeMana);
    // Health IS reduced by the matrix (Fire pulls health: polarity -1, pull = sign-reversed = +1*2... wait)
    // Fire polarity = -1, Pull expression = sign-reversed (isReversed=true) → sign = -(-1) = +1
    // So fire+pull BUFFS health (opposite of fire+push which drains).
    // But target starts at full health=10 → clamped to 10 (no visible change)
    // The point is: mana was not drained via neutralization.
  });

  test("Fire+Pull vs actor with Fire+Draw active (Draw ≠ Emit|Push) → matrix path", () => {
    const core = buildTwoActorWorld();
    // Draw is not Emit or Push — should not trigger neutralization
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Draw, 2);
    const beforeMana = manaOf(core, 1);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    expect(manaOf(core, 1)).toBe(beforeMana); // no neutralization drain
    // affinity expression NOT cleared (no neutralization)
    expect(affinityExprOf(core, 1)).toBe(AffinityExpression.Draw);
  });

  test("Fire+Pull vs actor with no active affinity → matrix path (no neutralization)", () => {
    const core = buildTwoActorWorld([1, 1], [2, 1], { defenderVitals: { mana: 10 } });
    // Actor 1 has no active affinity set (expression == 0)
    const beforeMana = manaOf(core, 1);
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    );
    expect(manaOf(core, 1)).toBe(beforeMana); // no mana drain from neutralization
  });
});

// ---------------------------------------------------------------------------
// Hazard neutralization via applyAffinityPullFromHazard
// ---------------------------------------------------------------------------

describe("applyAffinityPullFromHazard: hazard neutralization", () => {
  test("Fire+Pull vs Fire+Emit hazard → trap mana drained to 0, structure preserved, mana transferred to actor", () => {
    // actor at (1,1), trap at (3,1), actor mana=2/10, trap mana=8
    const core = buildTrapWorld(
      [1, 1], [3, 1],
      AffinityKind.Fire, AffinityExpression.Emit,
      2, 8, // stacks=2, mana=8
      10, 2, // actor maxMana=10, currentMana=2
    );

    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 3, 1, AffinityKind.Fire, 1,
    );

    expect(result).not.toBe(0);                   // accepted
    expect(trapManaOf(core, 3, 1)).toBe(0);        // mana fully drained
    expect(trapExistsAt(core, 3, 1)).toBe(true);   // trap structure preserved (can regen)
    // Transfer: min(8, 10-2=8) = 8 → attacker mana = 2 + 8 = 10
    expect(manaOf(core, 0)).toBe(10);
  });

  test("Fire+Pull vs Fire+Push hazard → also neutralizes (Push traps are neutralizable)", () => {
    const core = buildTrapWorld(
      [1, 1], [2, 1],
      AffinityKind.Fire, AffinityExpression.Push,
      2, 5,
      10, 0,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result).not.toBe(0);
    expect(trapManaOf(core, 2, 1)).toBe(0);       // mana drained
    expect(trapExistsAt(core, 2, 1)).toBe(true);  // structure preserved
  });

  test("mana excess is discarded when trap mana > attacker capacity", () => {
    // actor: current=8, max=10 → capacity=2; trap mana=6 → transfer 2, discard 4
    const core = buildTrapWorld(
      [1, 1], [2, 1],
      AffinityKind.Dark, AffinityExpression.Emit,
      1, 6,
      10, 8,
    );
    call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Dark, 1,
    );
    expect(manaOf(core, 0)).toBe(10); // 8 + min(6, 2) = 8 + 2 = 10
  });

  test("trap with zero mana (after drain) is rejected on second pull — nothing to neutralize", () => {
    // armStaticTrapAt rejects manaReserve <= 0, so create a world with a valid trap
    // then verify zero-mana path via mana already drained in a prior call
    const core = buildTrapWorld(
      [1, 1], [2, 1],
      AffinityKind.Fire, AffinityExpression.Emit,
      1, 1, // mana=1 (minimum valid arm)
      10, 0,
    );
    // First pull drains the 1 mana; trap structure remains
    call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(trapManaOf(core, 2, 1)).toBe(0);       // mana drained
    expect(trapExistsAt(core, 2, 1)).toBe(true);  // structure present

    // Second pull on the zero-mana trap should be rejected
    const result2 = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result2).toBe(0);
  });

  test("non-matching hazard affinity (Fire+Pull vs Water+Emit) → rejected (0)", () => {
    const core = buildTrapWorld(
      [1, 1], [2, 1],
      AffinityKind.Water, AffinityExpression.Emit,
      2, 8,
      10, 2,
    );
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result).toBe(0);
    expect(trapExistsAt(core, 2, 1)).toBe(true);  // trap still armed
    expect(trapManaOf(core, 2, 1)).toBe(8);        // mana untouched
  });

  test("no hazard at target cell → rejected (0)", () => {
    const core = buildTrapWorld(
      [1, 1], [2, 1],
      AffinityKind.Fire, AffinityExpression.Emit,
      2, 8,
    );
    // Pull at (4,1) which has no trap
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 4, 1, AffinityKind.Fire, 1,
    );
    expect(result).toBe(0);
  });

  test("invalid attacker index → rejected (0)", () => {
    const core = buildTrapWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      99, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result).toBe(0);
  });

  test("invalid affinity kind → rejected (0)", () => {
    const core = buildTrapWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, 99, 1,
    );
    expect(result).toBe(0);
  });

  test("zero stacks → rejected (0)", () => {
    const core = buildTrapWorld([1, 1], [2, 1]);
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 0,
    );
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Actor-vs-actor: rejection edge cases
// ---------------------------------------------------------------------------

describe("applyAffinityDamage: neutralization rejection cases", () => {
  test("target actor has matching affinity but attacker uses Push (not Pull) → no neutralization, matrix applies", () => {
    const core = buildTwoActorWorld();
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);
    // Push, not Pull → normal matrix path (drains health)
    call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Push, 1,
    );
    // Mana should be untouched (no neutralization)
    expect(manaOf(core, 1)).toBe(10);
    // Health should be reduced (matrix: fire+push = -2)
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 1, VitalKind.Health)).toBe(8);
    // Target's affinity expression should still be Emit (not cleared)
    expect(affinityExprOf(core, 1)).toBe(AffinityExpression.Emit);
  });
});

// ---------------------------------------------------------------------------
// PR #42 regression
// ---------------------------------------------------------------------------

describe("M3b: applyAttack PR #42 non-regression", () => {
  test("applyAttack still reduces target Health and ignores affinity state", () => {
    const core = buildTwoActorWorld();
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 2);
    const result = call(
      (core as Record<string, unknown>).applyAttack,
      0, 1, 3,
    );
    expect(result).not.toBe(0);
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 1, VitalKind.Health)).toBe(7);
    // mana unchanged — applyAttack does not touch affinity
    expect(manaOf(core, 1)).toBe(10);
    expect(affinityExprOf(core, 1)).toBe(AffinityExpression.Emit);
  });
});

// ---------------------------------------------------------------------------
// M3d regression — neutralised trap regens mana and comes back online
// ---------------------------------------------------------------------------

describe("M3d regression: neutralised trap mana regen via advanceTick", () => {
  test("neutralised hazard with manaRegen=1 recovers mana over ticks", () => {
    // Build a world with one actor and a Fire+Emit trap that has manaRegen=1
    const core = createCore();
    call(core.configureGrid, 7, 7);
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        call(core.setTileAt, x, y, 1);
      }
    }
    call(core.addActorPlacement, 1, 1, 1);
    call(core.applyActorPlacements);
    call(core.setMotivatedActorVital, 0, VitalKind.Mana, 0, 10, 0);

    // armStaticTrapAt with manaMax=4, manaRegen=1 (new M3d params at positions 10,11)
    call(core.armStaticTrapAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 4,
      0, 0, 0,   // durability: immortal
      4, 1,      // manaMax=4, manaRegen=1
    );

    // Neutralise
    call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(trapManaOf(core, 2, 1)).toBe(0);       // drained
    expect(trapExistsAt(core, 2, 1)).toBe(true);  // structure intact

    // Regen: needs 4 ticks at regen=1 to reach max=4
    for (let t = 1; t <= 4; t++) {
      call(core.advanceTick);
      expect(trapManaOf(core, 2, 1)).toBe(t);
    }
    expect(trapManaOf(core, 2, 1)).toBe(4); // back to max
  });
});

// ---------------------------------------------------------------------------
// Permutations: all 10 affinities — Pull vs matching Emit actor triggers neutralization
// ---------------------------------------------------------------------------

describe("permutations: all 10 kinds — Pull vs matching Emit actor neutralizes and clears expression", () => {
  const ALL_KINDS = [
    AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
    AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
    AffinityKind.Light, AffinityKind.Dark,
  ];

  test("neutralization triggers (return=1) and clears target expression for every AffinityKind", () => {
    for (const kind of ALL_KINDS) {
      const core = buildTwoActorWorld();
      call(core.setMotivatedActorAffinity, 1, kind, AffinityExpression.Emit, 1);
      const result = call(
        (core as Record<string, unknown>).applyAffinityDamage,
        0, 1, kind, AffinityExpression.Pull, 1,
      ) as number;
      expect(result).not.toBe(0);
      expect(affinityExprOf(core, 1)).toBe(0); // expression cleared
      expect(manaOf(core, 1)).toBe(0);         // mana drained
    }
  });

  test("neutralization triggers for Push (not just Emit) as the target expression for every kind", () => {
    for (const kind of ALL_KINDS) {
      const core = buildTwoActorWorld();
      call(core.setMotivatedActorAffinity, 1, kind, AffinityExpression.Push, 2);
      const result = call(
        (core as Record<string, unknown>).applyAffinityDamage,
        0, 1, kind, AffinityExpression.Pull, 1,
      ) as number;
      expect(result).not.toBe(0);
      expect(affinityExprOf(core, 1)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: mismatched kind → normal matrix path, no mana drain
// ---------------------------------------------------------------------------

describe("permutations: Pull vs mismatched kind uses the matrix path, does not drain mana", () => {
  test("for each kind K, Pull(K) vs target with Emit(K+1) does not neutralize", () => {
    const KINDS = [
      AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
      AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
      AffinityKind.Light, AffinityKind.Dark,
    ];
    for (let i = 0; i < KINDS.length; i++) {
      const pullerKind = KINDS[i]!;
      const targetKind = KINDS[(i + 1) % KINDS.length]!; // deliberately mismatched
      const core = buildTwoActorWorld();
      call(core.setMotivatedActorAffinity, 1, targetKind, AffinityExpression.Emit, 1);
      call(
        (core as Record<string, unknown>).applyAffinityDamage,
        0, 1, pullerKind, AffinityExpression.Pull, 1,
      );
      // Expression must NOT be cleared — only neutralization (matching kind) clears it
      // Note: some Pull affinities affect mana through the normal matrix path (e.g. Light+Pull
      // drains mana), so we cannot assert manaOf unchanged — only the expression sentinel matters
      expect(affinityExprOf(core, 1)).not.toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: minimal source mana — transfer=1, source goes to 0
// ---------------------------------------------------------------------------

describe("permutations: actor neutralization with minimal source mana (mana=1)", () => {
  test("source mana=1: transfer=1, attacker gains 1, source goes to 0 (not negative)", () => {
    const core = buildTwoActorWorld(
      [1, 1], [2, 1],
      { attackerVitals: { mana: 10, manaCurrent: 5 }, defenderVitals: { mana: 10, manaCurrent: 1 } },
    );
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 1);
    call((core as Record<string, unknown>).applyAffinityDamage, 0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1);
    expect(manaOf(core, 0)).toBe(6); // 5 + 1
    expect(manaOf(core, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Permutations: attacker already at max mana — transfer=0, neutralization still accepted
// ---------------------------------------------------------------------------

describe("permutations: attacker at max mana — transfer=0 but neutralization is still accepted", () => {
  test("capacity=0: return=1, source mana drained to 0, attacker mana unchanged", () => {
    const core = buildTwoActorWorld(
      [1, 1], [2, 1],
      { attackerVitals: { mana: 10, manaCurrent: 10 }, defenderVitals: { mana: 10, manaCurrent: 8 } },
    );
    call(core.setMotivatedActorAffinity, 1, AffinityKind.Fire, AffinityExpression.Emit, 1);
    const result = call(
      (core as Record<string, unknown>).applyAffinityDamage,
      0, 1, AffinityKind.Fire, AffinityExpression.Pull, 1,
    ) as number;
    expect(result).not.toBe(0); // still accepted
    expect(manaOf(core, 0)).toBe(10);  // attacker unchanged (already at max)
    expect(manaOf(core, 1)).toBe(0);   // source drained regardless
    expect(affinityExprOf(core, 1)).toBe(0); // expression cleared
  });
});

// ---------------------------------------------------------------------------
// Permutations: applyAffinityPullFromHazard — all 10 kinds vs matching Emit trap
// ---------------------------------------------------------------------------

describe("permutations: applyAffinityPullFromHazard — all 10 AffinityKind values vs matching Emit trap", () => {
  test("each kind: trap mana drained to 0, structure intact, mana transferred to attacker", () => {
    const ALL_KINDS = [
      AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
      AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
      AffinityKind.Light, AffinityKind.Dark,
    ];
    const TRAP_MANA = 4;
    const ATTACKER_MANA_START = 2;
    const ATTACKER_MANA_MAX = 10;

    for (const kind of ALL_KINDS) {
      const core = buildTrapWorld(
        [1, 1], [3, 1], kind, AffinityExpression.Emit, 1, TRAP_MANA,
        ATTACKER_MANA_MAX, ATTACKER_MANA_START,
      );
      const result = call(
        (core as Record<string, unknown>).applyAffinityPullFromHazard,
        0, 3, 1, kind, 1,
      ) as number;
      expect(result).not.toBe(0);                          // accepted
      expect(trapManaOf(core, 3, 1)).toBe(0);             // mana drained
      expect(trapExistsAt(core, 3, 1)).toBe(true);        // structure intact
      expect(manaOf(core, 0)).toBe(ATTACKER_MANA_START + Math.min(TRAP_MANA, ATTACKER_MANA_MAX - ATTACKER_MANA_START));
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: applyAffinityPullFromHazard — grid boundary cells (no off-by-one)
// ---------------------------------------------------------------------------

describe("permutations: applyAffinityPullFromHazard at grid boundary cells", () => {
  test("trap at (1,1) — minimum corner of walkable area — is pulled successfully", () => {
    const core = buildTrapWorld([2, 1], [1, 1], AffinityKind.Fire, AffinityExpression.Emit, 1, 5, 10, 2);
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 1, 1, AffinityKind.Fire, 1,
    ) as number;
    expect(result).not.toBe(0);
    expect(trapManaOf(core, 1, 1)).toBe(0);
    expect(trapExistsAt(core, 1, 1)).toBe(true);
  });

  test("trap at (5,5) — maximum corner of walkable area — is pulled successfully", () => {
    const core = buildTrapWorld([1, 1], [5, 5], AffinityKind.Dark, AffinityExpression.Emit, 1, 3, 10, 0);
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 5, 5, AffinityKind.Dark, 1,
    ) as number;
    expect(result).not.toBe(0);
    expect(trapManaOf(core, 5, 5)).toBe(0);
    expect(trapExistsAt(core, 5, 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Permutations: sequential neutralization — two traps pulled in sequence
// ---------------------------------------------------------------------------

describe("permutations: sequential applyAffinityPullFromHazard on two traps accumulates mana", () => {
  test("pulling two Fire traps in sequence: both drained, attacker gains from both (capped at max)", () => {
    const core = createCore();
    call(core.configureGrid, 7, 7);
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) call(core.setTileAt, x, y, 1);
    }
    call(core.addActorPlacement, 1, 1, 1);
    call(core.applyActorPlacements);
    call(core.setMotivatedActorVital, 0, VitalKind.Mana, 0, 10, 0);

    call(core.armStaticTrapAt, 3, 1, AffinityKind.Fire, AffinityExpression.Emit, 1, 3);
    call(core.armStaticTrapAt, 4, 1, AffinityKind.Fire, AffinityExpression.Emit, 1, 3);

    call((core as Record<string, unknown>).applyAffinityPullFromHazard, 0, 3, 1, AffinityKind.Fire, 1);
    expect(manaOf(core, 0)).toBe(3);
    expect(trapManaOf(core, 3, 1)).toBe(0);
    expect(trapExistsAt(core, 3, 1)).toBe(true);

    call((core as Record<string, unknown>).applyAffinityPullFromHazard, 0, 4, 1, AffinityKind.Fire, 1);
    expect(manaOf(core, 0)).toBe(6);
    expect(trapManaOf(core, 4, 1)).toBe(0);
    expect(trapExistsAt(core, 4, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Permutations: stacks > 1 does not change transfer magnitude in applyAffinityPullFromHazard
// ---------------------------------------------------------------------------

describe("permutations: stacks parameter does not affect mana transfer magnitude in applyAffinityPullFromHazard", () => {
  test("stacks=5 yields the same mana transfer as stacks=1 for the same trap", () => {
    const TRAP_MANA = 6;
    const ATTACKER_MAX = 10;

    const core1 = buildTrapWorld([1, 1], [3, 1], AffinityKind.Water, AffinityExpression.Emit, 1, TRAP_MANA, ATTACKER_MAX, 0);
    call((core1 as Record<string, unknown>).applyAffinityPullFromHazard, 0, 3, 1, AffinityKind.Water, 1);
    const manaAfterStacks1 = manaOf(core1, 0);

    const core5 = buildTrapWorld([1, 1], [3, 1], AffinityKind.Water, AffinityExpression.Emit, 1, TRAP_MANA, ATTACKER_MAX, 0);
    call((core5 as Record<string, unknown>).applyAffinityPullFromHazard, 0, 3, 1, AffinityKind.Water, 5);
    const manaAfterStacks5 = manaOf(core5, 0);

    expect(manaAfterStacks1).toBe(manaAfterStacks5);
    expect(manaAfterStacks5).toBe(TRAP_MANA); // full transfer fits
  });
});
