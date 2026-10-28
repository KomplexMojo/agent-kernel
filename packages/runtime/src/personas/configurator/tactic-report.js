/**
 * #396/#398 — the Configurator's side of the plan's tactics (`directives.tactics`).
 *
 * `compileTactics` turns each tactic it knows into #301 placement constraints over the level's
 * own wardens and resources, so the placement search seats them; every tactic gets a report
 * row saying what was done with it, so an asked-for tactic is never silently dropped.
 *
 * `ambush` (#398): a room (named with `room=`, else picked from the seed) gets `resources=<n>`
 * of the level's resources and `guards=<n>` of its wardens. The guards are seated out of sight
 * of the room's doorways (core's line of sight, doorway-sight.js); with `visible=true` they
 * stand in the open within 2 of the loot instead. A room that cannot hide them all hides as
 * many as fit and seats the rest in the open, and the row says so; the level is never refused
 * for it. Guards are the level's ordinary wardens, priced as such by the Allocator. Which
 * wardens and resources: those no authored `--place` constraint names, in id order.
 *
 * `retinue` (#400): `leader=<warden id>` (else the first free warden) gets `size=<n>` (3)
 * minions composed by role from the affinity table (retinue.js), each within 2 of it. The
 * minions are new wardens returned in `actors`; the Allocator prices them, and `fitRetinues`
 * shrinks a retinue the warden share cannot afford.
 *
 * `minefield` (#418): a room on the spawn-to-exit route (`room=`, else picked from the seed)
 * gets `hazards=<n>` (4) new emit hazards of range `range=<n>` (1) seated in a cluster clear of
 * a safe line through the room, and one of the level's free resources as the reward
 * (minefield.js). The hazards are returned in `hazards`; the Allocator prices them, and
 * `fitTacticHazards` shrinks a minefield the hazard share cannot afford.
 *
 * `shrine` (#486): a room off the spawn-to-exit route (`room=`, else picked from the seed; a
 * route room when there is no other) gets `count=<n>` (1) emit hazards of a restoring kind,
 * range `range=<n>` (1), drawn from the affinity table by the seed (shrine.js). A health shrine is
 * reported as a healing well. Priced from the hazard share like a minefield's hazards.
 */
import { hiddenRoomCells } from "./doorway-sight.js";
import { composeRetinue, readRetinueParams } from "./retinue.js";
import { composeMinefield, pickMinefieldRoom, readMinefieldParams } from "./minefield.js";
import { composeShrines, pickShrineRoom, readShrineParams } from "./shrine.js";
import { leftoverCategory } from "./unified-actors.js";

const NOT_APPLIED_NOTE = "recorded but not applied: the Configurator does not compile this tactic yet";
const AMBUSH_PARAMS = Object.freeze({ guards: 2, resources: 1 });
const LOOT_GUARD_DISTANCE = 2;

function withParams(entry) {
  return entry.params && Object.keys(entry.params).length > 0 ? { params: { ...entry.params } } : {};
}

/** A report row per tactic, none applied: the build's answer when no tactic is compiled. */
export function reportTactics(tactics) {
  if (!Array.isArray(tactics)) return [];
  return tactics
    .filter((entry) => entry && typeof entry.tactic === "string")
    .map((entry) => ({ tactic: entry.tactic, ...withParams(entry), applied: false, note: NOT_APPLIED_NOTE }));
}

function isWarden(actor) {
  const category = leftoverCategory(actor);
  if (category) return category === "warden";
  return actor?.alignment === "dungeon";
}

