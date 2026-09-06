import { EIGHT_WAY_DELTAS } from "../_shared/movement-directions.js";

/**
 * Proposal geometry helpers for Actor motivation modules.
 *
 * Dependency direction (enforced): actor persona → motivations/* → proposal-helpers.js.
 * Nothing in this file may import the actor persona entry or motivations/*.
 */

const DEFAULT_DELTAS = EIGHT_WAY_DELTAS;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function findExitFromTiles(baseTiles) {
  if (!Array.isArray(baseTiles)) {
    return null;
  }
  for (let y = 0; y < baseTiles.length; y += 1) {
    const row = String(baseTiles[y]);
    const x = row.indexOf("E");
    if (x !== -1) {
      return { x, y };
    }
  }
  return null;
}

export function resolveObservationView(observation) {
  if (!observation || typeof observation !== "object") {
    return null;
  }
  if (observation.view && typeof observation.view === "object") {
    return observation.view;
  }
  return observation;
}

export function resolveBaseTiles(payload, view, simConfig) {
  const fromPayload = payload?.baseTiles || payload?.tiles?.baseTiles;
  if (fromPayload) return fromPayload;
  if (view?.baseTiles) return view.baseTiles;
  if (view?.tiles?.baseTiles) return view.tiles.baseTiles;
  if (view?.tiles?.tiles) return view.tiles.tiles;
  const config = payload?.simConfig || simConfig;
  if (config?.layout?.data?.tiles) return config.layout.data.tiles;
  return null;
}

export function resolveExit(payload, view, baseTiles, simConfigInput) {
  if (payload?.exit) return payload.exit;
  if (view?.exit) return view.exit;
  const simConfig = payload?.simConfig || simConfigInput;
  if (simConfig?.layout?.data?.exit) return simConfig.layout.data.exit;
  if (baseTiles) return findExitFromTiles(baseTiles);
  return null;
}

export function resolveActor(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected?.position) {
      return { id: selected.id, position: selected.position };
    }
  }
  if (view?.actor) {
    const pos = view.actor.position || (Number.isFinite(view.actor.x) && Number.isFinite(view.actor.y) ? { x: view.actor.x, y: view.actor.y } : null);
    if (pos) {
      return { id: view.actor.id || actorId, position: pos };
    }
  }
  if (view?.position) {
    return { id: actorId || observation?.actorId, position: view.position };
  }
  return null;
}

export function resolveActorRecord(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected) {
      return selected;
    }
  }
  if (view?.actor) {
    return view.actor;
  }
  return null;
}

export function resolveTileKinds(view, payload) {
  if (Array.isArray(view?.tiles?.kinds)) return view.tiles.kinds;
  if (Array.isArray(view?.kinds)) return view.kinds;
  if (Array.isArray(payload?.tiles?.kinds)) return payload.tiles.kinds;
  return null;
}

export function buildAdjacentMoveProposals({ actor, tileKinds, baseTiles }) {
  if (!actor?.position) {
    return [];
  }
  const proposals = [];
  for (const delta of DEFAULT_DELTAS) {
    const to = {
      x: actor.position.x + delta.dx,
      y: actor.position.y + delta.dy,
    };
    if (!isPassable(to, tileKinds, baseTiles)) {
      continue;
    }
    proposals.push({
      kind: "move",
      params: {
        direction: delta.direction,
        from: actor.position,
        to,
      },
    });
  }
  return proposals;
}

export function chebyshevDistance(left, right) {
  if (!left || !right) return null;
  return Math.max(Math.abs(right.x - left.x), Math.abs(right.y - left.y));
}

export function isPassable({ x, y }, tileKinds, baseTiles) {
  if (tileKinds) {
    const row = tileKinds[y];
    if (!Array.isArray(row)) return false;
    return row[x] === 0;
  }
  if (baseTiles) {
    if (y < 0 || y >= baseTiles.length) return false;
    const row = String(baseTiles[y]);
    const cell = row[x];
    if (!cell) return false;
    return cell !== "#" && cell !== "B";
  }
  return false;
}

export function isDiagonalStepAllowed(current, next, tileKinds, baseTiles) {
  const dx = next.x - current.x;
  const dy = next.y - current.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
    return true;
  }
  return isPassable({ x: current.x + dx, y: current.y }, tileKinds, baseTiles)
    && isPassable({ x: current.x, y: current.y + dy }, tileKinds, baseTiles);
}

