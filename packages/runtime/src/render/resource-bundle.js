import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
} from "../personas/orchestrator/prompt-contract.js";
import {
  AFFINITY_COLOR_HEX,
  hexToRgba as sharedHexToRgba,
  normalizeHex as sharedNormalizeHex,
  resolveStackIntensity,
} from "./affinity-palette.js";
import { computeTileAlpha } from "./affinity-spatial-formulas.js";
import {
  applyAuraMask,
  emitMask,
  pushMask,
  pullMask,
  drawMask,
  stackAlphaMultiplier,
} from "./affinity-tile-mask.js";
import { getAffinitySpriteAsset } from "./generated/affinity-sprite-assets.js";
import { getGameSpriteAsset } from "./generated/game-sprite-assets.js";
import { SPATIAL_WEIGHTS } from "../contracts/affinity-spatial-rules.js";

export const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";
export const RESOURCE_BUNDLE_VERSION = 2;
export const DEFAULT_RESOURCE_TILE_SIZE = 32;
const RESOURCE_BUNDLE_VERSION_V1 = 1;
const RESOURCE_BUNDLE_VERSION_V2 = 2;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const DEFAULT_TILE_ASSET_IDS = Object.freeze({
  floor: "tile.floor",
  wall: "tile.wall",
  barrier: "tile.barrier",
  spawn: "tile.spawn",
  exit: "tile.exit",
  inaccessible: "tile.inaccessible",
  fog: "tile.fog",
});

const DEFAULT_ACTOR_ASSET_IDS = Object.freeze({
  delver: "actor.delver",
  warden: "actor.warden",
});

const DEFAULT_ITEM_ASSET_IDS = Object.freeze({
  hazard: "item.hazard",
  resource: "item.resource",
});

const DEFAULT_CARD_ASSET_IDS = Object.freeze({
  room: "card.room",
  delver: "card.delver",
  warden: "card.warden",
});

const STACK_TIER_IDS = Object.freeze({
  tier1: "overlay.stack-tier.tier1",
  tier2: "overlay.stack-tier.tier2",
  tier3: "overlay.stack-tier.tier3",
});

const ICON_TYPE_KEYS = Object.freeze(["room", "delver", "attacker", "warden", "defender", "hazard", "untyped"]);
const ICON_ITEM_KEYS = Object.freeze(["hazard", "resource"]);
const ICON_MOTIVATION_KEYS = Object.freeze([
  "random",
  "stationary",
  "exploring",
  "attacking",
  "defending",
  "stealthy",
  "friendly",
  "patrolling",
  "reflexive",
  "goal_oriented",
  "strategy_focused",
  "user_controlled",
]);
const ICON_VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability", "defence"]);
const ICON_UI_KEYS = Object.freeze(["playing-surface", "card-builder", "game-preview", "system-console", "game-inspector"]);

function mapKeys(keys, prefix) {
  return Object.fromEntries(keys.map((key) => [key, `${prefix}.${key}`]));
}

function mapAffinityTileOverlayIds(tileSemantic) {
  return Object.fromEntries(
    ALLOWED_AFFINITIES.map((kind) => [kind, `overlay.tile.${tileSemantic}.affinity.${kind}`]),
  );
}

function createLegacyMappings() {
  return {
    tiles: {
      floor: DEFAULT_TILE_ASSET_IDS.floor,
      wall: DEFAULT_TILE_ASSET_IDS.wall,
      barrier: DEFAULT_TILE_ASSET_IDS.barrier,
      spawn: DEFAULT_TILE_ASSET_IDS.spawn,
      exit: DEFAULT_TILE_ASSET_IDS.exit,
      inaccessible: DEFAULT_TILE_ASSET_IDS.inaccessible,
    },
    actors: { ...DEFAULT_ACTOR_ASSET_IDS },
    items: { ...DEFAULT_ITEM_ASSET_IDS },
    cards: { ...DEFAULT_CARD_ASSET_IDS },
    affinities: Object.fromEntries(ALLOWED_AFFINITIES.map((kind) => [kind, `affinity.${kind}`])),
    motivations: Object.fromEntries(ALLOWED_MOTIVATIONS.map((kind) => [kind, `motivation.${kind}`])),
    expressions: Object.fromEntries(ALLOWED_AFFINITY_EXPRESSIONS.map((kind) => [kind, `expression.${kind}`])),
  };
}

function createVisualMappings() {
  return {
    tiles: {
      floor: DEFAULT_TILE_ASSET_IDS.floor,
      wall: DEFAULT_TILE_ASSET_IDS.wall,
      barrier: DEFAULT_TILE_ASSET_IDS.barrier,
      spawn: DEFAULT_TILE_ASSET_IDS.spawn,
      exit: DEFAULT_TILE_ASSET_IDS.exit,
      inaccessible: DEFAULT_TILE_ASSET_IDS.inaccessible,
      fog: DEFAULT_TILE_ASSET_IDS.fog,
    },
    actors: {
      ...DEFAULT_ACTOR_ASSET_IDS,
      byRoleAndAffinity: {
        delver: Object.fromEntries(ALLOWED_AFFINITIES.map((kind) => [kind, `actor.delver.${kind}`])),
        warden: Object.fromEntries(ALLOWED_AFFINITIES.map((kind) => [kind, `actor.warden.${kind}`])),
      },
    },
    items: { ...DEFAULT_ITEM_ASSET_IDS },
    cards: { ...DEFAULT_CARD_ASSET_IDS },
    overlays: {
      affinities: Object.fromEntries(ALLOWED_AFFINITIES.map((kind) => [kind, `overlay.affinity.${kind}`])),
      expressions: Object.fromEntries(ALLOWED_AFFINITY_EXPRESSIONS.map((kind) => [kind, `overlay.expression.${kind}`])),
      stackTiers: {
        tier1: STACK_TIER_IDS.tier1,
        tier2: STACK_TIER_IDS.tier2,
        tier3: STACK_TIER_IDS.tier3,
      },
      motivations: Object.fromEntries(ALLOWED_MOTIVATIONS.map((kind) => [kind, `overlay.motivation.${kind}`])),
      tileAffinities: {
        floor: mapAffinityTileOverlayIds("floor"),
        wall: mapAffinityTileOverlayIds("wall"),
      },
      darknessMask: "overlay.darkness-mask",
    },
    tileEffects: {
      composition: "base_tile_plus_overlay_alpha",
      alphaFormula: "computeTileAlpha(distance, stacks, expression, SPATIAL_WEIGHTS)",
      affinityOverlays: {
        floor: mapAffinityTileOverlayIds("floor"),
        wall: mapAffinityTileOverlayIds("wall"),
      },
    },
    affinities: Object.fromEntries(ALLOWED_AFFINITIES.map((kind) => [kind, `overlay.affinity.${kind}`])),
    motivations: Object.fromEntries(ALLOWED_MOTIVATIONS.map((kind) => [kind, `overlay.motivation.${kind}`])),
    expressions: Object.fromEntries(ALLOWED_AFFINITY_EXPRESSIONS.map((kind) => [kind, `overlay.expression.${kind}`])),
    icons: {
      types: mapKeys(ICON_TYPE_KEYS, "icon.type"),
      items: mapKeys(ICON_ITEM_KEYS, "icon.item"),
      affinities: Object.fromEntries(ALLOWED_AFFINITIES.map((kind) => [kind, `icon.affinity.${kind}`])),
      expressions: Object.fromEntries(ALLOWED_AFFINITY_EXPRESSIONS.map((kind) => [kind, `icon.expression.${kind}`])),
      motivations: mapKeys(ICON_MOTIVATION_KEYS, "icon.motivation"),
      vitals: mapKeys(ICON_VITAL_KEYS, "icon.vital"),
      ui: mapKeys(ICON_UI_KEYS, "icon.ui"),
    },
  };
}

