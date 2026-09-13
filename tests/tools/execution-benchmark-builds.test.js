const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const CLI = join(ROOT, 'packages/adapters-cli/src/cli/ak.mjs');
const TRAVERSAL_FIXTURE_ROOT = join(ROOT, 'tests/fixtures/benchmarks/execution/traversal');
const COMBAT_FIXTURE_ROOT = join(ROOT, 'tests/fixtures/benchmarks/execution/combat');
const HAZARD_FIXTURE_ROOT = join(ROOT, 'tests/fixtures/benchmarks/execution/hazards');
const RESOURCE_FIXTURE_ROOT = join(ROOT, 'tests/fixtures/benchmarks/execution/resources');
const STRESS_FIXTURE_ROOT = join(ROOT, 'tests/fixtures/benchmarks/execution/stress');

function loadBuild(scenarioId, fixtureRoot = TRAVERSAL_FIXTURE_ROOT) {
  const buildDir = join(fixtureRoot, scenarioId);
  return {
    buildDir,
    simConfig: JSON.parse(readFileSync(join(buildDir, 'sim-config.json'), 'utf8')),
    initialState: JSON.parse(readFileSync(join(buildDir, 'initial-state.json'), 'utf8')),
  };
}

function assertExplorer(actor) {
  assert.equal(actor.archetype, 'delver');
  assert.equal(actor.kind, 'ambulatory');
  assert.deepEqual(actor.traits?.motivations, [{ kind: 'exploring', intensity: 1 }]);
}

function roomContains(room, position) {
  return position.x >= room.x && position.x < room.x + room.width
    && position.y >= room.y && position.y < room.y + room.height;
}

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function isWalkable(layout, position) {
  return !['#', 'B'].includes(layout.tiles[position.y]?.[position.x]);
}

function walkableNeighborCount(layout, position) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx !== 0 || dy !== 0)
        && isWalkable(layout, { x: position.x + dx, y: position.y + dy })) {
        count += 1;
      }
    }
  }
  return count;
}

function shortestWalkLength(layout, start, goal, blocked = []) {
  const blockedKeys = new Set(blocked.map(({ x, y }) => `${x},${y}`));
  const queue = [{ ...start, distance: 0 }];
  const visited = new Set([`${start.x},${start.y}`]);
  const deltas = [-1, 0, 1].flatMap((dy) => [-1, 0, 1]
    .filter((dx) => dx !== 0 || dy !== 0)
    .map((dx) => ({ dx, dy })));
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.x === goal.x && current.y === goal.y) return current.distance;
    for (const { dx, dy } of deltas) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (visited.has(key) || blockedKeys.has(key) || !isWalkable(layout, next)) continue;
      visited.add(key);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }
  return null;
}

function hasWalkableCycle(tiles) {
  const walkable = (x, y) => y >= 0 && y < tiles.length && x >= 0 && x < tiles[y].length
    && !['#', 'B'].includes(tiles[y][x]);
  let vertices = 0;
  let edges = 0;
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[y].length; x += 1) {
      if (!walkable(x, y)) continue;
      vertices += 1;
      if (walkable(x + 1, y)) edges += 1;
      if (walkable(x, y + 1)) edges += 1;
    }
  }
  return vertices > 0 && edges >= vertices;
}

test('EX-TR-01 is one exploring delver in one open medium room', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-01');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.ok(layout.rooms[0].width >= 5 && layout.rooms[0].height >= 5);
  assert.deepEqual(layout.connectivity, {
    rooms: 1, connectedRooms: 1, spawnReachable: true, exitReachable: true,
  });
  assert.equal(initialState.actors.length, 1);
  assertExplorer(initialState.actors[0]);
  assert.deepEqual(initialState.actors[0].position, layout.spawn);
});

test('EX-TR-02 is one exploring delver in the entry room of three connected rooms', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-02');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 3);
  assert.equal(layout.connectivity.connectedRooms, 3);
  assert.equal(layout.connectivity.spawnReachable, true);
  assert.equal(layout.connectivity.exitReachable, true);
  assert.notEqual(layout.entryRoomId, layout.exitRoomId);
  const entryRoom = layout.rooms.find((room) => room.id === layout.entryRoomId);
  assert.ok(entryRoom);
  assert.equal(initialState.actors.length, 1);
  assertExplorer(initialState.actors[0]);
  assert.equal(roomContains(entryRoom, initialState.actors[0].position), true);
  assert.deepEqual(initialState.actors[0].position, layout.spawn);
});

