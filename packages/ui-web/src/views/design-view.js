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
  const corridorWidthInput = root.querySelector("#prompt-corridor-width");
  const hallwayPatternInput = root.querySelector("#prompt-hallway-pattern");
  const patternInfillPercentInput = root.querySelector("#prompt-pattern-infill-percent");
  const layoutAllocationPercentInput = root.querySelector("#prompt-layout-allocation-percent");
  const defenderAllocationPercentInput = root.querySelector("#prompt-defender-allocation-percent");
  const attackerAllocationPercentInput = root.querySelector("#prompt-attacker-allocation-percent");
  const budgetAllocationSummary = root.querySelector("#prompt-budget-allocation-summary");
  const levelBenchmarkButton = root.querySelector("#design-run-level-benchmark");
  const levelBenchmarkOutput = root.querySelector("#design-level-benchmark-output");
  const benchmarkMaxTokenBudgetInput = root.querySelector("#benchmark-max-token-budget");
  const benchmarkSampleRunsInput = root.querySelector("#benchmark-sample-runs");
  const workflowAffinitiesContainer = root.querySelector("#prompt-workflow-affinities");
  const attackerCountInput = root.querySelector("#prompt-attacker-count");
  const attackerSetupModeInput = root.querySelector("#prompt-attacker-setup-mode");
  const attackerSelectedAffinitiesContainer = root.querySelector("#prompt-attacker-selected-affinities");
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
  let activePromptRuns = 0;
  let lastPublishedSpecText = "";
  let previewRunId = `design_ui_preview_${Date.now()}`;
  let previewCreatedAt = new Date().toISOString();
  const promptButtonLabelCache = new WeakMap();
  const phaseCompletion = {
    level: false,
    attacker: false,
    defender: false,
  };

  function listMissingDesignPhases() {
    const missing = [];
    if (!phaseCompletion.level) missing.push("level");
    if (!phaseCompletion.attacker) missing.push("attacker");
    if (!phaseCompletion.defender) missing.push("defender");
    return missing;
  }

  function updateBuildButtonState() {
    if (!buildButton) return;
    const missing = listMissingDesignPhases();
    buildButton.disabled = running || activePromptRuns > 0 || missing.length > 0;
  }

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
      corridorWidthInput,
      hallwayPatternInput,
      patternInfillPercentInput,
      layoutAllocationPercentInput,
      defenderAllocationPercentInput,
      attackerAllocationPercentInput,
      budgetAllocationSummary,
      levelBenchmarkButton,
      levelBenchmarkOutput,
      benchmarkMaxTokenBudgetInput,
      benchmarkSampleRunsInput,
      workflowAffinitiesContainer,
      attackerCountInput,
      attackerSetupModeInput,
      attackerSelectedAffinitiesContainer,
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

  async function runPhasePrompt(phaseId, action) {
    if (!phaseId || typeof action !== "function") {
      return { ok: false, reason: "invalid_phase_request" };
    }
    activePromptRuns += 1;
    updateBuildButtonState();
    try {
      const result = await action();
      phaseCompletion[phaseId] = result?.ok === true;
      return result;
    } catch (error) {
      phaseCompletion[phaseId] = false;
      throw error;
    } finally {
      activePromptRuns = Math.max(0, activePromptRuns - 1);
      updateBuildButtonState();
    }
  }

  async function runLevelPrompt(options) {
    return runPhasePrompt("level", () => guidance.generateLevelBrief(options));
  }

  async function runAttackerPrompt(options) {
    return runPhasePrompt("attacker", () => guidance.generateAttackerBrief(options));
  }

  async function runDefenderPrompt(options) {
    return runPhasePrompt("defender", () => guidance.generateDefenderBrief(options));
  }

  async function buildAndLoad() {
    if (running) return;
    const missingPhases = listMissingDesignPhases();
    if (missingPhases.length > 0) {
      setStatus(buildStatus, `Build blocked: run ${missingPhases.join(", ")} prompt(s) successfully first.`, true);
      updateBuildButtonState();
      return;
    }
    if (activePromptRuns > 0) {
      setStatus(buildStatus, "Build blocked while prompt runs are in progress.", true);
      updateBuildButtonState();
      return;
    }
    running = true;
    updateBuildButtonState();
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
      updateBuildButtonState();
    }
  }

  if (buildButton?.addEventListener) {
    buildButton.addEventListener("click", () => {
      buildAndLoad();
    });
  }

  async function runPromptWithBusyState({ button, activeLabel, action } = {}) {
    if (!button || button.disabled || button.getAttribute?.("aria-busy") === "true") {
      return { ok: false, reason: "prompt_busy" };
    }
    if (!promptButtonLabelCache.has(button)) {
      promptButtonLabelCache.set(button, typeof button.textContent === "string" ? button.textContent : "");
    }
    button.disabled = true;
    button.setAttribute?.("aria-busy", "true");
    if (typeof activeLabel === "string" && activeLabel.trim().length > 0 && "textContent" in button) {
      button.textContent = activeLabel;
    }
    try {
      return await action();
    } finally {
      button.disabled = false;
      button.removeAttribute?.("aria-busy");
      const originalLabel = promptButtonLabelCache.get(button);
      if (typeof originalLabel === "string" && "textContent" in button) {
        button.textContent = originalLabel;
      }
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

  updateBuildButtonState();

  return {
    generateLevelBrief: (options) => runLevelPrompt(options),
    generateAttackerBrief: (options) => runAttackerPrompt(options),
    generateDefenderBrief: (options) => runDefenderPrompt(options),
    benchmarkLevelGeneration: (options) => guidance.benchmarkLevelGeneration(options),
    generateBrief: (options) => guidance.generateBrief(options),
    buildAndLoad,
  };
}
