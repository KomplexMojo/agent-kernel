import { createBuildBridgeAdapter } from "../../adapters-web/src/adapters/build-bridge/index.js";
import { validateBuildSpec } from "../../runtime/src/contracts/build-spec.js";

const EMPTY_OUTPUT = "No build output yet.";
const DEFAULT_BRIDGE_URL = "/bridge/build";
const STORAGE_KEYS = Object.freeze({
  session: "ak.build.last.session",
  local: "ak.build.last",
});

function valueOf(el, fallback = "") {
  if (!el) return fallback;
  const trimmed = typeof el.value === "string" ? el.value.trim() : "";
  return trimmed || fallback;
}

function setStatus(el, message) {
  if (!el) return;
  el.textContent = message;
}

function setOutput(el, payload) {
  if (!el) return;
  if (payload === null || payload === undefined || payload === "") {
    el.textContent = EMPTY_OUTPUT;
    return;
  }
  if (typeof payload === "string") {
    el.textContent = payload;
    return;
  }
  el.textContent = JSON.stringify(payload, null, 2);
}

function deriveOutDir(spec) {
  const runId = spec?.meta?.runId;
  if (!runId) return "";
  return `artifacts/runs/${runId}/build`;
}

function storageFor(kind) {
  const storage = kind === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  if (!storage) return null;
  try {
    const probeKey = "__ak_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch (error) {
    return null;
  }
}

function readSnapshot(storage, key) {
  if (!storage) return null;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    storage.removeItem(key);
    return null;
  }
}

function writeSnapshot(storage, key, snapshot) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    return false;
  }
}

function extractRunId({ response, specJson }) {
  return (
    response?.manifest?.correlation?.runId ||
    response?.bundle?.spec?.meta?.runId ||
    response?.telemetry?.runId ||
    response?.telemetry?.meta?.runId ||
    response?.spec?.meta?.runId ||
    specJson?.meta?.runId ||
    ""
  );
}

function extractSpecPath({ response, specPath }) {
  return response?.manifest?.specPath || specPath || "";
}