test('EX-TR-03 is one patrolling warden on a connected two-room loop topology', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-03');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 2);
  assert.equal(layout.connectivity.connectedRooms, 2);
  assert.equal(layout.connectivity.spawnReachable, true);
  assert.equal(layout.connectivity.exitReachable, true);
  assert.equal(hasWalkableCycle(layout.tiles), true);
  assert.equal(initialState.actors.length, 1);
  const actor = initialState.actors[0];
  assert.equal(actor.archetype, 'warden');
  assert.equal(actor.kind, 'ambulatory');
  assert.deepEqual(actor.motivation, { kind: 'patrolling' });
  assert.deepEqual(actor.traits?.motivations, [{ kind: 'patrolling', intensity: 1 }]);
  assert.deepEqual(actor.position, layout.spawn);
});

test('EX-TR-04 is one stationary warden in an open room', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-04');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.ok(layout.rooms[0].width >= 5 && layout.rooms[0].height >= 5);
  assert.equal(initialState.actors.length, 1);
  const actor = initialState.actors[0];
  assert.equal(actor.archetype, 'warden');
  assert.equal(actor.kind, 'stationary');
  assert.deepEqual(actor.motivation, { kind: 'stationary' });
  assert.deepEqual(actor.traits?.motivations, [{ kind: 'stationary', intensity: 1 }]);
  assert.equal(actor.vitals.stamina.current, 0);
  assert.deepEqual(actor.position, layout.spawn);
});

test('EX-TR-05 spans three rooms with all four traversal motivations', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-05');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 3);
  assert.equal(layout.connectivity.connectedRooms, 3);
  assert.equal(layout.connectivity.spawnReachable, true);
  assert.equal(layout.connectivity.exitReachable, true);

  assert.equal(initialState.actors.length, 4);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 4);
  assert.deepEqual(
    initialState.actors.map((actor) => actor.motivation.kind).sort(),
    ['exploring', 'patrolling', 'random', 'stationary'],
  );
  for (const actor of initialState.actors) {
    assert.equal(actor.traits?.motivations?.[0]?.kind, actor.motivation.kind);
  }

  const occupiedRoomIds = new Set(initialState.actors.map((actor) => {
    const room = layout.rooms.find((candidate) => roomContains(candidate, actor.position));
    assert.ok(room, `${actor.id} is outside every declared room`);
    return room.id;
  }));
  assert.equal(occupiedRoomIds.size, 3);

  const mobileActors = initialState.actors.filter((actor) => actor.kind === 'ambulatory');
  const stationaryActors = initialState.actors.filter((actor) => actor.kind === 'stationary');
  assert.equal(mobileActors.length, 3);
  assert.equal(stationaryActors.length, 1);
  assert.equal(stationaryActors[0].motivation.kind, 'stationary');
  assert.equal(stationaryActors[0].vitals.stamina.current, 0);
});

