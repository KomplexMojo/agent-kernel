/**
 * The session runner `runLlmBudgetLoop` needs injected (CR.4 M5b).
 *
 * The loop refuses to run without it — deliberately, with no default. Defaulting to the
 * old `runLlmSession` would leave inline `adapter.generate` IO inside the persona as a
 * silent fallback, and a caller that forgot to thread the runner would keep the old path
 * with nothing reporting it. That is the defect class this branch has found repeatedly.
 *
 * Tests that exercise the loop therefore wire what production wires. This helper exists
 * so they wire the SAME thing — a hand-rolled stub here would be exactly the second
 * implementation the refusal exists to prevent, and it would drift silently. Same
 * reasoning as `configurator-capabilities.js`, one persona over.
 */
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const LLM_HOST = pathToFileURL(
  resolve(__dirname, "../../packages/runtime/src/commands/llm-host.js"),
).href;

let cached = null;

/**
 * The real host: drives an Orchestrator round and dispatches each `llm_request` through
 * `ports/effects.js`, so the adapter is the only thing that performs IO.
 */
async function hostedSessionRunner() {
  if (!cached) {
    ({ runLlmSessionHosted: cached } = await import(LLM_HOST));
  }
  return cached;
}

const DIRECTOR_ROUND = pathToFileURL(
  resolve(__dirname, "../../packages/runtime/src/commands/director-round.js"),
).href;

/**
 * A Director with an OPEN build round, as `mapPool` requires (CR.4 M5b.2a').
 *
 * `director.mapPool` is FSM-gated behind `beginBuild`. Tests open a real round through the
 * same glue helper production uses rather than stubbing the mapper — a stub would be the
 * second mapper the required capability exists to prevent.
 */
async function directorPoolMapper({ runId = "run_test", createdAt = "2026-08-07T00:00:00.000Z", goal } = {}) {
  const { beginDirectorRound } = await import(DIRECTOR_ROUND);
  return beginDirectorRound({ runId, createdAt, goal }).mapPool;
}

module.exports = { hostedSessionRunner, directorPoolMapper };
