import { orchestrateBuild } from "../build/orchestrate-build.js";
import { summarizeMixedRoomAssemblies, formatMixedRoomAssembliesCliLines } from "../build/mixed-room-summary.js";
import { buildBuildTelemetryRecord } from "../build/telemetry.js";
import { filterSchemaCatalogEntries } from "../contracts/schema-catalog.js";
import { buildBuildSpecFromSummary } from "../personas/director/buildspec-assembler.js";
import { mapSummaryToPool } from "../personas/director/pool-mapper.js";
import { generateGridLayoutFromInput } from "../personas/configurator/level-layout.js";
import { buildSimConfigArtifact, buildInitialStateArtifact } from "../personas/configurator/artifact-builders.js";
import { evaluateConfiguratorSpend } from "../personas/configurator/spend-proposal.js";
import { resolveAffinityEffects } from "../personas/configurator/affinity-effects.js";
import { runLlmSession } from "../personas/orchestrator/llm-session.js";
import { runLlmBudgetLoop } from "../personas/orchestrator/llm-budget-loop.js";
import { createRuntime } from "../runner/runtime.js";
import {
  ALLOWED_AFFINITIES,
  ALLOWED_AFFINITY_EXPRESSIONS,
  ALLOWED_MOTIVATIONS,
  deriveAllowedOptionsFromCatalog,
  normalizeSummary,
} from "../personas/orchestrator/prompt-contract.js";
import {
  applyActorOverrides,
  applyTileOverrides,
  baseVitalsFromActors,
  compareFrameSummaries,
  compareRuntimeDecisionCaptureSummaries,
  compareRuntimeDecisionSummaries,
  createDeterministicClock,
  summarizeRuntimeDecisions,
  summarizeRuntimeDecisionCaptures,
  normalizeArgList,
  resolveClockSeed,
  resolveVitalDefaults,
  summarizeFrame,
} from "./run-helpers.js";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  LLM_REPAIR_TEXT,
  appendLlmPromptSuffix,
  buildLlmActorConfigPromptTemplate,
  buildLlmCatalogRepairPromptTemplate,
  buildLlmConstraintSection,
  buildLlmRepairPromptTemplate,
} from "../contracts/domain-constants.js";

const SCHEMAS = Object.freeze({
  intent: "agent-kernel/IntentEnvelope",
  plan: "agent-kernel/PlanArtifact",
  budgetReceipt: "agent-kernel/BudgetReceipt",
  budgetArtifact: "agent-kernel/BudgetArtifact",
  budgetReceiptArtifact: "agent-kernel/BudgetReceiptArtifact",
  priceList: "agent-kernel/PriceList",
  simConfig: "agent-kernel/SimConfigArtifact",
  initialState: "agent-kernel/InitialStateArtifact",
  executionPolicy: "agent-kernel/ExecutionPolicy",
  solverRequest: "agent-kernel/SolverRequest",
  solverResult: "agent-kernel/SolverResult",
  tickFrame: "agent-kernel/TickFrame",
  effect: "agent-kernel/Effect",
  telemetry: "agent-kernel/TelemetryRecord",
  runSummary: "agent-kernel/RunSummary",
  affinityPreset: "agent-kernel/AffinityPresetArtifact",
  actorLoadout: "agent-kernel/ActorLoadoutArtifact",
  affinitySummary: "agent-kernel/AffinitySummary",
  capturedInput: "agent-kernel/CapturedInputArtifact",
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeFileSegment(value) {
  const raw = String(value || "").toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "capture";
}

function sanitizeFileName(value) {
  const raw = String(value || "");
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "capture";
}

function buildSpecMeta(spec, producedBy, suffix) {
  return {
    id: `${spec.meta.id}_${suffix}`,
    runId: spec.meta.runId,
    createdAt: spec.meta.createdAt,
    producedBy,
    correlationId: spec.meta.correlationId,
    note: spec.meta.note,
  };
}

function assertSchema(artifact, expectedSchema) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`Expected ${expectedSchema} artifact.`);
  }
  if (artifact.schema !== expectedSchema) {
    throw new Error(`Expected schema ${expectedSchema}, got ${artifact.schema || "missing"}.`);
  }
  if (artifact.schemaVersion !== 1) {
    throw new Error(`Expected schemaVersion 1 for ${expectedSchema}.`);
  }
}

function addManifestEntry(entries, artifact, path) {
  if (!artifact || typeof artifact !== "object") {
    return;
  }
  const id = artifact.meta?.id;
  if (!id) {
    return;
  }
  entries.push({
    id,
    schema: artifact.schema,
    schemaVersion: artifact.schemaVersion,
    path,
  });
}

function buildArtifactRefs(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    schema: entry.schema,
    schemaVersion: entry.schemaVersion,
  }));
}

