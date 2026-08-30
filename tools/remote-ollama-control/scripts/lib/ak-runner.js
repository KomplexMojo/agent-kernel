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

// M5: how many times a transport-level LLM failure (Ollama answered with an HTTP error status —
// its own tool-call parser choking on the model's output, not the rig being down) gets retried
// before the attempt is given up on. Starts at 1 per the plan: a bad sample deserves one more roll,
// not an unbounded retry loop that could mask a genuinely degrading model.
const MAX_TRANSPORT_RETRIES = 1;

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

// Repairs bracket-balance faults in an array-of-objects string: either trailing garbage after
// a complete value (a stray closing brace after the array's own ]), or a missing final closer
// (the objects inside are all complete but the outer [ never closes). Tracks depth outside
// quoted strings; the first time depth returns to zero the value is complete and anything after
// is dropped. If the string runs out with brackets still open, closing them in reverse order is
// safe -- every bracket left on the stack was opened after everything it contains already
// balanced, so there is nothing to guess at.
function repairJsonBrackets(s) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '[' || c === '{') { stack.push(c); continue; }
    if (c === ']' || c === '}') {
      if (stack.length === 0) return s.slice(0, i);
      stack.pop();
      if (stack.length === 0) return s.slice(0, i + 1);
    }
  }
  return stack.length > 0 ? s + stack.reverse().map((open) => (open === '[' ? ']' : '}')).join('') : s;
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
      // Some models emit a bracket-unbalanced array: an extra trailing } after a complete
      // array, or a missing closing ] on an otherwise-complete one. Repair and retry.
      try { return JSON.parse(repairJsonBrackets(converted)); } catch {}
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

// M5: an 'infrastructure_error' executionOutcome describes WHAT happened to one attempt (the LLM
// leg never produced a usable result); failureClass decides whether that's the collapse breaker's
// business -- whether executeContentGenMatrix should abort the whole run over it. A transport-level
// failure (runResult.llmErrorIsTransport: Ollama itself answered with an HTTP error status) is a
// bad sample -- runScenario already retried it once (MAX_TRANSPORT_RETRIES) before giving up, and
// one generation choking on its own tool-call parser is not evidence the rig is broken. A network-
// level failure (no response at all: connection refused, DNS, timeout) is the collapse breaker's
// actual reason to exist, and stays 'infrastructure' unconditionally.
function classifyFailureClass(executionOutcome, runResult) {
  if (executionOutcome !== 'infrastructure_error') return null;
  return runResult?.llmErrorIsTransport ? null : 'infrastructure';
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
/**
 * The price brief is NOT sent, and this is the single value that says so.
 *
 * It was built twice -- once into the system prompt and once into the hash below -- so the identity
 * could disagree with what the model was actually told. One value now feeds both: whatever is here
 * is what is sent AND what is recorded, and the two cannot drift.
 *
 * Measured on 2026-08-25, qwen3.5:9b over all 25 constrained scenarios, paired by scenario, five
 * arms differing only in this text:
 *
 *   none (this)          mean 47.7   13/25 pass   <-- best on every measure
 *   exact prices         mean 40.9   10/25
 *   assembled costs      mean 37.8   12/25
 *   rules, no numbers    mean 40.2    9/25
 *   exact + examples     mean 38.0   12/25
 *
 * No single arm reaches significance against the control (sign test p = 0.125 to 0.688; 17-19 of 25
 * scenarios are untouched in each pairing). The signal is the consistency: four unrelated contents,
 * all below the control, none above. When four different contents give the same answer, content is
 * not the lever.
 *
 * The mechanism, from constrained scenario 92: given prices the model authored a room, a floor
 * tile, four empty arrays and all four vitals, and overran a 58-token budget by 2. Given nothing it
 * authored the warden alone and scored 100. A price list reads as a MENU, and the model orders from
 * it -- which is why the numberless rules arm failed too.
 *
 * buildPriceBrief() is kept, tested and generated from base-costs.json rather than deleted: the open
 * question is whether prices help when the model DERIVES a total rather than being handed one, and
 * that experiment needs this generator. Set this constant back to buildPriceBrief() to re-run it.
 */
const AUTHORING_PRICE_BRIEF = '';

function authoringPolicy() {
  const brief = AUTHORING_PRICE_BRIEF;
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
  // Prices are deliberately NOT appended -- see AUTHORING_PRICE_BRIEF above for the measurement.
  // The trailing separator is conditional so an empty brief leaves no dangling blank lines, and so
  // restoring the brief needs no change here.
  const systemPrompt = `${AUTHORING_INSTRUCTIONS_HEAD}${budgetInstruction}${AUTHORING_INSTRUCTIONS_TAIL}`
    + (AUTHORING_PRICE_BRIEF ? `\n\n${AUTHORING_PRICE_BRIEF}` : '');

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
  if (settings.contextTokens) chatBody.options = { num_ctx: settings.contextTokens };

  const llmStarted = Date.now();
  let chatResponse;
  let toolCallProduced = false;
  let toolArgs = null;
  let llmError = null;
  // A transport-level failure means Ollama answered with an HTTP error status (statusCode set by
  // requestJson) -- the rig is up, one generation's tool-call XML translation choked. A network-
  // level failure (connection refused, DNS, timeout) never gets a statusCode: no response arrived
  // at all, which is what "the rig is down" actually looks like. Only the former is worth a retry;
  // retrying an unreachable endpoint just burns the same timeout twice for nothing.
  let llmErrorIsTransport = false;
  let llmRetries = 0;

  for (let attempt = 0; attempt <= MAX_TRANSPORT_RETRIES; attempt += 1) {
    llmError = null;
    llmErrorIsTransport = false;
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
      break;
    } catch (error) {
      llmError = error.message;
      llmErrorIsTransport = error.statusCode != null;
      if (llmErrorIsTransport && attempt < MAX_TRANSPORT_RETRIES) {
        llmRetries += 1;
        continue;
      }
      break;
    }
  }
  const llmMs = Date.now() - llmStarted;

  if (!toolCallProduced || !toolArgs) {
    return {
      toolCallProduced, toolArgs: null, llmMs, llmError, llmErrorIsTransport, llmRetries,
      execResult: null, outDir: null,
    };
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
    llmErrorIsTransport: false,
    llmRetries,
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
  authoringPolicy, classifyExecutionOutcome, classifyFailureClass, normalizeToolArgs, runScenario,
  AK_CLI, REPO_ROOT };
