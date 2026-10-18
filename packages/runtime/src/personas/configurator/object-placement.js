import { mapHazards, mapResources } from "./input-preparation.js";
import { terrainPositions, terrainMarker } from "./terrain-layout.js";
/**
 * Z9.1 — Configurator-owned object-placement search.
 *
 * Placement policy stays here. The host only dispatches the authored solver effect, and
 * platform adapters compile the resulting integer/linear problem without knowing what a
 * room, hazard, resource, or walkable path means.
 */
import {
  buildConstraintProblem,
  CONSTRAINT_DOMAINS,
  normalizeConstraintResult,
} from "../../contracts/constraint-problem.js";
import { UNUSED_CLOCK } from "../_shared/require-clock.js";
import { leftoverCategory } from "./unified-actors.js";
import { cellsSeenFromDoorways } from "./doorway-sight.js";
import {
  checkPlacementConstraints,
  distanceToTarget,
  normalizePlacementConstraints,
  resolvePlacementConstraints,
  routeCutCells,
} from "./placement-constraints.js";

const DOMAIN = CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY;

const clone = (value) => structuredClone(value);
const dataOf = (layout) => layout?.data || layout;
const pointKey = ({ x, y }) => `${x},${y}`;
const comparePoints = (left, right) => left.y - right.y || left.x - right.x;

