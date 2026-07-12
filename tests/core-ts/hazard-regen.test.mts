/**
 * M3d — Hazard Regen Ticks (Mana + Durability): failing tests
 *
 * `advanceTick` must advance each non-destroyed hazard's mana and durability
 * by their per-hazard regen rates (clamped to their respective maxima).
 *
 * Key design choices encoded here:
 *   - `armStaticHazardAt` gains two more optional trailing params (after durability):
 *       armStaticHazardAt(x, y, kind, expr, stacks, mana,
 *                       durCurrent?, durMax?, durRegen?,
 *                       manaMax?, manaRegen?)
 *     manaMax defaults to manaReserve (initial current); manaRegen defaults to 0.
 *   - `getStaticHazardManaMaxAt(x, y)` / `getStaticHazardManaRegenAt(x, y)` are new exports.
 *   - Destruction (durability → 0) is terminal; destroyed cells do NOT regen.
 *   - Neutralised hazards (mana drained to 0 by M3b pull, hazard structure intact)
 *     regen mana back to max over ceil(max / regen) ticks.
 *   - Regen of 0 means no advancement on any tick.
 *   - Actor vital regen is unaffected by these changes.
 *
 * Tests MUST FAIL until M3d implements:
 *   1. `staticHazardManaMaxByCell` + `staticHazardManaRegenByCell` arrays in world.ts
 *   2. `armStaticHazardAt` extended with optional manaMax / manaRegen params
 *   3. `getStaticHazardManaMaxAt` / `getStaticHazardManaRegenAt` getters + CORE_API_KEYS
 *   4. Per-hazard regen loop appended to `applyTickRegen()` in world.ts
 *   5. `applyAffinityPullFromHazard` changed to drain mana to 0 (not full disarm)
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
    throw new Error("expected callable core export — M3d must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/** 7×7 floor grid with one actor at (1,1). */
function buildWorld(): Core {
  const core = createCore();
  call(core.configureGrid, 7, 7);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
  call(core.addActorPlacement, 1, 1, 1);
  call(core.applyActorPlacements);
  call(core.setMotivatedActorVital, 0, VitalKind.Health,     10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Mana,       10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Stamina,    10, 10, 0);
  call(core.setMotivatedActorVital, 0, VitalKind.Durability,  5,  5, 0);
  return core;
}

function tick(core: Core, n = 1): void {
  for (let i = 0; i < n; i++) call(core.advanceTick);
}

function hazardMana(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardManaReserveAt, x, y) as number;
}

function hazardManaMax(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardManaMaxAt, x, y) as number;
}

function hazardManaRegen(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardManaRegenAt, x, y) as number;
}

function hazardDur(core: Core, x: number, y: number): number {
  return call(core.getStaticHazardDurabilityAt, x, y) as number;
}

function hazardExists(core: Core, x: number, y: number): boolean {
  return (call(core.getStaticHazardAffinityAt, x, y) as number) > 0;
}

function actorMana(core: Core): number {
  return call(core.getMotivatedActorVitalCurrentByIndex, 0, VitalKind.Mana) as number;
}

