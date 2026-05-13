import { AFFINITY_COLOR_HEX } from "../../../runtime/src/render/affinity-palette.js";
import {
  clearBundleCanvas,
  positionFromCanvasEvent,
  renderBundleBoardToCanvas,
} from "../resource-bundle-view.js";

export const PREVIEW_RENDERER_STORAGE_KEY = "agent-kernel.preview.renderer";
export const PREVIEW_RENDERER_IDS = Object.freeze({
  canvas: "canvas",
  phaser: "phaser",
});
const DEFAULT_TILE_SIZE = 32;
const phaserTextureLoads = new Map();

function parsePixelValue(value, fallback = 0) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isRendererId(value) {
  return value === PREVIEW_RENDERER_IDS.canvas || value === PREVIEW_RENDERER_IDS.phaser;
}

export function normalizePreviewRendererId(value) {
  return isRendererId(value) ? value : PREVIEW_RENDERER_IDS.canvas;
}

export function readPreviewRendererPreference(storage = globalThis.localStorage) {
  try {
    return normalizePreviewRendererId(storage?.getItem?.(PREVIEW_RENDERER_STORAGE_KEY));
  } catch (_error) {
    return PREVIEW_RENDERER_IDS.canvas;
  }
}

export function writePreviewRendererPreference(storage = globalThis.localStorage, rendererId) {
  const normalized = normalizePreviewRendererId(rendererId);
  try {
    storage?.setItem?.(PREVIEW_RENDERER_STORAGE_KEY, normalized);
  } catch (_error) {
    // Storage is optional in tests and locked-down browser contexts.
  }
  return normalized;
}

function hashText(input = "") {
  let hash = 0;
  const text = String(input);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function tileSymbolToType(symbol) {
  switch (symbol) {
    case "#":
      return "wall";
    case "B":
      return "barrier";
    case "S":
      return "spawn";
    case "E":
      return "exit";
    case "X":
    case " ":
      return "inaccessible";
    default:
      return "floor";
  }
}

function tileColorForType(type) {
  switch (type) {
    case "wall":
      return 0x3b3237;
    case "barrier":
      return 0x654a3d;
    case "spawn":
      return 0x2b5f48;
    case "exit":
      return 0x83704d;
    case "inaccessible":
      return 0x101113;
    default:
      return 0x241f22;
  }
}

function isVisibleBoardSymbol(symbol) {
  return symbol !== " " && symbol !== "X" && symbol !== "#" && symbol !== "B" && symbol !== "?";
}

function clampBounds(bounds, boardWidth, boardHeight) {
  return {
    minX: Math.max(0, Math.min(boardWidth - 1, bounds.minX)),
    minY: Math.max(0, Math.min(boardHeight - 1, bounds.minY)),
    maxX: Math.max(0, Math.min(boardWidth - 1, bounds.maxX)),
    maxY: Math.max(0, Math.min(boardHeight - 1, bounds.maxY)),
  };
}

export function computePreviewFocusBounds(previewState = {}) {
  const tiles = Array.isArray(previewState?.tiles) ? previewState.tiles : [];
  const boardHeight = tiles.length || Math.max(1, previewState?.boardHeight || 1);
  const boardWidth = Math.max(
    1,
    previewState?.boardWidth || 1,
    tiles.reduce((max, row) => Math.max(max, String(row || "").length), 0),
  );
  const points = [];

  for (let y = 0; y < tiles.length; y += 1) {
    const row = String(tiles[y] || "");
    for (let x = 0; x < row.length; x += 1) {
      if (isVisibleBoardSymbol(row[x])) {
        points.push({ x, y });
      }
    }
  }

  const actors = Array.isArray(previewState?.actors) ? previewState.actors : [];
  actors.forEach((actor) => {
    if (Number.isFinite(actor?.position?.x) && Number.isFinite(actor?.position?.y)) {
      points.push({ x: actor.position.x, y: actor.position.y });
    }
  });

  const traps = Array.isArray(previewState?.floorAffinityTraps) ? previewState.floorAffinityTraps : [];
  traps.forEach((trap) => {
    if (Number.isFinite(trap?.position?.x) && Number.isFinite(trap?.position?.y)) {
      points.push({ x: trap.position.x, y: trap.position.y });
    }
  });

  const auras = Array.isArray(previewState?.observation?.auras) ? previewState.observation.auras : [];
  auras.forEach((aura) => {
    if (Number.isFinite(aura?.x) && Number.isFinite(aura?.y)) {
      points.push({ x: aura.x, y: aura.y });
    }
  });

  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: Math.max(0, boardWidth - 1),
      maxY: Math.max(0, boardHeight - 1),
    };
  }

  const rawBounds = points.reduce((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxX: Math.max(acc.maxX, point.x),
    maxY: Math.max(acc.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });

  return clampBounds({
    minX: rawBounds.minX - 1,
    minY: rawBounds.minY - 1,
    maxX: rawBounds.maxX + 1,
    maxY: rawBounds.maxY + 1,
  }, boardWidth, boardHeight);
}

