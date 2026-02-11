const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, appendFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");
const { loadCoreFromWasmPath, resolveWasmPathOrThrow } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const LIVE_ENABLED = ["1", "true"].includes(String(process.env.AK_LLM_LIVE).toLowerCase());
const CAPTURE_PATH = process.env.AK_LLM_CAPTURE_PATH;
const USE_WASM = ["1", "true"].includes(String(process.env.AK_LLM_USE_WASM).toLowerCase());
const STRICT_ENABLED = ["1", "true"].includes(String(process.env.AK_LLM_STRICT).toLowerCase());

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
    ALLOWED_AFFINITIES,
    ALLOWED_AFFINITY_EXPRESSIONS,
    ALLOWED_MOTIVATIONS,
  } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const {
    LLM_REPAIR_TEXT,
    appendLlmPromptSuffix,
    buildLlmActorConfigPromptTemplate,
    buildLlmCatalogRepairPromptTemplate,
    buildLlmConstraintSection,
    buildLlmRepairPromptTemplate,
  } = await import(
    moduleUrl("packages/runtime/src/contracts/domain-constants.js")
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
  const { runLlmSession } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/llm-session.js")
  );
  const { initializeCoreFromArtifacts } = await import(
    moduleUrl("packages/runtime/src/runner/core-setup.mjs")
  );

  const allowedPairs = deriveAllowedPairs(catalog);
  const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
  const notes = scenario?.notes || "";
  const basePrompt = buildLlmActorConfigPromptTemplate({
    goal: scenario.goal,
    notes,
    budgetTokens: scenario.budgetTokens,
    allowedPairsText,
    affinities: ALLOWED_AFFINITIES,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: ALLOWED_MOTIVATIONS,
  });
  const constraintLines = buildLlmConstraintSection({ allowedPairsText });
  const prompt = appendLlmPromptSuffix(`${basePrompt}\n\n${constraintLines}`);

  const createdAt = new Date().toISOString();

  const llmAdapter = {
    async generate({ model: modelName, prompt: promptText }) {
      const response = await requestLlmResponse({ baseUrl, model: modelName, prompt: promptText, createLlmAdapter });
      if (!response.ok) {
        throw response.error;
      }
      return { response: response.responseText, mode: response.mode };
    },
  };

  const repairPromptBuilder = ({ errors, responseText }) => buildLlmRepairPromptTemplate({
    basePrompt,
    errors,
    responseText,
    affinities: ALLOWED_AFFINITIES,
    affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
    motivations: ALLOWED_MOTIVATIONS,
    allowedPairsText,
    phaseRequirement: LLM_REPAIR_TEXT.phaseActorsRequirement,
    extraLines: [LLM_REPAIR_TEXT.tokenHintRule, LLM_REPAIR_TEXT.exampleAffinityEntry],
  });

  async function requestSummary(promptText) {
    const session = await runLlmSession({
      adapter: llmAdapter,
      model,
      baseUrl,
      prompt: promptText,
      strict: STRICT_ENABLED,
      repairPromptBuilder,
      runId: "run_e2e_live",
      clock: () => createdAt,
      producedBy: "orchestrator",
    });

    if (session.repaired) {
      t.diagnostic("LLM response repaired to satisfy prompt contract.");
    }
    if (session.sanitized) {
      t.diagnostic("LLM response sanitized to satisfy prompt contract.");
    }

    if (!session.ok) {
      const preview = String(session.responseText || "").slice(0, 800);
      throw new Error(
        `LLM response failed summary parse: ${JSON.stringify(session.errors)}\nPreview:\n${preview}`
      );
    }
    assert.ok(session.summary);
    if (Array.isArray(session.summary.missing) && session.summary.missing.length > 0) {
      throw new Error(`LLM summary reported missing fields: ${session.summary.missing.join(", ")}`);
    }

    const actorCount = session.summary.actors.reduce((sum, entry) => sum + entry.count, 0);
    const roomCount = session.summary.rooms.reduce((sum, entry) => sum + entry.count, 0);
    if (actorCount <= 0 || roomCount <= 0) {
      const preview = String(session.responseText || "").slice(0, 800);
      throw new Error(
        `LLM summary missing required counts (actors=${actorCount}, rooms=${roomCount}).\nPreview:\n${preview}`
      );
    }

    return session;
  }

  let result = await requestSummary(prompt);
  let mapped = mapSummaryToPool({ summary: result.summary, catalog });
  assert.equal(mapped.ok, true);

  let actorInstances = countInstances(mapped.selections, "actor");
  let roomInstances = countInstances(mapped.selections, "room");
  if (actorInstances === 0 || roomInstances === 0) {
    const missingSelections = summarizeMissingSelections(mapped.selections);
    const catalogRepairPrompt = buildLlmCatalogRepairPromptTemplate({
      basePrompt,
      allowedPairsText,
      missingSelections,
    });
    result = await requestSummary(catalogRepairPrompt);
    mapped = mapSummaryToPool({ summary: result.summary, catalog });
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
    summary: result.summary,
    catalog,
    selections: mapped.selections,
    runId: "run_e2e_live",
    createdAt,
    source: "integration-test",
  });
  assert.equal(buildSpecResult.ok, true);

  assert.ok(result.capture);
  if (CAPTURE_PATH) {
    appendJsonl(CAPTURE_PATH, {
      runId: buildSpecResult.spec.meta.runId,
      createdAt: buildSpecResult.spec.meta.createdAt,
      model,
      baseUrl,
      mode: result.response?.mode,
      capture: result.capture,
    });
  }

  const buildResult = await orchestrateBuild({
    spec: buildSpecResult.spec,
    producedBy: "runtime-build",
    capturedInputs: [result.capture],
  });
  assert.ok(buildResult.simConfig);
  assert.ok(buildResult.initialState);
  assert.equal(buildResult.capturedInputs?.length, 1);

  let core = createStubCore();
  let usedWasm = false;
  let wasmPath = null;
  if (USE_WASM) {
    wasmPath = resolveWasmPathOrThrow();
    core = await loadCoreFromWasmPath(wasmPath);
    usedWasm = true;
  }

  ["configureGrid", "setTileAt", "spawnActorAt", "setActorVital"].forEach((method) => {
    assert.equal(typeof core[method], "function", `core.${method} must be a function`);
  });
  if (USE_WASM) {
    assert.equal(usedWasm, true);
    t.diagnostic(`LLM live test using WASM core at ${wasmPath}`);
  }
  const runtimeLoad = initializeCoreFromArtifacts(core, {
    simConfig: buildResult.simConfig,
    initialState: buildResult.initialState,
  });

  assert.equal(runtimeLoad.layout.ok, true);
  assert.equal(runtimeLoad.actor.ok, true);
  assert.equal(core.getMapWidth(), runtimeLoad.layout.dimensions.width);
  assert.equal(core.getMapHeight(), runtimeLoad.layout.dimensions.height);
});