test('EX-CB-01 starts an attacking delver adjacent to a defending warden', () => {
  const { simConfig, initialState } = loadBuild('EX-CB-01', COMBAT_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(layout.connectivity.connectedRooms, 1);
  assert.equal(initialState.actors.length, 2);

  const attacker = initialState.actors.find((actor) => actor.id === 'delver_attacker');
  const defender = initialState.actors.find((actor) => actor.id === 'warden_defender');
  assert.ok(attacker);
  assert.ok(defender);
  assert.equal(attacker.archetype, 'delver');
  assert.equal(attacker.role, 'delver');
  assert.equal(attacker.kind, 'ambulatory');
  assert.deepEqual(attacker.motivation, { kind: 'attacking' });
  assert.deepEqual(attacker.traits?.motivations, [{ kind: 'attacking', intensity: 1 }]);
  assert.equal(defender.archetype, 'warden');
  assert.equal(defender.role, 'warden');
  assert.equal(defender.kind, 'ambulatory');
  assert.deepEqual(defender.motivation, { kind: 'defending' });
  assert.deepEqual(defender.traits?.motivations, [{ kind: 'defending', intensity: 1 }]);
  assert.equal(
    Math.abs(attacker.position.x - defender.position.x)
      + Math.abs(attacker.position.y - defender.position.y),
    1,
  );
  assert.ok(attacker.vitals.health.current > 0 && defender.vitals.health.current > 0);
  assert.ok(layout.rooms.every((room) => [attacker, defender]
    .every((actor) => roomContains(room, actor.position))));
});

test('EX-CB-02 variants differ only by the declared attacker affinity advantage', () => {
  const neutral = loadBuild('EX-CB-02/neutral', COMBAT_FIXTURE_ROOT);
  const advantaged = loadBuild('EX-CB-02/advantaged', COMBAT_FIXTURE_ROOT);
  assert.equal(neutral.simConfig.seed, advantaged.simConfig.seed);
  assert.deepEqual(neutral.simConfig.layout, advantaged.simConfig.layout);

  const neutralAttacker = neutral.initialState.actors
    .find((actor) => actor.id === 'delver_affinity_attacker');
  const advantagedAttacker = advantaged.initialState.actors
    .find((actor) => actor.id === 'delver_affinity_attacker');
  const neutralDefender = neutral.initialState.actors
    .find((actor) => actor.id === 'warden_affinity_defender');
  const advantagedDefender = advantaged.initialState.actors
    .find((actor) => actor.id === 'warden_affinity_defender');
  assert.ok(neutralAttacker && advantagedAttacker && neutralDefender && advantagedDefender);
  assert.deepEqual(neutralDefender, advantagedDefender);
  assert.equal(neutralAttacker.role, 'delver');
  assert.deepEqual(neutralAttacker.motivation, { kind: 'attacking' });
  assert.equal(neutralAttacker.traits.affinities, undefined);

  assert.deepEqual(advantagedAttacker.traits.affinities, { 'fire:push': 2 });
  assert.deepEqual(advantagedAttacker.traits.affinityTargets, { 'fire:push:enemy': 2 });
  assert.deepEqual(advantagedAttacker.traits.abilities, [{
    id: 'fire_bolt', kind: 'attack', affinityKind: 'fire', expression: 'push',
    targetType: 'enemy', potency: 4, manaCost: 6,
  }]);
  assert.deepEqual(advantagedAttacker.traits.resolvedEffects, [{
    id: 'fire:push:enemy:vital', category: 'vital', operation: 'apply_vital_affinity',
    sourceType: 'actor', sourceId: 'delver_affinity_attacker', kind: 'fire', expression: 'push',
    stacks: 2, targetType: 'enemy', targetVital: 'health', potency: 2,
  }]);

  const normalizedAdvantaged = JSON.parse(JSON.stringify(advantagedAttacker));
  delete normalizedAdvantaged.traits.affinities;
  delete normalizedAdvantaged.traits.affinityTargets;
  delete normalizedAdvantaged.traits.abilities;
  delete normalizedAdvantaged.traits.resolvedEffects;
  normalizedAdvantaged.vitals.mana.max -= 2;
  assert.deepEqual(normalizedAdvantaged, neutralAttacker);
});

test('EX-CB-03 places two attacking delvers around one durable defending warden', () => {
  const { simConfig, initialState } = loadBuild('EX-CB-03', COMBAT_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(initialState.actors.length, 3);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 3);

  const attackers = initialState.actors.filter((actor) => actor.role === 'delver');
  const defenders = initialState.actors.filter((actor) => actor.role === 'warden');
  assert.equal(attackers.length, 2);
  assert.equal(defenders.length, 1);
  const defender = defenders[0];
  assert.deepEqual(defender.motivation, { kind: 'defending' });
  assert.deepEqual(defender.traits?.motivations, [{ kind: 'defending', intensity: 1 }]);
  assert.ok(defender.vitals.health.max > Math.max(...attackers.map((actor) => actor.vitals.health.max)));
  assert.ok(defender.vitals.durability.max
    > Math.max(...attackers.map((actor) => actor.vitals.durability.max)));

  for (const attacker of attackers) {
    assert.equal(attacker.archetype, 'delver');
    assert.equal(attacker.kind, 'ambulatory');
    assert.deepEqual(attacker.motivation, { kind: 'attacking' });
    assert.deepEqual(attacker.traits?.motivations, [{ kind: 'attacking', intensity: 1 }]);
    assert.equal(
      Math.abs(attacker.position.x - defender.position.x)
        + Math.abs(attacker.position.y - defender.position.y),
      1,
    );
  }
  assert.ok(initialState.actors.every((actor) => roomContains(layout.rooms[0], actor.position)));
});

test('EX-CB-04 starts an attacker beside a high-health regenerating defender', () => {
  const { simConfig, initialState } = loadBuild('EX-CB-04', COMBAT_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(initialState.actors.length, 2);
  const attacker = initialState.actors.find((actor) => actor.id === 'delver_endurance_attacker');
  const defender = initialState.actors
    .find((actor) => actor.id === 'warden_regenerating_defender');
  assert.ok(attacker && defender);
  assert.equal(attacker.role, 'delver');
  assert.deepEqual(attacker.motivation, { kind: 'attacking' });
  assert.equal(defender.role, 'warden');
  assert.deepEqual(defender.motivation, { kind: 'defending' });
  assert.ok(defender.vitals.health.max >= attacker.vitals.health.max * 3);
  assert.ok(defender.vitals.health.current < defender.vitals.health.max);
  assert.ok(defender.vitals.health.regen > 0);
  assert.ok(defender.vitals.durability.max > attacker.vitals.durability.max);
  assert.equal(
    Math.abs(attacker.position.x - defender.position.x)
      + Math.abs(attacker.position.y - defender.position.y),
    1,
  );
  assert.ok(initialState.actors.every((actor) => roomContains(layout.rooms[0], actor.position)));
});

test('EX-CB-05 gives every actor one mobility, posture, and cognition motivation', () => {
  const { simConfig, initialState } = loadBuild('EX-CB-05', COMBAT_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(initialState.actors.length, 3);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 3);
  assert.equal(new Set(initialState.actors
    .map((actor) => `${actor.position.x},${actor.position.y}`)).size, 3);

  const expected = {
    delver_reflexive_attacker: {
      role: 'delver', posture: 'attacking', kinds: ['random', 'attacking', 'reflexive'],
    },
    warden_goal_attacker: {
      role: 'warden', posture: 'attacking', kinds: ['patrolling', 'attacking', 'goal_oriented'],
    },
    warden_strategy_defender: {
      role: 'warden', posture: 'defending', kinds: ['exploring', 'defending', 'strategy_focused'],
    },
  };
  for (const actor of initialState.actors) {
    const contract = expected[actor.id];
    assert.ok(contract, `unexpected actor ${actor.id}`);
    assert.equal(actor.role, contract.role);
    assert.equal(actor.kind, 'ambulatory');
    assert.deepEqual(actor.motivation, { kind: contract.posture });
    assert.deepEqual(actor.traits.motivations.map((motivation) => motivation.kind), contract.kinds);
    assert.ok(actor.traits.motivations.every((motivation) => motivation.intensity === 1));
    assert.equal(roomContains(layout.rooms[0], actor.position), true);
  }
  assert.deepEqual(
    initialState.actors.flatMap((actor) => actor.traits.motivations
      .filter((motivation) => ['reflexive', 'goal_oriented', 'strategy_focused']
        .includes(motivation.kind))
      .map((motivation) => motivation.kind)).sort(),
    ['goal_oriented', 'reflexive', 'strategy_focused'],
  );
});

test('EX-HZ-01 routes an exploring delver from outside a fire emit field through its center', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-01', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(layout.hazards.length, 1);
  const hazard = layout.hazards[0];
  const actor = initialState.actors[0];
  assert.deepEqual(hazard.affinity, { kind: 'fire', expression: 'emit', stacks: 1 });
  assert.equal(hazard.blocking, false);
  assert.ok(hazard.vitals.mana.current > 0 && hazard.vitals.mana.regen > 0);
  assert.equal(actor.role, 'delver');
  assert.deepEqual(actor.motivation, { kind: 'exploring' });
  assert.equal(chebyshevDistance(actor.position, hazard), 3);
  assert.ok(chebyshevDistance(actor.position, hazard) > 2, 'actor must start outside emit radius');
  assert.deepEqual(
    { x: hazard.x * 2, y: hazard.y * 2 },
    { x: actor.position.x + (layout.exitApproach?.x ?? layout.exit.x), y: actor.position.y + (layout.exitApproach?.y ?? layout.exit.y) },
  );
});

test('EX-HZ-02 approaches a push hazard with a legal away-displacement tile', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-02', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = layout.hazards[0];
  const actor = initialState.actors[0];
  assert.deepEqual(hazard.affinity, { kind: 'wind', expression: 'push', stacks: 2 });
  assert.equal(hazard.blocking, false);
  assert.ok(chebyshevDistance(actor.position, hazard) > 1, 'actor must start outside push radius');
  const away = {
    x: Math.sign(actor.position.x - hazard.x),
    y: Math.sign(actor.position.y - hazard.y),
  };
  const radiusEntry = { x: hazard.x + away.x, y: hazard.y + away.y };
  const pushedTarget = { x: radiusEntry.x + away.x, y: radiusEntry.y + away.y };
  assert.equal(isWalkable(layout, radiusEntry), true);
  assert.equal(isWalkable(layout, pushedTarget), true);
  assert.equal(roomContains(layout.rooms[0], pushedTarget), true);
});

