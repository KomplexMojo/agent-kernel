import { loadCore } from "../../bindings-ts/src/core-as.js";
import { createRuntime } from "../../runtime/src/runner/runtime.js";
import { createDomLogAdapter } from "../../adapters-web/src/adapters/dom-log.js";

const counterEl = document.querySelector("#counter-value");
const logEl = document.querySelector("#effect-log");
const statusEl = document.querySelector("#status-message");
const stepButton = document.querySelector("#step-button");
const runButton = document.querySelector("#run-button");
const resetButton = document.querySelector("#reset-button");

function setStatus(message) {
  statusEl.textContent = message;
}

function setControlsEnabled(enabled) {
  stepButton.disabled = !enabled;
  runButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

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
