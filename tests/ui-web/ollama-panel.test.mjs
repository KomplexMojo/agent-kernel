import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { wireOllamaPromptPanel } from "../../packages/ui-web/src/ollama-panel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function makeButton() {
  const handlers = {};
  return {
    disabled: false,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      return handlers.click?.();
    },
  };
}

function makeInput(value = "") {
  return {
    value,
    addEventListener() {},
  };
}

test("ollama panel parses fixture response into a valid BuildSpec", async () => {
  const fixturePath = path.join(root, "tests/fixtures/adapters/llm-build-spec.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const expectedSpec = JSON.parse(fixture.response);

  const output = { textContent: "" };
  const status = { textContent: "" };
  const runButton = makeButton();
  const clearButton = makeButton();

  const calls = [];
  let capturedSpec = null;
  let capturedSpecText = "";

  wireOllamaPromptPanel({
    elements: {
      modeSelect: makeInput("fixture"),
      modelInput: makeInput("fixture"),
      baseUrlInput: makeInput("http://localhost:11434"),
      promptInput: makeInput("Build a demo scenario."),
      optionsInput: makeInput(""),
      runButton,
      clearButton,
      statusEl: status,
      outputEl: output,
    },
    helpers: {
      runLlmDemo: async (opts) => {
        calls.push(opts);
        return fixture;
      },
    },
    fixturePath: "/tests/fixtures/adapters/llm-build-spec.json",
    onValidSpec: ({ spec, specText }) => {
      capturedSpec = spec;
      capturedSpecText = specText;
    },
  });

  await runButton.click();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "fixture");
  assert.match(calls[0].prompt, /agent-kernel\/BuildSpec/);
  assert.match(status.textContent, /validated/i);

  const outputSpec = JSON.parse(output.textContent);
  assert.equal(outputSpec.schema, expectedSpec.schema);
  assert.equal(outputSpec.intent.goal, expectedSpec.intent.goal);

  assert.equal(capturedSpec.schema, expectedSpec.schema);
  assert.equal(JSON.parse(capturedSpecText).meta.id, expectedSpec.meta.id);
});
