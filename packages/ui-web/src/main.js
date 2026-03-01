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
let simulationView = null;
let latestInspectorSelection = null;
let inspectorRef = null;

function setInspectorOpenState(open) {
  if (!workspace) return;
  workspace.dataset.inspectorOpen = open ? "true" : "false";
}

function syncSimulationInspectorVisibility(visible) {
  const normalized = Boolean(visible);
  const selectedEntity = normalized
    ? (latestInspectorSelection || inspectorRef?.getSelectedEntity?.() || null)
    : null;
  simulationView?.setInspectorVisibility?.(normalized, selectedEntity);
  if (normalized && selectedEntity) {
    simulationView?.focusInspectorEntity?.(selectedEntity);
  }
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
  statusEl: document.querySelector("#actor-inspector-status"),
  roomListEl: document.querySelector("#actor-inspector-room-list"),
  attackerListEl: document.querySelector("#actor-inspector-attacker-list"),
  defenderListEl: document.querySelector("#actor-inspector-defender-list"),
  detailEl: document.querySelector("#actor-inspector-detail"),
  onSelectEntity: (entity) => {
    latestInspectorSelection = entity;
    simulationView?.focusInspectorEntity?.(entity);
    runtimeView?.selectActor?.(entity?.actorId || "", { notify: false });
  },
  onVisibilityChange: (visible) => {
    setInspectorOpenState(visible);
    syncSimulationInspectorVisibility(visible);
  },
});
inspectorRef = actorInspector;
setInspectorOpenState(true);

const runtimeView = wireRuntimeView({
  onSelectActor: (actorId) => {
    actorInspector?.selectActorById?.(actorId);
    const selectedEntity = actorInspector?.getSelectedEntity?.() || null;
    if (selectedEntity) {
      latestInspectorSelection = selectedEntity;
      simulationView?.focusInspectorEntity?.(selectedEntity);
    } else {
      simulationView?.setViewerActor?.(actorId);
    }
  },
  onAction: (payload) => {
    simulationView?.performGameAction?.(payload);
  },
});

simulationView = wireSimulationView({
  actorInspector,
  onObservation: (payload) => {
    runtimeView.updateFromSimulation(payload);
    const selectedEntity = inspectorRef?.getSelectedEntity?.() || latestInspectorSelection || null;
    latestInspectorSelection = selectedEntity;
    const selectedActorId = typeof selectedEntity?.actorId === "string"
      ? selectedEntity.actorId.trim()
      : "";
    runtimeView.selectActor(selectedActorId, { notify: false });
  },
});
syncSimulationInspectorVisibility(true);

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
