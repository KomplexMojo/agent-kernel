import { loadCore } from "../../bindings-ts/src/core-as.js";
import { runMvpMovement } from "../../runtime/src/mvp/movement.js";
import { setupPlayback } from "./movement-ui.js";
import { wireAdapterPanel } from "./adapter-panel.js";
import { wireRunBuilder } from "./run-builder.js";

const frameEl = document.querySelector("#frame-buffer");
const actorIdEl = document.querySelector("#actor-id");
const actorPosEl = document.querySelector("#actor-pos");
const actorHpEl = document.querySelector("#actor-hp");
const actorListEl = document.querySelector("#actor-list");
const tileActorListEl = document.querySelector("#tile-actor-list");
const tileActorCountEl = document.querySelector("#tile-actor-count");
const trapSectionEl = document.querySelector("#trap-section");
const trapListEl = document.querySelector("#trap-list");
const trapCountEl = document.querySelector("#trap-count");
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

const ACTOR_ID_LABEL = "actor_mvp";
const ACTOR_ID_VALUE = 1;
let core = null;
let actions = [];
let controller = null;

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
            tileActorList: tileActorListEl,
            tileActorCount: tileActorCountEl,
            trapSection: trapSectionEl,
            trapList: trapListEl,
            trapCount: trapCountEl,
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
