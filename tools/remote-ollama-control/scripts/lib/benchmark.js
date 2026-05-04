'use strict';

const fs = require('fs');
const path = require('path');
const { endpointFor, getProfile } = require('./config');
const { requestJson } = require('./ollama');
const { table } = require('./markdown');

function sanitizeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function numberList(values, fallback) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return [...new Set(source.map(Number).filter((value) => Number.isFinite(value) && value > 0))];
}

function normalizeEffort(value) {
  if (typeof value === 'number') {
    return { name: `predict-${value}`, numPredict: value };
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0
      ? { name: `predict-${numeric}`, numPredict: numeric }
      : null;
  }
  if (value && typeof value === 'object') {
    const numPredict = Number(value.numPredict ?? value.num_predict);
    if (Number.isFinite(numPredict) && numPredict > 0) {
      return {
        ...value,
        name: value.name || `predict-${numPredict}`,
        numPredict
      };
    }
  }
  return null;
}

function effortList(values, fallback) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  const fallbackByName = new Map((fallback || [])
    .map((value) => normalizeEffort(value))
    .filter(Boolean)
    .map((value) => [value.name, value]));
  const efforts = [];
  const seen = new Set();
  for (const value of source) {
    const effort = typeof value === 'string' && fallbackByName.has(value)
      ? fallbackByName.get(value)
      : normalizeEffort(value);
    if (!effort || seen.has(effort.name)) {
      continue;
    }
    seen.add(effort.name);
    efforts.push(effort);
  }
  return efforts.length > 0 ? efforts : [{ name: 'standard', numPredict: 4096 }];
}

function scenarioList(values, fallback) {
  const source = Array.isArray(values) && values.length > 0 ? values : fallback;
  return [...new Set(source.filter(Boolean).map(String))];
}

function modelProfiles(config, modelName) {
  const model = config.models[modelName] || {};
  return Array.isArray(model.profiles) ? model.profiles : [];
}

function buildHardwareBenchmarkSpecs(config, options = {}) {
  const benchmark = config.benchmark || {};
  const selectedModels = Array.isArray(options.models) && options.models.length > 0
    ? options.models
    : Object.keys(config.models || {});
  const selectedProfiles = Array.isArray(options.profileNames) && options.profileNames.length > 0
    ? new Set(options.profileNames)
    : null;
  const contexts = numberList(options.contexts, benchmark.defaultContexts || [4096, 8192, 16384, 32768]);
  const efforts = effortList(options.efforts, benchmark.defaultEfforts || [{ name: 'standard', numPredict: 4096 }]);
  const scenarios = scenarioList(options.scenarioNames, benchmark.defaultScenarios || ['vitest-generation']);
  const specs = [];

  for (const modelName of selectedModels) {
    const allowedProfiles = modelProfiles(config, modelName);
    if (allowedProfiles.length === 0) {
      continue;
    }
    for (const profileName of allowedProfiles) {
      if (selectedProfiles && !selectedProfiles.has(profileName)) {
        continue;
      }
      getProfile(config, profileName);
      for (const context of contexts) {
        for (const effort of efforts) {
          specs.push({
            profileName,
            model: modelName,
            context,
            effortName: effort.name,
            numPredict: effort.numPredict,
            effortOptions: { ...effort }
          });
        }
      }
    }
  }

  return { specs, scenarios, contexts, efforts };
}

function loadScenario(rootDir, scenarioName) {
  const dir = path.join(rootDir, 'benchmarks', 'scenarios', scenarioName);
  if (!fs.existsSync(dir)) {
    throw new Error(`Scenario not found: ${scenarioName} (${dir})`);
  }
  const promptPath = path.join(dir, 'prompt.md');
  const sourcePath = path.join(dir, 'source-context.md');
  const rubricPath = path.join(dir, 'rubric.json');
  return {
    name: scenarioName,
    dir,
    prompt: fs.readFileSync(promptPath, 'utf8'),
    sourceContext: fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '',
    rubric: fs.existsSync(rubricPath) ? JSON.parse(fs.readFileSync(rubricPath, 'utf8')) : {}
  };
}

