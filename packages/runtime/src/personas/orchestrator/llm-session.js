import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
  capturePromptResponse,
} from "./prompt-contract.js";
import {
  buildLlmActorConfigPromptTemplate,
  buildLlmPhasePromptTemplate,
} from "../../contracts/domain-constants.js";
import { buildLlmCaptureArtifact } from "./llm-capture.js";

// ── CR.4 M3: the pure decision layer, shared rather than duplicated ────────────
// `llm-round.js` runs the SAME escalation ladder without performing IO. Two
// independent copies of "should this retry?" would be the CR.1 defect class — a
// second silently-diverging answer to one question — so the round imports these
// rather than reimplementing them. They are pure: no adapter, no clock, no IO.
// M5 NOTE: when `runLlmSession`'s inline IO is deleted, what remains of this file
// IS this decision layer; split it out then rather than now.

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addSessionError(errors, field, code, message) {
  errors.push({ field, code, message });
}

function unwrapCodeFence(text) {
  if (!text) return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : text;
}

function normalizeJsonPunctuation(text) {
  if (!isNonEmptyString(text)) return "";
  return text
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ");
}

function stripTrailingCommas(text) {
  if (!isNonEmptyString(text)) return "";
  let inString = false;
  let escaped = false;
  let output = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      output += ch;
      continue;
    }
    if (ch === ",") {
      let lookahead = i + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1;
      }
      if (lookahead < text.length && (text[lookahead] === "}" || text[lookahead] === "]")) {
        continue;
      }
    }
    output += ch;
  }
  return output;
}

function parseJsonLenient(responseText) {
  const raw = isNonEmptyString(responseText) ? responseText : "";
  if (!raw) return null;
  const unwrapped = normalizeJsonPunctuation(unwrapCodeFence(raw)).trim();
  const extracted = extractJsonObject(unwrapped);
  const candidates = [extracted, unwrapped, normalizeJsonPunctuation(raw).trim()]
    .filter((candidate) => isNonEmptyString(candidate));
  const seen = new Set();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const variants = [candidate, stripTrailingCommas(candidate)];
    for (let j = 0; j < variants.length; j += 1) {
      const variant = variants[j];
      if (!isNonEmptyString(variant) || seen.has(`parsed:${variant}`)) continue;
      seen.add(`parsed:${variant}`);
      try {
        return JSON.parse(variant);
      } catch {
        // Continue trying candidate variants.
      }
    }
  }
  return null;
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = unwrapCodeFence(text).trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    return cleaned;
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.message?.content === "string") return payload.message.content;
  const choice = payload.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (typeof choice?.text === "string") return choice.text;
  return null;
}

export function captureWithFallback({ prompt, responseText, phase }) {
  const primary = capturePromptResponse({ prompt, responseText, phase });
  if (primary.errors.length === 0) {
    return primary;
  }
  const lenient = parseJsonLenient(responseText);
  if (lenient) {
    return capturePromptResponse({
      prompt,
      responseText: JSON.stringify(lenient),
      phase,
    });
  }
  const extracted = extractJsonObject(responseText);
  if (!extracted) {
    return primary;
  }
  return capturePromptResponse({ prompt, responseText: extracted, phase });
}

