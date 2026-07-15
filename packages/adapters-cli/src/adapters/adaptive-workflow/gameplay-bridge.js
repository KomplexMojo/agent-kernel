import { getSandboxBridgeState, pushGameplayBundle } from "../../mcp/bridge-server.mjs";

const RECEIPT_SCHEMA = "agent-kernel/AdaptiveWorkflowExecutionReceipt";

function executionError(code, message) {
  return Object.assign(new Error(message), { code, category: "execution", safeToRetry: false });
}

// Connector: turns a validated AdaptiveWorkflowAgent design output into a
// playable GameplayBundle and pushes it to the live browser UI via the sandbox
// bridge. Runs as an allowlisted controlled-execution operation, so it fits the
// AWA runner's execution port without loosening the execution boundary.
//
// Dependencies are injected so the operation is fully unit-testable without a
// real build pipeline or WebSocket server:
//   assembleSpec: buildBuildSpecFromSummary   (summary -> { ok, spec, errors })
//   compile:      compileBuildSpecToGameplayBundle  (BuildSpec -> { spec, artifacts })
//   push:         pushGameplayBundle           (envelope -> { deliveredClientIds, timedOutClientIds })
//   bridgeState:  getSandboxBridgeState        (-> { connectedClients, startFailed })
export function createGameplayBridgeOperation({
  assembleSpec,
  compile,
  push = pushGameplayBundle,
  bridgeState = getSandboxBridgeState,
  onBundle,
  targetTab = "gameplay",
  requireClient = false,
  clock = () => new Date().toISOString(),
  makeMessageId = (runId) => `awa_${runId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
} = {}) {
  if (typeof assembleSpec !== "function") throw new Error("createGameplayBridgeOperation requires an assembleSpec function.");
  if (typeof compile !== "function") throw new Error("createGameplayBridgeOperation requires a compile function.");

  return async function gameplayBridge({ runId, generated, selectedStrategy } = {}) {
    const built = assembleSpec({ summary: generated, runId, createdAt: clock(), source: "adaptive-workflow" });
    if (!built || built.ok !== true || !built.spec) {
      throw executionError("buildspec_failed", `Could not assemble a BuildSpec from the workflow output: ${(built?.errors || []).join("; ") || "unknown error"}`);
    }

    const bundle = await compile(built.spec);
    if (!bundle || typeof bundle !== "object") {
      throw executionError("bundle_compile_failed", "The build pipeline returned no gameplay bundle.");
    }
    if (typeof onBundle === "function") await onBundle(bundle, { runId });

    const state = (typeof bridgeState === "function" ? bridgeState() : null) || {};
    if (state.startFailed) {
      throw executionError("bridge_start_failed", "The sandbox bridge server failed to start (port may be in use).");
    }
    if (requireClient && (state.connectedClients || 0) === 0) {
      throw executionError("ui_not_connected", "No browser UI is connected to the sandbox bridge. Open the UI or pass requireClient=false to pre-stage the bundle.");
    }

    const messageId = makeMessageId(runId);
    const envelope = {
      type: "ak.gameplayBundle.v1",
      id: messageId,
      createdAt: clock(),
      targetTab,
      payload: { bundle, source: { tool: "ak_workflow_run", strategyId: selectedStrategy?.strategyId ?? null } },
    };

    const pushResult = (await push(envelope)) || {};
    return {
      schema: RECEIPT_SCHEMA,
      schemaVersion: 1,
      runId,
      operation: "gameplay_bridge",
      strategyId: selectedStrategy?.strategyId ?? null,
      messageId,
      bundleArtifactCount: Array.isArray(bundle.artifacts) ? bundle.artifacts.length : 0,
      connectedClients: state.connectedClients || 0,
      deliveredClientIds: Array.isArray(pushResult.deliveredClientIds) ? pushResult.deliveredClientIds : [],
      timedOutClientIds: Array.isArray(pushResult.timedOutClientIds) ? pushResult.timedOutClientIds : [],
    };
  };
}
