import { wireTabs } from "./tabs.js";
import { createActorInspector } from "./actor-inspector.js";
import { createCliWorkerAdapter } from "../../adapters-web/src/adapters/cli-worker/index.js";
import { wireDesignView } from "./views/design-view.js";
import { wirePreviewView, validatePreviewLaunchBundle } from "./views/preview-view.js";
import { wireSimulationView } from "./views/simulation-view.js";
import { wireDiagnosticsView } from "./views/diagnostics-view.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const AFFINITY_SUMMARY_SCHEMA = "agent-kernel/AffinitySummary";
const AFFINITY_RULES_SCHEMA = "agent-kernel/AffinityRulesArtifact";
const MOTIVATION_RULES_SCHEMA = "agent-kernel/MotivationRulesArtifact";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const workspace = document.querySelector(".workspace");
const actorInspectorRoot = document.querySelector("#actor-inspector");
const commandHost = createCliWorkerAdapter();

let simulationView = null;
let designView = null;
let diagnosticsView = null;
let previewRefreshPromise = null;
let suppressDiagnosticsBundleCallback = false;
const runSessionNameInput = document.querySelector("#run-session-name");
const runSessionCidInput = document.querySelector("#run-session-cid");
const runSessionSaveButton = document.querySelector("#run-session-save");
const runSessionLoadButton = document.querySelector("#run-session-load");
const runSessionStatus = document.querySelector("#run-session-status");

function openTab(tabId) {
  const button = document.querySelector(`[data-tab="${tabId}"]`);
  button?.click?.();
}

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema) || null;
}

function setRunSessionStatus(message, level = "info") {
  if (!runSessionStatus) return;
  runSessionStatus.dataset.level = level;
  runSessionStatus.textContent = message;
}

function buildSyntheticBundle({
  bundle,
  spec,
  simConfig,
  initialState,
  affinityEffects,
  affinityRules,
  motivationRules,
  resourceBundle,
}) {
  if (bundle) return bundle;
  const artifacts = [simConfig, initialState, affinityEffects, affinityRules, motivationRules, resourceBundle].filter(Boolean);
  if (artifacts.length === 0) {
    return null;
  }
  return {
    spec: spec || null,
    schemas: [],
    artifacts,
  };
}

wireTabs({
  buttons: tabButtons,
  panels: tabPanels,
  defaultTab: "design",
  onChange: (tabId) => {
    if (workspace) {
      workspace.dataset.activeTab = tabId;
    }
    if (tabId === "preview") {
      void refreshPreviewBundle();
    }
  },
});

const previewView = wirePreviewView({
  onBuildAndLoadGame: async () => {
    const refreshed = await refreshPreviewBundle({ resetBuildOutput: false, emitVisualAssets: true });
    if (!refreshed?.ok) {
      return refreshed;
    }
    const launchBundle = refreshed.bundle || previewView.getLastBundle();
    const launchValidation = validatePreviewLaunchBundle(launchBundle);
    if (!launchValidation.ok) {
      return launchValidation;
    }
    await syncBundleViews({ bundle: launchBundle, source: "preview-run-build" });
    openTab("simulation");
    return { ok: true, message: "Run loaded from Preview." };
  },
});

const actorInspector = createActorInspector({
  containerEl: actorInspectorRoot,
  roomListEl: document.querySelector("#actor-inspector-room-list"),
  delverListEl: document.querySelector("#actor-inspector-delver-list"),
  wardenListEl: document.querySelector("#actor-inspector-warden-list"),
  detailEl: document.querySelector("#actor-inspector-detail"),
  onSelectEntity: (entity) => {
    simulationView?.focusInspectorEntity?.(entity);
  },
});

simulationView = wireSimulationView({
  actorInspector,
});
simulationView.setInspectorVisibility?.(true, actorInspector?.getSelectedEntity?.() || null);

async function syncBundleViews({ bundle, source }) {
  const payloadBundle = bundle || null;
  const simConfig = findArtifact(payloadBundle, SIM_CONFIG_SCHEMA);
  const initialState = findArtifact(payloadBundle, INITIAL_STATE_SCHEMA) || { actors: [] };
  const affinityEffects = findArtifact(payloadBundle, AFFINITY_SUMMARY_SCHEMA);
  const affinityRules = findArtifact(payloadBundle, AFFINITY_RULES_SCHEMA);
  const motivationRules = findArtifact(payloadBundle, MOTIVATION_RULES_SCHEMA);
  const resourceBundle = findArtifact(payloadBundle, RESOURCE_BUNDLE_SCHEMA);

  await previewView.loadBundle(payloadBundle, { source });
  designView?.setRules?.({
    affinityRules,
    motivationRules,
  });
  if (!payloadBundle) {
    simulationView?.clear?.("Run cleared.");
    return;
  }
  if (!simConfig) {
    simulationView?.clear?.("Bundle missing SimConfigArtifact.");
    return;
  }
  if (!Array.isArray(initialState?.actors) || initialState.actors.length === 0) {
    simulationView?.clear?.("Bundle has no actors. Use Preview to inspect the layout-only result.");
    return;
  }

  simulationView?.startRunFromArtifacts({
    simConfig,
    initialState,
    affinityEffects,
    affinityRules,
    motivationRules,
    resourceBundle,
    spec: payloadBundle?.spec || null,
  });
}

