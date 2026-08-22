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
 * Pure: no IO, no clock, no imports — safe under the runtime persona layer.
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
// Falls back to medium when no rooms are present.
export function resolveRoomSizeProfile(rooms) {
  const order = ["small", "medium", "large"];
  let best = "medium";
  for (const entry of (rooms || [])) {
    const size = String(entry?.value?.size || entry?.value?.roomSize || "medium").toLowerCase();
    if (order.indexOf(size) > order.indexOf(best)) best = size;
  }
  return ROOM_SIZE_PROFILES[best] || ROOM_SIZE_PROFILES.medium;
}

export function ensureAuthoringLevelGenCapacity(levelGen, { walkableTilesTarget, placedHazards, rooms }) {
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
  const sizeProfile = resolveRoomSizeProfile(rooms);
  const profileMinSize = placedHazards.length > 0
    ? Math.max(MIN_ROOM_SIZE_WITH_ITEMS, sizeProfile.roomMinSize)
    : sizeProfile.roomMinSize;
  // +4 = 2 walls + 2 padding so the clamp in readRoomSettings allows the full room size
  const profileGridSide = profileMinSize + 4;

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
  const minRoomMax = placedHazards.length > 0
    ? Math.max(shape.roomMinSize, sizeProfile.roomMaxSize)
    : Math.max(shape.roomMinSize, 3);
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

/**
 * Map authored resource values onto the configurator resource-input shape.
 * Takes UNWRAPPED resource values (the CLI passes `parsedResources.map(e => e.value)`).
 * Mirrors ak-impl's inline mapping byte-for-byte.
 */
export function mapResources(resources = []) {
  return resources.map((entry) => {
    if (entry._schemaVersion === 3) {
      return {
        id: entry.id,
        permanenceMode: entry.permanenceMode,
        vitals: entry.vitals,
        ...(entry.affinity && typeof entry.affinity === "object"
          ? { affinity: { ...entry.affinity } }
          : {}),
      };
    }
    return { id: entry.id, tier: entry.tier, stat: entry.stat, delta: entry.delta, dropRate: entry.dropRate };
  });
}
