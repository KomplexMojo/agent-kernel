const DEFAULT_LABELS = Object.freeze({
  summary: "missing",
  spec: "waiting on summary",
  build: "waiting on BuildSpec",
  bundle: "waiting on build output",
});

function stageLabel(ready, label, fallback) {
  if (!ready) return fallback;
  return label || "ready";
}

export function wireLlmFlowRail({ elements = {}, actions = {} } = {}) {
  const {
    summaryButton,
    poolButton,
    buildButton,
    bundleButton,
    statusEl,
    summaryStatus,
    specStatus,
    buildStatus,
    bundleStatus,
  } = elements;

  const state = {
    summaryReady: false,
    specReady: false,
    buildReady: false,
    bundleReady: false,
    summaryLabel: "",
    specLabel: "",
    buildLabel: "",
    bundleLabel: "",
  };

  function updateButtons() {
    if (poolButton) poolButton.disabled = !state.summaryReady;
    if (buildButton) buildButton.disabled = !state.specReady;
    if (bundleButton) bundleButton.disabled = !state.buildReady;
  }

  function updateSteps() {
    if (summaryStatus) {
      summaryStatus.textContent = `Summary: ${stageLabel(state.summaryReady, state.summaryLabel, DEFAULT_LABELS.summary)}.`;
    }
    if (specStatus) {
      specStatus.textContent = `BuildSpec: ${stageLabel(state.specReady, state.specLabel, DEFAULT_LABELS.spec)}.`;
    }
    if (buildStatus) {
      buildStatus.textContent = `Build: ${stageLabel(state.buildReady, state.buildLabel, DEFAULT_LABELS.build)}.`;
    }
    if (bundleStatus) {
      bundleStatus.textContent = `Bundle: ${stageLabel(state.bundleReady, state.bundleLabel, DEFAULT_LABELS.bundle)}.`;
    }
  }

  function updateStatus() {
    if (!statusEl) return;
    if (!state.summaryReady) {
      statusEl.textContent = "Waiting for summary.";
      return;
    }
    if (!state.specReady) {
      statusEl.textContent = "Summary loaded. Generate BuildSpec.";
      return;
    }
    if (!state.buildReady) {
      statusEl.textContent = "BuildSpec ready. Run build.";
      return;
    }
    if (!state.bundleReady) {
      statusEl.textContent = "Build complete. Load bundle.";
      return;
    }
    statusEl.textContent = "Bundle loaded. Ready to run in Runtime.";
  }

  function refresh() {
    updateButtons();
    updateSteps();
    updateStatus();
  }

  function setSummaryReady(ready, { label = "" } = {}) {
    state.summaryReady = Boolean(ready);
    state.summaryLabel = label || state.summaryLabel;
    if (!ready) {
      state.specReady = false;
      state.buildReady = false;
      state.bundleReady = false;
    }
    refresh();
  }

  function setSpecReady(ready, { label = "" } = {}) {
    state.specReady = Boolean(ready);
    state.specLabel = label || state.specLabel;
    if (!ready) {
      state.buildReady = false;
      state.bundleReady = false;
    }
    refresh();
  }

  function setBuildReady(ready, { label = "" } = {}) {
    state.buildReady = Boolean(ready);
    state.buildLabel = label || state.buildLabel;
    if (!ready) {
      state.bundleReady = false;
    }
    refresh();
  }

  function setBundleReady(ready, { label = "" } = {}) {
    state.bundleReady = Boolean(ready);
    state.bundleLabel = label || state.bundleLabel;
    refresh();
  }

  if (summaryButton) {
    summaryButton.addEventListener("click", () => actions.loadSummary?.());
  }
  if (poolButton) {
    poolButton.addEventListener("click", () => actions.runPool?.());
  }
  if (buildButton) {
    buildButton.addEventListener("click", () => actions.runBuild?.());
  }
  if (bundleButton) {
    bundleButton.addEventListener("click", () => actions.loadBundle?.());
  }

  refresh();

  return {
    setSummaryReady,
    setSpecReady,
    setBuildReady,
    setBundleReady,
    refresh,
    state,
  };
}
