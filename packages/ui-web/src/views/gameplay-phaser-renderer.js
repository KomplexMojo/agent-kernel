import { createEntitySpriteTextureDescriptor } from "./entity-sprite-textures.js";
import { GAME_COLOR_PALETTE } from "../../../runtime/src/contracts/game-elements.js";
import { buildActorHudModel } from "../../../runtime/src/render/actor-hud-model.js";

/** "#rrggbb" -> 0xrrggbb, the numeric form Phaser tints want. */
function hexToTint(hex) {
  return Number.parseInt(String(hex).replace("#", ""), 16);
}

const DEFAULT_TILE_SIZE = 32;
// Option (a), maintainer 2026-09-02. M1's silhouettes are guaranteed distinct down
// to 12px and no further, so the camera must not shrink a tile past that. With
// DEFAULT_TILE_SIZE 32 the floor is 12/32 = 0.375; 0.4 keeps a little headroom.
// This costs maximum zoom-out on very large dungeons -- verified in M5.
const MIN_CAMERA_ZOOM = 0.4;
const MIN_LEGIBLE_TILE_PX = 12;
// Ceiling on affinity-field opacity. Above this the field stops reading as an
// overlay on the floor and starts replacing it, which also swallows any sprite
// standing in a field of its own affinity.
const MAX_FIELD_ALPHA = 0.45;
const MAX_CAMERA_ZOOM = 3;
const CAMERA_ZOOM_STEP = 1.2;
const DRAG_SELECT_THRESHOLD = 6;
const SELECTION_TINT = 0xffd700;
// Vital colours, labels and ordering come from the HUD view-model in runtime.
// They used to be a table here -- a duplicate of GAME_COLOR_PALETTE.vitals that
// still happened to agree. The affinity palette had the same shape of duplicate
// and had already drifted into a live bug (M2), so this one is folded back.
const REGEN_BLOCK_SIZE = 5;
const REGEN_BLOCK_GAP = 2;

// HUD geometry. Fixed to the camera, so these are screen pixels, not world.
const HUD = Object.freeze({
  margin: 12,
  padX: 10,
  padY: 8,
  rowH: 16,
  labelW: 20,
  barW: 96,
  barH: 5,
  valueW: 46,
  headerH: 16,
  footerH: 13,
  bg: 0x0d1014,
  bgAlpha: 0.88,
  border: 0x2c333c,
  depth: 1000,
});
const ACTOR_CONTROL_KEYS = new Set([
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "w", "a", "s", "d",
  "c", "x", "z", "escape",
]);

function defaultLoadPhaser() {
  return import("/node_modules/phaser/dist/phaser.esm.js").then((m) => m.default || m);
}

function tileSymbolToType(symbol) {
  switch (symbol) {
    case "#": return "wall";
    case "B": return "barrier";
    case "S": return "spawn";
    case "E": return "exit";
    case "X":
    case " ": return "inaccessible";
    default: return "floor";
  }
}

function inferActorRole(actor = {}) {
  const explicit = [actor.role, actor.type, actor.archetype, actor.actorType, actor.faction, actor.team, actor.kind]
    .find((v) => typeof v === "string" && v.trim());
  const normalized = String(explicit || actor.id || "").toLowerCase();
  if (normalized.includes("warden") || normalized.includes("defender")) return "warden";
  return "delver";
}

function actorDiagnostics(actors = []) {
  return actors
    .map((actor) => {
      const x = Number.isFinite(actor?.position?.x) ? actor.position.x : null;
      const y = Number.isFinite(actor?.position?.y) ? actor.position.y : null;
      if (x === null || y === null) return null;
      return {
        id: typeof actor?.id === "string" ? actor.id : "",
        role: inferActorRole(actor),
        x,
        y,
      };
    })
    .filter(Boolean);
}

function normalizeTileMetrics(resourceBundle) {
  const tileWidth = Number.isFinite(resourceBundle?.tileWidth) && resourceBundle.tileWidth > 0
    ? resourceBundle.tileWidth : DEFAULT_TILE_SIZE;
  const tileHeight = Number.isFinite(resourceBundle?.tileHeight) && resourceBundle.tileHeight > 0
    ? resourceBundle.tileHeight : DEFAULT_TILE_SIZE;
  return { tileWidth, tileHeight };
}

function normalizeResourceAssets(resourceBundle) {
  return new Map((Array.isArray(resourceBundle?.assets) ? resourceBundle.assets : [])
    .filter((asset) => typeof asset?.id === "string" && asset.id.trim())
    .map((asset) => [asset.id, asset]));
}

function findBundleAsset(resourceBundle, assetId) {
  if (!resourceBundle || typeof assetId !== "string" || !assetId.trim()) return null;
  return normalizeResourceAssets(resourceBundle).get(assetId) || null;
}

function primaryAffinityKind(actor = {}) {
  const explicit = typeof actor?.affinity === "string" ? actor.affinity.trim().toLowerCase() : "";
  if (explicit) return explicit;
  const affinities = Array.isArray(actor?.affinities) ? actor.affinities : [];
  const first = affinities.find((entry) => typeof entry?.kind === "string" && entry.kind.trim());
  if (first) return first.kind.trim().toLowerCase();
  const traitAffinities = actor?.traits?.affinities;
  if (traitAffinities && typeof traitAffinities === "object" && !Array.isArray(traitAffinities)) {
    const [key] = Object.keys(traitAffinities);
    return String(key || "").split(":")[0].trim().toLowerCase();
  }
  return "";
}

function resolveHazardAssetId(resourceBundle, hazard = {}) {
  const kind = hazard?.affinity?.kind || hazard?.affinityStacks?.[0]?.kind;
  if (kind) {
    const byAffinity = resourceBundle?.mappings?.affinities?.[kind];
    if (byAffinity) return byAffinity;
  }
  return resourceBundle?.mappings?.items?.["hazard"] || null;
}

function resolveActorAssetId(resourceBundle, actor = {}) {
  const role = inferActorRole(actor);
  const affinity = primaryAffinityKind(actor);
  const affinityAssetId = affinity ? resourceBundle?.mappings?.actors?.byRoleAndAffinity?.[role]?.[affinity] : "";
  return affinityAssetId || resourceBundle?.mappings?.actors?.[role] || null;
}

