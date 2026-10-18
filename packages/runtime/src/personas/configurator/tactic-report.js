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
 */
import { hiddenRoomCells } from "./doorway-sight.js";
import { composeRetinue, readRetinueParams } from "./retinue.js";
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
 * Compile the tactics into placement constraints. Returns `{ placement, report }`: the authored
 * constraints followed by the compiled ones, one report row per tactic in order, and the
 * actors the tactics add (retinue minions).
 */
export function compileTactics({ tactics = [], layout, actors = [], resources = [], placement = [], seed = 0 } = {}) {
  if (!Array.isArray(tactics) || tactics.length === 0) return { placement, report: [], actors: [] };
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
  const report = tactics.map((entry, index) => {
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
  return { placement: [...placement, ...compiled], report, actors: added };
}
