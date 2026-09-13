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
  const data = dataOf(layout);
  if (!data) return [];
  const result = [];
  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      for (let x = 0; x < (data.kinds[y] || []).length; x += 1) {
        if (data.kinds[y][x] !== 1) result.push({ x, y });
      }
    }
    return result.sort(comparePoints);
  }
  if (Array.isArray(data.tiles)) {
    const legend = data.legend || {};
    for (let y = 0; y < data.tiles.length; y += 1) {
      const row = String(data.tiles[y] ?? "");
      for (let x = 0; x < row.length; x += 1) {
        const tile = legend[row[x]]?.tile;
        if (row[x] === "#" || row[x] === "B" || row[x] === "S" || row[x] === "E" || tile === "wall" || tile === "barrier" || tile === "spawn" || tile === "exit") continue;
        result.push({ x, y });
      }
    }
  }
  return result.sort(comparePoints);
}

// Byte-compatible candidate collection for the characterized fallback. Search treats the
// fixture shorthand `#`/`B` as walls; the former build helper relied only on `kinds`/legend.
function collectLegacyWalkablePositions(layout) {
  const data = dataOf(layout);
  if (!data) return [];
  const result = [];
  const blockingHazards = new Set(
    (Array.isArray(data.hazards) ? data.hazards : [])
      .filter((hazard) => hazard?.blocking === true)
      .map(normalizePoint)
      .filter(Boolean)
      .map(pointKey),
  );
  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      for (let x = 0; x < (data.kinds[y] || []).length; x += 1) {
        const kind = data.kinds[y][x];
        if (kind === 1 || (kind === 2 && blockingHazards.has(`${x},${y}`))) continue;
        result.push({ x, y });
      }
    }
    return result;
  }
  if (Array.isArray(data.tiles)) {
    const legend = data.legend || {};
    for (let y = 0; y < data.tiles.length; y += 1) {
      const row = String(data.tiles[y] ?? "");
      for (let x = 0; x < row.length; x += 1) {
        const tile = legend[row[x]]?.tile;
        if (tile !== "wall" && tile !== "barrier") result.push({ x, y });
      }
    }
  }
  return result;
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
  ].map((entry, index) => ({ ...entry, index }));
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
  add(data.spawn || layout?.spawn);
  add(data.exit || layout?.exit);
  actors.forEach((actor) => add(actor));
  (Array.isArray(data.hazards) ? data.hazards : []).forEach((hazard) => add(hazard, hazard?.blocking === true));
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
  return candidateCells.every((_cells, index) => assign(index, new Set()));
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

