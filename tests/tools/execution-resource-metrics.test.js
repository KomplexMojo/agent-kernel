/**
 * The execution contract declares nine resource metrics and the evaluator
 * extracted none of them, so every resource gate reported `evidence_unavailable`
 * and the five EX-RS scenarios could never qualify. The evidence they need is a
 * world-state checkpoint series: a resource present at one tick and gone at the
 * next was collected in between, and the collecting actor's vitals and affinity
 * grants say what the collection did.
 *
 * These tests drive the extractor with checkpoint series directly, because the
 * question is what the evaluator concludes from a given world history — not how
 * that history came to be.
 */
'use strict';

const assert = require('node:assert/strict');

const {
  extractExecutionMetrics,
} = require('../../tools/remote-ollama-control/scripts/lib/execution-evaluator.js');
const {
  loadExecutionCatalog,
} = require('../../tools/remote-ollama-control/scripts/lib/execution-catalog.js');

const CONTRACT = loadExecutionCatalog().contract;

function vitals({ health = [10, 10, 0], mana = [0, 0, 0], stamina = [20, 20, 0] } = {}) {
  const of = ([current, max, regen]) => ({ current, max, regen });
  return { health: of(health), mana: of(mana), stamina: of(stamina), durability: of([2, 2, 0]) };
}

function checkpoint(tick, { actors = [], resources = [] } = {}) {
  return {
    schema: 'agent-kernel/WorldStateArtifact',
    schemaVersion: 2,
    meta: { id: `s${tick}`, runId: 'fixture', createdAt: '2026-01-01T00:00:00.000Z', producedBy: 'annotator' },
    tick,
    dimensions: { width: 5, height: 5 },
    actors,
    hazards: [],
    resources,
  };
}

function vitalResource(position, { kind = 0, delta = 5, mode = 0, regen = 0 } = {}) {
  return { position, vital: { kind, delta, mode, regen }, affinity: null };
}

function affinityResource(position, { kind = 1, expression = 1, stacks = 2, mana = 12, manaRegen = 0 } = {}) {
  return { position, vital: null, affinity: { kind, expression, stacks, mana, manaRegen } };
}

function actorAt(id, position, options = {}) {
  return { id, index: 0, position, vitals: vitals(options.vitals), affinities: options.affinities || [] };
}

function grant({ kind = 1, expression = 1, stacks = 2, mana = 12, manaMax = 12, manaRegen = 0 } = {}) {
  return { kind, expression, stacks, mana, manaMax, manaRegen };
}

function extract(states, { initialActors } = {}) {
  const { metrics } = extractExecutionMetrics({
    tickFrames: [],
    runSummary: { outcome: 'success', metrics: { ticks: 2 } },
    initialState: {
      actors: initialActors || [{ id: 'delver_1', archetype: 'delver', role: 'delver', position: { x: 1, y: 1 } }],
    },
    simConfig: { layout: { data: { width: 5, height: 5, tiles: ['.....', '.....', '.....', '.....', '.....'] } } },
    requestedTicks: 2,
    worldStateCheckpoints: { expectedTicks: states.map((state) => state.tick), states },
  }, CONTRACT);
  return metrics;
}

// ---------------------------------------------------------------------------
// Without a checkpoint series there is no evidence — and no false pass
// ---------------------------------------------------------------------------

const RESOURCE_METRICS = [
  'single_consumption', 'pickup_apply_correctness', 'persistent_vital_grant', 'recovery_curve',
  'affinity_lifecycle', 'affinity_activity', 'grant_isolation', 'actor_kind_parity', 'persistent_stacking',
];

test('every resource metric is unavailable when no checkpoints were captured', () => {
  const metrics = extract([]);
  for (const name of RESOURCE_METRICS) {
    assert.equal(metrics[name].status, 'evidence_unavailable', `${name} must not be scored without checkpoints`);
  }
});