function cropCanvasToFocusBounds(canvas, bounds, { tileWidth, tileHeight } = {}) {
  if (!canvas || !bounds || !tileWidth || !tileHeight) return null;
  const context = canvas.getContext?.("2d");
  if (!context || typeof context.getImageData !== "function" || typeof context.putImageData !== "function") {
    return null;
  }
  const sourceWidth = Math.max(1, (bounds.maxX - bounds.minX + 1) * tileWidth);
  const sourceHeight = Math.max(1, (bounds.maxY - bounds.minY + 1) * tileHeight);
  const sourceX = bounds.minX * tileWidth;
  const sourceY = bounds.minY * tileHeight;
  let snapshot = null;
  try {
    snapshot = context.getImageData(sourceX, sourceY, sourceWidth, sourceHeight);
  } catch (_error) {
    return null;
  }
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  context.putImageData(snapshot, 0, 0);
  return {
    width: sourceWidth,
    height: sourceHeight,
    offsetX: bounds.minX,
    offsetY: bounds.minY,
  };
}

function inferActorRole(actor = {}) {
  const explicit = [
    actor.role,
    actor.type,
    actor.kind,
    actor.faction,
    actor.team,
  ].find((value) => typeof value === "string" && value.trim());
  const normalized = String(explicit || actor.id || "").toLowerCase();
  if (normalized.includes("warden") || normalized.includes("defender")) return "warden";
  return "delver";
}

function inferPrimaryAffinity(actor = {}) {
  const traits = actor?.traits?.affinities;
  if (!traits || typeof traits !== "object") return null;
  let bestKey = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  Object.entries(traits).forEach(([key, value]) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= bestValue) return;
    const [kind] = String(key).split(":");
    if (!kind || !(kind in AFFINITY_COLOR_HEX)) return;
    bestKey = kind;
    bestValue = numeric;
  });
  return bestKey;
}

function resolveResourceBundle(bundle) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === "agent-kernel/ResourceBundleArtifact") || null;
}

function findAsset(resourceBundle, assetId) {
  const assets = Array.isArray(resourceBundle?.assets) ? resourceBundle.assets : [];
  return assets.find((asset) => asset?.id === assetId) || null;
}

function resolveTileAsset(resourceBundle, symbol) {
  const mappings = resourceBundle?.mappings?.tiles || {};
  return findAsset(resourceBundle, mappings[tileSymbolToType(symbol)]);
}

function resolveTrapAsset(resourceBundle) {
  return findAsset(resourceBundle, resourceBundle?.mappings?.items?.hazard);
}

function resolveActorAsset(resourceBundle, actor) {
  const role = inferActorRole(actor);
  const mappings = resourceBundle?.mappings?.actors || {};
  const affinity = inferPrimaryAffinity(actor);
  const byAffinity = mappings?.byRoleAndAffinity?.[role];
  if (affinity && byAffinity?.[affinity]) {
    return findAsset(resourceBundle, byAffinity[affinity]);
  }
  return findAsset(resourceBundle, mappings[role]);
}

function normalizeTileMetrics(resourceBundle) {
  const tileWidth = Number.isFinite(resourceBundle?.tileWidth) && resourceBundle.tileWidth > 0
    ? resourceBundle.tileWidth
    : DEFAULT_TILE_SIZE;
  const tileHeight = Number.isFinite(resourceBundle?.tileHeight) && resourceBundle.tileHeight > 0
    ? resourceBundle.tileHeight
    : DEFAULT_TILE_SIZE;
  return { tileWidth, tileHeight };
}

