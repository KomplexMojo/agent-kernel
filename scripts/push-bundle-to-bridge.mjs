/**
 * Starts the sandbox bridge on port 38487 and immediately pushes the
 * gameplay bundle so connected UI clients receive it.
 *
 * Usage: node scripts/push-bundle-to-bridge.mjs <bundle-path>
 *
 * Stays alive for 30 seconds so the UI can connect and receive the replay.
 */
import { readFileSync } from "node:fs";
import { startSandboxBridgeServer, pushGameplayBundle, getSandboxBridgeState } from "../packages/adapters-cli/src/mcp/bridge-server.mjs";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("Usage: node scripts/push-bundle-to-bridge.mjs <bundle-path>");
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const PORT = 38487;

console.log(`[bridge] Starting on port ${PORT}…`);
const { port } = await startSandboxBridgeServer({ port: PORT });
console.log(`[bridge] Listening on ws://127.0.0.1:${port}/ak-sandbox`);
console.log(`[bridge] Waiting for UI to connect (reload your browser)…`);

// Poll until a client connects, then push the bundle.
async function waitAndPush() {
  for (let i = 0; i < 30; i++) {
    const { connectedClients } = getSandboxBridgeState();
    if (connectedClients > 0) {
      console.log(`[bridge] ${connectedClients} client(s) connected — pushing bundle…`);
      const envelope = {
        type: "ak.gameplayBundle.v1",
        id: `push_${Date.now().toString(36)}`,
        targetTab: "gameplay",
        payload: { bundle },
      };
      const result = await pushGameplayBundle(envelope);
      console.log(`[bridge] Delivered to: ${result.deliveredClientIds.join(", ") || "none (timed out)"}`);
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
    process.stdout.write(".");
  }
  console.log("\n[bridge] No client connected within 30s. Exiting.");
}

await waitAndPush();
// Stay alive 10 more seconds for replay window.
await new Promise(r => setTimeout(r, 10_000));
console.log("[bridge] Done. Stopping.");
process.exit(0);
