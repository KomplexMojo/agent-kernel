import { EIGHT_WAY_DELTAS } from "../_shared/movement-directions.js";
import { ASCII_TERRAIN_GLYPHS } from "../../render/visualization-snapshot.js";

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

function terrainToTiles(layoutData) {
  const terrain = layoutData?.terrain;
  const width = layoutData?.width;
  const height = layoutData?.height;
  if (!Array.isArray(terrain) || !Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0 || terrain.length !== width * height) {
    return null;
  }
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += ASCII_TERRAIN_GLYPHS[terrain[y * width + x]] || ASCII_TERRAIN_GLYPHS.floor;
    }
    rows.push(row);
  }
  return rows;
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
  const fromTerrain = terrainToTiles(config?.layout?.data);
  if (fromTerrain) return fromTerrain;
  return null;
}

export function actorCanExit(actorOrRecord) {
  return actorOrRecord?.capabilities?.canExit !== false;
}

/**
 * Path target for exit-seeking. Prefers an explicit `exitApproach` (floor cell beside a
 * wall portal). Without one, falls back to legacy exit coordinates so older floor-`E`
 * fixtures keep working until they are migrated.
 */
export function resolveExit(payload, view, baseTiles, simConfigInput) {
  const simConfig = payload?.simConfig || simConfigInput;
  const layoutData = simConfig?.layout?.data;
  const approach = payload?.exitApproach
    || view?.exitApproach
    || layoutData?.exitApproach
    || null;
  if (approach && Number.isInteger(approach.x) && Number.isInteger(approach.y)) {
    return { x: approach.x, y: approach.y };
  }
  if (payload?.exit) return payload.exit;
  if (view?.exit) return view.exit;
  if (layoutData?.exit) return layoutData.exit;
  if (baseTiles) return findExitFromTiles(baseTiles);
  return null;
}

