/**
 * #418 — the `minefield` tactic, Configurator policy: one room on the spawn-to-exit route is
 * filled with hazards whose fields overlap, and a safe line runs through it.
 *
 * The safe line is chosen first: a path from the doorway the route enters by to the doorway it
 * leaves by, along the room's edge. The hazards are then seated in a cluster no closer to any
 * line cell than the distance where their field has faded to nothing, by core's own falloff
 * (`computeAffinityFalloff`). So the line is safe because reach runs out, for every kind, and
 * the proof is the seating itself. The short route straight across runs through the fields.
 *
 * Kinds are drawn from the affinity table's damaging rows from the seed, never picked per kind,
 * and no two drawn kinds are opposites (opposite fields would cancel each other out); `kinds=`
 * names them instead. A reward (one of the level's free resources) sits in the minefield.
 *
 * Hazards are ordinary hazards with the actor viability floor and enough mana regen to keep
 * their field lit (the Configurator's own upkeep rule). The Allocator prices them from the
 * hazard share; `fitTacticHazards` drops hazards until the share is approved.
 */
import { AFFINITY_TABLE } from "../../../../core-ts/src/state/affinity-table.ts";
import { getOppositeAffinityKind } from "../../../../core-ts/src/state/affinity.ts";
import { computeAffinityFalloff } from "../../../../core-ts/src/state/affinity-spatial.ts";
import { ACTOR_VIABILITY_FLOOR } from "../../contracts/domain-constants.js";
import { computeInternalManaUpkeep } from "./cost-model.js";
import { roomDoorways } from "./doorway-sight.js";
import { terrainPositions } from "./terrain-layout.js";

const MINEFIELD_PARAMS = Object.freeze(["hazards", "room", "range", "kinds"]);
const DEFAULTS = Object.freeze({ hazards: 4, range: 1 });
const EXPRESSION = "emit";
// Core's expression code for emit (affinity-readers.ts: push 1, pull 2, emit 3, draw 4).
const EMIT_CODE = 3;
const INTENSITY = 1;

const key = ({ x, y }) => `${x},${y}`;
const chebyshev = (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];

function readCount(params, name, minimum) {
  if (params[name] === undefined) return DEFAULTS[name];
  const value = Number(params[name]);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`tactic minefield: ${name} must be a whole number >= ${minimum}.`);
  return value;
}

export function readMinefieldParams(params = {}) {
  const unknown = Object.keys(params).filter((name) => !MINEFIELD_PARAMS.includes(name));
  if (unknown.length > 0) throw new Error(`tactic minefield: unknown param ${unknown.join(", ")} (${MINEFIELD_PARAMS.join(", ")}).`);
  let kinds = null;
  if (params.kinds !== undefined) {
    kinds = String(params.kinds).split("+").map((kind) => kind.trim()).filter(Boolean);
    const known = AFFINITY_TABLE.map((row) => row.kind);
    const bad = kinds.filter((kind) => !known.includes(kind));
    if (kinds.length === 0 || bad.length > 0) {
      throw new Error(`tactic minefield: kinds must be <kind>[+<kind>...] from ${known.join(", ")}${bad.length > 0 ? ` (not ${bad.join(", ")})` : ""}.`);
    }
  }
  return {
    hazards: readCount(params, "hazards", 0),
    range: readCount(params, "range", 1),
    room: params.room === undefined ? null : String(params.room),
    kinds,
  };
}

/** The Chebyshev distance from a hazard at which its field has faded to nothing, by core's falloff. */
export function minefieldClearance(range) {
  // Core measures field reach in king-free steps (|dx| + |dy|), never less than Chebyshev, so
  // a cell this far by Chebyshev is at least this far by core's measure too.
  let distance = 1;
  while (computeAffinityFalloff(distance, range, EMIT_CODE) > 0) distance += 1;
  return distance;
}

function inRoom(room, { x, y }) {
  return x >= room.x && y >= room.y && x < room.x + room.width && y < room.y + room.height;
}