test('EX-HZ-03 approaches a pull hazard from outside its focused radius', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-03', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = layout.hazards[0];
  const actor = initialState.actors[0];
  assert.deepEqual(hazard.affinity, { kind: 'water', expression: 'pull', stacks: 2 });
  assert.equal(hazard.blocking, false);
  assert.ok(chebyshevDistance(actor.position, hazard) > 1, 'actor must start outside pull radius');
  assert.deepEqual(actor.motivation, { kind: 'exploring' });
  assert.deepEqual(
    { x: hazard.x * 2, y: hazard.y * 2 },
    { x: actor.position.x + (layout.exitApproach?.x ?? layout.exit.x), y: actor.position.y + (layout.exitApproach?.y ?? layout.exit.y) },
  );
  assert.equal(isWalkable(layout, hazard), true);
});

test('EX-HZ-04 places a draw hazard between its subject and an unrelated target', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-04', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = layout.hazards[0];
  const subject = initialState.actors.find((actor) => actor.id === 'delver_draw_subject');
  const unrelated = initialState.actors.find((actor) => actor.id === 'warden_unrelated_target');
  assert.ok(subject && unrelated);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 2);
  assert.deepEqual(hazard.affinity, { kind: 'life', expression: 'draw', stacks: 2 });
  assert.deepEqual(subject.motivation, { kind: 'attacking' });
  assert.deepEqual(unrelated.motivation, { kind: 'stationary' });
  assert.equal(unrelated.kind, 'stationary');
  assert.ok(chebyshevDistance(subject.position, hazard) > 1);
  assert.ok(chebyshevDistance(unrelated.position, hazard) > 1);
  assert.deepEqual(
    { x: hazard.x * 2, y: hazard.y * 2 },
    { x: subject.position.x + unrelated.position.x, y: subject.position.y + unrelated.position.y },
  );
});