function normalizePoint(value) {
  const raw = value?.position && typeof value.position === "object" ? value.position : value;
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function roomContains(room, point) {
  return point.x >= room.x && point.x < room.x + room.width
    && point.y >= room.y && point.y < room.y + room.height;
}

function collectWalkablePositions(layout) {
  return terrainPositions(layout);
}

function collectLegacyWalkablePositions(layout) {
  const data = dataOf(layout);
  const blocked = new Set((data?.hazards || []).filter(actor => actor.blocking === true)
    .map(normalizePoint).filter(Boolean).map(pointKey));
  return terrainPositions(layout).filter(point => !blocked.has(pointKey(point)));
}

/**
 * #297 (Darren, 2026-10-17): the one route test both placement paths share. A blocking
 * object counts against the spawn-to-exit route only if it can't be destroyed, i.e. it has
 * no durability to lose. A destroyable trap is passable (Darren's rule, 2026-10-13), so it
 * never seals the route. With no authored durability a hazard takes the Configurator's
 * default, which is always above zero, so it is destroyable.
 */
function sealsRoute(value) {
  if (value?.blocking !== true) return false;
  const authored = [value?.vitals?.durability, value?.durability]
    .find((vital) => vital && typeof vital === "object" && !Array.isArray(vital));
  if (!authored) return false;
  const max = [authored.max, authored.amount, authored.current].find((amount) => Number.isFinite(amount));
  return !(max > 0);
}

function collectObjects(hazards = [], resources = [], actors = []) {
  return [
    ...hazards.map((value, index) => ({
      value,
      kind: "hazard",
      id: typeof value?.id === "string" && value.id.trim() ? value.id.trim() : `hazard_${index + 1}`,
    })),
    ...resources.map((value, index) => ({
      value,
      kind: "resource",
      id: typeof value?.id === "string" && value.id.trim() ? value.id.trim() : `resource_${index + 1}`,
    })),
    // #301: a delver or warden a placement constraint names is placed here too, so its
    // relation to everything else is part of the same search. Its value keeps no position:
    // where it stood before is not a request.
    ...actors.map(({ position: _position, x: _x, y: _y, ...value }) => ({ value, kind: "actor", id: value.id })),
  ].map((entry, index) => ({ ...entry, index, sealsRoute: entry.kind !== "actor" && sealsRoute(entry.value) }));
}

// #301: what a placement constraint calls a delver or a warden.
function actorPlacementKind(actor) {
  const category = leftoverCategory(actor);
  if (category === "delver" || category === "warden") return category;
  if (actor?.alignment === "external") return "delver";
  if (actor?.alignment === "dungeon" && !category) return "warden";
  return null;
}

function existingPlacementState(layout, actors = [], placedActorIds = new Set()) {
  const data = dataOf(layout) || {};
  const occupied = new Set();
  const blocking = new Set();
  const add = (value, blocks = false) => {
    const point = normalizePoint(value);
    if (!point) return;
    occupied.add(pointKey(point));
    if (blocks) blocking.add(pointKey(point));
  };
  add(data.spawnApproach || terrainMarker(data, "spawn"));
  add(data.exitApproach || terrainMarker(data, "exit"));
  actors.filter((actor) => !placedActorIds.has(actor?.id)).forEach((actor) => add(actor));
  (Array.isArray(data.hazards) ? data.hazards : []).forEach((hazard) => add(hazard, sealsRoute(hazard)));
  (Array.isArray(data.resources) ? data.resources : []).forEach((resource) => add(resource));
  return { occupied, blocking };
}

function pathExists(cells, spawn, exit, blocking = new Set()) {
  if (!spawn || !exit) return false;
  const allowed = new Set(cells.map(pointKey).filter((key) => !blocking.has(key)));
  const start = pointKey(spawn);
  const target = pointKey(exit);
  if (!allowed.has(start) || !allowed.has(target)) return false;
  const queue = [spawn];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (pointKey(current) === target) return true;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = pointKey(next);
      if (allowed.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return false;
}

function hasCompleteMatching(candidateCells) {
  return maximumMatchingSize(candidateCells) === candidateCells.length;
}

// How many objects can be given distinct cells at once (augmenting-path bipartite matching).
function maximumMatchingSize(candidateCells) {
  const ownerByCell = new Map();
  function assign(objectIndex, visited) {
    for (const cellIndex of candidateCells[objectIndex]) {
      if (visited.has(cellIndex)) continue;
      visited.add(cellIndex);
      const owner = ownerByCell.get(cellIndex);
      if (owner === undefined || assign(owner, visited)) {
        ownerByCell.set(cellIndex, objectIndex);
        return true;
      }
    }
    return false;
  }
  return candidateCells.reduce((matched, _cells, index) => matched + (assign(index, new Set()) ? 1 : 0), 0);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function objectiveId(id, index) {
  const safe = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return `place_${safe || index + 1}`;
}

function constraintFailure(reason, detail) {
  return { status: "unsat", reason, detail, constraintFailure: true };
}

/**
 * #301: resolve the authored placement constraints against this placement's objects and
 * actors. Returns the actors the constraints name (placed by this search) and the resolved
 * constraints keyed by provisional entity keys, remapped once objects are indexed.
 */
function resolveConstraintEntities({ constraints, objectsWithoutActors, actors, rooms, markers }) {
  const entities = [
    ...objectsWithoutActors.map((object) => ({ key: `obj:${object.index}`, id: object.id, kind: object.kind })),
    ...actors
      .filter((actor) => typeof actor?.id === "string" && actorPlacementKind(actor))
      .slice().sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map((actor) => ({ key: `actor:${actor.id}`, id: actor.id, kind: actorPlacementKind(actor) })),
  ];
  const resolved = resolvePlacementConstraints(constraints, { entities, rooms, markers });
  const named = new Set();
  resolved.forEach((entry) => {
    entry.subjects.forEach((key) => named.add(key));
    ["near", "far"].forEach((field) => {
      if (entry[field]?.target.kind === "entity") named.add(entry[field].target.key);
    });
  });
  const placedActorIds = new Set([...named].filter((key) => key.startsWith("actor:")).map((key) => key.slice(6)));
  return { resolved, placedActorIds };
}

function remapResolved(resolved, objects) {
  const keyOf = new Map(objects.map((object) => [
    object.kind === "actor" ? `actor:${object.id}` : `obj:${object.index}`, `obj:${object.index}`,
  ]));
  return resolved.map((entry) => {
    const out = { ...entry, subjects: entry.subjects.map((key) => keyOf.get(key)) };
    ["near", "far"].forEach((field) => {
      if (entry[field]?.target.kind === "entity") {
        out[field] = { ...entry[field], target: { kind: "entity", key: keyOf.get(entry[field].target.key) } };
      }
    });
    return out;
  });
}

const entityIndex = (key) => Number(key.slice(4));

function buildPlacementContext({ layout, hazards = [], resources = [], actors = [], affinityRules, placement } = {}) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return { status: "error", reason: "invalid_layout" };
  }
  const data = dataOf(layout);
  const cells = collectWalkablePositions(layout);
  const cellIndexByKey = new Map(cells.map((cell, index) => [pointKey(cell), index]));
  const rooms = new Map((Array.isArray(data?.rooms) ? data.rooms : []).map((room) => [room.id, room]));
  const actorList = Array.isArray(actors) ? actors : [];
  // Path endpoints are approach floors; wall portals themselves are non-walkable.
  const spawn = normalizePoint(
    data?.spawnApproach || terrainMarker(data, "spawn"),
  );
  const exit = normalizePoint(
    data?.exitApproach || terrainMarker(data, "exit"),
  );
  let constraints;
  let resolvedByProvisionalKey = [];
  let placedActorIds = new Set();
  try {
    constraints = normalizePlacementConstraints(placement);
    if (constraints.length > 0) {
      ({ resolved: resolvedByProvisionalKey, placedActorIds } = resolveConstraintEntities({
        constraints,
        objectsWithoutActors: collectObjects(Array.isArray(hazards) ? hazards : [], Array.isArray(resources) ? resources : []),
        actors: actorList,
        rooms,
        markers: { spawn, exit },
      }));
    }
  } catch (error) {
    return { status: "error", reason: "placement_constraint_invalid", detail: error.message };
  }
  const objects = collectObjects(
    Array.isArray(hazards) ? hazards : [],
    Array.isArray(resources) ? resources : [],
    actorList.filter((actor) => placedActorIds.has(actor?.id)),
  );
  const resolved = remapResolved(resolvedByProvisionalKey, objects);
  const { occupied, blocking } = existingPlacementState(layout, actorList, placedActorIds);
  const fixed = new Map();

  for (const object of objects) {
    const point = object.kind === "actor" ? null : normalizePoint(object.value);
    if (!point) continue;
    const room = object.value?.roomId ? rooms.get(object.value.roomId) : null;
    if (!cellIndexByKey.has(pointKey(point)) || (object.value?.roomId && (!room || !roomContains(room, point)))) {
      return { status: "unsat", reason: "containment" };
    }
    if (occupied.has(pointKey(point))) return { status: "unsat", reason: "collision" };
    occupied.add(pointKey(point));
    if (object.sealsRoute) blocking.add(pointKey(point));
    fixed.set(object.index, point);
  }

  const impossible = resolved.find((entry) => entry.impossible);
  if (impossible) {
    return constraintFailure("placement_constraint", `"${impossible.constraint.label}" ${impossible.impossible}`);
  }
  const cutCells = resolved.some((entry) => entry.constraint.route)
    ? routeCutCells(cells, spawn, exit, blocking) : new Set();
  const isFixedKey = (key) => fixed.has(entityIndex(key));
  // #398: what each named room's doorways can see, by core's sight rule, computed once a room.
  const seenByRoom = new Map();
  const seenFrom = (room) => {
    if (!seenByRoom.has(room.id)) seenByRoom.set(room.id, cellsSeenFromDoorways(layout, room));
    return seenByRoom.get(room.id);
  };
  const fixedPositions = new Map([...fixed].map(([index, point]) => [`obj:${index}`, point]));
  // A constraint whose other side is already in place (a marker, a room, a placed object)
  // narrows the subject's own cells; it needs no variables. Anything relating two objects
  // still to be placed, counts and arrangements are encoded in the problem.
  const filters = new Map();
  const relational = [];
  const involved = new Set();
  for (const entry of resolved) {
    const { constraint } = entry;
    const unaryFields = ["near", "far"].filter((field) => entry[field]
      && (entry[field].target.kind !== "entity" || isFixedKey(entry[field].target.key)));
    const binaryFields = ["near", "far"].filter((field) => entry[field] && !unaryFields.includes(field));
    const counted = constraint.count !== undefined;
    for (const subject of entry.subjects) {
      if (!filters.has(subject)) filters.set(subject, []);
      if (!counted) unaryFields.forEach((field) => filters.get(subject).push({ entry, field }));
      if (constraint.route) filters.get(subject).push({ entry, field: "route" });
      if (entry.outOfSight) filters.get(subject).push({ entry, field: "outOfSight" });
    }
    if (counted || binaryFields.length > 0 || constraint.arrange) {
      relational.push({ entry, binaryFields: counted ? [] : binaryFields });
      entry.subjects.forEach((key) => involved.add(key));
      binaryFields.forEach((field) => involved.add(entry[field].target.key));
    }
  }
  const passes = (cell, { entry, field }, subject) => {
    if (field !== "route" && entry[field].target.key === subject) return true;
    if (field === "route") return cutCells.has(pointKey(cell)) === (entry.constraint.route === "on");
    if (field === "outOfSight") return !seenFrom(entry.outOfSight.target.room).has(pointKey(cell));
    const distance = distanceToTarget(cell, entry[field].target, fixedPositions);
    return field === "near" ? distance <= entry[field].distance : distance >= entry[field].distance;
  };
  // Objects already in place are checked, not searched.
  for (const [subject, subjectFilters] of filters) {
    if (!isFixedKey(subject)) continue;
    const failed = subjectFilters.find((filter) => !passes(fixedPositions.get(subject), filter, subject));
    if (failed) {
      return constraintFailure("placement_constraint",
        `"${failed.entry.constraint.label}" does not hold for ${objects[entityIndex(subject)].id} where it was authored`);
    }
  }

  const pending = objects.filter((object) => !fixed.has(object.index));
  const candidates = pending.map((object) => {
    const room = object.value?.roomId ? rooms.get(object.value.roomId) : null;
    if (object.value?.roomId && !room) return [];
    const ownFilters = filters.get(`obj:${object.index}`) || [];
    return cells
      .map((_cell, index) => index)
      .filter((index) => !occupied.has(pointKey(cells[index])) && (!room || roomContains(room, cells[index]))
        && ownFilters.every((filter) => passes(cells[index], filter, `obj:${object.index}`)));
  });
  for (const [pendingIndex, object] of pending.entries()) {
    if (candidates[pendingIndex].length > 0) continue;
    const ownFilters = filters.get(`obj:${object.index}`) || [];
    if (ownFilters.length > 0) {
      const labels = [...new Set(ownFilters.map(({ entry }) => `"${entry.constraint.label}"`))].join(", ");
      return constraintFailure("placement_constraint", `${labels} leaves ${object.id} no free cell`);
    }
  }
  if (pending.some((object, index) => object.value?.roomId && candidates[index].length === 0)) {
    return { status: "unsat", reason: "containment" };
  }
  if (candidates.some((list) => list.length === 0) || !hasCompleteMatching(candidates)) {
    // The deficit in the fields the author controls, so a solver-backed refusal says as much
    // as the fallback's did (#296).
    const available = new Set(candidates.flat()).size;
    if (filters.size > 0) {
      return constraintFailure("placement_constraint",
        `the placement constraints leave too few free cells (${available} for ${pending.length} things)`);
    }
    return {
      status: "unsat",
      reason: "capacity",
      detail: `insufficient unoccupied walkable tiles (${available} available, ${pending.length} requested, `
        + `${maximumMatchingSize(candidates)} placed before running out — raise floorTile.count)`,
    };
  }
  if (!pathExists(cells, spawn, exit, blocking)) {
    return { status: "unsat", reason: "path_obstruction" };
  }
  return { status: pending.length === 0 ? "bypass" : "ready", layout, objects, pending, fixed, cells, candidates, blocking, spawn, exit,
    affinityRules, constraints: resolved, relational, involved, cutCells, seenFrom };
}

/** Author the complete binary assignment and reachability problem. */
export function buildObjectPlacementProblem(args = {}) {
  const context = buildPlacementContext(args);
  if (context.status !== "ready") {
    if (context.status === "bypass") {
      const result = applyPlacements(context, new Map(), "solver");
      const broken = (result.placementReport || []).find(({ held }) => !held);
      if (broken) return constraintFailure("placement_constraint", `"${broken.constraint}" does not hold: ${broken.detail}`);
      return { ...context, result };
    }
    return context;
  }
  const variables = [];
  const constraints = [];
  // #331: an object that cannot seal the route only needs its first `pending` candidate
  // cells. At most pending-1 other objects can hold any of them, so one is always free, and
  // moving the object there keeps every constraint and improves its own objective; the
  // lexicographic answer therefore never lies beyond them. The problem grows with the
  // objects, not the grid. A route-sealing object keeps every candidate: a cell's worth to
  // it depends on the route, not only on who else is placed.
  // #301: an object a relational constraint names keeps every candidate too, since its
  // worth depends on where the others go.
  // #370: hazards and resources are kept from touching (below), so a free cell for an object
  // must also be clear of every other one's 3x3 neighbourhood: each other object rules out at
  // most 9 cells, so 9 x (others) + 1 candidates always hold one that touches nothing.
  const spacedFixed = spacedFixedPoints(context);
  const others = context.pending.length - 1 + spacedFixed.length;
  const reach = Math.max(context.pending.length, others > 0 ? 9 * others + 1 : 0);
  const apart = firstApartCells(context, spacedFixed);
  const placementVariableIds = context.pending.map((object, pendingIndex) => (
    (object.sealsRoute || context.involved.has(`obj:${object.index}`)
      ? context.candidates[pendingIndex]
      : context.candidates[pendingIndex].slice(0, apart ? apart[pendingIndex] + 1 : reach)).map((cellIndex) => {
      const id = `object_${object.index}_cell_${cellIndex}`;
      variables.push({ id, kind: "integer", min: 0, max: 1 });
      return { id, cellIndex };
    })
  ));
  placementVariableIds.forEach((entries, index) => constraints.push({
    id: `object_${context.pending[index].index}_assigned_once`,
    kind: "linear",
    relation: "=",
    rightHandSide: 1,
    terms: entries.map(({ id }) => ({ variableId: id, coefficient: 1 })),
  }));
  const termsByCell = new Map();
  placementVariableIds.forEach((entries) => entries.forEach(({ id, cellIndex }) => {
    if (!termsByCell.has(cellIndex)) termsByCell.set(cellIndex, []);
    termsByCell.get(cellIndex).push({ variableId: id, coefficient: 1 });
  }));
  [...termsByCell.keys()].sort((left, right) => left - right).forEach((cellIndex) => {
    const terms = termsByCell.get(cellIndex);
    if (terms.length > 1) constraints.push({
      id: `cell_${cellIndex}_unique`, kind: "linear", relation: "<=", rightHandSide: 1, terms,
    });
  });

  const dynamicBlockers = context.pending
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => object.sealsRoute);
  if (dynamicBlockers.length > 0) {
    const usable = context.cells.filter((cell) => !context.blocking.has(pointKey(cell)));
    const usableKeys = new Set(usable.map(pointKey));
    const cellIndexByKey = new Map(context.cells.map((cell, index) => [pointKey(cell), index]));
    const blockerTermsByCell = new Map();
    dynamicBlockers.forEach(({ index }) => placementVariableIds[index].forEach(({ id: variableId, cellIndex }) => {
      if (!blockerTermsByCell.has(cellIndex)) blockerTermsByCell.set(cellIndex, []);
      blockerTermsByCell.get(cellIndex).push({ variableId, coefficient: 1 });
    }));
    const edges = [];
    const outgoing = new Map();
    const incoming = new Map();
    const addTerm = (map, key, term) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(term);
    };
    for (const from of usable) {
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const to = { x: from.x + dx, y: from.y + dy };
        if (!usableKeys.has(pointKey(to))) continue;
        const id = `flow_${edges.length}`;
        variables.push({ id, kind: "integer", min: 0, max: 1 });
        edges.push({ id, from: pointKey(from), to: pointKey(to) });
        addTerm(outgoing, pointKey(from), { variableId: id, coefficient: 1 });
        addTerm(incoming, pointKey(to), { variableId: id, coefficient: -1 });
        const blockingTerms = blockerTermsByCell.get(cellIndexByKey.get(pointKey(to))) || [];
        if (blockingTerms.length > 0) constraints.push({
          id: `${id}_avoids_blocker`,
          kind: "linear",
          relation: "<=",
          rightHandSide: 1,
          terms: [{ variableId: id, coefficient: 1 }, ...blockingTerms],
        });
      }
    }
    for (const cell of usable) {
      const key = pointKey(cell);
      const terms = [...(outgoing.get(key) || []), ...(incoming.get(key) || [])];
      if (terms.length === 0) continue;
      const balance = key === pointKey(context.spawn) ? 1 : key === pointKey(context.exit) ? -1 : 0;
      constraints.push({
        id: `path_balance_${cell.x}_${cell.y}`,
        kind: "linear",
        relation: "=",
        rightHandSide: balance,
        terms,
      });
    }
  }

  const relational = encodeRelationalConstraints(context, placementVariableIds, variables, constraints);
  if (relational.failure) return relational.failure;
  const spacing = encodeSpacing(context, placementVariableIds, spacedFixed, variables, constraints);
  const objective = {
    kind: "lexicographic",
    priorities: [...relational.priorities, ...spacing, ...context.pending.map((object, index) => ({
      id: objectiveId(object.id, index),
      sense: "minimize",
      expression: {
        kind: "linear",
        terms: placementVariableIds[index].map(({ id, cellIndex }) => ({
          variableId: id,
          coefficient: cellIndex,
        })),
      },
    }))],
  };
  const problem = buildConstraintProblem({
    domain: DOMAIN,
    posedBy: "configurator",
    meta: args.meta,
    variables,
    constraints,
    objective,
    context: { problemKind: "object_placement", objectCount: context.objects.length },
  });
  return { ...context, problem, placementVariableIds };
}

