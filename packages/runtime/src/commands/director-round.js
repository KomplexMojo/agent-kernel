/**
 * CR.4 M5b.2a′ — open a Director build round for glue that needs one.
 *
 * `runLlmBudgetLoop` no longer maps LLM summaries onto catalog pools itself; it asks the
 * Director, through `director.mapPool`, which is FSM-gated behind an open build round
 * (`requireState(PLANNED_STATES)`). That gate is the point: until now the loop mapped
 * summaries with **no Director round existing at all** — an artifact produced with no
 * round, the same defect as CR.4's `producedBy` stamp and CR.3's discarded plan.
 *
 * `kernel.js` already did this correctly (its llm-plan path builds a Director, synthesizes
 * an IntentEnvelope and calls `beginBuild` before the first `mapPool`). The other four
 * composition roots that drive the loop had **no Director at all**, so this is kernel's
 * wiring extracted rather than reinvented — four hand-rolled copies of an IntentEnvelope
 * is how a vocabulary ends up with four silently diverging origins.
 */

import { createDirectorPersona } from "../personas/director/persona.js";

const INTENT_ENVELOPE_SCHEMA = "agent-kernel/IntentEnvelope";

/**
 * Build a Director and open its round, returning the persona ready for `mapPool`.
 *
 * `createdAt` is required and injected: the envelope's `meta.createdAt` is stamped into a
 * persisted artifact, and a persona must never read the wall clock (PX.3).
 */
export function beginDirectorRound({ runId, createdAt, goal, producedBy = "cli" } = {}) {
  if (typeof createdAt !== "string" || !createdAt.trim()) {
    throw new Error("beginDirectorRound: createdAt (ISO-8601) is required — see PX.3.");
  }
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("beginDirectorRound: runId is required for deterministic provenance.");
  }

  const director = createDirectorPersona({ clock: () => createdAt });
  director.beginBuild({
    schema: INTENT_ENVELOPE_SCHEMA,
    schemaVersion: 1,
    meta: { id: `intent_${runId}`, runId, createdAt, producedBy },
    source: producedBy,
    intent: { goal: typeof goal === "string" && goal.trim() ? goal : `build ${runId}` },
  }, { runId });

  return director;
}
