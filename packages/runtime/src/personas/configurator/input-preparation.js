import { normalizeActorDefinition, INPUT_KEYS } from "./unified-actors.js";
import { computeHazardVitals } from "./affinity-effects.js";
import { ACTOR_EQUIPMENT_FIELDS, DEFAULT_VITALS } from "../../contracts/domain-constants.js";

/**
 * Configurator input preparation — the pure grid-sizing / hazard / resource
 * logic that turns authored entities (rooms, floor tiles, hazards, resources)
 * into a configurator `inputs.levelGen` + `inputs.resources` payload.
 *
 * This is Configurator-owned domain logic (charter — "Persona Model —
 * ENFORCED", Configurator row): configuration assembly. It previously lived
 * inline in the CLI adapter (ak-impl.mjs), which is why authoring reached
 * around the persona. P2.2 relocates it here VERBATIM — the grid arithmetic is
 * the program's most goldens-sensitive code (it feeds sim-config), so every
 * formula and its documented invariant is preserved byte-for-byte and pinned by
 * tests/personas/configurator/configurator-input-prep.test.js. P2.3.1 threads
 * the CLI through the configurator service surface and deletes the inline copy.
 *
 * Pure: no IO or clock — safe under the runtime persona layer.
 */

// Minimum room dimensions when placedHazards/hazards occupy floor tiles alongside entrance + exit.
// A room smaller than medium (roomMinSize=5) compresses all elements into too few walkable cells.
export const MIN_ROOM_SIZE_WITH_ITEMS = 5;

// Room size profiles: map CLI size token → { roomMinSize, roomMaxSize }.
export const ROOM_SIZE_PROFILES = {
  small:  { roomMinSize: 3,  roomMaxSize: 5  },
  medium: { roomMinSize: 5,  roomMaxSize: 8  },
  large:  { roomMinSize: 8,  roomMaxSize: 12 },
};

// Pick the largest profile requested by any room in parsedRooms.
// Falls back to medium when no rooms are present. The search starts below
// small so a small-only request stays small (#198: it used to start at medium).
export function resolveRoomSizeProfile(rooms) {
  const order = ["small", "medium", "large"];
  let best = (rooms || []).length > 0 ? null : "medium";
  for (const entry of (rooms || [])) {
    const size = String(entry?.value?.size || entry?.value?.roomSize || "medium").toLowerCase();
    if (order.indexOf(size) > order.indexOf(best)) best = size;
  }
  return ROOM_SIZE_PROFILES[best] || ROOM_SIZE_PROFILES.medium;
}