/**
 * #370: when nothing seals the route and no relational constraint applies, seat the objects in
 * order, each on its first candidate touching nothing already seated. If every one finds such a
 * cell, that is the answer the objective picks (nothing touches, and no object can sit earlier
 * without touching one seated before it), so no object needs candidates past its own. Returns
 * the position in each object's candidate list, or null when the bound does not apply.
 */
function firstApartCells(context, spacedFixed) {
  if (context.pending.some((object) => object.sealsRoute || object.kind === "actor"
    || context.involved.has(`obj:${object.index}`))) return null;
  const seated = [...spacedFixed];
  const used = new Set();
  const positions = [];
  for (const [pendingIndex] of context.pending.entries()) {
    const list = context.candidates[pendingIndex];
    const at = list.findIndex((cellIndex) => !used.has(cellIndex)
      && seated.every((point) => Math.max(Math.abs(point.x - context.cells[cellIndex].x),
        Math.abs(point.y - context.cells[cellIndex].y)) > 1));
    if (at < 0) return null;
    used.add(list[at]);
    seated.push(context.cells[list[at]]);
    positions.push(at);
  }
  return positions;
}

// #370: hazards and resources already in place (authored coordinates, or placed with the layout).
function spacedFixedPoints(context) {
  const data = dataOf(context.layout) || {};
  return [
    ...(Array.isArray(data.hazards) ? data.hazards : []),
    ...(Array.isArray(data.resources) ? data.resources : []),
  ].map(normalizePoint).filter(Boolean)
    .concat(context.objects.filter((object) => object.kind !== "actor" && context.fixed.has(object.index))
      .map((object) => context.fixed.get(object.index)));
}

