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

function categoryOf(initialState, actor) {
  return initialState.presentation?.[actor.id]?.category;
}

function actorsByCategory(initialState, category) {
  return (initialState.actors ?? []).filter((actor) => categoryOf(initialState, actor) === category);
}

function motivationKinds(actor) {
  return (actor.motivations ?? []).map((entry) => (typeof entry === 'string' ? entry : entry?.kind)).filter(Boolean);
}

function terrainAt(layout, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || x < 0 || y >= layout.height || x >= layout.width) {
    return undefined;
  }
  return layout.terrain?.[y * layout.width + x];
}

function terrainMarker(layout, kind) {
  const index = Array.isArray(layout.terrain) ? layout.terrain.indexOf(kind) : -1;
  if (index < 0) return null;
  return { x: index % layout.width, y: Math.floor(index / layout.width) };
}

function assertExplorer(initialState, actor) {
  assert.equal(categoryOf(initialState, actor), 'delver');
  assert.equal(actor.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(actor), ['exploring']);
}

function roomContains(room, position) {
  return position.x >= room.x && position.x < room.x + room.width
    && position.y >= room.y && position.y < room.y + room.height;
}

function chebyshevDistance(left, right) {
  const from = left.position ?? left;
  const to = right.position ?? right;
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

function isWalkable(layout, position) {
  const cell = terrainAt(layout, position.x, position.y);
  return cell === 'floor' || cell === 'spawn' || cell === 'exit';
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
  const blockedKeys = new Set(blocked.map((entry) => {
    const position = entry.position ?? entry;
    return `${position.x},${position.y}`;
  }));
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

function hasWalkableCycle(layout) {
  const walkable = (x, y) => isWalkable(layout, { x, y });
  let vertices = 0;
  let edges = 0;
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
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
  assertExplorer(initialState, initialState.actors[0]);
  assert.deepEqual(initialState.actors[0].position, terrainMarker(layout, 'spawn'));
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
  assertExplorer(initialState, initialState.actors[0]);
  assert.equal(roomContains(entryRoom, initialState.actors[0].position), true);
  assert.deepEqual(initialState.actors[0].position, terrainMarker(layout, 'spawn'));
});

test('EX-TR-03 is one patrolling warden on a connected two-room loop topology', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-03');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 2);
  assert.equal(layout.connectivity.connectedRooms, 2);
  assert.equal(layout.connectivity.spawnReachable, true);
  assert.equal(layout.connectivity.exitReachable, true);
  assert.equal(hasWalkableCycle(layout), true);
  assert.equal(initialState.actors.length, 1);
  const actor = initialState.actors[0];
  assert.equal(categoryOf(initialState, actor), 'warden');
  assert.equal(actor.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(actor), ['patrolling']);
  assert.deepEqual(actor.position, terrainMarker(layout, 'spawn'));
});

test('EX-TR-04 is one stationary warden in an open room', () => {
  const { simConfig, initialState } = loadBuild('EX-TR-04');
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.ok(layout.rooms[0].width >= 5 && layout.rooms[0].height >= 5);
  assert.equal(initialState.actors.length, 1);
  const actor = initialState.actors[0];
  assert.equal(categoryOf(initialState, actor), 'warden');
  assert.deepEqual(motivationKinds(actor), ['stationary']);
  assert.equal(actor.vitals.stamina.current, 0);
  assert.deepEqual(actor.position, terrainMarker(layout, 'spawn'));
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
    initialState.actors.map((actor) => motivationKinds(actor)[0]).sort(),
    ['exploring', 'patrolling', 'random', 'stationary'],
  );

  const occupiedRoomIds = new Set(initialState.actors.map((actor) => {
    const room = layout.rooms.find((candidate) => roomContains(candidate, actor.position));
    assert.ok(room, `${actor.id} is outside every declared room`);
    return room.id;
  }));
  assert.equal(occupiedRoomIds.size, 3);

  const stationaryActors = initialState.actors.filter((actor) => motivationKinds(actor).includes('stationary'));
  const mobileActors = initialState.actors.filter((actor) => !motivationKinds(actor).includes('stationary'));
  assert.equal(mobileActors.length, 3);
  assert.equal(stationaryActors.length, 1);
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
  assert.equal(categoryOf(initialState, attacker), 'delver');
  assert.equal(attacker.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(attacker), ['attacking']);
  assert.equal(categoryOf(initialState, defender), 'warden');
  assert.equal(defender.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(defender), ['defending']);
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
  assert.equal(categoryOf(neutral.initialState, neutralAttacker), 'delver');
  assert.deepEqual(motivationKinds(neutralAttacker), ['attacking']);
  assert.deepEqual(neutralAttacker.affinities, []);
  assert.deepEqual(advantagedAttacker.affinities, [{ kind: 'fire', expression: 'push', stacks: 2 }]);
  assert.equal(advantagedAttacker.activeAffinityKey, 'fire:push');
  assert.ok(advantagedAttacker.vitals.mana.max > neutralAttacker.vitals.mana.max);
});