function resolveSurfaceAsset(resourceBundle, category, key, model = {}) {
  let assetId = null;
  // No "tiles" branch: tiles are flat fills from GAME_COLOR_PALETTE now, never bundle
  // art, so nothing resolves a tile asset. The bundle still ships tile PNGs for other
  // consumers; the board simply stops drawing them.
  if (category === "actors") assetId = resolveActorAssetId(resourceBundle, model);
  if (category === "items" || category === "resources") assetId = resourceBundle?.mappings?.items?.[key] || null;
  if (category === "hazards") assetId = resolveHazardAssetId(resourceBundle, model);
  if (category === "overlays") {
    assetId = key === "darknessMask"
      ? resourceBundle?.mappings?.overlays?.darknessMask
      : resourceBundle?.mappings?.overlays?.[key] || null;
  }
  return findBundleAsset(resourceBundle, assetId);
}

function ensureGameplayStageElement(container) {
  if (!container) return null;
  let stage = container.querySelector?.("[data-gameplay-phaser-stage]");
  if (stage) return stage;
  const create = globalThis.document?.createElement?.bind?.(globalThis.document);
  stage = create ? create("div") : { dataset: {}, classList: { add() {} } };
  if (stage.dataset) stage.dataset.gameplayPhaserStage = "true";
  if (stage.classList?.add) stage.classList.add("gameplay-phaser-stage");
  container.appendChild(stage);
  return stage;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createGameplayPhaserRenderer({ loadPhaser = defaultLoadPhaser, onSelect, onHover, onHoverEnd, onKeyPress } = {}) {
  let container = null;
  let stageEl = null;
  let game = null;
  let scene = null;
  let sceneReady = null;
  let inputBound = false;
  let currentBoardMetrics = { tileWidth: DEFAULT_TILE_SIZE, tileHeight: DEFAULT_TILE_SIZE };
  let currentContainer = null;
  let hudContainer = null;
  let hudCamera = null;
  let hudEntity = null;
  let resizeObserver = null;
  let lastHoverTile = null;
  let actorNodes = new Map();
  let selectedActorKey = null;
  let playerPanelContainer = null;
  let playerPanelOpen = false;
  let playbackControls = null;
  let keydownHandler = null;
  let cameraState = {
    worldWidth: 1,
    worldHeight: 1,
    viewportWidth: 1,
    viewportHeight: 1,
    zoom: 1,
    fitZoom: 1,
  };

  function getCamera() {
    return scene?.cameras?.main || null;
  }

  function getCameraViewportCenter(camera = getCamera()) {
    if (!camera) return null;
    const zoom = Number(camera.zoom) || cameraState.zoom || 1;
    const viewportWidth = Number(camera.width) || cameraState.viewportWidth || 1;
    const viewportHeight = Number(camera.height) || cameraState.viewportHeight || 1;
    return {
      x: (Number(camera.scrollX) || 0) + viewportWidth / (2 * zoom),
      y: (Number(camera.scrollY) || 0) + viewportHeight / (2 * zoom),
    };
  }

  function setStageCameraDataset() {
    if (!stageEl?.dataset) return;
    stageEl.dataset.gameplayCameraZoom = String(Number(cameraState.zoom.toFixed(3)));
    stageEl.dataset.gameplayFitZoom = String(Number(cameraState.fitZoom.toFixed(3)));
    stageEl.dataset.gameplayWorldPixels = `${Math.round(cameraState.worldWidth)}x${Math.round(cameraState.worldHeight)}`;
  }

  function applyCameraZoom(nextZoom, { centerX, centerY } = {}) {
    const camera = getCamera();
    if (!camera) return cameraState.zoom;
    const previousCenter = getCameraViewportCenter(camera);
    const zoom = clamp(nextZoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
    cameraState.zoom = zoom;
    camera.setZoom?.(zoom);
    const targetCenterX = Number.isFinite(centerX) ? centerX : previousCenter?.x;
    const targetCenterY = Number.isFinite(centerY) ? centerY : previousCenter?.y;
    if (Number.isFinite(targetCenterX) && Number.isFinite(targetCenterY)) {
      camera.centerOn?.(targetCenterX, targetCenterY);
    }
    setStageCameraDataset();
    return zoom;
  }

  function fitCameraToWorld() {
    const camera = getCamera();
    if (!camera) return cameraState.zoom;
    // No 1.0 ceiling: the level fills the viewport. That ceiling kept tiles at
    // native 32px, which left a small level sitting in a corner of an otherwise
    // empty screen once the inventory rail stopped sharing the width. Sprites are
    // composed textures scaled by a pixelArt/roundPixels camera, so magnifying
    // them stays crisp and blocky rather than blurring. MAX_CAMERA_ZOOM still
    // caps it so a tiny level cannot become absurd.
    const fitZoom = clamp(
      Math.min(
        cameraState.viewportWidth / cameraState.worldWidth,
        cameraState.viewportHeight / cameraState.worldHeight,
      ),
      MIN_CAMERA_ZOOM,
      MAX_CAMERA_ZOOM,
    );
    cameraState.fitZoom = fitZoom;
    applyCameraZoom(fitZoom);
    camera.centerOn?.(cameraState.worldWidth / 2, cameraState.worldHeight / 2);
    setStageCameraDataset();
    return fitZoom;
  }

  // Loading a run frames the WHOLE level (maintainer, 2026-09-02).
  //
  // It used to fit only "the entry" -- the room containing the spawn tile or the
  // first delver -- which made a five-room level look like a one-room level on
  // load, because the other four sat off-screen with nothing indicating they
  // existed. The entry-focus helpers (computeEntryFocusTileBounds and
  // fitCameraToRegion) are removed rather than left unused; git history has them
  // if a "focus the entry" action is ever wanted as an explicit control.
  //
  // This deliberately shares fitCameraToWorld with the Fit button, so the view on
  // load is exactly the view Fit returns you to -- including its clamp at zoom 1,
  // which keeps a small level at native pixel scale instead of magnifying it.
  function configureCamera({ resetView = false } = {}) {
    const camera = getCamera();
    if (!camera) return;
    camera.setBounds?.(0, 0, cameraState.worldWidth, cameraState.worldHeight);
    if (resetView) {
      fitCameraToWorld();
    } else {
      applyCameraZoom(cameraState.zoom);
    }
  }

  function panCameraBy(deltaX, deltaY) {
    const camera = getCamera();
    if (!camera) return;
    const zoom = cameraState.zoom || 1;
    camera.scrollX = (Number(camera.scrollX) || 0) - deltaX / zoom;
    camera.scrollY = (Number(camera.scrollY) || 0) - deltaY / zoom;
  }

  function bindCameraInput() {
    if (!scene || inputBound) return;
    let dragStart = null;
    let lastPointer = null;
    let dragged = false;

    scene.input.on("pointerdown", (pointer) => {
      dragStart = { x: pointer.x ?? pointer.worldX ?? 0, y: pointer.y ?? pointer.worldY ?? 0 };
      lastPointer = { ...dragStart };
      dragged = false;
    });
    scene.input.on("pointermove", (pointer) => {
      const isDragging = pointer.isDown || pointer.primaryDown || pointer.buttons > 0;
      if (!isDragging) {
        if (!playerPanelOpen) {
          const tx = Math.floor((pointer.worldX ?? 0) / currentBoardMetrics.tileWidth);
          const ty = Math.floor((pointer.worldY ?? 0) / currentBoardMetrics.tileHeight);
          if (Number.isFinite(tx) && Number.isFinite(ty)) {
            if (tx !== lastHoverTile?.x || ty !== lastHoverTile?.y) {
              lastHoverTile = { x: tx, y: ty };
              onHover?.({ x: tx, y: ty });
            }
          }
        }
        return;
      }
      lastHoverTile = null;
      if (!lastPointer) return;
      const x = pointer.x ?? pointer.worldX ?? lastPointer.x;
      const y = pointer.y ?? pointer.worldY ?? lastPointer.y;
      const dx = x - lastPointer.x;
      const dy = y - lastPointer.y;
      if (dx !== 0 || dy !== 0) {
        dragged = true;
        panCameraBy(dx, dy);
      }
      lastPointer = { x, y };
    });
    scene.input.on("gameout", () => {
      lastHoverTile = null;
      onHoverEnd?.();
    });
    scene.input.on("pointerup", (pointer) => {
      const end = { x: pointer.x ?? pointer.worldX ?? 0, y: pointer.y ?? pointer.worldY ?? 0 };
      const distance = dragStart ? Math.hypot(end.x - dragStart.x, end.y - dragStart.y) : 0;
      const isSelection = !dragged && distance <= DRAG_SELECT_THRESHOLD;
      dragStart = null;
      lastPointer = null;
      dragged = false;
      if (!isSelection) return;
      if (playerPanelOpen) return;
      const x = Math.floor(pointer.worldX / currentBoardMetrics.tileWidth);
      const y = Math.floor(pointer.worldY / currentBoardMetrics.tileHeight);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        onSelect?.({ x, y });
      }
    });
    scene.input.on("wheel", (pointer, _objects, _deltaX, deltaY) => {
      const zoomFactor = deltaY > 0 ? 1 / CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP;
      applyCameraZoom(cameraState.zoom * zoomFactor, { centerX: pointer.worldX, centerY: pointer.worldY });
    });
    // Keyboard goes through a window-level DOM listener rather than
    // scene.input.keyboard: Phaser v4 does not expose the v3 keyboard plugin
    // on the scene, so that binding never fires (silently, via the optional
    // chain). The listener only acts while the gameplay stage is visible and
    // the user is not typing in a form field.
    keydownHandler = (event) => {
      if (!stageEl || stageEl.offsetParent === null) return;
      const target = event?.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = String(event?.key || "").toLowerCase();

      if (event?.metaKey) {
        // Cmd+Arrow drives tick-playback navigation instead of camera pan —
        // plain arrows (no modifier) remain reserved for camera pan / future
        // direct player movement, handled in the branch below. Auto-repeat
        // is ignored so one press moves the cursor exactly one step.
        if (event.repeat) { event.preventDefault?.(); return; }
        if (key === "arrowright") { event.preventDefault?.(); playbackControls?.stepForward?.(); }
        if (key === "arrowleft") { event.preventDefault?.(); playbackControls?.stepBack?.(); }
        if (key === "arrowdown") { event.preventDefault?.(); playbackControls?.jumpToEnd?.(); }
        if (key === "arrowup") { event.preventDefault?.(); playbackControls?.jumpToStart?.(); }
        return;
      }

      const amount = 48;
      if (key === "arrowup" || key === "w") panCameraBy(0, amount);
      if (key === "arrowdown" || key === "s") panCameraBy(0, -amount);
      if (key === "arrowleft" || key === "a") panCameraBy(amount, 0);
      if (key === "arrowright" || key === "d") panCameraBy(-amount, 0);
      if (key === "+" || key === "=") applyCameraZoom(cameraState.zoom * CAMERA_ZOOM_STEP);
      if (key === "-" || key === "_") applyCameraZoom(cameraState.zoom / CAMERA_ZOOM_STEP);
      if (key === "0") fitCameraToWorld();
      if (ACTOR_CONTROL_KEYS.has(key)) {
        onKeyPress?.({ key });
      }
    };
    // Bind exactly one keyboard seam — binding both double-steps every press.
    // In the browser the window listener is authoritative (Phaser's scene
    // keyboard delivers duplicate keydowns for a single press under v4).
    // In Node test environments there is no window listener, so the
    // fixture-based unit tests drive input through their fake scenes.
    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("keydown", keydownHandler);
    } else {
      scene.input.keyboard?.on?.("keydown", keydownHandler);
      keydownHandler = null;
    }
    inputBound = true;
  }

  function closePlayerPanel() {
    if (playerPanelContainer) {
      playerPanelContainer.destroy(true);
      playerPanelContainer = null;
    }
    playerPanelOpen = false;
    if (stageEl?.dataset) stageEl.dataset.gameplayPlayerPanelOpen = "false";
  }

  function isPlayerPanelOpen() {
    return playerPanelOpen;
  }

  function textureKeyForAsset(asset) {
    return asset?.id ? `ak-bundle:${asset.id}` : "";
  }

  async function preloadBundleTextures(resourceBundle) {
    if (!scene || !resourceBundle) return;
    const ImageCtor = typeof globalThis.Image === "function" ? globalThis.Image : null;
    const assets = Array.isArray(resourceBundle?.assets) ? resourceBundle.assets : [];
    const pending = [];
    for (const asset of assets) {
      const key = textureKeyForAsset(asset);
      const dataUri = typeof asset?.dataUri === "string" ? asset.dataUri.trim() : "";
      if (!key || !dataUri || scene.textures?.exists?.(key)) continue;
      if (ImageCtor) {
        pending.push(new Promise((resolve) => {
          const img = new ImageCtor();
          img.onload = () => {
            try {
              if (scene?.textures && !scene.textures.exists(key)) {
                scene.textures.addImage(key, img);
              }
            } catch (_) { /* scene may be destroyed */ }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = dataUri;
        }));
      } else if (typeof scene.textures?.addBase64 === "function") {
        scene.textures.addBase64(key, dataUri);
      }
    }
    if (pending.length > 0) await Promise.all(pending);
  }

  function ensureBundleTexture(asset) {
    const key = textureKeyForAsset(asset);
    if (!scene || !key) return "";
    return scene.textures?.exists?.(key) ? key : "";
  }

  function addBundleImage(asset, x, y, width, height) {
    const textureKey = ensureBundleTexture(asset);
    if (!textureKey || typeof scene?.add?.image !== "function") return null;
    const node = scene.add.image(x, y, textureKey);
    node.setDisplaySize?.(width, height);
    node.setOrigin?.(0.5);
    node.setName?.(asset.id);
    return node;
  }

  function canvasForTexture(texture) {
    return texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
  }

  function ensureEntitySpriteTexture(resourceBundle, entity, role, width, height) {
    const descriptor = createEntitySpriteTextureDescriptor({ resourceBundle, entity, role, width, height });
    if (!descriptor || !scene?.textures) return "";

    // Shared across every entity with the same role+affinity, so a texture that
    // already exists is finished -- recomposing it would write identical pixels.
    if (scene.textures.exists?.(descriptor.key) === true) {
      if (stageEl?.dataset) stageEl.dataset.gameplayEntitySprites = "runtime";
      return descriptor.key;
    }

    if (typeof scene.textures.createCanvas !== "function") return "";
    const texture = scene.textures.createCanvas(descriptor.key, descriptor.size, descriptor.size);

    const canvas = canvasForTexture(texture);
    const context = canvas?.getContext?.("2d");
    if (!context?.createImageData || !context?.putImageData) return "";

    const imageData = context.createImageData(descriptor.size, descriptor.size);
    imageData.data.set(descriptor.pixels);
    context.putImageData(imageData, 0, 0);
    texture?.refresh?.();
    if (stageEl?.dataset) stageEl.dataset.gameplayEntitySprites = "runtime";
    return descriptor.key;
  }

  function addEntitySpriteImage(resourceBundle, entity, role, x, y, width, height) {
    const textureKey = ensureEntitySpriteTexture(resourceBundle, entity, role, width, height);
    if (!textureKey || typeof scene?.add?.image !== "function") return null;
    const node = scene.add.image(x, y, textureKey);
    node.setDisplaySize?.(width, height);
    node.setOrigin?.(0.5);
    node.setName?.(`entity-sprite:${entity?.id || role || inferActorRole(entity)}`);
    node.setData?.("entitySprite", true);
    return node;
  }

  function addMissingBundleFallback(x, y, width, height) {
    const node = scene.add.rectangle(x, y, width, height, 0x111318, 0.92);
    node.setStrokeStyle?.(1, 0xff4d6d, 0.8);
    node.setData?.("intentionalMissingBundleFallback", true);
    return node;
  }

  // Categories the composer owns, and the sprite role each maps to. Hazards and
  // resources used to skip the composed path entirely and draw bundle PNGs, so the
  // board mixed the new sprite language for actors with retired art for everything
  // else. One composer, one language, four roles.
  const COMPOSED_ROLE_BY_CATEGORY = { actors: null, hazards: "hazard", resources: "resource" };

  function addSurfaceImageOrFallback(resourceBundle, category, key, model, x, y, width, height) {
    if (category in COMPOSED_ROLE_BY_CATEGORY) {
      // `actors` passes role null so the composer infers delver vs warden itself.
      const composed = addEntitySpriteImage(
        resourceBundle, model, COMPOSED_ROLE_BY_CATEGORY[category], x, y, width, height,
      );
      if (composed) return composed;
    }
    const asset = resolveSurfaceAsset(resourceBundle, category, key, model);
    const image = addBundleImage(asset, x, y, width, height);
    return image || addMissingBundleFallback(x, y, width, height);
  }

  function openPlayerPanel(model) {
    closePlayerPanel();
    if (!scene || !model) return;
    const vw = cameraState.viewportWidth || 400;
    const vh = cameraState.viewportHeight || 300;
    const panelW = Math.floor(vw * 0.85);
    const panelH = Math.floor(vh * 0.85);
    const panelX = Math.floor((vw - panelW) / 2);
    const panelY = Math.floor((vh - panelH) / 2);

    const overlay = scene.add.container(0, 0);
    overlay.setScrollFactor?.(0);
    playerPanelContainer = overlay;

    const dimmer = scene.add.rectangle(vw / 2, vh / 2, vw, vh, 0x000000, 0.65);
    overlay.add(dimmer);

    const bg = addSurfaceImageOrFallback(
      model.resourceBundle,
      "overlays",
      "darknessMask",
      null,
      panelX + panelW / 2,
      panelY + panelH / 2,
      panelW,
      panelH,
    );
    overlay.add(bg);

    const actorLabel = scene.add.text(
      panelX + 12, panelY + 12,
      `${String(model.entityType || "actor").toUpperCase()} — ${model.id}`,
      { fontSize: "11px", color: "#c8c8c8" },
    );
    overlay.add(actorLabel);

    const actorImage = addSurfaceImageOrFallback(
      model.resourceBundle,
      "actors",
      model.entityType,
      model,
      panelX + 36,
      panelY + 68,
      56,
      56,
    );
    overlay.add(actorImage);

    let yVitals = panelY + 32;
    if (model.vitals?.health) {
      const { current, max } = model.vitals.health;
      overlay.add(scene.add.text(panelX + 80, yVitals, `HP: ${current}/${max}`, { fontSize: "11px", color: "#ff8877" }));
      yVitals += 16;
    }
    if (model.vitals?.mana) {
      const { current, max } = model.vitals.mana;
      overlay.add(scene.add.text(panelX + 80, yVitals, `MP: ${current}/${max}`, { fontSize: "11px", color: "#88aaff" }));
      yVitals += 16;
    }
    if (model.vitals?.stamina) {
      const { current, max } = model.vitals.stamina;
      overlay.add(scene.add.text(panelX + 80, yVitals, `ST: ${current}/${max}`, { fontSize: "11px", color: "#88ee88" }));
    }

    let yAff = panelY + 110;
    for (const aff of (Array.isArray(model.affinities) ? model.affinities : [])) {
      overlay.add(scene.add.text(
        panelX + 12, yAff,
        `${aff.kind}  x${aff.stacks}  [${aff.expression}]`,
        { fontSize: "10px", color: "#ddaaff" },
      ));
      overlay.add(scene.add.text(
        panelX + panelW - 56, yAff, "EQUIP",
        { fontSize: "9px", color: "#aaffaa" },
      ));
      yAff += 16;
    }

    let yMot = panelY + 200;
    const motivations = Array.isArray(model.motivations) ? model.motivations : [];
    for (let i = 0; i < motivations.length; i++) {
      overlay.add(scene.add.text(
        panelX + 12, yMot, `${i + 1}. ${motivations[i]}`,
        { fontSize: "10px", color: "#c8c8a0" },
      ));
      yMot += 14;
    }
    if (motivations.length > 0) {
      overlay.add(scene.add.text(
        panelX + panelW - 90, panelY + 200, "PRIORITY ▲▼",
        { fontSize: "9px", color: "#ffcc88" },
      ));
    }

    overlay.add(scene.add.text(
      panelX + 12, panelY + panelH - 20, "[Z/ESC] Close",
      { fontSize: "9px", color: "#888888" },
    ));

    overlay.setDepth?.(500);
    playerPanelOpen = true;
    if (stageEl?.dataset) {
      stageEl.dataset.gameplayPlayerPanelOpen = "true";
      stageEl.dataset.gameplayPlayerPanelSize = `${vw}x${vh}`;
    }
  }

  function clearHighlight() {
    if (!selectedActorKey) return;
    const entry = actorNodes.get(selectedActorKey);
    if (entry?.node) {
      entry.node.clearTint?.();
    }
    selectedActorKey = null;
  }

  function highlightActor(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const key = `${Math.floor(x)},${Math.floor(y)}`;
    clearHighlight();
    const entry = actorNodes.get(key);
    if (!entry) return false;
    entry.node.setTint?.(SELECTION_TINT);
    selectedActorKey = key;
    return true;
  }

  // A dedicated, non-zooming camera for the HUD. Created lazily so a scene without
  // camera support (or a test double) simply falls back to the main camera.
  function ensureHudCamera() {
    if (hudCamera) return hudCamera;
    const add = scene?.cameras?.add;
    if (typeof add !== "function") return null;
    hudCamera = scene.cameras.add(
      0, 0,
      cameraState.viewportWidth || 1,
      cameraState.viewportHeight || 1,
    ) || null;
    hudCamera?.setName?.("gameplay-hud-camera");
    hudCamera?.setZoom?.(1);
    hudCamera?.setScroll?.(0, 0);
    return hudCamera;
  }

  function attachHudCamera(overlay) {
    const cam = ensureHudCamera();
    if (!cam) return;
    // Each camera renders exactly one of the two worlds.
    cam.ignore?.(currentContainer ? [currentContainer] : []);
    scene?.cameras?.main?.ignore?.(overlay);
  }

  function hideHud() {
    if (hudContainer) {
      hudContainer.destroy(true);
      hudContainer = null;
    }
  }

  /**
   * Keep the canvas matched to its container.
   *
   * The game was sized once, at creation, and only re-sized on a re-render. The
   * gameplay tab lays out in a CSS grid (`1fr 200px`) with the inventory rail in
   * column two, but the game is created while the design layout is active and
   * full width -- so on switching tabs the canvas kept its old width and
   * overhung the rail by ~40px, clipping the inventory labels underneath it.
   * A tab switch does not re-render, so nothing corrected it.
   */
  function applyViewportSize() {
    const width = Math.max(1, Math.round(container?.clientWidth || 0));
    const height = Math.max(1, Math.round(container?.clientHeight || 0));
    if (width <= 1 || height <= 1) return;
    if (width === cameraState.viewportWidth && height === cameraState.viewportHeight) return;

    cameraState.viewportWidth = width;
    cameraState.viewportHeight = height;
    game?.scale?.resize?.(width, height);
    getCamera()?.setSize?.(width, height);
    hudCamera?.setSize?.(width, height);
    configureCamera({ resetView: false });
    // The HUD anchors to the viewport height at draw time, so it has to be
    // redrawn rather than merely resized.
    if (hudEntity) showHud(hudEntity);
    setStageCameraDataset();
  }

  function observeContainerSize() {
    if (resizeObserver || typeof globalThis.ResizeObserver !== "function" || !container) return;
    resizeObserver = new globalThis.ResizeObserver(() => applyViewportSize());
    resizeObserver.observe(container);
  }

  const hexToInt = (hex) => Number.parseInt(String(hex).replace("#", ""), 16);

  /**
   * Draw the selected-entity HUD, fixed to the camera at the bottom-left.
   *
   * This replaces the old world-space quick view, which anchored a 9px panel to
   * the entity's tile: it moved when the board moved, shrank with camera zoom,
   * and was the reason vitals were unreadable at the very zoom levels where you
   * most needed them. The HUD does not scroll (`setScrollFactor(0)`), so its
   * legibility is independent of the board.
   *
   * Vitals, expression and motivation are exactly what M1 removed from the
   * sprite; this is where they reappear, at readable size, for one entity.
   */
  function showHud(entity) {
    hideHud();
    hudEntity = entity ?? null;
    if (!scene?.add?.container) return;
    const model = buildActorHudModel(entity);
    if (!model) return;

    const rows = model.vitals.length;
    const maxRegen = model.vitals.reduce((m, v) => Math.max(m, v.regen), 0);
    const regenColW = maxRegen > 0 ? 6 + maxRegen * (REGEN_BLOCK_SIZE + REGEN_BLOCK_GAP) : 0;
    const panelW = HUD.padX * 2 + HUD.labelW + 6 + HUD.barW + 6 + HUD.valueW + regenColW;
    const hasFooter = Boolean(model.motivation);
    const panelH = HUD.padY * 2 + HUD.headerH + rows * HUD.rowH + (hasFooter ? HUD.footerH : 0);

    // Top-right. The board fills the screen now that the inventory rail is gone
    // from this view, and the top-right is the corner least likely to hold level
    // geometry the player is reading -- bottom-left sat over the entry room on
    // most generated levels.
    const vw = cameraState.viewportWidth || 400;
    const originX = Math.max(HUD.margin, vw - panelW - HUD.margin);
    const originY = HUD.margin;

    const overlay = scene.add.container(originX, originY);
    hudContainer = overlay;
    overlay.setScrollFactor?.(0);
    overlay.setDepth?.(HUD.depth);
    overlay.setName?.("gameplay-hud");

    // scrollFactor(0) stops the HUD SCROLLING with the board, but it does not stop
    // it ZOOMING: Phaser still scales scrollFactor-0 objects about the camera
    // centre, so at zoom 3 the panel was scaled 3x and pushed off screen. The fix
    // is a second camera at zoom 1 that renders only the HUD, with each camera
    // ignoring the other's objects -- the standard Phaser HUD arrangement, and the
    // only one that makes the panel genuinely independent of board zoom.
    attachHudCamera(overlay);

    const bg = scene.add.rectangle(panelW / 2, panelH / 2, panelW, panelH, HUD.bg, HUD.bgAlpha);
    bg.setStrokeStyle?.(1, HUD.border, 1);
    bg.setScrollFactor?.(0);
    overlay.add(bg);

    // Header: who this is, and the two identity channels the sprite does show,
    // so the HUD and the board can be checked against each other.
    const idText = scene.add.text(HUD.padX, HUD.padY, model.id || model.role, {
      fontSize: "11px", color: "#e8ecf0",
    });
    idText.setScrollFactor?.(0);
    overlay.add(idText);

    const identity = [model.affinity, model.expression].filter(Boolean).join(" \u00b7 ");
    if (identity) {
      const affinityHex = GAME_COLOR_PALETTE.affinities?.[model.affinity] || "#8a949e";
      const identityText = scene.add.text(HUD.padX + HUD.labelW + 6 + HUD.barW - 30, HUD.padY, identity, {
        fontSize: "10px", color: affinityHex,
      });
      identityText.setScrollFactor?.(0);
      identityText.setName?.("gameplay-hud-identity");
      overlay.add(identityText);
    }

    model.vitals.forEach((vital, i) => {
      const rowY = HUD.padY + HUD.headerH + i * HUD.rowH;
      const barX = HUD.padX + HUD.labelW + 6;
      const barY = rowY + HUD.rowH / 2 - HUD.barH / 2;
      const colorInt = hexToInt(vital.colorHex);

      const label = scene.add.text(HUD.padX, rowY, vital.label, { fontSize: "10px", color: vital.colorHex });
      label.setScrollFactor?.(0);
      overlay.add(label);

      // Track then fill: a proportional bar reads faster than a moving tick,
      // which is what the old quick view drew.
      const track = scene.add.rectangle(barX + HUD.barW / 2, barY + HUD.barH / 2, HUD.barW, HUD.barH, 0x232a31, 1);
      track.setScrollFactor?.(0);
      overlay.add(track);

      const fillW = Math.max(0, Math.round(HUD.barW * vital.fraction));
      if (fillW > 0) {
        const fill = scene.add.rectangle(barX + fillW / 2, barY + HUD.barH / 2, fillW, HUD.barH, colorInt, 1);
        fill.setScrollFactor?.(0);
        fill.setName?.(`gameplay-hud-bar:${vital.key}`);
        overlay.add(fill);
      }

      const value = scene.add.text(barX + HUD.barW + 6, rowY, `${vital.current}/${vital.max}`, {
        fontSize: "10px", color: vital.colorHex,
      });
      value.setScrollFactor?.(0);
      overlay.add(value);

      for (let b = 0; b < vital.regen; b += 1) {
        const bx = barX + HUD.barW + 6 + HUD.valueW + b * (REGEN_BLOCK_SIZE + REGEN_BLOCK_GAP);
        const block = scene.add.rectangle(bx, barY + HUD.barH / 2, REGEN_BLOCK_SIZE, REGEN_BLOCK_SIZE, colorInt, 1);
        block.setScrollFactor?.(0);
        overlay.add(block);
      }
    });

    if (hasFooter) {
      const footY = HUD.padY + HUD.headerH + rows * HUD.rowH;
      const motivation = scene.add.text(HUD.padX, footY, model.motivation, {
        fontSize: "10px", color: "#8a949e",
      });
      motivation.setScrollFactor?.(0);
      motivation.setName?.("gameplay-hud-motivation");
      overlay.add(motivation);
    }

    if (stageEl?.dataset) stageEl.dataset.gameplayHud = model.id || model.role;
  }

  async function ensureGame(boardState) {
    if (!stageEl) stageEl = ensureGameplayStageElement(container);
    if (!stageEl) return { ok: false, reason: "missing_stage" };

    const resourceBundle = boardState?.resourceBundle || null;
    currentBoardMetrics = normalizeTileMetrics(resourceBundle);
    const { tileWidth, tileHeight } = currentBoardMetrics;
    const boardWidthTiles = Math.max(1, boardState?.boardWidth || 1);
    const boardHeightTiles = Math.max(1, boardState?.boardHeight || 1);
    const viewportWidth = Math.max(1, container?.clientWidth || boardWidthTiles * tileWidth);
    const viewportHeight = Math.max(1, container?.clientHeight || boardHeightTiles * tileHeight);
    cameraState.viewportWidth = viewportWidth;
    cameraState.viewportHeight = viewportHeight;

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

    await sceneReady;
    return { ok: true };
  }

  async function drawBoard(boardState, { resetCamera = false, tickIndex = null } = {}) {
    const ready = await ensureGame(boardState);
    if (!ready?.ok || !scene) return ready;

    const resourceBundle = boardState?.resourceBundle || null;
    await preloadBundleTextures(resourceBundle);

    if (currentContainer) {
      currentContainer.destroy(true);
      currentContainer = null;
    }
    actorNodes.clear();
    selectedActorKey = null;

    const { tileWidth, tileHeight } = currentBoardMetrics;
    const tiles = Array.isArray(boardState?.tiles) ? boardState.tiles : [];
    const boardHeight = Math.max(1, boardState?.boardHeight || tiles.length || 1);
    const boardWidth = Math.max(1, boardState?.boardWidth || 1);
    const worldWidth = boardWidth * tileWidth;
    const worldHeight = boardHeight * tileHeight;
    const worldChanged = worldWidth !== cameraState.worldWidth || worldHeight !== cameraState.worldHeight;
    cameraState.worldWidth = worldWidth;
    cameraState.worldHeight = worldHeight;
    const actors = Array.isArray(boardState?.observation?.actors) ? boardState.observation.actors : [];
    if (stageEl?.dataset) {
      const diagnostics = actorDiagnostics(actors);
      const delverCount = diagnostics.filter((entry) => entry.role === "delver").length;
      const wardenCount = diagnostics.filter((entry) => entry.role === "warden").length;
      stageEl.dataset.gameplayWorldTiles = `${boardWidth}x${boardHeight}`;
      stageEl.dataset.gameplayActors = String(diagnostics.length);
      stageEl.dataset.gameplayDelvers = String(delverCount);
      stageEl.dataset.gameplayWardens = String(wardenCount);
      stageEl.dataset.gameplayActorPositions = JSON.stringify(diagnostics);
      if (Number.isInteger(tickIndex)) {
        stageEl.dataset.gameplayCurrentTick = String(tickIndex);
      }
    }
    configureCamera({ resetView: resetCamera || worldChanged });

    currentContainer = scene.add.container(0, 0);

    const tileTypeGrid = [];
    for (let y = 0; y < boardHeight; y += 1) {
      const row = String(tiles[y] || "");
      const typeRow = [];
      for (let x = 0; x < boardWidth; x += 1) {
        typeRow.push(tileSymbolToType(row[x] || "X"));
      }
      tileTypeGrid.push(typeRow);
    }

    // Board backgrounds come from the canonical tile palette (M2, 2026-09-02).
    // These were local literals that agreed with no other surface: the board drew
    // floor 0x3a3a3a while the level-preview image drew a pale green floor, and
    // GAME_COLOR_PALETTE.tiles -- the declared canonical set -- was read by nothing
    // but tests. The affinity palette's contrast guarantee is measured against
    // these values, so they cannot be re-invented here.
    // A stroke colour, not a fill. M3 briefly used tiles.wall here and dropped the
    // border's contrast against the floor from dE 69.7 to 9.7, so room outlines
    // nearly vanished. tileBorders is a separate group for exactly this reason.
    const WALL_BORDER_COLOR = hexToTint(GAME_COLOR_PALETTE.tileBorders.wall);
    const WALL_BORDER_ALPHA = 0.6;
    const WALL_BORDER_W = 2;

    // Single Graphics object for all wall-border strokes — one draw call for
    // the whole board instead of one Graphics instance per wall-adjacent
    // tile, which dropped strokes on larger dungeons.
    const wallG = scene.add.graphics();
    wallG.lineStyle(WALL_BORDER_W, WALL_BORDER_COLOR, WALL_BORDER_ALPHA);
    let hasAnyWall = false;
    const isWall = (ty, tx) => {
      if (ty < 0 || ty >= boardHeight || tx < 0 || tx >= boardWidth) return true;
      const t = tileTypeGrid[ty][tx];
      return t === "wall" || t === "barrier" || t === "inaccessible";
    };

    for (let y = 0; y < boardHeight; y += 1) {
      for (let x = 0; x < boardWidth; x += 1) {
        const tileType = tileTypeGrid[y][x];
        const cx = x * tileWidth + tileWidth / 2;
        const cy = y * tileHeight + tileHeight / 2;
        const isFloor = tileType === "floor" || tileType === "spawn" || tileType === "exit";

        // Flat fill from the canonical palette -- no tile PNG. The bundle still ships
        // medallion-era tile art, and drawing it on top of the palette colour meant
        // the canonical floor was never actually visible: what showed was a busy
        // checkered texture plus a detailed exit icon, both in the retired visual
        // language, competing with the two-channel sprites in front of them.
        const tile = scene.add.rectangle(
          cx, cy, tileWidth, tileHeight,
          hexToTint(GAME_COLOR_PALETTE.tiles[tileType] ?? GAME_COLOR_PALETTE.tiles.floor),
          1,
        );
        tile.setName?.(`tile:${tileType}`);
        currentContainer.add(tile);

        if (isFloor) {
          if (isWall(y - 1, x)) { wallG.beginPath(); wallG.moveTo(x * tileWidth, y * tileHeight); wallG.lineTo(x * tileWidth + tileWidth, y * tileHeight); wallG.strokePath(); hasAnyWall = true; }
          if (isWall(y + 1, x)) { wallG.beginPath(); wallG.moveTo(x * tileWidth, y * tileHeight + tileHeight); wallG.lineTo(x * tileWidth + tileWidth, y * tileHeight + tileHeight); wallG.strokePath(); hasAnyWall = true; }
          if (isWall(y, x - 1)) { wallG.beginPath(); wallG.moveTo(x * tileWidth, y * tileHeight); wallG.lineTo(x * tileWidth, y * tileHeight + tileHeight); wallG.strokePath(); hasAnyWall = true; }
          if (isWall(y, x + 1)) { wallG.beginPath(); wallG.moveTo(x * tileWidth + tileWidth, y * tileHeight); wallG.lineTo(x * tileWidth + tileWidth, y * tileHeight + tileHeight); wallG.strokePath(); hasAnyWall = true; }
        }

        const tileVisuals = boardState?.tileVisuals;
        if (tileVisuals) {
          const tileKey = `${x},${y}`;
          const visual = tileVisuals.get(tileKey);
          if (visual) {
            // The affinity field is an OVERLAY on the floor, not the floor's identity.
            //
            // It used to tint a floor texture, which multiplies and is therefore
            // subtle. Once tiles became flat fills, replacing the fill made a
            // full-intensity field repaint the tile solid -- and since a sprite is
            // drawn in its own affinity colour, an actor standing in its own field
            // became that colour on that colour, leaving only its outline visible.
            //
            // Drawing a separate capped-alpha rect above the tile keeps the floor
            // readable underneath and keeps the sprite distinct from its own field.
            const fieldAlpha = Math.min(
              MAX_FIELD_ALPHA,
              typeof visual.alpha === "number" ? visual.alpha : 1,
            );
            const field = scene.add.rectangle(cx, cy, tileWidth, tileHeight, visual.color, fieldAlpha);
            field.setName?.(`tile-field:${tileType}`);
            currentContainer.add(field);
            if (visual.overlayAssetId) {
              const overlayNode = scene.add.image(cx, cy, visual.overlayAssetId);
              if (overlayNode) {
                overlayNode.setDisplaySize?.(tileWidth, tileHeight);
                overlayNode.setOrigin?.(0.5);
                if (typeof visual.alpha === "number") overlayNode.setAlpha?.(visual.alpha);
                currentContainer.add(overlayNode);
              }
            }
          }
        }
      }
    }

    if (hasAnyWall) currentContainer.add(wallG);
    else wallG.destroy();

    for (const actor of actors) {
      const ax = Number.isFinite(actor?.position?.x) ? actor.position.x : null;
      const ay = Number.isFinite(actor?.position?.y) ? actor.position.y : null;
      if (ax === null || ay === null) continue;
      const cx = ax * tileWidth + tileWidth / 2;
      const cy = ay * tileHeight + tileHeight / 2;
      const actorImage = addSurfaceImageOrFallback(
        resourceBundle,
        "actors",
        inferActorRole(actor),
        actor,
        cx,
        cy,
        tileWidth,
        tileHeight,
      );
      actorNodes.set(`${ax},${ay}`, { node: actorImage });
      currentContainer.add(actorImage);
    }

    const hazards = Array.isArray(boardState?.observation?.hazards) ? boardState.observation.hazards : [];
    for (const hazard of hazards) {
      const hx = Number.isFinite(hazard?.position?.x) ? hazard.position.x : null;
      const hy = Number.isFinite(hazard?.position?.y) ? hazard.position.y : null;
      if (hx === null || hy === null) continue;
      const cx = hx * tileWidth + tileWidth / 2;
      const cy = hy * tileHeight + tileHeight / 2;
      const hazardShape = addSurfaceImageOrFallback(
        resourceBundle,
        "hazards",
        "hazard",
        hazard,
        cx,
        cy,
        tileWidth,
        tileHeight,
      );
      currentContainer.add(hazardShape);
    }

    const resources = Array.isArray(boardState?.observation?.resources) ? boardState.observation.resources : [];
    for (const resource of resources) {
      const rx = Number.isFinite(resource?.position?.x) ? resource.position.x : null;
      const ry = Number.isFinite(resource?.position?.y) ? resource.position.y : null;
      if (rx === null || ry === null) continue;
      const cx = rx * tileWidth + tileWidth / 2;
      const cy = ry * tileHeight + tileHeight / 2;
      const resourceShape = addSurfaceImageOrFallback(
        resourceBundle,
        "resources",
        "resource",
        resource,
        cx,
        cy,
        tileWidth,
        tileHeight,
      );
      currentContainer.add(resourceShape);
    }

    bindCameraInput();

    return { ok: true };
  }

  return {
    mount(nextContainer) {
      container = nextContainer || container;
      stageEl = ensureGameplayStageElement(container);
      observeContainerSize();
    },
    async renderRun(boardState, { tickIndex = null } = {}) {
      return drawBoard(boardState, { resetCamera: true, tickIndex });
    },
    async renderFrame(boardState, { tickIndex = null } = {}) {
      return drawBoard(boardState, { tickIndex });
    },
    setPlaybackControls(controls) {
      playbackControls = controls || null;
    },
    zoomIn() {
      return applyCameraZoom(cameraState.zoom * CAMERA_ZOOM_STEP);
    },
    zoomOut() {
      return applyCameraZoom(cameraState.zoom / CAMERA_ZOOM_STEP);
    },
    fitToLevel() {
      return fitCameraToWorld();
    },
    centerOnTile(position) {
      const x = Number(position?.x);
      const y = Number(position?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      getCamera()?.centerOn?.(
        x * currentBoardMetrics.tileWidth + currentBoardMetrics.tileWidth / 2,
        y * currentBoardMetrics.tileHeight + currentBoardMetrics.tileHeight / 2,
      );
      return true;
    },
    getCameraState() {
      return { ...cameraState };
    },
    openPlayerPanel,
    closePlayerPanel,
    isPlayerPanelOpen,
    highlightActor,
    clearHighlight,
    showHud,
    hideHud,
    dispose() {
      closePlayerPanel();
      clearHighlight();
      hideHud();
      hudEntity = null;
      hudCamera = null;
      resizeObserver?.disconnect?.();
      resizeObserver = null;
      actorNodes.clear();
      if (currentContainer) {
        currentContainer.destroy(true);
        currentContainer = null;
      }
      if (game) {
        game.destroy(true);
      }
      game = null;
      scene = null;
      sceneReady = null;
      inputBound = false;
      lastHoverTile = null;
      if (keydownHandler) {
        globalThis.removeEventListener?.("keydown", keydownHandler);
        keydownHandler = null;
      }
    },
  };
}
