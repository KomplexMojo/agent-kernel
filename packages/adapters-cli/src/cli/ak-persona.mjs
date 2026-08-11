#!/usr/bin/env node
/**
 * ak-persona — run one persona standalone: artifact in, artifact out, one process.
 *
 *   ak-persona <persona> --in <spec.json> --out <result.json>
 *   ak-persona <persona> < spec.json > result.json      (stdin/stdout when --in/--out are absent)
 *
 * A FIRST-CLASS ENTRY POINT, NOT A TEST HARNESS. It happens to be used heavily by
 * the G1 CLI-differential tests, whose mechanism is: capture the inputs the
 * PRODUCTION path handed a persona, run the persona standalone on those same
 * inputs, and assert the artifacts match. A mismatch means glue computed a
 * different answer than the owning persona would have — i.e. a second
 * implementation of a chartered behavior (criterion A1/A2).
 *
 * That is a stronger instrument than module mocking, which proves only that a
 * persona was CALLED. "Called but ignored" is the shape of every finding in
 * CR.1-CR.9, so the gate has to compare answers, not call counts.
 *
 * It also buys, independent of enforcement: per-persona golden fixtures,
 * single-persona replay, and the ability to bisect a bad build by running one
 * persona in isolation.
 *
 * Envelope: agent-kernel/PersonaInvocation -> agent-kernel/PersonaResult
 * (DECISION D-j, contracts/artifacts.ts). Maps 1:1 onto the existing
 * `advance({phase, event, payload, tick})` signature, so no persona code changed
 * to add this.
 *
 * RULES THIS FILE HOLDS TO:
 *   - The clock is REQUIRED. Never defaulted, here or anywhere downstream (PX.3).
 *   - Invalid input exits non-zero with a structured error listing every problem.
 *   - No network. No writes outside --out.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  PERSONA_INVOCATION_SCHEMA as INVOCATION_SCHEMA,
  PERSONA_RESULT_SCHEMA as RESULT_SCHEMA,
} from "../../../runtime/src/contracts/artifacts.ts";

const require = createRequire(import.meta.url);
const RUNTIME = "../../../runtime/src";

const PERSONA_MODULES = Object.freeze({
  orchestrator: `${RUNTIME}/personas/orchestrator/persona.js`,
  director: `${RUNTIME}/personas/director/persona.js`,
  configurator: `${RUNTIME}/personas/configurator/persona.js`,
  actor: `${RUNTIME}/personas/actor/persona.js`,
  allocator: `${RUNTIME}/personas/allocator/persona.js`,
  annotator: `${RUNTIME}/personas/annotator/persona.js`,
  moderator: `${RUNTIME}/personas/moderator/persona.js`,
});

const PERSONA_FACTORIES = Object.freeze({
  orchestrator: "createOrchestratorPersona",
  director: "createDirectorPersona",
  configurator: "createConfiguratorPersona",
  actor: "createActorPersona",
  allocator: "createAllocatorPersona",
  annotator: "createAnnotatorPersona",
  moderator: "createModeratorPersona",
});

export const PERSONA_NAMES = Object.freeze(Object.keys(PERSONA_MODULES));
const TICK_PHASES = Object.freeze(["init", "observe", "decide", "apply", "emit", "summarize"]);


export class PersonaCliError extends Error {
  constructor(code, errors) {
    super(`${code}: ${errors.join("; ")}`);
    this.name = "PersonaCliError";
    this.code = code;
    this.errors = errors;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** ISO-8601 UTC, and a real date — "not-a-date" must not pass as a clock. */
