'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requestJson } = require('./ollama');
const { AK_CREATE_TOOL } = require('./ak-tool-schema');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const AK_CLI = path.join(REPO_ROOT, 'packages', 'adapters-cli', 'src', 'cli', 'ak.mjs');

// Normalize a tool-arg array field that the model may output as a JSON string.
// Models sometimes output array fields as a JSON-encoded string "[...]" instead
// of an actual array — handle that and plain string items too.
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s.startsWith('[')) {
      try { return JSON.parse(s); } catch {}
    }
    return s ? [s] : [];
  }
  return [val];
}

// Serialize an entity spec object (or already-formatted string) to the
// semicolon-delimited key=value format expected by ak.mjs CLI flags.
function specToString(spec) {
  if (typeof spec === 'string') {
    const s = spec.trim();
    if (s.startsWith('{')) {
      try { spec = JSON.parse(s); } catch { return spec; }
    } else {
      return spec;
    }
  }
  if (!spec || typeof spec !== 'object') return String(spec);

  const parts = [];
  for (const [k, v] of Object.entries(spec)) {
    if (v === undefined || v === null) continue;
    if (k === 'vitals' && typeof v === 'object' && !Array.isArray(v)) {
      const vparts = Object.entries(v).map(([vk, vv]) => {
        if (typeof vv === 'object') return `${vk}:${vv.max ?? 1}:${vv.regen ?? 0}`;
        return `${vk}:${vv}`;
      });
      if (vparts.length) parts.push(`vitals=${vparts.join(',')}`);
    } else if (k === 'affinities' && Array.isArray(v)) {
      const aparts = v.map(a => `${a.kind}:${a.expression}:${a.stacks ?? 1}`);
      if (aparts.length) parts.push(`affinities=${aparts.join(',')}`);
    } else if (k === 'goals') {
      // goals is an array of {kind, priority} objects
      const gArr = Array.isArray(v) ? v : [];
      const gparts = gArr.map(g => {
        if (typeof g === 'string') return g;
        return g.priority ? `${g.kind}:${g.priority}` : g.kind;
      });
      if (gparts.length) parts.push(`goals=${gparts.join(',')}`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join(';');
}

function buildCliArgs(toolArgs) {
  const args = ['create'];
  if (toolArgs.text) args.push('--text', toolArgs.text);
  if (toolArgs.budgetTokens != null) args.push('--budget-tokens', String(toolArgs.budgetTokens));
  if (toolArgs.runId) args.push('--run-id', toolArgs.runId);
  if (toolArgs.outDir) args.push('--out-dir', toolArgs.outDir);
  if (toolArgs.emitIntermediates !== false) args.push('--emit-intermediates');
  if (toolArgs.dungeonAffinity) args.push('--dungeon-affinity', toolArgs.dungeonAffinity);
  for (const spec of toArray(toolArgs.room)) args.push('--room', specToString(spec));
  for (const spec of toArray(toolArgs.floorTile)) args.push('--floor-tile', specToString(spec));
  for (const spec of toArray(toolArgs.trap)) args.push('--trap', specToString(spec));
  for (const spec of toArray(toolArgs.hazard)) args.push('--hazard', specToString(spec));
  for (const spec of toArray(toolArgs.resource)) args.push('--resource', specToString(spec));
  for (const spec of toArray(toolArgs.delver)) args.push('--delver', specToString(spec));
  for (const spec of toArray(toolArgs.warden)) args.push('--warden', specToString(spec));
  return args;
}

async function runScenario(endpoint, model, scenario, runOutDir, runId, timeoutMs = 600000) {
  const systemPrompt =
    'You are an agent-kernel dungeon designer. When given a dungeon creation request, ' +
    'call the ak_create tool with appropriate parameters. Use the exact prompt text as ' +
    'the text parameter. The budget is typically 1500 tokens. Always set emitIntermediates ' +
    'to true. Rooms are generic containers — affinity pressure belongs in traps or hazards. ' +
    'For delver goals use only: max_mana, mana_regen, or maximize_spend. Wardens have no goals.';

  const chatBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: scenario.prompt }
    ],
    tools: [AK_CREATE_TOOL],
    tool_choice: 'required',
    stream: false,
    temperature: 0.1,
    max_tokens: 2048
  };

  const llmStarted = Date.now();
  let chatResponse;
  let toolCallProduced = false;
  let toolArgs = null;
  let llmError = null;

  try {
    chatResponse = await requestJson(endpoint, '/v1/chat/completions', chatBody, timeoutMs);
    const toolCall = chatResponse?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.name === 'ak_create') {
      toolCallProduced = true;
      const rawArgs = toolCall.function.arguments;
      toolArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
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
  toolArgs.outDir = effectiveOutDir;
  toolArgs.runId = runId;
  toolArgs.emitIntermediates = true;

  const cliArgs = buildCliArgs(toolArgs);
  const execStarted = Date.now();
  const result = spawnSync(process.execPath, [AK_CLI, ...cliArgs], {
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

module.exports = { buildCliArgs, specToString, toArray, runScenario, AK_CLI, REPO_ROOT };
