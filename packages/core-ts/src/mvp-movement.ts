// @ts-nocheck
const DIR_MAP = Object.freeze({
  north: 0,
  northeast: 1,
  east: 2,
  southeast: 3,
  south: 4,
  southwest: 5,
  west: 6,
  northwest: 7,
});

const DIR_BY_CODE = Object.freeze({
  0: "north",
  1: "northeast",
  2: "east",
  3: "southeast",
  4: "south",
  5: "southwest",
  6: "west",
  7: "northwest",
});

const DEFAULT_LEGEND = Object.freeze({
  wall: "#",
  floor: ".",
  spawn: "S",
  exit: "E",
  barrier: "B",
  actor: "@",
});

const AFFINITY_KIND_BY_CODE = Object.freeze({
  1: "fire",
  2: "water",
  3: "earth",
  4: "wind",
  5: "life",
  6: "decay",
  7: "corrode",
  8: "fortify",
  9: "light",
  10: "dark",
});

const AFFINITY_EXPRESSION_BY_CODE = Object.freeze({
  1: "push",
  2: "pull",
  3: "emit",
});

function cloneResolvedEffects(effects) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({ ...entry }));
}

function collectCoreStaticHazards(core, width, height) {
  if (typeof core?.getStaticHazardAffinityAt !== "function") return [];
  const hazards = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const affinityCode = core.getStaticHazardAffinityAt(x, y);
      if (!Number.isFinite(affinityCode) || affinityCode <= 0) continue;
      const expressionCode = typeof core.getStaticHazardExpressionAt === "function"
        ? core.getStaticHazardExpressionAt(x, y)
        : 0;
      const kind = AFFINITY_KIND_BY_CODE[affinityCode] || "unknown";
      const expression = AFFINITY_EXPRESSION_BY_CODE[expressionCode] || "push";
      const stacks = typeof core.getStaticHazardStacksAt === "function"
        ? core.getStaticHazardStacksAt(x, y)
        : 1;
      const manaReserve = typeof core.getStaticHazardManaReserveAt === "function"
        ? core.getStaticHazardManaReserveAt(x, y)
        : 0;
      hazards.push({
        position: { x, y },
        affinities: [{ kind, expression, stacks, targetType: "floor" }],
        manaReserve,
      });
    }
  }
  return hazards;
}

function mergeHazardLists(primary = [], secondary = []) {
  const merged = new Map();
  const toKey = (hazard) => {
    const x = hazard?.position?.x;
    const y = hazard?.position?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return `${x},${y}`;
  };
  primary.forEach((hazard) => {
    const key = toKey(hazard);
    if (!key) return;
    merged.set(key, hazard);
  });
  secondary.forEach((hazard) => {
    const key = toKey(hazard);
    if (!key) return;
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, hazard);
      return;
    }
    merged.set(key, {
      ...prior,
      ...hazard,
      affinities: Array.isArray(prior.affinities) && prior.affinities.length
        ? prior.affinities
        : (hazard.affinities || []),
    });
  });
  return Array.from(merged.values())
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0));
}

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

