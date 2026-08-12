import { wireTabs } from "./tabs.js";
import { createActorInspector } from "./actor-inspector.js";
import { createCliWorkerAdapter } from "../../adapters-web/src/adapters/cli-worker/index.js";
import { buildResultHasBundle } from "./build-orchestrator.js";
import { shouldReuseActiveRun } from "./gameplay-launch.js";
import { wireDesignView } from "./views/design-view.js";
import { wirePreviewView, validatePreviewLaunchBundle } from "./views/preview-view.js";
import { wireDiagnosticsView } from "./views/diagnostics-view.js";
import { wireGameplayView } from "./views/gameplay-view.js";
import { createPhaserFrameView } from "./views/phaser-frame-view.js";
import { buildTileAffinityVisualsFromBundle } from "./views/affinity-field-bridge.js";
import { resolveIcon } from "./icon-resolver.js";
import { shouldHydrateDesignFromBundleSource } from "./build-spec-ui.js";
import { connectSandboxBridge } from "./sandbox-bridge-client.js";
import { createDefaultResourceBundleArtifact } from "../../runtime/src/render/resource-bundle.js";

const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";
const AFFINITY_SUMMARY_SCHEMA = "agent-kernel/AffinitySummary";
const RESOURCE_BUNDLE_SCHEMA = "agent-kernel/ResourceBundleArtifact";

const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const workspace = document.querySelector(".workspace");
const actorInspectorRoot = document.querySelector("#actor-inspector");
const commandHost = createCliWorkerAdapter();

// Status rail elements
const statusRailRunId = document.querySelector("#status-rail-run-id");
const statusRailTokens = {
  room: document.querySelector("#sr-room"),
  delver: document.querySelector("#sr-delver"),
  warden: document.querySelector("#sr-warden"),
  hazard: document.querySelector("#sr-hazard"),
  resource: document.querySelector("#sr-resource"),
};
const statusRailTotal = document.querySelector("#sr-total");

let designView = null;
let diagnosticsView = null;
let previewRefreshPromise = null;
let previewView = null;
let actorInspector = null;
let gameplayView = null;
let phaserFrame = null;
let gameplayRunPending = false;
// tabGeneration captured when gameplayRunPending was set; see the onBundleLoaded guard.
let pendingGameplayGeneration = -1;
let currentRunId = "";
// Spec text of the run currently loaded into the Gameplay tab. Used to decide
// whether re-entering Gameplay should rebuild (design changed) or keep the active
// run (design unchanged), so editing room size in Design always shows up in play.
let lastGameplaySpecText = "";
// Sequence counter for status rail updates — only the highest sequence number wins,
// preventing stale syncBundleViews calls from overwriting fresh design-ledger state.
let statusRailSeq = 0;

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

function updateStatusRail({ runId, byType, budgetTokens, totalSpentTokens, remainingTokens, _seq } = {}) {
  // Reject stale updates — only accept if no sequence token is present or it matches
  // the current high-water mark (Issue #3).
  if (typeof _seq === "number" && _seq < statusRailSeq) return;
  // Run ID
  if (statusRailRunId) {
    statusRailRunId.textContent = runId ? `#${runId}` : "";
    if (runId) {
      statusRailRunId.title = runId;
    } else {
      statusRailRunId.removeAttribute?.("title");
    }
  }

  // Per-type token spans
  const typeOrder = ["room", "delver", "warden", "hazard", "resource"];
  typeOrder.forEach((type) => {
    const el = statusRailTokens[type];
    if (!el) return;
    const entry = byType?.[type];
    if (entry) {
      const used = entry.usedTokens ?? 0;
      const allocated = entry.allocatedTokens ?? 0;
      el.textContent = `${type[0].toUpperCase()}${type.slice(1)}: ${used}/${allocated}`;
      el.classList?.toggle("is-over-budget", (entry.overByTokens ?? 0) > 0);
    } else {
      el.textContent = "";
      el.classList?.remove("is-over-budget");
    }
  });

  // Total remaining
  if (statusRailTotal) {
    if (typeof remainingTokens === "number" && typeof budgetTokens === "number") {
      statusRailTotal.textContent = `${totalSpentTokens ?? 0}/${budgetTokens} (${remainingTokens} left)`;
    } else {
      statusRailTotal.textContent = "";
    }
  }
}

function loadGameplayBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  gameplayView?.loadRun(bundle);
  currentRunId = getBundleRunId(bundle);
  // Preserve existing allocation ledger state on the rail (Issue #1):
  // Only update the runId; leave byType/budgetTokens/etc. unchanged by
  // passing the current design ledger state alongside the new run ID.
  const existingLedger = designView?.getAllocationLedger?.();
  updateStatusRail({
    runId: currentRunId,
    ...(existingLedger ? {
      byType: existingLedger.byType,
    } : {}),
  });
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
    const size = el.dataset.iconSize || "sm";
    const iconEl = resolveIcon(resourceBundle, category, key, size);
    if (iconEl) {
      el.appendChild(iconEl);
    }
  });
}

function updateInspectorSurface(tabId) {
  actorInspector?.setMode?.(tabId === "preview" ? "preview" : "simulation");
}

// Incremented on every explicit tab change (click or programmatic). Captured by
// launchGameplayRun before it kicks off an async worker build, then compared when
// the build's onBundleLoaded callback fires — if the user already navigated away
// (e.g. pressed "back" to Design) while the build was in flight, the generation
// will have moved on and the stale completion won't force the tab back to Gameplay.
let tabGeneration = 0;

let tabs;
tabs = wireTabs({
  buttons: tabButtons,
  panels: tabPanels,
  defaultTab: "design",
  onChange: (tabId) => {
    tabGeneration++;
    if (workspace) {
      workspace.dataset.activeTab = tabId;
    }
    phaserFrame?.setActiveTab?.(tabId);
    phaserFrame?.setRenderMode?.(tabId === "gameplay" ? "shelf" : "design");
    updateInspectorSurface(tabId);
    // Issue #2: clear the stale Gameplay run ID when returning to Design so that
    // subsequent design-ledger status updates are not labelled under the old run.
    if (tabId === "design") {
      currentRunId = "";
    }
    // Always re-evaluate the design on entering Gameplay: launchGameplayRun keeps the
    // active run when the design is unchanged and rebuilds when it changed. The old
    // `!isRunActive()` guard skipped the rebuild, so edits (e.g. room size) never showed.
    if (tabId === "gameplay" && !gameplayRunPending) {
      void launchGameplayRun({ autoGenerate: true });
    }
    if (tabId === "preview") {
      void refreshPreviewBundle();
    }
  },
});
globalThis.__ak_setActiveTab = (id) => tabs?.setActive(id);

// M7: scenario loader — compile a scenario JSON into a gameplay bundle and load it.
// Used by the UI sandbox controls and by Playwright tests that inject scenarios.
globalThis.__ak_loadScenario = async (scenario, options = {}) => {
  const { compileScenarioToBundle } = await import("./scenario-loader.js");
  const bundle = await compileScenarioToBundle(scenario);
  return globalThis.__ak_loadGameplayBundle(bundle, options);
};

// D3+D4: also hydrate Design/Preview from the bundle spec and honor targetTab
globalThis.__ak_loadGameplayBundle = async (bundle, { targetTab = "design" } = {}) => {
  if (!loadGameplayBundle(bundle)) return false;
  // Route spec to Phaser card builder (index_c.html path)
  if (bundle?.spec && phaserFrame) {
    await phaserFrame.ingest(bundle.spec);
    const surface = phaserFrame.getCardBuilderSurface?.();
    const ctrl = surface?.getController?.();
    const cards = ctrl?.getCards?.() || [];
    const firstActor = cards.find((c) => c.type === "delver" || c.type === "warden");
    if (firstActor) {
      ctrl.pullCardToEditor(firstActor.id);
      await surface.render?.();
    }
  }
  const ALLOWED_TABS = new Set(["design", "gameplay", "preview"]);
  // Opening the gameplay tab normally re-generates a run from the design
  // (launchGameplayRun below), which would clobber the bundle we just loaded
  // explicitly — scenario injection and the MCP bridge both land here. Hold
  // gameplayRunPending across the tab switch so the onChange guard skips the
  // auto-generate for this navigation only.
  const wasPending = gameplayRunPending;
  gameplayRunPending = true;
  try {
    openTab(ALLOWED_TABS.has(targetTab) ? targetTab : "design");
  } finally {
    gameplayRunPending = wasPending;
  }
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
  detailFrameEl: document.querySelector("#actor-inspector-detail-frame"),
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
  // Capture the sequence number BEFORE the async previewView.loadBundle so that
  // any onStatusUpdate fired by design-guidance during this await gets a higher
  // sequence number and wins over this stale bundle-derived call (Issue #3).
  const mySeq = ++statusRailSeq;
  await previewView.loadBundle(bundle, { source });

  const resourceBundle = bundle ? findArtifact(bundle, RESOURCE_BUNDLE_SCHEMA) : null;
  currentRunId = bundle ? getBundleRunId(bundle) : "";
  updateStatusRail({ runId: currentRunId, _seq: mySeq });

  // Update icon displays across all views
  populateUIIcons(resourceBundle);
  actorInspector?.setResourceBundle?.(resourceBundle);
  designView?.setResourceBundle?.(resourceBundle);
  phaserFrame?.setResourceBundle?.(resourceBundle);
}

