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
  outDir: pathSchema("Output directory override."),
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
