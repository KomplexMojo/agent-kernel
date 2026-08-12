import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

test("budget panels render fixture JSON when in fixture mode", async () => {
  const budget = JSON.parse(await readFile(path.resolve(root, "tests/fixtures/artifacts/budget-artifact-v1-basic.json"), "utf8"));
  const priceList = JSON.parse(await readFile(path.resolve(root, "tests/fixtures/artifacts/price-list-artifact-v1-basic.json"), "utf8"));
  const receipt = JSON.parse(await readFile(path.resolve(root, "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json"), "utf8"));
const { wireBudgetPanels, DEFAULT_BUDGET_FIXTURES } = await import("../../packages/ui-web/src/budget-panels.js");


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
});

test("budget panels render live artifact JSON from bundle and build outputs", async () => {const { wireBudgetPanels } = await import("../../packages/ui-web/src/budget-panels.js");

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

const wiring = wireBudgetPanels({
  elements: panels,
  mode: "live",
});

wiring.setFromArtifacts({
  bundle: {
    artifacts: [
      { schema: "agent-kernel/BudgetArtifact", schemaVersion: 1, totalTokens: 1000 },
      { schema: "agent-kernel/PriceList", schemaVersion: 1, entries: [] },
      { schema: "agent-kernel/BudgetReceiptArtifact", schemaVersion: 1, remainingBudgetTokens: 900 },
    ],
  },
});

assert.match(panels.configBudget.textContent, /BudgetArtifact/);
assert.match(panels.configPriceList.textContent, /PriceList/);
assert.match(panels.configReceipt.textContent, /BudgetReceiptArtifact/);

wiring.setFromArtifacts({
  response: {
    artifacts: {
      "budget.json": { schema: "agent-kernel/BudgetArtifact", schemaVersion: 1, totalTokens: 1200 },
      "price-list.json": { schema: "agent-kernel/PriceList", schemaVersion: 1, entries: [{ kind: "fire", baseCost: 1 }] },
      "budget-receipt.json": { schema: "agent-kernel/BudgetReceiptArtifact", schemaVersion: 1, remainingBudgetTokens: 850 },
    },
  },
});

assert.match(panels.allocatorBudget.textContent, /1200/);
assert.match(panels.allocatorPriceList.textContent, /baseCost/);
assert.match(panels.allocatorReceipt.textContent, /850/);
});
