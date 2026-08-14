/**
 * CR.4 M4b — the host loop that dispatches what the Orchestrator's round asks for.
 *
 * The round (`personas/orchestrator/llm-round.js`) returns `llm_request` effects and
 * never awaits anything. Something has to actually perform the call, and that something
 * is GLUE: it lives here in `commands/`, not in the persona, and it routes through
 * `ports/effects.js` so the adapter boundary stays the only place IO happens.
 *
 *     round.begin() ──▶ effect ──▶ dispatchEffect ──▶ adapter.generate ──▶ fulfill()
 *                          ▲                                                   │
 *                          └───────────────── next rung ────────────────────────┘
 *
 * `runLlmSessionHosted` is a DROP-IN for `runLlmSession`: same arguments, same result
 * shape. That is deliberate — M5 has eleven more call sites to migrate, and a migration
 * that also changes the caller's contract cannot be verified against goldens.
 *
 * THREE THINGS THIS HAS TO GET RIGHT.
 *
 * 1. **A `deferred` dispatch is a failure, not a response.** `dispatchEffect` defers when
 *    no LLM adapter is wired. Feeding that into `fulfill()` would report a model that was
 *    never called as one that answered badly. M2 made dispatch honest specifically so the
 *    host could not accidentally launder a no-op into a bad answer.
 *
 * 2. **Preconditions behave like `runLlmSession`, not like the round.** The round THROWS
 *    on a missing model or prompt, which is right for a persona — that is a programming
 *    error. But `runLlmSession` RETURNS `{ ok: false, errors, capture: null }` with zero
 *    adapter calls, and kernel.js's error paths are written against that shape. The host
 *    bridges the two, so migrating a call site changes WHERE IO happens and nothing else.
 *
 * 3. **The adapter is called with the shape it already expects.** The effect's `request`
 *    carries an envelope (schema, requestId, phase, baseUrl) that the adapters have never
 *    seen. Passing it straight through would quietly change what every adapter receives —
 *    including the one the content-gen benchmark runs against — so the request is mapped
 *    back to `{ model, prompt, options, format, stream }` at the boundary.
 */

import { createOrchestratorPersona } from "../personas/orchestrator/persona.js";
import { dispatchEffect } from "../ports/effects.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function preconditionFailure(errors) {
  return {
    ok: false,
    errors,
    capture: null,
    captureErrors: ["LLM session preconditions failed."],
  };
}

/**
 * Run one LLM session through the Orchestrator's round, dispatching each request.
 *
 * Signature-compatible with `runLlmSession`. `adapter` is the LLM adapter the caller
 * already holds; it is wrapped into the `adapters` shape `dispatchEffect` expects rather
 * than the adapters themselves being changed — adapter contracts are out of scope here
 * and are what the benchmark exercises.
 */
export async function runLlmSessionHosted({ adapter, ...sessionArgs } = {}) {
  const errors = [];
  if (!adapter || typeof adapter.generate !== "function") {
    errors.push({ field: "adapter", code: "missing_adapter", message: "adapter.generate is required" });
  }
  if (!isNonEmptyString(sessionArgs.model)) {
    errors.push({ field: "model", code: "missing_model", message: "model is required" });
  }
  if (!isNonEmptyString(sessionArgs.runId)) {
    errors.push({
      field: "runId",
      code: "missing_run_id",
      message: "runId is required for deterministic capture",
    });
  }
  if (typeof sessionArgs.clock !== "function") {
    errors.push({
      field: "clock",
      code: "missing_clock",
      message: "clock function is required for deterministic capture",
    });
  }
  if (errors.length > 0) {
    return preconditionFailure(errors);
  }

  const orchestrator = createOrchestratorPersona({ clock: sessionArgs.clock });
  const round = orchestrator.llm.beginRound(sessionArgs);

  // The round refuses a request it cannot make well-formed (no prompt after composition).
  // For a persona that is a programming error and a throw is right; for this host's
  // callers it is the same `{ ok: false }` `runLlmSession` has always returned.
  let outcome;
  try {
    outcome = round.begin();
  } catch (error) {
    return preconditionFailure([
      { field: "prompt", code: "missing_prompt", message: error.message },
    ]);
  }

  const adapters = {
    llm: {
      generate: (request) => adapter.generate({
        model: request.model,
        prompt: request.prompt,
        options: request.options,
        format: request.format,
        stream: Boolean(request.stream),
      }),
    },
  };

  let lastResponse;
  while (outcome.effect) {
    const dispatched = dispatchEffect(adapters, outcome.effect);
    if (dispatched.status !== "fulfilled") {
      // The model was never called. Saying so is the whole point of M2's explicit case.
      return {
        ok: false,
        errors: [{
          field: "adapter",
          code: dispatched.reason || "llm_dispatch_deferred",
          message: `LLM request was not dispatched: ${dispatched.reason || "deferred"}`,
        }],
        capture: null,
        captureErrors: ["LLM request was not dispatched."],
      };
    }
    lastResponse = await dispatched.result;
    outcome = round.fulfill(lastResponse);
  }

  return { ...outcome.result, response: lastResponse };
}
