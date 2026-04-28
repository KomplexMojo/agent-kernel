#!/usr/bin/env node
/**
 * local-test-gen: expand ## TODO: Test Permutations stubs using the currently
 * loaded Ollama model (auto-detected via /api/ps), or a specific model via --model.
 *
 * Usage:
 *   node main.mjs [--file <path>] [--dry-run] [--model <name>]
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
const DRY_RUN = args.includes("--dry-run");
const MODEL_OVERRIDE = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const TARGET_FILE = args.includes("--file") ? path.resolve(CWD, args[args.indexOf("--file") + 1]) : null;
const MAX_ITERATIONS = 5;
const OLLAMA_URL = "http://localhost:11434/api/generate";

// ── Model detection ───────────────────────────────────────────────────────────
async function detectModel() {
  if (MODEL_OVERRIDE) return MODEL_OVERRIDE;

  // /api/ps lists models currently loaded in memory (warm)
  try {
    const res = await fetch("http://localhost:11434/api/ps");
    if (res.ok) {
      const data = await res.json();
      const running = data.models ?? [];
      if (running.length > 0) return running[0].name;
    }
  } catch { /* fall through */ }

  // Fall back to /api/tags (installed models) and pick the first
  try {
    const res = await fetch("http://localhost:11434/api/tags");
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
    const stripped = lines[i].replace(/^\/\/\s*/, "").trim();
    if (stripped === "## TODO: Test Permutations") {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) return null;

  const stubs = [];
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const stripped = lines[i].replace(/^\/\/\s*/, "").trim();
    if (stripped.startsWith("- ")) {
      stubs.push(stripped.slice(2).trim());
    } else if (stripped === "") {
      // allow blank lines within the section
      continue;
    } else {
      // non-bullet, non-blank line after header — stop
      break;
    }
  }

  return { sectionStart, stubs };
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
  const isMjs = filePath.endsWith(".mjs");

  // .test.mjs → vitest; .test.js → node --test (legacy)
  const cmd = isMjs
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

// ── Error classification ───────────────────────────────────────────────────────
function classifyFailure(output) {
  const syntaxSignals = [
    /SyntaxError/i,
    /Unexpected token/i,
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

// ── Ollama call ───────────────────────────────────────────────────────────────
async function callOllama(prompt, model) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.response) throw new Error("Ollama returned empty response");

  // Strip markdown fences if present
  let code = data.response.trim();
  code = code.replace(/^```(?:javascript|js|typescript|ts|mjs)?\n?/m, "").replace(/\n?```$/m, "");
  return code.trim();
}

// ── Prompt builder ─────────────────────────────────────────────────────────────
function buildPrompt(fileContent, stubs, filePath, lastError, iteration) {
  const rel = path.relative(CWD, filePath);
  const isMjs = filePath.endsWith(".mjs");
  const runner = isMjs ? "Vitest (describe/it/expect)" : "Node built-in test runner (test() / assert)";

  // Strip the TODO section from shown content so the model doesn't reproduce it
  const displayContent = fileContent.split("\n")
    .filter(l => !l.replace(/^\/\/\s*/, "").trim().startsWith("## TODO"))
    .filter(l => !l.replace(/^\/\/\s*/, "").trim().startsWith("- ") || !fileContent.split("\n").some(ll => ll.replace(/^\/\/\s*/, "").trim() === "## TODO: Test Permutations"))
    .join("\n").trimEnd();

  // Actually, let's just take content up to the TODO line
  const todoIdx = fileContent.split("\n").findIndex(l => l.replace(/^\/\/\s*/, "").trim() === "## TODO: Test Permutations");
  const contentBeforeTodo = todoIdx !== -1
    ? fileContent.split("\n").slice(0, todoIdx).join("\n").trimEnd()
    : fileContent.trimEnd();

  const stubList = stubs.map((s, i) => `${i + 1}. ${s}`).join("\n");

  let prompt = `You are an expert JavaScript/TypeScript test engineer.

FILE: ${rel}
TEST RUNNER: ${runner}

Here is the existing test file (read it to understand the patterns, imports, and helpers):
\`\`\`javascript
${contentBeforeTodo}
\`\`\`

Your task: write concrete test cases for EACH of the following stubs. Add them at the end of the file.

STUBS TO IMPLEMENT:
${stubList}

Rules:
- Follow EXACTLY the same style as the existing tests (same runner, same assertion library, same helper usage)
- Do NOT add new import or require statements — use only what is already imported
- Do NOT repeat tests that already exist in the file
- Each stub gets exactly one test() or it() block
- Output ONLY the new test code to append — no explanation, no markdown fences, no file header
- The code must be syntactically valid and runnable immediately`;

  if (lastError && iteration > 1) {
    prompt += `

The previous attempt failed with this error:
\`\`\`
${lastError.slice(0, 800)}
\`\`\`

Fix the issue. Common causes: wrong assert method, wrong fixture name, missing await, wrong property path.`;
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

// ── Report ────────────────────────────────────────────────────────────────────
const reportRows = [];
function addReportRow(file, stubs, status, errorType, errorSnippet) {
  reportRows.push({ file, stubs, status, errorType, errorSnippet });
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
    flushLog();
    process.exit(0);
  }

  log(`Found ${targets.length} file(s) with TODO stubs\n`);

  for (const target of targets) {
    const rel = path.relative(CWD, target.file);
    log(`─── ${rel} (${target.stubs.length} stubs) ───`);
    for (const s of target.stubs) log(`  • ${s}`);

    if (DRY_RUN) {
      addReportRow(target.file, target.stubs.length, "dry-run", null, null);
      continue;
    }

    let success = false;
    let lastError = null;
    let generatedCode = null;

    for (let iter = 1; iter <= MAX_ITERATIONS && !success; iter++) {
      log(`  [iter ${iter}/${MAX_ITERATIONS}] Calling Ollama...`);
      try {
        const prompt = buildPrompt(target.content, target.stubs, target.file, lastError, iter);
        generatedCode = await callOllama(prompt, MODEL);
        log(`  Generated ${generatedCode.length} chars`);
      } catch (err) {
        log(`  Ollama call failed: ${err.message}`);
        lastError = err.message;
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
      } else {
        const errType = classifyFailure(result.output);
        lastError = result.output;
        log(`  ❌ Failed (${errType}) — ${result.output.slice(0, 150).replace(/\n/g, " ")}...`);

        if (errType === "logic" && iter === MAX_ITERATIONS) {
          // Logic failures likely mean production code needs fixing — keep the generated tests
          log(`  Keeping generated tests — logic failure indicates application code issue`);
          addReportRow(target.file, target.stubs.length, "fail", "logic", result.output.slice(0, 300));
          success = true; // don't rollback — tests are syntactically valid
        } else {
          // Syntax or early iterations — restore and retry
          fs.writeFileSync(target.file, target.content);
        }
      }
    }

    if (!success) {
      log(`  Rolled back after ${MAX_ITERATIONS} iterations`);
      fs.writeFileSync(target.file, target.content);
      addReportRow(target.file, target.stubs.length, "fail", "syntax", lastError?.slice(0, 300) ?? "unknown");
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
  flushLog();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
