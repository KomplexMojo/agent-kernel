import { describe, expect, test } from "vitest";

import { VitalKind } from "../../packages/core-ts/src/state/vitals.ts";

describe("core-ts vital constants parity", () => {
  test("VitalKind values match runtime domain-constants VITAL_KEYS order", async () => {
    const { VITAL_KEYS, VITAL_KIND } = await import(
      "../../packages/runtime/src/contracts/domain-constants.js"
    );

    // core-ts VitalKind keys lowercased should match VITAL_KEYS
    const coreKeys = Object.keys(VitalKind).map((k) => k.toLowerCase());
    expect(coreKeys).toEqual(Array.from(VITAL_KEYS));

    // Numeric values match by index
    for (let i = 0; i < VITAL_KEYS.length; i++) {
      const key = VITAL_KEYS[i] as string;
      expect(VITAL_KIND[key]).toBe(i);
    }

    // VitalKind values match their index
    expect(VitalKind.Health).toBe(0);
    expect(VitalKind.Mana).toBe(1);
    expect(VitalKind.Stamina).toBe(2);
    expect(VitalKind.Durability).toBe(3);
  });

  test("VitalKind has exactly 4 members", () => {
    expect(Object.keys(VitalKind).length).toBe(4);
  });
});

// ## TODO: Test Permutations
// - Verify VITAL_COUNT from domain-constants matches Object.keys(VitalKind).length
// - Verify all persona vital references (TRAP_VITAL_KEYS, DELVER_VITAL_KEYS, etc.) are subsets of VitalKind keys
// - Verify VitalKind values are contiguous starting from 0