function renderPrompt(scenario, run) {
  return `${scenario.prompt.trim()}

Benchmark metadata:
- Profile: ${run.profile.name}
- Expected GPU visibility: ${run.profile.gpuDevices}
- Endpoint: ${run.endpoint}
- Model: ${run.model}
- Context window under test: ${run.context}
- Effort under test: ${run.effortName || 'custom'}
- num_predict under test: ${run.numPredict}

Source/context material:
${scenario.sourceContext.trim()}
`;
}

function extractCodeBlock(text) {
  const matches = [...String(text || '').matchAll(/```(?:js|javascript|ts|typescript)?\s*([\s\S]*?)```/gi)];
  for (const match of matches) {
    const candidate = match[1].trim();
    if (/\b(?:test|it|describe)\s*\(/.test(candidate) || /from\s+["']vitest["']/.test(candidate)) {
      return { code: candidate, valid: true, error: null };
    }
  }
  if (/\b(?:test|it|describe)\s*\(/.test(text || '')) {
    return { code: String(text || '').trim(), valid: false, error: 'Vitest-like code was not fenced' };
  }
  return { code: '', valid: false, error: 'No Vitest code block found' };
}

function extractJsonObject(text) {
  const jsonFence = String(text || '').match(/```json\s*([\s\S]*?)```/i);
  const candidates = [];
  if (jsonFence) {
    candidates.push(jsonFence[1]);
  }
  candidates.push(String(text || ''));

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return { ok: true, value: JSON.parse(trimmed), error: null };
    } catch {
      const objectMatch = trimmed.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return { ok: true, value: JSON.parse(objectMatch[0]), error: null };
        } catch {
          // Try the next candidate.
        }
      }
    }
  }
  return { ok: false, value: null, error: 'No valid JSON object found' };
}

