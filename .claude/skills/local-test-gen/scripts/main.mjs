#!/usr/bin/env node
/**
 * local-test-gen: expand ## TODO: Test Permutations stubs using the currently
 * loaded Ollama model (auto-detected via /api/ps), or a specific model via --model.
 *
 * Usage:
 *   node main.mjs [--file <path>] [--dry-run] [--model <name>] [--ollama-host <url>] [--runner auto|vitest|node] [--eval-run]
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();
const REPORT_FILE = path.join(CWD, "test-gen-report.md");
const LOG_FILE = path.join(CWD, "test-gen.log");

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value === "--" || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeOllamaHost(value) {
  let raw = String(value || "http://localhost:11434").trim().replace(/\/+$/, "");
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    raw = `http://${raw}`;
  }
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported OLLAMA_HOST protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, "");
}

const DRY_RUN = args.includes("--dry-run");
const MODEL_OVERRIDE = argValue("--model") || process.env.OLLAMA_MODEL || null;
const TARGET_FILE = argValue("--file") ? path.resolve(CWD, argValue("--file")) : null;
const MAX_ITERATIONS = Number(argValue("--max-iterations") || process.env.TEST_GEN_MAX_ITERATIONS || 5);
const RUNNER_OVERRIDE = argValue("--runner") || process.env.TEST_GEN_RUNNER || "auto";
const KEEP_FAILING_LOGIC = args.includes("--keep-failing-logic");
const EVAL_RUN = args.includes("--eval-run") || process.env.TEST_GEN_EVAL_RUN === "1";
const EVAL_OUTPUT = path.resolve(CWD, argValue("--eval-output") || process.env.TEST_GEN_EVAL_OUTPUT || "test-gen-eval.json");
const NUM_CTX = optionalPositiveInteger("--num-ctx", process.env.OLLAMA_NUM_CTX || process.env.TEST_GEN_NUM_CTX);
const NUM_PREDICT = optionalPositiveInteger("--num-predict", process.env.OLLAMA_NUM_PREDICT || process.env.TEST_GEN_NUM_PREDICT);
const TEMPERATURE = optionalNumber("--temperature", process.env.TEST_GEN_TEMPERATURE, 0.2);
const REASONING_MODE = argValue("--reasoning-mode") || process.env.TEST_GEN_REASONING_MODE || (EVAL_RUN ? "plan-code" : "direct");
const SOURCE_CONTEXT_MODE = argValue("--source-context") || process.env.TEST_GEN_SOURCE_CONTEXT || "auto";
const SOURCE_CHAR_BUDGET = Number(argValue("--source-char-budget") || process.env.TEST_GEN_SOURCE_CHAR_BUDGET || 16_000);
const OLLAMA_HOST = normalizeOllamaHost(argValue("--ollama-host") || process.env.OLLAMA_HOST || "http://localhost:11434");
const OLLAMA_TIMEOUT_MS = Number(argValue("--ollama-timeout-ms") || process.env.OLLAMA_TIMEOUT_MS || 1_800_000);
if (!Number.isFinite(OLLAMA_TIMEOUT_MS) || OLLAMA_TIMEOUT_MS <= 0) {
  throw new Error("--ollama-timeout-ms / OLLAMA_TIMEOUT_MS must be a positive number");
}
if (!Number.isInteger(MAX_ITERATIONS) || MAX_ITERATIONS <= 0) {
  throw new Error("--max-iterations / TEST_GEN_MAX_ITERATIONS must be a positive integer");
}
if (!["auto", "vitest", "node"].includes(RUNNER_OVERRIDE)) {
  throw new Error("--runner / TEST_GEN_RUNNER must be one of: auto, vitest, node");
}
if (!["direct", "plan-code"].includes(REASONING_MODE)) {
  throw new Error("--reasoning-mode / TEST_GEN_REASONING_MODE must be one of: direct, plan-code");
}
if (!["auto", "off"].includes(SOURCE_CONTEXT_MODE)) {
  throw new Error("--source-context / TEST_GEN_SOURCE_CONTEXT must be one of: auto, off");
}
if (!Number.isInteger(SOURCE_CHAR_BUDGET) || SOURCE_CHAR_BUDGET < 0) {
  throw new Error("--source-char-budget / TEST_GEN_SOURCE_CHAR_BUDGET must be a non-negative integer");
}

function optionalPositiveInteger(flag, envValue) {
  const raw = argValue(flag) || envValue || null;
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function optionalNumber(flag, envValue, fallback) {
  const raw = argValue(flag) || envValue || null;
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  return parsed;
}

function ollamaApiUrl(pathname) {
  return new URL(pathname, OLLAMA_HOST).toString();
}

async function fetchOllama(pathname, init = {}, timeoutMs = OLLAMA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(ollamaApiUrl(pathname), { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms calling ${ollamaApiUrl(pathname)}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Model detection ───────────────────────────────────────────────────────────
async function detectModel() {
  if (MODEL_OVERRIDE) return MODEL_OVERRIDE;

  // /api/ps lists models currently loaded in memory (warm)
  try {
    const res = await fetchOllama("/api/ps", {}, 5000);
    if (res.ok) {
      const data = await res.json();
      const running = data.models ?? [];
      if (running.length > 0) return running[0].name;
    }
  } catch { /* fall through */ }

  // Fall back to /api/tags (installed models) and pick the first
  try {
    const res = await fetchOllama("/api/tags", {}, 5000);
    if (res.ok) {
      const data = await res.json();
      const available = data.models ?? [];
      if (available.length > 0) return available[0].name;
    }
  } catch { /* fall through */ }

  throw new Error("Cannot detect Ollama model — use --model <name> to specify one explicitly");
}

