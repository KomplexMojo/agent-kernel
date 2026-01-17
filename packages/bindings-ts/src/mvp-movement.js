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

export function packMoveAction({ actorId, from, to, direction, tick }) {
  const dirCode = typeof direction === "number" ? direction : DIR_MAP[String(direction).toLowerCase()];
  return [actorId, from.x, from.y, to.x, to.y, dirCode, tick];
}

export function unpackMoveAction(value) {
  const actorId = value[0];
  const fromX = value[1];
  const fromY = value[2];
  const toX = value[3];
  const toY = value[4];
  const dirCode = value[5];
  const tick = value[6];
  return {
    actorId,
    direction: DIR_BY_CODE[dirCode] ?? dirCode,
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    tick,
  };
}

export function applyMoveAction(core, value) {
  if (!core?.setMoveAction || !core?.applyAction) {
    throw new Error("Core is missing setMoveAction/applyAction; rebuild bindings.");
  }
  const actorId = value[0];
  const fromX = value[1];
  const fromY = value[2];
  const toX = value[3];
  const toY = value[4];
  const dirCode = value[5];
  const tick = value[6];
  core.setMoveAction(actorId, fromX, fromY, toX, toY, dirCode, tick);
  core.applyAction(8, 0);
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
  function readActorVitals({ current, max, regen }) {
    return { current, max, regen };
  }

  function buildAffinitiesAndAbilities(id) {
    const metaActor = Array.isArray(affinityEffects?.actors)
      ? affinityEffects.actors.find((entry) => entry?.actorId === id)
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
    return { affinities, abilities };
  }

  let actors = [];
  if (typeof core.getMotivatedActorCount === "function") {
    const count = core.getMotivatedActorCount();
    for (let index = 0; index < count; index += 1) {
      const idValue = core.getMotivatedActorIdByIndex(index);
      const idLabel = index === 0 ? actorIdLabel : `actor_${idValue}`;
      const { affinities, abilities } = buildAffinitiesAndAbilities(idLabel);
      actors.push({
        id: idLabel,
        kind: index === 0 ? core.getActorKind() : 2,
        position: {
          x: core.getMotivatedActorXByIndex(index),
          y: core.getMotivatedActorYByIndex(index),
        },
        vitals: {
          health: readActorVitals({
            current: core.getMotivatedActorVitalCurrentByIndex(index, 0),
            max: core.getMotivatedActorVitalMaxByIndex(index, 0),
            regen: core.getMotivatedActorVitalRegenByIndex(index, 0),
          }),
          mana: readActorVitals({
            current: core.getMotivatedActorVitalCurrentByIndex(index, 1),
            max: core.getMotivatedActorVitalMaxByIndex(index, 1),
            regen: core.getMotivatedActorVitalRegenByIndex(index, 1),
          }),
          stamina: readActorVitals({
            current: core.getMotivatedActorVitalCurrentByIndex(index, 2),
            max: core.getMotivatedActorVitalMaxByIndex(index, 2),
            regen: core.getMotivatedActorVitalRegenByIndex(index, 2),
          }),
          durability: readActorVitals({
            current: core.getMotivatedActorVitalCurrentByIndex(index, 3),
            max: core.getMotivatedActorVitalMaxByIndex(index, 3),
            regen: core.getMotivatedActorVitalRegenByIndex(index, 3),
          }),
        },
        affinities,
        abilities,
      });
    }
  }

  if (actors.length === 0) {
    const actorId = actorIdLabel;
    const { affinities, abilities } = buildAffinitiesAndAbilities(actorId);
    actors = [
      {
        id: actorId,
        kind: core.getActorKind(),
        position: { x: core.getActorX(), y: core.getActorY() },
        vitals: {
          health: readActorVitals({
            current: core.getActorVitalCurrent(0),
            max: core.getActorVitalMax(0),
            regen: core.getActorVitalRegen(0),
          }),
          mana: readActorVitals({
            current: core.getActorVitalCurrent(1),
            max: core.getActorVitalMax(1),
            regen: core.getActorVitalRegen(1),
          }),
          stamina: readActorVitals({
            current: core.getActorVitalCurrent(2),
            max: core.getActorVitalMax(2),
            regen: core.getActorVitalRegen(2),
          }),
          durability: readActorVitals({
            current: core.getActorVitalCurrent(3),
            max: core.getActorVitalMax(3),
            regen: core.getActorVitalRegen(3),
          }),
        },
        affinities,
        abilities,
      },
    ];
  }

  const primaryActor = actors[0];
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
    actors,
    tileActors,
    actor: {
      id: primaryActor.id,
      x: primaryActor.position.x,
      y: primaryActor.position.y,
      hp: primaryActor.vitals.health.current,
      maxHp: primaryActor.vitals.health.max,
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