function scoreResponse(scenario, response, extractedCode) {
  const rubric = scenario.rubric || {};
  const combined = `${response || ''}\n${extractedCode.code || ''}`;
  const lower = combined.toLowerCase();
  const reasons = [];
  let score = 0;

  if (!/\b(can't|cannot|unable to|as an ai)\b/i.test(response || '')) {
    score += 8;
    reasons.push('no-refusal');
  }

  if (rubric.expectCodeBlock !== false && extractedCode.valid) {
    score += 18;
    reasons.push('valid-code-block');
  }

  const testCount = (extractedCode.code.match(/\b(?:test|it)\s*\(/g) || []).length;
  if (testCount > 0) {
    score += Math.min(20, testCount * 5);
    reasons.push(`${testCount}-tests`);
  }
  if (testCount >= Number(rubric.minimumTests || 0)) {
    score += 10;
    reasons.push('minimum-tests');
  }

  if (/\b(assert\.|expect\s*\()/.test(extractedCode.code)) {
    score += 10;
    reasons.push('assertions');
  }

  const requiredImports = rubric.requiredImports || [];
  const importHits = requiredImports.filter((term) => extractedCode.code.toLowerCase().includes(String(term).toLowerCase()));
  if (requiredImports.length > 0) {
    score += Math.round(12 * importHits.length / requiredImports.length);
    reasons.push(`imports:${importHits.length}/${requiredImports.length}`);
  }

  const requiredTerms = rubric.requiredTerms || [];
  const termHits = requiredTerms.filter((term) => lower.includes(String(term).toLowerCase()));
  if (requiredTerms.length > 0) {
    score += Math.round(20 * termHits.length / requiredTerms.length);
    reasons.push(`terms:${termHits.length}/${requiredTerms.length}`);
  }

  const forbiddenTerms = rubric.forbiddenTerms || [];
  const forbiddenHits = forbiddenTerms.filter((term) => lower.includes(String(term).toLowerCase()));
  if (forbiddenHits.length > 0) {
    score -= Math.min(25, forbiddenHits.length * 8);
    reasons.push(`forbidden:${forbiddenHits.length}`);
  }

  let jsonResult = null;
  if (rubric.expectJsonObject) {
    jsonResult = extractJsonObject(response);
    if (jsonResult.ok) {
      score += 18;
      reasons.push('valid-json');
      const keys = rubric.requiredJsonKeys || [];
      const keyHits = keys.filter((key) => Object.prototype.hasOwnProperty.call(jsonResult.value, key));
      if (keys.length > 0) {
        score += Math.round(18 * keyHits.length / keys.length);
        reasons.push(`json-keys:${keyHits.length}/${keys.length}`);
      }
    } else {
      reasons.push('invalid-json');
    }
  }

  if (rubric.maxResponseChars && String(response || '').length <= Number(rubric.maxResponseChars)) {
    score += 8;
    reasons.push('within-length');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
    testCount,
    importHits,
    termHits,
    forbiddenHits,
    json: jsonResult
  };
}

function timingFields(payload, wallMs) {
  const timings = {
    wallMs,
    totalMs: payload.total_duration ? Math.round(payload.total_duration / 1_000_000) : null,
    loadMs: payload.load_duration ? Math.round(payload.load_duration / 1_000_000) : null,
    promptEvalMs: payload.prompt_eval_duration ? Math.round(payload.prompt_eval_duration / 1_000_000) : null,
    evalMs: payload.eval_duration ? Math.round(payload.eval_duration / 1_000_000) : null,
    promptEvalCount: payload.prompt_eval_count || null,
    evalCount: payload.eval_count || null
  };
  if (payload.eval_count && payload.eval_duration) {
    timings.tokensPerSecond = Math.round((payload.eval_count / (payload.eval_duration / 1_000_000_000)) * 100) / 100;
  }
  return timings;
}

function detectEarlyStop(response, payload, numPredict) {
  const text = String(response || '').trim();
  const fenceCount = (text.match(/```/g) || []).length;
  return {
    earlyStop: Boolean(
      (payload.done_reason && payload.done_reason !== 'stop') ||
      (payload.eval_count && payload.eval_count >= numPredict) ||
      fenceCount % 2 === 1 ||
      /[\[{(,;]$/.test(text)
    ),
    doneReason: payload.done_reason || null,
    hitNumPredict: Boolean(payload.eval_count && payload.eval_count >= numPredict),
    unclosedFence: fenceCount % 2 === 1
  };
}

async function generate(endpoint, model, prompt, context, numPredict, effortOptions = {}, timeoutMs = 3600000) {
  const optionOverrides = { ...effortOptions };
  delete optionOverrides.name;
  delete optionOverrides.numPredict;
  delete optionOverrides.num_predict;
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
      num_ctx: context,
      num_predict: numPredict,
      ...optionOverrides
    }
  };
  const started = Date.now();
  const payload = await requestJson(endpoint, '/api/generate', body, timeoutMs);
  const wallMs = Date.now() - started;
  return {
    payload,
    response: payload.response || '',
    request: body,
    timings: timingFields(payload, wallMs),
    earlyStop: detectEarlyStop(payload.response || '', payload, numPredict)
  };
}

function summarizeRecommendations(results) {
  const groups = new Map();
  for (const result of results.filter((item) => item.ok)) {
    const key = [
      result.profile,
      result.model,
      result.context,
      result.effortName || 'custom',
      result.numPredict
    ].join('\t');
    const existing = groups.get(key) || {
      profile: result.profile,
      model: result.model,
      context: result.context,
      effortName: result.effortName || 'custom',
      numPredict: result.numPredict,
      runs: 0,
      totalScore: 0,
      earlyStops: 0,
      errors: 0,
      tokensPerSecond: []
    };
    existing.runs += 1;
    existing.totalScore += result.score?.score || 0;
    if (result.earlyStop?.earlyStop) {
      existing.earlyStops += 1;
    }
    if (result.error) {
      existing.errors += 1;
    }
    if (result.timings?.tokensPerSecond) {
      existing.tokensPerSecond.push(result.timings.tokensPerSecond);
    }
    groups.set(key, existing);
  }

  const rows = [...groups.values()].map((group) => ({
    ...group,
    averageScore: Math.round((group.totalScore / Math.max(1, group.runs)) * 10) / 10,
    averageTokensPerSecond: group.tokensPerSecond.length > 0
      ? Math.round((group.tokensPerSecond.reduce((sum, value) => sum + value, 0) / group.tokensPerSecond.length) * 100) / 100
      : null
  }));

  rows.sort((a, b) => (
    b.averageScore - a.averageScore ||
    a.earlyStops - b.earlyStops ||
    b.context - a.context ||
    b.numPredict - a.numPredict ||
    String(a.model).localeCompare(String(b.model))
  ));

  const byProfile = new Map();
  for (const row of rows) {
    if (!byProfile.has(row.profile)) {
      byProfile.set(row.profile, row);
    }
  }

  return {
    ranked: rows,
    byProfile: [...byProfile.values()]
  };
}

function writeSummary(summaryPath, results, runConfig) {
  const rows = results.map((result) => [
    result.ok ? 'ok' : 'failed',
    result.profile,
    result.model,
    result.context,
    result.effortName || 'custom',
    result.numPredict,
    result.scenario,
    result.score?.score ?? '',
    result.timings?.wallMs ?? '',
    result.timings?.tokensPerSecond ?? '',
    result.earlyStop?.earlyStop ?? '',
    result.validCodeBlock ?? '',
    result.error || ''
  ]);

  const successful = results.filter((result) => result.ok);
  const ranked = [...successful].sort((a, b) => (b.score?.score || 0) - (a.score?.score || 0));
  const lines = [
    '# Remote Ollama Benchmark Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Route: ${runConfig.route}`,
    `Result directory: ${runConfig.resultDir}`,
    '',
    table(['Status', 'Profile', 'Model', 'Context', 'Effort', 'num_predict', 'Scenario', 'Score', 'Wall ms', 'tok/s', 'Early stop', 'Code block', 'Error'], rows)
  ];

  const recommendations = summarizeRecommendations(results);
  if (recommendations.byProfile.length > 0) {
    lines.push('## Recommended Standard Settings', '');
    lines.push(table(
      ['Profile', 'Model', 'Context', 'Effort', 'num_predict', 'Avg score', 'Runs', 'Early stops', 'Avg tok/s'],
      recommendations.byProfile.map((result) => [
        result.profile,
        result.model,
        result.context,
        result.effortName,
        result.numPredict,
        result.averageScore,
        result.runs,
        result.earlyStops,
        result.averageTokensPerSecond ?? ''
      ])
    ));
  }

  if (recommendations.ranked.length > 0) {
    lines.push('## Ranked Settings', '');
    lines.push(table(
      ['Rank', 'Profile', 'Model', 'Context', 'Effort', 'num_predict', 'Avg score', 'Runs', 'Early stops'],
      recommendations.ranked.slice(0, 25).map((result, index) => [
        index + 1,
        result.profile,
        result.model,
        result.context,
        result.effortName,
        result.numPredict,
        result.averageScore,
        result.runs,
        result.earlyStops
      ])
    ));
  }

  if (ranked.length > 0) {
    lines.push('## Best Runs', '');
    lines.push(table(
      ['Rank', 'Score', 'Profile', 'Model', 'Context', 'Effort', 'Wall ms', 'Reasons'],
      ranked.slice(0, 10).map((result, index) => [
        index + 1,
        result.score.score,
        result.profile,
        result.model,
        result.context,
        result.effortName || 'custom',
        result.timings.wallMs,
        result.score.reasons.join(', ')
      ])
    ));
  }

  fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`);
}

async function defaultTelemetry() {
  return null;
}

async function runBenchmarkMatrix(options) {
  const {
    config,
    route,
    profileNames,
    models,
    contexts,
    numPredict,
    scenarioName,
    scenarioNames,
    runSpecs,
    endpointForRun,
    beforeRun,
    timeoutMs = 3600000,
    collectTelemetry = defaultTelemetry
  } = options;

  const scenarios = scenarioList(scenarioNames, [scenarioName || 'vitest-generation'])
    .map((name) => loadScenario(config.rootDir, name));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultDir = path.join(config.host.resultsDir, `${timestamp}-${sanitizeName(scenarios.map((item) => item.name).join('_'))}`);
  const rawDir = path.join(resultDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const jsonlPath = path.join(resultDir, 'runs.jsonl');
  const summaryPath = path.join(resultDir, 'summary.md');
  const results = [];
  const specs = Array.isArray(runSpecs) && runSpecs.length > 0
    ? runSpecs
    : [];

  if (specs.length === 0) {
    const selectedProfiles = profileNames || ['primary'];
    const selectedContexts = contexts || [8192];
    const selectedModels = models || [];
    for (const profileName of selectedProfiles) {
      const profile = getProfile(config, profileName);
      const modelList = selectedModels.length > 0 ? selectedModels : [profile.defaultModel].filter(Boolean);
      for (const model of modelList) {
        for (const context of selectedContexts) {
          specs.push({
            profileName,
            model,
            context,
            effortName: 'custom',
            numPredict,
            effortOptions: {}
          });
        }
      }
    }
  }

  let index = 0;
  for (const spec of specs) {
    const profile = getProfile(config, spec.profileName);
    const endpoint = endpointForRun ? endpointForRun(profile, spec) : endpointFor(config, profile, route);
    const model = spec.model;
    const context = spec.context;
    const effortName = spec.effortName || 'custom';
    const runNumPredict = Number(spec.numPredict || numPredict || 4096);
    const effortOptions = spec.effortOptions || {};
    if (beforeRun) {
      await beforeRun({ profile, endpoint, model, context, numPredict: runNumPredict, effortName, spec });
    }
    for (const scenario of scenarios) {
      index += 1;
      const runId = `${String(index).padStart(3, '0')}-${sanitizeName(profile.name)}-${sanitizeName(model)}-${sanitizeName(scenario.name)}-ctx${context}-${sanitizeName(effortName)}`;
      const run = { profile, endpoint, model, context, numPredict: runNumPredict, effortName };
      const prompt = renderPrompt(scenario, run);
      const promptPath = path.join(rawDir, `${runId}.prompt.md`);
      const responsePath = path.join(rawDir, `${runId}.response.txt`);
      fs.writeFileSync(promptPath, prompt);

      process.stdout.write(`Benchmark ${runId} -> ${endpoint}\n`);
      const telemetryBefore = await collectTelemetry(profile.name, 'before');
      let result;
      try {
        const generated = await generate(endpoint, model, prompt, context, runNumPredict, effortOptions, timeoutMs);
        fs.writeFileSync(responsePath, generated.response);
        const extractedCode = extractCodeBlock(generated.response);
        const score = scoreResponse(scenario, generated.response, extractedCode);
        const telemetryAfter = await collectTelemetry(profile.name, 'after');
        result = {
          ok: true,
          runId,
          timestamp: new Date().toISOString(),
          route,
          endpoint,
          profile: profile.name,
          expectedGpuVisibility: profile.gpuDevices,
          port: profile.port,
          model,
          context,
          effortName,
          numPredict: runNumPredict,
          scenario: scenario.name,
          prompt,
          promptPath,
          response: generated.response,
          responsePath,
          promptTokensApprox: estimateTokens(prompt),
          responseChars: generated.response.length,
          requestOptions: generated.request.options,
          timings: generated.timings,
          ollamaRaw: {
            total_duration: generated.payload.total_duration,
            load_duration: generated.payload.load_duration,
            prompt_eval_duration: generated.payload.prompt_eval_duration,
            eval_duration: generated.payload.eval_duration,
            prompt_eval_count: generated.payload.prompt_eval_count,
            eval_count: generated.payload.eval_count,
            done: generated.payload.done,
            done_reason: generated.payload.done_reason
          },
          earlyStop: generated.earlyStop,
          validCodeBlock: extractedCode.valid,
          codeBlockError: extractedCode.error,
          score,
          telemetryBefore,
          telemetryAfter
        };
      } catch (error) {
        const telemetryAfter = await collectTelemetry(profile.name, 'after-error');
        result = {
          ok: false,
          runId,
          timestamp: new Date().toISOString(),
          route,
          endpoint,
          profile: profile.name,
          expectedGpuVisibility: profile.gpuDevices,
          port: profile.port,
          model,
          context,
          effortName,
          numPredict: runNumPredict,
          scenario: scenario.name,
          prompt,
          promptPath,
          response: '',
          responsePath,
          promptTokensApprox: estimateTokens(prompt),
          responseChars: 0,
          error: error.message,
          telemetryBefore,
          telemetryAfter
        };
      }

      results.push(result);
      fs.appendFileSync(jsonlPath, `${JSON.stringify(result)}\n`);
      writeSummary(summaryPath, results, { route, resultDir });
    }
  }

  return { resultDir, jsonlPath, summaryPath, results };
}

module.exports = {
  buildHardwareBenchmarkSpecs,
  estimateTokens,
  loadScenario,
  runBenchmarkMatrix,
  summarizeRecommendations
};
