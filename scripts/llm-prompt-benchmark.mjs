#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CAPTURE_SCHEMA = "agent-kernel/CapturedInputArtifact";

function printUsage() {
  console.log(`Usage: node scripts/llm-prompt-benchmark.mjs [options]

Options:
  --root <path>              Root directory to scan (default: artifacts)
  --run-id-regex <pattern>   Only include runIds matching the regex
  --variant-regex <pattern>  Regex with named groups (?<variant>...) and optional (?<mode>...)
  --top <n>                  Number of leaderboard rows (default: 20)
  --show-runs                Include per-run table in text output
  --json                     Print JSON instead of text tables
  --help                     Show this help text

Examples:
  node scripts/llm-prompt-benchmark.mjs --root artifacts --show-runs
  node scripts/llm-prompt-benchmark.mjs --root artifacts/runs --json
  node scripts/llm-prompt-benchmark.mjs --variant-regex "^(?<variant>prompt[A-Z])_(?<mode>strict|resilient)_"
`);
}

function parseArgs(argv) {
  const args = {
    root: "artifacts",
    runIdRegex: null,
    variantRegex: null,
    top: 20,
    showRuns: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") {
      args.root = argv[i + 1];
      i += 1;
    } else if (token === "--run-id-regex") {
      args.runIdRegex = argv[i + 1];
      i += 1;
    } else if (token === "--variant-regex") {
      args.variantRegex = argv[i + 1];
      i += 1;
    } else if (token === "--top") {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(parsed) && parsed > 0) args.top = parsed;
      i += 1;
    } else if (token === "--show-runs") {
      args.showRuns = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function safeJsonRead(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function findFilesByName(rootDir, fileName) {
  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        found.push(fullPath);
      }
    }
  }
  return found.sort();
}

function inferMode(runId) {
  if (/strict/i.test(runId)) return "strict";
  if (/(resilient|nonstrict|default|normal)/i.test(runId)) return "resilient";
  return "unknown";
}

