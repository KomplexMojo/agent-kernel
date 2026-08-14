// Card TYPE/SIZE vocabulary and its normalizers live in contracts/domain-constants.js
// (P5.1 D1): they are not Configurator decisions, and keeping them here forced the
// CLI, the Allocator, the Director and the UI to import a persona internal. The
// SIZE -> LAYOUT table below stays: those tile counts and room dimensions ARE
// Configurator geometry.
import {
  coercePositiveInt as normalizePositiveInt,
  DEFAULT_ROOM_CARD_SIZE,
  normalizeCardCount,
  normalizeCardType,
  normalizeRoomCardSize,
} from "../../contracts/domain-constants.js";

const ROOM_CARD_SIZE_LAYOUT = Object.freeze({
  small: Object.freeze({ roomFloorTiles: 24, connectorFloorTiles: 8, roomMinSize: 3, roomMaxSize: 5 }),
  medium: Object.freeze({ roomFloorTiles: 48, connectorFloorTiles: 16, roomMinSize: 5, roomMaxSize: 8 }),
  large: Object.freeze({ roomFloorTiles: 96, connectorFloorTiles: 24, roomMinSize: 8, roomMaxSize: 12 }),
});

const WALKABLE_DENSITY_TARGET = 0.5;

export function isRoomCard(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (normalizeCardType(entry.type) === "room") return true;
  return entry.source === "room";
}

export function readRoomCardLayoutBySize(size) {
  const normalizedSize = normalizeRoomCardSize(size);
  return ROOM_CARD_SIZE_LAYOUT[normalizedSize] || ROOM_CARD_SIZE_LAYOUT[DEFAULT_ROOM_CARD_SIZE];
}

export function extractRoomCards(cardSet = []) {
  if (!Array.isArray(cardSet)) return [];
  return cardSet.filter((entry) => isRoomCard(entry));
}

export function deriveLayoutFromRoomCards(cardSet = []) {
  const roomCards = extractRoomCards(cardSet);
  if (roomCards.length === 0) return null;

  return roomCards.reduce((layout, card) => {
    const count = normalizeCardCount(card?.count, 1);
    const roomLayout = readRoomCardLayoutBySize(card?.roomSize ?? card?.size);
    const connectorFloorTiles = roomLayout.connectorFloorTiles * count;
    const roomFloorTiles = roomLayout.roomFloorTiles * count;
    layout.floorTiles += roomFloorTiles + connectorFloorTiles;
    layout.connectorFloorTiles += connectorFloorTiles;
    layout.billableFloorTiles += roomFloorTiles;
    return layout;
  }, { floorTiles: 0, connectorFloorTiles: 0, billableFloorTiles: 0 });
}

export function deriveRoomShapeFromRoomCards(cardSet = [], { corridorWidth = 1 } = {}) {
  const roomCards = extractRoomCards(cardSet);
  if (roomCards.length === 0) return null;

  let roomCount = 0;
  let roomMinSize = null;
  let roomMaxSize = null;

  roomCards.forEach((card) => {
    const count = normalizeCardCount(card?.count, 1);
    const roomLayout = readRoomCardLayoutBySize(card?.roomSize ?? card?.size);
    roomCount += count;
    roomMinSize = roomMinSize === null
      ? roomLayout.roomMinSize
      : Math.min(roomMinSize, roomLayout.roomMinSize);
    roomMaxSize = roomMaxSize === null
      ? roomLayout.roomMaxSize
      : Math.max(roomMaxSize, roomLayout.roomMaxSize);
  });

  return {
    roomCount: normalizePositiveInt(roomCount, 1),
    roomMinSize: normalizePositiveInt(roomMinSize, 3),
    roomMaxSize: normalizePositiveInt(roomMaxSize, 5),
    corridorWidth: normalizePositiveInt(corridorWidth, 1),
    pattern: "none",
  };
}

function deriveLevelSideForWalkableTiles(totalTiles) {
  const normalizedTotalTiles = normalizePositiveInt(totalTiles, 1);
  const interiorArea = Math.ceil(normalizedTotalTiles / WALKABLE_DENSITY_TARGET);
  const interiorSide = Math.ceil(Math.sqrt(interiorArea));
  return Math.max(5, interiorSide + 2);
}

export function deriveLevelGenFromRoomCards(cardSet = [], { corridorWidth = 1 } = {}) {
  const layout = deriveLayoutFromRoomCards(cardSet);
  const shape = deriveRoomShapeFromRoomCards(cardSet, { corridorWidth });
  if (!shape) return null;

  const walkableTilesTarget = Number.isInteger(layout?.floorTiles)
    ? layout.floorTiles
    : null;
  const side = deriveLevelSideForWalkableTiles(
    Number.isInteger(walkableTilesTarget) && walkableTilesTarget > 0
      ? walkableTilesTarget
      : shape.roomCount * (
        readRoomCardLayoutBySize(DEFAULT_ROOM_CARD_SIZE).roomFloorTiles
        + readRoomCardLayoutBySize(DEFAULT_ROOM_CARD_SIZE).connectorFloorTiles
      ),
  );

  return {
    width: side,
    height: side,
    shape,
    walkableTilesTarget: Number.isInteger(walkableTilesTarget) ? walkableTilesTarget : undefined,
  };
}

export function buildRoomDesignFromRoomCards(cardSet = [], { corridorWidth = 1 } = {}) {
  const roomCards = extractRoomCards(cardSet);
  if (roomCards.length === 0) return null;

  const shape = deriveRoomShapeFromRoomCards(roomCards, { corridorWidth });
  if (!shape) return null;

  const rooms = roomCards.map((card, index) => ({
    id: typeof card?.id === "string" && card.id.trim() ? card.id.trim() : `room_card_${index + 1}`,
    affinity: typeof card?.affinity === "string" && card.affinity.trim() ? card.affinity.trim() : undefined,
    size: normalizeRoomCardSize(card?.roomSize ?? card?.size),
    count: normalizeCardCount(card?.count, 1),
  }));

  return {
    roomCount: shape.roomCount,
    roomMinSize: shape.roomMinSize,
    roomMaxSize: shape.roomMaxSize,
    corridorWidth: shape.corridorWidth,
    rooms,
  };
}