async function syncIpfsLoadPayload({
  bundle,
  manifest,
  fetched,
  source,
  checkpoint,
  actionLog,
} = {}) {
  const fetchedMap = fetched && typeof fetched === "object" ? fetched : {};
  const coreBundle = buildSyntheticBundle({
    bundle,
    spec: bundle?.spec || fetchedMap["spec.json"] || null,
    simConfig: findArtifact(bundle, SIM_CONFIG_SCHEMA) || fetchedMap["sim-config.json"] || null,
    initialState: findArtifact(bundle, INITIAL_STATE_SCHEMA) || fetchedMap["initial-state.json"] || null,
    affinityEffects: findArtifact(bundle, AFFINITY_SUMMARY_SCHEMA) || fetchedMap["affinity-summary.json"] || null,
    affinityRules: findArtifact(bundle, AFFINITY_RULES_SCHEMA) || fetchedMap["affinity-rules.json"] || null,
    motivationRules: findArtifact(bundle, MOTIVATION_RULES_SCHEMA) || fetchedMap["motivation-rules.json"] || null,
    resourceBundle: findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA) || fetchedMap["resource-bundle.json"] || null,
  });
  suppressDiagnosticsBundleCallback = true;
  try {
    if (manifest) {
      diagnosticsView?.loadManifestPayload?.(manifest, { source });
    }
    if (coreBundle) {
      diagnosticsView?.loadBundlePayload?.(coreBundle, { source });
    }
  } finally {
    suppressDiagnosticsBundleCallback = false;
  }
  if (!coreBundle) {
    simulationView?.clear?.("Loaded package is missing playable core artifacts.");
    return;
  }

  const simConfig = findArtifact(coreBundle, SIM_CONFIG_SCHEMA) || fetchedMap["sim-config.json"] || null;
  const initialState = findArtifact(coreBundle, INITIAL_STATE_SCHEMA) || fetchedMap["initial-state.json"] || { actors: [] };
  const affinityEffects = findArtifact(coreBundle, AFFINITY_SUMMARY_SCHEMA) || fetchedMap["affinity-summary.json"] || null;
  const affinityRules = findArtifact(coreBundle, AFFINITY_RULES_SCHEMA) || fetchedMap["affinity-rules.json"] || null;
  const motivationRules = findArtifact(coreBundle, MOTIVATION_RULES_SCHEMA) || fetchedMap["motivation-rules.json"] || null;
  const resourceBundle = findArtifact(coreBundle, RESOURCE_BUNDLE_SCHEMA) || fetchedMap["resource-bundle.json"] || null;

  await previewView.loadBundle(coreBundle, { source });
  designView?.setRules?.({
    affinityRules,
    motivationRules,
  });

  if (!simConfig || !Array.isArray(initialState?.actors) || initialState.actors.length === 0) {
    simulationView?.clear?.("Loaded package has no playable actors.");
    return;
  }

  simulationView?.startRunFromArtifacts({
    simConfig,
    initialState,
    affinityEffects,
    affinityRules,
    motivationRules,
    resourceBundle,
    spec: coreBundle?.spec || fetchedMap["spec.json"] || null,
    actionLog,
    checkpointState: checkpoint,
  });
}

function summarizePreviewError(result) {
  const errorText = Array.isArray(result?.errors) && result.errors.length > 0
    ? result.errors.join("; ")
    : result?.message;
  return errorText || "Add at least one configured card in Design before opening Preview.";
}

async function loadBuildOutputsIntoDiagnostics({ bundle, manifest, source }) {
  suppressDiagnosticsBundleCallback = true;
  try {
    if (manifest) {
      diagnosticsView?.loadManifestPayload?.(manifest, { source });
    }
    if (bundle) {
      diagnosticsView?.loadBundlePayload?.(bundle, { source });
    }
  } finally {
    suppressDiagnosticsBundleCallback = false;
  }
}