test('EX-HZ-05 blocks the unique short route while preserving a legal detour', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-05', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = layout.hazards[0];
  const actor = initialState.actors[0];
  assert.equal(layout.hazards.length, 1);
  assert.equal(hazard.blocking, true);
  assert.deepEqual(hazard.affinity, { kind: 'earth', expression: 'emit', stacks: 2 });
  assert.equal(actor.role, 'delver');
  assert.equal(actor.kind, 'ambulatory');
  assert.deepEqual(actor.motivation, { kind: 'exploring' });
  assert.deepEqual(actor.traits?.motivations, [{ kind: 'exploring', intensity: 1 }]);
  assert.ok(roomContains(layout.rooms[0], actor.position));
  assert.ok(roomContains(layout.rooms[0], layout.exitApproach ?? layout.exit));
  assert.ok(roomContains(layout.rooms[0], hazard));

  const exitGoal = layout.exitApproach ?? layout.exit;
  const directLength = chebyshevDistance(actor.position, exitGoal);
  assert.equal(directLength, 6);
  assert.equal(Math.abs(actor.position.x - exitGoal.x), directLength);
  assert.equal(Math.abs(actor.position.y - exitGoal.y), directLength);
  assert.deepEqual(
    { x: hazard.x * 2, y: hazard.y * 2 },
    { x: actor.position.x + exitGoal.x, y: actor.position.y + exitGoal.y },
  );
  const detourLength = shortestWalkLength(layout, actor.position, exitGoal, [hazard]);
  assert.ok(detourLength !== null, 'an alternate legal route must exist');
  assert.ok(detourLength > directLength, 'blocking hazard must control the unique shortest route');
});

