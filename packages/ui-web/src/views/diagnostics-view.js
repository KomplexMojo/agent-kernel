import { wireBuildOrchestrator } from "../build-orchestrator.js";
import { wireBundleReview } from "../bundle-review.js";
import { wireBudgetPanels } from "../budget-panels.js";
import { createCliWorkerAdapter } from "../../../adapters-web/src/adapters/cli-worker/index.js";
import { isLlmCaptureArtifact } from "../../../runtime/src/personas/annotator/llm-trace.js";

function captureKey(capture, index) {
  const metaId = capture?.meta?.id;
  if (typeof metaId === "string" && metaId.trim()) {
    return `id:${metaId.trim()}`;
  }
  const runId = capture?.meta?.runId || "run_unknown";
  const createdAt = capture?.meta?.createdAt || "time_unknown";
  return `fallback:${runId}:${createdAt}:${index}`;
}

function toLlmCaptureList(candidates = []) {
  const deduped = new Map();
  candidates.forEach((capture, index) => {
    if (!isLlmCaptureArtifact(capture)) return;
    deduped.set(captureKey(capture, index), capture);
  });
  return Array.from(deduped.values());
}

export function extractLlmCaptures({
  captures,
  snapshot,
  response,
  bundle,
} = {}) {
  const list = [];
  const snapshotResponse = snapshot?.response;
  const resolvedResponse = response || snapshotResponse;

  if (Array.isArray(captures)) list.push(...captures);
  if (Array.isArray(resolvedResponse?.capturedInputs)) list.push(...resolvedResponse.capturedInputs);
  if (Array.isArray(resolvedResponse?.artifacts)) list.push(...resolvedResponse.artifacts);
  if (Array.isArray(resolvedResponse?.bundle?.capturedInputs)) list.push(...resolvedResponse.bundle.capturedInputs);
  if (Array.isArray(resolvedResponse?.bundle?.artifacts)) list.push(...resolvedResponse.bundle.artifacts);
  if (Array.isArray(bundle?.capturedInputs)) list.push(...bundle.capturedInputs);
  if (Array.isArray(bundle?.artifacts)) list.push(...bundle.artifacts);

  return toLlmCaptureList(list);
}