export function ensureAuthoringLevelGenCapacity(levelGen, { walkableTilesTarget, placedHazards, rooms, hazardCount = placedHazards.length }) {
  const blockingHazardCount = placedHazards.reduce((sum, hazard) => sum + (hazard.blocking === true ? 1 : 0), 0);
  const walkableTarget = Number.isInteger(walkableTilesTarget) && walkableTilesTarget > 0 ? walkableTilesTarget : 0;
  // Authored hazard x/y are room-relative (mapped into a room's interior by
  // level-layout.js's mapHazardsToRooms), not absolute grid coordinates, so
  // they must not drive grid sizing here — doing so previously let e.g.
  // hazard x=99;y=99 silently inflate the grid to 102x102 to contain a raw
  // coordinate. Out-of-bounds room-relative placedHazards are now rejected with a
  // structured error by the layout layer instead.
  const requestedWalkable = walkableTarget + blockingHazardCount;
  const walkableSide = requestedWalkable > 0
    ? Math.max(5, Math.ceil(Math.sqrt(Math.ceil(requestedWalkable / 0.5))) + 2)
    : 5;

  // Resolve the room-size profile early so we can size the grid to fit it.
  // level-layout.js clamps roomMinSize to (min(width,height) - 2), so the grid must be at
  // least (roomMinSize + 4) on each side for the profile to take effect.
  // Hazards need at least a medium room: entrance, exit and hazards share it.
  // So a small room with hazards is medium-sized (the I1 benchmark contract).
  const requestedProfile = resolveRoomSizeProfile(rooms);
  const sizeProfile = hazardCount > 0 && requestedProfile.roomMaxSize < ROOM_SIZE_PROFILES.medium.roomMaxSize
    ? ROOM_SIZE_PROFILES.medium
    : requestedProfile;
  const profileMinSize = placedHazards.length > 0
    ? Math.max(MIN_ROOM_SIZE_WITH_ITEMS, sizeProfile.roomMinSize)
    : sizeProfile.roomMinSize;
  // +4 = 2 walls + 2 padding so the clamp in readRoomSettings allows the full room size
  // Sized to the profile's max so one room can use its whole range (#198).
  const profileGridSide = Math.max(profileMinSize, sizeProfile.roomMaxSize) + 4;

  // Grid capacity must also scale with the TOTAL requested room count, not just a single
  // room's size profile. level-layout.js's placeRooms() lays candidate rooms out in a
  // roughly-square grid of surface slots (buildRoomSurfaceSlots); if the interior is only
  // just big enough for one room of roomMaxSize, additional rooms silently fail to place
  // and orchestrateBuild returns fewer rooms than requested (confirmed: a 15x15 grid with
  // roomCount=5/roomMinSize=roomMaxSize=5 deterministically yields only 4 placed rooms).
  // Size the grid so a sqrt(roomCount) x sqrt(roomCount) arrangement of roomMaxSize rooms
  // (plus 1-tile spacing per room and a 4-tile wall/padding border) always fits. Only
  // applies when more than one room is requested — profileGridSide already sizes the
  // single-room case correctly, and widening it here would shift absolute tile
  // coordinates that other authoring flags (e.g. --hazard x=..;y=..) depend on.
  const requestedRoomCount = rooms.reduce((sum, entry) => {
    const count = Number.isInteger(entry?.value?.count) && entry.value.count > 0 ? entry.value.count : 1;
    return sum + count;
  }, 0);
  const roomCapacitySide = requestedRoomCount > 1
    ? (() => {
      const columns = Math.ceil(Math.sqrt(requestedRoomCount));
      const gridRows = Math.max(1, Math.ceil(requestedRoomCount / columns));
      return Math.max(columns, gridRows) * (sizeProfile.roomMaxSize + 1) + 4;
    })()
    : 0;

  const width = Math.max(
    Number.isInteger(levelGen?.width) ? levelGen.width : 0,
    walkableSide,
    profileGridSide,
    roomCapacitySide,
  );
  const height = Math.max(
    Number.isInteger(levelGen?.height) ? levelGen.height : 0,
    walkableSide,
    profileGridSide,
    roomCapacitySide,
  );
  const shape = levelGen?.shape && typeof levelGen.shape === "object" && !Array.isArray(levelGen.shape)
    ? { ...levelGen.shape }
    : {};
  if (!Number.isInteger(shape.roomCount) || shape.roomCount <= 0) {
    shape.roomCount = 1;
  }
  // When placedHazards are present, enforce the requested room-size profile (at least medium) to avoid
  // compressing entrance, exit, and hazard tiles into an unusably small floor area.
  const minRoomSize = profileMinSize;
  if (!Number.isInteger(shape.roomMinSize) || shape.roomMinSize < minRoomSize) {
    shape.roomMinSize = minRoomSize;
  }
  // Rooms range up to the profile's max whether or not hazards are placed;
  // capping hazard-free rooms at their min made every room its profile's
  // smallest square (#198).
  const minRoomMax = Math.max(shape.roomMinSize, sizeProfile.roomMaxSize);
  if (!Number.isInteger(shape.roomMaxSize) || shape.roomMaxSize < minRoomMax) {
    shape.roomMaxSize = minRoomMax;
  }
  if (!Number.isInteger(shape.corridorWidth) || shape.corridorWidth <= 0) {
    shape.corridorWidth = 1;
  }
  return {
    ...levelGen,
    width,
    height,
    shape,
  };
}

/**
 * Compose the full authored levelGen input: size the grid to fit the requested
 * rooms/floor tiles/hazards, record the walkable-tiles target, and attach the
 * canonicalized hazards. Mirrors ak-impl's inline prep (create/configure/*-plan)
 * byte-for-byte.
 *
 * Inputs keep the CLI's parsed `{ value: {...} }` wrapper shape so P2.3.1 is a
 * pure call-site swap; normalizing away the wrapper is a follow-up.
 *   rooms:      [{ value: { size|roomSize, count } }]
 *   floorTiles: [{ value: { count } }]
 *   hazards:    [{ value: { id, x, y, blocking, affinityStacks, vitals } }]
 */
