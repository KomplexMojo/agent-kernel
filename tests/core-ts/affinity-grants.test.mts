/**
 * M1 — Actor Affinity Grants (multi-grant, independent expiry): failing tests
 *
 * Resources grant affinity to any actor that passes over them. An actor therefore
 * needs N independently-expiring affinity grants, not the single affinity slot core
 * has today (motivatedActorAffinityKind/Expression/StacksArr, one entry per actor).
 *
 * Storage design encoded here (mirrors `motivatedActorVitalRegen`'s stride layout):
 *   Int32Array(maxMotivatedActors * MAX_AFFINITY_GRANTS_PER_ACTOR) per field,
 *   indexed `actorIndex * MAX_AFFINITY_GRANTS_PER_ACTOR + slot`.
 *   MAX_AFFINITY_GRANTS_PER_ACTOR = 10 (one per AffinityKind).
 *
 * Grant categories are DERIVED, never flagged. There is no `is_permanent` field
 * and no tier enum:
 *   - manaMax == 0             → innate. No pool. Always contributes stacks, never
 *                                expires. This is what setMotivatedActorAffinity
 *                                creates, preserving all pre-existing actor loadouts.
 *   - manaMax > 0, regen == 0  → temporary. Contributes stacks while mana > 0.
 *                                Removed WHOLE at mana 0 — all of that grant's stacks
 *                                disappear at once; other grants are untouched.
 *   - manaMax > 0, regen > 0   → permanent. Refills on tick, so it never stays empty.
 *                                Never removed.
 *
 * Effective affinity for a kind = SUM of stacks across that actor's contributing
 * grants. water+1 innate + water+2 temporary reads as water+3, and drops back to
 * water+1 when the temporary grant's mana is gone.
 *
 * Two design choices made during M1 authoring (flagged as assumptions, not from
 * Prompt.md):
 *   1. Drain order for spendMotivatedActorAffinityMana: pooled grants drain
 *      temporary-first (regen == 0 before regen > 0), tie-broken by lowest slot.
 *      Deterministic, and spends the perishable grant before the durable one.
 *      Innate grants (manaMax == 0) are never drained — they have no pool.
 *   2. A pooled grant contributes stacks only while mana > 0. A regen > 0 grant sitting
 *      at mana 0 is RETAINED but contributes 0 until regen refills it. This mirrors the
 *      established hazard rule ("zero-mana hazard remains represented but does not
 *      project active affinity" — hazard-regen.test.mts).
 *
 * Overflow: appending is the normal path and never mutates an existing grant. Only
 * when all MAX_AFFINITY_GRANTS_PER_ACTOR slots are occupied does a new grant merge
 * into a slot matching kind + expression + regen-ness (stacks and mana add).
 *
 * Tests MUST FAIL until M2 implements:
 *   1. Grant stride arrays + MAX_AFFINITY_GRANTS_PER_ACTOR in world.ts / state/affinity.ts
 *   2. grantMotivatedActorAffinity(actorIndex, kind, expr, stacks, mana, manaMax?, manaRegen?)
 *   3. Grant getters + getMotivatedActorAffinityStacksForKind + CORE_API_KEYS entries
 *   4. spendMotivatedActorAffinityMana(actorIndex, kind, amount)
 *   5. Grant mana regen + temporary-grant removal appended to applyTickRegen()
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
    throw new Error("expected callable core export — M2 must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/** 7×7 floor grid with two actors: index 0 at (1,1), index 1 at (2,2). */
function buildWorld(): Core {
  const core = createCore();
  call(core.configureGrid, 7, 7);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
  call(core.addActorPlacement, 1, 1, 1);
  call(core.addActorPlacement, 2, 2, 1);
  call(core.applyActorPlacements);
  for (const i of [0, 1]) {
    call(core.setMotivatedActorVital, i, VitalKind.Health, 10, 10, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Mana, 10, 10, 0);
  }
  return core;
}

function tick(core: Core, n = 1): void {
  for (let i = 0; i < n; i++) call(core.advanceTick);
}

