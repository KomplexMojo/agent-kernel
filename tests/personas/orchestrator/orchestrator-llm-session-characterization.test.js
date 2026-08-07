/**
 * CR.4 M1 — CHARACTERIZATION of `runLlmSession` before the Orchestrator inversion.
 *
 * These tests pin what the code does TODAY, quirks included. They are deliberately
 * not aspirational: M3–M5 replace the three inline `await adapter.generate(...)`
 * sites (llm-session.js 576 initial / 609 retry / 639 repair) with an FSM round that
 * returns LLM requests as effects, and the ONLY way to show that inversion preserved
 * behavior is to have written down the behavior first.
 *
 * WHAT MAKES THIS WORTH PINNING: the escalation ladder is gated on things that are
 * easy to lose in a rewrite and produce no error when lost —
 *
 *   1. `strict: true` disables the ENTIRE ladder. Exactly one adapter call, ever.
 *   2. Retry is gated on `retryPredict > previousPredict`, NOT on "there were errors".
 *      `buildRepairRequestOptions` only raises `num_predict` when the errors include
 *      `invalid_json` / `missing_response_text` (or `missing_actors` in the
 *      `actors_only` phase). Any other error goes straight past retry.
 *   3. Preconditions short-circuit BEFORE any IO — a failed precondition costs zero
 *      adapter calls and produces no capture artifact.
 *   4. One `runLlmSession` makes AT MOST 3 adapter calls.
 *
 * 🔴 A LATENT DEFECT IS PINNED HERE DELIBERATELY (see the `num_predict: 2048` test).
 * `buildRepairRequestOptions` caps expansion at 2048, so when a caller already asks
 * for 2048 the gate `retryPredict > previousPredict` can never be satisfied and the
 * retry ladder SILENTLY TURNS ITSELF OFF. The identical malformed response that
 * recovers at default options becomes a permanent failure at the cap — the retry
 * ladder is disabled exactly when the token budget is largest. This is characterized,
 * NOT fixed: M1 changes no production code. Fixing it would change LLM behavior and
 * belongs behind the benchmark gate.
 *
 * PROVENANCE, which is CR.4's actual charge: the capture artifact comes back stamped
 * `producedBy: "orchestrator"` with **no FSM round having run**. That is pinned below
 * so the inversion can demonstrate the stamp later comes from a real round.
 */
const assert = require("node:assert/strict");

const SESSION = "../../../packages/runtime/src/personas/orchestrator/llm-session.js";

const BASE = Object.freeze({
  model: "fixture",
  runId: "run_characterization",
  prompt: "Return JSON only.",
});

/** A summary shape the capture parser accepts with zero errors. */
const GOOD = JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] });

/**
 * Recording adapter. Returns the scripted response for each call, repeating the last
 * one once the script runs out, and records every request it was given. Call COUNT is
 * the point of this file: it is what distinguishes "the ladder ran" from "the ladder
 * was silently skipped", and no assertion on the returned summary can see it.
 */
function recordingAdapter(responses) {
  const calls = [];
  return {
    calls,
    async generate(args) {
      calls.push(args);
      return responses[Math.min(calls.length - 1, responses.length - 1)];
    },
  };
}

async function runSession(extra, responses) {
  const { runLlmSession } = await import(SESSION);
  const adapter = recordingAdapter(responses);
  const result = await runLlmSession({
    ...BASE,
    clock: () => "2025-01-01T00:00:00Z",
    ...extra,
    adapter,
  });
  return { result, adapter };
}

// ---------------------------------------------------------------------------
// Preconditions cost no IO
// ---------------------------------------------------------------------------

test("a failed precondition short-circuits before ANY adapter call", async () => {
  const { result, adapter } = await runSession({ model: "" }, [{ response: GOOD }]);

  assert.equal(adapter.calls.length, 0, "no IO may happen when preconditions fail");
  assert.equal(result.ok, false);
  assert.equal(result.capture, null, "no capture artifact is produced");
  assert.deepEqual(result.errors.map((e) => e.code), ["missing_model"]);
});

test("an empty initial response returns early, with one call and no capture", async () => {
  const { result, adapter } = await runSession({}, [{ response: "" }]);

  assert.equal(adapter.calls.length, 1, "the initial call happened; nothing escalated");
  assert.equal(result.ok, false);
  assert.equal(result.capture, null);
  assert.deepEqual(result.errors.map((e) => e.code), ["missing_response_text"]);
});

// ---------------------------------------------------------------------------
// The happy path, and the provenance CR.4 is about
// ---------------------------------------------------------------------------

