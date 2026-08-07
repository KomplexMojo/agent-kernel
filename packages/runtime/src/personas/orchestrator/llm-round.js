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
  buildRepairRequestOptions,
  captureWithFallback,
  extractResponseText,
  getNumPredict,
} from "./llm-session.js";
import { capturePromptResponse } from "./prompt-contract.js";

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
} = {}) {
  let state = LlmRoundStates.IDLE;
  let currentPrompt = prompt;
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
    state = LlmRoundStates.AWAITING_INITIAL;
    return { state, effect, view: view() };
  }

  function settle(nextState) {
    state = nextState;
    return {
      state,
      effect: null,
      result: {
        ok: nextState === LlmRoundStates.COMPLETED,
        prompt: currentPrompt,
        responseText,
        summary: capture?.summary ?? null,
        errors,
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

    return settle(LlmRoundStates.FAILED);
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
