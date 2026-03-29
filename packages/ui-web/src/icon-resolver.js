/**
 * icon-resolver.js
 * Resolves icons from resource bundle mappings, with text label fallback.
 */

/**
 * Text label fallbacks for each category and key.
 * Used when no bundle is loaded or icon asset is missing.
 */
const TEXT_LABELS = Object.freeze({
  types: {
    room: "Room",
    delver: "Delver",
    attacker: "Attacker",
    warden: "Warden",
    defender: "Defender",
    untyped: "Untyped",
  },
  affinities: {
    fire: "Fire",
    water: "Water",
    earth: "Earth",
    wind: "Wind",
    life: "Life",
    decay: "Decay",
    corrode: "Corrode",
    fortify: "Fortify",
    light: "Light",
    dark: "Dark",
  },
  expressions: {
    push: "Push",
    pull: "Pull",
    emit: "Emit",
  },
  motivations: {
    random: "Random",
    stationary: "Stationary",
    exploring: "Exploring",
    attacking: "Attacking",
    defending: "Defending",
    patrolling: "Patrolling",
    reflexive: "Reflexive",
    goal_oriented: "Goal",
    strategy_focused: "Strategy",
  },
  vitals: {
    health: "Health",
    mana: "Mana",
    stamina: "Stamina",
    durability: "Durability",
  },
  ui: {
    "playing-surface": "Playing Surface",
    "card-builder": "Card Builder",
    "game-preview": "Game Preview",
    "system-console": "System Console",
    "game-inspector": "Game Inspector",
  },
});

/**
 * Resolve an icon from the resource bundle or return a text fallback.
 * @param {Object|null} bundle - ResourceBundleArtifact or null
 * @param {string} category - Icon category: "types", "affinities", "expressions", "motivations", "vitals", "ui"
 * @param {string} key - Icon key within the category
 * @returns {HTMLElement} - <img> element with dataUri or <span> with text label
 */
export function resolveIcon(bundle, category, key) {
  // Try to find icon in bundle
  if (bundle?.mappings?.icons?.[category]?.[key]) {
    const assetId = bundle.mappings.icons[category][key];
    const asset = (bundle.assets || []).find((a) => a.id === assetId);

    if (asset?.dataUri) {
      const img = document.createElement("img");
      img.src = asset.dataUri;
      img.alt = TEXT_LABELS[category]?.[key] || key;
      img.className = "icon-from-bundle";
      img.style.width = "1em";
      img.style.height = "1em";
      img.style.verticalAlign = "middle";
      img.style.display = "inline-block";
      return img;
    }
  }

  // Fallback to text label
  const span = document.createElement("span");
  span.className = "icon-fallback-text";
  span.textContent = TEXT_LABELS[category]?.[key] || key;
  return span;
}

/**
 * Resolve an icon and return it as a string (for innerHTML use).
 * @param {Object|null} bundle - ResourceBundleArtifact or null
 * @param {string} category - Icon category
 * @param {string} key - Icon key within the category
 * @returns {string} - HTML string
 */
export function resolveIconHTML(bundle, category, key) {
  const element = resolveIcon(bundle, category, key);
  return element.outerHTML;
}

/**
 * Create an icon map for a category using the resolver.
 * Returns a Proxy that resolves icons on-demand.
 * @param {Object|null} bundle - ResourceBundleArtifact or null
 * @param {string} category - Icon category
 * @returns {Object} - Map-like object with icon getters
 */
export function createIconMap(bundle, category) {
  return new Proxy({}, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      return resolveIconHTML(bundle, category, key);
    },
  });
}
