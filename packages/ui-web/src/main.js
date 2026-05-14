import { wireTabs } from "./tabs.js";
import { createActorInspector } from "./actor-inspector.js";
import { createCliWorkerAdapter } from "../../adapters-web/src/adapters/cli-worker/index.js";
import { buildResultHasBundle } from "./build-orchestrator.js";
import { wireDesignView } from "./views/design-view.js";
import { wirePreviewView, validatePreviewLaunchBundle } from "./views/preview-view.js";
import { wireDiagnosticsView } from "./views/diagnostics-view.js";
import { wireGameplayView } from "./views/gameplay-view.js";
import { resolveIcon } from "./icon-resolver.js";
import { shouldHydrateDesignFromBundleSource } from "./build-spec-ui.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const AFFINITY_SUMMARY_SCHEMA = "agent-kernel/AffinitySummary";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const workspace = document.querySelector(".workspace");
const actorInspectorRoot = document.querySelector("#actor-inspector");
const gameplayRunIdLabel = document.querySelector("#gameplay-run-id-label");
const commandHost = createCliWorkerAdapter();

let designView = null;
let diagnosticsView = null;
let previewRefreshPromise = null;
let previewView = null;
let actorInspector = null;
let gameplayView = null;
let gameplayRunPending = false;

function openTab(tabId) {
  tabs?.setActive(tabId);
}

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema) || null;
}

function getBundleRunId(bundle) {
  const specRunId = bundle?.spec?.meta?.runId;
  if (typeof specRunId === "string" && specRunId.trim()) {
    return specRunId.trim();
  }
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  const artifactRunId = artifacts.find((artifact) => typeof artifact?.meta?.runId === "string" && artifact.meta.runId.trim())
    ?.meta?.runId;
  return typeof artifactRunId === "string" ? artifactRunId.trim() : "";
}

function setGameplayRunIdLabel(bundle) {
  if (!gameplayRunIdLabel) return;
  const runId = getBundleRunId(bundle);
  gameplayRunIdLabel.textContent = runId ? `#${runId}` : "";
  if (runId) {
    gameplayRunIdLabel.title = runId;
  } else {
    gameplayRunIdLabel.removeAttribute?.("title");
  }
}

function loadGameplayBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  gameplayView?.loadRun(bundle);
  setGameplayRunIdLabel(bundle);
  return true;
}

function populateUIIcons(resourceBundle) {
  const iconElements = document.querySelectorAll("[data-icon-category][data-icon-key]");
  iconElements.forEach((el) => {
    const category = el.dataset.iconCategory;
    const key = el.dataset.iconKey;
    if (!category || !key) return;

    // Clear existing content
    el.textContent = "";
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }

    // Resolve and append icon
    const iconEl = resolveIcon(resourceBundle, category, key);
    if (iconEl) {
      el.appendChild(iconEl);
    }
  });
}

function updateInspectorSurface(tabId) {
  actorInspector?.setMode?.(tabId === "preview" ? "preview" : "simulation");
}

let tabs;
tabs = wireTabs({
  buttons: tabButtons,
  panels: tabPanels,
  defaultTab: "design",
  onChange: (tabId) => {
    if (workspace) {
      workspace.dataset.activeTab = tabId;
    }
    updateInspectorSurface(tabId);
    if (tabId === "gameplay" && !gameplayRunPending && !gameplayView?.isRunActive?.()) {
      gameplayView?.clear?.("Launching run…");
      void launchGameplayRun({ autoGenerate: true });
    }
    if (tabId === "preview") {
      void refreshPreviewBundle();
    }
  },
});
globalThis.__ak_setActiveTab = (id) => tabs?.setActive(id);
globalThis.__ak_loadGameplayBundle = (bundle) => {
  if (!loadGameplayBundle(bundle)) return false;
  openTab("gameplay");
  return true;
};

actorInspector = createActorInspector({
  containerEl: actorInspectorRoot,
  roomListEl: document.querySelector("#actor-inspector-room-list"),
  attackerListEl: document.querySelector("#actor-inspector-delver-list"),
  defenderListEl: document.querySelector("#actor-inspector-warden-list"),
  hazardListEl: document.querySelector("#actor-inspector-hazard-list"),
  resourceListEl: document.querySelector("#actor-inspector-resource-list"),
  detailEl: document.querySelector("#actor-inspector-detail"),
  onSelectEntity: (entity) => {
    if (workspace?.dataset?.activeTab === "gameplay") {
      gameplayView?.handleInspectorSelect?.(entity);
    }
    if (workspace?.dataset?.activeTab === "preview") {
      previewView?.focusInspectorEntity?.(entity);
    }
  },
});

