/**
 * #486 — the `shrine` tactic, Configurator policy (Darren, 2026-10-24): helping hazards are a
 * placement role, not a new actor type. A room gets hazards whose emitted field restores a vital,
 * a detour worth taking: a room the spawn-to-exit route does not pass through when the level has
 * one, else a route room, picked from the seed (`room=` names it).
 *
 * Kinds are drawn from the affinity table's restoring rows by the seed, never picked per kind;
 * `kinds=` names them and must name restoring kinds. A shrine whose kind restores health is
 * reported as a healing well; the name follows the table's `primaryVital`, not the kind.
 *
 * Shrines are ordinary field hazards (`composeFieldHazard`), seated on chosen cells near the
 * room's centre, never touching each other or any other hazard (#370). The Allocator prices them
 * from the hazard share; `fitTacticHazards` drops shrines it cannot afford.
 */
import { AFFINITY_TABLE } from "../../../../core-ts/src/state/affinity-table.ts";
import { composeFieldHazard, roomsOnRoute } from "./minefield.js";
import { terrainPositions } from "./terrain-layout.js";

const SHRINE_PARAMS = Object.freeze(["count", "room", "range", "kinds"]);
const DEFAULTS = Object.freeze({ count: 1, range: 1 });
const HEALING_VITAL = "health";

const key = ({ x, y }) => `${x},${y}`;
const chebyshev = (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));

function restoringRows() {
  return AFFINITY_TABLE.filter((row) => row.outward === "restore");
}

function readCount(params, name) {
  if (params[name] === undefined) return DEFAULTS[name];
  const value = Number(params[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`tactic shrine: ${name} must be a whole number >= 1.`);
  return value;
}

export function readShrineParams(params = {}) {
  const unknown = Object.keys(params).filter((name) => !SHRINE_PARAMS.includes(name));
  if (unknown.length > 0) throw new Error(`tactic shrine: unknown param ${unknown.join(", ")} (${SHRINE_PARAMS.join(", ")}).`);
  let kinds = null;
  if (params.kinds !== undefined) {
    kinds = String(params.kinds).split("+").map((kind) => kind.trim()).filter(Boolean);
    const known = AFFINITY_TABLE.map((row) => row.kind);
    const unknownKinds = kinds.filter((kind) => !known.includes(kind));
    if (kinds.length === 0 || unknownKinds.length > 0) {
      throw new Error(`tactic shrine: kinds must be <kind>[+<kind>...] from ${known.join(", ")}${unknownKinds.length > 0 ? ` (not ${unknownKinds.join(", ")})` : ""}.`);
    }
    const restoring = restoringRows().map((row) => row.kind);
    const harmful = kinds.filter((kind) => !restoring.includes(kind));
    if (harmful.length > 0) {
      throw new Error(`tactic shrine: ${harmful.join(", ")} does not restore a vital; shrine kinds restore a vital: ${restoring.join(", ")}.`);
    }
  }
  return {
    count: readCount(params, "count"),
    range: readCount(params, "range"),
    room: params.room === undefined ? null : String(params.room),
    kinds,
  };
}

/** The room a shrine goes in: one the route does not pass, else a route room, picked from the seed. */
export function pickShrineRoom(layout, rooms, seed, index) {
  const data = layout?.data || layout || {};
  const onRoute = new Set(roomsOnRoute(layout, rooms).map((room) => room.id));
  const detours = rooms.filter((room) => !onRoute.has(room.id) && room.id !== data.entryRoomId && room.id !== data.exitRoomId);
  const inner = rooms.filter((room) => room.id !== data.entryRoomId && room.id !== data.exitRoomId);
  const pool = detours.length > 0 ? detours : inner.length > 0 ? inner : rooms;
  return pool.length > 0 ? pool[(Math.abs(Math.trunc(seed)) + index) % pool.length] : null;
}

function inRoom(room, { x, y }) {
  return x >= room.x && y >= room.y && x < room.x + room.width && y < room.y + room.height;
}

/**
 * Compose shrines in `room`. Returns `{ hazards, placement, row }`: the new hazards, a placement
 * constraint seating each on its chosen cell, and the report row fields; or `{ row }` alone when
 * the room has no cell clear of other hazards.
 */
export function composeShrines({ layout, room, params, seed = 0, takenIds = new Set(), occupied = new Set() }) {
  const clear = terrainPositions(layout).filter((cell) => inRoom(room, cell) && [...occupied].every((entry) => {
    const [x, y] = entry.split(",").map(Number);
    return chebyshev(cell, { x, y }) > 1;
  }));
  if (clear.length === 0) return { row: { applied: false, note: `${room.id} has no cell clear of other hazards for a shrine` } };
  // Nearest the room's centre first (the seed picks among equals), never two seats touching.
  const centre = { x: room.x + (room.width - 1) / 2, y: room.y + (room.height - 1) / 2 };
  const offset = (cell) => Math.max(Math.abs(cell.x - centre.x), Math.abs(cell.y - centre.y));
  const closest = Math.min(...clear.map(offset));
  const centres = clear.filter((cell) => offset(cell) === closest).sort((left, right) => left.y - right.y || left.x - right.x);
  const first = centres[Math.abs(Math.trunc(seed)) % centres.length];
  const seats = [];
  [...clear].sort((left, right) => chebyshev(left, first) - chebyshev(right, first) || left.y - right.y || left.x - right.x)
    .forEach((cell) => {
      if (seats.length < params.count && seats.every((seat) => chebyshev(seat, cell) > 1)) seats.push(cell);
    });
  const rows = restoringRows();
  const start = Math.abs(Math.trunc(seed)) % rows.length;
  const kinds = seats.map((_, index) => (params.kinds
    ? params.kinds[index % params.kinds.length]
    : rows[(start + index) % rows.length].kind));
  const hazards = [];
  const placement = [];
  const ids = [];
  const shrines = [];
  seats.forEach((seat, index) => {
    let id;
    let ordinal = index;
    do { ordinal += 1; id = `shrine_${room.id}_${ordinal}`; } while (takenIds.has(id));
    takenIds.add(id);
    const restores = rows.find((row) => row.kind === kinds[index]).primaryVital;
    const name = restores === HEALING_VITAL ? "healing well" : "shrine";
    hazards.push(composeFieldHazard(id, kinds[index], params.range));
    ids.push({ id, kind: kinds[index] });
    shrines.push({ id, kind: kinds[index], restores, name });
    placement.push({ label: `shrine ${room.id}: hazard:${id} (${kinds[index]} ${name}) at ${key(seat)}`,
      subject: { kind: "hazard", ref: id }, near: { target: { kind: "cells", cells: [seat] }, distance: 0 } });
  });
  const notes = seats.length < params.count ? [`${room.id} holds ${seats.length} of ${params.count} shrines`] : [];
  return {
    hazards,
    placement,
    row: { applied: true, room: room.id, hazards: ids, shrines, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) },
  };
}
