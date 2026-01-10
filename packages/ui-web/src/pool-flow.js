import { mapSummaryToPool } from "../../runtime/src/personas/director/pool-mapper.js";
import { enforceBudget } from "../../runtime/src/personas/director/budget-enforcer.js";
import { buildBuildSpecFromSummary } from "../../runtime/src/personas/director/buildspec-assembler.js";
import { deriveAllowedOptionsFromCatalog } from "../../runtime/src/personas/orchestrator/prompt-contract.js";

async function readFileInput(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return null;
  const text = await file.text();
  return JSON.parse(text);
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json();
}

export function setupPoolFlow(elements) {
  if (!elements) return;
  const {
    loadFixtureBtn,
    summaryFileInput,
    catalogFileInput,
    runBtn,
    statusEl,
    summaryOut,
    selectionsOut,
    receiptsOut,
    buildSpecOut,
    allowedOut,
  } = elements;

  const state = {
    summary: null,
    catalog: null,
  };

  async function updateStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "red" : "inherit";
  }

  async function loadFixture() {
    try {
      const [summary, catalog] = await Promise.all([
        fetchJson("/tests/fixtures/pool/summary-basic.json"),
        fetchJson("/tests/fixtures/pool/catalog-basic.json"),
      ]);
      state.summary = summary;
      state.catalog = catalog;
      if (summaryOut) summaryOut.value = JSON.stringify(summary, null, 2);
      const allowed = deriveAllowedOptionsFromCatalog(catalog);
      if (allowedOut) allowedOut.value = JSON.stringify(allowed, null, 2);
      await updateStatus("Loaded pool fixture (summary + catalog).");
    } catch (err) {
      await updateStatus(`Fixture load failed: ${err.message}`, true);
    }
  }

  async function runFlow() {
    try {
      if (summaryFileInput?.files?.length) {
        state.summary = await readFileInput(summaryFileInput);
      }
      if (catalogFileInput?.files?.length) {
        state.catalog = await readFileInput(catalogFileInput);
      }
      if (!state.summary) throw new Error("No summary loaded or provided.");
      if (!state.catalog) throw new Error("No catalog loaded or provided.");
      if (summaryOut) summaryOut.value = JSON.stringify(state.summary, null, 2);

      const mapped = mapSummaryToPool({ summary: state.summary, catalog: state.catalog });
      if (!mapped.ok) {
        await updateStatus(`Mapping failed: ${JSON.stringify(mapped.errors)}`, true);
        return;
      }

      const enforced = enforceBudget({ selections: mapped.selections, budgetTokens: state.summary.budgetTokens });
      if (selectionsOut) selectionsOut.value = JSON.stringify(enforced.selections, null, 2);
      if (receiptsOut) receiptsOut.value = JSON.stringify(enforced.actions, null, 2);
      const allowed = deriveAllowedOptionsFromCatalog(state.catalog);
      if (allowedOut) allowedOut.value = JSON.stringify(allowed, null, 2);

      const built = buildBuildSpecFromSummary({
        summary: state.summary,
        selections: enforced.selections,
        runId: "pool_ui_run",
        source: "pool-ui",
      });

      if (!built.ok) {
        await updateStatus(`BuildSpec validation failed: ${JSON.stringify(built.errors)}`, true);
        if (buildSpecOut) buildSpecOut.value = JSON.stringify(built.spec, null, 2);
        return;
      }

      if (buildSpecOut) buildSpecOut.value = JSON.stringify(built.spec, null, 2);
      await updateStatus("Pool flow completed: BuildSpec ready.");
    } catch (err) {
      await updateStatus(`Pool flow error: ${err.message}`, true);
    }
  }

  if (loadFixtureBtn) loadFixtureBtn.addEventListener("click", loadFixture);
  if (runBtn) runBtn.addEventListener("click", runFlow);
}