function onEdge(room, { x, y }) {
  return x === room.x || y === room.y || x === room.x + room.width - 1 || y === room.y + room.height - 1;
}

// Shortest 4-neighbour path over `allowed` from `from` to any cell `isGoal` accepts.
function shortestPath(allowed, from, isGoal) {
  if (!from || !allowed.has(key(from))) return null;
  const previous = new Map([[key(from), null]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index];
    if (isGoal(cell)) {
      const path = [];
      for (let at = cell; at; at = previous.get(key(at))) path.unshift(at);
      return path;
    }
    for (const [dx, dy] of STEPS) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (allowed.has(key(next)) && !previous.has(key(next))) {
        previous.set(key(next), cell);
        queue.push(next);
      }
    }
  }
  return null;
}

function routeCells(layout) {
  const data = layout?.data || layout || {};
  const floor = terrainPositions(layout);
  const allowed = new Set(floor.map(key));
  const spawn = data.spawnApproach || null;
  const exit = data.exitApproach || null;
  if (!spawn || !exit) return { floor, allowed, route: null };
  return { floor, allowed, route: shortestPath(allowed, spawn, (cell) => cell.x === exit.x && cell.y === exit.y) };
}

/** Rooms the spawn-to-exit route passes through, in route order, entry and exit rooms last. */
function routeRooms(rooms, route, data) {
  if (!route) return [];
  const passed = rooms.filter((room) => route.some((cell) => inRoom(room, cell)));
  const inner = passed.filter((room) => room.id !== data.entryRoomId && room.id !== data.exitRoomId);
  return inner.length > 0 ? inner : passed;
}

// The doorways the route enters and leaves the room by; else the two doorways farthest apart.
function lineEnds(room, doorways, route) {
  const doorwayKeys = new Set(doorways.map(key));
  if (route) {
    const inside = route.map((cell, index) => (inRoom(room, cell) ? index : -1)).filter((index) => index >= 0);
    if (inside.length > 0) {
      const before = route[inside[0] - 1];
      const after = route[inside[inside.length - 1] + 1];
      if (before && after && doorwayKeys.has(key(before)) && doorwayKeys.has(key(after)) && key(before) !== key(after)) {
        return [before, after];
      }
    }
  }
  let best = null;
  doorways.forEach((left, index) => doorways.slice(index + 1).forEach((right) => {
    const gap = Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
    if (!best || gap > best.gap) best = { gap, ends: [left, right] };
  }));
  return best ? best.ends : null;
}

function drawKinds(count, seed) {
  const damaging = AFFINITY_TABLE.map((row, index) => ({ row, code: index + 1 })).filter(({ row }) => row.outward === "damage");
  const start = Math.abs(Math.trunc(seed)) % damaging.length;
  const rotated = [...damaging.slice(start), ...damaging.slice(0, start)];
  const picked = [];
  for (const entry of rotated) {
    if (picked.some((other) => getOppositeAffinityKind(other.code) === entry.code)) continue;
    picked.push(entry);
  }
  return Array.from({ length: count }, (_, index) => picked[index % picked.length].row.kind);
}

/**
 * An ordinary emit hazard of `kind` at range `range`, intensity 1: the viability floor, and mana
 * regen that covers its field's upkeep so the field stays lit. Minefields and shrines (#486) alike.
 */
export function composeFieldHazard(id, kind, range) {
  const upkeep = computeInternalManaUpkeep(range + INTENSITY);
  const mana = Math.max(ACTOR_VIABILITY_FLOOR.mana.max, upkeep);
  const { max: durability, regen: durabilityRegen } = ACTOR_VIABILITY_FLOOR.durability;
  return {
    id,
    affinity: kind,
    expression: EXPRESSION,
    proximityRadius: 0,
    affinityStacks: [{ kind, expression: EXPRESSION, stacks: range, intensity: INTENSITY, targetType: "floor" }],
    vitals: {
      // Regen covers the field's upkeep, so the field stays lit.
      mana: { kind: "regen", current: mana, max: mana, regen: Math.max(ACTOR_VIABILITY_FLOOR.mana.regen, upkeep) },
      durability: { kind: "regen", current: durability, max: durability, regen: durabilityRegen },
    },
    blocking: false,
    _schemaVersion: 3,
  };
}

