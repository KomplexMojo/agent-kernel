import { loadCore } from "../../bindings-ts/src/core-as.js";
import { runMvpMovement } from "../../runtime/src/mvp/movement.js";
import { initializeCoreFromArtifacts } from "../../runtime/src/runner/core-setup.mjs";
import { setupPlayback } from "./movement-ui.js";
import { wireAdapterPanel } from "./adapter-panel.js";
import { wireRunBuilder } from "./run-builder.js";
import { wireBuildOrchestrator } from "./build-orchestrator.js";
import { wireOllamaPromptPanel } from "./ollama-panel.js";
import { wireBundleReview } from "./bundle-review.js";
import { wireTabs } from "./tabs.js";
import { wireAffinityLegend } from "./affinity-legend.js";
import { wireBudgetPanels } from "./budget-panels.js";
import { setupPoolFlow } from "./pool-flow.js";

const frameEl = document.querySelector("#frame-buffer");
const actorIdEl = document.querySelector("#actor-id-display");
const actorPosEl = document.querySelector("#actor-pos");
const actorHpEl = document.querySelector("#actor-hp");
const actorListEl = document.querySelector("#actor-list");
const affinityListEl = document.querySelector("#affinity-list");
const affinityLegendToggle = document.querySelector("#affinity-legend-toggle");
const affinityLegendPanel = document.querySelector("#affinity-legend");
const affinityLegendKinds = document.querySelector("#legend-kinds");
const affinityLegendExpressions = document.querySelector("#legend-expressions");
const tileActorListEl = document.querySelector("#tile-actor-list");
const tileActorCountEl = document.querySelector("#tile-actor-count");
const trapListEl = document.querySelector("#trap-list");
const trapTabCountEl = document.querySelector("#trap-tab-count");
const baseTilesEl = document.querySelector("#base-tiles");
const tickEl = document.querySelector("#tick-indicator");
const statusEl = document.querySelector("#status-message");
const stepBackButton = document.querySelector("#step-back");
const stepForwardButton = document.querySelector("#step-forward");
const playPauseButton = document.querySelector("#play-pause");
const resetRunButton = document.querySelector("#reset-run");
const adapterMode = document.querySelector("#adapter-mode");
const adapterGateway = document.querySelector("#adapter-gateway");
const adapterRpc = document.querySelector("#adapter-rpc-url");
const adapterAddress = document.querySelector("#adapter-address");
const adapterPrompt = document.querySelector("#adapter-prompt");
const adapterLlm = document.querySelector("#adapter-llm-url");
const adapterCid = document.querySelector("#adapter-cid");
const adapterPath = document.querySelector("#adapter-path");
const adapterOutput = document.querySelector("#adapter-output");
const adapterStatus = document.querySelector("#adapter-status");
const adapterClear = document.querySelector("#adapter-clear");
const adapterIpfs = document.querySelector("#adapter-ipfs");
const adapterBlockchain = document.querySelector("#adapter-blockchain");
const adapterLlmButton = document.querySelector("#adapter-llm");
const adapterSolver = document.querySelector("#adapter-solver");
const ollamaMode = document.querySelector("#ollama-mode");
const ollamaModel = document.querySelector("#ollama-model");
const ollamaBaseUrl = document.querySelector("#ollama-base-url");
const ollamaPrompt = document.querySelector("#ollama-prompt");
const ollamaOptions = document.querySelector("#ollama-options");
const ollamaRun = document.querySelector("#ollama-run");
const ollamaClear = document.querySelector("#ollama-clear");
const ollamaDownload = document.querySelector("#ollama-download");
const ollamaDownloadPrompt = document.querySelector("#ollama-download-prompt");
const ollamaStatus = document.querySelector("#ollama-status");
const ollamaOutput = document.querySelector("#ollama-output");
const buildBridgeUrl = document.querySelector("#build-bridge-url");
const buildSpecPath = document.querySelector("#build-spec-path");
const buildSpecJson = document.querySelector("#build-spec-json");
const buildOutDir = document.querySelector("#build-out-dir");
const buildRunButton = document.querySelector("#build-run");
const buildLoadButton = document.querySelector("#build-load");
const buildDownloadButton = document.querySelector("#build-download");
const buildClearButton = document.querySelector("#build-clear");
const buildStatus = document.querySelector("#build-status");
const buildOutput = document.querySelector("#build-output");
const buildValidation = document.querySelector("#build-validation");
const bundleInput = document.querySelector("#bundle-file");
const bundleManifestInput = document.querySelector("#bundle-manifest-file");
const bundleLoadLast = document.querySelector("#bundle-load-last");
const bundleClear = document.querySelector("#bundle-clear");
const bundleStatus = document.querySelector("#bundle-status");
const bundleSchemas = document.querySelector("#bundle-schemas");
const bundleManifest = document.querySelector("#bundle-manifest");
const bundleSpecEdit = document.querySelector("#bundle-spec-edit");
const bundleSpecErrors = document.querySelector("#bundle-spec-errors");
const bundleApplySpec = document.querySelector("#bundle-apply-spec");
const bundleSendSpec = document.querySelector("#bundle-send-spec");
const bundleDownloadSpec = document.querySelector("#bundle-download-spec");
const bundleRunRuntime = document.querySelector("#bundle-run-runtime");
const bundleIntent = document.querySelector("#bundle-intent");
const bundlePlan = document.querySelector("#bundle-plan");
const bundleConfigurator = document.querySelector("#bundle-configurator");
const bundleArtifacts = document.querySelector("#bundle-artifacts");
const seedInput = document.querySelector("#seed-input");
const mapSelect = document.querySelector("#map-select");
const actorNameInput = document.querySelector("#actor-name");
const actorIdInput = document.querySelector("#actor-id");
const fixtureSelect = document.querySelector("#fixture-select");
const badgeSeed = document.querySelector("#badge-seed");
const badgeName = document.querySelector("#badge-name");
const badgeMode = document.querySelector("#badge-mode");
const startRunButton = document.querySelector("#start-run");
const resetConfigButton = document.querySelector("#reset-config");
const configPreview = document.querySelector("#config-preview");
const configBudgetJson = document.querySelector("#config-budget-json");
const configPriceListJson = document.querySelector("#config-price-list-json");
const configReceiptJson = document.querySelector("#config-receipt-json");
const allocatorBudgetJson = document.querySelector("#allocator-budget-json");
const allocatorPriceListJson = document.querySelector("#allocator-price-list-json");
const allocatorReceiptJson = document.querySelector("#allocator-receipt-json");
const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const vitalsInputs = {
  health: {
    current: document.querySelector("#vital-health-current"),
    max: document.querySelector("#vital-health-max"),
    regen: document.querySelector("#vital-health-regen"),
  },
  mana: {
    current: document.querySelector("#vital-mana-current"),
    max: document.querySelector("#vital-mana-max"),
    regen: document.querySelector("#vital-mana-regen"),
  },
  stamina: {
    current: document.querySelector("#vital-stamina-current"),
    max: document.querySelector("#vital-stamina-max"),
    regen: document.querySelector("#vital-stamina-regen"),
  },
  durability: {
    current: document.querySelector("#vital-durability-current"),
    max: document.querySelector("#vital-durability-max"),
    regen: document.querySelector("#vital-durability-regen"),
  },
};