export function readObservation(core, { actorIdLabel = "actor_mvp", actorIds } = {}) {
  const affinityEffects = arguments.length > 1 ? arguments[1]?.affinityEffects : null;
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  function readActorVitals({ current, max, regen }) {
    return { current, max, regen };
  }
  function readPrimaryActorVital(kindIndex) {
    return readActorVitals({
      current: core.getActorVitalCurrent(kindIndex),
      max: core.getActorVitalMax(kindIndex),
      regen: core.getActorVitalRegen(kindIndex),
    });
  }
  function readMotivatedActorVital(index, kindIndex) {
    const vital = readActorVitals({
      current: core.getMotivatedActorVitalCurrentByIndex(index, kindIndex),
      max: core.getMotivatedActorVitalMaxByIndex(index, kindIndex),
      regen: core.getMotivatedActorVitalRegenByIndex(index, kindIndex),
    });
    if (
      index === 0
      && vital.current === 0
      && vital.max === 0
      && typeof core.getActorVitalCurrent === "function"
      && typeof core.getActorVitalMax === "function"
      && typeof core.getActorVitalRegen === "function"
    ) {
      return readPrimaryActorVital(kindIndex);
    }
    return vital;
  }
  function readActorCapabilities(index) {
    if (typeof index === "number" && typeof core.getMotivatedActorMovementCostByIndex === "function") {
      return {
        movementCost: core.getMotivatedActorMovementCostByIndex(index),
        actionCostMana: typeof core.getMotivatedActorActionCostManaByIndex === "function"
          ? core.getMotivatedActorActionCostManaByIndex(index)
          : 0,
        actionCostStamina: typeof core.getMotivatedActorActionCostStaminaByIndex === "function"
          ? core.getMotivatedActorActionCostStaminaByIndex(index)
          : 0,
      };
    }
    if (typeof core.getActorMovementCost === "function") {
      return {
        movementCost: core.getActorMovementCost(),
        actionCostMana: typeof core.getActorActionCostMana === "function" ? core.getActorActionCostMana() : 0,
        actionCostStamina: typeof core.getActorActionCostStamina === "function" ? core.getActorActionCostStamina() : 0,
      };
    }
    return null;
  }

  function buildAffinitiesAndAbilities(id) {
    const metaActor = Array.isArray(affinityEffects?.actors)
      ? affinityEffects.actors.find((entry) => entry?.actorId === id)
      : null;
    const affinityTargets = metaActor?.affinityTargets || null;
    const affinityStacks = metaActor?.affinityStacks || null;
    const affinities = affinityTargets
      ? Object.keys(affinityTargets)
        .sort()
        .map((key) => {
          const [kind, expression, targetType] = key.split(":");
          return { kind, expression, targetType, stacks: affinityTargets[key] };
        })
      : affinityStacks
        ? Object.keys(affinityStacks)
          .sort()
          .map((key) => {
            const [kind, expression] = key.split(":");
            return { kind, expression, stacks: affinityStacks[key] };
          })
        : [];
    const abilities = Array.isArray(metaActor?.abilities) ? metaActor.abilities.map((ability) => ({ ...ability })) : [];
    const resolvedEffects = cloneResolvedEffects(metaActor?.resolvedEffects);
    return { affinities, abilities, resolvedEffects };
  }

  let actors = [];
  if (typeof core.getMotivatedActorCount === "function") {
    const count = core.getMotivatedActorCount();
    const normalizedActorIds = Array.isArray(actorIds)
      ? actorIds
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
      : [];
    for (let index = 0; index < count; index += 1) {
      const idValue = core.getMotivatedActorIdByIndex(index);
      const idLabel = normalizedActorIds[index] || (index === 0 ? actorIdLabel : `actor_${idValue}`);
      const { affinities, abilities, resolvedEffects } = buildAffinitiesAndAbilities(idLabel);
      actors.push({
        id: idLabel,
        kind: index === 0 ? core.getActorKind() : 2,
        position: {
          x: core.getMotivatedActorXByIndex(index),
          y: core.getMotivatedActorYByIndex(index),
        },
        vitals: {
          health: readMotivatedActorVital(index, 0),
          mana: readMotivatedActorVital(index, 1),
          stamina: readMotivatedActorVital(index, 2),
          durability: readMotivatedActorVital(index, 3),
        },
        affinities,
        abilities,
        resolvedEffects,
      });
      const capabilities = readActorCapabilities(index);
      if (capabilities) {
        actors[actors.length - 1].capabilities = capabilities;
      }
    }
  }

  if (actors.length === 0) {
    const actorId = actorIdLabel;
    const { affinities, abilities, resolvedEffects } = buildAffinitiesAndAbilities(actorId);
    actors = [
      {
        id: actorId,
        kind: core.getActorKind(),
        position: { x: core.getActorX(), y: core.getActorY() },
        vitals: {
          health: readPrimaryActorVital(0),
          mana: readPrimaryActorVital(1),
          stamina: readPrimaryActorVital(2),
          durability: readPrimaryActorVital(3),
        },
        affinities,
        abilities,
        resolvedEffects,
      },
    ];
    const capabilities = readActorCapabilities();
    if (capabilities) {
      actors[0].capabilities = capabilities;
    }
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
  const affinityHazardList = Array.isArray(affinityEffects?.hazards) && affinityEffects.hazards.length > 0
    ? affinityEffects.hazards
      .map((hazard) => {
        const position = hazard.position || (Number.isFinite(hazard.x) && Number.isFinite(hazard.y) ? { x: hazard.x, y: hazard.y } : null);
        const hazardTargets = hazard.affinityTargets || null;
        const hazardStacks = hazard.affinityStacks || null;
        const hazardAffinities = hazard.affinities
          ? hazard.affinities.map((affinity) => ({ ...affinity }))
          : hazard.affinity
            ? [{ ...hazard.affinity }]
            : hazardTargets
              ? Object.keys(hazardTargets)
                .sort()
                .map((key) => {
                  const [kind, expression, targetType] = key.split(":");
                  return { kind, expression, targetType, stacks: hazardTargets[key] };
                })
              : hazardStacks
                ? Object.keys(hazardStacks)
                  .sort()
                  .map((key) => {
                    const [kind, expression] = key.split(":");
                    return { kind, expression, stacks: hazardStacks[key] };
                  })
                : [];
        return {
          position,
          vitals: hazard.vitals ? { ...hazard.vitals } : undefined,
          abilities: Array.isArray(hazard.abilities) ? hazard.abilities.map((ability) => ({ ...ability })) : [],
          resolvedEffects: cloneResolvedEffects(hazard.resolvedEffects),
          affinities: hazardAffinities,
        };
      })
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0))
    : [];
  const coreHazardList = collectCoreStaticHazards(core, width, height);
  const mergedHazards = mergeHazardLists(affinityHazardList, coreHazardList);

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
    hazards: mergedHazards.length > 0 ? mergedHazards : undefined,
  };
}
