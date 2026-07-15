import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  executeCommand,
  resolveFromRunArtifactPathsFromCommandOutDirs,
  summarizeRunShowFromCommandOutDirs,
} from "../cli/ak-impl.mjs";
import { authoringTools } from "./tools/authoring.mjs";
import { externalTools } from "./tools/external.mjs";
import { inspectionTools } from "./tools/inspection.mjs";
import { llmTools } from "./tools/llm.mjs";
import { simulationTools } from "./tools/simulation.mjs";
import { testingTools } from "./tools/testing.mjs";
import { tickTools } from "./tools/tick.mjs";
import { sandboxTools } from "./tools/sandbox.mjs";
import { adaptiveWorkflowResources, adaptiveWorkflowTools, assertAdaptiveWorkflowArgs, readAdaptiveWorkflowResource } from "./adaptive-workflow-tools.mjs";

const SERVER_NAME = "agent-kernel-cli";
const SERVER_VERSION = "1.0.0";
const TOOL_DEFINITIONS = [
  ...authoringTools,
  ...simulationTools,
  ...inspectionTools,
  ...llmTools,
  ...externalTools,
  ...testingTools,
  ...tickTools,
  ...sandboxTools,
  ...adaptiveWorkflowTools,
];

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const SESSION_TEMP_ROOT = mkdtempSync(join(os.tmpdir(), "agent-kernel-mcp-"));
const REMEMBERED_RUNS = new Map();
const MCP_REQUESTS = new Map();

let commandQueue = Promise.resolve();

function enqueueCommand(work) {
  const result = commandQueue.then(work, work);
  commandQueue = result.catch(() => {});
  return result;
}

function captureText(chunks) {
  return chunks.join("").trim();
}

function extractJsonPayload(stdoutText) {
  if (!stdoutText) {
    return undefined;
  }

  try {
    return JSON.parse(stdoutText);
  } catch {}

  const lines = stdoutText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }
  return undefined;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function pruneMcpRequests() {
  while (MCP_REQUESTS.size > 128) { const settled = Array.from(MCP_REQUESTS).find(([, entry]) => entry.settled); if (!settled) return; MCP_REQUESTS.delete(settled[0]); }
}

function getCommandOutDirEntries(runId) {
  const record = REMEMBERED_RUNS.get(runId);
  if (!record) {
    return [];
  }
  return Array.from(record.commands.entries()).map(([command, outDir]) => ({ command, outDir }));
}

function workflowRunSummaries() {
  return Array.from(REMEMBERED_RUNS.values()).filter((record) => record.commands.has("workflow")).map((record) => ({ runId: record.runId, outDir: record.commands.get("workflow") })).sort((left, right) => left.runId.localeCompare(right.runId));
}

function rememberRunArtifacts({ tool, args, result }) {
  if (result?.dryRun === true || args?.dryRun === true) {
    return false;
  }
  const runId = normalizeNonEmptyString(result?.runId) || normalizeNonEmptyString(args?.runId);
  const outDir = normalizeNonEmptyString(result?.outDir) || normalizeNonEmptyString(args?.outDir);
  if (!runId || !outDir) {
    return false;
  }
  const command = normalizeNonEmptyString(result?.command) || tool.command;
  const existing = REMEMBERED_RUNS.get(runId) || {
    runId,
    commands: new Map(),
  };
  existing.commands.set(command, outDir);
  REMEMBERED_RUNS.set(runId, existing);
  return true;
}

function toolSupportsOutDir(tool) {
  return Boolean(tool?.inputSchema?.properties?.outDir);
}

function resolveDefaultOutDir(tool, args) {
  if (!toolSupportsOutDir(tool) || normalizeNonEmptyString(args?.outDir)) {
    return null;
  }
  const runId = normalizeNonEmptyString(args?.runId);
  if (tool.command === "workflow" && tool.workflowAction !== "run") return null;
  if (tool.command === "scenario" && runId) {
    return join(SESSION_TEMP_ROOT, runId);
  }
  if (runId) {
    return join(SESSION_TEMP_ROOT, runId, tool.command);
  }
  return mkdtempSync(join(SESSION_TEMP_ROOT, `${tool.command}-`));
}

async function maybeResolveRememberedInputs(tool, rawArgs) {
  const args = { ...rawArgs };
  if (tool.command === "workflow" && tool.workflowAction !== "run" && normalizeNonEmptyString(args.runId) && !normalizeNonEmptyString(args.outDir)) {
    const outDir = REMEMBERED_RUNS.get(args.runId)?.commands.get("workflow");
    if (!outDir) throw new Error(`Unknown remembered workflow run id: ${args.runId}`);
    args.outDir = outDir;
  }
  if (
    tool.command === "run"
    && normalizeNonEmptyString(args.fromRun)
    && !normalizeNonEmptyString(args.simConfig)
    && !normalizeNonEmptyString(args.initialState)
  ) {
    const commandOutDirs = getCommandOutDirEntries(args.fromRun);
    if (commandOutDirs.length > 0) {
      const resolved = await resolveFromRunArtifactPathsFromCommandOutDirs({
        runId: args.fromRun,
        commandOutDirs,
      });
      args.simConfig = resolved.simConfigPath;
      args.initialState = resolved.initialStatePath;
      delete args.fromRun;
    }
  }
  return args;
}

