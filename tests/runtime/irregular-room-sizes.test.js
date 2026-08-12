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

test("randomIrregularRoomDimensions orientation follows wide/tall roll", async () => {
  const { randomIrregularRoomDimensions } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  const wide = randomIrregularRoomDimensions(() => 0.1, 3, 9);
  const tall = randomIrregularRoomDimensions(() => 0.9, 3, 9);
  assert.ok(wide.width > wide.height, `expected wide room, got ${wide.width}x${wide.height}`);
  assert.ok(tall.height > tall.width, `expected tall room, got ${tall.width}x${tall.height}`);
});

test("randomIrregularRoomDimensions produces a balanced wide/tall distribution", async () => {
  const { randomIrregularRoomDimensions } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  let seed = 123;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0x100000000;
  };
  let wide = 0;
  let tall = 0;
  for (let i = 0; i < 200; i += 1) {
    const result = randomIrregularRoomDimensions(rng, 3, 9);
    if (result.width > result.height) wide += 1;
    if (result.height > result.width) tall += 1;
  }
  assert.ok(wide >= 70 && wide <= 130, `wide count ${wide} is outside expected balance`);
  assert.ok(tall >= 70 && tall <= 130, `tall count ${tall} is outside expected balance`);
});

test("preferIrregular coexists with preferLargeRooms", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  const result = generateGridLayoutFromInput({
    seed: 333,
    width: 80,
    height: 80,
    shape: {
      roomCount: 12,
      roomMinSize: 3,
      roomMaxSize: 10,
      preferIrregular: true,
      preferLargeRooms: true,
    },
  });
  assert.ok(result.ok, `generateGridLayoutFromInput failed: ${JSON.stringify(result.errors)}`);
  const rooms = result.value.rooms;
  assert.ok(rooms.some((room) => room.width * room.height >= 48), "must produce at least one large room");
  assert.ok(rooms.every((room) => {
    const longer = Math.max(room.width, room.height);
    const shorter = Math.min(room.width, room.height);
    return longer / shorter >= 1.5;
  }), "all rooms should remain irregular");
});

test("dense placement still produces mostly irregular rooms", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  const result = generateGridLayoutFromInput({
    seed: 444,
    width: 30,
    height: 30,
    shape: { roomCount: 20, roomMinSize: 3, roomMaxSize: 8 },
  });
  assert.ok(result.ok, `generateGridLayoutFromInput failed: ${JSON.stringify(result.errors)}`);
  const rooms = result.value.rooms;
  assert.equal(rooms.length, 20);
  const irregular = rooms.filter((room) => {
    const longer = Math.max(room.width, room.height);
    const shorter = Math.min(room.width, room.height);
    return longer / shorter >= 1.5;
  });
  assert.ok(irregular.length / rooms.length >= 0.8, `expected mostly irregular rooms, got ${irregular.length}/${rooms.length}`);
});

test.skip("generateGridLayout with preferIrregular explicitly disabled produces more square rooms on average", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  const result = generateGridLayoutFromInput({
    seed: 555,
    width: 30,
    height: 30,
    shape: { roomCount: 12, roomMinSize: 3, roomMaxSize: 8, preferIrregular: false },
  });
  assert.ok(result.ok);
  const irregular = result.value.rooms.filter((room) => {
    const longer = Math.max(room.width, room.height);
    const shorter = Math.min(room.width, room.height);
    return longer / shorter >= 1.5;
  });
  assert.ok(irregular.length / result.value.rooms.length < 0.5);
});
