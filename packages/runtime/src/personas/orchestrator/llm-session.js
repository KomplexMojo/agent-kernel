import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  buildMenuPrompt,
  buildPhasePrompt,
  capturePromptResponse,
} from "./prompt-contract.js";
import { buildLlmCaptureArtifact } from "./llm-capture.js";

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

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.message?.content === "string") return payload.message.content;
  const choice = payload.choices?.[0];
  if (typeof choice?.message?.content === "string") return choice.message.content;
  if (typeof choice?.text === "string") return choice.text;
  return null;
}

function captureWithFallback({ prompt, responseText, phase }) {
  const primary = capturePromptResponse({ prompt, responseText, phase });
  if (primary.errors.length === 0) {
    return primary;
  }
  const extracted = extractJsonObject(responseText);
  if (!extracted) {
    return primary;
  }
  return capturePromptResponse({ prompt, responseText: extracted, phase });
}

function sanitizeSummaryValue(value, { allowedAffinities, allowedExpressions }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
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
    return entry;
  };

  if (Array.isArray(value.rooms)) {
    value.rooms = value.rooms.map(sanitizePick).filter(Boolean);
  }
  if (Array.isArray(value.actors)) {
    value.actors = value.actors.map(sanitizePick).filter(Boolean);
  }
  if (value.layout && typeof value.layout === "object" && !Array.isArray(value.layout)) {
    const nextLayout = {};
    ["wallTiles", "floorTiles", "hallwayTiles"].forEach((field) => {
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

function applySummaryContentErrors(capture, requireSummary) {
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

function sanitizeSummaryResponse(responseText, { allowedAffinities, allowedExpressions }) {
  const extracted = extractJsonObject(responseText) || responseText;
  let value;
  try {
    value = JSON.parse(extracted);
  } catch (error) {
    return null;
  }
  return sanitizeSummaryValue(value, { allowedAffinities, allowedExpressions });
}

function normalizeSessionPrompt({
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
    return buildPhasePrompt({
      goal,
      notes,
      budgetTokens,
      phase,
      remainingBudgetTokens,
      allowedPairsText,
      context: phaseContext,
      layoutCosts,
    });
  }
  return buildMenuPrompt({ goal, notes, budgetTokens });
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
} = {}) {
  const sessionErrors = [];
  if (!adapter || typeof adapter.generate !== "function") {
    addSessionError(sessionErrors, "adapter", "missing_adapter", "adapter.generate is required");
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
  let repaired = false;

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
      responsePayload = await adapter.generate({
        model,
        prompt: finalPrompt,
        options: requestOptions,
        format,
        stream: Boolean(stream),
      });
      const repairResponseText = extractResponseText(responsePayload);
      if (isNonEmptyString(repairResponseText)) {
        responseText = repairResponseText;
        capture = captureWithFallback({ prompt: finalPrompt, responseText, phase });
        capture = applySummaryContentErrors(capture, requireSummary);
      }
    }
  }

  if (!strict && capture.errors.length > 0) {
    let sanitizedValue = sanitizeSummaryResponse(responseText, {
      allowedAffinities: ALLOWED_AFFINITIES,
      allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    });
    if (!sanitizedValue && capture.responseParsed) {
      sanitizedValue = sanitizeSummaryValue(capture.responseParsed, {
        allowedAffinities: ALLOWED_AFFINITIES,
        allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
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

  const captureResult = buildLlmCaptureArtifact({
    prompt: finalPrompt,
    responseText,
    responseParsed: capture.responseParsed,
    summary: capture.summary,
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
    summary: capture.summary,
    errors: capture.errors,
    capture: captureResult.capture,
    captureErrors: captureResult.errors,
    sanitized,
    repaired,
    response: responsePayload,
  };
}
