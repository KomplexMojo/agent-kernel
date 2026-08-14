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
 * Every build-domain capability the loop needs, from ONE Director round (CR.4 M5b.2b).
 *
 * Option 1 (maintainer decision, 2026-08-07) makes the Director the loop's sole
 * counterpart: it answers for the pool mapping itself and consults the Allocator — through
 * `allocator/persona.js`, the public barrel — for the three pricing decisions the loop used
 * to make inline. Handing tests a single round mirrors production, where one Director
 * answers all four; four independent rounds would be four build rounds for one build.
 */
async function directorBuildCapabilities({
  runId = "run_test",
  createdAt = "2026-08-07T00:00:00.000Z",
  goal,
} = {}) {
  const { beginDirectorBuildCapabilities } = await import(DIRECTOR_ROUND);
  return beginDirectorBuildCapabilities({ runId, createdAt, goal });
}

module.exports = { hostedSessionRunner, directorBuildCapabilities };
