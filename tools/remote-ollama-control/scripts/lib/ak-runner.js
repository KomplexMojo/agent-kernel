'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requestJson } = require('./ollama');
const crypto = require('crypto');
const { AK_CREATE_TOOL } = require('./ak-tool-schema');
const { buildPriceBrief, priceBriefHash } = require('./price-brief');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const AK_CLI = path.join(REPO_ROOT, 'packages', 'adapters-cli', 'src', 'cli', 'ak.mjs');

// Lazy-loaded from the MCP package (ESM) so the benchmark uses the same
// argv builder as the MCP server — no parallel translation layer.
let _buildArgv, _authoringSpec;
async function getMcpBuildTools() {
  if (!_buildArgv) {
    const shared = await import('../../../../packages/adapters-cli/src/mcp/tools/shared.mjs');
    const authoring = await import('../../../../packages/adapters-cli/src/mcp/tools/authoring.mjs');
    _buildArgv = shared.buildArgv;
    _authoringSpec = authoring.authoringSpec;
  }
  return { buildArgv: _buildArgv, authoringSpec: _authoringSpec };
}

// ---------------------------------------------------------------------------
// Ollama-specific normalization — compensates for qwen3 output quirks.
// These functions run BEFORE the shared MCP translation layer.
// ---------------------------------------------------------------------------

// qwen3's thinking mode sometimes serializes arrays as Python repr strings
// ([{'key': 'val'}]) using single quotes. Convert to valid JSON.
function pythonReprToJson(s) {
  return s
    .replace(/'/g, '"')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');
}

// Normalize an entity array field: handles actual arrays, JSON-encoded strings,
// and Python repr strings that qwen3 emits from its thinking mode.
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s.startsWith('[')) {
      try { return JSON.parse(s); } catch {}
      const converted = pythonReprToJson(s);
      try { return JSON.parse(converted); } catch {}
      // Some models close the outer list with ) instead of ] — repair and retry.
      try { return JSON.parse(converted.replace(/\)\s*$/, ']')); } catch {}
    }
    return s ? [s] : [];
  }
  return [val];
}

// Model-invented motivation names → nearest valid ak.mjs value.
const MOTIVATION_ALIASES = {
  supporting: 'friendly', support: 'friendly', healing: 'friendly', healer: 'friendly',
  offensive: 'attacking', aggressive: 'attacking', melee: 'attacking',
  defensive: 'defending', guard: 'defending', guardian: 'defending',
  stealth: 'stealthy', patrol: 'patrolling', mixed: 'exploring',
};

// Apply Ollama model compensations to a single entity spec object.
function normalizeEntitySpec(key, spec) {
  if (typeof spec === 'string') {
    const s = spec.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return normalizeEntitySpec(key, JSON.parse(s)); } catch {}
      try { return normalizeEntitySpec(key, JSON.parse(pythonReprToJson(s))); } catch {}
    }
    return spec;
  }

  const out = { ...spec };

  // Map non-standard motivation values
  if (out.motivation && typeof out.motivation === 'string') {
    out.motivation = MOTIVATION_ALIASES[out.motivation.toLowerCase()] ?? out.motivation;
  }

  if (key === 'resource') {
    // Strip unsupported aggregate/model-invented fields. The canonical V3
    // affinity field is deliberately retained for temporary/permanent grants.
    //
    // tier/stat/dropRate are the pre-V3 resource vocabulary. The CLI rejects them
    // outright once any V3 key (permanenceMode, vital, affinity) appears in the same
    // spec, and models blend the two vocabularies freely — that blend cost 73 of 700
    // attempts on 2026-08-22. Dropping them here is the last point before argv is
    // built; the tool schema no longer offers them, so a model that still emits one
    // is improvising rather than following the contract.
    for (const f of ['vitals', 'affinities', 'goals', 'kind', 'tier', 'stat', 'dropRate']) {
      delete out[f];
    }
  }

  // Strip model-invented fields that hazards don't support. Coordinates are
  // stripped because benchmark hazards are proximity-based. Blocking is a
  // supported execution-semantic input and must survive generated authoring.
  if (key === 'hazard') {
    for (const f of ['manaDrain', 'healthDrain', 'staminaDrain', 'damage', 'effect', 'duration', 'x', 'y', 'vitals']) {
      delete out[f];
    }
    if (out.proximityRadius == null) {
      out.proximityRadius = 2;
    }
  }

  return out;
}