function summarizePreviewError(result) {
  const errorText = Array.isArray(result?.errors) && result.errors.length > 0
    ? result.errors.join("; ")
    : result?.message;
  return errorText || "Add at least one configured card in Design before opening Preview.";
}

async function launchGameplayRun({ autoGenerate = false } = {}) {
  if (!diagnosticsView) return;
  // Capture the navigation generation at entry — the awaits below yield, and
  // a user navigating away mid-launch must invalidate this build's completion.
  // Capturing later (as before) missed navigations during the publish await.
  const launchGeneration = tabGeneration;

  // In index_c.html the Phaser card builder is the live design state; designView reads
  // from DOM elements that don't exist there, so designView.getCards() is always empty.
  // Read cards and publish spec from the Phaser controller when it's present.
  const phaserController = phaserFrame?.getCardBuilderSurface?.()?.getController?.();
  const phaserCards = phaserController?.getCards?.() ?? [];
  const hasPhaserCards = phaserCards.length > 0;

  if (autoGenerate) {
    if (hasPhaserCards) {
      const hasRooms = phaserCards.some((c) => c.type === "room");
      if (!hasRooms) {
        gameplayView?.clear?.(
          "Your design needs at least one Room card. Add a Room in the Design screen before launching Gameplay."
        );
        return { ok: false, reason: "no_room" };
      }
    } else if (designView) {
      const generated = designView.autoGenerateCards?.();
      if (generated?.ok === false) {
        gameplayView?.clear?.("Add cards in the Design screen before launching Gameplay.");
        return generated;
      }
    }
  }

  // Compare the design's current spec against the run already loaded in Gameplay.
  // If unchanged and a run is active, keep it (preserves tick navigation); otherwise
  // rebuild so design edits — including room size — are reflected in play.
  const reuseActiveRun = (specText) => shouldReuseActiveRun({
    specText,
    lastGameplaySpecText,
    isRunActive: Boolean(gameplayView?.isRunActive?.()),
  });

  let buildResult;
  if (hasPhaserCards && phaserController) {
    const built = await phaserController.publishSpecText({ source: "design-preview" });
    if (!built?.ok) {
      gameplayView?.clear?.("Could not build a run from your design. Check your cards.");
      return built;
    }
    if (reuseActiveRun(built.specText)) {
      return { ok: true, reason: "unchanged" };
    }
    lastGameplaySpecText = built.specText;
    gameplayRunPending = true;
    pendingGameplayGeneration = launchGeneration;
    buildResult = await diagnosticsView.runBuildWithSpec(built.specText);
  } else if (designView) {
    const published = await designView.publishPreviewSpec({
      force: true,
      resetBuildOutput: false,
      source: "design-preview",
    });
    if (!published?.ok) return;
    if (reuseActiveRun(published.specText)) {
      return { ok: true, reason: "unchanged" };
    }
    if (typeof published.specText === "string") {
      lastGameplaySpecText = published.specText;
    }
    gameplayRunPending = true;
    pendingGameplayGeneration = launchGeneration;
    buildResult = await diagnosticsView.runBuild();
  } else {
    return { ok: false, reason: "no_spec_source" };
  }
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
  buildTileAffinityVisualsFromBundleFn: (bundle) => buildTileAffinityVisualsFromBundle(bundle),
  onDiscardToDesign: () => {
    currentRunId = "";
    updateStatusRail({ runId: "" });
    void syncBundleViews({ bundle: null, source: "discard" });
    openTab("design");
  },
});
globalThis.__ak_gameplayView = gameplayView;

// M4 — Unified Phaser game frame shell. Mounts one frame hosting the card builder
// and gameplay surfaces. The frame delegates gameplay-bundle loading to the existing
// __ak_loadGameplayBundle path; the legacy DOM panels remain as the compatibility
// renderer during the transition.
const _startupResourceBundle = createDefaultResourceBundleArtifact({
  createMeta: ({ producedBy, runId }) => ({
    id: `${producedBy}-${runId}`,
    runId,
    createdAt: new Date().toISOString(),
    producedBy,
  }),
  runId: "startup-default",
  producedBy: "ui-startup",
  emitVisualAssets: true,
});

// Used by the Cmd+Arrow keyboard shortcut below. "back" reuses the gameplay
// view's own transition logic (clears run state, resets the status rail)
// rather than a bare tab switch.
function navigateScreens(direction) {
  if (direction === "forward") {
    tabs?.setActive("gameplay");
  } else {
    gameplayView?.requestDesignTransition?.();
  }
}

