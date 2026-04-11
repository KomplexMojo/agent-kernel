import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { executeCommand } from "../cli/ak-impl.mjs";
import { authoringTools } from "./tools/authoring.mjs";
import { externalTools } from "./tools/external.mjs";
import { inspectionTools } from "./tools/inspection.mjs";
import { llmTools } from "./tools/llm.mjs";
import { simulationTools } from "./tools/simulation.mjs";

const SERVER_NAME = "agent-kernel-cli";
const SERVER_VERSION = "1.0.0";
const TOOL_DEFINITIONS = [
  ...authoringTools,
  ...simulationTools,
  ...inspectionTools,
  ...llmTools,
  ...externalTools,
];

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

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

async function invokeCliTool(tool, args) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

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

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOL_MAP.get(request.params.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments ?? {};
  const result = await enqueueCommand(() => invokeCliTool(tool, args));
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