test('EX-CB-03 places two attacking delvers around one durable defending warden', () => {
  const { simConfig, initialState } = loadBuild('EX-CB-03', COMBAT_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  assert.equal(initialState.actors.length, 3);
  assert.equal(new Set(initialState.actors.map((actor) => actor.id)).size, 3);

  const attackers = actorsByCategory(initialState, 'delver');
  const defenders = actorsByCategory(initialState, 'warden');
  assert.equal(attackers.length, 2);
  assert.equal(defenders.length, 1);
  const defender = defenders[0];
  assert.deepEqual(motivationKinds(defender), ['defending']);
  assert.ok(defender.vitals.health.max > Math.max(...attackers.map((actor) => actor.vitals.health.max)));
  assert.ok(defender.vitals.durability.max
    > Math.max(...attackers.map((actor) => actor.vitals.durability.max)));

  for (const attacker of attackers) {
    assert.equal(categoryOf(initialState, attacker), 'delver');
    assert.equal(attacker.capabilities.canMove, true);
    assert.deepEqual(motivationKinds(attacker), ['attacking']);
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
  assert.equal(categoryOf(initialState, attacker), 'delver');
  assert.deepEqual(motivationKinds(attacker), ['attacking']);
  assert.equal(categoryOf(initialState, defender), 'warden');
  assert.deepEqual(motivationKinds(defender), ['defending']);
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
    assert.equal(categoryOf(initialState, actor), contract.role);
    assert.equal(actor.capabilities.canMove, true);
    assert.ok(motivationKinds(actor).includes(contract.posture));
    assert.deepEqual(motivationKinds(actor), contract.kinds);
    assert.equal(roomContains(layout.rooms[0], actor.position), true);
  }
  assert.deepEqual(
    initialState.actors.flatMap((actor) => motivationKinds(actor)
      .filter((kind) => ['reflexive', 'goal_oriented', 'strategy_focused'].includes(kind))).sort(),
    ['goal_oriented', 'reflexive', 'strategy_focused'],
  );
});

test('EX-HZ-01 routes an exploring delver from outside a fire emit field through its center', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-01', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  assert.equal(layout.rooms.length, 1);
  const hazards = actorsByCategory(initialState, 'hazard');
  assert.equal(hazards.length, 1);
  const hazard = hazards[0];
  const actor = actorsByCategory(initialState, 'delver')[0];
  assert.deepEqual(hazard.affinities[0], { kind: 'fire', expression: 'emit', stacks: 1 });
  assert.equal(hazard.capabilities.blocksMovement, false);
  assert.ok(hazard.vitals.mana.current > 0 && hazard.vitals.mana.regen > 0);
  assert.equal(categoryOf(initialState, actor), 'delver');
  assert.deepEqual(motivationKinds(actor), ['exploring']);
  assert.equal(chebyshevDistance(actor.position, hazard), 3);
  assert.ok(chebyshevDistance(actor.position, hazard) > 2, 'actor must start outside emit radius');
  const exitGoal = layout.exitApproach ?? terrainMarker(layout, 'exit');
  assert.deepEqual(
    { x: hazard.position.x * 2, y: hazard.position.y * 2 },
    { x: actor.position.x + exitGoal.x, y: actor.position.y + exitGoal.y },
  );
});

