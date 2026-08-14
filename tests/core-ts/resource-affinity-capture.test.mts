/**
 * M3 — Resource affinity capture on pass-over: failing tests
 *
 * State of resources before this milestone (verified, not assumed):
 *   - world.ts allocates resourceVitalKindByCell / resourceDeltaByCell /
 *     resourceModeByCell, resets them to RESOURCE_VITAL_NONE, and exposes
 *     hasResourceAt / getResource*At / removeResourceAt.
 *   - NOTHING ever writes a resource. There is no placement function, and no
 *     resource key appears in CORE_API_KEYS.
 *   - hasResourceAt therefore always returns 0, so applyResourceCaptureAt in
 *     rules/move.ts is unreachable. The only test referencing resources stubs
 *     `hasResourceAt: () => 0`.
 *
 * M4 makes resources real and gives them an affinity payload:
 *   - placeResourceAt(x, y, vitalKind, delta, mode) — the vital payload that
 *     applyResourceCaptureAt already knows how to apply, finally reachable.
 *   - placeAffinityResourceAt(x, y, kind, expression, stacks, mana, manaRegen)
 *     — the affinity payload. mana + manaRegen ride along to the grant, so
 *     permanence stays derived from regen (no flag, no tier).
 *   - A cell may carry either payload or both; both are captured on pass-over.
 *   - Capture is automatic on entry and credits the ACTIVE motivated actor,
 *     which is how the existing vital capture already behaves via setActorVital.
 *
 * Tests MUST FAIL until M4 implements:
 *   1. resourceAffinity / resourceMana per-cell arrays in world.ts
 *   2. placeResourceAt / placeAffinityResourceAt + getters + CORE_API_KEYS entries
 *   3. hasResourceAt true for an affinity-only resource; removeResourceAt clears both
 *   4. grantActiveActorAffinity(kind, expr, stacks, mana, manaRegen) on world
 *   5. applyResourceCaptureAt extended to grant the affinity payload
 */
import { describe, expect, test } from "vitest";
import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  AffinityExpression,
  AffinityKind,
} from "../../packages/core-ts/src/state/affinity.ts";
import { Direction } from "../../packages/core-ts/src/rules/move.ts";
import { ActionKind } from "../../packages/core-ts/src/validate/inputs.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export — M4 must wire this");
  }
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

/** Actor ids. Index 0 is the delver, index 1 the warden. */
const DELVER = 10;
const WARDEN = 20;

/** 7×7 floor grid. Delver id 10 at (1,1); warden id 20 at (4,4). */
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
    call(core.setMotivatedActorVital, i, VitalKind.Health, 10, 10, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Mana, 10, 10, 0);
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

function hasResource(core: Core, x: number, y: number): number {
  return call((core as Record<string, unknown>).hasResourceAt, x, y) as number;
}

/** placeAffinityResourceAt(x, y, kind, expression, stacks, mana, manaRegen) */
function placeAffinity(
  core: Core,
  x: number,
  y: number,
  kind: number,
  expression: number,
  stacks: number,
  mana: number,
  manaRegen = 0,
): number {
  return call(
    (core as Record<string, unknown>).placeAffinityResourceAt,
    x, y, kind, expression, stacks, mana, manaRegen,
  ) as number;
}

/**
 * Walks `actorId` one step onto (x, y). Capture is a movement side effect —
 * applyMove → commitMove → applyTileEntryEffects — so nothing here opts in.
 */
function stepTo(core: Core, actorId: number, x: number, y: number): void {
  call(core.setActiveMotivatedActor, actorId);
  const fromX = call(core.getActorX) as number;
  const fromY = call(core.getActorY) as number;
  const tick = (call(core.getCurrentTick) as number) + 1;
  call(
    core.setMoveAction,
    actorId, fromX, fromY, x, y,
    directionFor(x - fromX, y - fromY),
    tick,
  );
  call(core.applyAction, ActionKind.Move, 0);
}

// ---------------------------------------------------------------------------
// API presence
// ---------------------------------------------------------------------------

describe("M3 API surface", () => {
  const REQUIRED = [
    "placeResourceAt",
    "placeAffinityResourceAt",
    "hasResourceAt",
    "removeResourceAt",
    "getResourceAffinityKindAt",
    "getResourceAffinityExpressionAt",
    "getResourceAffinityStacksAt",
    "getResourceManaAt",
    "getResourceManaRegenAt",
  ];

  for (const name of REQUIRED) {
    test(`${name} is exported`, () => {
      const core = createCore();
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    });
  }
});

// ---------------------------------------------------------------------------
// Placement — the writer that never existed
// ---------------------------------------------------------------------------

