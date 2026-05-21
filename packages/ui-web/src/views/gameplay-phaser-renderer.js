const DEFAULT_TILE_SIZE = 32;
const MIN_CAMERA_ZOOM = 0.25;
const MAX_CAMERA_ZOOM = 3;
const CAMERA_ZOOM_STEP = 1.2;
const DRAG_SELECT_THRESHOLD = 6;
const SELECTION_TINT = 0xffd700;
const VITAL_COLORS = {
  health:     { hex: "#ff4455", int: 0xff4455, label: "HP" },
  mana:       { hex: "#4499ff", int: 0x4499ff, label: "MP" },
  stamina:    { hex: "#44cc77", int: 0x44cc77, label: "ST" },
  durability: { hex: "#ffaa33", int: 0xffaa33, label: "DU" },
};
const DEFAULT_VITAL_COLOR = { hex: "#aaaaaa", int: 0xaaaaaa, label: "?" };
const VITAL_ORDER = ["health", "mana", "stamina", "durability"];
const REGEN_BLOCK_SIZE = 5;
const REGEN_BLOCK_GAP = 2;
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

function resolveActorAssetId(resourceBundle, actor = {}) {
  const role = inferActorRole(actor);
  const affinity = primaryAffinityKind(actor);
  const affinityAssetId = affinity ? resourceBundle?.mappings?.actors?.byRoleAndAffinity?.[role]?.[affinity] : "";
  return affinityAssetId || resourceBundle?.mappings?.actors?.[role] || null;
}

