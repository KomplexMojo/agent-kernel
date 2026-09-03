import assert from "node:assert/strict";
import {
  ENTITY_SPRITE_CANONICAL_SIZE,
  ENTITY_SPRITE_ROLES,
  composeEntitySprite,
  normalizeEntitySpriteState,
} from "../../packages/runtime/src/render/entity-sprite-composer.js";
import { AFFINITY_KINDS } from "../../packages/runtime/src/contracts/domain-constants.js";

// The whole point of this module is that a sprite carries TWO channels -- role as
// silhouette, affinity as fill -- so it stays readable when the gameplay camera
// shrinks a tile toward its floor. These tests hold that budget: anything that
// would smuggle a third channel back onto the sprite has to fail here.

type Rgba = [number, number, number, number];

function pixelAt(pixels: Uint8ClampedArray, size: number, x: number, y: number): Rgba {
  const i = (y * size + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

/** Indices of every pixel with any opacity -- the silhouette, independent of colour. */
function alphaMask(pixels: Uint8ClampedArray, size: number): Set<number> {
  const mask = new Set<number>();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (pixelAt(pixels, size, x, y)[3] > 0) mask.add(y * size + x);
    }
  }
  return mask;
}

function occupancy(pixels: Uint8ClampedArray, size: number): number {
  return alphaMask(pixels, size).size / (size * size);
}

function sameMask(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function compose(role: string, affinity: string, size = ENTITY_SPRITE_CANONICAL_SIZE) {
  return composeEntitySprite({ state: normalizeEntitySpriteState({ role, affinity }), size });
}

test("every role x affinity pair composes to a correctly sized buffer", () => {
  for (const role of ENTITY_SPRITE_ROLES) {
    for (const affinity of AFFINITY_KINDS) {
      const pixels = compose(role, affinity);
      assert.equal(
        pixels.length,
        ENTITY_SPRITE_CANONICAL_SIZE * ENTITY_SPRITE_CANONICAL_SIZE * 4,
        `${role}/${affinity} produced the wrong buffer length`,
      );
      assert.ok(occupancy(pixels, ENTITY_SPRITE_CANONICAL_SIZE) > 0.05, `${role}/${affinity} rendered nothing`);
    }
  }
});

test("composition is deterministic -- identical input gives a byte-identical buffer", () => {
  for (const role of ENTITY_SPRITE_ROLES) {
    const a = compose(role, "fire");
    const b = compose(role, "fire");
    assert.deepEqual(Array.from(a), Array.from(b), `${role} is not deterministic`);
  }
});

test("role changes the silhouette, not just the colour", () => {
  const roles = [...ENTITY_SPRITE_ROLES];
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      const a = alphaMask(compose(roles[i], "fire"), ENTITY_SPRITE_CANONICAL_SIZE);
      const b = alphaMask(compose(roles[j], "fire"), ENTITY_SPRITE_CANONICAL_SIZE);
      assert.ok(
        !sameMask(a, b),
        `${roles[i]} and ${roles[j]} share an identical silhouette -- role must be readable without colour`,
      );
    }
  }
});

test("affinity changes the fill, not the silhouette", () => {
  for (const role of ENTITY_SPRITE_ROLES) {
    const reference = alphaMask(compose(role, "fire"), ENTITY_SPRITE_CANONICAL_SIZE);
    for (const affinity of AFFINITY_KINDS) {
      const mask = alphaMask(compose(role, affinity), ENTITY_SPRITE_CANONICAL_SIZE);
      assert.ok(
        sameMask(reference, mask),
        `${role}/${affinity} changed the silhouette -- shape must be affinity-invariant`,
      );
    }
  }
});

test("two different affinities on the same role produce different pixels", () => {
  const fire = compose("delver", "fire");
  const water = compose("delver", "water");
  assert.notDeepEqual(Array.from(fire), Array.from(water));
});

// REFUSAL: the state type has no room for vitals, expression or motivation, and
// passing them must not change a single byte. A comment saying "do not add these"
// rots; this does not.
test("refuses to encode vitals, expression or motivation", () => {
  const bare = { role: "delver", affinity: "fire" };
  const loaded = {
    ...bare,
    expression: "push",
    motivation: "attacking",
    vitals: {
      health: { current: 1, max: 10, fraction: 0.1 },
      mana: { current: 1, max: 10, fraction: 0.1 },
      stamina: { current: 1, max: 10, fraction: 0.1 },
      durability: { current: 1, max: 10, fraction: 0.1 },
    },
  };
  const size = ENTITY_SPRITE_CANONICAL_SIZE;

  // Both entry points, because they strip at different moments. Checking only the
  // pre-normalized `state` path passes vacuously: composeEntitySprite re-normalizes
  // it, so the extra channels are gone before any pixel is written. `entity` is the
  // path the renderer actually uses, and it hands over the raw observation object.
  const cases: Array<[string, (v: object) => Uint8ClampedArray]> = [
    ["state", (v) => composeEntitySprite({ state: normalizeEntitySpriteState(v as never), size })],
    ["entity", (v) => composeEntitySprite({ entity: v as never, size })],
  ];
  for (const [label, run] of cases) {
    assert.deepEqual(
      Array.from(run(bare)),
      Array.from(run(loaded)),
      `a third channel leaked onto the sprite via the ${label} path -- vitals/expression/motivation belong to the HUD`,
    );
  }
});

test("normalized state exposes only role and affinity", () => {
  const state = normalizeEntitySpriteState({
    role: "warden",
    affinity: "water",
    expression: "pull",
    motivation: "patrolling",
    vitals: { health: { current: 3, max: 9, fraction: 0.33 } },
  } as never);
  assert.deepEqual(Object.keys(state).sort(), ["affinity", "role"]);
});

