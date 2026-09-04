/**
 * Stage A / A.2 — exposure is resolved AGAINST THE OBSERVER, and can move between vitals.
 *
 * Before Stage A, exposure was a property of the tile alone: `getAffinityVitalEffect`
 * takes no observer, so every actor standing on a tile read the same danger number and an
 * actor's own element was exactly as lethal to it as anyone else's.
 *
 * A.2 changed the return type to a SET OF VITAL DELTAS. The interaction matrix contains
 * genuine cross-vital outcomes -- a draw-expression actor converts a same-kind field into
 * mana instead of taking harm -- and a single number for a single vital could only have
 * flipped the sign on the harmed vital, which is a different rule wearing the right name.
 *
 * THE RELATIONSHIP RULE IS DERIVED, NOT INVENTED: same and opposite come from the 48-cell
 * matrix, which F10M made a pure derivation. NEUTRAL deliberately does not consult it --
 * the matrix answers what happens when two affinities MEET, correctly `None` for unrelated
 * kinds, but exposure is not interaction and a corrode field still corrodes a stranger.
 * Reading it literally there would make every unrelated field harmless.
 */
import { describe, expect, test } from "vitest";
import {
  AffinityExpression,
  AffinityKind,
  getAffinityVitalEffect,
  getAffinityTargetVital,
  getOppositeAffinityKind,
} from "../../packages/core-ts/src/state/affinity.ts";
import { resolveExposureVitalDeltas } from "../../packages/core-ts/src/state/affinity-spatial.ts";
import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

const ALL_KINDS = Object.values(AffinityKind) as number[];
const ALL_EXPRESSIONS = Object.values(AffinityExpression) as number[];

type Delta = { vital: number; effect: number };

const effectOn = (vital: number, deltas: Delta[]) =>
  deltas.filter((delta) => delta.vital === vital).reduce((sum, delta) => sum + delta.effect, 0);

const baseline = (kind: number, expression: number, vital: number, stacks: number) =>
  getAffinityVitalEffect(kind, expression, vital, stacks);

function exposure(args: {
  fieldKind: number; fieldExpression: number; observerKind: number;
  observerExpression: number; vital: number; stacks?: number;
}): Delta[] {
  const stacks = args.stacks ?? 3;
  return resolveExposureVitalDeltas({
    baseEffect: baseline(args.fieldKind, args.fieldExpression, args.vital, stacks),
    vital: args.vital,
    fieldKind: args.fieldKind,
    fieldExpression: args.fieldExpression,
    observerKind: args.observerKind,
    observerExpression: args.observerExpression,
  });
}

describe("exposure is resolved against the observer", () => {
  test("an actor takes no harm from its OWN affinity, for every kind", () => {
    for (const fieldKind of ALL_KINDS) {
      const vital = getAffinityTargetVital(fieldKind);
      for (const fieldExpression of ALL_EXPRESSIONS) {
        if (baseline(fieldKind, fieldExpression, vital, 3) >= 0) continue;
        const deltas = exposure({
          fieldKind, fieldExpression, observerKind: fieldKind,
          observerExpression: AffinityExpression.Emit, vital,
        });
        expect(effectOn(vital, deltas), `kind ${fieldKind}/${fieldExpression} harmed its own`)
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
        const expected = baseline(fieldKind, AffinityExpression.Emit, vital, 3);
        const deltas = exposure({
          fieldKind, fieldExpression: AffinityExpression.Emit,
          observerKind, observerExpression: AffinityExpression.Emit, vital,
        });
        expect(effectOn(vital, deltas), `neutral ${fieldKind}/${observerKind} must be unchanged`)
          .toBe(expected);
      }
    }
  });

  test("an OPPOSITE field is never safer than an unrelated one", () => {
    for (const fieldKind of ALL_KINDS) {
      const vital = getAffinityTargetVital(fieldKind);
      const expected = baseline(fieldKind, AffinityExpression.Emit, vital, 3);
      if (expected >= 0) continue;
      const deltas = exposure({
        fieldKind, fieldExpression: AffinityExpression.Emit,
        observerKind: getOppositeAffinityKind(fieldKind),
        observerExpression: AffinityExpression.Emit, vital,
      });
      expect(effectOn(vital, deltas)).toBeLessThanOrEqual(expected);
    }
  });

  test("no observer affinity behaves exactly as today", () => {
    const vital = getAffinityTargetVital(AffinityKind.Corrode);
    const expected = baseline(AffinityKind.Corrode, AffinityExpression.Emit, vital, 2);
    const deltas = resolveExposureVitalDeltas({
      baseEffect: expected, vital,
      fieldKind: AffinityKind.Corrode, fieldExpression: AffinityExpression.Emit,
      observerKind: 0, observerExpression: 0,
    });
    expect(effectOn(vital, deltas)).toBe(expected);
  });
});

