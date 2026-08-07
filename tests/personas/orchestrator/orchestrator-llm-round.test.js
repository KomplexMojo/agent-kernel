/**
 * CR.4 M3 — the LLM escalation ladder as an FSM that performs no IO.
 *
 * M1 wrote down what `runLlmSession` does. M2 made the request something a persona can
 * return. M3 is the round itself: the same ladder — initial, retry, repair, sanitize —
 * expressed as STATES, where each rung hands back an `llm_request` effect instead of
 * awaiting `adapter.generate(...)`.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROVE: **the round never performs IO.** Every test
 * here runs with no adapter in sight. If a future edit reintroduces an `await` inside the
 * round, there is nothing to await against and these fail.
 *
 * THE LADDER IS NOT REIMPLEMENTED. The round imports the same decision helpers
 * `runLlmSession` uses (`evaluateCapture`, `buildRepairRequestOptions`, `getNumPredict`,
 * `extractResponseText`). Two independent copies of "should this retry?" is the CR.1
 * defect class — a second silently-diverging answer to one question — and it is exactly
 * what a parallel implementation invites. The equivalence with M1's characterization is
 * therefore structural, not a coincidence to be re-asserted.
 *
 * States gate real behavior (charter: label-only states are a defect). You cannot repair
 * before evaluating a response, and a completed round refuses to accept another one.
 */
const assert = require("node:assert/strict");

const ROUND = "../../../packages/runtime/src/personas/orchestrator/llm-round.js";

const GOOD = JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] });

