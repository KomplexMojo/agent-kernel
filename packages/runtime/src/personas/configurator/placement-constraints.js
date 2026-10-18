/**
 * #301 — relational placement constraints, Configurator policy.
 *
 * A level recipe asks for placement as relationships ("a trap within 1 of the exit", "three
 * wardens within 2 of the trap", "the trap on the only route") instead of as a rule per
 * case. Each constraint names a SUBJECT (one or more placed things) and what must hold of
 * it. They become integer/linear constraints in the Configurator's object-placement problem
 * (object-placement.js); this module owns their shape, the spec-string grammar, how a
 * reference resolves, and how a finished placement is checked against them.
 *
 * Distances are Chebyshev (king moves). A room is as near as its nearest cell.
 *
 * Normalized constraint:
 *   { label, subject: Ref, near?: { target: Ref, distance }, far?: { target: Ref, distance },
 *     count?, route?: "on"|"off", arrange?: "spread"|"clump", outOfSight?: { target: RoomRef } }
 *
 * #398: `outOfSight=room:<id>` keeps the subject where no doorway of that room can see it, by
 * core's line-of-sight rule (doorway-sight.js). It is geometric, never light- or dark-dependent.
 * Ref: { kind: "spawn"|"exit" } | { kind: "room", ref } |
 *      { kind: "hazard"|"resource"|"delver"|"warden", ref }  (ref: id, 1-based ordinal, or "*")
 */