/**
 * #370: hazards and resources are seated apart. Two things touch (king-move distance 1) exactly
 * when some 2x2 window holds both, so each window gets a slack for every object past the
 * first, and the first priority after any authored arrangement is the least total slack. It is
 * a preference, never a refusal: a level too small to keep everything apart still builds, as
 * spread out as it fits.
 */
function encodeSpacing(context, placementVariableIds, spacedFixed, variables, constraints) {
  const windows = new Map();
  const windowOf = (key) => {
    if (!windows.has(key)) windows.set(key, { terms: [], constant: 0, sources: new Set() });
    return windows.get(key);
  };
  const eachWindow = ({ x, y }, visit) => {
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) visit(`${x + dx},${y + dy}`);
  };
  spacedFixed.forEach((point, fixedIndex) => eachWindow(point, (key) => {
    const window = windowOf(key);
    window.constant += 1;
    window.sources.add(`fixed_${fixedIndex}`);
  }));
  context.pending.forEach((object, pendingIndex) => {
    if (object.kind === "actor") return;
    placementVariableIds[pendingIndex].forEach(({ id, cellIndex }) => eachWindow(context.cells[cellIndex], (key) => {
      const window = windowOf(key);
      window.terms.push({ variableId: id, coefficient: 1 });
      window.sources.add(`object_${object.index}`);
    }));
  });
  const slackTerms = [];
  [...windows.keys()].sort().forEach((key) => {
    const window = windows.get(key);
    if (window.terms.length === 0 || window.sources.size < 2) return;
    const slack = `spacing_${key.replace(/-/g, "m").replace(",", "_")}`;
    variables.push({ id: slack, kind: "integer", min: 0, max: window.sources.size });
    constraints.push({
      id: `${slack}_window`,
      kind: "linear",
      relation: "<=",
      rightHandSide: 1 - window.constant,
      terms: [...window.terms, { variableId: slack, coefficient: -1 }],
    });
    slackTerms.push({ variableId: slack, coefficient: 1 });
  });
  if (slackTerms.length === 0) return [];
  return [{ id: "objects_apart", sense: "minimize", expression: { kind: "linear", terms: slackTerms } }];
}

