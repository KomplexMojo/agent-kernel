import { buildArgv, createTool, integerSchema, pathSchema, stringSchema } from "./tools/shared.mjs";

const runProperties = {
  input: pathSchema("AdaptiveWorkflowCliRunInput fixture path."), objective: stringSchema("Workflow objective.", { minLength: 1 }),
  policy: pathSchema("Strategy policy path."), runtimeProfile: pathSchema("Runtime profile path."), model: stringSchema("Model override.", { minLength: 1 }),
  maxModelAttempts: integerSchema("Bounded model attempts.", { minimum: 1 }), outDir: pathSchema("Durable run directory; MCP temp storage is used when omitted."),
  runId: stringSchema("Run id.", { minLength: 1 }), createdAt: stringSchema("Created-at timestamp.", { format: "date-time" }),
};
const targetProperties = { outDir: pathSchema("Durable run directory."), runId: stringSchema("Remembered workflow run id.", { minLength: 1 }) };
const runFlags = [{ key: "input" }, { key: "objective" }, { key: "policy" }, { key: "runtimeProfile", flag: "runtime-profile" }, { key: "model" }, { key: "maxModelAttempts", flag: "max-model-attempts" }, { key: "outDir", flag: "out-dir" }, { key: "runId", flag: "run-id" }, { key: "createdAt", flag: "created-at" }];
const targetFlags = [{ key: "outDir", flag: "out-dir" }, { key: "runId", flag: "run-id" }];
const workflowTool = ({ action, description, properties, schema = {}, flags }) => ({
  ...createTool({ name: `ak_workflow_${action}`, description, command: "workflow", inputSchema: { properties, ...schema }, buildArgs: (args) => [action, ...buildArgv(args, flags)] }), workflowAction: action,
});

export const adaptiveWorkflowTools = [
  workflowTool({ action: "run", description: "Run AdaptiveWorkflowAgent through the controlled CLI adapter.", properties: runProperties, schema: { oneOf: [{ required: ["input"] }, { required: ["objective"] }] }, flags: runFlags }),
  workflowTool({ action: "status", description: "Read durable workflow status.", properties: targetProperties, schema: { anyOf: [{ required: ["outDir"] }, { required: ["runId"] }] }, flags: targetFlags }),
  workflowTool({ action: "replay", description: "Replay from recorded model content without live IO.", properties: targetProperties, schema: { anyOf: [{ required: ["outDir"] }, { required: ["runId"] }] }, flags: targetFlags }),
  workflowTool({ action: "cancel", description: "Request cancellation through durable workflow state.", properties: { ...targetProperties, reason: stringSchema("Cancellation reason.", { minLength: 1 }) }, schema: { anyOf: [{ required: ["outDir"] }, { required: ["runId"] }] }, flags: [...targetFlags, { key: "reason" }] }),
  workflowTool({ action: "validate", description: "Validate workflow input without model or execution calls.", properties: runProperties, schema: { oneOf: [{ required: ["input"] }, { required: ["objective"] }] }, flags: runFlags }),
];

function isDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number); const [hour, minute, second] = match.slice(4, 7).map(Number);
  const offsetHour = Number(match[7] ?? 0); const offsetMinute = Number(match[8] ?? 0);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 60 && offsetHour <= 23 && offsetMinute <= 59;
}

export function assertAdaptiveWorkflowArgs(tool, args) {
  const schema = tool.inputSchema; const properties = schema.properties || {}; const unknown = Object.keys(args).filter((key) => !(key in properties));
  if (unknown.length) throw new Error(`Unknown workflow tool arguments: ${unknown.join(", ")}`);
  for (const [key, value] of Object.entries(args)) { const rule = properties[key]; if (rule.type === "string" && (typeof value !== "string" || (rule.minLength && !value.trim()) || (rule.format === "date-time" && !isDateTime(value)))) throw new Error(`Invalid workflow tool argument: ${key}`); if (rule.type === "integer" && (!Number.isInteger(value) || value < (rule.minimum ?? -Infinity))) throw new Error(`Invalid workflow tool argument: ${key}`); }
  for (const key of schema.required || []) if (args[key] === undefined) throw new Error(`Missing workflow tool argument: ${key}`);
  if (schema.oneOf && schema.oneOf.filter((option) => option.required.every((key) => args[key] !== undefined)).length !== 1) throw new Error("Workflow tool requires exactly one input form");
  if (schema.anyOf && !schema.anyOf.some((option) => option.required.every((key) => args[key] !== undefined))) throw new Error("Workflow tool requires outDir or runId");
}

export const adaptiveWorkflowResources = ["policy", "runtime-profile", "validators", "run-history"].map((name) => ({ uri: `agent-kernel://adaptive-workflow/${name}`, name: `Adaptive workflow ${name}`, description: `Safe AdaptiveWorkflowAgent ${name} metadata.`, mimeType: "application/json" }));
export function readAdaptiveWorkflowResource(uri, runs = []) {
  const name = adaptiveWorkflowResources.find((resource) => resource.uri === uri)?.uri.split("/").pop();
  const values = { policy: { schemaVersion: 1, strategies: ["flagship_full_context_v1", "local_sectional_repair_v1"], validationAuthority: "deterministic" }, "runtime-profile": { schemaVersion: 1, source: "adapter-injected", correctnessInvariant: true }, validators: { validators: [{ id: "workflow_required_keys", version: 1 }] }, "run-history": { runs } };
  if (!name || !values[name]) throw new Error(`Unknown adaptive workflow resource: ${uri}`);
  return values[name];
}
