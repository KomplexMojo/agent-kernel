import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { setupPoolFlow } from "../../packages/ui-web/src/pool-flow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function makeTextarea() {
  return { value: "" };
}
function makeButton() {
  const handlers = {};
  return {
    addEventListener(evt, fn) {
      handlers[evt] = fn;
    },
    click() {
      return handlers.click?.();
    },
  };
}
function makeFileInput(json) {
  return {
    files: [
      {
        async text() {
          return JSON.stringify(json);
        },
      },
    ],
  };
}

test("pool flow renders summary → selections → BuildSpec from fixtures", async () => {
  const summary = JSON.parse(readFileSync(path.join(root, "tests/fixtures/pool/summary-basic.json"), "utf8"));
  const catalog = JSON.parse(readFileSync(path.join(root, "tests/fixtures/pool/catalog-basic.json"), "utf8"));

  const state = {
    status: { textContent: "", style: {} },
    summaryOut: makeTextarea(),
    selectionsOut: makeTextarea(),
    receiptsOut: makeTextarea(),
    buildSpecOut: makeTextarea(),
    allowedOut: makeTextarea(),
  };

  const loadFixtureBtn = makeButton();
  const runBtn = makeButton();

  setupPoolFlow({
    loadFixtureBtn,
    runBtn,
    statusEl: state.status,
    summaryOut: state.summaryOut,
    selectionsOut: state.selectionsOut,
    receiptsOut: state.receiptsOut,
    buildSpecOut: state.buildSpecOut,
    allowedOut: state.allowedOut,
    summaryFileInput: makeFileInput(summary),
    catalogFileInput: makeFileInput(catalog),
  });

  await runBtn.click();

  assert.match(state.status.textContent, /BuildSpec ready/);
  assert.ok(state.summaryOut.value.includes("dungeonTheme"));
  const selections = JSON.parse(state.selectionsOut.value);
  assert.equal(Array.isArray(selections), true);
  const buildSpec = JSON.parse(state.buildSpecOut.value);
  assert.equal(buildSpec.schema, "agent-kernel/BuildSpec");
});