wireAdapterPanel({
  elements: {
    modeSelect: adapterMode,
    gatewayInput: adapterGateway,
    rpcInput: adapterRpc,
    llmInput: adapterLlm,
    addressInput: adapterAddress,
    cidInput: adapterCid,
    ipfsPathInput: adapterPath,
    promptInput: adapterPrompt,
    outputEl: adapterOutput,
    statusEl: adapterStatus,
    clearButton: adapterClear,
    ipfsButton: adapterIpfs,
    blockchainButton: adapterBlockchain,
    llmButton: adapterLlmButton,
    solverButton: adapterSolver,
  },
});

wireOllamaPromptPanel({
  elements: {
    modeSelect: ollamaMode,
    modelInput: ollamaModel,
    baseUrlInput: ollamaBaseUrl,
    promptInput: ollamaPrompt,
    optionsInput: ollamaOptions,
    runButton: ollamaRun,
    clearButton: ollamaClear,
    downloadButton: ollamaDownload,
    downloadPromptButton: ollamaDownloadPrompt,
    statusEl: ollamaStatus,
    outputEl: ollamaOutput,
  },
  fixturePath: "/tests/fixtures/adapters/llm-build-spec.json",
  onValidSpec: ({ specText }) => {
    if (buildSpecJson) {
      buildSpecJson.value = specText;
      buildSpecJson.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (buildSpecPath) {
      buildSpecPath.value = "";
      buildSpecPath.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
});

wireBuildOrchestrator({
  elements: {
    bridgeUrlInput: buildBridgeUrl,
    specPathInput: buildSpecPath,
    specJsonInput: buildSpecJson,
    outDirInput: buildOutDir,
    buildButton: buildRunButton,
    loadButton: buildLoadButton,
    downloadButton: buildDownloadButton,
    clearButton: buildClearButton,
    statusEl: buildStatus,
    outputEl: buildOutput,
    validationList: buildValidation,
  },
});

wireBundleReview({
  elements: {
    bundleInput,
    manifestInput: bundleManifestInput,
    loadLastButton: bundleLoadLast,
    runButton: bundleRunRuntime,
    clearButton: bundleClear,
    statusEl: bundleStatus,
    schemaList: bundleSchemas,
    manifestOutput: bundleManifest,
    specTextarea: bundleSpecEdit,
    specErrors: bundleSpecErrors,
    applySpecButton: bundleApplySpec,
    sendSpecButton: bundleSendSpec,
    downloadSpecButton: bundleDownloadSpec,
    intentOutput: bundleIntent,
    planOutput: bundlePlan,
    configuratorOutput: bundleConfigurator,
    artifactsContainer: bundleArtifacts,
  },
  onSpec: ({ specText }) => {
    if (buildSpecJson) {
      buildSpecJson.value = specText;
      buildSpecJson.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (buildSpecPath) {
      buildSpecPath.value = "";
      buildSpecPath.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
  onRun: ({ simConfig, initialState }) => {
    if (typeof runFromBundle === "function") {
      runFromBundle({ simConfig, initialState });
    }
  },
});

wireTabs({ buttons: tabButtons, panels: tabPanels, defaultTab: "runtime" });
wireAffinityLegend({
  button: affinityLegendToggle,
  panel: affinityLegendPanel,
  kindsEl: affinityLegendKinds,
  expressionsEl: affinityLegendExpressions,
});
setupPoolFlow({
  loadFixtureBtn: document.querySelector("#pool-load-fixture"),
  summaryFileInput: document.querySelector("#pool-summary-file"),
  catalogFileInput: document.querySelector("#pool-catalog-file"),
  runBtn: document.querySelector("#pool-run"),
  statusEl: document.querySelector("#pool-status"),
  summaryOut: document.querySelector("#pool-summary-out"),
  selectionsOut: document.querySelector("#pool-selections-out"),
  receiptsOut: document.querySelector("#pool-receipts-out"),
  buildSpecOut: document.querySelector("#pool-buildspec-out"),
});

const budgetPanels = wireBudgetPanels({
  elements: {
    configBudget: configBudgetJson,
    configPriceList: configPriceListJson,
    configReceipt: configReceiptJson,
    allocatorBudget: allocatorBudgetJson,
    allocatorPriceList: allocatorPriceListJson,
    allocatorReceipt: allocatorReceiptJson,
  },
  mode: fixtureSelect?.value === "live" ? "live" : "fixture",
});
budgetPanels.refresh();

const ACTOR_ID_LABEL = "actor_mvp";
const ACTOR_ID_VALUE = 1;
let core = null;
let actions = [];
let controller = null;
let runFromBundle = null;

function setStatus(message) {
  statusEl.textContent = message;
}

async function boot() {
  stepBackButton.disabled = true;
  stepForwardButton.disabled = true;
  playPauseButton.disabled = true;
  resetRunButton.disabled = true;
  startRunButton.disabled = true;
  setStatus("Loading WASM...");
  try {
    const wasmUrl = new URL("../assets/core-as.wasm", import.meta.url);
    core = await loadCore({ wasmUrl });
    setStatus("Ready");

    function startRun(config) {
      try {
        controller?.pause?.();
        const movement = runMvpMovement({
          core,
          actorIdLabel: config.actorId || ACTOR_ID_LABEL,
          actorIdValue: ACTOR_ID_VALUE,
          seed: config.seed,
        });
        actions = movement.actions;
        controller = setupPlayback({
          core,
          actions,
          actorIdLabel: config.actorId || ACTOR_ID_LABEL,
          actorIdValue: ACTOR_ID_VALUE,
          elements: {
            frame: frameEl,
            actorId: actorIdEl,
            actorPos: actorPosEl,
            actorHp: actorHpEl,
            actorList: actorListEl,
            affinityList: affinityListEl,
            tileActorList: tileActorListEl,
            tileActorCount: tileActorCountEl,
            trapList: trapListEl,
            trapCount: trapTabCountEl,
            baseTiles: baseTilesEl,
            tick: tickEl,
            status: statusEl,
            playButton: playPauseButton,
            stepBack: stepBackButton,
            stepForward: stepForwardButton,
            reset: resetRunButton,
          },
        });
        setStatus("Ready");
      } catch (err) {
        setStatus(err.message || "Failed to start run");
        console.error(err);
      }
    }

    function startRunFromArtifacts({ simConfig, initialState }) {
      try {
        controller?.pause?.();
        const actorLabel = initialState?.actors?.[0]?.id || "actor_bundle";
        actions = [];
        controller = setupPlayback({
          core,
          actions,
          actorIdLabel: actorLabel,
          actorIdValue: ACTOR_ID_VALUE,
          elements: {
            frame: frameEl,
            actorId: actorIdEl,
            actorPos: actorPosEl,
            actorHp: actorHpEl,
            actorList: actorListEl,
            affinityList: affinityListEl,
            tileActorList: tileActorListEl,
            tileActorCount: tileActorCountEl,
            trapList: trapListEl,
            trapCount: trapTabCountEl,
            baseTiles: baseTilesEl,
            tick: tickEl,
            status: statusEl,
            playButton: playPauseButton,
            stepBack: stepBackButton,
            stepForward: stepForwardButton,
            reset: resetRunButton,
          },
          initCore: () => {
            const seed = Number.isFinite(simConfig?.seed) ? simConfig.seed : 0;
            core.init(seed);
            const { layout, actor } = initializeCoreFromArtifacts(core, { simConfig, initialState });
            if (!layout.ok) {
              throw new Error(`SimConfig invalid: ${layout.reason || "unknown"}`);
            }
            if (!actor.ok) {
              throw new Error(`InitialState invalid: ${actor.reason || "unknown"}`);
            }
          },
        });
        setStatus("Ready (bundle artifacts).");
      } catch (err) {
        setStatus(err.message || "Failed to start bundle run");
        console.error(err);
      }
    }

    const builder = wireRunBuilder({
      elements: {
        seedInput,
        mapSelect,
        actorNameInput,
        actorIdInput,
        fixtureSelect,
        seedBadge: badgeSeed,
        nameBadge: badgeName,
        modeBadge: badgeMode,
        startButton: startRunButton,
        resetButton: resetConfigButton,
        preview: configPreview,
        vitals: vitalsInputs,
      },
      onStart: (config) => {
        startRun(config);
      },
    });

    runFromBundle = startRunFromArtifacts;

    fixtureSelect?.addEventListener("change", () => {
      const mode = fixtureSelect?.value === "live" ? "live" : "fixture";
      budgetPanels.refresh(mode);
    });

    startRun(builder.getConfig());

    stepForwardButton.addEventListener("click", () => controller?.stepForward());
    stepBackButton.addEventListener("click", () => controller?.stepBack());
    playPauseButton.addEventListener("click", () => controller?.toggle());
    resetRunButton.addEventListener("click", () => controller?.reset());
  } catch (error) {
    setStatus(`Failed to load: ${error.message}`);
  }
}

boot();