describe("resource placement", () => {
  test("an affinity-only resource registers as present", () => {
    const core = buildWorld();
    expect(hasResource(core, 3, 1)).toBe(0);
    placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 0);
    expect(hasResource(core, 3, 1)).toBe(1);
  });

  test("affinity payload reads back exactly as placed", () => {
    const core = buildWorld();
    placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 3);
    const g = (n: string) => call((core as Record<string, unknown>)[n], 3, 1);
    expect(g("getResourceAffinityKindAt")).toBe(AffinityKind.Water);
    expect(g("getResourceAffinityExpressionAt")).toBe(AffinityExpression.Emit);
    expect(g("getResourceAffinityStacksAt")).toBe(2);
    expect(g("getResourceManaAt")).toBe(50);
    expect(g("getResourceManaRegenAt")).toBe(3);
  });

  test("removeResourceAt clears the affinity payload", () => {
    const core = buildWorld();
    placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 0);
    call((core as Record<string, unknown>).removeResourceAt, 3, 1);
    expect(hasResource(core, 3, 1)).toBe(0);
    expect(call((core as Record<string, unknown>).getResourceAffinityKindAt, 3, 1)).toBe(0);
  });

  test("invalid placements are rejected", () => {
    const core = buildWorld();
    expect(placeAffinity(core, 3, 1, 0, AffinityExpression.Emit, 1, 10, 0)).toBe(0);
    expect(placeAffinity(core, 3, 1, 99, AffinityExpression.Emit, 1, 10, 0)).toBe(0);
    expect(placeAffinity(core, 3, 1, AffinityKind.Water, 99, 1, 10, 0)).toBe(0);
    expect(placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 0, 10, 0)).toBe(0);
    expect(placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 1, -1, 0)).toBe(0);
    expect(placeAffinity(core, 99, 99, AffinityKind.Water, AffinityExpression.Emit, 1, 10, 0)).toBe(0);
    expect(hasResource(core, 3, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The dictated scenario: temporary affinity from a mana-only resource
// ---------------------------------------------------------------------------

describe("passing over a mana-only resource grants temporary affinity", () => {
  test("delver gains water affinity by stepping onto the resource", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 0);
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);

    stepTo(core, DELVER, 2, 1); // delver at (1,1) steps east onto the resource

    expect(effective(core, 0, AffinityKind.Water)).toBe(2);
    expect(grantCount(core, 0)).toBe(1);
    expect(grantMana(core, 0, 0)).toBe(50);
  });

  test("the resource is consumed — it is gone from the cell", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 0);
    stepTo(core, DELVER, 2, 1);
    expect(hasResource(core, 2, 1)).toBe(0);
  });

  test("the granted affinity lasts until its mana is spent, then is lost", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 8, 0);
    stepTo(core, DELVER, 2, 1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);

    call((core as Record<string, unknown>).spendMotivatedActorAffinityMana,
      0, AffinityKind.Water, 8);

    expect(effective(core, 0, AffinityKind.Water)).toBe(0); // temporary access ended
    expect(grantCount(core, 0)).toBe(0);
  });

  test("no regen means the lost affinity never comes back", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 4, 0);
    stepTo(core, DELVER, 2, 1);
    call((core as Record<string, unknown>).spendMotivatedActorAffinityMana,
      0, AffinityKind.Water, 4);
    for (let i = 0; i < 10; i++) call(core.advanceTick);
    expect(effective(core, 0, AffinityKind.Water)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mana + regen resource → permanent affinity
// ---------------------------------------------------------------------------

describe("passing over a mana + regen resource grants permanent affinity", () => {
  test("the grant regenerates and is never removed", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 10, 5);
    stepTo(core, DELVER, 2, 1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);

    call((core as Record<string, unknown>).spendMotivatedActorAffinityMana,
      0, AffinityKind.Water, 10);
    expect(grantCount(core, 0)).toBe(1); // retained, unlike the temporary case
    call(core.advanceTick);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2); // back after regen
  });

  test("regen alone distinguishes permanent from temporary — same placement otherwise", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 6, 0); // temp
    placeAffinity(core, 2, 2, AffinityKind.Fire, AffinityExpression.Emit, 2, 6, 2);  // perm
    stepTo(core, DELVER, 2, 1);
    stepTo(core, DELVER, 2, 2);

    const spend = (kind: number) =>
      call((core as Record<string, unknown>).spendMotivatedActorAffinityMana, 0, kind, 6);
    spend(AffinityKind.Water);
    spend(AffinityKind.Fire);
    call(core.advanceTick);

    expect(effective(core, 0, AffinityKind.Water)).toBe(0); // gone for good
    expect(effective(core, 0, AffinityKind.Fire)).toBe(2);  // regenerated
  });
});