// ── Logging ───────────────────────────────────────────────────────────────────
const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}
function flushLog() {
  fs.appendFileSync(LOG_FILE, logLines.join("\n") + "\n");
  logLines.length = 0;
}

// ── TODO section detection ────────────────────────────────────────────────────
/**
 * Returns { sectionStart, stubs } where sectionStart is the 0-based line index
 * of the "## TODO: Test Permutations" header, and stubs is an array of strings.
 * Returns null if no section found.
 */
function parseTodoSection(content) {
  const lines = content.split("\n");
  let sectionStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripTodoLineSyntax(lines[i]);
    if (stripped === "## TODO: Test Permutations") {
      sectionStart = lines[i - 1]?.trim() === "/*" ? i - 1 : i;
      break;
    }
  }

  if (sectionStart === -1) return null;

  const stubs = [];
  const headerIndex = stripTodoLineSyntax(lines[sectionStart]).trim() === "## TODO: Test Permutations"
    ? sectionStart
    : sectionStart + 1;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const stripped = stripTodoLineSyntax(lines[i]);
    if (stripped.startsWith("- ")) {
      stubs.push(stripped.slice(2).trim());
    } else if (stripped === "") {
      // allow blank lines within the section
      continue;
    } else if (stripped === "*/") {
      break;
    } else {
      // non-bullet, non-blank line after header — stop
      break;
    }
  }

  return { sectionStart, stubs };
}

function stripTodoLineSyntax(line) {
  return line
    .replace(/^\/\/\s*/, "")
    .replace(/^\/\*\s*/, "")
    .replace(/^\*\s*/, "")
    .trim();
}

// ── File scanning ─────────────────────────────────────────────────────────────
function scanTestFolder(folderPath) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (entry.isFile() && /\.test\.(js|mjs)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  walk(folderPath);
  return files;
}

// ── Test runner ───────────────────────────────────────────────────────────────
function runTestFile(filePath) {
  const rel = path.relative(CWD, filePath);
  const runner = resolveRunner(filePath);

  const cmd = runner === "vitest"
    ? `pnpm exec vitest run "${rel}" 2>&1`
    : `node --test "${rel}" 2>&1`;

  try {
    const output = execSync(cmd, { encoding: "utf-8", cwd: CWD, stdio: "pipe" });
    return { success: true, output };
  } catch (err) {
    const output = err.stdout || (err.output || []).filter(Boolean).join("") || err.message;
    return { success: false, output };
  }
}