export function findPath(start, goal, tileKinds, baseTiles) {
  if (!start || !goal) return null;
  if (start.x === goal.x && start.y === goal.y) return [start];
  const height = tileKinds ? tileKinds.length : baseTiles ? baseTiles.length : 0;
  const width = tileKinds && Array.isArray(tileKinds[0]) ? tileKinds[0].length : baseTiles && baseTiles[0] ? String(baseTiles[0]).length : 0;
  if (width === 0 || height === 0) return null;

  const queue = [start];
  const cameFrom = {};
  const startKey = `${start.x},${start.y}`;
  cameFrom[startKey] = null;
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current.x === goal.x && current.y === goal.y) {
      const path = [];
      let key = `${goal.x},${goal.y}`;
      while (key) {
        const [x, y] = key.split(",").map((v) => Number(v));
        path.unshift({ x, y });
        key = cameFrom[key];
      }
      return path;
    }
    for (const delta of DEFAULT_DELTAS) {
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      const key = `${next.x},${next.y}`;
      if (Object.prototype.hasOwnProperty.call(cameFrom, key)) {
        continue;
      }
      if (!isPassable(next, tileKinds, baseTiles) || !isDiagonalStepAllowed(current, next, tileKinds, baseTiles)) {
        continue;
      }
      cameFrom[key] = `${current.x},${current.y}`;
      queue.push(next);
    }
  }
  return null;
}

