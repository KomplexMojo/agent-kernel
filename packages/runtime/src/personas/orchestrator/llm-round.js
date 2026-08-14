/**
 * CR.4 M3 — the LLM escalation ladder as a state machine that performs NO IO.
 *
 * `runLlmSession` runs this same ladder by `await`ing `adapter.generate(...)` at three
 * points inside the persona (llm-session.js 576 / 609 / 639). That is external IO running
 * inline, not returned as data and never passing through `ports/effects.js` — inside the
 * persona whose chartered role is external interaction, which is the whole of CR.4.
 *
 * This module runs the ladder as STATES. Each rung hands back an `llm_request` effect and
 * stops; the host dispatches it, the adapter does the IO, and the response arrives via
 * `fulfill()`. Nothing here awaits anything.
 *
 *     idle ──begin──▶ awaiting_initial ──▶ awaiting_retry ──▶ awaiting_repair
 *                            │                    │                   │
 *                            └──────────▶ completed / failed ◀────────┘
 *
 * THE LADDER IS NOT REIMPLEMENTED. `evaluate`, `buildRepairRequestOptions` and
 * `isRetryTriggeringError` are imported from `llm-session.js`, so both paths ask one
 * question and get one answer. A parallel implementation would be the CR.1 defect class —
 * a second copy that silently diverges — and it is precisely what "run the new path
 * alongside the old one" invites.
 *
 * THE RUNGS:
 *   1. initial  — always.
 *   2. retry    — when `isRetryTriggeringError` says the failure is one a retry can fix:
 *                 `invalid_json` / `missing_response_text` (and `missing_actors` in the
 *                 `actors_only` phase). Most errors skip this rung entirely.
 *                 ✅ **Decision 2, 2026-08-13.** This gate used to be "`buildRepairRequestOptions`
 *                 actually RAISED `num_predict`", which silently conflated "is this
 *                 retryable" with "can we afford more tokens". At the 2048 clamp the
 *                 second is no, so the rung vanished — the ladder was shortest exactly
 *                 when the budget was largest. The rung now asks the first question
 *                 directly; options are still raised wherever they can be, and the clamp
 *                 still holds.
 *   3. repair   — only when a `repairPromptBuilder` returns a non-empty prompt.
 *   4. sanitize — consumes no request; a last salvage of an already-received response.
 * Ceiling: three requests.
 *
 * States gate real behavior (charter: label-only states are a defect). `fulfill()` before
 * `begin()` throws, a completed round refuses another response, and `begin()` twice throws
 * — one round holds at most one outstanding request, which is what lets a host correlate
 * a response to a request by `requestId`.
 */

import { buildLlmRequestEffect } from "../_shared/persona-helpers.mts";
import {
  applySummaryContentErrors,
  buildRepairRequestOptions,
  captureWithFallback,
  extractResponseText,
  isRetryTriggeringError,
  normalizeSessionPrompt,
  sanitizeSummaryResponse,
  sanitizeSummaryValue,
} from "./llm-session.js";
import { buildLlmCaptureArtifact } from "./llm-capture.js";
import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  capturePromptResponse,
} from "./prompt-contract.js";

export const LlmRoundStates = Object.freeze({
  IDLE: "idle",
  AWAITING_INITIAL: "awaiting_initial",
  AWAITING_RETRY: "awaiting_retry",
  AWAITING_REPAIR: "awaiting_repair",
  COMPLETED: "completed",
  FAILED: "failed",
});

const AWAITING = new Set([
  LlmRoundStates.AWAITING_INITIAL,
  LlmRoundStates.AWAITING_RETRY,
  LlmRoundStates.AWAITING_REPAIR,
]);

const MAX_REQUESTS = 3;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Capture and grade a response. The single question "is this response usable?", asked
 * the same way `runLlmSession` asks it.
 */
function evaluate({ prompt, responseText, phase, strict, requireSummary }) {
  const captured = strict
    ? capturePromptResponse({ prompt, responseText, phase })
    : captureWithFallback({ prompt, responseText, phase });
  return applySummaryContentErrors(captured, requireSummary);
}