function resolveRunner(filePath) {
  if (RUNNER_OVERRIDE !== "auto") {
    return RUNNER_OVERRIDE;
  }
  if (filePath.endsWith(".mjs")) {
    return "vitest";
  }
  if (fs.existsSync(path.join(CWD, "vitest.config.mjs")) || fs.existsSync(path.join(CWD, "vitest.config.js"))) {
    return "vitest";
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (/from\s+["']vitest["']/.test(content) || /\bdescribe\s*\(/.test(content)) {
    return "vitest";
  }
  return "node";
}

// ── Error classification ───────────────────────────────────────────────────────
function classifyFailure(output) {
  const syntaxSignals = [
    /SyntaxError/i,
    /Unexpected token/i,
    /Parse failure/i,
    /RollupError/i,
    /Unterminated/i,
    /Cannot use import statement/i,
    /Unexpected identifier/i,
    /is not defined/i,
    /ReferenceError/i,
  ];
  for (const sig of syntaxSignals) {
    if (sig.test(output)) return "syntax";
  }
  return "logic";
}

function classifyFailureClasses(output, staticProblems = []) {
  const text = String(output || "");
  const classes = new Set();

  if (staticProblems.length > 0) {
    classes.add("static_validation");
  }
  if (/test is not defined/i.test(text)) {
    classes.add("runner_mismatch");
  }
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|module not found/i.test(text)) {
    classes.add("module_import");
  }
  if (/SyntaxError|Unexpected token|Parse failure|RollupError|Unterminated|Unexpected identifier/i.test(text)) {
    classes.add("syntax_parse");
  }
  if (/ReferenceError|is not defined/i.test(text)) {
    classes.add("invented_symbol");
  }
  if (/is not a function/i.test(text)) {
    classes.add("invented_api");
  }
  if (/AssertionError|expected|Expected|Received|notStrictEqual|deepEqual/i.test(text)) {
    classes.add("wrong_contract_expectation");
  }
  if (/Timed out|timeout/i.test(text)) {
    classes.add("timeout");
  }

  if (classes.size === 0 && text.trim()) {
    classes.add(classifyFailure(text) === "syntax" ? "syntax_other" : "logic_other");
  }
  if (classes.size === 0) {
    classes.add("unknown");
  }

  return [...classes];
}

// ── Ollama call ───────────────────────────────────────────────────────────────
function approxTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function ollamaOptions() {
  const options = { temperature: TEMPERATURE };
  if (NUM_CTX !== null) {
    options.num_ctx = NUM_CTX;
  }
  if (NUM_PREDICT !== null) {
    options.num_predict = NUM_PREDICT;
  }
  return options;
}

async function callOllama(prompt, model, { stripFences = true } = {}) {
  const res = await fetchOllama("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: ollamaOptions()
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.response) throw new Error("Ollama returned empty response");

  // Strip markdown fences if present
  let code = data.response.trim();
  if (stripFences) {
    code = code.replace(/^```(?:javascript|js|typescript|ts|mjs)?\n?/m, "").replace(/\n?```$/m, "");
  }
  return {
    text: code.trim(),
    metrics: {
      promptChars: prompt.length,
      promptApproxTokens: approxTokens(prompt),
      responseChars: code.trim().length,
      responseApproxTokens: approxTokens(code),
      totalDuration: data.total_duration || null,
      loadDuration: data.load_duration || null,
      promptEvalCount: data.prompt_eval_count || null,
      evalCount: data.eval_count || null,
      doneReason: data.done_reason || null
    }
  };
}

// ── Source context ────────────────────────────────────────────────────────────
function resolveImportPath(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.ts`,
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
    path.join(base, "index.ts")
  ];
  return candidates.find((candidate) => {
    const normalized = path.resolve(candidate);
    return normalized.startsWith(CWD) && fs.existsSync(normalized) && fs.statSync(normalized).isFile();
  }) || null;
}

function importedSourceFiles(testFile, content) {
  const files = new Set();
  const importRegex = /\bimport\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  const sideEffectImportRegex = /^\s*import\s+["']([^"']+)["']/gm;
  const requireRegex = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [importRegex, sideEffectImportRegex, requireRegex]) {
    for (const match of content.matchAll(regex)) {
      const resolved = resolveImportPath(testFile, match[1]);
      if (!resolved) continue;
      if (!/\.(?:js|mjs|ts)$/.test(resolved)) continue;
      if (resolved.includes(`${path.sep}tests${path.sep}fixtures${path.sep}`)) continue;
      files.add(resolved);
    }
  }

  return [...files];
}

function buildSourceContext(testFile, content) {
  if (SOURCE_CONTEXT_MODE === "off" || SOURCE_CHAR_BUDGET === 0) {
    return {
      mode: SOURCE_CONTEXT_MODE,
      budgetChars: SOURCE_CHAR_BUDGET,
      usedChars: 0,
      approxTokens: 0,
      files: [],
      text: ""
    };
  }

  let remaining = SOURCE_CHAR_BUDGET;
  const included = [];
  const chunks = [];

  for (const sourceFile of importedSourceFiles(testFile, content)) {
    if (remaining <= 0) break;
    const rel = path.relative(CWD, sourceFile);
    const raw = fs.readFileSync(sourceFile, "utf8");
    const header = `\n### ${rel}\n\`\`\`javascript\n`;
    const footer = "\n```\n";
    const available = Math.max(0, remaining - header.length - footer.length);
    if (available <= 0) break;
    const body = raw.length > available
      ? `${raw.slice(0, Math.max(0, available - 80))}\n/* truncated by source context budget */`
      : raw;
    const chunk = `${header}${body}${footer}`;
    chunks.push(chunk);
    included.push({
      file: rel,
      chars: body.length,
      truncated: raw.length > available
    });
    remaining -= chunk.length;
  }

  const text = chunks.join("");
  return {
    mode: SOURCE_CONTEXT_MODE,
    budgetChars: SOURCE_CHAR_BUDGET,
    usedChars: text.length,
    approxTokens: approxTokens(text),
    files: included,
    text
  };
}

