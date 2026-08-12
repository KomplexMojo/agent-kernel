import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { authoringSpec } from "../../packages/adapters-cli/src/mcp/tools/authoring.mjs";
import { buildArgv } from "../../packages/adapters-cli/src/mcp/tools/shared.mjs";

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

function extractPayload(notePath) {
  const text = readFileSync(notePath, "utf8");
  const match = text.match(/## MCP Payload\s+```json\s+([\s\S]*?)\s+```/);
  if (!match) {
    throw new Error(`MCP payload block not found in ${notePath}`);
  }
  return JSON.parse(match[1]);
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

function scenarioNotes() {
  return readdirSync(OUT_ROOT)
    .filter((entry) => /^\d{2} .+\.md$/.test(entry))
    .sort()
    .map((entry) => join(OUT_ROOT, entry));
}

function summarizeRows(rows) {
  const headers = ["#", "Title", "CLI", "MCP", "Parity", "Missing", "Error"];
  const escape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${[
      row.number,
      row.title,
      row.cliOk ? "ok" : "fail",
      row.mcpOk ? "ok" : "fail",
      row.parityOk ? "ok" : "fail",
      [...row.cliMissing, ...row.mcpMissing].join(", "),
      row.error || "",
    ].map(escape).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  mkdirSync(VALIDATION_ROOT, { recursive: true });
  const notes = scenarioNotes();
  const mcp = new McpServerHarness();
  const rows = [];
  await mcp.initialize();
  try {
    for (const notePath of notes) {
      const file = notePath.split("/").at(-1);
      const number = file.slice(0, 2);
      const title = file.slice(3, -3);
      const slug = slugify(title);
      const payload = extractPayload(notePath);
      const cliOutDir = join(VALIDATION_ROOT, "cli", `${number}-${slug}`, "create");
      const mcpOutDir = join(VALIDATION_ROOT, "mcp", `${number}-${slug}`, "create");
      const row = {
        number,
        title,
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
      try {
        const cli = runCli(payload, cliOutDir);
        row.cliOk = cli.exitCode === 0 && cli.json?.ok === true;
        row.cliMissing = missingFiles(cliOutDir);
        row.cliOk = row.cliOk && row.cliMissing.length === 0;
        row.spend = cli.json?.cost?.totalSpend ?? null;
        row.remaining = cli.json?.cost?.remaining ?? null;
        row.status = cli.json?.cost?.status ?? null;
        if (!row.cliOk) {
          row.error = [row.error, `CLI exit=${cli.exitCode} ${cli.stderr || cli.stdout}`].filter(Boolean).join(" | ");
        }
      } catch (error) {
        row.error = [row.error, `CLI ${error.message}`].filter(Boolean).join(" | ");
      }
      try {
        mkdirSync(mcpOutDir, { recursive: true });
        const mcpResult = await mcp.callTool("ak_create", { ...payload, outDir: mcpOutDir });
        row.mcpOk = mcpResult?.ok === true;
        row.mcpMissing = missingFiles(mcpOutDir);
        row.mcpOk = row.mcpOk && row.mcpMissing.length === 0;
        if (!row.mcpOk) {
          row.error = [row.error, `MCP ${JSON.stringify(mcpResult)}`].filter(Boolean).join(" | ");
        }
      } catch (error) {
        row.error = [row.error, `MCP ${error.message}`].filter(Boolean).join(" | ");
      }
      if (row.cliOk && row.mcpOk) {
        row.parityMismatches = compareArtifactDirs(cliOutDir, mcpOutDir);
        row.parityOk = row.parityMismatches.length === 0;
        if (!row.parityOk) {
          row.error = [row.error, `Parity mismatches: ${row.parityMismatches.join(", ")}`].filter(Boolean).join(" | ");
        }
      }
      rows.push(row);
      console.log(JSON.stringify({
        number,
        title,
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
      cliFailures: summary.cliFailures,
      mcpFailures: summary.mcpFailures,
      parityFailures: summary.parityFailures,
    }, null, 2)}\n\n${summarizeRows(rows)}\n`,
  );
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

await main();