// Normalize all entity array fields in toolArgs.
function normalizeToolArgs(toolArgs) {
  const ENTITY_KEYS = ['room', 'floorTile', 'hazard', 'resource', 'delver', 'warden'];
  const out = { ...toolArgs };
  for (const key of ENTITY_KEYS) {
    out[key] = toArray(out[key]).map((spec) => normalizeEntitySpec(key, spec));
  }
  return out;
}

// ---------------------------------------------------------------------------

function classifyExecutionOutcome(runResult) {
  if (runResult?.llmError || runResult?.execResult?.timedOut) return 'infrastructure_error';
  if (!runResult?.toolCallProduced) return 'model_failure';
  if (runResult.execResult?.succeeded) return 'success';
  const message = `${runResult.execResult?.stdout || ''}\n${runResult.execResult?.stderr || ''}`;
  if (/budget[^\n]*(denied|exceeded|insufficient)|requested[^\n]*available/i.test(message)) {
    return 'budget_denied';
  }
  return 'execution_failed';
}

// The constant half of the system prompt, split only so it can be hashed. The assembled text is
// byte-identical to what it was before the split: changing wording here would confound the very
// comparison the hash exists to enable.
const AUTHORING_INSTRUCTIONS_HEAD =
  'You are an agent-kernel dungeon designer. When given a dungeon creation request, '
  + 'call the ak_create tool with appropriate parameters. Use the exact prompt text as '
  + 'the text parameter. ';
const AUTHORING_INSTRUCTIONS_TAIL =
  'Always set emitIntermediates '
  + 'to true. Rooms are generic containers — affinity pressure belongs in hazards. '
  + 'Hazards are placed by proximityRadius, never by coordinates. '
  + 'For delver goals use only: max_mana, mana_regen, or maximize_spend. Wardens have no goals.';

/**
 * What the model was told, as identity.
 *
 * scenarioSetHash covers the questions, matrixHash the configurations, executionSuiteHash the
 * evaluation. Nothing covered the INSTRUCTIONS -- so changing the prompt, or the prices inside it,
 * moved what was being measured while all three pinned hashes sat still and two runs looked
 * comparable. Adding the price brief on 2026-08-24 is exactly such a change.
 *
 * The scenario-specific half is deliberately excluded: the budget number and the prompt text are
 * scenario data, already covered by scenarioSetHash. Only the harness's own contribution is here.
 */
function authoringPolicy() {
  const brief = buildPriceBrief();
  const canonical = JSON.stringify({
    head: AUTHORING_INSTRUCTIONS_HEAD,
    tail: AUTHORING_INSTRUCTIONS_TAIL,
    priceBrief: brief
  });
  return {
    sha256: crypto.createHash('sha256').update(canonical).digest('hex'),
    priceBriefSha256: priceBriefHash(brief)
  };
}