// ── Prompt builder ─────────────────────────────────────────────────────────────
function contentBeforeTodo(fileContent) {
  const fileLines = fileContent.split("\n");
  const todoIdx = fileLines.findIndex(l => stripTodoLineSyntax(l) === "## TODO: Test Permutations");
  const promptCutoff = todoIdx > 0 && fileLines[todoIdx - 1]?.trim() === "/*"
    ? todoIdx - 1
    : todoIdx;
  return promptCutoff !== -1
    ? fileLines.slice(0, promptCutoff).join("\n").trimEnd()
    : fileContent.trimEnd();
}

function buildPlanPrompt(fileContent, stubs, filePath, sourceContext, lastError, lastGeneratedCode, iteration) {
  const rel = path.relative(CWD, filePath);
  const stubList = stubs.map((s, i) => `${i + 1}. ${s}`).join("\n");
  let prompt = `You are planning a focused JavaScript/TypeScript test-generation patch.

FILE: ${rel}

Existing tests:
\`\`\`javascript
${contentBeforeTodo(fileContent)}
\`\`\`

Relevant implementation/source context:
${sourceContext.text || "(no source context provided)"}

Stubs to implement:
${stubList}

Return a concise implementation plan only. For each stub, state:
- the exact observable behavior to assert
- any existing helper or data fixture to reuse
- expected null/undefined/empty-string/throw behavior when knowable from source
- risks such as invented APIs or ambiguous contracts

Do not write test code in this response.`;

  if (lastError && iteration > 1) {
    prompt += `

Previous attempt failed:
\`\`\`
${lastError.slice(0, 2000)}
\`\`\`

Previous generated code:
\`\`\`javascript
${String(lastGeneratedCode || "").slice(0, 4000)}
\`\`\`

Revise the plan to avoid the failure.`;
  }

  return prompt;
}

function buildPrompt(fileContent, stubs, filePath, sourceContext, reasoningPlan, lastError, lastGeneratedCode, iteration) {
  const rel = path.relative(CWD, filePath);
  const runnerName = resolveRunner(filePath);
  const runner = runnerName === "vitest"
    ? "Vitest. Use the existing test()/it()/describe() style and existing assert imports."
    : "Node built-in test runner. Use existing test() / assert patterns only.";

  const stubList = stubs.map((s, i) => `${i + 1}. ${s}`).join("\n");

  let prompt = `You are an expert JavaScript/TypeScript test engineer.

FILE: ${rel}
TEST RUNNER: ${runner}

Here is the existing test file (read it to understand the patterns, imports, and helpers):
\`\`\`javascript
${contentBeforeTodo(fileContent)}
\`\`\`

Relevant implementation/source context:
${sourceContext.text || "(no source context provided)"}

Reasoning plan to follow:
${reasoningPlan || "(none; infer directly from the test file and source context)"}

Your task: write concrete test cases for EACH of the following stubs. Add them at the end of the file.

STUBS TO IMPLEMENT:
${stubList}

Rules:
- Follow EXACTLY the same style as the existing tests (same runner, same assertion library, same helper usage)
- Do NOT add new import or require statements — use only what is already imported
- Do NOT invent helper APIs or view/model methods that are not visible in the file
- Verify each expected value against the existing helper implementation and earlier tests; do not assume undefined/null/empty-string behavior
- Do NOT repeat tests that already exist in the file
- Each stub gets exactly one test() or it() block
- Each test must assert one distinct behavior from its stub and be useful for regression detection
- Output ONLY the new test code to append — no explanation, no markdown fences, no file header
- The code must be syntactically valid and runnable immediately`;

  if (lastError && iteration > 1) {
    prompt += `

The previous attempt failed with this error:
\`\`\`
${lastError.slice(0, 2000)}
\`\`\`

Previous generated code:
\`\`\`javascript
${String(lastGeneratedCode || "").slice(0, 4000)}
\`\`\`

Fix the issue. Common causes: wrong assert method, wrong fixture shape, missing await, wrong property path, leaving a block comment unterminated, or asserting behavior that the implementation does not promise.`;
  }

  return prompt;
}

