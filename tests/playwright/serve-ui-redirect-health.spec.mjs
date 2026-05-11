import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { listenWithPortFallback } from "../../scripts/serve-ui.mjs";

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("serve-ui falls back to the next port and keeps the root redirect", async ({ page, request }) => {
  const startPort = 8010;
  const blocker = createServer((_req, res) => {
    res.statusCode = 200;
    res.end("blocked");
  });
  await listen(blocker, startPort);

  const { port, server } = await listenWithPortFallback({
    startPort,
    maxAttempts: 3,
    hostname: "127.0.0.1",
  });

  try {
    expect(port).toBe(startPort + 1);

    const health = await request.get(`http://127.0.0.1:${port}/health`);
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toEqual({ status: "ready" });

    const root = await request.get(`http://127.0.0.1:${port}/`, {
      maxRedirects: 0,
    });
    expect(root.status()).toBe(302);
    expect(root.headers().location).toBe("/packages/ui-web/index.html");

    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page).toHaveURL(/\/packages\/ui-web\/index\.html$/);
  } finally {
    await closeServer(server);
    await closeServer(blocker);
  }
});