export function createLlmRound({
  model,
  prompt,
  phase,
  options,
  format,
  stream,
  baseUrl,
  strict = false,
  requireSummary,
  repairPromptBuilder,
  personaRef = "orchestrator",
  // ── Prompt composition, shared with runLlmSession ──────────────────────────
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  allowedPairsText,
  phaseContext,
  layoutCosts,
  // ── Capture-artifact provenance (CR.4 M4) ─────────────────────────────────
  // The round STAMPS the artifact, which is the whole of CR.4's charge: today
  // `producedBy: "orchestrator"` defaults in a free function with no FSM round ever
  // running. Here it can only be produced by a round that actually reached a terminal
  // state, so the stamp finally means what it says.
  runId,
  clock,
  meta,
  producedBy = "orchestrator",
  requestId,
  // ── The Director's cardSet translation (CR.7 / WP-5) ──────────────────────
  // REQUIRED, no default. A cardSet is the Director's translation (M5b.2e); this file used
  // to obtain it by importing `director/summary-selections.js` through `llm-session.js`,
  // which was that file's allowlist row. Callers bind it from
  // `beginDirectorBuildCapabilities`, where it is attached to an OPEN Director round —
  // necessary, because `director.buildCardSet` is gated on PLANNED_STATES.
  buildCardSet,
} = {}) {
  // THROWN, not collected: the round rejects bad preconditions by throwing, while
  // `runLlmSession` returns `{ ok: false, errors }` for the same fault. `commands/llm-host.js`
  // documents and preserves that difference, so this must throw to stay consistent with
  // `begin()` below rather than with the session.
  if (typeof buildCardSet !== "function") {
    throw new Error(
      "llm-round: buildCardSet is required — a cardSet is the Director's translation, not "
      + "the Orchestrator's. Bind it from beginDirectorBuildCapabilities().",
    );
  }
  let state = LlmRoundStates.IDLE;
  let currentPrompt = normalizeSessionPrompt({
    prompt,
    goal,
    notes,
    budgetTokens,
    phase,
    remainingBudgetTokens,
    allowedPairsText,
    phaseContext,
    layoutCosts,
  });
  let startedAt;
  let currentOptions = options;
  let requestCount = 0;
  let capture = null;
  let responseText = null;
  let errors = [];
  let retried = false;
  let repaired = false;
  let sanitized = false;

  function view() {
    return {
      state,
      context: {
        requestCount,
        retried,
        repaired,
        sanitized,
        errorCodes: errors.map((entry) => entry.code),
      },
    };
  }

  function requestEffect() {
    requestCount += 1;
    return buildLlmRequestEffect({
      model,
      prompt: currentPrompt,
      phase,
      options: currentOptions,
      format,
      stream,
      baseUrl,
      personaRef,
    });
  }

  function begin() {
    if (state !== LlmRoundStates.IDLE) {
      throw new Error(
        `llm-round: begin() is only valid from idle; the round is ${state}. `
        + "One round holds at most one outstanding request.",
      );
    }
    const effect = requestEffect();
    if (!effect) {
      requestCount -= 1;
      throw new Error("llm-round: a request needs both a model and a prompt.");
    }
    startedAt = typeof clock === "function" ? clock() : undefined;
    state = LlmRoundStates.AWAITING_INITIAL;
    return { state, effect, view: view() };
  }

  /**
   * Assemble the terminal result, capture artifact included.
   *
   * The artifact is built HERE, not by the host, for PROVENANCE: CR.4's charge is that
   * `producedBy: "orchestrator"` is stamped by a free function with no round running, and a
   * stamp applied inside a round that reached a terminal state is the fix.
   *
   * ⚠️ This docblock used to give a second, structural reason — that `buildLlmCaptureArtifact`
   * is persona-internal, so a host assembling the artifact would open a new boundary crossing
   * to close an old one. **That reason is retired as of CR.7 / WP-5 (2026-08-12): the builder is
   * now published on this persona's controller** for the tick plane, which stamps its own
   * `runtime-llm` capture. Publishing it does not weaken the provenance argument above, which
   * was always the stronger of the two — a reachable builder still cannot stamp a round that is
   * not running.
   */
  function settle(nextState) {
    state = nextState;
    const endedAt = typeof clock === "function" ? clock() : undefined;
    const startMs = startedAt ? Date.parse(startedAt) : NaN;
    const endMs = endedAt ? Date.parse(endedAt) : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? endMs - startMs
      : undefined;

    const cardSet = buildCardSet(capture?.summary || {});
    const summaryWithCards = capture?.summary && typeof capture.summary === "object"
      ? { ...capture.summary, cardSet }
      : capture?.summary ?? null;

    // A response that never arrived has nothing to capture — matching runLlmSession,
    // which returns `capture: null` on a missing-text failure rather than an artifact
    // describing an exchange that did not happen.
    const captureResult = isNonEmptyString(responseText)
      ? buildLlmCaptureArtifact({
        prompt: currentPrompt,
        responseText,
        responseParsed: capture?.responseParsed,
        summary: summaryWithCards,
        parseErrors: errors,
        model,
        baseUrl,
        options: currentOptions,
        stream,
        requestId,
        meta,
        runId,
        producedBy,
        phase,
        phaseContext,
        remainingBudgetTokens,
        phaseTiming: { startedAt, endedAt, durationMs },
        clock,
      })
      : { capture: null, errors: ["LLM response missing text."] };

    return {
      state,
      effect: null,
      result: {
        ok: nextState === LlmRoundStates.COMPLETED && captureResult.errors === undefined,
        prompt: currentPrompt,
        responseText,
        responseParsed: capture?.responseParsed ?? null,
        summary: summaryWithCards,
        cardSet,
        errors,
        capture: captureResult.capture,
        captureErrors: captureResult.errors,
        requestCount,
        retried,
        repaired,
        sanitized,
      },
      view: view(),
    };
  }

  function escalate() {
    // Rung 2 — retry. Decision 2 (2026-08-13): the gate is whether the ERROR is
    // retryable, not whether `num_predict` happened to grow. Gating on the growth meant
    // that at the 2048 clamp — where it cannot grow — the rung silently vanished, so the
    // ladder was shortest exactly when the token budget was largest. `retryOptions` is
    // still adopted, so the retry gets more tokens wherever more tokens exist, and the
    // clamp still holds.
    //
    // ⚠️ This gate must stay identical to `llm-session.js`'s. The session is the round's
    // reference implementation in the M4 differential, so a divergence here would be
    // invisible to every test that compares the two — they would simply agree on a
    // different ladder.
    if (!retried && requestCount < MAX_REQUESTS && isRetryTriggeringError({ errors, phase })) {
      currentOptions = buildRepairRequestOptions(currentOptions, { errors, phase });
      retried = true;
      const effect = requestEffect();
      state = LlmRoundStates.AWAITING_RETRY;
      return { state, effect, result: null, view: view() };
    }

    // Rung 3 — repair. Needs a builder that produces a prompt.
    if (!repaired && requestCount < MAX_REQUESTS && typeof repairPromptBuilder === "function") {
      const repairPrompt = repairPromptBuilder({
        prompt: currentPrompt,
        errors,
        responseText,
        responseParsed: capture?.responseParsed,
        phase,
      });
      if (isNonEmptyString(repairPrompt)) {
        currentPrompt = repairPrompt;
        currentOptions = buildRepairRequestOptions(currentOptions, { errors, phase });
        repaired = true;
        const effect = requestEffect();
        state = LlmRoundStates.AWAITING_REPAIR;
        return { state, effect, result: null, view: view() };
      }
    }

    // Rung 4 — sanitize. Consumes NO request: a last salvage of the response already in
    // hand, by coercing affinities/expressions back into the allowed vocabulary.
    //
    // ⚠️ THIS RUNG WAS DOCUMENTED IN M3 AND NOT IMPLEMENTED. The 8-case differential did
    // not catch it, because none of its scripts produced a response that sanitizing could
    // rescue — every case either parsed cleanly or was unsalvageable. `ak-llm-plan.test.js`
    // ("resilient mode sanitizes invalid affinities") caught it the moment kernel's call
    // sites were migrated. A differential only covers the cases someone thought to script;
    // that is the same lesson as the caller list being undercounted three times.
    if (trySanitize()) {
      return settle(LlmRoundStates.COMPLETED);
    }
    return settle(LlmRoundStates.FAILED);
  }

  /**
   * Coerce the response already received into the allowed vocabulary, matching
   * `runLlmSession`'s final block. Only accepted when it clears EVERY error — a partial
   * salvage is still a failure, and pretending otherwise would let a summary through that
   * no rung actually fixed.
   */
  function trySanitize() {
    if (strict || sanitized) return false;
    let value = sanitizeSummaryResponse(responseText, {
      allowedAffinities: ALLOWED_AFFINITIES,
      allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
      phase,
    });
    if (!value && capture?.responseParsed) {
      value = sanitizeSummaryValue(capture.responseParsed, {
        allowedAffinities: ALLOWED_AFFINITIES,
        allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
        phase,
      });
    }
    if (!value) return false;

    const sanitizedCapture = applySummaryContentErrors(
      capturePromptResponse({ prompt: currentPrompt, responseText: JSON.stringify(value), phase }),
      requireSummary,
    );
    if (sanitizedCapture.errors.length > 0) return false;

    capture = sanitizedCapture;
    errors = sanitizedCapture.errors;
    sanitized = true;
    return true;
  }

  function fulfill(payload) {
    if (!AWAITING.has(state)) {
      throw new Error(
        `llm-round: fulfill() is only valid while awaiting a response; the round is ${state}.`,
      );
    }

    responseText = extractResponseText(payload);
    if (!isNonEmptyString(responseText)) {
      // Matches `runLlmSession`: a response with no text is terminal, not a rung.
      errors = [{
        field: "response",
        code: "missing_response_text",
        message: "LLM response text is missing",
      }];
      return settle(LlmRoundStates.FAILED);
    }

    capture = evaluate({ prompt: currentPrompt, responseText, phase, strict, requireSummary });
    errors = capture.errors;

    if (errors.length === 0) {
      return settle(LlmRoundStates.COMPLETED);
    }
    if (strict) {
      // Strict disables every rung — one request, ever. M1 pinned this.
      return settle(LlmRoundStates.FAILED);
    }
    return escalate();
  }

  return { view, begin, fulfill, states: LlmRoundStates };
}