export const PLACEMENT_SUBJECT_KINDS = Object.freeze(["hazard", "resource", "delver", "warden"]);
const MARKER_KINDS = Object.freeze(["spawn", "exit"]);
const ARRANGEMENTS = Object.freeze(["spread", "clump"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseRef(text, { allowAll = false, field } = {}) {
  const raw = String(text ?? "").trim();
  if (MARKER_KINDS.includes(raw)) return { kind: raw };
  const separator = raw.indexOf(":");
  const kind = separator < 0 ? raw : raw.slice(0, separator);
  const ref = separator < 0 ? "" : raw.slice(separator + 1).trim();
  if (kind === "room") {
    if (!ref) throw new Error(`${field} needs a room id (room:<id>).`);
    return { kind, ref };
  }
  if (!PLACEMENT_SUBJECT_KINDS.includes(kind)) {
    throw new Error(`${field} "${raw}" must be spawn, exit, room:<id>, or ${PLACEMENT_SUBJECT_KINDS.join("|")}:<id|n${allowAll ? "|*" : ""}>.`);
  }
  if (!ref) throw new Error(`${field} "${raw}" needs an id, a 1-based number${allowAll ? ", or *" : ""}.`);
  if (ref === "*" && !allowAll) throw new Error(`${field} "${raw}" must name one thing, not *.`);
  return { kind, ref };
}

// "<target>:<distance>", where the target itself may contain a colon (hazard:trap1:2).
function parseTargetDistance(value, field) {
  const raw = String(value ?? "").trim();
  const separator = raw.lastIndexOf(":");
  const distance = Number(raw.slice(separator + 1));
  if (separator < 0 || !Number.isInteger(distance) || distance < 0) {
    throw new Error(`${field} "${raw}" must be <target>:<distance>, distance a whole number >= 0.`);
  }
  return { target: parseRef(raw.slice(0, separator), { field }), distance };
}

/**
 * The spec-string grammar `ak create --place` and `ak_create` share:
 *   "<subject>[;near=<target>:<d>][;far=<target>:<d>][;count=<n>][;onRoute|offRoute][;spread|clump]"
 */
export function parsePlacementConstraint(text, index = 0) {
  const field = `place[${index + 1}]`;
  if (!isNonEmptyString(text)) throw new Error(`${field} must be a non-empty spec string.`);
  const [subjectText, ...clauses] = text.split(";").map((part) => part.trim()).filter(Boolean);
  const constraint = { label: text.trim(), subject: parseRef(subjectText, { allowAll: true, field: `${field} subject` }) };
  for (const clause of clauses) {
    const [key, value] = clause.split("=").map((part) => part.trim());
    if (key === "near" || key === "far") constraint[key] = parseTargetDistance(value, `${field} ${key}`);
    else if (key === "count") constraint.count = Number(value);
    else if (key === "onRoute" && value === undefined) constraint.route = "on";
    else if (key === "offRoute" && value === undefined) constraint.route = "off";
    else if (ARRANGEMENTS.includes(key) && value === undefined) constraint.arrange = key;
    else if (key === "outOfSight" && value !== undefined) constraint.outOfSight = { target: parseRef(value, { field: `${field} outOfSight` }) };
    else throw new Error(`${field} clause "${clause}" is not one of near=, far=, count=, onRoute, offRoute, spread, clump, outOfSight=.`);
  }
  return normalizePlacementConstraint(constraint, index);
}

function normalizeRef(ref, { allowAll, field }) {
  if (!ref || typeof ref !== "object") throw new Error(`${field} must be an object.`);
  if (MARKER_KINDS.includes(ref.kind)) return { kind: ref.kind };
  const value = typeof ref.ref === "number" ? String(ref.ref) : ref.ref;
  return parseRef(`${ref.kind}:${value ?? ""}`, { allowAll, field });
}

/** Validate one constraint (object form) and return its canonical shape. Throws on error. */
export function normalizePlacementConstraint(raw, index = 0) {
  const field = `place[${index + 1}]`;
  if (typeof raw === "string") return parsePlacementConstraint(raw, index);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${field} must be an object or spec string.`);
  const subject = normalizeRef(raw.subject, { allowAll: true, field: `${field} subject` });
  if (!PLACEMENT_SUBJECT_KINDS.includes(subject.kind)) {
    throw new Error(`${field} subject must be a ${PLACEMENT_SUBJECT_KINDS.join(", ")}; spawn, exit and rooms are not placed.`);
  }
  const out = { label: isNonEmptyString(raw.label) ? raw.label.trim() : describeConstraint({ ...raw, subject }), subject };
  for (const key of ["near", "far"]) {
    if (raw[key] === undefined) continue;
    const distance = raw[key]?.distance;
    if (!Number.isInteger(distance) || distance < 0) throw new Error(`${field} ${key}.distance must be a whole number >= 0.`);
    out[key] = { target: normalizeRef(raw[key].target, { allowAll: false, field: `${field} ${key}.target` }), distance };
  }
  if (raw.count !== undefined) {
    if (!Number.isInteger(raw.count) || raw.count < 1) throw new Error(`${field} count must be a whole number >= 1.`);
    if (!out.near || out.far) throw new Error(`${field} count needs near= (at least <count> subjects within the distance) and no far=.`);
    out.count = raw.count;
  }
  if (raw.route !== undefined) {
    if (!["on", "off"].includes(raw.route)) throw new Error(`${field} route must be "on" or "off".`);
    out.route = raw.route;
  }
  if (raw.arrange !== undefined) {
    if (!ARRANGEMENTS.includes(raw.arrange)) throw new Error(`${field} arrange must be spread or clump.`);
    out.arrange = raw.arrange;
  }
  if (raw.outOfSight !== undefined) {
    const target = normalizeRef(raw.outOfSight?.target, { allowAll: false, field: `${field} outOfSight.target` });
    if (target.kind !== "room") throw new Error(`${field} outOfSight must name a room (room:<id>): its doorways are what must not see the subject.`);
    out.outOfSight = { target };
  }
  if (!out.near && !out.far && !out.route && !out.arrange && !out.outOfSight) {
    throw new Error(`${field} says nothing about placement: give near=, far=, onRoute, offRoute, spread, clump or outOfSight=.`);
  }
  return out;
}

export function normalizePlacementConstraints(entries) {
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) throw new Error("placement constraints must be an array.");
  return entries.map((entry, index) => normalizePlacementConstraint(entry, index));
}

function describeRef(ref) {
  return MARKER_KINDS.includes(ref.kind) ? ref.kind : `${ref.kind}:${ref.ref}`;
}

function describeConstraint(constraint) {
  return [
    describeRef(constraint.subject),
    ...["near", "far"].filter((key) => constraint[key]).map((key) => (
      `${key}=${describeRef(constraint[key].target)}:${constraint[key].distance}`)),
    ...(constraint.count !== undefined ? [`count=${constraint.count}`] : []),
    ...(constraint.route ? [constraint.route === "on" ? "onRoute" : "offRoute"] : []),
    ...(constraint.arrange ? [constraint.arrange] : []),
    ...(constraint.outOfSight ? [`outOfSight=${describeRef(constraint.outOfSight.target)}`] : []),
  ].join(";");
}

export function chebyshev(left, right) {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

/** Chebyshev distance from a cell to a room: 0 inside it, else to its nearest cell. */
export function distanceToRoom(point, room) {
  const dx = Math.max(room.x - point.x, 0, point.x - (room.x + room.width - 1));
  const dy = Math.max(room.y - point.y, 0, point.y - (room.y + room.height - 1));
  return Math.max(dx, dy);
}

/**
 * Resolve each constraint's references against the placement's entities. `entities` is the
 * ordered list of placed things, each `{ key, id, kind }` with kind hazard|resource|delver|warden.
 * Returns per constraint the subject entity keys and the target (marker point, room, or
 * entity key); an unknown reference throws, naming the constraint.
 */
export function resolvePlacementConstraints(constraints, { entities = [], rooms = new Map(), markers = {} } = {}) {
  const byKind = new Map(PLACEMENT_SUBJECT_KINDS.map((kind) => [kind, entities.filter((entity) => entity.kind === kind)]));
  const lookup = (ref, constraint, { allowAll }) => {
    const list = byKind.get(ref.kind) || [];
    if (ref.ref === "*" && allowAll) return list.map((entity) => entity.key);
    const ordinal = /^\d+$/.test(ref.ref) ? Number(ref.ref) : null;
    const match = list.find((entity) => entity.id === ref.ref)
      || (ordinal !== null && ordinal >= 1 ? list[ordinal - 1] : undefined);
    if (!match) throw new Error(`placement constraint "${constraint.label}": no ${ref.kind} "${ref.ref}" in this level.`);
    return [match.key];
  };
  const target = (ref, constraint) => {
    if (MARKER_KINDS.includes(ref.kind)) {
      if (!markers[ref.kind]) throw new Error(`placement constraint "${constraint.label}": this level has no ${ref.kind}.`);
      return { kind: "point", point: markers[ref.kind] };
    }
    if (ref.kind === "room") {
      const room = rooms.get(ref.ref);
      if (!room) throw new Error(`placement constraint "${constraint.label}": no room "${ref.ref}" in this level.`);
      return { kind: "room", room };
    }
    return { kind: "entity", key: lookup(ref, constraint, { allowAll: false })[0] };
  };
  return constraints.map((constraint) => {
    const subjects = lookup(constraint.subject, constraint, { allowAll: true });
    const resolved = { constraint, subjects };
    for (const key of ["near", "far"]) {
      if (constraint[key]) resolved[key] = { target: target(constraint[key].target, constraint), distance: constraint[key].distance };
    }
    if (constraint.outOfSight) resolved.outOfSight = { target: target(constraint.outOfSight.target, constraint) };
    if (constraint.count !== undefined && constraint.count > subjects.length) {
      resolved.impossible = `asks for ${constraint.count} but names only ${subjects.length}`;
    }
    if (constraint.arrange && subjects.length < 2) resolved.impossible = `${constraint.arrange} needs at least two things`;
    return resolved;
  });
}

/** Distance from a cell to a resolved target, given the placed positions of entities. */
export function distanceToTarget(point, target, positions) {
  if (target.kind === "point") return chebyshev(point, target.point);
  if (target.kind === "room") return distanceToRoom(point, target.room);
  const other = positions.get(target.key);
  return other ? chebyshev(point, other) : Infinity;
}

/**
 * Cells every spawn-to-exit route passes through (the "only route" cells): articulation
 * points that separate the spawn approach from the exit approach. The approaches themselves
 * are never placement cells, so they are left out.
 */
export function routeCutCells(cells, spawn, exit, blocking = new Set()) {
  const key = ({ x, y }) => `${x},${y}`;
  const allowed = new Set(cells.map(key).filter((entry) => !blocking.has(entry)));
  if (!spawn || !exit || !allowed.has(key(spawn)) || !allowed.has(key(exit))) return new Set();
  const disc = new Map();
  const low = new Map();
  const hasExit = new Map();
  const cuts = new Set();
  const neighbours = ({ x, y }) => [[0, -1], [-1, 0], [1, 0], [0, 1]]
    .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
    .filter((next) => allowed.has(key(next)));
  let time = 0;
  const exitKey = key(exit);
  const rootKey = key(spawn);
  // Iterative DFS (large levels would overflow the call stack).
  disc.set(rootKey, time); low.set(rootKey, time); time += 1;
  hasExit.set(rootKey, rootKey === exitKey);
  const stack = [{ cell: spawn, parent: null, next: neighbours(spawn), index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const here = key(frame.cell);
    if (frame.index < frame.next.length) {
      const child = frame.next[frame.index];
      frame.index += 1;
      const childKey = key(child);
      if (childKey === frame.parent) continue;
      if (disc.has(childKey)) {
        low.set(here, Math.min(low.get(here), disc.get(childKey)));
        continue;
      }
      disc.set(childKey, time); low.set(childKey, time); time += 1;
      hasExit.set(childKey, childKey === exitKey);
      stack.push({ cell: child, parent: here, next: neighbours(child), index: 0 });
      continue;
    }
    stack.pop();
    if (stack.length === 0) break;
    const parent = stack[stack.length - 1];
    const parentKey = key(parent.cell);
    low.set(parentKey, Math.min(low.get(parentKey), low.get(here)));
    if (hasExit.get(here)) {
      hasExit.set(parentKey, true);
      // `here`'s subtree holds the exit and cannot reach above the parent: every route
      // from the spawn to the exit passes through the parent.
      if (parentKey !== rootKey && low.get(here) >= disc.get(parentKey)) cuts.add(parentKey);
    }
  }
  cuts.delete(exitKey);
  return hasExit.get(rootKey) ? cuts : new Set();
}

/**
 * Check a finished placement against every resolved constraint. `positions` maps entity key
 * to its cell. Returns one report row per constraint, in authored order.
 */
export function checkPlacementConstraints(resolved, { positions, cutCells, labelOf = (key) => key, seenFrom = () => new Set() } = {}) {
  const key = ({ x, y }) => `${x},${y}`;
  return resolved.map((entry) => {
    const { constraint, subjects } = entry;
    const row = { constraint: constraint.label, held: true };
    const failures = [];
    if (entry.impossible) {
      row.held = false;
      row.detail = entry.impossible;
      return row;
    }
    for (const field of ["near", "far"]) {
      if (!entry[field]) continue;
      const { target, distance } = entry[field];
      const others = subjects.filter((subject) => !(target.kind === "entity" && target.key === subject));
      const within = others.filter((subject) => distanceToTarget(positions.get(subject), target, positions) <= distance);
      if (field === "near" && constraint.count !== undefined) {
        row.matched = within.length;
        if (within.length < constraint.count) failures.push(`${within.length} of ${constraint.count} within ${distance}`);
      } else if (field === "near") {
        others.filter((subject) => !within.includes(subject)).forEach((subject) => failures.push(`${labelOf(subject)} is beyond ${distance}`));
      } else {
        others.filter((subject) => distanceToTarget(positions.get(subject), target, positions) < distance)
          .forEach((subject) => failures.push(`${labelOf(subject)} is closer than ${distance}`));
      }
    }
    if (constraint.route) {
      subjects.forEach((subject) => {
        const onRoute = cutCells.has(key(positions.get(subject)));
        if (onRoute !== (constraint.route === "on")) {
          failures.push(`${labelOf(subject)} is ${onRoute ? "on" : "off"} the only route`);
        }
      });
    }
    if (entry.outOfSight) {
      const seen = seenFrom(entry.outOfSight.target.room);
      subjects.filter((subject) => seen.has(key(positions.get(subject))))
        .forEach((subject) => failures.push(`${labelOf(subject)} is in sight of ${entry.outOfSight.target.room.id}'s doorways`));
    }
    if (constraint.arrange) {
      const distances = [];
      subjects.forEach((left, index) => subjects.slice(index + 1).forEach((right) => (
        distances.push(chebyshev(positions.get(left), positions.get(right))))));
      row[constraint.arrange === "spread" ? "closestPair" : "farthestPair"] = constraint.arrange === "spread"
        ? Math.min(...distances) : Math.max(...distances);
    }
    if (failures.length > 0) {
      row.held = false;
      row.detail = failures.join("; ");
    }
    return row;
  });
}