// Use shared palette functions for consistency
const normalizeHex = sharedNormalizeHex;
const hexToRgba = sharedHexToRgba;

function createAssetEntry(
  id,
  kind,
  label,
  ipfsUri,
  {
    width = DEFAULT_RESOURCE_TILE_SIZE,
    height = DEFAULT_RESOURCE_TILE_SIZE,
    dataUri,
    relativePath,
    variants,
  } = {},
) {
  const entry = {
    id,
    kind,
    label,
    ipfsUri,
    mimeType: "image/png",
    width,
    height,
  };
  if (typeof dataUri === "string" && dataUri.trim()) {
    entry.dataUri = dataUri;
  }
  if (typeof relativePath === "string" && relativePath.trim()) {
    entry.relativePath = relativePath;
  }
  if (variants && typeof variants === "object" && !Array.isArray(variants)) {
    entry.variants = variants;
  }
  return entry;
}

function base64FromBytes(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return globalThis.btoa(binary);
}

function bytesFromBase64(base64) {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function encodePngDataUri({ width, height, pixels }) {
  return `data:image/png;base64,${base64FromBytes(encodeRgbaToPng({ width, height, pixels }))}`;
}

function decodePngDataUri(dataUri) {
  const match = /^data:image\/png;base64,(.+)$/i.exec(String(dataUri || "").trim());
  if (!match) return null;
  return bytesFromBase64(match[1]);
}

function relativePathForAssetId(id) {
  if (id.startsWith("tile.")) {
    return `visual-assets/tiles/${id.slice("tile.".length).replace(/\./g, "-")}.png`;
  }
  if (id.startsWith("actor.")) {
    return `visual-assets/actors/${id.slice("actor.".length).replace(/\./g, "-")}.png`;
  }
  if (id.startsWith("card.")) {
    return `visual-assets/cards/${id.slice("card.".length).replace(/\./g, "-")}.png`;
  }
  if (id.startsWith("overlay.")) {
    return `visual-assets/overlays/${id.slice("overlay.".length).replace(/\./g, "-")}.png`;
  }
  if (id.startsWith("affinity.") || id.startsWith("motivation.") || id.startsWith("expression.")) {
    return `visual-assets/overlays/${id.replace(/\./g, "-")}.png`;
  }
  return `visual-assets/misc/${id.replace(/\./g, "-")}.png`;
}

function createGeneratedAssetEntry(id, kind, label, ipfsUri) {
  const affinitySpriteAsset = getAffinitySpriteAsset(id) || getGameSpriteAsset(id);
  if (affinitySpriteAsset) {
    return createAssetEntry(id, kind, label, ipfsUri, {
      dataUri: affinitySpriteAsset.dataUri,
      relativePath: affinitySpriteAsset.relativePath,
      variants: affinitySpriteAsset.variants,
    });
  }

  const pixels = buildSpriteForSemantic(id, DEFAULT_RESOURCE_TILE_SIZE);
  return createAssetEntry(id, kind, label, ipfsUri, {
    dataUri: encodePngDataUri({
      width: DEFAULT_RESOURCE_TILE_SIZE,
      height: DEFAULT_RESOURCE_TILE_SIZE,
      pixels,
    }),
    relativePath: relativePathForAssetId(id),
  });
}

function createDefaultAssets({ emitVisualAssets = false } = {}) {
  const makeEntry = emitVisualAssets ? createGeneratedAssetEntry : createAssetEntry;
  const assets = [
    makeEntry(DEFAULT_TILE_ASSET_IDS.floor, "tile", "Floor Tile", "ipfs://ak-resource-bundle-v1/tile-floor.png"),
    makeEntry(DEFAULT_TILE_ASSET_IDS.wall, "tile", "Wall Tile", "ipfs://ak-resource-bundle-v1/tile-wall.png"),
    makeEntry(DEFAULT_TILE_ASSET_IDS.barrier, "tile", "Barrier Tile", "ipfs://ak-resource-bundle-v1/tile-barrier.png"),
    makeEntry(DEFAULT_TILE_ASSET_IDS.spawn, "tile", "Spawn Tile", "ipfs://ak-resource-bundle-v1/tile-spawn.png"),
    makeEntry(DEFAULT_TILE_ASSET_IDS.exit, "tile", "Exit Tile", "ipfs://ak-resource-bundle-v1/tile-exit.png"),
    makeEntry(DEFAULT_TILE_ASSET_IDS.inaccessible, "tile", "Inaccessible Tile", "ipfs://ak-resource-bundle-v1/tile-inaccessible.png"),
    makeEntry(DEFAULT_ACTOR_ASSET_IDS.delver, "actor", "Generic Delver", "ipfs://ak-resource-bundle-v1/actor-delver.png"),
    makeEntry(DEFAULT_ACTOR_ASSET_IDS.warden, "actor", "Generic Warden", "ipfs://ak-resource-bundle-v1/actor-warden.png"),
    makeEntry(DEFAULT_ITEM_ASSET_IDS.hazard, "item", "Generic Hazard", "ipfs://ak-resource-bundle-v1/item-hazard.png"),
    makeEntry(DEFAULT_ITEM_ASSET_IDS.resource, "item", "Generic Resource", "ipfs://ak-resource-bundle-v1/item-resource.png"),
    makeEntry(DEFAULT_CARD_ASSET_IDS.room, "card", "Room Card", "ipfs://ak-resource-bundle-v1/card-room.png"),
    makeEntry(DEFAULT_CARD_ASSET_IDS.delver, "card", "Delver Card", "ipfs://ak-resource-bundle-v1/card-delver.png"),
    makeEntry(DEFAULT_CARD_ASSET_IDS.warden, "card", "Warden Card", "ipfs://ak-resource-bundle-v1/card-warden.png"),
  ];

  if (emitVisualAssets) {
    assets.push(makeEntry(DEFAULT_TILE_ASSET_IDS.fog, "tile", "Fog Tile", "ipfs://ak-resource-bundle-v2/tile-fog.png"));
    ALLOWED_AFFINITIES.forEach((kind) => {
      assets.push(makeEntry(`actor.delver.${kind}`, "actor", `Delver ${kind}`, `ipfs://ak-resource-bundle-v2/actor-delver-${kind}.png`));
      assets.push(makeEntry(`actor.warden.${kind}`, "actor", `Warden ${kind}`, `ipfs://ak-resource-bundle-v2/actor-warden-${kind}.png`));
      assets.push(makeEntry(`overlay.affinity.${kind}`, "overlay", `${kind} Overlay`, `ipfs://ak-resource-bundle-v2/overlay-affinity-${kind}.png`));
      assets.push(makeEntry(`overlay.tile.floor.affinity.${kind}`, "overlay", `Floor ${kind} Affinity Overlay`, `ipfs://ak-resource-bundle-v2/overlay-tile-floor-affinity-${kind}.png`));
      assets.push(makeEntry(`overlay.tile.wall.affinity.${kind}`, "overlay", `Wall ${kind} Affinity Overlay`, `ipfs://ak-resource-bundle-v2/overlay-tile-wall-affinity-${kind}.png`));
    });
    ALLOWED_AFFINITY_EXPRESSIONS.forEach((kind) => {
      assets.push(makeEntry(`overlay.expression.${kind}`, "overlay", `${kind} Expression Overlay`, `ipfs://ak-resource-bundle-v2/overlay-expression-${kind}.png`));
    });
    assets.push(makeEntry(STACK_TIER_IDS.tier1, "overlay", "Stack Tier 1", "ipfs://ak-resource-bundle-v2/overlay-stack-tier-1.png"));
    assets.push(makeEntry(STACK_TIER_IDS.tier2, "overlay", "Stack Tier 2", "ipfs://ak-resource-bundle-v2/overlay-stack-tier-2.png"));
    assets.push(makeEntry(STACK_TIER_IDS.tier3, "overlay", "Stack Tier 3", "ipfs://ak-resource-bundle-v2/overlay-stack-tier-3.png"));
    ALLOWED_MOTIVATIONS.forEach((kind) => {
      assets.push(makeEntry(`overlay.motivation.${kind}`, "overlay", `${kind} Motivation Overlay`, `ipfs://ak-resource-bundle-v2/overlay-motivation-${kind}.png`));
    });
    assets.push(makeEntry("overlay.darkness-mask", "overlay", "Darkness Mask", "ipfs://ak-resource-bundle-v2/overlay-darkness-mask.png"));

    ICON_TYPE_KEYS.forEach((kind) => {
      assets.push(makeEntry(`icon.type.${kind}`, "icon", `${kind} Type Icon`, `ipfs://ak-resource-bundle-v2/icon-type-${kind}.png`));
    });

    ICON_ITEM_KEYS.forEach((kind) => {
      assets.push(makeEntry(`icon.item.${kind}`, "icon", `${kind} Item Icon`, `ipfs://ak-resource-bundle-v2/icon-item-${kind}.png`));
    });

    ALLOWED_AFFINITIES.forEach((kind) => {
      assets.push(makeEntry(`icon.affinity.${kind}`, "icon", `${kind} Affinity Icon`, `ipfs://ak-resource-bundle-v2/icon-affinity-${kind}.png`));
    });

    ALLOWED_AFFINITY_EXPRESSIONS.forEach((kind) => {
      assets.push(makeEntry(`icon.expression.${kind}`, "icon", `${kind} Expression Icon`, `ipfs://ak-resource-bundle-v2/icon-expression-${kind}.png`));
    });

    ICON_MOTIVATION_KEYS.forEach((kind) => {
      assets.push(makeEntry(`icon.motivation.${kind}`, "icon", `${kind} Motivation Icon`, `ipfs://ak-resource-bundle-v2/icon-motivation-${kind}.png`));
    });

    ICON_VITAL_KEYS.forEach((kind) => {
      assets.push(makeEntry(`icon.vital.${kind}`, "icon", `${kind} Vital Icon`, `ipfs://ak-resource-bundle-v2/icon-vital-${kind}.png`));
    });

    ICON_UI_KEYS.forEach((kind) => {
      assets.push(makeEntry(`icon.ui.${kind}`, "icon", `${kind} UI Icon`, `ipfs://ak-resource-bundle-v2/icon-ui-${kind}.png`));
    });

    return assets;
  }

  ALLOWED_AFFINITIES.forEach((kind) => {
    assets.push(createAssetEntry(`affinity.${kind}`, "affinity", `${kind} Affinity`, `ipfs://ak-resource-bundle-v1/affinity-${kind}.png`));
  });
  ALLOWED_MOTIVATIONS.forEach((kind) => {
    assets.push(createAssetEntry(`motivation.${kind}`, "motivation", `${kind} Motivation`, `ipfs://ak-resource-bundle-v1/motivation-${kind}.png`));
  });
  ALLOWED_AFFINITY_EXPRESSIONS.forEach((kind) => {
    assets.push(createAssetEntry(`expression.${kind}`, "expression", `${kind} Expression`, `ipfs://ak-resource-bundle-v1/expression-${kind}.png`));
  });

  return assets;
}

export function createDefaultResourceBundleArtifact({
  createMeta,
  runId = "resource_bundle_default",
  producedBy = "resource-bundle",
  gatewayBaseUrl = "https://ipfs.io/ipfs",
  emitVisualAssets = false,
} = {}) {
  if (typeof createMeta !== "function") {
    throw new Error("createDefaultResourceBundleArtifact requires createMeta.");
  }
  const schemaVersion = emitVisualAssets ? RESOURCE_BUNDLE_VERSION_V2 : RESOURCE_BUNDLE_VERSION_V1;
  return {
    schema: RESOURCE_BUNDLE_SCHEMA,
    schemaVersion,
    meta: createMeta({ producedBy, runId }),
    bundleId: emitVisualAssets ? "agent-kernel-visual-resource-bundle" : "agent-kernel-default-resource-bundle",
    bundleVersion: schemaVersion,
    tileWidth: DEFAULT_RESOURCE_TILE_SIZE,
    tileHeight: DEFAULT_RESOURCE_TILE_SIZE,
    gatewayBaseUrl,
    assets: createDefaultAssets({ emitVisualAssets }),
    mappings: emitVisualAssets ? createVisualMappings() : createLegacyMappings(),
  };
}

export function validateResourceBundleArtifact(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return { ok: false, errors: ["artifact must be an object"] };
  }
  if (bundle.schema !== RESOURCE_BUNDLE_SCHEMA) errors.push(`schema must be ${RESOURCE_BUNDLE_SCHEMA}`);
  if (![RESOURCE_BUNDLE_VERSION_V1, RESOURCE_BUNDLE_VERSION_V2].includes(Number(bundle.schemaVersion))) {
    errors.push(`schemaVersion must be ${RESOURCE_BUNDLE_VERSION_V1} or ${RESOURCE_BUNDLE_VERSION_V2}`);
  }
  if (!Array.isArray(bundle.assets) || bundle.assets.length === 0) errors.push("assets must be a non-empty array");
  const seen = new Set();
  (bundle.assets || []).forEach((asset, index) => {
    const id = typeof asset?.id === "string" ? asset.id.trim() : "";
    if (!id) errors.push(`assets[${index}].id is required`);
    if (id && seen.has(id)) errors.push(`assets[${index}].id must be unique`);
    seen.add(id);
    if (!/^ipfs:\/\//.test(String(asset?.ipfsUri || ""))) errors.push(`assets[${index}].ipfsUri must use ipfs://`);
    if (Number(asset?.width) !== DEFAULT_RESOURCE_TILE_SIZE) errors.push(`assets[${index}].width must be ${DEFAULT_RESOURCE_TILE_SIZE}`);
    if (Number(asset?.height) !== DEFAULT_RESOURCE_TILE_SIZE) errors.push(`assets[${index}].height must be ${DEFAULT_RESOURCE_TILE_SIZE}`);
    if (Number(bundle.schemaVersion) >= RESOURCE_BUNDLE_VERSION_V2) {
      if (!/^data:image\/png;base64,/i.test(String(asset?.dataUri || ""))) {
        errors.push(`assets[${index}].dataUri must be an image/png data URI`);
      }
      if (!String(asset?.relativePath || "").trim()) {
        errors.push(`assets[${index}].relativePath is required`);
      }
    }
  });
  if (!bundle.mappings?.tiles?.floor) errors.push("mappings.tiles.floor is required");
  if (!bundle.mappings?.actors?.delver) errors.push("mappings.actors.delver is required");
  if (!bundle.mappings?.actors?.warden) errors.push("mappings.actors.warden is required");
  if (Number(bundle.schemaVersion) >= RESOURCE_BUNDLE_VERSION_V2) {
    if (!bundle.mappings?.tiles?.fog) errors.push("mappings.tiles.fog is required");
    if (!bundle.mappings?.actors?.byRoleAndAffinity?.delver) errors.push("mappings.actors.byRoleAndAffinity.delver is required");
    if (!bundle.mappings?.actors?.byRoleAndAffinity?.warden) errors.push("mappings.actors.byRoleAndAffinity.warden is required");
    if (!bundle.mappings?.overlays?.affinities) errors.push("mappings.overlays.affinities is required");
    if (!bundle.mappings?.overlays?.expressions) errors.push("mappings.overlays.expressions is required");
    if (!bundle.mappings?.overlays?.stackTiers?.tier1) errors.push("mappings.overlays.stackTiers.tier1 is required");
    if (!bundle.mappings?.overlays?.motivations) errors.push("mappings.overlays.motivations is required");
    if (!bundle.mappings?.overlays?.tileAffinities?.floor?.fire) errors.push("mappings.overlays.tileAffinities.floor.fire is required");
    if (!bundle.mappings?.overlays?.tileAffinities?.wall?.fire) errors.push("mappings.overlays.tileAffinities.wall.fire is required");
    if (!bundle.mappings?.tileEffects?.affinityOverlays?.floor?.fire) errors.push("mappings.tileEffects.affinityOverlays.floor.fire is required");
    if (!bundle.mappings?.icons?.types?.hazard) errors.push("mappings.icons.types.hazard is required");
    if (!bundle.mappings?.icons?.items?.hazard) errors.push("mappings.icons.items.hazard is required");
    if (!bundle.mappings?.icons?.motivations?.user_controlled) errors.push("mappings.icons.motivations.user_controlled is required");
    if (!bundle.mappings?.icons?.vitals?.defence) errors.push("mappings.icons.vitals.defence is required");
    if (!bundle.mappings?.overlays?.darknessMask) errors.push("mappings.overlays.darknessMask is required");
  }
  return { ok: errors.length === 0, errors };
}

function createPixelBuffer(width, height) {
  return new Uint8ClampedArray(width * height * 4);
}

function setPixel(pixels, width, x, y, rgba) {
  if (x < 0 || y < 0) return;
  const index = (y * width + x) * 4;
  if (index < 0 || index + 3 >= pixels.length) return;
  pixels[index] = rgba[0];
  pixels[index + 1] = rgba[1];
  pixels[index + 2] = rgba[2];
  pixels[index + 3] = rgba[3];
}

function fillRect(pixels, width, x, y, rectWidth, rectHeight, rgba) {
  for (let yy = 0; yy < rectHeight; yy += 1) {
    for (let xx = 0; xx < rectWidth; xx += 1) {
      setPixel(pixels, width, x + xx, y + yy, rgba);
    }
  }
}

function drawBorder(pixels, width, x, y, size, rgba) {
  fillRect(pixels, width, x, y, size, 1, rgba);
  fillRect(pixels, width, x, y + size - 1, size, 1, rgba);
  fillRect(pixels, width, x, y, 1, size, rgba);
  fillRect(pixels, width, x + size - 1, y, 1, size, rgba);
}

function drawLine(pixels, width, x0, y0, x1, y1, rgba) {
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    setPixel(pixels, width, x0, y0, rgba);
    if (x0 === x1 && y0 === y1) break;
    const next = 2 * error;
    if (next >= dy) {
      if (x0 === x1) break;
      error += dy;
      x0 += sx;
    }
    if (next <= dx) {
      if (y0 === y1) break;
      error += dx;
      y0 += sy;
    }
  }
}