export function prepareLevelGen({ existingLevelGen = {}, rooms = [], floorTiles = [], hazards = [] } = {}) {
  const walkableTilesTarget = floorTiles.reduce((sum, entry) => sum + entry.value.count, 0);
  const placedHazards = hazards
    .map((entry) => entry.value)
    .filter((entry) => entry.x !== undefined && entry.y !== undefined);
  const levelGen = ensureAuthoringLevelGenCapacity(existingLevelGen || {}, {
    walkableTilesTarget,
    placedHazards,
    rooms,
    hazardCount: hazards.length,
  });
  if (walkableTilesTarget > 0) {
    levelGen.walkableTilesTarget = walkableTilesTarget;
  }
  if (hazards.length > 0) {
    levelGen.hazards = hazards.map(({ value: entry }) => {
      if (entry.x === undefined || entry.y === undefined) {
        return { ...entry };
      }
      return {
        id: entry.id,
        x: entry.x,
        y: entry.y,
        blocking: entry.blocking === true,
        affinity: { ...entry.affinityStacks[0] },
        vitals: { ...entry.vitals },
      };
    });
  }
  return levelGen;
}

const RESOURCE_AUTHORING_KEYS = new Set(["permanenceMode", "_schemaVersion", "affinity", "permanent"]);
const RESOURCE_REQUEST_KEYS = Object.freeze([
  "alignment", "lifecycle", "defeatVital", "capabilities", "motivations", "affinities", ...ACTOR_EQUIPMENT_FIELDS,
]);

function authoredResourceAffinity(entry) {
  const affinity = entry?.affinity;
  if (!affinity || typeof affinity !== "object" || Array.isArray(affinity)
    || typeof affinity.kind !== "string" || !affinity.kind.trim()
    || typeof affinity.expression !== "string" || !affinity.expression.trim()
    || !Number.isSafeInteger(affinity.stacks) || affinity.stacks < 1
    || !Number.isFinite(affinity.mana) || affinity.mana < 0) return null;
  const manaRegen = affinity.manaRegen === undefined ? 0 : affinity.manaRegen;
  if (!Number.isFinite(manaRegen) || manaRegen < 0) return null;
  return {
    kind: affinity.kind,
    expression: affinity.expression,
    stacks: affinity.stacks,
    mana: affinity.mana,
    manaRegen,
  };
}

function grantVitals(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const grants = [];
  for (const grant of value) {
    if (!grant || typeof grant !== "object" || Array.isArray(grant)
      || !["health", "mana", "stamina"].includes(grant.key)
      || !Number.isFinite(grant.delta)
      || Object.keys(grant).some((key) => !["key", "delta", "regen"].includes(key))) {
      return null;
    }
    const next = { key: grant.key, delta: grant.delta };
    if (grant.regen !== undefined) {
      if (!Number.isFinite(grant.regen) || grant.regen < 0) return null;
      next.regen = grant.regen;
    }
    grants.push(next);
  }
  return grants;
}

function hasMechanicalVitals(vitals) {
  return Boolean(vitals) && typeof vitals === "object" && !Array.isArray(vitals)
    && Object.values(vitals).some((vital) => vital && [vital.current, vital.max, vital.regen].every(Number.isFinite));
}

/** Author resource presets through the same mechanical normalization as every actor. */
export function mapResources(resources = []) {
  return resources.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("invalid unified actor definition");
    }
    const authored = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
    if (Object.hasOwn(authored, "tier") || Object.hasOwn(authored, "stat")
      || Object.keys(authored).some((key) => !INPUT_KEYS.has(key) && !RESOURCE_AUTHORING_KEYS.has(key))) {
      throw new Error("invalid unified actor definition");
    }
    const positioned = Object.hasOwn(authored, "position");
    const affinity = authoredResourceAffinity(authored);
    if (Object.hasOwn(authored, "affinity") && !affinity) throw new Error("invalid unified actor definition");
    const grants = grantVitals(authored.vitals);
    // Darren, 2026-10-30: an actor equips at most three (core's MAX_AFFINITY_SLOTS) and carries
    // the rest as a pack, so slot-unlock loot (`slotGrant`) is gone and refused as an unknown key.
    const authoredHoldings = [
      ...(["consumable", "level", "permanent"].includes(authored.permanenceMode) && grants
        ? [{ id: authored.id, kind: "vital", permanenceMode: authored.permanenceMode, claimedBy: null, vitals: grants }]
        : []),
    ];
    const holdings = Array.isArray(authored.holdings)
      ? authored.holdings
      : (authoredHoldings.length > 0 ? authoredHoldings : undefined);
    const mechanical = hasMechanicalVitals(authored.vitals)
      ? mechanicalVitals(authored.vitals)
      : (holdings && grants ? { durability: { ...DEFAULT_VITALS.durability } } : null);
    const vitals = affinity
      ? {
        durability: { ...DEFAULT_VITALS.durability },
        ...(mechanical || {}),
        mana: { current: affinity.mana, max: affinity.mana, regen: affinity.manaRegen },
      }
      : (mechanical || authored.vitals);
    const request = {
      category: "resource",
      id: authored.id,
      position: positioned ? authored.position : { x: 0, y: 0 },
      vitals,
    };
    for (const key of RESOURCE_REQUEST_KEYS) {
      if (Object.hasOwn(authored, key)) request[key] = authored[key];
    }
    if (holdings) request.holdings = holdings;
    if (affinity && !Object.hasOwn(authored, "affinities")) {
      request.affinities = [{ kind: affinity.kind, expression: affinity.expression, stacks: affinity.stacks }];
      if (!Object.hasOwn(authored, "activeAffinityKey")) {
        request.activeAffinityKey = `${affinity.kind}:${affinity.expression}`;
      }
    }
    const { actor, presentation } = normalizeActorDefinition(request);
    const mapped = { ...actor, category: presentation.category };
    if (!positioned) delete mapped.position;
    return mapped;
  });
}

