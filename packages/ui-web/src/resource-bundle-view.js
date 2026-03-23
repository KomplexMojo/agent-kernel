import { renderBoardWithResourceBundle } from "../../runtime/src/render/resource-bundle.js";

const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";
const assetPixelCache = new Map();

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema) || null;
}

function ensureCanvas(canvas) {
  if (!canvas) return null;
  const context = canvas.getContext?.("2d");
  if (!context) return null;
  return context;
}

async function loadAssetPixelsFromDataUri(asset, { tileWidth = 32, tileHeight = 32 } = {}) {
  const dataUri = typeof asset?.dataUri === "string" ? asset.dataUri.trim() : "";
  if (!dataUri) return null;
  const cacheKey = `${asset?.id || "asset"}:${tileWidth}x${tileHeight}:${dataUri}`;
  if (assetPixelCache.has(cacheKey)) {
    return assetPixelCache.get(cacheKey);
  }
  if (typeof Image === "undefined" || typeof document?.createElement !== "function") {
    return null;
  }

  const pending = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scratch = document.createElement("canvas");
        scratch.width = tileWidth;
        scratch.height = tileHeight;
        const context = scratch.getContext?.("2d");
        if (!context) {
          resolve(null);
          return;
        }
        context.clearRect(0, 0, tileWidth, tileHeight);
        context.drawImage(image, 0, 0, tileWidth, tileHeight);
        const imageData = context.getImageData(0, 0, tileWidth, tileHeight);
        resolve(new Uint8ClampedArray(imageData.data));
      } catch (_error) {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUri;
  });

  assetPixelCache.set(cacheKey, pending);
  return pending;
}

export async function renderBundleBoardToCanvas({
  canvas,
  tiles = [],
  actors = [],
  bundle = null,
} = {}) {
  const resourceBundle = findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA) || null;
  const rendered = await renderBoardWithResourceBundle({
    tiles,
    actors,
    resourceBundle,
    loadAssetPixels: loadAssetPixelsFromDataUri,
  });
  if (!rendered?.ok) {
    return rendered;
  }
  const ctx = ensureCanvas(canvas);
  if (!ctx) {
    return { ok: false, reason: "missing_canvas_context" };
  }
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const imageData = ctx.createImageData(rendered.width, rendered.height);
  imageData.data.set(rendered.pixels);
  ctx.putImageData(imageData, 0, 0);
  return rendered;
}

export function clearBundleCanvas(canvas) {
  const ctx = ensureCanvas(canvas);
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
}

export function positionFromCanvasEvent(event, canvas, { tileWidth = 32, tileHeight = 32 } = {}) {
  if (!event || !canvas || typeof canvas.getBoundingClientRect !== "function") return null;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  const x = Math.floor((event.clientX - rect.left) * scaleX / tileWidth);
  const y = Math.floor((event.clientY - rect.top) * scaleY / tileHeight);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
