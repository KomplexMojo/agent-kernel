import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { mapBuildSpecToArtifacts } from "./map-build-spec.js";
import { solveWithAdapter } from "../ports/solver.js";
// CR.7 / WP-5 — design spend is the Allocator's, taken from its PUBLIC barrel.
import { evaluateConfiguratorSpend } from "../personas/allocator/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { createDefaultResourceBundleArtifact } from "../render/resource-bundle.js";
import {
  DEFAULT_ROOM_CARD_AFFINITY,
  ROOM_AFFINITY_EMIT_PERCENT_PER_STACK,
} from "../contracts/domain-constants.js";
// M9: every value in SCHEMAS below now comes from contracts/artifacts.ts. M8 relocated the
// two rules schemas here; the other five were the tree-wide retype backlog it deferred.
import {
  ACTOR_LOADOUT_SCHEMA,
  AFFINITY_PRESET_SCHEMA,
  AFFINITY_RULES_ARTIFACT_SCHEMA,
  AFFINITY_SUMMARY_SCHEMA,
  MOTIVATION_RULES_ARTIFACT_SCHEMA,
  SOLVER_REQUEST_SCHEMA,
  SOLVER_RESULT_SCHEMA,
} from "../contracts/artifacts.ts";

// CR.7 / WP-5 — the build-geometry helpers this file used to import out of seven Configurator
// internals now come off the persona's PUBLIC surface, which retired seven allowlist rows. The
// local names are unchanged, so every call site below reads exactly as it did.
const configuratorBuild = createConfiguratorPersona({ clock: UNUSED_CLOCK });
const {
  generateGridLayoutFromInput,
  buildSimConfigArtifact,
  buildInitialStateArtifact,
  resolveAffinityEffects,
  normalizeAffinityRulesArtifact,
  resolveAffinityRules,
  buildAmbientAffinityPressure,
  computeInternalManaUpkeep,
  normalizeMotivationRulesArtifact,
  resolveMotivationRules,
} = configuratorBuild;

// CR.9 M3: spend proposals price raw actor motivations, and motivation vocabulary is
// Configurator law. The Allocator no longer owns a copy of it, so this composition
// root hands over the Configurator's own function.
const configuratorMotivations = configuratorBuild.normalizeMotivations;

// WP-5/D10: same pattern for budget maximization. Scaling authored actors to fill an
// unspent budget is Configurator work, so it comes off the Configurator's public
// surface rather than out of `configurator/budget-maximizer.js` directly — the prices
// it scales against are supplied separately, by the Allocator.
const configuratorMaximizeActorBudget = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.maximizeActorBudget;

// AM.2b — what an actor's motivation REQUIRES of its vitals is configuration
// validity, so it comes off the same public surface for the same reason.
const configuratorApplyMotivationVitalRequirements = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.applyMotivationDerivedVitalRequirements;

// AM.5/F14 — and what an actor's AFFINITIES require of its mana, for the same
// reason and at the same point: before anything prices the actor list.
const configuratorApplyAffinityVitalRequirements = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.applyAffinityDerivedVitalRequirements;

// The viability floor, off the same surface for the same reason. Unlike the two above it is
// unconditional: a stationary actor with no affinities still has to survive being hit.
const configuratorApplyViabilityVitalRequirements = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.applyViabilityDerivedVitalRequirements;

