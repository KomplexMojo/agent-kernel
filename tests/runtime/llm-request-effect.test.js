/**
 * CR.4 M2 — the LLM request/response contract and its effect route.
 *
 * M2 adds the seam the inversion needs and nothing else: an `llm_request` effect that
 * personas can RETURN AS DATA, and a dispatch case that hands it to the LLM adapter.
 * No persona emits one yet — M3 builds the round that does.
 *
 * TWO DESIGN DECISIONS PINNED HERE.
 *
 * 1. **The LLM effect is NOT a core-ts `EffectKind`.** That enum is backed by
 *    `Int32Array`s (core-ts/src/ports/effects.ts) and can carry only integers — actor
 *    ids, coordinates, deltas. An LLM request carries a prompt string, a model name and
 *    an options object, so it cannot be represented there at all. It lives on the
 *    runtime's STRUCTURED effect layer, using a string kind, exactly where
 *    `solver_request` already lives. PX.1 therefore still holds: core-ts remains the
 *    sole origin of the numeric `EffectKind` and gains no fifteenth member.
 *
 * 2. **`llm_request` must DEFER when the adapter is absent, never report fulfilled.**
 *    `dispatchEffect`'s `default:` branch returns `{ status: "fulfilled" }` after merely
 *    logging "Unhandled effect kind". For a log or a stray effect that is harmless; for
 *    an LLM request it would mean the model was never called and the caller was told it
 *    was — a silent no-op wearing a success status. That is the same defect class as the
 *    maximizer's fallback price (WP-5/D10) and the regen branch that skipped silently.
 *    The last test here is the one that matters: it proves an `llm_request` never lands
 *    in that default branch.
 */
const assert = require("node:assert/strict");

const EFFECTS = "../../packages/runtime/src/ports/effects.js";
const ARTIFACTS = "../../packages/runtime/src/contracts/artifacts.ts";
const HELPERS = "../../packages/runtime/src/personas/_shared/persona-helpers.mts";

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test("the LlmRequest/LlmResponse schemas are declared once, in contracts", async () => {
  const { LLM_REQUEST_SCHEMA, LLM_RESPONSE_SCHEMA } = await import(ARTIFACTS);

  assert.equal(LLM_REQUEST_SCHEMA, "agent-kernel/LlmRequest");
  assert.equal(LLM_RESPONSE_SCHEMA, "agent-kernel/LlmResponse");
});

test("buildLlmRequestEffect returns an effect as DATA, with no IO performed", async () => {
  const { buildLlmRequestEffect } = await import(HELPERS);

  const effect = buildLlmRequestEffect({
    model: "fixture",
    prompt: "Return JSON only.",
    phase: "layout_only",
    personaRef: "orchestrator",
  });

  assert.equal(effect.kind, "llm_request");
  assert.equal(effect.request.model, "fixture");
  assert.equal(effect.request.prompt, "Return JSON only.");
  assert.equal(effect.request.schema, "agent-kernel/LlmRequest");
  assert.equal(effect.request.schemaVersion, 1);
  assert.equal(effect.personaRef, "orchestrator");
  assert.ok(effect.requestId, "a request id is required so the response can be correlated");
});

test("buildLlmRequestEffect refuses a request with no model or no prompt", async () => {
  const { buildLlmRequestEffect } = await import(HELPERS);

  assert.equal(buildLlmRequestEffect({ prompt: "p" }), null, "no model ⇒ no effect");
  assert.equal(buildLlmRequestEffect({ model: "m" }), null, "no prompt ⇒ no effect");
  assert.equal(buildLlmRequestEffect({}), null);
});

test("the same request produces the same requestId — replay depends on it", async () => {
  const { buildLlmRequestEffect } = await import(HELPERS);
  const args = { model: "fixture", prompt: "Return JSON only.", phase: "layout_only" };

  assert.equal(
    buildLlmRequestEffect(args).requestId,
    buildLlmRequestEffect(args).requestId,
    "request ids must be derived, not generated, or replay diverges",
  );
});

// ---------------------------------------------------------------------------
// The dispatch route
// ---------------------------------------------------------------------------

test("dispatchEffect routes an llm_request to the LLM adapter", async () => {
  const { dispatchEffect, buildEffectFromCore } = await import(EFFECTS);
  void buildEffectFromCore;
  const { buildLlmRequestEffect } = await import(HELPERS);

  const seen = [];
  const adapters = {
    llm: {
      generate: (request) => {
        seen.push(request);
        return { response: "{}" };
      },
    },
  };

  const effect = buildLlmRequestEffect({ model: "fixture", prompt: "p" });
  const outcome = dispatchEffect(adapters, effect);

  assert.equal(outcome.status, "fulfilled");
  assert.equal(seen.length, 1, "the adapter was called exactly once");
  assert.equal(seen[0].model, "fixture");
  assert.equal(seen[0].prompt, "p");
});

test("REFUSAL: with no LLM adapter the request DEFERS — it is never 'fulfilled'", async () => {
  const { dispatchEffect } = await import(EFFECTS);
  const { buildLlmRequestEffect } = await import(HELPERS);

  const effect = buildLlmRequestEffect({ model: "fixture", prompt: "p" });
  const outcome = dispatchEffect({ logger: { warn() {} } }, effect);

  assert.equal(outcome.status, "deferred", "an uncalled model must never look like a called one");
  assert.equal(outcome.reason, "missing_llm");
});

test("TEETH: an llm_request never falls through to the default 'fulfilled' branch", async () => {
  // The control. `dispatchEffect`'s default branch reports `fulfilled` for any kind it
  // does not recognise, so the ONLY thing separating "routed to the model" from
  // "silently swallowed with a warning" is the explicit case. A kind that genuinely has
  // no case demonstrates what the failure would look like.
  const { dispatchEffect } = await import(EFFECTS);
  const { buildLlmRequestEffect } = await import(HELPERS);

  const warnings = [];
  const adapters = { logger: { warn: (msg) => warnings.push(msg) } };

  const unknown = dispatchEffect(adapters, { kind: "not_a_real_kind", data: {} });
  assert.equal(unknown.status, "fulfilled", "control: unknown kinds ARE reported fulfilled");
  assert.equal(warnings.length, 1);

  const llm = dispatchEffect(adapters, buildLlmRequestEffect({ model: "m", prompt: "p" }));
  assert.equal(llm.status, "deferred", "llm_request must have its own case, not the default");
  assert.equal(warnings.length, 1, "and must not be swallowed with a warning");
});

// ## TODO: Test Permutations
// - an adapter whose generate() throws: status and reason
// - an adapter returning a promise (the real shape) — the host awaits it
// - options/format/stream threading from the builder through to the adapter call
// - requestId collision across two different prompts in the same phase
