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
// semicolon-delimited key=value string that agon.mjs CLI flags expect.
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
      // Intensity travels too (it was dropped, so an MCP object could not set it).
      const aparts = v.map((a) => (typeof a === "string" ? a : `${a.kind}:${a.expression}:${a.stacks ?? 1}${a.intensity === undefined ? "" : `:${a.intensity}`}`));
      if (aparts.length) parts.push(`affinities=${aparts.join(",")}`);
    } else if (k === "motivation" && Array.isArray(v)) {
      // One motivation per family, e.g. ["exploring", "stealthy"] → motivation=exploring+stealthy.
      if (v.length) parts.push(`motivation=${v.join("+")}`);
    } else if (k === "equip" && Array.isArray(v)) {
      const eparts = v.map((e) =>
        typeof e === "string" ? e : [e.kind, e.expression, ...(e.stacks === undefined ? [] : [e.stacks])].join(":")
      );
      if (eparts.length) parts.push(`equip=${eparts.join(",")}`);
    } else if (k === "strategyRecipe") {
      // #719: the Actor's strategy recipes by name (camelCase in an object, strategy-recipe= in the spec).
      parts.push(`strategy-recipe=${v}`);
    } else if (k === "strategy" && typeof v === "object") {
      // A strategy object travels as inline JSON (strategy={...}); a string is compact goals or a .json path.
      parts.push(`strategy=${JSON.stringify(v)}`);
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

// #185: one vital shape everywhere. Actors author vitals as a map keyed by name; a resource
// grants one vital and the CLI grammar takes it flat (permanenceMode + vital + delta|regen).
// A resource object may carry the actor-style map under `vital` or `vitals`; a map with one
// vital and only grant fields is spelled here as the flat fields. Anything else travels
// as JSON for runtime's resource grammar (authoring-specs.js) to refuse with its reason:
// this never decides what a resource may be, and never throws, so a refused spec is a
// refused create rather than a crashed call.
const RESOURCE_GRANT_FIELDS = Object.freeze(["permanenceMode", "delta", "regen"]);

function flattenResourceVitalMap(spec, map) {
  const names = Object.keys(map);
  if (names.length !== 1) return null;
  const [name] = names;
  const inner = map[name] !== null && typeof map[name] === "object" ? map[name] : { delta: map[name] };
  if (Array.isArray(inner) || Object.keys(inner).some((field) => !RESOURCE_GRANT_FIELDS.includes(field))) return null;
  const flat = {};
  for (const field of RESOURCE_GRANT_FIELDS) {
    const outer = spec[field];
    const nested = inner[field];
    if (outer !== undefined && nested !== undefined && String(outer) !== String(nested)) return null;
    flat[field] = outer ?? nested;
  }
  const rest = Object.fromEntries(Object.entries(spec).filter(([key]) => !["vital", "vitals", ...RESOURCE_GRANT_FIELDS].includes(key)));
  return { permanenceMode: flat.permanenceMode, vital: name, delta: flat.delta, regen: flat.regen, ...rest };
}

export function resourceSpecToString(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return specObjectToString(spec);
  const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const mapKey = isMap(spec.vital) ? "vital" : isMap(spec.vitals) ? "vitals" : null;
  if (!mapKey) return specObjectToString(spec);
  const both = spec.vital !== undefined && spec.vitals !== undefined;
  const flat = both ? null : flattenResourceVitalMap(spec, spec[mapKey]);
  if (flat) return specObjectToString(flat);
  const { vital: _vital, vitals: _vitals, ...rest } = spec;
  return specObjectToString({ ...rest, vital: JSON.stringify(spec[mapKey]) });
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