export function sanitizeSummaryValue(value, { allowedAffinities, allowedExpressions, phase }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (isNonEmptyString(phase) && !isNonEmptyString(value.phase)) {
    value.phase = phase;
  }
  if (!Array.isArray(value.rooms) && value.rooms && typeof value.rooms === "object") {
    value.rooms = [value.rooms];
  }
  if (!Array.isArray(value.wardens) && value.wardens && typeof value.wardens === "object") {
    value.wardens = [value.wardens];
  }
  if (!Array.isArray(value.actors)) {
    if (value.actors && typeof value.actors === "object") {
      value.actors = [value.actors];
    } else if (Array.isArray(value.wardens)) {
      value.actors = value.wardens.map((entry) => ({ ...entry }));
    } else if (value.actor && typeof value.actor === "object") {
      value.actors = [value.actor];
    }
  }
  if (!Array.isArray(value.delverConfigs)) {
    if (value.delverConfigs && typeof value.delverConfigs === "object") {
      value.delverConfigs = [value.delverConfigs];
    } else if (value.delverConfig && typeof value.delverConfig === "object") {
      value.delverConfigs = [{ ...value.delverConfig }];
    }
  }
  if (Array.isArray(value.delverConfigs)) {
    value.delverConfigs = value.delverConfigs
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({ ...entry }));
    if (value.delverConfigs.length > 0) {
      if (!value.delverConfig || typeof value.delverConfig !== "object" || Array.isArray(value.delverConfig)) {
        value.delverConfig = { ...value.delverConfigs[0] };
      }
      if (!Number.isInteger(value.delverCount) || value.delverCount <= 0) {
        value.delverCount = value.delverConfigs.length;
      }
    }
  }

  const sanitizeTokenHint = (entry) => {
    const tokenHint = entry.tokenHint;
    if (Number.isInteger(tokenHint) && tokenHint > 0) {
      return;
    }
    if (typeof tokenHint === "string") {
      const parsed = Number(tokenHint);
      if (Number.isInteger(parsed) && parsed > 0) {
        entry.tokenHint = parsed;
        return;
      }
    }
    if (typeof tokenHint === "number" && Number.isFinite(tokenHint) && tokenHint > 0) {
      entry.tokenHint = Math.floor(tokenHint);
      return;
    }
    delete entry.tokenHint;
  };

  const sanitizePick = (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const sanitizePositiveIntField = (target, field) => {
      const raw = target?.[field];
      if (Number.isInteger(raw) && raw > 0) return;
      if (typeof raw === "string") {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed > 0) {
          target[field] = parsed;
          return;
        }
      }
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        target[field] = Math.floor(raw);
        return;
      }
      target[field] = 1;
    };
    const sanitizeNonNegativeIntField = (target, field, fallback = 0) => {
      const raw = target?.[field];
      if (Number.isInteger(raw) && raw >= 0) return;
      if (typeof raw === "string") {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 0) {
          target[field] = parsed;
          return;
        }
      }
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
        target[field] = Math.floor(raw);
        return;
      }
      target[field] = fallback;
    };

    if (!ALLOWED_MOTIVATIONS.includes(entry.motivation) && ALLOWED_MOTIVATIONS.includes(entry.role)) {
      entry.motivation = entry.role;
    }
    if (!ALLOWED_MOTIVATIONS.includes(entry.motivation)) {
      entry.motivation = "stationary";
    }
    if (!allowedAffinities.includes(entry.affinity)) {
      entry.affinity = allowedAffinities[0];
    }
    sanitizePositiveIntField(entry, "count");
    sanitizeTokenHint(entry);
    if (entry.affinities !== undefined && !Array.isArray(entry.affinities)) {
      delete entry.affinities;
    }
    if (Array.isArray(entry.affinities)) {
      const fixed = entry.affinities
        .map((affinityEntry) => {
          if (!affinityEntry || typeof affinityEntry !== "object" || Array.isArray(affinityEntry)) {
            return null;
          }
          let kind = affinityEntry.kind ?? affinityEntry.affinity;
          let expression = affinityEntry.expression ?? affinityEntry.affinityExpression;

          const kindIsExpression = allowedExpressions.includes(kind);
          const expressionIsAffinity = allowedAffinities.includes(expression);
          if (kindIsExpression && expressionIsAffinity) {
            const swapped = kind;
            kind = expression;
            expression = swapped;
          }

          if (!allowedAffinities.includes(kind) && allowedAffinities.includes(entry.affinity)) {
            kind = entry.affinity;
          }

          if (!allowedExpressions.includes(expression) && kindIsExpression) {
            expression = kind;
          }

          if (!allowedAffinities.includes(kind) || !allowedExpressions.includes(expression)) {
            return null;
          }

          const fixedEntry = { kind, expression };
          if (Number.isInteger(affinityEntry.stacks) && affinityEntry.stacks > 0) {
            fixedEntry.stacks = affinityEntry.stacks;
          }
          return fixedEntry;
        })
        .filter(Boolean);
      if (fixed.length > 0) {
        entry.affinities = fixed;
      } else {
        delete entry.affinities;
      }
    }

    const ambulatoryActor = phase === "actors_only" && entry.motivation !== "stationary";
    if (entry.vitals !== undefined && (!entry.vitals || typeof entry.vitals !== "object" || Array.isArray(entry.vitals))) {
      delete entry.vitals;
    }
    if (entry.vitals && typeof entry.vitals === "object" && !Array.isArray(entry.vitals)) {
      const keys = ["health", "mana", "stamina", "durability"];
      keys.forEach((key) => {
        const rawVital = entry.vitals[key];
        if (rawVital !== undefined && (!rawVital || typeof rawVital !== "object" || Array.isArray(rawVital))) {
          delete entry.vitals[key];
        }
        if (!entry.vitals[key]) return;
        sanitizeNonNegativeIntField(entry.vitals[key], "current");
        sanitizeNonNegativeIntField(entry.vitals[key], "max");
        sanitizeNonNegativeIntField(entry.vitals[key], "regen");
      });
      if (ambulatoryActor) {
        if (!entry.vitals.stamina || typeof entry.vitals.stamina !== "object") {
          entry.vitals.stamina = { current: 1, max: 1, regen: 1 };
        }
        sanitizePositiveIntField(entry.vitals.stamina, "current");
        sanitizePositiveIntField(entry.vitals.stamina, "max");
        sanitizePositiveIntField(entry.vitals.stamina, "regen");
      }
    } else if (ambulatoryActor) {
      entry.vitals = {
        stamina: { current: 1, max: 1, regen: 1 },
      };
    }

    return entry;
  };

  if (Array.isArray(value.rooms)) {
    value.rooms = value.rooms.map(sanitizePick).filter(Boolean);
  }
  if (Array.isArray(value.wardens)) {
    value.wardens = value.wardens.map(sanitizePick).filter(Boolean);
    if (!Array.isArray(value.actors)) {
      value.actors = value.wardens.map((entry) => ({ ...entry }));
    }
  }
  if (Array.isArray(value.actors)) {
    value.actors = value.actors.map(sanitizePick).filter(Boolean);
  }
  if (value.layout && typeof value.layout === "object" && !Array.isArray(value.layout)) {
    const nextLayout = {};
    ["floorTiles", "hallwayTiles"].forEach((field) => {
      const raw = value.layout[field];
      if (Number.isInteger(raw) && raw >= 0) {
        nextLayout[field] = raw;
        return;
      }
      if (typeof raw === "string") {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 0) {
          nextLayout[field] = parsed;
        }
      }
    });
    if (Object.keys(nextLayout).length > 0) {
      value.layout = nextLayout;
    } else {
      delete value.layout;
    }
  }

  return value;
}

