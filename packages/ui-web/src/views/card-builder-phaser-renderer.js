import { buildPropertyCatalog } from "../card-builder-controller.js";
import {
  GAME_ICON_FALLBACKS,
  GAME_VITAL_KEYS,
  GAME_AFFINITY_COLOR_HEX,
  GAME_AFFINITY_EXPRESSIONS,
} from "../../../runtime/src/contracts/game-elements.js";
import { ROOM_SIZE_ORDER, ROOM_SHAPE_ORDER } from "../../../runtime/src/commands/card-authoring.js";
import { resolveIconHTML } from "../icon-resolver.js";

export const CARD_BUILDER_UI_INTENTS = Object.freeze([
  "drag_chip",
  "drop_chip",
  "select_card",
  "move_card_between_groups",
]);

const UI_INTENT_SET = new Set(CARD_BUILDER_UI_INTENTS);

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 520;
const TAB_BAR_H = 40;
const STATUS_BAR_H = 28;
const GAP = 6;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_DEFAULT = "#e6e8ee";
const COLOR_HOVER = "#ffdd88";
const COLOR_TYPE = "#b8c8e8";
const COLOR_AFFINITY = "#c8d8e8";
const COLOR_EXPRESSION = "#d8c8e8";
const COLOR_MOTIVATION = "#c8e8b8";
const COLOR_CARD = "#9fe6a0";
const COLOR_HEADER = "#888ea8";
const COLOR_DISABLED = "#383e4a";
const COLOR_STATUS_OK = "#9fe6a0";
const COLOR_STATUS_ERROR = "#ff6b6b";
const COLOR_SHELVE_BTN = "#f0d060";
const COLOR_ROOM_SIZE = "#e8d0a8";
const COLOR_APPLIED = "#a8d8e8";

const BG_EDITOR = 0x242838;
const BG_PALETTE = 0x13161f;
const BG_SHELF = 0x13161f;

function defaultLoadPhaser() {
  return import("/node_modules/phaser/dist/phaser.esm.js").then((m) => m.default || m);
}

function ensureStageElement(container) {
  if (!container) return null;
  let stage = container.querySelector?.("[data-card-builder-phaser-stage]");
  if (stage) return stage;
  const create = globalThis.document?.createElement?.bind?.(globalThis.document);
  stage = create ? create("div") : { dataset: {}, classList: { add() {} } };
  if (stage.dataset) stage.dataset.cardBuilderPhaserStage = "true";
  if (stage.classList?.add) stage.classList.add("card-builder-phaser-stage");
  container.appendChild(stage);
  return stage;
}

// Shelf-only layout: inventory rail fills the entire canvas.
function computeShelfLayout(canvasW, canvasH) {
  const PAD = 8;
  const topOffset = 0;
  return {
    shelfX: PAD,
    shelfW: canvasW - PAD * 2,
    canvasW,
    canvasH,
    contentH: canvasH - STATUS_BAR_H - topOffset,
    topOffset,
  };
}

// Compute panel layout proportionally from the actual canvas dimensions.
function computeLayout(canvasW, canvasH) {
  const topOffset = 0;
  const paletteX = GAP;
  const paletteW = 280;
  const editorX = paletteX + paletteW + GAP;
  const shelfW = Math.max(140, Math.floor(canvasW * 0.18));
  const shelfX = canvasW - shelfW - GAP;
  const editorW = Math.max(180, shelfX - editorX - GAP);
  const contentH = canvasH - STATUS_BAR_H - topOffset;
  return { paletteX, paletteW, editorX, editorW, shelfX, shelfW, canvasW, canvasH, contentH, topOffset };
}

