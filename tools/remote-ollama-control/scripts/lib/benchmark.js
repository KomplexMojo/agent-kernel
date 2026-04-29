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

async function generate(endpoint, model, prompt, context, numPredict) {
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
      num_ctx: context,
      num_predict: numPredict
    }
  };
  const started = Date.now();
  const payload = await requestJson(endpoint, '/api/generate', body, 3600000);
  const wallMs = Date.now() - started;
  return {
    payload,
    response: payload.response || '',
    request: body,
    timings: timingFields(payload, wallMs),
    earlyStop: detectEarlyStop(payload.response || '', payload, numPredict)
  };
}

function writeSummary(summaryPath, results, runConfig) {
  const rows = results.map((result) => [
    result.ok ? 'ok' : 'failed',
    result.profile,
    result.model,
    result.context,
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
    table(['Status', 'Profile', 'Model', 'Context', 'num_predict', 'Scenario', 'Score', 'Wall ms', 'tok/s', 'Early stop', 'Code block', 'Error'], rows)
  ];

  if (ranked.length > 0) {
    lines.push('## Best Runs', '');
    lines.push(table(
      ['Rank', 'Score', 'Profile', 'Model', 'Context', 'Wall ms', 'Reasons'],
      ranked.slice(0, 10).map((result, index) => [
        index + 1,
        result.score.score,
        result.profile,
        result.model,
        result.context,
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
    collectTelemetry = defaultTelemetry
  } = options;

  const scenario = loadScenario(config.rootDir, scenarioName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultDir = path.join(config.host.resultsDir, `${timestamp}-${sanitizeName(scenarioName)}`);
  const rawDir = path.join(resultDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const jsonlPath = path.join(resultDir, 'runs.jsonl');
  const summaryPath = path.join(resultDir, 'summary.md');
  const results = [];

  let index = 0;
  for (const profileName of profileNames) {
    const profile = getProfile(config, profileName);
    const endpoint = endpointFor(config, profile, route);
    const modelList = models.length > 0 ? models : [profile.defaultModel].filter(Boolean);
    for (const model of modelList) {
      for (const context of contexts) {
        index += 1;
        const runId = `${String(index).padStart(3, '0')}-${sanitizeName(profile.name)}-${sanitizeName(model)}-ctx${context}`;
        const run = { profile, endpoint, model, context, numPredict };
        const prompt = renderPrompt(scenario, run);
        const promptPath = path.join(rawDir, `${runId}.prompt.md`);
        const responsePath = path.join(rawDir, `${runId}.response.txt`);
        fs.writeFileSync(promptPath, prompt);

        process.stdout.write(`Benchmark ${runId} -> ${endpoint}\n`);
        const telemetryBefore = await collectTelemetry(profile.name, 'before');
        let result;
        try {
          const generated = await generate(endpoint, model, prompt, context, numPredict);
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
            numPredict,
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
            numPredict,
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
  }

  return { resultDir, jsonlPath, summaryPath, results };
}

module.exports = {
  estimateTokens,
  loadScenario,
  runBenchmarkMatrix
};
