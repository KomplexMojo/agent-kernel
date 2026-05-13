import { createDesignCard, wireDesignGuidance } from "../design-guidance.js";
import { extractDesignStateFromBuildSpec } from "../build-spec-ui.js";
import { createCliWorkerAdapter } from "../../../adapters-web/src/adapters/cli-worker/index.js";

export function wireDesignView({
  root = document,
  llmConfig = {},
  commandHost = createCliWorkerAdapter({ forceInProcess: typeof Worker !== "function" }),
  onSendBuildSpec,
  onLlmCapture,
} = {}) {
  const guidanceStatus = root.querySelector("#design-guidance-status");
  const leftRailType = root.querySelector("#design-property-group-type");
  const leftRailAffinities = root.querySelector("#design-property-group-affinities");
  const leftRailExpressions = root.querySelector("#design-property-group-expressions");
  const leftRailMotivations = root.querySelector("#design-property-group-motivations");
  const cardGrid = root.querySelector("#design-card-grid");
  const roomGroup = root.querySelector("#design-card-group-room");
  const attackerGroup = root.querySelector("#design-card-group-delver");
  const defenderGroup = root.querySelector("#design-card-group-warden");
  const hazardGroup = root.querySelector("#design-card-group-hazard");
  const resourceGroup = root.querySelector("#design-card-group-resource");
  const roomGroupBudget = root.querySelector("#design-card-group-budget-room");
  const attackerGroupBudget = root.querySelector("#design-card-group-budget-delver");
  const defenderGroupBudget = root.querySelector("#design-card-group-budget-warden");
  const resourceGroupBudget = root.querySelector("#design-card-group-budget-resource");
  const levelBudgetInput = root.querySelector("#design-level-budget");
  const budgetSplitRoomInput = root.querySelector("#design-budget-split-room");
  const budgetSplitAttackerInput = root.querySelector("#design-budget-split-delver");
  const budgetSplitDefenderInput = root.querySelector("#design-budget-split-warden");
  const budgetSplitHazardInput = root.querySelector("#design-budget-split-hazard");
  const budgetSplitResourceInput = root.querySelector("#design-budget-split-resource");
  const budgetSplitRoomTokens = root.querySelector("#design-budget-split-room-tokens");
  const budgetSplitAttackerTokens = root.querySelector("#design-budget-split-delver-tokens");
  const budgetSplitDefenderTokens = root.querySelector("#design-budget-split-warden-tokens");
  const budgetOverviewEl = root.querySelector("#design-budget-overview");
  const autoGenerateButton = root.querySelector("#design-auto-generate");
  const loadMintedButton = root.querySelector("#design-load-minted");

  let lastPublishedSpecText = "";
  let previewRunId = `design_ui_preview_${Date.now()}`;
  let previewCreatedAt = new Date().toISOString();
  let guidance = null;
  let pendingSummaryPublish = false;
  const mintedCardStore = new Map();
  let lastMintedTokenId = "";

  function setGuidanceMessage(message, level = "info") {
    if (!guidanceStatus) return;
    guidanceStatus.dataset.level = level;
    guidanceStatus.textContent = message;
  }

  function refreshPreviewIdentity() {
    previewRunId = `design_ui_preview_${Date.now()}`;
    previewCreatedAt = new Date().toISOString();
  }

  function handleSummary() {
    refreshPreviewIdentity();
    if (guidance) {
      void publishPreviewSpec();
      return;
    }
    pendingSummaryPublish = true;
  }

  guidance = wireDesignGuidance({
    elements: {
      statusEl: guidanceStatus,
      leftRailType,
      leftRailAffinities,
      leftRailExpressions,
      leftRailMotivations,
      cardGrid,
      roomGroup,
      attackerGroup,
      defenderGroup,
      hazardGroup,
      resourceGroup,
      roomGroupBudget,
      attackerGroupBudget,
      defenderGroupBudget,
      resourceGroupBudget,
      levelBudgetInput,
      budgetSplitRoomInput,
      budgetSplitAttackerInput,
      budgetSplitDefenderInput,
      budgetSplitHazardInput,
      budgetSplitResourceInput,
      budgetSplitRoomTokens,
      budgetSplitAttackerTokens,
      budgetSplitDefenderTokens,
      budgetOverviewEl,
    },
    llmConfig,
    onLlmCapture,
    onSummary: handleSummary,
    onMintCard: async ({ card }) => {
      if (typeof commandHost?.blockchainMint !== "function") {
        return { ok: false, error: "Blockchain mint command is unavailable." };
      }
      const tokenId = `token_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const mintFixture = {
        jsonrpc: "2.0",
        id: 1,
        result: {
          tokenId,
          txHash: `0x${tokenId}`,
          owner: "local-designer",
          card,
          metadata: {
            source: "design-ui",
          },
        },
      };
      const result = await commandHost.blockchainMint({
        rpcUrl: "http://fixture",
        owner: "local-designer",
        cardJson: card,
        tokenId,
        fixtureChainIdJson: { jsonrpc: "2.0", id: 1, result: "0x1" },
        fixtureMintJson: mintFixture,
      });
      const output = result?.output || result || {};
      const mintedTokenId = output?.tokenId || tokenId;
      mintedCardStore.set(mintedTokenId, card);
      lastMintedTokenId = mintedTokenId;
      return { ok: true, tokenId: mintedTokenId, result: output };
    },
  });
  if (pendingSummaryPublish) {
    pendingSummaryPublish = false;
    void publishPreviewSpec();
  }

  if (autoGenerateButton?.addEventListener) {
    autoGenerateButton.addEventListener("click", () => {
      autoGenerateCards();
    });
  }

  function autoGenerateCards() {
    const result = guidance.autoGenerateCards();
    if (result?.ok) {
      void publishPreviewSpec({ force: true, resetBuildOutput: false });
    }
    return result;
  }

  async function loadMintedCard(tokenIdInput) {
    if (typeof commandHost?.blockchainLoad !== "function") {
      setGuidanceMessage("Blockchain load command is unavailable.", "error");
      return { ok: false, reason: "missing_blockchain_load" };
    }
    const tokenId = typeof tokenIdInput === "string" ? tokenIdInput.trim() : "";
    if (!tokenId) {
      setGuidanceMessage("Load minted card cancelled.", "info");
      return { ok: false, reason: "cancelled" };
    }
    const storedCard = mintedCardStore.get(tokenId);
    const loadFixture = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tokenId,
        owner: "local-designer",
        card: storedCard || null,
        metadata: {
          source: "design-ui",
        },
      },
    };
    try {
      const result = await commandHost.blockchainLoad({
        rpcUrl: "http://fixture",
        tokenId,
        fixtureChainIdJson: { jsonrpc: "2.0", id: 1, result: "0x1" },
        fixtureLoadJson: loadFixture,
      });
      const output = result?.output || result || {};
      const loadedCard = output?.card || loadFixture?.result?.card || null;
      if (!loadedCard || typeof loadedCard !== "object") {
        setGuidanceMessage(`No card payload found for ${tokenId}.`, "error");
        return { ok: false, reason: "missing_card_payload" };
      }
      const importedCard = createDesignCard(loadedCard);
      const existing = guidance.getCards();
      const withoutDuplicate = existing.filter((entry) => entry.id !== importedCard.id);
      guidance.setCards([...withoutDuplicate, importedCard]);
      guidance.pullCardToEditor(importedCard.id);
      setGuidanceMessage(`Loaded minted card ${tokenId} into the editor.`, "info");
      return { ok: true, tokenId, card: importedCard };
    } catch (error) {
      const message = error?.message || String(error);
      setGuidanceMessage(message, "error");
      return { ok: false, reason: "load_failed", error: message };
    }
  }

  if (loadMintedButton?.addEventListener) {
    loadMintedButton.addEventListener("click", async () => {
      const promptFn = typeof globalThis.prompt === "function" ? globalThis.prompt.bind(globalThis) : null;
      const tokenIdInput = promptFn
        ? promptFn("Enter minted token id", lastMintedTokenId || "")
        : (lastMintedTokenId || "");
      await loadMintedCard(tokenIdInput);
    });
  }

  async function buildSpecFromCurrentSummary({ runId, source = "design-ui", createdAt } = {}) {
    const summary = guidance?.getSummary?.();
    if (!summary) {
      return { ok: false, reason: "missing_summary", errors: ["Create at least one configured card first."] };
    }
    if (typeof commandHost?.buildSpecFromSummary !== "function") {
      return { ok: false, reason: "missing_command_host", errors: ["Build spec command is unavailable."] };
    }

    const effectiveRunId = typeof runId === "string" && runId.trim()
      ? runId.trim()
      : `design_ui_${Date.now()}`;
    const built = await commandHost.buildSpecFromSummary({
      summary,
      runId: effectiveRunId,
      source,
      createdAt,
    });

    if (!built.ok || !built.spec) {
      return {
        ok: false,
        reason: "invalid_spec",
        errors: built.errors || [],
      };
    }

    return {
      ok: true,
      runId: effectiveRunId,
      spec: built.spec,
      specText: JSON.stringify(built.spec, null, 2),
    };
  }

  async function publishSpecToDiagnostics({
    runId,
    createdAt,
    source = "design-preview",
    resetBuildOutput = true,
    force = false,
  } = {}) {
    const effectiveRunId = typeof runId === "string" && runId.trim()
      ? runId.trim()
      : previewRunId;
    const effectiveCreatedAt = typeof createdAt === "string" && createdAt.trim()
      ? createdAt.trim()
      : previewCreatedAt;
    const built = await buildSpecFromCurrentSummary({
      runId: effectiveRunId,
      source: "design-ui",
      createdAt: effectiveCreatedAt,
    });
    if (!built.ok) {
      return built;
    }
    if (!force && built.specText === lastPublishedSpecText) {
      return { ok: true, skipped: true, runId: built.runId, spec: built.spec, specText: built.specText };
    }
    onSendBuildSpec?.({
      spec: built.spec,
      specText: built.specText,
      source,
      resetBuildOutput,
    });
    lastPublishedSpecText = built.specText;
    previewRunId = built.runId;
    return { ok: true, runId: built.runId, spec: built.spec, specText: built.specText };
  }

  async function publishPreviewSpec(options = {}) {
    return publishSpecToDiagnostics({
      runId: previewRunId,
      createdAt: previewCreatedAt,
      source: "design-preview",
      resetBuildOutput: true,
      ...options,
    });
  }

  function loadBuildSpec(specInput, { source = "bundle" } = {}) {
    const {
      spec,
      changed,
      cards,
      budgetTokens,
      budgetSplitPercent,
    } = extractDesignStateFromBuildSpec(specInput);
    if (!spec || typeof spec !== "object") {
      setGuidanceMessage("Loaded build spec is invalid.", "error");
      return { ok: false, reason: "invalid_spec" };
    }
    if (cards.length === 0) {
      setGuidanceMessage("Loaded build spec has no editable card set.", "error");
      return { ok: false, reason: "missing_card_set" };
    }

    if (Number.isFinite(budgetTokens)) {
      guidance.setBudget?.(budgetTokens);
    }
    if (budgetSplitPercent) {
      guidance.setBudgetSplit?.("room", budgetSplitPercent.room);
      guidance.setBudgetSplit?.("delver", budgetSplitPercent.delver);
      guidance.setBudgetSplit?.("warden", budgetSplitPercent.warden);
    }

    const applied = guidance.setCards(cards);
    if (!applied) {
      setGuidanceMessage("Loaded build spec could not be applied to the editor.", "error");
      return { ok: false, reason: "apply_failed" };
    }

    refreshPreviewIdentity();
    lastPublishedSpecText = "";
    setGuidanceMessage(
      `Loaded ${cards.length} authored card${cards.length === 1 ? "" : "s"} from ${source}${changed ? " (normalized for UI)." : "."}`,
      "info",
    );
    return { ok: true, spec, cards, normalized: changed };
  }

  function resetToScratch({ message = "Design reset. Start a new run." } = {}) {
    const applied = guidance.setCards([]);
    if (!applied) {
      setGuidanceMessage("Design could not be reset.", "error");
      return { ok: false, reason: "apply_failed" };
    }
    refreshPreviewIdentity();
    lastPublishedSpecText = "";
    setGuidanceMessage(message, "info");
    return { ok: true };
  }

  void publishPreviewSpec();

  return {
    addCard: guidance.addCard,
    setCards: guidance.setCards,
    applyPropertyDrop: guidance.applyPropertyDrop,
    adjustCardCount: guidance.adjustCardCount,
    adjustAffinityStack: guidance.adjustAffinityStack,
    adjustVital: guidance.adjustVital,
    cycleAffinityExpression: guidance.cycleAffinityExpression,
    setPrimaryAffinity: guidance.setPrimaryAffinity,
    stashActiveCard: guidance.stashActiveCard,
    mintActiveCard: guidance.mintActiveCard,
    pullCardToEditor: guidance.pullCardToEditor,
    loadMintedCard,
    setBudgetSplit: guidance.setBudgetSplit,
    autoGenerateCards,
    generateAiConfiguration: guidance.generateAiConfiguration,
    loadBuildSpec,
    resetToScratch,
    publishPreviewSpec,
    getActiveCard: guidance.getActiveCard,
    getSummary: guidance.getSummary,
    getCards: guidance.getCards,
    getSpendLedger: guidance.getSpendLedger,
  };
}
