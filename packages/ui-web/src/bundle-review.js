import { validateBuildSpec } from "../../runtime/src/contracts/build-spec.js";

const EMPTY_TEXT = "No JSON output yet.";
const STORAGE_KEYS = Object.freeze({
  session: "ak.build.last.session",
  local: "ak.build.last",
});

function setStatus(el, message) {
  if (!el) return;
  el.textContent = message;
}

function setOutput(el, payload) {
  if (!el) return;
  if (payload === null || payload === undefined) {
    el.textContent = EMPTY_TEXT;
    return;
  }
  if (typeof payload === "string") {
    el.textContent = payload;
    return;
  }
  el.textContent = JSON.stringify(payload, null, 2);
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

function renderList(listEl, items) {
  if (!listEl) return;
  if (!items || items.length === 0) {
    listEl.hidden = true;
    listEl.textContent = "";
    return;
  }
  listEl.hidden = false;
  listEl.textContent = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    listEl.appendChild(li);
  });
}

function renderArtifacts(container, artifacts) {
  if (!container) return;
  container.textContent = "";
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    container.textContent = "No artifacts loaded.";
    return;
  }
  artifacts.forEach((artifact) => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const metaId = artifact?.meta?.id ? ` · ${artifact.meta.id}` : "";
    summary.textContent = `${artifact?.schema || "artifact"}${metaId}`;
    const body = document.createElement("pre");
    body.className = "adapter-output";
    body.textContent = JSON.stringify(artifact, null, 2);
    details.appendChild(summary);
    details.appendChild(body);
    container.appendChild(details);
  });
}

