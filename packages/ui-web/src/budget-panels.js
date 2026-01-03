export const DEFAULT_BUDGET_FIXTURES = Object.freeze({
  budget: "/tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  priceList: "/tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
  receipt: "/tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
});

const EMPTY_TEXT = "No JSON output yet.";

function setPanel(panel, payload) {
  if (!panel) return;
  if (!payload) {
    panel.textContent = EMPTY_TEXT;
    return;
  }
  panel.textContent = JSON.stringify(payload, null, 2);
}

async function loadFixtureJson(path, fetchFn) {
  const response = await fetchFn(path);
  if (!response.ok) {
    throw new Error(`Failed to load fixture ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function wireBudgetPanels({
  elements = {},
  fixturePaths = DEFAULT_BUDGET_FIXTURES,
  mode = "fixture",
  fetchFn = fetch,
} = {}) {
  let currentMode = mode;

  function setData({ budget, priceList, receipt } = {}) {
    setPanel(elements.configBudget, budget);
    setPanel(elements.configPriceList, priceList);
    setPanel(elements.configReceipt, receipt);
    setPanel(elements.allocatorBudget, budget);
    setPanel(elements.allocatorPriceList, priceList);
    setPanel(elements.allocatorReceipt, receipt);
  }

  async function refresh(nextMode = currentMode) {
    currentMode = nextMode;
    if (currentMode !== "fixture") {
      setData();
      return;
    }
    try {
      const [budget, priceList, receipt] = await Promise.all([
        loadFixtureJson(fixturePaths.budget, fetchFn),
        loadFixtureJson(fixturePaths.priceList, fetchFn),
        loadFixtureJson(fixturePaths.receipt, fetchFn),
      ]);
      setData({ budget, priceList, receipt });
    } catch (error) {
      setData();
      console.warn(error);
    }
  }

  return { refresh, setData };
}
