import {
  buildArgv,
  createTool,
  pathSchema,
  stringSchema,
  withCommonOutput,
} from "./shared.mjs";

export const inspectionTools = [
  createTool({
    name: "ak_schemas",
    description: "List the schema catalog used by the runtime.",
    command: "schemas",
    inputSchema: {
      properties: {
        outDir: pathSchema("Optional output directory for schemas.json."),
      },
    },
    buildArgs: (args) => buildArgv(args, [{ key: "outDir", flag: "out-dir" }]),
  }),
  createTool({
    name: "ak_inspect",
    description: "Inspect recorded tick frames and summarize effects.",
    command: "inspect",
    inputSchema: {
      required: ["tickFrames"],
      properties: withCommonOutput({
        tickFrames: pathSchema("Tick frames path."),
        effectsLog: pathSchema("Effects log path."),
      }),
    },
    buildArgs: (args) => buildArgv(args, [
      { key: "tickFrames", flag: "tick-frames" },
      { key: "effectsLog", flag: "effects-log" },
      { key: "outDir", flag: "out-dir" },
    ]),
  }),
  createTool({
    name: "ak_narrate",
    description: "Generate a narrative artifact from frames and initial state.",
    command: "narrate",
    inputSchema: {
      required: ["tickFrames", "initialState"],
      properties: withCommonOutput({
        tickFrames: pathSchema("Tick frames path."),
        initialState: pathSchema("Initial state path."),
      }),
    },
    buildArgs: (args) => buildArgv(args, [
      { key: "tickFrames", flag: "tick-frames" },
      { key: "initialState", flag: "initial-state" },
      { key: "outDir", flag: "out-dir" },
    ]),
  }),
  createTool({
    name: "ak_show",
    description: "Show the indexed artifacts for an existing run.",
    command: "show",
    inputSchema: {
      required: ["runId"],
      properties: {
        runId: stringSchema("Run id."),
      },
    },
    buildArgs: (args) => buildArgv(args, [{ key: "runId", flag: "run-id" }]),
  }),
  createTool({
    name: "ak_diff",
    description: "Diff two existing runs.",
    command: "diff",
    inputSchema: {
      required: ["runA", "runB"],
      properties: {
        runA: stringSchema("First run id."),
        runB: stringSchema("Second run id."),
      },
    },
    buildArgs: (args) => buildArgv(args, [
      { key: "runA", flag: "run-a" },
      { key: "runB", flag: "run-b" },
    ]),
  }),
  createTool({
    name: "ak_runs_list",
    description: "List indexed runs from the artifacts directory.",
    command: "runs",
    inputSchema: {
      properties: {},
    },
    buildArgs: () => ["list"],
  }),
];
