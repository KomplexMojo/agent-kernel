/**
 * Integration tests for the bridge push-to-UI tool.
 *
 * M1 (sandbox consolidation): the tool is renamed `ak_sandbox_push_ui` → `ak_push_to_ui`
 * (Plan O3). M2 implements the rename in packages/adapters-cli/src/mcp/tools/push-to-ui.mjs
 * (formerly sandbox-ui.mjs) and registers it on the MCP server.
 *
 * Tests:
 * - compileBuildSpecToGameplayBundle produces { spec, artifacts[] } with correct schemas
 * - Bundle includes SimConfigArtifact, InitialStateArtifact, and ResourceBundleArtifact
 * - The tool is exported under the new name `ak_push_to_ui`; the legacy name is gone
 * - Optional buildSpec (omitted) returns structured MISSING_BUILD_SPEC error
 * - requireClient:true with no clients returns SANDBOX_UI_NOT_CONNECTED
 * - requireClient:false compiles and pre-stages the bundle
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
// Use the configurator spec — it has levelGen + actors and produces SimConfig + InitialState + ResourceBundle
const SPEC_PATH = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");

// The renamed bridge tool (Plan O3). The legacy name must no longer be exported.
const PUSH_TOOL_NAME = "ak_push_to_ui";
const LEGACY_PUSH_TOOL_NAME = "ak_sandbox_push_ui";

const SCHEMA_SIM_CONFIG = "agent-kernel/SimConfigArtifact";
const SCHEMA_INITIAL_STATE = "agent-kernel/InitialStateArtifact";
const SCHEMA_RESOURCE_BUNDLE = "agent-kernel/ResourceBundleArtifact";

// Import the bridge tool module fresh (cache-busted) and return the push tool by its new name.
async function loadPushTool() {
  const { pushToUiTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/push-to-ui.mjs?t=" + Date.now()
  );
  const tool = pushToUiTools.find((t) => t.name === PUSH_TOOL_NAME);
  assert.ok(tool, `${PUSH_TOOL_NAME} tool must be registered (renamed from ${LEGACY_PUSH_TOOL_NAME})`);
  return { pushToUiTools, tool };
}

test("compileBuildSpecToGameplayBundle returns { spec, artifacts[] } with SimConfig and ResourceBundle", async () => {
  const { compileBuildSpecToGameplayBundle } = await import(
    "../../packages/adapters-cli/src/cli/ak-impl.mjs"
  );
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  const bundle = await compileBuildSpecToGameplayBundle(buildSpec);

  // Must return a bundle-shaped object
  assert.ok(bundle && typeof bundle === "object", "must return an object");
  assert.ok(bundle.spec && typeof bundle.spec === "object", "bundle.spec must be present");
  assert.ok(Array.isArray(bundle.artifacts), "bundle.artifacts must be an array");
  assert.ok(bundle.artifacts.length > 0, "bundle.artifacts must not be empty");

  // Must include SimConfigArtifact
  const simConfig = bundle.artifacts.find((a) => a?.schema === SCHEMA_SIM_CONFIG);
  assert.ok(simConfig, `artifacts must include a ${SCHEMA_SIM_CONFIG}`);
  assert.equal(simConfig.schemaVersion, 1);
  assert.ok(simConfig.meta?.id, "SimConfigArtifact must have meta.id");

  // Must include ResourceBundleArtifact
  const resourceBundle = bundle.artifacts.find((a) => a?.schema === SCHEMA_RESOURCE_BUNDLE);
  assert.ok(resourceBundle, `artifacts must include a ${SCHEMA_RESOURCE_BUNDLE}`);
});

test("compileBuildSpecToGameplayBundle bundle includes InitialStateArtifact (D2)", async () => {
  const { compileBuildSpecToGameplayBundle } = await import(
    "../../packages/adapters-cli/src/cli/ak-impl.mjs?t=" + Date.now()
  );
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  const bundle = await compileBuildSpecToGameplayBundle(buildSpec);
  const initialState = bundle.artifacts.find((a) => a?.schema === SCHEMA_INITIAL_STATE);
  assert.ok(initialState, `artifacts must include a ${SCHEMA_INITIAL_STATE} (D2)`);
  assert.ok(initialState.meta?.id, "InitialStateArtifact must have meta.id");
});

test("bridge push tool is exported as ak_push_to_ui and the legacy name is removed (O3)", async () => {
  const { pushToUiTools, tool } = await loadPushTool();
  assert.equal(tool.name, PUSH_TOOL_NAME);
  const names = pushToUiTools.map((t) => t.name);
  assert.ok(
    !names.includes(LEGACY_PUSH_TOOL_NAME),
    `legacy tool name ${LEGACY_PUSH_TOOL_NAME} must no longer be exported (got: ${names.join(", ")})`,
  );
});

test("ak_push_to_ui tool handler returns MISSING_BUILD_SPEC when buildSpec omitted (D5)", async () => {
  const { tool } = await loadPushTool();

  // Call without buildSpec
  const result = await tool.handler({});
  assert.equal(result.ok, false);
  assert.equal(result.error, "MISSING_BUILD_SPEC");
});

test("ak_push_to_ui tool handler returns SANDBOX_UI_NOT_CONNECTED when no clients connected", async () => {
  const { tool } = await loadPushTool();
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  const result = await tool.handler({ buildSpec, requireClient: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "SANDBOX_UI_NOT_CONNECTED");
  assert.ok(result.bridge, "must include bridge state in error response");
});

test("ak_push_to_ui tool compiles and pre-stages bundle when requireClient: false", async () => {
  const { tool } = await loadPushTool();
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  const result = await tool.handler({ buildSpec, requireClient: false });

  assert.equal(result.ok, true, `expected ok:true but got: ${result.error ?? result.message}`);
  assert.ok(result.bundle, "must include bundle summary in response");
  assert.ok(typeof result.bundle.artifactCount === "number" && result.bundle.artifactCount > 0,
    "must report artifact count > 0");
  assert.ok(result.bundle.simConfigArtifactId, "must include simConfigArtifactId");
  assert.ok(result.bundle.resourceBundleArtifactId, "must include resourceBundleArtifactId");
  // No clients → deliveredClientIds is empty, timedOutClientIds is empty
  assert.deepEqual(result.bridge.deliveredClientIds, []);
  assert.deepEqual(result.bridge.timedOutClientIds, []);
});

test("ak_push_to_ui with openBrowser:true returns the canonical index_c.html URL (O1, M3)", async () => {
  const { tool } = await loadPushTool();
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  // Disable the real serve/open side effects so the test never spawns a server or browser.
  const prev = process.env.AK_DISABLE_UI_LAUNCH;
  process.env.AK_DISABLE_UI_LAUNCH = "1";
  try {
    const result = await tool.handler({ buildSpec, openBrowser: true });
    assert.equal(result.ok, true, `expected ok:true but got: ${result.error ?? result.message}`);
    assert.ok(result.ui, "openBrowser:true must include a ui block");
    assert.equal(result.ui.entry, "index_c.html");
    assert.match(result.ui.url, /^http:\/\/[^/]+\/packages\/ui-web\/index_c\.html$/);
    // Launch disabled → nothing was opened or spawned.
    assert.equal(result.ui.opened, false);
  } finally {
    if (prev === undefined) delete process.env.AK_DISABLE_UI_LAUNCH;
    else process.env.AK_DISABLE_UI_LAUNCH = prev;
  }
});

/*
## TODO: Test Permutations
- Bridge startup failure: mock port in use, assert SANDBOX_BRIDGE_START_FAILED error from tool
- AK_SANDBOX_BRIDGE_PORT env var forwarded to browser: serve-ui.mjs injects correct port into HTML
- Bundle round-trip: connect mock browser client, push bundle, verify client receives exact artifacts[]
- targetTab: "design" → loadGameplayBundle called with { targetTab: "design" }
- targetTab: "gameplay" → loadGameplayBundle called with { targetTab: "gameplay" }
- openBrowser flag (O1): requireClient:false + openBrowser:true returns the served index_c.html URL in the result
- openBrowser flag (O1): openBrowser omitted/false does not attempt to serve or open a browser
- correlationId is echoed back in both the ok:true and the ok:false (SANDBOX_UI_NOT_CONNECTED) responses
*/