async function maybeHandleRememberedTool(tool, args) {
  if (tool.command === "show" && normalizeNonEmptyString(args.runId)) {
    const commandOutDirs = getCommandOutDirEntries(args.runId);
    if (commandOutDirs.length > 0) {
      return summarizeRunShowFromCommandOutDirs({
        runId: args.runId,
        commandOutDirs,
      });
    }
  }

  if (tool.command === "runs" && REMEMBERED_RUNS.size > 0) {
    const runs = [];
    for (const runId of Array.from(REMEMBERED_RUNS.keys()).sort((left, right) => left.localeCompare(right))) {
      const summary = await summarizeRunShowFromCommandOutDirs({
        runId,
        commandOutDirs: getCommandOutDirEntries(runId),
      });
      runs.push({
        runId: summary.runId,
        status: summary.status,
        commandCount: summary.commandCount,
        commands: summary.commands,
      });
    }
    return {
      ok: true,
      command: "runs",
      action: "list",
      rootDir: SESSION_TEMP_ROOT,
      runs,
      remembered: true,
    };
  }

  return null;
}

async function invokeCliTool(tool, args) {
  if (typeof tool.handler === "function") {
    return tool.handler(args);
  }

  const stdoutChunks = [];
  const stderrChunks = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;

  const captureWrite = (chunks) => (chunk, encoding, callback) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === "string" ? encoding : "utf8") : String(chunk);
    chunks.push(text);
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  console.log = (...parts) => {
    stdoutChunks.push(`${parts.map((part) => String(part)).join(" ")}\n`);
  };
  console.error = (...parts) => {
    stderrChunks.push(`${parts.map((part) => String(part)).join(" ")}\n`);
  };
  process.stdout.write = captureWrite(stdoutChunks);
  process.stderr.write = captureWrite(stderrChunks);

  try {
    await executeCommand(tool.command, tool.buildArgs(args));
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }

  const stdoutText = captureText(stdoutChunks);
  const stderrText = captureText(stderrChunks);
  const payload = extractJsonPayload(stdoutText);

  if (payload !== undefined) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if (stderrText && payload.stderr === undefined) {
        payload.stderr = stderrText;
      }
      return payload;
    }
    return {
      ok: true,
      command: tool.command,
      data: payload,
      ...(stderrText ? { stderr: stderrText } : {}),
    };
  }

  return {
    ok: true,
    command: tool.command,
    ...(stdoutText ? { stdout: stdoutText } : {}),
    ...(stderrText ? { stderr: stderrText } : {}),
  };
}

function annotateArtifactLocation(result, { requestedArgs, preparedArgs, defaultedOutDir, remembered }) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const outDir = normalizeNonEmptyString(result.outDir) || normalizeNonEmptyString(preparedArgs?.outDir);
  if (!outDir) {
    return result;
  }
  result.artifactLocation = {
    outDir,
    requestedByCaller: normalizeNonEmptyString(requestedArgs?.outDir) !== "",
    defaultedToTemp: normalizeNonEmptyString(defaultedOutDir) !== "",
    remembered: Boolean(remembered),
    ...(normalizeNonEmptyString(defaultedOutDir) ? { tempRoot: SESSION_TEMP_ROOT } : {}),
  };
  return result;
}

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => enqueueCommand(() => ({
  tools: TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
})));

server.setRequestHandler(ListResourcesRequestSchema, async () => enqueueCommand(() => ({ resources: adaptiveWorkflowResources })));
server.setRequestHandler(ReadResourceRequestSchema, async (request) => enqueueCommand(() => {
  const value = readAdaptiveWorkflowResource(request.params.uri, workflowRunSummaries());
  return { contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] };
}));

async function executeToolRequest(tool, requestedArgs) {
  const rememberedResult = await maybeHandleRememberedTool(tool, requestedArgs);
  if (rememberedResult) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(rememberedResult, null, 2),
        },
      ],
      structuredContent: rememberedResult,
    };
  }

  const preparedArgs = await maybeResolveRememberedInputs(tool, requestedArgs);
  const defaultedOutDir = resolveDefaultOutDir(tool, preparedArgs);
  if (defaultedOutDir) {
    preparedArgs.outDir = defaultedOutDir;
  }

  const result = await invokeCliTool(tool, preparedArgs);
  const remembered = rememberRunArtifacts({ tool, args: preparedArgs, result });
  annotateArtifactLocation(result, {
    requestedArgs,
    preparedArgs,
    defaultedOutDir,
    remembered,
  });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}

async function handleToolRequest(request, extra) {
  const tool = TOOL_MAP.get(request.params.name);
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  const requestedArgs = request.params.arguments ?? {};
  if (extra?.requestId === undefined) {
    if (tool.command === "workflow") assertAdaptiveWorkflowArgs(tool, requestedArgs);
    return executeToolRequest(tool, requestedArgs);
  }
  const key = `${typeof extra.requestId}:${String(extra.requestId)}`; const signature = canonicalJson({ name: tool.name, arguments: requestedArgs }); const cached = MCP_REQUESTS.get(key);
  if (cached) { if (cached.signature !== signature) throw new Error(`MCP request id conflict: ${key}`); return cached.promise; }
  const entry = { signature, settled: false, promise: null };
  entry.promise = (async () => { if (tool.command === "workflow") assertAdaptiveWorkflowArgs(tool, requestedArgs); return executeToolRequest(tool, requestedArgs); })().finally(() => { entry.settled = true; pruneMcpRequests(); }); MCP_REQUESTS.set(key, entry); pruneMcpRequests();
  return entry.promise;
}

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => enqueueCommand(() => handleToolRequest(request, extra)));

const transport = new StdioServerTransport();
await server.connect(transport);
