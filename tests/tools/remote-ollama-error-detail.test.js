const assert = require("node:assert/strict");
const http = require("node:http");

const { requestJson } = require("../../tools/remote-ollama-control/scripts/lib/ollama");

// An infrastructure failure aborts the whole content-gen run — 700-2,100 calls in. The error it
// raises is the only account of why, so losing its detail costs a full run's worth of GPU time and
// leaves nothing to act on. A live run died at attempt 82 reporting exactly "[object Object]".
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const rejection = (promise) => promise.then(() => null, (error) => error);

test("a structured error body is rendered, not stringified to [object Object]", async () => {
  const error = await withServer(
    (req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "model_not_loaded", detail: "qwen3.5:9b is not resident" } }));
    },
    (baseUrl) => rejection(requestJson(baseUrl, "/api/chat", { model: "qwen3.5:9b" })),
  );

  assert.ok(error, "expected the request to reject");
  assert.doesNotMatch(error.message, /\[object Object\]/);
  assert.match(error.message, /model_not_loaded/);
  assert.match(error.message, /qwen3\.5:9b is not resident/);
});

test("status code and url survive even when the body carries its own message", async () => {
  const error = await withServer(
    (req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server busy" }));
    },
    (baseUrl) => rejection(requestJson(baseUrl, "/api/chat", { model: "m" })),
  );

  assert.match(error.message, /server busy/);
  assert.match(error.message, /503/, "the status code must not be dropped when a body message exists");
  assert.equal(error.statusCode, 503);
  assert.deepEqual(error.body, { error: "server busy" });
});

test("an error-free failure body still names the status and url", async () => {
  const error = await withServer(
    (req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    },
    (baseUrl) => rejection(requestJson(baseUrl, "/api/chat", { model: "m" })),
  );

  assert.match(error.message, /500/);
  assert.match(error.message, /api\/chat/);
});

test("a successful response still resolves to the parsed body", async () => {
  const parsed = await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { content: "ok" } }));
    },
    (baseUrl) => requestJson(baseUrl, "/api/chat", { model: "m" }),
  );
  assert.deepEqual(parsed, { message: { content: "ok" } });
});