previewView = wirePreviewView({
  actorInspector,
  onBuildAndLoadGame: async () => {
    const refreshed = await refreshPreviewBundle({ resetBuildOutput: false });
    if (!refreshed?.ok) {
      return refreshed;
    }
    const launchValidation = validatePreviewLaunchBundle(previewView.getLastBundle());
    if (!launchValidation.ok) {
      return launchValidation;
    }
    const bundle = previewView.getLastBundle();
    if (bundle) {
      loadGameplayBundle(bundle);
    }
    openTab("gameplay");
    return { ok: true, message: "Run loaded from Preview." };
  },
});

actorInspector?.setMode?.("simulation");
updateInspectorSurface(workspace?.dataset?.activeTab || "design");

async function syncBundleViews({ bundle, source }) {
  await previewView.loadBundle(bundle, { source });

  const resourceBundle = bundle ? findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA) : null;
  setGameplayRunIdLabel(bundle);

  // Update icon displays across all views
  populateUIIcons(resourceBundle);
  actorInspector?.setResourceBundle?.(resourceBundle);
  designView?.setResourceBundle?.(resourceBundle);

}

function summarizePreviewError(result) {
  const errorText = Array.isArray(result?.errors) && result.errors.length > 0
    ? result.errors.join("; ")
    : result?.message;
  return errorText || "Add at least one configured card in Design before opening Preview.";
}

async function launchGameplayRun({ autoGenerate = false } = {}) {
  if (!designView || !diagnosticsView) return;

  if (autoGenerate) {
    const generated = designView.autoGenerateCards?.();
    const hasCards = (designView.getCards?.() || []).length > 0;
    if (generated?.ok === false && !hasCards) {
      return generated;
    }
  }

  const published = await designView.publishPreviewSpec({
    force: true,
    resetBuildOutput: false,
    source: "design-preview",
  });
  if (!published?.ok) return;

  gameplayRunPending = true;
  const buildResult = await diagnosticsView.runBuild();
  if (buildResult?.ok === false) {
    gameplayRunPending = false;
    return;
  }
  if (buildResultHasBundle(buildResult)) {
    diagnosticsView.loadLastBundle();
  } else {
    gameplayRunPending = false;
  }
}

async function refreshPreviewBundle({ resetBuildOutput = false } = {}) {
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

    const buildResult = await diagnosticsView.runBuild();
    if (buildResult?.ok === false) {
      const message = "Preview build failed. Check Diagnostics for details.";
      previewView.clear(message);
      return { ok: false, message };
    }
    if (buildResultHasBundle(buildResult)) {
      diagnosticsView.loadLastBundle();
      return { ok: true };
    }
    previewView.clear("Preview bundle is not ready yet.");
    actorInspector?.setMode?.("preview");
    return { ok: true };
  })().finally(() => {
    previewRefreshPromise = null;
  });

  return previewRefreshPromise;
}

gameplayView = wireGameplayView({
  root: document,
  actorInspector,
  onDiscardToDesign: () => {
    void syncBundleViews({ bundle: null, source: "discard" });
    setGameplayRunIdLabel(null);
    openTab("design");
  },
});
globalThis.__ak_gameplayView = gameplayView;

diagnosticsView = wireDiagnosticsView({
  commandHost,
  onBundleLoaded: ({ bundle, source }) => {
    if (bundle && shouldHydrateDesignFromBundleSource(source)) {
      designView?.loadBuildSpec?.(bundle.spec, { source: `Diagnostics ${source}` });
    }
    void syncBundleViews({ bundle, source });

    if (gameplayRunPending && bundle) {
      gameplayRunPending = false;
      loadGameplayBundle(bundle);
      openTab("gameplay");
    }
  },
  onBundleStateReset: () => {
    gameplayRunPending = false;
    setGameplayRunIdLabel(null);
    void syncBundleViews({ bundle: null, source: "clear" });
  },
});

designView = wireDesignView({
  commandHost,
  onSendBuildSpec: ({ specText, source, resetBuildOutput }) =>
    diagnosticsView.setBuildSpecText(specText, { source, resetOutput: resetBuildOutput }),
  onLlmCapture: null,
});

globalThis.addEventListener?.("beforeunload", () => {
  previewView?.dispose?.();
  gameplayView?.dispose?.();
  commandHost.dispose?.();
});

// Initialize UI icons with text labels on startup
populateUIIcons(null);
