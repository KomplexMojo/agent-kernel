import { wireDesignGuidance } from "../design-guidance.js";
import { buildBuildSpecFromSummary } from "../../../runtime/src/personas/director/buildspec-assembler.js";

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#cf3f5b" : "inherit";
}

function summarizeErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "unknown error";
  return errors.map((err) => (typeof err === "string" ? err : JSON.stringify(err))).join("; ");
}

export function wireDesignView({
  root = document,
  llmConfig = {},
  onSendBuildSpec,
  onRunBuild,
  onLoadBundle,
  onRunBundle,
  onOpenSimulation,
  onLlmCapture,
} = {}) {
  const guidanceStatus = root.querySelector("#design-guidance-status");
  const leftRailType = root.querySelector("#design-property-group-type");
  const leftRailAffinities = root.querySelector("#design-property-group-affinities");
  const leftRailExpressions = root.querySelector("#design-property-group-expressions");
  const leftRailMotivations = root.querySelector("#design-property-group-motivations");
  const cardGrid = root.querySelector("#design-card-grid");
  const roomGroup = root.querySelector("#design-card-group-room");
  const attackerGroup = root.querySelector("#design-card-group-attacker");
  const defenderGroup = root.querySelector("#design-card-group-defender");
  const roomGroupBudget = root.querySelector("#design-card-group-budget-room");
  const attackerGroupBudget = root.querySelector("#design-card-group-budget-attacker");
  const defenderGroupBudget = root.querySelector("#design-card-group-budget-defender");
  const levelBudgetInput = root.querySelector("#design-level-budget");
  const budgetSplitRoomInput = root.querySelector("#design-budget-split-room");
  const budgetSplitAttackerInput = root.querySelector("#design-budget-split-attacker");
  const budgetSplitDefenderInput = root.querySelector("#design-budget-split-defender");
  const budgetSplitRoomTokens = root.querySelector("#design-budget-split-room-tokens");
  const budgetSplitAttackerTokens = root.querySelector("#design-budget-split-attacker-tokens");
  const budgetSplitDefenderTokens = root.querySelector("#design-budget-split-defender-tokens");
  const budgetOverviewEl = root.querySelector("#design-budget-overview");
  const buildButton = root.querySelector("#design-build-and-load");
  const buildStatus = root.querySelector("#design-build-status");

  let running = false;
  let lastPublishedSpecText = "";
  let previewRunId = `design_ui_preview_${Date.now()}`;
  let previewCreatedAt = new Date().toISOString();
  let guidance = null;
  let pendingSummaryPublish = false;

  function refreshPreviewIdentity() {
    previewRunId = `design_ui_preview_${Date.now()}`;
    previewCreatedAt = new Date().toISOString();
  }

  function handleSummary() {
    refreshPreviewIdentity();
    if (guidance) {
      publishPreviewSpec();
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
      roomGroupBudget,
      attackerGroupBudget,
      defenderGroupBudget,
      levelBudgetInput,
      budgetSplitRoomInput,
      budgetSplitAttackerInput,
      budgetSplitDefenderInput,
      budgetSplitRoomTokens,
      budgetSplitAttackerTokens,
      budgetSplitDefenderTokens,
      budgetOverviewEl,
    },
    llmConfig,
    onLlmCapture,
    onSummary: handleSummary,
  });
  if (pendingSummaryPublish) {
    pendingSummaryPublish = false;
    publishPreviewSpec();
  }

  function buildSpecFromCurrentSummary({ runId, source = "design-ui", createdAt } = {}) {
    const summary = guidance?.getSummary?.();
    if (!summary) {
      return { ok: false, reason: "missing_summary", errors: ["Create at least one configured card first."] };
    }

    const effectiveRunId = typeof runId === "string" && runId.trim()
      ? runId.trim()
      : `design_ui_${Date.now()}`;
    const built = buildBuildSpecFromSummary({
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

  function publishSpecToDiagnostics({
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
    const built = buildSpecFromCurrentSummary({
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

  function publishPreviewSpec() {
    const published = publishSpecToDiagnostics({
      runId: previewRunId,
      createdAt: previewCreatedAt,
      source: "design-preview",
      resetBuildOutput: true,
    });
    if (!published.ok) {
      setStatus(buildStatus, `BuildSpec preview failed: ${summarizeErrors(published.errors)}`, true);
      return false;
    }
    return true;
  }

  async function buildAndLoad() {
    if (running) return;
    running = true;
    if (buildButton) buildButton.disabled = true;
    setStatus(buildStatus, "Preparing build from card set...");

    try {
      const spendLedger = guidance?.getSpendLedger?.();
      if (spendLedger?.overBudget) {
        const allocationType = ["room", "attacker", "defender"].find((type) => (
          Number(spendLedger?.allocations?.[type]?.overByTokens) > 0
        ));
        if (allocationType) {
          const detail = spendLedger.allocations[allocationType];
          setStatus(
            buildStatus,
            `Build blocked: ${allocationType} allocation exceeded (${detail.usedTokens}/${detail.allocatedTokens}).`,
            true,
          );
          return;
        }
        const overBy = Number.isInteger(spendLedger.totalOverBudgetBy) ? spendLedger.totalOverBudgetBy : "unknown";
        setStatus(buildStatus, `Build blocked: over budget by ${overBy} tokens.`, true);
        return;
      }

      const published = publishSpecToDiagnostics({
        runId: previewRunId,
        createdAt: previewCreatedAt,
        source: "design-build",
        resetBuildOutput: false,
      });
      if (!published.ok) {
        setStatus(buildStatus, `BuildSpec validation failed: ${summarizeErrors(published.errors)}`, true);
        return;
      }

      setStatus(buildStatus, "Running build...");
      const buildResult = await onRunBuild?.();
      if (buildResult && buildResult.ok === false) {
        setStatus(buildStatus, "Build failed. Check Diagnostics for details.", true);
        return;
      }

      setStatus(buildStatus, "Loading bundle...");
      const loaded = await onLoadBundle?.();
      if (loaded === false) {
        setStatus(buildStatus, "Build completed, but no bundle was available to load.", true);
        return;
      }

      const ran = await onRunBundle?.();
      if (ran === false) {
        setStatus(buildStatus, "Bundle loaded, but runtime artifacts were missing.", true);
        return;
      }

      onOpenSimulation?.();
      setStatus(buildStatus, "Build complete. Game loaded.");
    } catch (error) {
      setStatus(buildStatus, `Build failed: ${error?.message || String(error)}`, true);
    } finally {
      running = false;
      if (buildButton) buildButton.disabled = false;
    }
  }

  if (buildButton?.addEventListener) {
    buildButton.addEventListener("click", () => {
      buildAndLoad();
    });
  }

  publishPreviewSpec();

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
    pullCardToEditor: guidance.pullCardToEditor,
    setBudgetSplit: guidance.setBudgetSplit,
    generateAiConfiguration: guidance.generateAiConfiguration,
    buildAndLoad,
    getActiveCard: guidance.getActiveCard,
    getSummary: guidance.getSummary,
    getCards: guidance.getCards,
    getSpendLedger: guidance.getSpendLedger,
  };
}