test('EX-HZ-02 approaches a push hazard with a legal away-displacement tile', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-02', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = actorsByCategory(initialState, 'hazard')[0];
  const actor = actorsByCategory(initialState, 'delver')[0];
  assert.deepEqual(hazard.affinities[0], { kind: 'wind', expression: 'push', stacks: 2 });
  assert.equal(hazard.capabilities.blocksMovement, false);
  assert.ok(chebyshevDistance(actor.position, hazard) > 1, 'actor must start outside push radius');
  const away = {
    x: Math.sign(actor.position.x - hazard.position.x),
    y: Math.sign(actor.position.y - hazard.position.y),
  };
  const radiusEntry = { x: hazard.position.x + away.x, y: hazard.position.y + away.y };
  const pushedTarget = { x: radiusEntry.x + away.x, y: radiusEntry.y + away.y };
  assert.equal(isWalkable(layout, radiusEntry), true);
  assert.equal(isWalkable(layout, pushedTarget), true);
  assert.equal(roomContains(layout.rooms[0], pushedTarget), true);
});

test('EX-HZ-03 approaches a pull hazard from outside its focused radius', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-03', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = actorsByCategory(initialState, 'hazard')[0];
  const actor = actorsByCategory(initialState, 'delver')[0];
  assert.deepEqual(hazard.affinities[0], { kind: 'water', expression: 'pull', stacks: 2 });
  assert.equal(hazard.capabilities.blocksMovement, false);
  assert.ok(chebyshevDistance(actor.position, hazard) > 1, 'actor must start outside pull radius');
  assert.deepEqual(motivationKinds(actor), ['exploring']);
  const exitGoal = layout.exitApproach ?? terrainMarker(layout, 'exit');
  assert.deepEqual(
    { x: hazard.position.x * 2, y: hazard.position.y * 2 },
    { x: actor.position.x + exitGoal.x, y: actor.position.y + exitGoal.y },
  );
  assert.equal(isWalkable(layout, hazard.position), true);
});

test('EX-HZ-04 places a draw hazard between its subject and an unrelated target', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-04', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazard = actorsByCategory(initialState, 'hazard')[0];
  const subject = initialState.actors.find((actor) => actor.id === 'delver_draw_subject');
  const unrelated = initialState.actors.find((actor) => actor.id === 'warden_unrelated_target');
  assert.ok(subject && unrelated);
  assert.equal(actorsByCategory(initialState, 'delver').length + actorsByCategory(initialState, 'warden').length, 2);
  assert.deepEqual(hazard.affinities[0], { kind: 'life', expression: 'draw', stacks: 2 });
  assert.deepEqual(motivationKinds(subject), ['attacking']);
  assert.deepEqual(motivationKinds(unrelated), ['stationary']);
  assert.ok(chebyshevDistance(subject.position, hazard) > 1);
  assert.ok(chebyshevDistance(unrelated.position, hazard) > 1);
  assert.deepEqual(
    { x: hazard.position.x * 2, y: hazard.position.y * 2 },
    { x: subject.position.x + unrelated.position.x, y: subject.position.y + unrelated.position.y },
  );
});

