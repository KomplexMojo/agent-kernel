import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { authoringSpec } from "../../packages/adapters-cli/src/mcp/tools/authoring.mjs";
import { buildArgv } from "../../packages/adapters-cli/src/mcp/tools/shared.mjs";

const require = createRequire(import.meta.url);
const { loadScenarioCatalog } = require("../remote-ollama-control/scripts/lib/ak-scenarios.js");

const ROOT = resolve(process.env.AGENT_KERNEL_ROOT || process.cwd());
const CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SERVER = join(ROOT, "packages/adapters-cli/src/mcp/server.mjs");
const OUT_ROOT = resolve(process.env.AK_BENCHMARK_OUTPUT_DIR || join(ROOT, "tools/benchmark/out"));
const VALIDATION_ROOT = join(OUT_ROOT, "Validation");
const REQUIRED_FILES = Object.freeze([
  "spec.json",
  "bundle.json",
  "manifest.json",
  "budget-receipt.json",
  "sim-config.json",
  "initial-state.json",
  "resource-bundle.json",
  "price-list.json",
  "budget.json",
  "spend-proposal.json",
  "telemetry.json",
  "request.json",
  "intent.json",
  "plan.json",
]);

function parseJsonLine(stdout) {
  const lines = String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }
  return null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function scenarioPayloadForOutput(scenario, outDir) {
  return { ...scenario.payload, outDir };
}

function resultDetail(result) {
  return [result?.error, result?.json?.error, result?.stderr, result?.stdout]
    .filter(Boolean)
    .join("\n");
}

function rejectionClass(result) {
  return /Budget (?:receipt )?(?:denied|insufficient)/i.test(resultDetail(result))
    ? "budget_denied"
    : null;
}

export function classifyCliOutcome(result) {
  if (result?.exitCode === 0 && result?.json?.ok === true) return "success";
  return rejectionClass(result) || "unexpected_failure";
}

export function classifyMcpOutcome(result) {
  if (result?.ok === true) return "success";
  return rejectionClass(result) || "unexpected_failure";
}

