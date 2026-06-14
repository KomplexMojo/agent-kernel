import { buildPropertyCatalog } from "../card-builder-controller.js";

export const CARD_BUILDER_UI_INTENTS = Object.freeze([
  "drag_chip",
  "drop_chip",
  "select_card",
  "move_card_between_groups",
]);

const UI_INTENT_SET = new Set(CARD_BUILDER_UI_INTENTS);

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;

async function defaultLoadPhaser() {
  const mod = await import("phaser");
  return mod.default ?? mod;
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

export function createCardBuilderPhaserRenderer({
  controller,
  loadPhaser = defaultLoadPhaser,
  onIntent,
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

  function emit(intent) {
    if (!intent || !UI_INTENT_SET.has(intent.kind)) {
      return { ok: false, reason: "unsupported_intent" };
    }
    if (typeof onIntent === "function") {
      onIntent(intent);
    }
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

  function mount(host) {
    container = host;
    stageEl = ensureStageElement(container);
    sceneReady = (async () => {
      const Phaser = await loadPhaser();
      if (!Phaser || typeof Phaser.Game !== "function") {
        return;
      }
      await new Promise((resolve) => {
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: stageEl,
          width: container?.clientWidth || DEFAULT_WIDTH,
          height: container?.clientHeight || DEFAULT_HEIGHT,
          backgroundColor: "#10131a",
          scale: { mode: Phaser.Scale.NONE },
          scene: {
            create() {
              scene = this;
              resolve();
            },
          },
        });
      });
    })();
    return sceneReady;
  }

  function drawText(x, y, text, style = {}) {
    if (!scene) return null;
    return scene.add.text(x, y, String(text), { fontSize: "12px", color: "#e6e8ee", ...style });
  }

  function buildSnapshot() {
    const state = controller.getState();
    const status = controller.getStatus();
    const summary = controller.getSummary();
    const cards = controller.getCards();
    const activeCard = controller.getActiveCard();
    return {
      budgetTokens: state.budgetTokens,
      budgetSplitPercent: state.budgetSplitPercent,
      status,
      cardCount: cards.length,
      activeReceipt: activeCard?.tokenReceipt ?? null,
      summaryRoomCount: summary?.roomDesign?.roomCount ?? 0,
    };
  }

  async function render() {
    if (sceneReady) await sceneReady;
    if (!scene) return { ok: false, reason: "scene_unavailable" };

    const catalog = buildPropertyCatalog();
    let row = 16;
    // Type chips
    catalog.type.forEach((entry, index) => {
      drawText(16 + index * 90, row, entry.label, { fontSize: "13px" });
    });
    row += 28;
    // Affinity / expression / motivation chip groups
    [catalog.affinities, catalog.expressions, catalog.motivations].forEach((groups) => {
      groups.forEach((group) => {
        group.options.forEach((option, idx) => {
          drawText(16 + idx * 60, row, option.label, { fontSize: "11px" });
        });
        row += 22;
      });
    });

    // Budget / receipt / status panels from controller state.
    const snapshot = buildSnapshot();
    drawText(16, row, `Budget: ${snapshot.budgetTokens}`, { fontSize: "12px" });
    drawText(16, row + 18, `Status: ${snapshot.status.message || "—"}`, {
      fontSize: "12px",
      color: snapshot.status.level === "error" ? "#ff6b6b" : "#9fe6a0",
    });
    if (snapshot.activeReceipt) {
      drawText(16, row + 36, `Receipt total: ${snapshot.activeReceipt.tokenTotals.total}`, { fontSize: "12px" });
    }

    lastSnapshot = snapshot;
    return { ok: true };
  }

  function getRenderedSnapshot() {
    return lastSnapshot || buildSnapshot();
  }

  function dispose() {
    if (game?.destroy) game.destroy(true);
    game = null;
    scene = null;
    sceneReady = null;
  }

  return {
    mount,
    render,
    emitIntent: emit,
    getRenderedSnapshot,
    getController: () => controller,
    dispose,
  };
}