function drawCircle(pixels, width, cx, cy, radius, rgba) {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) {
        setPixel(pixels, width, cx + x, cy + y, rgba);
      }
    }
  }
}

function checker(pixels, width, size, colorA, colorB, step = 4) {
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      fillRect(pixels, width, x, y, step, step, ((x + y) / step) % 2 === 0 ? colorA : colorB);
    }
  }
}

const PALETTE = Object.freeze({
  floorA: hexToRgba("#d7f3c0"),
  floorB: hexToRgba("#c7e8ac"),
  wallA: hexToRgba("#18221d"),
  wallB: hexToRgba("#253028"),
  barrierA: hexToRgba("#7b8792"),
  barrierB: hexToRgba("#4e5963"),
  spawn: hexToRgba("#3eaad6"),
  exit: hexToRgba("#ef8b2c"),
  inaccessible: hexToRgba("#050505"),
  delver: hexToRgba("#2e8b7b"),
  warden: hexToRgba("#9a3d45"),
  border: hexToRgba("#0d1110"),
  white: hexToRgba("#ffffff"),
  black: hexToRgba("#000000"),
  // Affinity colors now sourced from shared palette
  affinity: Object.freeze(
    Object.fromEntries(
      Object.entries(AFFINITY_COLOR_HEX).map(([kind, hex]) => [kind, hexToRgba(hex)]),
    ),
  ),
});

