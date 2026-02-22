const { moduleUrl } = require("./esm-runner");

const TIER_SPECS = Object.freeze({
  1: { width: 5, height: 5, count: 1, seed: 101 },
  2: { width: 10, height: 10, count: 3, seed: 202 },
  3: { width: 20, height: 20, count: 10, seed: 303 },
  4: { width: 50, height: 50, count: 20, seed: 404 },
  5: { width: 100, height: 100, count: 50, seed: 505 },
  6: { width: 1000, height: 1000, count: 500, seed: 606 },
});

function resolveTierSpec(tier, overrides = {}) {
  const base = TIER_SPECS[tier];
  if (!base) {
    throw new Error(`Unknown tier ${tier}`);
  }
  const width = overrides.width ?? base.width;
  const height = overrides.height ?? base.height;
  const minSide = Math.max(3, Math.floor(Math.min(width, height) / 20));
  const maxSide = Math.max(minSide, Math.floor(Math.min(width, height) / 8));
  return {
    tier,
    width,
    height,
    count: overrides.count ?? base.count,
    seed: Number.isFinite(overrides.seed) ? overrides.seed : base.seed,
    roomCount: Number.isInteger(overrides.roomCount)
      ? Math.max(1, overrides.roomCount)
      : Math.max(2, Math.min(24, Math.round(Math.min(width, height) / 40))),
    roomMinSize: Number.isInteger(overrides.roomMinSize)
      ? Math.max(1, overrides.roomMinSize)
      : minSide,
    roomMaxSize: Number.isInteger(overrides.roomMaxSize)
      ? Math.max(1, overrides.roomMaxSize)
      : maxSide,
    corridorWidth: Number.isInteger(overrides.corridorWidth)
      ? Math.max(1, overrides.corridorWidth)
      : 1,
    edgePadding: overrides.edgePadding ?? 1,
    idPrefix: overrides.idPrefix ?? `tier${tier}_actor`,
  };
}

let generatorPromise = null;

async function loadGenerators() {
  if (!generatorPromise) {
    generatorPromise = Promise.all([
      import(moduleUrl("packages/runtime/src/personas/configurator/level-layout.js")),
      import(moduleUrl("packages/runtime/src/personas/configurator/actor-generator.js")),
    ]).then(([layout, actors]) => ({
      generateGridLayoutFromInput: layout.generateGridLayoutFromInput,
      generateActorSet: actors.generateActorSet,
    }));
  }
  return generatorPromise;
}

async function generateTierLayout(options = {}) {
  if (!options.tier) {
    throw new Error("tier is required for generateTierLayout");
  }
  const spec = resolveTierSpec(options.tier, options);
  const { generateGridLayoutFromInput } = await loadGenerators();
  const input = {
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    shape: {
      roomCount: spec.roomCount,
      roomMinSize: spec.roomMinSize,
      roomMaxSize: spec.roomMaxSize,
      corridorWidth: spec.corridorWidth,
    },
  };
  if (Array.isArray(options.traps)) {
    input.traps = options.traps;
  }
  return generateGridLayoutFromInput(input);
}

async function generateTierActors(options = {}) {
  if (!options.tier) {
    throw new Error("tier is required for generateTierActors");
  }
  const spec = resolveTierSpec(options.tier, options);
  const { generateActorSet } = await loadGenerators();
  return generateActorSet({
    count: spec.count,
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    idPrefix: spec.idPrefix,
    edgePadding: spec.edgePadding,
  });
}

module.exports = {
  resolveTierSpec,
  generateTierLayout,
  generateTierActors,
};
