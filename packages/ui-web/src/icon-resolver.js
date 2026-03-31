/**
 * icon-resolver.js
 * Resolves icons from resource bundle mappings, with text label fallback.
 */

/**
 * Unicode icon fallbacks for each category and key.
 * Used when no bundle is loaded or icon asset is missing.
 */
const DEFAULT_UI_ICON = "◈";

const TEXT_LABELS = Object.freeze({
  types: {
    room: "🏛️",
    delver: "⚔️",
    attacker: "⚔️",
    warden: "🛡️",
    defender: "🛡️",
    untyped: "◻️",
  },
  affinities: {
    fire: "🔥",
    water: "💧",
    earth: "🪨",
    wind: "🌪️",
    life: "🌿",
    decay: "🧪",
    corrode: "🧫",
    fortify: "🧱",
    light: "🌟",
    dark: "🌑",
  },
  expressions: {
    push: "⬆️",
    pull: "⬇️",
    emit: "📡",
  },
  motivations: {
    random: "🎲",
    stationary: "🧱",
    exploring: "🧭",
    attacking: "⚔️",
    defending: "🛡️",
    patrolling: "👣",
    reflexive: "⚡",
    goal_oriented: "🎯",
    strategy_focused: "♟️",
  },
  vitals: {
    health: "❤",
    mana: "💧",
    stamina: "⚡",
    durability: "🛡️",
  },
  ui: {
    "playing-surface": "◈",
    "card-builder": DEFAULT_UI_ICON,
    "game-preview": "◈",
    "system-console": "◈",
    "game-inspector": "◈",
  },
});

/**
 * Check if a dataUri string is valid and not a placeholder image.
 * Placeholder images are detected by checking for large, highly repetitive patterns
 * that suggest solid-color fill images rather than actual icon graphics.
 * @param {string} dataUri - The data URI to validate
 * @returns {boolean} - True if valid and not a placeholder, false otherwise
 */
function isValidDataUri(dataUri) {
  if (typeof dataUri !== "string" || dataUri.trim().length === 0 || !dataUri.trim().startsWith("data:")) {
    return false;
  }

  // Extract base64 content after the comma in data URIs
  const base64Match = dataUri.match(/^data:[^,]*,(.+)$/);
  if (!base64Match) return false;

  const base64Content = base64Match[1];

  // Detect placeholder images:
  // Images >100 chars with highly repetitive patterns suggest placeholders
  // Very short test fixture strings (<100 chars) are allowed through
  if (base64Content.length > 100) {
    // Check if the base64 has repeating patterns like "VVVV" (0x55 grey)
    const repetitivePatterns = [
      /VVV[VU]/g,  // Matches grey placeholder (0x555555)
      /\/\/\/\//g,  // Matches white placeholder (0xFFFFFF)
    ];

    for (const pattern of repetitivePatterns) {
      const matches = base64Content.match(pattern);
      // If we see the same pattern repeated more than 15 times, it's likely a placeholder
      if (matches && matches.length > 15) {
        return false;
      }
    }
  }

  return true;
}

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

    if (asset?.dataUri && isValidDataUri(asset.dataUri)) {
      const img = document.createElement("img");
      img.src = asset.dataUri;
      img.alt = key;
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
  const fallbackLabel = TEXT_LABELS[category]?.[key] || DEFAULT_UI_ICON;
  span.textContent = fallbackLabel;
  return span;
}

/**
 * Resolve an icon and return it as a string (for textContent use).
 * @param {Object|null} bundle - ResourceBundleArtifact or null
 * @param {string} category - Icon category
 * @param {string} key - Icon key within the category
 * @returns {string} - Unicode icon or data URI
 */
export function resolveIconHTML(bundle, category, key) {
  // Try to find icon in bundle
  if (bundle?.mappings?.icons?.[category]?.[key]) {
    const assetId = bundle.mappings.icons[category][key];
    const asset = (bundle.assets || []).find((a) => a.id === assetId);

    if (asset?.dataUri && isValidDataUri(asset.dataUri)) {
      // Return img tag as HTML for data URIs
      return `<img src="${asset.dataUri}" alt="${key}" class="icon-from-bundle" style="width:1em;height:1em;vertical-align:middle;display:inline-block">`;
    }
  }

  // Fallback to Unicode icon - never return raw key text
  return TEXT_LABELS[category]?.[key] || DEFAULT_UI_ICON;
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