function buildPlacementContext({ layout, hazards = [], resources = [], actors = [] } = {}) {
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
    if (object.value?.blocking === true) blocking.add(pointKey(point));
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
    return { status: "unsat", reason: "capacity" };
  }
  // Path endpoints are approach floors; wall portals themselves are non-walkable.
  const spawn = normalizePoint(
    data?.spawnApproach || layout.spawnApproach || data?.spawn || layout.spawn,
  );
  const exit = normalizePoint(
    data?.exitApproach || layout.exitApproach || data?.exit || layout.exit,
  );
  if (!pathExists(cells, spawn, exit, blocking)) {
    return { status: "unsat", reason: "path_obstruction" };
  }
  return { status: pending.length === 0 ? "bypass" : "ready", layout, objects, pending, fixed, cells, candidates, blocking, spawn, exit };
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
  const placementVariableIds = context.pending.map((object, pendingIndex) => (
    context.candidates[pendingIndex].map((cellIndex) => {
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
  context.cells.forEach((_cell, cellIndex) => {
    const terms = placementVariableIds.flatMap((entries) => (
      entries.filter((entry) => entry.cellIndex === cellIndex).map(({ id }) => ({ variableId: id, coefficient: 1 }))
    ));
    if (terms.length > 1) constraints.push({
      id: `cell_${cellIndex}_unique`, kind: "linear", relation: "<=", rightHandSide: 1, terms,
    });
  });

  const dynamicBlockers = context.pending
    .map((object, index) => ({ object, index }))
    .filter(({ object }) => object.value?.blocking === true);
  if (dynamicBlockers.length > 0) {
    const usable = context.cells.filter((cell) => !context.blocking.has(pointKey(cell)));
    const usableKeys = new Set(usable.map(pointKey));
    const edges = [];
    for (const from of usable) {
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const to = { x: from.x + dx, y: from.y + dy };
        if (!usableKeys.has(pointKey(to))) continue;
        const id = `flow_${edges.length}`;
        variables.push({ id, kind: "integer", min: 0, max: 1 });
        edges.push({ id, from: pointKey(from), to: pointKey(to) });
        const cellIndex = context.cells.findIndex((cell) => pointKey(cell) === pointKey(to));
        const blockingTerms = dynamicBlockers.flatMap(({ index }) => (
          placementVariableIds[index]
            .filter((entry) => entry.cellIndex === cellIndex)
            .map(({ id: variableId }) => ({ variableId, coefficient: 1 }))
        ));
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
      const terms = [
        ...edges.filter(({ from }) => from === key).map(({ id }) => ({ variableId: id, coefficient: 1 })),
        ...edges.filter(({ to }) => to === key).map(({ id }) => ({ variableId: id, coefficient: -1 })),
      ];
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

function applyPlacements(prepared, solved, source) {
  const output = clone(prepared.layout);
  const data = dataOf(output);
  const placed = prepared.objects.map((object) => {
    const point = prepared.fixed.get(object.index) || solved.get(object.index);
    return { ...object.value, id: object.id, position: { ...point }, x: point.x, y: point.y };
  });
  const hazards = placed.filter((_entry, index) => prepared.objects[index].kind === "hazard");
  const resources = placed.filter((_entry, index) => prepared.objects[index].kind === "resource");
  if (hazards.length > 0) data.hazards = [...(Array.isArray(data.hazards) ? data.hazards : []), ...hazards];
  if (resources.length > 0) data.resources = resources;
  return { ok: true, source, layout: output };
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
    if (object.value?.blocking === true && solved.has(object.index)) blocking.add(pointKey(solved.get(object.index)));
  });
  if (!pathExists(prepared.cells, prepared.spawn, prepared.exit, blocking)) valid = false;
  if (!valid) return { ok: false, status: "error", reason: "configurator_object_placement_model_invalid" };
  return applyPlacements(prepared, solved, "solver");
}

function placeObjectsLegacy({ layout, hazards = [], resources = [] } = {}) {
  const output = clone(layout);
  const data = dataOf(output);
  const occupied = new Set();
  const reserve = (value) => {
    const point = normalizePoint(value);
    if (point) occupied.add(pointKey(point));
  };
  reserve(data.spawn || output.spawn);
  reserve(data.exit || output.exit);
  (Array.isArray(data.hazards) ? data.hazards : []).forEach(reserve);
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
      if (!assigned) {
        throw new Error(
          `configurator inputs could not place ${kind}: insufficient unoccupied walkable tiles `
          + `(${candidates.length} available, ${values.length} requested, ${index} placed before running out — raise floorTile.count).`,
        );
      }
      occupied.add(pointKey(assigned));
      const id = typeof value?.id === "string" && value.id.trim() ? value.id.trim() : `${kind}_${index + 1}`;
      return { ...value, id, position: { ...assigned }, x: assigned.x, y: assigned.y };
    });
  };
  const placedHazards = place(Array.isArray(hazards) ? hazards : [], "hazard");
  const placedResources = place(Array.isArray(resources) ? resources : [], "resource");
  if (placedHazards.length > 0) data.hazards = [...(Array.isArray(data.hazards) ? data.hazards : []), ...placedHazards];
  if (placedResources.length > 0) data.resources = placedResources;
  return { ok: true, source: "fallback", layout: output };
}

/** Consume host output; deferred/error/capability absence keeps the characterized fallback. */
export function completeObjectPlacement({ prepared: supplied, solverResult, ...args } = {}) {
  const prepared = supplied || prepareObjectPlacement(args);
  if (prepared.status === "error") {
    return { ok: false, status: prepared.status, reason: prepared.reason };
  }
  if (prepared.status === "unsat" && solverResult?.status === "unsat") {
    return { ok: false, status: "unsat", reason: prepared.reason };
  }
  if (prepared.status === "unsat") return placeObjectsLegacy(args);
  if (prepared.status === "bypass") return prepared.result;
  if (!solverResult || solverResult.status === "deferred" || solverResult.status === "error") {
    return placeObjectsLegacy(args);
  }
  return consumeObjectPlacementResult({ prepared, rawResult: solverResult });
}
