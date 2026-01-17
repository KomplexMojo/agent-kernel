const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, appendFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const LIVE_ENABLED = ["1", "true"].includes(String(process.env.AK_LLM_LIVE).toLowerCase());
const CAPTURE_PATH = process.env.AK_LLM_CAPTURE_PATH;

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf8"));
}

function appendJsonl(path, record) {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  appendFileSync(resolved, `${JSON.stringify(record)}\n`, "utf8");
}

function createStubCore() {
  const state = {
    width: 0,
    height: 0,
    grid: [],
    actor: { x: 0, y: 0, vitals: [] },
  };

  return {
    configureGrid(width, height) {
      state.width = width;
      state.height = height;
      state.grid = Array.from({ length: height }, () => Array.from({ length: width }, () => 1));
      return 0;
    },
    setTileAt(x, y, value) {
      if (state.grid[y]) state.grid[y][x] = value;
    },
    spawnActorAt(x, y) {
      state.actor.x = x;
      state.actor.y = y;
    },
    setActorVital(index, current, max, regen) {
      state.actor.vitals[index] = { current, max, regen };
    },
    getMapWidth() {
      return state.width;
    },
    getMapHeight() {
      return state.height;
    },
  };
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

function captureWithFallback({ prompt, responseText, capturePromptResponse }) {
  const primary = capturePromptResponse({ prompt, responseText });
  if (primary.errors.length === 0) {
    return primary;
  }
  const extracted = extractJsonObject(responseText);
  if (!extracted) {
    return primary;
  }
  return capturePromptResponse({ prompt, responseText: extracted });
}

function sanitizeSummaryResponse(
  responseText,
  { allowedAffinities, allowedExpressions }
) {
  const extracted = extractJsonObject(responseText) || responseText;
  let value;
  try {
    value = JSON.parse(extracted);
  } catch (error) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sanitizePick = (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    if (!Number.isInteger(entry.tokenHint) || entry.tokenHint <= 0) {
      delete entry.tokenHint;
    }
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

  return value;
}

function deriveAllowedPairs(catalog) {
  const entries = Array.isArray(catalog?.entries)
    ? catalog.entries
    : Array.isArray(catalog)
      ? catalog
      : [];
  const pairs = new Map();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const { motivation, affinity } = entry;
    if (typeof motivation !== "string" || typeof affinity !== "string") return;
    const key = `${motivation}|${affinity}`;
    if (!pairs.has(key)) {
      pairs.set(key, { motivation, affinity });
    }
  });
  return Array.from(pairs.values()).sort(
    (a, b) => a.motivation.localeCompare(b.motivation) || a.affinity.localeCompare(b.affinity),
  );
}

function formatAllowedPairs(pairs) {
  return pairs.map((pair) => `(${pair.motivation}, ${pair.affinity})`).join(", ");
}

function countInstances(selections, kind) {
  return selections
    .filter((sel) => sel.kind === kind && Array.isArray(sel.instances))
    .reduce((sum, sel) => sum + sel.instances.length, 0);
}

function summarizeMissingSelections(selections) {
  return selections
    .filter((sel) => !sel.applied)
    .map((sel) => `${sel.kind}:${sel.requested?.motivation || "?"}/${sel.requested?.affinity || "?"}`)
    .join(", ");
}

