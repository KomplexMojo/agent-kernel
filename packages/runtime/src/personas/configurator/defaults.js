export const LEVEL_GEN_DEFAULTS = Object.freeze({
  roomCount: 4,
  roomMinSize: 3,
  roomMaxSize: 9,
  corridorWidth: 1,
  pattern: "grid",
  patternSpacing: 6,
  patternLineWidth: 1,
  patternGapEvery: 4,
  patternInset: 1,
  edgeBias: false,
  minDistance: 0,
  requirePath: true,
});

export const AFFINITY_DEFAULTS = Object.freeze({
  manaCost: 0,
  stacks: 1,
});