test('EX-HZ-05 blocks the unique short route while preserving a legal detour', () => {
  const { simConfig, initialState } = loadBuild('EX-HZ-05', HAZARD_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const hazards = actorsByCategory(initialState, 'hazard');
  const hazard = hazards[0];
  const actor = actorsByCategory(initialState, 'delver')[0];
  assert.equal(hazards.length, 1);
  assert.equal(hazard.capabilities.blocksMovement, true);
  assert.deepEqual(hazard.affinities[0], { kind: 'earth', expression: 'emit', stacks: 2 });
  assert.equal(categoryOf(initialState, actor), 'delver');
  assert.equal(actor.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(actor), ['exploring']);
  assert.ok(roomContains(layout.rooms[0], actor.position));
  const exitGoal = layout.exitApproach ?? terrainMarker(layout, 'exit');
  assert.ok(roomContains(layout.rooms[0], exitGoal));
  assert.ok(roomContains(layout.rooms[0], hazard.position));

  const directLength = chebyshevDistance(actor.position, exitGoal);
  assert.equal(directLength, 6);
  assert.equal(Math.abs(actor.position.x - exitGoal.x), directLength);
  assert.equal(Math.abs(actor.position.y - exitGoal.y), directLength);
  assert.deepEqual(
    { x: hazard.position.x * 2, y: hazard.position.y * 2 },
    { x: actor.position.x + exitGoal.x, y: actor.position.y + exitGoal.y },
  );
  const detourLength = shortestWalkLength(layout, actor.position, exitGoal, [hazard]);
  assert.ok(detourLength !== null, 'an alternate legal route must exist');
  assert.ok(detourLength > directLength, 'blocking hazard must control the unique shortest route');
});

test('EX-RS-01 places an injured explorer beside a consumable health resource', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-01', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const actor = actorsByCategory(initialState, 'delver')[0];
  const resources = actorsByCategory(initialState, 'resource');
  assert.equal(resources.length, 1);
  const resource = resources[0];
  assert.equal(resource.holdings[0].permanenceMode, 'consumable');
  assert.deepEqual(resource.holdings[0].vitals, [{ key: 'health', delta: 5 }]);
  assert.equal(categoryOf(initialState, actor), 'delver');
  assert.equal(actor.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(actor), ['exploring']);
  assert.ok(actor.vitals.health.current < actor.vitals.health.max);
  assert.ok(actor.vitals.health.current + resource.holdings[0].vitals[0].delta <= actor.vitals.health.max);
  assert.equal(chebyshevDistance(actor.position, resource.position), 1);
  const exitGoal = terrainMarker(layout, 'exit');
  assert.equal(
    chebyshevDistance(actor.position, resource.position)
      + chebyshevDistance(resource.position, exitGoal),
    chebyshevDistance(actor.position, exitGoal),
  );
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-02 places an explorer beside a persistent max-health resource', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-02', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const actor = actorsByCategory(initialState, 'delver')[0];
  const resources = actorsByCategory(initialState, 'resource');
  assert.equal(resources.length, 1);
  const resource = resources[0];
  assert.equal(resource.holdings[0].permanenceMode, 'level');
  assert.deepEqual(resource.holdings[0].vitals, [{ key: 'health', delta: 4 }]);
  assert.equal(categoryOf(initialState, actor), 'delver');
  assert.deepEqual(motivationKinds(actor), ['exploring']);
  assert.ok(actor.vitals.health.current < actor.vitals.health.max);
  assert.equal(chebyshevDistance(actor.position, resource.position), 1);
  const exitGoal = terrainMarker(layout, 'exit');
  assert.equal(
    chebyshevDistance(actor.position, resource.position)
      + chebyshevDistance(resource.position, exitGoal),
    chebyshevDistance(actor.position, exitGoal),
  );
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-03 places an injured explorer beside a regeneration-only resource', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-03', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const actor = actorsByCategory(initialState, 'delver')[0];
  const resources = actorsByCategory(initialState, 'resource');
  assert.equal(resources.length, 1);
  const resource = resources[0];
  assert.equal(resource.holdings[0].permanenceMode, 'level');
  assert.deepEqual(resource.holdings[0].vitals, [{ key: 'health', delta: 0, regen: 2 }]);
  assert.equal(categoryOf(initialState, actor), 'delver');
  assert.equal(actor.capabilities.canMove, true);
  assert.deepEqual(motivationKinds(actor), ['exploring']);
  assert.ok(actor.vitals.health.current < actor.vitals.health.max);
  assert.equal(actor.vitals.health.regen, 0);
  assert.equal(chebyshevDistance(actor.position, resource.position), 1);
  const exitGoal = terrainMarker(layout, 'exit');
  assert.equal(
    chebyshevDistance(actor.position, resource.position)
      + chebyshevDistance(resource.position, exitGoal),
    chebyshevDistance(actor.position, exitGoal),
  );
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-04 places a finite-mana affinity resource between opposing actors', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-04', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const resources = actorsByCategory(initialState, 'resource');
  assert.equal(resources.length, 1);
  const resource = resources[0];
  assert.equal(resource.holdings.length, 0);
  assert.deepEqual(resource.affinities[0], { kind: 'fire', expression: 'push', stacks: 2 });
  const subject = initialState.actors
    .find((actor) => actor.id === 'delver_temporary_affinity_subject-1');
  const target = initialState.actors.find((actor) => actor.id === 'warden_affinity_target-1');
  assert.ok(subject && target);
  assert.equal(categoryOf(initialState, subject), 'delver');
  assert.deepEqual(motivationKinds(subject), ['attacking']);
  assert.equal(categoryOf(initialState, target), 'warden');
  assert.deepEqual(motivationKinds(target), ['defending']);
  assert.equal(chebyshevDistance(subject.position, resource.position), 1);
  assert.equal(chebyshevDistance(resource.position, target.position), 1);
  assert.equal(chebyshevDistance(subject.position, target.position), 2);
  assert.equal(isWalkable(layout, resource.position), true);
  assert.equal(roomContains(layout.rooms[0], resource.position), true);
});

