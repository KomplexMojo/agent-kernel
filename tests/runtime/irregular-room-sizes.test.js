/**
 * M6 — Irregular room sizes (C-05)
 *
 * Verifies that:
 * - randomIrregularRoomDimensions always produces an aspect ratio >= 1.5
 * - The function respects min/max bounds
 * - generateGridLayout produces rooms that are predominantly non-square
 *   (majority have aspect ratio >= 1.5 with preferIrregular on by default)
 */

const assert = require("node:assert/strict");

test("randomIrregularRoomDimensions returns { width, height } with aspect ratio >= 1.5", async () => {
  const { randomIrregularRoomDimensions } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  // Use a simple seeded-like rng (deterministic sequence)
  let seed = 42;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0x100000000;
  };

  for (let i = 0; i < 50; i += 1) {
    const { width, height } = randomIrregularRoomDimensions(rng, 3, 9);
    const longer = Math.max(width, height);
    const shorter = Math.min(width, height);
    assert.ok(
      longer / shorter >= 1.5,
      `Expected aspect ratio >= 1.5 but got ${longer}x${shorter} (ratio ${(longer / shorter).toFixed(2)}) on iteration ${i}`,
    );
  }
});

test("randomIrregularRoomDimensions keeps dimensions within [min, max]", async () => {
  const { randomIrregularRoomDimensions } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  let seed = 7;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0x100000000;
  };

  for (let i = 0; i < 50; i += 1) {
    const { width, height } = randomIrregularRoomDimensions(rng, 3, 9);
    assert.ok(width >= 3 && width <= 9, `width ${width} out of [3,9]`);
    assert.ok(height >= 3 && height <= 9, `height ${height} out of [3,9]`);
  }
});

test("randomIrregularRoomDimensions works when min and max leave little room for aspect ratio", async () => {
  const { randomIrregularRoomDimensions } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  let seed = 99;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0x100000000;
  };
  // min=3, max=4 — very tight range; function must not throw and still produce valid dimensions
  for (let i = 0; i < 20; i += 1) {
    const result = randomIrregularRoomDimensions(rng, 3, 4);
    assert.ok(typeof result.width === "number" && typeof result.height === "number", "must return { width, height }");
    assert.ok(result.width >= 3 && result.width <= 4, `width out of range: ${result.width}`);
    assert.ok(result.height >= 3 && result.height <= 4, `height out of range: ${result.height}`);
  }
});

test("generateGridLayoutFromInput produces mostly non-square rooms by default (preferIrregular)", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );

  const result = generateGridLayoutFromInput({
    seed: 12345,
    width: 60,
    height: 60,
    shape: { roomCount: 12, roomMinSize: 3, roomMaxSize: 10 },
  });

  assert.ok(result.ok, `generateGridLayoutFromInput failed: ${JSON.stringify(result.errors)}`);
  const rooms = result.value?.rooms ?? [];
  assert.ok(rooms.length > 0, "layout must produce rooms");

  const irregular = rooms.filter((r) => {
    const longer = Math.max(r.width, r.height);
    const shorter = Math.min(r.width, r.height);
    return longer / shorter >= 1.5;
  });

  // At least 60% of rooms should be irregular (aspect ratio >= 1.5)
  const ratio = irregular.length / rooms.length;
  assert.ok(
    ratio >= 0.6,
    `Expected >= 60% irregular rooms but only ${irregular.length}/${rooms.length} (${(ratio * 100).toFixed(0)}%) qualify`,
  );
});

/*
## TODO: Test Permutations
- randomIrregularRoomDimensions orientation: when wide, width > height; when tall, height > width
- randomIrregularRoomDimensions distribution: roughly equal wide/tall across many calls (not biased)
- generateGridLayout with preferIrregular: explicitly disabled produces more square rooms on average
- preferIrregular coexists with preferLargeRooms: large irregular rooms are produced
- placeRooms fallback path also uses preferIrregular when set
*/