/** Effective (summed) stacks for a kind across all contributing grants. */
function effective(core: Core, actor: number, kind: number): number {
  return call(
    (core as Record<string, unknown>).getMotivatedActorAffinityStacksForKind,
    actor,
    kind,
  ) as number;
}

function grantCount(core: Core, actor: number): number {
  return call(
    (core as Record<string, unknown>).getMotivatedActorAffinityGrantCountByIndex,
    actor,
  ) as number;
}

function grantMana(core: Core, actor: number, slot: number): number {
  return call(
    (core as Record<string, unknown>).getMotivatedActorAffinityGrantManaAt,
    actor,
    slot,
  ) as number;
}

function grantStacks(core: Core, actor: number, slot: number): number {
  return call(
    (core as Record<string, unknown>).getMotivatedActorAffinityGrantStacksAt,
    actor,
    slot,
  ) as number;
}

function grantKind(core: Core, actor: number, slot: number): number {
  return call(
    (core as Record<string, unknown>).getMotivatedActorAffinityGrantKindAt,
    actor,
    slot,
  ) as number;
}

/** grant(actor, kind, expr, stacks, mana, manaMax?, manaRegen?) */
function grant(
  core: Core,
  actor: number,
  kind: number,
  expr: number,
  stacks: number,
  mana: number,
  manaMax?: number,
  manaRegen?: number,
): number {
  const args: unknown[] = [actor, kind, expr, stacks, mana];
  if (manaMax !== undefined) args.push(manaMax);
  if (manaRegen !== undefined) args.push(manaRegen);
  return call(
    (core as Record<string, unknown>).grantMotivatedActorAffinity,
    ...args,
  ) as number;
}

