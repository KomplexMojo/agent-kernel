import { runLlmDemo, DEFAULT_FIXTURES } from "./adapter-playground.js";
import { validateBuildSpec } from "../../runtime/src/contracts/build-spec.js";
import { buildBuildSpecPrompt } from "./ollama-template.js";
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from "../../runtime/src/contracts/domain-constants.js";

const STORAGE_KEY = "ak.ollama.prompt";
const DEFAULT_STATE = Object.freeze({
  mode: "live",
  model: DEFAULT_LLM_MODEL,
  baseUrl: DEFAULT_LLM_BASE_URL,
  prompt: "",
  optionsText: "",
});

function valueOf(el, fallback = "") {
  if (!el) return fallback;
  const trimmed = typeof el.value === "string" ? el.value.trim() : "";
  return trimmed || fallback;
}

function setOutput(el, payload) {
  if (!el) return;
  if (!payload) {
    el.textContent = "No JSON output yet.";
    return;
  }
  if (typeof payload === "string") {
    el.textContent = payload;
    return;
  }
  el.textContent = JSON.stringify(payload, null, 2);
}

function setStatus(el, message) {
  if (!el) return;
  el.textContent = message;
}

function safeLocalStorage() {
  const storage = globalThis.localStorage;
  if (!storage) return null;
  try {
    storage.setItem("__ak_ollama_probe__", "1");
    storage.removeItem("__ak_ollama_probe__");
    return storage;
  } catch (error) {
    return null;
  }
}

function loadState(storage) {
  if (!storage) return { ...DEFAULT_STATE };
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    return { ...DEFAULT_STATE };
  }
}

function saveState(storage, state) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    return;
  }
}

function parseOptions(text) {
  if (!text) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

function modeValue(value) {
  return value === "fixture" ? "fixture" : "live";
}

function extractResponseText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.content === "string") return payload.content;
  return "";
}

function extractJsonCandidate(text) {
  if (!text) return "";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return text.trim();
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

function normalizeArrayField(container, key) {
  if (!container || typeof container !== "object") return { changed: false };
  const value = container[key];
  if (value === undefined) return { changed: false };
  if (Array.isArray(value)) return { changed: false };
  if (value && typeof value === "object") {
    container[key] = [value];
    return { changed: true };
  }
  return { changed: false };
}

function normalizeAgentHints(hints) {
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) return { changed: false };
  let changed = false;
  if (normalizeArrayField(hints, "rooms").changed) changed = true;
  if (normalizeArrayField(hints, "actors").changed) changed = true;
  if (normalizeArrayField(hints, "actorGroups").changed) changed = true;
  return { changed };
}

function normalizeArtifactRef(ref, schema) {
  if (ref === undefined || ref === null) return { value: ref, changed: false };
  if (typeof ref === "string" || typeof ref === "number") {
    return { value: { id: String(ref), schema, schemaVersion: 1 }, changed: true };
  }
  if (ref && typeof ref === "object" && !Array.isArray(ref)) {
    let changed = false;
    if (!ref.schema) {
      ref.schema = schema;
      changed = true;
    }
    if (!Number.isInteger(ref.schemaVersion)) {
      ref.schemaVersion = 1;
      changed = true;
    }
    return { value: ref, changed };
  }
  return { value: ref, changed: false };
}

function normalizeBuildSpec(spec) {
  if (!spec || typeof spec !== "object") return { spec, changed: false };
  let changed = false;

  if (spec.intent?.hints) {
    if (normalizeAgentHints(spec.intent.hints).changed) changed = true;
  }
  if (spec.configurator?.inputs) {
    if (normalizeAgentHints(spec.configurator.inputs).changed) changed = true;
  }

  if (spec.budget && typeof spec.budget === "object" && !Array.isArray(spec.budget)) {
    const budgetRef = normalizeArtifactRef(spec.budget.budgetRef, "agent-kernel/BudgetArtifact");
    if (budgetRef.changed) {
      spec.budget.budgetRef = budgetRef.value;
      changed = true;
    }
    const priceListRef = normalizeArtifactRef(spec.budget.priceListRef, "agent-kernel/PriceList");
    if (priceListRef.changed) {
      spec.budget.priceListRef = priceListRef.value;
      changed = true;
    }
  }

  return { spec, changed };
}