function inferTileSemantic(char) {
  if (char === "?") return "fog";
  if (char === "#") return "wall";
  if (char === "B") return "barrier";
  if (char === "S") return "spawn";
  if (char === "E") return "exit";
  if (char === " " || char === "X") return "inaccessible";
  return "floor";
}

function affinityOrder(kind) {
  const index = ALLOWED_AFFINITIES.indexOf(kind);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function normalizeAffinityKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeStacks(stacks) {
  const parsed = Number(stacks);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.round(parsed));
}

function collectAffinityEntries(actor = {}) {
  const entries = [];
  if (Array.isArray(actor?.affinities)) {
    actor.affinities.forEach((entry) => {
      const kind = normalizeAffinityKey(entry?.kind);
      if (!kind) return;
      const expression = normalizeAffinityKey(entry?.expression);
      entries.push({
        kind,
        expression,
        stacks: normalizeStacks(entry?.stacks),
      });
    });
  }
  const traitAffinities = actor?.traits?.affinities;
  if (traitAffinities && typeof traitAffinities === "object" && !Array.isArray(traitAffinities)) {
    Object.entries(traitAffinities).forEach(([rawKey, rawStacks]) => {
      const [kindPart, expressionPart] = String(rawKey || "").split(":");
      const kind = normalizeAffinityKey(kindPart);
      if (!kind) return;
      entries.push({
        kind,
        expression: normalizeAffinityKey(expressionPart),
        stacks: normalizeStacks(rawStacks),
      });
    });
  }
  if (entries.length === 0 && typeof actor?.affinity === "string" && actor.affinity.trim()) {
    entries.push({
      kind: normalizeAffinityKey(actor.affinity),
      expression: normalizeAffinityKey(actor?.expression),
      stacks: 1,
    });
  }
  entries.sort((left, right) => {
    if (right.stacks !== left.stacks) return right.stacks - left.stacks;
    return affinityOrder(left.kind) - affinityOrder(right.kind);
  });
  return entries;
}

function inferActorRole(actor = {}) {
  const raw = `${actor.role || ""} ${actor.kind || ""} ${actor.id || ""}`.toLowerCase();
  return raw.includes("warden") ? "warden" : "delver";
}

function inferAffinity(actor = {}) {
  return collectAffinityEntries(actor)[0]?.kind || "";
}

function inferExpression(actor = {}) {
  return collectAffinityEntries(actor)[0]?.expression || "";
}

