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

function collectObjects(hazards = [], resources = []) {
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
  ].map((entry, index) => ({ ...entry, index, sealsRoute: sealsRoute(entry.value) }));
}

function existingPlacementState(layout, actors = []) {
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
  actors.forEach((actor) => add(actor));
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

function buildPlacementContext({ layout, hazards = [], resources = [], actors = [], affinityRules } = {}) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return { status: "error", reason: "invalid_layout" };
  }
  const data = dataOf(layout);
  const cells = collectWalkablePositions(layout);
  const cellIndexByKey = new Map(cells.map((cell, index) => [pointKey(cell), index]));
  const rooms = new Map((Array.isArray(data?.rooms) ? data.rooms : []).map((room) => [room.id, room]));
  const objects = collectObjects(
    Array.isArray(hazards) ? hazards : [],
    Array.isArray(resources) ? resources : [],
  );
  const { occupied, blocking } = existingPlacementState(layout, Array.isArray(actors) ? actors : []);
  const fixed = new Map();

  for (const object of objects) {
    const point = normalizePoint(object.value);
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

  const pending = objects.filter((object) => !fixed.has(object.index));
  const candidates = pending.map((object) => {
    const room = object.value?.roomId ? rooms.get(object.value.roomId) : null;
    if (object.value?.roomId && !room) return [];
    return cells
      .map((_cell, index) => index)
      .filter((index) => !occupied.has(pointKey(cells[index])) && (!room || roomContains(room, cells[index])));
  });
  if (pending.some((object, index) => object.value?.roomId && candidates[index].length === 0)) {
    return { status: "unsat", reason: "containment" };
  }
  if (candidates.some((list) => list.length === 0) || !hasCompleteMatching(candidates)) {
    // The deficit in the fields the author controls, so a solver-backed refusal says as much
    // as the fallback's did (#296).
    const available = new Set(candidates.flat()).size;
    return {
      status: "unsat",
      reason: "capacity",
      detail: `insufficient unoccupied walkable tiles (${available} available, ${pending.length} requested, `
        + `${maximumMatchingSize(candidates)} placed before running out — raise floorTile.count)`,
    };
  }
  // Path endpoints are approach floors; wall portals themselves are non-walkable.
  const spawn = normalizePoint(
    data?.spawnApproach || terrainMarker(data, "spawn"),
  );
  const exit = normalizePoint(
    data?.exitApproach || terrainMarker(data, "exit"),
  );
  if (!pathExists(cells, spawn, exit, blocking)) {
    return { status: "unsat", reason: "path_obstruction" };
  }
  return { status: pending.length === 0 ? "bypass" : "ready", layout, objects, pending, fixed, cells, candidates, blocking, spawn, exit,
    affinityRules };
}

/** Author the complete binary assignment and reachability problem. */
export function buildObjectPlacementProblem(args = {}) {
  const context = buildPlacementContext(args);
  if (context.status !== "ready") {
    if (context.status === "bypass") return { ...context, result: applyPlacements(context, new Map(), "solver") };
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
  const reach = context.pending.length;
  const placementVariableIds = context.pending.map((object, pendingIndex) => (
    (object.sealsRoute ? context.candidates[pendingIndex] : context.candidates[pendingIndex].slice(0, reach)).map((cellIndex) => {
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

  const objective = {
    kind: "lexicographic",
    priorities: context.pending.map((object, index) => ({
      id: objectiveId(object.id, index),
      sense: "minimize",
      expression: {
        kind: "linear",
        terms: placementVariableIds[index].map(({ id, cellIndex }) => ({
          variableId: id,
          coefficient: cellIndex,
        })),
      },
    })),
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

/** Produce solver-request data; no adapter enters the persona. */
export function prepareObjectPlacement({ clock = UNUSED_CLOCK, meta, ...args } = {}) {
  const prepared = buildObjectPlacementProblem({ ...args, meta });
  if (prepared.status !== "ready") return prepared;
  const problemMeta = prepared.problem.meta || {
    id: `configurator_object_placement_${stableHash({ layout: args.layout, hazards: args.hazards, resources: args.resources, actors: args.actors })}`,
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

function applyPlacements(prepared, solved, source) {
  const output = clone(prepared.layout);
  const data = dataOf(output);
  const placed = prepared.objects.map((object) => {
    const point = prepared.fixed.get(object.index) || solved.get(object.index);
    return { ...object.value, id: object.id, position: { ...point }, x: point.x, y: point.y };
  });
  const hazards = placed.filter((_entry, index) => prepared.objects[index].kind === "hazard");
  const resources = placed.filter((_entry, index) => prepared.objects[index].kind === "resource");
  const allHazards = [...(Array.isArray(data.hazards) ? data.hazards : []), ...hazards];
  delete data.hazards;
  return { ok: true, source, layout: output,
    actors: [...hazardActors(allHazards, prepared.affinityRules), ...resourceActors(resources)] };
}

/** Re-check every hard constraint before accepting an adapter model. */
export function consumeObjectPlacementResult({ prepared, rawResult } = {}) {
  const result = normalizeConstraintResult(rawResult, { domain: DOMAIN, meta: prepared?.problem?.meta });
  if (result.status === "unsat") {
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
  const expectedObjectives = prepared.placementVariableIds.map((entries) => (
    entries.reduce((sum, { id, cellIndex }) => sum + assignments?.[id] * cellIndex, 0)
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

/** Consume host output; deferred/error/capability absence keeps the characterized fallback. */
export function completeObjectPlacement({ prepared: supplied, solverResult, ...args } = {}) {
  const prepared = supplied || prepareObjectPlacement(args);
  if (prepared.status === "error") {
    return { ok: false, status: prepared.status, reason: prepared.reason };
  }
  if (prepared.status === "unsat" && solverResult?.status === "unsat") {
    return { ok: false, status: "unsat", reason: prepared.reason, ...(prepared.detail ? { detail: prepared.detail } : {}) };
  }
  if (prepared.status === "unsat") return placeObjectsLegacy(args);
  if (prepared.status === "bypass") return prepared.result;
  if (!solverResult || solverResult.status === "deferred" || solverResult.status === "error") {
    return placeObjectsLegacy(args);
  }
  return consumeObjectPlacementResult({ prepared, rawResult: solverResult });
}