/** Authoring hazard vitals may still carry `kind`; mechanical records keep current/max/regen. */
function mechanicalVitals(vitals = {}) {
  if (!vitals || typeof vitals !== "object" || Array.isArray(vitals)) return {};
  const next = {};
  for (const [key, vital] of Object.entries(vitals)) {
    if (!vital || typeof vital !== "object" || Array.isArray(vital)) continue;
    if ([vital.current, vital.max, vital.regen].every((value) => Number.isFinite(value))) {
      next[key] = { current: vital.current, max: vital.max, regen: vital.regen };
      continue;
    }
    if (vital.kind === "one-time" && Number.isFinite(vital.amount) && vital.amount >= 0) {
      next[key] = { current: vital.amount, max: vital.amount, regen: 0 };
    }
  }
  return next;
}

export function authoredAffinity(entry) {
  const stack = Array.isArray(entry?.affinityStacks) ? entry.affinityStacks[0] : null;
  if (stack && typeof stack === "object" && !Array.isArray(stack)
    && typeof stack.kind === "string" && stack.kind.trim()
    && typeof stack.expression === "string" && stack.expression.trim()) {
    return { kind: stack.kind, expression: stack.expression, stacks: stack.stacks,
      ...(stack.intensity !== undefined ? { intensity: stack.intensity } : {}) };
  }
  if (entry?.affinity && typeof entry.affinity === "object" && !Array.isArray(entry.affinity)) {
    return entry.affinity;
  }
  if (typeof entry?.affinity === "string" && entry.affinity.trim()
    && typeof entry.expression === "string" && entry.expression.trim()) {
    return { kind: entry.affinity, expression: entry.expression, stacks: entry.stacks };
  }
  return null;
}

/**
 * Translate the hazard authoring preset into the common mechanical actor shape.
 * Trap pools are sized from `affinityRules` when a build authors them (#247), the
 * same rules core's cast prices are built from; the default rules otherwise.
 */
export function mapHazards(hazards = [], { affinityRules } = {}) {
  return hazards.map((entry, index) => {
    const affinity = authoredAffinity(entry);
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !affinity) {
      throw new Error("invalid hazard actor request");
    }
    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `hazard_${index + 1}`;
    const position = entry.position ?? (
      Number.isSafeInteger(entry.x) && Number.isSafeInteger(entry.y)
        ? { x: entry.x, y: entry.y }
        : null
    );
    const { kind, expression, stacks, intensity } = affinity;
    const defaults = computeHazardVitals(expression, stacks, kind, affinityRules, intensity);
    const { actor, presentation } = normalizeActorDefinition({
      category: "hazard",
      id,
      position,
      vitals: { ...defaults, ...mechanicalVitals(entry.vitals) },
      capabilities: { blocksMovement: entry.blocking === true },
      // #340: intensity rides along as authored; core validates it and reads absent as 1.
      affinities: [{ kind, expression, stacks, ...(intensity !== undefined ? { intensity } : {}) }],
      activeAffinityKey: `${kind}:${expression}`,
      motivations: Array.isArray(entry.motivations) ? entry.motivations : [],
      holdings: Array.isArray(entry.holdings) ? entry.holdings : [],
    });
    return { ...actor, category: presentation.category };
  });
}
