/**
 * icon-resolver.js
 * Resolves icons from resource bundle mappings, with text label fallback.
 */
import { GAME_ICON_FALLBACKS } from "../../runtime/src/contracts/game-elements.js";
import { buildIconModel } from "../../runtime/src/render/icon-model.js";

/**
 * Unicode icon fallbacks for each category and key.
 * Used when no bundle is loaded or icon asset is missing.
 */
const DEFAULT_UI_ICON = "◈";

/**
 * Chip geometry, in a 0..100 viewBox so one SVG scales to every chip size in the
 * UI (1em inline through 28px rail chips) without a raster step.
 *
 * The old icons were PNGs with an opaque background baked in, forced to
 * `width: 100% !important` inside the chip. The art's square background covered
 * the chip's ring and matched its fill, so the chip read as a solid block with
 * the glyph jammed edge to edge -- no containment, no breathing room. Here the
 * background IS the chip: a disc washed toward the element colour, with the
 * glyph inset inside it.
 */
const CHIP = Object.freeze({
  wash: 0.2,      // how far the disc is tinted toward the element colour
  inset: 0.58,    // glyph size as a fraction of the disc
  outline: 4.5,   // outline width in viewBox units
});

/** Glyph paths in a 0..100 viewBox, centred on (50,50) at the inset radius. */
function glyphPath(shape, r) {
  const c = 50;
  switch (shape) {
    case "delver":   return `M ${c} ${c - r} L ${c + r} ${c + r * 0.78} L ${c - r} ${c + r * 0.78} Z`;
    case "hazard":   return `M ${c} ${c + r} L ${c - r} ${c - r * 0.78} L ${c + r} ${c - r * 0.78} Z`;
    case "resource": return `M ${c} ${c - r} L ${c + r} ${c} L ${c} ${c + r} L ${c - r} ${c} Z`;
    case "warden": {
      const pts = [];
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(`${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`);
      }
      return `M ${pts.join(" L ")} Z`;
    }
    case "room": {
      const s = r * 0.92;
      return `M ${c - s} ${c - s} L ${c + s} ${c - s} L ${c + s} ${c + s} L ${c - s} ${c + s} Z`;
    }
    case "bar": {
      const h = r * 0.42, w = r * 0.98;
      return `M ${c - w} ${c - h} L ${c + w} ${c - h} L ${c + w} ${c + h} L ${c - w} ${c + h} Z`;
    }
    case "mark":
    default: {
      // Circle as a path so every shape uses one element and one code path.
      return `M ${c - r} ${c} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    }
  }
}

/**
 * Expression glyphs are stroked, not filled, so they return whole markup rather
 * than a single path. push/pull are chevrons with a stem; emit/draw are rays that
 * differ by their CORE -- solid versus hollow. An earlier attempt distinguished
 * them by ray direction alone, which is invisible at chip size.
 */
function expressionMarkup(shape, ink) {
  const c = 50;
  if (shape === "push" || shape === "pull") {
    const d = shape === "push" ? 1 : -1;
    return `<path d="M ${c - 13 * d} ${c - 26} L ${c + 17 * d} ${c} L ${c - 13 * d} ${c + 26}" fill="none"`
      + ` stroke="${ink}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<line x1="${c - 24 * d}" y1="${c}" x2="${c + 4 * d}" y2="${c}" stroke="${ink}" stroke-width="9" stroke-linecap="round"/>`;
  }
  const out = shape === "emit";
  let rays = "";
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    const r1 = out ? 24 : 40;
    const r2 = out ? 40 : 24;
    rays += `<line x1="${(c + r1 * Math.cos(a)).toFixed(1)}" y1="${(c + r1 * Math.sin(a)).toFixed(1)}"`
      + ` x2="${(c + r2 * Math.cos(a)).toFixed(1)}" y2="${(c + r2 * Math.sin(a)).toFixed(1)}"`
      + ` stroke="${ink}" stroke-width="7" stroke-linecap="round"/>`;
  }
  return rays + (out
    ? `<circle cx="${c}" cy="${c}" r="15" fill="${ink}"/>`
    : `<circle cx="${c}" cy="${c}" r="14" fill="none" stroke="${ink}" stroke-width="8"/>`);
}

const EXPRESSION_SHAPES = ["push", "pull", "emit", "draw"];

/**
 * Build the chip SVG markup for a generated icon model.
 * `color-mix` gives the wash without needing to know the surrounding card colour.
 */
function iconSvg(model, label) {
  const r = 50 * CHIP.inset;
  const ink = model.inkHex || model.colorHex;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="icon-generated"`
    + ` role="img" aria-label="${label}" width="64" height="64" style="display:block">`;
  const disc = `<circle cx="50" cy="50" r="49" fill="${model.colorHex}" fill-opacity="${CHIP.wash}"/>`;

  // A monochrome mark in the same chip. Motivations are abstract, so they stay
  // typographic; drawn as SVG text so the card rail can rasterise one code path.
  if (model.kind === "glyph") {
    return `${open}${disc}<text x="50" y="50" text-anchor="middle" dominant-baseline="central"`
      + ` font-size="54" fill="${ink}"`
      + ` font-family="system-ui, -apple-system, 'Segoe UI Symbol', sans-serif">${model.mark}</text></svg>`;
  }
  if (EXPRESSION_SHAPES.includes(model.shape)) {
    return `${open}${disc}${expressionMarkup(model.shape, ink)}</svg>`;
  }
  // A translucent fill of the element colour, NOT color-mix on currentColor: the
  // same markup is rasterised into a Phaser texture for the card rail, where there
  // is no inherited colour to mix against. fill-opacity composites over whatever
  // is behind it in both cases.
  // Explicit pixel dimensions, NOT width="100%". The same markup is rasterised
  // into a Phaser texture, and a percentage has no containing block there, so the
  // image has no intrinsic size and renders as an empty box. CSS scales it back.
  const stroke = model.outlineHex
    ? ` stroke="${model.outlineHex}" stroke-width="${CHIP.outline}" stroke-linejoin="round"`
    : "";
  return `${open}${disc}<path d="${glyphPath(model.shape, r)}" fill="${ink}"${stroke}/></svg>`;
}


const TEXT_LABELS = GAME_ICON_FALLBACKS;

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
 * @param {string} category - Icon category: "types", "items", "affinities", "expressions", "motivations", "vitals", "ui"
 * @param {string} key - Icon key within the category
 * @returns {HTMLElement} - <img> element with dataUri or <span> with text label
 */
export function resolveIcon(bundle, category, key) {
  // Generated first, and deliberately ahead of the bundle. Bundle icons are
  // medallion-era art in the retired visual language; where the sprite language
  // can speak for a category, it wins, and it needs no bundle to do it.
  const model = buildIconModel(category, key);
  if (model?.kind === "shape" || model?.kind === "glyph") {
    const span = document.createElement("span");
    span.className = "icon-generated-wrap";
    span.innerHTML = iconSvg(model, String(key));
    if (span.style) {
      span.style.display = "inline-flex";
      span.style.width = "100%";
      span.style.height = "100%";
    }
    return span;
  }

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
  // See resolveIcon: generated beats bundle art for the categories the sprite
  // language covers. Expressions, motivations and ui fall through to unicode,
  // because the language has no mark for them and inventing one is design work.
  const model = buildIconModel(category, key);
  if (model?.kind === "shape" || model?.kind === "glyph") return iconSvg(model, String(key));

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
