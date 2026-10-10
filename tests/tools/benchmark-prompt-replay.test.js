'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAuthoringChatBody,
  llmRequestFromChatBody,
  toolsSchemaSha256,
} = require('../../tools/remote-ollama-control/scripts/lib/ak-runner');
const {
  enrichAttemptsWithLlmRequest,
  buildReplayChatBody,
  settingsFromConfigurationId,
  CURRENT_TOOLS_SCHEMA_SHA256,
  AK_CREATE_TOOL,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-prompt-replay');
const { serveStatusPage } = require('../../tools/remote-ollama-control/scripts/lib/benchmark-status-serve');

test('buildAuthoringChatBody puts catalog prompt in the user message and enums on the tool', () => {
  const body = buildAuthoringChatBody('qwen3.5:9b', {
    prompt: 'create a connected two-room corridor loop',
    budgetMode: 'unconstrained',
  });
  assert.equal(body.messages[1].content, 'create a connected two-room corridor loop');
  assert.match(body.messages[0].content, /Omit budgetTokens/);
  assert.equal(body.tools[0].function.name, 'ak_create');
  assert.deepEqual(
    body.tools[0].function.parameters.properties.hazard.items.properties.affinity.enum.slice(0, 3),
    ['fire', 'water', 'earth'],
  );
});

test('constrained scenarios pin budgetTokens in the system prompt', () => {
  const body = buildAuthoringChatBody('m', {
    prompt: 'x',
    budgetMode: 'constrained',
    budget: 277,
  });
  assert.match(body.messages[0].content, /Set budgetTokens to 277/);
  assert.equal(body.max_tokens, 4096);
});

test('llmRequest omits the tools blob but pins its hash', () => {
  const body = buildAuthoringChatBody('m', { prompt: 'x', budgetMode: 'unconstrained' });
  const req = llmRequestFromChatBody(body);
  assert.equal(req.provenance, 'recorded');
  assert.equal(req.toolsSchemaSha256, toolsSchemaSha256(body.tools));
  assert.equal(req.toolsSchemaSha256, CURRENT_TOOLS_SCHEMA_SHA256);
  assert.equal(req.messages[1].content, 'x');
  assert.equal(req.tools, undefined);
});

test('settingsFromConfigurationId reads ctx/out from the configuration id', () => {
  assert.deepEqual(
    settingsFromConfigurationId('cg-v1--qwen3.5_9b--primary--ctx8192--out4096'),
    { contextTokens: 8192, outputTokens: 4096 },
  );
});

test('enrichAttemptsWithLlmRequest reconstructs missing prompts from the catalog', () => {
  const catalog = {
    scenarios: [{
      index: 8,
      title: 'Execution EX-TR-03 — Warden patrol recurrence',
      prompt: 'catalog prompt for EX-TR-03',
      budgetMode: 'unconstrained',
    }],
  };
  const [enriched] = enrichAttemptsWithLlmRequest([{
    scenarioIndex: 8,
    scenarioTitle: 'Execution EX-TR-03 — Warden patrol recurrence',
    model: 'qwen3.5:9b',
    configurationId: 'cg-v1--qwen3.5_9b--primary--ctx8192--out4096',
  }], catalog);
  assert.equal(enriched.llmRequest.provenance, 'reconstructed');
  assert.equal(enriched.llmRequest.messages[1].content, 'catalog prompt for EX-TR-03');
  assert.equal(enriched.toolsSchemaMatch, true);
  assert.equal(enriched.llmRequest.options.num_ctx, 8192);
  assert.equal(enriched.llmRequest.max_tokens, 4096);
});

test('enrichAttemptsWithLlmRequest preserves a recorded llmRequest', () => {
  const recorded = {
    provenance: 'recorded',
    model: 'remote-model',
    messages: [{ role: 'user', content: 'recorded prompt' }],
    toolsSchemaSha256: CURRENT_TOOLS_SCHEMA_SHA256,
  };
  const [enriched] = enrichAttemptsWithLlmRequest([{
    scenarioIndex: 1,
    llmRequest: recorded,
  }], { scenarios: [] });
  assert.equal(enriched.llmRequest.messages[0].content, 'recorded prompt');
  assert.equal(enriched.llmRequest.provenance, 'recorded');
  assert.equal(enriched.toolsSchemaMatch, true);
});

test('buildReplayChatBody restores tools for a local re-prompt', () => {
  const req = llmRequestFromChatBody(buildAuthoringChatBody('orig', {
    prompt: 'replay me',
    budgetMode: 'unconstrained',
  }));
  const body = buildReplayChatBody(req, { model: 'local-model', tools: [AK_CREATE_TOOL] });
  assert.equal(body.model, 'local-model');
  assert.equal(body.messages[1].content, 'replay me');
  assert.equal(body.tools[0].function.name, 'ak_create');
});

test('serveStatusPage proxies /ollama onto the local host', async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-status-'));
  const htmlPath = path.join(dir, 'page.html');
  fs.writeFileSync(htmlPath, '<html>status</html>');

  const { server, pageUrl } = await serveStatusPage({
    htmlPath,
    ollamaHost: `http://127.0.0.1:${upstreamPort}`,
    openBrowser: false,
  });

  try {
    const page = await fetch(pageUrl).then((r) => r.text());
    assert.match(page, /status/);

    const proxied = await fetch(new URL('/ollama/api/tags', pageUrl)).then((r) => r.json());
    assert.equal(proxied.ok, true);
    assert.equal(proxied.path, '/api/tags');
  } finally {
    server.close();
    upstream.close();
  }
});
