/**
 * M8 — sandbox-bridge-client unit tests
 *
 * Mocks the global WebSocket constructor so the client can run in Node.
 * Tests the happy-path: bundle received → __ak_loadGameplayBundle called →
 * ak.bundleLoaded.v1 ACK sent back.
 */

import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal mock WebSocket
// ---------------------------------------------------------------------------

function createMockWebSocket() {
  const OPEN = 1;
  let openHandler = null;
  let messageHandler = null;
  let closeHandler = null;
  const sent = [];

  const ws = {
    readyState: OPEN,
    OPEN,
    send(data) { sent.push(data); },
    close() { closeHandler?.({ code: 1000, reason: "" }); },
    addEventListener(event, fn) {
      if (event === "open") openHandler = fn;
      if (event === "message") messageHandler = fn;
      if (event === "close") closeHandler = fn;
    },
    // Test helpers
    _triggerOpen() { openHandler?.(); },
    _triggerMessage(payload) { messageHandler?.({ data: JSON.stringify(payload) }); },
    _triggerClose() { closeHandler?.({ code: 1000, reason: "" }); },
    _sent: sent,
  };
  return ws;
}

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function installMockGlobals({ loadFn, setTabFn } = {}) {
  globalThis.__ak_loadGameplayBundle = loadFn ?? (() => true);
  globalThis.__ak_setActiveTab = setTabFn ?? (() => {});
}

function clearMockGlobals() {
  delete globalThis.__ak_loadGameplayBundle;
  delete globalThis.__ak_setActiveTab;
}

// ---------------------------------------------------------------------------

test("sandbox-bridge-client: bundle received → loadGameplayBundle called → ak.bundleLoaded.v1 sent", async () => {
  let mockWs = null;
  globalThis.WebSocket = function MockWebSocket(url) {
    mockWs = createMockWebSocket();
    return mockWs;
  };
  globalThis.WebSocket.OPEN = 1;

  const receivedBundles = [];
  const receivedOptions = [];

  installMockGlobals({
    // D4: __ak_loadGameplayBundle now receives { targetTab } option — tab routing moved here
    loadFn: (bundle, opts) => { receivedBundles.push(bundle); receivedOptions.push(opts); return true; },
    setTabFn: () => {},
  });

  try {
    const { connectSandboxBridge, disconnectSandboxBridge } = await import(
      "../../packages/ui-web/src/sandbox-bridge-client.js?t=" + Date.now()
    );

    connectSandboxBridge({ port: 38487 });
    mockWs._triggerOpen();

    const bundle = { simConfig: { schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1, meta: { id: "sc-test" } } };
    const messageId = "msg_001";

    mockWs._triggerMessage({
      type: "ak.gameplayBundle.v1",
      id: messageId,
      targetTab: "gameplay",
      payload: { bundle, source: { tool: "ak_sandbox_push_ui" } },
    });

    // Allow async handleBundle to complete
    await new Promise((r) => setTimeout(r, 20));

    // Bundle was passed to loadGameplayBundle
    assert.equal(receivedBundles.length, 1);
    assert.deepEqual(receivedBundles[0], bundle);

    // D4: targetTab is forwarded as an option to __ak_loadGameplayBundle (tab routing moved there)
    assert.equal(receivedOptions[0]?.targetTab, "gameplay", "targetTab option must be forwarded to loadGameplayBundle");

    // ACK was sent back
    const ackRaw = mockWs._sent.find((s) => {
      try { return JSON.parse(s)?.type === "ak.bundleLoaded.v1"; } catch { return false; }
    });
    assert.ok(ackRaw, "ak.bundleLoaded.v1 ACK must be sent");
    const ack = JSON.parse(ackRaw);
    assert.equal(ack.messageId, messageId);

    disconnectSandboxBridge();
  } finally {
    clearMockGlobals();
    delete globalThis.WebSocket;
  }
});

test("sandbox-bridge-client: ak.uiReady.v1 is sent on connect", async () => {
  let mockWs = null;
  globalThis.WebSocket = function MockWebSocket() {
    mockWs = createMockWebSocket();
    return mockWs;
  };
  globalThis.WebSocket.OPEN = 1;

  installMockGlobals();
  try {
    const { connectSandboxBridge, disconnectSandboxBridge } = await import(
      "../../packages/ui-web/src/sandbox-bridge-client.js?t=" + Date.now()
    );

    connectSandboxBridge({ port: 38487 });
    mockWs._triggerOpen();
    await new Promise((r) => setTimeout(r, 10));

    const readyMsg = mockWs._sent.map((s) => {
      try { return JSON.parse(s); } catch { return null; }
    }).find((m) => m?.type === "ak.uiReady.v1");

    assert.ok(readyMsg, "ak.uiReady.v1 must be sent on open");
    assert.ok(typeof readyMsg.clientId === "string" && readyMsg.clientId.length > 0);
    assert.ok("loadGameplayBundle" in (readyMsg.capabilities ?? {}));

    disconnectSandboxBridge();
  } finally {
    clearMockGlobals();
    delete globalThis.WebSocket;
  }
});