function isIsoUtcTimestamp(value) {
  if (!isNonEmptyString(value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function validateMeta(meta, errors) {
  if (!isObject(meta)) {
    errors.push("meta: expected object");
    return;
  }
  if (!isNonEmptyString(meta.id)) errors.push("meta.id: expected non-empty string");
  if (!isNonEmptyString(meta.runId)) errors.push("meta.runId: expected non-empty string");
  if (!isIsoUtcTimestamp(meta.createdAt)) errors.push("meta.createdAt: expected ISO-8601 UTC timestamp");
  if (!isNonEmptyString(meta.producedBy)) errors.push("meta.producedBy: expected non-empty string");
}

/**
 * Validate a PersonaInvocation. Reports EVERY problem rather than the first, so a
 * malformed envelope is fixed in one pass.
 */
export function validatePersonaInvocation(input) {
  if (!isObject(input)) return { ok: false, errors: ["invocation: expected object"] };
  const errors = [];

  if (input.schema !== INVOCATION_SCHEMA) errors.push(`schema: expected ${INVOCATION_SCHEMA}`);
  if (input.schemaVersion !== 1) errors.push("schemaVersion: expected 1");
  validateMeta(input.meta, errors);

  if (!PERSONA_NAMES.includes(input.persona)) {
    errors.push(`persona: expected one of ${PERSONA_NAMES.join("|")}`);
  }

  // The clock is required, not defaulted. See PX.3.
  if (!isIsoUtcTimestamp(input.clock)) {
    errors.push("clock: expected ISO-8601 UTC timestamp (required — the clock is never defaulted)");
  }

  // `state` must be present and explicitly null: no persona can be rebuilt from
  // its own view() yet (PX.4), so a non-null value is refused rather than ignored.
  if (!("state" in input)) {
    errors.push("state: expected null (required key)");
  } else if (input.state !== null) {
    errors.push(
      "state: only null is supported — personas cannot yet be restored from a serialized view() "
        + "(finding PX.4; restore() lands in HANDOFF-4)",
    );
  }

  if ("seed" in input && input.seed !== null && !Number.isInteger(input.seed)) {
    errors.push("seed: expected integer or null");
  }
  if (input.seed !== undefined && input.seed !== null && input.persona !== "actor") {
    errors.push(`seed: only the actor persona accepts a seed (got persona "${input.persona}")`);
  }

  for (const key of ["priceList", "priceListMeta"]) {
    if (input[key] !== undefined && input[key] !== null && !isObject(input[key])) {
      errors.push(`${key}: expected object or null`);
    }
    if (input[key] !== undefined && input[key] !== null && input.persona !== "allocator") {
      errors.push(`${key}: only the allocator persona accepts a price list (got persona "${input.persona}")`);
    }
  }

  const invocation = input.invocation;
  if (!isObject(invocation)) {
    errors.push("invocation: expected object");
  } else {
    if (!TICK_PHASES.includes(invocation.phase)) {
      errors.push(`invocation.phase: expected one of ${TICK_PHASES.join("|")}`);
    }
    if (!isNonEmptyString(invocation.event)) {
      errors.push("invocation.event: expected non-empty string");
    }
    if (invocation.payload !== undefined && !isObject(invocation.payload)) {
      errors.push("invocation.payload: expected object");
    }
    if (!Number.isInteger(invocation.tick) || invocation.tick < 0) {
      errors.push("invocation.tick: expected non-negative integer");
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Construct the persona and run exactly one round.
 *
 * The clock is injected as a FIXED function returning the envelope's timestamp —
 * a standalone invocation must be reproducible, so time cannot advance mid-round.
 */
export async function runPersonaInvocation(invocationArtifact) {
  const validation = validatePersonaInvocation(invocationArtifact);
  if (!validation.ok) throw new PersonaCliError("invalid_persona_invocation", validation.errors);

  const { persona, clock, seed, priceList, priceListMeta, invocation } = invocationArtifact;
  const module = await import(PERSONA_MODULES[persona]);
  const factory = module[PERSONA_FACTORIES[persona]];
  if (typeof factory !== "function") {
    throw new PersonaCliError("persona_factory_missing", [
      `${PERSONA_FACTORIES[persona]} is not exported from ${PERSONA_MODULES[persona]}`,
    ]);
  }

  const options = { clock: () => clock };
  if (persona === "actor" && Number.isInteger(seed)) options.seed = seed;
  if (persona === "allocator") {
    if (priceList) options.priceList = priceList;
    if (priceListMeta) options.priceListMeta = priceListMeta;
  }

  const instance = factory(options);
  const subscribed = Array.isArray(instance.subscribePhases)
    && instance.subscribePhases.includes(invocation.phase);

  const round = instance.advance({
    phase: invocation.phase,
    event: invocation.event,
    payload: invocation.payload ?? {},
    tick: invocation.tick,
  });

  // The persona's state comes from view(), NOT from the advance() return.
  //
  // They are not the same thing for three of the seven: the Director, Configurator
  // and Allocator merge a service-side context into view() that advance() does not
  // return — `hasConfig`/`validated`/`locked`/`configVersion`, `planId`/
  // `buildSpecCount`, `budgetTokens`/`receiptCount`/`lastReceiptStatus`. Reading the
  // advance return dropped exactly those fields, which are the ones carrying
  // build-plane authority, and it was also inconsistent: the unsubscribed path in
  // every controller already returns view(). view() is the persona's declared
  // serialized surface, so it is what a differential compares and what restore()
  // will eventually round-trip.
  const view = instance.view();

  return {
    schema: RESULT_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: `${invocationArtifact.meta.id}_result`,
      runId: invocationArtifact.meta.runId,
      createdAt: clock,
      producedBy: persona,
    },
    persona,
    state: { state: view.state, context: view.context },
    subscribed,
    actions: round.actions ?? [],
    effects: round.effects ?? [],
    // Uniform across personas: only the Director populates this.
    artifacts: round.artifacts ?? [],
    telemetry: round.telemetry ?? null,
  };
}

function parseArgs(argv) {
  const errors = [];
  const positional = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--in" || arg === "--out") {
      const value = argv[index + 1];
      if (!isNonEmptyString(value) || value.startsWith("--")) {
        errors.push(`${arg}: expected a file path`);
      } else {
        flags[arg.slice(2)] = value;
      }
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg.startsWith("--")) {
      errors.push(`${arg}: unknown flag (ak-persona accepts --in, --out, --help)`);
    } else {
      positional.push(arg);
    }
  }

  if (!flags.help) {
    if (positional.length === 0) errors.push(`persona: expected one of ${PERSONA_NAMES.join("|")}`);
    if (positional.length > 1) errors.push(`unexpected arguments: ${positional.slice(1).join(", ")}`);
    if (positional.length === 1 && !PERSONA_NAMES.includes(positional[0])) {
      errors.push(`persona: "${positional[0]}" is not a persona (expected ${PERSONA_NAMES.join("|")})`);
    }
  }

  return { persona: positional[0], ...flags, errors };
}

const USAGE = `ak-persona — run one persona standalone (artifact in, artifact out)

  ak-persona <persona> --in <spec.json> --out <result.json>
  ak-persona <persona> < spec.json > result.json

  personas: ${PERSONA_NAMES.join(", ")}

  --in <path>   PersonaInvocation artifact (default: stdin)
  --out <path>  PersonaResult artifact     (default: stdout)

The input envelope is agent-kernel/PersonaInvocation; "clock" is required and is
never defaulted, and "state" must be null until restore() exists.`;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    throw new PersonaCliError("missing_input", ["no --in path given and stdin is empty"]);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.errors.length > 0) throw new PersonaCliError("invalid_arguments", args.errors);

  const raw = args.in ? readFileSync(args.in, "utf8") : readStdin();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PersonaCliError("invalid_json", [
      `${args.in || "stdin"}: ${error.message}`,
    ]);
  }

  // The positional persona must agree with the envelope; a silent override would
  // make the recorded artifact a lie about what ran.
  if (isObject(parsed) && parsed.persona !== undefined && parsed.persona !== args.persona) {
    throw new PersonaCliError("persona_mismatch", [
      `argument "${args.persona}" does not match envelope persona "${parsed.persona}"`,
    ]);
  }

  const result = await runPersonaInvocation(parsed);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) writeFileSync(args.out, serialized);
  else process.stdout.write(serialized);
  return 0;
}

// Executed directly (not imported by a test).
if (process.argv[1] && require.resolve(process.argv[1]) === require.resolve(import.meta.filename)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const payload = {
      error: error.code || "persona_cli_error",
      message: error.message,
      errors: error.errors || [],
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  }
}
