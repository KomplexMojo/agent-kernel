import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from "../../../../runtime/src/contracts/domain-constants.js";

export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs";
export { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL };

export const pathSchema = (description) => ({
  type: "string",
  minLength: 1,
  description,
});

export const stringSchema = (description, extras = {}) => ({
  type: "string",
  ...extras,
  description,
});

export const integerSchema = (description, extras = {}) => ({
  type: "integer",
  ...extras,
  description,
});

export const booleanSchema = (description) => ({
  type: "boolean",
  description,
});

export const stringArraySchema = (description) => ({
  type: "array",
  items: { type: "string" },
  description,
});

// Accepts both plain spec strings and structured objects so MCP clients
// (Claude Code, benchmark harness) can produce either format.
export const entitySpecSchema = (description) => ({
  type: "array",
  items: { oneOf: [{ type: "string" }, { type: "object", additionalProperties: true }] },
  description,
});

// Canonical serializer: converts a structured entity spec object into the
// semicolon-delimited key=value string that ak.mjs CLI flags expect.
// Passes plain strings through unchanged so the function is idempotent.
export function specObjectToString(spec) {
  if (typeof spec === "string") return spec;
  if (!spec || typeof spec !== "object") return String(spec);

  const parts = [];
  for (const [k, v] of Object.entries(spec)) {
    if (v === undefined || v === null) continue;
    if (k === "vitals" && typeof v === "object" && !Array.isArray(v)) {
      const vparts = Object.entries(v).map(([vk, vv]) => {
        if (typeof vv === "object") return `${vk}:${vv.max ?? 1}:${vv.regen ?? 0}`;
        return `${vk}:${vv}`;
      });
      if (vparts.length) parts.push(`vitals=${vparts.join(",")}`);
    } else if (k === "affinities" && Array.isArray(v)) {
      const aparts = v.map((a) => `${a.kind}:${a.expression}:${a.stacks ?? 1}`);
      if (aparts.length) parts.push(`affinities=${aparts.join(",")}`);
    } else if (k === "goals" && Array.isArray(v)) {
      const gparts = v.map((g) =>
        typeof g === "string" ? g : g.priority ? `${g.kind}:${g.priority}` : g.kind
      );
      if (gparts.length) parts.push(`goals=${gparts.join(",")}`);
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.join(";");
}

export function createTool({ name, description, command, inputSchema, buildArgs }) {
  return {
    name,
    description,
    command,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      ...inputSchema,
    },
    buildArgs,
  };
}

export function createHandlerTool({ name, description, inputSchema, handler }) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      ...inputSchema,
    },
    handler,
  };
}

export function buildArgv(args = {}, spec = []) {
  const argv = [];
  for (const entry of spec) {
    const {
      key,
      flag = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`),
      repeatable = false,
      boolean = false,
      format = (value) => String(value),
      defaultValue,
    } = entry;

    let value = args[key];
    if (value === undefined && defaultValue !== undefined) {
      value = typeof defaultValue === "function" ? defaultValue(args) : defaultValue;
    }
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (boolean) {
      argv.push(`--${flag}`);
      continue;
    }
    const values = repeatable ? (Array.isArray(value) ? value : [value]) : [value];
    for (const item of values) {
      if (item === undefined || item === null) {
        continue;
      }
      argv.push(`--${flag}`, format(item));
    }
  }
  return argv;
}

export const commonOutputProperties = {
  outDir: pathSchema("Output directory override. When omitted, the MCP server uses a writable temp folder and remembers it for follow-up tool calls."),
  out: pathSchema("Output file override when supported by the command."),
  runId: stringSchema("Run id override."),
  createdAt: stringSchema("Created-at timestamp override.", { format: "date-time" }),
};

export function withCommonOutput(properties = {}) {
  return {
    ...properties,
    ...commonOutputProperties,
  };
}