function inferStackTier(actor = {}) {
  const stacks = collectAffinityEntries(actor)[0]?.stacks || 1;
  if (stacks >= 3) return "tier3";
  if (stacks >= 2) return "tier2";
  return "tier1";
}

function inferMotivation(actor = {}) {
  if (typeof actor?.motivation === "string" && actor.motivation.trim()) return actor.motivation.trim().toLowerCase();
  const traits = actor?.traits;
  if (typeof traits?.motivation === "string" && traits.motivation.trim()) return traits.motivation.trim().toLowerCase();
  return "";
}

function buildSpriteForSemantic(assetId, size = DEFAULT_RESOURCE_TILE_SIZE) {
  const pixels = createPixelBuffer(size, size);
  if (assetId.startsWith("tile.floor")) {
    checker(pixels, size, size, PALETTE.floorA, PALETTE.floorB, 4);
    drawBorder(pixels, size, 0, 0, size, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("tile.wall")) {
    checker(pixels, size, size, PALETTE.wallA, PALETTE.wallB, 4);
    drawBorder(pixels, size, 0, 0, size, PALETTE.black);
    return pixels;
  }
  if (assetId.startsWith("tile.barrier")) {
    checker(pixels, size, size, PALETTE.barrierA, PALETTE.barrierB, 4);
    for (let x = 0; x < size; x += 4) {
      drawLine(pixels, size, x, 0, Math.min(size - 1, x + 10), size - 1, PALETTE.white);
    }
    drawBorder(pixels, size, 0, 0, size, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("tile.spawn")) {
    checker(pixels, size, size, PALETTE.floorA, PALETTE.floorB, 4);
    drawCircle(pixels, size, 16, 16, 9, PALETTE.spawn);
    drawBorder(pixels, size, 0, 0, size, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("tile.exit")) {
    checker(pixels, size, size, PALETTE.floorA, PALETTE.floorB, 4);
    fillRect(pixels, size, 9, 6, 14, 20, PALETTE.exit);
    fillRect(pixels, size, 12, 9, 8, 14, PALETTE.black);
    drawBorder(pixels, size, 0, 0, size, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("tile.inaccessible")) {
    fillRect(pixels, size, 0, 0, size, size, PALETTE.inaccessible);
    drawLine(pixels, size, 0, 0, size - 1, size - 1, PALETTE.wallB);
    drawLine(pixels, size, size - 1, 0, 0, size - 1, PALETTE.wallB);
    drawBorder(pixels, size, 0, 0, size, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("tile.fog")) {
    fillRect(pixels, size, 0, 0, size, size, hexToRgba("#0b0e10"));
    checker(pixels, size, size, hexToRgba("#12181c"), hexToRgba("#090c0e"), 4);
    drawBorder(pixels, size, 0, 0, size, PALETTE.black);
    return pixels;
  }
  if (assetId.startsWith("actor.delver")) {
    const affinityKind = assetId.split(".")[2];
    const color = PALETTE.affinity[affinityKind] || PALETTE.delver;
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    drawCircle(pixels, size, 16, 10, 5, PALETTE.white);
    drawCircle(pixels, size, 16, 15, 8, color);
    fillRect(pixels, size, 11, 21, 10, 6, color);
    drawLine(pixels, size, 11, 14, 7, 22, PALETTE.white);
    drawLine(pixels, size, 21, 14, 25, 22, PALETTE.white);
    return pixels;
  }
  if (assetId.startsWith("actor.warden")) {
    const affinityKind = assetId.split(".")[2];
    const color = PALETTE.affinity[affinityKind] || PALETTE.warden;
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    fillRect(pixels, size, 9, 10, 14, 14, color);
    fillRect(pixels, size, 12, 5, 8, 5, color);
    drawBorder(pixels, size, 9, 10, 14, PALETTE.white);
    drawLine(pixels, size, 8, 25, 16, 19, PALETTE.white);
    drawLine(pixels, size, 24, 25, 16, 19, PALETTE.white);
    return pixels;
  }
  if (assetId.startsWith("affinity.")) {
    const kind = assetId.slice("affinity.".length);
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    drawCircle(pixels, size, 16, 16, 11, PALETTE.affinity[kind] || PALETTE.white);
    drawBorder(pixels, size, 3, 3, 26, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("motivation.")) {
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    drawLine(pixels, size, 6, 25, 25, 6, PALETTE.white);
    drawLine(pixels, size, 18, 6, 25, 6, PALETTE.white);
    drawLine(pixels, size, 25, 6, 25, 13, PALETTE.white);
    return pixels;
  }
  if (assetId.startsWith("expression.")) {
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    drawLine(pixels, size, 7, 16, 25, 16, PALETTE.white);
    drawLine(pixels, size, 18, 9, 25, 16, PALETTE.white);
    drawLine(pixels, size, 18, 23, 25, 16, PALETTE.white);
    return pixels;
  }
  if (assetId.startsWith("overlay.affinity.")) {
    const kind = assetId.slice("overlay.affinity.".length);
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    drawCircle(pixels, size, 24, 8, 5, PALETTE.affinity[kind] || PALETTE.white);
    drawBorder(pixels, size, 18, 2, 12, PALETTE.border);
    return pixels;
  }
  if (assetId.startsWith("overlay.tile.")) {
    const parts = assetId.split(".");
    const semantic = parts[2];
    const kind = parts[4];
    const color = PALETTE.affinity[kind] || PALETTE.white;
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    if (semantic === "wall") {
      drawLine(pixels, size, 2, 9, size - 3, 12, color);
      drawLine(pixels, size, 0, 22, size - 1, 18, color);
      drawLine(pixels, size, 10, 0, 12, size - 1, color);
    } else {
      drawCircle(pixels, size, Math.floor(size / 2), Math.floor(size / 2), Math.max(5, Math.floor(size * 0.32)), [color[0], color[1], color[2], 150]);
      drawLine(pixels, size, 6, 20, 14, 12, color);
      drawLine(pixels, size, 14, 12, 24, 8, color);
    }
    return pixels;
  }
  if (assetId.startsWith("overlay.expression.")) {
    const expression = assetId.slice("overlay.expression.".length);
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    if (expression === "emit") {
      drawCircle(pixels, size, 24, 24, 4, PALETTE.white);
      drawCircle(pixels, size, 24, 24, 2, PALETTE.black);
    } else if (expression === "pull") {
      drawLine(pixels, size, 26, 24, 18, 24, PALETTE.white);
      drawLine(pixels, size, 18, 24, 22, 20, PALETTE.white);
      drawLine(pixels, size, 18, 24, 22, 28, PALETTE.white);
    } else if (expression === "draw") {
      drawLine(pixels, size, 24, 30, 24, 18, PALETTE.white);
      drawLine(pixels, size, 24, 18, 20, 22, PALETTE.white);
      drawLine(pixels, size, 24, 18, 28, 22, PALETTE.white);
      drawCircle(pixels, size, 24, 30, 3, PALETTE.white);
    } else {
      drawLine(pixels, size, 18, 24, 26, 24, PALETTE.white);
      drawLine(pixels, size, 26, 24, 22, 20, PALETTE.white);
      drawLine(pixels, size, 26, 24, 22, 28, PALETTE.white);
    }
    return pixels;
  }
  if (assetId.startsWith("overlay.stack-tier.")) {
    const tier = assetId.slice("overlay.stack-tier.".length);
    const count = tier === "tier3" ? 3 : tier === "tier2" ? 2 : 1;
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    for (let index = 0; index < count; index += 1) {
      drawCircle(pixels, size, 5, 8 + index * 7, 2, PALETTE.white);
    }
    return pixels;
  }
  if (assetId.startsWith("overlay.motivation.")) {
    const motivation = assetId.slice("overlay.motivation.".length);
    const colors = Object.values(PALETTE.affinity);
    const color = colors[Math.abs(motivation.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colors.length];
    fillRect(pixels, size, 0, 0, size, size, [0, 0, 0, 0]);
    fillRect(pixels, size, 2, 2, 8, 8, color);
    drawLine(pixels, size, 3, 9, 9, 3, PALETTE.white);
    return pixels;
  }
  if (assetId.startsWith("overlay.darkness-mask")) {
    fillRect(pixels, size, 0, 0, size, size, [6, 8, 10, 180]);
    return pixels;
  }
  if (assetId.startsWith("card.")) {
    checker(pixels, size, size, hexToRgba("#eadfc5"), hexToRgba("#dbcda9"), 4);
    fillRect(pixels, size, 6, 6, 20, 20, hexToRgba("#55412e"));
    drawBorder(pixels, size, 0, 0, size, PALETTE.border);
    return pixels;
  }
  fillRect(pixels, size, 0, 0, size, size, hexToRgba("#555555"));
  return pixels;
}

function alphaBlend(dst, src) {
  const srcAlpha = src[3] / 255;
  const dstAlpha = dst[3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  if (outAlpha <= 0) return [0, 0, 0, 0];
  return [
    Math.round((src[0] * srcAlpha + dst[0] * dstAlpha * (1 - srcAlpha)) / outAlpha),
    Math.round((src[1] * srcAlpha + dst[1] * dstAlpha * (1 - srcAlpha)) / outAlpha),
    Math.round((src[2] * srcAlpha + dst[2] * dstAlpha * (1 - srcAlpha)) / outAlpha),
    Math.round(outAlpha * 255),
  ];
}

function blitSprite(target, targetWidth, targetHeight, sprite, spriteSize, destX, destY, opacity = 1) {
  const alphaScale = Math.max(0, Math.min(1, Number(opacity) || 0));
  if (alphaScale <= 0) return;
  for (let y = 0; y < spriteSize; y += 1) {
    for (let x = 0; x < spriteSize; x += 1) {
      const tx = destX + x;
      const ty = destY + y;
      if (tx < 0 || ty < 0 || tx >= targetWidth || ty >= targetHeight) continue;
      const spriteIndex = (y * spriteSize + x) * 4;
      const src = [
        sprite[spriteIndex],
        sprite[spriteIndex + 1],
        sprite[spriteIndex + 2],
        Math.round(sprite[spriteIndex + 3] * alphaScale),
      ];
      if (src[3] === 0) continue;
      const targetIndex = (ty * targetWidth + tx) * 4;
      const dst = [
        target[targetIndex],
        target[targetIndex + 1],
        target[targetIndex + 2],
        target[targetIndex + 3],
      ];
      const blended = alphaBlend(dst, src);
      target[targetIndex] = blended[0];
      target[targetIndex + 1] = blended[1];
      target[targetIndex + 2] = blended[2];
      target[targetIndex + 3] = blended[3];
    }
  }
}

function assetById(bundle, id) {
  return Array.isArray(bundle?.assets) ? bundle.assets.find((entry) => entry?.id === id) || null : null;
}

export function hasGeneratedResourceBundleAssets(bundle) {
  return Number(bundle?.schemaVersion) >= RESOURCE_BUNDLE_VERSION_V2
    && Array.isArray(bundle?.assets)
    && bundle.assets.some((asset) => typeof asset?.dataUri === "string" && typeof asset?.relativePath === "string");
}

export function listResourceBundleAssetFiles(bundle) {
  if (!hasGeneratedResourceBundleAssets(bundle)) {
    return [];
  }
  const files = [];
  const seen = new Set();
  const pushFile = (relativePathValue, dataUriValue) => {
    const relativePath = typeof relativePathValue === "string" ? relativePathValue.trim() : "";
    if (!relativePath || seen.has(relativePath)) return;
    const bytes = decodePngDataUri(dataUriValue);
    if (!(bytes instanceof Uint8Array)) return;
    seen.add(relativePath);
    files.push({ relativePath, bytes });
  };
  bundle.assets.forEach((asset) => {
    pushFile(asset?.relativePath, asset?.dataUri);
    Object.values(asset?.variants || {}).forEach((variant) => {
      pushFile(variant?.relativePath, variant?.dataUri);
    });
  });
  return files;
}

function resolveTileAssetId(bundle, char) {
  const semantic = inferTileSemantic(char);
  return bundle?.mappings?.tiles?.[semantic] || DEFAULT_TILE_ASSET_IDS[semantic] || DEFAULT_TILE_ASSET_IDS.floor;
}

function resolveActorAssetId(bundle, actor) {
  const role = inferActorRole(actor);
  const affinity = inferAffinity(actor);
  const variantId = bundle?.mappings?.actors?.byRoleAndAffinity?.[role]?.[affinity];
  if (variantId) {
    return variantId;
  }
  return bundle?.mappings?.actors?.[role] || DEFAULT_ACTOR_ASSET_IDS[role] || DEFAULT_ACTOR_ASSET_IDS.delver;
}

function resolveBadgeAssetId(bundle, category, key) {
  const normalized = typeof key === "string" ? key.trim().toLowerCase() : "";
  if (!normalized) return "";
  return bundle?.mappings?.[category]?.[normalized] || `${category.slice(0, -1)}.${normalized}`;
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = ((bn - rn) / delta) + 2;
    else h = ((rn - gn) / delta) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs((2 * l) - 1));
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs((2 * l) - 1)) * s;
  const hPrime = (h % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime >= 0 && hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function resolveAffinityFloorRgba(affinity) {
  const baseHex = AFFINITY_COLOR_HEX[affinity?.kind];
  if (!baseHex) return null;
  const baseRgba = hexToRgba(baseHex);
  const { h } = rgbToHsl(baseRgba[0], baseRgba[1], baseRgba[2]);
  const style = resolveStackIntensity(affinity?.stacks || 1);
  const sat = Math.max(0, Math.min(1, style.sat / 100));
  const light = Math.max(0, Math.min(1, style.light / 100));
  const [r, g, b] = hslToRgb(h, sat, light);
  return [r, g, b, 255];
}

function affinityPriority(kind) {
  const index = ALLOWED_AFFINITIES.indexOf(kind);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function normalizeTrapPosition(trap) {
  const x = Number(trap?.position?.x ?? trap?.x);
  const y = Number(trap?.position?.y ?? trap?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function normalizeTrapAffinityEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const kind = typeof entry.kind === "string" ? entry.kind.trim().toLowerCase() : "";
  if (!kind || !AFFINITY_COLOR_HEX[kind]) return null;
  const stacks = Math.max(1, Math.round(Number(entry.roomStacks ?? entry.stacks ?? entry.value) || 1));
  const expression = typeof entry.expression === "string" && entry.expression.trim()
    ? entry.expression.trim().toLowerCase()
    : "emit";
  const targetType = typeof entry.targetType === "string" ? entry.targetType.trim().toLowerCase() : "";
  return { kind, expression, stacks, targetType };
}

function collectTrapAffinities(trap) {
  const candidates = [];
  if (trap?.affinity && typeof trap.affinity === "object") {
    candidates.push(trap.affinity);
  }
  if (Array.isArray(trap?.affinities)) {
    candidates.push(...trap.affinities);
  }
  if (trap?.affinityTargets && typeof trap.affinityTargets === "object") {
    Object.entries(trap.affinityTargets).forEach(([key, stacks]) => {
      const parts = String(key).split(":");
      const kind = parts[0];
      const expression = parts[1] || "";
      const targetType = parts[2] || "";
      candidates.push({ kind, expression, stacks, targetType });
    });
  }
  if (trap?.affinityStacks && typeof trap.affinityStacks === "object") {
    Object.entries(trap.affinityStacks).forEach(([key, stacks]) => {
      const parts = String(key).split(":");
      const kind = parts[0];
      const expression = parts[1] || "";
      candidates.push({ kind, expression, stacks });
    });
  }
  return candidates
    .map(normalizeTrapAffinityEntry)
    .filter(Boolean)
    .sort((a, b) => {
      // Prefer floor target, then higher stacks, then defined render order.
      const targetScore = (entry) => (entry.targetType === "floor" ? 0 : 1);
      const targetDelta = targetScore(a) - targetScore(b);
      if (targetDelta !== 0) return targetDelta;
      if (b.stacks !== a.stacks) return b.stacks - a.stacks;
      return affinityPriority(a.kind) - affinityPriority(b.kind);
    });
}

function buildFloorAffinityMap(floorAffinityTraps = []) {
  const map = new Map();
  if (!Array.isArray(floorAffinityTraps)) return map;
  floorAffinityTraps.forEach((trap) => {
    const position = normalizeTrapPosition(trap);
    if (!position) return;
    const affinities = collectTrapAffinities(trap);
    const affinity = affinities.length > 0 ? affinities[0] : null;
    if (!affinity) return;
    const key = `${position.x},${position.y}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, affinity);
      return;
    }
    if (affinity.stacks > prior.stacks) {
      map.set(key, affinity);
      return;
    }
    if (affinity.stacks === prior.stacks && affinityPriority(affinity.kind) < affinityPriority(prior.kind)) {
      map.set(key, affinity);
    }
  });
  return map;
}

function chebyshevDistance(left, right) {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function resolveTileAffinityOverlayAssetId(bundle, semantic, kind) {
  if (!kind) return "";
  if (semantic !== "floor" && semantic !== "wall") {
    return bundle?.mappings?.overlays?.affinities?.[kind] || `overlay.affinity.${kind}`;
  }
  return bundle?.mappings?.tileEffects?.affinityOverlays?.[semantic]?.[kind]
    || bundle?.mappings?.overlays?.tileAffinities?.[semantic]?.[kind]
    || bundle?.mappings?.overlays?.affinities?.[kind]
    || `overlay.affinity.${kind}`;
}

function computeProjectionAlpha(distance, affinity) {
  if (distance <= 0) return 1;
  const expression = affinity?.expression || "emit";
  const buffer = SPATIAL_WEIGHTS?.intensity?.[expression]?.buffer || 0;
  return computeTileAlpha(distance + buffer, affinity?.stacks || 1, expression, SPATIAL_WEIGHTS);
}

function buildTileAffinityProjectionMap(floorAffinityTraps = [], tiles = [], widthTiles = 0, heightTiles = 0) {
  const map = new Map();
  if (!Array.isArray(floorAffinityTraps)) return map;

  floorAffinityTraps.forEach((trap) => {
    const position = normalizeTrapPosition(trap);
    if (!position) return;
    const affinities = collectTrapAffinities(trap);
    affinities.forEach((affinity) => {
      for (let y = 0; y < heightTiles; y += 1) {
        const row = String(tiles[y] || "").padEnd(widthTiles, "#");
        for (let x = 0; x < widthTiles; x += 1) {
          const semantic = inferTileSemantic(row[x] || "#");
          if (semantic !== "floor" && semantic !== "wall") continue;
          const distance = chebyshevDistance(position, { x, y });
          const alpha = computeProjectionAlpha(distance, affinity);
          if (alpha <= 0) continue;
          const key = `${x},${y}`;
          const projections = map.get(key) || [];
          projections.push({
            kind: affinity.kind,
            expression: affinity.expression,
            stacks: affinity.stacks,
            distance,
            alpha,
            semantic,
          });
          map.set(key, projections);
        }
      }
    });
  });

  map.forEach((projections) => {
    projections.sort((left, right) => {
      if (left.distance !== right.distance) return right.distance - left.distance;
      if (left.alpha !== right.alpha) return left.alpha - right.alpha;
      return affinityPriority(left.kind) - affinityPriority(right.kind);
    });
  });
  return map;
}

function applyAffinityTint(basePixels, width, tileX, tileY, tileWidth, tileHeight, affinityRgba, tintAlpha = 0.4) {
  if (!affinityRgba) return;
  for (let y = 0; y < tileHeight; y += 1) {
    for (let x = 0; x < tileWidth; x += 1) {
      const px = tileX * tileWidth + x;
      const py = tileY * tileHeight + y;
      if (px < 0 || py < 0 || px >= width || py >= basePixels.length / 4 / width * width) continue;
      const index = (py * width + px) * 4;
      if (index < 0 || index + 3 >= basePixels.length) continue;
      // Alpha blend the affinity color over the base floor tile
      basePixels[index] = Math.round(basePixels[index] * (1 - tintAlpha) + affinityRgba[0] * tintAlpha);
      basePixels[index + 1] = Math.round(basePixels[index + 1] * (1 - tintAlpha) + affinityRgba[1] * tintAlpha);
      basePixels[index + 2] = Math.round(basePixels[index + 2] * (1 - tintAlpha) + affinityRgba[2] * tintAlpha);
    }
  }
}

function resolveOverlayAssetIds(bundle, actor) {
  if (Number(bundle?.schemaVersion) < RESOURCE_BUNDLE_VERSION_V2) {
    const affinitySpriteId = resolveBadgeAssetId(bundle, "affinities", inferAffinity(actor));
    const motivationSpriteId = resolveBadgeAssetId(bundle, "motivations", inferMotivation(actor));
    return [affinitySpriteId, motivationSpriteId].filter(Boolean);
  }
  const overlays = bundle?.mappings?.overlays || {};
  const ids = [
    overlays?.motivations?.[inferMotivation(actor)],
    overlays?.affinities?.[inferAffinity(actor)],
    overlays?.expressions?.[inferExpression(actor)],
    overlays?.stackTiers?.[inferStackTier(actor)],
  ];
  return ids.filter(Boolean);
}

export async function renderBoardWithResourceBundle({
  tiles = [],
  actors = [],
  floorAffinityTraps = [],
  resourceBundle,
  loadAssetPixels,
  observation,
} = {}) {
  const widthTiles = Array.isArray(tiles) && tiles.length > 0
    ? tiles.reduce((max, row) => Math.max(max, String(row || "").length), 0)
    : 0;
  const heightTiles = Array.isArray(tiles) ? tiles.length : 0;
  if (widthTiles <= 0 || heightTiles <= 0) {
    return { ok: false, reason: "missing_tiles" };
  }
  const bundle = resourceBundle || createDefaultResourceBundleArtifact({
    createMeta: ({ producedBy = "resource-bundle", runId = "resource_bundle_render" } = {}) => ({
      id: `${producedBy}_${runId}`,
      runId,
      createdAt: "1970-01-01T00:00:00.000Z",
      producedBy,
    }),
  });
  const tileWidth = Number(bundle.tileWidth) || DEFAULT_RESOURCE_TILE_SIZE;
  const tileHeight = Number(bundle.tileHeight) || DEFAULT_RESOURCE_TILE_SIZE;
  const width = widthTiles * tileWidth;
  const height = heightTiles * tileHeight;
  const pixels = createPixelBuffer(width, height);
  const spriteCache = new Map();
  const sourceAffinityMap = buildFloorAffinityMap(floorAffinityTraps);
  const tileAffinityProjectionMap = buildTileAffinityProjectionMap(floorAffinityTraps, tiles, widthTiles, heightTiles);

  async function getSprite(assetId) {
    if (spriteCache.has(assetId)) return spriteCache.get(assetId);
    const asset = assetById(bundle, assetId);
    let next = null;
    if (typeof loadAssetPixels === "function" && asset) {
      try {
        next = await loadAssetPixels(asset, { tileWidth, tileHeight });
      } catch (_error) {
        next = null;
      }
    }
    if (!(next instanceof Uint8ClampedArray) || next.length !== tileWidth * tileHeight * 4) {
      next = buildSpriteForSemantic(assetId, tileWidth);
    }
    spriteCache.set(assetId, next);
    return next;
  }

  for (let y = 0; y < heightTiles; y += 1) {
    const row = String(tiles[y] || "").padEnd(widthTiles, "#");
    for (let x = 0; x < widthTiles; x += 1) {
      const assetId = resolveTileAssetId(bundle, row[x] || "#");
      const sprite = await getSprite(assetId);
      blitSprite(pixels, width, height, sprite, tileWidth, x * tileWidth, y * tileHeight);

      const projections = tileAffinityProjectionMap.get(`${x},${y}`) || [];
      for (const projection of projections) {
        const overlayAssetId = projection.distance === 0
          ? (bundle?.mappings?.overlays?.affinities?.[projection.kind] || `overlay.affinity.${projection.kind}`)
          : resolveTileAffinityOverlayAssetId(bundle, projection.semantic, projection.kind);
        const overlaySprite = await getSprite(overlayAssetId);
        blitSprite(pixels, width, height, overlaySprite, tileWidth, x * tileWidth, y * tileHeight, projection.alpha);
      }
    }
  }

  // Aura rendering pass (after trap tinting, before actors)
  if (observation?.auras && Array.isArray(observation.auras)) {
    const auraIndex = new Map();
    observation.auras.forEach((auraData) => {
      const key = `${auraData.x},${auraData.y}`;
      auraIndex.set(key, auraData);
    });

    for (let y = 0; y < heightTiles; y += 1) {
      const row = String(tiles[y] || "").padEnd(widthTiles, "#");
      for (let x = 0; x < widthTiles; x += 1) {
        const char = row[x] || "#";
        const semantic = inferTileSemantic(char);

        // Observation auras render on floor tiles; authored trap/source tiles keep their stronger authored overlay.
        if (semantic !== "floor") continue;
        const hasTrap = sourceAffinityMap.has(`${x},${y}`);
        if (hasTrap) continue;

        const auraData = auraIndex.get(`${x},${y}`);
        if (!auraData) continue;

        // Select mask function based on visualState
        const visualState = auraData.visualState || "emit";
        let maskFn = emitMask;
        if (visualState.includes("push")) maskFn = pushMask;
        else if (visualState.includes("pull")) maskFn = pullMask;
        else if (visualState.includes("draw")) maskFn = drawMask;

        // Resolve affinity color
        const affinityKind = auraData.affinityKind || auraData.kind;
        const affinityHex = AFFINITY_COLOR_HEX[affinityKind];
        if (!affinityHex) continue;
        const affinityRgba = hexToRgba(affinityHex);

        // Compute mask alpha from intensity and stacks
        const intensity = auraData.intensity ?? 1.0;
        const stacks = auraData.stacks ?? 1;
        const stackAlpha = stackAlphaMultiplier(stacks, SPATIAL_WEIGHTS);
        const maskAlpha = intensity * stackAlpha;

        // Apply aura mask
        const tilePixelX = x * tileWidth;
        const tilePixelY = y * tileHeight;
        const maskFnWithWeights = (u, v) => maskFn(u, v, SPATIAL_WEIGHTS);
        applyAuraMask(
          pixels,
          width,
          tilePixelX,
          tilePixelY,
          tileWidth,
          affinityRgba,
          maskFnWithWeights,
          maskAlpha
        );
      }
    }
  }

  const sortedActors = Array.isArray(actors)
    ? actors.slice().sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))
    : [];
  for (const actor of sortedActors) {
    const x = Number(actor?.position?.x);
    const y = Number(actor?.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const sprite = await getSprite(resolveActorAssetId(bundle, actor));
    blitSprite(pixels, width, height, sprite, tileWidth, x * tileWidth, y * tileHeight);
    const overlayAssetIds = resolveOverlayAssetIds(bundle, actor);
    for (const overlayAssetId of overlayAssetIds) {
      const overlaySprite = await getSprite(overlayAssetId);
      if (Number(bundle?.schemaVersion) >= RESOURCE_BUNDLE_VERSION_V2) {
        blitSprite(pixels, width, height, overlaySprite, tileWidth, x * tileWidth, y * tileHeight);
      } else if (overlayAssetId.startsWith("affinity.")) {
        blitSprite(pixels, width, height, overlaySprite, tileWidth, x * tileWidth + tileWidth - 14, y * tileHeight + 2);
      } else if (overlayAssetId.startsWith("motivation.")) {
        blitSprite(pixels, width, height, overlaySprite, tileWidth, x * tileWidth + 2, y * tileHeight + tileHeight - 14);
      }
    }
  }

  return {
    ok: true,
    width,
    height,
    tileWidth,
    tileHeight,
    pixels,
    resourceBundle: bundle,
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

function encodePngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const lengthBytes = new Uint8Array(4);
  writeUint32(lengthBytes, 0, data.length);
  const crcBytes = new Uint8Array(4);
  writeUint32(crcBytes, 0, crc32(concatBytes([typeBytes, data])));
  return concatBytes([lengthBytes, typeBytes, data, crcBytes]);
}

function encodeDeflateStoreBlocks(data) {
  const blocks = [];
  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockLength = Math.min(65535, remaining);
    const finalFlag = offset + blockLength >= data.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = finalFlag;
    header[1] = blockLength & 0xff;
    header[2] = (blockLength >>> 8) & 0xff;
    const nlen = (~blockLength) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    blocks.push(header, data.slice(offset, offset + blockLength));
    offset += blockLength;
  }
  const zlibHeader = Uint8Array.from([0x78, 0x01]);
  const checksum = new Uint8Array(4);
  writeUint32(checksum, 0, adler32(data));
  return concatBytes([zlibHeader, ...blocks, checksum]);
}

export function encodeRgbaToPng({ width, height, pixels }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("encodeRgbaToPng requires positive width and height.");
  }
  if (!(pixels instanceof Uint8ClampedArray) && !(pixels instanceof Uint8Array)) {
    throw new Error("encodeRgbaToPng requires RGBA pixels.");
  }
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (stride + 1);
    raw[rawOffset] = 0;
    raw.set(pixels.slice(y * stride, y * stride + stride), rawOffset + 1);
  }
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = encodeDeflateStoreBlocks(raw);
  return concatBytes([
    PNG_SIGNATURE,
    encodePngChunk("IHDR", ihdr),
    encodePngChunk("IDAT", idat),
    encodePngChunk("IEND", new Uint8Array(0)),
  ]);
}
