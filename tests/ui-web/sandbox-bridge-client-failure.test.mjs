/**
 * M8 — sandbox-bridge-client failure tests
 *
 * Covers the case where __ak_loadGameplayBundle throws: the client must send
 * ak.bundleLoadFailed.v1 with code LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE.
 */

import assert from "node:assert/strict";

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
    close() { closeHandler?.({ code: 1000 }); },
    addEventListener(event, fn) {
      if (event === "open") openHandler = fn;
      if (event === "message") messageHandler = fn;
      if (event === "close") closeHandler = fn;
    },
    _triggerOpen() { openHandler?.(); },
    _triggerMessage(payload) { messageHandler?.({ data: JSON.stringify(payload) }); },
    _sent: sent,
  };
  return ws;
}

test("sandbox-bridge-client: throwing loadGameplayBundle → ak.bundleLoadFailed.v1 with LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE", async () => {
  let mockWs = null;
  globalThis.WebSocket = function MockWebSocket() {
    mockWs = createMockWebSocket();
    return mockWs;
  };
  globalThis.WebSocket.OPEN = 1;

  globalThis.__ak_loadGameplayBundle = () => {
    const err = new Error("Load unavailable");
    err.code = "LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE";
    throw err;
  };
  globalThis.__ak_setActiveTab = () => {};

  try {
    const { connectSandboxBridge, disconnectSandboxBridge } = await import(
      "../../packages/ui-web/src/sandbox-bridge-client.js?t=" + Date.now()
    );

    connectSandboxBridge({ port: 38487 });
    mockWs._triggerOpen();

    const messageId = "msg_fail_001";
    mockWs._triggerMessage({
      type: "ak.gameplayBundle.v1",
      id: messageId,
      targetTab: "gameplay",
      payload: { bundle: {}, source: { tool: "test" } },
    });

    await new Promise((r) => setTimeout(r, 20));

    const failRaw = mockWs._sent.find((s) => {
      try { return JSON.parse(s)?.type === "ak.bundleLoadFailed.v1"; } catch { return false; }
    });
    assert.ok(failRaw, "ak.bundleLoadFailed.v1 must be sent on load failure");
    const fail = JSON.parse(failRaw);
    assert.equal(fail.messageId, messageId);
    assert.equal(fail.error?.code, "LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE");

    disconnectSandboxBridge();
  } finally {
    delete globalThis.__ak_loadGameplayBundle;
    delete globalThis.__ak_setActiveTab;
    delete globalThis.WebSocket;
  }
});

test("sandbox-bridge-client: missing __ak_loadGameplayBundle → ak.bundleLoadFailed.v1", async () => {
  let mockWs = null;
  globalThis.WebSocket = function MockWebSocket() {
    mockWs = createMockWebSocket();
    return mockWs;
  };
  globalThis.WebSocket.OPEN = 1;

  // Deliberately not setting __ak_loadGameplayBundle
  delete globalThis.__ak_loadGameplayBundle;
  delete globalThis.__ak_setActiveTab;

  try {
    const { connectSandboxBridge, disconnectSandboxBridge } = await import(
      "../../packages/ui-web/src/sandbox-bridge-client.js?t=" + Date.now()
    );

    connectSandboxBridge({ port: 38487 });
    mockWs._triggerOpen();

    mockWs._triggerMessage({
      type: "ak.gameplayBundle.v1",
      id: "msg_no_fn",
      targetTab: "gameplay",
      payload: { bundle: {}, source: { tool: "test" } },
    });

    await new Promise((r) => setTimeout(r, 20));

    const failRaw = mockWs._sent.find((s) => {
      try { return JSON.parse(s)?.type === "ak.bundleLoadFailed.v1"; } catch { return false; }
    });
    assert.ok(failRaw, "ak.bundleLoadFailed.v1 must be sent when load fn is missing");
    const fail = JSON.parse(failRaw);
    assert.equal(fail.error?.code, "LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE");

    disconnectSandboxBridge();
  } finally {
    delete globalThis.WebSocket;
  }
});
