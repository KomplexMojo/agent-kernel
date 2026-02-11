import { runIpfsDemo, runBlockchainDemo, runLlmDemo, runSolverDemo } from "./adapter-playground.js";
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from "../../runtime/src/contracts/domain-constants.js";

function valueOf(el, fallback = "") {
  if (!el) return fallback;
  const trimmed = typeof el.value === "string" ? el.value.trim() : "";
  return trimmed || fallback;
}

export function wireAdapterPanel({
  elements,
  helpers = { runIpfsDemo, runBlockchainDemo, runLlmDemo, runSolverDemo },
} = {}) {
  const emptyOutput = "No JSON output yet.";
  const {
    modeSelect,
    gatewayInput,
    rpcInput,
    llmInput,
    addressInput,
    cidInput,
    ipfsPathInput,
    promptInput,
    outputEl,
    statusEl,
    clearButton,
    ipfsButton,
    blockchainButton,
    llmButton,
    solverButton,
  } = elements;

  const fixtures = elements?.fixtures || {};
  const buttons = [ipfsButton, blockchainButton, llmButton, solverButton];
  if (llmInput && (!llmInput.value || !llmInput.value.trim())) {
    llmInput.value = DEFAULT_LLM_BASE_URL;
  }

  function setStatus(message) {
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  function setOutput(data) {
    if (!outputEl) return;
    if (data === null || data === undefined || data === "") {
      outputEl.textContent = emptyOutput;
      return;
    }
    if (typeof data === "string") {
      outputEl.textContent = data;
      return;
    }
    outputEl.textContent = JSON.stringify(data, null, 2);
  }

  function setDisabled(disabled) {
    buttons.forEach((btn) => {
      if (btn) btn.disabled = disabled;
    });
  }

  function currentMode() {
    return modeSelect?.value === "live" ? "live" : "fixture";
  }

  async function run(kind, fn) {
    setStatus(`Running ${kind}...`);
    setDisabled(true);
    try {
      const data = await fn();
      setOutput(data);
      setStatus(`${kind} complete`);
    } catch (error) {
      setOutput({ error: error?.message || String(error) });
      setStatus(`Error: ${error?.message || error}`);
    } finally {
      setDisabled(false);
    }
  }

  ipfsButton?.addEventListener("click", () =>
    run("IPFS", () =>
      helpers.runIpfsDemo({
        mode: currentMode(),
        gatewayUrl: valueOf(gatewayInput, "https://ipfs.io/ipfs"),
        cid: valueOf(cidInput, "fixture"),
        path: valueOf(ipfsPathInput, ""),
        fixtureText: fixtures.ipfsText,
      }),
    ),
  );

  blockchainButton?.addEventListener("click", () =>
    run("Blockchain", () =>
      helpers.runBlockchainDemo({
        mode: currentMode(),
        rpcUrl: valueOf(rpcInput, "http://fixture"),
        address: valueOf(addressInput, "0xabc"),
        fixtureChain: fixtures.blockchainChain,
        fixtureBalance: fixtures.blockchainBalance,
      }),
    ),
  );

  llmButton?.addEventListener("click", () =>
    run("LLM", () =>
      helpers.runLlmDemo({
        mode: currentMode(),
        baseUrl: valueOf(llmInput, DEFAULT_LLM_BASE_URL),
        model: DEFAULT_LLM_MODEL,
        prompt: valueOf(promptInput, "hello"),
        fixtureResponse: fixtures.llmResponse,
      }),
    ),
  );

  solverButton?.addEventListener("click", () =>
    run("Solver", () =>
      helpers.runSolverDemo({
        mode: currentMode(),
        fixtureResult: fixtures.solverResult,
      }),
    ),
  );

  clearButton?.addEventListener("click", () => {
    setOutput("");
    setStatus("Cleared");
  });

  return { run, currentMode };
}