// ---------------------------------------------------------------------------
// Actor-type parity — "an actor of any type, either a delver or a warden"
// ---------------------------------------------------------------------------

describe("delvers and wardens consume resources identically", () => {
  test("a warden gains affinity the same way a delver does", () => {
    const core = buildWorld();
    placeAffinity(core, 4, 3, AffinityKind.Dark, AffinityExpression.Push, 3, 20, 0);
    stepTo(core, WARDEN, 4, 3); // actor 1 (warden) steps north onto it
    expect(effective(core, 1, AffinityKind.Dark)).toBe(3);
    expect(effective(core, 0, AffinityKind.Dark)).toBe(0); // delver unaffected
  });

  test("whichever actor arrives first takes it; the other finds nothing", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 30, 0);
    stepTo(core, DELVER, 2, 1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);
    expect(hasResource(core, 2, 1)).toBe(0);
    expect(effective(core, 1, AffinityKind.Water)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Consumption is automatic and stacks onto what the actor already holds
// ---------------------------------------------------------------------------

describe("consumption is automatic and additive", () => {
  test("entering the cell is enough — no elective claim step exists", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 1, 10, 0);
    stepTo(core, DELVER, 2, 1);
    expect(grantCount(core, 0)).toBe(1); // fired on entry, nothing was opted into
  });

  test("water+1 then water+2 reads as water+3", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 1, 30, 0);
    placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 0);
    stepTo(core, DELVER, 2, 1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(1);
    stepTo(core, DELVER, 3, 1);
    expect(effective(core, 0, AffinityKind.Water)).toBe(3);
    expect(grantCount(core, 0)).toBe(2); // two independent grants, not merged
  });

  test("the two grants expire independently", () => {
    const core = buildWorld();
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 1, 30, 0);
    placeAffinity(core, 3, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 50, 0);
    stepTo(core, DELVER, 2, 1);
    stepTo(core, DELVER, 3, 1);

    call((core as Record<string, unknown>).spendMotivatedActorAffinityMana,
      0, AffinityKind.Water, 30);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2); // first grant gone only
  });
});

// ---------------------------------------------------------------------------
// The vital payload still works (and is finally reachable)
// ---------------------------------------------------------------------------

describe("vital resources still behave, now that they can exist", () => {
  test("a consumable vital resource raises the actor's current vital", () => {
    const core = buildWorld();
    call(core.setMotivatedActorVital, 0, VitalKind.Health, 4, 10, 0);
    // placeResourceAt(x, y, vitalKind, delta, mode) — mode 0 = Consumable
    call((core as Record<string, unknown>).placeResourceAt, 2, 1, VitalKind.Health, 3, 0);
    stepTo(core, DELVER, 2, 1);
    expect(call(core.getMotivatedActorVitalCurrentByIndex, 0, VitalKind.Health)).toBe(7);
  });

  test("a cell can carry both a vital and an affinity payload", () => {
    const core = buildWorld();
    call(core.setMotivatedActorVital, 0, VitalKind.Health, 4, 10, 0);
    call((core as Record<string, unknown>).placeResourceAt, 2, 1, VitalKind.Health, 3, 0);
    placeAffinity(core, 2, 1, AffinityKind.Water, AffinityExpression.Emit, 2, 20, 0);

    stepTo(core, DELVER, 2, 1);

    expect(call(core.getMotivatedActorVitalCurrentByIndex, 0, VitalKind.Health)).toBe(7);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);
    expect(hasResource(core, 2, 1)).toBe(0); // both payloads consumed together
  });
});

// ---------------------------------------------------------------------------
// ## TODO: Test Permutations — EXPANDED (M11)
//
// Expanded into tests/core-ts/resource-permutations.test.mts: the 10 kinds × 4
// expressions matrix, exact expiry/refill timing, slot saturation and re-grant,
// multi-actor independence, and vital+regen payload permutations.
//
// Hand to Ollama (/ollama-test-permutations) once M4 is green. Expand:
//   - All 10 AffinityKind × 4 AffinityExpression resources capture correctly.
//   - Capture from every entry direction, including diagonals.
//   - An actor consuming 10 distinct-kind resources fills all grant slots; the
//     11th of a matching kind+expression merges (per the M1 overflow rule).
//   - Resource on a spawn tile / exit tile / barrier-adjacent tile.
//   - Placement over an existing resource (overwrite vs reject).
//   - Multi-actor: two actors racing toward one resource across many tick orders.
//   - Permanent-grant regen continues across 100+ ticks with repeated spending.
// ---------------------------------------------------------------------------