/**
 * #301: the relational constraints as linear rows over the placement variables. An object's
 * coordinate is linear in its own cell variables (exactly one is 1), so "A within d of B" is
 * four rows on X_A - X_B and Y_A - Y_B. "At least d apart", "n of these within r" and
 * spread use a binary per alternative with a big-M row; clump bounds every pairwise gap.
 * Arrangement objectives come before the default cell-order ones.
 */
function encodeRelationalConstraints(context, placementVariableIds, variables, constraints) {
  const priorities = [];
  if (!context.relational?.length) return { priorities };
  const data = dataOf(context.layout);
  const span = Math.max(1, Number(data?.width) || 0) + Math.max(1, Number(data?.height) || 0);
  const pendingIndexByObject = new Map(context.pending.map((object, index) => [object.index, index]));
  const position = (key, axis, coefficient = 1) => {
    const index = entityIndex(key);
    const point = context.fixed.get(index);
    if (point) return { terms: [], constant: coefficient * point[axis] };
    return {
      terms: placementVariableIds[pendingIndexByObject.get(index)].map(({ id, cellIndex }) => ({
        variableId: id, coefficient: coefficient * context.cells[cellIndex][axis],
      })),
      constant: 0,
    };
  };
  const term = (variableId, coefficient) => ({ terms: [{ variableId, coefficient }], constant: 0 });
  let failure = null;
  const add = (id, parts, relation, rightHandSide) => {
    const merged = new Map();
    let constant = 0;
    parts.forEach((part) => {
      constant += part.constant;
      part.terms.forEach(({ variableId, coefficient }) => merged.set(variableId, (merged.get(variableId) || 0) + coefficient));
    });
    const rhs = rightHandSide - constant;
    const terms = [...merged].map(([variableId, coefficient]) => ({ variableId, coefficient }));
    if (terms.length === 0) {
      const holds = relation === "<=" ? 0 <= rhs : relation === ">=" ? 0 >= rhs : rhs === 0;
      if (!holds) failure = true;
      return;
    }
    constraints.push({ id, kind: "linear", relation, rightHandSide: rhs, terms });
  };
  const binary = (id, max = 1) => {
    variables.push({ id, kind: "integer", min: 0, max });
    return id;
  };
  // left - right on one axis, as parts.
  const gap = (left, right, axis) => [position(left, axis), position(right, axis, -1)];
  const big = 2 * span + 2;

  context.relational.forEach(({ entry, binaryFields }, constraintIndex) => {
    const { constraint } = entry;
    const prefix = `rel_${constraintIndex}`;
    const startFailure = failure;
    for (const field of binaryFields) {
      const { target, distance } = entry[field];
      entry.subjects.filter((subject) => subject !== target.key).forEach((subject, pairIndex) => {
        const id = `${prefix}_${field}_${pairIndex}`;
        if (field === "near") {
          ["x", "y"].forEach((axis) => {
            add(`${id}_${axis}_upper`, gap(subject, target.key, axis), "<=", distance);
            add(`${id}_${axis}_lower`, gap(target.key, subject, axis), "<=", distance);
          });
          return;
        }
        const choices = [["x", subject, target.key], ["x", target.key, subject], ["y", subject, target.key], ["y", target.key, subject]]
          .map(([axis, left, right], choice) => {
            const flag = binary(`${id}_side_${choice}`);
            // left - right >= distance when flag is 1; slack otherwise.
            add(`${id}_side_${choice}_row`, [...gap(left, right, axis), term(flag, -big)], ">=", distance - big);
            return flag;
          });
        add(`${id}_some_side`, choices.map((flag) => term(flag, 1)), ">=", 1);
      });
    }
    if (constraint.count !== undefined) {
      const { target, distance } = entry.near;
      const subjects = entry.subjects.filter((subject) => subject !== target.key);
      if (target.kind !== "entity" || context.fixed.has(entityIndex(target.key))) {
        // A target already in place: count each subject's cells within reach directly.
        const fixedPositions = new Map([...context.fixed].map(([index, point]) => [`obj:${index}`, point]));
        const parts = subjects.map((subject) => {
          const point = context.fixed.get(entityIndex(subject));
          if (point) return { terms: [], constant: distanceToTarget(point, target, fixedPositions) <= distance ? 1 : 0 };
          return {
            terms: placementVariableIds[pendingIndexByObject.get(entityIndex(subject))]
              .filter(({ cellIndex }) => distanceToTarget(context.cells[cellIndex], target, fixedPositions) <= distance)
              .map(({ id }) => ({ variableId: id, coefficient: 1 })),
            constant: 0,
          };
        });
        add(`${prefix}_count`, parts, ">=", constraint.count);
      } else {
        const flags = subjects.map((subject, subjectIndex) => {
          const flag = binary(`${prefix}_within_${subjectIndex}`);
          ["x", "y"].forEach((axis) => {
            // |subject - target| <= distance when flag is 1.
            add(`${prefix}_within_${subjectIndex}_${axis}_upper`, [...gap(subject, target.key, axis), term(flag, big)], "<=", distance + big);
            add(`${prefix}_within_${subjectIndex}_${axis}_lower`, [...gap(target.key, subject, axis), term(flag, big)], "<=", distance + big);
          });
          return flag;
        });
        add(`${prefix}_count`, flags.map((flag) => term(flag, 1)), ">=", constraint.count);
      }
    }
    if (constraint.arrange) {
      const measure = binary(`${prefix}_${constraint.arrange}`, span);
      entry.subjects.forEach((left, leftIndex) => entry.subjects.slice(leftIndex + 1).forEach((right, offset) => {
        const id = `${prefix}_pair_${leftIndex}_${leftIndex + 1 + offset}`;
        if (constraint.arrange === "clump") {
          ["x", "y"].forEach((axis) => {
            add(`${id}_${axis}_upper`, [...gap(left, right, axis), term(measure, -1)], "<=", 0);
            add(`${id}_${axis}_lower`, [...gap(right, left, axis), term(measure, -1)], "<=", 0);
          });
          return;
        }
        // spread: some axis separates the pair by at least the measure.
        const choices = [["x", left, right], ["x", right, left], ["y", left, right], ["y", right, left]]
          .map(([axis, from, to], choice) => {
            const flag = binary(`${id}_side_${choice}`);
            add(`${id}_side_${choice}_row`, [...gap(from, to, axis), term(measure, -1), term(flag, -big)], ">=", -big);
            return flag;
          });
        add(`${id}_some_side`, choices.map((flag) => term(flag, 1)), ">=", 1);
      }));
      priorities.push({
        id: `${prefix}_${constraint.arrange}`,
        sense: constraint.arrange === "spread" ? "maximize" : "minimize",
        expression: { kind: "linear", terms: [{ variableId: measure, coefficient: 1 }] },
      });
    }
    if (failure && !startFailure) failure = constraint.label;
  });
  if (failure) {
    return { priorities, failure: constraintFailure("placement_constraint", `"${failure}" cannot hold for the objects already in place`) };
  }
  return { priorities };
}

