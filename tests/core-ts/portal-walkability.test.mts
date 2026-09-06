/**
 * Spawn and Exit are wall portals: non-walkable markers off the playing surface.
 */
import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";

type Core = ReturnType<typeof createCore>;

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") throw new Error("expected callable core export");
  return fn(...args);
}

describe("core-ts portal walkability", () => {
  test("spawn and exit tiles are not walkable; adjacent floor is", () => {
    const core: Core = createCore();
    call(core.configureGrid, 5, 3);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++) call(core.setTileAt, x, y, 1);
    }
    call(core.setTileAt, 0, 1, 2); // Spawn portal
    call(core.setTileAt, 4, 1, 3); // Exit portal

    expect(call(core.isWalkablePosition, 0, 1)).toBe(false);
    expect(call(core.isWalkablePosition, 4, 1)).toBe(false);
    expect(call(core.isWalkablePosition, 1, 1)).toBe(true);
    expect(call(core.isWalkablePosition, 3, 1)).toBe(true);
  });

  test("loadMvpScenario seats the actor on the spawn approach, not the portal", () => {
    const core: Core = createCore();
    call(core.loadMvpScenario);
    expect(call(core.renderBaseCellChar, 0, 1)).toBe(83); // S on wall
    expect(call(core.getActorX)).toBe(1);
    expect(call(core.getActorY)).toBe(1);
    expect(call(core.isWalkablePosition, 0, 1)).toBe(false);
    expect(call(core.isWalkablePosition, 1, 1)).toBe(true);
  });
});
