/**
 * Destroyable earth interior barriers planned by level layout and materialized
 * as barrier actors (not permanent wall terrain).
 */
const assert = require("node:assert/strict");

test("default layouts plan interior barriers on floor, not as wall terrain", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../../packages/runtime/src/personas/configurator/level-layout.js"
  );

  const result = generateGridLayoutFromInput({
    width: 36,
    height: 36,
    seed: 11,
    shape: { roomCount: 6, roomMinSize: 4, roomMaxSize: 9, corridorWidth: 1 },
    connectivity: { requirePath: true },
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const layout = result.value;
  assert.ok(Array.isArray(layout.interiorBarriers));
  assert.ok(layout.interiorBarriers.length > 0, "expected planned interior barriers");

  let wallInsideRooms = 0;
  for (const room of layout.rooms) {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        const kind = layout.terrain[y * layout.width + x];
        if (kind === "wall") wallInsideRooms += 1;
      }
    }
  }
  // Default pattern is none — barriers must not carve permanent walls in room bboxes.
  // Sculpted non-rect footprints may leave wall cells inside the bbox; those are carved
  // out of the footprint, not barrier cells. Barrier cells themselves must be floor.
  for (const cell of layout.interiorBarriers) {
    const kind = layout.terrain[cell.y * layout.width + cell.x];
    assert.notEqual(kind, "wall", `barrier at ${cell.x},${cell.y} must sit on floor`);
    assert.ok(kind === "floor" || kind === "spawn" || kind === "exit");
  }
  void wallInsideRooms;
});

test("every room receives at least one interior barrier when rooms are large enough", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  const result = generateGridLayoutFromInput({
    width: 48,
    height: 48,
    seed: 22,
    shape: { roomCount: 8, roomMinSize: 5, roomMaxSize: 10, corridorWidth: 1 },
    connectivity: { requirePath: true },
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const layout = result.value;
  const barriers = layout.interiorBarriers || [];
  for (const room of layout.rooms) {
    const inRoom = barriers.filter((cell) => (
      cell.x >= room.x && cell.x < room.x + room.width
      && cell.y >= room.y && cell.y < room.y + room.height
      && layout.terrain[cell.y * layout.width + cell.x] !== "wall"
    ));
    // Rooms that still have an interior floor cell should get a barrier.
    let interiorFloor = 0;
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        if (layout.terrain[y * layout.width + x] !== "wall") interiorFloor += 1;
      }
    }
    if (interiorFloor > 0) {
      assert.ok(inRoom.length >= 1, `room ${room.id} expected a barrier`);
    }
  }
});

test("shape.interiorBarriers false disables planned barriers", async () => {
  const { generateGridLayoutFromInput } = await import(
    "../../../packages/runtime/src/personas/configurator/level-layout.js"
  );
  const result = generateGridLayoutFromInput({
    width: 36,
    height: 36,
    seed: 3,
    shape: { roomCount: 5, roomMinSize: 4, roomMaxSize: 8, interiorBarriers: false },
    connectivity: { requirePath: true },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.interiorBarriers, []);
});

test("buildInteriorBarrierActors emits earth push barriers with positive durability", async () => {
  const { buildInteriorBarrierActors, INTERIOR_BARRIER_INTENSITY } = await import(
    "../../../packages/runtime/src/personas/configurator/interior-barriers.js"
  );
  const { raisedBarrierStats } = await import(
    "../../../packages/core-ts/src/rules/actor-cast.ts"
  );
  const { affinityTableRow } = await import(
    "../../../packages/core-ts/src/state/affinity-table.ts"
  );
  const actors = buildInteriorBarrierActors([{ x: 2, y: 3 }, { x: 4, y: 5 }]);
  assert.equal(actors.length, 2);
  const expected = raisedBarrierStats(
    INTERIOR_BARRIER_INTENSITY,
    affinityTableRow("earth").raiseScale,
  ).durability;
  for (const actor of actors) {
    assert.equal(actor.category, "barrier");
    assert.equal(actor.affinities[0].kind, "earth");
    assert.equal(actor.affinities[0].expression, "push");
    assert.equal(actor.activeAffinityKey, "earth:push");
    assert.equal(actor.vitals.durability.max, expected);
    assert.ok(actor.vitals.durability.max > 0);
    assert.equal(actor.raisedBy, undefined);
  }
});

test("an authored interior barrier without raisedBy is destroyed by pull", async () => {
  const { createActorRegistry } = await import(
    "../../../packages/core-ts/src/state/actor-registry.ts"
  );
  const { createActorTurn } = await import(
    "../../../packages/core-ts/src/rules/actor-turn.ts"
  );
  const { buildInteriorBarrierActors } = await import(
    "../../../packages/runtime/src/personas/configurator/interior-barriers.js"
  );
  const { normalizeActorDefinition } = await import(
    "../../../packages/runtime/src/personas/configurator/unified-actors.js"
  );

  const barrierAuthored = buildInteriorBarrierActors([{ x: 1, y: 0 }])[0];
  const barrier = normalizeActorDefinition(barrierAuthored).actor;
  const caster = {
    id: "hero",
    alignment: "external",
    lifecycle: "alive",
    position: { x: 0, y: 0 },
    defeatVital: "health",
    vitals: {
      health: { current: 30, max: 30, regen: 0 },
      mana: { current: 100, max: 100, regen: 0 },
      stamina: { current: 30, max: 30, regen: 0 },
    },
    capabilities: {
      canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true,
      blocksMovement: true, blocksSight: false,
    },
    motivations: [],
    affinities: [{ kind: "fire", expression: "pull", stacks: 2, intensity: 2 }],
    activeAffinityKey: "fire:pull",
    holdings: [],
  };
  const registry = createActorRegistry({
    dimensions: { width: 5, height: 1 },
    terrain: Array(5).fill("floor"),
    actors: [caster, barrier],
  });
  const turn = createActorTurn(registry, 0, {
    castManaBase: { "fire:pull": 1 },
    movementStamina: { me: 1, other: 1 },
  });
  assert.equal(turn.apply({
    actorId: "hero",
    tick: 0,
    kind: "cast_affinity",
    params: { targetId: barrier.id },
  }), true);
  assert.equal(registry.getActor(barrier.id).lifecycle, "defeated");
});
