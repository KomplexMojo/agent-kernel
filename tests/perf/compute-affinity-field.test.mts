import { performance } from "node:perf_hooks";
import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

function setAllFloors(core: ReturnType<typeof createCore>, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      call(core.setTileAt, x, y, 1);
    }
  }
}

describe("computeAffinityField performance smoke", () => {
  test("projects mixed actor and hazard fields within a local smoke budget", () => {
    const core = createCore();
    call(core.configureGrid, 32, 32);
    setAllFloors(core, 32, 32);

    call(core.clearActorPlacements);
    for (let i = 0; i < 8; i += 1) {
      call(core.addActorPlacement, i + 1, 3 + i * 3, 8 + (i % 4) * 3);
    }
    call(core.applyActorPlacements);
    for (let i = 0; i < 8; i += 1) {
      call(core.setMotivatedActorAffinity, i, (i % 10) + 1, 3, (i % 3) + 1);
      call(core.armStaticHazardAt, 2 + i * 3, 20 + (i % 3), ((i + 4) % 10) + 1, 3, 1, 5);
    }

    const start = performance.now();
    const projected = call(core.computeAffinityField);
    const elapsed = performance.now() - start;

    expect(projected).toBe(16);
    expect(elapsed).toBeLessThan(25);
  });
});
