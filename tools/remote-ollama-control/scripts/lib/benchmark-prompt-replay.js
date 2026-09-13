'use strict';

/**
 * HITL replay support for content-gen attempts.
 *
 * Attempt records store the chat messages + sampling knobs (llmRequest). The tool schema is the
 * same for every content-gen attempt and is attached once at page level so a 4000-attempt run does
 * not ship megabytes of duplicated JSON. Older runs that never recorded llmRequest are reconstructed
 * from the catalog + the current authoring instructions, and labelled so a human can see the
 * difference between "this is what ran" and "this is our best rebuild".
 */

const crypto = require('crypto');
const { AK_CREATE_TOOL } = require('./ak-tool-schema');
const {
  buildAuthoringChatBody,
  llmRequestFromChatBody,
  toolsSchemaSha256,
} = require('./ak-runner');

const CURRENT_TOOLS_SCHEMA_SHA256 = toolsSchemaSha256([AK_CREATE_TOOL]);

/** Parse ctx/out from configuration ids like `cg-v1--qwen…--ctx8192--out4096`. */
function settingsFromConfigurationId(configurationId) {
  const id = String(configurationId || '');
  const ctx = id.match(/--ctx(\d+)/);
  const out = id.match(/--out(\d+)/);
  const settings = {};
  if (ctx) settings.contextTokens = Number(ctx[1]);
  if (out) settings.outputTokens = Number(out[1]);
  return settings;
}

function scenarioLookup(catalog) {
  const byIndex = new Map();
  const byTitle = new Map();
  for (const scenario of catalog?.scenarios || []) {
    byIndex.set(scenario.index, scenario);
    if (scenario.title) byTitle.set(scenario.title, scenario);
  }
  return { byIndex, byTitle };
}

function resolveScenario(attempt, lookup) {
  if (Number.isInteger(attempt.scenarioIndex) && lookup.byIndex.has(attempt.scenarioIndex)) {
    return lookup.byIndex.get(attempt.scenarioIndex);
  }
  if (attempt.scenarioTitle && lookup.byTitle.has(attempt.scenarioTitle)) {
    return lookup.byTitle.get(attempt.scenarioTitle);
  }
  return null;
}

function reconstructLlmRequest(attempt, scenario) {
  if (!scenario?.prompt) return null;
  const settings = settingsFromConfigurationId(attempt.configurationId);
  const chatBody = buildAuthoringChatBody(attempt.model || 'local', scenario, settings);
  return llmRequestFromChatBody(chatBody, { provenance: 'reconstructed' });
}

/**
 * Attach llmRequest to every attempt that lacks one, and stamp toolsSchemaMatch against the
 * schema the status page will embed for replay.
 */
function enrichAttemptsWithLlmRequest(attempts, catalog) {
  const lookup = scenarioLookup(catalog);
  return (attempts || []).map((attempt) => {
    let llmRequest = attempt.llmRequest || null;
    if (!llmRequest) {
      const scenario = resolveScenario(attempt, lookup);
      llmRequest = reconstructLlmRequest(attempt, scenario);
    }
    if (!llmRequest) return { ...attempt, llmRequest: null, toolsSchemaMatch: null };

    const toolsSchemaMatch = llmRequest.toolsSchemaSha256 === CURRENT_TOOLS_SCHEMA_SHA256;
    return { ...attempt, llmRequest, toolsSchemaMatch };
  });
}

function buildReplayChatBody(llmRequest, { model, tools = [AK_CREATE_TOOL] } = {}) {
  if (!llmRequest?.messages) {
    throw new Error('llmRequest.messages is required to rebuild a chat body');
  }
  const body = {
    model: model || llmRequest.model,
    think: llmRequest.think === true,
    messages: llmRequest.messages,
    tools,
    tool_choice: llmRequest.tool_choice || 'required',
    stream: false,
    temperature: llmRequest.temperature ?? 0.1,
    max_tokens: llmRequest.max_tokens || 8192,
  };
  if (llmRequest.options && typeof llmRequest.options === 'object') {
    body.options = llmRequest.options;
  }
  return body;
}

function curlForReplay(endpoint, chatBody) {
  const base = String(endpoint || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const payload = JSON.stringify(chatBody);
  return `curl -sS ${JSON.stringify(`${base}/v1/chat/completions`)} \\\n`
    + `  -H 'content-type: application/json' \\\n`
    + `  -d ${JSON.stringify(payload)}`;
}

module.exports = {
  AK_CREATE_TOOL,
  CURRENT_TOOLS_SCHEMA_SHA256,
  buildReplayChatBody,
  curlForReplay,
  enrichAttemptsWithLlmRequest,
  reconstructLlmRequest,
  settingsFromConfigurationId,
  toolsSchemaSha256: () => CURRENT_TOOLS_SCHEMA_SHA256,
  // Exported for tests that want a stable digest of the embedded schema.
  hashTools: (tools) => crypto.createHash('sha256').update(JSON.stringify(tools)).digest('hex'),
};