/**
 * Compose a minefield in `room`. Returns `{ hazards, placement, row }`: the new hazards, a
 * placement constraint seating each one (and the reward) on its chosen cell, and the report
 * row fields; or `{ row }` alone when the room cannot hold one.
 */
export function composeMinefield({ layout, room, params, seed = 0, reward = null, takenIds = new Set(), occupied = new Set() }) {
  const { allowed, route } = routeCells(layout);
  const doorways = roomDoorways(layout, room);
  const ends = lineEnds(room, doorways, route);
  if (!ends) return { row: { applied: false, note: `${room.id} needs two doorways for a line through it` } };
  const roomCells = [...allowed].map((entry) => entry.split(",").map(Number)).map(([x, y]) => ({ x, y }))
    .filter((cell) => inRoom(room, cell));
  const isEnd = (cell) => cell.x === ends[1].x && cell.y === ends[1].y;
  const endKeys = [key(ends[0]), key(ends[1])];
  const edgeKeys = roomCells.filter((cell) => onEdge(room, cell)).map(key);
  const shortRoute = shortestPath(new Set([...roomCells.map(key), ...endKeys]), ends[0], isEnd);
  if (!shortRoute) return { row: { applied: false, note: `${room.id} has no line from doorway to doorway` } };
  const clearance = minefieldClearance(params.range);
  const zoneOf = (line) => roomCells.filter((cell) => [...occupied].every((entry) => {
    const [x, y] = entry.split(",").map(Number);
    return chebyshev(cell, { x, y }) > 1;
  }) && line.every((step) => chebyshev(cell, step) >= clearance)).sort((left, right) => left.y - right.y || left.x - right.x);
  const wanted = params.hazards + (reward ? 1 : 0);
  // A cluster around a centre as close to the short route as the clear cells allow (the seed
  // picks among equals), so the fields lie across the short way through. No two seats touch
  // (#370 keeps hazards and resources apart, so none starts inside another's reach of 1), yet
  // seats two apart still share the cell between them, so the fields overlap.
  const toRoute = (cell) => Math.min(...shortRoute.map((step) => chebyshev(cell, step)));
  const clusterIn = (zone) => {
    if (zone.length === 0) return [];
    const closest = Math.min(...zone.map(toRoute));
    const centres = zone.filter((cell) => toRoute(cell) === closest);
    const centre = centres[Math.abs(Math.trunc(seed)) % centres.length];
    const seats = [];
    [...zone].sort((left, right) => chebyshev(left, centre) - chebyshev(right, centre)
      || left.y - right.y || left.x - right.x).forEach((cell) => {
      if (seats.length < wanted && seats.every((seat) => chebyshev(seat, cell) > 1)) seats.push(cell);
    });
    return seats;
  };
  // The safe line runs along the room's edge, either way round. The long way leaves the short
  // route through the middle for the minefield, so it comes first; then the short way round,
  // then the short route itself. The first whose clear cells seat everything wins, else the
  // one that seats the most.
  const near = shortestPath(new Set([...edgeKeys, ...endKeys]), ends[0], isEnd);
  const nearInner = new Set((near || []).slice(1, -1).map(key));
  const far = near ? shortestPath(new Set([...edgeKeys.filter((entry) => !nearInner.has(entry)), ...endKeys]), ends[0], isEnd) : null;
  const options = [far, near, shortRoute].filter(Boolean).map((line) => ({ line, cluster: clusterIn(zoneOf(line)) }));
  const { line, cluster } = options.find((option) => option.cluster.length >= wanted)
    || options.reduce((best, option) => (option.cluster.length > best.cluster.length ? option : best));
  const notes = [];
  if (cluster.length === 0) {
    return { row: { applied: false, note: `${room.id} has no cell ${clearance} from its safe line for a hazard` } };
  }
  const count = Math.min(params.hazards, cluster.length);
  if (count < params.hazards) notes.push(`${room.id} holds ${count} of ${params.hazards} hazards clear of its safe line`);
  const kinds = params.kinds
    ? Array.from({ length: count }, (_, index) => params.kinds[index % params.kinds.length])
    : drawKinds(count, seed);
  const hazards = [];
  const placement = [];
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    let id;
    let ordinal = index;
    do { ordinal += 1; id = `minefield_${room.id}_${ordinal}`; } while (takenIds.has(id));
    takenIds.add(id);
    hazards.push(composeFieldHazard(id, kinds[index], params.range));
    ids.push({ id, kind: kinds[index] });
    placement.push({ label: `minefield ${room.id}: hazard:${id} (${kinds[index]}) at ${key(cluster[index])}`,
      subject: { kind: "hazard", ref: id }, near: { target: { kind: "cells", cells: [cluster[index]] }, distance: 0 } });
  }
  const rewardCell = reward ? cluster[count] : null;
  if (reward && !rewardCell) notes.push(`${room.id} has no cell left in the minefield for resource:${reward}`);
  if (rewardCell) {
    placement.push({ label: `minefield ${room.id}: resource:${reward} in the minefield at ${key(rewardCell)}`,
      subject: { kind: "resource", ref: reward }, near: { target: { kind: "cells", cells: [rewardCell] }, distance: 0 } });
  }
  return {
    hazards,
    placement,
    row: {
      applied: true,
      room: room.id,
      hazards: ids,
      ...(rewardCell ? { reward } : {}),
      safeLine: { length: line.length, from: { ...ends[0] }, to: { ...ends[1] }, clearance, cells: line.map(({ x, y }) => ({ x, y })) },
      ...(shortRoute ? { shortRoute: { length: shortRoute.length } } : {}),
      ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    },
  };
}