function validateSummaryContent(summary, { minRooms, minActors } = {}) {
  const errors = [];
  const rooms = Array.isArray(summary?.rooms) ? summary.rooms : [];
  const actors = Array.isArray(summary?.actors) ? summary.actors : [];
  if (Number.isInteger(minRooms) && minRooms > 0 && rooms.length < minRooms) {
    errors.push({ field: "rooms", code: "missing_rooms" });
  }
  if (Number.isInteger(minActors) && minActors > 0 && actors.length < minActors) {
    errors.push({ field: "actors", code: "missing_actors" });
  }
  return errors;
}

export function applySummaryContentErrors(capture, requireSummary) {
  if (!requireSummary) {
    return capture;
  }
  const contentErrors = validateSummaryContent(capture?.summary, requireSummary);
  if (contentErrors.length === 0) {
    return capture;
  }
  return {
    ...capture,
    errors: [...(capture.errors || []), ...contentErrors],
  };
}

function hasErrorCode(errors, code) {
  if (!Array.isArray(errors) || !code) return false;
  return errors.some((entry) => entry && typeof entry === "object" && entry.code === code);
}

/**
 * Is this a failure a RETRY can plausibly fix?
 *
 * Decision 2, 2026-08-13 — this predicate is new, and extracting it IS the fix.
 *
 * The retry rung used to be gated on `retryPredict > previousPredict`: a numeric side
 * effect of `buildRepairRequestOptions`. That one comparison was standing in for two
 * different questions —
 *
 *   1. is this error the kind a retry can fix?
 *   2. can we afford to ask for more tokens?
 *
 * — which agree everywhere except at the 2048 clamp. There, (2) is no, so the gate
 * silently answered no to (1) as well and **the ladder disabled itself exactly when the
 * token budget was largest**: the identical malformed response that recovered in two
 * calls at default options failed permanently in one at the cap, with no error and no
 * warning. Characterized by CR.4 M1, fixed here.
 *
 * The fix is NOT raising the cap — 2048 is a model limit, and raising it would be a
 * guess. The rung asks question (1) directly; options are still raised whenever they can
 * be raised, and the clamp still holds.
 *
 * ⇒ Same defect class this branch keeps recording: a guard matching one SPELLING of a
 * condition rather than the condition itself.
 */
