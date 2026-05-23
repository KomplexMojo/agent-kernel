import { describe, expect, test } from "vitest";

import { createEffectsPort, EffectKind } from "../../packages/core-ts/src/ports/effects.ts";
import {
  BudgetConstants,
  createBudgetState,
} from "../../packages/core-ts/src/state/budget.ts";
import { createCounterState } from "../../packages/core-ts/src/state/counter.ts";
import { createEffectState } from "../../packages/core-ts/src/state/effects.ts";
import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  ActionKind,
  validateAction,
  validateSeed,
  ValidationError,
} from "../../packages/core-ts/src/validate/inputs.ts";

describe("core-ts leaf modules", () => {
  test("counter state resets, increments, and reads the latest value", () => {
    const counter = createCounterState();

    counter.resetCounter(0);

    expect(counter.incrementCounter()).toBe(1);
    expect(counter.incrementCounter(5)).toBe(6);
    expect(counter.getCounterValue()).toBe(6);
  });

  test("budget state tracks caps, spent totals, and invalid categories", () => {
    const budget = createBudgetState();

    budget.setBudgetCap(2, 40);
    expect(budget.getBudgetCap(2)).toBe(40);
    expect(budget.chargeBudget(2, 5)).toBe(5);
    expect(budget.chargeBudget(2, 7)).toBe(12);
    expect(budget.chargeBudget(2, 0)).toBe(12);
    expect(budget.chargeBudget(2, -3)).toBe(12);
    expect(budget.getBudgetSpent(2)).toBe(12);
    expect(budget.getBudgetCap(-1)).toBe(BudgetConstants.UNLIMITED_CAP);
    expect(budget.getBudgetCap(BudgetConstants.MAX_BUDGET_CATEGORIES)).toBe(
      BudgetConstants.UNLIMITED_CAP,
    );
    expect(budget.getBudgetSpent(-1)).toBe(0);
    expect(budget.chargeBudget(BudgetConstants.MAX_BUDGET_CATEGORIES, 1)).toBe(
      -1,
    );

    budget.resetBudgets();

    for (let i = 0; i < BudgetConstants.MAX_BUDGET_CATEGORIES; i += 1) {
      expect(budget.getBudgetCap(i)).toBe(BudgetConstants.UNLIMITED_CAP);
      expect(budget.getBudgetSpent(i)).toBe(0);
    }
  });

  test("effects port stores generic effects and clears count", () => {
    const effects = createEffectsPort();

    effects.pushEffect(EffectKind.Log, 3);

    expect(effects.getEffectCount()).toBe(1);
    expect(effects.getEffectKind(0)).toBe(EffectKind.Log);
    expect(effects.getEffectValue(0)).toBe(3);
    expect(effects.getEffectKind(1)).toBe(0);

    effects.clearEffects();

    expect(effects.getEffectCount()).toBe(0);
  });

  test("effects port caps stored effects at 32", () => {
    const effects = createEffectsPort();

    for (let i = 0; i < 33; i += 1) {
      effects.pushEffect(EffectKind.Telemetry, i);
    }

    expect(effects.getEffectCount()).toBe(32);
    expect(effects.getEffectValue(31)).toBe(31);
    expect(effects.getEffectValue(32)).toBe(0);
  });

  test("effects port stores actor movement, blockage, and durability payloads", () => {
    const effects = createEffectsPort();

    effects.pushActorMoved(101, 4, 7);
    effects.pushActorBlocked(102, 8, 9, 5);
    effects.pushDurabilityChanged(103, -2);

    expect(effects.getEffectKind(0)).toBe(EffectKind.ActorMoved);
    expect(effects.getEffectActorId(0)).toBe(101);
    expect(effects.getEffectX(0)).toBe(4);
    expect(effects.getEffectY(0)).toBe(7);
    expect(effects.getEffectKind(1)).toBe(EffectKind.ActorBlocked);
    expect(effects.getEffectActorId(1)).toBe(102);
    expect(effects.getEffectX(1)).toBe(8);
    expect(effects.getEffectY(1)).toBe(9);
    expect(effects.getEffectReason(1)).toBe(5);
    expect(effects.getEffectKind(2)).toBe(EffectKind.DurabilityChanged);
    expect(effects.getEffectActorId(2)).toBe(103);
    expect(effects.getEffectDelta(2)).toBe(-2);
  });

  test("input validation matches AssemblyScript leaf behavior", () => {
    expect(validateSeed(-1)).toBe(ValidationError.InvalidSeed);
    expect(validateSeed(0)).toBe(ValidationError.None);
    expect(validateAction(ActionKind.IncrementCounter, 1)).toBe(
      ValidationError.None,
    );
    expect(validateAction(ActionKind.IncrementCounter, 2)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.EmitLog, 3)).toBe(ValidationError.None);
    expect(validateAction(ActionKind.EmitLog, 4)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.EmitTelemetry, 0)).toBe(
      ValidationError.None,
    );
    expect(validateAction(ActionKind.EmitTelemetry, -1)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.RequestExternalFact, 255)).toBe(
      ValidationError.None,
    );
    expect(validateAction(ActionKind.RequestExternalFact, 256)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.RequestSolver, 255)).toBe(
      ValidationError.None,
    );
    expect(validateAction(ActionKind.RequestSolver, -1)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.FulfillRequest, 1)).toBe(
      ValidationError.None,
    );
    expect(validateAction(ActionKind.FulfillRequest, 0)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.DeferRequest, 1)).toBe(
      ValidationError.None,
    );
    expect(validateAction(ActionKind.DeferRequest, 0)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(ActionKind.Move, 0)).toBe(ValidationError.None);
    expect(validateAction(ActionKind.Move, -1)).toBe(
      ValidationError.InvalidActionValue,
    );
    expect(validateAction(999, 0)).toBe(ValidationError.InvalidActionKind);
  });

  test("effect request state resets, sequences, and clears pending request", () => {
    const effects = createEffectState();

    effects.resetEffectState();

    expect(effects.nextRequestSequence()).toBe(1);
    expect(effects.nextRequestSequence()).toBe(2);

    effects.setPendingRequest(2);

    expect(effects.getPendingRequest()).toBe(2);

    effects.clearPendingRequest();

    expect(effects.getPendingRequest()).toBe(0);
  });

  test("createCore instances do not share leaf module state", () => {
    const first = createCore();
    const second = createCore();

    call(first.setBudget, 3, 99);

    expect(call(first.getBudget, 3)).toBe(99);
    expect(call(second.getBudget, 3)).toBe(0);
    expect(call(first.getCounter)).toBe(0);
    expect(call(second.getCounter)).toBe(0);
  });
});

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

