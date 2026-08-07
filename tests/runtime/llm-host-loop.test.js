/**
 * CR.4 M4b — the host loop: dispatch → await → fulfil, with the IO in the adapter.
 *
 * This is the piece that makes the inversion usable. The Orchestrator's round returns
 * `llm_request` effects and never awaits; something has to actually dispatch them. That
 * something is glue — it belongs in `commands/`, not in the persona — and it routes
 * through `ports/effects.js` so the adapter boundary is the only place IO happens.
 *
 * WHAT THIS MUST GET RIGHT, and why each is a real hazard:
 *
 *   1. A `deferred` dispatch is a FAILURE, not a response. `dispatchEffect` returns
 *      `{ status: "deferred" }` when no LLM adapter is wired. Feeding that to `fulfill()`
 *      as if it were a response would report a model that was never called as one that
 *      answered badly. M2 made dispatch honest; the host has to stay honest too.
 *
 *   2. Preconditions must behave like `runLlmSession`, NOT like the round. The round
 *      THROWS on a missing model or prompt — correct for a persona, since that is a
 *      programming error. But `runLlmSession` RETURNS `{ ok: false, errors, capture: null }`
 *      with zero adapter calls, and kernel.js's error paths are written against that
 *      shape. The host bridges the two; if it did not, migrating a call site would change
 *      how failures surface rather than where IO happens.
 *
 *   3. The adapter is called with the shape it already expects
 *      (`{ model, prompt, options, format, stream }`). The effect's `request` carries
 *      more than that — schema, requestId, phase, baseUrl — and passing the whole thing
 *      through would quietly change what every existing adapter receives, including the
 *      one the benchmark runs against.
 */
const assert = require("node:assert/strict");

const HOST = "../../packages/runtime/src/commands/llm-host.js";

const GOOD = JSON.stringify({ dungeonAffinity: "fire", rooms: [], actors: [] });

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