function inferVariant(runId) {
  const stripped = runId
    .replace(/(?:^|[_-])(strict|resilient|nonstrict|default|normal)(?:[_-]|$)/gi, "_")
    .replace(/(?:^|[_-])(run|llm|plan|budget|loop|benchmark|bench)(?:[_-]|$)/gi, "_")
    .replace(/(?:^|[_-])(rep|round|trial|seed)[-_]?\d+(?:[_-]|$)/gi, "_")
    .replace(/[_-]{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
  return stripped || runId;
}

function deriveVariantMode(runId, variantRegex) {
  if (variantRegex) {
    const match = runId.match(variantRegex);
    if (match) {
      const groups = match.groups || {};
      const variant = groups.variant || match[1] || inferVariant(runId);
      const mode = groups.mode || match[2] || inferMode(runId);
      return { variant, mode };
    }
  }
  return { variant: inferVariant(runId), mode: inferMode(runId) };
}

function getCapturePaths(runDir, manifest) {
  if (manifest && Array.isArray(manifest.artifacts)) {
    const fromManifest = manifest.artifacts
      .filter((entry) => entry?.schema === CAPTURE_SCHEMA && typeof entry.path === "string")
      .map((entry) => resolve(runDir, entry.path))
      .filter((path) => existsSync(path));
    if (fromManifest.length > 0) return fromManifest.sort();
  }
  let files = [];
  try {
    files = readdirSync(runDir)
      .filter((name) => /(capture_llm_|captured-input-llm-).*\.json$/i.test(name))
      .map((name) => join(runDir, name))
      .sort();
  } catch {
    files = [];
  }
  return files;
}

function estimatePhaseCountFromCaptures(captures) {
  if (!Array.isArray(captures) || captures.length === 0) return 0;
  const phases = captures
    .map((capture) => capture?.payload?.phase)
    .filter((value) => typeof value === "string" && value.length > 0);
  if (phases.length === 0) return captures.length;
  let transitions = 1;
  for (let i = 1; i < phases.length; i += 1) {
    if (phases[i] !== phases[i - 1]) {
      transitions += 1;
    }
  }
  return transitions;
}

function countErrors(list = []) {
  if (!Array.isArray(list)) return 0;
  return list.length;
}

function analyzeRun({
  telemetryPath,
  runIdRegex = null,
  variantRegex = null,
} = {}) {
  const runDir = dirname(telemetryPath);
  const telemetry = safeJsonRead(telemetryPath);
  if (!telemetry) {
    return { skip: "invalid_telemetry_json", runDir };
  }
  const runId = telemetry?.meta?.runId || basename(dirname(runDir)) || basename(runDir);
  if (runIdRegex && !runIdRegex.test(runId)) {
    return { skip: "run_id_filtered", runDir, runId };
  }
  const trace = Array.isArray(telemetry?.data?.llm?.trace) ? telemetry.data.llm.trace : [];
  const budgetLoop = telemetry?.data?.llm?.budgetLoop === true;
  const manifest = safeJsonRead(join(runDir, "manifest.json"));
  const capturePaths = getCapturePaths(runDir, manifest);
  const captures = capturePaths.map((path) => safeJsonRead(path)).filter(Boolean);

  if (trace.length === 0 && captures.length === 0) {
    return { skip: "no_llm_data", runDir, runId };
  }

  const captureCount = captures.length;
  const phaseCount = trace.length > 0 ? trace.length : estimatePhaseCountFromCaptures(captures);
  const repairCount = Math.max(0, captureCount - phaseCount);
  const parseErrorCount = captures.reduce((sum, capture) => sum + countErrors(capture?.payload?.errors), 0);
  const validationWarningCount = trace.reduce(
    (sum, phase) => sum + countErrors(phase?.validationWarnings),
    0,
  );
  const traceDurationMs = trace.reduce(
    (sum, phase) => sum + (Number.isFinite(phase?.durationMs) ? phase.durationMs : 0),
    0,
  );
  const captureDurationMs = captures.reduce(
    (sum, capture) => sum + (Number.isFinite(capture?.payload?.phaseTiming?.durationMs) ? capture.payload.phaseTiming.durationMs : 0),
    0,
  );
  const durationMs = traceDurationMs > 0 ? traceDurationMs : captureDurationMs > 0 ? captureDurationMs : null;

  const parsePenaltyPhases = Math.min(phaseCount, parseErrorCount);
  const cleanPhaseRate = phaseCount > 0
    ? Math.max(0, (phaseCount - repairCount - parsePenaltyPhases) / phaseCount)
    : 0;
  const repairsPerPhase = phaseCount > 0 ? repairCount / phaseCount : 0;
  const warningsPerPhase = phaseCount > 0 ? validationWarningCount / phaseCount : 0;
  const parseErrorsPerCapture = captureCount > 0 ? parseErrorCount / captureCount : 0;
  const scoreRaw = 100
    - (repairsPerPhase * 40)
    - (warningsPerPhase * 30)
    - (parseErrorsPerCapture * 30);
  const score = Math.max(0, Math.min(100, scoreRaw));
  const { variant, mode } = deriveVariantMode(runId, variantRegex);

  return {
    runId,
    runDir,
    variant,
    mode,
    budgetLoop,
    captureCount,
    phaseCount,
    repairCount,
    parseErrorCount,
    validationWarningCount,
    durationMs,
    cleanPhaseRate,
    score,
  };
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function aggregateRuns(runs) {
  const byGroup = new Map();
  for (const run of runs) {
    const key = `${run.variant}||${run.mode}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        variant: run.variant,
        mode: run.mode,
        runs: 0,
        captureCount: 0,
        phaseCount: 0,
        repairCount: 0,
        parseErrorCount: 0,
        validationWarningCount: 0,
        durationMs: 0,
        cleanRunCount: 0,
        scoreTotal: 0,
      });
    }
    const group = byGroup.get(key);
    group.runs += 1;
    group.captureCount += run.captureCount;
    group.phaseCount += run.phaseCount;
    group.repairCount += run.repairCount;
    group.parseErrorCount += run.parseErrorCount;
    group.validationWarningCount += run.validationWarningCount;
    group.durationMs += Number.isFinite(run.durationMs) ? run.durationMs : 0;
    group.scoreTotal += run.score;
    if (run.repairCount === 0 && run.parseErrorCount === 0 && run.validationWarningCount === 0) {
      group.cleanRunCount += 1;
    }
  }

  const leaderboard = Array.from(byGroup.values()).map((group) => {
    const avgDurationMs = group.runs > 0 ? group.durationMs / group.runs : 0;
    const avgRepairsPerRun = group.runs > 0 ? group.repairCount / group.runs : 0;
    const avgParseErrorsPerRun = group.runs > 0 ? group.parseErrorCount / group.runs : 0;
    const avgValidationWarningsPerRun = group.runs > 0 ? group.validationWarningCount / group.runs : 0;
    const avgParseErrorsPerCapture = group.captureCount > 0 ? group.parseErrorCount / group.captureCount : 0;
    const avgValidationWarningsPerPhase = group.phaseCount > 0 ? group.validationWarningCount / group.phaseCount : 0;
    const avgCleanPhaseRate = group.phaseCount > 0
      ? Math.max(0, (group.phaseCount - group.repairCount - Math.min(group.phaseCount, group.parseErrorCount)) / group.phaseCount)
      : 0;
    const cleanRunRate = group.runs > 0 ? group.cleanRunCount / group.runs : 0;
    const score = group.runs > 0 ? group.scoreTotal / group.runs : 0;
    return {
      variant: group.variant,
      mode: group.mode,
      runs: group.runs,
      cleanRunRate: round(cleanRunRate),
      avgCleanPhaseRate: round(avgCleanPhaseRate),
      avgRepairsPerRun: round(avgRepairsPerRun),
      avgValidationWarningsPerRun: round(avgValidationWarningsPerRun),
      avgValidationWarningsPerPhase: round(avgValidationWarningsPerPhase),
      avgParseErrorsPerRun: round(avgParseErrorsPerRun),
      avgParseErrorsPerCapture: round(avgParseErrorsPerCapture),
      avgDurationMs: round(avgDurationMs, 2),
      score: round(score, 3),
    };
  });

  leaderboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.avgCleanPhaseRate !== a.avgCleanPhaseRate) return b.avgCleanPhaseRate - a.avgCleanPhaseRate;
    if (a.avgValidationWarningsPerPhase !== b.avgValidationWarningsPerPhase) {
      return a.avgValidationWarningsPerPhase - b.avgValidationWarningsPerPhase;
    }
    if (a.avgRepairsPerRun !== b.avgRepairsPerRun) return a.avgRepairsPerRun - b.avgRepairsPerRun;
    return a.avgDurationMs - b.avgDurationMs;
  });

  return leaderboard;
}

function formatTable(rows, columns) {
  const widths = columns.map((column) => {
    const values = rows.map((row) => String(row[column.key] ?? ""));
    return Math.max(column.label.length, ...values.map((value) => value.length));
  });
  const header = columns
    .map((column, i) => column.label.padEnd(widths[i], " "))
    .join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = rows.map((row) => columns
    .map((column, i) => {
      const value = String(row[column.key] ?? "");
      return column.align === "right"
        ? value.padStart(widths[i], " ")
        : value.padEnd(widths[i], " ");
    })
    .join("  "));
  return [header, divider, ...lines].join("\n");
}

function toDisplayRuns(runs) {
  return runs.map((run) => ({
    runId: run.runId,
    variant: run.variant,
    mode: run.mode,
    cleanPhaseRate: round(run.cleanPhaseRate, 3),
    repairs: run.repairCount,
    valWarns: run.validationWarningCount,
    parseErrs: run.parseErrorCount,
    durationMs: run.durationMs ?? "",
    score: round(run.score, 3),
  }));
}

export function benchmarkPromptRuns({
  root = "artifacts",
  runIdRegex = null,
  variantRegex = null,
} = {}) {
  const resolvedRoot = resolve(root);
  const telemetryPaths = findFilesByName(resolvedRoot, "telemetry.json");
  const analyzedRuns = [];
  const skipped = [];
  for (const telemetryPath of telemetryPaths) {
    const result = analyzeRun({ telemetryPath, runIdRegex, variantRegex });
    if (result.skip) {
      skipped.push(result);
      continue;
    }
    analyzedRuns.push(result);
  }

  analyzedRuns.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.cleanPhaseRate !== a.cleanPhaseRate) return b.cleanPhaseRate - a.cleanPhaseRate;
    return a.runId.localeCompare(b.runId);
  });

  return {
    generatedAt: new Date().toISOString(),
    root: resolvedRoot,
    totalTelemetryFiles: telemetryPaths.length,
    analyzedRuns: analyzedRuns.length,
    skippedRuns: skipped.length,
    runs: analyzedRuns.map((run) => ({
      ...run,
      cleanPhaseRate: round(run.cleanPhaseRate),
      score: round(run.score, 3),
    })),
    leaderboard: aggregateRuns(analyzedRuns),
    skipped,
  };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const runIdRegex = parsed.runIdRegex ? new RegExp(parsed.runIdRegex) : null;
  const variantRegex = parsed.variantRegex ? new RegExp(parsed.variantRegex) : null;
  const result = benchmarkPromptRuns({
    root: parsed.root,
    runIdRegex,
    variantRegex,
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`LLM Prompt Benchmark`);
  console.log(`Root: ${result.root}`);
  console.log(`Telemetry files: ${result.totalTelemetryFiles}`);
  console.log(`Analyzed runs: ${result.analyzedRuns}`);
  console.log(`Skipped runs: ${result.skippedRuns}`);
  console.log("");

  const topLeaderboard = result.leaderboard.slice(0, parsed.top).map((row, index) => ({
    rank: index + 1,
    variant: row.variant,
    mode: row.mode,
    runs: row.runs,
    cleanRunRate: row.cleanRunRate,
    cleanPhaseRate: row.avgCleanPhaseRate,
    repairsRun: row.avgRepairsPerRun,
    warnRun: row.avgValidationWarningsPerRun,
    parseRun: row.avgParseErrorsPerRun,
    avgMs: row.avgDurationMs ?? "",
    score: row.score,
  }));

  if (topLeaderboard.length > 0) {
    console.log(`Leaderboard`);
    console.log(formatTable(topLeaderboard, [
      { key: "rank", label: "#", align: "right" },
      { key: "variant", label: "Variant" },
      { key: "mode", label: "Mode" },
      { key: "runs", label: "Runs", align: "right" },
      { key: "cleanRunRate", label: "CleanRunRate", align: "right" },
      { key: "cleanPhaseRate", label: "CleanPhaseRate", align: "right" },
      { key: "repairsRun", label: "Repairs/Run", align: "right" },
      { key: "warnRun", label: "Warns/Run", align: "right" },
      { key: "parseRun", label: "ParseErr/Run", align: "right" },
      { key: "avgMs", label: "AvgMs", align: "right" },
      { key: "score", label: "Score", align: "right" },
    ]));
  } else {
    console.log("No matching runs found.");
  }

  if (parsed.showRuns && result.runs.length > 0) {
    console.log("");
    console.log(`Runs`);
    console.log(formatTable(
      toDisplayRuns(result.runs).slice(0, parsed.top),
      [
        { key: "runId", label: "RunId" },
        { key: "variant", label: "Variant" },
        { key: "mode", label: "Mode" },
        { key: "cleanPhaseRate", label: "CleanPhaseRate", align: "right" },
        { key: "repairs", label: "Repairs", align: "right" },
        { key: "valWarns", label: "ValWarns", align: "right" },
        { key: "parseErrs", label: "ParseErrs", align: "right" },
        { key: "durationMs", label: "DurationMs", align: "right" },
        { key: "score", label: "Score", align: "right" },
      ],
    ));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

