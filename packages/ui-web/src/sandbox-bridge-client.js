/**
 * M8 — Sandbox bridge client (browser-side)
 *
 * Maintains a reconnecting WebSocket connection to the MCP server's bridge.
 * On connect, announces capabilities. On ak.gameplayBundle.v1, delegates to
 * the global __ak_loadGameplayBundle and __ak_setActiveTab hooks.
 *
 * Exports:
 *   connectSandboxBridge({ port, onBundle? })  → { disconnect }
 *   disconnectSandboxBridge()
 */

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BRIDGE_PATH = "/ak-sandbox";

function makeClientId() {
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const CLIENT_ID = makeClientId();

let _ws = null;
let _reconnectTimer = null;
let _reconnectDelay = RECONNECT_DELAY_MS;
let _stopped = false;
let _port = null;
let _onBundle = null;

function sendJson(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function announceReady(ws) {
  sendJson(ws, {
    type: "ak.uiReady.v1",
    clientId: CLIENT_ID,
    createdAt: new Date().toISOString(),
    capabilities: {
      loadGameplayBundle: typeof globalThis.__ak_loadGameplayBundle === "function",
      setActiveTab: typeof globalThis.__ak_setActiveTab === "function",
    },
  });
}

async function handleBundle(ws, msg) {
  const messageId = msg.id;
  const bundle = msg?.payload?.bundle;
  // D4: targetTab is at the envelope root (not inside payload)
  const targetTab = typeof msg.targetTab === "string" ? msg.targetTab : "gameplay";

  try {
    if (typeof globalThis.__ak_loadGameplayBundle !== "function") {
      throw Object.assign(new Error("__ak_loadGameplayBundle is not available"), {
        code: "LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE",
      });
    }

    // D4: pass targetTab so __ak_loadGameplayBundle can handle design vs gameplay routing
    await globalThis.__ak_loadGameplayBundle(bundle, { targetTab });

    if (typeof _onBundle === "function") {
      _onBundle(bundle);
    }

    sendJson(ws, {
      type: "ak.bundleLoaded.v1",
      clientId: CLIENT_ID,
      messageId,
      ...(msg.correlationId ? { correlationId: msg.correlationId } : {}),
      loadedAt: new Date().toISOString(),
    });
  } catch (err) {
    sendJson(ws, {
      type: "ak.bundleLoadFailed.v1",
      clientId: CLIENT_ID,
      messageId,
      ...(msg.correlationId ? { correlationId: msg.correlationId } : {}),
      error: {
        message: err?.message ?? String(err),
        code: err?.code ?? "LOAD_GAMEPLAY_BUNDLE_UNAVAILABLE",
      },
    });
  }
}

function connect() {
  if (_stopped) return;

  const url = `ws://127.0.0.1:${_port}${BRIDGE_PATH}`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  _ws = ws;

  ws.addEventListener("open", () => {
    _reconnectDelay = RECONNECT_DELAY_MS;
    announceReady(ws);
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg?.type === "ak.gameplayBundle.v1") {
      handleBundle(ws, msg);
    }
  });

  ws.addEventListener("close", () => {
    _ws = null;
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    // close event fires after error — reconnect handled there
  });
}

function scheduleReconnect() {
  if (_stopped) return;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => {
    _reconnectDelay = Math.min(_reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    connect();
  }, _reconnectDelay);
}

/**
 * Start connecting to the sandbox bridge.
 * @param {{ port: number, onBundle?: (bundle: object) => void }} options
 * @returns {{ disconnect: () => void }}
 */
export function connectSandboxBridge({ port, onBundle } = {}) {
  _stopped = false;
  _port = port;
  _onBundle = onBundle ?? null;
  _reconnectDelay = RECONNECT_DELAY_MS;
  connect();
  return { disconnect: disconnectSandboxBridge };
}

/**
 * Stop the bridge connection and cancel any pending reconnect.
 */
export function disconnectSandboxBridge() {
  _stopped = true;
  clearTimeout(_reconnectTimer);
  if (_ws) {
    _ws.close();
    _ws = null;
  }
}