export function createCanvasPreviewRenderer({
  canvas,
  onSelect,
  renderBundleBoard = renderBundleBoardToCanvas,
} = {}) {
  let mountedCanvas = canvas || null;
  let focusBounds = null;
  let tileMetrics = { tileWidth: DEFAULT_TILE_SIZE, tileHeight: DEFAULT_TILE_SIZE };

  function hide() {
    clearBundleCanvas(mountedCanvas);
    if (mountedCanvas) mountedCanvas.hidden = true;
  }

  return {
    id: PREVIEW_RENDERER_IDS.canvas,
    mount(_container, { canvas: nextCanvas } = {}) {
      mountedCanvas = nextCanvas || mountedCanvas;
      if (mountedCanvas?.__previewCanvasRendererBound !== true) {
        mountedCanvas?.addEventListener?.("click", (event) => {
          const position = positionFromCanvasEvent(event, mountedCanvas, tileMetrics);
          if (!position) return;
          const worldPosition = focusBounds
            ? {
              x: position.x + focusBounds.minX,
              y: position.y + focusBounds.minY,
            }
            : position;
          onSelect?.(worldPosition);
        });
        if (mountedCanvas) mountedCanvas.__previewCanvasRendererBound = true;
      }
    },
    async renderPreview(previewState) {
      if (!mountedCanvas) {
        return { ok: false, reason: "missing_canvas" };
      }
      const result = await renderBundleBoard({
        canvas: mountedCanvas,
        tiles: previewState?.tiles || [],
        actors: previewState?.actors || [],
        floorAffinityTraps: previewState?.floorAffinityTraps || [],
        bundle: previewState?.bundle || null,
        observation: previewState?.observation || null,
      });
      if (!result?.ok) {
        hide();
        return result || { ok: false, reason: "render_failed" };
      }
      tileMetrics = {
        tileWidth: result.tileWidth || DEFAULT_TILE_SIZE,
        tileHeight: result.tileHeight || DEFAULT_TILE_SIZE,
      };
      focusBounds = computePreviewFocusBounds(previewState);
      const cropped = cropCanvasToFocusBounds(mountedCanvas, focusBounds, tileMetrics);
      mountedCanvas.hidden = false;
      return {
        ok: true,
        interactive: true,
        width: cropped?.width || result.width,
        height: cropped?.height || result.height,
      };
    },
    clear() {
      focusBounds = null;
      hide();
    },
    dispose() {
      focusBounds = null;
      hide();
    },
  };
}

function defaultLoadPhaser() {
  return import("/node_modules/phaser/dist/phaser.esm.js").then((module) => module.default || module);
}

function ensureStageElement(container) {
  if (!container || typeof document?.createElement !== "function") return null;
  let stage = container.querySelector?.("[data-preview-phaser-stage]");
  if (stage) return stage;
  stage = document.createElement("div");
  stage.dataset.previewPhaserStage = "true";
  stage.className = "preview-phaser-stage";
  stage.hidden = true;
  container.appendChild(stage);
  return stage;
}

async function ensureTexture(scene, asset) {
  const dataUri = typeof asset?.dataUri === "string" ? asset.dataUri.trim() : "";
  if (!scene || !dataUri || typeof Image === "undefined") return null;
  const textureKey = `preview:${asset.id || "asset"}:${hashText(dataUri)}`;
  if (scene.textures.exists(textureKey)) return textureKey;
  if (phaserTextureLoads.has(textureKey)) {
    return phaserTextureLoads.get(textureKey);
  }
  const pending = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        scene.textures.addImage(textureKey, image);
        resolve(textureKey);
      } catch (_error) {
        resolve(null);
      } finally {
        phaserTextureLoads.delete(textureKey);
      }
    };
    image.onerror = () => {
      phaserTextureLoads.delete(textureKey);
      resolve(null);
    };
    image.src = dataUri;
  });
  phaserTextureLoads.set(textureKey, pending);
  return pending;
}

