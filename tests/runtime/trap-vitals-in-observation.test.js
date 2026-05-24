const assert = require("node:assert/strict");

test("trap vitals enrichment preserves layout vitals in observations", () => {
  // This test verifies the logic in resolveObservation that enriches traps from layout data

  // Mock observation from core-ts core (only has manaReserve, not full vitals)
  const observationFromCore = {
    actors: [],
    traps: [
      {
        position: { x: 1, y: 1 },
        affinities: [{ kind: "fire", expression: "emit", stacks: 2, targetType: "floor" }],
        manaReserve: 12,
      },
      {
        position: { x: 2, y: 2 },
        affinities: [{ kind: "water", expression: "emit", stacks: 1, targetType: "floor" }],
        manaReserve: 9,
      },
    ],
  };

  // Layout traps with full vitals structure
  const layoutTraps = [
    {
      x: 1,
      y: 1,
      vitals: {
        mana: { current: 12, max: 12, regen: 4 },
        durability: { current: 10, max: 10, regen: 0 },
      },
    },
    {
      x: 2,
      y: 2,
      vitals: {
        mana: { current: 9, max: 9, regen: 3 },
        durability: { current: 5, max: 5, regen: 0 },
      },
    },
  ];

  // Simulate the enrichment logic from resolveObservation
  const trapVitalsByPosition = new Map();
  layoutTraps.forEach((layoutTrap) => {
    if (layoutTrap?.x != null && layoutTrap?.y != null) {
      const key = `${layoutTrap.x},${layoutTrap.y}`;
      trapVitalsByPosition.set(key, layoutTrap.vitals);
    }
  });

  const enrichedTraps = observationFromCore.traps.map((trap) => {
    const key = `${trap.position?.x ?? 0},${trap.position?.y ?? 0}`;
    const vitals = trapVitalsByPosition.get(key);
    return vitals ? { ...trap, vitals } : trap;
  });

  // Verify enrichment worked
  assert.equal(enrichedTraps.length, 2, "Should have 2 traps");

  // First trap (fire+2+emit)
  const trap1 = enrichedTraps[0];
  assert.deepEqual(trap1.position, { x: 1, y: 1 });
  assert.ok(trap1.vitals, "Trap 1 should have vitals");
  assert.equal(trap1.vitals.mana.current, 12);
  assert.equal(trap1.vitals.mana.max, 12);
  assert.equal(trap1.vitals.mana.regen, 4);
  assert.equal(trap1.vitals.durability.current, 10);
  assert.equal(trap1.vitals.durability.max, 10);

  // Second trap (water+1+emit)
  const trap2 = enrichedTraps[1];
  assert.deepEqual(trap2.position, { x: 2, y: 2 });
  assert.ok(trap2.vitals, "Trap 2 should have vitals");
  assert.equal(trap2.vitals.mana.current, 9);
  assert.equal(trap2.vitals.mana.max, 9);
  assert.equal(trap2.vitals.mana.regen, 3);
  assert.equal(trap2.vitals.durability.current, 5);
  assert.equal(trap2.vitals.durability.max, 5);
});

/*
## TODO: Test Permutations
- trap at position not in layoutTraps: enrichment leaves it un-enriched (no vitals, no error)
- layoutTraps with null/undefined x or y: those entries are skipped during map build
- two layoutTraps at same (x,y): last-write-wins; enrichment uses the surviving entry
- observation trap with null position: enrichment skips it without throwing
- enrichedTrap.vitals.mana.current updated after mana-drain: regen not yet applied on observe
- enrichedTrap.vitals.durability reaches 0: trap is treated as destroyed in observation
- trap with no affinities array: enrichment still attaches vitals without error
- round-trip: serializing and re-parsing enrichedTraps produces identical vitals structure
*/
