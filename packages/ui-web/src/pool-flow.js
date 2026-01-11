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

export function setupPoolFlow(elements = {}) {
  const {
    loadFixtureBtn,
    summaryFileInput,
    catalogFileInput,
    runBtn,
    sendBuildBtn,
    statusEl,
    summaryOut,
    selectionsOut,
    receiptsOut,
    buildSpecOut,
    allowedOut,
    onSummaryLoaded,
    onBuildSpec,
    onSendSpec,
  } = elements;

  const state = {
    summary: null,
    catalog: null,
    buildSpec: null,
    buildSpecText: "",
    summarySource: "",
    catalogSource: "",
  };

  async function updateStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "red" : "inherit";
  }

  function setSendAvailable(available) {
    if (!sendBuildBtn) return;
    sendBuildBtn.disabled = !available;
  }

  function updateBuildSpecState(spec, specText) {
    state.buildSpec = spec || null;
    state.buildSpecText = specText || "";
    setSendAvailable(Boolean(spec && specText));
  }

  function notifySummaryLoaded(source) {
    if (typeof onSummaryLoaded !== "function") return;
    if (!state.summary || !state.catalog) return;
    onSummaryLoaded({ summary: state.summary, catalog: state.catalog, source });
  }

  async function loadInputs({ source = "file", notify = true } = {}) {
    try {
      let summaryLoaded = false;
      let catalogLoaded = false;

      if (summaryFileInput?.files?.length) {
        state.summary = await readFileInput(summaryFileInput);
        state.summarySource = source;
        summaryLoaded = true;
      }
      if (catalogFileInput?.files?.length) {
        state.catalog = await readFileInput(catalogFileInput);
        state.catalogSource = source;
        catalogLoaded = true;
      }
      if (summaryLoaded || catalogLoaded) {
        updateBuildSpecState(null, "");
      }

      if (state.summary && summaryOut) {
        summaryOut.value = JSON.stringify(state.summary, null, 2);
      }
      if (state.catalog && allowedOut) {
        const allowed = deriveAllowedOptionsFromCatalog(state.catalog);
        allowedOut.value = JSON.stringify(allowed, null, 2);
      }

      const hasSummary = Boolean(state.summary);
      const hasCatalog = Boolean(state.catalog);
      if (notify) {
        if (hasSummary && hasCatalog) {
          await updateStatus("Loaded summary + catalog.");
        } else if (hasSummary) {
          await updateStatus("Loaded summary. Waiting on catalog.");
        } else if (hasCatalog) {
          await updateStatus("Loaded catalog. Waiting on summary.");
        } else {
          await updateStatus("Load a summary + catalog to begin.");
        }
      }
      if (hasSummary && hasCatalog) {
        notifySummaryLoaded(source);
      }

      return { summaryLoaded, catalogLoaded, ready: hasSummary && hasCatalog };
    } catch (err) {
      await updateStatus(`Load failed: ${err.message}`, true);
      return { summaryLoaded: false, catalogLoaded: false, ready: false };
    }
  }

  async function loadFixture() {
    try {
      const [summary, catalog] = await Promise.all([
        fetchJson("/tests/fixtures/pool/summary-basic.json"),
        fetchJson("/tests/fixtures/pool/catalog-basic.json"),
      ]);
      state.summary = summary;
      state.catalog = catalog;
      state.summarySource = "fixture";
      state.catalogSource = "fixture";
      updateBuildSpecState(null, "");
      if (summaryOut) summaryOut.value = JSON.stringify(summary, null, 2);
      const allowed = deriveAllowedOptionsFromCatalog(catalog);
      if (allowedOut) allowedOut.value = JSON.stringify(allowed, null, 2);
      await updateStatus("Loaded pool fixture (summary + catalog).");
      notifySummaryLoaded("fixture");
    } catch (err) {
      await updateStatus(`Fixture load failed: ${err.message}`, true);
    }
  }

  async function runFlow() {
    try {
      await loadInputs({ source: "file", notify: false });
      if (!state.summary) throw new Error("No summary loaded or provided.");
      if (!state.catalog) throw new Error("No catalog loaded or provided.");
      if (summaryOut) summaryOut.value = JSON.stringify(state.summary, null, 2);
      updateBuildSpecState(null, "");

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

      const specText = JSON.stringify(built.spec, null, 2);
      if (buildSpecOut) buildSpecOut.value = specText;
      updateBuildSpecState(built.spec, specText);
      if (typeof onBuildSpec === "function") {
        onBuildSpec({
          summary: state.summary,
          catalog: state.catalog,
          selections: enforced.selections,
          receipts: enforced.actions,
          spec: built.spec,
          specText,
        });
      }
      await updateStatus("Pool flow completed: BuildSpec ready.");
    } catch (err) {
      updateBuildSpecState(null, "");
      await updateStatus(`Pool flow error: ${err.message}`, true);
    }
  }

  function sendBuildSpec() {
    if (!state.buildSpec || !state.buildSpecText) {
      updateStatus("BuildSpec not ready. Run the pool flow first.", true);
      return;
    }
    if (typeof onSendSpec === "function") {
      onSendSpec({ spec: state.buildSpec, specText: state.buildSpecText });
    }
    updateStatus("BuildSpec sent to Build Orchestration.");
  }

  if (loadFixtureBtn) loadFixtureBtn.addEventListener("click", loadFixture);
  if (runBtn) runBtn.addEventListener("click", runFlow);
  if (sendBuildBtn) sendBuildBtn.addEventListener("click", sendBuildSpec);
  setSendAvailable(false);

  return { loadFixture, loadInputs, runFlow };
}