async function newRound(overrides = {}) {
  const { createLlmRound } = await import(ROUND);
  return createLlmRound({
    model: "fixture",
    prompt: "Return JSON only.",
    phase: "layout_only",
    // M4: the round now stamps its own capture artifact, so it needs the same
    // provenance inputs `runLlmSession` demands as preconditions. Without them the
    // artifact cannot be built and `ok` is false — which is exactly how
    // `runLlmSession` computes it (`captureResult.errors === undefined`).
    runId: "run_round_test",
    clock: () => "2025-01-01T00:00:00Z",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The round is data in, data out
// ---------------------------------------------------------------------------

test("begin() returns an llm_request effect and awaits nothing", async () => {
  const round = await newRound();
  const { state, effect } = round.begin();

  assert.equal(state, "awaiting_initial");
  assert.equal(effect.kind, "llm_request");
  assert.equal(effect.request.model, "fixture");
  assert.equal(effect.request.prompt, "Return JSON only.");
  assert.ok(effect.requestId);
});

test("a clean response completes the round in one request", async () => {
  const round = await newRound();
  round.begin();
  const { state, effect, result } = round.fulfill({ response: GOOD });

  assert.equal(state, "completed");
  assert.equal(effect, null, "a completed round asks for nothing further");
  assert.equal(result.ok, true);
  assert.equal(result.requestCount, 1);
});

test("view() reports state and is serializable — no functions, no instances", async () => {
  const round = await newRound();
  round.begin();
  const view = round.view();

  assert.equal(view.state, "awaiting_initial");
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view, "a persona view must round-trip");
});

// ---------------------------------------------------------------------------
// The ladder, matching M1's characterization
// ---------------------------------------------------------------------------

test("an unparseable response escalates to a retry, as a STATE", async () => {
  const round = await newRound();
  round.begin();
  const { state, effect } = round.fulfill({ response: "not json" });

  assert.equal(state, "awaiting_retry");
  assert.equal(effect.kind, "llm_request", "the retry is another request, returned as data");
  assert.ok(
    (effect.request.options?.num_predict ?? 0) > 0,
    "the retry raises num_predict — that increase is the gate M1 pinned",
  );
});

test("strict: true refuses to escalate — the round fails instead of retrying", async () => {
  const round = await newRound({ strict: true, repairPromptBuilder: () => "REPAIR" });
  round.begin();
  const { state, effect, result } = round.fulfill({ response: "not json" });

  assert.equal(state, "failed");
  assert.equal(effect, null, "strict must not ask for a retry or a repair");
  assert.equal(result.ok, false);
  assert.equal(result.requestCount, 1);
});

test("retry then repair: three requests, and the repair uses the rebuilt prompt", async () => {
  const round = await newRound({ repairPromptBuilder: () => "REPAIR PROMPT" });
  round.begin();

  const afterInitial = round.fulfill({ response: "not json" });
  assert.equal(afterInitial.state, "awaiting_retry");

  const afterRetry = round.fulfill({ response: "still not json" });
  assert.equal(afterRetry.state, "awaiting_repair");
  assert.equal(afterRetry.effect.request.prompt, "REPAIR PROMPT");

  const afterRepair = round.fulfill({ response: GOOD });
  assert.equal(afterRepair.state, "completed");
  assert.equal(afterRepair.result.requestCount, 3);
});

test("THE CEILING: a round never asks for more than three requests", async () => {
  const round = await newRound({ repairPromptBuilder: () => "REPAIR" });
  round.begin();
  round.fulfill({ response: "never valid" });
  round.fulfill({ response: "never valid" });
  const final = round.fulfill({ response: "never valid" });

  assert.equal(final.state, "failed");
  assert.equal(final.effect, null, "the ladder is exhausted; asking again is not an option");
  assert.equal(final.result.requestCount, 3);
});

test("with no repairPromptBuilder the round fails after the retry", async () => {
  const round = await newRound();
  round.begin();
  round.fulfill({ response: "not json" });
  const afterRetry = round.fulfill({ response: "still not json" });

  assert.equal(afterRetry.state, "failed", "no builder means no repair rung exists");
  assert.equal(afterRetry.effect, null);
  assert.equal(afterRetry.result.requestCount, 2);
});

test("an empty response text fails immediately, without escalating", async () => {
  const round = await newRound();
  round.begin();
  const { state, result } = round.fulfill({ response: "" });

  assert.equal(state, "failed");
  assert.equal(result.requestCount, 1);
  assert.ok(
    result.errors.some((e) => e.code === "missing_response_text"),
    "the failure names itself",
  );
});

// ---------------------------------------------------------------------------
// States gate behavior (charter A3)
// ---------------------------------------------------------------------------

test("fulfill() before begin() is refused — there is no request outstanding", async () => {
  const round = await newRound();

  assert.throws(
    () => round.fulfill({ response: GOOD }),
    /idle/,
    "a response cannot arrive for a request that was never made",
  );
});

test("a completed round refuses a second response", async () => {
  const round = await newRound();
  round.begin();
  round.fulfill({ response: GOOD });

  assert.throws(() => round.fulfill({ response: GOOD }), /completed/);
});

test("begin() twice is refused — one round, one outstanding request", async () => {
  const round = await newRound();
  round.begin();

  assert.throws(() => round.begin(), /awaiting_initial/);
});

test("a request with no model or prompt cannot begin a round", async () => {
  const round = await newRound({ model: "", prompt: "" });

  assert.throws(() => round.begin(), /model|prompt/);
});

// ---------------------------------------------------------------------------
// The persona surface — the seam M4/M5 migrate onto
// ---------------------------------------------------------------------------

test("the round is reachable through the Orchestrator's PUBLIC surface", async () => {
  // The point of publishing it: if callers imported `llm-round.js` directly, CR.4 would
  // have replaced 12 allowlisted imports of `llm-session.js` with 12 of `llm-round.js`
  // and closed nothing.
  const { createOrchestratorPersona } = await import(
    "../../../packages/runtime/src/personas/orchestrator/persona.js"
  );
  const orchestrator = createOrchestratorPersona({ clock: () => "2025-01-01T00:00:00Z" });

  const round = orchestrator.llm.beginRound({
    model: "fixture",
    prompt: "Return JSON only.",
    phase: "layout_only",
  });
  const { state, effect } = round.begin();

  assert.equal(state, "awaiting_initial");
  assert.equal(effect.kind, "llm_request");
  assert.equal(effect.personaRef, "orchestrator", "the round is stamped by the persona that owns it");
  assert.equal(round.fulfill({ response: GOOD }).state, "completed");
});

// ---------------------------------------------------------------------------
// THE DIFFERENTIAL — the round and runLlmSession must agree, rung for rung
// ---------------------------------------------------------------------------

/**
 * This is the test that licenses M4 and M5.
 *
 * The two paths share their decision helpers, so they SHOULD agree by construction —
 * but "should by construction" is exactly the reasoning that let 13 findings pass a
 * green suite on this branch. Driving both with identical scripted responses and
 * comparing what they ASK FOR is the only way to know.
 *
 * The comparison is on request count and outcome, not on the returned artifact:
 * `runLlmSession` also builds a capture artifact and card set, which the round
 * deliberately does not — the round decides, the host assembles.
 */
const DIFFERENTIAL_CASES = [
  ["clean first response", {}, [{ response: GOOD }]],
  ["retry recovers", {}, [{ response: "not json" }, { response: GOOD }]],
  ["retry then repair recovers", { repairPromptBuilder: () => "REPAIR" },
    [{ response: "not json" }, { response: "nope" }, { response: GOOD }]],
  ["ladder exhausted", { repairPromptBuilder: () => "REPAIR" }, [{ response: "never valid" }]],
  ["strict refuses to escalate", { strict: true, repairPromptBuilder: () => "REPAIR" },
    [{ response: "not json" }, { response: GOOD }]],
  ["no repair builder", {}, [{ response: "not json" }, { response: "still not json" }]],
  ["empty response text", {}, [{ response: "" }]],
  ["at the 2048 cap the retry rung is gone", { options: { num_predict: 2048 } },
    [{ response: "not json" }, { response: GOOD }]],
];

for (const [label, config, script] of DIFFERENTIAL_CASES) {
  test(`differential: ${label} — the round and runLlmSession agree`, async () => {
    const { runLlmSession } = await import(
      "../../../packages/runtime/src/personas/orchestrator/llm-session.js"
    );

    // The old path: real IO against a recording adapter.
    const calls = [];
    const adapter = {
      async generate(args) {
        calls.push(args);
        return script[Math.min(calls.length - 1, script.length - 1)];
      },
    };
    const session = await runLlmSession({
      model: "fixture",
      prompt: "Return JSON only.",
      phase: "layout_only",
      runId: "run_differential",
      clock: () => "2025-01-01T00:00:00Z",
      ...config,
      adapter,
    });

    // The new path: no IO at all; the script is handed back through fulfill().
    const round = await newRound({ runId: "run_differential", clock: () => "2025-01-01T00:00:00Z", ...config });
    let outcome = round.begin();
    let index = 0;
    while (outcome.effect) {
      const response = script[Math.min(index, script.length - 1)];
      index += 1;
      outcome = round.fulfill(response);
    }

    assert.equal(
      outcome.result.requestCount,
      calls.length,
      `${label}: the round asked for ${outcome.result.requestCount} request(s), `
      + `runLlmSession made ${calls.length} adapter call(s)`,
    );
    assert.equal(outcome.result.ok, session.ok, `${label}: the two paths disagree on success`);

    // M4: the round now assembles the capture artifact itself, so the differential can
    // compare the thing callers actually consume. `session.capture` is written to disk
    // by kernel.js and keyed by `capture.meta.id`, so a divergence here would surface as
    // a changed artifact on the real path — exactly what the goldens would catch late.
    assert.equal(
      outcome.result.capture === null,
      session.capture === null,
      `${label}: one path produced a capture artifact and the other did not`,
    );
    if (session.capture) {
      assert.deepEqual(
        outcome.result.capture.payload,
        session.capture.payload,
        `${label}: the capture payloads diverge`,
      );
      assert.equal(
        outcome.result.capture.meta.producedBy,
        session.capture.meta.producedBy,
        `${label}: provenance diverges`,
      );
    }
  });
}

test("CR.4: the round's capture is stamped by a round that actually reached a terminal state", async () => {
  // The provenance half of CR.4. `runLlmSession` stamps `producedBy: "orchestrator"` from
  // a free function with no FSM round running (pinned in M1's characterization). Here the
  // artifact cannot exist until the round has settled.
  const round = await newRound({ runId: "run_round", clock: () => "2025-01-01T00:00:00Z" });
  round.begin();
  const { state, result } = round.fulfill({ response: GOOD });

  assert.equal(state, "completed", "the artifact exists only after a terminal state");
  assert.equal(result.capture.meta.producedBy, "orchestrator");
  assert.equal(result.capture.meta.runId, "run_round");
});

// ## TODO: Test Permutations
// - phase "actors_only": the 480 num_predict floor and missing_actors as a retry trigger
// - num_predict already at 2048: the round must expose that the retry rung is unavailable
//   rather than silently skipping it (the latent defect M1 characterized)
// - the sanitize rung: responses that reach it, and that it consumes no request
// - restore(view) round-trip mid-ladder, so a round survives serialization
