/**
 * AM.0b — the end-of-run world-state snapshot (closes F11).
 *
 * A run emitted tick-frames, effects, an action log and a summary: a complete
 * record of what was DECIDED, and nothing about what HAPPENED. No position, no
 * vital, no hazard state reached disk. Nothing outside the process could tell a
 * run in which every actor moved from one in which core refused every move —
 * which is exactly the confusion F1/F2 hid behind for as long as they existed,
 * and why the CLI multi-actor suite could only ever assert the action ledger.
 *
 * This is Annotator work: capturing and normalizing run observability is its
 * chartered role. Like `summarizeRun`, it is a pure derivation and persistence
 * stays with the caller — the runtime performs no IO.
 *
 * It reads the live core rather than replaying frames, so it reports the world
 * as core holds it. That is the point: a snapshot derived from the same ledger
 * whose truthfulness is in question would prove nothing.
 */
import { WORLD_STATE_SCHEMA } from "../../contracts/artifacts.ts";

const VITAL_NAMES = Object.freeze(["health", "mana", "stamina", "durability"]);
const MAX_AFFINITY_GRANT_SLOTS = 10;

function readNumber(fn, ...args) {
  if (typeof fn !== "function") return 0;
  const value = fn(...args);
  return Number.isFinite(value) ? value : 0;
}

function readActorVitals(core, index) {
  const vitals = {};
  VITAL_NAMES.forEach((name, kind) => {
    vitals[name] = {
      current: readNumber(core.getMotivatedActorVitalCurrentByIndex?.bind(core), index, kind),
      max: readNumber(core.getMotivatedActorVitalMaxByIndex?.bind(core), index, kind),
      regen: readNumber(core.getMotivatedActorVitalRegenByIndex?.bind(core), index, kind),
    };
  });
  return vitals;
}

function readActorAffinities(core, index) {
  const grants = [];
  // The grant slot surface is `...AffinityGrant<Field>At(index, slot)`, with a
  // count reader. Guarded rather than assumed: a snapshot that silently reported
  // "no affinities" because a reader name drifted would be worse than one that
  // reports nothing at all, since it reads as a fact about the world.
  if (typeof core.getMotivatedActorAffinityGrantKindAt !== "function") {
    const kind = readNumber(core.getMotivatedActorAffinityKindByIndex?.bind(core), index);
    if (kind > 0) {
      grants.push({
        kind,
        expression: readNumber(core.getMotivatedActorAffinityExpressionByIndex?.bind(core), index),
        stacks: readNumber(core.getMotivatedActorAffinityStacksByIndex?.bind(core), index),
        mana: 0,
        manaMax: 0,
        manaRegen: 0,
      });
    }
    return grants;
  }
  const declaredCount = readNumber(
    core.getMotivatedActorAffinityGrantCountByIndex?.bind(core),
    index,
  );
  const slots = declaredCount > 0 ? declaredCount : MAX_AFFINITY_GRANT_SLOTS;
  for (let slot = 0; slot < slots; slot += 1) {
    const kind = readNumber(core.getMotivatedActorAffinityGrantKindAt.bind(core), index, slot);
    if (kind <= 0) continue;
    grants.push({
      kind,
      expression: readNumber(core.getMotivatedActorAffinityGrantExpressionAt?.bind(core), index, slot),
      stacks: readNumber(core.getMotivatedActorAffinityGrantStacksAt?.bind(core), index, slot),
      mana: readNumber(core.getMotivatedActorAffinityGrantManaAt?.bind(core), index, slot),
      manaMax: readNumber(core.getMotivatedActorAffinityGrantManaMaxAt?.bind(core), index, slot),
      manaRegen: readNumber(core.getMotivatedActorAffinityGrantManaRegenAt?.bind(core), index, slot),
    });
  }
  return grants;
}

function readHazards(core, width, height) {
  const hazards = [];
  if (typeof core.getStaticHazardAffinityAt !== "function") return hazards;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const affinity = readNumber(core.getStaticHazardAffinityAt.bind(core), x, y);
      if (affinity <= 0) continue;
      hazards.push({
        position: { x, y },
        affinity,
        expression: readNumber(core.getStaticHazardExpressionAt?.bind(core), x, y),
        stacks: readNumber(core.getStaticHazardStacksAt?.bind(core), x, y),
        mana: {
          current: readNumber(core.getStaticHazardManaReserveAt?.bind(core), x, y),
          max: readNumber(core.getStaticHazardManaMaxAt?.bind(core), x, y),
          regen: readNumber(core.getStaticHazardManaRegenAt?.bind(core), x, y),
        },
        durability: {
          current: readNumber(core.getStaticHazardDurabilityAt?.bind(core), x, y),
          max: readNumber(core.getStaticHazardDurabilityMaxAt?.bind(core), x, y),
          regen: readNumber(core.getStaticHazardDurabilityRegenAt?.bind(core), x, y),
        },
      });
    }
  }
  return hazards;
}

