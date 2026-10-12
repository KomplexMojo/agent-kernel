/**
 * DS.3 — visibility is an affinity interaction, computed in core.
 *
 * Maintainer ruling (2026-10-10, superseding the 3-tile baseline of 2026-08-20):
 * levels are UNLIT. An actor that does not itself emit light sees only what is
 * adjacent. Its own emitted light extends sight; dark wears that light down
 * through the affinity field's light/dark cancellation, and where dark survives
 * at a cell, that cell cannot be seen into from beyond one tile.
 *
 * WHY THE NUMBERS ARE NOT NEW. Three constants encoding exactly this design
 * already existed in `runtime/src/contracts/domain-constants.js` —
 * `DARKNESS_OBSCURE_STACK_THRESHOLD`, `DARKNESS_OBSCURE_RADIUS`,
 * `LIGHT_SIGHT_MIN_STACK` — declared in a single commit and then read by nothing,
 * anywhere, ever. Rather than invent a parallel intensity scale beside them
 * (which is how this repo grew two affinity authorities once already), DS.3
 * CONSUMES them. They move to core-ts because that is where the mechanism lives
 * and core must never import from runtime.
 *
 * Default rooms emit dark at 2 stacks, exactly the obscure threshold. Under the
 * unlit rule that no longer shrinks an unlit actor's sight (it is already one
 * tile); it is what a light-bearer's emission has to push back against.
 *
 * DS.4 wired radius scoping into real ticks. DS6.1 extends the same core-owned
 * transform with deterministic occlusion, target concealment, and hazard
 * scoping; runtime still only supplies live core data.
 */
import { describe, expect, test } from "vitest";

import {
  BASELINE_SIGHT_RADIUS,
  resolvePoweredLightStacks,
  computeVisibleCells,
  DARKNESS_OBSCURE_RADIUS,
  DARKNESS_OBSCURE_STACK_THRESHOLD,
  LIGHT_SIGHT_BONUS_PER_STACK,
  LIGHT_SIGHT_MIN_STACK,
  resolveVisibilityRadius,
  scopeObservation,
} from "../../packages/core-ts/src/state/visibility.ts";

// ---------------------------------------------------------------------------
// The radius policy, as a pure function
// ---------------------------------------------------------------------------

describe("resolveVisibilityRadius", () => {
  test("an unlit observer sees only what is adjacent", () => {
    expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks: 0 })).toBe(BASELINE_SIGHT_RADIUS);
    expect(BASELINE_SIGHT_RADIUS).toBe(1);
  });

  test("dark at or above the obscure threshold collapses sight to the obscured radius", () => {
    expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks: DARKNESS_OBSCURE_STACK_THRESHOLD }))
      .toBe(DARKNESS_OBSCURE_RADIUS);
    expect(resolveVisibilityRadius({ lightStacks: 3, darkStacks: 9 }))
      .toBe(DARKNESS_OBSCURE_RADIUS);
  });

  test("dark BELOW the threshold has no effect — the threshold is the rule, not a slope", () => {
    expect(resolveVisibilityRadius({ lightStacks: 2, darkStacks: DARKNESS_OBSCURE_STACK_THRESHOLD - 1 }))
      .toBe(BASELINE_SIGHT_RADIUS + 2 * LIGHT_SIGHT_BONUS_PER_STACK);
  });

  test("light extends sight, one tile per stack, from the minimum stack up", () => {
    expect(resolveVisibilityRadius({ lightStacks: LIGHT_SIGHT_MIN_STACK, darkStacks: 0 }))
      .toBe(BASELINE_SIGHT_RADIUS + LIGHT_SIGHT_BONUS_PER_STACK);
    expect(resolveVisibilityRadius({ lightStacks: 3, darkStacks: 0 }))
      .toBe(BASELINE_SIGHT_RADIUS + 3 * LIGHT_SIGHT_BONUS_PER_STACK);
  });

  test("sight never drops below one tile — an actor always perceives what is adjacent", () => {
    // The floor clamp, ruled 2026-08-20 and kept on 2026-10-10. A radius of 0
    // would leave an actor unable to see an adjacent attacker, collapsing every
    // hostile-dependent proposal to wait.
    for (const darkStacks of [2, 5, 50]) {
      expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks })).toBeGreaterThanOrEqual(1);
    }
    expect(resolveVisibilityRadius({ lightStacks: -5, darkStacks: -5 })).toBeGreaterThanOrEqual(1);
  });

  test("garbage inputs fall back to the baseline rather than producing a nonsense radius", () => {
    expect(resolveVisibilityRadius({} as never)).toBe(BASELINE_SIGHT_RADIUS);
    expect(resolveVisibilityRadius(undefined as never)).toBe(BASELINE_SIGHT_RADIUS);
  });
});