/** Produce solver-request data; no adapter enters the persona. */
export function prepareObjectPlacement({ clock = UNUSED_CLOCK, meta, ...args } = {}) {
  const prepared = buildObjectPlacementProblem({ ...args, meta });
  if (prepared.status !== "ready") return prepared;
  const problemMeta = prepared.problem.meta || {
    id: `configurator_object_placement_${stableHash({ layout: args.layout, hazards: args.hazards, resources: args.resources, actors: args.actors, placement: args.placement })}`,
    runId: "configurator_object_placement",
    createdAt: clock(),
    producedBy: "configurator",
  };
  prepared.problem.meta = problemMeta;
  const request = { id: problemMeta.id, requestId: problemMeta.id, targetAdapter: "solver", meta: problemMeta, problem: prepared.problem };
  return {
    ...prepared,
    request,
    effect: { kind: "solver_request", request, requestId: request.requestId, targetAdapter: "solver", personaRef: "configurator" },
  };
}

function resourceActors(placed) {
  return mapResources(placed.map(({ kind, roomId, blocking, x, y, ...request }) => request));
}

function hazardActors(placed, affinityRules) {
  return mapHazards(placed.map(({ kind, roomId, source, templateId, templateInstanceId,
    x, y, ...request }) => ({ ...request,
    position: request.position ?? { x, y },
  })), { affinityRules });
}

