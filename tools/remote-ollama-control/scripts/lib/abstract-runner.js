'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requestJson } = require('./ollama');
const { evaluateAbstractPlan, mapAbstractPlanToCreateArgs } = require('./abstract-plan');
const { classifyExecutionOutcome } = require('./ak-runner');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const AK_CLI = path.join(REPO_ROOT, 'packages', 'adapters-cli', 'src', 'cli', 'ak.mjs');

const ABSTRACT_PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'submit_abstract_build_plan',
    description: 'Submit the minimum-cost component selection that satisfies every stated constraint.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['selections'],
      properties: {
        selections: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['componentId', 'quantity'],
            properties: {
              componentId: { type: 'string' },
              quantity: { type: 'integer', minimum: 1 },
            },
          },
        },
      },
    },
  },
};

let buildTools;
async function getBuildTools() {
  if (!buildTools) {
    const shared = await import('../../../../packages/adapters-cli/src/mcp/tools/shared.mjs');
    const authoring = await import('../../../../packages/adapters-cli/src/mcp/tools/authoring.mjs');
    buildTools = { buildArgv: shared.buildArgv, authoringSpec: authoring.authoringSpec };
  }
  return buildTools;
}

function extractToolArgs(chatResponse) {
  const message = chatResponse?.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.find((entry) => entry?.function?.name === ABSTRACT_PLAN_TOOL.function.name);
  if (toolCall) {
    const args = toolCall.function.arguments;
    return typeof args === 'string' ? JSON.parse(args) : args;
  }
  const content = message?.content?.trim();
  if (!content?.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed?.name !== ABSTRACT_PLAN_TOOL.function.name) return null;
    return typeof parsed.arguments === 'string' ? JSON.parse(parsed.arguments) : parsed.arguments;
  } catch {
    return null;
  }
}

async function runAbstractScenario(endpoint, model, scenario, runOutDir, runId, timeoutMs = 600000, settings = {}) {
  const chatBody = {
    model,
    think: false,
    messages: [
      {
        role: 'system',
        content: [
          'You solve domain-neutral discrete component-selection problems.',
          'Satisfy every exact quantity, capacity, signal-coverage, component-bound, and total-cost constraint.',
          'Then minimize total cost. Submit the solution with the required tool; do not rename component ids.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Solve this abstract problem:\n${JSON.stringify(scenario.problem)}`,
      },
    ],
    tools: [ABSTRACT_PLAN_TOOL],
    tool_choice: 'required',
    stream: false,
    temperature: 0,
    max_tokens: settings.outputTokens || 4096,
  };
  if (settings.contextTokens) chatBody.options = { num_ctx: settings.contextTokens };

  const llmStarted = Date.now();
  let toolArgs = null;
  let llmError = null;
  try {
    toolArgs = extractToolArgs(await requestJson(endpoint, '/v1/chat/completions', chatBody, timeoutMs));
  } catch (error) {
    llmError = error.message;
  }
  const llmMs = Date.now() - llmStarted;
  const selections = toolArgs?.selections;
  const planning = evaluateAbstractPlan(scenario, selections);
  if (!toolArgs) {
    return {
      toolCallProduced: false,
      toolArgs: null,
      planning,
      llmMs,
      llmError,
      mappingSucceeded: false,
      mappingError: null,
      mappedArgs: null,
      execResult: null,
      executionOutcome: 'model_failure',
      executionVerdictPassed: false,
      outDir: null,
    };
  }

  const effectiveOutDir = path.join(runOutDir, 'create');
  let mappedArgs;
  try {
    mappedArgs = mapAbstractPlanToCreateArgs(scenario, selections, { outDir: effectiveOutDir, runId });
  } catch (error) {
    return {
      toolCallProduced: true,
      toolArgs,
      planning,
      llmMs,
      llmError,
      mappingSucceeded: false,
      mappingError: error.message,
      mappedArgs: null,
      execResult: null,
      executionOutcome: 'model_failure',
      executionVerdictPassed: false,
      outDir: null,
    };
  }

  fs.mkdirSync(effectiveOutDir, { recursive: true });
  const { buildArgv, authoringSpec } = await getBuildTools();
  const cliArgs = buildArgv(mappedArgs, authoringSpec);
  const execStarted = Date.now();
  const result = spawnSync(process.execPath, [AK_CLI, 'create', ...cliArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const execMs = Date.now() - execStarted;
  const execResult = {
    succeeded: result.status === 0,
    exitCode: result.status,
    execMs,
    stdout: (result.stdout || '').slice(-2000),
    stderr: (result.stderr || '').slice(-2000),
    timedOut: result.status === null,
  };
  const executionOutcome = classifyExecutionOutcome({
    toolCallProduced: true,
    llmError: null,
    execResult,
  });
  return {
    toolCallProduced: true,
    toolArgs,
    planning,
    llmMs,
    llmError,
    mappingSucceeded: true,
    mappingError: null,
    mappedArgs,
    execResult,
    executionOutcome,
    executionVerdictPassed: executionOutcome === scenario.expectedOutcome,
    outDir: effectiveOutDir,
  };
}

module.exports = { ABSTRACT_PLAN_TOOL, extractToolArgs, runAbstractScenario };
