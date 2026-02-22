import { wireTabs } from "./tabs.js";
import { createActorInspector } from "./actor-inspector.js";
import { wireDesignView } from "./views/design-view.js";
import { wireSimulationView } from "./views/simulation-view.js";
import { wireRuntimeView } from "./views/runtime-view.js";
import { wireDiagnosticsView } from "./views/diagnostics-view.js";

const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const workspace = document.querySelector(".workspace");
const actorInspectorRoot = document.querySelector("#actor-inspector");

function setInspectorOpenState(open) {
  if (!workspace) return;
  workspace.dataset.inspectorOpen = open ? "true" : "false";
}

wireTabs({
  buttons: tabButtons,
  panels: tabPanels,
  defaultTab: "design",
  onChange: (tabId) => {
    if (!workspace) return;
    workspace.dataset.activeTab = tabId;
  },
});

const actorInspector = createActorInspector({
  containerEl: actorInspectorRoot,
  closeButtonEl: document.querySelector("#actor-inspector-close"),
  statusEl: document.querySelector("#actor-inspector-status"),
  profileEl: document.querySelector("#actor-inspector-profile"),
  capabilitiesEl: document.querySelector("#actor-inspector-capabilities"),
  constraintsEl: document.querySelector("#actor-inspector-constraints"),
  liveStateEl: document.querySelector("#actor-inspector-live"),
  onVisibilityChange: (visible) => {
    setInspectorOpenState(visible);
  },
});
setInspectorOpenState(actorInspector?.isVisible?.() === true);

let simulationView = null;
const runtimeView = wireRuntimeView({
  onSelectActor: (actorId) => {
    actorInspector?.selectActorById?.(actorId);
    simulationView?.setViewerActor?.(actorId);
  },
});

simulationView = wireSimulationView({
  actorInspector,
  onObservation: (payload) => runtimeView.updateFromSimulation(payload),
});

const diagnosticsView = wireDiagnosticsView({
  onRunFromBundle: (payload) => {
    simulationView.startRunFromArtifacts(payload);
  },
});

wireDesignView({
  onSendBuildSpec: ({ specText, source, resetBuildOutput }) =>
    diagnosticsView.setBuildSpecText(specText, { source, resetOutput: resetBuildOutput }),
  onRunBuild: async () => diagnosticsView.runBuild(),
  onLoadBundle: () => diagnosticsView.loadLastBundle(),
  onRunBundle: () => diagnosticsView.runBundle(),
  onLlmCapture: ({ captures }) => {
    diagnosticsView.appendLlmCaptures(captures, { source: "Captured design guidance turn" });
  },
  onOpenSimulation: () => {
    const simulationTab = document.querySelector('[data-tab="simulation"]');
    simulationTab?.click?.();
  },
});
