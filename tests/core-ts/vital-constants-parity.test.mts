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

describe("core-ts vital constants permutations", () => {
  test("VITAL_COUNT from domain-constants matches VitalKind member count", async () => {
    const { VITAL_COUNT } = await import(
      "../../packages/runtime/src/contracts/domain-constants.js"
    );
    expect(VITAL_COUNT).toBe(Object.keys(VitalKind).length);
  });

  test("all persona vital references are subsets of VitalKind keys", async () => {
    const {
      VITAL_KEYS,
      TRAP_VITAL_KEYS,
      DELVER_VITAL_KEYS,
      WARDEN_VITAL_KEYS,
      RESOURCE_VITAL_KEYS,
    } = await import("../../packages/runtime/src/contracts/domain-constants.js");

    const coreKeys = new Set(
      Object.keys(VitalKind).map((k) => k.toLowerCase()),
    );

    for (const subset of [
      TRAP_VITAL_KEYS,
      DELVER_VITAL_KEYS,
      WARDEN_VITAL_KEYS,
      RESOURCE_VITAL_KEYS,
    ]) {
      for (const key of subset) {
        expect(coreKeys.has(key)).toBe(true);
      }
    }
  });

  test("VitalKind values are contiguous starting from 0", () => {
    const values = Object.values(VitalKind).sort((a, b) => a - b);
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBe(i);
    }
  });
});