export function evaluateOutcomeParity(expectedOutcome, cliOutcome, mcpOutcome) {
  return {
    cliOk: cliOutcome === expectedOutcome,
    mcpOk: mcpOutcome === expectedOutcome,
    parityOk: cliOutcome === expectedOutcome && mcpOutcome === expectedOutcome,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readStableJson(path) {
  return stableStringify(JSON.parse(readFileSync(path, "utf8")));
}

function missingFiles(dir) {
  return REQUIRED_FILES.filter((file) => !existsSync(join(dir, file)));
}

function compareArtifactDirs(leftDir, rightDir) {
  const mismatches = [];
  for (const file of REQUIRED_FILES) {
    const leftPath = join(leftDir, file);
    const rightPath = join(rightDir, file);
    if (!existsSync(leftPath) || !existsSync(rightPath)) {
      mismatches.push(`${file}:missing`);
      continue;
    }
    if (readStableJson(leftPath) !== readStableJson(rightPath)) {
      mismatches.push(`${file}:diff`);
    }
  }
  return mismatches;
}

class McpServerHarness {
  constructor() {
    this.nextId = 1;
    this.stdoutBuffer = "";
    this.stderr = "";
    this.pending = new Map();
    this.closed = false;
    this.process = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.process.on("exit", (code, signal) => {
      this.closed = true;
      const reason = `MCP server exited before response (code=${code}, signal=${signal})`;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`${reason}\n${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim()) {
        this.handleMessage(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  handleMessage(line) {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`MCP request failed: ${message.error.message}\n${this.stderr}`));
      return;
    }
    pending.resolve(message.result);
  }

  request(method, params, timeoutMs = 60000) {
    if (!this.process.stdin) {
      return Promise.reject(new Error("MCP server stdin unavailable"));
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${method}\n${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.process.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "agent-kernel-benchmark-validation", version: "1.0.0" },
    });
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = result?.content?.[0]?.text;
    const parsed = text ? JSON.parse(text) : result?.structuredContent;
    return result?.structuredContent || parsed;
  }

  async close() {
    if (!this.process || this.closed) return;
    await new Promise((resolveClose) => {
      this.process.once("close", () => {
        this.closed = true;
        resolveClose();
      });
      this.process.stdin.end();
      setTimeout(() => {
        if (!this.closed) this.process.kill("SIGTERM");
      }, 500).unref();
    });
  }
}

function runCli(payload, outDir) {
  mkdirSync(outDir, { recursive: true });
  const args = buildArgv({ ...payload, outDir }, authoringSpec);
  const result = spawnSync(process.execPath, [CLI, "create", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 30,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: parseJsonLine(result.stdout),
  };
}

function summarizeRows(rows) {
  const headers = ["#", "Title", "Expected", "CLI", "MCP", "Parity", "Missing", "Error"];
  const escape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${[
      row.number,
      row.title,
      row.expectedOutcome,
      `${row.cliOutcome}:${row.cliOk ? "ok" : "fail"}`,
      `${row.mcpOutcome}:${row.mcpOk ? "ok" : "fail"}`,
      row.parityOk ? "ok" : "fail",
      [...row.cliMissing, ...row.mcpMissing].join(", "),
      row.error || "",
    ].map(escape).join(" | ")} |`),
  ].join("\n");
}

export async function validateBenchmark() {
  rmSync(VALIDATION_ROOT, { recursive: true, force: true });
  mkdirSync(VALIDATION_ROOT, { recursive: true });
  const catalog = loadScenarioCatalog();
  const mcp = new McpServerHarness();
  const rows = [];
  try {
    await mcp.initialize();
    for (const scenario of catalog.scenarios) {
      const number = String(scenario.index).padStart(2, "0");
      const slug = slugify(scenario.title);
      const cliOutDir = join(VALIDATION_ROOT, "cli", `${number}-${slug}`, "create");
      const mcpOutDir = join(VALIDATION_ROOT, "mcp", `${number}-${slug}`, "create");
      const row = {
        number,
        title: scenario.title,
        expectedOutcome: scenario.expectedOutcome,
        cliOutcome: "unexpected_failure",
        mcpOutcome: "unexpected_failure",
        cliOk: false,
        mcpOk: false,
        parityOk: false,
        cliMissing: [],
        mcpMissing: [],
        parityMismatches: [],
        spend: null,
        remaining: null,
        status: null,
        error: "",
      };

      let cliResult;
      try {
        cliResult = runCli(scenario.payload, cliOutDir);
      } catch (error) {
        cliResult = { exitCode: null, json: null, stderr: error.message, stdout: "" };
      }

      let mcpResult;
      try {
        mkdirSync(mcpOutDir, { recursive: true });
        mcpResult = await mcp.callTool(
          "ak_create",
          scenarioPayloadForOutput(scenario, mcpOutDir),
        );
      } catch (error) {
        mcpResult = { ok: false, error: error.message };
      }

      row.cliOutcome = classifyCliOutcome(cliResult);
      row.mcpOutcome = classifyMcpOutcome(mcpResult);
      Object.assign(
        row,
        evaluateOutcomeParity(scenario.expectedOutcome, row.cliOutcome, row.mcpOutcome),
      );
      row.spend = cliResult.json?.cost?.totalSpend ?? null;
      row.remaining = cliResult.json?.cost?.remaining ?? null;
      row.status = cliResult.json?.cost?.status ?? null;

      if (scenario.expectedOutcome === "success") {
        row.cliMissing = missingFiles(cliOutDir);
        row.mcpMissing = missingFiles(mcpOutDir);
        row.cliOk = row.cliOk && row.cliMissing.length === 0;
        row.mcpOk = row.mcpOk && row.mcpMissing.length === 0;
        row.parityOk = row.cliOk && row.mcpOk;
      }
      if (scenario.expectedOutcome === "success" && row.parityOk) {
        row.parityMismatches = compareArtifactDirs(cliOutDir, mcpOutDir);
        row.parityOk = row.parityMismatches.length === 0;
      }

      if (!row.cliOk) {
        row.error = [
          row.error,
          `CLI expected=${scenario.expectedOutcome} actual=${row.cliOutcome}: ${resultDetail(cliResult)}`,
        ].filter(Boolean).join(" | ");
      }
      if (!row.mcpOk) {
        row.error = [
          row.error,
          `MCP expected=${scenario.expectedOutcome} actual=${row.mcpOutcome}: ${resultDetail(mcpResult)}`,
        ].filter(Boolean).join(" | ");
      }
      if (!row.parityOk && row.parityMismatches.length > 0) {
        row.error = [
          row.error,
          `Parity mismatches: ${row.parityMismatches.join(", ")}`,
        ].filter(Boolean).join(" | ");
      }

      rows.push(row);
      console.log(JSON.stringify({
        number,
        title: scenario.title,
        expectedOutcome: scenario.expectedOutcome,
        cliOutcome: row.cliOutcome,
        mcpOutcome: row.mcpOutcome,
        cliOk: row.cliOk,
        mcpOk: row.mcpOk,
        parityOk: row.parityOk,
      }));
    }
  } finally {
    await mcp.close();
  }

  const summary = {
    ok: rows.every((row) => row.cliOk && row.mcpOk && row.parityOk),
    count: rows.length,
    scenarioSetHash: catalog.sha256,
    tierCounts: catalog.tierCounts,
    expectedOutcomes: Object.fromEntries(
      ["success", "budget_denied"].map((outcome) => [
        outcome,
        rows.filter((row) => row.expectedOutcome === outcome).length,
      ]),
    ),
    cliFailures: rows.filter((row) => !row.cliOk).length,
    mcpFailures: rows.filter((row) => !row.mcpOk).length,
    parityFailures: rows.filter((row) => !row.parityOk).length,
    rows,
  };
  writeFileSync(join(VALIDATION_ROOT, "validation-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(
    join(VALIDATION_ROOT, "validation-summary.md"),
    `# Benchmark Validation Summary\n\n${JSON.stringify({
      ok: summary.ok,
      count: summary.count,
      scenarioSetHash: summary.scenarioSetHash,
      tierCounts: summary.tierCounts,
      expectedOutcomes: summary.expectedOutcomes,
      cliFailures: summary.cliFailures,
      mcpFailures: summary.mcpFailures,
      parityFailures: summary.parityFailures,
    }, null, 2)}\n\n${summarizeRows(rows)}\n`,
  );
  return summary;
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const summary = await validateBenchmark();
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