function readCount(params, name) {
  if (params[name] === undefined) return AMBUSH_PARAMS[name];
  const value = Number(params[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`tactic ambush: ${name} must be a whole number >= 0.`);
  return value;
}

function readAmbushParams(params = {}) {
  const unknown = Object.keys(params).filter((name) => !["guards", "resources", "room", "visible"].includes(name));
  if (unknown.length > 0) throw new Error(`tactic ambush: unknown param ${unknown.join(", ")} (guards, resources, room, visible).`);
  const visible = params.visible === undefined ? false : String(params.visible);
  if (![false, "true", "false"].includes(visible)) throw new Error("tactic ambush: visible must be true or false.");
  return {
    guards: readCount(params, "guards"),
    resources: readCount(params, "resources"),
    room: params.room === undefined ? null : String(params.room),
    visible: visible === "true",
  };
}

const PARAM_READERS = Object.freeze({ ambush: readAmbushParams, retinue: readRetinueParams, minefield: readMinefieldParams,
  shrine: readShrineParams });

/**
 * #402 — check a tactic list before the build, for a plan the Configurator didn't author (the
 * LLM's). Each entry's params go through the same readers the compile uses, and the level must
 * have the wardens and resources the plan claims: a guard or a leader each takes a warden of its
 * own, and an ambush's loot takes resources. Returns the reasons it can't be used; [] is valid.
 */
export function validateTactics(tactics, { wardens = 0, resources = 0 } = {}) {
  if (!Array.isArray(tactics) || tactics.length === 0) return ["no tactics"];
  const errors = [];
  let wardensClaimed = 0;
  let resourcesClaimed = 0;
  for (const entry of tactics) {
    const read = PARAM_READERS[entry?.tactic];
    if (!read) {
      errors.push(`unknown tactic "${entry?.tactic}"`);
      continue;
    }
    try {
      const params = read(entry.params || {});
      if (entry.tactic === "ambush") {
        wardensClaimed += params.guards;
        resourcesClaimed += params.resources;
      }
      if (entry.tactic === "retinue") wardensClaimed += 1;
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (wardensClaimed > wardens) errors.push(`the plan needs ${wardensClaimed} warden(s); the level has ${wardens}`);
  if (resourcesClaimed > resources) errors.push(`the plan needs ${resourcesClaimed} resource(s); the level has ${resources}`);
  return errors;
}

function pickRoom(rooms, data, seed, index) {
  const nonEntry = rooms.filter((room) => room.id !== data.entryRoomId);
  const inner = nonEntry.filter((room) => room.id !== data.exitRoomId);
  const pool = inner.length > 0 ? inner : nonEntry.length > 0 ? nonEntry : rooms;
  return pool.length > 0 ? pool[(Math.abs(Math.trunc(seed)) + index) % pool.length] : null;
}

function inRoom(room) {
  return { kind: "room", ref: room.id };
}

/**
 * Compile the tactics into placement constraints. Returns `{ placement, report, actors, hazards }`:
 * the authored constraints followed by the compiled ones, one report row per tactic in order,
 * the actors the tactics add (retinue minions) and the hazards they add (minefields, shrines).
 * `hazards` are the level's authored hazards, so new ids and cells stay clear of them.
 */
export function compileTactics({ tactics = [], layout, actors = [], resources = [], hazards = [], placement = [], seed = 0 } = {}) {
  if (!Array.isArray(tactics) || tactics.length === 0) return { placement, report: [], actors: [], hazards: [] };
  const data = layout?.data || layout || {};
  const rooms = (Array.isArray(data.rooms) ? data.rooms : []).filter((room) => typeof room?.id === "string");
  const named = new Set((Array.isArray(placement) ? placement : [])
    .map((constraint) => constraint?.subject)
    .filter((subject) => subject && subject.ref !== "*")
    .map((subject) => `${subject.kind}:${subject.ref}`));
  const free = (kind, ids) => ids.filter((id) => !named.has(`${kind}:${id}`));
  const wardens = free("warden", actors.filter(isWarden).map((actor) => actor.id).filter((id) => typeof id === "string").sort());
  const loot = free("resource", resources.map((resource, index) => (
    typeof resource?.id === "string" && resource.id.trim() ? resource.id.trim() : `resource_${index + 1}`)));
  const claimed = new Set();
  const take = (ids, count) => {
    const picked = ids.filter((id) => !claimed.has(id)).slice(0, count);
    picked.forEach((id) => claimed.add(id));
    return picked;
  };
  const compiled = [];
  const added = [];
  const takenIds = new Set(actors.map((actor) => actor?.id).filter((id) => typeof id === "string"));
  const addedHazards = [];
  const hazardIds = new Set([...hazards, ...(Array.isArray(data.hazards) ? data.hazards : [])]
    .map((hazard) => hazard?.id).filter((id) => typeof id === "string"));
  const hazardCells = new Set((Array.isArray(data.hazards) ? data.hazards : [])
    .filter((hazard) => Number.isFinite(hazard?.x) && Number.isFinite(hazard?.y)).map(({ x, y }) => `${x},${y}`));
  const report = tactics.map((entry, index) => {
    if (entry?.tactic === "minefield") {
      const params = readMinefieldParams(entry.params);
      const room = params.room ? rooms.find((candidate) => candidate.id === params.room) : pickMinefieldRoom(layout, rooms, seed, index);
      if (params.room && !room) throw new Error(`tactic minefield: no room "${params.room}" in this level.`);
      if (!room) return { tactic: "minefield", ...withParams(entry), applied: false, note: "this level has no room with two doorways for a minefield" };
      const reward = take(loot, 1)[0] ?? null;
      const minefield = composeMinefield({ layout, room, params, seed, reward, takenIds: hazardIds, occupied: hazardCells });
      if (reward && minefield.row.reward !== reward) claimed.delete(reward);
      addedHazards.push(...(minefield.hazards || []));
      compiled.push(...(minefield.placement || []));
      (minefield.placement || []).forEach((constraint) => constraint.near.target.cells.forEach(({ x, y }) => hazardCells.add(`${x},${y}`)));
      return { tactic: "minefield", ...withParams(entry), ...(minefield.row.applied ? {} : { room: room.id }), ...minefield.row };
    }
    if (entry?.tactic === "shrine") {
      const params = readShrineParams(entry.params);
      const room = params.room ? rooms.find((candidate) => candidate.id === params.room) : pickShrineRoom(layout, rooms, seed, index);
      if (params.room && !room) throw new Error(`tactic shrine: no room "${params.room}" in this level.`);
      if (!room) return { tactic: "shrine", ...withParams(entry), applied: false, note: "this level has no room for a shrine" };
      const shrine = composeShrines({ layout, room, params, seed, takenIds: hazardIds, occupied: hazardCells });
      addedHazards.push(...(shrine.hazards || []));
      compiled.push(...(shrine.placement || []));
      (shrine.placement || []).forEach((constraint) => constraint.near.target.cells.forEach(({ x, y }) => hazardCells.add(`${x},${y}`)));
      return { tactic: "shrine", ...withParams(entry), ...(shrine.row.applied ? {} : { room: room.id }), ...shrine.row };
    }
    if (entry?.tactic === "retinue") {
      const params = readRetinueParams(entry.params);
      const leaderId = params.leader ?? wardens.find((id) => !claimed.has(id));
      if (params.leader && !actors.some((actor) => actor?.id === params.leader && isWarden(actor))) {
        throw new Error(`tactic retinue: no warden "${params.leader}" in this level.`);
      }
      if (!leaderId) return { tactic: "retinue", ...withParams(entry), applied: false, note: "this level has no warden to lead a retinue" };
      claimed.add(leaderId);
      const leader = actors.find((actor) => actor?.id === leaderId);
      const retinue = composeRetinue({ leader, size: params.size, takenIds });
      added.push(...retinue.minions);
      compiled.push(...retinue.placement);
      return {
        tactic: "retinue", ...withParams(entry), applied: true, leader: leaderId, minions: retinue.roles,
        ...(retinue.notes.length > 0 ? { note: retinue.notes.join("; ") } : {}),
      };
    }
    if (entry?.tactic !== "ambush") return reportTactics([entry])[0];
    const params = readAmbushParams(entry.params);
    const room = params.room ? rooms.find((candidate) => candidate.id === params.room) : pickRoom(rooms, data, seed, index);
    if (params.room && !room) throw new Error(`tactic ambush: no room "${params.room}" in this level.`);
    if (!room) return { tactic: "ambush", ...withParams(entry), applied: false, note: "this level has no rooms to set an ambush in" };
    const guards = take(wardens, params.guards);
    const items = take(loot, params.resources);
    const notes = [];
    if (guards.length < params.guards) notes.push(`${guards.length} of ${params.guards} guards: the level has no more free wardens`);
    if (items.length < params.resources) notes.push(`${items.length} of ${params.resources} resources: the level has no more free resources`);
    items.forEach((id) => compiled.push({ label: `ambush ${room.id}: resource:${id} in the room`,
      subject: { kind: "resource", ref: id }, near: { target: inRoom(room), distance: 0 } }));
    let hidden = 0;
    if (params.visible) {
      guards.forEach((id) => {
        compiled.push({ label: `ambush ${room.id}: warden:${id} guards in the open`,
          subject: { kind: "warden", ref: id }, near: { target: inRoom(room), distance: 0 } });
        if (items.length > 0) {
          compiled.push({ label: `ambush ${room.id}: warden:${id} within ${LOOT_GUARD_DISTANCE} of resource:${items[0]}`,
            subject: { kind: "warden", ref: id }, near: { target: { kind: "resource", ref: items[0] }, distance: LOOT_GUARD_DISTANCE } });
        }
      });
    } else {
      // Leave the loot room to sit anywhere: the hidden cells it might take are not counted.
      hidden = Math.min(guards.length, Math.max(0, hiddenRoomCells(layout, room).length - items.length));
      if (hidden < guards.length) notes.push(`${room.id} hides ${hidden} of ${guards.length} guards; the rest stand in the open`);
      guards.forEach((id, guardIndex) => compiled.push({
        label: `ambush ${room.id}: warden:${id} ${guardIndex < hidden ? "hidden from the doorways" : "in the open"}`,
        subject: { kind: "warden", ref: id },
        near: { target: inRoom(room), distance: 0 },
        ...(guardIndex < hidden ? { outOfSight: { target: inRoom(room) } } : {}),
      }));
    }
    return {
      tactic: "ambush", ...withParams(entry), applied: true, room: room.id,
      variant: params.visible ? "visible" : "hidden", guards, resources: items,
      ...(params.visible ? {} : { hidden }),
      ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    };
  });
  return { placement: [...placement, ...compiled], report, actors: added, hazards: addedHazards };
}