export function wireBundleReview({
  elements = {},
  onSpec,
  onRun,
} = {}) {
  const {
    bundleInput,
    manifestInput,
    loadLastButton,
    runButton,
    clearButton,
    statusEl,
    schemaList,
    manifestOutput,
    specTextarea,
    specErrors,
    applySpecButton,
    sendSpecButton,
    downloadSpecButton,
    intentOutput,
    planOutput,
    configuratorOutput,
    artifactsContainer,
  } = elements;

  const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
  const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

  const sessionStorage = storageFor("session");
  const localStorage = storageFor("local");

  const state = {
    bundle: null,
    manifest: null,
    specText: "",
    spec: null,
    validation: { ok: true, errors: [] },
  };

  function renderSchemas() {
    const schemas = state.bundle?.schemas || state.manifest?.schemas || [];
    const lines = schemas.map((entry) => `${entry.schema} v${entry.schemaVersion}`);
    renderList(schemaList, lines);
  }

  function renderSpecSections() {
    const spec = state.spec;
    setOutput(intentOutput, spec?.intent || null);
    setOutput(planOutput, spec?.plan || null);
    setOutput(configuratorOutput, spec?.configurator || null);
  }

  function renderBundle() {
    renderSchemas();
    setOutput(manifestOutput, state.manifest || null);
    renderSpecSections();
    renderArtifacts(artifactsContainer, state.bundle?.artifacts || []);
  }

  function renderSpecErrors(errors) {
    if (!specErrors) return;
    if (!errors || errors.length === 0) {
      specErrors.hidden = true;
      specErrors.textContent = "";
      return;
    }
    specErrors.hidden = false;
    specErrors.textContent = "";
    errors.forEach((message) => {
      const li = document.createElement("li");
      li.dataset.level = "warn";
      li.textContent = message;
      specErrors.appendChild(li);
    });
  }

  function validateSpecText(text, { notify = false } = {}) {
    if (!text) {
      state.validation = { ok: true, errors: [] };
      renderSpecErrors([]);
      return state.validation;
    }
    const parsed = parseJsonWithDetails(text);
    if (!parsed.ok) {
      const detail = parsed.line && parsed.column
        ? `Parse error at line ${parsed.line}, column ${parsed.column}`
        : "Parse error";
      const errors = [`${detail}: ${parsed.error?.message || "Invalid JSON"}`];
      state.validation = { ok: false, errors };
      renderSpecErrors(errors);
      if (notify) setStatus(statusEl, "Spec JSON invalid.");
      return state.validation;
    }
    const validation = validateBuildSpec(parsed.value);
    if (!validation.ok) {
      state.validation = { ok: false, errors: validation.errors };
      renderSpecErrors(validation.errors);
      if (notify) setStatus(statusEl, "BuildSpec validation failed.");
      return state.validation;
    }
    state.validation = { ok: true, errors: [] };
    renderSpecErrors([]);
    return { ok: true, errors: [], spec: parsed.value };
  }

  function updateSpecText(text, { notify = false } = {}) {
    state.specText = text;
    if (specTextarea) specTextarea.value = text;
    validateSpecText(text, { notify });
  }

  function applySpecEdits() {
    const text = specTextarea?.value || "";
    if (!text.trim()) {
      setStatus(statusEl, "Spec JSON is required.");
      return;
    }
    const result = validateSpecText(text, { notify: true });
    if (!result.ok) return;
    const parsed = JSON.parse(text);
    state.spec = parsed;
    if (state.bundle) {
      state.bundle.spec = parsed;
    }
    setStatus(statusEl, "Spec updated.");
    renderSpecSections();
  }

  function sendSpecToBuild() {
    if (!specTextarea) return;
    const text = specTextarea.value || "";
    if (!text.trim()) {
      setStatus(statusEl, "Spec JSON is required.");
      return;
    }
    const result = validateSpecText(text, { notify: true });
    if (!result.ok) return;
    if (typeof onSpec === "function") {
      onSpec({ specText: text, spec: JSON.parse(text) });
    }
    setStatus(statusEl, "Spec sent to build panel.");
  }

  function findArtifact(schema) {
    const artifacts = state.bundle?.artifacts || [];
    return artifacts.find((artifact) => artifact?.schema === schema) || null;
  }

  function runFromBundle() {
    if (!state.bundle) {
      setStatus(statusEl, "Load a bundle.json to run the simulation.");
      return;
    }
    const simConfig = findArtifact(SIM_CONFIG_SCHEMA);
    const initialState = findArtifact(INITIAL_STATE_SCHEMA);
    if (!simConfig || !initialState) {
      setStatus(statusEl, "Bundle missing SimConfigArtifact or InitialStateArtifact.");
      return;
    }
    if (typeof onRun === "function") {
      onRun({ simConfig, initialState });
    }
    setStatus(statusEl, "Loaded artifacts into Runtime controls.");
  }

  function downloadSpec() {
    if (!specTextarea) return;
    const text = specTextarea.value || "";
    if (!text) return;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "spec.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function clear() {
    state.bundle = null;
    state.manifest = null;
    state.specText = "";
    state.spec = null;
    state.validation = { ok: true, errors: [] };
    if (bundleInput) bundleInput.value = "";
    if (manifestInput) manifestInput.value = "";
    if (specTextarea) specTextarea.value = "";
    renderSpecErrors([]);
    renderSchemas();
    renderBundle();
    setStatus(statusEl, "Cleared.");
  }

  async function loadBundleFile(file) {
    const text = await file.text();
    const parsed = parseJsonWithDetails(text);
    if (!parsed.ok) {
      const detail = parsed.line && parsed.column
        ? `Bundle parse error at line ${parsed.line}, column ${parsed.column}`
        : "Bundle parse error";
      setStatus(statusEl, `${detail}: ${parsed.error?.message || "Invalid JSON"}`);
      return;
    }
    state.bundle = parsed.value;
    state.spec = parsed.value?.spec || null;
    const specText = state.spec ? JSON.stringify(state.spec, null, 2) : "";
    updateSpecText(specText);
    renderBundle();
    setStatus(statusEl, "Bundle loaded.");
  }

  async function loadManifestFile(file) {
    const text = await file.text();
    const parsed = parseJsonWithDetails(text);
    if (!parsed.ok) {
      const detail = parsed.line && parsed.column
        ? `Manifest parse error at line ${parsed.line}, column ${parsed.column}`
        : "Manifest parse error";
      setStatus(statusEl, `${detail}: ${parsed.error?.message || "Invalid JSON"}`);
      return;
    }
    state.manifest = parsed.value;
    renderBundle();
    setStatus(statusEl, "Manifest loaded.");
  }

  function loadFromSnapshot(snapshot) {
    const response = snapshot?.response;
    if (!response) {
      setStatus(statusEl, "No bundle data in last build.");
      return;
    }
    if (response.bundle) {
      state.bundle = response.bundle;
      state.spec = response.bundle?.spec || null;
      const specText = state.spec ? JSON.stringify(state.spec, null, 2) : "";
      updateSpecText(specText);
    }
    if (response.manifest) {
      state.manifest = response.manifest;
    }
    renderBundle();
    if (response.bundle) {
      setStatus(statusEl, "Loaded bundle from last build.");
    } else if (response.manifest) {
      setStatus(statusEl, "Loaded manifest from last build.");
    } else {
      setStatus(statusEl, "Last build did not include bundle data.");
    }
  }

  function loadLastBuild() {
    const sessionSnapshot = readSnapshot(sessionStorage, STORAGE_KEYS.session);
    if (sessionSnapshot) {
      loadFromSnapshot(sessionSnapshot);
      return;
    }
    const localSnapshot = readSnapshot(localStorage, STORAGE_KEYS.local);
    if (localSnapshot) {
      loadFromSnapshot(localSnapshot);
      return;
    }
    setStatus(statusEl, "No saved builds found.");
  }

  bundleInput?.addEventListener("change", () => {
    const file = bundleInput.files?.[0];
    if (file) {
      loadBundleFile(file);
    }
  });

  manifestInput?.addEventListener("change", () => {
    const file = manifestInput.files?.[0];
    if (file) {
      loadManifestFile(file);
    }
  });

  specTextarea?.addEventListener("input", () => {
    validateSpecText(specTextarea.value || "");
  });
  specTextarea?.addEventListener("change", () => {
    validateSpecText(specTextarea.value || "", { notify: true });
  });

  applySpecButton?.addEventListener("click", applySpecEdits);
  sendSpecButton?.addEventListener("click", sendSpecToBuild);
  downloadSpecButton?.addEventListener("click", downloadSpec);
  loadLastButton?.addEventListener("click", loadLastBuild);
  runButton?.addEventListener("click", runFromBundle);
  clearButton?.addEventListener("click", clear);

  setStatus(statusEl, "No bundle loaded.");
  renderBundle();
  renderSpecErrors([]);

  const sessionSnapshot = readSnapshot(sessionStorage, STORAGE_KEYS.session);
  if (sessionSnapshot?.response?.bundle) {
    loadFromSnapshot(sessionSnapshot);
  }

  return { loadLastBuild, clear, applySpecEdits };
}