test('EX-RS-01 places an injured explorer beside a consumable health resource', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-01', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const actor = initialState.actors[0];
  assert.equal(layout.resources.length, 1);
  const resource = layout.resources[0];
  assert.equal(resource.permanenceMode, 'consumable');
  assert.deepEqual(resource.vitals, [{ key: 'health', delta: 5 }]);
  assert.equal(actor.role, 'delver');
  assert.equal(actor.kind, 'ambulatory');
  assert.deepEqual(actor.motivation, { kind: 'exploring' });
  assert.deepEqual(actor.traits?.motivations, [{ kind: 'exploring', intensity: 1 }]);
  assert.ok(actor.vitals.health.current < actor.vitals.health.max);
  assert.ok(actor.vitals.health.current + resource.vitals[0].delta <= actor.vitals.health.max);
  assert.equal(chebyshevDistance(actor.position, resource.position), 1);
  assert.equal(
    chebyshevDistance(actor.position, resource.position)
      + chebyshevDistance(resource.position, layout.exit),
    chebyshevDistance(actor.position, layout.exit),
  );
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-02 places an explorer beside a persistent max-health resource', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-02', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const actor = initialState.actors[0];
  assert.equal(layout.resources.length, 1);
  const resource = layout.resources[0];
  assert.equal(resource.permanenceMode, 'level');
  assert.deepEqual(resource.vitals, [{ key: 'health', delta: 4 }]);
  assert.equal(actor.role, 'delver');
  assert.deepEqual(actor.motivation, { kind: 'exploring' });
  assert.ok(actor.vitals.health.current < actor.vitals.health.max);
  assert.equal(chebyshevDistance(actor.position, resource.position), 1);
  assert.equal(
    chebyshevDistance(actor.position, resource.position)
      + chebyshevDistance(resource.position, layout.exit),
    chebyshevDistance(actor.position, layout.exit),
  );
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-03 places an injured explorer beside a regeneration-only resource', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-03', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const actor = initialState.actors[0];
  assert.equal(layout.resources.length, 1);
  const resource = layout.resources[0];
  assert.equal(resource.permanenceMode, 'level');
  assert.deepEqual(resource.vitals, [{ key: 'health', delta: 0, regen: 2 }]);
  assert.equal(actor.role, 'delver');
  assert.equal(actor.kind, 'ambulatory');
  assert.deepEqual(actor.motivation, { kind: 'exploring' });
  assert.deepEqual(actor.traits?.motivations, [{ kind: 'exploring', intensity: 1 }]);
  assert.ok(actor.vitals.health.current < actor.vitals.health.max);
  assert.equal(actor.vitals.health.regen, 0);
  assert.equal(chebyshevDistance(actor.position, resource.position), 1);
  assert.equal(
    chebyshevDistance(actor.position, resource.position)
      + chebyshevDistance(resource.position, layout.exit),
    chebyshevDistance(actor.position, layout.exit),
  );
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-04 places a finite-mana affinity resource between opposing actors', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-04', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.resources.length, 1);
  const resource = layout.resources[0];
  assert.equal(resource.permanenceMode, 'consumable');
  assert.deepEqual(resource.vitals, []);
  assert.deepEqual(resource.affinity, {
    kind: 'fire', expression: 'push', stacks: 2, mana: 12, manaRegen: 0,
  });
  const subject = initialState.actors
    .find((actor) => actor.id === 'delver_temporary_affinity_subject-1');
  const target = initialState.actors.find((actor) => actor.id === 'warden_affinity_target-1');
  assert.ok(subject && target);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 2);
  assert.equal(subject.role, 'delver');
  assert.deepEqual(subject.motivation, { kind: 'attacking' });
  assert.deepEqual(subject.traits.affinities, { life: 1 });
  assert.equal(subject.traits.affinities.fire, undefined);
  assert.equal(target.role, 'warden');
  assert.deepEqual(target.motivation, { kind: 'defending' });
  assert.deepEqual(target.traits.affinities, { dark: 1 });
  assert.equal(chebyshevDistance(subject.position, resource.position), 1);
  assert.equal(chebyshevDistance(resource.position, target.position), 1);
  assert.equal(chebyshevDistance(subject.position, target.position), 2);
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-05 gives delver and warden isolated permanent-affinity pickups', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-05', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.resources.length, 2);
  assert.equal(new Set(layout.resources.map((resource) => resource.id)).size, 2);
  assert.equal(initialState.actors.length, 2);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 2);
  const expectedResourceByActor = {
    'delver_permanent_affinity_subject-1': 'resource_permanent_fire_delver',
    'warden_permanent_affinity_subject-1': 'resource_permanent_fire_warden',
  };
  const roles = new Set();
  for (const actor of initialState.actors) {
    roles.add(actor.role);
    assert.equal(actor.kind, 'ambulatory');
    assert.deepEqual(actor.motivation, { kind: 'attacking' });
    assert.deepEqual(actor.traits.affinities, { fire: 1 });
    assert.deepEqual(actor.traits.motivations, [{ kind: 'attacking', intensity: 1 }]);
    const designated = layout.resources.find(
      (resource) => resource.id === expectedResourceByActor[actor.id],
    );
    assert.ok(designated, `missing designated resource for ${actor.id}`);
    assert.equal(chebyshevDistance(actor.position, designated.position), 1);
    const other = layout.resources.find((resource) => resource !== designated);
    assert.ok(chebyshevDistance(actor.position, other.position) > 1);
    assert.equal(actor.traits.affinities.fire + designated.affinity.stacks, 3);
  }
  assert.deepEqual([...roles].sort(), ['delver', 'warden']);
  assert.equal(chebyshevDistance(initialState.actors[0].position, initialState.actors[1].position), 1);
  for (const resource of layout.resources) {
    assert.equal(resource.permanenceMode, 'consumable');
    assert.deepEqual(resource.vitals, []);
    assert.deepEqual(resource.affinity, {
      kind: 'fire', expression: 'emit', stacks: 2, mana: 12, manaRegen: 2,
    });
    assert.equal(isWalkable(layout, resource.position), true);
    assert.equal(roomContains(layout.rooms[0], resource.position), true);
  }
});