const SCHEMAS = Object.freeze({
  solverRequest: SOLVER_REQUEST_SCHEMA,
  solverResult: SOLVER_RESULT_SCHEMA,
  affinityPreset: AFFINITY_PRESET_SCHEMA,
  actorLoadout: ACTOR_LOADOUT_SCHEMA,
  affinityRules: AFFINITY_RULES_ARTIFACT_SCHEMA,
  motivationRules: MOTIVATION_RULES_ARTIFACT_SCHEMA,
  affinitySummary: AFFINITY_SUMMARY_SCHEMA,
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

function mergePriceListWithDefaults(priceList, { meta } = {}) {
  const defaults = createAllocatorPersona({ priceListMeta: meta, clock: UNUSED_CLOCK }).pricing.priceList();
  if (!priceList) return defaults;
  const itemsByKey = new Map();
  defaults.items.forEach((item) => {
    itemsByKey.set(`${item.kind}:${item.id}`, item);
  });
  if (Array.isArray(priceList.items)) {
    priceList.items.forEach((item) => {
      if (typeof item?.id === "string" && typeof item?.kind === "string") {
        itemsByKey.set(`${item.kind}:${item.id}`, item);
      } else if (typeof item?.key === "string") {
        itemsByKey.set(`legacy:${item.key}`, item);
      }
    });
  }
  return {
    ...defaults,
    ...priceList,
    meta: priceList.meta || defaults.meta,
    items: Array.from(itemsByKey.values()),
  };
}

function formatBudgetReceiptDenial(receipt) {
  const parts = [
    `status=${receipt?.status}`,
    `remaining=${receipt?.remaining}`,
  ];
  const allDeniedItems = Array.isArray(receipt?.lineItems)
    ? receipt.lineItems.filter((item) => item?.status !== "approved")
    : [];
  const deniedLines = allDeniedItems
    .slice(0, 5)
    .map((item) => `${item.kind}:${item.id}${item.category ? `:${item.category}` : ""}`);
  if (deniedLines.length > 0) {
    // SM2: the 5-item cap kept the message from growing unbounded, but never said it was capping
    // -- a silent truncation on a message this session read closely three times without anyone
    // noticing the missing "+N more".
    const omitted = allDeniedItems.length - deniedLines.length;
    parts.push(`deniedLines=${deniedLines.join(",")}${omitted > 0 ? ` (+${omitted} more)` : ""}`);
  }
  const deniedPools = Array.isArray(receipt?.poolStatuses)
    ? receipt.poolStatuses
      .filter((pool) => pool?.status !== "approved")
      .map((pool) => `${pool.id}:${pool.spentTokens}/${pool.capTokens}`)
    : [];
  if (deniedPools.length > 0) {
    parts.push(`deniedPools=${deniedPools.join(",")}`);
  }
  return `Budget receipt denied: ${parts.join("; ")}`;
}

function resolveActorPoolRemaining(receipt) {
  if (!Array.isArray(receipt?.poolStatuses)) return null;
  const actorPools = receipt.poolStatuses.filter((pool) => pool?.id === "delver" || pool?.id === "wardens");
  if (actorPools.length === 0) return null;
  return actorPools.reduce((sum, pool) => {
    const remaining = Number.isFinite(pool?.remainingTokens) ? pool.remainingTokens : 0;
    return sum + Math.max(0, remaining);
  }, 0);
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
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const blockingHazards = new Set(
    hazards
      .filter((hazard) => hazard && hazard.blocking === true)
      .map((hazard) => `${hazard.x},${hazard.y}`),
  );

  if (Array.isArray(data.kinds)) {
    for (let y = 0; y < data.kinds.length; y += 1) {
      const row = data.kinds[y] || [];
      for (let x = 0; x < row.length; x += 1) {
        const kind = row[x];
        if (kind === 1) continue;
        if (kind === 2 && blockingHazards.has(`${x},${y}`)) continue;
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

function collectReservedPlacementKeys(layout, {
  includeSpawnExit = true,
  includeHazards = true,
  includeResources = true,
} = {}) {
  const data = layout?.data || layout || {};
  const reserved = new Set();
  const addPoint = (point) => {
    const normalized = normalizePoint(point);
    if (normalized) reserved.add(positionKey(normalized));
  };

  if (includeSpawnExit) {
    addPoint(data.spawn || layout?.spawn);
    addPoint(data.exit || layout?.exit);
  }
  if (includeHazards && Array.isArray(data.hazards)) {
    data.hazards.forEach(addPoint);
  }
  if (includeResources && Array.isArray(data.resources)) {
    data.resources.forEach(addPoint);
  }
  return reserved;
}

function assignPositionedLayoutObjects({ layout, objects = [], kind, occupied = new Set() } = {}) {
  if (!layout || !Array.isArray(objects) || objects.length === 0) return [];
  const walkable = collectWalkablePositions(layout);
  const walkableSet = new Set(walkable.map(positionKey));
  const candidates = walkable
    .filter((pos) => !occupied.has(positionKey(pos)))
    .sort(comparePoints);
  let cursor = 0;

  return objects.map((object, index) => {
    const explicit = normalizePoint(object);
    let assigned = explicit && walkableSet.has(positionKey(explicit)) && !occupied.has(positionKey(explicit))
      ? explicit
      : null;
    while (!assigned && cursor < candidates.length) {
      const candidate = candidates[cursor];
      cursor += 1;
      if (!occupied.has(positionKey(candidate))) {
        assigned = candidate;
      }
    }
    if (!assigned) {
      // M4: the refusal used to say only "insufficient" with no numbers -- every one of the
      // benchmark's spatial-placement failures turned out to be the model requesting too small a
      // floorTile.count for its own room/object count, not this placer missing a valid
      // arrangement (verified by replaying the recorded requests with only floorTile.count
      // raised: the exact same objects then place cleanly). Reporting the actual deficit makes
      // that diagnosable from the error alone instead of requiring a replay to discover it.
      throw new Error(
        `configurator inputs could not place ${kind}: insufficient unoccupied walkable tiles `
        + `(${candidates.length} available, ${objects.length} requested, ${index} placed before `
        + `running out — raise floorTile.count).`,
      );
    }
    occupied.add(positionKey(assigned));
    const id = typeof object?.id === "string" && object.id.trim()
      ? object.id.trim()
      : `${kind}_${index + 1}`;
    return {
      ...object,
      id,
      position: { x: assigned.x, y: assigned.y },
      x: assigned.x,
      y: assigned.y,
    };
  });
}

function placeLayoutObjects({ layout, hazards = [], resources = [] } = {}) {
  if (!layout) return;
  const occupied = collectReservedPlacementKeys(layout, {
    includeSpawnExit: true,
    includeHazards: true,
    includeResources: false,
  });
  const placedHazards = assignPositionedLayoutObjects({
    layout,
    objects: hazards,
    kind: "hazard",
    occupied,
  });
  const placedResources = assignPositionedLayoutObjects({
    layout,
    objects: resources,
    kind: "resource",
    occupied,
  });
  if (placedHazards.length > 0) {
    const existingHazards = Array.isArray(layout.hazards) ? layout.hazards : [];
    layout.hazards = [...existingHazards, ...placedHazards];
  }
  if (placedResources.length > 0) layout.resources = placedResources;
}

function normalizeActorPositionsLegacy(actors, layout) {
  if (!Array.isArray(actors) || actors.length === 0) {
    return { actors, changed: false };
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
  const spawn = data.spawn || layout?.spawn || null;
  const spawnKey = spawn ? positionKey(spawn) : null;
  if (spawnKey && !walkableSet.has(spawnKey)) {
    throw new Error(`configurator inputs could not place actors: spawn (${spawn.x}, ${spawn.y}) not walkable.`);
  }

  const groups = createActorGroups(actors, { supportPerLeader: 3 });
  const anchors = selectGroupAnchors({
    walkable,
    groupCount: groups.length,
    spawn: spawnKey && spawn ? { x: spawn.x, y: spawn.y } : null,
  });
  if (anchors.length === 0) {
    throw new Error(
      `configurator inputs could not place actors: no anchor points `
      + `(${groups.length} group${groups.length === 1 ? "" : "s"}, ${walkable.length} walkable tiles).`,
    );
  }

  const used = new Set();
  collectReservedPlacementKeys(layout).forEach((key) => used.add(key));
  let changed = false;
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
      const key = positionKey(assigned);
      used.add(key);
      assignedById.set(entry.actor.id, { x: assigned.x, y: assigned.y });
    });
  });

  if (spawn && !used.has(positionKey(spawn))) {
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
      throw new Error(`configurator inputs could not place actors: unresolved group placement for actor "${actor.id}".`);
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

function normalizeNonNegativeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : fallback;
}

function normalizeRoomAffinityEntries(room, hazards, { fallbackAffinity = "" } = {}) {
  const byKind = new Map();
  const roomHazards = Array.isArray(hazards)
    ? hazards.filter((hazard) => hazard && roomContainsPoint(room, { x: hazard.x, y: hazard.y }))
    : [];

  roomHazards.forEach((hazard) => {
    const affinity = hazard?.affinity;
    if (!affinity) return;
    const kind = normalizeAffinityKind(affinity.kind);
    if (!kind) return;
    const stacks = normalizePositiveInt(affinity.stacks, 0);
    if (stacks <= 0) return;
    const expression = typeof affinity.expression === "string" ? affinity.expression.trim().toLowerCase() : "";
    const current = byKind.get(kind) || { kind, emitStacks: 0, maxStacks: 0 };
    if (expression === "emit") {
      current.emitStacks = Math.max(current.emitStacks, stacks);
    }
    current.maxStacks = Math.max(current.maxStacks, stacks);
    byKind.set(kind, current);
  });

  if (byKind.size === 0 && fallbackAffinity) {
    const fallbackKind = normalizeAffinityKind(fallbackAffinity);
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

function buildMixedRoomTemplateMap(affinityRules) {
  const templates = affinityRules?.worldActorCostModel?.mixedRoomAssembly?.templates;
  if (!Array.isArray(templates) || templates.length === 0) {
    return new Map();
  }
  const map = new Map();
  templates.forEach((template) => {
    const id = typeof template?.id === "string" ? template.id.trim() : "";
    if (!id) return;
    map.set(id, template);
  });
  return map;
}

function buildMixedRoomProfilesFromCardSet(cardSet, templateMap) {
  if (!Array.isArray(cardSet) || cardSet.length === 0 || !(templateMap instanceof Map) || templateMap.size === 0) {
    return [];
  }
  const profiles = [];
  cardSet.forEach((card) => {
    const type = typeof card?.type === "string" ? card.type.trim().toLowerCase() : "";
    const source = typeof card?.source === "string" ? card.source.trim().toLowerCase() : "";
    if (type !== "room" && source !== "room") return;
    const templateId = typeof card?.id === "string" ? card.id.trim() : "";
    if (!templateId) return;
    const template = templateMap.get(templateId);
    if (!template) return;
    const count = Math.max(1, normalizePositiveInt(card?.count, 1));
    for (let i = 0; i < count; i += 1) {
      profiles.push({
        templateId,
        templateInstanceId: `${templateId}-${i + 1}`,
        template,
      });
    }
  });
  return profiles;
}

function normalizeMixedRoomOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") return undefined;
  const kind = normalizeAffinityKind(overlay.kind);
  if (!kind) return undefined;
  return {
    kind,
    expression: typeof overlay.expression === "string" && overlay.expression.trim()
      ? overlay.expression.trim().toLowerCase()
      : "emit",
    stacks: Math.max(1, normalizePositiveInt(overlay.stacks, 1)),
    tokenCost: normalizeNonNegativeInt(overlay.tokenCost, 0),
  };
}

function normalizeMixedRoomLocalizedTiles(localizedTiles, defaultTileTokenCost) {
  if (!Array.isArray(localizedTiles)) return [];
  return localizedTiles
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      x: normalizeNonNegativeInt(entry.x, 0),
      y: normalizeNonNegativeInt(entry.y, 0),
      kind: typeof entry.kind === "string" && entry.kind.trim()
        ? entry.kind.trim().toLowerCase()
        : "floor",
      tokenCost: normalizeNonNegativeInt(entry.tokenCost, defaultTileTokenCost),
    }));
}

function normalizeMixedRoomLocalizedHazards(localizedHazards) {
  if (!Array.isArray(localizedHazards)) return [];
  return localizedHazards
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const affinityKind = normalizeAffinityKind(entry?.affinity?.kind);
      if (!affinityKind) return null;
      const stacks = Math.max(1, normalizePositiveInt(entry?.affinity?.stacks, 1));
      return {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `hazard_${index + 1}`,
        x: normalizeNonNegativeInt(entry.x, 0),
        y: normalizeNonNegativeInt(entry.y, 0),
        blocking: entry.blocking === true,
        tokenCost: normalizeNonNegativeInt(entry.tokenCost, 0),
        affinity: {
          kind: affinityKind,
          expression: typeof entry?.affinity?.expression === "string" && entry.affinity.expression.trim()
            ? entry.affinity.expression.trim().toLowerCase()
            : "emit",
          stacks,
        },
        manaReserve: normalizeNonNegativeInt(entry.manaReserve, ROOM_AFFINITY_EMIT_PERCENT_PER_STACK * stacks),
        manaRegen: normalizeNonNegativeInt(entry.manaRegen, 0),
      };
    })
    .filter(Boolean);
}