async function host(extra, responses) {
  const { runLlmSessionHosted } = await import(HOST);
  const adapter = recordingAdapter(responses);
  const result = await runLlmSessionHosted({
    adapter,
    model: "fixture",
    prompt: "Return JSON only.",
    runId: "run_host",
    clock: () => "2025-01-01T00:00:00Z",
    ...extra,
  });
  return { result, adapter };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

test("a clean response: one adapter call, and the round supplies the artifact", async () => {
  const { result, adapter } = await host({}, [{ response: GOOD }]);

  assert.equal(adapter.calls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.capture.meta.producedBy, "orchestrator");
  assert.equal(result.summary.dungeonAffinity, "fire");
});

test("the host drives the whole ladder — retry and repair are dispatched too", async () => {
  const { result, adapter } = await host(
    { repairPromptBuilder: () => "REPAIR PROMPT" },
    [{ response: "not json" }, { response: "still not json" }, { response: GOOD }],
  );

  assert.equal(adapter.calls.length, 3, "the host dispatched every rung the round asked for");
  assert.equal(adapter.calls[2].prompt, "REPAIR PROMPT");
  assert.equal(result.ok, true);
  assert.equal(result.retried, true);
  assert.equal(result.repaired, true);
});

test("the adapter is called with the shape it already expects, and nothing more", async () => {
  const { adapter } = await host({ format: "json", stream: false }, [{ response: GOOD }]);

  assert.deepEqual(
    Object.keys(adapter.calls[0]).sort(),
    ["format", "model", "options", "prompt", "stream"],
    "effect-envelope fields (schema, requestId, phase, baseUrl) must not leak to the adapter",
  );
});

// ---------------------------------------------------------------------------
// Honesty about failure
// ---------------------------------------------------------------------------

test("REFUSAL: a deferred dispatch fails the session — it is not fed back as a response", async () => {
  const { runLlmSessionHosted } = await import(HOST);

  // No adapter at all ⇒ dispatchEffect defers ⇒ the model was never called.
  const result = await runLlmSessionHosted({
    adapter: { generate: undefined },
    model: "fixture",
    prompt: "Return JSON only.",
    runId: "run_host",
    clock: () => "2025-01-01T00:00:00Z",
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /adapter/i.test(e.code) || /adapter/i.test(e.field || "")),
    "an uncalled model must not be reported as one that answered badly",
  );
});

test("preconditions match runLlmSession: no model ⇒ ok:false, zero adapter calls, no throw", async () => {
  const { result, adapter } = await host({ model: "" }, [{ response: GOOD }]);

  assert.equal(adapter.calls.length, 0, "no IO on a failed precondition");
  assert.equal(result.ok, false);
  assert.equal(result.capture, null);
  assert.ok(result.errors.some((e) => e.code === "missing_model"));
});

test("an empty prompt is NOT a failure mode — normalization always produces one", async () => {
  // Recorded because it corrects the M4 plan note, which said the host must bridge the
  // round's THROW on a missing prompt. It must not, because that throw is unreachable
  // from here: `normalizeSessionPrompt` returns a 3000-character template prompt even
  // when given no prompt, goal and notes at all, and the model is checked before the
  // round is built. The host keeps a defensive try/catch, but this is the honest record
  // that the path is dead rather than exercised.
  //
  // The same fact makes `runLlmSession`'s own `missing_prompt` precondition dead code —
  // it tests the prompt AFTER normalization. Characterized here, not fixed: changing it
  // would change LLM behavior and belongs behind the benchmark gate.
  const { runLlmSession } = await import(
    "../../packages/runtime/src/personas/orchestrator/llm-session.js"
  );
  const args = { prompt: "", goal: "", notes: "" };

  const legacyAdapter = recordingAdapter([{ response: GOOD }]);
  const legacy = await runLlmSession({
    adapter: legacyAdapter,
    model: "fixture",
    runId: "run_host",
    clock: () => "2025-01-01T00:00:00Z",
    ...args,
  });
  const { result, adapter } = await host(args, [{ response: GOOD }]);

  assert.equal(legacy.ok, true, "the legacy path runs on a template prompt");
  assert.equal(result.ok, legacy.ok, "and the host agrees, rather than refusing");
  assert.equal(adapter.calls.length, legacyAdapter.calls.length);
  assert.ok(adapter.calls[0].prompt.length > 100, "the prompt is the composed template");
});

// ---------------------------------------------------------------------------
// THE DIFFERENTIAL — the host must be a drop-in for runLlmSession
// ---------------------------------------------------------------------------

const CASES = [
  ["clean", {}, [{ response: GOOD }]],
  ["retry recovers", {}, [{ response: "not json" }, { response: GOOD }]],
  ["retry then repair", { repairPromptBuilder: () => "REPAIR" },
    [{ response: "not json" }, { response: "nope" }, { response: GOOD }]],
  ["ladder exhausted", { repairPromptBuilder: () => "REPAIR" }, [{ response: "never valid" }]],
  ["strict", { strict: true, repairPromptBuilder: () => "REPAIR" },
    [{ response: "not json" }, { response: GOOD }]],
  ["empty response text", {}, [{ response: "" }]],
  ["missing model", { model: "" }, [{ response: GOOD }]],
  ["sanitize rescues an invalid affinity", {},
    [{ response: JSON.stringify({ dungeonAffinity: "fire", rooms: [{ motivation: "stationary", affinity: "plasma", count: 1, affinities: [{ kind: "push", expression: "plasma", stacks: 1 }] }], actors: [] }) }]],
  ["sanitize cannot rescue an invalid dungeonAffinity", {},
    [{ response: JSON.stringify({ dungeonAffinity: "plasma", rooms: [], actors: [] }) }]],
];

for (const [label, config, script] of CASES) {
  test(`drop-in differential: ${label}`, async () => {
    const { runLlmSession } = await import(
      "../../packages/runtime/src/personas/orchestrator/llm-session.js"
    );

    const legacyAdapter = recordingAdapter(script);
    const legacy = await runLlmSession({
      adapter: legacyAdapter,
      model: "fixture",
      prompt: "Return JSON only.",
      runId: "run_host",
      clock: () => "2025-01-01T00:00:00Z",
      ...config,
    });

    const { result, adapter } = await host(config, script);

    assert.equal(adapter.calls.length, legacyAdapter.calls.length, `${label}: adapter call counts differ`);
    assert.equal(result.ok, legacy.ok, `${label}: ok differs`);
    assert.equal(result.capture === null, legacy.capture === null, `${label}: capture presence differs`);
    if (legacy.capture) {
      assert.deepEqual(result.capture.payload, legacy.capture.payload, `${label}: capture payload differs`);
    }
  });
}

// ## TODO: Test Permutations
// - an adapter whose generate() rejects: the session must fail, not hang
// - phaseContext / remainingBudgetTokens threading into the capture artifact
// - a dispatch that returns a non-promise result (a synchronous adapter)
