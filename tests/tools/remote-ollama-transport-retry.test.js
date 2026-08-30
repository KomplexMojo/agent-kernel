// M5 (coding-issues-affecting-benchmarking.md): a transport-level failure -- Ollama itself answers
// with an HTTP error status, its own tool-call parser choking on one generation -- is a bad sample,
// not a broken rig. It gets one retry before the attempt gives up. A network-level failure (no
// response at all: connection refused, DNS, timeout) never gets a statusCode and is never retried --
// retrying an unreachable endpoint just burns the same timeout twice for nothing, and the collapse
// breaker exists precisely so a genuinely broken rig stops instead of producing meaningless numbers.

const assert = require("node:assert/strict");
const http = require("node:http");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { runScenario } = require("../../tools/remote-ollama-control/scripts/lib/ak-runner");

const SCENARIO = { budgetMode: "unconstrained", prompt: "Create a small room." };

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "ak-transport-retry-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("a transport-level 500 (Ollama's own tool-call parser choking) is retried once and can recover", () => withTempDir(async (runOutDir) => {
  let requestCount = 0;
  const result = await withServer(
    (req, res) => {
      requestCount += 1;
      if (requestCount === 1) {
        res.writeHead(500, { "content-type": "application/json" });
        // Ollama's /v1/chat/completions is OpenAI-compatible; errors nest under "error".
        res.end(JSON.stringify({ error: { message: "XML syntax error on line 42: element <parameter> closed by </function>", type: "api_error", param: null, code: null } }));
        return;
      }
      // Recovers on retry: a normal response with no tool call, so runScenario returns early
      // without touching the CLI -- this test is about the retry mechanism, not execution.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "no tool call this time" } }] }));
    },
    (endpoint) => runScenario(endpoint, "test-model", SCENARIO, runOutDir, "retry-recovers", 5000),
  );

  assert.equal(requestCount, 2, "expected exactly one retry (2 total requests)");
  assert.equal(result.llmRetries, 1);
  assert.equal(result.llmErrorIsTransport, false, "the retry succeeded — no error survives to report");
  assert.equal(result.llmError, null);
}));

test("a transport-level 500 that never recovers is not classified as a network failure", () => withTempDir(async (runOutDir) => {
  let requestCount = 0;
  const result = await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "XML syntax error on line 42: element <parameter> closed by </function>", type: "api_error", param: null, code: null } }));
    },
    (endpoint) => runScenario(endpoint, "test-model", SCENARIO, runOutDir, "retry-exhausted", 5000),
  );

  assert.equal(requestCount, 2, "one retry attempted, then given up on");
  assert.equal(result.llmRetries, 1);
  assert.equal(result.llmErrorIsTransport, true);
  assert.match(result.llmError, /XML syntax error/);
  assert.equal(result.toolCallProduced, false);
}));

test("a network-level failure (nothing listening) is never retried", () => withTempDir(async (runOutDir) => {
  // Connect to a port nothing is bound to: requestJson's 'error' handler rejects with a raw socket
  // error, which never carries a statusCode.
  const deadEndpoint = "http://127.0.0.1:1";
  const result = await runScenario(deadEndpoint, "test-model", SCENARIO, runOutDir, "network-down", 2000);

  assert.equal(result.llmRetries, 0, "a network-level failure must not be retried");
  assert.equal(result.llmErrorIsTransport, false);
  assert.ok(result.llmError, "expected an error message");
  assert.equal(result.toolCallProduced, false);
}));
