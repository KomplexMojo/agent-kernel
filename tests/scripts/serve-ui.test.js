const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");

async function listenOnce(server, port) {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
}

async function closeOnce(server) {
  server.close();
  await once(server, "close");
}

async function findStartPort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidateServer = createServer();
    await listenOnce(candidateServer, 0);
    const { port } = candidateServer.address();
    await closeOnce(candidateServer);

    const fallbackServer = createServer();
    try {
      await listenOnce(fallbackServer, port + 1);
      await closeOnce(fallbackServer);
      return port;
    } catch (error) {
      fallbackServer.close();
      if (error && error.code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to find consecutive free ports for serve-ui test.");
}

async function withBlockedPort(port, callback) {
  const blocker = createServer((_req, res) => {
    res.statusCode = 200;
    res.end("blocked");
  });

  await listenOnce(blocker, port);

  try {
    await callback();
  } finally {
    await closeOnce(blocker);
  }
}

test("serve-ui falls back to the next port and keeps the root redirect", async () => {
  const { listenWithPortFallback } = await import("../../scripts/serve-ui.mjs");
  const startPort = await findStartPort();

  await withBlockedPort(startPort, async () => {
    const { port, server, url } = await listenWithPortFallback({
      startPort,
      maxAttempts: 3,
      hostname: "127.0.0.1",
    });

    try {
      assert.equal(port, startPort + 1);
      assert.equal(url, `http://localhost:${startPort + 1}/packages/ui-web/index.html`);

      const rootResponse = await fetch(`http://127.0.0.1:${port}/`, {
        redirect: "manual",
      });
      assert.equal(rootResponse.status, 302);
      assert.equal(rootResponse.headers.get("location"), "/packages/ui-web/index.html");

      const uiResponse = await fetch(`http://127.0.0.1:${port}/packages/ui-web/index.html`);
      assert.equal(uiResponse.status, 200);
      assert.match(uiResponse.headers.get("content-type") || "", /text\/html/);

      const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(healthResponse.status, 200);
      assert.deepEqual(await healthResponse.json(), { status: "ready" });
    } finally {
      await closeOnce(server);
    }
  });
});