describe("A.2 — a DRAW expression converts its own element into mana", () => {
  test("a draw observer in a same-kind EMIT field gains mana instead of losing the vital", () => {
    for (const fieldKind of ALL_KINDS) {
      const vital = getAffinityTargetVital(fieldKind);
      const harm = baseline(fieldKind, AffinityExpression.Emit, vital, 3);
      if (harm >= 0) continue;
      const deltas = exposure({
        fieldKind, fieldExpression: AffinityExpression.Emit,
        observerKind: fieldKind, observerExpression: AffinityExpression.Draw, vital,
      });
      if (vital === VitalKind.Mana) {
        // Light and Dark already target mana, so there is no separate vital to spare --
        // the conversion lands on the same one and simply reverses its sign. Asserting a
        // zero here would have been asserting that the rule does nothing for two of the
        // ten kinds.
        expect(effectOn(VitalKind.Mana, deltas), `${fieldKind}: mana-targeting field converts in place`)
          .toBe(Math.abs(harm));
        continue;
      }
      expect(effectOn(vital, deltas), `${fieldKind}: the harmed vital must be spared`).toBe(0);
      expect(effectOn(VitalKind.Mana, deltas), `${fieldKind}: mana gained at the same magnitude`)
        .toBe(Math.abs(harm));
    }
  });

  test("a draw observer also converts a same-kind PUSH — the 2026-09-04 ruling", () => {
    const vital = getAffinityTargetVital(AffinityKind.Fire);
    const harm = baseline(AffinityKind.Fire, AffinityExpression.Push, vital, 3);
    const deltas = exposure({
      fieldKind: AffinityKind.Fire, fieldExpression: AffinityExpression.Push,
      observerKind: AffinityKind.Fire, observerExpression: AffinityExpression.Draw, vital,
    });
    expect(effectOn(vital, deltas)).toBe(0);
    expect(effectOn(VitalKind.Mana, deltas)).toBe(Math.abs(harm));
  });

  test("a draw observer in a same-kind PULL field loses mana", () => {
    const vital = getAffinityTargetVital(AffinityKind.Fire);
    const harm = baseline(AffinityKind.Fire, AffinityExpression.Pull, vital, 3);
    const deltas = exposure({
      fieldKind: AffinityKind.Fire, fieldExpression: AffinityExpression.Pull,
      observerKind: AffinityKind.Fire, observerExpression: AffinityExpression.Draw, vital,
    });
    expect(effectOn(VitalKind.Mana, deltas)).toBe(-Math.abs(harm));
  });

  test("conversion needs the SAME kind: a draw observer gains nothing from a stranger", () => {
    const vital = getAffinityTargetVital(AffinityKind.Corrode);
    const expected = baseline(AffinityKind.Corrode, AffinityExpression.Emit, vital, 3);
    const deltas = exposure({
      fieldKind: AffinityKind.Corrode, fieldExpression: AffinityExpression.Emit,
      observerKind: AffinityKind.Fire, observerExpression: AffinityExpression.Draw, vital,
    });
    expect(effectOn(VitalKind.Mana, deltas)).toBe(0);
    expect(effectOn(vital, deltas)).toBe(expected);
  });
});

// ## TODO: Test Permutations
// - a beneficial same-kind field must not become a mana PENALTY through the abs() path
// - an observer holding two grants of different kinds against one field
