import { loadCore } from "../../bindings-ts/src/core-as.js";
import { createRuntime } from "../../runtime/src/runner/runtime.js";
import { createDomLogAdapter } from "../../adapters-web/src/adapters/dom-log.js";
import { wireAdapterPanel } from "./adapter-panel.js";

const counterEl = document.querySelector("#counter-value");
const logEl = document.querySelector("#effect-log");
const statusEl = document.querySelector("#status-message");
const stepButton = document.querySelector("#step-button");
const runButton = document.querySelector("#run-button");
const resetButton = document.querySelector("#reset-button");
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

function setStatus(message) {
  statusEl.textContent = message;
}

function setControlsEnabled(enabled) {
  stepButton.disabled = !enabled;
  runButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

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

async function boot() {
  setControlsEnabled(false);
  try {
    const wasmUrl = new URL("../assets/core-as.wasm", import.meta.url);
    const core = await loadCore({ wasmUrl });
    const adapters = createDomLogAdapter({ listEl: logEl, statusEl: counterEl });
    const runtime = createRuntime({ core, adapters });

    runtime.init(0);
    counterEl.textContent = String(runtime.getState().counter);
    setStatus("Ready.");
    setControlsEnabled(true);

    stepButton.addEventListener("click", () => {
      counterEl.textContent = String(runtime.step());
    });

    runButton.addEventListener("click", () => {
      for (let i = 0; i < 10; i += 1) {
        runtime.step();
      }
      counterEl.textContent = String(runtime.getState().counter);
    });

    resetButton.addEventListener("click", () => {
      runtime.init(0);
      counterEl.textContent = String(runtime.getState().counter);
      logEl.innerHTML = "";
    });
  } catch (error) {
    setStatus(`Failed to load: ${error.message}`);
  }
}

boot();