function resolveSurfaceAsset(resourceBundle, category, key, model = {}) {
  let assetId = null;
  if (category === "tiles") assetId = resourceBundle?.mappings?.tiles?.[key] || null;
  if (category === "actors") assetId = resolveActorAssetId(resourceBundle, model);
  if (category === "items") assetId = resourceBundle?.mappings?.items?.[key] || null;
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
  let quickViewContainer = null;
  let lastHoverTile = null;
  let actorNodes = new Map();
  let selectedActorKey = null;
  let playerPanelContainer = null;
  let playerPanelOpen = false;
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
    const fitZoom = clamp(
      Math.min(
        cameraState.viewportWidth / cameraState.worldWidth,
        cameraState.viewportHeight / cameraState.worldHeight,
        1,
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
    scene.input.keyboard?.on?.("keydown", (event) => {
      const key = String(event?.key || "").toLowerCase();
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
    });
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

  function addMissingBundleFallback(x, y, width, height) {
    const node = scene.add.rectangle(x, y, width, height, 0x111318, 0.92);
    node.setStrokeStyle?.(1, 0xff4d6d, 0.8);
    node.setData?.("intentionalMissingBundleFallback", true);
    return node;
  }

  function addSurfaceImageOrFallback(resourceBundle, category, key, model, x, y, width, height) {
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

    const actorAsset = resolveSurfaceAsset(model.resourceBundle, "actors", model.entityType, model);
    const actorImage = addBundleImage(actorAsset, panelX + 36, panelY + 68, 56, 56)
      || addMissingBundleFallback(panelX + 36, panelY + 68, 56, 56);
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

  function hideQuickView() {
    if (quickViewContainer) {
      quickViewContainer.destroy(true);
      quickViewContainer = null;
    }
  }

  function showQuickView(model) {
    hideQuickView();
    if (!scene || !model?.position) return;
    const { tileWidth, tileHeight } = currentBoardMetrics;
    const px = model.position.x * tileWidth + tileWidth / 2;
    const py = model.position.y * tileHeight;
    const overlayX = px + tileWidth;
    const overlayY = py - tileHeight * 0.5;

    const vitals = model.vitals && typeof model.vitals === "object" ? model.vitals : {};
    const orderedKeys = [...VITAL_ORDER.filter((k) => k in vitals), ...Object.keys(vitals).filter((k) => !VITAL_ORDER.includes(k))];

    const rowH = 18;
    const labelW = 22;
    const barW = 72;
    const valW = 30;
    const padX = 6;
    const headerH = 14;
    const footerH = model.equippedAffinity?.kind ? 14 : 0;
    const maxRegen = orderedKeys.reduce((m, k) => Math.max(m, Number(vitals[k]?.regen) || 0), 0);
    const regenColW = maxRegen > 0 ? 4 + maxRegen * (REGEN_BLOCK_SIZE + REGEN_BLOCK_GAP) : 0;
    const panelW = padX + labelW + 4 + barW + 4 + valW + regenColW + padX;
    const panelH = headerH + orderedKeys.length * rowH + footerH + 6;

    const overlay = scene.add.container(overlayX, overlayY);
    quickViewContainer = overlay;

    const bg = addSurfaceImageOrFallback(
      model.resourceBundle,
      "overlays",
      "darknessMask",
      null,
      panelW / 2,
      panelH / 2,
      panelW,
      panelH,
    );
    overlay.add(bg);

    const idLabel = scene.add.text(padX, 3, model.id ?? "", { fontSize: "9px", color: "#c8c8c8" });
    overlay.add(idLabel);

    orderedKeys.forEach((key, i) => {
      const vital = vitals[key];
      if (!vital || typeof vital !== "object") return;
      const { current = 0, max = 0, regen } = vital;
      const cfg = VITAL_COLORS[key] ?? DEFAULT_VITAL_COLOR;
      const rowY = headerH + i * rowH;
      const barX = padX + labelW + 4;
      const barY = rowY + rowH / 2 - 2;
      const tickH = 7;
      const indicatorH = 10;
      const frac = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;

      const labelNode = scene.add.text(padX, rowY + 2, cfg.label, { fontSize: "9px", color: cfg.hex });
      overlay.add(labelNode);

      // track
      const track = scene.add.rectangle(barX + barW / 2, barY, barW, 4, 0x222228, 1);
      overlay.add(track);

      // min tick (left edge)
      const minTick = scene.add.rectangle(barX, barY, 2, tickH, cfg.int, 1);
      overlay.add(minTick);

      // max tick (right edge)
      const maxTick = scene.add.rectangle(barX + barW, barY, 2, tickH, cfg.int, 1);
      overlay.add(maxTick);

      // current indicator
      const indX = barX + frac * barW;
      const indicator = scene.add.rectangle(indX, barY, 2, indicatorH, cfg.int, 1);
      overlay.add(indicator);

      const valText = scene.add.text(barX + barW + 4, rowY + 2, `${current}/${max}`, { fontSize: "9px", color: cfg.hex });
      overlay.add(valText);

      const regenCount = regen != null && regen > 0 ? Math.floor(regen) : 0;
      if (regenCount > 0) {
        const regenStartX = barX + barW + 4 + valW + 4;
        for (let bi = 0; bi < regenCount; bi++) {
          const bx = regenStartX + bi * (REGEN_BLOCK_SIZE + REGEN_BLOCK_GAP) + REGEN_BLOCK_SIZE / 2;
          overlay.add(scene.add.rectangle(bx, barY, REGEN_BLOCK_SIZE, REGEN_BLOCK_SIZE, cfg.int, 1));
        }
      }
    });

    if (model.equippedAffinity?.kind) {
      const affY = headerH + orderedKeys.length * rowH + 2;
      const affText = scene.add.text(padX, affY, model.equippedAffinity.kind, { fontSize: "9px", color: "#88aaff" });
      overlay.add(affText);
    }

    overlay.setDepth?.(200);
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

  async function drawBoard(boardState, { resetCamera = false } = {}) {
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
    }
    configureCamera({ resetView: resetCamera || worldChanged });

    currentContainer = scene.add.container(0, 0);

    for (let y = 0; y < boardHeight; y += 1) {
      const row = String(tiles[y] || "");
      for (let x = 0; x < boardWidth; x += 1) {
        const symbol = row[x] || "X";
        const cx = x * tileWidth + tileWidth / 2;
        const cy = y * tileHeight + tileHeight / 2;
        const tile = addSurfaceImageOrFallback(
          resourceBundle,
          "tiles",
          tileSymbolToType(symbol),
          null,
          cx,
          cy,
          tileWidth,
          tileHeight,
        );
        currentContainer.add(tile);

        // Apply tile affinity visuals (tint, alpha, overlay) when present.
        const tileVisuals = boardState?.tileVisuals;
        if (tileVisuals) {
          const tileKey = `${x},${y}`;
          const visual = tileVisuals.get(tileKey);
          if (visual) {
            tile.setTint?.(visual.color);
            if (typeof visual.alpha === "number") tile.setAlpha?.(visual.alpha);
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
        "items",
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
        "items",
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
    },
    async renderRun(boardState) {
      return drawBoard(boardState, { resetCamera: true });
    },
    async renderFrame(boardState) {
      return drawBoard(boardState);
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
    showQuickView,
    hideQuickView,
    dispose() {
      closePlayerPanel();
      clearHighlight();
      hideQuickView();
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
    },
  };
}