function placementPositions(prepared, solved) {
  return new Map(prepared.objects.map((object) => [
    `obj:${object.index}`, prepared.fixed.get(object.index) || solved.get(object.index),
  ]));
}

// #301: how each authored placement constraint came out, for the build to report.
function placementReport(prepared, solved) {
  if (!prepared.constraints?.length) return [];
  return checkPlacementConstraints(prepared.constraints, {
    positions: placementPositions(prepared, solved),
    cutCells: prepared.cutCells,
    seenFrom: prepared.seenFrom,
    labelOf: (key) => prepared.objects[entityIndex(key)].id,
  });
}

function applyPlacements(prepared, solved, source) {
  const output = clone(prepared.layout);
  const data = dataOf(output);
  const placed = prepared.objects.map((object) => {
    const point = prepared.fixed.get(object.index) || solved.get(object.index);
    return { ...object.value, id: object.id, position: { ...point }, x: point.x, y: point.y };
  });
  const hazards = placed.filter((_entry, index) => prepared.objects[index].kind === "hazard");
  const resources = placed.filter((_entry, index) => prepared.objects[index].kind === "resource");
  const actorPositions = Object.fromEntries(placed
    .filter((_entry, index) => prepared.objects[index].kind === "actor")
    .map((entry) => [entry.id, { ...entry.position }]));
  const allHazards = [...(Array.isArray(data.hazards) ? data.hazards : []), ...hazards];
  delete data.hazards;
  const report = placementReport(prepared, solved);
  return { ok: true, source, layout: output,
    actors: [...hazardActors(allHazards, prepared.affinityRules), ...resourceActors(resources)],
    ...(Object.keys(actorPositions).length > 0 ? { actorPositions } : {}),
    ...(report.length > 0 ? { placementReport: report } : {}) };
}

function evaluateLinear(expression, assignments) {
  return expression.terms.reduce((sum, { variableId, coefficient }) => sum + assignments?.[variableId] * coefficient, 0);
}

/** Re-check every hard constraint before accepting an adapter model. */
export function consumeObjectPlacementResult({ prepared, rawResult } = {}) {
  const result = normalizeConstraintResult(rawResult, { domain: DOMAIN, meta: prepared?.problem?.meta });
  if (result.status === "unsat") {
    if (prepared.constraints?.length) {
      return { ok: false, status: "unsat", reason: "placement_constraint",
        detail: `these placement constraints cannot all hold with the route kept open: ${prepared.constraints
          .map(({ constraint }) => `"${constraint.label}"`).join(", ")}` };
    }
    return { ok: false, status: "unsat", reason: "path_obstruction" };
  }
  if (result.status !== "fulfilled") {
    return { ok: false, status: result.status, reason: result.reason || "configurator_object_placement_solver_failed" };
  }
  const assignments = result.model?.assignments;
  const expectedIds = prepared.problem.variables.map(({ id }) => id).sort();
  const actualIds = assignments && typeof assignments === "object" && !Array.isArray(assignments)
    ? Object.keys(assignments).sort()
    : [];
  const exact = actualIds.length === expectedIds.length && actualIds.every((id, index) => id === expectedIds[index]);
  const bounds = exact && prepared.problem.variables.every(({ id, min, max }) => (
    Number.isInteger(assignments[id]) && assignments[id] >= min && assignments[id] <= max
  ));
  const solved = new Map();
  const usedCells = new Set();
  let valid = bounds;
  prepared.placementVariableIds.forEach((entries, pendingIndex) => {
    const selected = entries.filter(({ id }) => assignments?.[id] === 1);
    if (selected.length !== 1 || usedCells.has(selected[0]?.cellIndex)) valid = false;
    if (selected.length === 1) {
      usedCells.add(selected[0].cellIndex);
      solved.set(prepared.pending[pendingIndex].index, prepared.cells[selected[0].cellIndex]);
    }
  });
  const expectedObjectives = prepared.problem.objective.priorities.map(({ expression }) => (
    evaluateLinear(expression, assignments)
  ));
  const reportedObjectives = result.model?.objectiveValues;
  if (!Array.isArray(reportedObjectives)
    || reportedObjectives.length !== expectedObjectives.length
    || reportedObjectives.some((value, index) => value !== expectedObjectives[index])) valid = false;
  const blocking = new Set(prepared.blocking);
  prepared.pending.forEach((object) => {
    if (object.sealsRoute && solved.has(object.index)) blocking.add(pointKey(solved.get(object.index)));
  });
  if (!pathExists(prepared.cells, prepared.spawn, prepared.exit, blocking)) valid = false;
  if (valid && placementReport(prepared, solved).some(({ held }) => !held)) valid = false;
  if (!valid) return { ok: false, status: "error", reason: "configurator_object_placement_model_invalid" };
  return applyPlacements(prepared, solved, "solver");
}

class RouteObstruction extends Error {}