function buildCapturedInputPath(adapter, index, outputRefId) {
  if (isNonEmptyString(outputRefId)) {
    return `${sanitizeFileName(outputRefId)}.json`;
  }
  const safeAdapter = sanitizeFileSegment(adapter);
  return `captured-input-${safeAdapter}-${index + 1}.json`;
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function resolveDefaultLlmFixturePath({ resolvePath, exists, cwd }) {
  const candidates = [
    resolvePath("tests/fixtures/adapters/llm-generate-summary.json"),
    resolvePath("tests/fixtures/adapters/llm-generate-summary.json", cwd()),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
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
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
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

function appendJsonOnlyInstruction(promptText) {
  return appendLlmPromptSuffix(promptText);
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

function injectBudgetTokens(prompt, budgetTokens) {
  if (!isNonEmptyString(prompt)) {
    return prompt;
  }
  if (!Number.isInteger(budgetTokens) || budgetTokens <= 0) {
    return prompt;
  }
  if (prompt.includes("Budget tokens:")) {
    return prompt;
  }
  return `Budget tokens: ${budgetTokens}\n${prompt}`;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveScenarioAssetPath(rawPath, baseDir, resolvePath, exists) {
  if (!rawPath) {
    return null;
  }
  const primary = resolvePath(rawPath);
  if (primary && exists(primary)) {
    return primary;
  }
  if (!baseDir) {
    return primary;
  }
  const fallback = resolvePath(rawPath, baseDir);
  if (fallback && exists(fallback)) {
    return fallback;
  }
  return primary || fallback;
}

function buildRepairPrompt({ basePrompt, errors, responseText, allowedOptions, allowedPairsText }) {
  const extracted = extractJsonObject(responseText) || responseText;
  const affinities = allowedOptions?.affinities?.length ? allowedOptions.affinities : ALLOWED_AFFINITIES;
  const motivations = allowedOptions?.motivations?.length ? allowedOptions.motivations : ALLOWED_MOTIVATIONS;
  const expressions = ALLOWED_AFFINITY_EXPRESSIONS;
  return buildLlmRepairPromptTemplate({
    basePrompt,
    errors,
    responseText: extracted,
    affinities,
    affinityExpressions: expressions,
    motivations,
    allowedPairsText,
    phaseRequirement: LLM_REPAIR_TEXT.phaseActorsRequirement,
    extraLines: [
      LLM_REPAIR_TEXT.tokenHintRule,
      LLM_REPAIR_TEXT.exampleAffinityEntry,
    ],
  });
}

function readEnv(env, key) {
  if (!env || typeof env !== "object") {
    return undefined;
  }
  return env[key];
}

function toBooleanGate(value) {
  return value === true || value === "1" || value === "true";
}

function resolveBoolGate(fnOrValue, fallback = false) {
  if (typeof fnOrValue === "function") {
    return Boolean(fnOrValue());
  }
  if (fnOrValue === undefined) {
    return fallback;
  }
  return Boolean(fnOrValue);
}

function requireHostFunction(host, name) {
  const fn = host?.[name];
  if (typeof fn !== "function") {
    throw new Error(`command kernel host missing function: ${name}`);
  }
  return fn;
}

async function captureAdapterPayload({ capture, index, baseDir, spec, producedBy, allowNetwork, host }) {
  const readText = requireHostFunction(host, "readText");
  const resolvePath = requireHostFunction(host, "resolvePath");
  const createIpfsAdapter = requireHostFunction(host, "createIpfsAdapter");
  const createBlockchainAdapter = requireHostFunction(host, "createBlockchainAdapter");
  const createLlmAdapter = requireHostFunction(host, "createLlmAdapter");
  const isLocalBaseUrl = requireHostFunction(host, "isLocalBaseUrl");

  if (!capture || typeof capture !== "object") {
    throw new Error("build capture requires an object entry.");
  }
  const adapterRaw = capture.adapter;
  if (!isNonEmptyString(adapterRaw)) {
    throw new Error("build capture requires adapter name.");
  }

  const adapterKey = adapterRaw.toLowerCase();
  const request = isObject(capture.request) ? capture.request : {};
  const outputRef = capture.outputRef;
  if (outputRef) {
    if (outputRef.schema !== SCHEMAS.capturedInput) {
      throw new Error(`capture outputRef schema must be ${SCHEMAS.capturedInput}.`);
    }
    if (outputRef.schemaVersion !== 1) {
      throw new Error("capture outputRef schemaVersion must be 1.");
    }
  }

  const suffix = `capture_${sanitizeFileSegment(adapterKey)}_${index + 1}`;
  const meta = buildSpecMeta(spec, producedBy, suffix);
  if (outputRef?.id) {
    meta.id = outputRef.id;
  }

  const source = {
    adapter: adapterRaw,
    requestId: isNonEmptyString(request.requestId) ? request.requestId : undefined,
    request,
  };

  let payload;
  let contentType = capture.contentType || request.contentType;

  if (adapterKey === "ipfs") {
    const cid = request.cid;
    if (!isNonEmptyString(cid)) {
      throw new Error("ipfs capture requires request.cid.");
    }
    const path = request.path || "";
    const gatewayUrl = request.gatewayUrl || "https://ipfs.io/ipfs";
    const wantJson = request.json !== undefined
      ? Boolean(request.json)
      : contentType === "application/json";
    const fixturePath = resolvePath(capture.fixturePath || request.fixturePath, baseDir);

    let fetchFn;
    if (fixturePath) {
      const fixtureText = await readText(fixturePath);
      fetchFn = async () => ({ ok: true, text: async () => fixtureText });
    } else if (!allowNetwork) {
      throw new Error("ipfs capture requires fixturePath unless AK_ALLOW_NETWORK=1.");
    }

    const adapter = createIpfsAdapter({ gatewayUrl, fetchFn });
    payload = wantJson ? await adapter.fetchJson(cid, path) : await adapter.fetchText(cid, path);
    contentType = contentType || (wantJson ? "application/json" : "text/plain");
  } else if (adapterKey === "blockchain") {
    const rpcUrl = request.rpcUrl;
    if (!isNonEmptyString(rpcUrl)) {
      throw new Error("blockchain capture requires request.rpcUrl.");
    }
    const address = request.address;
    const fixtureChainIdPath = resolvePath(request.fixtureChainIdPath, baseDir);
    const fixtureBalancePath = resolvePath(request.fixtureBalancePath, baseDir);

    if ((!fixtureChainIdPath || (address && !fixtureBalancePath)) && !allowNetwork) {
      throw new Error("blockchain capture requires fixtures unless AK_ALLOW_NETWORK=1.");
    }

    let fetchFn;
    if (fixtureChainIdPath || fixtureBalancePath) {
      const chainFixture = fixtureChainIdPath ? JSON.parse(await readText(fixtureChainIdPath)) : null;
      const balanceFixture = fixtureBalancePath ? JSON.parse(await readText(fixtureBalancePath)) : null;
      fetchFn = async (_url, options) => {
        const body = JSON.parse(options?.body || "{}");
        if (body.method === "eth_chainId" && chainFixture) {
          return { ok: true, json: async () => chainFixture };
        }
        if (body.method === "eth_getBalance" && balanceFixture) {
          return { ok: true, json: async () => balanceFixture };
        }
        return { ok: false, status: 500, statusText: "Missing fixture" };
      };
    }

    const adapter = createBlockchainAdapter({ rpcUrl, fetchFn });
    payload = { rpcUrl };
    payload.chainId = await adapter.getChainId();
    if (address) {
      payload.address = address;
      payload.balance = await adapter.getBalance(address);
    }
    contentType = contentType || "application/json";
  } else if (adapterKey === "llm" || adapterKey === "ollama") {
    const model = request.model;
    const prompt = request.prompt;
    if (!isNonEmptyString(model) || !isNonEmptyString(prompt)) {
      throw new Error("llm capture requires request.model and request.prompt.");
    }
    const baseUrl = request.baseUrl || request.base_url || DEFAULT_LLM_BASE_URL;
    const fixturePath = resolvePath(capture.fixturePath || request.fixturePath, baseDir);

    let fetchFn;
    if (fixturePath) {
      const fixtureJson = JSON.parse(await readText(fixturePath));
      fetchFn = async () => ({ ok: true, json: async () => fixtureJson });
    } else if (!allowNetwork && !isLocalBaseUrl(baseUrl)) {
      throw new Error("llm capture requires fixturePath unless AK_ALLOW_NETWORK=1.");
    }

    const options = isObject(request.options) ? request.options : undefined;
    const adapter = createLlmAdapter({ baseUrl, fetchFn });
    payload = await adapter.generate({
      model,
      prompt,
      options,
      stream: Boolean(request.stream),
    });
    contentType = contentType || "application/json";
  } else {
    throw new Error(`unknown capture adapter ${adapterRaw}`);
  }

  const artifact = {
    schema: SCHEMAS.capturedInput,
    schemaVersion: 1,
    meta,
    source,
    contentType: contentType || "application/json",
    payload,
  };

  return {
    artifact,
    path: buildCapturedInputPath(adapterKey, index, outputRef?.id),
  };
}

function buildBuildArtifacts(buildResult, { includeBudgetAllocation = null, capturedInputs = [] } = {}) {
  const artifacts = [];
  if (buildResult.intent) artifacts.push(buildResult.intent);
  if (buildResult.plan) artifacts.push(buildResult.plan);
  if (buildResult.budget?.budget) artifacts.push(buildResult.budget.budget);
  if (buildResult.budget?.priceList) artifacts.push(buildResult.budget.priceList);
  if (buildResult.budgetReceipt) artifacts.push(buildResult.budgetReceipt);
  if (includeBudgetAllocation) artifacts.push(includeBudgetAllocation);
  if (buildResult.solverRequest) artifacts.push(buildResult.solverRequest);
  if (buildResult.solverResult) artifacts.push(buildResult.solverResult);
  if (buildResult.simConfig) artifacts.push(buildResult.simConfig);
  if (buildResult.initialState) artifacts.push(buildResult.initialState);
  if (buildResult.resourceBundle) artifacts.push(buildResult.resourceBundle);
  capturedInputs.forEach((entry) => {
    artifacts.push(entry.artifact || entry);
  });

  artifacts.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.meta.id.localeCompare(b.meta.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  return artifacts;
}

function buildBuildManifestEntries(buildResult, { includeBudgetAllocation = null, capturedInputs = [] } = {}) {
  const entries = [];
  addManifestEntry(entries, buildResult.intent, "intent.json");
  addManifestEntry(entries, buildResult.plan, "plan.json");
  addManifestEntry(entries, buildResult.budget?.budget, "budget.json");
  addManifestEntry(entries, buildResult.budget?.priceList, "price-list.json");
  addManifestEntry(entries, buildResult.budgetReceipt, "budget-receipt.json");
  addManifestEntry(entries, includeBudgetAllocation, "budget-allocation.json");
  addManifestEntry(entries, buildResult.solverRequest, "solver-request.json");
  addManifestEntry(entries, buildResult.solverResult, "solver-result.json");
  addManifestEntry(entries, buildResult.simConfig, "sim-config.json");
  addManifestEntry(entries, buildResult.initialState, "initial-state.json");
  addManifestEntry(entries, buildResult.resourceBundle, "resource-bundle.json");
  capturedInputs.forEach((entry, index) => {
    const artifact = entry.artifact || entry;
    const capturePath = entry.path || buildCapturedInputPath("llm", index, artifact?.meta?.id);
    addManifestEntry(entries, artifact, capturePath);
  });

  entries.sort((a, b) => {
    if (a.schema === b.schema) {
      return a.id.localeCompare(b.id);
    }
    return a.schema.localeCompare(b.schema);
  });

  return entries;
}

export function createCommandKernel(host = {}) {
  const readJson = requireHostFunction(host, "readJson");
  const readText = requireHostFunction(host, "readText");
  const writeJson = requireHostFunction(host, "writeJson");
  const resolvePath = requireHostFunction(host, "resolvePath");
  const join = requireHostFunction(host, "join");
  const dirname = requireHostFunction(host, "dirname");
  const exists = requireHostFunction(host, "exists");
  const makeId = requireHostFunction(host, "makeId");
  const createMeta = requireHostFunction(host, "createMeta");
  const toRef = requireHostFunction(host, "toRef");
  const defaultBuildOutDir = requireHostFunction(host, "defaultBuildOutDir");
  const defaultRunCommandOutDir = requireHostFunction(host, "defaultRunCommandOutDir");
  const defaultLlmPlanOutDir = requireHostFunction(host, "defaultLlmPlanOutDir");
  const allowNetworkRequests = requireHostFunction(host, "allowNetworkRequests");
  const isLlmLiveEnabled = requireHostFunction(host, "isLlmLiveEnabled");
  const isLlmStrictEnabled = requireHostFunction(host, "isLlmStrictEnabled");
  const isLlmBudgetLoopEnabled = requireHostFunction(host, "isLlmBudgetLoopEnabled");
  const isLocalBaseUrl = requireHostFunction(host, "isLocalBaseUrl");
  const createSolverAdapter = requireHostFunction(host, "createSolverAdapter");
  const createLlmAdapter = requireHostFunction(host, "createLlmAdapter");
  const nowIso = requireHostFunction(host, "nowIso");

  const log = typeof host.log === "function" ? host.log : () => {};
  const warn = typeof host.warn === "function" ? host.warn : () => {};
  const cwd = typeof host.cwd === "function" ? host.cwd : () => ".";

  async function solve(args) {
    const runId = args["run-id"] || makeId("run");
    const scenario = args.scenario || null;
    const scenarioFilePath = resolvePath(args["scenario-file"]);
    const planPath = resolvePath(args.plan);
    const intentPath = resolvePath(args.intent);
    const optionsPath = resolvePath(args.options);
    const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("solve", runId);
    const solverFixturePath = resolvePath(args["solver-fixture"]);

    let scenarioData = scenario;
    if (!scenarioData && scenarioFilePath) {
      scenarioData = await readText(scenarioFilePath);
    }
    if (!scenarioData && !planPath && !intentPath) {
      throw new Error("solve requires --scenario, --scenario-file, --plan, or --intent.");
    }

    let planArtifact = null;
    let intentArtifact = null;
    if (planPath) {
      planArtifact = await readJson(planPath);
      assertSchema(planArtifact, SCHEMAS.plan);
    }
    if (intentPath) {
      intentArtifact = await readJson(intentPath);
      assertSchema(intentArtifact, SCHEMAS.intent);
    }

    let options = null;
    if (optionsPath) {
      options = await readJson(optionsPath);
    }

    const solverRequest = {
      schema: SCHEMAS.solverRequest,
      schemaVersion: 1,
      meta: createMeta({ producedBy: "cli-solve", runId }),
      intentRef: toRef(intentArtifact),
      planRef: toRef(planArtifact),
      problem: {
        language: "custom",
        data: scenarioData || { planRef: toRef(planArtifact) },
      },
      options: options || undefined,
    };

    const solverAdapter = await createSolverAdapter({ fixturePath: solverFixturePath });
    const solverResult = await solverAdapter.solve(solverRequest);
    if (!solverResult.meta) {
      solverResult.meta = createMeta({ producedBy: "cli-solve", runId });
    }
    solverResult.schema = solverResult.schema || SCHEMAS.solverResult;
    solverResult.schemaVersion = solverResult.schemaVersion || 1;
    solverResult.requestRef = solverResult.requestRef || toRef(solverRequest);

    await writeJson(join(outDir, "solver-request.json"), solverRequest);
    await writeJson(join(outDir, "solver-result.json"), solverResult);

    log(`solve: wrote ${outDir}`);
    return { outDir, solverRequest, solverResult };
  }

  async function build(args) {
    if (typeof args.spec !== "string") {
      throw new Error("build requires --spec <path>.");
    }
    if (args["out-dir"] !== undefined && typeof args["out-dir"] !== "string") {
      throw new Error("build requires --out-dir <path> when provided.");
    }

    const specPath = resolvePath(args.spec);
    if (!specPath) {
      throw new Error("build requires --spec <path>.");
    }

    let spec = null;
    let outDir = null;
    let result = null;
    let manifestEntries = [];
    let capturedInputs = [];
    const producedBy = "cli-build";
    const baseDir = dirname(specPath);

    try {
      spec = await readJson(specPath);
      outDir = resolvePath(args["out-dir"]) || defaultBuildOutDir(spec);

      let solver = null;
      const solverSpec = spec.plan?.hints?.solver ?? spec.intent?.hints?.solver;
      if (solverSpec !== undefined) {
        if (!solverSpec || typeof solverSpec !== "object" || Array.isArray(solverSpec)) {
          throw new Error("build requires solver hints as an object when provided.");
        }
        const fixturePath = resolvePath(solverSpec.fixture || solverSpec.fixturePath, baseDir);
        if (!fixturePath) {
          throw new Error("build requires solver fixture path (solver.fixture).");
        }
        const scenarioFile = resolvePath(solverSpec.scenarioFile, baseDir);
        const optionsPath = resolvePath(solverSpec.optionsPath, baseDir);
        let scenarioData = solverSpec.scenario;
        if (scenarioData === undefined && scenarioFile) {
          scenarioData = await readText(scenarioFile);
        }
        let options = solverSpec.options;
        if (options === undefined && optionsPath) {
          options = await readJson(optionsPath);
        }

        const solverAdapter = await createSolverAdapter({ fixturePath });
        solver = {
          adapter: solverAdapter,
          scenario: scenarioData,
          options,
          clock: () => spec.meta.createdAt,
        };
      }

      result = await orchestrateBuild({ spec, producedBy, solver });
      const mixedRoomAssemblies = summarizeMixedRoomAssemblies(result?.simConfig?.layout?.data?.rooms);
      if (result?.affinitySummary && typeof result.affinitySummary === "object") {
        result.affinitySummary = {
          ...result.affinitySummary,
          mixedRoomAssemblies,
        };
      }

      await writeJson(join(outDir, "spec.json"), result.spec);
      await writeJson(join(outDir, "intent.json"), result.intent);
      await writeJson(join(outDir, "plan.json"), result.plan);

      if (result.budget?.budget) {
        await writeJson(join(outDir, "budget.json"), result.budget.budget);
      }
      if (result.budget?.priceList) {
        await writeJson(join(outDir, "price-list.json"), result.budget.priceList);
      }
      if (result.budgetReceipt) {
        await writeJson(join(outDir, "budget-receipt.json"), result.budgetReceipt);
      }
      if (result.solverRequest) {
        await writeJson(join(outDir, "solver-request.json"), result.solverRequest);
      }
      if (result.solverResult) {
        await writeJson(join(outDir, "solver-result.json"), result.solverResult);
      }
      if (result.simConfig) {
        await writeJson(join(outDir, "sim-config.json"), result.simConfig);
      }
      if (result.initialState) {
        await writeJson(join(outDir, "initial-state.json"), result.initialState);
      }
      if (result.resourceBundle) {
        await writeJson(join(outDir, "resource-bundle.json"), result.resourceBundle);
      }

      const captures = Array.isArray(spec.adapters?.capture) ? spec.adapters.capture : [];
      if (captures.length > 0) {
        const allowNetwork = allowNetworkRequests();
        for (let i = 0; i < captures.length; i += 1) {
          const captured = await captureAdapterPayload({
            capture: captures[i],
            index: i,
            baseDir,
            spec,
            producedBy,
            allowNetwork,
            host,
          });
          await writeJson(join(outDir, captured.path), captured.artifact);
          capturedInputs.push(captured);
        }
      }

      const bundleArtifacts = buildBuildArtifacts(result, { capturedInputs });
      manifestEntries = buildBuildManifestEntries(result, { capturedInputs });

      const schemaEntries = filterSchemaCatalogEntries({
        schemaRefs: [
          { schema: spec.schema, schemaVersion: spec.schemaVersion },
          ...manifestEntries,
        ],
      });

      const bundle = {
        spec: result.spec,
        schemas: schemaEntries,
        artifacts: bundleArtifacts,
      };

      await writeJson(join(outDir, "bundle.json"), bundle);

      const manifest = {
        specPath: "spec.json",
        correlation: {
          runId: spec.meta.runId,
          source: spec.meta.source,
          correlationId: spec.meta.correlationId,
        },
        schemas: schemaEntries,
        artifacts: manifestEntries,
      };

      if (!manifest.correlation.correlationId) {
        delete manifest.correlation.correlationId;
      }

      await writeJson(join(outDir, "manifest.json"), manifest);

      const artifactRefs = buildArtifactRefs(manifestEntries);
      const telemetry = buildBuildTelemetryRecord({
        spec,
        status: "success",
        artifactRefs,
        producedBy,
        clock: () => spec.meta.createdAt,
      });
      await writeJson(join(outDir, "telemetry.json"), telemetry);

      log(`build: wrote ${outDir}`);
      formatMixedRoomAssembliesCliLines(mixedRoomAssemblies).forEach((line) => {
        log(line);
      });
      return { outDir };
    } catch (error) {
      const message = error?.message || String(error);
      const runId = spec?.meta?.runId || "run_unknown";
      outDir = outDir || defaultRunCommandOutDir("build", runId);
      let artifactRefs = buildArtifactRefs(manifestEntries);
      if (artifactRefs.length === 0 && result) {
        const fallbackEntries = buildBuildManifestEntries(result, { capturedInputs });
        artifactRefs = buildArtifactRefs(fallbackEntries);
      }
      const telemetry = buildBuildTelemetryRecord({
        spec,
        status: "error",
        errors: [message],
        artifactRefs,
        producedBy,
        clock: () => spec?.meta?.createdAt || "1970-01-01T00:00:00.000Z",
      });
      await writeJson(join(outDir, "telemetry.json"), telemetry);
      throw error;
    }
  }

  async function run(args) {
    const loadCore = requireHostFunction(host, "loadCore");
    const defaultWasmPath = typeof host.defaultWasmPath === "function" ? host.defaultWasmPath() : "build/core-as.wasm";
    const simConfigPath = resolvePath(args["sim-config"]);
    const initialStatePath = resolvePath(args["initial-state"]);
    const executionPolicyPath = resolvePath(args["execution-policy"]);
    const actionsPath = resolvePath(args.actions);
    const affinityPresetsPath = resolvePath(args["affinity-presets"]);
    const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
    const affinitySummaryArg = args["affinity-summary"];
    const wasmPath = resolvePath(args.wasm || defaultWasmPath);
    const ticks = args.ticks !== undefined ? Number(args.ticks) : 1;
    const seed = args.seed !== undefined ? Number(args.seed) : 0;

    if (!simConfigPath || !initialStatePath) {
      throw new Error("run requires --sim-config and --initial-state.");
    }
    if (!Number.isFinite(ticks) || ticks < 0) {
      throw new Error("run requires a valid --ticks value.");
    }
    if (!Number.isFinite(seed)) {
      throw new Error("run requires a valid --seed value.");
    }
    if (!wasmPath) {
      throw new Error("run requires a valid --wasm value.");
    }

    const simConfig = await readJson(simConfigPath);
    assertSchema(simConfig, SCHEMAS.simConfig);
    const initialState = await readJson(initialStatePath);
    assertSchema(initialState, SCHEMAS.initialState);
    const runId = args["run-id"]
      || simConfig?.meta?.runId
      || initialState?.meta?.runId
      || makeId("run");
    const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("run", runId);

    if (executionPolicyPath) {
      const executionPolicy = await readJson(executionPolicyPath);
      assertSchema(executionPolicy, SCHEMAS.executionPolicy);
    }

    let affinityPresets = null;
    let affinityLoadouts = null;
    const wantsAffinitySummary = affinitySummaryArg !== undefined || (affinityPresetsPath && affinityLoadoutsPath);
    if (wantsAffinitySummary && (!affinityPresetsPath || !affinityLoadoutsPath)) {
      throw new Error("Affinity summary requires --affinity-presets and --affinity-loadouts.");
    }
    if (affinityPresetsPath) {
      affinityPresets = await readJson(affinityPresetsPath);
      assertSchema(affinityPresets, SCHEMAS.affinityPreset);
    }
    if (affinityLoadoutsPath) {
      affinityLoadouts = await readJson(affinityLoadoutsPath);
      assertSchema(affinityLoadouts, SCHEMAS.actorLoadout);
    }

    let actionLog = null;
    if (actionsPath) {
      actionLog = await readJson(actionsPath);
      if (!Array.isArray(actionLog.actions)) {
        throw new Error("actions file must include an actions array.");
      }
      actionLog.schema = actionLog.schema || "agent-kernel/ActionSequence";
      actionLog.schemaVersion = actionLog.schemaVersion || 1;
      actionLog.meta = actionLog.meta || createMeta({ producedBy: "cli-run", runId });
      actionLog.simConfigRef = actionLog.simConfigRef || toRef(simConfig);
      actionLog.initialStateRef = actionLog.initialStateRef || toRef(initialState);
    } else {
      actionLog = {
        schema: "agent-kernel/ActionSequence",
        schemaVersion: 1,
        meta: createMeta({ producedBy: "cli-run", runId }),
        simConfigRef: toRef(simConfig),
        initialStateRef: toRef(initialState),
        actions: [],
      };
    }

    const actorSpecs = normalizeArgList(args.actor);
    const vitalSpecs = normalizeArgList(args.vital);
    const vitalDefaultSpecs = normalizeArgList(args["vital-default"]);
    const tileWalls = normalizeArgList(args["tile-wall"]);
    const tileBarriers = normalizeArgList(args["tile-barrier"]);
    const tileFloors = normalizeArgList(args["tile-floor"]);
    const vitalDefaults = resolveVitalDefaults(vitalDefaultSpecs);

    const tileOverrideResult = applyTileOverrides(simConfig, {
      walls: tileWalls,
      barriers: tileBarriers,
      floors: tileFloors,
    });
    const actorOverrideResult = applyActorOverrides(initialState, simConfig, {
      actorSpecs,
      vitalSpecs,
      vitalDefaults,
    });
    const overridesApplied = tileOverrideResult.mutated || actorOverrideResult.mutated;

    const affinitySummaryPath = wantsAffinitySummary
      ? (typeof affinitySummaryArg === "string" ? resolvePath(affinitySummaryArg) : join(outDir, "affinity-summary.json"))
      : null;
    let affinitySummary = null;
    if (wantsAffinitySummary) {
      const traps = simConfig?.layout?.data?.traps;
      const resolved = resolveAffinityEffects({
        presets: affinityPresets?.presets,
        loadouts: affinityLoadouts?.loadouts,
        baseVitalsByActorId: baseVitalsFromActors(initialState?.actors),
        traps: Array.isArray(traps) ? traps : [],
      });
      affinitySummary = {
        schema: SCHEMAS.affinitySummary,
        schemaVersion: 1,
        meta: createMeta({ producedBy: "cli-run", runId }),
        presetsRef: toRef(affinityPresets),
        loadoutsRef: toRef(affinityLoadouts),
        simConfigRef: toRef(simConfig),
        initialStateRef: toRef(initialState),
        actors: resolved.actors,
        traps: resolved.traps,
      };
    }

    const clock = createDeterministicClock(resolveClockSeed(simConfig, initialState));
    const core = await loadCore(wasmPath);
    const runtime = createRuntime({ core, adapters: {}, runId, clock });
    await runtime.init({ seed, simConfig, initialState, clock });
    for (let i = 0; i < ticks; i += 1) {
      await runtime.step();
    }

    const tickFrames = runtime.getTickFrames();
    const effectLog = runtime.getEffectLog();
    const runtimeDecisionCaptures = summarizeRuntimeDecisionCaptures(tickFrames).captures;
    const runSummary = {
      schema: SCHEMAS.runSummary,
      schemaVersion: 1,
      meta: createMeta({ producedBy: "cli-run", runId }),
      simConfigRef: toRef(simConfig),
      outcome: "unknown",
      metrics: {
        ticks,
        frames: tickFrames.length,
        effects: effectLog.length,
      },
    };

    await writeJson(join(outDir, "tick-frames.json"), tickFrames);
    await writeJson(join(outDir, "effects-log.json"), effectLog);
    await writeJson(join(outDir, "runtime-decision-captures.json"), runtimeDecisionCaptures);
    await writeJson(join(outDir, "run-summary.json"), runSummary);
    await writeJson(join(outDir, "action-log.json"), actionLog);
    if (affinitySummary && affinitySummaryPath) {
      await writeJson(affinitySummaryPath, affinitySummary);
    }
    if (overridesApplied) {
      await writeJson(join(outDir, "resolved-sim-config.json"), simConfig);
      await writeJson(join(outDir, "resolved-initial-state.json"), initialState);
    }

    log(`run: wrote ${outDir}`);
    return { outDir };
  }

  async function replay(args) {
    const loadCore = requireHostFunction(host, "loadCore");
    const defaultWasmPath = typeof host.defaultWasmPath === "function" ? host.defaultWasmPath() : "build/core-as.wasm";
    const simConfigPath = resolvePath(args["sim-config"]);
    const initialStatePath = resolvePath(args["initial-state"]);
    const executionPolicyPath = resolvePath(args["execution-policy"]);
    const tickFramesPath = resolvePath(args["tick-frames"]);
    const runId = makeId("replay");
    const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("replay", runId);
    const wasmPath = resolvePath(args.wasm || defaultWasmPath);
    const seed = args.seed !== undefined ? Number(args.seed) : 0;

    if (!simConfigPath || !initialStatePath || !tickFramesPath) {
      throw new Error("replay requires --sim-config, --initial-state, and --tick-frames.");
    }
    if (!Number.isFinite(seed)) {
      throw new Error("replay requires a valid --seed value.");
    }
    if (!wasmPath) {
      throw new Error("replay requires a valid --wasm value.");
    }

    const simConfig = await readJson(simConfigPath);
    assertSchema(simConfig, SCHEMAS.simConfig);
    const initialState = await readJson(initialStatePath);
    assertSchema(initialState, SCHEMAS.initialState);
    if (executionPolicyPath) {
      const executionPolicy = await readJson(executionPolicyPath);
      assertSchema(executionPolicy, SCHEMAS.executionPolicy);
    }

    const expectedFrames = await readJson(tickFramesPath);
    const expectedSummaries = expectedFrames.map(summarizeFrame);
    const ticks = args.ticks !== undefined
      ? Number(args.ticks)
      : Math.max(0, ...expectedSummaries.map((frame) => frame.tick));
    if (!Number.isFinite(ticks) || ticks < 0) {
      throw new Error("replay requires a valid --ticks value.");
    }

    const clock = createDeterministicClock(resolveClockSeed(simConfig, initialState));
    const core = await loadCore(wasmPath);
    const runtime = createRuntime({ core, adapters: {}, runId, clock });
    await runtime.init({ seed, simConfig, initialState, clock });
    for (let i = 0; i < ticks; i += 1) {
      await runtime.step();
    }

    const actualFrames = runtime.getTickFrames();
    const actualSummaries = actualFrames.map(summarizeFrame);
    const frameComparison = compareFrameSummaries(expectedSummaries, actualSummaries);
    const runtimeDecisionComparison = compareRuntimeDecisionSummaries(expectedFrames, actualFrames);
    const runtimeDecisionCaptureComparison = compareRuntimeDecisionCaptureSummaries(expectedFrames, actualFrames);

    const summary = {
      match: frameComparison.match && runtimeDecisionComparison.match && runtimeDecisionCaptureComparison.match,
      expectedFrames: frameComparison.expectedFrames,
      actualFrames: frameComparison.actualFrames,
      mismatches: frameComparison.mismatches,
      firstMismatch: frameComparison.firstMismatch,
      runtimeDecisions: runtimeDecisionComparison,
      runtimeDecisionCaptures: runtimeDecisionCaptureComparison,
    };

    await writeJson(join(outDir, "replay-summary.json"), summary);
    await writeJson(join(outDir, "replay-tick-frames.json"), actualFrames);

    log(`replay: wrote ${outDir}`);
    return { outDir };
  }

  async function inspect(args) {
    const tickFramesPath = resolvePath(args["tick-frames"]);
    const effectsLogPath = resolvePath(args["effects-log"]);
    const outDirOverride = resolvePath(args["out-dir"]);

    let frames = [];
    const warnings = [];
    if (!tickFramesPath || !exists(tickFramesPath)) {
      warnings.push("missing_tick_frames");
      warn("inspect: missing --tick-frames (summary will be empty)");
    } else {
      frames = await readJson(tickFramesPath);
    }

    const phaseCounts = {};
    let totalEmitted = 0;
    let fulfilled = 0;
    let deferred = 0;
    let maxTick = 0;

    for (const frame of frames) {
      maxTick = Math.max(maxTick, frame.tick || 0);
      const phaseKey = frame.phaseDetail || frame.phase || "unknown";
      phaseCounts[phaseKey] = (phaseCounts[phaseKey] || 0) + 1;
      if (Array.isArray(frame.emittedEffects)) {
        totalEmitted += frame.emittedEffects.length;
      }
      if (Array.isArray(frame.fulfilledEffects)) {
        for (const record of frame.fulfilledEffects) {
          if (record.status === "fulfilled") {
            fulfilled += 1;
          } else if (record.status === "deferred") {
            deferred += 1;
          }
        }
      }
    }

    const runId = frames[0]?.meta?.runId || makeId("run");
    const outDir = outDirOverride || defaultRunCommandOutDir("inspect", runId);
    const effectsLog = effectsLogPath ? await readJson(effectsLogPath) : null;
    const summary = {
      schema: SCHEMAS.telemetry,
      schemaVersion: 1,
      meta: createMeta({ producedBy: "cli-inspect", runId }),
      scope: "run",
      data: {
        frames: frames.length,
        ticks: maxTick,
        phaseCounts,
        effects: {
          emitted: totalEmitted,
          fulfilled,
          deferred,
          logEntries: Array.isArray(effectsLog) ? effectsLog.length : 0,
        },
        runtimeDecisions: summarizeRuntimeDecisions(frames),
        runtimeDecisionCaptures: summarizeRuntimeDecisionCaptures(frames),
        warnings,
      },
    };

    await writeJson(join(outDir, "inspect-summary.json"), summary);
    log(`inspect: wrote ${outDir}`);
    return { outDir };
  }

  async function configurator(args) {
    const runId = args["run-id"] || makeId("run");
    const levelGenPath = resolvePath(args["level-gen"]);
    const actorsPath = resolvePath(args.actors);
    const planPath = resolvePath(args.plan);
    const budgetReceiptPath = resolvePath(args["budget-receipt"]);
    const budgetPath = resolvePath(args.budget);
    const priceListPath = resolvePath(args["price-list"]);
    const receiptOutPath = resolvePath(args["receipt-out"]);
    const affinityPresetsPath = resolvePath(args["affinity-presets"]);
    const affinityLoadoutsPath = resolvePath(args["affinity-loadouts"]);
    const outDir = resolvePath(args["out-dir"]) || defaultRunCommandOutDir("configurator", runId);

    if (!levelGenPath || !actorsPath) {
      throw new Error("configurator requires --level-gen and --actors.");
    }
    if ((affinityPresetsPath && !affinityLoadoutsPath) || (!affinityPresetsPath && affinityLoadoutsPath)) {
      throw new Error("configurator requires both --affinity-presets and --affinity-loadouts.");
    }
    if ((budgetPath && !priceListPath) || (!budgetPath && priceListPath)) {
      throw new Error("configurator requires both --budget and --price-list.");
    }
    if (budgetReceiptPath && (budgetPath || priceListPath)) {
      throw new Error("configurator accepts either --budget-receipt or --budget/--price-list, not both.");
    }
    if (receiptOutPath && !(budgetPath && priceListPath)) {
      throw new Error("configurator requires --budget and --price-list when using --receipt-out.");
    }

    const levelGenInput = await readJson(levelGenPath);
    const layoutResult = generateGridLayoutFromInput(levelGenInput);
    if (!layoutResult.ok) {
      const details = layoutResult.errors.map((err) => `${err.field}:${err.code}`).join(", ");
      throw new Error(`level-gen input invalid: ${details}`);
    }
    const actorsInput = await readJson(actorsPath);
    if (!actorsInput || !Array.isArray(actorsInput.actors)) {
      throw new Error("actors file must include an actors array.");
    }

    let plan = null;
    let budgetReceipt = null;
    let budget = null;
    let priceList = null;
    if (planPath) {
      plan = await readJson(planPath);
      assertSchema(plan, SCHEMAS.plan);
    }
    if (budgetReceiptPath) {
      budgetReceipt = await readJson(budgetReceiptPath);
      assertSchema(budgetReceipt, SCHEMAS.budgetReceipt);
    }
    if (budgetPath) {
      budget = await readJson(budgetPath);
      assertSchema(budget, SCHEMAS.budgetArtifact);
    }
    if (priceListPath) {
      priceList = await readJson(priceListPath);
      assertSchema(priceList, SCHEMAS.priceList);
    }

    let affinityPresets = null;
    let affinityLoadouts = null;
    if (affinityPresetsPath) {
      affinityPresets = await readJson(affinityPresetsPath);
      assertSchema(affinityPresets, "agent-kernel/AffinityPresetArtifact");
    }
    if (affinityLoadoutsPath) {
      affinityLoadouts = await readJson(affinityLoadoutsPath);
      assertSchema(affinityLoadouts, "agent-kernel/ActorLoadoutArtifact");
    }

    const layout = layoutResult.value;
    const baseVitalsByActorId = baseVitalsFromActors(actorsInput.actors);
    const resolvedEffects = (affinityPresets && affinityLoadouts)
      ? resolveAffinityEffects({
        presets: affinityPresets.presets,
        loadouts: affinityLoadouts.loadouts,
        baseVitalsByActorId,
        traps: Array.isArray(layout.traps) ? layout.traps : [],
      })
      : {};
    const seed = Number.isFinite(levelGenInput.seed) ? levelGenInput.seed : 0;

    if (budget && priceList) {
      const spendResult = evaluateConfiguratorSpend({
        budget,
        priceList,
        layout,
        actors: actorsInput.actors,
        proposalMeta: createMeta({ producedBy: "cli-configurator", runId }),
        receiptMeta: createMeta({ producedBy: "cli-configurator", runId }),
      });
      budgetReceipt = spendResult.receipt;
    }

    const simConfig = buildSimConfigArtifact({
      meta: createMeta({ producedBy: "cli-configurator", runId }),
      planRef: plan ? toRef(plan) : undefined,
      budgetReceiptRef: budgetReceipt ? toRef(budgetReceipt) : undefined,
      seed,
      layout,
    });
    const initialState = buildInitialStateArtifact({
      meta: createMeta({ producedBy: "cli-configurator", runId }),
      simConfigRef: toRef(simConfig),
      actors: actorsInput.actors,
      resolvedEffects,
    });

    await writeJson(join(outDir, "sim-config.json"), simConfig);
    await writeJson(join(outDir, "initial-state.json"), initialState);
    if (budget && priceList && budgetReceipt) {
      const receiptPath = join(outDir, "budget-receipt.json");
      await writeJson(receiptPath, budgetReceipt);
      if (receiptOutPath) {
        await writeJson(receiptOutPath, budgetReceipt);
      }
    }

    log(`configurator: wrote ${outDir}`);
    return { outDir };
  }

  async function budget(args) {
    const budgetPath = resolvePath(args.budget);
    const priceListPath = resolvePath(args["price-list"]);
    const receiptPath = resolvePath(args.receipt);
    const receiptOutPath = resolvePath(args["receipt-out"]);
    const outDir = resolvePath(args["out-dir"]);
    const outPath = resolvePath(args.out);

    if (!budgetPath && !priceListPath && !receiptPath) {
      throw new Error("budget requires at least one of --budget, --price-list, or --receipt.");
    }

    let budgetArtifact = null;
    let priceList = null;
    let receipt = null;

    if (budgetPath) {
      budgetArtifact = await readJson(budgetPath);
      assertSchema(budgetArtifact, SCHEMAS.budgetArtifact);
    }
    if (priceListPath) {
      priceList = await readJson(priceListPath);
      assertSchema(priceList, SCHEMAS.priceList);
    }
    if (receiptPath) {
      receipt = await readJson(receiptPath);
      assertSchema(receipt, SCHEMAS.budgetReceiptArtifact);
    }

    if (outDir) {
      if (budgetArtifact) await writeJson(join(outDir, "budget.json"), budgetArtifact);
      if (priceList) await writeJson(join(outDir, "price-list.json"), priceList);
      if (receipt) await writeJson(join(outDir, "budget-receipt.json"), receipt);
    }
    if (receiptOutPath && receipt) {
      await writeJson(receiptOutPath, receipt);
    }

    const output = {};
    if (budgetArtifact) output.budget = budgetArtifact;
    if (priceList) output.priceList = priceList;
    if (receipt) output.receipt = receipt;

    if (outPath) {
      await writeJson(outPath, output);
    } else {
      log(JSON.stringify(output, null, 2));
    }

    return { outDir, outPath, output };
  }

  async function ipfs(args) {
    const createIpfsAdapter = requireHostFunction(host, "createIpfsAdapter");
    const cid = args.cid;
    const pathValue = args.path || "";
    const gatewayUrl = args.gateway || "https://ipfs.io/ipfs";
    const fixturePath = resolvePath(args.fixture, cwd());

    if (!isNonEmptyString(cid)) {
      throw new Error("ipfs requires --cid.");
    }

    let fetchFn;
    if (fixturePath) {
      const fixtureText = await readText(fixturePath);
      fetchFn = async () => ({ ok: true, text: async () => fixtureText });
    }

    const adapter = createIpfsAdapter({ gatewayUrl, fetchFn });
    if (args.json) {
      const output = await adapter.fetchJson(cid, pathValue);
      return { output, contentType: "application/json" };
    }
    const output = await adapter.fetchText(cid, pathValue);
    return { output, contentType: "text/plain" };
  }

  async function ipfsPublish(args) {
    const createIpfsAdapter = requireHostFunction(host, "createIpfsAdapter");
    const gatewayUrl = args.gateway || "https://ipfs.io/ipfs";
    const rootPath = isNonEmptyString(args.path) ? args.path.trim().replace(/^\/+|\/+$/g, "") : "";
    const fixtureCid = isNonEmptyString(args["fixture-cid"]) ? args["fixture-cid"].trim() : "";
    const artifactMap = isObject(args["artifact-map"]) ? args["artifact-map"] : null;

    if (!artifactMap) {
      throw new Error("ipfs-publish requires --artifact-map.");
    }
    const entries = Object.entries(artifactMap)
      .filter(([fileName, value]) => isNonEmptyString(fileName) && value !== undefined);
    if (entries.length === 0) {
      throw new Error("ipfs-publish requires at least one artifact.");
    }

    if (fixtureCid) {
      return {
        cid: fixtureCid,
        rootPath: rootPath || "",
        published: Object.fromEntries(entries),
        publishedFiles: entries.map(([fileName]) => String(fileName).replace(/^\/+/, "")),
        mode: "fixture",
      };
    }

    const adapter = createIpfsAdapter({ gatewayUrl });
    if (!adapter || typeof adapter.publishJsonMap !== "function") {
      throw new Error("ipfs-publish requires an adapter with publishJsonMap support.");
    }

    const published = Object.fromEntries(entries.map(([fileName, value]) => [
      String(fileName).replace(/^\/+/, ""),
      value,
    ]));
    const publishResult = await adapter.publishJsonMap(published, { pathPrefix: rootPath || "" });
    return {
      cid: publishResult.cid,
      rootPath: rootPath || "",
      published,
      publishedFiles: Object.keys(published),
      mode: "live",
      entries: Array.isArray(publishResult.entries) ? publishResult.entries : [],
      rootName: publishResult.rootName || "",
    };
  }

  async function ipfsLoad(args) {
    const createIpfsAdapter = requireHostFunction(host, "createIpfsAdapter");
    const cid = args.cid;
    const rootPath = isNonEmptyString(args.path) ? args.path.trim().replace(/^\/+|\/+$/g, "") : "";
    const gatewayUrl = args.gateway || "https://ipfs.io/ipfs";
    const files = normalizeStringList(args.file);
    const targetFiles = files.length > 0
      ? files
      : [
        "bundle.json",
        "manifest.json",
        "spec.json",
        "sim-config.json",
        "initial-state.json",
        "budget.json",
        "price-list.json",
        "budget-receipt.json",
      ];
    const fixtureMap = isObject(args["fixture-map"]) ? args["fixture-map"] : null;

    if (!isNonEmptyString(cid)) {
      throw new Error("ipfs-load requires --cid.");
    }

    let fetchFn;
    if (fixtureMap) {
      fetchFn = async (resource) => {
        const url = String(resource || "");
        const cidToken = `${cid}/`;
        const marker = url.lastIndexOf(cidToken);
        const suffix = marker >= 0 ? url.slice(marker + cidToken.length) : "";
        const normalized = suffix.replace(/^\/+/, "");
        const value = fixtureMap[normalized];
        if (value === undefined) {
          return { ok: false, status: 404, statusText: "Not Found" };
        }
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return { ok: true, text: async () => text };
      };
    }

    const adapter = createIpfsAdapter({ gatewayUrl, fetchFn });
    const fetched = {};
    const missing = [];

    for (const fileName of targetFiles) {
      const normalizedFile = fileName.replace(/^\/+/, "");
      const ipfsPath = rootPath ? `${rootPath}/${normalizedFile}` : normalizedFile;
      try {
        fetched[normalizedFile] = await adapter.fetchJson(cid, ipfsPath);
      } catch (error) {
        missing.push({
          file: normalizedFile,
          error: error?.message || String(error),
        });
      }
    }

    if (!fetched["bundle.json"]) {
      throw new Error("ipfs-load could not fetch required bundle.json.");
    }

    return {
      cid,
      rootPath: rootPath || "",
      fetched,
      missing,
    };
  }

  async function resolveJsonFixture(value) {
    if (isObject(value) || Array.isArray(value)) {
      return value;
    }
    const fixturePath = resolvePath(value, cwd());
    if (!fixturePath) return null;
    return JSON.parse(await readText(fixturePath));
  }

  async function blockchain(args) {
    const createBlockchainAdapter = requireHostFunction(host, "createBlockchainAdapter");
    const rpcUrl = args["rpc-url"];
    const address = args.address;
    const chainFixture = await resolveJsonFixture(args["fixture-chain-id"]);
    const balanceFixture = await resolveJsonFixture(args["fixture-balance"]);

    if (!isNonEmptyString(rpcUrl)) {
      throw new Error("blockchain requires --rpc-url.");
    }

    let fetchFn;
    if (chainFixture || balanceFixture) {
      fetchFn = async (_url, options) => {
        const body = JSON.parse(options?.body || "{}");
        if (body.method === "eth_chainId" && chainFixture) {
          return { ok: true, json: async () => chainFixture };
        }
        if (body.method === "eth_getBalance" && balanceFixture) {
          return { ok: true, json: async () => balanceFixture };
        }
        return { ok: false, status: 500, statusText: "Missing fixture" };
      };
    }

    const adapter = createBlockchainAdapter({ rpcUrl, fetchFn });
    const output = { rpcUrl };
    output.chainId = await adapter.getChainId();
    if (address) {
      output.address = address;
      output.balance = await adapter.getBalance(address);
    }
    return { output, contentType: "application/json" };
  }

  async function blockchainMint(args) {
    const createBlockchainAdapter = requireHostFunction(host, "createBlockchainAdapter");
    const rpcUrl = args["rpc-url"];
    const owner = args.owner;
    const contractAddress = args.contract || args["contract-address"];
    const tokenIdHint = args["token-id"];
    const cardJson = isObject(args["card-json"]) ? args["card-json"] : null;
    const cardPath = resolvePath(args.card, cwd());
    const chainFixture = await resolveJsonFixture(args["fixture-chain-id"]);
    const mintFixture = await resolveJsonFixture(args["fixture-mint"]);

    if (!isNonEmptyString(rpcUrl)) {
      throw new Error("blockchain-mint requires --rpc-url.");
    }
    if (!cardJson && !cardPath) {
      throw new Error("blockchain-mint requires --card.");
    }

    const card = cardJson || await readJson(cardPath);
    const metadata = {
      schema: card?.schema || null,
      schemaVersion: Number.isFinite(card?.schemaVersion) ? card.schemaVersion : null,
      cardType: isNonEmptyString(card?.type) ? card.type : null,
      cardId: isNonEmptyString(card?.id) ? card.id : null,
    };

    let fetchFn;
    if (chainFixture || mintFixture) {
      fetchFn = async (_url, options) => {
        const body = JSON.parse(options?.body || "{}");
        if (body.method === "eth_chainId" && chainFixture) {
          return { ok: true, json: async () => chainFixture };
        }
        if (body.method === "ak_mintCard" && mintFixture) {
          return { ok: true, json: async () => mintFixture };
        }
        return { ok: false, status: 500, statusText: "Missing fixture" };
      };
    }

    const adapter = createBlockchainAdapter({ rpcUrl, fetchFn });
    const output = { rpcUrl };
    output.chainId = await adapter.getChainId();
    if (isNonEmptyString(owner)) output.owner = owner;
    if (isNonEmptyString(contractAddress)) output.contractAddress = contractAddress;
    output.card = card;
    const mintResult = await adapter.mintCard({
      owner,
      contractAddress,
      tokenId: tokenIdHint,
      card,
      metadata,
    });
    const tokenId = isNonEmptyString(mintResult?.tokenId)
      ? mintResult.tokenId
      : isNonEmptyString(tokenIdHint)
        ? tokenIdHint
        : makeId("token");
    output.tokenId = tokenId;
    if (isNonEmptyString(mintResult?.txHash)) output.txHash = mintResult.txHash;
    if (isObject(mintResult?.metadata)) output.metadata = mintResult.metadata;
    return { output, contentType: "application/json" };
  }

  async function blockchainLoad(args) {
    const createBlockchainAdapter = requireHostFunction(host, "createBlockchainAdapter");
    const rpcUrl = args["rpc-url"];
    const tokenId = args["token-id"];
    const owner = args.owner;
    const contractAddress = args.contract || args["contract-address"];
    const chainFixture = await resolveJsonFixture(args["fixture-chain-id"]);
    const loadFixture = await resolveJsonFixture(args["fixture-load"]);

    if (!isNonEmptyString(rpcUrl)) {
      throw new Error("blockchain-load requires --rpc-url.");
    }
    if (!isNonEmptyString(tokenId)) {
      throw new Error("blockchain-load requires --token-id.");
    }

    let fetchFn;
    if (chainFixture || loadFixture) {
      fetchFn = async (_url, options) => {
        const body = JSON.parse(options?.body || "{}");
        if (body.method === "eth_chainId" && chainFixture) {
          return { ok: true, json: async () => chainFixture };
        }
        if (body.method === "ak_getMintedCard" && loadFixture) {
          return { ok: true, json: async () => loadFixture };
        }
        return { ok: false, status: 500, statusText: "Missing fixture" };
      };
    }

    const adapter = createBlockchainAdapter({ rpcUrl, fetchFn });
    const output = { rpcUrl, tokenId };
    output.chainId = await adapter.getChainId();
    if (isNonEmptyString(owner)) output.owner = owner;
    if (isNonEmptyString(contractAddress)) output.contractAddress = contractAddress;
    const loaded = await adapter.loadMintedCard({ tokenId, owner, contractAddress });
    if (isObject(loaded)) {
      if (loaded.card !== undefined) output.card = loaded.card;
      if (loaded.owner !== undefined && output.owner === undefined) output.owner = loaded.owner;
      if (loaded.contractAddress !== undefined && output.contractAddress === undefined) {
        output.contractAddress = loaded.contractAddress;
      }
      if (loaded.metadata !== undefined) output.metadata = loaded.metadata;
      if (loaded.txHash !== undefined) output.txHash = loaded.txHash;
    } else {
      output.card = loaded;
    }
    return { output, contentType: "application/json" };
  }

  async function llm(args) {
    const model = args.model || readEnv(host.env, "AK_LLM_MODEL") || DEFAULT_LLM_MODEL;
    const prompt = args.prompt;
    const baseUrl = args["base-url"] || readEnv(host.env, "AK_LLM_BASE_URL") || DEFAULT_LLM_BASE_URL;
    const fixturePath = resolvePath(args.fixture, cwd());
    const llmFormat = readEnv(host.env, "AK_LLM_FORMAT");

    if (!isNonEmptyString(prompt)) {
      throw new Error("llm requires --prompt.");
    }

    let fetchFn;
    if (fixturePath) {
      const fixtureJson = JSON.parse(await readText(fixturePath));
      fetchFn = async () => ({ ok: true, json: async () => fixtureJson });
    }

    const adapter = createLlmAdapter({ baseUrl, fetchFn });
    const output = await adapter.generate({
      model,
      prompt,
      stream: false,
      format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
    });
    return { output, contentType: "application/json" };
  }

  async function llmPlan(args) {
    const scenarioPath = resolvePath(args.scenario);
    const textRaw = args.text;
    const promptRaw = args.prompt;
    const catalogOverride = resolvePath(args.catalog);
    const goalOverride = args.goal;
    const budgetTokensRaw = args["budget-tokens"];
    const model = args.model || readEnv(host.env, "AK_LLM_MODEL") || DEFAULT_LLM_MODEL;
    const baseUrl = args["base-url"] || readEnv(host.env, "AK_LLM_BASE_URL") || DEFAULT_LLM_BASE_URL;
    const promptInput = isNonEmptyString(promptRaw)
      ? promptRaw
      : isNonEmptyString(textRaw)
        ? textRaw
        : undefined;
    const fixturePath = resolvePath(args.fixture)
      || (!scenarioPath && isNonEmptyString(textRaw)
        ? resolveDefaultLlmFixturePath({ resolvePath, exists, cwd })
        : null);
    const runId = args["run-id"] || makeId("run");
    const createdAt = args["created-at"] || nowIso();
    const outDir = resolvePath(args["out-dir"]) || defaultLlmPlanOutDir(runId);

    if (!scenarioPath && !catalogOverride) {
      throw new Error("llm-plan requires --scenario or --catalog.");
    }
    if (!scenarioPath && !isNonEmptyString(promptInput)) {
      throw new Error("llm-plan requires --text or --prompt when --scenario is omitted.");
    }

    let budgetTokens;
    if (budgetTokensRaw !== undefined) {
      budgetTokens = Number(budgetTokensRaw);
      if (!Number.isFinite(budgetTokens)) {
        throw new Error("llm-plan requires --budget-tokens to be a number.");
      }
    }

    const budgetReserveRaw = args["budget-reserve"];
    let budgetReserveTokens;
    if (budgetReserveRaw !== undefined) {
      budgetReserveTokens = Number(budgetReserveRaw);
      if (!Number.isFinite(budgetReserveTokens) || budgetReserveTokens < 0) {
        throw new Error("llm-plan requires --budget-reserve to be a non-negative number.");
      }
    }

    const budgetPoolRaw = args["budget-pool"];
    const budgetPools = [];
    if (budgetPoolRaw !== undefined) {
      const entries = Array.isArray(budgetPoolRaw) ? budgetPoolRaw : [budgetPoolRaw];
      entries.forEach((entry) => {
        if (typeof entry !== "string" || !entry.includes("=")) {
          throw new Error("llm-plan --budget-pool must be in id=weight form.");
        }
        const [idRaw, weightRaw] = entry.split("=");
        const id = idRaw.trim();
        const weight = Number(weightRaw);
        if (!id) {
          throw new Error("llm-plan --budget-pool requires a non-empty id.");
        }
        if (!Number.isFinite(weight) || weight < 0) {
          throw new Error(`llm-plan --budget-pool weight must be >= 0 for ${id}.`);
        }
        budgetPools.push({ id, weight });
      });
    }

    const scenario = scenarioPath ? await readJson(scenarioPath) : null;
    const scenarioBaseDir = scenarioPath ? dirname(scenarioPath) : cwd();
    const catalogPath = catalogOverride
      || (scenario ? resolveScenarioAssetPath(scenario.catalogPath, scenarioBaseDir, resolvePath, exists) : null);
    if (!catalogPath) {
      if (scenario) {
        throw new Error("llm-plan requires scenario.catalogPath or --catalog.");
      }
      throw new Error("llm-plan requires --catalog when --scenario is omitted.");
    }
    const catalog = await readJson(catalogPath);
    const allowedOptions = deriveAllowedOptionsFromCatalog(catalog);
    const allowedPairs = deriveAllowedPairs(catalog);
    const allowedPairsText = allowedPairs.length > 0 ? formatAllowedPairs(allowedPairs) : "";
    const budgetLoopEnabled = Boolean(args["budget-loop"]) || isLlmBudgetLoopEnabled();

    const goal = isNonEmptyString(goalOverride)
      ? goalOverride
      : scenario?.goal || promptInput || "LLM planning request";
    const resolvedBudgetTokens = budgetTokens !== undefined ? budgetTokens : scenario?.budgetTokens;
    if (!Number.isFinite(resolvedBudgetTokens) || resolvedBudgetTokens <= 0) {
      throw new Error("llm-plan requires --budget-tokens or scenario.budgetTokens > 0.");
    }
    const prompt = injectBudgetTokens(
      promptInput,
      resolvedBudgetTokens,
    );
    const notes = [
      scenario?.notes,
      "Include at least one actor; counts must be > 0.",
      allowedPairsText ? `Allowed profiles (motivation, affinity): ${allowedPairsText}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const basePrompt = isNonEmptyString(prompt)
      ? prompt
      : buildLlmActorConfigPromptTemplate({
        goal,
        notes,
        budgetTokens: resolvedBudgetTokens,
        affinities: allowedOptions.affinities,
        affinityExpressions: ALLOWED_AFFINITY_EXPRESSIONS,
        motivations: allowedOptions.motivations,
      });
    const constraintLines = buildLlmConstraintSection({ allowedPairsText });
    const finalPrompt = appendJsonOnlyInstruction(`${basePrompt}\n\n${constraintLines}`);
    const llmFormat = readEnv(host.env, "AK_LLM_FORMAT");

    const liveEnabled = isLlmLiveEnabled();
    const adapterFlowEnabled = liveEnabled || Boolean(fixturePath);
    let capture = null;
    let captures = [];
    let summary = null;
    let mappedSelections;
    let loopTrace = null;
    let budgetAllocation = null;
    let budgetPoolWeights = null;
    let budgetPoolBudgets = null;
    let budgetPoolPolicy = null;

    if (adapterFlowEnabled) {
      if (!fixturePath && !allowNetworkRequests() && !isLocalBaseUrl(baseUrl)) {
        throw new Error("llm-plan requires --fixture unless AK_ALLOW_NETWORK=1 or base URL is local.");
      }

      let fetchFn;
      if (fixturePath) {
        const fixtureJson = JSON.parse(await readText(fixturePath));
        const responses = Array.isArray(fixtureJson)
          ? fixtureJson
          : Array.isArray(fixtureJson?.responses)
            ? fixtureJson.responses
            : [fixtureJson];
        let fixtureIndex = 0;
        fetchFn = async () => {
          if (responses.length > 1 && fixtureIndex >= responses.length) {
            return { ok: false, status: 500, statusText: "Missing fixture response" };
          }
          const payload = responses[Math.min(fixtureIndex, responses.length - 1)];
          fixtureIndex += 1;
          return { ok: true, json: async () => payload };
        };
      }

      const adapter = createLlmAdapter({ baseUrl, fetchFn });
      const repairPromptBuilder = ({ errors, responseText }) => buildRepairPrompt({
        basePrompt: finalPrompt,
        errors,
        responseText,
        allowedOptions,
        allowedPairsText,
      });
      if (budgetLoopEnabled) {
        const poolPolicy = Number.isFinite(budgetReserveTokens) ? { reserveTokens: budgetReserveTokens } : undefined;
        const loopResult = await runLlmBudgetLoop({
          adapter,
          model,
          baseUrl,
          catalog,
          goal,
          notes,
          budgetTokens: resolvedBudgetTokens,
          poolWeights: budgetPools.length > 0 ? budgetPools : undefined,
          poolPolicy,
          strict: isLlmStrictEnabled(),
          format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
          runId,
          clock: () => createdAt,
          producedBy: "orchestrator",
        });
        captures = loopResult.captures || [];
        loopTrace = loopResult.trace || null;
        budgetAllocation = loopResult.budgetAllocation || null;
        budgetPoolWeights = loopResult.poolWeights || null;
        budgetPoolBudgets = loopResult.poolBudgets || null;
        budgetPoolPolicy = loopResult.poolPolicy || poolPolicy || null;
        if (!loopResult.ok) {
          if (captures.length > 0) {
            for (let i = 0; i < captures.length; i += 1) {
              const artifact = captures[i];
              const capturePath = buildCapturedInputPath("llm", i, artifact?.meta?.id);
              await writeJson(join(outDir, capturePath), artifact);
            }
          }
          throw new Error(`llm-plan budget loop failed: ${JSON.stringify(loopResult.errors || [])}`);
        }
        summary = loopResult.summary;
        mappedSelections = loopResult.selections;
      } else {
        let session = await runLlmSession({
          adapter,
          model,
          baseUrl,
          prompt: isNonEmptyString(finalPrompt) ? finalPrompt : undefined,
          goal,
          budgetTokens: resolvedBudgetTokens,
          strict: isLlmStrictEnabled(),
          repairPromptBuilder,
          requireSummary: { minRooms: 1, minActors: 1 },
          runId,
          clock: () => createdAt,
          producedBy: "orchestrator",
          format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
        });
        if (!session.ok) {
          if (session.capture) {
            const capturePath = buildCapturedInputPath("llm", 0, session.capture.meta?.id);
            await writeJson(join(outDir, capturePath), session.capture);
          }
          throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
        }
        summary = session.summary;
        capture = session.capture;

        let mapped = mapSummaryToPool({ summary, catalog });
        let actorInstances = countInstances(mapped.selections, "actor");
        if (actorInstances === 0) {
          const missingSelections = summarizeMissingSelections(mapped.selections);
          const catalogRepairPrompt = buildLlmCatalogRepairPromptTemplate({
            basePrompt,
            allowedPairsText,
            missingSelections,
          });

          session = await runLlmSession({
            adapter,
            model,
            baseUrl,
            prompt: catalogRepairPrompt,
            goal,
            budgetTokens: resolvedBudgetTokens,
            strict: isLlmStrictEnabled(),
            repairPromptBuilder,
            requireSummary: { minRooms: 1, minActors: 1 },
            runId,
            clock: () => createdAt,
            producedBy: "orchestrator",
            format: isNonEmptyString(llmFormat) ? llmFormat : undefined,
          });

          if (!session.ok) {
            if (session.capture) {
              const capturePath = buildCapturedInputPath("llm", 0, session.capture.meta?.id);
              await writeJson(join(outDir, capturePath), session.capture);
            }
            throw new Error(`llm-plan session failed: ${JSON.stringify(session.errors || [])}`);
          }

          summary = session.summary;
          capture = session.capture;
          mapped = mapSummaryToPool({ summary, catalog });
          actorInstances = countInstances(mapped.selections, "actor");
          if (actorInstances === 0) {
            const finalMissing = summarizeMissingSelections(mapped.selections);
            throw new Error(
              `llm-plan summary did not match catalog entries (actors=${actorInstances}).`
                + (finalMissing ? ` Unmatched picks: ${finalMissing}` : "")
            );
          }
        }

        mappedSelections = mapped.selections;
      }
    } else {
      if (isNonEmptyString(prompt)) {
        throw new Error("llm-plan requires AK_LLM_LIVE=1 when using --prompt.");
      }
      if (!scenario) {
        throw new Error("llm-plan requires AK_LLM_LIVE=1 when --scenario is omitted.");
      }
      const summaryPath = resolveScenarioAssetPath(scenario.summaryPath, scenarioBaseDir, resolvePath, exists);
      if (!summaryPath) {
        throw new Error("llm-plan requires scenario.summaryPath when AK_LLM_LIVE is off.");
      }
      const summaryFixture = await readJson(summaryPath);
      const normalized = normalizeSummary(summaryFixture);
      if (!normalized.ok) {
        throw new Error(`llm-plan summary fixture invalid: ${normalized.errors.map((err) => err.code).join(", ")}`);
      }
      summary = normalized.value;
    }

    let summaryForSpec = summary;
    if (!scenario) {
      summaryForSpec = { ...summary };
      if (isNonEmptyString(goal)) {
        summaryForSpec.goal = goal;
      }
      if (Number.isFinite(resolvedBudgetTokens)) {
        summaryForSpec.budgetTokens = resolvedBudgetTokens;
      }
    }

    const buildSpecResult = buildBuildSpecFromSummary({
      summary: summaryForSpec,
      catalog,
      selections: mappedSelections || undefined,
      runId,
      createdAt,
      source: "cli-llm-plan",
    });
    if (!buildSpecResult.ok) {
      throw new Error(`llm-plan build spec failed: ${buildSpecResult.errors.join("\n")}`);
    }

    const capturedInputsForBuild = captures.length > 0 ? captures : capture ? [capture] : undefined;
    const buildResult = await orchestrateBuild({
      spec: buildSpecResult.spec,
      producedBy: "cli-llm-plan",
      capturedInputs: capturedInputsForBuild,
    });

    await writeJson(join(outDir, "spec.json"), buildResult.spec);
    await writeJson(join(outDir, "intent.json"), buildResult.intent);
    await writeJson(join(outDir, "plan.json"), buildResult.plan);

    if (buildResult.budget?.budget) {
      await writeJson(join(outDir, "budget.json"), buildResult.budget.budget);
    }
    if (buildResult.budget?.priceList) {
      await writeJson(join(outDir, "price-list.json"), buildResult.budget.priceList);
    }
    if (buildResult.budgetReceipt) {
      await writeJson(join(outDir, "budget-receipt.json"), buildResult.budgetReceipt);
    }
    if (budgetAllocation) {
      await writeJson(join(outDir, "budget-allocation.json"), budgetAllocation);
    }
    if (buildResult.solverRequest) {
      await writeJson(join(outDir, "solver-request.json"), buildResult.solverRequest);
    }
    if (buildResult.solverResult) {
      await writeJson(join(outDir, "solver-result.json"), buildResult.solverResult);
    }
    if (buildResult.simConfig) {
      await writeJson(join(outDir, "sim-config.json"), buildResult.simConfig);
    }
    if (buildResult.initialState) {
      await writeJson(join(outDir, "initial-state.json"), buildResult.initialState);
    }
    if (buildResult.resourceBundle) {
      await writeJson(join(outDir, "resource-bundle.json"), buildResult.resourceBundle);
    }

    const capturedInputs = Array.isArray(buildResult.capturedInputs) ? buildResult.capturedInputs : [];
    for (let i = 0; i < capturedInputs.length; i += 1) {
      const artifact = capturedInputs[i];
      const capturePath = buildCapturedInputPath("llm", i, artifact?.meta?.id);
      await writeJson(join(outDir, capturePath), artifact);
    }

    const bundleArtifacts = buildBuildArtifacts(buildResult, {
      includeBudgetAllocation: budgetAllocation,
      capturedInputs,
    });

    const manifestEntries = buildBuildManifestEntries(buildResult, {
      includeBudgetAllocation: budgetAllocation,
      capturedInputs,
    });

    const schemaEntries = filterSchemaCatalogEntries({
      schemaRefs: [
        { schema: buildResult.spec.schema, schemaVersion: buildResult.spec.schemaVersion },
        ...manifestEntries,
      ],
    });

    const bundle = {
      spec: buildResult.spec,
      schemas: schemaEntries,
      artifacts: bundleArtifacts,
    };
    await writeJson(join(outDir, "bundle.json"), bundle);

    const manifest = {
      specPath: "spec.json",
      correlation: {
        runId: buildResult.spec.meta.runId,
        source: buildResult.spec.meta.source,
        correlationId: buildResult.spec.meta.correlationId,
      },
      schemas: schemaEntries,
      artifacts: manifestEntries,
    };
    if (!manifest.correlation.correlationId) {
      delete manifest.correlation.correlationId;
    }
    await writeJson(join(outDir, "manifest.json"), manifest);

    const telemetry = buildBuildTelemetryRecord({
      spec: buildResult.spec,
      status: "success",
      artifactRefs: buildArtifactRefs(manifestEntries),
      producedBy: "cli-llm-plan",
      clock: () => buildResult.spec.meta.createdAt,
      data: loopTrace ? {
        llm: {
          budgetLoop: true,
          trace: loopTrace,
          budgetAllocation: budgetAllocation
            ? {
              pools: budgetAllocation.pools,
              weights: budgetPoolWeights || undefined,
              policy: budgetPoolPolicy || budgetAllocation.policy,
              totals: budgetPoolBudgets || undefined,
            }
            : undefined,
        },
      } : undefined,
    });
    await writeJson(join(outDir, "telemetry.json"), telemetry);

    log(`llm-plan: wrote ${outDir}`);
    return { outDir };
  }

  return {
    solve,
    build,
    run,
    replay,
    inspect,
    configurator,
    budget,
    ipfs,
    ipfsPublish,
    ipfsLoad,
    blockchain,
    blockchainMint,
    blockchainLoad,
    llm,
    llmPlan,
  };
}