function destroyRenderable(renderRoot) {
  renderRoot?.destroy?.(true);
}

function isPointInBounds(x, y, bounds) {
  return Number.isFinite(x)
    && Number.isFinite(y)
    && x >= bounds.minX
    && x <= bounds.maxX
    && y >= bounds.minY
    && y <= bounds.maxY;
}

function projectBoardPointToFocus(x, y, bounds, tileWidth, tileHeight) {
  return {
    centerX: ((x - bounds.minX) * tileWidth) + (tileWidth / 2),
    centerY: ((y - bounds.minY) * tileHeight) + (tileHeight / 2),
  };
}

export function createPhaserPreviewRenderer({
  onSelect,
  loadPhaser = defaultLoadPhaser,
} = {}) {
  let container = null;
  let stageEl = null;
  let game = null;
  let scene = null;
  let sceneReady = null;
  let inputBound = false;
  let currentBoardMetrics = { tileWidth: DEFAULT_TILE_SIZE, tileHeight: DEFAULT_TILE_SIZE };
  let currentPreviewState = null;
  let currentRenderRoot = null;
  let currentViewport = { width: DEFAULT_TILE_SIZE, height: DEFAULT_TILE_SIZE, zoom: 1 };
  let currentFocusBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  function clearStage() {
    destroyRenderable(currentRenderRoot);
    currentRenderRoot = null;
    if (stageEl) {
      stageEl.hidden = true;
      stageEl.style.height = "";
      stageEl.style.minHeight = "";
      delete stageEl.dataset.previewWorldTiles;
      delete stageEl.dataset.previewFocusTiles;
      delete stageEl.dataset.previewFocusBounds;
    }
  }

  async function ensureGame(previewState) {
    container = container || stageEl?.parentElement || null;
    stageEl = stageEl || ensureStageElement(container);
    if (!stageEl) {
      return { ok: false, reason: "missing_stage" };
    }
    stageEl.hidden = false;
    const resourceBundle = previewState?.resourceBundle || resolveResourceBundle(previewState?.bundle);
    currentBoardMetrics = normalizeTileMetrics(resourceBundle);
    const boardWidthTiles = Math.max(1, previewState?.boardWidth || 1);
    const boardHeightTiles = Math.max(1, previewState?.boardHeight || 1);
    currentFocusBounds = computePreviewFocusBounds(previewState);
    const focusTileWidth = Math.max(1, currentFocusBounds.maxX - currentFocusBounds.minX + 1);
    const focusTileHeight = Math.max(1, currentFocusBounds.maxY - currentFocusBounds.minY + 1);
    const focusWidth = Math.max(1, focusTileWidth * currentBoardMetrics.tileWidth);
    const focusHeight = Math.max(1, focusTileHeight * currentBoardMetrics.tileHeight);
    const style = globalThis.getComputedStyle?.(stageEl);
    const availableWidth = Math.max(
      1,
      stageEl.clientWidth
        || container?.clientWidth
        || parsePixelValue(style?.width, focusWidth)
        || focusWidth,
    );
    const maxHeight = Math.max(
      1,
      parsePixelValue(style?.maxHeight, focusHeight) || focusHeight,
    );
    const fitScale = Math.min(availableWidth / focusWidth, maxHeight / focusHeight);
    const viewportWidth = Math.max(1, Math.floor(focusWidth * fitScale));
    const viewportHeight = Math.max(1, Math.floor(focusHeight * fitScale));
    currentViewport = {
      width: viewportWidth,
      height: viewportHeight,
      zoom: fitScale,
    };
    stageEl.style.height = `${viewportHeight}px`;
    stageEl.style.minHeight = `${viewportHeight}px`;
    stageEl.dataset.previewWorldTiles = `${boardWidthTiles}x${boardHeightTiles}`;
    stageEl.dataset.previewFocusTiles = `${focusTileWidth}x${focusTileHeight}`;
    stageEl.dataset.previewFocusBounds = [
      currentFocusBounds.minX,
      currentFocusBounds.minY,
      currentFocusBounds.maxX,
      currentFocusBounds.maxY,
    ].join(",");

    if (!game) {
      const Phaser = await loadPhaser();
      sceneReady = new Promise((resolve) => {
        game = new Phaser.Game({
          type: Phaser.AUTO,
          width: viewportWidth,
          height: viewportHeight,
          parent: stageEl,
          transparent: true,
          backgroundColor: "#000000",
          scene: {
            create() {
              scene = this;
              resolve(this);
            },
          },
          scale: {
            mode: Phaser.Scale.NONE,
            width: viewportWidth,
            height: viewportHeight,
          },
          render: {
            antialias: false,
            pixelArt: true,
            roundPixels: true,
          },
        });
      });
    } else {
      game.scale.resize(viewportWidth, viewportHeight);
    }

    const resolvedScene = await sceneReady;
    const canvas = game.canvas;
    if (canvas) {
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
      canvas.style.display = "block";
    }
    resolvedScene.cameras.main.setViewport(0, 0, viewportWidth, viewportHeight);
    resolvedScene.cameras.main.setBounds(0, 0, focusWidth, focusHeight);
    resolvedScene.cameras.main.setZoom(fitScale);
    resolvedScene.cameras.main.centerOn(focusWidth / 2, focusHeight / 2);
    return { ok: true, Phaser: game.constructor, scene: resolvedScene };
  }

  async function drawBoard(previewState) {
    const ready = await ensureGame(previewState);
    if (!ready?.ok || !scene) return ready;

    destroyRenderable(currentRenderRoot);
    currentPreviewState = previewState;
    currentRenderRoot = scene.add.container(0, 0);
    const resourceBundle = previewState?.resourceBundle || resolveResourceBundle(previewState?.bundle);
    const { tileWidth, tileHeight } = currentBoardMetrics;
    const trapPositions = new Set();

    const tiles = Array.isArray(previewState?.tiles) ? previewState.tiles : [];
    for (let y = currentFocusBounds.minY; y <= currentFocusBounds.maxY; y += 1) {
      const row = String(tiles[y] || "");
      for (let x = currentFocusBounds.minX; x <= currentFocusBounds.maxX; x += 1) {
        const symbol = row[x] || "X";
        const asset = resolveTileAsset(resourceBundle, symbol);
        const textureKey = await ensureTexture(scene, asset);
        const { centerX, centerY } = projectBoardPointToFocus(x, y, currentFocusBounds, tileWidth, tileHeight);
        let node = null;
        if (textureKey) {
          node = scene.add.image(centerX, centerY, textureKey).setDisplaySize(tileWidth, tileHeight);
        } else {
          node = scene.add.rectangle(centerX, centerY, tileWidth - 1, tileHeight - 1, tileColorForType(tileSymbolToType(symbol)), 1);
          node.setStrokeStyle?.(1, 0x0d0d0f, 0.35);
        }
        currentRenderRoot.add(node);
      }
    }

    const auras = Array.isArray(previewState?.observation?.auras) ? previewState.observation.auras : [];
    auras.forEach((aura) => {
      const colorHex = AFFINITY_COLOR_HEX[aura?.affinityKind || aura?.kind];
      if (!colorHex) return;
      const x = Number.isFinite(aura?.x) ? aura.x : null;
      const y = Number.isFinite(aura?.y) ? aura.y : null;
      if (x === null || y === null || !isPointInBounds(x, y, currentFocusBounds)) return;
      const alpha = Math.min(0.18 + (Number(aura?.intensity) || 0) * 0.3, 0.46);
      const { centerX, centerY } = projectBoardPointToFocus(x, y, currentFocusBounds, tileWidth, tileHeight);
      const overlay = scene.add.rectangle(
        centerX,
        centerY,
        Math.max(8, tileWidth - 6),
        Math.max(8, tileHeight - 6),
        Number.parseInt(colorHex.replace("#", ""), 16),
        alpha,
      );
      overlay.setStrokeStyle?.(1, Number.parseInt(colorHex.replace("#", ""), 16), Math.min(alpha + 0.15, 0.65));
      currentRenderRoot.add(overlay);
    });

    const trapAsset = resolveTrapAsset(resourceBundle);
    const trapTextureKey = await ensureTexture(scene, trapAsset);
    const traps = Array.isArray(previewState?.floorAffinityTraps) ? previewState.floorAffinityTraps : [];
    traps.forEach((trap) => {
      const x = Number.isFinite(trap?.position?.x) ? trap.position.x : null;
      const y = Number.isFinite(trap?.position?.y) ? trap.position.y : null;
      if (x === null || y === null || !isPointInBounds(x, y, currentFocusBounds)) return;
      trapPositions.add(`${x},${y}`);
      const { centerX, centerY } = projectBoardPointToFocus(x, y, currentFocusBounds, tileWidth, tileHeight);
      const tintHex = AFFINITY_COLOR_HEX[trap?.affinity?.kind] || "#ffb9a8";
      const tint = Number.parseInt(tintHex.replace("#", ""), 16);
      let node = null;
      if (trapTextureKey) {
        node = scene.add.image(centerX, centerY, trapTextureKey).setDisplaySize(tileWidth * 0.72, tileHeight * 0.72).setTint(tint);
      } else {
        node = scene.add.rectangle(centerX, centerY, tileWidth * 0.48, tileHeight * 0.48, tint, 0.92).setAngle(45);
      }
      currentRenderRoot.add(node);
    });

    const actors = Array.isArray(previewState?.actors) ? previewState.actors : [];
    for (const actor of actors) {
      const x = Number.isFinite(actor?.position?.x) ? actor.position.x : null;
      const y = Number.isFinite(actor?.position?.y) ? actor.position.y : null;
      if (x === null || y === null || !isPointInBounds(x, y, currentFocusBounds)) continue;
      const { centerX, centerY } = projectBoardPointToFocus(x, y, currentFocusBounds, tileWidth, tileHeight);
      const role = inferActorRole(actor);
      const affinity = inferPrimaryAffinity(actor);
      const tintHex = AFFINITY_COLOR_HEX[affinity] || (role === "warden" ? "#7da6ff" : "#ffb9a8");
      const tint = Number.parseInt(tintHex.replace("#", ""), 16);
      const asset = resolveActorAsset(resourceBundle, actor);
      const textureKey = await ensureTexture(scene, asset);
      let node = null;
      if (textureKey) {
        node = scene.add.image(centerX, centerY, textureKey).setDisplaySize(tileWidth * 0.86, tileHeight * 0.86);
        node.setTint?.(tint);
      } else {
        node = scene.add.circle(centerX, centerY, Math.max(8, Math.min(tileWidth, tileHeight) * 0.3), tint, 0.96);
        const label = scene.add.text(centerX, centerY, role === "warden" ? "W" : "D", {
          fontFamily: "Space Grotesk, sans-serif",
          fontSize: `${Math.max(12, Math.floor(tileWidth * 0.38))}px`,
          color: "#140e0e",
        }).setOrigin(0.5);
        currentRenderRoot.add(label);
      }
      node.setDepth?.(trapPositions.has(`${x},${y}`) ? 26 : 24);
      currentRenderRoot.add(node);
    }

    scene.tweens.add({
      targets: currentRenderRoot.list,
      alpha: { from: 0, to: 1 },
      duration: 140,
      ease: "Quad.out",
    });

    if (!inputBound) {
      scene.input.on("pointerdown", (pointer) => {
        if (!currentPreviewState) return;
        const x = Math.floor(pointer.worldX / currentBoardMetrics.tileWidth);
        const y = Math.floor(pointer.worldY / currentBoardMetrics.tileHeight);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          onSelect?.({
            x: x + currentFocusBounds.minX,
            y: y + currentFocusBounds.minY,
          });
        }
      });
      inputBound = true;
    }

    stageEl.hidden = false;
    return {
      ok: true,
      interactive: true,
      width: currentViewport.width,
      height: currentViewport.height,
    };
  }

  return {
    id: PREVIEW_RENDERER_IDS.phaser,
    mount(nextContainer) {
      container = nextContainer || container;
      stageEl = ensureStageElement(container);
    },
    async renderPreview(previewState) {
      return drawBoard(previewState);
    },
    clear() {
      clearStage();
    },
    dispose() {
      clearStage();
      if (game) {
        game.destroy(true);
      }
      game = null;
      scene = null;
      sceneReady = null;
      inputBound = false;
    },
  };
}
