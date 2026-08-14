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
 *   2. Retry is gated on the ERROR being retryable, NOT on "there were errors" — the
 *      codes are `invalid_json` / `missing_response_text` (or `missing_actors` in the
 *      `actors_only` phase). Any other error goes straight past retry.
 *      *(Until 2026-08-13 this read "gated on `retryPredict > previousPredict`", which
 *      was the same thing everywhere except at the 2048 clamp — see below.)*
 *   3. Preconditions short-circuit BEFORE any IO — a failed precondition costs zero
 *      adapter calls and produces no capture artifact.
 *   4. One `runLlmSession` makes AT MOST 3 adapter calls.
 *
 * ✅ THE LATENT DEFECT THIS FILE PINNED IS NOW FIXED (Decision 2, 2026-08-13).
 * M1 characterized it and deliberately did not fix it: `buildRepairRequestOptions` caps
 * expansion at 2048, so a caller already asking for 2048 could never satisfy the gate
 * `retryPredict > previousPredict` and the retry ladder SILENTLY TURNED ITSELF OFF —
 * shortest exactly when the token budget was largest. It stayed characterized for months
 * behind "fixing it changes LLM behavior ⇒ benchmark-gated"; that gate was retired
 * 2026-08-13 when benchmarking became a standalone nightly tool outside development, and
 * the fix is below. Point 2 in the list above is updated accordingly: the retry rung is
 * gated on the ERROR being retryable, not on the options having grown.
 *
 * PROVENANCE, which is CR.4's actual charge: the capture artifact comes back stamped
 * `producedBy: "orchestrator"` with **no FSM round having run**. That is pinned below
 * so the inversion can demonstrate the stamp later comes from a real round.
 */
const assert = require("node:assert/strict");
// CR.7 / WP-5: the session REQUIRES the Director's cardSet builder injected and no longer
// imports `director/summary-selections.js`. Wired from the shared helper so tests wire what
// production wires — a stub here would be the second implementation the refusal prevents.
const { directorBuildCapabilities } = require("../../helpers/orchestrator-capabilities.js");

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
    buildCardSet: (await directorBuildCapabilities()).buildCardSet,
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

/**
 * ⚠️ RENAMED 2026-08-13 (Decision 2). This test used to be called "the retry raises
 * num_predict — that increase IS the gate", and the name was the defect: making the
 * increase the gate is what turned the ladder off at the 2048 clamp. The BEHAVIOUR it
 * asserts is still right and still pinned — below the cap, a retry does ask for more
 * tokens — it simply is not the thing that decides whether the rung runs.
 */