export function createCardBuilderPhaserRenderer({
  controller,
  loadPhaser = defaultLoadPhaser,
  onIntent,
  onInventorySelect,
} = {}) {
  if (!controller) {
    throw new Error("createCardBuilderPhaserRenderer requires a controller");
  }

  let container = null;
  let stageEl = null;
  let game = null;
  let scene = null;
  let sceneReady = null;
  let lastSnapshot = null;

  let chipRegistry = [];
  let activeObjects = [];
  let hoveredChip = null;
  // Maps icon HTML string (or dataUri) → loaded Phaser texture key, or null if failed.
  const iconTextureCache = new Map();
  let nextIconTextureId = 0;
  // Resource bundle passed directly by the host — bypasses module-level shared state.
  let rendererBundle = null;
  // Active tab — kept in sync via setActiveTab() called from main.js wireTabs onChange.
  let activeTab = "design";
  // Render mode: "design" = full card builder, "shelf" = shelf-only companion rail.
  let renderMode = "design";

  // ---------------------------------------------------------------------------
  // Icon texture loading — loads bundle dataUri images into Phaser once per session
  // ---------------------------------------------------------------------------

  async function loadIconTextures(entries) {
    if (!scene) return;
    const toLoad = entries.filter((e) => {
      if (typeof e.icon !== "string" || !e.icon.startsWith("<img")) return false;
      return !iconTextureCache.has(e.icon);
    });
    await Promise.all(
      toLoad.map((e) => {
        const match = e.icon.match(/src="([^"]+)"/);
        if (!match) { iconTextureCache.set(e.icon, null); return Promise.resolve(); }
        const dataUri = match[1];
        const key = `cb-icon-${nextIconTextureId++}`;
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              if (!scene.textures.exists(key)) scene.textures.addImage(key, img);
              iconTextureCache.set(e.icon, key);
            } catch { iconTextureCache.set(e.icon, null); }
            resolve();
          };
          img.onerror = () => { iconTextureCache.set(e.icon, null); resolve(); };
          img.src = dataUri;
        });
      }),
    );
  }

  // Maps catalog group + value → [resolveIconHTML category, key].
  function catalogIconCategory(group, value) {
    if (group === "type") {
      if (value === "hazard" || value === "resource") return ["items", value];
      return ["types", value];
    }
    if (group === "affinities") return ["affinities", value];
    if (group === "expressions") return ["expressions", value];
    if (group === "motivations") return ["motivations", value];
    return [null, null];
  }

  // Returns a catalog where each entry.icon is resolved from rendererBundle
  // (if available) instead of the shared module-level resource bundle.
  function buildResolvedCatalog() {
    const catalog = buildPropertyCatalog();
    if (!rendererBundle) return catalog;
    const resolveEntry = (entry, group) => {
      const [cat, key] = catalogIconCategory(group, entry.value);
      return { ...entry, icon: cat ? resolveIconHTML(rendererBundle, cat, key) : entry.icon };
    };
    return {
      type: catalog.type.map((e) => resolveEntry(e, "type")),
      affinities: catalog.affinities.map((g) => ({
        ...g,
        options: g.options.map((o) => resolveEntry(o, "affinities")),
      })),
      expressions: catalog.expressions.map((g) => ({
        ...g,
        options: g.options.map((o) => resolveEntry(o, "expressions")),
      })),
      motivations: catalog.motivations.map((g) => ({
        ...g,
        options: g.options.map((o) => resolveEntry(o, "motivations")),
      })),
    };
  }

  // Collects { icon } entries for the active card's editor-panel icons (type,
  // applied affinities/expressions, motivations, vitals) so render() can
  // preload their textures alongside the palette catalog icons.
  function buildEditorIconEntries(card) {
    if (!card) return [];
    const entries = [];
    const type = card.type || "";
    if (type) {
      const [cat, key] = catalogIconCategory("type", type);
      if (cat) entries.push({ icon: resolveIconHTML(rendererBundle, cat, key) });
    }
    (Array.isArray(card.affinities) ? card.affinities : []).forEach((entry) => {
      entries.push({ icon: resolveIconHTML(rendererBundle, "affinities", entry.kind) });
      entries.push({ icon: resolveIconHTML(rendererBundle, "expressions", entry.expression) });
    });
    (Array.isArray(card.motivations) ? card.motivations : []).forEach((m) => {
      entries.push({ icon: resolveIconHTML(rendererBundle, "motivations", m) });
    });
    if (type === "delver" || type === "warden") {
      GAME_VITAL_KEYS.forEach((vitalKey) => {
        entries.push({ icon: resolveIconHTML(rendererBundle, "vitals", vitalKey) });
      });
    }
    return entries;
  }

  // ---------------------------------------------------------------------------
  // Scene management
  // ---------------------------------------------------------------------------

  function clearScene() {
    for (const obj of activeObjects) obj?.destroy?.();
    activeObjects = [];
    chipRegistry = [];
    hoveredChip = null;
  }

  function addObj(obj) {
    if (obj) activeObjects.push(obj);
    return obj;
  }

  // ---------------------------------------------------------------------------
  // Intent routing
  // ---------------------------------------------------------------------------

  function emit(intent) {
    if (!intent || !UI_INTENT_SET.has(intent.kind)) {
      return { ok: false, reason: "unsupported_intent" };
    }
    if (typeof onIntent === "function") onIntent(intent);
    return applyIntent(intent);
  }

  function applyIntent(intent) {
    switch (intent.kind) {
      case "drop_chip":
        return controller.applyPropertyDrop(intent.cardId, intent.property);
      case "select_card":
        return { ok: controller.pullCardToEditor(intent.cardId) === true };
      case "move_card_between_groups":
        return { ok: controller.stashActiveCard(intent.group) === true };
      case "drag_chip":
        return { ok: true };
      default:
        return { ok: false, reason: "unsupported_intent" };
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------

  function drawRect(x, y, w, h, color, alpha = 1) {
    if (!scene) return null;
    return addObj(scene.add.rectangle(x + w / 2, y + h / 2, w, h, color, alpha));
  }

  function drawText(x, y, text, style = {}) {
    if (!scene) return null;
    return addObj(scene.add.text(x, y, String(text), { fontSize: "14px", color: COLOR_DEFAULT, ...style }));
  }

  function drawHeader(x, y, label, style = {}) {
    return drawText(x, y, label, { fontSize: "12px", color: COLOR_HEADER, ...style });
  }

  // Full-width section band: dim background strip with a label, returns next row.
  function drawSectionBand(x, y, w, label) {
    const H = 18;
    drawRect(x, y, w, H, 0x1a2035, 1);
    drawText(x + 6, y + 2, label, { fontSize: "11px", color: "#6272a4" });
    return y + H + 4;
  }

  // Draws a bundle icon image at (x, y) sized to `size` if a texture is loaded for it.
  // Returns { drawn, isBundle } so callers can fall back to a unicode-prefixed label.
  function drawIconAt(x, y, icon, size, { alpha = 1 } = {}) {
    if (!scene || typeof icon !== "string") return { drawn: false, isBundle: false };
    const isBundle = icon.startsWith("<img");
    const textureKey = isBundle ? iconTextureCache.get(icon) : null;
    if (textureKey && scene.textures.exists(textureKey)) {
      addObj(
        scene.add.image(x + size / 2, y + size / 2, textureKey)
          .setDisplaySize(size, size)
          .setAlpha(alpha),
      );
      return { drawn: true, isBundle: true };
    }
    return { drawn: false, isBundle };
  }

  // ---------------------------------------------------------------------------
  // Palette chip — zone: "palette"
  // ---------------------------------------------------------------------------

  function drawPaletteChip(x, y, label, property, { icon, color = COLOR_DEFAULT, enabled = true, iconSize = 36 } = {}) {
    if (!scene) return null;
    const ICON_SIZE = iconSize;
    const ICON_PAD = 4;
    const effectiveColor = enabled ? color : COLOR_DISABLED;

    // Determine text x-offset and whether to render an image icon.
    let textX = x;
    let displayLabel = label;
    let iconObj = null;

    if (icon) {
      const isBundleHtml = typeof icon === "string" && icon.startsWith("<img");
      const textureKey = isBundleHtml ? iconTextureCache.get(icon) : null;

      if (textureKey && scene.textures.exists(textureKey)) {
        iconObj = addObj(
          scene.add.image(x + ICON_SIZE / 2, y + ICON_SIZE / 2, textureKey)
            .setDisplaySize(ICON_SIZE, ICON_SIZE)
            .setAlpha(enabled ? 1 : 0.25),
        );
        textX = x + ICON_SIZE + ICON_PAD;
      } else if (!isBundleHtml) {
        displayLabel = `${icon} ${label}`;
      }
    }

    // Vertically center text alongside the icon.
    const textY = y + Math.max(0, (ICON_SIZE - 16) / 2);
    const obj = addObj(scene.add.text(textX, textY, displayLabel, { fontSize: "14px", color: effectiveColor }));
    const chipW = (textX - x) + obj.width;
    const chipH = Math.max(ICON_SIZE, obj.height);

    chipRegistry.push({
      label: displayLabel,
      group: property.group,
      value: property.value,
      zone: "palette",
      enabled,
      ...(property.affinityKind ? { affinityKind: property.affinityKind } : {}),
      x,
      y,
      width: chipW,
      height: chipH,
    });

    if (enabled) {
      // Transparent hit-rect covers the full chip (icon + text) from the chip's top-left.
      const hit = addObj(
        scene.add.rectangle(x + chipW / 2, y + chipH / 2, chipW, chipH, 0x000000, 0)
          .setInteractive({ useHandCursor: true }),
      );
      hit.on("pointerover", () => { hoveredChip = displayLabel; obj.setStyle({ color: COLOR_HOVER }); });
      hit.on("pointerout", () => { if (hoveredChip === displayLabel) hoveredChip = null; obj.setStyle({ color: effectiveColor }); });
      hit.on("pointerdown", () => {
        const activeCard = controller.getActiveCard();
        if (!activeCard?.id) return;
        applyIntent({ kind: "drop_chip", cardId: activeCard.id, property });
        void render();
      });
    }

    return obj;
  }

  // ---------------------------------------------------------------------------
  // Editor chip — zone: "editor"
  // ---------------------------------------------------------------------------

  function drawEditorChip(x, y, label, { role, group, value, color = COLOR_DEFAULT, interactive = false, onDown } = {}) {
    if (!scene) return null;
    const obj = scene.add.text(x, y, label, { fontSize: "14px", color });

    chipRegistry.push({
      label,
      zone: "editor",
      ...(role ? { role } : {}),
      ...(group ? { group } : {}),
      ...(value !== undefined ? { value } : {}),
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
    });

    if (interactive) {
      obj.setInteractive({ useHandCursor: true });
      obj.on("pointerover", () => { hoveredChip = label; obj.setStyle({ color: COLOR_HOVER }); });
      obj.on("pointerout", () => { if (hoveredChip === label) hoveredChip = null; obj.setStyle({ color }); });
      obj.on("pointerdown", () => {
        if (typeof onDown === "function") onDown();
        void render();
      });
    }

    addObj(obj);
    return obj;
  }

  // ---------------------------------------------------------------------------
  // Shelf card chip — zone: "shelf"
  // ---------------------------------------------------------------------------

  function drawShelfCard(x, y, card) {
    if (!scene) return null;
    const tokens = card.cardValue?.totalTokens ?? 0;
    const isActor = card.type === "delver" || card.type === "warden";

    const ICON_SIZE = 16;
    const ICON_PAD = 4;
    const PIP_R = 5;
    const [iconCat, iconKey] = catalogIconCategory("type", card.type);
    const iconHtml = iconCat ? resolveIconHTML(rendererBundle, iconCat, iconKey) : null;
    const { drawn } = drawIconAt(x, y + 1, iconHtml, ICON_SIZE);

    // Affinity color pip
    let pipEndX = x;
    if (card.affinity) {
      const pipHex = GAME_AFFINITY_COLOR_HEX[card.affinity] || "#888888";
      const pipNum = parseInt(pipHex.replace("#", ""), 16);
      const pipG = addObj(scene.add.graphics());
      pipG.fillStyle(pipNum, 1);
      pipG.fillCircle(x + PIP_R, y + ICON_SIZE / 2 + 1, PIP_R);
      pipEndX = x + PIP_R * 2 + 3;
    }

    const textX = drawn ? Math.max(pipEndX, x + ICON_SIZE + ICON_PAD) : pipEndX;
    const typeEmoji = drawn ? "" : (GAME_ICON_FALLBACKS.types?.[card.type] || GAME_ICON_FALLBACKS.items?.[card.type] || "◈");
    const labelText = typeEmoji
      ? `${typeEmoji} ${card.id}  x${card.count}  ${tokens}t`
      : `${card.id}  x${card.count}  ${tokens}t`;

    const obj = addObj(scene.add.text(textX, y, labelText, { fontSize: "13px", color: COLOR_CARD }));

    // Second line: motivation + vitals for actors
    const ROW2_Y = y + 18;
    if (isActor) {
      let r2x = x + 2;
      const motivations = Array.isArray(card.motivations) ? card.motivations : [];
      if (motivations.length > 0) {
        const motLabel = motivations[0].length > 6 ? motivations[0].slice(0, 6) + "…" : motivations[0];
        addObj(scene.add.text(r2x, ROW2_Y, motLabel, { fontSize: "9px", color: COLOR_MOTIVATION }));
        r2x += motLabel.length * 5.5 + 6;
      }
      const vitals = card.vitals;
      if (vitals) {
        const VITAL_COLORS = { health: 0xff3030, mana: 0x269cff, stamina: 0x4cff28, durability: 0xffa412 };
        const BAR_W = 16;
        const BAR_H = 4;
        const BAR_GAP = 2;
        ["health", "mana", "stamina", "durability"].forEach((vk) => {
          const v = vitals[vk];
          if (!v || !v.max) return;
          const vg = addObj(scene.add.graphics());
          vg.fillStyle(0x1a1a1a, 1);
          vg.fillRect(r2x, ROW2_Y + 2, BAR_W, BAR_H);
          const fill = Math.min(1, v.max / 12);
          vg.fillStyle(VITAL_COLORS[vk] || 0x888888, 0.8);
          vg.fillRect(r2x, ROW2_Y + 2, Math.round(BAR_W * fill), BAR_H);
          r2x += BAR_W + BAR_GAP;
        });
      }
    }

    const totalW = Math.max((textX - x) + (obj.width || 120), 100);
    const totalH = isActor ? 32 : Math.max(ICON_SIZE + 2, obj.height || 18);
    const hitRect = addObj(
      scene.add.rectangle(x + totalW / 2, y + totalH / 2, totalW, totalH, 0x000000, 0)
        .setInteractive({ useHandCursor: true }),
    );

    chipRegistry.push({
      label: labelText,
      group: "_card",
      value: card.id,
      cardId: card.id,
      typeGroup: card.type || "",
      zone: "shelf",
      x,
      y,
      width: totalW,
      height: totalH,
    });

    hitRect.on("pointerover", () => { hoveredChip = labelText; obj.setStyle({ color: COLOR_HOVER }); });
    hitRect.on("pointerout", () => { if (hoveredChip === labelText) hoveredChip = null; obj.setStyle({ color: COLOR_CARD }); });
    hitRect.on("pointerdown", () => {
      if (renderMode === "shelf") {
        obj.setStyle({ color: "#ffffff" });
        scene.time?.delayedCall?.(150, () => obj.setStyle({ color: COLOR_CARD }));
        const found = onInventorySelect?.(card);
        if (found === null || found === undefined) {
          obj.setStyle({ color: COLOR_HOVER });
          scene.time?.delayedCall?.(400, () => obj.setStyle({ color: COLOR_CARD }));
        }
      } else {
        controller.pullCardToEditor?.(card.id);
        void render();
      }
    });

    return obj;
  }

  // ---------------------------------------------------------------------------
  // Gameplay arrow — top-right directional control replacing the tab bar.
  // ---------------------------------------------------------------------------

  function drawGameplayArrow({ canvasW }) {
    const SZ = 28;
    const PAD = 8;
    const cx = canvasW - PAD - SZ / 2;
    const cy = PAD + SZ / 2;

    const bg = addObj(scene.add.graphics());
    bg.fillStyle(0x2a3a4a, 1);
    bg.fillRoundedRect(cx - SZ / 2, cy - SZ / 2, SZ, SZ, 6);
    bg.lineStyle(1, 0x5a7a9a, 0.8);
    bg.strokeRoundedRect(cx - SZ / 2, cy - SZ / 2, SZ, SZ, 6);
    bg.fillStyle(0x9ac8ff, 1);
    bg.fillTriangle(cx - 5, cy - 7, cx + 7, cy, cx - 5, cy + 7);

    const hit = addObj(
      scene.add.rectangle(cx, cy, SZ, SZ, 0, 0).setInteractive({ useHandCursor: true }),
    );
    hit.on("pointerover", () => {
      bg.clear();
      bg.fillStyle(0x3a4a5a, 1);
      bg.fillRoundedRect(cx - SZ / 2, cy - SZ / 2, SZ, SZ, 6);
      bg.lineStyle(1, 0x7a9aba, 1);
      bg.strokeRoundedRect(cx - SZ / 2, cy - SZ / 2, SZ, SZ, 6);
      bg.fillStyle(0xc8e0ff, 1);
      bg.fillTriangle(cx - 5, cy - 7, cx + 7, cy, cx - 5, cy + 7);
    });
    hit.on("pointerout", () => {
      bg.clear();
      bg.fillStyle(0x2a3a4a, 1);
      bg.fillRoundedRect(cx - SZ / 2, cy - SZ / 2, SZ, SZ, 6);
      bg.lineStyle(1, 0x5a7a9a, 0.8);
      bg.strokeRoundedRect(cx - SZ / 2, cy - SZ / 2, SZ, SZ, 6);
      bg.fillStyle(0x9ac8ff, 1);
      bg.fillTriangle(cx - 5, cy - 7, cx + 7, cy, cx - 5, cy + 7);
    });
    hit.on("pointerdown", () => { globalThis.__ak_setActiveTab?.("gameplay"); });
  }

  // ---------------------------------------------------------------------------
  // Panel: PALETTE
  // ---------------------------------------------------------------------------

  function drawPalette({ paletteX, paletteW, contentH, topOffset }, catalog) {
    drawRect(paletteX - GAP, topOffset, paletteW + GAP * 2, contentH, BG_PALETTE);

    const activeType = controller.getActiveCard()?.type || "";
    const activeAffinities = controller.getActiveCard()?.affinities || [];
    const hasType = Boolean(activeType);
    const hasAffinity = activeAffinities.length > 0;
    const isActor = activeType === "delver" || activeType === "warden";
    const halfW = Math.floor((paletteW - 4) / 2);

    const typeRows = Math.ceil(catalog.type.length / 2);
    const affRows = catalog.affinities.length;
    const exprRows = catalog.expressions.length;
    const motRows = catalog.motivations.length;
    const totalRows = typeRows + affRows + exprRows + motRows;
    const headerSpace = 4 * 14 + 4 * 4;
    const available = contentH - headerSpace - 16;
    const CHIP_ROW = Math.min(44, Math.max(28, Math.floor(available / totalRows)));

    let row = topOffset + 4;

    drawHeader(paletteX, row, "TYPE");
    row += 14;
    catalog.type.forEach((entry, i) => {
      drawPaletteChip(
        paletteX + (i % 2) * halfW,
        row + Math.floor(i / 2) * CHIP_ROW,
        entry.label,
        { group: "type", value: entry.value },
        { icon: entry.icon, color: COLOR_TYPE, enabled: true, iconSize: CHIP_ROW - 6 },
      );
    });
    row += typeRows * CHIP_ROW + 2;

    drawHeader(paletteX, row, "AFFINITIES");
    row += 14;
    catalog.affinities.forEach((group) => {
      group.options.forEach((option, idx) => {
        drawPaletteChip(
          paletteX + idx * halfW,
          row,
          option.label,
          { group: "affinities", value: option.value },
          { icon: option.icon, color: COLOR_AFFINITY, enabled: hasType, iconSize: CHIP_ROW - 6 },
        );
      });
      row += CHIP_ROW;
    });
    row += 4;

    drawHeader(paletteX, row, "EXPRESSIONS");
    row += 14;
    catalog.expressions.forEach((group) => {
      group.options.forEach((option, idx) => {
        drawPaletteChip(
          paletteX + idx * halfW,
          row,
          option.label,
          { group: "expressions", value: option.value },
          { icon: option.icon, color: COLOR_EXPRESSION, enabled: hasType && hasAffinity, iconSize: CHIP_ROW - 6 },
        );
      });
      row += CHIP_ROW;
    });
    row += 2;

    drawHeader(paletteX, row, "MOTIVATIONS");
    row += 14;
    catalog.motivations.forEach((group) => {
      group.options.forEach((option, idx) => {
        drawPaletteChip(
          paletteX + idx * halfW,
          row,
          option.label,
          { group: "motivations", value: option.value },
          { icon: option.icon, color: COLOR_MOTIVATION, enabled: isActor, iconSize: CHIP_ROW - 6 },
        );
      });
      row += CHIP_ROW;
    });
  }

  // ---------------------------------------------------------------------------
  // Affinity stacks — each row represents one stack: affinity + expression × count.
  // ---------------------------------------------------------------------------

  function drawAffinityBlocks({ editorX, editorW }, activeCard, startRow) {
    if (!scene) return startRow;

    const affinities = Array.isArray(activeCard?.affinities) ? activeCard.affinities : [];
    if (affinities.length === 0) return startRow;

    const ROW_H = 26;
    const ROW_GAP = 3;
    const ICON_SZ = 20;
    const BTN_SZ = 14;
    const PAD = 6;

    function hexToNum(hex) {
      return parseInt((hex || "#888888").replace("#", ""), 16);
    }

    let row = startRow + PAD;

    affinities.forEach((entry) => {
      const { kind, expression, stacks } = entry;
      const colHex = GAME_AFFINITY_COLOR_HEX[kind] || "#6688aa";
      const colNum = hexToNum(colHex);
      const chipX = editorX;
      const chipW = editorW;
      const cy = row + ROW_H / 2;

      const bg = addObj(scene.add.graphics());
      bg.fillStyle(colNum, 0.12);
      bg.fillRoundedRect(chipX, row, chipW, ROW_H, 4);
      bg.lineStyle(1, colNum, 0.35);
      bg.strokeRoundedRect(chipX, row, chipW, ROW_H, 4);

      let cx = chipX + 4;

      const affIconHtml = resolveIconHTML(rendererBundle, "affinities", kind);
      const affDrawn = drawIconAt(cx, row + (ROW_H - ICON_SZ) / 2, affIconHtml, ICON_SZ);
      cx += ICON_SZ + 4;

      addObj(scene.add.text(cx, cy, kind, { fontSize: "11px", color: "#e0e0e0" }).setOrigin(0, 0.5));
      cx += kind.length * 7 + 6;

      addObj(scene.add.text(cx, cy, "+", { fontSize: "10px", color: "#888888" }).setOrigin(0, 0.5));
      cx += 12;

      const exprStartX = cx;
      const exprIconHtml = resolveIconHTML(rendererBundle, "expressions", expression);
      drawIconAt(cx, row + (ROW_H - (ICON_SZ - 4)) / 2, exprIconHtml, ICON_SZ - 4);
      cx += ICON_SZ;

      const exprTxt = addObj(scene.add.text(cx, cy, expression, { fontSize: "11px", color: "#e0e0e0" }).setOrigin(0, 0.5));
      const exprHitW = (cx - exprStartX) + expression.length * 7 + 8;
      const exprHit = addObj(
        scene.add.rectangle(exprStartX + exprHitW / 2, cy, exprHitW, ROW_H, 0, 0).setInteractive({ useHandCursor: true }),
      );
      exprHit.on("pointerover", () => exprTxt.setStyle({ color: COLOR_HOVER }));
      exprHit.on("pointerout", () => exprTxt.setStyle({ color: "#e0e0e0" }));
      exprHit.on("pointerdown", () => {
        const id = controller.getActiveCard()?.id;
        if (id) { controller.cycleAffinityExpression?.(id, kind); void render(); }
      });

      const rightEdge = chipX + chipW - 4;

      const removeTxt = addObj(scene.add.text(rightEdge, cy, "×", { fontSize: "12px", color: "#ff6666" }).setOrigin(1, 0.5));
      const removeHit = addObj(scene.add.rectangle(rightEdge - 6, cy, BTN_SZ, BTN_SZ, 0, 0).setInteractive({ useHandCursor: true }));
      removeHit.on("pointerover", () => removeTxt.setStyle({ color: "#ff9999" }));
      removeHit.on("pointerout", () => removeTxt.setStyle({ color: "#ff6666" }));
      removeHit.on("pointerdown", () => {
        const id = controller.getActiveCard()?.id;
        if (id) { applyIntent({ kind: "drop_chip", cardId: id, property: { group: "affinities", value: kind } }); void render(); }
      });

      const plusX = rightEdge - BTN_SZ - 8;
      const plusTxt = addObj(scene.add.text(plusX, cy, "+", { fontSize: "12px", color: colHex }).setOrigin(0.5, 0.5));
      const plusHit = addObj(scene.add.rectangle(plusX, cy, BTN_SZ, BTN_SZ, 0, 0).setInteractive({ useHandCursor: true }));
      plusHit.on("pointerover", () => plusTxt.setStyle({ color: COLOR_HOVER }));
      plusHit.on("pointerout", () => plusTxt.setStyle({ color: colHex }));
      plusHit.on("pointerdown", () => {
        const id = controller.getActiveCard()?.id;
        if (id) { controller.adjustAffinityStack?.(id, kind, 1, expression); void render(); }
      });

      const minusX = plusX - BTN_SZ - 4;
      const minusTxt = addObj(scene.add.text(minusX, cy, "−", { fontSize: "12px", color: colHex }).setOrigin(0.5, 0.5));
      const minusHit = addObj(scene.add.rectangle(minusX, cy, BTN_SZ, BTN_SZ, 0, 0).setInteractive({ useHandCursor: true }));
      minusHit.on("pointerover", () => minusTxt.setStyle({ color: COLOR_HOVER }));
      minusHit.on("pointerout", () => minusTxt.setStyle({ color: colHex }));
      minusHit.on("pointerdown", () => {
        const id = controller.getActiveCard()?.id;
        if (id) { controller.adjustAffinityStack?.(id, kind, -1, expression); void render(); }
      });

      const countX = minusX - 8;
      addObj(scene.add.text(countX, cy, `×${stacks}`, { fontSize: "12px", color: "#ffffff", fontStyle: "bold" }).setOrigin(1, 0.5));

      chipRegistry.push({ label: `${kind}:${expression}`, zone: "editor", group: "affinities", role: "affinity_stack",
        value: `${kind}:${expression}`, x: chipX, y: row, width: chipW, height: ROW_H });

      row += ROW_H + ROW_GAP;
    });

    return row + PAD;
  }

  // Vital edge bars — mirrors actor-medallion drawVitalBars layout:
  //   durability=top(H), health=right(V), stamina=bottom(H), mana=left(V)
  // Bar length encodes max (out of 12); bar thickness encodes regen.
  // Max +/- sit at the bar ends; regen +/- sit at the midpoint, perpendicular.
  // ---------------------------------------------------------------------------

  function drawVitalEdgeBars({ editorX, editorW }, activeCard, startRow) {
    if (!scene) return startRow;

    const CARD_SZ = 100;
    const OFFSET  = 18;  // gap from card edge to bar centre
    const CG      = 12;  // corner gap — bars inset from card corners so ends don't touch
    const MAX_V   = 12;
    const BSZ     = 14;  // button square side
    const BGAP    = 3;   // gap between bar end and button
    const PAD     = 44;  // vertical clearance above/below card area

    const cardCx  = editorX + Math.floor(editorW / 2);
    const cardCy  = startRow + PAD + Math.floor(CARD_SZ / 2);
    const cL = cardCx - Math.floor(CARD_SZ / 2);
    const cR = cL + CARD_SZ;
    const cT = cardCy - Math.floor(CARD_SZ / 2);
    const cB = cT + CARD_SZ;
    const trackLen = CARD_SZ - 2 * CG;  // bar track length (< card side to clear corners)

    const cardRect = scene.add.rectangle(cardCx, cardCy, CARD_SZ, CARD_SZ, 0x1c2030, 1);
    cardRect.setStrokeStyle?.(1, 0x3a4055, 1);
    addObj(cardRect);

    // Type icon centered inside the card square (bundle image or emoji fallback)
    {
      const cardType = activeCard?.type || "";
      const [iconCat, iconKey] = catalogIconCategory("type", cardType);
      const typeIconHtml = iconCat && rendererBundle ? resolveIconHTML(rendererBundle, iconCat, iconKey) : null;
      const ICN = CARD_SZ - 20;
      const iconResult = typeIconHtml
        ? drawIconAt(cardCx - ICN / 2, cardCy - ICN / 2, typeIconHtml, ICN, { alpha: 0.55 })
        : { drawn: false };
      if (!iconResult.drawn && cardType) {
        const catalogEntry = buildPropertyCatalog().type.find((e) => e.value === cardType);
        const emoji = catalogEntry?.icon || "";
        if (emoji) {
          addObj(scene.add.text(cardCx, cardCy, emoji, { fontSize: "40px" }).setOrigin(0.5, 0.5).setAlpha(0.55));
        }
      }
    }

    function mkBtn(bcx, bcy, label, btnRole, vKey, field, delta, hex, num) {
      const br = scene.add.rectangle(bcx, bcy, BSZ, BSZ, 0x1c2030, 1);
      br.setStrokeStyle?.(1, num, 0.6);
      addObj(br);
      const txt = addObj(
        scene.add.text(bcx, bcy, label, { fontSize: "11px", color: hex }).setOrigin(0.5, 0.5),
      );
      const hit = addObj(
        scene.add.rectangle(bcx, bcy, BSZ, BSZ, 0x000000, 0).setInteractive({ useHandCursor: true }),
      );
      hit.on("pointerover", () => txt.setStyle({ color: COLOR_HOVER }));
      hit.on("pointerout", () => txt.setStyle({ color: hex }));
      hit.on("pointerdown", () => {
        const freshId = controller.getActiveCard()?.id;
        if (freshId) controller.adjustVital?.(freshId, vKey, field, delta);
        void render();
      });
      chipRegistry.push({ label, zone: "editor", role: btnRole, value: vKey, x: bcx - BSZ / 2, y: bcy - BSZ / 2, width: BSZ, height: BSZ });
    }

    function mkLabel(x, y, text, role, vKey, hex, ox = 0, oy = 0.5) {
      addObj(scene.add.text(x, y, text, { fontSize: "10px", color: hex }).setOrigin(ox, oy));
      chipRegistry.push({ label: text, zone: "editor", role, value: vKey, x: x - 15, y: y - 6, width: 30, height: 12 });
    }

    const CONFIGS = [
      { key: "durability", num: 0xffa412, hex: "#ffa412", edge: "top" },
      { key: "health",     num: 0xff3030, hex: "#ff3030", edge: "right" },
      { key: "stamina",    num: 0x4cff28, hex: "#4cff28", edge: "bottom" },
      { key: "mana",       num: 0x269cff, hex: "#269cff", edge: "left" },
    ];

    CONFIGS.forEach(({ key, num, hex, edge }) => {
      const vital  = activeCard?.vitals?.[key] || { max: 0, regen: 0 };
      const maxVal = Math.max(0, Math.min(MAX_V, vital.max ?? 0));
      const regVal = Math.max(1, Math.min(6, vital.regen ?? 1));
      const thick  = 2 + (regVal - 1) * 1.5;
      const hT     = thick / 2;
      const fillLen = Math.round(trackLen * (maxVal / MAX_V));

      if (edge === "top") {
        const barY   = cT - OFFSET;
        const trackL = cL + CG;
        const trackR = cR - CG;
        const midX   = trackL + trackLen / 2;
        addObj(scene.add.rectangle(midX, barY, trackLen, thick, 0x060708, 0.85));
        if (fillLen > 0) addObj(scene.add.rectangle(trackL + fillLen / 2, barY, fillLen, thick, num, 1));
        mkBtn(trackL - BGAP - BSZ / 2,        barY,                        "−", "vital_max_dec",   key, "max",   -1, hex, num);
        mkBtn(trackR + BGAP + BSZ / 2,        barY,                        "+", "vital_max_inc",   key, "max",   +1, hex, num);
        mkBtn(midX,  barY - hT - BGAP - BSZ / 2,                          "+", "vital_regen_inc", key, "regen", +1, hex, num);
        mkBtn(midX,  barY + hT + BGAP + BSZ / 2,                          "−", "vital_regen_dec", key, "regen", -1, hex, num);
        mkLabel(trackR + BGAP + BSZ + 5,      barY,                        `${maxVal}`,   "vital_max_label",   key, hex, 0, 0.5);
        mkLabel(midX + BSZ / 2 + 4,           barY - hT - BGAP - BSZ / 2, `R:${regVal}`, "vital_regen_label", key, hex, 0, 0.5);

      } else if (edge === "right") {
        const barX   = cR + OFFSET;
        const trackT = cT + CG;
        const trackB = cB - CG;
        const midY   = trackT + trackLen / 2;
        addObj(scene.add.rectangle(barX, midY, thick, trackLen, 0x060708, 0.85));
        if (fillLen > 0) addObj(scene.add.rectangle(barX, trackB - fillLen / 2, thick, fillLen, num, 1));
        mkBtn(barX,                            trackT - BGAP - BSZ / 2,    "+", "vital_max_inc",   key, "max",   +1, hex, num);
        mkBtn(barX,                            trackB + BGAP + BSZ / 2,    "−", "vital_max_dec",   key, "max",   -1, hex, num);
        mkBtn(barX + hT + BGAP + BSZ / 2,     midY,                        "+", "vital_regen_inc", key, "regen", +1, hex, num);
        mkBtn(barX - hT - BGAP - BSZ / 2,     midY,                        "−", "vital_regen_dec", key, "regen", -1, hex, num);
        mkLabel(barX + BSZ / 2 + 4,           trackT - BGAP - BSZ / 2,    `${maxVal}`,   "vital_max_label",   key, hex, 0, 0.5);
        mkLabel(barX + hT + BGAP + BSZ + 4,   midY,                        `R:${regVal}`, "vital_regen_label", key, hex, 0, 0.5);

      } else if (edge === "bottom") {
        const barY   = cB + OFFSET;
        const trackL = cL + CG;
        const trackR = cR - CG;
        const midX   = trackL + trackLen / 2;
        addObj(scene.add.rectangle(midX, barY, trackLen, thick, 0x060708, 0.85));
        if (fillLen > 0) addObj(scene.add.rectangle(trackL + fillLen / 2, barY, fillLen, thick, num, 1));
        mkBtn(trackL - BGAP - BSZ / 2,        barY,                        "−", "vital_max_dec",   key, "max",   -1, hex, num);
        mkBtn(trackR + BGAP + BSZ / 2,        barY,                        "+", "vital_max_inc",   key, "max",   +1, hex, num);
        mkBtn(midX,  barY + hT + BGAP + BSZ / 2,                          "+", "vital_regen_inc", key, "regen", +1, hex, num);
        mkBtn(midX,  barY - hT - BGAP - BSZ / 2,                          "−", "vital_regen_dec", key, "regen", -1, hex, num);
        mkLabel(trackR + BGAP + BSZ + 5,      barY,                        `${maxVal}`,   "vital_max_label",   key, hex, 0, 0.5);
        mkLabel(midX + BSZ / 2 + 4,           barY + hT + BGAP + BSZ / 2, `R:${regVal}`, "vital_regen_label", key, hex, 0, 0.5);

      } else if (edge === "left") {
        const barX   = cL - OFFSET;
        const trackT = cT + CG;
        const trackB = cB - CG;
        const midY   = trackT + trackLen / 2;
        addObj(scene.add.rectangle(barX, midY, thick, trackLen, 0x060708, 0.85));
        if (fillLen > 0) addObj(scene.add.rectangle(barX, trackB - fillLen / 2, thick, fillLen, num, 1));
        mkBtn(barX,                            trackT - BGAP - BSZ / 2,    "+", "vital_max_inc",   key, "max",   +1, hex, num);
        mkBtn(barX,                            trackB + BGAP + BSZ / 2,    "−", "vital_max_dec",   key, "max",   -1, hex, num);
        mkBtn(barX - hT - BGAP - BSZ / 2,     midY,                        "+", "vital_regen_inc", key, "regen", +1, hex, num);
        mkBtn(barX + hT + BGAP + BSZ / 2,     midY,                        "−", "vital_regen_dec", key, "regen", -1, hex, num);
        mkLabel(barX - BSZ / 2 - 4,           trackT - BGAP - BSZ / 2,    `${maxVal}`,   "vital_max_label",   key, hex, 1, 0.5);
        mkLabel(barX - hT - BGAP - BSZ - 4,   midY,                        `R:${regVal}`, "vital_regen_label", key, hex, 1, 0.5);
      }
    });

    return startRow + PAD + CARD_SZ + PAD;
  }

  // ---------------------------------------------------------------------------
  // Room controls — size (-/+) visual square + shape toggle (regular/irregular)
  // ---------------------------------------------------------------------------

  function drawRoomControls({ editorX, editorW }, activeCard, startRow) {
    if (!scene) return startRow;

    const centerX = editorX + Math.floor(editorW / 2);
    let row = startRow;

    // ── SIZE ──────────────────────────────────────────────────────────────────
    row = drawSectionBand(editorX, row, editorW, "ROOM SIZE");

    const currentSize = activeCard?.roomSize || "medium";
    const sizeIdx = ROOM_SIZE_ORDER.indexOf(currentSize);
    // Pixel sizes scale with size tier for visual clarity
    const SIZE_PX = { small: 52, medium: 76, large: 100 };
    // Billable floor tiles per card (card-model.js): small=24, medium=48, large=96
    // At 1100t room budget: small→~45 rooms, medium→~22 rooms, large→~11 rooms
    const SIZE_INFO = {
      small:  { tokens: 24, guide: "~30-45 rooms" },
      medium: { tokens: 48, guide: "~15-22 rooms" },
      large:  { tokens: 96, guide: "~10-12 rooms" },
    };
    const sqPx = SIZE_PX[currentSize] || 76;
    const sizeInfo = SIZE_INFO[currentSize] || SIZE_INFO.medium;

    const BTN_W = 28;
    const BTN_H = 24;
    const BTN_GAP = 10;
    const sqT = row + 12;
    const sqL = centerX - Math.floor(sqPx / 2);

    // Visual square — scales with size, shows internal tile grid
    const gSq = addObj(scene.add.graphics());
    gSq.fillStyle(0x1a2840, 1);
    gSq.fillRect(sqL, sqT, sqPx, sqPx);
    gSq.lineStyle(2, 0x4a78b8, 1);
    gSq.strokeRect(sqL, sqT, sqPx, sqPx);
    const gridDiv = currentSize === "large" ? 4 : currentSize === "medium" ? 3 : 2;
    gSq.lineStyle(1, 0x4a78b8, 0.25);
    for (let c = 1; c < gridDiv; c++) {
      const gx = sqL + Math.round(sqPx * c / gridDiv);
      gSq.beginPath(); gSq.moveTo(gx, sqT + 1); gSq.lineTo(gx, sqT + sqPx - 1); gSq.strokePath();
    }
    for (let r = 1; r < gridDiv; r++) {
      const gy = sqT + Math.round(sqPx * r / gridDiv);
      gSq.beginPath(); gSq.moveTo(sqL + 1, gy); gSq.lineTo(sqL + sqPx - 1, gy); gSq.strokePath();
    }

    // Size name + token cost inside square
    addObj(
      scene.add.text(centerX, sqT + Math.floor(sqPx / 2) - 7,
        currentSize[0].toUpperCase() + currentSize.slice(1),
        { fontSize: "14px", color: "#6a98d8" }).setOrigin(0.5, 0.5),
    );
    addObj(
      scene.add.text(centerX, sqT + Math.floor(sqPx / 2) + 10,
        `${sizeInfo.tokens}t`,
        { fontSize: "11px", color: "#4a78b8" }).setOrigin(0.5, 0.5),
    );

    const btnCy = sqT + Math.floor(sqPx / 2);

    // Minus button
    const canDec = sizeIdx > 0;
    const minusBtnX = sqL - BTN_GAP - Math.floor(BTN_W / 2);
    {
      const col = canDec ? 0x3a4868 : 0x1e2230;
      const tc = canDec ? COLOR_ROOM_SIZE : COLOR_DISABLED;
      const bg = addObj(scene.add.rectangle(minusBtnX, btnCy, BTN_W, BTN_H, col, 1));
      if (canDec) bg.setStrokeStyle(1, 0x4a78b8, 0.8);
      const txt = addObj(scene.add.text(minusBtnX, btnCy, "−", { fontSize: "18px", color: tc }).setOrigin(0.5, 0.5));
      if (canDec) {
        const hit = addObj(scene.add.rectangle(minusBtnX, btnCy, BTN_W, BTN_H, 0, 0).setInteractive({ useHandCursor: true }));
        hit.on("pointerover", () => txt.setStyle({ color: COLOR_HOVER }));
        hit.on("pointerout", () => txt.setStyle({ color: tc }));
        hit.on("pointerdown", () => { controller.adjustRoomSize?.(activeCard.id, -1); void render(); });
      }
    }

    // Plus button
    const canInc = sizeIdx < ROOM_SIZE_ORDER.length - 1;
    const plusBtnX = sqL + sqPx + BTN_GAP + Math.floor(BTN_W / 2);
    {
      const col = canInc ? 0x3a4868 : 0x1e2230;
      const tc = canInc ? COLOR_ROOM_SIZE : COLOR_DISABLED;
      const bg = addObj(scene.add.rectangle(plusBtnX, btnCy, BTN_W, BTN_H, col, 1));
      if (canInc) bg.setStrokeStyle(1, 0x4a78b8, 0.8);
      const txt = addObj(scene.add.text(plusBtnX, btnCy, "+", { fontSize: "18px", color: tc }).setOrigin(0.5, 0.5));
      if (canInc) {
        const hit = addObj(scene.add.rectangle(plusBtnX, btnCy, BTN_W, BTN_H, 0, 0).setInteractive({ useHandCursor: true }));
        hit.on("pointerover", () => txt.setStyle({ color: COLOR_HOVER }));
        hit.on("pointerout", () => txt.setStyle({ color: tc }));
        hit.on("pointerdown", () => { controller.adjustRoomSize?.(activeCard.id, +1); void render(); });
      }
    }

    chipRegistry.push({ label: currentSize, zone: "editor", role: "room_size_display", value: currentSize,
      x: sqL, y: sqT, width: sqPx, height: sqPx });

    // Room count guidance below the square
    addObj(
      scene.add.text(centerX, sqT + sqPx + 7, sizeInfo.guide,
        { fontSize: "11px", color: COLOR_HEADER }).setOrigin(0.5, 0),
    );

    row = sqT + sqPx + 26;

    // ── SHAPE ─────────────────────────────────────────────────────────────────
    row = drawSectionBand(editorX, row, editorW, "ROOM SHAPE");
    row += 6;

    const currentShape = activeCard?.roomShape || "regular";
    const CHIP_W = editorW - 8;
    const CHIP_H = 68;
    const CHIP_GAP = 5;

    ROOM_SHAPE_ORDER.forEach((shape, idx) => {
      const chipX = editorX + 4;
      const chipY = row + idx * (CHIP_H + CHIP_GAP);
      const isActive = shape === currentShape;

      const bgColor = isActive ? 0x1e2d48 : 0x0d1018;
      const borderNum = isActive ? 0x4a78b8 : 0x2a3250;
      const bg = addObj(scene.add.rectangle(chipX + Math.floor(CHIP_W / 2), chipY + Math.floor(CHIP_H / 2), CHIP_W, CHIP_H, bgColor, 1));
      if (isActive) bg.setStrokeStyle(2, borderNum, 1);

      const labelH = 16;
      const pad = 8;
      const diagX = chipX + pad;
      const diagY = chipY + pad;
      const diagW = CHIP_W - pad * 2;
      const diagH = CHIP_H - pad * 2 - labelH;
      const lineColor = isActive ? 0x7aaae8 : 0x3a4a68;
      const lineAlpha = isActive ? 1 : 0.6;

      const g = addObj(scene.add.graphics());

      if (shape === "regular") {
        g.fillStyle(0x0a1520, 1);
        g.fillRect(diagX, diagY, diagW, diagH);
        g.lineStyle(2, lineColor, lineAlpha);
        g.strokeRect(diagX, diagY, diagW, diagH);
        g.lineStyle(1, lineColor, lineAlpha * 0.2);
        const cols = 4, rows = 3;
        for (let c = 1; c < cols; c++) {
          const gx = diagX + Math.round(diagW * c / cols);
          g.beginPath(); g.moveTo(gx, diagY + 1); g.lineTo(gx, diagY + diagH - 1); g.strokePath();
        }
        for (let r = 1; r < rows; r++) {
          const gy = diagY + Math.round(diagH * r / rows);
          g.beginPath(); g.moveTo(diagX + 1, gy); g.lineTo(diagX + diagW - 1, gy); g.strokePath();
        }
      } else {
        // Blocky irregular cave — axis-aligned (90° turns only), like dungeon rooms carved from grid blocks
        const X = (f) => Math.round(diagX + f * diagW);
        const Y = (f) => Math.round(diagY + f * diagH);

        // Main chamber + right alcove (L-shape), with a notch cut from the top-left corner
        const verts = [
          [0.25, 0.0],  [0.65, 0.0],
          [0.65, 0.0],  [0.65, 0.35],
          [0.65, 0.35], [1.0, 0.35],
          [1.0, 0.35],  [1.0, 1.0],
          [1.0, 1.0],   [0.0, 1.0],
          [0.0, 1.0],   [0.0, 0.35],
          [0.0, 0.35],  [0.25, 0.35],
          [0.25, 0.35], [0.25, 0.0],
        ];
        const points = [];
        for (let i = 0; i < verts.length; i += 2) points.push(verts[i]);

        g.fillStyle(0x080f1c, 1);
        g.beginPath();
        g.moveTo(X(points[0][0]), Y(points[0][1]));
        points.slice(1).forEach(([fx, fy]) => g.lineTo(X(fx), Y(fy)));
        g.closePath();
        g.fillPath();

        g.lineStyle(2, lineColor, lineAlpha);
        g.beginPath();
        g.moveTo(X(points[0][0]), Y(points[0][1]));
        points.slice(1).forEach(([fx, fy]) => g.lineTo(X(fx), Y(fy)));
        g.closePath();
        g.strokePath();

        // Faint interior tile grid
        g.lineStyle(1, lineColor, lineAlpha * 0.2);
        const cols = 5, rows = 3;
        for (let c = 1; c < cols; c++) {
          const gx = X(c / cols);
          g.beginPath(); g.moveTo(gx, Y(0) + 1); g.lineTo(gx, Y(1) - 1); g.strokePath();
        }
        for (let r = 1; r < rows; r++) {
          const gy = Y(r / rows);
          g.beginPath(); g.moveTo(X(0) + 1, gy); g.lineTo(X(1) - 1, gy); g.strokePath();
        }
      }

      const labelColor = isActive ? COLOR_ROOM_SIZE : COLOR_HEADER;
      addObj(
        scene.add.text(chipX + Math.floor(CHIP_W / 2), chipY + CHIP_H - 9,
          shape === "regular" ? "Regular Room" : "Irregular / Cave",
          { fontSize: "11px", color: labelColor },
        ).setOrigin(0.5, 0.5),
      );

      const hit = addObj(
        scene.add.rectangle(chipX + Math.floor(CHIP_W / 2), chipY + Math.floor(CHIP_H / 2), CHIP_W, CHIP_H, 0, 0)
          .setInteractive({ useHandCursor: true }),
      );
      hit.on("pointerover", () => { if (!isActive) bg.setFillStyle(0x151e30); });
      hit.on("pointerout", () => { if (!isActive) bg.setFillStyle(bgColor); });
      hit.on("pointerdown", () => {
        if (!isActive) { controller.adjustRoomShape?.(activeCard.id); void render(); }
      });

      chipRegistry.push({ label: shape, zone: "editor", role: "room_shape", value: shape,
        x: chipX, y: chipY, width: CHIP_W, height: CHIP_H });
    });

    return row + 2 * (CHIP_H + CHIP_GAP) + 8;
  }

  // ---------------------------------------------------------------------------
  // Panel: EDITOR
  // ---------------------------------------------------------------------------

  function drawEditor({ editorX, editorW, contentH, topOffset }) {
    drawRect(editorX - GAP, topOffset + 2, editorW + GAP * 2, contentH - 4, BG_EDITOR);

    const activeCard = controller.getActiveCard();
    const type = activeCard?.type || "";
    const tokens = activeCard?.cardValue?.totalTokens ?? 0;
    const TYPE_ICON_SIZE = 40;
    let row = topOffset + 8;

    // Larger card-type icon next to the header.
    let headerTextX = editorX;
    let headerTextY = row;
    if (type) {
      const [cat, key] = catalogIconCategory("type", type);
      const typeIconHtml = cat ? resolveIconHTML(rendererBundle, cat, key) : null;
      const typeIconResult = typeIconHtml ? drawIconAt(editorX, row, typeIconHtml, TYPE_ICON_SIZE) : { drawn: false };
      if (typeIconResult.drawn) {
        headerTextX = editorX + TYPE_ICON_SIZE + 8;
        headerTextY = row + (TYPE_ICON_SIZE - 16) / 2;
      }
    }

    const headerLabel = type
      ? `${activeCard.id}  [${type}]  ${tokens}t`
      : `${activeCard.id}  [blank]`;
    drawEditorChip(headerTextX, headerTextY, headerLabel, {
      role: "card_header",
      color: type ? COLOR_DEFAULT : COLOR_HEADER,
    });
    row += type ? TYPE_ICON_SIZE + 6 : 22;

    if (type === "room") {
      row = drawRoomControls({ editorX, editorW, contentH }, activeCard, row);
    }

    const affinities = Array.isArray(activeCard?.affinities) ? activeCard.affinities : [];
    if (affinities.length > 0) {
      row = drawSectionBand(editorX, row, editorW, "AFFINITIES");
      row = drawAffinityBlocks({ editorX, editorW }, activeCard, row);
    }

    const MOTIVATION_ICON_SIZE = 24;
    const MOTIVATION_CHIP_H = 28;
    const motivations = Array.isArray(activeCard?.motivations) ? activeCard.motivations : [];
    if (motivations.length > 0) {
      row = drawSectionBand(editorX, row, editorW, "MOTIVATIONS");
      row += 4;
      motivations.forEach((m) => {
        const chipX = editorX + 2;
        const chipW = editorW - 4;
        const pillBg = addObj(scene.add.graphics());
        pillBg.fillStyle(0x2a3a28, 1);
        pillBg.fillRoundedRect(chipX, row, chipW, MOTIVATION_CHIP_H, 6);
        pillBg.lineStyle(1, 0x4a6a40, 0.7);
        pillBg.strokeRoundedRect(chipX, row, chipW, MOTIVATION_CHIP_H, 6);

        const motivationIconHtml = resolveIconHTML(rendererBundle, "motivations", m);
        const iconX = chipX + 6;
        const iconY = row + (MOTIVATION_CHIP_H - MOTIVATION_ICON_SIZE) / 2;
        const motivationIconResult = drawIconAt(iconX, iconY, motivationIconHtml, MOTIVATION_ICON_SIZE);
        const textX = motivationIconResult.drawn ? iconX + MOTIVATION_ICON_SIZE + 6 : chipX + 8;
        const textY = row + (MOTIVATION_CHIP_H - 14) / 2;
        drawEditorChip(textX, textY, m, {
          group: "motivations",
          value: m,
          color: COLOR_MOTIVATION,
          interactive: true,
          onDown: () => {
            const freshId = controller.getActiveCard().id;
            applyIntent({ kind: "drop_chip", cardId: freshId, property: { group: "motivations", value: m } });
          },
        });

        const hitArea = addObj(
          scene.add.rectangle(chipX + chipW / 2, row + MOTIVATION_CHIP_H / 2, chipW, MOTIVATION_CHIP_H, 0x000000, 0)
            .setInteractive({ useHandCursor: true }),
        );
        hitArea.on("pointerover", () => pillBg.clear().fillStyle(0x3a4a38, 1).fillRoundedRect(chipX, row, chipW, MOTIVATION_CHIP_H, 6).lineStyle(1, 0x5a8a50, 0.9).strokeRoundedRect(chipX, row, chipW, MOTIVATION_CHIP_H, 6));
        hitArea.on("pointerout", () => pillBg.clear().fillStyle(0x2a3a28, 1).fillRoundedRect(chipX, row, chipW, MOTIVATION_CHIP_H, 6).lineStyle(1, 0x4a6a40, 0.7).strokeRoundedRect(chipX, row, chipW, MOTIVATION_CHIP_H, 6));
        hitArea.on("pointerdown", () => {
          const freshId = controller.getActiveCard().id;
          applyIntent({ kind: "drop_chip", cardId: freshId, property: { group: "motivations", value: m } });
          void render();
        });

        row += MOTIVATION_CHIP_H + 4;
      });
      row += 4;
    }

    const EXPRESSION_ICON_SIZE = 20;
    const expressions = Array.isArray(activeCard?.expressions) ? activeCard.expressions : [];
    if (expressions.length > 0) {
      row = drawSectionBand(editorX, row, editorW, "EXPRESSIONS");
      row += 4;
      expressions.forEach((expr) => {
        const exprIconHtml = resolveIconHTML(rendererBundle, "expressions", expr);
        const exprIconResult = drawIconAt(editorX, row, exprIconHtml, EXPRESSION_ICON_SIZE);
        const textX = exprIconResult.drawn ? editorX + EXPRESSION_ICON_SIZE + 4 : editorX;
        const label = exprIconResult.drawn ? expr : `${exprIconHtml} ${expr}`;
        const textY = exprIconResult.drawn ? row + (EXPRESSION_ICON_SIZE - 16) / 2 : row;
        drawEditorChip(textX, textY, label, {
          group: "expressions",
          value: expr,
          color: COLOR_EXPRESSION,
          interactive: true,
          onDown: () => {
            const freshId = controller.getActiveCard().id;
            applyIntent({ kind: "drop_chip", cardId: freshId, property: { group: "expressions", value: expr } });
          },
        });
        row += EXPRESSION_ICON_SIZE + 4;
      });
      row += 4;
    }

    const isActorType = type === "delver" || type === "warden";
    if (isActorType) {
      row = drawSectionBand(editorX, row, editorW, "VITALS");
      row = drawVitalEdgeBars({ editorX, editorW }, activeCard, row);
    }

    if (type) {
      const SHELVE_SZ = 22;
      const shelveCx = editorX + SHELVE_SZ / 2 + 2;
      const shelveCy = row + SHELVE_SZ / 2;
      const shelveG = addObj(scene.add.graphics());
      shelveG.fillStyle(0x3a3420, 1);
      shelveG.fillRoundedRect(shelveCx - SHELVE_SZ / 2, row, SHELVE_SZ, SHELVE_SZ, 4);
      shelveG.lineStyle(1, 0x806820, 0.8);
      shelveG.strokeRoundedRect(shelveCx - SHELVE_SZ / 2, row, SHELVE_SZ, SHELVE_SZ, 4);
      shelveG.fillStyle(0xf0d060, 1);
      shelveG.fillTriangle(
        shelveCx - 4, shelveCy - 5,
        shelveCx + 5, shelveCy,
        shelveCx - 4, shelveCy + 5,
      );
      const shelveLabel = addObj(
        scene.add.text(shelveCx + SHELVE_SZ / 2 + 6, shelveCy, `Shelve as ${type}`,
          { fontSize: "11px", color: COLOR_SHELVE_BTN }).setOrigin(0, 0.5).setAlpha(0),
      );
      const shelveHit = addObj(
        scene.add.rectangle(shelveCx, shelveCy, SHELVE_SZ, SHELVE_SZ, 0, 0).setInteractive({ useHandCursor: true }),
      );
      shelveHit.on("pointerover", () => { shelveLabel.setAlpha(1); shelveG.clear().fillStyle(0x4a4428, 1).fillRoundedRect(shelveCx - SHELVE_SZ / 2, row, SHELVE_SZ, SHELVE_SZ, 4).lineStyle(1, 0xa08830, 1).strokeRoundedRect(shelveCx - SHELVE_SZ / 2, row, SHELVE_SZ, SHELVE_SZ, 4).fillStyle(0xffdd88, 1).fillTriangle(shelveCx - 4, shelveCy - 5, shelveCx + 5, shelveCy, shelveCx - 4, shelveCy + 5); });
      shelveHit.on("pointerout", () => { shelveLabel.setAlpha(0); shelveG.clear().fillStyle(0x3a3420, 1).fillRoundedRect(shelveCx - SHELVE_SZ / 2, row, SHELVE_SZ, SHELVE_SZ, 4).lineStyle(1, 0x806820, 0.8).strokeRoundedRect(shelveCx - SHELVE_SZ / 2, row, SHELVE_SZ, SHELVE_SZ, 4).fillStyle(0xf0d060, 1).fillTriangle(shelveCx - 4, shelveCy - 5, shelveCx + 5, shelveCy, shelveCx - 4, shelveCy + 5); });
      shelveHit.on("pointerdown", () => { applyIntent({ kind: "move_card_between_groups", group: type }); void render(); });
      chipRegistry.push({ label: `shelve_${type}`, zone: "editor", role: "shelve_button", value: type,
        x: shelveCx - SHELVE_SZ / 2, y: row, width: SHELVE_SZ, height: SHELVE_SZ });
      row += SHELVE_SZ + 4;
    }

    const status = controller.getStatus();
    if (status.message) {
      const truncated = status.message.length > 50 ? status.message.slice(0, 50) + "…" : status.message;
      drawText(editorX, topOffset + contentH - 20, truncated, {
        fontSize: "12px",
        color: status.level === "error" ? COLOR_STATUS_ERROR : COLOR_STATUS_OK,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Panel: SHELF
  // ---------------------------------------------------------------------------

  function drawShelf({ shelfX, shelfW, contentH, topOffset }, allocationLedger) {
    const TITLE_H = 28;
    drawRect(shelfX - GAP, topOffset, shelfW + GAP * 2, contentH, BG_SHELF);

    // Inventory title header
    drawRect(shelfX - GAP, topOffset, shelfW + GAP * 2, TITLE_H, 0x0d0f18);
    addObj(scene.add.text(shelfX + shelfW / 2, topOffset + TITLE_H / 2, "INVENTORY", {
      fontSize: "11px", color: "#8892b0", letterSpacing: 3,
    }).setOrigin(0.5, 0.5));
    const divG = addObj(scene.add.graphics());
    divG.lineStyle(1, 0x2a2c3a, 1);
    divG.beginPath();
    divG.moveTo(shelfX - GAP, topOffset + TITLE_H);
    divG.lineTo(shelfX + shelfW + GAP, topOffset + TITLE_H);
    divG.strokePath();

    const TYPE_ORDER = ["room", "delver", "warden", "hazard", "resource"];
    const cardsByType = Object.fromEntries(TYPE_ORDER.map((t) => [t, []]));
    (controller.getCards() || []).forEach((card) => {
      if (cardsByType[card.type]) cardsByType[card.type].push(card);
    });

    let row = topOffset + TITLE_H + 8;
    TYPE_ORDER.forEach((type) => {
      if (row >= topOffset + contentH - 20) return;
      const cards = cardsByType[type];
      const alloc = allocationLedger?.byType?.[type] || { allocatedTokens: 0, usedTokens: 0 };
      const remaining = alloc.allocatedTokens - alloc.usedTokens;

      drawHeader(shelfX, row, type.toUpperCase());
      row += 15;

      const budgetLabel = `${alloc.allocatedTokens}−[${alloc.usedTokens}]=${remaining}t`;
      drawText(shelfX, row, budgetLabel, {
        fontSize: "11px",
        color: remaining < 0 ? COLOR_STATUS_ERROR : COLOR_HEADER,
      });
      row += 15;

      if (cards.length === 0) {
        drawText(shelfX, row, "—", { fontSize: "12px", color: COLOR_DISABLED });
        row += 16;
      } else {
        cards.forEach((card) => {
          if (row >= topOffset + contentH - 18) return;
          drawShelfCard(shelfX, row, card);
          row += 18;
        });
      }
      row += 4;
    });
  }

  // ---------------------------------------------------------------------------
  // Status bar
  // ---------------------------------------------------------------------------

  function drawStatusBar({ canvasW, contentH, topOffset }, allocationLedger) {
    const totalTokens = controller.getState()?.budgetTokens ?? 2500;
    const spentTokens = Object.values(allocationLedger?.byType || {})
      .reduce((sum, t) => sum + (t.usedTokens || 0), 0);
    const remaining = totalTokens - spentTokens;
    const barY = topOffset + contentH;

    drawRect(0, barY, canvasW, STATUS_BAR_H, 0x0d1018);
    drawText(GAP, barY + 5, `Budget: ${totalTokens}t  │  Spent: ${spentTokens}t  │  Remaining: ${remaining}t`, {
      fontSize: "12px",
      color: remaining < 0 ? COLOR_STATUS_ERROR : COLOR_DEFAULT,
    });
  }

  // ---------------------------------------------------------------------------
  // Mount / render / dispose
  // ---------------------------------------------------------------------------

  function mount(host) {
    container = host;
    stageEl = ensureStageElement(container);
    sceneReady = (async () => {
      const Phaser = await loadPhaser();
      if (!Phaser || typeof Phaser.Game !== "function") return;

      const w = container?.clientWidth || DEFAULT_WIDTH;
      const h = container?.clientHeight || DEFAULT_HEIGHT;

      await new Promise((resolve) => {
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: stageEl,
          width: w,
          height: h || DEFAULT_HEIGHT,
          backgroundColor: "#0d1018",
          scale: {
            mode: Phaser.Scale?.RESIZE ?? Phaser.Scale?.NONE ?? 0,
            autoCenter: Phaser.Scale?.CENTER_BOTH ?? 0,
          },
          scene: {
            create() {
              scene = this;
              // Re-render when the canvas is resized by the browser.
              if (typeof this.scale?.on === "function") {
                this.scale.on("resize", () => { void render(); });
              }
              resolve();
            },
          },
        });
      });
    })();
    return sceneReady;
  }

  async function render() {
    if (sceneReady) await sceneReady;
    if (!scene) return { ok: false, reason: "scene_unavailable" };

    const catalog = buildResolvedCatalog();
    const activeCard = controller.getActiveCard();

    // Preload any bundle icon images as Phaser textures before drawing.
    const allIconEntries = [
      ...catalog.type,
      ...catalog.affinities.flatMap((g) => g.options),
      ...catalog.expressions.flatMap((g) => g.options),
      ...catalog.motivations.flatMap((g) => g.options),
      ...buildEditorIconEntries(activeCard),
    ];
    await loadIconTextures(allIconEntries);

    clearScene();

    const canvasW = game?.scale?.gameSize?.width || game?.canvas?.width || DEFAULT_WIDTH;
    const canvasH = game?.scale?.gameSize?.height || game?.canvas?.height || DEFAULT_HEIGHT;
    const allocationLedger = controller.getAllocationLedger?.() || { byType: {} };

    if (renderMode === "shelf") {
      const shelfLayout = computeShelfLayout(canvasW, canvasH);
      drawShelf(shelfLayout, allocationLedger);
      drawStatusBar(shelfLayout, allocationLedger);
      lastSnapshot = buildSnapshot();
      return { ok: true };
    }

    const layout = computeLayout(canvasW, canvasH);
    drawPalette(layout, catalog);
    drawEditor(layout);
    drawShelf(layout, allocationLedger);
    drawStatusBar(layout, allocationLedger);
    drawGameplayArrow(layout);

    lastSnapshot = buildSnapshot();
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Snapshot and public queries
  // ---------------------------------------------------------------------------

  function buildSnapshot() {
    const state = controller.getState();
    const status = controller.getStatus();
    const cards = controller.getCards();
    const activeCard = controller.getActiveCard();
    return {
      budgetTokens: state.budgetTokens,
      budgetSplitPercent: state.budgetSplitPercent,
      status,
      cardCount: cards.length,
      activeReceipt: activeCard?.tokenReceipt ?? null,
      summaryRoomCount: controller.getSummary?.()?.roomDesign?.roomCount ?? 0,
    };
  }

  function buildAllocationLedger() {
    return controller.getAllocationLedger?.() || { byType: {} };
  }

  function buildBudgetInfo() {
    const alloc = buildAllocationLedger();
    const totalTokens = controller.getState()?.budgetTokens ?? 2500;
    const byType = alloc?.byType || {};
    const spentTokens = Object.values(byType).reduce((sum, t) => sum + (t.usedTokens || 0), 0);
    return {
      totalTokens,
      spentTokens,
      remainingTokens: totalTokens - spentTokens,
      allocated: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [k, {
          allocatedTokens: v.allocatedTokens || 0,
          usedTokens: v.usedTokens || 0,
          remainingTokens: v.remainingTokens || 0,
        }]),
      ),
    };
  }

  function getRenderedSnapshot() {
    return lastSnapshot || buildSnapshot();
  }

  function getChipPositions() {
    return chipRegistry.filter((c) => c.zone === "palette");
  }

  function getCardPositions() {
    return chipRegistry.filter((c) => c.zone === "shelf" && c.group === "_card");
  }

  function getEditorChips() {
    return chipRegistry.filter((c) => c.zone === "editor");
  }

  function getHoveredChip() {
    return hoveredChip;
  }

  function getShelfBudget() {
    const alloc = buildAllocationLedger();
    const byType = alloc?.byType || {};
    return Object.fromEntries(
      ["room", "delver", "warden", "hazard", "resource"].map((type) => {
        const e = byType[type] || { allocatedTokens: 0, usedTokens: 0, remainingTokens: 0 };
        return [type, {
          allocatedTokens: e.allocatedTokens || 0,
          usedTokens: e.usedTokens || 0,
          remainingTokens: e.remainingTokens || 0,
        }];
      }),
    );
  }

  function setResourceBundle(bundle) {
    rendererBundle = bundle || null;
    // Clear texture cache so icons are reloaded from the new bundle on next render.
    iconTextureCache.clear();
    void render();
  }

  function dispose() {
    clearScene();
    iconTextureCache.clear();
    rendererBundle = null;
    if (game?.destroy) game.destroy(true);
    game = null;
    scene = null;
    sceneReady = null;
  }

  return {
    mount,
    render,
    emitIntent: emit,
    setResourceBundle,
    setActiveTab: (tabId) => { activeTab = tabId; void render(); },
    setRenderMode: (mode) => { renderMode = mode; void render(); },
    getRenderedSnapshot,
    getChipPositions,
    getCardPositions,
    getEditorChips,
    getBudgetInfo: buildBudgetInfo,
    getShelfBudget,
    getHoveredChip,
    getController: () => controller,
    dispose,
  };
}
