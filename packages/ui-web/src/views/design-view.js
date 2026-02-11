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
  const guidanceGenerate = root.querySelector("#design-guidance-generate");
  const guidanceStatus = root.querySelector("#design-guidance-status");
  const briefOutput = root.querySelector("#design-brief-output");
  const levelDesignOutput = root.querySelector("#design-level-output");
  const tokenBudgetInput = root.querySelector("#prompt-token-budget");
  const thinkTimeInput = root.querySelector("#prompt-think-time");
  const llmTokensInput = root.querySelector("#prompt-llm-tokens");
  const levelBudgetInput = root.querySelector("#prompt-level-budget");
  const levelAffinitiesContainer = root.querySelector("#prompt-level-affinities");
  const attackerBudgetInput = root.querySelector("#prompt-attacker-budget");
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
  const hasAttackerVitalsInputs = Object.values(attackerVitalsInputs).some(
    (group) => group?.max,
  );
  const resolvedAttackerVitalsInputs = hasAttackerVitalsInputs ? attackerVitalsInputs : null;
  const actorSetJson = root.querySelector("#design-actor-set-json");
  const actorSetApply = root.querySelector("#design-actor-set-apply");
  const actorSetPreview = root.querySelector("#design-actor-set-preview");
  const buildButton = root.querySelector("#design-build-and-load");
  const buildStatus = root.querySelector("#design-build-status");

  let running = false;
  let lastPublishedSpecText = "";
  let previewRunId = `design_ui_preview_${Date.now()}`;
  let previewCreatedAt = new Date().toISOString();

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
      generateButton: guidanceGenerate,
      statusEl: guidanceStatus,
      briefOutput,
      levelDesignOutput,
      tokenBudgetInput,
      thinkTimeInput,
      llmTokensInput,
      levelBudgetInput,
      levelAffinitiesContainer,
      attackerBudgetInput,
      attackerAffinitiesContainer,
      defenderAffinitiesContainer,
      attackerVitalsInputs: resolvedAttackerVitalsInputs,
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
    generateBrief: (options) => guidance.generateBrief(options),
    buildAndLoad,
  };
}
