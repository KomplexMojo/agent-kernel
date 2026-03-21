export const DEFAULT_BUDGET_FIXTURES = Object.freeze({
  budget: "/tests/fixtures/artifacts/budget-artifact-v1-basic.json",
  priceList: "/tests/fixtures/artifacts/price-list-artifact-v1-basic.json",
  receipt: "/tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json",
});

const EMPTY_TEXT = "No JSON output yet.";
const BUDGET_SCHEMA = "agent-kernel/BudgetArtifact";
const PRICE_LIST_SCHEMA = "agent-kernel/PriceList";
const RECEIPT_SCHEMA = "agent-kernel/BudgetReceiptArtifact";

function setPanel(panel, payload) {
  if (!panel) return;
  if (!payload) {
    panel.textContent = EMPTY_TEXT;
    return;
  }
  panel.textContent = JSON.stringify(payload, null, 2);
}

function readSchemaArtifact(artifacts, schema) {
  if (!Array.isArray(artifacts)) return null;
  const hit = artifacts.find((artifact) => artifact?.schema === schema);
  return hit && typeof hit === "object" ? hit : null;
}

function readArtifactFile(artifacts, matcher) {
  if (!artifacts || typeof artifacts !== "object") return null;
  for (const [path, value] of Object.entries(artifacts)) {
    if (!matcher(path)) continue;
    if (!value || typeof value !== "object") continue;
    return value;
  }
  return null;
}

function resolveBudgetTriplet({
  budget,
  priceList,
  receipt,
  response,
  snapshot,
  bundle,
  artifacts,
} = {}) {
  const resolvedBundle = bundle || snapshot?.response?.bundle || response?.bundle;
  const resolvedResponse = response || snapshot?.response;
  const bundleArtifacts = Array.isArray(resolvedBundle?.artifacts) ? resolvedBundle.artifacts : [];
  const directoryArtifacts = artifacts || resolvedResponse?.artifacts || snapshot?.response?.artifacts;

  const schemaBudget = readSchemaArtifact(bundleArtifacts, BUDGET_SCHEMA);
  const schemaPriceList = readSchemaArtifact(bundleArtifacts, PRICE_LIST_SCHEMA);
  const schemaReceipt = readSchemaArtifact(bundleArtifacts, RECEIPT_SCHEMA);

  const fileBudget = readArtifactFile(
    directoryArtifacts,
    (path) => /(^|\/)budget\.json$/i.test(path),
  );
  const filePriceList = readArtifactFile(
    directoryArtifacts,
    (path) => /(^|\/)price-list\.json$/i.test(path),
  );
  const fileReceipt = readArtifactFile(
    directoryArtifacts,
    (path) => /(^|\/)budget-receipt\.json$/i.test(path),
  );

  return {
    budget: budget || schemaBudget || fileBudget,
    priceList: priceList || schemaPriceList || filePriceList,
    receipt: receipt || schemaReceipt || fileReceipt,
  };
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

  function setFromArtifacts(payload = {}) {
    const resolved = resolveBudgetTriplet(payload);
    setData(resolved);
    return resolved;
  }

  return { refresh, setData, setFromArtifacts };
}
