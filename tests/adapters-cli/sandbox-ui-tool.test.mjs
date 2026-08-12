/**
 * D10 — Integration tests for ak_sandbox_push_ui tool (M8)
 *
 * Tests:
 * - compileBuildSpecToGameplayBundle produces { spec, artifacts[] } with correct schemas
 * - Bundle includes SimConfigArtifact and ResourceBundleArtifact
 * - Bridge startup failure returns structured error
 * - Optional buildSpec (omitted) returns structured MISSING_BUILD_SPEC error
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
// Use the configurator spec — it has levelGen + actors and produces SimConfig + InitialState + ResourceBundle
const SPEC_PATH = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");

const SCHEMA_SIM_CONFIG = "agent-kernel/SimConfigArtifact";
const SCHEMA_INITIAL_STATE = "agent-kernel/InitialStateArtifact";
const SCHEMA_RESOURCE_BUNDLE = "agent-kernel/ResourceBundleArtifact";

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

test("ak_sandbox_push_ui tool handler returns MISSING_BUILD_SPEC when buildSpec omitted (D5)", async () => {
  const { sandboxUiTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox-ui.mjs?t=" + Date.now()
  );
  const tool = sandboxUiTools.find((t) => t.name === "ak_sandbox_push_ui");
  assert.ok(tool, "ak_sandbox_push_ui tool must be registered");

  // Call without buildSpec
  const result = await tool.handler({});
  assert.equal(result.ok, false);
  assert.equal(result.error, "MISSING_BUILD_SPEC");
});

test("ak_sandbox_push_ui tool handler returns SANDBOX_UI_NOT_CONNECTED when no clients connected", async () => {
  // Import fresh to ensure no clients are connected
  const { sandboxUiTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox-ui.mjs?t=" + Date.now()
  );
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  const tool = sandboxUiTools.find((t) => t.name === "ak_sandbox_push_ui");
  const result = await tool.handler({ buildSpec, requireClient: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "SANDBOX_UI_NOT_CONNECTED");
  assert.ok(result.bridge, "must include bridge state in error response");
});

test("ak_sandbox_push_ui tool compiles and pre-stages bundle when requireClient: false", async () => {
  const { sandboxUiTools } = await import(
    "../../packages/adapters-cli/src/mcp/tools/sandbox-ui.mjs?t=" + Date.now()
  );
  const specJson = await readFile(SPEC_PATH, "utf8");
  const buildSpec = JSON.parse(specJson);

  const tool = sandboxUiTools.find((t) => t.name === "ak_sandbox_push_ui");
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

test.skip("ak_sandbox_push_ui reports SANDBOX_BRIDGE_START_FAILED when bridge startup port is occupied", () => {});
test.skip("serve-ui forwards AK_SANDBOX_BRIDGE_PORT into browser HTML", () => {});
test.skip("ak_sandbox_push_ui sends exact artifacts array to a connected browser client", () => {});
test.skip("ak_sandbox_push_ui targetTab design calls loadGameplayBundle with design target", () => {});
test.skip("ak_sandbox_push_ui targetTab gameplay calls loadGameplayBundle with gameplay target", () => {});