function deriveMixedRoomCompositionProfile({ roomWideOverlay, localizedTiles, localizedHazards }) {
  if (roomWideOverlay && localizedHazards.length > 0) {
    return "room_overlay_dominant_with_localized_variation";
  }
  if (roomWideOverlay) {
    return "room_overlay_dominant";
  }
  if (localizedHazards.length > 0) {
    return "neutral_with_localized_hazards";
  }
  if (localizedTiles.length > 0) {
    return "mixed_composition";
  }
  return "mixed_composition";
}

function deriveMixedRoomDominantInvestment({ roomWideOverlay, localizedTiles, localizedHazards, tokenSpend }) {
  if (roomWideOverlay && localizedHazards.length > 0) {
    return "room_wide_overlay";
  }
  if (roomWideOverlay) {
    return "room_wide_overlay";
  }
  if (localizedHazards.length > 0) {
    return "localized_hazards";
  }
  if (localizedTiles.length > 0) {
    return "localized_tiles";
  }
  if (tokenSpend.defaultTiles > 0) {
    return "default_tiles";
  }
  return "none";
}

function buildMixedRoomComposition({ room, templateId, templateInstanceId, template }) {
  const roomWidth = Math.max(1, normalizePositiveInt(room?.width, normalizePositiveInt(template?.width, 1)));
  const roomHeight = Math.max(1, normalizePositiveInt(room?.height, normalizePositiveInt(template?.height, 1)));
  const defaultTileTokenCost = Math.max(1, normalizePositiveInt(template?.defaultTileTokenCost, 1));
  const roomWideOverlay = normalizeMixedRoomOverlay(template?.roomWideOverlay);
  const localizedTiles = normalizeMixedRoomLocalizedTiles(template?.localizedTiles, defaultTileTokenCost);
  const localizedHazards = normalizeMixedRoomLocalizedHazards(template?.localizedHazards);
  const tokenSpend = {
    defaultTiles: roomWidth * roomHeight * defaultTileTokenCost,
    localizedTiles: localizedTiles.reduce((sum, tile) => sum + normalizeNonNegativeInt(tile?.tokenCost, 0), 0),
    roomWideOverlay: roomWideOverlay ? normalizeNonNegativeInt(roomWideOverlay.tokenCost, 0) : 0,
    localizedHazards: localizedHazards.reduce((sum, hazard) => sum + normalizeNonNegativeInt(hazard?.tokenCost, 0), 0),
    total: 0,
  };
  tokenSpend.total = (
    tokenSpend.defaultTiles
    + tokenSpend.localizedTiles
    + tokenSpend.roomWideOverlay
    + tokenSpend.localizedHazards
  );
  const compositionProfile = deriveMixedRoomCompositionProfile({
    roomWideOverlay,
    localizedTiles,
    localizedHazards,
  });
  const dominantInvestment = deriveMixedRoomDominantInvestment({
    roomWideOverlay,
    localizedTiles,
    localizedHazards,
    tokenSpend,
  });
  return {
    templateId,
    templateInstanceId,
    compositionProfile,
    dominantInvestment,
    defaultTileTokenCost,
    localizedTiles,
    roomWideOverlay,
    localizedHazards,
    tokenSpend,
  };
}