test("below the cap, the retry asks for more tokens than the attempt it is retrying", async () => {
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
// ✅ The pinned latent defect — FIXED 2026-08-13 (Decision 2)
// ---------------------------------------------------------------------------

/**
 * 🔴 WHAT THE DEFECT ACTUALLY WAS, because "the cap is too low" was the wrong reading.
 *
 * The retry rung was gated on `retryPredict > previousPredict` — a NUMERIC SIDE EFFECT of
 * `buildRepairRequestOptions`. That single comparison was standing in for two different
 * questions at once:
 *
 *   1. is this error the kind a retry can fix? (invalid_json / missing_response_text,
 *      or missing_actors in the actors_only phase)
 *   2. can we afford to ask for more tokens?
 *
 * They agree everywhere except at the 2048 clamp, where the answer to (2) is no and the
 * gate therefore silently answered no to (1) as well. The ladder disabled itself exactly
 * when the token budget was largest, with no error, no warning, and no observable
 * difference except the call count.
 *
 * ⇒ The fix is NOT raising the cap — that would be guessing at a model limit. The rung now
 * asks question (1) directly (`isRetryTriggeringError`), and still raises the options
 * whenever they can be raised. Same defect class this branch keeps recording: a guard
 * matching one SPELLING of a condition rather than the condition.
 */
test("at num_predict 2048 the retry still fires — the cap limits tokens, not the ladder", async () => {
  // The identical malformed response as "an unparseable response retries once and can
  // recover" above. It used to take ONE call here and fail permanently.
  const { result, adapter } = await runSession(
    { options: { num_predict: 2048 } },
    [{ response: "not json" }, { response: GOOD }],
  );

  assert.equal(adapter.calls.length, 2, "the retry fires at the cap, as it does below it");
  assert.equal(result.retried, true);
  assert.equal(result.ok, true, "a response that recovers at default options now recovers at the cap too");

  // The retry may not ask for MORE tokens — there are none to ask for — and must not
  // exceed the cap by way of the fix.
  assert.equal(
    adapter.calls[1].options.num_predict,
    2048,
    "the clamp still holds: retrying at the cap must not raise num_predict past it",
  );

  // The control that made the original finding legible, kept: the same response and
  // script without the capped option. Both paths now agree, which is the point.
  const control = await runSession({}, [{ response: "not json" }, { response: GOOD }]);
  assert.equal(control.adapter.calls.length, 2);
  assert.equal(control.result.ok, true);
});

/**
 * ⚠️ THIS TEST WAS VACUOUS ON ITS FIRST WRITING, AND THE PERTURBATION IS WHAT FOUND IT.
 *
 * It was `requireSummary: true` over `{ rooms: [] }` — which produces ZERO errors, because
 * `validateSummaryContent` only reports anything when `requireSummary` carries
 * `minRooms`/`minActors` thresholds. With no errors the whole escalation block is skipped,
 * so the retry never fires whatever the trigger says. Neutering `isRetryTriggeringError`
 * to `return true` left all 75 orchestrator tests green, and this was why: the test could
 * not disagree, because it never reached the gate.
 *
 * ⇒ *"The guard did not catch it" and "there was nothing to catch" look identical in a
 * runner* — the same finding P5.4 recorded for the Annotator's `[]`-is-truthy fallback,
 * and the P2.6 sweep for the Actor's relative assertion. Third instance on this branch.
 * A real threshold is what makes the error exist.
 */
test("a non-retryable error still skips the retry rung — the fix must not retry everything", async () => {
  // minRooms: 1 over a response with no rooms ⇒ a `missing_rooms` content error. It parses
  // fine, so it is NOT invalid_json, and no larger token budget would produce rooms the
  // model did not write. Before the fix this was filtered out as a SIDE EFFECT of the
  // options not growing; it must still be filtered now the rung asks directly, or the fix
  // would have traded one silent skip for a blanket extra adapter call on every content
  // failure.
  const { result, adapter } = await runSession(
    { requireSummary: { minRooms: 1 } },
    [{ response: JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] }) }, { response: GOOD }],
  );

  assert.equal(adapter.calls.length, 1, "a content error that a bigger budget cannot fix does not retry");
  assert.equal(result.retried, false);
  assert.equal(result.ok, false, "precondition: the response must actually fail, or this proves nothing");
});

test("the retry vocabulary is phase-sensitive: missing_actors retries only in actors_only", async () => {
  const thin = JSON.stringify({ dungeonAffinity: "fire", rooms: [{ id: "r1" }], actors: [] });

  // `missing_actors` is a retry trigger ONLY in the actors_only phase — the one place a
  // bigger budget plausibly buys the actors the model truncated away.
  const inPhase = await runSession(
    { phase: "actors_only", requireSummary: { minActors: 1 } },
    [{ response: thin }, { response: GOOD }],
  );
  assert.equal(inPhase.adapter.calls.length, 2, "actors_only retries a missing_actors response");
  assert.equal(inPhase.result.retried, true);

  // Same error, same response, different phase: no retry. This is the assertion that
  // catches a trigger widened past its vocabulary.
  const outOfPhase = await runSession(
    { requireSummary: { minActors: 1 } },
    [{ response: thin }, { response: GOOD }],
  );
  assert.equal(outOfPhase.adapter.calls.length, 1, "outside actors_only, missing_actors is not a retry trigger");
  assert.equal(outOfPhase.result.retried, false);
});

// ## TODO: Test Permutations
// - phase "actors_only": missing_actors as a retry trigger, and its 480 floor
// - num_predict just below the cap (e.g. 1808) where expansion is clamped but still increases
// - repairPromptBuilder returning empty/non-string: repair must not fire
// - a repair response with no text: what responseText and `repaired` end up as
// - sanitized: true — the no-IO fourth rung, and which responses reach it