describe("core-ts leaf module permutations", () => {
  test("budget: category boundary from -1 through MAX_BUDGET_CATEGORIES", () => {
    const core = createCore();
    // Valid categories: 0-7
    for (let i = 0; i < 8; i++) {
      call(core.setBudget, i, i * 10);
      expect(call(core.getBudget, i)).toBe(i * 10);
    }
    // Out-of-bounds: -1 and 8 return UNLIMITED_CAP (-1)
    call(core.setBudget, -1, 99);
    expect(call(core.getBudget, -1)).toBe(-1);
    call(core.setBudget, 8, 99);
    expect(call(core.getBudget, 8)).toBe(-1);
  });

  test("budget: getBudgetUsage returns 0 for out-of-bounds categories", () => {
    const core = createCore();
    expect(call(core.getBudgetUsage, -1)).toBe(0);
    expect(call(core.getBudgetUsage, 8)).toBe(0);
  });

  test("effects: invalid reads via core getters for out-of-bounds indexes", () => {
    const core = createCore();
    // No effects pushed — all getters should return 0 for index -1 and 0
    expect(call(core.getEffectKind, -1)).toBe(0);
    expect(call(core.getEffectKind, 0)).toBe(0);
    expect(call(core.getEffectCount)).toBe(0);
  });

  test("validation: boundary values for request payloads", () => {
    // RequestExternalFact at 0 is valid
    expect(validateAction(ActionKind.RequestExternalFact, 0)).toBe(
      ValidationError.None,
    );
    // Move at boundary 255
    expect(validateAction(ActionKind.Move, 255)).toBe(ValidationError.None);
  });

  test("createCore: three instances have fully independent budget state", () => {
    const a = createCore();
    const b = createCore();
    const c = createCore();

    call(a.setBudget, 0, 100);
    call(b.setBudget, 0, 200);

    expect(call(a.getBudget, 0)).toBe(100);
    expect(call(b.getBudget, 0)).toBe(200);
    // c is unset — default depends on initialization (may be 0 or UNLIMITED)
    const cDefault = call(c.getBudget, 0) as number;
    expect(cDefault).not.toBe(100);
    expect(cDefault).not.toBe(200);
  });
});
