/**
 * Ruling, 2026-08-18 (Plan.md §POST-AM/Z): `ActionKind.Move` is intentionally excluded
 * from token-budget charging. Stamina (AM.2b, `rules/move.ts`) is a move's real cost;
 * the token budget was never meant to gate movement a second time.
 *
 * `applyAction` (`core-ts/src/index.ts`) routes `ActionKind.Move` through
 * `handleMoveAction` and returns before `chargeBudgetForAction` is ever reached — even
 * when an Allocator has injected a non-zero cost for it via `setActionBudgetCost`. This
 * was flagged as an open question at P5.5 (`allocator/reconciliation`'s registry entry,
 * and `allocator-reconciles-or-nothing-does.test.js`'s fixture comment) and ruled
 * intentional here rather than left to be re-derived every session.
 *
 * THE CONTROL IS HALF THE TEST, same discipline as every ablation in this tree: the
 * second test proves the same cost injection DOES charge the Default category for a
 * non-Move action, so the first test cannot be passing because nothing charges anything.
 *
 * Perturbation: route `ActionKind.Move` through `chargeBudgetForAction` (revert this
 * ruling) → the first test fails. Remove the `chargeBudgetForAction` call from
 * `applyAction`'s non-Move path entirely → the second test fails. Each fails on its own
 * assertion and no other.
 */
import { describe, expect, test } from "vitest";

import { createCore, BudgetCategory } from "../../packages/core-ts/src/index.ts";
import { Direction } from "../../packages/core-ts/src/rules/move.ts";
import { ActionKind } from "../../packages/core-ts/src/validate/inputs.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

type Core = ReturnType<typeof createCore>;

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

const ACTOR = 10;
const INJECTED_COST = 5;

function buildWorld(): Core {
  const core = createCore();
  call(core.configureGrid, 5, 5);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
  call(core.clearActorPlacements);
  call(core.addActorPlacement, ACTOR, 1, 1);
  call(core.applyActorPlacements);
  call(core.setMotivatedActorVital, 0, VitalKind.Stamina, 60, 60, 0);
  // Same cost injected for both kinds: the control proves the injection itself works,
  // so the Move test's zero reading is Move's exemption, not a broken cost path.
  call(core.setActionBudgetCost, ActionKind.Move, INJECTED_COST);
  call(core.setActionBudgetCost, ActionKind.EmitLog, INJECTED_COST);
  call(core.setBudget, BudgetCategory.Default, 1000);
  return core;
}

function stepEast(core: Core): void {
  call(core.setActiveMotivatedActor, ACTOR);
  const fromX = call(core.getActorX) as number;
  const fromY = call(core.getActorY) as number;
  const tick = (call(core.getCurrentTick) as number) + 1;
  call(core.setMoveAction, ACTOR, fromX, fromY, fromX + 1, fromY, Direction.East, tick);
  call(core.applyAction, ActionKind.Move, 0);
}

describe("ActionKind.Move is ruled exempt from token-budget charging", () => {
  test("three moves reconcile as zero spend even with a non-zero cost injected", () => {
    const core = buildWorld();

    stepEast(core);
    stepEast(core);

    expect(call(core.getBudgetUsage, BudgetCategory.Default)).toBe(0);
  });

  test("control: the same injected cost DOES charge Default for a non-Move action", () => {
    const core = buildWorld();

    call(core.applyAction, ActionKind.EmitLog, 1);

    expect(call(core.getBudgetUsage, BudgetCategory.Default)).toBe(INJECTED_COST);
  });
});