function isNotFound(error) {
  const message = String(error?.message || "");
  return message.includes("404");
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  return { response, payload };
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

async function requestLlmResponse({ baseUrl, model, prompt, createLlmAdapter }) {
  const cleanBase = normalizeBaseUrl(baseUrl);

  try {
    const llm = createLlmAdapter({ baseUrl: cleanBase });
    const llmResponse = await llm.generate({ model, prompt });
    const responseText = extractResponseText(llmResponse);
    if (responseText) {
      return { ok: true, responseText, mode: "generate" };
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  const attempts = [
    {
      label: "ollama-chat",
      path: "/api/chat",
      body: { model, messages: [{ role: "user", content: prompt }], stream: false },
    },
    {
      label: "openai-chat",
      path: "/v1/chat/completions",
      body: { model, messages: [{ role: "user", content: prompt }] },
    },
    {
      label: "openai-completions",
      path: "/v1/completions",
      body: { model, prompt },
    },
  ];

  for (const attempt of attempts) {
    const { response, payload } = await postJson(`${cleanBase}${attempt.path}`, attempt.body);
    if (response.status === 404) {
      continue;
    }
    if (!response.ok) {
      throw new Error(`LLM request failed (${attempt.label}): ${response.status} ${response.statusText}`);
    }
    const responseText = extractResponseText(payload);
    if (!responseText) {
      throw new Error(`LLM response missing text for ${attempt.label}.`);
    }
    return { ok: true, responseText, mode: attempt.label };
  }

  return {
    ok: false,
    error: new Error("LLM request failed: no supported endpoint responded. Check AK_LLM_BASE_URL."),
  };
}

test("live llm prompt flows into build + runtime", async (t) => {
  if (!LIVE_ENABLED) {
    t.skip("Set AK_LLM_LIVE=1 to run live LLM integration test.");
    return;
  }

  const model = process.env.AK_LLM_MODEL;
  if (!model) {
    throw new Error("AK_LLM_MODEL is required when AK_LLM_LIVE=1.");
  }
  const baseUrl = process.env.AK_LLM_BASE_URL || "http://localhost:11434";

  const scenario = readJson("tests/fixtures/e2e/e2e-scenario-v1-basic.json");
  const catalog = readJson(scenario.catalogPath);

  const { createLlmAdapter } = await import(
    moduleUrl("packages/adapters-cli/src/adapters/llm/index.js")
  );
  const {
    buildMenuPrompt,
    capturePromptResponse,
    ALLOWED_AFFINITIES,
    ALLOWED_AFFINITY_EXPRESSIONS,
    ALLOWED_MOTIVATIONS,
  } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );
  const { orchestrateBuild } = await import(
    moduleUrl("packages/runtime/src/build/orchestrate-build.js")
  );
  const { buildLlmCaptureArtifact } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/llm-capture.js")
  );
  const { initializeCoreFromArtifacts } = await import(
    moduleUrl("packages/runtime/src/runner/core-setup.mjs")
  );

  const allowedPairs = deriveAllowedPairs(catalog);
  const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
  const notes = [
    "Include at least one room and one actor; counts must be > 0.",
    allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const basePrompt = buildMenuPrompt({
    goal: scenario.goal,
    notes,
    budgetTokens: scenario.budgetTokens,
  });
  const prompt = [
    basePrompt,
    "",
    "Constraints:",
    "- In affinities[] entries, kind must be from Affinities and expression must be from Affinity expressions.",
    "- Omit optional fields instead of using null.",
    "",
    "Final request: return the JSON now. Output JSON only (no markdown, no commentary).",
  ].join("\n");

  async function requestAndParseSummary(promptText) {
    const response = await requestLlmResponse({ baseUrl, model, prompt: promptText, createLlmAdapter });
    if (!response.ok) {
      throw response.error;
    }
    const capture = captureWithFallback({
      prompt: promptText,
      responseText: response.responseText,
      capturePromptResponse,
    });
    return { response, capture, promptText };
  }

  async function requestSummary(promptText) {
    let result = await requestAndParseSummary(promptText);
    if (result.capture.errors.length > 0) {
      const extracted = extractJsonObject(result.response.responseText) || result.response.responseText;
      const repairPrompt = [
        basePrompt,
        "",
        "Your previous response failed validation. Fix it and return corrected JSON only.",
        `Errors: ${JSON.stringify(result.capture.errors)}`,
        `Allowed affinities: ${ALLOWED_AFFINITIES.join(", ")}`,
        `Allowed expressions: ${ALLOWED_AFFINITY_EXPRESSIONS.join(", ")}`,
        `Allowed motivations: ${ALLOWED_MOTIVATIONS.join(", ")}`,
        allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
        "tokenHint must be a positive integer if provided; otherwise omit it.",
        "Example affinity entry: {\"kind\":\"water\",\"expression\":\"push\",\"stacks\":1}",
        "Invalid response JSON (fix to match schema):",
        String(extracted),
        "",
        "Final request: return corrected JSON only.",
      ]
        .filter(Boolean)
        .join("\n");
      result = await requestAndParseSummary(repairPrompt);
    }

    if (result.capture.errors.length > 0) {
      const sanitized = sanitizeSummaryResponse(result.response.responseText, {
        allowedAffinities: ALLOWED_AFFINITIES,
        allowedExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
      });
      if (sanitized) {
        const sanitizedCapture = capturePromptResponse({
          prompt: result.promptText,
          responseText: JSON.stringify(sanitized),
        });
        if (sanitizedCapture.errors.length === 0) {
          t.diagnostic("LLM response sanitized to satisfy prompt contract.");
          result = { ...result, capture: sanitizedCapture };
        }
      }
    }

    if (result.capture.errors.length > 0) {
      const preview = String(result.response.responseText || "").slice(0, 800);
      throw new Error(
        `LLM response failed summary parse: ${JSON.stringify(result.capture.errors)}\nPreview:\n${preview}`
      );
    }
    assert.ok(result.capture.summary);
    if (Array.isArray(result.capture.summary.missing) && result.capture.summary.missing.length > 0) {
      throw new Error(`LLM summary reported missing fields: ${result.capture.summary.missing.join(", ")}`);
    }

    const actorCount = result.capture.summary.actors.reduce((sum, entry) => sum + entry.count, 0);
    const roomCount = result.capture.summary.rooms.reduce((sum, entry) => sum + entry.count, 0);
    if (actorCount <= 0 || roomCount <= 0) {
      const preview = String(result.response.responseText || "").slice(0, 800);
      throw new Error(
        `LLM summary missing required counts (actors=${actorCount}, rooms=${roomCount}).\nPreview:\n${preview}`
      );
    }

    return result;
  }

  let result = await requestSummary(prompt);
  let mapped = mapSummaryToPool({ summary: result.capture.summary, catalog });
  assert.equal(mapped.ok, true);

  let actorInstances = countInstances(mapped.selections, "actor");
  let roomInstances = countInstances(mapped.selections, "room");
  if (actorInstances === 0 || roomInstances === 0) {
    const missingSelections = summarizeMissingSelections(mapped.selections);
    const catalogRepairPrompt = [
      basePrompt,
      "",
      "Your previous response did not match the pool catalog. Choose only from the allowed profiles below.",
      allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}` : null,
      missingSelections ? `Unmatched picks: ${missingSelections}` : null,
      "Final request: return corrected JSON only.",
    ]
      .filter(Boolean)
      .join("\n");
    result = await requestSummary(catalogRepairPrompt);
    mapped = mapSummaryToPool({ summary: result.capture.summary, catalog });
    assert.equal(mapped.ok, true);
    actorInstances = countInstances(mapped.selections, "actor");
    roomInstances = countInstances(mapped.selections, "room");
    if (actorInstances === 0 || roomInstances === 0) {
      throw new Error(
        `LLM summary did not match catalog entries (actors=${actorInstances}, rooms=${roomInstances}).`
      );
    }
  }

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: result.capture.summary,
    catalog,
    selections: mapped.selections,
    runId: "run_e2e_live",
    createdAt: new Date().toISOString(),
    source: "integration-test",
  });
  assert.equal(buildSpecResult.ok, true);

  const captureResult = buildLlmCaptureArtifact({
    prompt: result.promptText,
    responseText: result.response.responseText,
    responseParsed: result.capture.responseParsed,
    summary: result.capture.summary,
    parseErrors: result.capture.errors,
    model,
    baseUrl,
    runId: buildSpecResult.spec.meta.runId,
    producedBy: "orchestrator",
    clock: () => buildSpecResult.spec.meta.createdAt,
  });
  assert.equal(captureResult.errors, undefined);
  if (CAPTURE_PATH) {
    appendJsonl(CAPTURE_PATH, {
      runId: buildSpecResult.spec.meta.runId,
      createdAt: buildSpecResult.spec.meta.createdAt,
      model,
      baseUrl,
      mode: result.response.mode,
      capture: captureResult.capture,
    });
  }

  const buildResult = await orchestrateBuild({
    spec: buildSpecResult.spec,
    producedBy: "runtime-build",
    capturedInputs: [captureResult.capture],
  });
  assert.ok(buildResult.simConfig);
  assert.ok(buildResult.initialState);
  assert.equal(buildResult.capturedInputs?.length, 1);

  const core = createStubCore();
  const runtimeLoad = initializeCoreFromArtifacts(core, {
    simConfig: buildResult.simConfig,
    initialState: buildResult.initialState,
  });

  assert.equal(runtimeLoad.layout.ok, true);
  assert.equal(runtimeLoad.actor.ok, true);
  assert.equal(core.getMapWidth(), runtimeLoad.layout.dimensions.width);
  assert.equal(core.getMapHeight(), runtimeLoad.layout.dimensions.height);
});