function spend(core: Core, actor: number, kind: number, amount: number): number {
  return call(
    (core as Record<string, unknown>).spendMotivatedActorAffinityMana,
    actor,
    kind,
    amount,
  ) as number;
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("M1 API surface", () => {
  const REQUIRED = [
    "grantMotivatedActorAffinity",
    "spendMotivatedActorAffinityMana",
    "getMotivatedActorAffinityStacksForKind",
    "getMotivatedActorAffinityGrantCountByIndex",
    "getMotivatedActorAffinityGrantKindAt",
    "getMotivatedActorAffinityGrantExpressionAt",
    "getMotivatedActorAffinityGrantStacksAt",
    "getMotivatedActorAffinityGrantManaAt",
    "getMotivatedActorAffinityGrantManaMaxAt",
    "getMotivatedActorAffinityGrantManaRegenAt",
  ];

  for (const name of REQUIRED) {
    test(`${name} is exported`, () => {
      const core = createCore();
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    });
  }

  test("MAX_AFFINITY_GRANTS_PER_ACTOR is 10 (one per AffinityKind)", async () => {
    const mod = await import("../../packages/core-ts/src/state/affinity.ts");
    expect((mod as Record<string, unknown>).MAX_AFFINITY_GRANTS_PER_ACTOR).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Additive stacking — the water+1 / water+2 → water+3 rule
// ---------------------------------------------------------------------------

describe("effective affinity sums across grants of the same kind", () => {
  test("water+1 innate plus water+2 temporary reads as water+3", () => {
    const core = buildWorld();
    // Innate water+1 (no pool)
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 0, 0, 0);
    // Temporary water+2 (mana pool, no regen)
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 50, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);
  });

  test("three separate grants of one kind sum", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Fire, AffinityExpression.Emit, 1, 10, 10, 0);
    grant(core, 0, AffinityKind.Fire, AffinityExpression.Push, 2, 10, 10, 0);
    grant(core, 0, AffinityKind.Fire, AffinityExpression.Pull, 4, 10, 10, 0);
    expect(effective(core, 0, AffinityKind.Fire)).toBe(7);
    expect(grantCount(core, 0)).toBe(3);
  });

  test("grants of different kinds do not cross-contaminate", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 3, 10, 10, 0);
    grant(core, 0, AffinityKind.Fire, AffinityExpression.Emit, 5, 10, 10, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);
    expect(effective(core, 0, AffinityKind.Fire)).toBe(5);
    expect(effective(core, 0, AffinityKind.Earth)).toBe(0);
  });

  test("grants are per-actor — actor 1 is unaffected by actor 0's grants", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 3, 10, 10, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);
    expect(effective(core, 1, AffinityKind.Water)).toBe(0);
    expect(grantCount(core, 1)).toBe(0);
  });

  test("consuming appends a new grant — it never mutates an existing one", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 30, 30, 0);
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 50, 0);
    // Two distinct slots, each holding its own pool — NOT merged into one.
    expect(grantCount(core, 0)).toBe(2);
    expect(grantMana(core, 0, 0)).toBe(30);
    expect(grantMana(core, 0, 1)).toBe(50);
    expect(grantStacks(core, 0, 0)).toBe(1);
    expect(grantStacks(core, 0, 1)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Temporary grants: expire independently, removed whole
// ---------------------------------------------------------------------------

describe("temporary grants (manaMax > 0, regen == 0) expire independently", () => {
  test("grant is removed WHOLE at mana 0 — all its stacks vanish at once", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 3, 10, 10, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);

    spend(core, 0, AffinityKind.Water, 10);
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);
    expect(grantCount(core, 0)).toBe(0);
  });

  test("partial spend does not reduce stacks — magnitude holds until mana is gone", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 3, 10, 10, 0);
    spend(core, 0, AffinityKind.Water, 9);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3); // still +3 on the last point
    spend(core, 0, AffinityKind.Water, 1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);
  });

  test("one grant expiring leaves the other grant of the same kind untouched", () => {
    const core = buildWorld();
    // A: water+1, 30 mana. B: water+2, 50 mana. Drain temporary-first by slot order.
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 30, 30, 0);
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 50, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);

    spend(core, 0, AffinityKind.Water, 30); // exhausts A only
    expect(effective(core, 0, AffinityKind.Water)).toBe(2); // A's +1 gone, B's +2 intact
    expect(grantCount(core, 0)).toBe(1);
    expect(grantMana(core, 0, 0)).toBe(50); // B untouched, compacted into slot 0
  });

  test("innate grant survives a temporary grant's expiry", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 0, 0, 0); // innate +1
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 20, 20, 0); // temp +2
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);

    spend(core, 0, AffinityKind.Water, 20);
    expect(effective(core, 0, AffinityKind.Water)).toBe(1); // back to innate
    expect(grantCount(core, 0)).toBe(1);
  });

  test("spend returns the amount actually drained and never over-drains", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 5, 5, 0);
    expect(spend(core, 0, AffinityKind.Water, 12)).toBe(5); // only 5 available
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);
  });

  test("spending a kind the actor lacks drains nothing", () => {
    const core = buildWorld();
    expect(spend(core, 0, AffinityKind.Dark, 5)).toBe(0);
  });

  test("temporary grant does not regen back after expiring", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 4, 4, 0);
    spend(core, 0, AffinityKind.Water, 4);
    tick(core, 10);
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);
    expect(grantCount(core, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Permanent grants: regen > 0 refills, never removed
// ---------------------------------------------------------------------------

describe("permanent grants (manaMax > 0, regen > 0) are self-sustaining", () => {
  test("regen refills the pool on tick", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 3, 8, 2);
    tick(core);
    expect(grantMana(core, 0, 0)).toBe(5); // 3 + 2
  });

  test("mana clamps at manaMax", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 5, 6, 4);
    tick(core, 3);
    expect(grantMana(core, 0, 0)).toBe(6);
  });

  test("drained to 0 the grant is RETAINED and contributes 0, then returns on regen", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 4, 4, 1);
    spend(core, 0, AffinityKind.Water, 4);

    // Retained (slot still occupied) but contributing nothing while empty —
    // mirrors the hazard rule for a zero-mana hazard.
    expect(grantCount(core, 0)).toBe(1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);

    tick(core);
    expect(grantMana(core, 0, 0)).toBe(1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2); // affinity is back
  });

  test("permanent grant survives many ticks of heavy spending", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 10, 10, 5);
    for (let i = 0; i < 20; i++) {
      spend(core, 0, AffinityKind.Water, 10);
      tick(core, 2);
    }
    expect(grantCount(core, 0)).toBe(1); // never removed
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);
  });

  test("temporary drains before permanent when both are held", () => {
    const core = buildWorld();
    // Permanent water+1 granted first (slot 0), temporary water+2 second (slot 1).
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 20, 20, 5);
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 6, 6, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);

    // Spend 6: the temporary grant absorbs it all despite the permanent being slot 0.
    spend(core, 0, AffinityKind.Water, 6);
    expect(effective(core, 0, AffinityKind.Water)).toBe(1); // temp gone, permanent intact
    expect(grantCount(core, 0)).toBe(1);
    expect(grantMana(core, 0, 0)).toBe(20); // permanent never touched
  });

  test("innate grants are never drained", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 4, 0, 0, 0);
    expect(spend(core, 0, AffinityKind.Water, 50)).toBe(0); // no pool to draw from
    expect(effective(core, 0, AffinityKind.Water)).toBe(4); // unaffected
  });
});

