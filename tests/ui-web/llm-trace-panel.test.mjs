import { test } from "node:test";
import assert from "node:assert/strict";
import { wireLlmTracePanel } from "../../packages/ui-web/src/llm-trace-panel.js";

function makeTextEl(value = "") {
  return { textContent: value };
}

function makeSelectEl() {
  const handlers = {};
  let text = "";
  return {
    value: "",
    disabled: false,
    children: [],
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    trigger(event) {
      handlers[event]?.();
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
      if (text === "") {
        this.children = [];
      }
    },
  };
}

function makeButton() {
  const handlers = {};
  return {
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      handlers.click?.();
    },
  };
}

function createLlmCapture({
  id,
  createdAt,
  prompt,
  responseRaw,
  responseParsed,
  phase,
  errors = [],
} = {}) {
  return {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    meta: {
      id,
      runId: "run_trace_ui",
      createdAt,
      producedBy: "orchestrator",
    },
    source: {
      adapter: "llm",
      request: {
        model: "phi4",
        baseUrl: "http://localhost:11434",
      },
    },
    contentType: "application/json",
    payload: {
      prompt,
      responseRaw,
      responseParsed,
      phase,
      errors,
    },
  };
}

test("llm trace panel renders multi-turn prompt/response transcript and annotator summary", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ value: "", textContent: "" }),
  };

  try {
    const elements = {
      statusEl: makeTextEl(),
      countEl: makeTextEl("0"),
      turnSelect: makeSelectEl(),
      promptEl: makeTextEl(),
      responseRawEl: makeTextEl(),
      responseParsedEl: makeTextEl(),
      errorsEl: makeTextEl(),
      summaryEl: makeTextEl(),
      telemetryEl: makeTextEl(),
      clearButton: makeButton(),
    };

    const panel = wireLlmTracePanel({ elements });
    const first = createLlmCapture({
      id: "capture_1",
      createdAt: "2026-02-08T10:00:01.000Z",
      prompt: "layout prompt",
      responseRaw: "{\"layout\":{}}",
      responseParsed: { layout: {} },
      phase: "layout_only",
    });
    const second = createLlmCapture({
      id: "capture_2",
      createdAt: "2026-02-08T10:00:02.000Z",
      prompt: "actors prompt",
      responseRaw: "{\"actors\":[]}",
      responseParsed: { actors: [] },
      phase: "actors_only",
      errors: [{ code: "missing_actors" }],
    });

    panel.setCaptures([first, second], { source: "Loaded bundle captures" });

    assert.equal(elements.countEl.textContent, "2");
    assert.equal(elements.turnSelect.children.length, 2);
    assert.match(elements.statusEl.textContent, /Loaded bundle captures/);
    assert.match(elements.summaryEl.textContent, /"turnCount": 2/);
    assert.match(elements.telemetryEl.textContent, /"kind": "llm_trace"/);
    assert.match(elements.promptEl.textContent, /actors prompt/);
    assert.match(elements.errorsEl.textContent, /missing_actors/);

    elements.turnSelect.value = "capture_1";
    elements.turnSelect.trigger("change");
    assert.match(elements.promptEl.textContent, /layout prompt/);
    assert.match(elements.responseRawEl.textContent, /"layout"/);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("llm trace panel clear removes rendered transcript", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ value: "", textContent: "" }),
  };

  try {
    const clearButton = makeButton();
    const elements = {
      statusEl: makeTextEl(),
      countEl: makeTextEl("0"),
      turnSelect: makeSelectEl(),
      promptEl: makeTextEl(),
      responseRawEl: makeTextEl(),
      responseParsedEl: makeTextEl(),
      errorsEl: makeTextEl(),
      summaryEl: makeTextEl(),
      telemetryEl: makeTextEl(),
      clearButton,
    };
    const panel = wireLlmTracePanel({ elements });
    panel.setCaptures([
      createLlmCapture({
        id: "capture_clear",
        createdAt: "2026-02-08T10:00:00.000Z",
        prompt: "prompt",
        responseRaw: "response",
        phase: "summary",
      }),
    ]);

    clearButton.click();

    assert.equal(elements.countEl.textContent, "0");
    assert.equal(elements.turnSelect.children.length, 0);
    assert.match(elements.statusEl.textContent, /Trace cleared/);
    assert.equal(elements.promptEl.textContent, "No prompt captured.");
    assert.equal(elements.summaryEl.textContent, "No annotator summary yet.");
    assert.equal(elements.telemetryEl.textContent, "No annotator telemetry yet.");
  } finally {
    globalThis.document = originalDocument;
  }
});