function staticFieldSourceCount(core: Core): number {
  return call(core.computeStaticHazardAffinityField) as number;
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("M3d API surface", () => {
  test("getStaticHazardManaMaxAt is exported", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).getStaticHazardManaMaxAt).toBe("function");
  });

  test("getStaticHazardManaRegenAt is exported", () => {
    const core = createCore();
    expect(typeof (core as Record<string, unknown>).getStaticHazardManaRegenAt).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// armStaticHazardAt: mana max / regen params
// ---------------------------------------------------------------------------

describe("armStaticHazardAt: mana max and regen configuration", () => {
  test("manaMax defaults to manaReserve when omitted (6-arg legacy call)", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1, AffinityKind.Fire, AffinityExpression.Emit, 1, 6);
    expect(hazardManaMax(core, 2, 1)).toBe(6);
    expect(hazardManaRegen(core, 2, 1)).toBe(0);
  });

  test("explicit manaMax and manaRegen stored and read back", () => {
    const core = buildWorld();
    // armStaticHazardAt(x,y, kind,expr,stacks,mana, durCur,durMax,durRegen, manaMax,manaRegen)
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 3,
      0, 0, 0,   // durability: immortal
      8, 2,      // manaMax=8, manaRegen=2
    );
    expect(hazardManaMax(core, 2, 1)).toBe(8);
    expect(hazardManaRegen(core, 2, 1)).toBe(2);
    expect(hazardMana(core, 2, 1)).toBe(3); // current starts at manaReserve (3)
  });

  test("manaMax defaults to manaReserve when only durability params given", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      4, 4, 1,   // durability
      // no manaMax/manaRegen → default manaMax=5, manaRegen=0
    );
    expect(hazardManaMax(core, 2, 1)).toBe(5);
    expect(hazardManaRegen(core, 2, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mana regen on advanceTick
// ---------------------------------------------------------------------------

describe("advanceTick: hazard mana regen", () => {
  test("zero-mana hazard remains represented but does not project active affinity", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 2, 0,
      0, 0, 0, 5, 0,
    );

    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(hazardMana(core, 2, 1)).toBe(0);
    expect(staticFieldSourceCount(core)).toBe(0);
    expect(call(core.getAffinityFieldStacksAt, 2, 1, AffinityKind.Fire)).toBe(0);
  });

  test("mana regen restores a disabled hazard so it projects affinity again", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 2, 0,
      0, 0, 0, 5, 1,
    );

    expect(staticFieldSourceCount(core)).toBe(0);
    tick(core);

    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(hazardMana(core, 2, 1)).toBe(1);
    expect(staticFieldSourceCount(core)).toBe(1);
    expect(call(core.getAffinityFieldStacksAt, 2, 1, AffinityKind.Fire)).toBe(2);
  });

  test("mana advances by regen each tick (regen=1, from 3 to 4 after 1 tick)", () => {
    const core = buildWorld();
    // current=3, max=6, regen=1
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 3,
      0, 0, 0, 6, 1,
    );
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(4);
  });

  test("mana advances by regen=2 per tick", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 2,
      0, 0, 0, 10, 2,
    );
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(4);
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(6);
  });

  test("mana clamps at manaMax — does not exceed", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      0, 0, 0, 6, 2,
    );
    tick(core, 5); // 5+2+2+2+2+2 → would be 15 but clamped at 6
    expect(hazardMana(core, 2, 1)).toBe(6);
  });

  test("regen=0 means no advancement across many ticks", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 4,
      0, 0, 0, 10, 0,
    );
    tick(core, 10);
    expect(hazardMana(core, 2, 1)).toBe(4); // unchanged
  });

  test("hazard already at max (mana==manaMax) does not increase further", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      0, 0, 0, 5, 1,
    );
    tick(core, 3);
    expect(hazardMana(core, 2, 1)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Durability regen on advanceTick
// ---------------------------------------------------------------------------

describe("advanceTick: hazard durability regen", () => {
  test("durability advances by durRegen each tick", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 4,
      2, 8, 1,   // durCurrent=2, durMax=8, durRegen=1
    );
    tick(core);
    expect(hazardDur(core, 2, 1)).toBe(3);
  });

  test("durability clamps at durMax", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 4,
      6, 8, 3,   // regen=3, max=8 → reaches 8 in 1 tick (6+3=9→8)
    );
    tick(core);
    expect(hazardDur(core, 2, 1)).toBe(8);
  });

  test("durRegen=0 → durability unchanged", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 4,
      3, 8, 0,
    );
    tick(core, 5);
    expect(hazardDur(core, 2, 1)).toBe(3); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Destroyed hazards do NOT regen (terminal)
// ---------------------------------------------------------------------------