test('checkpoint observations are labeled and require the complete declared series', () => {
  const states = [
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 })], resources: [vitalResource({ x: 3, y: 3 })] }),
    checkpoint(2, { actors: [actorAt('delver_1', { x: 3, y: 3 })], resources: [] }),
  ];
  const complete = extract(states);
  assert.equal(complete.single_consumption.evidence, 'observation');

  const { metrics } = extractExecutionMetrics({
    tickFrames: [], requestedTicks: 2,
    runSummary: { outcome: 'success', metrics: { ticks: 2 } },
    initialState: { actors: [] },
    simConfig: { layout: { data: { width: 5, height: 5, tiles: [] } } },
    worldStateCheckpoints: { expectedTicks: [0, 1, 2], states },
  }, CONTRACT);
  assert.equal(metrics.single_consumption.status, 'evidence_unavailable');
  assert.match(metrics.single_consumption.reason, /complete declared/);
});

test('a single checkpoint proves nothing, because collection is a difference between two', () => {
  const metrics = extract([checkpoint(0, {
    actors: [actorAt('delver_1', { x: 1, y: 1 })],
    resources: [vitalResource({ x: 3, y: 3 })],
  })]);
  assert.equal(metrics.single_consumption.status, 'evidence_unavailable');
});

// ---------------------------------------------------------------------------
// single_consumption
// ---------------------------------------------------------------------------

test('a resource that vanishes exactly once scores single_consumption 1', () => {
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 })], resources: [vitalResource({ x: 3, y: 3 })] }),
    checkpoint(2, { actors: [actorAt('delver_1', { x: 3, y: 3 }, { vitals: { health: [15, 20, 0] } })], resources: [] }),
  ]);
  assert.equal(metrics.single_consumption.status, 'available');
  assert.equal(metrics.single_consumption.value, 1);
});

// The gate reads "resource consumes once". A resource nobody ever crossed did not
// consume once, and must not be scored as though it had.
test('a resource still sitting on the map at the end scores below 1', () => {
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 })], resources: [vitalResource({ x: 3, y: 3 })] }),
    checkpoint(2, { actors: [actorAt('delver_1', { x: 1, y: 2 })], resources: [vitalResource({ x: 3, y: 3 })] }),
  ]);
  assert.equal(metrics.single_consumption.value, 0);
});

test('a resource that reappears after being taken is not a single consumption', () => {
  const resource = vitalResource({ x: 3, y: 3 });
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 })], resources: [resource] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 3, y: 3 })], resources: [] }),
    checkpoint(2, { actors: [actorAt('delver_1', { x: 3, y: 3 })], resources: [resource] }),
  ]);
  assert.equal(metrics.single_consumption.value, 0);
});

// ---------------------------------------------------------------------------
// pickup_apply_correctness and persistent_vital_grant
// ---------------------------------------------------------------------------

test('a consumable grant that raised current health within max scores pickup_apply_correctness 1', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [5, 20, 0] } })],
      resources: [vitalResource({ x: 3, y: 3 }, { mode: 0, delta: 5 })],
    }),
    checkpoint(2, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { vitals: { health: [10, 20, 0] } })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.pickup_apply_correctness.value, 1);
});

test('a consumed grant that changed nothing scores pickup_apply_correctness 0', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [5, 20, 0] } })],
      resources: [vitalResource({ x: 3, y: 3 }, { mode: 0, delta: 5 })],
    }),
    checkpoint(2, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { vitals: { health: [5, 20, 0] } })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.pickup_apply_correctness.value, 0);
});

test('a level grant that raised max and held it to the end scores persistent_vital_grant 1', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [5, 12, 0] } })],
      resources: [vitalResource({ x: 3, y: 3 }, { mode: 1, delta: 4 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { vitals: { health: [9, 16, 0] } })],
      resources: [],
    }),
    checkpoint(2, {
      actors: [actorAt('delver_1', { x: 3, y: 4 }, { vitals: { health: [9, 16, 0] } })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.persistent_vital_grant.value, 1);
});

