// M6 — End-to-end sandbox bridge launch smoke.
//
// Proves the user's workflow end to end through the real MCP tool surface:
//   1. The loopback sandbox bridge is running.
//   2. serve-ui serves the canonical index_c.html with the bridge port injected.
//   3. The browser bridge client connects.
//   4. ak_push_to_ui compiles a BuildSpec and delivers the bundle over the bridge.
//   5. The UI hydrates Design and the Gameplay tab renders the run over precomputed
//      tickFrames (no live ticking).
//
// The bridge server, the push tool, and the browser all share the same Node
// bridge-server singleton in this worker; the real browser connects to it over WS.

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { startServeUi, stopProcess, resolveFixturePath } from "./helpers/serve-ui.mjs";
import {
  startSandboxBridgeServer,
  stopSandboxBridgeServer,
  getSandboxBridgeState,
} from "../../packages/adapters-cli/src/mcp/bridge-server.mjs";
import { pushToUiTools } from "../../packages/adapters-cli/src/mcp/tools/push-to-ui.mjs";

const SPEC_PATH = resolveFixturePath(
  "tests",
  "fixtures",
  "artifacts",
  "build-spec-v1-configurator.json",
);
const pushTool = pushToUiTools.find((tool) => tool.name === "ak_push_to_ui");

test("ak_push_to_ui delivers a compiled bundle to index_c.html and the Gameplay tab renders the run", async ({ page }) => {
  const bridge = await startSandboxBridgeServer({ port: 0 });
  const served = await startServeUi({ bridgePort: bridge.port });

  try {
    await page.goto(served.url);

    // The browser bridge client announces ak.uiReady.v1 once main.js loads.
    await expect
      .poll(() => getSandboxBridgeState().connectedClients, { timeout: 15_000 })
      .toBe(1);

    // Push a real BuildSpec through the MCP tool. requireClient:true means the
    // browser must be connected and must ACK successful load (ak.bundleLoaded.v1).
    const buildSpec = JSON.parse(await readFile(SPEC_PATH, "utf8"));
    const result = await pushTool.handler({
      buildSpec,
      requireClient: true,
      targetTab: "gameplay",
    });

    expect(result.ok).toBe(true);
    expect(result.bundle.artifactCount).toBeGreaterThan(0);
    // A delivered client id proves the browser received AND successfully loaded the bundle.
    expect(result.bridge.deliveredClientIds.length).toBe(1);
    expect(result.bridge.timedOutClientIds.length).toBe(0);

    // The bundle drove the UI: Design hydrated and Gameplay is active with a rendered run.
    await expect(page.locator('[data-tab-panel="gameplay"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#gameplay-status")).not.toContainText("No run loaded", {
      timeout: 10_000,
    });
  } finally {
    await stopProcess(served.proc);
    await stopSandboxBridgeServer();
  }
});

test("ak_push_to_ui pre-stages a bundle that a later-connecting UI replays", async ({ page }) => {
  const bridge = await startSandboxBridgeServer({ port: 0 });
  const served = await startServeUi({ bridgePort: bridge.port });

  try {
    // Pre-stage the bundle BEFORE any UI is connected (requireClient:false).
    const buildSpec = JSON.parse(await readFile(SPEC_PATH, "utf8"));
    const staged = await pushTool.handler({
      buildSpec,
      requireClient: false,
      targetTab: "gameplay",
    });
    expect(staged.ok).toBe(true);
    expect(staged.bridge.deliveredClientIds.length).toBe(0); // no client yet

    // Now open the UI — the bridge replays the staged bundle within its window.
    await page.goto(served.url);
    await expect(page.locator('[data-tab-panel="gameplay"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("#gameplay-phaser-host canvas")).toBeVisible({ timeout: 20_000 });
  } finally {
    await stopProcess(served.proc);
    await stopSandboxBridgeServer();
  }
});