export function wireDiagnosticsView({
  root = document,
  commandHost = createCliWorkerAdapter({ forceInProcess: typeof Worker !== "function" }),
  onBuildComplete,
  onBundleLoaded,
  onBuildStateReset,
  onBundleStateReset,
} = {}) {
  const buildSpecPath = root.querySelector("#build-spec-path");
  const buildSpecJson = root.querySelector("#build-spec-json");
  const buildOutDir = root.querySelector("#build-out-dir");
  const buildRunButton = root.querySelector("#build-run");
  const buildLoadButton = root.querySelector("#build-load");
  const buildSendBundle = root.querySelector("#build-send-bundle");
  const buildDownloadButton = root.querySelector("#build-download");
  const buildClearButton = root.querySelector("#build-clear");
  const buildStatus = root.querySelector("#build-status");
  const buildOutput = root.querySelector("#build-output");
  const buildValidation = root.querySelector("#build-validation");

  const bundleInput = root.querySelector("#bundle-file");
  const bundleManifestInput = root.querySelector("#bundle-manifest-file");
  const bundleLoadLast = root.querySelector("#bundle-load-last");
  const bundleClear = root.querySelector("#bundle-clear");
  const bundleStatus = root.querySelector("#bundle-status");
  const bundleSchemas = root.querySelector("#bundle-schemas");
  const bundleManifest = root.querySelector("#bundle-manifest");
  const bundleSpecEdit = root.querySelector("#bundle-spec-edit");
  const bundleSpecErrors = root.querySelector("#bundle-spec-errors");
  const bundleApplySpec = root.querySelector("#bundle-apply-spec");
  const bundleSendSpec = root.querySelector("#bundle-send-spec");
  const bundleDownloadSpec = root.querySelector("#bundle-download-spec");
  const bundleIntent = root.querySelector("#bundle-intent");
  const bundlePlan = root.querySelector("#bundle-plan");
  const bundleConfigurator = root.querySelector("#bundle-configurator");
  const bundleArtifacts = root.querySelector("#bundle-artifacts");

  const configBudgetJson = root.querySelector("#config-budget-json");
  const configPriceListJson = root.querySelector("#config-price-list-json");
  const configReceiptJson = root.querySelector("#config-receipt-json");

  let bundleReview = null;
  let buildOrchestrator = null;

  const budgetPanels = wireBudgetPanels({
    elements: {
      configBudget: configBudgetJson,
      configPriceList: configPriceListJson,
      configReceipt: configReceiptJson,
    },
    mode: "live",
  });

  buildOrchestrator = wireBuildOrchestrator({
    elements: {
      specPathInput: buildSpecPath,
      specJsonInput: buildSpecJson,
      outDirInput: buildOutDir,
      buildButton: buildRunButton,
      loadButton: buildLoadButton,
      sendBundleButton: buildSendBundle,
      downloadButton: buildDownloadButton,
      clearButton: buildClearButton,
      statusEl: buildStatus,
      outputEl: buildOutput,
      validationList: buildValidation,
    },
    commandHost,
    onBuildComplete: (payload) => {
      budgetPanels.setFromArtifacts({
        snapshot: payload?.snapshot,
        response: payload?.snapshot?.response,
      });
      if (typeof onBuildComplete === "function") {
        onBuildComplete(payload);
      }
    },
  });

  bundleReview = wireBundleReview({
    elements: {
      bundleInput,
      manifestInput: bundleManifestInput,
      loadLastButton: bundleLoadLast,
      clearButton: bundleClear,
      statusEl: bundleStatus,
      schemaList: bundleSchemas,
      manifestOutput: bundleManifest,
      specTextarea: bundleSpecEdit,
      specErrors: bundleSpecErrors,
      applySpecButton: bundleApplySpec,
      sendSpecButton: bundleSendSpec,
      downloadSpecButton: bundleDownloadSpec,
      intentOutput: bundleIntent,
      planOutput: bundlePlan,
      configuratorOutput: bundleConfigurator,
      artifactsContainer: bundleArtifacts,
    },
    onSpec: ({ specText }) => {
      if (buildSpecJson) {
        buildSpecJson.value = specText;
        buildSpecJson.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (buildSpecPath) {
        buildSpecPath.value = "";
        buildSpecPath.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    onBundleLoaded: (payload) => {
      if (payload?.source === "clear") {
        budgetPanels.setData();
      } else {
        budgetPanels.setFromArtifacts({ bundle: payload?.bundle });
      }
      if (typeof onBundleLoaded === "function") {
        onBundleLoaded(payload);
      }
    },
  });

  buildRunButton?.addEventListener("click", () => {
    onBuildStateReset?.();
  });
  buildClearButton?.addEventListener("click", () => {
    onBuildStateReset?.();
  });
  bundleClear?.addEventListener("click", () => {
    onBundleStateReset?.();
  });
  buildSendBundle?.addEventListener("click", () => bundleReview?.loadLastBuild?.());
  budgetPanels.refresh();

  function setBuildSpecText(specText, { source = "design", resetOutput = true } = {}) {
    if (buildSpecJson) {
      buildSpecJson.value = specText;
      buildSpecJson.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (buildSpecPath) {
      buildSpecPath.value = "";
      buildSpecPath.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (resetOutput) {
      if (buildOutput) {
        buildOutput.textContent = "No build output yet.";
      }
      const label = source === "design-preview" ? "Design brief" : "Design";
      if (buildStatus) {
        buildStatus.textContent = `${label} spec loaded. Run Build to refresh output.`;
      }
    }
  }

  return {
    runBuild: () => buildOrchestrator?.runBuild?.(),
    runBuildWithSpec: (specText) => {
      buildOrchestrator?.setSpecOverride?.(specText);
      return buildOrchestrator?.runBuild?.();
    },
    loadLastBundle: () => bundleReview?.loadLastBuild?.(),
    setBuildSpecText,
  };
}