export function isRetryTriggeringError({ errors, phase } = {}) {
  return hasErrorCode(errors, "invalid_json")
    || hasErrorCode(errors, "missing_response_text")
    || (phase === "actors_only" && hasErrorCode(errors, "missing_actors"));
}

export function buildRepairRequestOptions(options, { errors, phase } = {}) {
  // Single origin: the trigger vocabulary lives in isRetryTriggeringError, so the rung
  // and the option expansion cannot drift apart on which errors count.
  if (!isRetryTriggeringError({ errors, phase })) {
    return options && typeof options === "object" ? { ...options } : options;
  }
  const next = options && typeof options === "object" ? { ...options } : {};
  const current = Number.isInteger(next.num_predict) && next.num_predict > 0 ? next.num_predict : 0;
  const minByPhase = phase === "actors_only" ? 480 : 320;
  const expanded = Math.max(minByPhase, current + 240, Math.ceil(current * 2));
  next.num_predict = Math.min(expanded, 2048);
  return next;
}

export function getNumPredict(options) {
  if (!options || typeof options !== "object") return 0;
  return Number.isInteger(options.num_predict) && options.num_predict > 0 ? options.num_predict : 0;
}

export function sanitizeSummaryResponse(responseText, { allowedAffinities, allowedExpressions, phase }) {
  const value = parseJsonLenient(responseText);
  if (!value) return null;
  return sanitizeSummaryValue(value, { allowedAffinities, allowedExpressions, phase });
}

/**
 * CR.7 / WP-5 (2026-08-12) — `buildCardModelFromLlmSummary` STOOD HERE AND IS GONE.
 *
 * It was a one-line rename of `director/summary-selections.js#buildCardSetFromSummary`,
 * imported straight across the persona boundary, and it was this file's allowlist row. A
 * cardSet is the DIRECTOR's translation (M5b.2e), so the builder is now an injected
 * capability on `runLlmSession` and `createLlmRound` — REQUIRED, with no default, for the
 * same reason the budget loop's `buildCardSet` and `runSession` are: a default would let the
 * Orchestrator author another persona's artifact with nothing reporting it, and an
 * un-normalized cardSet is still a well-formed array that serializes and replays.
 *
 * Callers get it from `beginDirectorBuildCapabilities` (`commands/director-round.js`), which
 * binds `director.buildCardSet` to an OPEN build round — that binding matters, because the
 * Director gates `buildCardSet` on PLANNED_STATES.
 */

export function normalizeSessionPrompt({
  prompt,
  goal,
  notes,
  budgetTokens,
  phase,
  remainingBudgetTokens,
  allowedPairsText,
  phaseContext,
  layoutCosts,
}) {
  if (isNonEmptyString(prompt)) {
    return prompt;
  }
  if (phase) {
    return buildLlmPhasePromptTemplate({
      goal,
      notes,
      budgetTokens,
      phase,
      remainingBudgetTokens,
      allowedPairsText,
      context: phaseContext,
      layoutCosts,
      affinities: ALLOWED_AFFINITIES,
      affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
      motivations: ALLOWED_MOTIVATIONS,
    });
  }
  return buildLlmActorConfigPromptTemplate({
    goal,
    notes,
    budgetTokens,
    affinities: ALLOWED_AFFINITIES,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: ALLOWED_MOTIVATIONS,
  });
}