/**
 * Resources still on the map.
 *
 * Read per cell like hazards, because that is how core holds them. A cell's two
 * payloads are independent: `hasResourceAt` is true when either is present, and a
 * missing half reports as null rather than as a zeroed one — a resource claiming
 * to grant 0 health is a different statement from one that grants no vital at all.
 */
function readResources(core, width, height) {
  const resources = [];
  if (typeof core.hasResourceAt !== "function") return resources;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (readNumber(core.hasResourceAt.bind(core), x, y) === 0) continue;
      // Core reports -1 for "no vital payload". readNumber would turn a missing
      // reader into 0, which is health — a resource that grants nothing would
      // read as one that grants health.
      const vitalKind = typeof core.getResourceVitalKindAt === "function"
        ? core.getResourceVitalKindAt(x, y)
        : -1;
      const affinityKind = readNumber(core.getResourceAffinityKindAt?.bind(core), x, y);
      resources.push({
        position: { x, y },
        vital: vitalKind >= 0
          ? {
            kind: vitalKind,
            delta: readNumber(core.getResourceDeltaAt?.bind(core), x, y),
            mode: readNumber(core.getResourceModeAt?.bind(core), x, y),
            regen: readNumber(core.getResourceVitalRegenAt?.bind(core), x, y),
          }
          : null,
        affinity: affinityKind > 0
          ? {
            kind: affinityKind,
            expression: readNumber(core.getResourceAffinityExpressionAt?.bind(core), x, y),
            stacks: readNumber(core.getResourceAffinityStacksAt?.bind(core), x, y),
            mana: readNumber(core.getResourceManaAt?.bind(core), x, y),
            manaRegen: readNumber(core.getResourceManaRegenAt?.bind(core), x, y),
          }
          : null,
      });
    }
  }
  return resources;
}

/**
 * Build the WorldStateArtifact from live core state.
 *
 * @param {object} args
 * @param {object} args.core          the core whose world is being snapshotted
 * @param {object} args.meta          ArtifactMeta supplied by the caller
 * @param {object} [args.simConfigRef]
 * @param {Map<string, number>|null} [args.actorIdMap] id -> 1-based core index,
 *        so the snapshot can report the author's original actor ids rather than
 *        core's numeric ones. Without it the numeric id is reported as a string.
 * @returns {object} WorldStateArtifactV2
 */
export function buildWorldState({ core, meta, simConfigRef = null, actorIdMap = null } = {}) {
  if (!core) throw new Error("buildWorldState requires a core.");

  const width = readNumber(core.getMapWidth?.bind(core));
  const height = readNumber(core.getMapHeight?.bind(core));
  const actorCount = readNumber(core.getMotivatedActorCount?.bind(core));

  const indexToId = new Map();
  if (actorIdMap && typeof actorIdMap.entries === "function") {
    for (const [id, numeric] of actorIdMap.entries()) {
      indexToId.set(numeric - 1, id);
    }
  }

  const actors = [];
  for (let index = 0; index < actorCount; index += 1) {
    actors.push({
      id: indexToId.get(index)
        ?? String(readNumber(core.getMotivatedActorIdByIndex?.bind(core), index) || index + 1),
      index,
      position: {
        x: readNumber(core.getMotivatedActorXByIndex?.bind(core), index),
        y: readNumber(core.getMotivatedActorYByIndex?.bind(core), index),
      },
      vitals: readActorVitals(core, index),
      affinities: readActorAffinities(core, index),
    });
  }

  const artifact = {
    schema: WORLD_STATE_SCHEMA,
    schemaVersion: 2,
    meta,
    tick: readNumber(core.getCurrentTick?.bind(core)),
    dimensions: { width, height },
    actors,
    hazards: readHazards(core, width, height),
    resources: readResources(core, width, height),
  };
  if (simConfigRef) artifact.simConfigRef = simConfigRef;
  return artifact;
}
