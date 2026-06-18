import { createCardBuilderController } from "../card-builder-controller.js";
import { createCardBuilderPhaserRenderer } from "./card-builder-phaser-renderer.js";
import { createPhaserSurfaceIngestion } from "../phaser-surface-ingestion.js";

const FRAME_ROOT_SELECTOR = "#phaser-frame-root";

export function createPhaserFrameView({
  root = typeof document !== "undefined" ? document : null,
  llmConfig = {},
  onLoadGameplayBundle,
  onInventorySelect,
  createCardRenderer = createCardBuilderPhaserRenderer,
  loadPhaser,
} = {}) {
  let mountEl = null;
  let cardBuilderHost = null;
  let gameplayHost = null;
  let cardRenderer = null;
  let mounted = false;

  const cardBuilderController = createCardBuilderController({ llmConfig });

  const cardBuilderSurface = {
    getController: () => cardBuilderController,
    emitIntent: (intent) =>
      cardRenderer ? cardRenderer.emitIntent(intent) : cardBuilderController.applyPropertyDrop(intent?.cardId, intent?.property),
    render: () => (cardRenderer ? cardRenderer.render() : Promise.resolve({ ok: false, reason: "renderer_unmounted" })),
    getChipPositions: () => cardRenderer?.getChipPositions() ?? [],
    getCardPositions: () => cardRenderer?.getCardPositions() ?? [],
    getEditorChips: () => cardRenderer?.getEditorChips() ?? [],
    getBudgetInfo: () => cardRenderer?.getBudgetInfo() ?? null,
    getShelfBudget: () => cardRenderer?.getShelfBudget() ?? null,
    getHoveredChip: () => cardRenderer?.getHoveredChip() ?? null,
  };
  const gameplaySurface = {
    getHost: () => gameplayHost,
    loadRun: (bundle) => loadGameplayBundle(bundle),
  };

  const ingestion = createPhaserSurfaceIngestion({
    cardBuilder: cardBuilderController,
    gameplay: gameplaySurface,
  });

  function createHost(dataAttr) {
    const node = root.createElement("div");
    node.dataset[dataAttr] = "true";
    return node;
  }

  function mount() {
    if (mounted) {
      return { ok: true };
    }
    mountEl = root.querySelector?.(FRAME_ROOT_SELECTOR) ?? null;
    if (!mountEl) {
      return { ok: false, reason: "missing_frame_root" };
    }
    mountEl.dataset.phaserFrame = "true";
    cardBuilderHost = createHost("cardBuilderSurface");
    gameplayHost = createHost("gameplaySurface");
    mountEl.appendChild(cardBuilderHost);
    mountEl.appendChild(gameplayHost);
    cardRenderer = createCardRenderer({
      controller: cardBuilderController,
      ...(onInventorySelect ? { onInventorySelect } : {}),
      ...(loadPhaser ? { loadPhaser } : {}),
    });
    cardRenderer.mount(cardBuilderHost);
    void cardRenderer.render();
    mounted = true;
    return { ok: true };
  }

  async function loadGameplayBundle(bundle) {
    if (typeof onLoadGameplayBundle !== "function") {
      return false;
    }
    return onLoadGameplayBundle(bundle);
  }

  function dispose() {
    cardRenderer?.dispose?.();
    cardRenderer = null;
    if (mountEl) {
      if (typeof mountEl.replaceChildren === "function") {
        mountEl.replaceChildren();
      } else {
        mountEl.children = [];
      }
    }
    mounted = false;
  }

  return {
    mount,
    dispose,
    loadGameplayBundle,
    setResourceBundle: (bundle) => cardRenderer?.setResourceBundle?.(bundle),
    setActiveTab: (tabId) => cardRenderer?.setActiveTab?.(tabId),
    setRenderMode: (mode) => cardRenderer?.setRenderMode?.(mode),
    ingest: (payload) => ingestion.ingest(payload),
    getCardBuilderSurface: () => cardBuilderSurface,
    getGameplaySurface: () => gameplaySurface,
    getCardBuilderHost: () => cardBuilderHost,
    getGameplayHost: () => gameplayHost,
  };
}