export function resolveActor(view, actorId, observation) {
  if (view?.actors && Array.isArray(view.actors)) {
    const matchId = actorId || observation?.actorId;
    const selected = matchId ? view.actors.find((actor) => actor?.id === matchId) : view.actors[0];
    if (selected?.position) {
      return {
        id: selected.id,
        position: selected.position,
        alignment: selected.alignment,
        capabilities: selected.capabilities,
      };
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
  if (!actor?.position || actor.capabilities?.canMove === false) {
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
      params: { target: to },
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
    // S/E are wall portals (non-walkable). Path targets use exitApproach.
    return cell !== "#" && cell !== "B" && cell !== "S" && cell !== "E";
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

  // Breadth-first over cell indexes: visit order matches the eight-way deltas, so
  // the path is the same one a keyed search finds, without a string per cell.
  const NONE = -1;
  const FROM_START = -2;
  const cells = width * height;
  const parent = new Int32Array(cells).fill(NONE);
  const queue = new Int32Array(cells);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const goalIndex = inBounds(goal.x, goal.y) ? goal.y * width + goal.x : NONE;
  if (inBounds(start.x, start.y)) parent[start.y * width + start.x] = FROM_START;
  const toPath = (index) => {
    const path = [];
    for (let at = index; at !== FROM_START; at = parent[at]) {
      path.push({ x: at % width, y: Math.floor(at / width) });
    }
    path.push({ x: start.x, y: start.y });
    return path.reverse();
  };
  let head = 0;
  let tail = 0;
  let current = { x: start.x, y: start.y };
  let currentIndex = FROM_START;
  for (;;) {
    for (const delta of DEFAULT_DELTAS) {
      const next = { x: current.x + delta.dx, y: current.y + delta.dy };
      if (!inBounds(next.x, next.y)) continue;
      const index = next.y * width + next.x;
      if (parent[index] !== NONE) continue;
      const isGoal = index === goalIndex;
      if ((!isPassable(next, tileKinds, baseTiles) && !isGoal)
        || !isDiagonalStepAllowed(current, next, tileKinds, baseTiles)) {
        continue;
      }
      parent[index] = currentIndex;
      if (isGoal) return toPath(index);
      queue[tail] = index;
      tail += 1;
    }
    if (head >= tail) break;
    currentIndex = queue[head];
    head += 1;
    current = { x: currentIndex % width, y: Math.floor(currentIndex / width) };
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
  if (!actor || !actor.position) return [];
  const actorRecord = resolveActorRecord(view, payload?.actorId, observation);
  if (actorRecord?.capabilities?.canMove === false || actor?.capabilities?.canMove === false) {
    return [{ kind: "wait" }];
  }
  if (!actorCanExit(actorRecord) || !actorCanExit(actor) || !actorCanExit(payload?.configuredActor)) {
    return [{ kind: "wait" }];
  }
  if (!exit) return [];
  if (actorRecord?.motivation?.mobility === "stationary") {
    return [{ kind: "wait" }];
  }
  // The exit is a wall portal beside its approach: from the approach, step onto it,
  // then stay there for core's exit dwell.
  const portal = findExitFromTiles(baseTiles);
  if (portal && actor.position.x === portal.x && actor.position.y === portal.y) return [{ kind: "wait" }];
  if (portal && actor.position.x === exit.x && actor.position.y === exit.y
    && chebyshevDistance(actor.position, portal) === 1) {
    return [{ kind: "move", params: { target: portal } }];
  }
  const path = findPath(actor.position, exit, tileKinds, baseTiles)
    ?? findTerrainRoute(actor.position, exit, tileKinds, baseTiles);
  if (!path || path.length < 2) return [];
  const to = path[1];
  return [{ kind: "move", params: { target: to } }];
}

/**
 * Whether two alignments are on one side. The Actor's single allegiance rule: unknown or
 * missing alignments are never allied, so a consumer cannot guess "allied" by default.
 */
export function alignmentsAreAllied(selfAlignment, otherAlignment) {
  if (typeof selfAlignment !== "string" || typeof otherAlignment !== "string") return false;
  const self = selfAlignment.trim().toLowerCase();
  const other = otherAlignment.trim().toLowerCase();
  return Boolean(self && other && self === other);
}

/** Other actors still in the level, split by allegiance to `actorId`, each with its distance. */
export function sideOf(view, actorId) {
  const actors = Array.isArray(view?.actors) ? view.actors : [];
  const self = actors.find((entry) => entry?.id === actorId);
  const allies = [];
  const hostiles = [];
  if (!self?.position) return { allies, hostiles };
  for (const other of actors) {
    if (!other?.position || other.id === actorId || ["defeated", "exited"].includes(other.lifecycle)) continue;
    const entry = { actor: other, distance: chebyshevDistance(self.position, other.position) };
    (alignmentsAreAllied(self.alignment, other.alignment) ? allies : hostiles).push(entry);
  }
  const byDistance = (a, b) => a.distance - b.distance || (a.actor.id < b.actor.id ? -1 : a.actor.id > b.actor.id ? 1 : 0);
  return { allies: allies.sort(byDistance), hostiles: hostiles.sort(byDistance) };
}

/**
 * Every first step on a shortest route to the exit, in step order (#311). Where
 * `buildMoveProposal` answers with anything other than one routed step (a wait, the
 * portal step, a blocked route), that answer stands: there is no choice to make.
 */
export function buildExitSteps({ observation, payload, simConfig }) {
  const fallback = buildMoveProposal({ observation, payload, simConfig });
  const view = resolveObservationView(observation);
  const actor = resolveActor(view, payload?.actorId, observation);
  if (fallback.length !== 1 || fallback[0].kind !== "move" || !actor?.position) return { fallback, steps: [] };
  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const exit = resolveExit(payload, view, baseTiles, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const route = findPath(actor.position, exit, tileKinds, baseTiles);
  if (!route || route.length < 2) return { fallback, steps: [] };
  const steps = [];
  for (const delta of DEFAULT_DELTAS) {
    const to = { x: actor.position.x + delta.dx, y: actor.position.y + delta.dy };
    if (!isPassable(to, tileKinds, baseTiles) || !isDiagonalStepAllowed(actor.position, to, tileKinds, baseTiles)) continue;
    const onward = findPath(to, exit, tileKinds, baseTiles);
    if (onward && onward.length === route.length - 1) steps.push(to);
  }
  return { fallback, steps: steps.length > 0 ? steps : [fallback[0].params.target] };
}

/** Impassable cells within two tiles of `position`: how close it keeps to the walls. */
export function wallsNear(position, tileKinds, baseTiles) {
  let walls = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (!isPassable({ x: position.x + dx, y: position.y + dy }, tileKinds, baseTiles)) walls += 1;
    }
  }
  return walls;
}

/**
 * When actors plug every route (wardens seated around the exit), walk the terrain
 * route as far as it is free: the actor closes in on whoever holds the way instead
 * of waiting out the run. Null when terrain itself has no route or the first step
 * is occupied.
 */
function findTerrainRoute(start, goal, tileKinds, baseTiles) {
  if (!tileKinds || !baseTiles) return null;
  const route = findPath(start, goal, null, baseTiles);
  if (!route || route.length < 2) return null;
  if (isPassable(route[1], tileKinds, baseTiles)) return route;
  // #368: the shortest route's next tile is taken (a partner stands on it). Another free
  // first step keeps the actor moving round it: one that closes in if there is one, else a
  // sidestep that loses no ground.
  let sidestep = null;
  for (const delta of DEFAULT_DELTAS) {
    const next = { x: start.x + delta.dx, y: start.y + delta.dy };
    if (!isPassable(next, tileKinds, baseTiles) || !isDiagonalStepAllowed(start, next, tileKinds, baseTiles)) continue;
    const rest = findPath(next, goal, null, baseTiles);
    if (rest && rest.length < route.length) return [start, ...rest];
    if (rest && rest.length === route.length && !sidestep) sidestep = [start, ...rest];
  }
  return sidestep;
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

/**
 * Resolve the next ring cell for a patrol pattern.
 * `loop` (default): clockwise circuit — the historical behaviour.
 * `ping_pong`: reverse at the ring ends (triangle wave over tick).
 * `random_walk`: not handled here — the patrolling module delegates to random.
 */
function resolvePatrolRingTarget(at, ring, pattern, tick) {
  if (at < 0) return null;
  const normalized = typeof pattern === "string" ? pattern.trim().toLowerCase() : "loop";
  if (normalized === "ping_pong") {
    const span = ring.length - 1;
    if (span <= 0) return ring[0];
    const period = span * 2;
    const phase = ((Number.isFinite(tick) ? tick : 0) % period + period) % period;
    const index = phase <= span ? phase : period - phase;
    return ring[index];
  }
  // loop (default)
  return ring[(at + 1) % ring.length];
}

export function buildPatrolProposals({ observation, payload, simConfig, params = null }) {
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
  // On the ring: take the next cell for the active pattern. Inside the room: walk out
  // to the nearest ring cell first, so an actor that spawned in the middle joins the
  // patrol instead of standing still — which would look exactly like the defect this replaces.
  const pattern = params?.pattern || "loop";
  const tick = Number.isFinite(payload?.tick) ? payload.tick : 0;
  const target = at >= 0
    ? resolvePatrolRingTarget(at, ring, pattern, tick)
    : nearestRingCell(actor.position, ring);
  if (!target) return [];

  const path = findPath(actor.position, target, tileKinds, baseTiles);
  if (!path || path.length < 2) return [];
  const to = path[1];
  return [{ kind: "move", params: { target: to } }];
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
  if (!actor?.position || actor?.capabilities?.canMove === false) return [{ kind: "wait" }];

  const baseTiles = resolveBaseTiles(payload, view, simConfig);
  const tileKinds = resolveTileKinds(view, payload);
  const reservedTargets = payload?.reservedTargets;
  const candidates = buildAdjacentMoveProposals({ actor, tileKinds, baseTiles })
    .filter((proposal) => !isOccupied(proposal.params.target, view, actorId))
    .filter((proposal) => !isReserved(proposal.params.target, reservedTargets));

  if (candidates.length === 0) {
    return [{ kind: "wait" }];
  }

  const seed = resolveActorRandomSeed(view, actorId, payload, personaSeed);
  const roll = deterministicRandom(seed, actorId, payload?.tick, 0);
  const index = Math.floor(roll * candidates.length) % candidates.length;
  const chosen = candidates[index];

  return [{ kind: "move", params: { target: chosen.params.target } }];
}

export { DEFAULT_DELTAS };
