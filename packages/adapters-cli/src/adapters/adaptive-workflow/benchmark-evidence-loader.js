import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { classifyBenchmarkEvidence, createBenchmarkEvidenceV1 } from "../../../../runtime/src/adaptive-workflow/benchmark-evidence.js";
import { createStrategyPolicyV1 } from "../../../../runtime/src/adaptive-workflow/strategy-policy.js";

// Parses an offline content-gen `summary.md` into deterministic benchmark
// evidence and classifies each entry against the strategy policy thresholds.
// Reads nothing except the provided summary file and never runs a live model.
export function loadBenchmarkEvidenceFromSummary(filePath, { strategyIdByProfile = {}, policy = createStrategyPolicyV1(), asOf } = {}) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseSummary(raw);
  const source = deriveSource(filePath, parsed);

  const evidence = [];
  const classifications = [];
  for (const row of parsed.aggregate) {
    const strategyId = strategyIdByProfile[row.profile];
    const evidenceId = `${source}:${row.profile}`;
    if (typeof strategyId !== "string" || strategyId.trim() === "") {
      classifications.push({ evidenceId, strategyId: null, status: "ignored", reason: "unmapped_profile", profile: row.profile });
      continue;
    }
    const item = createBenchmarkEvidenceV1({
      evidenceId,
      strategyId,
      sampleSize: row.runs,
      stability: row.execOk.rate,
      confidence: row.toolCallOk.rate,
      capturedAt: parsed.generatedAt,
      source,
      averageScore: row.avgScore,
      metrics: {
        model: row.model,
        scenarios: row.scenarios,
        execOk: row.execOk,
        toolCallOk: row.toolCallOk,
        route: parsed.route,
      },
    });
    evidence.push(item);
    classifications.push(classifyBenchmarkEvidence(item, policy, asOf));
  }

  return { source, generatedAt: parsed.generatedAt, route: parsed.route, evidence, classifications };
}

function parseSummary(raw) {
  const lines = raw.split(/\r?\n/);
  const generatedAt = matchHeader(lines, /^Generated:\s*(.+)$/);
  const route = matchHeader(lines, /^Route:\s*(.+)$/);
  const aggregate = parseAggregateTable(lines);
  return { generatedAt, route, aggregate };
}

function matchHeader(lines, pattern) {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function parseAggregateTable(lines) {
  const headingIndex = lines.findIndex((line) => /^##\s+Aggregate by Profile\s*$/.test(line));
  if (headingIndex === -1) return [];
  const rows = [];
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    // Skip the header row and the |---|---| separator row.
    if (cells[0] === "Profile" || cells.every((cell) => /^-+$/.test(cell) || cell === "")) continue;
    if (cells.length < 7) continue;
    const runs = toPositiveInt(cells[3]);
    const avgScore = toFiniteNumber(cells[4]);
    const toolCallOk = toFraction(cells[5]);
    const execOk = toFraction(cells[6]);
    if (runs === null || avgScore === null || !toolCallOk || !execOk) continue;
    rows.push({ profile: cells[0], model: cells[1], scenarios: toPositiveInt(cells[2]) ?? 0, runs, avgScore, toolCallOk, execOk });
  }
  return rows;
}

function toFraction(cell) {
  const match = String(cell).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const pass = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(total) || total <= 0 || pass < 0 || pass > total) return null;
  return { pass, total, rate: pass / total };
}

function toPositiveInt(cell) {
  const value = Number(cell);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function toFiniteNumber(cell) {
  const value = Number(cell);
  return Number.isFinite(value) ? value : null;
}

function deriveSource(filePath, parsed) {
  const dir = basename(dirname(filePath));
  if (dir && dir !== "." && dir !== "adaptive-workflow") return dir;
  if (typeof parsed.generatedAt === "string" && parsed.generatedAt.trim() !== "") return `content-gen:${parsed.generatedAt}`;
  return basename(filePath);
}
