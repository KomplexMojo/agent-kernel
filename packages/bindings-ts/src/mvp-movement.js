const DIR_MAP = Object.freeze({
  north: 0,
  east: 1,
  south: 2,
  west: 3,
});

const DIR_BY_CODE = Object.freeze({
  0: "north",
  1: "east",
  2: "south",
  3: "west",
});

const DEFAULT_LEGEND = Object.freeze({
  wall: "#",
  floor: ".",
  spawn: "S",
  exit: "E",
  barrier: "B",
  actor: "@",
});

/**
 * Pack a move action into the bit layout expected by core-as.
 * Fields are masked to keep deterministic size (4-bit coords, 8-bit tick, 4-bit actorId).
 */
export function packMoveAction({ actorId, from, to, direction, tick }) {
  const dirCode = typeof direction === "number" ? direction : DIR_MAP[String(direction).toLowerCase()];
  const actorCode = actorId & 0xf;
  const tickCode = tick & 0xff;
  return (
    ((actorCode & 0xf) << 28) |
    ((tickCode & 0xff) << 20) |
    ((to.y & 0xf) << 16) |
    ((to.x & 0xf) << 12) |
    ((from.y & 0xf) << 8) |
    ((from.x & 0xf) << 4) |
    (dirCode & 0xf)
  );
}

export function unpackMoveAction(value) {
  return {
    direction: DIR_BY_CODE[(value >> 0) & 0xf],
    from: {
      x: (value >> 4) & 0xf,
      y: (value >> 8) & 0xf,
    },
    to: {
      x: (value >> 12) & 0xf,
      y: (value >> 16) & 0xf,
    },
    tick: (value >> 20) & 0xff,
    actorId: (value >> 28) & 0xf,
  };
}

export function renderBaseTiles(core) {
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += String.fromCharCode(core.renderBaseCellChar(x, y));
    }
    rows.push(row);
  }
  return rows;
}

export function renderFrameBuffer(core, { actorIdLabel = "actor_mvp" } = {}) {
  const baseTiles = renderBaseTiles(core);
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += String.fromCharCode(core.renderCellChar(x, y));
    }
    rows.push(row);
  }
  return {
    tick: core.getCurrentTick(),
    baseTiles,
    legend: DEFAULT_LEGEND,
    buffer: rows,
    actorPositions: {
      [actorIdLabel]: { x: core.getActorX(), y: core.getActorY() },
    },
  };
}

export function readObservation(core, { actorIdLabel = "actor_mvp" } = {}) {
  const affinityEffects = arguments.length > 1 ? arguments[1]?.affinityEffects : null;
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  const actor = {
    id: actorIdLabel,
    kind: core.getActorKind(),
    position: { x: core.getActorX(), y: core.getActorY() },
    vitals: {
      health: {
        current: core.getActorVitalCurrent(0),
        max: core.getActorVitalMax(0),
        regen: core.getActorVitalRegen(0),
      },
      mana: {
        current: core.getActorVitalCurrent(1),
        max: core.getActorVitalMax(1),
        regen: core.getActorVitalRegen(1),
      },
      stamina: {
        current: core.getActorVitalCurrent(2),
        max: core.getActorVitalMax(2),
        regen: core.getActorVitalRegen(2),
      },
      durability: {
        current: core.getActorVitalCurrent(3),
        max: core.getActorVitalMax(3),
        regen: core.getActorVitalRegen(3),
      },
    },
  };
  const metaActor = Array.isArray(affinityEffects?.actors)
    ? affinityEffects.actors.find((entry) => entry?.actorId === actor.id)
    : null;
  const affinityStacks = metaActor?.affinityStacks || null;
  const affinities = affinityStacks
    ? Object.keys(affinityStacks)
      .sort()
      .map((key) => {
        const [kind, expression] = key.split(":");
        return { kind, expression, stacks: affinityStacks[key] };
      })
    : [];
  const abilities = Array.isArray(metaActor?.abilities) ? metaActor.abilities.map((ability) => ({ ...ability })) : [];
  actor.affinities = affinities;
  actor.abilities = abilities;
  const kinds = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push(core.getTileActorKind(x, y));
    }
    kinds.push(row);
  }
  const tileActors = [];
  if (typeof core.getTileActorCount === "function") {
    const count = core.getTileActorCount();
    for (let i = 0; i < count; i += 1) {
      const tileId = core.getTileActorIdByIndex(i);
      const durability = typeof core.getTileActorDurabilityByIndex === "function"
        ? core.getTileActorDurabilityByIndex(i)
        : 0;
      tileActors.push({
        id: `tile_${tileId}`,
        kind: core.getTileActorKindByIndex(i),
        position: { x: core.getTileActorXByIndex(i), y: core.getTileActorYByIndex(i) },
        vitals: {
          health: { current: 0, max: 0, regen: 0 },
          mana: { current: 0, max: 0, regen: 0 },
          stamina: { current: 0, max: 0, regen: 0 },
          durability: { current: durability, max: durability, regen: 0 },
        },
      });
    }
  }
  return {
    tick: core.getCurrentTick(),
    actors: [actor],
    tileActors,
    actor: {
      id: actor.id,
      x: actor.position.x,
      y: actor.position.y,
      hp: actor.vitals.health.current,
      maxHp: actor.vitals.health.max,
    },
    tiles: {
      width,
      height,
      kinds,
    },
    traps: Array.isArray(affinityEffects?.traps) && affinityEffects.traps.length > 0
      ? affinityEffects.traps
        .map((trap) => {
          const position = trap.position || (Number.isFinite(trap.x) && Number.isFinite(trap.y) ? { x: trap.x, y: trap.y } : null);
          const trapStacks = trap.affinityStacks || null;
          const trapAffinities = trap.affinities
            ? trap.affinities.map((affinity) => ({ ...affinity }))
            : trap.affinity
              ? [{ ...trap.affinity }]
              : trapStacks
                ? Object.keys(trapStacks)
                  .sort()
                  .map((key) => {
                    const [kind, expression] = key.split(":");
                    return { kind, expression, stacks: trapStacks[key] };
                  })
                : [];
          return {
            position,
            vitals: trap.vitals ? { ...trap.vitals } : undefined,
            abilities: Array.isArray(trap.abilities) ? trap.abilities.map((ability) => ({ ...ability })) : [],
            affinities: trapAffinities,
          };
        })
        .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0))
      : undefined,
  };
}