describe("advanceTick: destroyed hazard stays gone", () => {
  test("hazard destroyed via applyAffinityDamageToHazard does not regen mana or durability", () => {
    const core = buildWorld();
    // durability 1/1, regen=1 — after destruction, regen must not bring it back
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      1, 1, 1,   // durability: current=1, max=1, regen=1
      5, 1,      // mana: max=5, regen=1
    );
    call((core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(hazardExists(core, 2, 1)).toBe(false); // destroyed

    tick(core, 5);
    // Hazard must not reappear
    expect(hazardExists(core, 2, 1)).toBe(false);
    expect(hazardMana(core, 2, 1)).toBe(0);
    expect(hazardDur(core, 2, 1)).toBe(0);
  });

  test("destroyed cell returns 0 from all hazard getters across ticks", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 4,
      1, 1, 2, 4, 2,
    );
    call((core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    tick(core, 10);
    expect(hazardManaMax(core, 2, 1)).toBe(0);
    expect(hazardManaRegen(core, 2, 1)).toBe(0);
    expect(call(core.getStaticHazardDurabilityMaxAt, 2, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Neutralised hazard (M3b) regens mana and comes back online
// ---------------------------------------------------------------------------

describe("advanceTick: neutralised hazard regens mana", () => {
  test("after M3b pull, mana=0 hazard regens back to max over ceil(max/regen) ticks", () => {
    const core = buildWorld();
    // mana current=5, max=5, regen=1 → needs 5 ticks from 0 to reach 5
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      0, 0, 0,   // immortal (no durability)
      5, 1,      // manaMax=5, manaRegen=1
    );
    // Neutralise: drain mana to 0, hazard structure preserved
    call((core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(hazardMana(core, 2, 1)).toBe(0);      // drained
    expect(hazardExists(core, 2, 1)).toBe(true); // structure intact

    tick(core, 5);
    expect(hazardMana(core, 2, 1)).toBe(5);      // fully regenerated
  });

  test("second pull is accepted once mana regens back above 0", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 4,
      0, 0, 0, 4, 2,
    );
    call((core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    // Partially regen (1 tick, regen=2 → mana=2)
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(2);

    // Attacker mana back to 0 first so we can see transfer
    call(core.setMotivatedActorVital, 0, VitalKind.Mana, 0, 10, 0);

    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result).not.toBe(0); // second pull accepted
    expect(actorMana(core)).toBe(2); // 0 + min(2, 10) = 2
  });

  test("pull on still-drained hazard (mana=0) is rejected (0)", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      0, 0, 0, 5, 0, // regen=0 so mana stays 0 after pull
    );
    call((core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    tick(core, 3); // no regen
    const result = call(
      (core as Record<string, unknown>).applyAffinityPullFromHazard,
      0, 2, 1, AffinityKind.Fire, 1,
    );
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-hazard independence
// ---------------------------------------------------------------------------

describe("advanceTick: multiple hazards regen independently", () => {
  test("two hazards with different regen values each advance correctly per tick", () => {
    const core = buildWorld();
    // Hazard A at (2,1): mana current=1, max=10, regen=1
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 1,
      0, 0, 0, 10, 1,
    );
    // Hazard B at (3,1): mana current=1, max=10, regen=3
    call(core.armStaticHazardAt, 3, 1,
      AffinityKind.Dark, AffinityExpression.Push, 1, 1,
      0, 0, 0, 10, 3,
    );
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(2);  // 1 + 1
    expect(hazardMana(core, 3, 1)).toBe(4);  // 1 + 3
  });

  test("one hazard destroyed, other continues to regen normally", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 4,
      1, 1, 0,   // durability: will be destroyed
      4, 1,
    );
    call(core.armStaticHazardAt, 3, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 2,
      0, 0, 0, 6, 2,
    );
    // Destroy hazard A
    call((core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    tick(core, 2);
    // Hazard A gone, hazard B regens normally
    expect(hazardExists(core, 2, 1)).toBe(false);
    expect(hazardMana(core, 3, 1)).toBe(6); // 2 + 2 + 2 = 6 (clamped at max)
  });
});

// ---------------------------------------------------------------------------
// Actor regen unaffected
// ---------------------------------------------------------------------------

describe("advanceTick: actor vital regen unaffected by hazard regen changes", () => {
  test("actor mana regen still works normally alongside hazard regen", () => {
    const core = buildWorld();
    // Give actor a mana regen of 2
    call(core.setMotivatedActorVital, 0, VitalKind.Mana, 6, 10, 2);
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 3,
      0, 0, 0, 8, 1,
    );
    tick(core);
    expect(actorMana(core)).toBe(8);         // 6 + 2
    expect(hazardMana(core, 2, 1)).toBe(4);    // 3 + 1
  });
});

// ---------------------------------------------------------------------------
// PR #42 regression
// ---------------------------------------------------------------------------

describe("M3d: applyAttack non-regression", () => {
  test("applyAttack still works and is unaffected by hazard regen tick changes", () => {
    const core = buildWorld();
    call(core.addActorPlacement, 2, 2, 1);
    // Can't addActorPlacement after applyActorPlacements — rebuild with 2 actors
    const core2 = createCore();
    call(core2.configureGrid, 7, 7);
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        call(core2.setTileAt, x, y, 1);
      }
    }
    call(core2.addActorPlacement, 1, 1, 1);
    call(core2.addActorPlacement, 2, 2, 1);
    call(core2.applyActorPlacements);
    call(core2.setMotivatedActorVital, 0, VitalKind.Health, 10, 10, 0);
    call(core2.setMotivatedActorVital, 1, VitalKind.Health, 10, 10, 0);
    call(core2.armStaticHazardAt, 3, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 5,
      0, 0, 0, 5, 1,
    );
    const result = call((core2 as Record<string, unknown>).applyAttack, 0, 1, 3);
    expect(result).not.toBe(0);
    expect(call(core2.getMotivatedActorVitalCurrentByIndex, 1, VitalKind.Health)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Permutations: all 10 AffinityKind hazards with manaRegen=1 reach manaMax
// ---------------------------------------------------------------------------

describe("permutations: all 10 AffinityKind hazards with manaRegen=1 reach manaMax after max ticks", () => {
  const ALL_KINDS = [
    AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
    AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
    AffinityKind.Light, AffinityKind.Dark,
  ];

  test("each kind: hazard starts at mana=1, manaMax=4, regen=1 → reaches 4 after 3 more ticks", () => {
    // Use a 7×7 grid; place each hazard at a unique cell in rows y=1 and y=2
    const POSITIONS: [number, number][] = [
      [1,1],[2,1],[3,1],[4,1],[5,1],
      [1,2],[2,2],[3,2],[4,2],[5,2],
    ];
    const MANA_START = 1;
    const MANA_MAX = 4;
    const core = buildWorld();

    for (let i = 0; i < ALL_KINDS.length; i++) {
      const [x, y] = POSITIONS[i]!;
      const kind = ALL_KINDS[i]!;
      // armStaticHazardAt requires manaReserve > 0; start at 1, regen fills to max
      call(core.armStaticHazardAt, x, y, kind, AffinityExpression.Emit, 1, MANA_START,
        0, 0, 0,           // durability: immortal
        MANA_MAX, 1,       // manaMax=4, manaRegen=1
      );
    }

    tick(core, MANA_MAX - MANA_START); // 3 ticks → 1+3 = 4

    for (let i = 0; i < ALL_KINDS.length; i++) {
      const [x, y] = POSITIONS[i]!;
      expect(hazardMana(core, x, y)).toBe(MANA_MAX);
    }
  });
});

// ---------------------------------------------------------------------------
// Permutations: manaRegen > manaMax — single tick clamps at max
// ---------------------------------------------------------------------------

describe("permutations: manaRegen > manaMax — single tick clamps at max", () => {
  test("regen=10, manaMax=3: one tick clamps at max (starting from 1)", () => {
    const core = buildWorld();
    // manaReserve must be > 0; start at 1, regen=10 overshoots and clamps at max=3
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 1,
      0, 0, 0,     // immortal
      3, 10,       // manaMax=3, manaRegen=10
    );
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(3); // min(3, 1+10) = 3
  });
});

// ---------------------------------------------------------------------------
// Permutations: durRegen exact recovery — ceil((max-current)/regen) ticks
// ---------------------------------------------------------------------------

describe("permutations: durability reaches durMax in exactly the expected number of ticks", () => {
  test("durCurrent=2, durMax=6, durRegen=2 → reaches 6 after exactly 2 ticks", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 4,
      2, 6, 2, // durCurrent=2, durMax=6, durRegen=2
    );
    tick(core);
    expect(hazardDur(core, 2, 1)).toBe(4); // +2
    tick(core);
    expect(hazardDur(core, 2, 1)).toBe(6); // +2 → max
    tick(core);
    expect(hazardDur(core, 2, 1)).toBe(6); // clamped
  });

  test("durCurrent=1, durMax=5, durRegen=1 → reaches 5 after exactly 4 ticks", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Earth, AffinityExpression.Emit, 1, 4,
      1, 5, 1,
    );
    tick(core, 4);
    expect(hazardDur(core, 2, 1)).toBe(5);
    tick(core);
    expect(hazardDur(core, 2, 1)).toBe(5); // clamped, does not exceed
  });
});

// ---------------------------------------------------------------------------
// Permutations: combined mana + durability regen advances both in a single tick
// ---------------------------------------------------------------------------

describe("permutations: combined mana and durability regen both advance in a single advanceTick", () => {
  test("hazard with manaRegen=2 and durRegen=3: single tick advances both independently", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Earth, AffinityExpression.Emit, 1, 1,
      2, 10, 3,    // durCurrent=2, durMax=10, durRegen=3
      8, 2,        // manaMax=8, manaRegen=2
    );
    tick(core);
    expect(hazardMana(core, 2, 1)).toBe(3);  // 1 + 2
    expect(hazardDur(core, 2, 1)).toBe(5);   // 2 + 3
  });
});

// ---------------------------------------------------------------------------
// Permutations: hazard with regen=0 for both — no mutation after multiple ticks
// ---------------------------------------------------------------------------

describe("permutations: regen=0 means no mutation on either mana or durability arrays across many ticks", () => {
  test("manaRegen=0 AND durRegen=0: both values unchanged after 10 ticks", () => {
    const core = buildWorld();
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Fire, AffinityExpression.Emit, 1, 3,
      2, 8, 0,    // durability: current=2, max=8, regen=0
      7, 0,       // mana: max=7, regen=0
    );
    tick(core, 10);
    expect(hazardMana(core, 2, 1)).toBe(3); // unchanged
    expect(hazardDur(core, 2, 1)).toBe(2);  // unchanged
  });
});

// ---------------------------------------------------------------------------
// Permutations: multiple hazards on the same grid all regen independently
// ---------------------------------------------------------------------------

describe("permutations: multiple hazards regen independently — each advances by its own regen rate", () => {
  test("five hazards with different manaRegen rates all reach their individual maxima correctly", () => {
    const core = buildWorld();
    // armStaticHazardAt requires manaReserve > 0; use 1 as the minimum non-zero starting value.
    // Hazard A: mana=1/5, regen=1 → full after 4 ticks; after 5 ticks: 5
    call(core.armStaticHazardAt, 1, 1, AffinityKind.Fire,  AffinityExpression.Emit, 1, 1, 0, 0, 0, 5, 1);
    // Hazard B: mana=1/4, regen=2 → full after 2 ticks (1+2+2=5→4); after 5 ticks: 4
    call(core.armStaticHazardAt, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 1, 1, 0, 0, 0, 4, 2);
    // Hazard C: mana=3/6, regen=0 → stays at 3 (no regen)
    call(core.armStaticHazardAt, 3, 1, AffinityKind.Dark,  AffinityExpression.Emit, 1, 3, 0, 0, 0, 6, 0);
    // Hazard D: mana=1/3, regen=3 → full after 1 tick (1+3=4→3); after 5 ticks: 3
    call(core.armStaticHazardAt, 4, 1, AffinityKind.Light, AffinityExpression.Emit, 1, 1, 0, 0, 0, 3, 3);
    // Hazard E: mana=1/1, regen=5 → already at max, stays at 1
    call(core.armStaticHazardAt, 5, 1, AffinityKind.Earth, AffinityExpression.Emit, 1, 1, 0, 0, 0, 1, 5);

    tick(core, 5);

    expect(hazardMana(core, 1, 1)).toBe(5); // A: full (1 + 5×1 = 6 → clamped 5)
    expect(hazardMana(core, 2, 1)).toBe(4); // B: full (clamped after 2 ticks)
    expect(hazardMana(core, 3, 1)).toBe(3); // C: regen=0, unchanged
    expect(hazardMana(core, 4, 1)).toBe(3); // D: full (clamped after 1 tick)
    expect(hazardMana(core, 5, 1)).toBe(1); // E: already at max
  });
});

// ---------------------------------------------------------------------------
// Permutations: arm → destroy → re-arm cycle — fresh regen state, no stale values
// ---------------------------------------------------------------------------

describe("permutations: arm → destroy → re-arm starts fresh regen with no stale state", () => {
  test("destroy a hazard then re-arm with new regen values — old regen does not bleed into new hazard", () => {
    const core = buildWorld();
    // Arm with durCurrent=2/2, durRegen=99 — would destroy and regen endlessly if stale
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Corrode, AffinityExpression.Push, 1, 5,
      2, 2, 99,  // durability: 2/2, regen=99 (intentionally large to detect leakage)
    );
    // Destroy via damage
    call((core as Record<string, unknown>).applyAffinityDamageToHazard,
      0, 2, 1, AffinityKind.Corrode, AffinityExpression.Push, 1,
    );
    expect(hazardExists(core, 2, 1)).toBe(false);

    // Re-arm with durRegen=0 — if stale, regen=99 would bleed in
    call(core.armStaticHazardAt, 2, 1,
      AffinityKind.Earth, AffinityExpression.Emit, 1, 3,
      4, 8, 0,   // durCurrent=4, durMax=8, durRegen=0
      6, 1,      // mana: max=6, regen=1
    );

    tick(core, 5);

    expect(hazardExists(core, 2, 1)).toBe(true);
    expect(hazardDur(core, 2, 1)).toBe(4);  // durRegen=0, unchanged
    // mana starts at manaReserve=3, manaMax=6, regen=1 → 5 ticks → min(6, 3+5)=6
    expect(hazardMana(core, 2, 1)).toBe(6);
  });
});