function collectMixedRoomTemplateHazards({
  room,
  roomIndex,
  templateId,
  templateInstanceId,
  composition,
  occupied,
  spawnKey,
  exitKey,
}) {
  const localizedHazards = Array.isArray(composition?.localizedHazards) ? composition.localizedHazards : [];
  const roomId = resolveRoomId(room, roomIndex);
  const generated = [];
  localizedHazards.forEach((hazard) => {
    const x = room.x + hazard.x;
    const y = room.y + hazard.y;
    const point = { x, y };
    if (!roomContainsPoint(room, point)) return;
    const key = `${x},${y}`;
    if (key === spawnKey || key === exitKey || occupied.has(key)) return;
    const reserve = normalizeNonNegativeInt(hazard.manaReserve, 0);
    generated.push({
      id: hazard.id,
      x,
      y,
      blocking: hazard.blocking === true,
      source: "mixed_room_template",
      roomId,
      templateId,
      templateInstanceId,
      affinity: {
        kind: hazard.affinity.kind,
        expression: hazard.affinity.expression,
        stacks: hazard.affinity.stacks,
        targetType: "floor",
      },
      vitals: {
        mana: {
          current: reserve,
          max: reserve,
          regen: normalizeNonNegativeInt(hazard.manaRegen, 0),
        },
      },
    });
    occupied.add(key);
  });
  return generated;
}

function buildCardAffinityProfiles(cardSet) {
  if (!Array.isArray(cardSet) || cardSet.length === 0) return [];
  const profiles = [];
  cardSet.forEach((card) => {
    const type = typeof card?.type === "string" ? card.type.trim().toLowerCase() : "";
    const source = typeof card?.source === "string" ? card.source.trim().toLowerCase() : "";
    if (type !== "room" && source !== "room") return;
    const affinities = Array.isArray(card?.affinities) ? card.affinities : [];
    const emitAffinities = affinities
      .map((a) => {
        const kind = normalizeAffinityKind(a?.kind);
        if (!kind) return null;
        const expression = typeof a?.expression === "string" ? a.expression.trim().toLowerCase() : "";
        if (expression !== "emit") return null;
        return { kind, stacks: Math.max(1, normalizePositiveInt(a.stacks, 1)) };
      })
      .filter(Boolean);
    if (emitAffinities.length === 0) return;
    const count = Math.max(1, normalizePositiveInt(card?.count, 1));
    const templateId = typeof card?.id === "string" && card.id.trim() ? card.id.trim() : `card_room_${profiles.length + 1}`;
    for (let i = 0; i < count; i += 1) {
      profiles.push({ templateId, templateInstanceId: `${templateId}-${i + 1}`, emitAffinities });
    }
  });
  return profiles;
}