test('EX-ST-01 combines three occupied rooms, mixed actors, hazards, and resources', () => {
  const { simConfig, initialState } = loadBuild('EX-ST-01', STRESS_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 3);
  assert.deepEqual(layout.connectivity, {
    rooms: 3, connectedRooms: 3, spawnReachable: true, exitReachable: true,
  });
  assert.equal(layout.hazards.length, 2);
  assert.equal(layout.resources.length, 2);
  assert.deepEqual(
    layout.hazards.map((hazard) => hazard.expression).sort(),
    ['emit', 'push'],
  );
  assert.ok(layout.hazards.every((hazard) => hazard.vitals?.mana?.current > 0));
  assert.deepEqual(
    layout.resources.map((resource) => resource.permanenceMode).sort(),
    ['consumable', 'level'],
  );

  assert.equal(initialState.actors.length, 4);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 4);
  assert.equal(initialState.actors.filter((actor) => actor.role === 'delver').length, 2);
  assert.equal(initialState.actors.filter((actor) => actor.role === 'warden').length, 2);
  assert.deepEqual(
    initialState.actors.map((actor) => actor.motivation.kind).sort(),
    ['attacking', 'defending', 'patrolling', 'random'],
  );
  assert.ok(initialState.actors.every((actor) => actor.kind === 'ambulatory'
    && actor.vitals.stamina.current > 0));
  const occupiedRooms = new Set(initialState.actors.map((actor) => {
    const room = layout.rooms.find((candidate) => roomContains(candidate, actor.position));
    assert.ok(room, `${actor.id} is outside every room`);
    return room.id;
  }));
  assert.equal(occupiedRooms.size, 3);
  for (const object of [...layout.hazards, ...layout.resources]) {
    const position = object.position || object;
    assert.ok(layout.rooms.some((room) => roomContains(room, position)));
    assert.equal(isWalkable(layout, position), true);
  }
});

test('EX-ST-02 contains one delver and ten mobile random wardens with unique ids', () => {
  const { simConfig, initialState } = loadBuild('EX-ST-02', STRESS_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(initialState.actors.length, 11);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 11);
  assert.equal(new Set(initialState.actors
    .map((actor) => `${actor.position.x},${actor.position.y}`)).size, 11);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'delver').length, 1);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'warden').length, 10);
  for (const actor of initialState.actors) {
    assert.equal(actor.kind, 'ambulatory');
    assert.deepEqual(actor.motivation, { kind: 'random' });
    assert.ok(actor.vitals.stamina.current > 0 && actor.vitals.stamina.regen > 0);
    assert.equal(roomContains(layout.rooms[0], actor.position), true);
    assert.equal(isWalkable(layout, actor.position), true);
  }
});

test('EX-ST-03 is a dense four-room field with six hazards and six resources', () => {
  const { simConfig, initialState } = loadBuild('EX-ST-03', STRESS_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 4);
  assert.deepEqual(layout.connectivity, {
    rooms: 4, connectedRooms: 4, spawnReachable: true, exitReachable: true,
  });
  assert.equal(layout.hazards.length, 6);
  assert.equal(layout.resources.length, 6);
  assert.equal(new Set(layout.hazards.map((hazard) => hazard.id)).size, 6);
  assert.equal(new Set(layout.resources.map((resource) => resource.id)).size, 6);
  assert.ok(new Set(layout.hazards.map((hazard) => hazard.affinity)).size >= 6);
  assert.ok(new Set(layout.hazards.map((hazard) => hazard.expression)).size >= 4);
  assert.deepEqual(
    [...new Set(layout.resources.map((resource) => resource.permanenceMode))].sort(),
    ['consumable', 'level'],
  );
  assert.equal(new Set([...layout.hazards, ...layout.resources]
    .map((object) => `${object.position.x},${object.position.y}`)).size, 12);
  for (const object of [...layout.hazards, ...layout.resources]) {
    assert.ok(layout.rooms.some((room) => roomContains(room, object.position)));
    assert.equal(isWalkable(layout, object.position), true);
  }

  assert.equal(initialState.actors.length, 6);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 6);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'delver').length, 2);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'warden').length, 4);
  assert.deepEqual(
    [...new Set(initialState.actors.map((actor) => actor.motivation.kind))].sort(),
    ['attacking', 'defending', 'patrolling', 'random'],
  );
  assert.ok(initialState.actors.every((actor) => actor.kind === 'ambulatory'
    && actor.vitals.health.current > 0 && actor.vitals.mana.current > 0
    && actor.vitals.stamina.current > 0));
  const occupiedRooms = new Set(initialState.actors.map((actor) => layout.rooms
    .find((room) => roomContains(room, actor.position))?.id));
  assert.equal(occupiedRooms.has(undefined), false);
  assert.ok(occupiedRooms.size >= 2);
});

