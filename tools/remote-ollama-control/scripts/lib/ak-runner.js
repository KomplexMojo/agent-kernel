'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requestJson } = require('./ollama');
const { AK_CREATE_TOOL } = require('./ak-tool-schema');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const AK_CLI = path.join(REPO_ROOT, 'packages', 'adapters-cli', 'src', 'cli', 'ak.mjs');

function buildCliArgs(toolArgs) {
  const args = ['create'];
  if (toolArgs.text) args.push('--text', toolArgs.text);
  if (toolArgs.budgetTokens != null) args.push('--budget-tokens', String(toolArgs.budgetTokens));
  if (toolArgs.runId) args.push('--run-id', toolArgs.runId);
  if (toolArgs.outDir) args.push('--out-dir', toolArgs.outDir);
  if (toolArgs.emitIntermediates !== false) args.push('--emit-intermediates');
  if (toolArgs.dungeonAffinity) args.push('--dungeon-affinity', toolArgs.dungeonAffinity);
  for (const spec of toolArgs.room || []) args.push('--room', spec);
  for (const spec of toolArgs.floorTile || []) args.push('--floor-tile', spec);
  for (const spec of toolArgs.trap || []) args.push('--trap', spec);
  for (const spec of toolArgs.hazard || []) args.push('--hazard', spec);
  for (const spec of toolArgs.resource || []) args.push('--resource', spec);
  for (const spec of toolArgs.delver || []) args.push('--delver', spec);
  for (const spec of toolArgs.warden || []) args.push('--warden', spec);
  return args;
}

async function runScenario(endpoint, model, scenario, runOutDir, runId, timeoutMs = 600000) {
  const systemPrompt =
    'You are an agent-kernel dungeon designer. When given a dungeon creation request, ' +
    'call the ak_create tool with appropriate parameters. Use the exact prompt text as ' +
    'the text parameter. The budget is typically 1500 tokens. Always set emitIntermediates ' +
    'to true. Rooms are generic containers — affinity pressure belongs in traps or hazards.';

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

module.exports = { buildCliArgs, runScenario, AK_CLI, REPO_ROOT };