if (document.querySelector("#phaser-frame-root")) {
  phaserFrame = createPhaserFrameView({
    root: document,
    onLoadGameplayBundle: (bundle) => globalThis.__ak_loadGameplayBundle(bundle),
    onInventorySelect: (card) => gameplayView?.selectEntityById?.(card.id) ?? null,
  });
  phaserFrame.mount();
  phaserFrame.setResourceBundle(_startupResourceBundle);
  globalThis.__ak_phaserFrame = phaserFrame;
}

// Cmd+Right (Mac) / Ctrl+Right (other platforms) → Gameplay, Cmd+Left / Ctrl+Left → Design.
// Keyboard events bypass Phaser's InputManager/hit-zone testing entirely, so this
// works reliably even when canvas-based nav buttons don't (destroy/recreate timing,
// camera-transform hit-testing, etc).
// Screen navigation lives on Cmd/Ctrl+brackets and Ctrl+digits so it can
// never collide with game-surface bindings: bare keys belong to the game
// (movement, actions), Cmd+arrows to tick playback, Cmd+[/] to screen
// back/forward, Ctrl+digit to direct screen jumps. Cmd+digit is off-limits —
// Chrome reserves it for browser-tab switching and pages cannot intercept it.
document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey) {
    if (event.key === "]") {
      event.preventDefault();
      navigateScreens("forward");
      return;
    }
    if (event.key === "[") {
      event.preventDefault();
      navigateScreens("back");
      return;
    }
  }
  if (event.ctrlKey && !event.metaKey) {
    if (event.key === "1") {
      event.preventDefault();
      tabs?.setActive("design");
    } else if (event.key === "2") {
      event.preventDefault();
      tabs?.setActive("gameplay");
    }
  }
});

// M8 — Sandbox bridge client
const AK_BRIDGE_PORT = Number(globalThis.__ak_sandboxBridgePort ?? 38487);
const sandboxBridge = connectSandboxBridge({ port: AK_BRIDGE_PORT });
globalThis.__ak_sandboxBridge = sandboxBridge;

diagnosticsView = wireDiagnosticsView({
  commandHost,
  onBundleLoaded: ({ bundle, source }) => {
    if (bundle && shouldHydrateDesignFromBundleSource(source)) {
      designView?.loadBuildSpec?.(bundle.spec, { source: `Diagnostics ${source}` });
    }
    void syncBundleViews({ bundle, source });

    if (gameplayRunPending && bundle) {
      gameplayRunPending = false;
      // If the user navigated away from Gameplay while this worker build was
      // in flight (e.g. pressed back to Design), don't force them back —
      // that's the "back button just blinks" bug. A stale completion is a no-op;
      // re-entering Gameplay later triggers a fresh, current build.
      if (tabGeneration === pendingGameplayGeneration) {
        loadGameplayBundle(bundle);
        openTab("gameplay");
      }
    }
  },
  onBundleStateReset: () => {
    gameplayRunPending = false;
    currentRunId = "";
    updateStatusRail({ runId: "" });
    void syncBundleViews({ bundle: null, source: "clear" });
  },
});

designView = wireDesignView({
  commandHost,
  onSendBuildSpec: ({ specText, source, resetBuildOutput }) =>
    diagnosticsView.setBuildSpecText(specText, { source, resetOutput: resetBuildOutput }),
  // Clear the run ID and any active gameplay run when the user manually clicks
  // Auto-generate — the previous run is stale.  Clearing the gameplay view also
  // resets isRunActive() so the next Gameplay tab switch triggers a fresh launch.
  // This fires only from the button, NOT from launchGameplayRun (which calls
  // autoGenerateCards() programmatically, bypassing this callback).
  onAutoGenerate: () => {
    currentRunId = "";
    updateStatusRail({ runId: "" });
    gameplayView?.clear?.("Design changed — re-generating…");
  },
  onLlmCapture: null,
  // Bump the sequence counter so this live design-ledger update always wins
  // over any in-flight stale syncBundleViews call (Issue #3).
  onStatusUpdate: (data) => updateStatusRail({ ...data, runId: currentRunId, _seq: ++statusRailSeq }),
});

globalThis.addEventListener?.("beforeunload", () => {
  previewView?.dispose?.();
  gameplayView?.dispose?.();
  commandHost.dispose?.();
});

// Initialize all views with the startup visual bundle so icons are visible before the first build.
designView?.setResourceBundle?.(_startupResourceBundle);
populateUIIcons(_startupResourceBundle);
