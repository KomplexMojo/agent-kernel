import { mapBuildSpecToArtifacts } from "./map-build-spec.js";
import { solveWithAdapter } from "../ports/solver.js";
import { generateGridLayoutFromInput } from "../personas/configurator/level-layout.js";
import { resolveAffinityEffects } from "../personas/configurator/affinity-effects.js";
import { buildAmbientAffinityPressure } from "../personas/configurator/affinity-pressure.js";
import { normalizeAffinityRulesArtifact, resolveAffinityRules } from "../personas/configurator/affinity-rules.js";
import { buildSimConfigArtifact, buildInitialStateArtifact } from "../personas/configurator/artifact-builders.js";
import { evaluateConfiguratorSpend } from "../personas/configurator/spend-proposal.js";
import { normalizeMotivationRulesArtifact, resolveMotivationRules } from "../personas/configurator/motivation-rules.js";
import {
  DEFAULT_ROOM_CARD_AFFINITY,
  ROOM_AFFINITY_EMIT_PERCENT_PER_STACK,
} from "../contracts/domain-constants.js";

const SCHEMAS = Object.freeze({
  solverRequest: "agent-kernel/SolverRequest",
  solverResult: "agent-kernel/SolverResult",
  affinityPreset: "agent-kernel/AffinityPresetArtifact",
  actorLoadout: "agent-kernel/ActorLoadoutArtifact",
  affinityRules: "agent-kernel/AffinityRulesArtifact",
  motivationRules: "agent-kernel/MotivationRulesArtifact",
  affinitySummary: "agent-kernel/AffinitySummary",
});

function createBuildMeta(spec, producedBy, suffix) {
  return {
    id: `${spec.meta.id}_${suffix}`,
    runId: spec.meta.runId,
    createdAt: spec.meta.createdAt,
    producedBy,
    correlationId: spec.meta.correlationId,
    note: spec.meta.note,
  };
}

function toRef(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  if (!artifact.schema || !artifact.schemaVersion) {
    return null;
  }
  const id = artifact.meta?.id;
  if (!id) {
    return null;
  }
  return {
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
  };
}