// ── Insert generated tests ────────────────────────────────────────────────────
function insertTests(originalContent, sectionStart, generatedCode) {
  const lines = originalContent.split("\n");
  // Replace from sectionStart to end of file with generated code
  const before = lines.slice(0, sectionStart);
  return before.join("\n") + "\n\n" + generatedCode.trimStart();
}

function validateGeneratedCode(generatedCode, stubCount) {
  const problems = [];
  const code = generatedCode.trim();
  if (!code) {
    problems.push("generated code is empty");
  }
  if (/^```|```$/m.test(code)) {
    problems.push("generated code contains markdown fences");
  }
  if (/^\s*import\s+/m.test(code) || /\brequire\s*\(/.test(code)) {
    problems.push("generated code adds imports or require calls");
  }
  if (/TODO: Test Permutations/.test(code)) {
    problems.push("generated code kept the TODO section");
  }
  const testCount = (code.match(/\b(?:test|it)\s*\(/g) || []).length;
  if (testCount < stubCount) {
    problems.push(`generated ${testCount} test blocks for ${stubCount} stubs`);
  }
  const opens = (code.match(/\/\*/g) || []).length;
  const closes = (code.match(/\*\//g) || []).length;
  if (opens !== closes) {
    problems.push(`unbalanced block comments: ${opens} opener(s), ${closes} closer(s)`);
  }
  return problems;
}

// ── Report ────────────────────────────────────────────────────────────────────
const reportRows = [];
function addReportRow(file, stubs, status, errorType, errorSnippet) {
  reportRows.push({ file, stubs, status, errorType, errorSnippet });
}

const evalRecords = [];
function createEvalRecord(target) {
  return {
    file: path.relative(CWD, target.file),
    stubs: target.stubs,
    stubCount: target.stubs.length,
    runner: resolveRunner(target.file),
    sourceContext: null,
    baselinePassed: null,
    status: "pending",
    passed: false,
    kept: false,
    rolledBack: false,
    skipped: false,
    iterations: 0,
    generatedTestBlocks: 0,
    promptChars: 0,
    promptApproxTokens: 0,
    responseChars: 0,
    responseApproxTokens: 0,
    failureClasses: [],
    humanCorrectionsRequired: null,
    needsHumanReview: false,
    attempts: []
  };
}

function countGeneratedTestBlocks(code) {
  return (String(code || "").match(/\b(?:test|it)\s*\(/g) || []).length;
}

function addFailureClasses(record, classes) {
  const merged = new Set(record.failureClasses);
  for (const item of classes) {
    merged.add(item);
  }
  record.failureClasses = [...merged];
}

function writeEvalReport(model, startedAt, finishedAt) {
  if (!EVAL_RUN) {
    return;
  }
  const passed = evalRecords.filter((record) => record.passed).length;
  const failed = evalRecords.filter((record) => record.status === "failed").length;
  const skipped = evalRecords.filter((record) => record.skipped).length;
  const totalIterations = evalRecords.reduce((sum, record) => sum + record.iterations, 0);
  const allFailureClasses = [...new Set(evalRecords.flatMap((record) => record.failureClasses))].sort();
  const payload = {
    schema: "agent-kernel/LocalTestGenEvalReport",
    schemaVersion: 1,
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    cwd: CWD,
    model,
    ollamaHost: OLLAMA_HOST,
    modelProfile: {
      runnerMode: RUNNER_OVERRIDE,
      maxIterations: MAX_ITERATIONS,
      numCtx: NUM_CTX,
      numPredict: NUM_PREDICT,
      temperature: TEMPERATURE,
      reasoningMode: REASONING_MODE,
      sourceContextMode: SOURCE_CONTEXT_MODE,
      sourceCharBudget: SOURCE_CHAR_BUDGET
    },
    runnerMode: RUNNER_OVERRIDE,
    maxIterations: MAX_ITERATIONS,
    keepFailingLogic: KEEP_FAILING_LOGIC,
    dryRun: DRY_RUN,
    targetFile: TARGET_FILE ? path.relative(CWD, TARGET_FILE) : null,
    summary: {
      filesProcessed: evalRecords.length,
      passed,
      failed,
      skipped,
      passRate: evalRecords.length > 0 ? passed / evalRecords.length : 0,
      totalIterations,
      averageIterations: evalRecords.length > 0 ? totalIterations / evalRecords.length : 0,
      totalPromptChars: evalRecords.reduce((sum, record) => sum + record.promptChars, 0),
      totalPromptApproxTokens: evalRecords.reduce((sum, record) => sum + record.promptApproxTokens, 0),
      needsHumanReview: evalRecords.filter((record) => record.needsHumanReview).length,
      failureClasses: allFailureClasses
    },
    files: evalRecords
  };
  fs.writeFileSync(EVAL_OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
  log(`Eval report written to ${EVAL_OUTPUT}`);
}

function writeReport(model) {
  const lines = [
    "# Test Generation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Model: ${model}`,
    "",
    "## Results",
    "",
    "| File | Stubs | Status | Error Type | Notes |",
    "|------|-------|--------|------------|-------|",
  ];

  for (const row of reportRows) {
    const file = path.relative(CWD, row.file);
    const stubCount = row.stubs;
    const status = row.status === "pass" ? "✅ pass" : row.status === "dry-run" ? "🔍 dry-run" : "❌ fail";
    const errType = row.errorType || "—";
    const notes = row.errorSnippet ? row.errorSnippet.slice(0, 80).replace(/\n/g, " ") : "—";
    lines.push(`| \`${file}\` | ${stubCount} | ${status} | ${errType} | ${notes} |`);
  }

  const passed = reportRows.filter(r => r.status === "pass").length;
  const failed = reportRows.filter(r => r.status === "fail").length;
  const logicFails = reportRows.filter(r => r.errorType === "logic").length;

  lines.push("", "## Summary", "");
  lines.push(`- Files processed: ${reportRows.length}`);
  lines.push(`- Passed: ${passed}`);
  lines.push(`- Failed: ${failed}`);
  if (logicFails > 0) {
    lines.push(`- Logic/application failures (need production code fixes): ${logicFails}`);
  }

  fs.writeFileSync(REPORT_FILE, lines.join("\n") + "\n");
  log(`Report written to ${REPORT_FILE}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  // Resolve model (skip Ollama check in dry-run)
  let MODEL = MODEL_OVERRIDE ?? "(dry-run)";
  if (!DRY_RUN) {
    try {
      MODEL = await detectModel();
    } catch (err) {
      log(`ERROR: ${err.message}`);
      process.exit(1);
    }
  }

  log("=".repeat(70));
  log(`local-test-gen — model: ${MODEL}${DRY_RUN ? " [DRY RUN]" : ""}`);
  log(`Ollama host: ${OLLAMA_HOST}`);
  log(`Runner mode: ${RUNNER_OVERRIDE}; max iterations: ${MAX_ITERATIONS}; keep failing logic: ${KEEP_FAILING_LOGIC ? "yes" : "no"}`);
  log(`Ollama options: num_ctx=${NUM_CTX ?? "default"} num_predict=${NUM_PREDICT ?? "default"} temperature=${TEMPERATURE}`);
  log(`Reasoning mode: ${REASONING_MODE}; source context: ${SOURCE_CONTEXT_MODE} (${SOURCE_CHAR_BUDGET} chars)`);
  if (EVAL_RUN) {
    log(`Eval output: ${EVAL_OUTPUT}`);
  }
  log("=".repeat(70));

  // Collect target files
  const testDir = path.join(CWD, "tests");
  if (!fs.existsSync(testDir)) {
    log(`ERROR: tests/ directory not found at ${testDir}`);
    process.exit(1);
  }

  const allFiles = TARGET_FILE ? [TARGET_FILE] : scanTestFolder(testDir);
  log(`Scanned ${allFiles.length} test files`);

  const targets = [];
  for (const f of allFiles) {
    const content = fs.readFileSync(f, "utf-8");
    const parsed = parseTodoSection(content);
    if (parsed && parsed.stubs.length > 0) {
      targets.push({ file: f, content, ...parsed });
    }
  }

  if (targets.length === 0) {
    log("No files with ## TODO: Test Permutations stubs found.");
    writeEvalReport(MODEL, startedAt, new Date().toISOString());
    flushLog();
    process.exit(0);
  }

  log(`Found ${targets.length} file(s) with TODO stubs\n`);

  for (const target of targets) {
    const rel = path.relative(CWD, target.file);
    const evalRecord = createEvalRecord(target);
    const sourceContext = buildSourceContext(target.file, target.content);
    evalRecord.sourceContext = {
      mode: sourceContext.mode,
      budgetChars: sourceContext.budgetChars,
      usedChars: sourceContext.usedChars,
      approxTokens: sourceContext.approxTokens,
      files: sourceContext.files
    };
    evalRecords.push(evalRecord);
    log(`─── ${rel} (${target.stubs.length} stubs) ───`);
    if (sourceContext.files.length > 0) {
      log(`  Source context: ${sourceContext.files.map((item) => item.file).join(", ")} (${sourceContext.usedChars} chars)`);
    }
    for (const s of target.stubs) log(`  • ${s}`);

    if (DRY_RUN) {
      addReportRow(target.file, target.stubs.length, "dry-run", null, null);
      evalRecord.status = "dry-run";
      evalRecord.skipped = true;
      evalRecord.needsHumanReview = false;
      continue;
    }

    const baseline = runTestFile(target.file);
    evalRecord.baselinePassed = baseline.success;
    if (!baseline.success) {
      const errType = classifyFailure(baseline.output);
      const classes = classifyFailureClasses(baseline.output);
      log(`  ❌ Existing file fails before generation (${errType}) — skipping`);
      addReportRow(target.file, target.stubs.length, "fail", `preexisting-${errType}`, baseline.output.slice(0, 300));
      evalRecord.status = "skipped-preexisting-failure";
      evalRecord.skipped = true;
      evalRecord.needsHumanReview = true;
      addFailureClasses(evalRecord, classes);
      continue;
    }

    let success = false;
    let lastError = null;
    let generatedCode = null;
    let reasoningPlan = null;

    for (let iter = 1; iter <= MAX_ITERATIONS && !success; iter++) {
      evalRecord.iterations = iter;
      const attempt = {
        iteration: iter,
        reasoningMode: REASONING_MODE,
        planPromptChars: 0,
        planPromptApproxTokens: 0,
        planResponseChars: 0,
        planResponseApproxTokens: 0,
        codePromptChars: 0,
        codePromptApproxTokens: 0,
        generatedChars: 0,
        generatedTestBlocks: 0,
        staticProblems: [],
        passed: false,
        errorType: null,
        failureClasses: [],
        errorSnippet: null
      };
      evalRecord.attempts.push(attempt);
      log(`  [iter ${iter}/${MAX_ITERATIONS}] Calling Ollama...`);
      try {
        if (REASONING_MODE === "plan-code") {
          const planPrompt = buildPlanPrompt(target.content, target.stubs, target.file, sourceContext, lastError, generatedCode, iter);
          const planResult = await callOllama(planPrompt, MODEL, { stripFences: false });
          reasoningPlan = planResult.text;
          attempt.planPromptChars = planResult.metrics.promptChars;
          attempt.planPromptApproxTokens = planResult.metrics.promptApproxTokens;
          attempt.planResponseChars = planResult.metrics.responseChars;
          attempt.planResponseApproxTokens = planResult.metrics.responseApproxTokens;
        }

        const prompt = buildPrompt(target.content, target.stubs, target.file, sourceContext, reasoningPlan, lastError, generatedCode, iter);
        const codeResult = await callOllama(prompt, MODEL);
        generatedCode = codeResult.text;
        attempt.codePromptChars = codeResult.metrics.promptChars;
        attempt.codePromptApproxTokens = codeResult.metrics.promptApproxTokens;
        attempt.generatedChars = generatedCode.length;
        attempt.generatedTestBlocks = countGeneratedTestBlocks(generatedCode);
        evalRecord.promptChars += attempt.planPromptChars + attempt.codePromptChars;
        evalRecord.promptApproxTokens += attempt.planPromptApproxTokens + attempt.codePromptApproxTokens;
        evalRecord.responseChars += attempt.planResponseChars + attempt.generatedChars;
        evalRecord.responseApproxTokens += attempt.planResponseApproxTokens + approxTokens(generatedCode);
        log(`  Generated ${generatedCode.length} chars`);
      } catch (err) {
        log(`  Ollama call failed: ${err.message}`);
        lastError = err.message;
        attempt.errorType = "ollama";
        attempt.errorSnippet = err.message;
        attempt.failureClasses = ["ollama_call_failed"];
        addFailureClasses(evalRecord, attempt.failureClasses);
        continue;
      }

      const staticProblems = validateGeneratedCode(generatedCode, target.stubs.length);
      if (staticProblems.length > 0) {
        lastError = `Static generated-code validation failed:\n- ${staticProblems.join("\n- ")}`;
        log(`  ❌ Static validation failed — ${staticProblems.join("; ")}`);
        attempt.staticProblems = staticProblems;
        attempt.errorType = "static";
        attempt.errorSnippet = lastError;
        attempt.failureClasses = classifyFailureClasses(lastError, staticProblems);
        addFailureClasses(evalRecord, attempt.failureClasses);
        continue;
      }

      // Write to file
      const updated = insertTests(target.content, target.sectionStart, generatedCode);
      fs.writeFileSync(target.file, updated);

      // Run tests
      log(`  Running tests...`);
      const result = runTestFile(target.file);

      if (result.success) {
        log(`  ✅ Tests passed`);
        success = true;
        addReportRow(target.file, target.stubs.length, "pass", null, null);
        attempt.passed = true;
        evalRecord.status = "passed";
        evalRecord.passed = true;
        evalRecord.kept = true;
        evalRecord.generatedTestBlocks = attempt.generatedTestBlocks;
        evalRecord.humanCorrectionsRequired = 0;
        evalRecord.needsHumanReview = false;
      } else {
        const errType = classifyFailure(result.output);
        lastError = result.output;
        const classes = classifyFailureClasses(result.output);
        log(`  ❌ Failed (${errType}) — ${result.output.slice(0, 150).replace(/\n/g, " ")}...`);
        attempt.errorType = errType;
        attempt.errorSnippet = result.output.slice(0, 1000);
        attempt.failureClasses = classes;
        addFailureClasses(evalRecord, classes);

        if (KEEP_FAILING_LOGIC && errType === "logic" && iter === MAX_ITERATIONS) {
          // Logic failures likely mean production code needs fixing — keep the generated tests
          log(`  Keeping generated tests — logic failure indicates application code issue`);
          addReportRow(target.file, target.stubs.length, "fail", "logic", result.output.slice(0, 300));
          success = true; // don't rollback — tests are syntactically valid
          evalRecord.status = "kept-failing-logic";
          evalRecord.passed = false;
          evalRecord.kept = true;
          evalRecord.needsHumanReview = true;
          evalRecord.humanCorrectionsRequired = null;
        } else {
          // Restore and retry. By default this tool only keeps fully passing generated tests.
          fs.writeFileSync(target.file, target.content);
        }
      }
    }

    if (!success) {
      log(`  Rolled back after ${MAX_ITERATIONS} iterations`);
      fs.writeFileSync(target.file, target.content);
      const finalErrorType = lastError ? classifyFailure(lastError) : "unknown";
      addReportRow(target.file, target.stubs.length, "fail", finalErrorType, lastError?.slice(0, 300) ?? "unknown");
      evalRecord.status = "failed";
      evalRecord.passed = false;
      evalRecord.kept = false;
      evalRecord.rolledBack = true;
      evalRecord.needsHumanReview = true;
      evalRecord.humanCorrectionsRequired = null;
      if (lastError) {
        addFailureClasses(evalRecord, classifyFailureClasses(lastError));
      }
    }

    log("");
  }

  log("=".repeat(70));
  log("Summary");
  log("=".repeat(70));
  const passed = reportRows.filter(r => r.status === "pass").length;
  const failed = reportRows.filter(r => r.status === "fail").length;
  log(`Files with stubs: ${reportRows.length}`);
  log(`Passed: ${passed}  Failed: ${failed}`);

  writeReport(MODEL);
  writeEvalReport(MODEL, startedAt, new Date().toISOString());
  flushLog();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
