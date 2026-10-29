/**
 * #400 — the `retinue` tactic, Configurator policy: a leader warden and `size` minions
 * seated within 2 of it.
 *
 * A minion's loadout is derived from core's affinity table, never picked per kind. Roles
 * fill in order, then repeat:
 * - shield: emits the leader's own kind, the same kind its opposite meets near the leader;
 * - support: pushes the restoring kind that acts on the leader's defeat vital (healing
 *   reaches anyone, so it reaches the leader);
 * - striker: the leader's kind in the first harmful expression the leader lacks (inward
 *   expressions steal for every kind; outward ones harm only for a damaging kind).
 * A leader with no affinity has no kind to shield or strike with, so it gets supports only.
 *
 * Minions are ordinary wardens: the leader's motivations, the actor viability floor for
 * vitals, and one affinity slot. The Allocator prices them like any warden; a retinue the
 * warden share cannot afford is shrunk by `fitRetinues` against the Allocator's receipt.
 *
 * A delver may lead one too (the player's own minions, 2026-10-29): its minions are delvers
 * that escort it and take its orders (`escorting` + `friendly`, never `user_controlled`), with
 * the same loadouts, floor and slot, priced from the delver share. They start with it, seated as
 * delvers are, so they pose no placement question (and the phone app, which has no solver,
 * builds the same level). `roles` names the roles
 * in order (`shield+support`) instead of filling them by count.
 */
import { AFFINITY_TABLE } from "../../../../core-ts/src/state/affinity-table.ts";
import { ACTOR_VIABILITY_FLOOR } from "../../contracts/domain-constants.js";

export const RETINUE_ROLES = Object.freeze(["shield", "support", "striker"]);
const RETINUE_PARAMS = Object.freeze(["leader", "size", "roles"]);
// What a delver's minions do: keep near it and take its orders.
const DELVER_MINION_MOTIVATIONS = Object.freeze(["escorting", "friendly"]);
const DEFAULT_SIZE = RETINUE_ROLES.length;
export const RETINUE_DISTANCE = 2;
// Reach 2 covers the leader from any seat within RETINUE_DISTANCE; intensity 1 is the base.
const MINION_RANGE = RETINUE_DISTANCE;
const MINION_INTENSITY = 1;
const EXPRESSION_ORDER = Object.freeze(["push", "pull", "emit", "draw"]);
const OUTWARD = new Set(["push", "emit"]);

