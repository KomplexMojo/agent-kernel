import {
  INITIAL_STATE_SCHEMA,
  SIM_CONFIG_SCHEMA,
} from "../../contracts/artifacts.ts";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneLayoutData(layout) {
  if (!isPlainObject(layout)) return {};
  const {
    width,
    height,
    tiles,
    kinds,
    legend,
    render,
    spawn,
    exit,
    spawnApproach,
    exitApproach,
    entryRoomId,
    exitRoomId,
    bounds,
    rooms,
    connectivity,
    hazards,
    resources,
  } = layout;
  const data = {
    width,
    height,
    tiles,
    kinds,
    legend,
    render,
    spawn,
    exit,
    bounds,
  };
  if (spawnApproach !== undefined) {
    data.spawnApproach = spawnApproach;
  }
  if (exitApproach !== undefined) {
    data.exitApproach = exitApproach;
  }
  if (entryRoomId !== undefined) {
    data.entryRoomId = entryRoomId;
  }
  if (exitRoomId !== undefined) {
    data.exitRoomId = exitRoomId;
  }
  if (Array.isArray(rooms) && rooms.length > 0) {
    data.rooms = rooms.map((room) => ({ ...room }));
  }
  if (connectivity && typeof connectivity === "object") {
    data.connectivity = { ...connectivity };
  }
  if (Array.isArray(hazards) && hazards.length > 0) {
    data.hazards = hazards.map((hazard) => ({ ...hazard }));
  }
  if (Array.isArray(resources) && resources.length > 0) {
    data.resources = resources.map((resource) => ({ ...resource }));
  }
  return data;
}

function sortedById(list) {
  if (!Array.isArray(list)) return [];
  return list.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
}

function assertUniqueActorIds(actors) {
  const seenIds = new Set();
  actors.forEach((actor) => {
    const id = String(actor?.id || "");
    if (seenIds.has(id)) {
      const reason = id === "" ? "missing_actor_id" : "duplicate_actor_id";
      throw new Error(id === "" ? reason : `${reason}: ${id}`);
    }
    seenIds.add(id);
  });
}

function buildResolvedTraits(actorTraits, resolved) {
  const traits = { ...(actorTraits || {}) };
  if (resolved?.affinityStacks) {
    traits.affinities = { ...resolved.affinityStacks };
  }
  if (resolved?.affinityTargets) {
    traits.affinityTargets = { ...resolved.affinityTargets };
  }
  if (Array.isArray(resolved?.abilities)) {
    traits.abilities = resolved.abilities.map((ability) => ({ ...ability }));
  }
  if (Array.isArray(resolved?.resolvedEffects)) {
    traits.resolvedEffects = resolved.resolvedEffects.map((effect) => ({ ...effect }));
  }
  return Object.keys(traits).length > 0 ? traits : undefined;
}

export function buildSimConfigArtifact({
  meta,
  planRef,
  budgetReceiptRef,
  seed = 0,
  layout,
  flags,
  executionPolicy,
  constraints,
} = {}) {
  const artifact = {
    schema: SIM_CONFIG_SCHEMA,
    schemaVersion: 1,
    meta,
    planRef,
    seed,
    layout: {
      kind: "grid",
      data: cloneLayoutData(layout),
    },
  };
  if (budgetReceiptRef) artifact.budgetReceiptRef = budgetReceiptRef;
  if (executionPolicy) artifact.executionPolicy = executionPolicy;
  if (flags) artifact.flags = flags;
  if (constraints) artifact.constraints = constraints;
  return artifact;
}

export function buildInitialStateArtifact({ meta, simConfigRef, actors = [], resolvedEffects = {} } = {}) {
  assertUniqueActorIds(Array.isArray(actors) ? actors : []);
  const resolvedByActor = new Map();
  if (Array.isArray(resolvedEffects.actors)) {
    resolvedEffects.actors.forEach((entry) => {
      if (entry?.actorId) {
        resolvedByActor.set(entry.actorId, entry);
      }
    });
  }

  const normalizedActors = sortedById(actors).map((actor) => {
    const resolved = resolvedByActor.get(actor.id);
    const vitals = resolved?.vitals || actor.vitals;
    const traits = buildResolvedTraits(actor.traits, resolved);
    const entry = {
      id: actor.id,
      kind: actor.kind,
      position: actor.position,
    };
    if (vitals) entry.vitals = vitals;
    if (actor.archetype) entry.archetype = actor.archetype;
    if (actor.capabilities) entry.capabilities = actor.capabilities;
    if (traits) entry.traits = traits;
    // AM.5/F13 — carry the AFFINITIES ARRAY through, not just `traits.affinities`.
    //
    // The authored actor arrives here with `affinities: [{kind, expression,
    // stacks}]` and this builder dropped it, emitting only the trait map
    // (`{water: 1}`). But `runner/core-setup.mjs` seeds an actor's core affinity
    // from the ARRAY, and the observation's affinity list is built from the same
    // shape — so every CLI-authored actor reached the simulation holding no
    // affinity at all. `--delver affinity=water` was recorded and never applied:
    // no field contribution, nothing to express, nothing to interact with.
    //
    // The trait map stays: it is what the renderers and card surfaces read.
    if (Array.isArray(actor.affinities) && actor.affinities.length > 0) {
      entry.affinities = actor.affinities.map((affinity) => ({ ...affinity }));
    }
    return entry;
  });

  return {
    schema: INITIAL_STATE_SCHEMA,
    schemaVersion: 1,
    meta,
    simConfigRef,
    actors: normalizedActors,
  };
}
