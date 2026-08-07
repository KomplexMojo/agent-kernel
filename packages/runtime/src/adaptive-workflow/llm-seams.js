import { runLlmBudgetLoop } from "../personas/orchestrator/llm-budget-loop.js";
// CR.4 M5: the LLM session runs as an Orchestrator round; this host dispatches its
// `llm_request` effects through ports/effects.js so the IO happens in the adapter.
// Drop-in for runLlmSession (differential: tests/runtime/llm-host-loop.test.js).
import { runLlmSessionHosted } from "../commands/llm-host.js";

export async function runFlagshipLlmSeam({
  adapter,
  model,
  prompt,
  runId,
  clock,
  requestId,
  options,
  format,
  stream,
} = {}) {
  const result = await runLlmSessionHosted({
    adapter,
    model,
    prompt,
    runId,
    clock,
    requestId,
    options,
    format,
    stream,
    strict: false,
    producedBy: "adaptive-workflow",
  });
  return { ...result, captures: result.capture ? [result.capture] : [] };
}

export async function runSectionalBudgetLlmSeam({
  adapter,
  model,
  goal,
  runId,
  clock,
  requestId,
  catalog,
  budgetTokens,
  priceList,
  poolWeights,
  poolPolicy,
  optionsByPhase,
} = {}) {
  const result = await runLlmBudgetLoop({
    adapter,
    model,
    goal,
    runId,
    clock,
    requestId,
    catalog,
    budgetTokens,
    priceList,
    poolWeights,
    poolPolicy,
    optionsByPhase,
    producedBy: "adaptive-workflow",
  });
  return reconcileSectionalRooms(result);
}

// The budget loop builds summary.rooms from catalog selections and drops it when
// empty. In catalog-less generation the model still designs rooms under
// summary.roomDesign.rooms, which would otherwise never reach the adaptive-workflow
// output contract. Surface those designed rooms as summary.rooms — but only when
// selections produced none, so catalog-driven runs are left untouched.
function reconcileSectionalRooms(result) {
  const summary = result?.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return result;
  const designed = Array.isArray(summary.roomDesign?.rooms) ? summary.roomDesign.rooms : [];
  const current = Array.isArray(summary.rooms) ? summary.rooms : [];
  if (current.length > 0 || designed.length === 0) return result;
  const rooms = designed.filter((room) => room && typeof room === "object" && !Array.isArray(room)).map((room) => ({ ...room }));
  if (rooms.length === 0) return result;
  return { ...result, summary: { ...summary, rooms } };
}
