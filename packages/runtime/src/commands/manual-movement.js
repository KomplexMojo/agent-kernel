const MANUAL_MOVE_BY_ACTION = Object.freeze({
  up: Object.freeze({ direction: "north", dx: 0, dy: -1 }),
  north: Object.freeze({ direction: "north", dx: 0, dy: -1 }),
  "up-right": Object.freeze({ direction: "northeast", dx: 1, dy: -1 }),
  upright: Object.freeze({ direction: "northeast", dx: 1, dy: -1 }),
  northeast: Object.freeze({ direction: "northeast", dx: 1, dy: -1 }),
  right: Object.freeze({ direction: "east", dx: 1, dy: 0 }),
  east: Object.freeze({ direction: "east", dx: 1, dy: 0 }),
  "down-right": Object.freeze({ direction: "southeast", dx: 1, dy: 1 }),
  downright: Object.freeze({ direction: "southeast", dx: 1, dy: 1 }),
  southeast: Object.freeze({ direction: "southeast", dx: 1, dy: 1 }),
  down: Object.freeze({ direction: "south", dx: 0, dy: 1 }),
  south: Object.freeze({ direction: "south", dx: 0, dy: 1 }),
  "down-left": Object.freeze({ direction: "southwest", dx: -1, dy: 1 }),
  downleft: Object.freeze({ direction: "southwest", dx: -1, dy: 1 }),
  southwest: Object.freeze({ direction: "southwest", dx: -1, dy: 1 }),
  left: Object.freeze({ direction: "west", dx: -1, dy: 0 }),
  west: Object.freeze({ direction: "west", dx: -1, dy: 0 }),
  "up-left": Object.freeze({ direction: "northwest", dx: -1, dy: -1 }),
  upleft: Object.freeze({ direction: "northwest", dx: -1, dy: -1 }),
  northwest: Object.freeze({ direction: "northwest", dx: -1, dy: -1 }),
});

function resolveObservedActors(observation) {
  return Array.isArray(observation?.actors) ? observation.actors : [];
}

export function buildManualMoveAction({
  action,
  actorId,
  viewerActorId,
  observation,
  controllableActorIds,
} = {}) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (normalizedAction === "cast") {
    return { ok: false, reason: "cast_unimplemented" };
  }
  const move = MANUAL_MOVE_BY_ACTION[normalizedAction];
  if (!move) {
    return { ok: false, reason: "unsupported_action" };
  }

  const observedActors = resolveObservedActors(observation);
  const selectedActorId = String(actorId || viewerActorId || "").trim();
  if (!selectedActorId) {
    return { ok: false, reason: "missing_actor" };
  }
  if (Array.isArray(controllableActorIds) && controllableActorIds.length > 0 && !controllableActorIds.includes(selectedActorId)) {
    return { ok: false, reason: "actor_not_controllable", actorId: selectedActorId };
  }
  const actor = observedActors.find((entry) => String(entry?.id || "").trim() === selectedActorId);
  if (!actor || !actor.position) {
    return { ok: false, reason: "actor_not_found", actorId: selectedActorId };
  }
  const fromX = Number(actor.position.x);
  const fromY = Number(actor.position.y);
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) {
    return { ok: false, reason: "invalid_position", actorId: selectedActorId };
  }

  return {
    ok: true,
    actorId: selectedActorId,
    action: {
      kind: "move",
      actorId: selectedActorId,
      tick: Number(observation?.tick ?? 0) + 1,
      params: {
        from: { x: fromX, y: fromY },
        to: { x: fromX + move.dx, y: fromY + move.dy },
        direction: move.direction,
      },
    },
  };
}
