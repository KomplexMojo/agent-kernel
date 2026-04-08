import { wireTabs } from "./tabs.js";
import { createActorInspector } from "./actor-inspector.js";
import { createCliWorkerAdapter } from "../../adapters-web/src/adapters/cli-worker/index.js";
import { wireDesignView } from "./views/design-view.js";
import { wirePreviewView, validatePreviewLaunchBundle } from "./views/preview-view.js";
import { wireSimulationView } from "./views/simulation-view.js";
import { wireDiagnosticsView } from "./views/diagnostics-view.js";
import { resolveIcon } from "./icon-resolver.js";
import { setResourceBundle as setDesignResourceBundle } from "./design-guidance.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const AFFINITY_SUMMARY_SCHEMA = "agent-kernel/AffinitySummary";
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

function openTab(tabId) {
  const button = document.querySelector(`[data-tab="${tabId}"]`);
  button?.click?.();
}

function findArtifact(bundle, schema) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  return artifacts.find((artifact) => artifact?.schema === schema) || null;
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
    const refreshed = await refreshPreviewBundle({ resetBuildOutput: false });
    if (!refreshed?.ok) {
      return refreshed;
    }
    const launchValidation = validatePreviewLaunchBundle(previewView.getLastBundle());
    if (!launchValidation.ok) {
      return launchValidation;
    }
    openTab("simulation");
    return { ok: true, message: "Run loaded from Preview." };
  },
});

const actorInspector = createActorInspector({
  containerEl: actorInspectorRoot,
  roomListEl: document.querySelector("#actor-inspector-room-list"),
  attackerListEl: document.querySelector("#actor-inspector-delver-list"),
  defenderListEl: document.querySelector("#actor-inspector-warden-list"),
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
  await previewView.loadBundle(bundle, { source });

  const resourceBundle = bundle ? findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA) : null;

  // Update icon displays across all views
  populateUIIcons(resourceBundle);
  actorInspector?.setResourceBundle?.(resourceBundle);
  setDesignResourceBundle(resourceBundle);

  if (!bundle) {
    simulationView?.clear?.("Run cleared.");
    return;
  }

  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA);
  if (!simConfig) {
    simulationView?.clear?.("Bundle missing SimConfigArtifact.");
    return;
  }

  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA) || { actors: [] };
  if (!Array.isArray(initialState?.actors) || initialState.actors.length === 0) {
    simulationView?.clear?.("Bundle has no actors. Use Preview to inspect the layout-only result.");
    return;
  }

  simulationView?.startRunFromArtifacts({
    simConfig,
    initialState,
    affinityEffects: findArtifact(bundle, AFFINITY_SUMMARY_SCHEMA),
    resourceBundle,
    spec: bundle?.spec || null,
  });
}

function summarizePreviewError(result) {
  const errorText = Array.isArray(result?.errors) && result.errors.length > 0
    ? result.errors.join("; ")
    : result?.message;
  return errorText || "Add at least one configured card in Design before opening Preview.";
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

    diagnosticsView.loadLastBundle();
    return { ok: true };
  })().finally(() => {
    previewRefreshPromise = null;
  });

  return previewRefreshPromise;
}

diagnosticsView = wireDiagnosticsView({
  commandHost,
  onBundleLoaded: ({ bundle, source }) => {
    if (bundle && (source === "file" || source === "ipfs")) {
      designView?.loadBuildSpec?.(bundle.spec, { source: `Diagnostics ${source}` });
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

// Initialize UI icons with text labels on startup
populateUIIcons(null);
