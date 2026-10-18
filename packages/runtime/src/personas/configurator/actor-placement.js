import { leftoverCategory } from "./unified-actors.js";
import { terrainPositions, terrainMarker } from "./terrain-layout.js";

/**
 * Configurator-owned actor grouping and placement.
 *
 * This module intentionally preserves both the room-aware strategic path and the
 * legacy group-anchor fallback. It is pure: caller-owned actors and layout data
 * are read only, and the returned actor records carry fresh position objects.
 */

function positionKey(pos) {
  return `${pos.x},${pos.y}`;
}

function normalizePoint(value) {
  const raw = value?.position && typeof value.position === "object" ? value.position : value;
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function comparePoints(a, b) {
  return (a.y - b.y) || (a.x - b.x);
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function parseCostFromId(id) {
  if (typeof id !== "string" || !id.trim()) return null;
  const trimmed = id.trim();
  const indexed = trimmed.match(/_(\d+)_(\d+)$/);
  if (indexed) return Number(indexed[1]);
  const trailing = trimmed.match(/_(\d+)$/);
  if (trailing) return Number(trailing[1]);
  return null;
}

function deriveActorPower(actor) {
  if (Number.isInteger(actor?.tokenCost) && actor.tokenCost > 0) return actor.tokenCost;
  if (Number.isInteger(actor?.cost) && actor.cost > 0) return actor.cost;
  const parsed = parseCostFromId(actor?.id);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;

  const vitals = actor?.vitals && typeof actor.vitals === "object" ? actor.vitals : null;
  if (vitals) {
    const fallback = ["health", "mana", "stamina", "durability"].reduce((sum, key) => {
      const record = vitals[key];
      if (!record || typeof record !== "object") return sum;
      const max = Number.isFinite(record.max) ? Math.max(0, record.max) : 0;
      const regen = Number.isFinite(record.regen) ? Math.max(0, record.regen) : 0;
      return sum + max + regen;
    }, 0);
    if (fallback > 0) return fallback;
  }
  return 1;
}

function compareActorStrengthDesc(a, b) {
  return (b.power - a.power) || String(a.actor?.id || "").localeCompare(String(b.actor?.id || ""));
}

function compareActorStrengthAsc(a, b) {
  return (a.power - b.power) || String(a.actor?.id || "").localeCompare(String(b.actor?.id || ""));
}

function compareActorIdsAsc(a, b) {
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function createActorGroups(actors, { supportPerLeader = 3 } = {}) {
  const ranked = actors.map((actor) => ({ actor, power: deriveActorPower(actor) })).sort(compareActorStrengthDesc);
  if (ranked.length === 0) return [];
  const groupSize = Math.max(2, supportPerLeader + 1);
  const groupCount = Math.max(1, Math.ceil(ranked.length / groupSize));
  const leaders = ranked.slice(0, groupCount);
  const supports = ranked.slice(groupCount).sort(compareActorStrengthAsc);
  const groups = leaders.map((leader) => [leader]);
  supports.forEach((support, index) => {
    groups[index % groups.length].push(support);
  });
  return groups;
}

function selectGroupAnchors({ walkable, groupCount, spawn } = {}) {
  const orderedWalkable = walkable.slice().sort(comparePoints);
  const walkableSet = new Set(orderedWalkable.map(positionKey));
  const anchors = [];
  const used = new Set();
  const addAnchor = (candidate) => {
    if (!candidate) return false;
    const key = positionKey(candidate);
    if (!walkableSet.has(key) || used.has(key)) return false;
    anchors.push({ x: candidate.x, y: candidate.y });
    used.add(key);
    return true;
  };

  if (!addAnchor(spawn) && orderedWalkable.length > 0) addAnchor(orderedWalkable[0]);
  while (anchors.length < groupCount && anchors.length < orderedWalkable.length) {
    let best = null;
    let bestDistance = -1;
    for (const candidate of orderedWalkable) {
      const key = positionKey(candidate);
      if (used.has(key)) continue;
      const minDistance = anchors.reduce(
        (currentMin, anchor) => Math.min(currentMin, manhattanDistance(candidate, anchor)),
        Number.POSITIVE_INFINITY,
      );
      if (
        minDistance > bestDistance
        || (minDistance === bestDistance && best && comparePoints(candidate, best) < 0)
        || (minDistance === bestDistance && !best)
      ) {
        best = candidate;
        bestDistance = minDistance;
      }
    }
    if (!best) break;
    addAnchor(best);
  }
  return anchors;
}

function sortPositionsByAnchorDistance(positions, anchor) {
  return positions.slice().sort((a, b) => {
    const distance = manhattanDistance(a, anchor) - manhattanDistance(b, anchor);
    return distance || comparePoints(a, b);
  });
}

function collectWalkablePositions(layout) {
  const data = layout?.data || layout;
  const blocked = new Set((data?.hazards || []).filter(actor => actor.blocking === true)
    .map(actor => `${actor.x},${actor.y}`));
  return terrainPositions(layout).filter(point => !blocked.has(positionKey(point)));
}

function collectReservedPlacementKeys(layout, reservedActors = []) {
  const data = layout?.data || layout || {};
  const reserved = new Set();
  const addPoint = (point) => {
    const normalized = normalizePoint(point);
    if (normalized) reserved.add(positionKey(normalized));
  };
  addPoint(terrainMarker(data, "spawn"));
  addPoint(terrainMarker(data, "exit"));
  // Approaches are seating targets, so they remain available until assigned.
  if (Array.isArray(data.hazards)) data.hazards.forEach(addPoint);
  if (Array.isArray(data.resources)) data.resources.forEach(addPoint);
  if (Array.isArray(reservedActors)) reservedActors.forEach(addPoint);
  return reserved;
}

function normalizePositiveInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function normalizeAffinityKind(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim().toLowerCase();
}

function normalizeRoomAffinityEntries(room, hazards) {
  const byKind = new Map();
  const roomHazards = Array.isArray(hazards)
    ? hazards.filter((hazard) => hazard && roomContainsPoint(room, { x: hazard.x, y: hazard.y }))
    : [];
  roomHazards.forEach((hazard) => {
    const affinity = hazard?.affinity;
    const kind = normalizeAffinityKind(affinity?.kind);
    if (!kind) return;
    const stacks = normalizePositiveInt(affinity.stacks, 0);
    if (stacks <= 0) return;
    const expression = typeof affinity.expression === "string" ? affinity.expression.trim().toLowerCase() : "";
    const current = byKind.get(kind) || { kind, emitStacks: 0, maxStacks: 0 };
    if (expression === "emit") current.emitStacks = Math.max(current.emitStacks, stacks);
    current.maxStacks = Math.max(current.maxStacks, stacks);
    byKind.set(kind, current);
  });
  return Array.from(byKind.values())
    .map((record) => ({
      kind: record.kind,
      stacks: record.emitStacks > 0 ? record.emitStacks : Math.max(1, record.maxStacks),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function collectActorAffinityKinds(actor) {
  const kinds = new Set();
  if (Array.isArray(actor?.affinities)) {
    actor.affinities.forEach((entry) => {
      const kind = normalizeAffinityKind(entry?.kind);
      if (kind) kinds.add(kind);
    });
  }
  if (actor?.traits?.affinities && typeof actor.traits.affinities === "object") {
    Object.keys(actor.traits.affinities).forEach((key) => {
      const [rawKind] = String(key || "").split(":");
      const kind = normalizeAffinityKind(rawKind);
      if (kind) kinds.add(kind);
    });
  }
  const directAffinity = normalizeAffinityKind(actor?.affinity);
  if (directAffinity) kinds.add(directAffinity);
  return Array.from(kinds.values()).sort();
}

function roomContainsPoint(room, point) {
  if (!room || !point) return false;
  return (
    point.x >= room.x
    && point.x < room.x + room.width
    && point.y >= room.y
    && point.y < room.y + room.height
  );
}

function resolveRoomId(room, index) {
  if (typeof room?.id === "string" && room.id.trim()) return room.id.trim();
  return `R${index + 1}`;
}

function collectWalkableInRoom(walkable, room) {
  if (!Array.isArray(walkable) || !room) return [];
  return walkable.filter((point) => roomContainsPoint(room, point));
}

function uniquePositions(positions = []) {
  const map = new Map();
  positions.forEach((pos) => {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    map.set(`${x},${y}`, { x, y });
  });
  return Array.from(map.values()).sort(comparePoints);
}

function findRoomIndexForPoint(rooms, point) {
  if (!Array.isArray(rooms) || !point) return -1;
  for (let index = 0; index < rooms.length; index += 1) {
    if (roomContainsPoint(rooms[index], point)) return index;
  }
  return -1;
}

function pickRoomPairWithGreatestDeltas(rooms, roomWalkableByIndex) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  const viable = rooms
    .map((room, index) => ({
      room,
      index,
      center: { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) },
    }))
    .filter((entry) => Array.isArray(roomWalkableByIndex[entry.index]) && roomWalkableByIndex[entry.index].length > 0);
  if (viable.length === 0) return null;
  if (viable.length === 1) return { entryRoomIndex: viable[0].index, exitRoomIndex: viable[0].index };

  let best = null;
  for (let first = 0; first < viable.length - 1; first += 1) {
    for (let second = first + 1; second < viable.length; second += 1) {
      const a = viable[first];
      const b = viable[second];
      const dx = Math.abs(a.center.x - b.center.x);
      const dy = Math.abs(a.center.y - b.center.y);
      const aFirst = (a.center.x < b.center.x) || (a.center.x === b.center.x && a.center.y <= b.center.y);
      const entry = aFirst ? a : b;
      const exit = aFirst ? b : a;
      const candidate = {
        entryRoomIndex: entry.index,
        exitRoomIndex: exit.index,
        totalDelta: dx + dy,
        minAxisDelta: Math.min(dx, dy),
        maxAxisDelta: Math.max(dx, dy),
        entryCenter: entry.center,
        exitCenter: exit.center,
      };
      if (!best
        || candidate.totalDelta > best.totalDelta
        || (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta > best.minAxisDelta)
        || (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta === best.minAxisDelta
          && candidate.maxAxisDelta > best.maxAxisDelta)
        || (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta === best.minAxisDelta
          && candidate.maxAxisDelta === best.maxAxisDelta
          && comparePoints(candidate.entryCenter, best.entryCenter) < 0)
        || (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta === best.minAxisDelta
          && candidate.maxAxisDelta === best.maxAxisDelta
          && comparePoints(candidate.entryCenter, best.entryCenter) === 0
          && comparePoints(candidate.exitCenter, best.exitCenter) < 0)) {
        best = candidate;
      }
    }
  }
  return best
    ? { entryRoomIndex: best.entryRoomIndex, exitRoomIndex: best.exitRoomIndex }
    : null;
}

function deriveRoomPlacementContext({ data, walkable } = {}) {
  const rooms = Array.isArray(data?.rooms)
    ? data.rooms.filter((room) => room && Number.isFinite(room.x) && Number.isFinite(room.y)
      && Number.isFinite(room.width) && Number.isFinite(room.height))
    : [];
  if (rooms.length === 0 || !Array.isArray(walkable) || walkable.length === 0) return null;
  const roomWalkableByIndex = rooms.map((room) => collectWalkableInRoom(walkable, room));

  let entryRoomIndex = typeof data?.entryRoomId === "string" && data.entryRoomId.trim()
    ? rooms.findIndex((room, index) => resolveRoomId(room, index) === data.entryRoomId.trim())
    : -1;
  if (entryRoomIndex < 0) entryRoomIndex = findRoomIndexForPoint(rooms, terrainMarker(data, "spawn"));

  let exitRoomIndex = typeof data?.exitRoomId === "string" && data.exitRoomId.trim()
    ? rooms.findIndex((room, index) => resolveRoomId(room, index) === data.exitRoomId.trim())
    : -1;
  if (exitRoomIndex < 0) exitRoomIndex = findRoomIndexForPoint(rooms, terrainMarker(data, "exit"));

  if (
    entryRoomIndex < 0
    || exitRoomIndex < 0
    || roomWalkableByIndex[entryRoomIndex]?.length === 0
    || roomWalkableByIndex[exitRoomIndex]?.length === 0
  ) {
    const pair = pickRoomPairWithGreatestDeltas(rooms, roomWalkableByIndex);
    if (!pair) return null;
    entryRoomIndex = pair.entryRoomIndex;
    exitRoomIndex = pair.exitRoomIndex;
  }

  const entryRoom = rooms[entryRoomIndex];
  const exitRoom = rooms[exitRoomIndex];
  if (!entryRoom || !exitRoom) return null;
  const entryRoomWalkable = uniquePositions(roomWalkableByIndex[entryRoomIndex] || []);
  const exitRoomWalkable = uniquePositions(roomWalkableByIndex[exitRoomIndex] || []);
  if (entryRoomWalkable.length === 0 || exitRoomWalkable.length === 0) return null;

  const allRoomsWalkable = uniquePositions(roomWalkableByIndex.flatMap((roomWalkable) => roomWalkable || []));
  const hazards = Array.isArray(data?.hazards) ? data.hazards : [];
  const roomAffinityWalkableByKind = {};
  rooms.forEach((room, index) => {
    const roomWalkable = uniquePositions(roomWalkableByIndex[index] || []);
    if (roomWalkable.length === 0) return;
    normalizeRoomAffinityEntries(room, hazards).forEach((entry) => {
      const current = Array.isArray(roomAffinityWalkableByKind[entry.kind])
        ? roomAffinityWalkableByKind[entry.kind]
        : [];
      roomAffinityWalkableByKind[entry.kind] = current.concat(roomWalkable);
    });
  });
  Object.keys(roomAffinityWalkableByKind).forEach((kind) => {
    roomAffinityWalkableByKind[kind] = uniquePositions(roomAffinityWalkableByKind[kind]);
  });
  // #397: the rooms wardens spread over, every room but the entry room: the exit room first,
  // then the rest nearest the exit first. Each carries its centre as the seat anchor.
  const exitCenter = roomCenter(exitRoom);
  const spreadRooms = rooms
    .map((room, index) => ({ index, center: roomCenter(room), walkable: uniquePositions(roomWalkableByIndex[index] || []) }))
    .filter((entry) => entry.index !== entryRoomIndex && entry.walkable.length > 0)
    .sort((a, b) => (b.index === exitRoomIndex) - (a.index === exitRoomIndex)
      || manhattanDistance(a.center, exitCenter) - manhattanDistance(b.center, exitCenter)
      || comparePoints(a.center, b.center));
  return {
    entryRoomWalkable,
    exitRoomWalkable,
    allRoomsWalkable,
    roomAffinityWalkableByKind,
    spreadRooms,
  };
}

function roomCenter(room) {
  return { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) };
}

function authoredAlignment(actor) {
  if (actor?.alignment === "external" || actor?.alignment === "dungeon") return actor.alignment;
  const category = leftoverCategory(actor);
  if (category === "delver") return "external";
  if (category) return "dungeon";
  throw new Error(`configurator inputs require actor alignment or category for "${actor?.id || "unknown"}".`);
}

function partitionActorsByAlignment(actors) {
  const sorted = actors.slice().sort(compareActorIdsAsc);
  const delvers = [];
  const wardens = [];
  sorted.forEach((actor) => {
    if (authoredAlignment(actor) === "external") delvers.push(actor);
    else wardens.push(actor);
  });
  return { delvers, wardens };
}

function pickPreferredPosition({ candidateSets = [], used, anchor } = {}) {
  for (const rawSet of candidateSets) {
    const available = uniquePositions(rawSet).filter((pos) => !used.has(positionKey(pos)));
    if (available.length === 0) continue;
    available.sort((a, b) => {
      const distance = manhattanDistance(a, anchor) - manhattanDistance(b, anchor);
      return distance || comparePoints(a, b);
    });
    return available[0];
  }
  return null;
}

function placeActorsLegacy(actors, layout, reservedActors = []) {
  const data = layout?.data || layout;
  const walkable = collectWalkablePositions(layout);
  if (!data || walkable.length === 0) {
    throw new Error(
      `configurator inputs could not place actors: no walkable tiles (0 available, `
      + `${actors.length} actor${actors.length === 1 ? "" : "s"} to place).`,
    );
  }
  const walkableSet = new Set(walkable.map(positionKey));
  const spawn = terrainMarker(data, "spawn");
  const spawnApproach = data.spawnApproach || layout?.spawnApproach || null;
  const seatingSpawn = spawnApproach || spawn;
  const spawnKey = seatingSpawn ? positionKey(seatingSpawn) : null;
  if (spawnKey && !walkableSet.has(spawnKey)) {
    throw new Error(
      `configurator inputs could not place actors: spawn seating (${seatingSpawn.x}, ${seatingSpawn.y}) not walkable.`,
    );
  }

  const groups = createActorGroups(actors, { supportPerLeader: 3 });
  const anchors = selectGroupAnchors({
    walkable,
    groupCount: groups.length,
    spawn: spawnKey && seatingSpawn ? { x: seatingSpawn.x, y: seatingSpawn.y } : null,
  });
  if (anchors.length === 0) {
    throw new Error(
      `configurator inputs could not place actors: no anchor points `
      + `(${groups.length} group${groups.length === 1 ? "" : "s"}, ${walkable.length} walkable tiles).`,
    );
  }
  const used = collectReservedPlacementKeys(layout, reservedActors);
  const assignedById = new Map();
  groups.forEach((group, groupIndex) => {
    const anchor = anchors[Math.min(groupIndex, anchors.length - 1)];
    const available = walkable.filter((pos) => !used.has(positionKey(pos)));
    if (available.length < group.length) {
      throw new Error(
        `configurator inputs could not place actors: insufficient walkable tiles for group `
        + `${groupIndex} (${available.length} available, ${group.length} requested).`,
      );
    }
    const sorted = sortPositionsByAnchorDistance(available, anchor);
    group.forEach((entry, memberIndex) => {
      const assigned = sorted[memberIndex];
      used.add(positionKey(assigned));
      assignedById.set(entry.actor.id, { x: assigned.x, y: assigned.y });
    });
  });

  if (seatingSpawn && !used.has(positionKey(seatingSpawn))) {
    const primaryActor = actors.slice().sort(compareActorIdsAsc)[0];
    const primaryId = primaryActor?.id;
    if (primaryId && assignedById.has(primaryId)) {
      const primaryPosition = assignedById.get(primaryId);
      const spawnPosition = { x: seatingSpawn.x, y: seatingSpawn.y };
      if (primaryPosition.x !== spawnPosition.x || primaryPosition.y !== spawnPosition.y) {
        let spawnActorId = null;
        for (const actor of actors) {
          const position = assignedById.get(actor.id);
          if (position?.x === spawnPosition.x && position?.y === spawnPosition.y) {
            spawnActorId = actor.id;
            break;
          }
        }
        if (spawnActorId && spawnActorId !== primaryId) {
          assignedById.set(spawnActorId, { x: primaryPosition.x, y: primaryPosition.y });
        }
        assignedById.set(primaryId, spawnPosition);
      }
    }
  }
  return buildPlacementResult(actors, assignedById, "unresolved group placement");
}

function buildPlacementResult(actors, assignedById, unresolvedReason) {
  let changed = false;
  const normalized = actors.map((actor) => {
    const assigned = assignedById.get(actor.id);
    if (!assigned) {
      throw new Error(`configurator inputs could not place actors: ${unresolvedReason} for actor "${actor.id}".`);
    }
    const desired = actor?.position;
    if (!desired || desired.x !== assigned.x || desired.y !== assigned.y) changed = true;
    return { ...actor, position: { x: assigned.x, y: assigned.y } };
  });
  return { actors: normalized, changed };
}

export function placeActors({ actors, layout, reservedActors = [], delverCount = 1, pinnedPositions = {} } = {}) {
  if (!Array.isArray(actors) || actors.length === 0) return { actors, changed: false };
  // #301: an actor a placement constraint positioned keeps that cell; the others are seated
  // around it as usual.
  const pinnedIds = actors.map((actor) => actor?.id).filter((id) => pinnedPositions?.[id]);
  if (pinnedIds.length > 0) {
    const pinned = actors.filter((actor) => pinnedIds.includes(actor?.id))
      .map((actor) => ({ ...actor, position: { ...pinnedPositions[actor.id] } }));
    const free = actors.filter((actor) => !pinnedIds.includes(actor?.id));
    const seated = free.length > 0
      ? placeActors({ actors: free, layout, reservedActors: [...reservedActors, ...pinned], delverCount })
      : { actors: [] };
    const byId = new Map([...pinned, ...seated.actors].map((actor) => [actor.id, actor]));
    return { actors: actors.map((actor) => byId.get(actor.id)), changed: true };
  }
  const data = layout?.data || layout;
  const walkable = collectWalkablePositions(layout);
  if (!data || walkable.length === 0) {
    throw new Error(
      `configurator inputs could not place actors: no walkable tiles (0 available, `
      + `${actors.length} actor${actors.length === 1 ? "" : "s"} to place).`,
    );
  }
  const walkableSet = new Set(walkable.map(positionKey));
  const spawn = terrainMarker(data, "spawn");
  const exit = terrainMarker(data, "exit");
  const spawnApproach = data.spawnApproach || layout?.spawnApproach || null;
  const exitApproach = data.exitApproach || layout?.exitApproach || null;
  // Spawn/exit are wall portals (non-walkable). Seating uses approach floors.
  if (spawnApproach && !walkableSet.has(positionKey(spawnApproach))) {
    throw new Error(
      `configurator inputs could not place actors: spawnApproach (${spawnApproach.x}, ${spawnApproach.y}) not walkable.`,
    );
  }
  if (exitApproach && !walkableSet.has(positionKey(exitApproach))) {
    throw new Error(
      `configurator inputs could not place actors: exitApproach (${exitApproach.x}, ${exitApproach.y}) not walkable.`,
    );
  }

  const context = deriveRoomPlacementContext({ data, walkable });
  if (!context) return placeActorsLegacy(actors, layout, reservedActors);
  const { delvers, wardens } = partitionActorsByAlignment(actors);
  const used = collectReservedPlacementKeys(layout, reservedActors);
  const assignedById = new Map();
  const entryAnchor = spawnApproach && walkableSet.has(positionKey(spawnApproach))
    ? { x: spawnApproach.x, y: spawnApproach.y }
    : context.entryRoomWalkable[0];
  const exitAnchor = exitApproach && walkableSet.has(positionKey(exitApproach))
    ? { x: exitApproach.x, y: exitApproach.y }
    : context.exitRoomWalkable[0];

  delvers.forEach((actor, index) => {
    let assigned = null;
    if (index === 0 && entryAnchor && !used.has(positionKey(entryAnchor))) {
      assigned = { x: entryAnchor.x, y: entryAnchor.y };
    }
    if (!assigned) {
      assigned = pickPreferredPosition({
        candidateSets: [context.entryRoomWalkable, walkable],
        used,
        anchor: entryAnchor || context.entryRoomWalkable[0] || walkable[0],
      });
    }
    if (!assigned) {
      throw new Error(
        `configurator inputs could not place actors: insufficient entry-room tiles for delver `
        + `${index + 1} of ${delvers.length} (${context.entryRoomWalkable.length} entry-room tiles, `
        + `${used.size} already occupied).`,
      );
    }
    used.add(positionKey(assigned));
    assignedById.set(actor.id, assigned);
  });

  // #397 (#360): no warden is seated on the exit approach itself, so none can seal the exit.
  if (exitApproach) used.add(positionKey(exitApproach));
  wardens.forEach((actor, index) => {
    // The first warden guards the exit room, beside the approach. The rest keep their
    // affinity-room preference, else take the next room in the spread, one room each while
    // rooms last, so patrol rings do not crowd one another.
    const room = context.spreadRooms.length > 0
      ? context.spreadRooms[index % context.spreadRooms.length]
      : null;
    const affinityCandidateSets = index === 0 ? [] : collectActorAffinityKinds(actor)
      .map((kind) => context.roomAffinityWalkableByKind?.[kind])
      .filter((set) => Array.isArray(set) && set.length > 0);
    const affinityAnchor = affinityCandidateSets[0]?.[0] || null;
    const assigned = pickPreferredPosition({
      candidateSets: [...affinityCandidateSets, room?.walkable || [], context.exitRoomWalkable, context.allRoomsWalkable],
      used,
      anchor: (index === 0 ? exitAnchor : null) || affinityAnchor || room?.center || exitAnchor
        || context.exitRoomWalkable[0] || context.allRoomsWalkable[0] || walkable[0],
    });
    if (!assigned) {
      throw new Error(
        `configurator inputs could not place actors: insufficient room tiles for warden "${actor.id}" `
        + `(${context.allRoomsWalkable.length} room tiles total, ${used.size} already occupied).`,
      );
    }
    used.add(positionKey(assigned));
    assignedById.set(actor.id, assigned);
  });
  return buildPlacementResult(actors, assignedById, "unresolved strategic placement");
}