export function wireBuildOrchestrator({
  elements,
  adapterFactory = createBuildBridgeAdapter,
  onBuildComplete,
} = {}) {
  const {
    bridgeUrlInput,
    specPathInput,
    specJsonInput,
    outDirInput,
    buildButton,
    loadButton,
    sendBundleButton,
    downloadButton,
    clearButton,
    statusEl,
    outputEl,
    validationList,
  } = elements;

  const state = {
    lastSpecText: "",
    downloadReady: false,
    lastSnapshot: null,
    validation: { ok: true, errors: [], spec: null, specText: "" },
    running: false,
  };

  const sessionStorage = storageFor("session");
  const localStorage = storageFor("local");

  function setDownloadVisible(visible) {
    if (!downloadButton) return;
    state.downloadReady = visible;
    downloadButton.hidden = !visible;
    downloadButton.disabled = !visible;
  }

  function setLoadAvailable(available) {
    if (loadButton) {
      loadButton.disabled = !available;
    }
    if (sendBundleButton) sendBundleButton.disabled = !available;
  }

  function renderValidation(errors) {
    if (!validationList) return;
    if (!errors || errors.length === 0) {
      validationList.hidden = true;
      validationList.textContent = "";
      return;
    }
    validationList.hidden = false;
    validationList.textContent = "";
    errors.forEach((message) => {
      const item = document.createElement("li");
      item.dataset.level = "warn";
      item.textContent = message;
      validationList.appendChild(item);
    });
  }

  function updateSpecState(text, parsed) {
    state.lastSpecText = parsed?.ok ? text : "";
  }

  function indexToLineColumn(text, index) {
    let line = 1;
    let column = 1;
    for (let i = 0; i < index && i < text.length; i += 1) {
      if (text[i] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    return { line, column };
  }

  function parseJsonWithDetails(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (error) {
      const message = error?.message || String(error);
      const match = message.match(/position\s+(\d+)/i);
      let line = null;
      let column = null;
      if (match) {
        const index = Number(match[1]);
        if (Number.isFinite(index)) {
          const pos = indexToLineColumn(text, index);
          line = pos.line;
          column = pos.column;
        }
      }
      return { ok: false, error, line, column };
    }
  }

  function validateSpecInput({ notifyStatus = false } = {}) {
    const specText = valueOf(specJsonInput);
    const specPath = valueOf(specPathInput);
    const errors = [];
    let spec = null;

    if (specText && specPath) {
      errors.push("Provide either Spec Path or Spec JSON, not both.");
    }

    if (specText) {
      const parsed = parseJsonWithDetails(specText);
      if (!parsed.ok) {
        const detail = parsed.line && parsed.column
          ? `Parse error at line ${parsed.line}, column ${parsed.column}`
          : "Parse error";
        errors.push(`${detail}: ${parsed.error?.message || "Invalid JSON"}`);
      } else {
        spec = parsed.value;
        const validation = validateBuildSpec(spec);
        if (!validation.ok) {
          errors.push(...validation.errors);
        }
      }
    }

    const ok = errors.length === 0;
    state.validation = { ok, errors, spec, specText };
    renderValidation(errors);
    if (notifyStatus && specText && !ok) {
      setStatus(statusEl, "BuildSpec invalid. Fix errors before building.");
    }
    updateBuildAvailability();
    return state.validation;
  }

  function updateBuildAvailability() {
    if (!buildButton) return;
    const specText = valueOf(specJsonInput);
    const specPath = valueOf(specPathInput);
    const hasSpec = Boolean(specText || specPath);
    const hasInvalidJson = specText && !state.validation.ok;
    buildButton.disabled = state.running || !hasSpec || hasInvalidJson;
  }

  function persistSnapshot(snapshot) {
    state.lastSnapshot = snapshot;
    setLoadAvailable(true);
    writeSnapshot(sessionStorage, STORAGE_KEYS.session, snapshot);
    writeSnapshot(localStorage, STORAGE_KEYS.local, snapshot);
  }

  function applySnapshot(snapshot, { source = "session", auto = false } = {}) {
    if (!snapshot) return false;
    state.lastSnapshot = snapshot;
    setOutput(outputEl, snapshot.response || snapshot);
    if (specPathInput && snapshot.specPath) {
      specPathInput.value = snapshot.specPath;
    }
    if (outDirInput && snapshot.outDir) {
      outDirInput.value = snapshot.outDir;
    }
    const runId = snapshot.runId ? `runId ${snapshot.runId}` : "last build";
    const prefix = auto ? "Auto-loaded" : "Loaded";
    setStatus(statusEl, `${prefix} ${runId} from ${source}.`);
    setLoadAvailable(true);
    if (typeof onBuildComplete === "function") {
      onBuildComplete({ snapshot, source, auto });
    }
    return true;
  }

  function loadLastBuild() {
    if (state.lastSnapshot) {
      applySnapshot(state.lastSnapshot, { source: "memory" });
      return;
    }
    const sessionSnapshot = readSnapshot(sessionStorage, STORAGE_KEYS.session);
    if (sessionSnapshot) {
      applySnapshot(sessionSnapshot, { source: "session" });
      return;
    }
    const localSnapshot = readSnapshot(localStorage, STORAGE_KEYS.local);
    if (localSnapshot) {
      applySnapshot(localSnapshot, { source: "local storage" });
      return;
    }
    setStatus(statusEl, "No saved builds found.");
  }

  function reset() {
    if (specPathInput) specPathInput.value = "";
    if (specJsonInput) specJsonInput.value = "";
    if (outDirInput) outDirInput.value = "";
    setOutput(outputEl, "");
    setStatus(statusEl, "Cleared.");
    setDownloadVisible(false);
    state.lastSpecText = "";
    state.running = false;
    setLoadAvailable(Boolean(state.lastSnapshot || readSnapshot(localStorage, STORAGE_KEYS.local)));
    state.validation = { ok: true, errors: [], spec: null, specText: "" };
    renderValidation([]);
    updateBuildAvailability();
  }

  function triggerDownload() {
    if (!state.lastSpecText) return;
    const blob = new Blob([state.lastSpecText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spec.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function runBuild() {
    setDownloadVisible(false);
    const specPath = valueOf(specPathInput);
    const specText = valueOf(specJsonInput);
    const bridgeUrl = valueOf(bridgeUrlInput, DEFAULT_BRIDGE_URL);
    const requestedOutDir = valueOf(outDirInput);

    const validation = validateSpecInput({ notifyStatus: true });
    if (specText && !validation.ok) {
      return;
    }

    if (!specPath && !specText) {
      setOutput(outputEl, { error: "Provide a spec path or spec JSON." });
      setStatus(statusEl, "Waiting for a build spec.");
      return;
    }
    if (specPath && specText) {
      setStatus(statusEl, "Choose spec path or spec JSON, not both.");
      return;
    }

    let specJson = null;
    let outDir = requestedOutDir;
    if (!specPath && specText) {
      updateSpecState(specText, { ok: validation.ok });
      specJson = validation.spec;
      if (!outDir) {
        outDir = deriveOutDir(specJson);
      }
    } else {
      state.lastSpecText = "";
    }

    setStatus(statusEl, "Submitting build request...");
    setOutput(outputEl, "");
    state.running = true;
    updateBuildAvailability();

    try {
      const adapter = adapterFactory({ baseUrl: bridgeUrl });
      const response = await adapter.build({ specPath: specPath || undefined, specJson: specJson || undefined, outDir: outDir || undefined });
      const snapshot = {
        runId: extractRunId({ response, specJson }),
        specPath: extractSpecPath({ response, specPath }),
        outDir: outDir || "",
        savedAt: new Date().toISOString(),
        response,
      };
      persistSnapshot(snapshot);
      setOutput(outputEl, response);
      setStatus(statusEl, "Build complete.");
      if (typeof onBuildComplete === "function") {
        onBuildComplete({ snapshot, source: "build", auto: false });
      }
    } catch (error) {
      setOutput(outputEl, { error: error?.message || String(error) });
      setStatus(statusEl, "Build failed. Download spec.json to run build manually.");
      if (state.lastSpecText) {
        setDownloadVisible(true);
      }
    } finally {
      state.running = false;
      updateBuildAvailability();
    }
  }

  if (buildButton) {
    buildButton.addEventListener("click", runBuild);
  }
  if (loadButton) {
    loadButton.addEventListener("click", loadLastBuild);
  }
  if (downloadButton) {
    downloadButton.addEventListener("click", triggerDownload);
  }
  if (clearButton) {
    clearButton.addEventListener("click", reset);
  }
  if (specJsonInput) {
    specJsonInput.addEventListener("input", () => {
      validateSpecInput();
    });
    specJsonInput.addEventListener("change", () => {
      validateSpecInput({ notifyStatus: true });
    });
  }
  if (specPathInput) {
    specPathInput.addEventListener("input", () => {
      validateSpecInput();
    });
    specPathInput.addEventListener("change", () => {
      validateSpecInput({ notifyStatus: true });
    });
  }

  setOutput(outputEl, "");
  setStatus(statusEl, "Bridge idle.");
  setDownloadVisible(false);
  updateBuildAvailability();
  const sessionSnapshot = readSnapshot(sessionStorage, STORAGE_KEYS.session);
  if (sessionSnapshot) {
    applySnapshot(sessionSnapshot, { source: "session", auto: true });
  } else {
    const localSnapshot = readSnapshot(localStorage, STORAGE_KEYS.local);
    setLoadAvailable(Boolean(localSnapshot));
    if (localSnapshot) {
      setStatus(statusEl, "Bridge idle. Last build available.");
    }
  }

  return { runBuild, loadLastBuild, reset };
}
