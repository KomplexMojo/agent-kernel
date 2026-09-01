/**
 * RB3.2 — price a Configurator-authored mixed-room composition.
 *
 * The Configurator supplies structural classifications; this module only prices
 * those published fields against one resolved PriceList. The result is an
 * explanatory breakdown of the room's existing receipt charge, never a second
 * spend proposal or ledger debit.
 */
import { AFFINITY_EXPRESSION_SET, VITAL_KEYS } from "../../contracts/domain-constants.js";
import { calculateActorConfigurationUnitCost } from "./spend-proposal.js";
import { calculatePriceTotal, normalizePriceItems } from "./validate-spend.js";

const UNIT = "design_tokens";
const PRODUCER = "allocator";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unavailable(reason) {
  return { status: "unavailable", unit: UNIT, producedBy: PRODUCER, reason };
}

function readPrice(priceMap, kind, id, quantity) {
  const item = priceMap.get(`${kind}:${id}`);
  if (!item) return null;
  const total = calculatePriceTotal(item, quantity);
  return Number.isInteger(total) && total >= 0 ? total : null;
}

function normalizeAffinity(affinity) {
  if (!isObject(affinity)
    || typeof affinity.kind !== "string"
    || affinity.kind.trim().length === 0
    || !AFFINITY_EXPRESSION_SET.has(affinity.expression)
    || !Number.isInteger(affinity.stacks)
    || affinity.stacks <= 0) {
    return null;
  }
  return {
    kind: affinity.kind.trim().toLowerCase(),
    expression: affinity.expression,
    stacks: affinity.stacks,
  };
}

function normalizeHazardVitals(hazard) {
  if (hazard.vitals !== undefined) {
    if (!isObject(hazard.vitals)) return null;
    const vitals = {};
    for (const key of VITAL_KEYS) {
      const record = hazard.vitals[key];
      if (record === undefined) continue;
      if (!isObject(record)) return null;
      const max = record.max ?? record.current;
      const regen = record.regen ?? 0;
      if (!Number.isInteger(max) || max < 0 || !Number.isInteger(regen) || regen < 0) return null;
      vitals[key] = { max, regen };
    }
    return vitals;
  }

  const reserve = hazard.manaReserve ?? 0;
  const regen = hazard.manaRegen ?? 0;
  if (!Number.isInteger(reserve) || reserve < 0 || !Number.isInteger(regen) || regen < 0) return null;
  return reserve > 0 || regen > 0 ? { mana: { max: reserve, regen } } : {};
}

function priceAffinityPayload({ affinity, vitals = {}, priceMap }) {
  const result = calculateActorConfigurationUnitCost({
    entry: {
      normalizedMotivations: [],
      affinities: [affinity],
      vitals,
    },
    priceMap,
  });
  if (Array.isArray(result.errors) && result.errors.length > 0) return null;
  return Number.isInteger(result.cost) && result.cost >= 0 ? result.cost : null;
}

export function priceMixedRoomDesignSpend({ room, composition, priceList } = {}) {
  if (!isObject(room)
    || !Number.isInteger(room.width)
    || room.width <= 0
    || !Number.isInteger(room.height)
    || room.height <= 0
    || !isObject(composition)
    || !Array.isArray(composition.localizedTiles)
    || !Array.isArray(composition.localizedHazards)) {
    return unavailable("mixed_room_input_invalid");
  }

  const priceMap = normalizePriceItems(priceList);
  const occupiedTiles = new Set();
  let localizedTiles = 0;
  for (const tile of composition.localizedTiles) {
    const kind = typeof tile?.kind === "string" ? tile.kind.trim().toLowerCase() : "";
    if (!Number.isInteger(tile?.x)
      || !Number.isInteger(tile?.y)
      || tile.x < 0
      || tile.y < 0
      || tile.x >= room.width
      || tile.y >= room.height
      || !kind) {
      return unavailable("mixed_room_input_invalid");
    }
    const coordinate = `${tile.x},${tile.y}`;
    if (occupiedTiles.has(coordinate)) return unavailable("mixed_room_input_invalid");
    occupiedTiles.add(coordinate);
    const tileId = `tile_${kind.replace(/^tile_/, "")}`;
    const cost = readPrice(priceMap, "tile", tileId, 1);
    if (cost === null) return unavailable("mixed_room_price_missing");
    localizedTiles += cost;
  }

  const defaultTileCount = room.width * room.height - occupiedTiles.size;
  const defaultTiles = readPrice(priceMap, "tile", "tile_floor", defaultTileCount);
  if (defaultTiles === null) return unavailable("mixed_room_price_missing");

  let roomWideOverlay = 0;
  if (composition.roomWideOverlay !== undefined) {
    const affinity = normalizeAffinity(composition.roomWideOverlay);
    if (!affinity) return unavailable("mixed_room_input_invalid");
    const cost = priceAffinityPayload({ affinity, priceMap });
    if (cost === null) return unavailable("mixed_room_price_missing");
    roomWideOverlay = cost;
  }

  const hazardBase = readPrice(priceMap, "hazard", "hazard_basic", 1);
  if (composition.localizedHazards.length > 0 && hazardBase === null) {
    return unavailable("mixed_room_price_missing");
  }
  let localizedHazards = 0;
  for (const hazard of composition.localizedHazards) {
    if (!isObject(hazard)) return unavailable("mixed_room_input_invalid");
    const affinity = normalizeAffinity(hazard.affinity);
    const vitals = normalizeHazardVitals(hazard);
    if (!affinity || vitals === null) return unavailable("mixed_room_input_invalid");
    const payloadCost = priceAffinityPayload({ affinity, vitals, priceMap });
    if (payloadCost === null) return unavailable("mixed_room_price_missing");
    localizedHazards += hazardBase + payloadCost;
  }

  const components = { defaultTiles, localizedTiles, roomWideOverlay, localizedHazards };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (!Object.values(components).every((value) => Number.isInteger(value) && value >= 0)
    || !Number.isInteger(total)
    || total < 0) {
    return unavailable("mixed_room_spend_invalid");
  }

  return { status: "available", unit: UNIT, producedBy: PRODUCER, components, total };
}
