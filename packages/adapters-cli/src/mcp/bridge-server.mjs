/**
 * M8 — Sandbox to UI bridge server
 *
 * Manages a WebSocket server bound to 127.0.0.1 only.  Browser clients
 * connect, identify themselves with ak.uiReady.v1, and receive compiled
 * gameplay bundles pushed via pushGameplayBundle().
 *
 * Exports:
 *   startSandboxBridgeServer({ host?, port })  → { port, stop }
 *   getSandboxBridgeState()                    → { connectedClients, latestBundle, startFailed }
 *   pushGameplayBundle(message)                → { deliveredClientIds, timedOutClientIds }
 *   stopSandboxBridgeServer()
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const LOOPBACK = "127.0.0.1";
const REPLAY_WINDOW_MS = 10_000;
const ACK_TIMEOUT_MS = 8_000;

/** @type {{ wss: import("ws").WebSocketServer, httpServer: import("node:http").Server } | null} */
let _server = null;

/** D6: track whether the bridge failed to start */
let _startFailed = false;

/** Map<clientId, { ws, capabilities, connectedAt, replayedIds: Set<string> }> */
const _clients = new Map();

/** { bundle, pushedAt } | null */
let _pendingReplay = null;

function makeMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeClientId() {
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function replayToClient(clientId, ws) {
  if (!_pendingReplay) return;
  const age = Date.now() - _pendingReplay.pushedAt;
  if (age > REPLAY_WINDOW_MS) {
    _pendingReplay = null;
    return;
  }
  // D9: deduplicate — only replay if this client hasn't received this message already
  const client = _clients.get(clientId);
  const msgId = _pendingReplay.bundle?.id;
  if (client && msgId) {
    if (client.replayedIds.has(msgId)) return;
    client.replayedIds.add(msgId);
  }
  sendJson(ws, _pendingReplay.bundle);
}

/**
 * Start the bridge WebSocket server.
 * @param {{ host?: string, port: number }} options
 * @returns {{ port: number, stop: () => Promise<void> }}
 */
export async function startSandboxBridgeServer({ host = LOOPBACK, port } = {}) {
  if (host !== LOOPBACK && host !== "localhost") {
    throw new Error(
      `startSandboxBridgeServer: host must be "${LOOPBACK}" (loopback only). Received: "${host}"`,
    );
  }

  if (_server) {
    throw new Error("startSandboxBridgeServer: bridge server is already running.");
  }

  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer, path: "/ak-sandbox" });

  wss.on("connection", (ws) => {
    let clientId = null;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return; // ignore unparseable frames
      }

      if (msg?.type === "ak.uiReady.v1") {
        clientId = msg.clientId || makeClientId();
        _clients.set(clientId, {
          ws,
          capabilities: msg.capabilities ?? {},
          connectedAt: new Date().toISOString(),
          replayedIds: new Set(),  // D9: per-client dedup set
        });
        // Replay latest bundle within the window
        replayToClient(clientId, ws);
      }
    });

    ws.on("close", () => {
      if (clientId) _clients.delete(clientId);
    });

    ws.on("error", () => {
      if (clientId) _clients.delete(clientId);
    });
  });

  // D6: track startup failure so getSandboxBridgeState can surface it
  await new Promise((resolve, reject) => {
    function onError(err) {
      httpServer.removeListener("error", onError);
      wss.removeListener("error", onError);
      _startFailed = true;
      reject(err);
    }
    httpServer.once("error", onError);
    wss.once("error", onError);

    httpServer.listen(port, LOOPBACK, () => {
      httpServer.removeListener("error", onError);
      wss.removeListener("error", onError);
      _startFailed = false;
      resolve();
    });
  });

  const boundPort = httpServer.address().port;
  _server = { wss, httpServer };

  return {
    port: boundPort,
    stop: stopSandboxBridgeServer,
  };
}

/**
 * @returns {{ connectedClients: number, latestBundle: object | null, startFailed: boolean }}
 */
export function getSandboxBridgeState() {
  return {
    connectedClients: _clients.size,
    latestBundle: _pendingReplay?.bundle ?? null,
    startFailed: _startFailed,   // D6: expose startup failure to callers
  };
}

/**
 * Push an ak.gameplayBundle.v1 message to all connected clients.
 * Stores the message for a 10-second replay window.
 *
 * @param {object} message  Full ak.gameplayBundle.v1 envelope
 * @returns {Promise<{ deliveredClientIds: string[], timedOutClientIds: string[] }>}
 */
export async function pushGameplayBundle(message) {
  // Store for replay window
  _pendingReplay = { bundle: message, pushedAt: Date.now() };

  const clientEntries = Array.from(_clients.entries());
  if (clientEntries.length === 0) {
    return { deliveredClientIds: [], timedOutClientIds: [] };
  }

  const deliveredClientIds = [];
  const timedOutClientIds = [];

  const ackPromises = clientEntries.map(([clientId, { ws }]) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        ws.removeListener("message", onMessage);
        timedOutClientIds.push(clientId);
        resolve();
      }, ACK_TIMEOUT_MS);

      function onMessage(raw) {
        let msg;
        try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }
        if (
          (msg?.type === "ak.bundleLoaded.v1" || msg?.type === "ak.bundleLoadFailed.v1")
          && msg?.messageId === message.id
        ) {
          clearTimeout(timer);
          ws.removeListener("message", onMessage);
          if (msg.type === "ak.bundleLoaded.v1") {
            deliveredClientIds.push(clientId);
          } else {
            timedOutClientIds.push(clientId);
          }
          resolve();
        }
      }

      ws.on("message", onMessage);
      sendJson(ws, message);
    });
  });

  await Promise.all(ackPromises);
  return { deliveredClientIds, timedOutClientIds };
}

/**
 * Stop the bridge server and disconnect all clients cleanly.
 * D8: Force-terminate active client WebSockets before closing the server
 * so wss.close() doesn't hang waiting for long-lived connections.
 */
export async function stopSandboxBridgeServer() {
  if (!_server) return;
  const { wss, httpServer } = _server;
  _server = null;

  // D8: terminate all connected clients before closing
  for (const { ws } of _clients.values()) {
    try { ws.terminate(); } catch { /* ignore */ }
  }
  _clients.clear();
  _pendingReplay = null;
  _startFailed = false;

  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}
