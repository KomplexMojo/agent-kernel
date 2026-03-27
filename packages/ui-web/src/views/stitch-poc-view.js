const SIM_CONFIG_SCHEMA = "agent-kernel/SimConfigArtifact";
const INITIAL_STATE_SCHEMA = "agent-kernel/InitialStateArtifact";

export const DEFAULT_STITCH_POC_FIXTURE_PATH = "/tests/fixtures/ui/build-spec-bundle/bundle.json";

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function setStatus(el, message, level = "info") {
  if (!el) return;
  el.textContent = message;
  if (el.dataset) {
    el.dataset.level = level;
  }
}

function findArtifact(bundle, schema) {
  if (!bundle || !Array.isArray(bundle.artifacts)) return null;
  return bundle.artifacts.find((artifact) => artifact && artifact.schema === schema) || null;
}

export function summarizeFixtureBundle(bundle = {}) {
  const spec = bundle.spec || {};
  const simConfig = findArtifact(bundle, SIM_CONFIG_SCHEMA) || {};
  const initialState = findArtifact(bundle, INITIAL_STATE_SCHEMA) || {};

  const width = Number(simConfig?.layout?.data?.width) || 0;
  const height = Number(simConfig?.layout?.data?.height) || 0;
  const actors = Array.isArray(initialState.actors) ? initialState.actors.length : 0;
  const artifactCount = Array.isArray(bundle.artifacts) ? bundle.artifacts.length : 0;
  const tags = Array.isArray(spec?.intent?.tags) ? spec.intent.tags : [];

  return {
    goal: String(spec?.intent?.goal || "No fixture goal available."),
    runId: String(spec?.meta?.runId || "unknown_run"),
    mapSizeLabel: width > 0 && height > 0 ? `${width}x${height}` : "Unknown",
    actorCount: actors,
    artifactCount,
    tagLabel: tags.length > 0 ? tags.join(", ") : "none",
  };
}

export function wireStitchPocView({
  root = document,
  fetchFn = globalThis.fetch,
  fixturePath = DEFAULT_STITCH_POC_FIXTURE_PATH,
  autoLoad = true,
  commandHost,
  onNewJourney,
} = {}) {
  const statusEl = root.querySelector("#stitch-poc-status");
  const goalEl = root.querySelector("#stitch-poc-goal");
  const runIdEl = root.querySelector("#stitch-poc-run-id");
  const mapSizeEl = root.querySelector("#stitch-poc-map-size");
  const actorCountEl = root.querySelector("#stitch-poc-actor-count");
  const artifactCountEl = root.querySelector("#stitch-poc-artifact-count");
  const tagsEl = root.querySelector("#stitch-poc-tags");

  const newJourneyBtn = root.querySelector("#stitch-poc-menu-new");
  const continueBtn = root.querySelector("#stitch-poc-menu-continue");
  const settingsBtn = root.querySelector("#stitch-poc-menu-settings");
  const exitBtn = root.querySelector("#stitch-poc-menu-exit");

  let lastBundle = null;
  let lastSummary = null;
  let lastNormalizedSpec = null;

  function renderFromBundle(bundle, { source = "fixture" } = {}) {
    lastBundle = bundle;
    const summary = summarizeFixtureBundle(bundle);
    lastSummary = summary;

    setText(goalEl, summary.goal);
    setText(runIdEl, summary.runId);
    setText(mapSizeEl, summary.mapSizeLabel);
    setText(actorCountEl, String(summary.actorCount));
    setText(artifactCountEl, String(summary.artifactCount));
    setText(tagsEl, summary.tagLabel);
    setStatus(statusEl, `Main Menu fixture loaded from ${source}.`, "info");

    return { ok: true, summary };
  }

  async function loadFixture({ source = "fixture" } = {}) {
    if (typeof fetchFn !== "function") {
      const error = "Fetch API unavailable; cannot load fixture bundle.";
      setStatus(statusEl, error, "error");
      return { ok: false, error };
    }

    setStatus(statusEl, "Loading Main Menu fixture bundle...", "info");

    try {
      const response = await fetchFn(fixturePath);
      if (!response?.ok) {
        throw new Error(`Fixture request failed (${response?.status ?? "unknown"}).`);
      }
      const bundle = await response.json();
      return renderFromBundle(bundle, { source });
    } catch (error) {
      const message = error?.message || "Failed to load fixture bundle.";
      setStatus(statusEl, message, "error");
      return { ok: false, error: message };
    }
  }

  async function runCommandHostProof() {
    if (!lastBundle?.spec || typeof lastBundle.spec !== "object") {
      const error = "Load fixture bundle before running command-host normalization.";
      setStatus(statusEl, error, "error");
      return { ok: false, error };
    }
    if (typeof commandHost?.normalizeBuildSpec !== "function") {
      const error = "Command host unavailable; cannot run normalization proof.";
      setStatus(statusEl, error, "error");
      return { ok: false, error };
    }

    setStatus(statusEl, "Running command-host normalization...", "info");
    try {
      const result = await commandHost.normalizeBuildSpec({ spec: lastBundle.spec });
      const normalizedSpec = result?.spec;
      if (!normalizedSpec || typeof normalizedSpec !== "object") {
        throw new Error("Command host returned no normalized BuildSpec.");
      }
      lastNormalizedSpec = normalizedSpec;
      const runId = String(normalizedSpec?.meta?.runId || "unknown_run");
      const changedLabel = result?.changed ? "changed" : "unchanged";
      setStatus(statusEl, `Command host normalized BuildSpec (${changedLabel}, runId=${runId}).`, "info");
      return { ok: true, result };
    } catch (error) {
      const message = error?.message || "Command-host normalization failed.";
      setStatus(statusEl, `Command-host normalization failed: ${message}`, "error");
      return { ok: false, error: message };
    }
  }

  function bindButton(el, message, callback) {
    if (!el || typeof el.addEventListener !== "function") return;
    el.addEventListener("click", async () => {
      await callback?.();
      if (message) {
        setStatus(statusEl, message, "info");
      }
    });
  }

  bindButton(newJourneyBtn, "Main Menu action selected: New Journey.", onNewJourney);
  bindButton(continueBtn, "", runCommandHostProof);
  bindButton(settingsBtn, "Main Menu action selected: Settings.");
  bindButton(exitBtn, "Main Menu action selected: Exit.");

  if (autoLoad) {
    void loadFixture();
  }

  return {
    loadFixture,
    renderFromBundle,
    getLastBundle() {
      return lastBundle;
    },
    getLastSummary() {
      return lastSummary;
    },
    getLastNormalizedSpec() {
      return lastNormalizedSpec;
    },
    runCommandHostProof,
  };
}