// ---------------------------------------------------------------------------
// The scoping transform
// ---------------------------------------------------------------------------

describe("scopeObservation", () => {
  const observation = Object.freeze({
    actors: [
      { id: "self", position: { x: 5, y: 5 } },
      { id: "adjacent", position: { x: 6, y: 5 } },
      { id: "edge_of_sight", position: { x: 8, y: 5 } },
      { id: "just_beyond", position: { x: 9, y: 5 } },
      { id: "far_away", position: { x: 20, y: 5 } },
    ],
  });

  test("actors beyond the radius are removed; actors within it survive", () => {
    const scoped = scopeObservation(observation, "self", 3);
    const ids = scoped.actors.map((actor: { id: string }) => actor.id);

    expect(ids).toContain("adjacent");
    expect(ids).toContain("edge_of_sight");
    expect(ids).not.toContain("just_beyond");
    expect(ids).not.toContain("far_away");
  });

  test("the observer always perceives itself, at any radius", () => {
    const scoped = scopeObservation(observation, "self", 1);
    const ids = scoped.actors.map((actor: { id: string }) => actor.id);
    expect(ids).toContain("self");
  });

  test("distance is Chebyshev — 3 in EACH direction is a square, not a circle", () => {
    const diagonal = {
      actors: [
        { id: "self", position: { x: 5, y: 5 } },
        // Chebyshev distance 3 (a corner of the 7x7 square). Euclidean would be
        // ~4.24 and would wrongly drop this actor.
        { id: "corner", position: { x: 8, y: 8 } },
      ],
    };
    const ids = scopeObservation(diagonal, "self", 3).actors.map((a: { id: string }) => a.id);
    expect(ids).toContain("corner");
  });

  test("the input observation is not mutated — scoping is a pure transform", () => {
    const before = observation.actors.length;
    scopeObservation(observation, "self", 1);
    expect(observation.actors.length).toBe(before);
  });

  test("an unknown observer id scopes nothing away rather than blanking the board", () => {
    // Refusing to guess: if the observer cannot be located, returning an empty
    // actor list would silently blind an actor, which is far worse than a no-op.
    const scoped = scopeObservation(observation, "nobody", 1);
    expect(scoped.actors.length).toBe(observation.actors.length);
  });

  test("scopeObservation omits a hazards collection even when one is injected", () => {
    const scoped = scopeObservation({
      actors: [
        { id: "self", position: { x: 1, y: 1 } },
        { id: "near", position: { x: 2, y: 1 } },
      ],
      hazards: [{ id: "hz", position: { x: 2, y: 1 } }],
    }, "self", 3);
    expect(scoped.actors.map((entry) => entry.id)).toEqual(["self", "near"]);
    expect(Object.hasOwn(scoped, "hazards")).toBe(false);
  });

  test("the wall-or-barrier observation kind blocks actors and hazards behind it", () => {
    const observationWithBarrier = {
      actors: [
        { id: "self", position: { x: 1, y: 2 } },
        { id: "hidden", position: { x: 3, y: 2 } },
      ],
      hazards: [{ id: "hidden_hazard", position: { x: 4, y: 2 } }],
      tiles: {
        kinds: [
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0],
          [0, 0, 1, 0, 0],
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0],
        ],
      },
    };

    const scoped = scopeObservation(observationWithBarrier, "self", 4);
    expect(scoped.actors.map((entry) => entry.id)).toEqual(["self"]);
    expect(Object.hasOwn(scoped, "hazards")).toBe(false);
  });

  test("unobstructed cardinal and diagonal rays retain their targets", () => {
    const observation = {
      actors: [
        { id: "self", position: { x: 1, y: 1 } },
        { id: "cardinal", position: { x: 3, y: 1 } },
        { id: "diagonal", position: { x: 3, y: 3 } },
      ],
      tiles: { kinds: Array.from({ length: 5 }, () => Array(5).fill(0)) },
    };

    expect(scopeObservation(observation, "self", 3).actors.map((entry) => entry.id))
      .toEqual(["self", "cardinal", "diagonal"]);
  });

  test("a diagonal ray cannot peek through the corner between opaque cells", () => {
    const observation = {
      actors: [
        { id: "self", position: { x: 1, y: 1 } },
        { id: "diagonal", position: { x: 2, y: 2 } },
      ],
      tiles: {
        kinds: [
          [0, 0, 0, 0],
          [0, 0, 1, 0],
          [0, 1, 0, 0],
          [0, 0, 0, 0],
        ],
      },
    };

    const ids = scopeObservation(observation, "self", 3).actors.map((entry) => entry.id);
    expect(ids).toEqual(["self"]);
  });

  test("surviving dark at the target conceals it beyond one tile", () => {
    const observation = {
      actors: [
        { id: "self", position: { x: 1, y: 1 } },
        { id: "adjacent_dark", position: { x: 2, y: 1 } },
        { id: "distant_dark", position: { x: 3, y: 1 } },
      ],
      hazards: [{ id: "distant_hazard", position: { x: 3, y: 2 } }],
      tiles: { kinds: Array.from({ length: 5 }, () => Array(5).fill(0)) },
    };

    const scoped = scopeObservation(observation, "self", 4, {
      darkStacksByCell: { "2,1": 2, "3,1": 2, "3,2": 2 },
    });

    expect(scoped.actors.map((entry) => entry.id)).toEqual(["self", "adjacent_dark"]);
    expect(Object.hasOwn(scoped, "hazards")).toBe(false);
  });

  test("field cells use radius and line of sight but are not hidden by target darkness", () => {
    const observation = {
      actors: [
        { id: "self", position: { x: 1, y: 1 } },
        { id: "concealed_source", position: { x: 3, y: 1 } },
      ],
      affinityFields: [
        { position: { x: 3, y: 1 }, kind: 10, expression: 3, stacks: 2 },
        { position: { x: 4, y: 1 }, kind: 1, expression: 3, stacks: 1 },
      ],
      tiles: { kinds: Array.from({ length: 5 }, () => Array(5).fill(0)) },
    };

    const scoped = scopeObservation(observation, "self", 3, {
      darkStacksByCell: { "3,1": 2 },
    });

    expect(scoped.actors.map((entry) => entry.id)).toEqual(["self"]);
    expect(scoped.affinityFields).toEqual([
      { position: { x: 3, y: 1 }, kind: 10, expression: 3, stacks: 2 },
      { position: { x: 4, y: 1 }, kind: 1, expression: 3, stacks: 1 },
    ]);
  });

  test("field cells behind an opaque tile are scoped away", () => {
    const observation = {
      actors: [{ id: "self", position: { x: 1, y: 2 } }],
      affinityFields: [{ position: { x: 3, y: 2 }, kind: 1, expression: 3, stacks: 1 }],
      tiles: {
        kinds: [
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0],
          [0, 0, 1, 0, 0],
          [0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0],
        ],
      },
    };

    expect(scopeObservation(observation, "self", 4).affinityFields).toEqual([]);
  });

  test("missing tile geometry preserves the existing radius-only behavior", () => {
    const observation = {
      actors: [
        { id: "self", position: { x: 1, y: 1 } },
        { id: "nearby", position: { x: 3, y: 1 } },
      ],
    };

    expect(scopeObservation(observation, "self", 3).actors.map((entry) => entry.id))
      .toEqual(["self", "nearby"]);
  });
});

