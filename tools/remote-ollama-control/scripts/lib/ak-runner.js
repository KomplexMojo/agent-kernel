'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requestJson } = require('./ollama');
const { AK_CREATE_TOOL } = require('./ak-tool-schema');

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
    // Inject dropRate default when model omits it
    if (out.tier && out.stat && out.delta != null && out.dropRate == null) {
      out.dropRate = 10;
    }
    // Map natural stat names to canonical internal names
    const STAT_ALIASES = {
      health: 'vitalMax', mana: 'vitalMax', stamina: 'vitalMax', durability: 'vitalMax',
      max_health: 'vitalMax', max_mana: 'vitalMax', max_stamina: 'vitalMax', max_durability: 'vitalMax',
      health_regen: 'vitalRegen', mana_regen: 'vitalRegen', stamina_regen: 'vitalRegen',
      regen_health: 'vitalRegen', regen_mana: 'vitalRegen', regen_stamina: 'vitalRegen',
      affinity_stack: 'affinityStack', affinitystack: 'affinityStack',
      push_expression: 'pushExpression', pushexpression: 'pushExpression',
    };
    if (out.stat && typeof out.stat === 'string') {
      out.stat = STAT_ALIASES[out.stat.toLowerCase()] ?? out.stat;
    }
    // Strip unsupported resource fields (vitals, affinities, goals, kind)
    for (const f of ['vitals', 'affinities', 'goals', 'kind', 'affinity']) {
      delete out[f];
    }
  }

  // Strip model-invented fields that hazards don't support. Coordinates and
  // blocking are stripped too: benchmark hazards are proximity-based, which
  // makes the old trap_outside_room failure class structurally impossible.
  if (key === 'hazard') {
    for (const f of ['manaDrain', 'healthDrain', 'staminaDrain', 'damage', 'effect', 'duration', 'x', 'y', 'blocking', 'vitals']) {
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

async function runScenario(endpoint, model, scenario, runOutDir, runId, timeoutMs = 600000) {
  const { buildArgv, authoringSpec } = await getMcpBuildTools();

  const constrained = scenario.budgetMode === 'constrained' && Number.isInteger(scenario.budget);
  const budgetInstruction = constrained
    ? `Set budgetTokens to ${scenario.budget}. `
    : 'Omit budgetTokens — the budget is unconstrained. ';
  const systemPrompt =
    'You are an agent-kernel dungeon designer. When given a dungeon creation request, ' +
    'call the ak_create tool with appropriate parameters. Use the exact prompt text as ' +
    `the text parameter. ${budgetInstruction}Always set emitIntermediates ` +
    'to true. Rooms are generic containers — affinity pressure belongs in hazards. ' +
    'Hazards are placed by proximityRadius, never by coordinates. ' +
    'For delver goals use only: max_mana, mana_regen, or maximize_spend. Wardens have no goals.';

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
    max_tokens: constrained ? 4096 : 8192
  };

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

module.exports = { normalizeToolArgs, runScenario, AK_CLI, REPO_ROOT };