function augmentLayoutWithRoomAffinityEffects(
  layout,
  {
    cardSet,
    fallbackAffinity = "",
    seed = 0,
    affinityRules = null,
  } = {},
) {
  if (!layout || !Array.isArray(layout.rooms) || layout.rooms.length === 0) {
    return { layout, generatedHazardCount: 0 };
  }

  const templateMap = buildMixedRoomTemplateMap(affinityRules || resolveAffinityRules());
  let profiles = templateMap.size > 0 ? buildMixedRoomProfilesFromCardSet(cardSet, templateMap) : [];
  const useCardAffinityFallback = profiles.length === 0;
  if (useCardAffinityFallback) {
    profiles = buildCardAffinityProfiles(cardSet);
  }
  if (profiles.length === 0) {
    return { layout, generatedHazardCount: 0 };
  }

  const normalizedSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const assignmentRng = createRng((normalizedSeed ^ ROOM_AFFINITY_ASSIGNMENT_SEED_XOR) >>> 0);
  const roomOrder = shuffleWithRng(layout.rooms.map((_, index) => index), assignmentRng);
  const nextRooms = layout.rooms.map((room) => ({ ...room }));

  // Room affinity metadata removed - hazards carry affinity configuration

  const existingHazards = Array.isArray(layout.hazards) ? layout.hazards.map((hazard) => ({ ...hazard })) : [];
  const occupied = new Set(
    existingHazards
      .filter((hazard) => Number.isFinite(hazard?.x) && Number.isFinite(hazard?.y))
      .map((hazard) => `${hazard.x},${hazard.y}`),
  );
  const spawnKey = Number.isFinite(layout?.spawn?.x) && Number.isFinite(layout?.spawn?.y)
    ? `${layout.spawn.x},${layout.spawn.y}`
    : "";
  const exitKey = Number.isFinite(layout?.exit?.x) && Number.isFinite(layout?.exit?.y)
    ? `${layout.exit.x},${layout.exit.y}`
    : "";
  const generatedHazards = [];

  const fallbackAffinityKind = normalizeAffinityKind(fallbackAffinity);

  roomOrder.forEach((roomIndex, orderIndex) => {
    const profile = profiles[orderIndex % profiles.length];
    if (!profile) return;
    const room = nextRooms[roomIndex];

    if (useCardAffinityFallback) {
      const emitAffinities = Array.isArray(profile.emitAffinities) ? profile.emitAffinities : [];
      const nextRoom = {
        ...room,
        templateId: profile.templateId,
        templateInstanceId: profile.templateInstanceId,
      };
      nextRooms[roomIndex] = nextRoom;
      const roomId = resolveRoomId(room, roomIndex);
      emitAffinities.forEach(({ kind, stacks }) => {
        const candidates = [];
        for (let dy = 0; dy < nextRoom.height; dy += 1) {
          for (let dx = 0; dx < nextRoom.width; dx += 1) {
            const tx = nextRoom.x + dx;
            const ty = nextRoom.y + dy;
            const key = `${tx},${ty}`;
            if (key === spawnKey || key === exitKey || occupied.has(key)) continue;
            candidates.push({ x: tx, y: ty });
          }
        }
        if (candidates.length === 0) return;
        const chosen = candidates[Math.floor(assignmentRng() * candidates.length)];

        // Compute hazard vitals using cost model formulas
        // emit upkeep = 2 + stacks
        const upkeep = computeInternalManaUpkeep(stacks);
        const manaPool = upkeep * 3; // 3 ticks worth
        const manaRegen = upkeep; // Sustain indefinitely
        const durability = stacks * 5; // Structural integrity

        generatedHazards.push({
          id: `${kind}_emit_${roomIndex}`,
          x: chosen.x,
          y: chosen.y,
          blocking: false,
          source: "room_affinity_tile",
          roomId,
          affinity: { kind, expression: "emit", stacks, targetType: "floor" },
          vitals: {
            mana: { current: manaPool, max: manaPool, regen: manaRegen },
            durability: { current: durability, max: durability, regen: 0 },
          },
        });
        occupied.add(`${chosen.x},${chosen.y}`);
      });
      return;
    }

    const composition = buildMixedRoomComposition({
      room,
      templateId: profile.templateId,
      templateInstanceId: profile.templateInstanceId,
      template: profile.template,
    });
    const nextRoom = {
      ...room,
      templateId: profile.templateId,
      templateInstanceId: profile.templateInstanceId,
      mixedRoomComposition: composition,
    };

    nextRooms[roomIndex] = nextRoom;
    generatedHazards.push(...collectMixedRoomTemplateHazards({
      room: nextRoom,
      roomIndex,
      templateId: profile.templateId,
      templateInstanceId: profile.templateInstanceId,
      composition,
      occupied,
      spawnKey,
      exitKey,
    }));
  });

  layout.rooms = nextRooms;
  if (generatedHazards.length > 0 || existingHazards.length > 0) {
    layout.hazards = [...existingHazards, ...generatedHazards];
  }

  return {
    layout,
    generatedHazardCount: generatedHazards.length,
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
  const hazards = Array.isArray(data?.hazards) ? data.hazards : [];
  const roomAffinityWalkableByKind = {};
  rooms.forEach((room, index) => {
    const roomWalkable = uniquePositions(roomWalkableByIndex[index] || []);
    if (roomWalkable.length === 0) return;
    const affinities = normalizeRoomAffinityEntries(room, hazards);
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

const DELVER_KEYWORDS = Object.freeze(["delver", "attack", "attacking", "player", "assault", "intruder", "raider", "runner"]);
const WARDEN_KEYWORDS = Object.freeze(["warden", "defend", "defending", "stationary", "guard", "patrol", "patrolling", "sentry"]);

function actorTextBag(actor) {
  const values = [];
  if (typeof actor?.id === "string") values.push(actor.id);
  if (typeof actor?.archetype === "string") values.push(actor.archetype);
  if (typeof actor?.actorType === "string") values.push(actor.actorType);
  if (typeof actor?.type === "string") values.push(actor.type);
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
  if (DELVER_KEYWORDS.some((token) => bag.includes(token))) return "delver";
  if (WARDEN_KEYWORDS.some((token) => bag.includes(token))) return "warden";
  return null;
}

function partitionActorsByRole(actors, { delverCountHint = 1 } = {}) {
  const sorted = actors.slice().sort(compareActorIdsAsc);
  const explicitDelvers = [];
  const explicitWardens = [];
  const unknown = [];

  sorted.forEach((actor) => {
    const role = inferActorRole(actor);
    if (role === "delver") {
      explicitDelvers.push(actor);
      return;
    }
    if (role === "warden") {
      explicitWardens.push(actor);
      return;
    }
    unknown.push(actor);
  });

  const delvers = explicitDelvers.slice();
  const wardens = explicitWardens.slice();
  const targetDelvers = Math.min(sorted.length, Math.max(1, normalizePositiveInt(delverCountHint, 1)));

  while (delvers.length < targetDelvers && unknown.length > 0) {
    delvers.push(unknown.shift());
  }
  while (delvers.length < targetDelvers && wardens.length > 0) {
    delvers.push(wardens.shift());
  }

  const delverIds = new Set(delvers.map((actor) => actor.id));
  const finalWardens = sorted.filter((actor) => !delverIds.has(actor.id));

  if (delvers.length === 0 && sorted.length > 0) {
    delvers.push(sorted[0]);
    return {
      delvers,
      wardens: sorted.slice(1),
    };
  }

  return {
    delvers,
    wardens: finalWardens,
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

function normalizeActorPositions(actors, layout, { delverCount = 1 } = {}) {
  if (!Array.isArray(actors) || actors.length === 0) {
    return { actors, changed: false };
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
  const spawn = data.spawn || layout?.spawn || null;
  const exit = data.exit || layout?.exit || null;
  if (spawn && !walkableSet.has(positionKey(spawn))) {
    throw new Error(`configurator inputs could not place actors: spawn (${spawn.x}, ${spawn.y}) not walkable.`);
  }
  if (exit && !walkableSet.has(positionKey(exit))) {
    throw new Error(`configurator inputs could not place actors: exit (${exit.x}, ${exit.y}) not walkable.`);
  }

  const context = deriveRoomPlacementContext({ data, walkable });
  if (!context) {
    return normalizeActorPositionsLegacy(actors, layout);
  }

  const { delvers, wardens } = partitionActorsByRole(actors, { delverCountHint: delverCount });
  const used = new Set();
  collectReservedPlacementKeys(layout).forEach((key) => used.add(key));
  const assignedById = new Map();
  let changed = false;

  const entryAnchor = (spawn && walkableSet.has(positionKey(spawn)))
    ? { x: spawn.x, y: spawn.y }
    : context.entryRoomWalkable[0];
  const exitAnchor = (exit && walkableSet.has(positionKey(exit)))
    ? { x: exit.x, y: exit.y }
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

  wardens.forEach((actor) => {
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
      throw new Error(
        `configurator inputs could not place actors: insufficient room tiles for warden "${actor.id}" `
        + `(${context.allRoomsWalkable.length} room tiles total, ${used.size} already occupied).`,
      );
    }
    used.add(positionKey(assigned));
    assignedById.set(actor.id, assigned);
  });

  const normalized = actors.map((actor) => {
    const desired = actor?.position;
    const assigned = assignedById.get(actor.id);
    if (!assigned) {
      throw new Error(`configurator inputs could not place actors: unresolved strategic placement for actor "${actor.id}".`);
    }
    if (!desired || desired.x !== assigned.x || desired.y !== assigned.y) {
      changed = true;
    }
    return { ...actor, position: { x: assigned.x, y: assigned.y } };
  });

  return { actors: normalized, changed };
}

export async function orchestrateBuild({
  spec,
  producedBy = "runtime-build",
  solver,
  capturedInputs,
  // CR.3: `{intent, plan}` from the Director round that produced this spec, when
  // the caller ran one. Without it map-build-spec reconstructs a plan from the
  // finished spec, which is a lineage derived from the product rather than the
  // cause. Callers that never ran a Director (sandbox bridge, fixture-driven
  // tests) legitimately omit it.
  directorRound,
} = {}) {
  if (!spec) {
    throw new Error("orchestrateBuild requires spec");
  }

  const mapped = mapBuildSpecToArtifacts(spec, { producedBy, directorRound });

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
  // PX.6: the actors the build actually resolved (budget-maximized, then position-
  // normalized). Function-scoped because `actorsInput` is block-scoped inside the layout
  // branch, and this is published as build OUTPUT at the end rather than written back over
  // the Configurator's locked inputs.
  let resolvedActors = null;
  let resourceBundle = null;
  let resolvedPriceList = null;
  let budgetAllocation = null;

  if (hasLevelGen) {
    if (!hasActors) {
      const receivedKind = actorsInputRaw === undefined
        ? "undefined"
        : actorsInputRaw === null ? "null" : typeof actorsInputRaw;
      throw new Error(
        `configurator inputs require actors when levelGen is provided (received ${receivedKind}, `
        + `expected an array or object).`,
      );
    }

    const authoredHazards = Array.isArray(levelGenInput.hazards) ? levelGenInput.hazards : [];
    const positionedHazards = authoredHazards.filter(
      (hazard) => Number.isFinite(hazard?.x) && Number.isFinite(hazard?.y),
    );
    const unpositionedHazards = authoredHazards.filter(
      (hazard) => !Number.isFinite(hazard?.x) || !Number.isFinite(hazard?.y),
    );
    const layoutResult = generateGridLayoutFromInput({
      ...levelGenInput,
      hazards: positionedHazards,
    });
    if (!layoutResult.ok) {
      // M4: every recorded floor_tile_budget_insufficient failure turned out to be the model
      // requesting a floorTile.count far below what its own declared room count needs -- the
      // carving algorithm itself scales cleanly (verified up to 500 tiles across 9 rooms).
      // level-layout.js already computes the exact deficit in err.detail; it was being discarded
      // here rather than surfaced, which is what made the failure look uninvestigable instead of
      // reporting a concrete number to raise floorTile.count to.
      const details = layoutResult.errors.map((err) => {
        const detail = err.detail && typeof err.detail === "object"
          ? ` (requested ${err.detail.target}, need at least ${err.detail.required} for `
            + `${err.detail.roomCount} room${err.detail.roomCount === 1 ? "" : "s"})`
          : "";
        return `${err.field}:${err.code}${detail}`;
      }).join(", ");
      throw new Error(`level-gen input invalid: ${details}`);
    }

    const actorsInput = Array.isArray(actorsInputRaw) ? { actors: actorsInputRaw } : actorsInputRaw;
    if (!actorsInput || !Array.isArray(actorsInput.actors)) {
      const receivedKind = actorsInput?.actors === undefined ? "undefined" : typeof actorsInput.actors;
      throw new Error(`configurator inputs must include an actors array (received ${receivedKind}).`);
    }

    // AM.2b — raise each actor's vitals to what its motivation requires BEFORE
    // anything prices them.
    //
    // An actor whose motivation implies movement needs a stamina POOL, not just
    // stamina regen: core clamps regen to max, so the {0,0,0} default made every
    // move it ever proposed fail InsufficientStamina (F12). Applying the floor
    // here rather than after the build is what keeps the Allocator whole — the
    // spend proposal below is built from `actorsInput.actors`, so the stamina
    // appears as priced line items instead of a vital the actor was handed for
    // free. An unpriced grant is exactly the silent fallback the charter forbids.
    // COPY, never mutate in place. `actorsInput.actors` may be the Configurator's
    // LOCKED input — deep-frozen, and recorded as this build's causal input. An
    // earlier draft of this called the two helpers on the actors directly and
    // `build-locked-input-immutability.test.js` caught it twice over: a
    // TypeError on the frozen vital, and the byte-identity check that exists
    // precisely because affinityRules/motivationRules/actors used to be written
    // back over the locked artifact after the Configurator's round had closed.
    actorsInput.actors = actorsInput.actors.map((actor) => {
      const draft = {
        ...actor,
        vitals: actor?.vitals
          ? Object.fromEntries(
            Object.entries(actor.vitals).map(([key, vital]) => [key, { ...vital }]),
          )
          : actor?.vitals,
      };
      configuratorApplyMotivationVitalRequirements(draft);
      configuratorApplyAffinityVitalRequirements(draft);
      configuratorApplyViabilityVitalRequirements(draft);
      return draft;
    });

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
      const missing = affinityPresets ? "affinityLoadouts" : "affinityPresets";
      throw new Error(`configurator inputs require both affinityPresets and affinityLoadouts (missing ${missing}).`);
    }
    if (affinityPresets) {
      assertSchema(affinityPresets, SCHEMAS.affinityPreset);
    }
    if (affinityLoadouts) {
      assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
    }
    // PX.6: these used to be written INTO spec.configurator.inputs — the artifact recorded
    // as the build's causal input — after the Configurator's round had closed. Both are
    // already returned as top-level build results, and both are now republished on the spec
    // under `configurator.resolved` instead. See the publish site near the return.

    const layout = layoutResult.value;
    if (levelGenInput?.budgetScaffold === true) {
      layout.budgetScaffold = true;
    }
    const seed = Number.isFinite(levelGenInput.seed) ? levelGenInput.seed : 0;
    augmentLayoutWithRoomAffinityEffects(layout, {
      cardSet: configuratorInputs?.cardSet,
      fallbackAffinity: configuratorInputs?.levelAffinity || DEFAULT_ROOM_CARD_AFFINITY,
      seed,
    });
    placeLayoutObjects({
      layout,
      hazards: unpositionedHazards,
      resources: Array.isArray(configuratorInputs?.resources) ? configuratorInputs.resources : [],
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
        hazards: Array.isArray(layout.hazards) ? layout.hazards : [],
        affinityRules,
      });
    }

    resolvedPriceList = mapped.budget?.budget
      ? mergePriceListWithDefaults(mapped.budget?.priceList, {
        meta: createBuildMeta(spec, producedBy, "default_price_list"),
      })
      : null;
    if (mapped.budget?.budget && resolvedPriceList) {
      // CR.7 / WP-5 — asked of the Allocator's public surface rather than by importing
      // `budget-allocation.js`. `allocateBudget` IS `buildBudgetAllocation`, wrapped only to
      // default an absent `priceList` from the persona's own — and this call site supplies one
      // explicitly, so the wrapper is a no-op here and the allocation is byte-identical.
      // Constructed inline with `UNUSED_CLOCK` because that is this file's existing idiom for
      // asking the Allocator a stateless question (see `scenarioSpendReport` below).
      const allocationResult = createAllocatorPersona({ clock: UNUSED_CLOCK }).allocateBudget({
        budget: mapped.budget.budget,
        priceList: resolvedPriceList,
        meta: createBuildMeta(spec, producedBy, "budget_allocation"),
        poolWeights: spec.intent?.hints?.poolWeights,
      });
      if (!allocationResult.ok) {
        const details = allocationResult.errors.map((entry) => `${entry.field || "poolWeights"}:${entry.code}`).join(", ");
        throw new Error(`Budget allocation invalid: ${details}`);
      }
      budgetAllocation = allocationResult.allocation;
    }

    const configuratorResources = Array.isArray(configuratorInputs?.resources) ? configuratorInputs.resources : [];

    if (configuratorInputs?.maximizeBudget && !budgetReceipt && mapped.budget?.budget && resolvedPriceList) {
      const probeResult = evaluateConfiguratorSpend({
        budget: mapped.budget.budget,
        priceList: resolvedPriceList,
        allocation: budgetAllocation,
        layout,
        actors: actorsInput.actors,
        resources: configuratorResources,
        proposalMeta: createBuildMeta(spec, producedBy, "spend_proposal_probe"),
        receiptMeta: createBuildMeta(spec, producedBy, "budget_receipt_probe"),
        normalizeMotivations: configuratorMotivations,
      });
      const probeRemaining = probeResult.receipt?.remaining ?? 0;
      const actorPoolRemaining = resolveActorPoolRemaining(probeResult.receipt);
      const maximizeRemaining = actorPoolRemaining === null
        ? probeRemaining
        : Math.min(probeRemaining, actorPoolRemaining);
      if (maximizeRemaining > 0) {
        // The prices are the Allocator's, read off its published surface against
        // the very price list this build resolved — not derived here, and not
        // derived inside the Configurator from the Allocator's own tools.
        const { pricing } = createAllocatorPersona({
          priceList: resolvedPriceList,
          clock: UNUSED_CLOCK,
        });
        actorsInput.actors = configuratorMaximizeActorBudget({
          actors: actorsInput.actors,
          remaining: maximizeRemaining,
          unitCosts: pricing.unitCosts(),
          priceItems: pricing.priceMap(),
        });
        resolvedActors = actorsInput.actors;
      }
    }

    if (!budgetReceipt && mapped.budget?.budget && resolvedPriceList) {
      const spendResult = evaluateConfiguratorSpend({
        budget: mapped.budget.budget,
        priceList: resolvedPriceList,
        allocation: budgetAllocation,
        layout,
        actors: actorsInput.actors,
        resources: configuratorResources,
        motivationRules,
        affinityRules,
        proposalMeta: createBuildMeta(spec, producedBy, "spend_proposal"),
        receiptMeta: createBuildMeta(spec, producedBy, "budget_receipt"),
        normalizeMotivations: configuratorMotivations,
      });
      spendProposal = spendResult.proposal;
      budgetReceipt = spendResult.receipt;
      budgetReceipt.scenarioSpendReport = createAllocatorPersona({ clock: UNUSED_CLOCK }).scenarioSpendReport({
        lineItems: budgetReceipt.lineItems,
        allocation: budgetAllocation,
        budgetTokens: mapped.budget.budget?.budget?.tokens,
      });
      if (budgetReceipt.status !== "approved") {
        throw new Error(formatBudgetReceiptDenial(budgetReceipt));
      }
    }
    if (budgetReceipt && budgetReceipt.status !== "approved") {
      throw new Error(formatBudgetReceiptDenial(budgetReceipt));
    }

    resolvedActors = resolvedActors || actorsInput.actors;
    const normalizedActors = normalizeActorPositions(actorsInput.actors, layout, {
      delverCount: configuratorInputs?.delverCount,
    });
    if (normalizedActors.changed) {
      actorsInput.actors = normalizedActors.actors;
      resolvedActors = normalizedActors.actors;
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
        hazards: Array.isArray(layout.hazards) ? layout.hazards : [],
      });
      affinitySummary = {
        schema: SCHEMAS.affinitySummary,
        schemaVersion: 1,
        // Builds run NO tick, and the Annotator subscribes only to the EMIT/SUMMARIZE tick
        // phases — so it cannot have produced this. Stamp the real caller, as every sibling
        // artifact here does; glue must not claim persona provenance it did not earn (P3.4).
        meta: createBuildMeta(spec, producedBy, "affinity_summary"),
        presetsRef: toRef(affinityPresets),
        loadoutsRef: toRef(affinityLoadouts),
        affinityRulesRef: affinityRules ? toRef(affinityRules) : undefined,
        simConfigRef: toRef(simConfig),
        initialStateRef: toRef(initialState),
        actors: resolvedEffects.actors || [],
        hazards: resolvedEffects.hazards || [],
        ambientPressure,
      };
    }

    resourceBundle = createDefaultResourceBundleArtifact({
      createMeta: (metaOverrides) => createBuildMeta(spec, metaOverrides.producedBy, "resource_bundle"),
      runId: spec.meta.runId,
      producedBy: "cli-build",
      emitVisualAssets: true,
    });
  }

  const resolvedBudget = mapped.budget
    ? {
      ...mapped.budget,
      ...(resolvedPriceList && !mapped.budget.priceList ? { priceList: resolvedPriceList } : {}),
      ...(budgetAllocation ? { allocation: budgetAllocation } : {}),
    }
    : mapped.budget;

  if (spendProposal && budgetReceipt) {
    const runCostContext = {
      runTotalTokens: budgetReceipt.totalCost,
      budgetTokens: budgetReceipt.totalCost + (budgetReceipt.remaining ?? 0),
      receiptRef: toRef(budgetReceipt),
      proposalRef: toRef(spendProposal),
    };
    for (const artifact of [spec, mapped.intent, mapped.plan, simConfig, initialState, resourceBundle, affinitySummary]) {
      if (artifact?.meta) {
        artifact.meta.cost = runCostContext;
      }
    }
  }

  // ── PX.6: what the build RESOLVED, published as output ──────────────────────────
  //
  // The Configurator's `inputs` are the causal record: what it was asked to build from,
  // locked when its round closed. The build then resolves them further — affinity and
  // motivation rules get expanded, actors get budget-maximized and normalized — and those
  // results USED to be written back on top of `inputs`, which made the artifact recorded as
  // the cause partly a product of the effect. Nothing failed, because the mutated shape is
  // still well-formed; you simply could not tell afterwards what the Configurator had
  // actually approved.
  //
  // Same data, honest location. `inputs` is now immutable after the round, and a consumer
  // that wants "what the build used" reads `resolved`. A spec with no `resolved` has not
  // been built yet, which is a fact worth being able to observe.
  if (spec?.configurator && typeof spec.configurator === "object") {
    spec.configurator.resolved = {
      affinityRules,
      motivationRules,
      ...(Array.isArray(resolvedActors) ? { actors: resolvedActors } : {}),
    };
  }

  return {
    spec,
    intent: mapped.intent,
    plan: mapped.plan,
    budget: resolvedBudget,
    solverRequest,
    solverResult,
    spendProposal,
    budgetReceipt,
    affinityRules,
    motivationRules,
    affinitySummary,
    simConfig,
    initialState,
    resourceBundle,
    capturedInputs: Array.isArray(capturedInputs) ? capturedInputs : undefined,
  };
}
