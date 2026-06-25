/**
 * M8 — bridge-server unit tests
 *
 * Uses port 0 (OS-assigned) to avoid collisions.
 * Each test starts its own server instance and stops it in cleanup.
 */

import assert from "node:assert/strict";
// Use Node 22's built-in WebSocket (available since Node 21) — no ws import needed in tests.
const { WebSocket } = globalThis;
import {
  startSandboxBridgeServer,
  stopSandboxBridgeServer,
  getSandboxBridgeState,
  pushGameplayBundle,
} from "../../packages/adapters-cli/src/mcp/bridge-server.mjs";

// Helper: connect a WS client, wait for open, optional send
// Uses browser-style addEventListener (Node 22 built-in WebSocket API)
function createTestClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ak-sandbox`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(e.error ?? new Error("ws error")));
  });
}

// Helper: wait for a single message matching a predicate
function waitForMessage(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      reject(new Error(`waitForMessage: timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function onMsg(event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMsg);
        resolve(msg);
      }
    }

    ws.addEventListener("message", onMsg);
  });
}

// ---------------------------------------------------------------------------

test("bridge-server: start with port 0 and bind to 127.0.0.1", async () => {
  const { port, stop } = await startSandboxBridgeServer({ port: 0 });
  try {
    assert.ok(typeof port === "number" && port > 0, "bound port must be a positive integer");
    const state = getSandboxBridgeState();
    assert.equal(state.connectedClients, 0);
    assert.equal(state.latestBundle, null);
  } finally {
    await stop();
  }
});

test("bridge-server: rejects non-loopback host", async () => {
  await assert.rejects(
    () => startSandboxBridgeServer({ host: "0.0.0.0", port: 0 }),
    /loopback only/i,
  );
});

test("bridge-server: client sends ak.uiReady.v1 and is tracked", async () => {
  const { port, stop } = await startSandboxBridgeServer({ port: 0 });
  let ws;
  try {
    ws = await createTestClient(port);
    ws.send(JSON.stringify({
      type: "ak.uiReady.v1",
      clientId: "test-client-1",
      createdAt: new Date().toISOString(),
      capabilities: { loadGameplayBundle: true, setActiveTab: true },
    }));
    // Small delay for the server to process the message
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(getSandboxBridgeState().connectedClients, 1);
  } finally {
    ws?.close();
    await new Promise((r) => setTimeout(r, 20));
    await stop();
  }
});

test("bridge-server: pushGameplayBundle delivers exact envelope to connected client", { timeout: 20_000 }, async () => {
  const { port, stop } = await startSandboxBridgeServer({ port: 0 });
  let ws;
  try {
    ws = await createTestClient(port);

    // Announce ready
    ws.send(JSON.stringify({
      type: "ak.uiReady.v1",
      clientId: "test-client-2",
      createdAt: new Date().toISOString(),
      capabilities: {},
    }));
    await new Promise((r) => setTimeout(r, 30));

    const envelope = {
      type: "ak.gameplayBundle.v1",
      id: "msg_test_001",
      createdAt: new Date().toISOString(),
      targetTab: "gameplay",
      payload: {
        bundle: { simConfig: { schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1, meta: { id: "sc1" } } },
        source: { tool: "ak_push_to_ui" },
      },
    };

    // Set up ACK + message capture before push
    const receivePromise = waitForMessage(ws, (m) => m.type === "ak.gameplayBundle.v1");

    // Push with ACK timeout — client won't ACK so expect timedOut
    const pushPromise = pushGameplayBundle(envelope);

    const received = await receivePromise;
    assert.equal(received.type, "ak.gameplayBundle.v1");
    assert.equal(received.id, "msg_test_001");
    assert.deepEqual(received.payload.source, { tool: "ak_push_to_ui" });

    // Let push finish (it will time out waiting for ACK since our test client doesn't ACK)
    const result = await pushPromise;
    assert.ok(Array.isArray(result.deliveredClientIds));
    assert.ok(Array.isArray(result.timedOutClientIds));
    // The client did not send an ACK, so it should be timed out
    assert.equal(result.timedOutClientIds.length, 1);
  } finally {
    ws?.close();
    await new Promise((r) => setTimeout(r, 20));
    await stop();
  }
}, 15_000);

test("bridge-server: pushGameplayBundle with ACK returns deliveredClientIds", async () => {
  const { port, stop } = await startSandboxBridgeServer({ port: 0 });
  let ws;
  try {
    ws = await createTestClient(port);

    ws.send(JSON.stringify({
      type: "ak.uiReady.v1",
      clientId: "test-ack-client",
      createdAt: new Date().toISOString(),
      capabilities: {},
    }));
    await new Promise((r) => setTimeout(r, 30));

    const messageId = "msg_ack_test";
    const envelope = {
      type: "ak.gameplayBundle.v1",
      id: messageId,
      createdAt: new Date().toISOString(),
      targetTab: "gameplay",
      payload: { bundle: {}, source: { tool: "test" } },
    };

    // Simulate client that ACKs immediately
    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg?.type === "ak.gameplayBundle.v1") {
        ws.send(JSON.stringify({
          type: "ak.bundleLoaded.v1",
          clientId: "test-ack-client",
          messageId: msg.id,
          loadedAt: new Date().toISOString(),
        }));
      }
    });

    const result = await pushGameplayBundle(envelope);
    assert.equal(result.deliveredClientIds.length, 1);
    assert.equal(result.timedOutClientIds.length, 0);
  } finally {
    ws?.close();
    await new Promise((r) => setTimeout(r, 20));
    await stop();
  }
}, 15_000);

test("bridge-server: replay window sends latest bundle to late-connecting client", async () => {
  const { port, stop } = await startSandboxBridgeServer({ port: 0 });
  try {
    const envelope = {
      type: "ak.gameplayBundle.v1",
      id: "msg_replay_001",
      createdAt: new Date().toISOString(),
      targetTab: "gameplay",
      payload: { bundle: {}, source: { tool: "test" } },
    };

    // Push with no clients connected
    const result = await pushGameplayBundle(envelope);
    assert.equal(result.deliveredClientIds.length, 0);

    // Now a late-connecting client should receive the replay
    const ws = await createTestClient(port);
    const receivePromise = waitForMessage(ws, (m) => m.type === "ak.gameplayBundle.v1");

    ws.send(JSON.stringify({
      type: "ak.uiReady.v1",
      clientId: "late-client",
      createdAt: new Date().toISOString(),
      capabilities: {},
    }));

    const received = await receivePromise;
    assert.equal(received.id, "msg_replay_001");
    ws.close();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    await stop();
  }
}, 10_000);

test("bridge-server: stopSandboxBridgeServer clears state", async () => {
  await startSandboxBridgeServer({ port: 0 });
  await stopSandboxBridgeServer();
  assert.equal(getSandboxBridgeState().connectedClients, 0);
  assert.equal(getSandboxBridgeState().latestBundle, null);
});

/*
## TODO: Test Permutations
- start → getSandboxBridgeState().startFailed is false after a successful bind
- starting a second server while one is running rejects ("already running")
- start on an in-use port sets startFailed and rejects (port collision path)
- replay window: a client connecting after REPLAY_WINDOW_MS does NOT receive the stale bundle
- replay dedup: a client that already received a bundle is not sent it twice (D9)
- pushGameplayBundle to a mix of ACKing and non-ACKing clients splits delivered vs timedOut
- stop terminates in-flight client sockets so wss.close() does not hang (D8)
*/