// ---------------------------------------------------------------------------
// The per-tile visible set: what the player's map shows
// ---------------------------------------------------------------------------

describe("computeVisibleCells", () => {
  const open5 = () => Array.from({ length: 5 }, () => Array(5).fill(0));

  function visibleKeys(grid: number[][]): string[] {
    const keys: string[] = [];
    grid.forEach((row, y) => row.forEach((cell, x) => { if (cell) keys.push(`${x},${y}`); }));
    return keys;
  }

  test("an unlit observer sees its own tile and the eight around it", () => {
    const grid = computeVisibleCells(open5(), { x: 2, y: 2 }, 1);
    expect(visibleKeys(grid)).toHaveLength(9);
    expect(grid[2][2]).toBe(1);
    expect(grid[0][0]).toBe(0);
  });

  test("the grid matches the tile grid's shape", () => {
    const grid = computeVisibleCells(open5(), { x: 0, y: 0 }, 1);
    expect(grid).toHaveLength(5);
    expect(grid.every((row) => row.length === 5)).toBe(true);
  });

  test("a wall is visible but what is behind it is not", () => {
    const kinds = open5();
    kinds[2][3] = 1;
    const grid = computeVisibleCells(kinds, { x: 1, y: 2 }, 4);
    expect(grid[2][3]).toBe(1);
    expect(grid[2][4]).toBe(0);
  });

  test("surviving dark hides a cell beyond one tile but not an adjacent one", () => {
    const grid = computeVisibleCells(open5(), { x: 0, y: 2 }, 4, {
      darkStacksByCell: { "1,2": DARKNESS_OBSCURE_STACK_THRESHOLD, "3,2": DARKNESS_OBSCURE_STACK_THRESHOLD },
    });
    expect(grid[2][1]).toBe(1);
    expect(grid[2][3]).toBe(0);
    expect(grid[2][4]).toBe(1);
  });

  test("an observer outside the grid sees nothing rather than throwing", () => {
    const grid = computeVisibleCells(open5(), { x: 9, y: 9 }, 2);
    expect(visibleKeys(grid)).toEqual([]);
  });

  test("malformed geometry yields an empty grid", () => {
    expect(computeVisibleCells([] as never, { x: 0, y: 0 }, 1)).toEqual([]);
    expect(computeVisibleCells([[0, 0], [0]] as never, { x: 0, y: 0 }, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lit cells: light that hazards (or anyone) emit lets the observer see into it
// ---------------------------------------------------------------------------

describe("lit cells", () => {
  const open = (w: number, h: number) => Array.from({ length: h }, () => Array(w).fill(0));

  test("a lit cell beyond the observer's radius is visible when in line of sight", () => {
    const grid = computeVisibleCells(open(9, 3), { x: 0, y: 1 }, 1, { lightByCell: { "6,1": 2 } });
    expect(grid[1][6]).toBe(1);
    expect(grid[1][5]).toBe(0);
  });

  test("a lit cell behind a wall stays hidden", () => {
    const kinds = open(9, 3);
    kinds[1][3] = 1;
    const grid = computeVisibleCells(kinds, { x: 0, y: 1 }, 1, { lightByCell: { "6,1": 2 } });
    expect(grid[1][6]).toBe(0);
  });

  test("dark at the obscure threshold puts a lit cell out", () => {
    const grid = computeVisibleCells(open(9, 3), { x: 0, y: 1 }, 1, {
      lightByCell: { "6,1": 2 },
      darkStacksByCell: { "6,1": DARKNESS_OBSCURE_STACK_THRESHOLD },
    });
    expect(grid[1][6]).toBe(0);
  });

  test("an actor or hazard standing in a lit cell is perceived from afar", () => {
    const observation = {
      actors: [
        { id: "self", position: { x: 0, y: 1 } },
        { id: "lit", position: { x: 6, y: 1 } },
        { id: "dark", position: { x: 7, y: 1 } },
        // A hazard is an actor in the unified model.
        { id: "lamp", position: { x: 6, y: 2 } },
      ],
      tiles: { kinds: open(9, 3) },
    };
    const scoped = scopeObservation(observation, "self", 1, { lightByCell: { "6,1": 2, "6,2": 2 } });
    expect(scoped.actors.map((entry: { id: string }) => entry.id)).toEqual(["self", "lit", "lamp"]);
  });
});

describe("resolvePoweredLightStacks", () => {
  test("a full pool powers every stack; part of a pool powers its share, rounded up", () => {
    expect(resolvePoweredLightStacks(4, 10, 10)).toBe(4);
    expect(resolvePoweredLightStacks(4, 5, 10)).toBe(2);
    expect(resolvePoweredLightStacks(4, 1, 10)).toBe(1);
  });

  test("no mana, or no pool at all, powers nothing", () => {
    expect(resolvePoweredLightStacks(4, 0, 10)).toBe(0);
    expect(resolvePoweredLightStacks(4, 5, 0)).toBe(0);
  });

  test("mana above the max never powers more than the stacks", () => {
    expect(resolvePoweredLightStacks(3, 50, 10)).toBe(3);
  });
});

// ## TODO: Test Permutations
//
// - a cell at the EDGE of a dark aura versus its origin (documents that the
//   stack-threshold rule is deliberately distance-insensitive, unlike intensity)
// - every affinity kind that is neither light nor dark: no effect on sight at all
// - an observer with no position field: scopes nothing, does not throw
// - radius exactly equal to the distance (boundary inclusion, both axes)
// - a ray ending on an opaque tile: the endpoint remains visible while cells
//   behind it do not
// - malformed/ragged tile geometry: falls back to radius-only instead of throwing