export function wireOllamaPromptPanel({
  elements,
  helpers = { runLlmDemo },
  fixturePath = DEFAULT_FIXTURES.llm,
  onValidSpec,
} = {}) {
  const {
    modeSelect,
    modelInput,
    baseUrlInput,
    promptInput,
    optionsInput,
    runButton,
    clearButton,
    downloadButton,
    downloadPromptButton,
    statusEl,
    outputEl,
  } = elements;

  const storage = safeLocalStorage();
  const state = loadState(storage);
  let lastRawResponse = "";
  let lastFullPrompt = "";

  function setDownloadAvailable(available) {
    if (!downloadButton) return;
    downloadButton.disabled = !available;
  }

  function setPromptDownloadAvailable(available) {
    if (!downloadPromptButton) return;
    downloadPromptButton.disabled = !available;
  }

  function triggerDownload() {
    if (!lastRawResponse) return;
    const blob = new Blob([lastRawResponse], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ollama-response.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function triggerPromptDownload() {
    if (!lastFullPrompt) return;
    const blob = new Blob([lastFullPrompt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ollama-prompt.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function applyState(next) {
    if (modeSelect && typeof modeSelect.addEventListener === "function") {
      modeSelect.value = modeValue(next.mode);
    } else if (modeSelect) {
      modeSelect.value = "live";
    }
    if (modelInput) modelInput.value = next.model || DEFAULT_STATE.model;
    if (baseUrlInput) baseUrlInput.value = next.baseUrl || DEFAULT_STATE.baseUrl;
    if (promptInput) promptInput.value = next.prompt || "";
    if (optionsInput) optionsInput.value = next.optionsText || "";
  }

  function collectState() {
    return {
      mode: modeSelect && typeof modeSelect.addEventListener === "function" ? modeValue(modeSelect.value) : "live",
      model: valueOf(modelInput, DEFAULT_STATE.model),
      baseUrl: valueOf(baseUrlInput, DEFAULT_STATE.baseUrl),
      prompt: valueOf(promptInput, ""),
      optionsText: valueOf(optionsInput, ""),
    };
  }

  function persist(next) {
    Object.assign(state, next);
    saveState(storage, state);
  }

  function updateStatus() {
    const mode = modeSelect && typeof modeSelect.addEventListener === "function" ? modeValue(modeSelect.value) : "live";
    const label = mode === "live" ? "Live mode ready." : "Fixture mode ready.";
    setStatus(statusEl, label);
  }

  async function runPrompt() {
    const next = collectState();
    persist(next);

    if (!next.prompt) {
      setOutput(outputEl, { error: "Prompt is required." });
      setStatus(statusEl, "Add a prompt to continue.");
      return;
    }
    if (!next.model) {
      setOutput(outputEl, { error: "Model is required." });
      setStatus(statusEl, "Add a model to continue.");
      return;
    }

    const optionsResult = parseOptions(next.optionsText);
    if (!optionsResult.ok) {
      setOutput(outputEl, { error: "Options must be valid JSON.", detail: optionsResult.error.message });
      setStatus(statusEl, "Fix the options JSON and try again.");
      return;
    }

    if (runButton) runButton.disabled = true;
    setStatus(statusEl, `Running ${next.mode} prompt...`);

    try {
      const prompt = buildBuildSpecPrompt({ userPrompt: next.prompt });
      lastFullPrompt = prompt;
      setPromptDownloadAvailable(Boolean(prompt));
      const response = await helpers.runLlmDemo({
        mode: next.mode,
        model: next.model,
        baseUrl: next.baseUrl,
        prompt,
        options: optionsResult.value,
        fixturePath,
      });
      const responseText = extractResponseText(response);
      lastRawResponse = responseText;
      setDownloadAvailable(Boolean(responseText));
      const candidate = extractJsonCandidate(responseText);
      if (!candidate) {
        setOutput(outputEl, { error: "No JSON response found.", detail: responseText || "Empty response." });
        setStatus(statusEl, "Prompt returned no JSON.");
        return;
      }
      const parsed = parseJsonWithDetails(candidate);
      if (!parsed.ok) {
        setOutput(outputEl, {
          error: "Failed to parse JSON response.",
          detail: parsed.error?.message || String(parsed.error),
          line: parsed.line ?? undefined,
          column: parsed.column ?? undefined,
        });
        setStatus(statusEl, "Fix JSON response and retry.");
        return;
      }
      const normalized = normalizeBuildSpec(parsed.value);
      const validation = validateBuildSpec(normalized.spec);
      if (!validation.ok) {
        setOutput(outputEl, { error: "BuildSpec validation failed.", errors: validation.errors });
        setStatus(statusEl, "BuildSpec validation failed.");
        return;
      }
      const specText = JSON.stringify(normalized.spec, null, 2);
      setOutput(outputEl, normalized.spec);
      if (typeof onValidSpec === "function") {
        onValidSpec({ spec: normalized.spec, specText });
      }
      setStatus(statusEl, normalized.changed ? "BuildSpec validated (normalized)." : "BuildSpec validated.");
    } catch (error) {
      setOutput(outputEl, { error: error?.message || String(error) });
      setStatus(statusEl, "Prompt failed.");
    } finally {
      if (runButton) runButton.disabled = false;
    }
  }

  function clear() {
    applyState(DEFAULT_STATE);
    persist({ ...DEFAULT_STATE });
    setOutput(outputEl, "");
    lastRawResponse = "";
    lastFullPrompt = "";
    setDownloadAvailable(false);
    setPromptDownloadAvailable(false);
    updateStatus();
  }

  applyState(state);
  updateStatus();
  setOutput(outputEl, "");
  setDownloadAvailable(false);
  setPromptDownloadAvailable(false);

  const listenTargets = [modeSelect, modelInput, baseUrlInput, promptInput, optionsInput].filter(Boolean);
  listenTargets.forEach((el) => {
    if (!el?.addEventListener) return;
    el.addEventListener("input", () => {
      persist(collectState());
    });
    el.addEventListener("change", () => {
      persist(collectState());
      updateStatus();
    });
  });

  if (runButton) runButton.addEventListener("click", runPrompt);
  if (clearButton) clearButton.addEventListener("click", clear);
  if (downloadButton) downloadButton.addEventListener("click", triggerDownload);
  if (downloadPromptButton) downloadPromptButton.addEventListener("click", triggerPromptDownload);

  return { runPrompt, clear };
}
