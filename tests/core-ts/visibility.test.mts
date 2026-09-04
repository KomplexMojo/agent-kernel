/**
 * DS.3 — visibility is an affinity interaction, computed in core.
 *
 * Maintainer ruling (2026-08-20): an actor with no affinities, in a room with no
 * hazards, sees 3 tiles in each direction. Affinity interactions determine
 * visibility at runtime — emitted dark reduces sight, emitted light extends it.
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
 * ⚠️ **A deliberate, accepted gameplay consequence.** Default rooms emit dark at
 * 2 stacks, and the obscure threshold is 2 — so a default room obscures sight to
 * a single tile out of the box. That was surfaced before the rule was chosen and
 * accepted; the test at the bottom of this file pins it so it stays visible
 * rather than being rediscovered as a bug.
 *
 * DS.4 wired radius scoping into real ticks. DS6.1 extends the same core-owned
 * transform with deterministic occlusion, target concealment, and hazard
 * scoping; runtime still only supplies live core data.
 */
import { describe, expect, test } from "vitest";

import { createCore } from "../../packages/core-ts/src/index.ts";
import {
  BASELINE_SIGHT_RADIUS,
  DARKNESS_OBSCURE_RADIUS,
  DARKNESS_OBSCURE_STACK_THRESHOLD,
  LIGHT_SIGHT_BONUS_PER_STACK,
  LIGHT_SIGHT_MIN_STACK,
  resolveVisibilityRadius,
  scopeObservation,
} from "../../packages/core-ts/src/state/visibility.ts";

function call(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

function setAllFloors(core: ReturnType<typeof createCore>, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      call(core.setTileAt, x, y, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// The radius policy, as a pure function
// ---------------------------------------------------------------------------

describe("resolveVisibilityRadius", () => {
  test("an actor with no light and no dark sees the baseline 3 tiles", () => {
    expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks: 0 })).toBe(BASELINE_SIGHT_RADIUS);
    expect(BASELINE_SIGHT_RADIUS).toBe(3);
  });

  test("dark at or above the obscure threshold collapses sight to the obscured radius", () => {
    expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks: DARKNESS_OBSCURE_STACK_THRESHOLD }))
      .toBe(DARKNESS_OBSCURE_RADIUS);
    expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks: 9 }))
      .toBe(DARKNESS_OBSCURE_RADIUS);
  });

  test("dark BELOW the threshold has no effect — the threshold is the rule, not a slope", () => {
    expect(resolveVisibilityRadius({ lightStacks: 0, darkStacks: DARKNESS_OBSCURE_STACK_THRESHOLD - 1 }))
      .toBe(BASELINE_SIGHT_RADIUS);
  });

  test("light extends sight, one tile per stack, from the minimum stack up", () => {
    expect(resolveVisibilityRadius({ lightStacks: LIGHT_SIGHT_MIN_STACK, darkStacks: 0 }))
      .toBe(BASELINE_SIGHT_RADIUS + LIGHT_SIGHT_BONUS_PER_STACK);
    expect(resolveVisibilityRadius({ lightStacks: 3, darkStacks: 0 }))
      .toBe(BASELINE_SIGHT_RADIUS + 3 * LIGHT_SIGHT_BONUS_PER_STACK);
  });

  test("sight never drops below one tile — an actor always perceives what is adjacent", () => {
    // The floor clamp, ruled 2026-08-20. A radius of 0 would leave an actor unable
    // to see an adjacent attacker, collapsing every hostile-dependent proposal to
    // wait and turning a dark room into a dead zone rather than a dangerous one.
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
    expect(scoped.hazards).toEqual([]);
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
    expect(scoped.hazards).toEqual([]);
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
// Against a real core: the field the runtime already computes per tick
// ---------------------------------------------------------------------------

describe("getVisibilityRadiusAt", () => {
  const DARK = 10;
  const LIGHT = 9;
  const EMIT = 3;

  test("an actor emitting dark obscures its own tile", () => {
    const core = createCore();
    call(core.configureGrid, 12, 12);
    setAllFloors(core, 12, 12);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 5, 5);
    call(core.applyActorPlacements);
    call(core.setMotivatedActorAffinity, 0, DARK, EMIT, DARKNESS_OBSCURE_STACK_THRESHOLD);
    call(core.computeAffinityField);

    expect(call(core.getVisibilityRadiusAt, 5, 5)).toBe(DARKNESS_OBSCURE_RADIUS);
  });

  test("an actor emitting light sees further than baseline from its own tile", () => {
    const core = createCore();
    call(core.configureGrid, 12, 12);
    setAllFloors(core, 12, 12);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 5, 5);
    call(core.applyActorPlacements);
    call(core.setMotivatedActorAffinity, 0, LIGHT, EMIT, 2);
    call(core.computeAffinityField);

    expect(call(core.getVisibilityRadiusAt, 5, 5)).toBeGreaterThan(BASELINE_SIGHT_RADIUS);
  });

  test("an empty board gives every tile the baseline radius", () => {
    const core = createCore();
    call(core.configureGrid, 12, 12);
    setAllFloors(core, 12, 12);
    call(core.computeAffinityField);

    expect(call(core.getVisibilityRadiusAt, 5, 5)).toBe(BASELINE_SIGHT_RADIUS);
  });

  test("DELIBERATE, ACCEPTED: a default room's dark emission obscures sight to one tile", () => {
    // Default rooms emit dark at 2 stacks (DEFAULT_ROOM_AFFINITY_STACKS in the
    // runtime vocabulary) and the obscure threshold is 2, so a default room
    // clamps sight to a single tile. This was surfaced to the maintainer before
    // the stack-threshold rule was chosen and was accepted knowingly.
    //
    // Pinned here so it stays a DECISION rather than becoming a bug report: if
    // this ever needs to change, it is the threshold or the room default that
    // moves, and this test is the place that says so out loud.
    const core = createCore();
    call(core.configureGrid, 12, 12);
    setAllFloors(core, 12, 12);
    call(core.clearActorPlacements);
    call(core.addActorPlacement, 10, 5, 5);
    call(core.applyActorPlacements);
    call(core.setMotivatedActorAffinity, 0, DARK, EMIT, 2);
    call(core.computeAffinityField);

    expect(call(core.getVisibilityRadiusAt, 5, 5)).toBe(1);
  });

  test("canceled target dark does not conceal an otherwise visible actor", () => {
    const core = createCore();
    call(core.configureGrid, 9, 7);
    setAllFloors(core, 9, 7);
    call(core.armStaticHazardAt, 2, 3, DARK, EMIT, 3, 5);
    call(core.armStaticHazardAt, 6, 3, LIGHT, EMIT, 3, 5);
    call(core.computeAffinityField);

    const targetDark = call(core.getAffinityFieldStacksAt, 4, 3, DARK) as number;
    expect(targetDark).toBe(0);

    const observation = {
      actors: [
        { id: "self", position: { x: 1, y: 3 } },
        { id: "target", position: { x: 4, y: 3 } },
      ],
      tiles: { kinds: Array.from({ length: 7 }, () => Array(9).fill(0)) },
    };
    const scoped = scopeObservation(observation, "self", 3, {
      darkStacksByCell: { "4,3": targetDark },
    });

    expect(scoped.actors.map((entry) => entry.id)).toEqual(["self", "target"]);
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
