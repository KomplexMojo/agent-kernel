function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function titleLabel(value) {
  return String(value || "")
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function relativePathForGameAssetId(assetId) {
  const id = String(assetId || "").trim();
  if (id.startsWith("overlay.tile.")) {
    const parts = id.split(".");
    const tile = parts[2] || "tile";
    const affinity = parts[4] || "unknown";
    return `visual-assets/tiles/overlays/${tile}-affinity-${affinity}.png`;
  }
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

function ipfsUriForAssetId(assetId, version = 2) {
  const slug = String(assetId || "").replace(/\./g, "-");
  return `ipfs://ak-resource-bundle-v${version}/${slug}.png`;
}

function element({
  group,
  key,
  label = titleLabel(key),
  unicodeIcon,
  defaultColor,
  description,
  assetId,
  assetKind,
  legacyAssetId = "",
  iconAssetId = "",
  imageRelativePath,
  imageIpfsUri,
  meta,
}) {
  const resolvedAssetId = assetId || iconAssetId || legacyAssetId || key;
  return {
    id: `${group}.${key}`,
    group,
    key,
    label,
    unicodeIcon,
    assetId: resolvedAssetId,
    assetKind,
    legacyAssetId,
    iconAssetId,
    defaultColor,
    description,
    imageResource: {
      assetId: resolvedAssetId,
      relativePath: imageRelativePath || relativePathForGameAssetId(resolvedAssetId),
      ipfsUri: imageIpfsUri || ipfsUriForAssetId(resolvedAssetId, 2),
    },
    ...(meta ? { meta } : {}),
  };
}

function byKey(entries) {
  return Object.fromEntries(entries.map((entry) => [entry.key, entry]));
}

export const GAME_AFFINITY_KINDS = Object.freeze([
  "fire",
  "water",
  "earth",
  "wind",
  "life",
  "decay",
  "corrode",
  "fortify",
  "light",
  "dark",
]);

export const GAME_AFFINITY_EXPRESSIONS = Object.freeze(["push", "pull", "emit", "draw"]);
export const GAME_VITAL_KEYS = Object.freeze(["health", "mana", "stamina", "durability"]);

export const GAME_MOTIVATION_FAMILIES = deepFreeze({
  mobility: ["random", "stationary", "exploring", "patrolling"],
  posture: ["attacking", "defending", "stealthy", "friendly"],
  cognition: ["reflexive", "goal_oriented", "strategy_focused"],
  control: ["user_controlled"],
});

export const GAME_MOTIVATION_KINDS = Object.freeze([
  ...GAME_MOTIVATION_FAMILIES.mobility,
  ...GAME_MOTIVATION_FAMILIES.posture,
  ...GAME_MOTIVATION_FAMILIES.cognition,
  ...GAME_MOTIVATION_FAMILIES.control,
]);

export const GAME_MOTIVATION_KIND_IDS = deepFreeze(
  Object.fromEntries(GAME_MOTIVATION_KINDS.map((kind) => [kind, `motivation_${kind}`])),
);

export const GAME_MOTIVATION_DISPLAY_GROUPS = deepFreeze([
  { id: "mobility_random_stationary", kinds: ["random", "stationary"] },
  { id: "mobility_exploring_patrolling", kinds: ["exploring", "patrolling"] },
  { id: "posture_attacking_defending", kinds: ["attacking", "defending"] },
  { id: "posture_stealthy_friendly", kinds: ["stealthy", "friendly"] },
  { id: "cognition_reflexive_goal_oriented", kinds: ["reflexive", "goal_oriented"] },
  { id: "cognition_strategy_focused", kinds: ["strategy_focused"] },
  { id: "control_user_controlled", kinds: ["user_controlled"] },
]);

const AFFINITY_COLORS = Object.freeze({
  fire: "#f05a28",
  water: "#2b7fff",
  earth: "#7a5c33",
  wind: "#8fd3ff",
  life: "#49b96b",
  decay: "#6f7b46",
  corrode: "#7fbf42",
  fortify: "#8c6dd7",
  light: "#f5d14d",
  dark: "#3a2a57",
});

const VITAL_COLORS = Object.freeze({
  health: "#ff4455",
  mana: "#4499ff",
  stamina: "#44cc77",
  durability: "#ffaa33",
  defence: "#ffaa33",
});

const GAME_ELEMENT_VISUALS_VALUE = {
  tiles: byKey([
    element({
      group: "tiles",
      key: "floor",
      unicodeIcon: ".",
      defaultColor: "#241f22",
      assetId: "tile.floor",
      assetKind: "tile",
      description: "Walkable dungeon floor tile.",
    }),
    element({
      group: "tiles",
      key: "wall",
      unicodeIcon: "#",
      defaultColor: "#3b3237",
      assetId: "tile.wall",
      assetKind: "tile",
      description: "Blocking dungeon wall tile.",
    }),
    element({
      group: "tiles",
      key: "barrier",
      unicodeIcon: "B",
      defaultColor: "#654a3d",
      assetId: "tile.barrier",
      assetKind: "tile",
      description: "Constructed obstacle or temporary barrier.",
    }),
    element({
      group: "tiles",
      key: "spawn",
      unicodeIcon: "S",
      defaultColor: "#2b5f48",
      assetId: "tile.spawn",
      assetKind: "tile",
      description: "Starting tile or entry point.",
    }),
    element({
      group: "tiles",
      key: "exit",
      unicodeIcon: "E",
      defaultColor: "#83704d",
      assetId: "tile.exit",
      assetKind: "tile",
      description: "Exit tile or level objective.",
    }),
    element({
      group: "tiles",
      key: "inaccessible",
      unicodeIcon: "X",
      defaultColor: "#101113",
      assetId: "tile.inaccessible",
      assetKind: "tile",
      description: "Void or inaccessible map space.",
    }),
    element({
      group: "tiles",
      key: "fog",
      unicodeIcon: "?",
      defaultColor: "#12181c",
      assetId: "tile.fog",
      assetKind: "tile",
      description: "Fog-of-war or obscured tile.",
    }),
  ]),
  actors: byKey([
    element({
      group: "actors",
      key: "delver",
      unicodeIcon: "○",
      defaultColor: "#d8d2bf",
      assetId: "actor.delver",
      assetKind: "actor",
      description: "Mobile explorer actor trying to traverse the dungeon.",
    }),
    element({
      group: "actors",
      key: "warden",
      unicodeIcon: "△",
      defaultColor: "#b18edc",
      assetId: "actor.warden",
      assetKind: "actor",
      description: "Defensive actor controlling dungeon space.",
    }),
  ]),
  items: byKey([
    element({
      group: "items",
      key: "hazard",
      unicodeIcon: "☠",
      defaultColor: "#b85a4a",
      assetId: "item.hazard",
      assetKind: "item",
      description: "Static danger source, trap, or hostile environmental object.",
    }),
    element({
      group: "items",
      key: "resource",
      unicodeIcon: "◆",
      defaultColor: "#49b96b",
      assetId: "item.resource",
      assetKind: "item",
      description: "Collectible or usable dungeon resource.",
    }),
  ]),
  cards: byKey([
    element({
      group: "cards",
      key: "room",
      unicodeIcon: "□",
      defaultColor: "#83704d",
      assetId: "card.room",
      assetKind: "card",
      description: "Room card or authored dungeon-space template.",
    }),
    element({
      group: "cards",
      key: "delver",
      unicodeIcon: "○",
      defaultColor: "#d8d2bf",
      assetId: "card.delver",
      assetKind: "card",
      description: "Delver card template.",
    }),
    element({
      group: "cards",
      key: "warden",
      unicodeIcon: "△",
      defaultColor: "#b18edc",
      assetId: "card.warden",
      assetKind: "card",
      description: "Warden card template.",
    }),
  ]),
  types: byKey([
    element({
      group: "types",
      key: "room",
      unicodeIcon: "□",
      defaultColor: "#83704d",
      assetId: "icon.type.room",
      assetKind: "icon",
      description: "Room type marker.",
    }),
    element({
      group: "types",
      key: "delver",
      unicodeIcon: "○",
      defaultColor: "#d8d2bf",
      assetId: "icon.type.delver",
      assetKind: "icon",
      description: "Delver type marker.",
    }),
    element({
      group: "types",
      key: "attacker",
      unicodeIcon: "!",
      defaultColor: "#f05a28",
      assetId: "icon.type.attacker",
      assetKind: "icon",
      description: "Attacker type marker.",
    }),
    element({
      group: "types",
      key: "warden",
      unicodeIcon: "△",
      defaultColor: "#b18edc",
      assetId: "icon.type.warden",
      assetKind: "icon",
      description: "Warden type marker.",
    }),
    element({
      group: "types",
      key: "defender",
      unicodeIcon: "▣",
      defaultColor: "#8c6dd7",
      assetId: "icon.type.defender",
      assetKind: "icon",
      description: "Defender type marker.",
    }),
    element({
      group: "types",
      key: "hazard",
      unicodeIcon: "☠",
      defaultColor: "#b85a4a",
      assetId: "icon.type.hazard",
      assetKind: "icon",
      description: "Hazard type marker.",
    }),
    element({
      group: "types",
      key: "untyped",
      unicodeIcon: "◇",
      defaultColor: "#8a8588",
      assetId: "icon.type.untyped",
      assetKind: "icon",
      description: "Fallback type marker.",
    }),
  ]),
  affinities: byKey(
    GAME_AFFINITY_KINDS.map((kind) => element({
      group: "affinities",
      key: kind,
      label: `${titleLabel(kind)} Affinity`,
      unicodeIcon: {
        fire: "♨",
        water: "◍",
        earth: "◆",
        wind: "〰",
        life: "♧",
        decay: "☠",
        corrode: "◌",
        fortify: "⬟",
        light: "✦",
        dark: "☾",
      }[kind],
      defaultColor: AFFINITY_COLORS[kind],
      assetId: `overlay.affinity.${kind}`,
      legacyAssetId: `affinity.${kind}`,
      iconAssetId: `icon.affinity.${kind}`,
      assetKind: "overlay",
      description: `${titleLabel(kind)} affinity glyph and color identity.`,
    })),
  ),
  affinityStacks: byKey([
    element({
      group: "affinityStacks",
      key: "tier1",
      label: "Stack Tier 1",
      unicodeIcon: "①",
      defaultColor: "#8a8588",
      assetId: "overlay.stack-tier.tier1",
      assetKind: "overlay",
      description: "Low intensity affinity stack marker.",
    }),
    element({
      group: "affinityStacks",
      key: "tier2",
      label: "Stack Tier 2",
      unicodeIcon: "②",
      defaultColor: "#8c6dd7",
      assetId: "overlay.stack-tier.tier2",
      assetKind: "overlay",
      description: "Medium intensity affinity stack marker.",
    }),
    element({
      group: "affinityStacks",
      key: "tier3",
      label: "Stack Tier 3",
      unicodeIcon: "③",
      defaultColor: "#f5d14d",
      assetId: "overlay.stack-tier.tier3",
      assetKind: "overlay",
      description: "High intensity affinity stack marker.",
    }),
  ]),
  affinityExpressions: byKey(
    GAME_AFFINITY_EXPRESSIONS.map((kind) => element({
      group: "affinityExpressions",
      key: kind,
      label: `${titleLabel(kind)} Expression`,
      unicodeIcon: {
        push: "⇢",
        pull: "⇠",
        emit: "⊙",
        draw: "⟲",
      }[kind],
      defaultColor: {
        push: "#f05a28",
        pull: "#2b7fff",
        emit: "#f5d14d",
        draw: "#8c6dd7",
      }[kind],
      assetId: `overlay.expression.${kind}`,
      legacyAssetId: `expression.${kind}`,
      iconAssetId: `icon.expression.${kind}`,
      assetKind: "overlay",
      description: `${titleLabel(kind)} affinity expression marker.`,
    })),
  ),
  motivations: byKey(
    GAME_MOTIVATION_KINDS.map((kind) => element({
      group: "motivations",
      key: kind,
      label: `${titleLabel(kind)} Motivation`,
      unicodeIcon: {
        random: "?",
        stationary: "■",
        exploring: "⌖",
        patrolling: "◇",
        attacking: "!",
        defending: "▣",
        stealthy: "◐",
        friendly: "+",
        reflexive: "↯",
        goal_oriented: "◎",
        strategy_focused: "♟",
        user_controlled: "◉",
      }[kind],
      defaultColor: {
        random: "#8a8588",
        stationary: "#7a5c33",
        exploring: "#8fd3ff",
        patrolling: "#49b96b",
        attacking: "#f05a28",
        defending: "#8c6dd7",
        stealthy: "#3a2a57",
        friendly: "#49b96b",
        reflexive: "#f5d14d",
        goal_oriented: "#2b7fff",
        strategy_focused: "#8c6dd7",
        user_controlled: "#d8d2bf",
      }[kind],
      assetId: `overlay.motivation.${kind}`,
      legacyAssetId: `motivation.${kind}`,
      iconAssetId: `icon.motivation.${kind}`,
      assetKind: "overlay",
      description: `${titleLabel(kind)} actor motivation marker.`,
    })),
  ),
  vitals: byKey(
    [...GAME_VITAL_KEYS, "defence"].map((kind) => element({
      group: "vitals",
      key: kind,
      label: `${titleLabel(kind)} Vital`,
      unicodeIcon: {
        health: "♥",
        mana: "◆",
        stamina: "↯",
        durability: "▰",
        defence: "⬢",
      }[kind],
      defaultColor: VITAL_COLORS[kind],
      assetId: `icon.vital.${kind}`,
      assetKind: "icon",
      description: kind === "defence"
        ? "Legacy defense icon alias for durability-oriented UI surfaces."
        : `${titleLabel(kind)} vital meter and state marker.`,
    })),
  ),
  ui: byKey([
    element({
      group: "ui",
      key: "playing-surface",
      unicodeIcon: "▦",
      defaultColor: "#8a8588",
      assetId: "icon.ui.playing-surface",
      assetKind: "icon",
      description: "Playing surface navigation icon.",
    }),
    element({
      group: "ui",
      key: "card-builder",
      unicodeIcon: "▤",
      defaultColor: "#8a8588",
      assetId: "icon.ui.card-builder",
      assetKind: "icon",
      description: "Card builder navigation icon.",
    }),
    element({
      group: "ui",
      key: "game-preview",
      unicodeIcon: "▣",
      defaultColor: "#8a8588",
      assetId: "icon.ui.game-preview",
      assetKind: "icon",
      description: "Game preview navigation icon.",
    }),
    element({
      group: "ui",
      key: "system-console",
      unicodeIcon: "▥",
      defaultColor: "#8a8588",
      assetId: "icon.ui.system-console",
      assetKind: "icon",
      description: "System console navigation icon.",
    }),
    element({
      group: "ui",
      key: "game-inspector",
      unicodeIcon: "⌕",
      defaultColor: "#8a8588",
      assetId: "icon.ui.game-inspector",
      assetKind: "icon",
      description: "Game inspector navigation icon.",
    }),
  ]),
  overlays: byKey([
    element({
      group: "overlays",
      key: "darkness-mask",
      label: "Darkness Mask",
      unicodeIcon: "◑",
      defaultColor: "#101113",
      assetId: "overlay.darkness-mask",
      assetKind: "overlay",
      description: "Darkness and visibility mask overlay.",
    }),
  ]),
};

export const GAME_ELEMENT_VISUALS = deepFreeze(GAME_ELEMENT_VISUALS_VALUE);

function assetIdMap(group) {
  return Object.fromEntries(Object.entries(group).map(([key, value]) => [key, value.assetId]));
}

export const GAME_ELEMENT_ASSET_IDS = deepFreeze({
  tiles: assetIdMap(GAME_ELEMENT_VISUALS.tiles),
  actors: assetIdMap(GAME_ELEMENT_VISUALS.actors),
  items: assetIdMap(GAME_ELEMENT_VISUALS.items),
  cards: assetIdMap(GAME_ELEMENT_VISUALS.cards),
  stackTiers: assetIdMap(GAME_ELEMENT_VISUALS.affinityStacks),
  darknessMask: GAME_ELEMENT_VISUALS.overlays["darkness-mask"].assetId,
});

export const GAME_ELEMENT_ICON_KEYS = deepFreeze({
  types: Object.keys(GAME_ELEMENT_VISUALS.types),
  items: Object.keys(GAME_ELEMENT_VISUALS.items),
  motivations: Object.keys(GAME_ELEMENT_VISUALS.motivations),
  vitals: Object.keys(GAME_ELEMENT_VISUALS.vitals),
  ui: Object.keys(GAME_ELEMENT_VISUALS.ui),
});

export const GAME_AFFINITY_COLOR_HEX = deepFreeze(
  Object.fromEntries(
    Object.entries(GAME_ELEMENT_VISUALS.affinities).map(([kind, visual]) => [kind, visual.defaultColor]),
  ),
);

export const GAME_ICON_FALLBACKS = deepFreeze({
  types: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.types).map(([key, visual]) => [key, visual.unicodeIcon])),
  affinities: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.affinities).map(([key, visual]) => [key, visual.unicodeIcon])),
  items: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.items).map(([key, visual]) => [key, visual.unicodeIcon])),
  expressions: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.affinityExpressions).map(([key, visual]) => [key, visual.unicodeIcon])),
  motivations: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.motivations).map(([key, visual]) => [key, visual.unicodeIcon])),
  vitals: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.vitals).map(([key, visual]) => [key, visual.unicodeIcon])),
  ui: Object.fromEntries(Object.entries(GAME_ELEMENT_VISUALS.ui).map(([key, visual]) => [key, visual.unicodeIcon])),
});

