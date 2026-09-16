// @ts-nocheck
import { getAffinityKindCount, getAffinityVitalEffect } from "./state/affinity.ts";
import { VitalKind } from "./state/vitals.ts";

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
  4: "draw",
});

function readActorAffinityGrants(core, index) {
  if (
    typeof core?.getMotivatedActorAffinityGrantCountByIndex !== "function"
    || typeof core?.getMotivatedActorAffinityGrantKindAt !== "function"
  ) {
    return [];
  }
  const count = core.getMotivatedActorAffinityGrantCountByIndex(index);
  if (!Number.isInteger(count) || count <= 0) return [];
  const grants = [];
  for (let slot = 0; slot < count; slot += 1) {
    const kindCode = core.getMotivatedActorAffinityGrantKindAt(index, slot);
    const expressionCode = core.getMotivatedActorAffinityGrantExpressionAt(index, slot);
    if (!Number.isInteger(kindCode) || kindCode <= 0) continue;
    grants.push({
      kind: AFFINITY_KIND_BY_CODE[kindCode] || "unknown",
      expression: AFFINITY_EXPRESSION_BY_CODE[expressionCode] || "unknown",
      stacks: core.getMotivatedActorAffinityGrantStacksAt(index, slot),
      mana: core.getMotivatedActorAffinityGrantManaAt(index, slot),
      manaMax: core.getMotivatedActorAffinityGrantManaMaxAt(index, slot),
      manaRegen: core.getMotivatedActorAffinityGrantManaRegenAt(index, slot),
    });
  }
  return grants;
}

function cloneResolvedEffects(effects) {
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({ ...entry }));
}

const VITAL_KINDS = Object.freeze([
  VitalKind.Health,
  VitalKind.Mana,
  VitalKind.Stamina,
  VitalKind.Durability,
]);

/**
 * Read the core's already-resolved affinity field as sparse, serializable cell
 * records. This is deliberately a projection, not a second field calculation:
 * `computeAffinityField()` has already applied cancellation before these readers
 * are consulted.
 */
function readAffinityFields(core, width, height) {
  const requiredReaders = [
    "getAffinityFieldStacksAt",
    "getAffinityFieldIntensityAt",
    "getAffinityFieldExpressionAt",
    "getAffinityFieldContributionCountAt",
  ];
  if (!requiredReaders.every((name) => typeof core?.[name] === "function")) return null;

  const fields = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let kind = 1; kind <= getAffinityKindCount(); kind += 1) {
        const stacks = core.getAffinityFieldStacksAt(x, y, kind);
        if (!Number.isInteger(stacks) || stacks <= 0) continue;

        const expression = core.getAffinityFieldExpressionAt(x, y, kind);
        const intensity = core.getAffinityFieldIntensityAt(x, y, kind);
        const contributionCount = core.getAffinityFieldContributionCountAt(x, y, kind);
        if (
          !Number.isInteger(expression)
          || expression <= 0
          || !Number.isFinite(intensity)
          || !Number.isInteger(contributionCount)
          || contributionCount <= 0
        ) {
          continue;
        }

        const vitalEffects = VITAL_KINDS
          .map((vital) => ({
            vital,
            effect: getAffinityVitalEffect(kind, expression, vital, stacks),
          }))
          .filter((entry) => entry.effect !== 0);
        fields.push({
          position: { x, y },
          kind,
          expression,
          stacks,
          intensity,
          contributionCount,
          vitalEffects,
        });
      }
    }
  }
  return fields;
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

/**
 * AM.1 — returns core's ValidationError code (0 == None/accepted).
 *
 * Previously void, which made core-level move rejection unobservable to every
 * caller: the runtime treated "did not throw" as "moved". A caller that ignores
 * the return value behaves exactly as before.
 */
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
  const result = core.applyAction(8, 0);
  return Number.isFinite(result) ? result : 0;
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
        affinityGrants: readActorAffinityGrants(core, index),
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
        affinityGrants: readActorAffinityGrants(core, 0),
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
  const affinityFields = readAffinityFields(core, width, height);

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
    ...(affinityFields ? { affinityFields } : {}),
  };
}
