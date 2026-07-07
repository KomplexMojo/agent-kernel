/**
 * ak_push_to_ui openBrowser launch — MCP-driven UI bootstrap
 *
 * The push tool must be able to launch the canonical UI (serve index_c.html +
 * open the default browser) and pre-stage the bundle so the UI loads it on
 * connect, instead of requiring a browser session to already exist.
 *
 * Side effects (server spawn, browser open) are disabled here via
 * AK_DISABLE_UI_LAUNCH=1; the tests assert the structured result contract.
 */

import assert from "node:assert/strict";

const MINIMAL_BUNDLE = {
  schema: "agent-kernel/GameplayBundle",
  schemaVersion: 1,
  meta: { id: "bundle_launch_test", runId: "run_launch_test" },
  artifacts: [
    { schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1, meta: { id: "sim_launch_test" } },
  ],
  tickFrames: [],
};

async function importPushToUi() {
  const { executePushToUi } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs"
  );
  return executePushToUi;
}

test("openBrowser: true succeeds with no connected client and reports the canonical UI url", async () => {
  process.env.AK_DISABLE_UI_LAUNCH = "1";
  delete process.env.AK_UI_HOST;
  delete process.env.AK_UI_PORT;
  const executePushToUi = await importPushToUi();

  const result = await executePushToUi({
    bundle: MINIMAL_BUNDLE,
    openBrowser: true,
  });

  // openBrowser implies requireClient: false — must not fail on 0 clients
  assert.equal(result.ok, true, `expected ok result, got: ${JSON.stringify(result)}`);
  assert.equal(result.command, "push-to-ui");

  // The launch report must always carry the canonical URL, even when side
  // effects are disabled, so callers can surface it.
  assert.ok(result.ui, "result must include a ui launch report when openBrowser is true");
  assert.ok(
    result.ui.url.endsWith("/packages/ui-web/index_c.html"),
    `ui.url must target the canonical entry, got: ${result.ui.url}`,
  );
  assert.equal(result.ui.entry, "index_c.html");
  assert.equal(result.ui.opened, false, "AK_DISABLE_UI_LAUNCH=1 must skip the browser open");
  assert.equal(result.ui.serverSpawned, false, "AK_DISABLE_UI_LAUNCH=1 must skip the server spawn");
});

test("openBrowser: true pre-stages the bundle for replay when the UI connects", async () => {
  process.env.AK_DISABLE_UI_LAUNCH = "1";
  const executePushToUi = await importPushToUi();
  const { getSandboxBridgeState } = await import(
    "../../packages/adapters-cli/src/mcp/bridge-server.mjs"
  );

  const result = await executePushToUi({
    bundle: MINIMAL_BUNDLE,
    openBrowser: true,
    correlationId: "corr_launch_prestage",
  });

  assert.equal(result.ok, true);
  assert.equal(result.correlationId, "corr_launch_prestage");

  const state = getSandboxBridgeState();
  assert.ok(state.latestBundle, "bundle must be stored for the bridge replay window");
  assert.equal(state.latestBundle.payload.bundle.meta.id, "bundle_launch_test");
});

test("openBrowser url honors AK_UI_HOST / AK_UI_PORT overrides", async () => {
  process.env.AK_DISABLE_UI_LAUNCH = "1";
  process.env.AK_UI_HOST = "127.0.0.1";
  process.env.AK_UI_PORT = "9123";
  const executePushToUi = await importPushToUi();

  const result = await executePushToUi({ bundle: MINIMAL_BUNDLE, openBrowser: true });

  assert.equal(result.ok, true);
  assert.equal(result.ui.url, "http://127.0.0.1:9123/packages/ui-web/index_c.html");

  delete process.env.AK_UI_HOST;
  delete process.env.AK_UI_PORT;
});

test("without openBrowser the result shape is unchanged (no ui field, requireClient still enforced)", async () => {
  const executePushToUi = await importPushToUi();

  const denied = await executePushToUi({ bundle: MINIMAL_BUNDLE });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "SANDBOX_UI_NOT_CONNECTED");

  const prestaged = await executePushToUi({ bundle: MINIMAL_BUNDLE, requireClient: false });
  assert.equal(prestaged.ok, true);
  assert.equal(prestaged.ui, undefined, "ui launch report must only appear when openBrowser is true");
});

// ## TODO: Test Permutations
// - openBrowser: true with a live /health responder must not spawn a second serve-ui process (serverSpawned: false)
// - openBrowser: true with no /health responder and AK_DISABLE_UI_LAUNCH unset must report serverSpawned: true (needs spawn stub)
// - openBrowser: true combined with explicit requireClient: true must still succeed (openBrowser wins)
// - openBrowser: true with bundleNotFound outDir must fail before any launch side effect
// - openBrowser: true when the bridge reports startFailed must return SANDBOX_BRIDGE_START_FAILED and skip the launch
