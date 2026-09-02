// Bounded configuration-permutation matrix for `ak create` (dry-run or full) plus an optional
// `ak run` follow-on, driven by run-configuration-permutation-sweep.mjs.
//
// Not a full Cartesian product (10 affinities x 4 expressions x 11 motivations x counts x
// warden/resource combos would run into the thousands) — this is a one-axis-at-a-time sweep off a
// single known-good baseline, plus a handful of multi-entity stress scenarios. Each axis holds
// every other axis at baseline and varies one dimension across its full domain (or a spot-check
// subset for the larger domains), so a failure localizes to one axis immediately.
//
// budgetTokens is fixed for every scenario at a level well above what any one scenario costs, so
// budget denial doesn't confound the sweep. That fixed cap is also the "don't let generated configs
// grow unmanaged" rail this tool was built to satisfy.
//
// See mcp-harness-run-through.md ("Configuration-permutation sweep") for the sweep this matrix
// backs, its results, and the issue (#148) its first full run found.

export const AFFINITIES = ["fire", "water", "earth", "wind", "life", "decay", "corrode", "fortify", "light", "dark"];
export const EXPRESSIONS = ["push", "pull", "emit", "draw"];
export const NON_CONTROL_MOTIVATIONS = [
  "random", "stationary", "exploring", "patrolling",
  "attacking", "defending", "stealthy", "friendly",
  "reflexive", "goal_oriented", "strategy_focused",
];
// The control family (packages/runtime/src/contracts/game-elements.js GAME_MOTIVATION_FAMILIES)
// has exactly one kind. Player-controlled actors are documented (Actor persona README, "Player-
// controlled dynamic actors") as needing streamed simulation playback to actually be driven, so a
// plain ak_run pass over this axis is expected to authoring-validate cleanly but act as an inert
// actor at the run layer — informational, not a failure signal, same caveat as the axis-B
// cognition-only motivations already noted in mcp-harness-run-through.md.
export const CONTROL_MOTIVATIONS = ["user_controlled"];

const BASELINE = {
  room: ["size=small;count=1"],
  delver: ["count=1;affinity=fire;motivation=exploring"],
  hazard: ["x=3;y=3;affinity=fire;expression=emit;stacks=1"],
  budgetTokens: 2000,
};

function scenario(id, axis, description, overrides) {
  return {
    id,
    axis,
    description,
    args: { ...BASELINE, ...overrides },
  };
}