// ---------------------------------------------------------------------------
// No tier flag — permanence is derived from regen alone
// ---------------------------------------------------------------------------

describe("permanence is derived, never flagged", () => {
  test("identical grants differing only in regen behave as temporary vs permanent", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 5, 5, 0); // regen 0
    grant(core, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 5, 5, 1); // regen 1

    spend(core, 0, AffinityKind.Water, 5);
    spend(core, 1, AffinityKind.Water, 5);
    tick(core);

    expect(grantCount(core, 0)).toBe(0); // temporary: gone
    expect(grantCount(core, 1)).toBe(1); // permanent: retained and refilling
    expect(effective(core, 1, AffinityKind.Water)).toBe(2);
  });

  test("core exposes no is_permanent / tier accessor", () => {
    const core = createCore() as Record<string, unknown>;
    for (const key of Object.keys(core)) {
      expect(key).not.toMatch(/is_?permanent|permanentFlag|affinityTier/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Slot cap and overflow merge
// ---------------------------------------------------------------------------

describe("grant slots: cap of 10 with merge-on-overflow", () => {
  const ALL_KINDS = [
    AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
    AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
    AffinityKind.Light, AffinityKind.Dark,
  ];

  test("an actor can hold 10 distinct grants", () => {
    const core = buildWorld();
    for (const kind of ALL_KINDS) {
      expect(grant(core, 0, kind, AffinityExpression.Emit, 1, 10, 10, 0)).toBe(1);
    }
    expect(grantCount(core, 0)).toBe(10);
    for (const kind of ALL_KINDS) {
      expect(effective(core, 0, kind)).toBe(1);
    }
  });

  test("11th grant merges into the matching kind+expression slot rather than being lost", () => {
    const core = buildWorld();
    for (const kind of ALL_KINDS) {
      grant(core, 0, kind, AffinityExpression.Emit, 1, 10, 10, 0);
    }
    // Slots full. A water:emit grant must merge into the existing water:emit slot.
    expect(grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 5, 5, 0)).toBe(1);
    expect(grantCount(core, 0)).toBe(10); // no new slot
    expect(effective(core, 0, AffinityKind.Water)).toBe(3); // 1 + 2 stacks merged
  });

  test("overflow merge adds mana into the matching slot", () => {
    const core = buildWorld();
    for (const kind of ALL_KINDS) {
      grant(core, 0, kind, AffinityExpression.Emit, 1, 10, 10, 0);
    }
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 5, 5, 0);
    const waterSlot = [...Array(10).keys()].find(
      (s) => grantKind(core, 0, s) === AffinityKind.Water,
    )!;
    expect(grantMana(core, 0, waterSlot)).toBe(15); // 10 + 5
  });

  test("overflow with no matching slot is rejected rather than corrupting a slot", () => {
    const core = buildWorld();
    for (const kind of ALL_KINDS) {
      grant(core, 0, kind, AffinityExpression.Emit, 1, 10, 10, 0);
    }
    // Slots full; water:push matches no existing kind+expression pair.
    expect(grant(core, 0, AffinityKind.Water, AffinityExpression.Push, 1, 5, 5, 0)).toBe(0);
    expect(grantCount(core, 0)).toBe(10);
    expect(effective(core, 0, AffinityKind.Water)).toBe(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("grant validation", () => {
  test("stacks <= 0 is rejected", () => {
    const core = buildWorld();
    expect(grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 0, 10, 10, 0)).toBe(0);
    expect(grantCount(core, 0)).toBe(0);
  });

  test("invalid kind is rejected", () => {
    const core = buildWorld();
    expect(grant(core, 0, 0, AffinityExpression.Emit, 1, 10, 10, 0)).toBe(0);
    expect(grant(core, 0, 99, AffinityExpression.Emit, 1, 10, 10, 0)).toBe(0);
    expect(grantCount(core, 0)).toBe(0);
  });

  test("invalid expression is rejected", () => {
    const core = buildWorld();
    expect(grant(core, 0, AffinityKind.Water, 0, 1, 10, 10, 0)).toBe(0);
    expect(grant(core, 0, AffinityKind.Water, 99, 1, 10, 10, 0)).toBe(0);
    expect(grantCount(core, 0)).toBe(0);
  });

  test("out-of-range actor index is rejected", () => {
    const core = buildWorld();
    expect(grant(core, 99, AffinityKind.Water, AffinityExpression.Emit, 1, 10, 10, 0)).toBe(0);
    expect(grant(core, -1, AffinityKind.Water, AffinityExpression.Emit, 1, 10, 10, 0)).toBe(0);
  });

  test("negative mana or regen is rejected", () => {
    const core = buildWorld();
    expect(grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, -5, 10, 0)).toBe(0);
    expect(grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 10, 10, -2)).toBe(0);
    expect(grantCount(core, 0)).toBe(0);
  });

  test("getters return 0 for out-of-range slots and actors", () => {
    const core = buildWorld();
    expect(grantKind(core, 0, 99)).toBe(0);
    expect(grantMana(core, 99, 0)).toBe(0);
    expect(effective(core, 99, AffinityKind.Water)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism / reset
// ---------------------------------------------------------------------------

describe("grant state is deterministic and resets cleanly", () => {
  test("identical grant sequences produce identical effective affinity", () => {
    const build = (): Core => {
      const core = buildWorld();
      grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 30, 30, 0);
      grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 50, 1);
      grant(core, 0, AffinityKind.Fire, AffinityExpression.Push, 3, 10, 10, 0);
      spend(core, 0, AffinityKind.Water, 30);
      tick(core, 3);
      return core;
    };
    const a = build();
    const b = build();
    for (const kind of [AffinityKind.Water, AffinityKind.Fire]) {
      expect(effective(a, 0, kind)).toBe(effective(b, 0, kind));
    }
    expect(grantCount(a, 0)).toBe(grantCount(b, 0));
  });

  test("a rebuilt world carries no stale grants from a previous one", () => {
    const first = buildWorld();
    grant(first, 0, AffinityKind.Water, AffinityExpression.Emit, 9, 99, 99, 9);
    const second = buildWorld();
    expect(grantCount(second, 0)).toBe(0);
    expect(effective(second, 0, AffinityKind.Water)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations — EXPANDED (M11)
//
// Expanded into tests/core-ts/resource-permutations.test.mts: the 10 kinds × 4
// expressions matrix, exact expiry/refill timing, slot saturation and re-grant,
// multi-actor independence, and vital+regen payload permutations.
//
// Hand to Ollama (/ollama-test-permutations) once M2 is green. Expand:
//   - All 10 AffinityKind × 4 AffinityExpression grant combinations round-trip
//     through grant → effective → spend → expire.
//   - manaRegen > manaMax clamps in a single tick (mirror hazard-regen.test.mts).
//   - Exact expiry timing: mana=N, regen=0 survives exactly N points of spend.
//   - Exact refill timing: reaching manaMax in ceil((max-current)/regen) ticks.
//   - Mixed innate + temporary + permanent grants of the SAME kind on one actor.
//   - Multi-actor independence: 10 actors × 10 grants each regen independently.
//   - Spend amounts of 0 and negative values are no-ops.
//   - Grant → expire → re-grant into the freed slot starts with fresh mana/regen
//     (no stale values bleeding through, per the hazard arm→destroy→re-arm case).
// ---------------------------------------------------------------------------
