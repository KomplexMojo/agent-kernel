import {
  buildPropertyCatalog,
  wireDesignGuidance,
} from "./design-guidance.js";
import { extractDesignStateFromBuildSpec } from "./build-spec-ui.js";
import { buildSpecFromSummaryFlow } from "../../runtime/src/commands/ui-flow.js";

export { buildPropertyCatalog };

function createStatusSink() {
  const status = { message: "", level: "info", hidden: true };
  return {
    el: {
      dataset: {},
      style: {},
      set textContent(value) {
        status.message = String(value ?? "");
      },
      get textContent() {
        return status.message;
      },
      set hidden(value) {
        status.hidden = Boolean(value);
      },
      get hidden() {
        return status.hidden;
      },
      get dataset() {
        return this._dataset || (this._dataset = {});
      },
    },
    read() {
      return {
        message: status.message,
        level: this.el.dataset.level || "info",
        hidden: status.hidden,
      };
    },
  };
}

export function createCardBuilderController({ llmConfig = {} } = {}) {
  const statusSink = createStatusSink();
  const guidance = wireDesignGuidance({
    elements: { statusEl: statusSink.el },
    llmConfig,
  });

  async function publishSpecText({ runId, source = "design-ui", createdAt } = {}) {
    const summary = guidance.getSummary();
    if (!summary) {
      return { ok: false, reason: "missing_summary", errors: ["Create at least one configured card first."] };
    }
    return buildSpecFromSummaryFlow({
      summary,
      runId: typeof runId === "string" && runId.trim() ? runId.trim() : `card_builder_${Date.now()}`,
      source,
      createdAt,
    });
  }

  async function loadBuildSpec(specInput) {
    const { spec, cards, budgetTokens, budgetSplitPercent, changed } = extractDesignStateFromBuildSpec(specInput);
    if (!spec || typeof spec !== "object") {
      return { ok: false, reason: "invalid_spec" };
    }
    if (cards.length === 0) {
      return { ok: false, reason: "missing_card_set" };
    }
    const applied = guidance.loadState({
      budgetTokens: Number.isFinite(budgetTokens) ? budgetTokens : undefined,
      budgetSplitPercent: budgetSplitPercent || undefined,
      cards,
    });
    if (!applied) {
      return { ok: false, reason: "apply_failed" };
    }
    return { ok: true, spec, cards, normalized: changed };
  }

  return {
    getCatalog: () => buildPropertyCatalog(),
    getActiveCard: guidance.getActiveCard,
    getCards: guidance.getCards,
    getSummary: guidance.getSummary,
    getSpendLedger: guidance.getSpendLedger,
    getAllocationLedger: guidance.getAllocationLedger,
    getState: guidance.getState,
    getStatus: () => statusSink.read(),
    applyPropertyDrop: guidance.applyPropertyDrop,
    adjustCardCount: guidance.adjustCardCount,
    adjustVital: guidance.adjustVital,
    adjustAffinityStack: guidance.adjustAffinityStack,
    cycleAffinityExpression: guidance.cycleAffinityExpression,
    adjustRoomSize: (cardId, direction) => guidance.cycleRoomSize(cardId, direction),
    adjustRoomShape: (cardId) => guidance.cycleRoomShape(cardId),
    stashActiveCard: guidance.stashActiveCard,
    pullCardToEditor: guidance.pullCardToEditor,
    setCards: guidance.setCards,
    loadState: guidance.loadState,
    loadBuildSpec,
    publishSpecText,
    serializeCards: guidance.serializeCards,
  };
}