function assertSchema(artifact, expectedSchema) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Expected ${expectedSchema} artifact.`);
  }
  if (artifact.schema !== expectedSchema) {
    throw new Error(`Expected schema ${expectedSchema}, got ${artifact.schema || "missing"}.`);
  }
  if (artifact.schemaVersion !== 1) {
    throw new Error(`Expected schemaVersion 1 for ${expectedSchema}.`);
  }
}

function normalizeResolvedRulesArtifact({
  artifact,
  schema,
  normalizeArtifact,
  resolveDefaultArtifact,
  label,
} = {}) {
  if (!artifact) {
    return resolveDefaultArtifact();
  }
  assertSchema(artifact, schema);
  const normalized = normalizeArtifact(artifact);
  if (!normalized.ok) {
    const details = normalized.errors.map((entry) => `${entry.field}:${entry.code}`).join(", ");
    throw new Error(`${label} invalid: ${details}`);
  }
  return normalized.value;
}

function positionKey(pos) {
  return `${pos.x},${pos.y}`;
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
    const target = index % groups.length;
    groups[target].push(support);
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

  if (!addAnchor(spawn) && orderedWalkable.length > 0) {
    addAnchor(orderedWalkable[0]);
  }

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
    const dist = manhattanDistance(a, anchor) - manhattanDistance(b, anchor);
    return dist || comparePoints(a, b);
  });
}

function collectWalkablePositions(layout) {
  const data = layout?.data || layout;
  if (!data) return [];

  const walkable = [];
  const traps = Array.isArray(data.traps) ? data.traps : [];
  const blockingTraps = new Set(
    traps
      .filter((trap) => trap && trap.blocking === true)
      .map((trap) => `${trap.x},${trap.y}`),
  );

  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      const row = data.kinds[y] || [];
      for (let x = 0; x < row.length; x += 1) {
        const kind = row[x];
        if (kind === 1) continue;
        if (kind === 2 && blockingTraps.has(`${x},${y}`)) continue;
        walkable.push({ x, y });
      }
    }
    return walkable;
  }

  if (Array.isArray(data.tiles)) {
    const legend = data.legend || {};
    for (let y = 0; y < data.tiles.length; y += 1) {
      const row = String(data.tiles[y] ?? "");
      for (let x = 0; x < row.length; x += 1) {
        const char = row[x];
        const entry = legend[char];
        const tileType = entry?.tile;
        if (tileType === "wall" || tileType === "barrier") continue;
        walkable.push({ x, y });
      }
    }
  }

  return walkable;
}

function normalizeActorPositionsLegacy(actors, layout) {
  if (!Array.isArray(actors) || actors.length === 0) {
    return { actors, changed: false };
  }

  const data = layout?.data || layout;
  const walkable = collectWalkablePositions(layout);
  if (!data || walkable.length === 0) {
    throw new Error("configurator inputs could not place actors: no walkable tiles");
  }

  const walkableSet = new Set(walkable.map(positionKey));
  const spawn = data.spawn || layout?.spawn || null;
  const spawnKey = spawn ? positionKey(spawn) : null;
  if (spawnKey && !walkableSet.has(spawnKey)) {
    throw new Error("configurator inputs could not place actors: spawn not walkable");
  }

  const groups = createActorGroups(actors, { supportPerLeader: 3 });
  const anchors = selectGroupAnchors({
    walkable,
    groupCount: groups.length,
    spawn: spawnKey && spawn ? { x: spawn.x, y: spawn.y } : null,
  });
  if (anchors.length === 0) {
    throw new Error("configurator inputs could not place actors: no anchor points");
  }

  const used = new Set();
  let changed = false;
  const assignedById = new Map();

  groups.forEach((group, groupIndex) => {
    const anchor = anchors[Math.min(groupIndex, anchors.length - 1)];
    const available = walkable.filter((pos) => !used.has(positionKey(pos)));
    if (available.length < group.length) {
      throw new Error("configurator inputs could not place actors: insufficient walkable tiles");
    }
    const sorted = sortPositionsByAnchorDistance(available, anchor);
    group.forEach((entry, memberIndex) => {
      const assigned = sorted[memberIndex];
      const key = positionKey(assigned);
      used.add(key);
      assignedById.set(entry.actor.id, { x: assigned.x, y: assigned.y });
    });
  });

  if (spawn) {
    const primaryActor = actors.slice().sort(compareActorIdsAsc)[0];
    const primaryId = primaryActor?.id;
    if (primaryId && assignedById.has(primaryId)) {
      const primaryPosition = assignedById.get(primaryId);
      const spawnPosition = { x: spawn.x, y: spawn.y };
      if (primaryPosition.x !== spawnPosition.x || primaryPosition.y !== spawnPosition.y) {
        let spawnActorId = null;
        for (const actor of actors) {
          const position = assignedById.get(actor.id);
          if (!position) continue;
          if (position.x === spawnPosition.x && position.y === spawnPosition.y) {
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

  const normalized = actors.map((actor) => {
    const desired = actor?.position;
    const assigned = assignedById.get(actor.id);
    if (!assigned) {
      throw new Error("configurator inputs could not place actors: unresolved group placement");
    }
    if (!desired || desired.x !== assigned.x || desired.y !== assigned.y) {
      changed = true;
    }
    return { ...actor, position: { x: assigned.x, y: assigned.y } };
  });

  return { actors: normalized, changed };
}

function normalizePositiveInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

const ROOM_AFFINITY_ASSIGNMENT_SEED_XOR = 0x9e3779b9;
const ROOM_AFFINITY_TILE_SEED_XOR = 0x85ebca6b;

function createRng(seed = 0) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithRng(list, rng) {
  const values = list.slice();
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}

function normalizeAffinityKind(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim().toLowerCase();
}

function normalizeRoomAffinityEntries(entry, { fallbackAffinity = "" } = {}) {
  const byKind = new Map();
  const affinityList = Array.isArray(entry?.affinities) ? entry.affinities : [];
  affinityList.forEach((affinity) => {
    const kind = normalizeAffinityKind(affinity?.kind);
    if (!kind) return;
    const stacks = normalizePositiveInt(affinity?.stacks, 0);
    if (stacks <= 0) return;
    const expression = typeof affinity?.expression === "string" ? affinity.expression.trim().toLowerCase() : "";
    const current = byKind.get(kind) || { kind, emitStacks: 0, maxStacks: 0 };
    if (expression === "emit") {
      current.emitStacks = Math.max(current.emitStacks, stacks);
    }
    current.maxStacks = Math.max(current.maxStacks, stacks);
    byKind.set(kind, current);
  });

  if (byKind.size === 0) {
    const fallbackKind = normalizeAffinityKind(entry?.affinity || fallbackAffinity);
    if (fallbackKind) {
      byKind.set(fallbackKind, { kind: fallbackKind, emitStacks: 0, maxStacks: 1 });
    }
  }

  return Array.from(byKind.values())
    .map((record) => ({
      kind: record.kind,
      stacks: record.emitStacks > 0 ? record.emitStacks : Math.max(1, record.maxStacks),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function buildRoomAffinityProfilesFromCardSet(cardSet, { fallbackAffinity = "" } = {}) {
  if (!Array.isArray(cardSet) || cardSet.length === 0) return [];
  const profiles = [];
  cardSet.forEach((card, index) => {
    const type = typeof card?.type === "string" ? card.type.trim().toLowerCase() : "";
    const source = typeof card?.source === "string" ? card.source.trim().toLowerCase() : "";
    if (type !== "room" && source !== "room") return;
    const count = Math.max(1, normalizePositiveInt(card?.count, 1));
    const affinities = normalizeRoomAffinityEntries(card, { fallbackAffinity });
    if (affinities.length === 0) return;
    const templateId = typeof card?.id === "string" && card.id.trim() ? card.id.trim() : `room_card_${index + 1}`;
    for (let i = 0; i < count; i += 1) {
      const templateInstanceId = `${templateId}-${i + 1}`;
      profiles.push({
        id: templateInstanceId,
        templateId,
        templateInstanceId,
        affinities: affinities.map((entry) => ({ ...entry })),
      });
    }
  });
  return profiles;
}

function collectRoomWalkableTilesFromLayout(layout, room) {
  if (!Array.isArray(layout?.tiles) || !room) return [];
  const width = layout.tiles.reduce((max, row) => Math.max(max, String(row || "").length), 0);
  const startY = Math.max(0, room.y);
  const endY = Math.min(layout.tiles.length - 1, room.y + room.height - 1);
  const startX = Math.max(0, room.x);
  const endX = Math.max(startX - 1, Math.min(width - 1, room.x + room.width - 1));
  const cells = [];

  for (let y = startY; y <= endY; y += 1) {
    const row = String(layout.tiles[y] || "");
    for (let x = startX; x <= endX; x += 1) {
      const char = row[x];
      if (!char || char === "#" || char === "B") continue;
      const tileKind = Array.isArray(layout.kinds?.[y]) ? layout.kinds[y][x] : null;
      if (tileKind === 1) continue;
      cells.push({ x, y });
    }
  }

  return cells;
}

function augmentLayoutWithRoomAffinityEffects(
  layout,
  {
    cardSet,
    fallbackAffinity = "",
    seed = 0,
  } = {},
) {
  if (!layout || !Array.isArray(layout.rooms) || layout.rooms.length === 0) {
    return { layout, generatedTrapCount: 0 };
  }

  const profiles = buildRoomAffinityProfilesFromCardSet(cardSet, { fallbackAffinity });
  const hasRoomAffinityMetadata = layout.rooms.some((room) => normalizeRoomAffinityEntries(room).length > 0);
  if (profiles.length === 0 && !hasRoomAffinityMetadata) {
    return { layout, generatedTrapCount: 0 };
  }

  const normalizedSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const assignmentRng = createRng((normalizedSeed ^ ROOM_AFFINITY_ASSIGNMENT_SEED_XOR) >>> 0);
  const roomOrder = shuffleWithRng(layout.rooms.map((_, index) => index), assignmentRng);
  const nextRooms = layout.rooms.map((room) => ({ ...room }));

  if (profiles.length > 0) {
    roomOrder.forEach((roomIndex, orderIndex) => {
      const profile = profiles[orderIndex % profiles.length];
      if (!profile || !Array.isArray(profile.affinities) || profile.affinities.length === 0) return;
      const affinities = profile.affinities.map((entry) => ({
        kind: entry.kind,
        expression: "emit",
        stacks: Math.max(1, normalizePositiveInt(entry.stacks, 1)),
      }));
      const primaryAffinity = affinities[0]?.kind;
      nextRooms[roomIndex] = {
        ...nextRooms[roomIndex],
        affinity: primaryAffinity || nextRooms[roomIndex]?.affinity,
        affinities,
        templateId: profile.templateId,
        templateInstanceId: profile.templateInstanceId,
      };
    });
  }

  const existingTraps = Array.isArray(layout.traps) ? layout.traps.map((trap) => ({ ...trap })) : [];
  const occupied = new Set(
    existingTraps
      .filter((trap) => Number.isFinite(trap?.x) && Number.isFinite(trap?.y))
      .map((trap) => `${trap.x},${trap.y}`),
  );
  const spawnKey = Number.isFinite(layout?.spawn?.x) && Number.isFinite(layout?.spawn?.y)
    ? `${layout.spawn.x},${layout.spawn.y}`
    : "";
  const exitKey = Number.isFinite(layout?.exit?.x) && Number.isFinite(layout?.exit?.y)
    ? `${layout.exit.x},${layout.exit.y}`
    : "";
  const trapRng = createRng((normalizedSeed ^ ROOM_AFFINITY_TILE_SEED_XOR) >>> 0);
  const generatedTraps = [];

  nextRooms.forEach((room, roomIndex) => {
    const roomAffinities = normalizeRoomAffinityEntries(room);
    if (roomAffinities.length === 0) return;
    const roomTiles = collectRoomWalkableTilesFromLayout(layout, room)
      .filter((tile) => {
        const key = `${tile.x},${tile.y}`;
        return key !== spawnKey && key !== exitKey && !occupied.has(key);
      });
    if (roomTiles.length === 0) return;
    const randomizedTiles = shuffleWithRng(roomTiles, trapRng);
    randomizedTiles.forEach((tile, tileIndex) => {
      const affinity = roomAffinities[tileIndex % roomAffinities.length];
      const roomStacks = Math.max(1, normalizePositiveInt(affinity?.stacks, 1));
      const manaReserve = ROOM_AFFINITY_EMIT_PERCENT_PER_STACK * roomStacks;
      generatedTraps.push({
        x: tile.x,
        y: tile.y,
        blocking: false,
        source: "room_affinity_tile",
        roomId: resolveRoomId(room, roomIndex),
        affinity: {
          kind: affinity.kind,
          expression: "emit",
          stacks: 1,
          roomStacks,
          targetType: "floor",
        },
        vitals: {
          mana: { current: manaReserve, max: manaReserve, regen: 0 },
        },
      });
      occupied.add(`${tile.x},${tile.y}`);
    });
  });

  layout.rooms = nextRooms;
  if (generatedTraps.length > 0 || existingTraps.length > 0) {
    layout.traps = [...existingTraps, ...generatedTraps];
  }

  return {
    layout,
    generatedTrapCount: generatedTraps.length,
  };
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
  for (let i = 0; i < rooms.length; i += 1) {
    if (roomContainsPoint(rooms[i], point)) return i;
  }
  return -1;
}

function pickRoomPairWithGreatestDeltas(rooms, roomWalkableByIndex) {
  if (!Array.isArray(rooms) || rooms.length === 0) return null;
  const viable = rooms
    .map((room, index) => ({ room, index, center: { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) } }))
    .filter((entry) => Array.isArray(roomWalkableByIndex[entry.index]) && roomWalkableByIndex[entry.index].length > 0);
  if (viable.length === 0) return null;
  if (viable.length === 1) {
    return { entryRoomIndex: viable[0].index, exitRoomIndex: viable[0].index };
  }

  let best = null;
  for (let i = 0; i < viable.length - 1; i += 1) {
    for (let j = i + 1; j < viable.length; j += 1) {
      const a = viable[i];
      const b = viable[j];
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
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.totalDelta > best.totalDelta) {
        best = candidate;
        continue;
      }
      if (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta > best.minAxisDelta) {
        best = candidate;
        continue;
      }
      if (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta === best.minAxisDelta
        && candidate.maxAxisDelta > best.maxAxisDelta) {
        best = candidate;
        continue;
      }
      if (candidate.totalDelta === best.totalDelta && candidate.minAxisDelta === best.minAxisDelta
        && candidate.maxAxisDelta === best.maxAxisDelta) {
        const entryCompare = comparePoints(candidate.entryCenter, best.entryCenter);
        if (entryCompare < 0) {
          best = candidate;
          continue;
        }
        if (entryCompare === 0 && comparePoints(candidate.exitCenter, best.exitCenter) < 0) {
          best = candidate;
        }
      }
    }
  }

  if (!best) return null;
  return {
    entryRoomIndex: best.entryRoomIndex,
    exitRoomIndex: best.exitRoomIndex,
  };
}

function deriveRoomPlacementContext({ data, walkable } = {}) {
  const rooms = Array.isArray(data?.rooms)
    ? data.rooms.filter((room) => room && Number.isFinite(room.x) && Number.isFinite(room.y)
      && Number.isFinite(room.width) && Number.isFinite(room.height))
    : [];
  if (rooms.length === 0 || !Array.isArray(walkable) || walkable.length === 0) {
    return null;
  }
  const roomWalkableByIndex = rooms.map((room) => collectWalkableInRoom(walkable, room));

  let entryRoomIndex = -1;
  if (typeof data?.entryRoomId === "string" && data.entryRoomId.trim()) {
    entryRoomIndex = rooms.findIndex((room, index) => resolveRoomId(room, index) === data.entryRoomId.trim());
  }
  if (entryRoomIndex < 0) {
    entryRoomIndex = findRoomIndexForPoint(rooms, data?.spawn);
  }

  let exitRoomIndex = -1;
  if (typeof data?.exitRoomId === "string" && data.exitRoomId.trim()) {
    exitRoomIndex = rooms.findIndex((room, index) => resolveRoomId(room, index) === data.exitRoomId.trim());
  }
  if (exitRoomIndex < 0) {
    exitRoomIndex = findRoomIndexForPoint(rooms, data?.exit);
  }

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
  const roomAffinityWalkableByKind = {};
  rooms.forEach((room, index) => {
    const roomWalkable = uniquePositions(roomWalkableByIndex[index] || []);
    if (roomWalkable.length === 0) return;
    const affinities = normalizeRoomAffinityEntries(room);
    if (affinities.length === 0) return;
    affinities.forEach((entry) => {
      const key = entry.kind;
      if (!key) return;
      const current = Array.isArray(roomAffinityWalkableByKind[key]) ? roomAffinityWalkableByKind[key] : [];
      roomAffinityWalkableByKind[key] = current.concat(roomWalkable);
    });
  });
  Object.keys(roomAffinityWalkableByKind).forEach((kind) => {
    roomAffinityWalkableByKind[kind] = uniquePositions(roomAffinityWalkableByKind[kind]);
  });

  return {
    rooms,
    roomWalkableByIndex,
    entryRoomIndex,
    exitRoomIndex,
    entryRoomId: resolveRoomId(entryRoom, entryRoomIndex),
    exitRoomId: resolveRoomId(exitRoom, exitRoomIndex),
    entryRoomWalkable,
    exitRoomWalkable,
    allRoomsWalkable,
    roomAffinityWalkableByKind,
  };
}

const ATTACKER_KEYWORDS = Object.freeze(["attacker", "attack", "attacking", "player", "assault", "intruder", "raider", "runner"]);
const DEFENDER_KEYWORDS = Object.freeze(["defender", "defend", "defending", "stationary", "guard", "patrol", "patrolling", "sentry"]);

function actorTextBag(actor) {
  const values = [];
  if (typeof actor?.id === "string") values.push(actor.id);
  if (Array.isArray(actor?.motivations)) {
    actor.motivations.forEach((entry) => {
      if (typeof entry === "string") values.push(entry);
      if (entry && typeof entry === "object" && typeof entry.kind === "string") values.push(entry.kind);
    });
  }
  if (typeof actor?.motivation === "string") values.push(actor.motivation);
  if (typeof actor?.role === "string") values.push(actor.role);
  return values.join(" ").toLowerCase();
}

function inferActorRole(actor) {
  const bag = actorTextBag(actor);
  if (!bag) return null;
  if (ATTACKER_KEYWORDS.some((token) => bag.includes(token))) return "attacker";
  if (DEFENDER_KEYWORDS.some((token) => bag.includes(token))) return "defender";
  return null;
}

function partitionActorsByRole(actors, { attackerCountHint = 1 } = {}) {
  const sorted = actors.slice().sort(compareActorIdsAsc);
  const explicitAttackers = [];
  const explicitDefenders = [];
  const unknown = [];

  sorted.forEach((actor) => {
    const role = inferActorRole(actor);
    if (role === "attacker") {
      explicitAttackers.push(actor);
      return;
    }
    if (role === "defender") {
      explicitDefenders.push(actor);
      return;
    }
    unknown.push(actor);
  });

  const attackers = explicitAttackers.slice();
  const defenders = explicitDefenders.slice();
  const targetAttackers = Math.min(sorted.length, Math.max(1, normalizePositiveInt(attackerCountHint, 1)));

  while (attackers.length < targetAttackers && unknown.length > 0) {
    attackers.push(unknown.shift());
  }
  while (attackers.length < targetAttackers && defenders.length > 0) {
    attackers.push(defenders.shift());
  }

  const attackerIds = new Set(attackers.map((actor) => actor.id));
  const finalDefenders = sorted.filter((actor) => !attackerIds.has(actor.id));

  if (attackers.length === 0 && sorted.length > 0) {
    attackers.push(sorted[0]);
    return {
      attackers,
      defenders: sorted.slice(1),
    };
  }

  return {
    attackers,
    defenders: finalDefenders,
  };
}

function pickPreferredPosition({ candidateSets = [], used, anchor, preferFarthest = false } = {}) {
  for (const rawSet of candidateSets) {
    const set = uniquePositions(rawSet);
    const available = set.filter((pos) => !used.has(positionKey(pos)));
    if (available.length === 0) continue;
    available.sort((a, b) => {
      const distDelta = manhattanDistance(a, anchor) - manhattanDistance(b, anchor);
      if (distDelta !== 0) return preferFarthest ? -distDelta : distDelta;
      return comparePoints(a, b);
    });
    return available[0];
  }
  return null;
}

function normalizeActorPositions(actors, layout, { attackerCount = 1 } = {}) {
  if (!Array.isArray(actors) || actors.length === 0) {
    return { actors, changed: false };
  }

  const data = layout?.data || layout;
  const walkable = collectWalkablePositions(layout);
  if (!data || walkable.length === 0) {
    throw new Error("configurator inputs could not place actors: no walkable tiles");
  }

  const walkableSet = new Set(walkable.map(positionKey));
  const spawn = data.spawn || layout?.spawn || null;
  const exit = data.exit || layout?.exit || null;
  if (spawn && !walkableSet.has(positionKey(spawn))) {
    throw new Error("configurator inputs could not place actors: spawn not walkable");
  }
  if (exit && !walkableSet.has(positionKey(exit))) {
    throw new Error("configurator inputs could not place actors: exit not walkable");
  }

  const context = deriveRoomPlacementContext({ data, walkable });
  if (!context) {
    return normalizeActorPositionsLegacy(actors, layout);
  }

  const { attackers, defenders } = partitionActorsByRole(actors, { attackerCountHint: attackerCount });
  const used = new Set();
  const assignedById = new Map();
  let changed = false;

  const entryAnchor = (spawn && walkableSet.has(positionKey(spawn)))
    ? { x: spawn.x, y: spawn.y }
    : context.entryRoomWalkable[0];
  const exitAnchor = (exit && walkableSet.has(positionKey(exit)))
    ? { x: exit.x, y: exit.y }
    : context.exitRoomWalkable[0];

  attackers.forEach((actor, index) => {
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
      throw new Error("configurator inputs could not place actors: insufficient entry-room tiles");
    }
    used.add(positionKey(assigned));
    assignedById.set(actor.id, assigned);
  });

  defenders.forEach((actor) => {
    const affinityCandidateSets = collectActorAffinityKinds(actor)
      .map((kind) => context.roomAffinityWalkableByKind?.[kind])
      .filter((set) => Array.isArray(set) && set.length > 0);
    const affinityAnchor = affinityCandidateSets[0]?.[0] || null;
    const assigned = pickPreferredPosition({
      candidateSets: [...affinityCandidateSets, context.exitRoomWalkable, context.allRoomsWalkable],
      used,
      anchor: affinityAnchor || exitAnchor || context.exitRoomWalkable[0] || context.allRoomsWalkable[0] || walkable[0],
    });
    if (!assigned) {
      throw new Error("configurator inputs could not place actors: insufficient room tiles for defenders");
    }
    used.add(positionKey(assigned));
    assignedById.set(actor.id, assigned);
  });

  const normalized = actors.map((actor) => {
    const desired = actor?.position;
    const assigned = assignedById.get(actor.id);
    if (!assigned) {
      throw new Error("configurator inputs could not place actors: unresolved strategic placement");
    }
    if (!desired || desired.x !== assigned.x || desired.y !== assigned.y) {
      changed = true;
    }
    return { ...actor, position: { x: assigned.x, y: assigned.y } };
  });

  return { actors: normalized, changed };
}

export async function orchestrateBuild({ spec, producedBy = "runtime-build", solver, capturedInputs } = {}) {
  if (!spec) {
    throw new Error("orchestrateBuild requires spec");
  }

  const mapped = mapBuildSpecToArtifacts(spec, { producedBy });

  let solverRequest = null;
  let solverResult = null;
  if (solver?.adapter) {
    const solverClock = solver.clock || (() => spec.meta.createdAt);
    solverRequest = {
      schema: SCHEMAS.solverRequest,
      schemaVersion: 1,
      meta: createBuildMeta(spec, producedBy, "solver_request"),
      intentRef: toRef(mapped.intent),
      planRef: toRef(mapped.plan),
      problem: {
        language: "custom",
        data: solver.scenario ?? { planRef: toRef(mapped.plan) },
      },
      options: solver.options || undefined,
    };

    solverResult = await solveWithAdapter(solver.adapter, solverRequest, { clock: solverClock });
    solverResult.schema = solverResult.schema || SCHEMAS.solverResult;
    solverResult.schemaVersion = solverResult.schemaVersion || 1;
    solverResult.requestRef = solverResult.requestRef || toRef(solverRequest);
  }

  const configuratorInputs = mapped.configuratorInputs;
  const levelGenInput = configuratorInputs?.levelGen;
  const actorsInputRaw = configuratorInputs?.actors;
  const hasLevelGen = levelGenInput && typeof levelGenInput === "object" && !Array.isArray(levelGenInput);
  const hasActors = Array.isArray(actorsInputRaw) || (actorsInputRaw && typeof actorsInputRaw === "object");

  let simConfig = null;
  let initialState = null;
  let budgetReceipt = mapped.budget?.receipt || null;
  let spendProposal = null;
  let affinitySummary = null;
  let affinityRules = null;
  let motivationRules = null;

  if (hasLevelGen) {
    if (!hasActors) {
      throw new Error("configurator inputs require actors when levelGen is provided.");
    }

    const layoutResult = generateGridLayoutFromInput(levelGenInput);
    if (!layoutResult.ok) {
      const details = layoutResult.errors.map((err) => `${err.field}:${err.code}`).join(", ");
      throw new Error(`level-gen input invalid: ${details}`);
    }

    const actorsInput = Array.isArray(actorsInputRaw) ? { actors: actorsInputRaw } : actorsInputRaw;
    if (!actorsInput || !Array.isArray(actorsInput.actors)) {
      throw new Error("configurator inputs must include an actors array.");
    }

    const affinityPresets = configuratorInputs?.affinityPresets || null;
    const affinityLoadouts = configuratorInputs?.affinityLoadouts || null;
    affinityRules = normalizeResolvedRulesArtifact({
      artifact: configuratorInputs?.affinityRules || null,
      schema: SCHEMAS.affinityRules,
      normalizeArtifact: normalizeAffinityRulesArtifact,
      resolveDefaultArtifact: () => resolveAffinityRules(),
      label: "affinity rules",
    });
    motivationRules = normalizeResolvedRulesArtifact({
      artifact: configuratorInputs?.motivationRules || null,
      schema: SCHEMAS.motivationRules,
      normalizeArtifact: normalizeMotivationRulesArtifact,
      resolveDefaultArtifact: () => resolveMotivationRules(),
      label: "motivation rules",
    });
    if ((affinityPresets && !affinityLoadouts) || (!affinityPresets && affinityLoadouts)) {
      throw new Error("configurator inputs require both affinityPresets and affinityLoadouts.");
    }
    if (affinityPresets) {
      assertSchema(affinityPresets, SCHEMAS.affinityPreset);
    }
    if (affinityLoadouts) {
      assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
    }
    if (spec?.configurator?.inputs) {
      spec.configurator.inputs.affinityRules = affinityRules;
      spec.configurator.inputs.motivationRules = motivationRules;
    }

    const layout = layoutResult.value;
    const seed = Number.isFinite(levelGenInput.seed) ? levelGenInput.seed : 0;
    augmentLayoutWithRoomAffinityEffects(layout, {
      cardSet: configuratorInputs?.cardSet,
      fallbackAffinity: configuratorInputs?.levelAffinity || DEFAULT_ROOM_CARD_AFFINITY,
      seed,
    });
    const baseVitalsByActorId = Object.fromEntries(
      actorsInput.actors
        .filter((actor) => actor?.id && actor.vitals)
        .map((actor) => [actor.id, actor.vitals]),
    );
    let resolvedEffects = {};
    if (affinityPresets && affinityLoadouts) {
      resolvedEffects = resolveAffinityEffects({
        presets: affinityPresets.presets,
        loadouts: affinityLoadouts.loadouts,
        baseVitalsByActorId,
        rooms: Array.isArray(layout.rooms) ? layout.rooms : [],
        traps: Array.isArray(layout.traps) ? layout.traps : [],
        affinityRules,
      });
    }

    if (!budgetReceipt && mapped.budget?.budget && mapped.budget?.priceList) {
      const spendResult = evaluateConfiguratorSpend({
        budget: mapped.budget.budget,
        priceList: mapped.budget.priceList,
        layout,
        actors: actorsInput.actors,
        motivationRules,
        affinityRules,
        proposalMeta: createBuildMeta(spec, producedBy, "spend_proposal"),
        receiptMeta: createBuildMeta(spec, producedBy, "budget_receipt"),
      });
      spendProposal = spendResult.proposal;
      budgetReceipt = spendResult.receipt;
    }

    const normalizedActors = normalizeActorPositions(actorsInput.actors, layout, {
      attackerCount: configuratorInputs?.attackerCount,
    });
    if (normalizedActors.changed) {
      actorsInput.actors = normalizedActors.actors;
      if (spec?.configurator?.inputs?.actors) {
        spec.configurator.inputs.actors = normalizedActors.actors;
      }
    }

    simConfig = buildSimConfigArtifact({
      meta: createBuildMeta(spec, producedBy, "sim_config"),
      planRef: toRef(mapped.plan),
      budgetReceiptRef: budgetReceipt ? toRef(budgetReceipt) : undefined,
      affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
      motivationRulesRef: motivationRules ? toRef(motivationRules) : undefined,
      seed,
      layout,
    });
    initialState = buildInitialStateArtifact({
      meta: createBuildMeta(spec, producedBy, "initial_state"),
      simConfigRef: toRef(simConfig),
      affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
      motivationRulesRef: motivationRules ? toRef(motivationRules) : undefined,
      actors: actorsInput.actors,
      resolvedEffects,
    });

    if (affinityPresets && affinityLoadouts) {
      const ambientPressure = buildAmbientAffinityPressure({
        rooms: Array.isArray(layout.rooms) ? layout.rooms : [],
        traps: Array.isArray(layout.traps) ? layout.traps : [],
      });
      affinitySummary = {
        schema: SCHEMAS.affinitySummary,
        schemaVersion: 1,
        meta: createBuildMeta(spec, "annotator", "affinity_summary"),
        presetsRef: toRef(affinityPresets),
        loadoutsRef: toRef(affinityLoadouts),
        affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
        simConfigRef: toRef(simConfig),
        initialStateRef: toRef(initialState),
        actors: resolvedEffects.actors || [],
        traps: resolvedEffects.traps || [],
        ambientPressure,
      };
    }
  }

  return {
    spec,
    intent: mapped.intent,
    plan: mapped.plan,
    budget: mapped.budget,
    solverRequest,
    solverResult,
    spendProposal,
    budgetReceipt,
    affinityRules,
    motivationRules,
    affinitySummary,
    simConfig,
    initialState,
    capturedInputs: Array.isArray(capturedInputs) ? capturedInputs : undefined,
  };
}
