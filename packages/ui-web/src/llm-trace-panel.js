import {
  buildLlmTraceTelemetryRecord,
  buildLlmTraceTurns,
  summarizeLlmTrace,
} from "../../runtime/src/personas/annotator/llm-trace.js";

const EMPTY_STATUS = "No LLM captures yet.";
const EMPTY_PROMPT = "No prompt captured.";
const EMPTY_RESPONSE = "No response captured.";
const EMPTY_PARSED = "No parsed response.";
const EMPTY_ERRORS = "No parse/contract errors.";
const EMPTY_SUMMARY = "No annotator summary yet.";
const EMPTY_TELEMETRY = "No annotator telemetry yet.";

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function stringifyForPre(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function captureKey(capture, index) {
  const metaId = capture?.meta?.id;
  if (typeof metaId === "string" && metaId.trim()) {
    return `id:${metaId.trim()}`;
  }
  const runId = capture?.meta?.runId || "run_unknown";
  const createdAt = capture?.meta?.createdAt || "time_unknown";
  return `fallback:${runId}:${createdAt}:${index}`;
}

function mergeCaptures(existing = [], incoming = []) {
  const base = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const deduped = new Map();

  base.forEach((capture, index) => {
    deduped.set(captureKey(capture, index), capture);
  });
  next.forEach((capture, index) => {
    deduped.set(captureKey(capture, index), capture);
  });

  return Array.from(deduped.values());
}

function formatTurnLabel(turn, index) {
  const phase = turn?.phase || "phase:unknown";
  const status = turn?.status || "status:unknown";
  const model = turn?.model || "model:unknown";
  return `${index + 1}. ${phase} | ${status} | ${model}`;
}

export function wireLlmTracePanel({ elements = {} } = {}) {
  const {
    statusEl,
    countEl,
    turnSelect,
    promptEl,
    responseRawEl,
    responseParsedEl,
    errorsEl,
    summaryEl,
    telemetryEl,
    clearButton,
  } = elements;

  const state = {
    captures: [],
    selectedTurnId: "",
  };

  function resolveSelectedTurn(turns) {
    if (!Array.isArray(turns) || turns.length === 0) return null;
    const selected = turns.find((turn) => turn.id === state.selectedTurnId);
    if (selected) return selected;
    const latest = turns[turns.length - 1];
    state.selectedTurnId = latest.id;
    return latest;
  }

  function renderTurns(turns) {
    if (!turnSelect) return;

    if ("textContent" in turnSelect) {
      turnSelect.textContent = "";
    }

    turns.forEach((turn, index) => {
      const option = typeof document !== "undefined" && document.createElement
        ? document.createElement("option")
        : { value: "", textContent: "" };
      option.value = turn.id;
      option.textContent = formatTurnLabel(turn, index);
      if (typeof turnSelect.appendChild === "function") {
        turnSelect.appendChild(option);
      }
    });

    const selected = resolveSelectedTurn(turns);
    if ("value" in turnSelect) {
      turnSelect.value = selected?.id || "";
    }
    if ("disabled" in turnSelect) {
      turnSelect.disabled = turns.length === 0;
    }
  }

  function renderTurnDetails(turn) {
    if (!turn) {
      setText(promptEl, EMPTY_PROMPT);
      setText(responseRawEl, EMPTY_RESPONSE);
      setText(responseParsedEl, EMPTY_PARSED);
      setText(errorsEl, EMPTY_ERRORS);
      return;
    }

    setText(promptEl, stringifyForPre(turn.prompt, EMPTY_PROMPT));
    setText(responseRawEl, stringifyForPre(turn.responseRaw, EMPTY_RESPONSE));
    const parsedValue = turn.responseParsed !== undefined ? turn.responseParsed : turn.summary;
    setText(responseParsedEl, stringifyForPre(parsedValue, EMPTY_PARSED));
    setText(errorsEl, stringifyForPre(turn.errors, EMPTY_ERRORS));
  }

  function render({ source } = {}) {
    const turns = buildLlmTraceTurns(state.captures);
    const summary = turns.length > 0 ? summarizeLlmTrace(state.captures) : null;
    const telemetry = turns.length > 0
      ? buildLlmTraceTelemetryRecord({
        captures: state.captures,
        runId: turns[0]?.runId,
      })
      : null;

    renderTurns(turns);
    const selectedTurn = resolveSelectedTurn(turns);
    renderTurnDetails(selectedTurn);

    if (countEl) {
      countEl.textContent = String(turns.length);
    }

    if (turns.length === 0) {
      setText(statusEl, source ? `${source}. ${EMPTY_STATUS}` : EMPTY_STATUS);
      setText(summaryEl, EMPTY_SUMMARY);
      setText(telemetryEl, EMPTY_TELEMETRY);
      return;
    }

    const defaultStatus = `${turns.length} LLM turn(s) loaded.`;
    setText(statusEl, source ? `${source}. ${defaultStatus}` : defaultStatus);
    setText(summaryEl, stringifyForPre(summary, EMPTY_SUMMARY));
    setText(telemetryEl, stringifyForPre(telemetry, EMPTY_TELEMETRY));
  }

  function setCaptures(captures, { source } = {}) {
    state.captures = mergeCaptures([], captures);
    state.selectedTurnId = "";
    render({ source });
    return getState();
  }

  function appendCaptures(captures, { source } = {}) {
    state.captures = mergeCaptures(state.captures, captures);
    render({ source });
    return getState();
  }

  function clear({ source = "Trace cleared" } = {}) {
    state.captures = [];
    state.selectedTurnId = "";
    render({ source });
    return getState();
  }

  function getState() {
    return {
      captures: state.captures.slice(),
      selectedTurnId: state.selectedTurnId,
      turnCount: buildLlmTraceTurns(state.captures).length,
    };
  }

  if (turnSelect?.addEventListener) {
    turnSelect.addEventListener("change", () => {
      state.selectedTurnId = turnSelect.value || "";
      render();
    });
  }

  if (clearButton?.addEventListener) {
    clearButton.addEventListener("click", () => {
      clear();
    });
  }

  render();

  return {
    setCaptures,
    appendCaptures,
    clear,
    getState,
  };
}