test("a clean response takes exactly one adapter call and escalates nothing", async () => {
  const { result, adapter } = await runSession({}, [{ response: GOOD }]);

  assert.equal(adapter.calls.length, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(
    { retried: result.retried, repaired: result.repaired, sanitized: result.sanitized },
    { retried: false, repaired: false, sanitized: false },
  );
});

test("CR.4: the capture is stamped producedBy 'orchestrator' with no FSM round", async () => {
  // The whole of CR.4 in one assertion. `runLlmSession` is a free function; no
  // controller, no `advance()`, no state transition — yet the artifact it returns
  // claims the Orchestrator produced it. After the inversion this stamp must come
  // from inside a real round, and this test is what makes that change visible.
  const { result } = await runSession({}, [{ response: GOOD }]);

  assert.equal(result.capture.meta.producedBy, "orchestrator");
});

// ---------------------------------------------------------------------------
// strict disables the entire ladder
// ---------------------------------------------------------------------------

test("strict: true never escalates — one call even when the response is unparseable", async () => {
  const { result, adapter } = await runSession(
    { strict: true, repairPromptBuilder: () => "REPAIR" },
    [{ response: "not json" }, { response: GOOD }],
  );

  assert.equal(adapter.calls.length, 1, "strict must not retry, repair or sanitize");
  assert.equal(result.ok, false);
  assert.equal(result.retried, false);
  assert.equal(result.repaired, false);
  assert.deepEqual(result.errors.map((e) => e.code), ["invalid_json"]);
});

// ---------------------------------------------------------------------------
// The escalation ladder
// ---------------------------------------------------------------------------

test("an unparseable response retries once and can recover", async () => {
  const { result, adapter } = await runSession({}, [
    { response: "not json" },
    { response: GOOD },
  ]);

  assert.equal(adapter.calls.length, 2);
  assert.equal(result.retried, true);
  assert.equal(result.repaired, false);
  assert.equal(result.ok, true, "the retry's response is what succeeds");
});

test("the retry raises num_predict — that increase IS the gate", async () => {
  const { adapter } = await runSession({}, [{ response: "not json" }, { response: GOOD }]);

  const [first, second] = adapter.calls;
  const firstPredict = first.options?.num_predict ?? 0;
  const secondPredict = second.options?.num_predict ?? 0;
  assert.ok(
    secondPredict > firstPredict,
    `retry must ask for more tokens than the attempt it is retrying (${firstPredict} -> ${secondPredict})`,
  );
});

test("retry then repair is the full ladder: three calls, both flags set", async () => {
  const { result, adapter } = await runSession(
    { repairPromptBuilder: () => "REPAIR PROMPT" },
    [{ response: "not json" }, { response: "still not json" }, { response: GOOD }],
  );

  assert.equal(adapter.calls.length, 3);
  assert.equal(result.retried, true);
  assert.equal(result.repaired, true);
  assert.equal(adapter.calls[2].prompt, "REPAIR PROMPT", "the repair call uses the rebuilt prompt");
});

test("THE CEILING: one runLlmSession makes at most three adapter calls", async () => {
  const { result, adapter } = await runSession(
    { repairPromptBuilder: () => "REPAIR" },
    [{ response: "never valid" }],
  );

  assert.equal(adapter.calls.length, 3, "initial + retry + repair, and no more");
  assert.equal(result.ok, false, "exhausting the ladder still fails");
});

// ---------------------------------------------------------------------------
// 🔴 The pinned latent defect
// ---------------------------------------------------------------------------

test("LATENT DEFECT: at num_predict 2048 the retry silently does not fire", async () => {
  // Identical malformed response to "an unparseable response retries once and can
  // recover" above, which takes 2 calls and ends ok:true. Here it takes ONE call and
  // fails permanently, because `buildRepairRequestOptions` caps expansion at 2048 —
  // so `retryPredict > previousPredict` is false and the ladder never starts.
  // No error, no warning, no observable difference except the call count.
  const { result, adapter } = await runSession(
    { options: { num_predict: 2048 } },
    [{ response: "not json" }, { response: GOOD }],
  );

  assert.equal(adapter.calls.length, 1, "the retry is skipped at the cap");
  assert.equal(result.retried, false);
  assert.equal(result.ok, false, "a response that recovers at default options fails at the cap");

  // The control: the SAME response, same script, without the capped option.
  const control = await runSession({}, [{ response: "not json" }, { response: GOOD }]);
  assert.equal(control.adapter.calls.length, 2);
  assert.equal(control.result.ok, true, "control proves the difference is the cap, not the response");
});

// ## TODO: Test Permutations
// - phase "actors_only": missing_actors as a retry trigger, and its 480 floor
// - num_predict just below the cap (e.g. 1808) where expansion is clamped but still increases
// - repairPromptBuilder returning empty/non-string: repair must not fire
// - a repair response with no text: what responseText and `repaired` end up as
// - sanitized: true — the no-IO fourth rung, and which responses reach it