// "increase persists through tick 100" is the gate. A max that comes back down
// is exactly the failure it exists to catch.
test('a raised max that decays before the last checkpoint scores persistent_vital_grant 0', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [5, 12, 0] } })],
      resources: [vitalResource({ x: 3, y: 3 }, { mode: 1, delta: 4 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { vitals: { health: [9, 16, 0] } })],
      resources: [],
    }),
    checkpoint(2, {
      actors: [actorAt('delver_1', { x: 3, y: 4 }, { vitals: { health: [9, 12, 0] } })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.persistent_vital_grant.value, 0);
});

test('a granted regen counts as a persistent grant even with a zero delta', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [5, 20, 0] } })],
      resources: [vitalResource({ x: 3, y: 3 }, { mode: 1, delta: 0, regen: 2 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { vitals: { health: [5, 20, 2] } })],
      resources: [],
    }),
    checkpoint(2, {
      actors: [actorAt('delver_1', { x: 3, y: 4 }, { vitals: { health: [7, 20, 2] } })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.persistent_vital_grant.value, 1);
});

// ---------------------------------------------------------------------------
// recovery_curve
// ---------------------------------------------------------------------------

test('recovery_curve counts the checkpoint steps where health climbed within bounds', () => {
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [4, 20, 2] } })], resources: [] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 2, y: 1 }, { vitals: { health: [6, 20, 2] } })], resources: [] }),
    checkpoint(2, { actors: [actorAt('delver_1', { x: 3, y: 1 }, { vitals: { health: [8, 20, 2] } })], resources: [] }),
  ]);
  assert.equal(metrics.recovery_curve.value, 2);
});

test('health that never climbs yields a recovery_curve of 0, not unavailable', () => {
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 }, { vitals: { health: [8, 20, 0] } })], resources: [] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 2, y: 1 }, { vitals: { health: [8, 20, 0] } })], resources: [] }),
  ]);
  assert.equal(metrics.recovery_curve.status, 'available');
  assert.equal(metrics.recovery_curve.value, 0);
});

// ---------------------------------------------------------------------------
// affinity metrics
// ---------------------------------------------------------------------------

test('a consumed affinity resource whose grant appears with declared stacks scores affinity_lifecycle 1', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 })],
      resources: [affinityResource({ x: 3, y: 3 }, { kind: 1, expression: 1, stacks: 2, mana: 12 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { affinities: [grant({ kind: 1, expression: 1, stacks: 2, mana: 12 })] })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.affinity_lifecycle.value, 1);
});

test('a grant arriving with the wrong stack count scores affinity_lifecycle 0', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 })],
      resources: [affinityResource({ x: 3, y: 3 }, { stacks: 2 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { affinities: [grant({ stacks: 1 })] })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.affinity_lifecycle.value, 0);
});

test('affinity_activity counts the steps where a grant spent mana', () => {
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 }, { affinities: [grant({ mana: 12 })] })], resources: [] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 2, y: 1 }, { affinities: [grant({ mana: 8 })] })], resources: [] }),
    checkpoint(2, { actors: [actorAt('delver_1', { x: 3, y: 1 }, { affinities: [grant({ mana: 5 })] })], resources: [] }),
  ]);
  assert.equal(metrics.affinity_activity.value, 2);
});

test('an exhausted grant that expires while the others survive scores grant_isolation 1', () => {
  const spent = grant({ kind: 1, expression: 1, mana: 0 });
  const other = grant({ kind: 2, expression: 2, mana: 9 });
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 }, { affinities: [spent, other] })], resources: [] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 2, y: 1 }, { affinities: [other] })], resources: [] }),
  ]);
  assert.equal(metrics.grant_isolation.value, 1);
});

test('an expiry that takes an unrelated grant with it scores grant_isolation 0', () => {
  const spent = grant({ kind: 1, expression: 1, mana: 0 });
  const other = grant({ kind: 2, expression: 2, mana: 9 });
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 }, { affinities: [spent, other] })], resources: [] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 2, y: 1 }, { affinities: [] })], resources: [] }),
  ]);
  assert.equal(metrics.grant_isolation.value, 0);
});

