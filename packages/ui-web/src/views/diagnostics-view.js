import { wireAdapterPanel } from "../adapter-panel.js";
import { wireBuildOrchestrator } from "../build-orchestrator.js";
import { wireBundleReview } from "../bundle-review.js";
import { wireBudgetPanels } from "../budget-panels.js";
import { wireAffinityLegend } from "../affinity-legend.js";
import { wireOllamaPromptPanel } from "../ollama-panel.js";
import { wireLlmTracePanel } from "../llm-trace-panel.js";
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
  onBuildComplete,
  onBundleLoaded,
  onBuildStateReset,
  onBundleStateReset,
  onRunFromBundle,
} = {}) {
  const adapterGateway = root.querySelector("#adapter-gateway");
  const adapterRpc = root.querySelector("#adapter-rpc-url");
  const adapterAddress = root.querySelector("#adapter-address");
  const adapterPrompt = root.querySelector("#adapter-prompt");
  const adapterCid = root.querySelector("#adapter-cid");
  const adapterPath = root.querySelector("#adapter-path");
  const adapterOutput = root.querySelector("#adapter-output");
  const adapterStatus = root.querySelector("#adapter-status");
  const adapterClear = root.querySelector("#adapter-clear");
  const adapterIpfs = root.querySelector("#adapter-ipfs");
  const adapterBlockchain = root.querySelector("#adapter-blockchain");
  const adapterLlmButton = root.querySelector("#adapter-llm");
  const adapterSolver = root.querySelector("#adapter-solver");

  const ollamaMode = root.querySelector("#ollama-mode");
  const ollamaModel = root.querySelector("#ollama-model");
  const ollamaBaseUrl = root.querySelector("#ollama-base-url");
  const ollamaPrompt = root.querySelector("#ollama-prompt");
  const ollamaOptions = root.querySelector("#ollama-options");
  const ollamaRun = root.querySelector("#ollama-run");
  const ollamaClear = root.querySelector("#ollama-clear");
  const ollamaDownload = root.querySelector("#ollama-download");
  const ollamaDownloadPrompt = root.querySelector("#ollama-download-prompt");
  const ollamaStatus = root.querySelector("#ollama-status");
  const ollamaOutput = root.querySelector("#ollama-output");

  const buildBridgeUrl = root.querySelector("#build-bridge-url");
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
  const bundleRunRuntime = root.querySelector("#bundle-run-runtime");
  const bundleIntent = root.querySelector("#bundle-intent");
  const bundlePlan = root.querySelector("#bundle-plan");
  const bundleConfigurator = root.querySelector("#bundle-configurator");
  const bundleArtifacts = root.querySelector("#bundle-artifacts");

  const configBudgetJson = root.querySelector("#config-budget-json");
  const configPriceListJson = root.querySelector("#config-price-list-json");
  const configReceiptJson = root.querySelector("#config-receipt-json");
  const allocatorBudgetJson = root.querySelector("#allocator-budget-json");
  const allocatorPriceListJson = root.querySelector("#allocator-price-list-json");
  const allocatorReceiptJson = root.querySelector("#allocator-receipt-json");

  const affinityLegendToggle = root.querySelector("#affinity-legend-toggle");
  const affinityLegendPanel = root.querySelector("#affinity-legend");
  const affinityLegendKinds = root.querySelector("#legend-kinds");
  const affinityLegendExpressions = root.querySelector("#legend-expressions");
  const llmTraceStatus = root.querySelector("#llm-trace-status");
  const llmTraceCount = root.querySelector("#llm-trace-count");
  const llmTraceTurns = root.querySelector("#llm-trace-turns");
  const llmTracePrompt = root.querySelector("#llm-trace-prompt");
  const llmTraceResponseRaw = root.querySelector("#llm-trace-response-raw");
  const llmTraceResponseParsed = root.querySelector("#llm-trace-response-parsed");
  const llmTraceErrors = root.querySelector("#llm-trace-errors");
  const llmTraceSummary = root.querySelector("#llm-trace-summary");
  const llmTraceTelemetry = root.querySelector("#llm-trace-telemetry");
  const llmTraceClear = root.querySelector("#llm-trace-clear");

  const llmTracePanel = wireLlmTracePanel({
    elements: {
      statusEl: llmTraceStatus,
      countEl: llmTraceCount,
      turnSelect: llmTraceTurns,
      promptEl: llmTracePrompt,
      responseRawEl: llmTraceResponseRaw,
      responseParsedEl: llmTraceResponseParsed,
      errorsEl: llmTraceErrors,
      summaryEl: llmTraceSummary,
      telemetryEl: llmTraceTelemetry,
      clearButton: llmTraceClear,
    },
  });

  wireAdapterPanel({
    elements: {
      modeSelect: { value: "live" },
      gatewayInput: adapterGateway,
      rpcInput: adapterRpc,
      addressInput: adapterAddress,
      cidInput: adapterCid,
      ipfsPathInput: adapterPath,
      promptInput: adapterPrompt,
      outputEl: adapterOutput,
      statusEl: adapterStatus,
      clearButton: adapterClear,
      ipfsButton: adapterIpfs,
      blockchainButton: adapterBlockchain,
      llmButton: adapterLlmButton,
      solverButton: adapterSolver,
    },
  });

  wireOllamaPromptPanel({
    elements: {
      modeSelect: ollamaMode || { value: "live" },
      modelInput: ollamaModel,
      baseUrlInput: ollamaBaseUrl,
      promptInput: ollamaPrompt,
      optionsInput: ollamaOptions,
      runButton: ollamaRun,
      clearButton: ollamaClear,
      downloadButton: ollamaDownload,
      downloadPromptButton: ollamaDownloadPrompt,
      statusEl: ollamaStatus,
      outputEl: ollamaOutput,
    },
    fixturePath: "/tests/fixtures/adapters/llm-build-spec.json",
    onValidSpec: ({ specText }) => {
      if (buildSpecJson) {
        buildSpecJson.value = specText;
        buildSpecJson.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (buildSpecPath) {
        buildSpecPath.value = "";
        buildSpecPath.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
  });

  const buildOrchestrator = wireBuildOrchestrator({
    elements: {
      bridgeUrlInput: buildBridgeUrl,
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
    onBuildComplete: (payload) => {
      const captures = extractLlmCaptures({ snapshot: payload?.snapshot });
      llmTracePanel.appendCaptures(captures, { source: "Loaded build captures" });
      if (typeof onBuildComplete === "function") {
        onBuildComplete(payload);
      }
    },
  });

  const bundleReview = wireBundleReview({
    elements: {
      bundleInput,
      manifestInput: bundleManifestInput,
      loadLastButton: bundleLoadLast,
      runButton: bundleRunRuntime,
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
    onRun: ({ simConfig, initialState, affinityEffects }) => {
      if (typeof onRunFromBundle === "function") {
        onRunFromBundle({ simConfig, initialState, affinityEffects });
      }
    },
    onBundleLoaded: (payload) => {
      if (payload?.source === "clear") {
        llmTracePanel.clear({ source: "Bundle cleared" });
      } else {
        const captures = extractLlmCaptures({ bundle: payload?.bundle });
        llmTracePanel.setCaptures(captures, { source: "Loaded bundle captures" });
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

  const budgetPanels = wireBudgetPanels({
    elements: {
      configBudget: configBudgetJson,
      configPriceList: configPriceListJson,
      configReceipt: configReceiptJson,
      allocatorBudget: allocatorBudgetJson,
      allocatorPriceList: allocatorPriceListJson,
      allocatorReceipt: allocatorReceiptJson,
    },
    mode: "live",
  });
  budgetPanels.refresh();

  wireAffinityLegend({
    button: affinityLegendToggle,
    panel: affinityLegendPanel,
    kindsEl: affinityLegendKinds,
    expressionsEl: affinityLegendExpressions,
  });

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
    loadLastBundle: () => bundleReview?.loadLastBuild?.(),
    runBundle: () => bundleReview?.runFromBundle?.(),
    setBuildSpecText,
    refreshBudgetPanels: (mode = "live") => budgetPanels.refresh(mode),
    setLlmCaptures: (captures, options) => llmTracePanel.setCaptures(captures, options),
    appendLlmCaptures: (captures, options) => llmTracePanel.appendCaptures(captures, options),
    clearLlmCaptures: (options) => llmTracePanel.clear(options),
  };
}