function placeObjectsLegacy({ layout, hazards = [], resources = [], affinityRules } = {}) {
  const output = clone(layout);
  const data = dataOf(output);
  const occupied = new Set();
  const reserve = (value) => {
    const point = normalizePoint(value);
    if (point) occupied.add(pointKey(point));
  };
  const spawn = normalizePoint(data.spawnApproach || terrainMarker(data, "spawn"));
  const exit = normalizePoint(data.exitApproach || terrainMarker(data, "exit"));
  reserve(spawn);
  reserve(exit);
  (Array.isArray(data.hazards) ? data.hazards : []).forEach(reserve);
  // The same route test the solver path enforces (#297). The fallback stays first-fit (it is
  // not a search; finding a cell that keeps the route open is the solver's job), so a
  // first-fit cell that would seal the spawn-to-exit route refuses the level instead of
  // emitting one that cannot be finished.
  const cells = collectWalkablePositions(output);
  const sealed = new Set((Array.isArray(data.hazards) ? data.hazards : []).filter(sealsRoute)
    .map(normalizePoint).filter(Boolean).map(pointKey));
  const routeOpen = !spawn || !exit || pathExists(cells, spawn, exit, sealed);
  const keepsRoute = (value, cell) => !routeOpen || !sealsRoute(value)
    || pathExists(cells, spawn, exit, new Set([...sealed, pointKey(cell)]));
  const place = (values, kind) => {
    const walkable = collectLegacyWalkablePositions(output);
    const walkableKeys = new Set(walkable.map(pointKey));
    const candidates = walkable.filter((cell) => !occupied.has(pointKey(cell))).sort(comparePoints);
    let cursor = 0;
    return values.map((value, index) => {
      const explicit = normalizePoint(value);
      let assigned = explicit && walkableKeys.has(pointKey(explicit)) && !occupied.has(pointKey(explicit))
        ? explicit
        : null;
      while (!assigned && cursor < candidates.length) {
        const candidate = candidates[cursor++];
        if (!occupied.has(pointKey(candidate))) assigned = candidate;
      }
      if (assigned && !keepsRoute(value, assigned)) throw new RouteObstruction();
      if (!assigned) {
        throw new Error(
          `configurator inputs could not place ${kind}: insufficient unoccupied walkable tiles `
          + `(${candidates.length} available, ${values.length} requested, ${index} placed before running out — raise floorTile.count).`,
        );
      }
      occupied.add(pointKey(assigned));
      if (sealsRoute(value)) sealed.add(pointKey(assigned));
      const id = typeof value?.id === "string" && value.id.trim() ? value.id.trim() : `${kind}_${index + 1}`;
      return { ...value, id, position: { ...assigned }, x: assigned.x, y: assigned.y };
    });
  };
  let placedHazards;
  let placedResources;
  try {
    placedHazards = place(Array.isArray(hazards) ? hazards : [], "hazard");
    placedResources = place(Array.isArray(resources) ? resources : [], "resource");
  } catch (error) {
    if (error instanceof RouteObstruction) return { ok: false, status: "unsat", reason: "path_obstruction" };
    throw error;
  }
  const allHazards = [...(Array.isArray(data.hazards) ? data.hazards : []), ...placedHazards];
  delete data.hazards;
  return { ok: true, source: "fallback", layout: output,
    actors: [...hazardActors(allHazards, affinityRules), ...resourceActors(placedResources)] };
}

/**
 * #300 — pose a built level's placement question again. Its hazard and resource actors become
 * unpositioned placement requests that map back to the same actors once placed; every other
 * actor stays where it stands. Room membership is not recorded on a built actor, so the
 * re-placement ranges over every walkable cell.
 */
export function levelObjectRequests({ actors = [], presentation = {} } = {}) {
  const hazards = [];
  const resources = [];
  const fixed = [];
  (Array.isArray(actors) ? actors : []).forEach((actor) => {
    const category = presentation?.[actor?.id]?.category ?? actor?.category;
    const { position: _position, category: _category, ...request } = actor || {};
    if (category === "hazard") {
      hazards.push({
        id: request.id,
        affinity: Array.isArray(request.affinities) ? request.affinities[0] : undefined,
        vitals: request.vitals,
        blocking: request.capabilities?.blocksMovement === true,
        motivations: request.motivations,
        holdings: request.holdings,
      });
    } else if (category === "resource") {
      resources.push(request);
    } else {
      fixed.push(actor);
    }
  });
  return { hazards, resources, actors: fixed };
}

function normalizePlacementConstraintsSafely(placement) {
  try {
    return normalizePlacementConstraints(placement);
  } catch {
    return [];
  }
}

/** Consume host output; deferred/error/capability absence keeps the characterized fallback. */
export function completeObjectPlacement({ prepared: supplied, solverResult, ...args } = {}) {
  const prepared = supplied || prepareObjectPlacement(args);
  if (prepared.status === "error") {
    return { ok: false, status: prepared.status, reason: prepared.reason, ...(prepared.detail ? { detail: prepared.detail } : {}) };
  }
  if (prepared.status === "unsat" && (solverResult?.status === "unsat" || prepared.constraintFailure)) {
    return { ok: false, status: "unsat", reason: prepared.reason, ...(prepared.detail ? { detail: prepared.detail } : {}) };
  }
  // #301: the reading-order fallback cannot honour a relational constraint, so a level that
  // asks for one is refused rather than placed as if it had not asked.
  const constrained = normalizePlacementConstraintsSafely(args.placement).length > 0;
  if (prepared.status === "unsat" && !constrained) return placeObjectsLegacy(args);
  if (prepared.status === "unsat") {
    return { ok: false, status: "unsat", reason: prepared.reason, ...(prepared.detail ? { detail: prepared.detail } : {}) };
  }
  if (prepared.status === "bypass") return prepared.result;
  if (!solverResult || solverResult.status === "deferred" || solverResult.status === "error") {
    if (constrained) {
      return { ok: false, status: "error", reason: "placement_constraints_need_solver",
        detail: `placement constraints need the solver, which answered ${solverResult?.status || "nothing"}`
          + `${solverResult?.reason ? ` (${solverResult.reason})` : ""}` };
    }
    return placeObjectsLegacy(args);
  }
  return consumeObjectPlacementResult({ prepared, rawResult: solverResult });
}