export function readRetinueParams(params = {}) {
  const unknown = Object.keys(params).filter((name) => !RETINUE_PARAMS.includes(name));
  if (unknown.length > 0) throw new Error(`tactic retinue: unknown param ${unknown.join(", ")} (${RETINUE_PARAMS.join(", ")}).`);
  const roles = params.roles === undefined ? null : String(params.roles).split("+").map((role) => role.trim()).filter(Boolean);
  const unknownRole = (roles ?? []).find((role) => !RETINUE_ROLES.includes(role));
  if (unknownRole) throw new Error(`tactic retinue: unknown role ${unknownRole} (${RETINUE_ROLES.join(", ")}, joined with +).`);
  const size = params.size === undefined ? (roles ? roles.length : DEFAULT_SIZE) : Number(params.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("tactic retinue: size must be a whole number >= 0.");
  if (roles && size !== roles.length) throw new Error(`tactic retinue: size ${size} does not match the ${roles.length} roles named.`);
  return { leader: params.leader === undefined ? null : String(params.leader), size, roles };
}

function leaderKind(leader) {
  const active = typeof leader?.activeAffinityKey === "string" ? leader.activeAffinityKey.split(":")[0] : null;
  const first = Array.isArray(leader?.affinities) ? leader.affinities.find((entry) => entry?.kind)?.kind : null;
  return active || first || null;
}

function roleLoadout(role, leader) {
  const kind = leaderKind(leader);
  if (role === "support") {
    const defeatVital = leader?.defeatVital || "health";
    const restorer = AFFINITY_TABLE.find((row) => row.outward === "restore" && row.primaryVital === defeatVital);
    return restorer ? { kind: restorer.kind, expression: "push" } : null;
  }
  if (!kind) return null;
  if (role === "shield") return { kind, expression: "emit" };
  const row = AFFINITY_TABLE.find((entry) => entry.kind === kind);
  const harmful = EXPRESSION_ORDER.filter((expression) => !OUTWARD.has(expression) || row?.outward === "damage");
  const held = new Set((leader.affinities || []).filter((entry) => entry?.kind === kind).map((entry) => entry.expression));
  return { kind, expression: harmful.find((expression) => !held.has(expression)) ?? harmful[0] };
}

function floorVitals() {
  const vital = ({ max, regen }) => ({ current: max, max, regen });
  return {
    health: vital(ACTOR_VIABILITY_FLOOR.health),
    mana: vital(ACTOR_VIABILITY_FLOOR.mana),
    // The floor names no stamina; a minion gets the same pool, and moving motivations are
    // raised further by the build's vital floors like any authored actor.
    stamina: vital(ACTOR_VIABILITY_FLOOR.health),
    durability: vital(ACTOR_VIABILITY_FLOOR.durability),
  };
}

/**
 * Compose `size` minions for `leader`. Returns `{ minions, roles, placement, notes }`: the new
 * warden actors, `{ id, role }` per minion (the role stays in the report, never on the actor),
 * a near-the-leader constraint per minion, and any notes for the report row.
 */
export function composeRetinue({ leader, size, roles: named = null, category = "warden", takenIds = new Set() }) {
  const usable = RETINUE_ROLES.filter((role) => roleLoadout(role, leader));
  const notes = usable.length < RETINUE_ROLES.length
    ? [`${leader.id} has no affinity kind, so its retinue is ${usable.join(" and ")} only`] : [];
  // Named roles keep their order; one the leader cannot fill (no kind to shield or strike with) is left out.
  const order = named ? named.filter((role) => usable.includes(role)) : null;
  if (named && order.length < named.length) notes.push(`${named.length - order.length} of ${named.length} named roles need an affinity kind ${leader.id} lacks`);
  const count = order ? order.length : size;
  const minions = [];
  const roles = [];
  const placement = [];
  let ordinal = 0;
  for (let index = 0; index < count && usable.length > 0; index += 1) {
    const role = order ? order[index] : usable[index % usable.length];
    let id;
    do { ordinal += 1; id = `${leader.id}_minion_${ordinal}`; } while (takenIds.has(id));
    takenIds.add(id);
    const { kind, expression } = roleLoadout(role, leader);
    const delver = category === "delver";
    minions.push({
      id,
      category,
      motivations: delver ? [...DELVER_MINION_MOTIVATIONS] : Array.isArray(leader.motivations) ? [...leader.motivations] : [],
      vitals: floorVitals(),
      affinities: [{ kind, expression, stacks: MINION_RANGE, intensity: MINION_INTENSITY }],
      activeAffinityKey: `${kind}:${expression}`,
      ...(delver ? { escort: { target: leader.id, distance: RETINUE_DISTANCE } } : {}),
    });
    roles.push({ id, role });
    // A delver's minions start with it, seated as delvers are; a warden's are posed to the solver.
    if (!delver) placement.push({ label: `retinue ${leader.id}: ${category}:${id} (${role}) within ${RETINUE_DISTANCE} of ${category}:${leader.id}`,
      subject: { kind: category, ref: id },
      near: { target: { kind: category, ref: leader.id }, distance: RETINUE_DISTANCE } });
  }
  return { minions, roles, placement, notes };
}

/**
 * Shrink each retinue until the Allocator approves the warden share. `affordable(dropped)`
 * prices the level without the dropped minion ids and says whether the warden pool is
 * approved; minions go from the end of the last retinue first. Returns the dropped ids and
 * the report rows with their kept minions and a note per shrunk retinue.
 */
export function fitRetinues({ report = [], affordable }) {
  const order = report.filter((row) => row?.tactic === "retinue" && Array.isArray(row.minions))
    .flatMap((row) => row.minions.map((minion) => minion.id));
  const dropped = new Set();
  while (order.length > dropped.size && !affordable(dropped)) dropped.add(order[order.length - 1 - dropped.size]);
  if (dropped.size === 0) return { dropped, report };
  return {
    dropped,
    report: report.map((row) => {
      if (row?.tactic !== "retinue" || !Array.isArray(row.minions)) return row;
      const kept = row.minions.filter((minion) => !dropped.has(minion.id));
      if (kept.length === row.minions.length) return row;
      const note = `the warden share affords ${kept.length} of ${row.minions.length} minions`;
      return { ...row, minions: kept, note: row.note ? `${row.note}; ${note}` : note };
    }),
  };
}