async function refreshPreviewBundle({ resetBuildOutput = false, emitVisualAssets = false } = {}) {
  if (previewRefreshPromise) return previewRefreshPromise;
  previewRefreshPromise = (async () => {
    if (!designView || !diagnosticsView) {
      return { ok: false, message: "Preview is still initializing." };
    }

    const published = await designView.publishPreviewSpec({
      force: true,
      resetBuildOutput,
      source: "design-preview",
    });
    if (!published?.ok) {
      const message = summarizePreviewError(published);
      previewView.clear(message);
      return { ok: false, message };
    }

    const buildResult = await diagnosticsView.runBuild({ emitVisualAssets });
    if (buildResult?.ok === false) {
      const message = "Preview build failed. Check Diagnostics for details.";
      previewView.clear(message);
      return { ok: false, message };
    }

    const bundle = buildResult?.response?.bundle || null;
    const manifest = buildResult?.response?.manifest || null;
    const source = emitVisualAssets ? "preview-run-build" : "design-preview";
    await loadBuildOutputsIntoDiagnostics({ bundle, manifest, source });
    if (!bundle) {
      const message = "Preview build did not produce a bundle.";
      previewView.clear(message, "error");
      return { ok: false, message };
    }
    const loaded = await previewView.loadBundle(bundle, { source });
    if (!loaded) {
      return { ok: false, message: "Preview build produced an invalid bundle." };
    }
    return { ok: true, bundle, manifest };
  })().finally(() => {
    previewRefreshPromise = null;
  });

  return previewRefreshPromise;
}

diagnosticsView = wireDiagnosticsView({
  commandHost,
  onBundleLoaded: ({ bundle, manifest, fetched, source, checkpoint, actionLog }) => {
    if (suppressDiagnosticsBundleCallback) {
      return;
    }
    if (
      checkpoint
      || actionLog
      || fetched?.["checkpoint-state.json"]
      || fetched?.["sim-config.json"]
      || fetched?.["initial-state.json"]
    ) {
      void syncIpfsLoadPayload({
        bundle,
        manifest,
        fetched,
        source,
        checkpoint: checkpoint || fetched?.["checkpoint-state.json"] || null,
        actionLog: actionLog || fetched?.["action-log.json"] || null,
      });
      return;
    }
    void syncBundleViews({ bundle, source });
  },
  onBundleStateReset: () => {
    void syncBundleViews({ bundle: null, source: "clear" });
  },
});

designView = wireDesignView({
  commandHost,
  onSendBuildSpec: ({ specText, source, resetBuildOutput }) =>
    diagnosticsView.setBuildSpecText(specText, { source, resetOutput: resetBuildOutput }),
  onLlmCapture: ({ captures }) => {
    diagnosticsView.appendLlmCaptures(captures, { source: "Captured design guidance turn" });
  },
});

globalThis.addEventListener?.("beforeunload", () => {
  simulationView?.dispose?.();
  commandHost.dispose?.();
});

runSessionSaveButton?.addEventListener("click", async () => {
  const coreArtifactMap = diagnosticsView?.getIpfsCoreArtifacts?.();
  if (!coreArtifactMap) {
    setRunSessionStatus("Build or load a core package before saving a session checkpoint.", "error");
    return;
  }
  const exported = simulationView?.exportSessionArtifacts?.({
    sessionId: runSessionNameInput?.value || undefined,
    checkpointId: runSessionNameInput?.value || undefined,
    status: "checkpoint",
  });
  if (!exported?.ok) {
    setRunSessionStatus("No active run is available to checkpoint.", "error");
    return;
  }
  runSessionSaveButton.disabled = true;
  try {
    const result = await commandHost.ipfsPublish({
      scope: "session",
      coreArtifactMap,
      sessionArtifactMap: exported.artifacts,
      sessionId: exported.sessionId,
      checkpointId: exported.checkpointId,
      sessionStatus: "checkpoint",
    });
    const cid = result?.output?.cid || result?.cid || "";
    if (runSessionCidInput && cid) {
      runSessionCidInput.value = cid;
    }
    setRunSessionStatus(
      cid
        ? `Checkpoint ${exported.checkpointId} saved to IPFS package ${cid}.`
        : `Checkpoint ${exported.checkpointId} packaged successfully.`,
      "info",
    );
  } catch (error) {
    setRunSessionStatus(error?.message || "Failed to save checkpoint.", "error");
  } finally {
    runSessionSaveButton.disabled = false;
  }
});

runSessionLoadButton?.addEventListener("click", async () => {
  const cid = typeof runSessionCidInput?.value === "string" ? runSessionCidInput.value.trim() : "";
  if (!cid) {
    setRunSessionStatus("Enter an IPFS package CID to restore a checkpoint.", "error");
    return;
  }
  runSessionLoadButton.disabled = true;
  try {
    const result = await commandHost.ipfsLoad({
      cid,
      loadMode: "resume",
    });
    await syncIpfsLoadPayload({
      bundle: result?.bundle || null,
      manifest: result?.manifest || null,
      fetched: result?.fetched || null,
      source: "ipfs-resume",
      checkpoint: result?.checkpoint || result?.fetched?.["checkpoint-state.json"] || null,
      actionLog: result?.actionLog || result?.fetched?.["action-log.json"] || null,
    });
    openTab("simulation");
    setRunSessionStatus(`Restored checkpoint from ${cid}.`, "info");
  } catch (error) {
    setRunSessionStatus(error?.message || "Failed to restore checkpoint.", "error");
  } finally {
    runSessionLoadButton.disabled = false;
  }
});