function specForVisual(visual, { assetId = visual.assetId, kind = visual.assetKind, label = visual.label, version = 2 } = {}) {
  return {
    id: assetId,
    kind,
    label,
    ipfsUri: ipfsUriForAssetId(assetId, version),
    visualId: visual.id,
  };
}

function pushUniqueSpec(target, seen, spec) {
  if (!spec?.id || seen.has(spec.id)) return;
  seen.add(spec.id);
  target.push(spec);
}

export function getGameElementVisual(group, key) {
  return GAME_ELEMENT_VISUALS?.[group]?.[key] || null;
}

export function getGameElementVisualEntries() {
  return Object.values(GAME_ELEMENT_VISUALS).flatMap((group) => Object.values(group));
}

export function getResourceBundleAssetSpecs({ emitVisualAssets = false } = {}) {
  const specs = [];
  const seen = new Set();
  const push = (spec) => pushUniqueSpec(specs, seen, spec);
  const visuals = GAME_ELEMENT_VISUALS;

  ["floor", "wall", "barrier", "spawn", "exit", "inaccessible"].forEach((key) => {
    push(specForVisual(visuals.tiles[key], { version: 1 }));
  });
  Object.values(visuals.actors).forEach((visual) => push(specForVisual(visual, { version: 1 })));
  Object.values(visuals.items).forEach((visual) => push(specForVisual(visual, { version: 1 })));
  Object.values(visuals.cards).forEach((visual) => push(specForVisual(visual, { version: 1 })));

  if (!emitVisualAssets) {
    Object.values(visuals.affinities).forEach((visual) => {
      push(specForVisual(visual, {
        assetId: visual.legacyAssetId,
        kind: "affinity",
        label: visual.label,
        version: 1,
      }));
    });
    Object.values(visuals.motivations).forEach((visual) => {
      push(specForVisual(visual, {
        assetId: visual.legacyAssetId,
        kind: "motivation",
        label: visual.label,
        version: 1,
      }));
    });
    Object.values(visuals.affinityExpressions).forEach((visual) => {
      push(specForVisual(visual, {
        assetId: visual.legacyAssetId,
        kind: "expression",
        label: visual.label,
        version: 1,
      }));
    });
    return specs;
  }

  push(specForVisual(visuals.tiles.fog));
  Object.keys(visuals.affinities).forEach((affinity) => {
    ["delver", "warden"].forEach((role) => {
      const roleVisual = visuals.actors[role];
      push(specForVisual(roleVisual, {
        assetId: `actor.${role}.${affinity}`,
        kind: "actor",
        label: `${roleVisual.label} ${titleLabel(affinity)}`,
      }));
    });
    const affinityVisual = visuals.affinities[affinity];
    push(specForVisual(affinityVisual));
    push(specForVisual(affinityVisual, {
      assetId: `overlay.tile.floor.affinity.${affinity}`,
      kind: "overlay",
      label: `Floor ${titleLabel(affinity)} Affinity Overlay`,
    }));
    push(specForVisual(affinityVisual, {
      assetId: `overlay.tile.wall.affinity.${affinity}`,
      kind: "overlay",
      label: `Wall ${titleLabel(affinity)} Affinity Overlay`,
    }));
  });
  Object.values(visuals.affinityExpressions).forEach((visual) => push(specForVisual(visual)));
  Object.values(visuals.affinityStacks).forEach((visual) => push(specForVisual(visual)));
  Object.values(visuals.motivations).forEach((visual) => push(specForVisual(visual)));
  push(specForVisual(visuals.overlays["darkness-mask"]));

  Object.values(visuals.types).forEach((visual) => push(specForVisual(visual)));
  Object.values(visuals.items).forEach((visual) => {
    push(specForVisual(visual, {
      assetId: `icon.item.${visual.key}`,
      kind: "icon",
      label: `${visual.label} Icon`,
    }));
  });
  Object.values(visuals.affinities).forEach((visual) => {
    push(specForVisual(visual, {
      assetId: visual.iconAssetId,
      kind: "icon",
      label: `${visual.label} Icon`,
    }));
  });
  Object.values(visuals.affinityExpressions).forEach((visual) => {
    push(specForVisual(visual, {
      assetId: visual.iconAssetId,
      kind: "icon",
      label: `${visual.label} Icon`,
    }));
  });
  Object.values(visuals.motivations).forEach((visual) => {
    push(specForVisual(visual, {
      assetId: visual.iconAssetId,
      kind: "icon",
      label: `${visual.label} Icon`,
    }));
  });
  Object.values(visuals.vitals).forEach((visual) => push(specForVisual(visual)));
  Object.values(visuals.ui).forEach((visual) => push(specForVisual(visual)));

  return specs;
}
