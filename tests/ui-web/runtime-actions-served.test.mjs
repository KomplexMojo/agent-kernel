import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function safePath(urlPath, serverRoot) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const target = resolve(serverRoot, `.${decoded}`);
  return target.startsWith(serverRoot) ? target : null;
}

function startServer(serverRoot) {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      const target = safePath(req.url || "/", serverRoot);
      if (!target) { res.statusCode = 403; res.end("Forbidden"); return; }
      let filePath = target;
      let stats;
      try { stats = await stat(filePath); } catch { res.statusCode = 404; res.end("Not found"); return; }
      if (stats.isDirectory()) { filePath = join(filePath, "index.html"); }
      const ext = extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
      createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveServer({ server, port });
    });
  });
}

test("served /packages/ui-web/index.html includes all eight runtime movement controls", async () => {
  const { server, port } = await startServer(root);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/packages/ui-web/index.html`);
    assert.equal(res.status, 200);
    const html = await res.text();

    const diagonalIds = [
      "runtime-move-up-left",
      "runtime-move-up-right",
      "runtime-move-down-left",
      "runtime-move-down-right",
    ];
    const cardinalIds = [
      "runtime-move-up",
      "runtime-move-down",
      "runtime-move-left",
      "runtime-move-right",
    ];
    const allIds = [...diagonalIds, ...cardinalIds];
    for (const id of allIds) {
      assert.ok(html.includes(`id="${id}"`), `served HTML must include #${id}`);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("served runtime movement controls are inside Runtime Actions section", async () => {
  const { server, port } = await startServer(root);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/packages/ui-web/index.html`);
    const html = await res.text();

    const runtimeActionsStart = html.indexOf('aria-label="Runtime controls"');
    assert.ok(runtimeActionsStart >= 0, "Runtime controls section must exist");

    const gridStart = html.indexOf('aria-label="Runtime movement controls"');
    assert.ok(gridStart >= 0, "Runtime movement controls group must exist");
    assert.ok(gridStart > runtimeActionsStart, "movement grid must be inside Runtime controls section");

    const gridEnd = html.indexOf("</div>", gridStart);
    const gridContent = html.slice(gridStart, gridEnd + 6);
    assert.ok(gridContent.includes('id="runtime-move-up-left"'), "diagonal up-left inside grid");
    assert.ok(gridContent.includes('id="runtime-move-up-right"'), "diagonal up-right inside grid");
    assert.ok(gridContent.includes('id="runtime-move-down-left"'), "diagonal down-left inside grid");
    assert.ok(gridContent.includes('id="runtime-move-down-right"'), "diagonal down-right inside grid");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
