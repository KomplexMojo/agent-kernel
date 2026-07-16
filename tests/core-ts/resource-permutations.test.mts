/**
 * M11 — Resource permutation coverage.
 *
 * Expanded from the `## TODO: Test Permutations` stubs in affinity-grants.test.mts
 * and resource-affinity-capture.test.mts. The base tests prove each rule once; these
 * sweep the matrices where a rule could hold for water:emit and quietly fail for
 * dark:draw — kind/expression coverage, exact expiry and refill timing, slot
 * saturation, and multi-actor independence.
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
  if (typeof fn !== "function") throw new Error("expected callable core export");
  return fn(...args);
}

type Core = ReturnType<typeof createCore>;

const ALL_KINDS = [
  AffinityKind.Fire, AffinityKind.Water, AffinityKind.Earth, AffinityKind.Wind,
  AffinityKind.Life, AffinityKind.Decay, AffinityKind.Corrode, AffinityKind.Fortify,
  AffinityKind.Light, AffinityKind.Dark,
];
const ALL_EXPRESSIONS = [
  AffinityExpression.Push, AffinityExpression.Pull,
  AffinityExpression.Emit, AffinityExpression.Draw,
];
const ALL_VITALS = [VitalKind.Health, VitalKind.Mana, VitalKind.Stamina];

const DELVER = 10;

function buildWorld(actorCount = 1): Core {
  const core = createCore();
  call(core.configureGrid, 9, 9);
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) call(core.setTileAt, x, y, 1);
  }
  call(core.clearActorPlacements);
  for (let i = 0; i < actorCount; i++) call(core.addActorPlacement, DELVER + i * 10, 1, 1 + i);
  call(core.applyActorPlacements);
  for (let i = 0; i < actorCount; i++) {
    call(core.setMotivatedActorVital, i, VitalKind.Health, 10, 20, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Mana, 10, 20, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Stamina, 90, 90, 0);
    call(core.setMotivatedActorVital, i, VitalKind.Durability, 5, 5, 0);
  }
  return core;
}

const grant = (core: Core, actor: number, kind: number, expr: number, stacks: number,
  mana: number, manaMax: number, regen: number) =>
  call((core as Record<string, unknown>).grantMotivatedActorAffinity,
    actor, kind, expr, stacks, mana, manaMax, regen) as number;

const effective = (core: Core, actor: number, kind: number) =>
  call((core as Record<string, unknown>).getMotivatedActorAffinityStacksForKind, actor, kind) as number;

const spend = (core: Core, actor: number, kind: number, amount: number) =>
  call((core as Record<string, unknown>).spendMotivatedActorAffinityMana, actor, kind, amount) as number;

const grantCount = (core: Core, actor: number) =>
  call((core as Record<string, unknown>).getMotivatedActorAffinityGrantCountByIndex, actor) as number;

const grantMana = (core: Core, actor: number, slot: number) =>
  call((core as Record<string, unknown>).getMotivatedActorAffinityGrantManaAt, actor, slot) as number;

function directionFor(dx: number, dy: number): number {
  if (dx === 0 && dy === -1) return Direction.North;
  if (dx === 1 && dy === -1) return Direction.NorthEast;
  if (dx === 1 && dy === 0) return Direction.East;
  if (dx === 1 && dy === 1) return Direction.SouthEast;
  if (dx === 0 && dy === 1) return Direction.South;
  if (dx === -1 && dy === 1) return Direction.SouthWest;
  if (dx === -1 && dy === 0) return Direction.West;
  if (dx === -1 && dy === -1) return Direction.NorthWest;
  throw new Error(`not adjacent: ${dx},${dy}`);
}

function stepTo(core: Core, actorId: number, x: number, y: number): void {
  call(core.setActiveMotivatedActor, actorId);
  const fromX = call(core.getActorX) as number;
  const fromY = call(core.getActorY) as number;
  const tick = (call(core.getCurrentTick) as number) + 1;
  call(core.setMoveAction, actorId, fromX, fromY, x, y, directionFor(x - fromX, y - fromY), tick);
  call(core.applyAction, ActionKind.Move, 0);
}

// ---------------------------------------------------------------------------
// kind × expression matrix
// ---------------------------------------------------------------------------

describe("permutations: all 10 kinds × 4 expressions", () => {
  test("every combination grants, sums and expires identically", () => {
    for (const kind of ALL_KINDS) {
      for (const expr of ALL_EXPRESSIONS) {
        const core = buildWorld();
        expect(grant(core, 0, kind, expr, 2, 10, 10, 0)).toBe(1);
        expect(effective(core, 0, kind)).toBe(2);
        expect(spend(core, 0, kind, 10)).toBe(10);
        expect(effective(core, 0, kind)).toBe(0);
        expect(grantCount(core, 0)).toBe(0);
      }
    }
  });

  test("every kind survives as permanent when regen > 0", () => {
    for (const kind of ALL_KINDS) {
      const core = buildWorld();
      grant(core, 0, kind, AffinityExpression.Emit, 1, 5, 5, 1);
      spend(core, 0, kind, 5);
      expect(grantCount(core, 0)).toBe(1);
      call(core.advanceTick);
      expect(effective(core, 0, kind)).toBe(1);
    }
  });

  test("captured resources of every kind grant on pass-over", () => {
    for (const kind of ALL_KINDS) {
      const core = buildWorld();
      call((core as Record<string, unknown>).placeAffinityResourceAt, 2, 1, kind, AffinityExpression.Emit, 3, 15, 0);
      stepTo(core, DELVER, 2, 1);
      expect(effective(core, 0, kind)).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// exact expiry / refill timing
// ---------------------------------------------------------------------------

describe("permutations: exact timing", () => {
  test("a mana-N grant survives exactly N points of spend", () => {
    for (const mana of [1, 2, 5, 10, 33]) {
      const core = buildWorld();
      grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, mana, mana, 0);
      expect(spend(core, 0, AffinityKind.Water, mana - 1)).toBe(mana - 1);
      expect(effective(core, 0, AffinityKind.Water)).toBe(1); // alive on the last point
      expect(spend(core, 0, AffinityKind.Water, 1)).toBe(1);
      expect(effective(core, 0, AffinityKind.Water)).toBe(0);
    }
  });

  test("a drained permanent grant refills in ceil((max-0)/regen) ticks", () => {
    for (const [max, regen] of [[4, 1], [6, 2], [9, 3], [10, 5]]) {
      const core = buildWorld();
      grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, max, max, regen);
      spend(core, 0, AffinityKind.Water, max);
      const ticks = Math.ceil(max / regen);
      for (let i = 0; i < ticks; i++) call(core.advanceTick);
      expect(grantMana(core, 0, 0)).toBe(max);
    }
  });

  test("regen greater than max clamps in a single tick", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 0, 3, 10);
    call(core.advanceTick);
    expect(grantMana(core, 0, 0)).toBe(3);
  });

  test("spend of 0 or negative is a no-op", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 2, 10, 10, 0);
    expect(spend(core, 0, AffinityKind.Water, 0)).toBe(0);
    expect(spend(core, 0, AffinityKind.Water, -5)).toBe(0);
    expect(grantMana(core, 0, 0)).toBe(10);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// slot saturation
// ---------------------------------------------------------------------------

describe("permutations: slot saturation", () => {
  test("10 distinct kinds fill every slot and all remain readable", () => {
    const core = buildWorld();
    ALL_KINDS.forEach((kind) => grant(core, 0, kind, AffinityExpression.Emit, 2, 10, 10, 0));
    expect(grantCount(core, 0)).toBe(10);
    ALL_KINDS.forEach((kind) => expect(effective(core, 0, kind)).toBe(2));
  });

  test("re-granting into a slot freed by expiry starts with fresh mana", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 5, 99, 99, 0);
    spend(core, 0, AffinityKind.Water, 99);
    expect(grantCount(core, 0)).toBe(0);
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 4, 4, 0);
    expect(grantMana(core, 0, 0)).toBe(4); // no stale 99
    expect(effective(core, 0, AffinityKind.Water)).toBe(1); // no stale 5 stacks
  });

  test("mixed innate + temporary + permanent of one kind sum and decay correctly", () => {
    const core = buildWorld();
    grant(core, 0, AffinityKind.Water, AffinityExpression.Emit, 1, 0, 0, 0);   // innate +1
    grant(core, 0, AffinityKind.Water, AffinityExpression.Pull, 2, 8, 8, 2);   // permanent +2
    grant(core, 0, AffinityKind.Water, AffinityExpression.Push, 4, 6, 6, 0);   // temporary +4
    expect(effective(core, 0, AffinityKind.Water)).toBe(7);

    spend(core, 0, AffinityKind.Water, 6); // temporary drains first
    expect(effective(core, 0, AffinityKind.Water)).toBe(3); // innate 1 + permanent 2
    expect(grantCount(core, 0)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// multi-actor independence
// ---------------------------------------------------------------------------

describe("permutations: multi-actor independence", () => {
  test("five actors each hold their own grants without cross-talk", () => {
    const core = buildWorld(5);
    for (let i = 0; i < 5; i++) {
      grant(core, i, ALL_KINDS[i], AffinityExpression.Emit, i + 1, 10, 10, 0);
    }
    for (let i = 0; i < 5; i++) {
      expect(effective(core, i, ALL_KINDS[i])).toBe(i + 1);
      for (let j = 0; j < 5; j++) {
        if (i !== j) expect(effective(core, j, ALL_KINDS[i])).toBe(0);
      }
    }
  });

  test("draining one actor's grant leaves the others untouched", () => {
    const core = buildWorld(3);
    for (let i = 0; i < 3; i++) grant(core, i, AffinityKind.Water, AffinityExpression.Emit, 2, 5, 5, 0);
    spend(core, 1, AffinityKind.Water, 5);
    expect(effective(core, 0, AffinityKind.Water)).toBe(2);
    expect(effective(core, 1, AffinityKind.Water)).toBe(0);
    expect(effective(core, 2, AffinityKind.Water)).toBe(2);
  });

  test("regen advances every actor's grants independently in one tick", () => {
    const core = buildWorld(3);
    for (let i = 0; i < 3; i++) grant(core, i, AffinityKind.Fire, AffinityExpression.Emit, 1, 0, 10, i + 1);
    call(core.advanceTick);
    for (let i = 0; i < 3; i++) expect(grantMana(core, i, 0)).toBe(i + 1);
  });
});

// ---------------------------------------------------------------------------
// vital payload permutations
// ---------------------------------------------------------------------------

describe("permutations: vital + regen payloads", () => {
  test("every vital kind grants its regen on pass-over", () => {
    for (const vital of ALL_VITALS) {
      const core = buildWorld();
      call((core as Record<string, unknown>).placeResourceAt, 2, 1, vital, 0, 0, 2);
      stepTo(core, DELVER, 2, 1);
      expect(call(core.getMotivatedActorVitalRegenByIndex, 0, vital)).toBe(2);
    }
  });

  test("regen is granted under every permanenceMode", () => {
    for (const mode of [0, 1, 2]) {
      const core = buildWorld();
      call((core as Record<string, unknown>).placeResourceAt, 2, 1, VitalKind.Health, 2, mode, 3);
      stepTo(core, DELVER, 2, 1);
      expect(call(core.getMotivatedActorVitalRegenByIndex, 0, VitalKind.Health)).toBe(3);
    }
  });

  test("consumable raises current only; level/permanent raise max", () => {
    const consumable = buildWorld();
    call((consumable as Record<string, unknown>).placeResourceAt, 2, 1, VitalKind.Health, 4, 0, 0);
    stepTo(consumable, DELVER, 2, 1);
    expect(call(consumable.getMotivatedActorVitalCurrentByIndex, 0, VitalKind.Health)).toBe(14);
    expect(call(consumable.getMotivatedActorVitalMaxByIndex, 0, VitalKind.Health)).toBe(20);

    for (const mode of [1, 2]) {
      const core = buildWorld();
      call((core as Record<string, unknown>).placeResourceAt, 2, 1, VitalKind.Health, 4, mode, 0);
      stepTo(core, DELVER, 2, 1);
      expect(call(core.getMotivatedActorVitalMaxByIndex, 0, VitalKind.Health)).toBe(24);
    }
  });
});