async function runScenario(endpoint, model, scenario, runOutDir, runId, timeoutMs = 600000, settings = {}) {
  const { buildArgv, authoringSpec } = await getMcpBuildTools();

  const constrained = scenario.budgetMode === 'constrained' && Number.isInteger(scenario.budget);
  const budgetInstruction = constrained
    ? `Set budgetTokens to ${scenario.budget}. `
    : 'Omit budgetTokens — the budget is unconstrained. ';
  // The model used to be handed a budget number and no prices, so authoring within it was a guess.
  // Budget and spatial failures were 55% of what failed once the schema defects were fixed, and the
  // constrained tier failed at 56% against simple's 18%. The brief is generated from the
  // Allocator's own base-costs.json, never restated, so a price change reaches the model.
  const systemPrompt = `${AUTHORING_INSTRUCTIONS_HEAD}${budgetInstruction}${AUTHORING_INSTRUCTIONS_TAIL}\n\n${buildPriceBrief()}`;

  const chatBody = {
    model,
    think: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: scenario.prompt }
    ],
    tools: [AK_CREATE_TOOL],
    tool_choice: 'required',
    stream: false,
    temperature: 0.1,
    // Output-length cap for the LLM call — unrelated to the authoring budget.
    // Constrained scenarios are minimal specs; unconstrained ones can get large.
    max_tokens: settings.outputTokens || (constrained ? 4096 : 8192)
  };
  // No `options: { num_ctx }` here. This posts to /v1/chat/completions, and Ollama's
  // OpenAI-compatible shim discards `options` without a word -- it looked like it was working for
  // months. The context is set on the serving process instead, via OLLAMA_CONTEXT_LENGTH in
  // serviceEnvironment(). Re-adding it here would not restore the behaviour, only the illusion.

  const llmStarted = Date.now();
  let chatResponse;
  let toolCallProduced = false;
  let toolArgs = null;
  let llmError = null;

  try {
    chatResponse = await requestJson(endpoint, '/v1/chat/completions', chatBody, timeoutMs);
    const msg = chatResponse?.choices?.[0]?.message;
    const toolCall = msg?.tool_calls?.[0];
    if (toolCall?.function?.name === 'ak_create') {
      toolCallProduced = true;
      const rawArgs = toolCall.function.arguments;
      toolArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
    } else if (!toolCallProduced && msg?.content) {
      // Fallback: some Ollama models (e.g. qwen2.5-coder) ignore tool_choice and
      // serialize the tool call as JSON text in the content field.
      const trimmed = msg.content.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed?.name === 'ak_create' && parsed?.arguments) {
            toolCallProduced = true;
            toolArgs = typeof parsed.arguments === 'string'
              ? JSON.parse(parsed.arguments)
              : parsed.arguments;
          }
        } catch {}
      }
    }
  } catch (error) {
    llmError = error.message;
  }
  const llmMs = Date.now() - llmStarted;

  if (!toolCallProduced || !toolArgs) {
    return { toolCallProduced, toolArgs: null, llmMs, llmError, execResult: null, outDir: null };
  }

  const effectiveOutDir = path.join(runOutDir, 'create');
  fs.mkdirSync(effectiveOutDir, { recursive: true });

  // Normalize Ollama quirks, then build argv via the shared MCP translation layer.
  // The scenario definition decides the budget, not the model: constrained scenarios
  // enforce their budgetTokens, unconstrained ones run with no budget at all.
  const normalizedArgs = normalizeToolArgs({
    ...toolArgs,
    budgetTokens: constrained ? scenario.budget : undefined,
    outDir: effectiveOutDir,
    runId,
    emitIntermediates: true,
  });
  if (!constrained) {
    delete normalizedArgs.budgetTokens;
  }
  const cliArgs = buildArgv(normalizedArgs, authoringSpec);

  const execStarted = Date.now();
  const result = spawnSync(process.execPath, [AK_CLI, 'create', ...cliArgs], {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd: REPO_ROOT
  });
  const execMs = Date.now() - execStarted;

  return {
    toolCallProduced: true,
    toolArgs,
    llmMs,
    llmError: null,
    execResult: {
      succeeded: result.status === 0,
      exitCode: result.status,
      execMs,
      stdout: (result.stdout || '').slice(-2000),
      stderr: (result.stderr || '').slice(-2000),
      timedOut: result.status === null
    },
    outDir: effectiveOutDir
  };
}

module.exports = {
  authoringPolicy, classifyExecutionOutcome, normalizeToolArgs, runScenario, AK_CLI, REPO_ROOT };
