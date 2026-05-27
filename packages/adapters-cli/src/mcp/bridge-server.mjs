/**
 * M8 — Sandbox to UI bridge server
 *
 * Manages a WebSocket server bound to 127.0.0.1 only.  Browser clients
 * connect, identify themselves with ak.uiReady.v1, and receive compiled
 * gameplay bundles pushed via pushGameplayBundle().
 *
 * Exports:
 *   startSandboxBridgeServer({ host?, port })  → { port, stop }
 *   getSandboxBridgeState()                    → { connectedClients, latestBundle }
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

/** Map<clientId, { ws, capabilities, connectedAt }> */
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

  await new Promise((resolve, reject) => {
    // Absorb error events on both httpServer and wss so no unhandled error
    // propagates to the process before the promise rejects cleanly.
    function onError(err) {
      httpServer.removeListener("error", onError);
      wss.removeListener("error", onError);
      reject(err);
    }
    httpServer.once("error", onError);
    wss.once("error", onError);

    httpServer.listen(port, LOOPBACK, () => {
      httpServer.removeListener("error", onError);
      wss.removeListener("error", onError);
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
 * @returns {{ connectedClients: number, latestBundle: object | null }}
 */
export function getSandboxBridgeState() {
  return {
    connectedClients: _clients.size,
    latestBundle: _pendingReplay?.bundle ?? null,
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
 */
export async function stopSandboxBridgeServer() {
  if (!_server) return;
  const { wss, httpServer } = _server;
  _server = null;
  _clients.clear();
  _pendingReplay = null;

  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}
