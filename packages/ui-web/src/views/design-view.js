import { wireDesignGuidance } from "../design-guidance.js";
import { buildBuildSpecFromSummary } from "../../../runtime/src/personas/director/buildspec-assembler.js";
import { normalizeSummaryPick } from "../../../runtime/src/personas/director/summary-selections.js";
import { DEFAULT_DUNGEON_AFFINITY } from "../../../runtime/src/contracts/domain-constants.js";

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "red" : "inherit";
}

function actorSetEntryToPick(entry, dungeonAffinity) {
  return normalizeSummaryPick(entry, {
    dungeonAffinity,
    source: entry?.source === "room" ? "room" : "actor",
  });
}

export function mergeSummaryWithActorSet(summary, actorSet) {
  const base = summary && typeof summary === "object" ? { ...summary } : {};
  const dungeonAffinity = typeof base.dungeonAffinity === "string" ? base.dungeonAffinity : DEFAULT_DUNGEON_AFFINITY;
  const entries = Array.isArray(actorSet) ? actorSet : [];
  const actors = entries
    .filter((entry) => entry?.source !== "room")
    .map((entry) => actorSetEntryToPick(entry, dungeonAffinity));
  const rooms = entries
    .filter((entry) => entry?.source === "room")
    .map((entry) => actorSetEntryToPick(entry, dungeonAffinity));
  base.actors = actors;
  base.rooms = rooms;
  return base;
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
  const guidanceInput = root.querySelector("#design-guidance-input");
  const levelPromptInput = root.querySelector("#design-level-prompt-template");
  const attackerPromptInput = root.querySelector("#design-attacker-prompt-template");
  const defenderPromptInput = root.querySelector("#design-defender-prompt-template");
  const runLevelPromptButton = root.querySelector("#design-run-level-prompt") || root.querySelector("#design-guidance-generate");
  const runAttackerPromptButton = root.querySelector("#design-run-attacker-prompt");
  const runDefenderPromptButton = root.querySelector("#design-run-defender-prompt");
  const guidanceStatus = root.querySelector("#design-guidance-status");
  const briefOutput = root.querySelector("#design-brief-output");
  const spendLedgerOutput = root.querySelector("#design-spend-ledger-output");
  const levelDesignOutput = root.querySelector("#design-level-output");
  const attackerConfigOutput = root.querySelector("#design-attacker-output");
  const levelTokenIndicator = root.querySelector("#design-level-token-indicator");
  const attackerTokenIndicator = root.querySelector("#design-attacker-token-indicator");
  const defenderTokenIndicator = root.querySelector("#design-defender-token-indicator");
  const simulationTokenIndicator = root.querySelector("#design-simulation-token-indicator");
  const tokenBudgetInput = root.querySelector("#prompt-token-budget");
  const maxTokenBudgetInput = root.querySelector("#prompt-max-token-budget");
  const thinkTimeInput = root.querySelector("#prompt-think-time");
  const llmTokensInput = root.querySelector("#prompt-llm-tokens");
  const layoutProfileInput = root.querySelector("#prompt-layout-profile");
  const layoutAllocationPercentInput = root.querySelector("#prompt-layout-allocation-percent");
  const defenderAllocationPercentInput = root.querySelector("#prompt-defender-allocation-percent");
  const attackerAllocationPercentInput = root.querySelector("#prompt-attacker-allocation-percent");
  const budgetAllocationSummary = root.querySelector("#prompt-budget-allocation-summary");
  const levelBenchmarkButton = root.querySelector("#design-run-level-benchmark");
  const levelBenchmarkOutput = root.querySelector("#design-level-benchmark-output");
  const benchmarkMaxTokenBudgetInput = root.querySelector("#benchmark-max-token-budget");
  const benchmarkSampleRunsInput = root.querySelector("#benchmark-sample-runs");
  const levelAffinitiesContainer = root.querySelector("#prompt-level-affinities");
  const attackerSetupModeInput = root.querySelector("#prompt-attacker-setup-mode");
  const attackerAffinitiesContainer = root.querySelector("#prompt-attacker-affinities");
  const defenderAffinitiesContainer = root.querySelector("#prompt-defender-affinities");
  const attackerVitalsInputs = {
    health: {
      max: root.querySelector("#attacker-vitals-health-max"),
    },
    mana: {
      max: root.querySelector("#attacker-vitals-mana-max"),
    },
    stamina: {
      max: root.querySelector("#attacker-vitals-stamina-max"),
    },
    durability: {
      max: root.querySelector("#attacker-vitals-durability-max"),
    },
  };
  const attackerVitalsRegenInputs = {
    health: root.querySelector("#attacker-vitals-health-regen"),
    mana: root.querySelector("#attacker-vitals-mana-regen"),
    stamina: root.querySelector("#attacker-vitals-stamina-regen"),
    durability: root.querySelector("#attacker-vitals-durability-regen"),
  };
  const hasAttackerVitalsInputs = Object.values(attackerVitalsInputs).some(
    (group) => group?.max,
  );
  const resolvedAttackerVitalsInputs = hasAttackerVitalsInputs ? attackerVitalsInputs : null;
  const hasAttackerVitalsRegenInputs = Object.values(attackerVitalsRegenInputs).some(Boolean);
  const resolvedAttackerVitalsRegenInputs = hasAttackerVitalsRegenInputs ? attackerVitalsRegenInputs : null;
  const actorSetJson = root.querySelector("#design-actor-set-json");
  const actorSetApply = root.querySelector("#design-actor-set-apply");
  const actorSetPreview = root.querySelector("#design-actor-set-preview");
  const buildButton = root.querySelector("#design-build-and-load");
  const buildStatus = root.querySelector("#design-build-status");
  const designTabButtons = typeof root.querySelectorAll === "function"
    ? Array.from(root.querySelectorAll("[data-design-tab]"))
    : [];
  const designTabPanels = typeof root.querySelectorAll === "function"
    ? Array.from(root.querySelectorAll("[data-design-tab-panel]"))
    : [];

  let running = false;
  let promptRunInFlight = false;
  let lastPublishedSpecText = "";
  let previewRunId = `design_ui_preview_${Date.now()}`;
  let previewCreatedAt = new Date().toISOString();
  const promptButtonLabelCache = new WeakMap();

  function setDesignStep(stepId = "level") {
    if (!stepId) return;
    designTabButtons.forEach((button) => {
      const active = button?.dataset?.designTab === stepId;
      button.classList?.toggle?.("active", active);
      button.setAttribute?.("aria-selected", active ? "true" : "false");
    });
    designTabPanels.forEach((panel) => {
      panel.hidden = panel?.dataset?.designTabPanel !== stepId;
    });
  }

  if (designTabButtons.length > 0 && designTabPanels.length > 0) {
    setDesignStep("level");
    designTabButtons.forEach((button) => {
      button.addEventListener?.("click", () => {
        const tabId = button?.dataset?.designTab;
        if (!tabId) return;
        setDesignStep(tabId);
      });
    });
  }

  function refreshPreviewIdentity() {
    previewRunId = `design_ui_preview_${Date.now()}`;
    previewCreatedAt = new Date().toISOString();
  }

  function buildSpecFromCurrentSummary({ runId, source = "design-ui", createdAt } = {}) {
    const summary = guidance.getSummary?.();
    if (!summary) {
      return { ok: false, reason: "missing_summary", errors: ["Generate a design brief first."] };
    }

    const mergedSummary = mergeSummaryWithActorSet(summary, guidance.getActorSet?.() || []);
    const effectiveRunId = typeof runId === "string" && runId.trim()
      ? runId.trim()
      : `design_ui_${Date.now()}`;
    const built = buildBuildSpecFromSummary({
      summary: mergedSummary,
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

  const guidance = wireDesignGuidance({
    elements: {
      guidanceInput,
      levelPromptInput,
      attackerPromptInput,
      defenderPromptInput,
      generateButton: null,
      statusEl: guidanceStatus,
      briefOutput,
      spendLedgerOutput,
      levelDesignOutput,
      attackerConfigOutput,
      levelTokenIndicator,
      attackerTokenIndicator,
      defenderTokenIndicator,
      simulationTokenIndicator,
      tokenBudgetInput,
      maxTokenBudgetInput,
      thinkTimeInput,
      llmTokensInput,
      layoutProfileInput,
      layoutAllocationPercentInput,
      defenderAllocationPercentInput,
      attackerAllocationPercentInput,
      budgetAllocationSummary,
      levelBenchmarkButton,
      levelBenchmarkOutput,
      benchmarkMaxTokenBudgetInput,
      benchmarkSampleRunsInput,
      levelAffinitiesContainer,
      attackerSetupModeInput,
      attackerAffinitiesContainer,
      defenderAffinitiesContainer,
      attackerVitalsInputs: resolvedAttackerVitalsInputs,
      attackerVitalsRegenInputs: resolvedAttackerVitalsRegenInputs,
      actorSetInput: actorSetJson,
      actorSetPreview,
      applyActorSetButton: actorSetApply,
    },
    llmConfig,
    onLlmCapture,
    onSummary: () => {
      refreshPreviewIdentity();
      publishPreviewSpec();
    },
  });

  async function runLevelPrompt(options) {
    const result = await guidance.generateLevelBrief(options);
    if (result?.ok) {
      setDesignStep("attacker");
    }
    return result;
  }

  async function runAttackerPrompt(options) {
    const result = await guidance.generateAttackerBrief(options);
    if (result?.ok) {
      setDesignStep("defender");
    }
    return result;
  }

  async function runDefenderPrompt(options) {
    const result = await guidance.generateDefenderBrief(options);
    if (result?.ok) {
      setDesignStep("simulation");
    }
    return result;
  }

  async function buildAndLoad() {
    if (running) return;
    running = true;
    if (buildButton) buildButton.disabled = true;
    setStatus(buildStatus, "Preparing build from current brief...");

    try {
      const summary = guidance.getSummary?.();
      if (!summary) {
        setStatus(buildStatus, "Generate a design brief first.", true);
        return;
      }

      const actorText = actorSetJson?.value || "[]";
      const actorSetOk = guidance.updateActorSetFromJson(actorText);
      if (!actorSetOk) {
        setStatus(buildStatus, "Fix actor set JSON before building.", true);
        return;
      }
      const spendLedger = guidance.getSpendLedger?.();
      if (spendLedger?.overBudget) {
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
      const bundleLoaded = await onLoadBundle?.();
      if (bundleLoaded === false) {
        setStatus(buildStatus, "Build completed, but no bundle was available to load.", true);
        return;
      }

      const ran = await onRunBundle?.();
      if (ran === false) {
        setStatus(buildStatus, "Bundle loaded, but runtime artifacts were missing.", true);
        return;
      }

      onOpenSimulation?.();
      setStatus(buildStatus, "Build complete. Simulation loaded.");
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

  function setPromptButtonsBusy({ activeButton = null, activeLabel = "" } = {}) {
    const buttons = [
      runLevelPromptButton,
      runAttackerPromptButton,
      runDefenderPromptButton,
    ].filter(Boolean);
    buttons.forEach((button) => {
      if (!promptButtonLabelCache.has(button)) {
        promptButtonLabelCache.set(button, typeof button.textContent === "string" ? button.textContent : "");
      }
      button.disabled = true;
      if (typeof button.setAttribute === "function") {
        button.setAttribute("aria-busy", button === activeButton ? "true" : "false");
      }
      if (button === activeButton && typeof activeLabel === "string" && activeLabel.trim().length > 0 && "textContent" in button) {
        button.textContent = activeLabel;
      }
    });
  }

  function clearPromptButtonsBusy() {
    const buttons = [
      runLevelPromptButton,
      runAttackerPromptButton,
      runDefenderPromptButton,
    ].filter(Boolean);
    buttons.forEach((button) => {
      button.disabled = false;
      if (typeof button.removeAttribute === "function") {
        button.removeAttribute("aria-busy");
      }
      const originalLabel = promptButtonLabelCache.get(button);
      if (typeof originalLabel === "string" && "textContent" in button) {
        button.textContent = originalLabel;
      }
    });
  }

  async function runPromptWithBusyState({ button, activeLabel, action } = {}) {
    if (promptRunInFlight) {
      return { ok: false, reason: "prompt_busy" };
    }
    promptRunInFlight = true;
    setPromptButtonsBusy({ activeButton: button, activeLabel });
    try {
      return await action();
    } finally {
      promptRunInFlight = false;
      clearPromptButtonsBusy();
    }
  }

  if (runLevelPromptButton?.addEventListener) {
    runLevelPromptButton.addEventListener("click", () => {
      runPromptWithBusyState({
        button: runLevelPromptButton,
        activeLabel: "Running Level Prompt...",
        action: () => runLevelPrompt({ useFixture: false }),
      });
    });
  }

  if (runAttackerPromptButton?.addEventListener) {
    runAttackerPromptButton.addEventListener("click", () => {
      runPromptWithBusyState({
        button: runAttackerPromptButton,
        activeLabel: "Running Attacker Prompt...",
        action: () => runAttackerPrompt({ useFixture: false }),
      });
    });
  }

  if (runDefenderPromptButton?.addEventListener) {
    runDefenderPromptButton.addEventListener("click", () => {
      runPromptWithBusyState({
        button: runDefenderPromptButton,
        activeLabel: "Running Defender Prompt...",
        action: () => runDefenderPrompt({ useFixture: false }),
      });
    });
  }

  if (actorSetApply?.addEventListener) {
    actorSetApply.addEventListener("click", () => {
      publishPreviewSpec();
    });
  }

  if (actorSetJson?.addEventListener) {
    actorSetJson.addEventListener("change", () => {
      publishPreviewSpec();
    });
  }

  return {
    generateLevelBrief: (options) => guidance.generateLevelBrief(options),
    generateAttackerBrief: (options) => guidance.generateAttackerBrief(options),
    generateDefenderBrief: (options) => guidance.generateDefenderBrief(options),
    benchmarkLevelGeneration: (options) => guidance.benchmarkLevelGeneration(options),
    generateBrief: (options) => guidance.generateBrief(options),
    buildAndLoad,
  };
}