test("reads affinity from every shape the observation actually uses", () => {
  // All four are live: actors carry `affinities[]`, hazards carry a singular
  // `affinity` OBJECT or `affinityStacks[]`, cards carry `traits.affinities`.
  // Reading only the string form rendered every hazard and resource as the
  // default `fire`, which is how this was found.
  const cases: Array<[string, object]> = [
    ["affinity string", { affinity: "water" }],
    ["affinity object", { affinity: { kind: "water" } }],
    ["affinities array", { affinities: [{ kind: "water", expression: "emit" }] }],
    ["affinityStacks array", { affinityStacks: [{ kind: "water", stacks: 2 }] }],
    ["equippedAffinity object", { equippedAffinity: { kind: "water" } }],
    ["traits.affinities", { traits: { affinities: { "water:emit": 1 } } }],
  ];
  for (const [label, entity] of cases) {
    assert.equal(
      normalizeEntitySpriteState({ role: "hazard", ...entity } as never).affinity,
      "water",
      `${label} did not resolve to water`,
    );
  }
});

test("unknown role and affinity fall back without throwing", () => {
  const state = normalizeEntitySpriteState({ role: "sorcerer", affinity: "plasma" } as never);
  assert.ok(ENTITY_SPRITE_ROLES.includes(state.role));
  assert.ok(AFFINITY_KINDS.includes(state.affinity));
  assert.doesNotThrow(() => composeEntitySprite({ state, size: ENTITY_SPRITE_CANONICAL_SIZE }));
});

// The reason this module exists: the camera can shrink a tile a long way, and the
// silhouette has to survive it. 12px is the floor the maintainer chose to defend
// by raising MIN_CAMERA_ZOOM (M3); below that only colour is expected to read.
test("silhouettes stay distinct down to the 12px camera floor", () => {
  // Overlap, not identity. Asserting only "the masks differ" is a guard that
  // ratifies anything: the first hazard/resource pair differed by 16 pixels of
  // 144 and passed that check while being visually the same blob. This measures
  // Jaccard overlap and holds a real ceiling.
  const MAX_OVERLAP = 0.6;
  for (const size of [32, 16, 12]) {
    const masks = ENTITY_SPRITE_ROLES.map((role) => alphaMask(compose(role, "fire", size), size));
    for (let i = 0; i < masks.length; i += 1) {
      for (let j = i + 1; j < masks.length; j += 1) {
        let intersection = 0;
        for (const v of masks[i]) if (masks[j].has(v)) intersection += 1;
        const overlap = intersection / (masks[i].size + masks[j].size - intersection);
        assert.ok(
          overlap <= MAX_OVERLAP,
          `${ENTITY_SPRITE_ROLES[i]} and ${ENTITY_SPRITE_ROLES[j]} overlap ${overlap.toFixed(3)} at ${size}px ` +
            `(ceiling ${MAX_OVERLAP}) -- too similar to read apart on the board`,
        );
      }
    }
  }
});

test("sprite fills a usable share of its tile at every size", () => {
  for (const size of [32, 16, 12]) {
    for (const role of ENTITY_SPRITE_ROLES) {
      const share = occupancy(compose(role, "fire", size), size);
      assert.ok(share > 0.12, `${role} at ${size}px covers only ${(share * 100).toFixed(1)}% of the tile`);
      assert.ok(share < 0.95, `${role} at ${size}px covers ${(share * 100).toFixed(1)}% -- no silhouette left`);
    }
  }
});

test("a constant outline separates the fill from the board", () => {
  // Figure-ground is the outline's job, not the fill's -- this is what let M2 drop
  // the floor-contrast bar from 45 to 30 without the board turning to soup.
  const size = ENTITY_SPRITE_CANONICAL_SIZE;
  const outlines = ENTITY_SPRITE_ROLES.map((role) => {
    const pixels = compose(role, "dark", size);
    const mask = alphaMask(pixels, size);
    const edge: Rgba[] = [];
    for (const index of mask) {
      const x = index % size;
      const y = Math.floor(index / size);
      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const isEdge = neighbours.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= size || ny >= size || !mask.has(ny * size + nx);
      });
      if (isEdge) edge.push(pixelAt(pixels, size, x, y));
    }
    assert.ok(edge.length > 0, "sprite has no edge pixels");
    return edge;
  });
  // `dark` is the darkest fill; its outline must still be markedly lighter, or the
  // sprite disappears against the board.
  for (const edge of outlines) {
    const meanLuma = edge.reduce((sum, [r, g, b]) => sum + (r + g + b) / 3, 0) / edge.length;
    assert.ok(meanLuma > 120, `outline mean luminance ${meanLuma.toFixed(1)} is too dark to separate from the board`);
  }
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("every affinity keeps its fill distinct from every other at 16px", () => {});
test.skip("every affinity keeps its fill distinct from every other at 12px", () => {});
test.skip("odd sizes (13px, 17px, 31px) render without off-by-one gaps", () => {});
test.skip("size below the canonical floor still produces a non-empty silhouette", () => {});
test.skip("size above canonical scales the silhouette without resampling artefacts", () => {});
test.skip("hazard and resource silhouettes stay distinguishable at 16px", () => {});
test.skip("outline width stays proportional across 12px, 32px and 64px", () => {});
test.skip("null, undefined and empty-object entities normalize to the default role", () => {});
test.skip("affinity casing and surrounding whitespace normalize identically", () => {});
test.skip("buffer contains no partially-transparent pixels outside the outline", () => {});