test('EX-ST-04 is a connected four-actor combat and movement soak setup', () => {
  const { simConfig, initialState } = loadBuild('EX-ST-04', STRESS_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 2);
  assert.deepEqual(layout.connectivity, {
    rooms: 2, connectedRooms: 2, spawnReachable: true, exitReachable: true,
  });
  assert.equal(initialState.actors.length, 4);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 4);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'delver').length, 2);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'warden').length, 2);
  assert.deepEqual(
    initialState.actors.map((actor) => actor.motivation.kind).sort(),
    ['attacking', 'defending', 'patrolling', 'random'],
  );
  assert.ok(initialState.actors.every((actor) => actor.kind === 'ambulatory'
    && actor.vitals.health.current > 0 && actor.vitals.health.regen > 0
    && actor.vitals.mana.current > 0 && actor.vitals.mana.regen > 0
    && actor.vitals.stamina.current > 0 && actor.vitals.stamina.regen > 0
    && actor.vitals.durability.current > 0 && actor.vitals.durability.regen > 0));
  const occupiedRooms = new Set(initialState.actors.map((actor) => {
    const room = layout.rooms.find((candidate) => roomContains(candidate, actor.position));
    assert.ok(room, `${actor.id} is outside every room`);
    return room.id;
  }));
  assert.equal(occupiedRooms.size, 2);
});

test('EX-ST-05 isolates random mobility on a branching field for replay comparison', () => {
  const { simConfig, initialState } = loadBuild('EX-ST-05', STRESS_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.ok(layout.rooms[0].width >= 8 && layout.rooms[0].height >= 8);
  assert.deepEqual(layout.connectivity, {
    rooms: 1, connectedRooms: 1, spawnReachable: true, exitReachable: true,
  });
  assert.equal(layout.hazards, undefined);
  assert.equal(layout.resources, undefined);

  assert.equal(initialState.actors.length, 3);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 3);
  assert.equal(new Set(initialState.actors
    .map((actor) => `${actor.position.x},${actor.position.y}`)).size, 3);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'delver').length, 1);
  assert.equal(initialState.actors.filter((actor) => actor.archetype === 'warden').length, 2);
  for (const actor of initialState.actors) {
    assert.equal(actor.kind, 'ambulatory');
    assert.deepEqual(actor.motivation, { kind: 'random' });
    assert.ok(actor.vitals.stamina.current > 0 && actor.vitals.stamina.regen > 0);
    assert.equal(roomContains(layout.rooms[0], actor.position), true);
    assert.equal(isWalkable(layout, actor.position), true);
    assert.ok(walkableNeighborCount(layout, actor.position) >= 3,
      `${actor.id} lacks enough initial branches to exercise seed sensitivity`);
  }
});

test('committed execution builds pass the public CLI zero-tick smoke boundary', () => {
  const builds = [
    ...['EX-TR-01', 'EX-TR-02', 'EX-TR-03', 'EX-TR-04', 'EX-TR-05']
      .map((scenarioId) => [scenarioId, TRAVERSAL_FIXTURE_ROOT]),
    ...['EX-CB-01', 'EX-CB-02/neutral', 'EX-CB-02/advantaged', 'EX-CB-03', 'EX-CB-04', 'EX-CB-05']
      .map((scenarioId) => [scenarioId, COMBAT_FIXTURE_ROOT]),
    ...['EX-HZ-01', 'EX-HZ-02', 'EX-HZ-03', 'EX-HZ-04', 'EX-HZ-05']
      .map((scenarioId) => [scenarioId, HAZARD_FIXTURE_ROOT]),
    ...['EX-RS-01', 'EX-RS-02', 'EX-RS-03', 'EX-RS-04', 'EX-RS-05']
      .map((scenarioId) => [scenarioId, RESOURCE_FIXTURE_ROOT]),
    ...['EX-ST-01', 'EX-ST-02', 'EX-ST-03', 'EX-ST-04', 'EX-ST-05']
      .map((scenarioId) => [scenarioId, STRESS_FIXTURE_ROOT]),
  ];
  for (const [scenarioId, fixtureRoot] of builds) {
    const { buildDir } = loadBuild(scenarioId, fixtureRoot);
    const safeScenarioId = scenarioId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const outDir = mkdtempSync(join(tmpdir(), `ak-${safeScenarioId}-`));
    execFileSync(process.execPath, [CLI, 'run',
      '--sim-config', join(buildDir, 'sim-config.json'),
      '--initial-state', join(buildDir, 'initial-state.json'),
      '--ticks', '0', '--seed', '0', '--out-dir', outDir,
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const name of ['tick-frames.json', 'effects-log.json', 'run-summary.json']) {
      assert.equal(existsSync(join(outDir, name)), true, `${scenarioId} did not emit ${name}`);
    }
  }
});

// ## TODO: Test Permutations
// - a traversal actor positioned outside the declared entry room is rejected by setup validation
// - a disconnected three-room layout fails the traversal fixture contract before CLI execution
// - a mobile traversal actor without an exploring motivation is rejected
