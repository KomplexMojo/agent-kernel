import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runEsm } from "../helpers/esm-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

test("budget panels render fixture JSON when in fixture mode", async () => {
  const budget = JSON.parse(await readFile(path.resolve(root, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"), "utf8"));
  const priceList = JSON.parse(await readFile(path.resolve(root, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json"), "utf8"));
  const receipt = JSON.parse(await readFile(path.resolve(root, "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json"), "utf8"));

  const script = `
import assert from "node:assert/strict";
import { wireBudgetPanels, DEFAULT_BUDGET_FIXTURES } from ${JSON.stringify(pathToFileURL(path.resolve(root, "packages/ui-web/src/budget-panels.js")).href)};

const budget = ${JSON.stringify(budget)};
const priceList = ${JSON.stringify(priceList)};
const receipt = ${JSON.stringify(receipt)};

function makePanel() {
  return { textContent: "" };
}

const panels = {
  configBudget: makePanel(),
  configPriceList: makePanel(),
  configReceipt: makePanel(),
  allocatorBudget: makePanel(),
  allocatorPriceList: makePanel(),
  allocatorReceipt: makePanel(),
};

const fetchFn = async (url) => {
  if (url === DEFAULT_BUDGET_FIXTURES.budget) {
    return { ok: true, json: async () => budget };
  }
  if (url === DEFAULT_BUDGET_FIXTURES.priceList) {
    return { ok: true, json: async () => priceList };
  }
  if (url === DEFAULT_BUDGET_FIXTURES.receipt) {
    return { ok: true, json: async () => receipt };
  }
  return { ok: false, status: 404, statusText: "Not Found" };
};

const wiring = wireBudgetPanels({
  elements: panels,
  mode: "fixture",
  fetchFn,
});

await wiring.refresh();

assert.match(panels.configBudget.textContent, /BudgetArtifact/);
assert.match(panels.configPriceList.textContent, /PriceList/);
assert.match(panels.configReceipt.textContent, /BudgetReceiptArtifact/);
assert.match(panels.allocatorBudget.textContent, /BudgetArtifact/);
assert.match(panels.allocatorPriceList.textContent, /PriceList/);
assert.match(panels.allocatorReceipt.textContent, /BudgetReceiptArtifact/);
`;

  runEsm(script);
});