export function buildMoveProposal({ observation, payload, simConfig }) {
  const view = resolveObservationView(observation);
  if (!view) return [];
  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const exit = resolveExit(payload, view, baseTiles, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const actor = resolveActor(view, payload?.actorId, observation);
  if (!actor || !actor.position || !exit) return [];
  const actorRecord = resolveActorRecord(view, payload?.actorId, observation);
  if (actorRecord?.motivation?.mobility === "stationary") {
    return [{ kind: "wait", params: { reason: "stationary" } }];
  }
  const path = findPath(actor.position, exit, tileKinds, baseTiles);
  if (!path || path.length < 2) return [];
  const from = path[0];
  const to = path[1];
  const delta = { dx: to.x - from.x, dy: to.y - from.y };
  const direction = DEFAULT_DELTAS.find((entry) => entry.dx === delta.dx && entry.dy === delta.dy)?.direction;
  if (!direction) return [];
  return [
    {
      kind: "move",
      params: {
        direction,
        from,
        to,
      },
    },
  ];
}

export function roomPerimeterRing(room, tileKinds, baseTiles) {
  const x0 = room.x;
  const y0 = room.y;
  const x1 = room.x + room.width - 1;
  const y1 = room.y + room.height - 1;
  if (x1 <= x0 || y1 <= y0) return [];
  const ring = [];
  for (let x = x0; x <= x1; x += 1) ring.push({ x, y: y0 });
  for (let y = y0 + 1; y <= y1; y += 1) ring.push({ x: x1, y });
  for (let x = x1 - 1; x >= x0; x -= 1) ring.push({ x, y: y1 });
  for (let y = y1 - 1; y >= y0 + 1; y -= 1) ring.push({ x: x0, y });
  // A room may be carved so part of its rectangle is wall. Patrolling the walkable
  // subset keeps the circuit legal rather than proposing moves core will refuse.
  return ring.filter((cell) => isPassable(cell, tileKinds, baseTiles));
}

export function roomContaining(position, rooms) {
  if (!Array.isArray(rooms) || !position) return null;
  for (const room of rooms) {
    if (!isObject(room)) continue;
    const { x, y, width, height } = room;
    if (![x, y, width, height].every((v) => Number.isInteger(v))) continue;
    if (position.x >= x && position.x <= x + width - 1
      && position.y >= y && position.y <= y + height - 1) {
      return room;
    }
  }
  return null;
}

export function resolveRooms(payload, view, simConfig) {
  const fromConfig = simConfig?.layout?.data?.rooms;
  if (Array.isArray(fromConfig)) return fromConfig;
  const fromPayload = payload?.simConfig?.layout?.data?.rooms;
  if (Array.isArray(fromPayload)) return fromPayload;
  const fromView = view?.rooms;
  return Array.isArray(fromView) ? fromView : [];
}

export function buildPatrolProposals({ observation, payload, simConfig }) {
  const view = resolveObservationView(observation);
  if (!view) return [];
  const actor = resolveActor(view, payload?.actorId, observation);
  if (!actor?.position) return [];
  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const rooms = resolveRooms(payload, view, simConfig);
  const room = roomContaining(actor.position, rooms);
  if (!room) return [];
  const ring = roomPerimeterRing(room, tileKinds, baseTiles);
  if (ring.length < 2) return [];

  const at = ring.findIndex((cell) => cell.x === actor.position.x && cell.y === actor.position.y);
  // On the ring: take the next cell round. Inside the room: walk out to the nearest ring
  // cell first, so an actor that spawned in the middle joins the patrol instead of
  // standing still — which would look exactly like the defect this replaces.
  const target = at >= 0 ? ring[(at + 1) % ring.length] : nearestRingCell(actor.position, ring);
  if (!target) return [];

  const path = findPath(actor.position, target, tileKinds, baseTiles);
  if (!path || path.length < 2) return [];
  const from = path[0];
  const to = path[1];
  const direction = DEFAULT_DELTAS.find(
    (entry) => entry.dx === to.x - from.x && entry.dy === to.y - from.y,
  )?.direction;
  if (!direction) return [];
  return [{ kind: "move", params: { direction, from, to } }];
}

export function nearestRingCell(position, ring) {
  let best = null;
  let bestDistance = Infinity;
  for (const cell of ring) {
    const distance = chebyshevDistance(position, cell);
    // Ties break on the ring's own order, which is deterministic — replay compares runs
    // frame by frame, so "whichever came first" must mean the same thing every run.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}

export function resolveActorRandomSeed(view, actorId, payload, personaSeed) {
  if (view?.actors && Array.isArray(view.actors)) {
    const self = view.actors.find((a) => a && a.id === actorId);
    if (self?.motivation?.seed !== undefined && self.motivation.seed !== null) {
      return self.motivation.seed;
    }
  }
  const configActors = payload?.initialState?.actors;
  if (Array.isArray(configActors)) {
    const configActor = configActors.find((a) => a && a.id === actorId);
    if (configActor?.motivation?.seed !== undefined && configActor.motivation.seed !== null) {
      return configActor.motivation.seed;
    }
  }
  if (payload?.seed !== undefined && payload?.seed !== null) return payload.seed;
  if (personaSeed !== undefined && personaSeed !== null) return personaSeed;
  return 0;
}

export function hashRandomInputs(seed, actorId, tick) {
  const text = `${String(seed)}:${String(actorId)}:${String(Number.isFinite(tick) ? tick : 0)}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Final mix (mulberry32-style) so nearby hashes decorrelate before use.
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
}

export function deterministicRandom(seed, actorId, tick, salt = 0) {
  const hashed = hashRandomInputs(seed, actorId, (Number.isFinite(tick) ? tick : 0) * 2654435761 + salt);
  return hashed / 4294967296;
}

export function isOccupied(position, view, actorId) {
  if (!view?.actors || !Array.isArray(view.actors)) return false;
  return view.actors.some(
    (other) => other && other.id !== actorId && other.position
      && other.position.x === position.x && other.position.y === position.y,
  );
}

export function isReserved(position, reservedTargets) {
  if (!Array.isArray(reservedTargets) || reservedTargets.length === 0) return false;
  return reservedTargets.some((target) => target && target.x === position.x && target.y === position.y);
}

export function buildRandomMoveProposals({ observation, payload, simConfig, personaSeed }) {
  const view = resolveObservationView(observation);
  const actorId = payload?.actorId;
  const actor = resolveActor(view, actorId, observation);
  if (!actor?.position) return [{ kind: "wait", params: { reason: "random" } }];

  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const reservedTargets = payload?.reservedTargets;
  const candidates = buildAdjacentMoveProposals({ actor, tileKinds, baseTiles })
    .filter((proposal) => !isOccupied(proposal.params.to, view, actorId))
    .filter((proposal) => !isReserved(proposal.params.to, reservedTargets));

  if (candidates.length === 0) {
    return [{ kind: "wait", params: { reason: "random" } }];
  }

  const seed = resolveActorRandomSeed(view, actorId, payload, personaSeed);
  const roll = deterministicRandom(seed, actorId, payload?.tick, 0);
  const index = Math.floor(roll * candidates.length) % candidates.length;
  const chosen = candidates[index];

  return [
    {
      kind: "move",
      params: {
        direction: chosen.params.direction,
        from: chosen.params.from,
        to: chosen.params.to,
        reason: "random",
      },
    },
  ];
}

export { DEFAULT_DELTAS };
