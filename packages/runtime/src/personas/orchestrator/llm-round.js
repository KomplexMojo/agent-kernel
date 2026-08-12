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
 * `getNumPredict` are imported from `llm-session.js`, so both paths ask one question and
 * get one answer. A parallel implementation would be the CR.1 defect class — a second
 * copy that silently diverges — and it is precisely what "run the new path alongside the
 * old one" invites.
 *
 * THE RUNGS, exactly as M1 characterized them:
 *   1. initial  — always.
 *   2. retry    — only when `buildRepairRequestOptions` actually RAISES `num_predict`.
 *                 It only does so for `invalid_json` / `missing_response_text` (and
 *                 `missing_actors` in the `actors_only` phase), so most errors skip this
 *                 rung entirely. ⚠️ It also cannot raise past 2048, so a caller already
 *                 at the cap has no retry rung at all — the latent defect M1 pinned.
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
  buildCardModelFromLlmSummary,
  buildRepairRequestOptions,
  captureWithFallback,
  extractResponseText,
  getNumPredict,
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
} = {}) {
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

    const cardSet = buildCardModelFromLlmSummary(capture?.summary || {});
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
    // Rung 2 — retry. The gate is that options actually grow; see the 2048 note above.
    if (!retried && requestCount < MAX_REQUESTS) {
      const retryOptions = buildRepairRequestOptions(currentOptions, { errors, phase });
      if (getNumPredict(retryOptions) > getNumPredict(currentOptions)) {
        currentOptions = retryOptions;
        retried = true;
        const effect = requestEffect();
        state = LlmRoundStates.AWAITING_RETRY;
        return { state, effect, result: null, view: view() };
      }
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