// Isolation cannot be observed in a run where nothing expired. Reporting 1 there
// would be a pass invented from the absence of evidence.
test('grant_isolation is unavailable when no grant ever expired', () => {
  const metrics = extract([
    checkpoint(0, { actors: [actorAt('delver_1', { x: 1, y: 1 }, { affinities: [grant()] })], resources: [] }),
    checkpoint(1, { actors: [actorAt('delver_1', { x: 2, y: 1 }, { affinities: [grant()] })], resources: [] }),
  ]);
  assert.equal(metrics.grant_isolation.status, 'evidence_unavailable');
});

test('stacks that combine additively across two grants score persistent_stacking 1', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { affinities: [grant({ stacks: 2 })] })],
      resources: [affinityResource({ x: 3, y: 3 }, { stacks: 2 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { affinities: [grant({ stacks: 4 })] })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.persistent_stacking.value, 1);
});

test('stacks that replace rather than combine score persistent_stacking 0', () => {
  const metrics = extract([
    checkpoint(0, {
      actors: [actorAt('delver_1', { x: 1, y: 1 }, { affinities: [grant({ stacks: 2 })] })],
      resources: [affinityResource({ x: 3, y: 3 }, { stacks: 2 })],
    }),
    checkpoint(1, {
      actors: [actorAt('delver_1', { x: 3, y: 3 }, { affinities: [grant({ stacks: 2 })] })],
      resources: [],
    }),
  ]);
  assert.equal(metrics.persistent_stacking.value, 0);
});

// ---------------------------------------------------------------------------
// actor_kind_parity — EX-RS-05 exists to prove wardens are not second-class
// ---------------------------------------------------------------------------

test('both actor kinds collecting a resource scores actor_kind_parity 1', () => {
  const initialActors = [
    { id: 'delver_1', archetype: 'delver', role: 'delver' },
    { id: 'warden_1', archetype: 'warden', role: 'warden' },
  ];
  const metrics = extract([
    checkpoint(0, {
      actors: [
        { ...actorAt('delver_1', { x: 1, y: 1 }), index: 0 },
        { ...actorAt('warden_1', { x: 4, y: 4 }), index: 1 },
      ],
      resources: [affinityResource({ x: 2, y: 2 }), affinityResource({ x: 3, y: 3 })],
    }),
    checkpoint(1, {
      actors: [
        { ...actorAt('delver_1', { x: 2, y: 2 }, { affinities: [grant()] }), index: 0 },
        { ...actorAt('warden_1', { x: 3, y: 3 }, { affinities: [grant()] }), index: 1 },
      ],
      resources: [],
    }),
  ], { initialActors });
  assert.equal(metrics.actor_kind_parity.value, 1);
});

test('one kind collecting while the other does not scores actor_kind_parity below 1', () => {
  const initialActors = [
    { id: 'delver_1', archetype: 'delver', role: 'delver' },
    { id: 'warden_1', archetype: 'warden', role: 'warden' },
  ];
  const metrics = extract([
    checkpoint(0, {
      actors: [
        { ...actorAt('delver_1', { x: 1, y: 1 }), index: 0 },
        { ...actorAt('warden_1', { x: 4, y: 4 }), index: 1 },
      ],
      resources: [affinityResource({ x: 2, y: 2 })],
    }),
    checkpoint(1, {
      actors: [
        { ...actorAt('delver_1', { x: 2, y: 2 }, { affinities: [grant()] }), index: 0 },
        { ...actorAt('warden_1', { x: 4, y: 4 }), index: 1 },
      ],
      resources: [],
    }),
  ], { initialActors });
  assert.equal(metrics.actor_kind_parity.value, 0.5);
});

// ## TODO: Test Permutations
test.skip("a checkpoint series with a gap in the middle still scores what it can observe", async () => {});
test.skip("two actors adjacent to the same consumed resource attribute the pickup to exactly one", async () => {});
test.skip("a vital that exceeds its max at any checkpoint fails pickup_apply_correctness", async () => {});
test.skip("a resource carrying both payloads counts once in single_consumption, not twice", async () => {});
test.skip("mana regen refilling a pool does not read as affinity_activity", async () => {});
test.skip("an actor absent from a later checkpoint does not crash the extractor", async () => {});