export async function runLlmSession({
  adapter,
  model,
  baseUrl,
  prompt,
  goal,
  notes,
  budgetTokens,
  remainingBudgetTokens,
  phase,
  phaseContext,
  allowedPairsText,
  layoutCosts,
  options,
  format,
  stream,
  strict = false,
  repairPromptBuilder,
  requireSummary,
  runId,
  meta,
  producedBy = "orchestrator",
  clock,
  requestId,
  // CR.7 / WP-5 — the Director's cardSet translation, injected. REQUIRED, no default: see
  // the note where `buildCardModelFromLlmSummary` used to live.
  buildCardSet,
} = {}) {
  const sessionErrors = [];
  if (!adapter || typeof adapter.generate !== "function") {
    addSessionError(sessionErrors, "adapter", "missing_adapter", "adapter.generate is required");
  }
  // Reported as a session error rather than thrown, unlike the round's precondition of the
  // same name. That asymmetry is deliberate and documented in `commands/llm-host.js`:
  // `runLlmSession` RETURNS `{ ok: false, errors, capture: null }` for a bad precondition
  // where the round throws, and the host preserves each style.
  if (typeof buildCardSet !== "function") {
    addSessionError(
      sessionErrors,
      "buildCardSet",
      "missing_card_set_builder",
      "buildCardSet is required: a cardSet is the Director's translation, not the Orchestrator's",
    );
  }
  if (!isNonEmptyString(model)) {
    addSessionError(sessionErrors, "model", "missing_model", "model is required");
  }
  if (!isNonEmptyString(runId)) {
    addSessionError(sessionErrors, "runId", "missing_run_id", "runId is required for deterministic capture");
  }
  if (typeof clock !== "function") {
    addSessionError(sessionErrors, "clock", "missing_clock", "clock function is required for deterministic capture");
  }
  const initialPrompt = normalizeSessionPrompt({
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
  if (!isNonEmptyString(initialPrompt)) {
    addSessionError(sessionErrors, "prompt", "missing_prompt", "prompt is required");
  }

  if (sessionErrors.length > 0) {
    return {
      ok: false,
      errors: sessionErrors,
      capture: null,
      captureErrors: ["LLM session preconditions failed."],
    };
  }

  const startedAt = typeof clock === "function" ? clock() : undefined;
  const startMs = startedAt ? Date.parse(startedAt) : NaN;

  let requestOptions = options && typeof options === "object" ? { ...options } : undefined;
  if (isNonEmptyString(format)) {
    if (requestOptions) {
      requestOptions.format = format;
    } else {
      requestOptions = { format };
    }
  }

  let finalPrompt = initialPrompt;
  let responsePayload = await adapter.generate({
    model,
    prompt: finalPrompt,
    options: requestOptions,
    format,
    stream: Boolean(stream),
  });
  let responseText = extractResponseText(responsePayload);
  if (!isNonEmptyString(responseText)) {
    addSessionError(sessionErrors, "response", "missing_response_text", "LLM response text is missing");
    return {
      ok: false,
      errors: sessionErrors,
      capture: null,
      captureErrors: ["LLM response missing text."],
      response: responsePayload,
      prompt: finalPrompt,
    };
  }

  let capture = strict
    ? capturePromptResponse({ prompt: finalPrompt, responseText, phase })
    : captureWithFallback({ prompt: finalPrompt, responseText, phase });
  capture = applySummaryContentErrors(capture, requireSummary);
  let sanitized = false;
  let retried = false;
  let repaired = false;

  if (!strict && capture.errors.length > 0) {
    const retryOptions = buildRepairRequestOptions(requestOptions, { errors: capture.errors, phase });
    // Decision 2 — the rung asks whether the ERROR is retryable, not whether the options
    // happened to grow. At the 2048 clamp they cannot grow, and gating on that silently
    // turned the ladder off at the largest budgets. `retryOptions` is still used, so the
    // retry gets more tokens wherever more tokens exist.
    if (isRetryTriggeringError({ errors: capture.errors, phase })) {
      responsePayload = await adapter.generate({
        model,
        prompt: finalPrompt,
        options: retryOptions,
        format,
        stream: Boolean(stream),
      });
      const retryResponseText = extractResponseText(responsePayload);
      if (isNonEmptyString(retryResponseText)) {
        retried = true;
        requestOptions = retryOptions;
        responseText = retryResponseText;
        capture = captureWithFallback({ prompt: finalPrompt, responseText, phase });
        capture = applySummaryContentErrors(capture, requireSummary);
      }
    }
  }

  if (!strict && capture.errors.length > 0 && typeof repairPromptBuilder === "function") {
    const repairPrompt = repairPromptBuilder({
      prompt: finalPrompt,
      errors: capture.errors,
      responseText,
      responseParsed: capture.responseParsed,
      phase,
    });
    if (isNonEmptyString(repairPrompt)) {
      finalPrompt = repairPrompt;
      repaired = true;
      const repairOptions = buildRepairRequestOptions(requestOptions, { errors: capture.errors, phase });
      responsePayload = await adapter.generate({
        model,
        prompt: finalPrompt,
        options: repairOptions,
        format,
        stream: Boolean(stream),
      });
      const repairResponseText = extractResponseText(responsePayload);
      if (isNonEmptyString(repairResponseText)) {
        responseText = repairResponseText;
        requestOptions = repairOptions;
        capture = captureWithFallback({ prompt: finalPrompt, responseText, phase });
        capture = applySummaryContentErrors(capture, requireSummary);
      }
    }
  }

  if (!strict && capture.errors.length > 0) {
    let sanitizedValue = sanitizeSummaryResponse(responseText, {
      allowedAffinities: ALLOWED_AFFINITIES,
      allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
      phase,
    });
    if (!sanitizedValue && capture.responseParsed) {
      sanitizedValue = sanitizeSummaryValue(capture.responseParsed, {
        allowedAffinities: ALLOWED_AFFINITIES,
        allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
        phase,
      });
    }
    if (sanitizedValue) {
      const sanitizedCapture = capturePromptResponse({
        prompt: finalPrompt,
        responseText: JSON.stringify(sanitizedValue),
        phase,
      });
      const sanitizedWithContent = applySummaryContentErrors(sanitizedCapture, requireSummary);
      if (sanitizedWithContent.errors.length === 0) {
        capture = sanitizedWithContent;
        sanitized = true;
      }
    }
  }

  const endedAt = typeof clock === "function" ? clock() : undefined;
  const endMs = endedAt ? Date.parse(endedAt) : NaN;
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
  const phaseTiming = {
    startedAt,
    endedAt,
    durationMs,
  };
  const cardSet = buildCardSet(capture.summary || {});
  const summaryWithCards = capture.summary && typeof capture.summary === "object"
    ? {
      ...capture.summary,
      cardSet,
    }
    : capture.summary;

  const captureResult = buildLlmCaptureArtifact({
    prompt: finalPrompt,
    responseText,
    responseParsed: capture.responseParsed,
    summary: summaryWithCards,
    parseErrors: capture.errors,
    model,
    baseUrl,
    options: requestOptions,
    stream,
    requestId,
    meta,
    runId,
    producedBy,
    phase,
    phaseContext,
    remainingBudgetTokens,
    phaseTiming,
    clock,
  });

  return {
    ok: capture.errors.length === 0 && captureResult.errors === undefined,
    prompt: finalPrompt,
    responseText,
    responseParsed: capture.responseParsed,
    summary: summaryWithCards,
    cardSet,
    errors: capture.errors,
    capture: captureResult.capture,
    captureErrors: captureResult.errors,
    sanitized,
    retried,
    repaired,
    response: responsePayload,
  };
}