/** Every room the spawn-to-exit route passes through, the entry and exit rooms included. */
export function roomsOnRoute(layout, rooms) {
  const { route } = routeCells(layout);
  return route ? rooms.filter((room) => route.some((cell) => inRoom(room, cell))) : [];
}

/** The room a minefield goes in: `room=`, else one the route passes, picked from the seed. */
export function pickMinefieldRoom(layout, rooms, seed, index) {
  const data = layout?.data || layout || {};
  const { route } = routeCells(layout);
  const onRoute = routeRooms(rooms, route, data).filter((room) => roomDoorways(layout, room).length >= 2);
  const pool = onRoute.length > 0 ? onRoute : rooms.filter((room) => roomDoorways(layout, room).length >= 2);
  return pool.length > 0 ? pool[(Math.abs(Math.trunc(seed)) + index) % pool.length] : null;
}

/**
 * Drop the hazards tactics added (minefields, shrines #486) until the Allocator approves the
 * hazard share. `affordable(dropped)` prices the level without the dropped hazard ids; hazards go
 * from the end of the last such tactic first. Returns the dropped ids and the report rows with a
 * note per shrunk tactic.
 */
export function fitTacticHazards({ report = [], affordable }) {
  const order = report.filter((row) => Array.isArray(row?.hazards))
    .flatMap((row) => row.hazards.map((hazard) => hazard.id));
  const dropped = new Set();
  while (order.length > dropped.size && !affordable(dropped)) dropped.add(order[order.length - 1 - dropped.size]);
  if (dropped.size === 0) return { dropped, report };
  return {
    dropped,
    report: report.map((row) => {
      if (!Array.isArray(row?.hazards)) return row;
      const kept = row.hazards.filter((hazard) => !dropped.has(hazard.id));
      if (kept.length === row.hazards.length) return row;
      const note = `the hazard share affords ${kept.length} of ${row.hazards.length} hazards`;
      return { ...row, hazards: kept,
        ...(Array.isArray(row.shrines) ? { shrines: row.shrines.filter((shrine) => !dropped.has(shrine.id)) } : {}),
        note: row.note ? `${row.note}; ${note}` : note };
    }),
  };
}