test('EX-RS-05 gives delver and warden isolated permanent-affinity pickups', () => {
  const { simConfig, initialState } = loadBuild('EX-RS-05', RESOURCE_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const resources = actorsByCategory(initialState, 'resource');
  assert.equal(resources.length, 2);
  assert.equal(new Set(resources.map((resource) => resource.id)).size, 2);
  const motivated = [...actorsByCategory(initialState, 'delver'), ...actorsByCategory(initialState, 'warden')];
  assert.equal(motivated.length, 2);
  assert.equal(new Set(motivated.map((actor) => actor.id)).size, 2);
  const expectedResourceByActor = {
    'delver_permanent_affinity_subject-1': 'resource_permanent_fire_delver',
    'warden_permanent_affinity_subject-1': 'resource_permanent_fire_warden',
  };
  const roles = new Set();
  for (const actor of motivated) {
    roles.add(categoryOf(initialState, actor));
    assert.equal(actor.capabilities.canMove, true);
    assert.deepEqual(motivationKinds(actor), ['attacking']);
    const designated = resources.find(
      (resource) => resource.id === expectedResourceByActor[actor.id],
    );
    assert.ok(designated, `missing designated resource for ${actor.id}`);
    assert.equal(chebyshevDistance(actor.position, designated.position), 1);
    const other = resources.find((resource) => resource !== designated);
    assert.ok(chebyshevDistance(actor.position, other.position) > 1);
    assert.equal(designated.affinities[0].stacks, 2);
  }
  assert.deepEqual([...roles].sort(), ['delver', 'warden']);
  assert.equal(chebyshevDistance(motivated[0].position, motivated[1].position), 1);
  for (const resource of resources) {
    assert.deepEqual(resource.affinities[0], { kind: 'fire', expression: 'emit', stacks: 2 });
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
  const hazards = actorsByCategory(initialState, 'hazard');
  const resources = actorsByCategory(initialState, 'resource');
  const motivated = [...actorsByCategory(initialState, 'delver'), ...actorsByCategory(initialState, 'warden')];
  assert.equal(hazards.length, 2);
  assert.equal(resources.length, 2);
  assert.deepEqual(
    hazards.map((hazard) => hazard.affinities[0]?.expression).sort(),
    ['emit', 'push'],
  );
  assert.ok(hazards.every((hazard) => hazard.vitals?.mana?.current > 0));
  assert.deepEqual(
    resources.map((resource) => resource.holdings[0]?.permanenceMode).sort(),
    ['consumable', 'level'],
  );

  assert.equal(motivated.length, 4);
  assert.equal(new Set(motivated.map((actor) => actor.id)).size, 4);
  assert.equal(actorsByCategory(initialState, 'delver').length, 2);
  assert.equal(actorsByCategory(initialState, 'warden').length, 2);
  assert.deepEqual(
    motivated.map((actor) => motivationKinds(actor)[0]).sort(),
    ['attacking', 'defending', 'patrolling', 'random'],
  );
  assert.ok(motivated.every((actor) => actor.capabilities.canMove
    && actor.vitals.stamina.current > 0));
  const occupiedRooms = new Set(motivated.map((actor) => {
    const room = layout.rooms.find((candidate) => roomContains(candidate, actor.position));
    assert.ok(room, `${actor.id} is outside every room`);
    return room.id;
  }));
  assert.equal(occupiedRooms.size, 3);
  for (const object of [...hazards, ...resources]) {
    assert.ok(layout.rooms.some((room) => roomContains(room, object.position)));
    assert.equal(isWalkable(layout, object.position), true);
  }
});

test('EX-ST-02 contains one delver and ten mobile random wardens with unique ids', () => {
  const { simConfig, initialState } = loadBuild('EX-ST-02', STRESS_FIXTURE_ROOT);
  const layout = simConfig.layout.data;
  const motivated = [...actorsByCategory(initialState, 'delver'), ...actorsByCategory(initialState, 'warden')];
  assert.equal(layout.rooms.length, 1);
  assert.equal(motivated.length, 11);
  assert.equal(new Set(motivated.map((actor) => actor.id)).size, 11);
  assert.equal(new Set(motivated
    .map((actor) => `${actor.position.x},${actor.position.y}`)).size, 11);
  assert.equal(actorsByCategory(initialState, 'delver').length, 1);
  assert.equal(actorsByCategory(initialState, 'warden').length, 10);
  for (const actor of motivated) {
    assert.equal(actor.capabilities.canMove, true);
    assert.deepEqual(motivationKinds(actor), ['random']);
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
  const hazards = actorsByCategory(initialState, 'hazard');
  const resources = actorsByCategory(initialState, 'resource');
  const motivated = [...actorsByCategory(initialState, 'delver'), ...actorsByCategory(initialState, 'warden')];
  assert.equal(hazards.length, 6);
  assert.equal(resources.length, 6);
  assert.equal(new Set(hazards.map((hazard) => hazard.id)).size, 6);
  assert.equal(new Set(resources.map((resource) => resource.id)).size, 6);
  assert.ok(new Set(hazards.map((hazard) => hazard.affinities[0]?.kind)).size >= 4);
  assert.ok(new Set(hazards.map((hazard) => hazard.affinities[0]?.expression)).size >= 4);
  assert.deepEqual(
    [...new Set(resources.map((resource) => resource.holdings[0]?.permanenceMode))].sort(),
    ['consumable', 'level'],
  );
  assert.equal(new Set([...hazards, ...resources]
    .map((object) => `${object.position.x},${object.position.y}`)).size, 12);
  for (const object of [...hazards, ...resources]) {
    assert.ok(layout.rooms.some((room) => roomContains(room, object.position)));
    assert.equal(isWalkable(layout, object.position), true);
  }

  assert.equal(motivated.length, 6);
  assert.equal(new Set(motivated.map((actor) => actor.id)).size, 6);
  assert.equal(actorsByCategory(initialState, 'delver').length, 2);
  assert.equal(actorsByCategory(initialState, 'warden').length, 4);
  assert.deepEqual(
    [...new Set(motivated.map((actor) => motivationKinds(actor)[0]))].sort(),
    ['attacking', 'defending', 'patrolling', 'random'],
  );
  assert.ok(motivated.every((actor) => actor.capabilities.canMove
    && actor.vitals.health.current > 0 && actor.vitals.mana.current > 0
    && actor.vitals.stamina.current > 0));
  const occupiedRooms = new Set(motivated.map((actor) => layout.rooms
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
  const motivated = [...actorsByCategory(initialState, 'delver'), ...actorsByCategory(initialState, 'warden')];
  assert.equal(motivated.length, 4);
  assert.equal(new Set(motivated.map((actor) => actor.id)).size, 4);
  assert.equal(actorsByCategory(initialState, 'delver').length, 2);
  assert.equal(actorsByCategory(initialState, 'warden').length, 2);
  assert.deepEqual(
    motivated.map((actor) => motivationKinds(actor)[0]).sort(),
    ['attacking', 'defending', 'patrolling', 'random'],
  );
  assert.ok(motivated.every((actor) => actor.capabilities.canMove
    && actor.vitals.health.current > 0 && actor.vitals.health.regen > 0
    && actor.vitals.mana.current > 0 && actor.vitals.mana.regen > 0
    && actor.vitals.stamina.current > 0 && actor.vitals.stamina.regen > 0
    && actor.vitals.durability.current > 0 && actor.vitals.durability.regen > 0));
  const occupiedRooms = new Set(motivated.map((actor) => {
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

  const motivated = [...actorsByCategory(initialState, 'delver'), ...actorsByCategory(initialState, 'warden')];
  assert.equal(motivated.length, 3);
  assert.equal(new Set(motivated.map((actor) => actor.id)).size, 3);
  assert.equal(new Set(motivated
    .map((actor) => `${actor.position.x},${actor.position.y}`)).size, 3);
  assert.equal(actorsByCategory(initialState, 'delver').length, 1);
  assert.equal(actorsByCategory(initialState, 'warden').length, 2);
  for (const actor of motivated) {
    assert.equal(actor.capabilities.canMove, true);
    assert.deepEqual(motivationKinds(actor), ['random']);
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
