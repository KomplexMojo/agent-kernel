/**
 * Stage A — exposure harm is resolved AGAINST THE OBSERVER, not per-tile.
 *
 * Before this, `readAffinityFields` computed a tile's vital effects from the field
 * alone -- `getAffinityVitalEffect(kind, expression, vital, stacks)` takes no observer
 * -- so every actor standing on a tile read the identical danger number. A fire actor
 * and a corrode actor saw a fire field the same way, and there was no way to express
 * "this element is mine, it does not harm me."
 *
 * THE RULE IS DERIVED, NOT INVENTED. Same and opposite relationships are already
 * defined by the 48-cell interaction matrix (`deriveAffinityInteractionCell`), which
 * F10M made a pure derivation from stated rules. This composes that with the field's
 * own magnitude rather than authoring a second table -- two authorities for one concept
 * is the F10 defect this codebase has already paid for once.
 *
 * NEUTRAL IS THE SUBTLE CASE and is deliberately NOT taken from the matrix. The matrix
 * answers "what happens when these two affinities MEET", and for unrelated kinds that
 * is correctly `None` -- they do not interact. But exposure is not interaction: a
 * corrode field still corrodes an actor who has no relationship to it. Reading the
 * matrix literally here would have made every unrelated field harmless, which is a far
 * larger regression than the bug being fixed. Neutral therefore keeps today's exposure
 * exactly, and that is what these tests pin.
 */
import { describe, expect, test } from "vitest";
import {
  AffinityExpression,
  AffinityKind,
  getAffinityVitalEffect,
  getOppositeAffinityKind,
  getAffinityTargetVital,
} from "../../packages/core-ts/src/state/affinity.ts";
import { resolveExposureVitalEffect } from "../../packages/core-ts/src/state/affinity-spatial.ts";

const ALL_KINDS = Object.values(AffinityKind) as number[];
const ALL_EXPRESSIONS = Object.values(AffinityExpression) as number[];

/** Exposure with no observer affinity at all: the pre-existing per-tile number. */
function baselineEffect(kind: number, expression: number, vital: number, stacks: number) {
  return getAffinityVitalEffect(kind, expression, vital, stacks);
}

describe("exposure is resolved against the observer", () => {
  test("an actor is immune to harm from its OWN affinity, for every kind", () => {
    for (const kind of ALL_KINDS) {
      const vital = getAffinityTargetVital(kind);
      for (const fieldExpression of ALL_EXPRESSIONS) {
        const baseline = baselineEffect(kind, fieldExpression, vital, 3);
        if (baseline >= 0) continue; // only harmful fields are in scope for immunity
        const perceived = resolveExposureVitalEffect({
          baseEffect: baseline,
          fieldKind: kind,
          fieldExpression,
          observerKind: kind,
          observerExpression: AffinityExpression.Emit,
        });
        expect(perceived, `kind ${kind} expression ${fieldExpression} should not harm its own`)
          .toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("an UNRELATED field harms exactly as much as it does today, for every pair", () => {
    for (const fieldKind of ALL_KINDS) {
      const vital = getAffinityTargetVital(fieldKind);
      for (const observerKind of ALL_KINDS) {
        if (observerKind === fieldKind) continue;
        if (getOppositeAffinityKind(fieldKind) === observerKind) continue;
        const baseline = baselineEffect(fieldKind, AffinityExpression.Emit, vital, 3);
        const perceived = resolveExposureVitalEffect({
          baseEffect: baseline,
          fieldKind,
          fieldExpression: AffinityExpression.Emit,
          observerKind,
          observerExpression: AffinityExpression.Emit,
        });
        expect(perceived, `neutral pair ${fieldKind}/${observerKind} must be unchanged`)
          .toBe(baseline);
      }
    }
  });

  test("an OPPOSITE field harms at least as much as an unrelated one", () => {
    for (const fieldKind of ALL_KINDS) {
      const vital = getAffinityTargetVital(fieldKind);
      const opposite = getOppositeAffinityKind(fieldKind);
      const baseline = baselineEffect(fieldKind, AffinityExpression.Emit, vital, 3);
      if (baseline >= 0) continue;
      const perceived = resolveExposureVitalEffect({
        baseEffect: baseline,
        fieldKind,
        fieldExpression: AffinityExpression.Emit,
        observerKind: opposite,
        observerExpression: AffinityExpression.Emit,
      });
      expect(perceived, `opposite of ${fieldKind} should not be safer than a stranger`)
        .toBeLessThanOrEqual(baseline);
    }
  });

  test("no observer affinity behaves exactly as today", () => {
    const vital = getAffinityTargetVital(AffinityKind.Corrode);
    expect(resolveExposureVitalEffect({
      baseEffect: baselineEffect(AffinityKind.Corrode, AffinityExpression.Emit, vital, 2),
      fieldKind: AffinityKind.Corrode,
      fieldExpression: AffinityExpression.Emit,
      observerKind: 0,
      observerExpression: 0,
    })).toBe(baselineEffect(AffinityKind.Corrode, AffinityExpression.Emit, vital, 2));
  });

  test("the worked example: a fire actor ignores fire and still fears corrode", () => {
    const fireVital = getAffinityTargetVital(AffinityKind.Fire);
    const corrodeVital = getAffinityTargetVital(AffinityKind.Corrode);
    const observer = { observerKind: AffinityKind.Fire, observerExpression: AffinityExpression.Emit };

    const inFire = resolveExposureVitalEffect({
      baseEffect: baselineEffect(AffinityKind.Fire, AffinityExpression.Emit, fireVital, 3),
      fieldKind: AffinityKind.Fire, fieldExpression: AffinityExpression.Emit, ...observer,
    });
    const inCorrode = resolveExposureVitalEffect({
      baseEffect: baselineEffect(AffinityKind.Corrode, AffinityExpression.Emit, corrodeVital, 3),
      fieldKind: AffinityKind.Corrode, fieldExpression: AffinityExpression.Emit, ...observer,
    });

    expect(inFire).toBeGreaterThanOrEqual(0);
    expect(inCorrode).toBe(baselineEffect(AffinityKind.Corrode, AffinityExpression.Emit, corrodeVital, 3));
    expect(inCorrode).toBeLessThan(0);
  });
});

// ## TODO: Test Permutations
// - Stage A.2: a draw-expression observer in a same-kind emit field converts to mana
// - Stage A.2: push into draw must also yield mana (maintainer ruling 2026-09-04, reverses the current matrix cell)
// - observer stacks of zero must read as "no affinity", not as same-kind immunity
// - invalid kind or expression codes fall back to the unmodified field effect
// - a vital the field does not target is unaffected regardless of relationship
// - amplification is monotonic in field stacks