export const MATRIX = [
  // Axis A — delver affinity, full domain (10). Motivation/hazard held at baseline.
  ...AFFINITIES.map((a) =>
    scenario(`A-delver-affinity-${a}`, "A", `delver affinity=${a}`, {
      delver: [`count=1;affinity=${a};motivation=exploring`],
    })),

  // Axis B — delver motivation, full domain (all 4 families) minus "exploring" (already covered
  // by baseline in axis A). Includes the control family's "user_controlled", widened in from a
  // non-control-only sweep 2026-09-01. Affinity/hazard held at baseline.
  ...[...NON_CONTROL_MOTIVATIONS, ...CONTROL_MOTIVATIONS].filter((m) => m !== "exploring").map((m) =>
    scenario(`B-delver-motivation-${m}`, "B", `delver motivation=${m}`, {
      delver: [`count=1;affinity=fire;motivation=${m}`],
    })),

  // Axis C — hazard expression, full domain minus "emit" (baseline). Delver held at baseline.
  ...EXPRESSIONS.filter((e) => e !== "emit").map((e) =>
    scenario(`C-hazard-expression-${e}`, "C", `hazard expression=${e}`, {
      hazard: [`x=3;y=3;affinity=fire;expression=${e};stacks=1`],
    })),

  // Axis C (continued) — hazard position, the room's two diagonals. Hazard x/y are
  // room-relative offsets into the target room's carved interior (level-layout.js), and a
  // "small" room's interior is confirmed 5x5 (relative 0..4 each axis: sim-config.json grid is
  // 9x9 with a 1-tile border wall on every side). The four corners are the diagonal extremes of
  // that interior — main diagonal (0,0)/(4,4) and anti-diagonal (0,4)/(4,0) — chosen because
  // diagonal-adjacent-to-wall geometry (corner peeking, diagonal blocking) is called out
  // elsewhere in this codebase (Actor persona README, line-of-sight) as a distinct code path
  // from cardinal placement, which the baseline's near-center (3,3) hazard never exercises.
  // Expression/affinity held at baseline ("emit"/"fire"); only position varies. Widened in
  // 2026-09-01.
  ...[
    { id: "topleft", x: 0, y: 0 },
    { id: "bottomright", x: 4, y: 4 },
    { id: "topright", x: 4, y: 0 },
    { id: "bottomleft", x: 0, y: 4 },
  ].map(({ id, x, y }) =>
    scenario(`C-hazard-position-diagonal-${id}`, "C", `hazard position=diagonal-${id} (${x},${y})`, {
      hazard: [`x=${x};y=${y};affinity=fire;expression=emit;stacks=1`],
    })),

  // Axis D — hazard affinity, full domain (10), matching axis A's pattern of sweeping the full
  // domain inclusive of the baseline value (fire) rather than excluding it. Delver held at
  // baseline. Widened from a 3-affinity spot-check (water, dark, decay) 2026-09-01.
  ...AFFINITIES.map((a) =>
    scenario(`D-hazard-affinity-${a}`, "D", `hazard affinity=${a}`, {
      hazard: [`x=3;y=3;affinity=${a};expression=emit;stacks=1`],
    })),

  // Axis E — warden present, actor-vs-actor interaction.
  scenario("E1-warden-basic", "E", "delver(fire/exploring) + warden(dark/defending)", {
    warden: ["count=1;affinity=dark;motivation=defending"],
  }),
  scenario("E2-warden-same-affinity-opposed-roles", "E", "delver(fire/attacking) + warden(fire/defending), same affinity", {
    delver: ["count=1;affinity=fire;motivation=attacking"],
    warden: ["count=1;affinity=fire;motivation=defending"],
  }),
  scenario("E3-multi-actor-stress", "E", "2 delvers + 1 warden, mixed affinities/motivations", {
    delver: [
      "count=1;affinity=fire;motivation=exploring",
      "count=1;affinity=water;motivation=attacking",
    ],
    warden: ["count=1;affinity=earth;motivation=defending"],
  }),

  // Axis E (continued) — diagonal warden placement, the room's two diagonals (4 corners), same
  // rationale as axis C's diagonal hazard positions but for an actor rather than a static hazard.
  // create/configure has no x/y field for delver/warden (level-gen auto-places actors), so this
  // reuses E1's exact authored config and repositions the auto-placed warden at RUN time via
  // `ak run --actor <id>,<x>,<y>` (run-configuration-permutation-sweep.mjs's actorOverride hook)
  // — id "card_warden_1-1" confirmed from E1's own initial-state.json (single warden, count=1).
  // Corners are absolute grid coordinates: the room's walkable interior is confirmed absolute
  // 1..5 on each axis (9x9 grid, 1-tile border wall, room origin at (1,1) — see axis C's comment
  // for the room-relative 0..4 that these are offset by +1 from).
  ...[
    { id: "topleft", x: 1, y: 1 },
    { id: "bottomright", x: 5, y: 5 },
    { id: "topright", x: 5, y: 1 },
    { id: "bottomleft", x: 1, y: 5 },
  ].map(({ id, x, y }) =>
    scenario(`E-warden-diagonal-${id}`, "E", `warden repositioned to diagonal-${id} (${x},${y})`, {
      warden: ["count=1;affinity=dark;motivation=defending"],
      actorOverride: [`card_warden_1-1,${x},${y}`],
    })),

  // Axis F — resource authoring (V3 spec: vital payload, affinity payload, and both).
  scenario("F1-resource-vital-consumable", "F", "resource vital payload, consumable mana", {
    resource: ["permanenceMode=consumable;vital=mana;delta=5"],
  }),
  scenario("F2-resource-vital-permanent", "F", "resource vital payload, permanent health", {
    resource: ["permanenceMode=permanent;vital=health;delta=2"],
  }),
  scenario("F3-resource-affinity-payload", "F", "resource affinity payload with manaRegen", {
    resource: ["affinity=water;expression=draw;stacks=1;mana=10;manaRegen=2"],
  }),

  // Axis G — multi-hazard stress (id/index collision surface distinct from axis E's multi-actor).
  // G2's third hazard is deliberately placed outside the room's bounds — this is the exact repro
  // for #148 (level-gen error formatter bakes literal "undefined" into hazard_outside_room
  // messages) and is left in place on purpose as a regression probe: it should keep reporting
  // ANOMALY_UNEXPECTED (bad message text) until #148 is fixed, not VALIDATION_REJECTION (which
  // would require the message to actually say what's wrong).
  scenario("G1-multi-hazard", "G", "2 hazards, distinct affinity/expression/stacks", {
    hazard: [
      "x=3;y=3;affinity=fire;expression=emit;stacks=1",
      "x=1;y=4;affinity=water;expression=pull;stacks=2",
    ],
  }),
  scenario("G2-multi-hazard-triple", "G", "3 hazards, full variety", {
    hazard: [
      "x=3;y=3;affinity=fire;expression=emit;stacks=1",
      "x=1;y=4;affinity=water;expression=pull;stacks=2",
      "x=5;y=1;affinity=dark;expression=push;stacks=3",
    ],
  }),
];
