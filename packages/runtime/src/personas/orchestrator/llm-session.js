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

function sanitizeSummaryValue(value, { allowedAffinities, allowedExpressions, phase }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (isNonEmptyString(phase) && !isNonEmptyString(value.phase)) {
    value.phase = phase;
  }
  if (!Array.isArray(value.rooms) && value.rooms && typeof value.rooms === "object") {
    value.rooms = [value.rooms];
  }
  if (!Array.isArray(value.defenders) && value.defenders && typeof value.defenders === "object") {
    value.defenders = [value.defenders];
  }
  if (!Array.isArray(value.actors)) {
    if (value.actors && typeof value.actors === "object") {
      value.actors = [value.actors];
    } else if (Array.isArray(value.defenders)) {
      value.actors = value.defenders.map((entry) => ({ ...entry }));
    } else if (value.actor && typeof value.actor === "object") {
      value.actors = [value.actor];
    }
  }
  if (!Array.isArray(value.attackerConfigs)) {
    if (value.attackerConfigs && typeof value.attackerConfigs === "object") {
      value.attackerConfigs = [value.attackerConfigs];
    } else if (value.attackerConfig && typeof value.attackerConfig === "object") {
      value.attackerConfigs = [{ ...value.attackerConfig }];
    }
  }
  if (Array.isArray(value.attackerConfigs)) {
    value.attackerConfigs = value.attackerConfigs
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({ ...entry }));
    if (value.attackerConfigs.length > 0) {
      if (!value.attackerConfig || typeof value.attackerConfig !== "object" || Array.isArray(value.attackerConfig)) {
        value.attackerConfig = { ...value.attackerConfigs[0] };
      }
      if (!Number.isInteger(value.attackerCount) || value.attackerCount <= 0) {
        value.attackerCount = value.attackerConfigs.length;
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
  if (Array.isArray(value.defenders)) {
    value.defenders = value.defenders.map(sanitizePick).filter(Boolean);
    if (!Array.isArray(value.actors)) {
      value.actors = value.defenders.map((entry) => ({ ...entry }));
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

function hasErrorCode(errors, code) {
  if (!Array.isArray(errors) || !code) return false;
  return errors.some((entry) => entry && typeof entry === "object" && entry.code === code);
}

function buildRepairRequestOptions(options, { errors, phase } = {}) {
  const codeTriggered = hasErrorCode(errors, "invalid_json")
    || hasErrorCode(errors, "missing_response_text")
    || (phase === "actors_only" && hasErrorCode(errors, "missing_actors"));
  if (!codeTriggered) {
    return options && typeof options === "object" ? { ...options } : options;
  }
  const next = options && typeof options === "object" ? { ...options } : {};
  const current = Number.isInteger(next.num_predict) && next.num_predict > 0 ? next.num_predict : 0;
  const minByPhase = phase === "actors_only" ? 480 : 320;
  const expanded = Math.max(minByPhase, current + 240, Math.ceil(current * 2));
  next.num_predict = Math.min(expanded, 2048);
  return next;
}

function getNumPredict(options) {
  if (!options || typeof options !== "object") return 0;
  return Number.isInteger(options.num_predict) && options.num_predict > 0 ? options.num_predict : 0;
}

function sanitizeSummaryResponse(responseText, { allowedAffinities, allowedExpressions, phase }) {
  const value = parseJsonLenient(responseText);
  if (!value) return null;
  return sanitizeSummaryValue(value, { allowedAffinities, allowedExpressions, phase });
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
  let retried = false;
  let repaired = false;

  if (!strict && capture.errors.length > 0) {
    const retryOptions = buildRepairRequestOptions(requestOptions, { errors: capture.errors, phase });
    const previousPredict = getNumPredict(requestOptions);
    const retryPredict = getNumPredict(retryOptions);
    if (retryPredict > previousPredict) {
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
    retried,
    repaired,
    response: responsePayload,
  };
}
