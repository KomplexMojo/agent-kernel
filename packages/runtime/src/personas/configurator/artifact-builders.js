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
    bounds,
    rooms,
    connectivity,
    traps,
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
  if (Array.isArray(rooms) && rooms.length > 0) {
    data.rooms = rooms.map((room) => ({ ...room }));
  }
  if (connectivity && typeof connectivity === "object") {
    data.connectivity = { ...connectivity };
  }
  if (Array.isArray(traps) && traps.length > 0) {
    data.traps = traps.map((trap) => ({ ...trap }));
  }
  return data;
}

function sortedById(list) {
  if (!Array.isArray(list)) return [];
  return list.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
}

function buildResolvedTraits(actorTraits, resolved) {
  const traits = { ...(actorTraits || {}) };
  if (resolved?.affinityStacks) {
    traits.affinities = { ...resolved.affinityStacks };
  }
  if (Array.isArray(resolved?.abilities)) {
    traits.abilities = resolved.abilities.map((ability) => ({ ...ability }));
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
    schema: "agent-kernel/SimConfigArtifact",
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
    return entry;
  });

  return {
    schema: "agent-kernel/InitialStateArtifact",
    schemaVersion: 1,
    meta,
    simConfigRef,
    actors: normalizedActors,
  };
}
