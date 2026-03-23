import { createCommandKernel } from "../../../../runtime/src/commands/kernel.js";
import { instantiateCommandRuntimeCoreFromBuffer } from "../../../../runtime/src/commands/wasm-core.js";
import {
  buildSpecFromSummaryFlow,
  normalizeBuildSpecForUi,
  runPoolFlow,
} from "../../../../runtime/src/commands/ui-flow.js";
import { createBlockchainAdapter } from "../blockchain/index.js";
import { createIpfsAdapter } from "../ipfs/index.js";
import { createLlmAdapter } from "../llm/index.js";
import { createWebSolverAdapter } from "../solver/index.js";

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isUrl(value) {
  return /^[a-z]+:\/\//i.test(String(value || ""));
}

function ensureLeadingSlash(value) {
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizePath(pathValue) {
  const raw = String(pathValue || "").replace(/\\/g, "/");
  if (!raw || raw === ".") return "/";
  const absolute = raw.startsWith("/");
  const parts = raw.split("/");
  const stack = [];
  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
      return;
    }
    stack.push(part);
  });
  const joined = stack.join("/");
  if (!joined) return absolute ? "/" : "";
  return absolute ? `/${joined}` : joined;
}

function ensureDirectoryHref(value) {
  if (!value) return value;
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveResourcePath(input, baseDir = "/") {
  if (!input) return null;
  const raw = String(input);
  if (isUrl(raw)) return raw;
  if (raw.startsWith("/")) return normalizePath(raw);
  if (isUrl(baseDir)) {
    return new URL(raw, ensureDirectoryHref(baseDir)).toString();
  }
  const normalizedBase = normalizePath(baseDir || "/") || "/";
  return normalizePath(`${ensureLeadingSlash(normalizedBase)}/${raw}`);
}

function dirnamePath(pathValue) {
  const raw = String(pathValue || "");
  if (isUrl(raw)) {
    const url = new URL(raw);
    const pathname = normalizePath(url.pathname);
    const index = pathname.lastIndexOf("/");
    url.pathname = index > 0 ? pathname.slice(0, index) : "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  const normalized = normalizePath(pathValue || "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

function pathJoin(...parts) {
  const filtered = parts.filter(Boolean).map((part) => String(part));
  if (filtered.length === 0) return "/";
  const [first, ...rest] = filtered;
  if (isUrl(first)) {
    return rest.reduce((current, part) => new URL(part, ensureDirectoryHref(current)).toString(), first);
  }
  return normalizePath(filtered.join("/"));
}

function readHeader(response, key) {
  const headers = response?.headers;
  if (!headers || typeof headers.get !== "function") return "";
  return headers.get(key) || "";
}

async function fetchTextResource(pathValue, fetchFn) {
  const response = await fetchFn(pathValue);
  if (!response?.ok) {
    throw new Error(`Failed to fetch ${pathValue}: ${response?.status || "ERR"} ${response?.statusText || ""}`.trim());
  }
  const text = await response.text();
  return {
    text,
    contentType: readHeader(response, "content-type"),
  };
}

async function fetchBinaryResource(pathValue, fetchFn) {
  const response = await fetchFn(pathValue);
  if (!response?.ok) {
    throw new Error(`Failed to fetch ${pathValue}: ${response?.status || "ERR"} ${response?.statusText || ""}`.trim());
  }
  if (typeof response.arrayBuffer !== "function") {
    throw new Error(`Binary fetch for ${pathValue} requires response.arrayBuffer().`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function createBrowserKernelHost({
  fetchFn = fetch,
  env = {},
  nowIso = () => new Date().toISOString(),
  fileStore = new Map(),
  logSink = [],
  warnSink = [],
} = {}) {
  let seq = 0;

  async function readText(pathValue) {
    const resolved = resolveResourcePath(pathValue);
    if (fileStore.has(resolved)) {
      const existing = fileStore.get(resolved);
      return typeof existing === "string" ? existing : JSON.stringify(existing);
    }
    const fetched = await fetchTextResource(resolved, fetchFn);
    fileStore.set(resolved, fetched.text);
    return fetched.text;
  }

  async function readJson(pathValue) {
    const resolved = resolveResourcePath(pathValue);
    if (fileStore.has(resolved)) {
      const existing = fileStore.get(resolved);
      if (typeof existing === "string") {
        return JSON.parse(existing);
      }
      return cloneJson(existing);
    }
    const fetched = await fetchTextResource(resolved, fetchFn);
    const parsed = JSON.parse(fetched.text);
    fileStore.set(resolved, cloneJson(parsed));
    return cloneJson(parsed);
  }

  async function writeJson(pathValue, value) {
    const resolved = resolveResourcePath(pathValue);
    fileStore.set(resolved, cloneJson(value));
  }

  async function writeBinary(pathValue, value) {
    const resolved = resolveResourcePath(pathValue);
    fileStore.set(resolved, value instanceof Uint8Array ? new Uint8Array(value) : value);
  }

  return {
    files: fileStore,
    logs: logSink,
    warnings: warnSink,
    host: {
      readJson,
      readText,
      writeJson,
      writeBinary,
      resolvePath: resolveResourcePath,
      join: pathJoin,
      dirname: dirnamePath,
      exists: (pathValue) => fileStore.has(resolveResourcePath(pathValue)),
      listFiles: (dirPath) => {
        const resolvedDir = resolveResourcePath(dirPath || "/");
        const basePrefix = ensureDirectoryHref(resolvedDir);
        const names = new Set();
        fileStore.forEach((_value, key) => {
          const resolvedKey = resolveResourcePath(key);
          if (!resolvedKey.startsWith(basePrefix)) {
            return;
          }
          const remainder = resolvedKey.slice(basePrefix.length);
          if (!remainder || remainder.includes("/")) {
            return;
          }
          names.add(remainder);
        });
        return Array.from(names).sort((left, right) => left.localeCompare(right));
      },
      makeId: (prefix) => `${prefix}_${++seq}`,
      createMeta: ({ producedBy = "web-cli", runId, correlationId, note } = {}) => ({
        id: `artifact_${++seq}`,
        runId: runId || `run_${seq}`,
        createdAt: nowIso(),
        producedBy,
        correlationId,
        note,
      }),
      toRef: (artifact) => {
        if (!artifact || typeof artifact !== "object") {
          return null;
        }
        if (!artifact.schema || !artifact.schemaVersion) {
          return null;
        }
        return {
          id: artifact.meta?.id || `artifact_${++seq}`,
          schema: artifact.schema,
          schemaVersion: artifact.schemaVersion,
        };
      },
      defaultBuildOutDir: (spec) => {
        const runId = spec?.meta?.runId || `run_${++seq}`;
        return `/artifacts/runs/${runId}/build`;
      },
      defaultRunCommandOutDir: (command, runId) => `/artifacts/runs/${runId || `run_${++seq}`}/${command}`,
      defaultLlmPlanOutDir: (runId) => `/artifacts/runs/${runId || `run_${++seq}`}/llm-plan`,
      defaultWasmPath: () => "/assets/core-as.wasm",
      allowNetworkRequests: () => true,
      isLlmLiveEnabled: () => true,
      isLlmStrictEnabled: () => false,
      isLlmBudgetLoopEnabled: () => false,
      isLocalBaseUrl: (baseUrl = "") => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(String(baseUrl)),
      createIpfsAdapter: (options = {}) => createIpfsAdapter({
        ...options,
        fetchFn: options.fetchFn || fetchFn,
      }),
      createBlockchainAdapter: (options = {}) => createBlockchainAdapter({
        ...options,
        fetchFn: options.fetchFn || fetchFn,
      }),
      createLlmAdapter: (options = {}) => createLlmAdapter({
        ...options,
        fetchFn: options.fetchFn || fetchFn,
      }),
      createSolverAdapter: async ({ fixturePath } = {}) => {
        const fixture = fixturePath ? await readJson(fixturePath) : undefined;
        return createWebSolverAdapter({ fixture });
      },
      loadCore: async (wasmPath) => {
        const resolved = resolveResourcePath(wasmPath || "/assets/core-as.wasm");
        const buffer = await fetchBinaryResource(resolved, fetchFn);
        return instantiateCommandRuntimeCoreFromBuffer(buffer);
      },
      nowIso,
      env,
      cwd: () => "/",
      log: (...parts) => {
        logSink.push(parts.map((part) => String(part)).join(" "));
      },
      warn: (...parts) => {
        warnSink.push(parts.map((part) => String(part)).join(" "));
      },
    },
  };
}

function readJsonOutput(files, pathValue) {
  const resolved = resolveResourcePath(pathValue);
  if (!files.has(resolved)) return null;
  const value = files.get(resolved);
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return cloneJson(value);
}

function readStoredValue(files, pathValue) {
  const resolved = resolveResourcePath(pathValue);
  if (!files.has(resolved)) return null;
  const value = files.get(resolved);
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) {
    return {
      kind: "binary",
      byteLength: value.byteLength,
    };
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return cloneJson(value);
}

function collectDirectoryArtifacts(files, outDir) {
  if (!outDir) return {};
  const resolved = resolveResourcePath(outDir);
  const prefix = resolved.endsWith("/") ? resolved : `${resolved}/`;
  return Object.fromEntries(
    Array.from(files.entries())
      .filter(([pathValue]) => pathValue.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([pathValue]) => {
        const relativePath = pathValue.slice(prefix.length);
        return [relativePath, readStoredValue(files, pathValue)];
      }),
  );
}

async function seedJsonInput(context, { path, json, fallbackPath } = {}) {
  if (json === undefined) {
    return path ? resolveResourcePath(path) : null;
  }
  const resolved = path ? resolveResourcePath(path) : resolveResourcePath(fallbackPath);
  await context.host.writeJson(resolved, json);
  return resolved;
}

function buildCommandResult({ context, outDir, extra = {} } = {}) {
  return {
    outDir,
    artifacts: collectDirectoryArtifacts(context.files, outDir),
    logs: context.logs.slice(),
    warnings: context.warnings.slice(),
    ...extra,
  };
}

export async function executeBrowserCommand(
  { action, payload = {} } = {},
  { fetchFn = fetch, env = {}, nowIso = () => new Date().toISOString() } = {},
) {
  const context = createBrowserKernelHost({ fetchFn, env, nowIso });
  const kernel = createCommandKernel(context.host);

  if (action === "build") {
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = requestedOutDir
      ? pathJoin(requestedOutDir, "..", "inputs")
      : `/inputs/${payload?.specJson?.meta?.runId || context.host.makeId("run")}/build`;
    let specPath = await seedJsonInput(context, {
      path: payload?.specPath,
      json: payload?.specJson,
      fallbackPath: requestedOutDir
        ? pathJoin(requestedOutDir, "spec.json")
        : pathJoin(inputBase, "spec.json"),
    });
    const affinityRulesPath = await seedJsonInput(context, {
      path: payload?.affinityRulesPath,
      json: payload?.affinityRulesJson,
      fallbackPath: pathJoin(inputBase, "affinity-rules.json"),
    });
    const motivationRulesPath = await seedJsonInput(context, {
      path: payload?.motivationRulesPath,
      json: payload?.motivationRulesJson,
      fallbackPath: pathJoin(inputBase, "motivation-rules.json"),
    });

    const result = await kernel.build({
      spec: specPath,
      "affinity-rules": affinityRulesPath || undefined,
      "motivation-rules": motivationRulesPath || undefined,
      "emit-visual-assets": payload?.emitVisualAssets ? true : undefined,
      "out-dir": requestedOutDir || undefined,
    });
    const outDir = result?.outDir || requestedOutDir || "";

    return buildCommandResult({
      context,
      outDir,
      extra: {
      specPath,
      manifest: readJsonOutput(context.files, pathJoin(outDir, "manifest.json")),
      bundle: readJsonOutput(context.files, pathJoin(outDir, "bundle.json")),
      telemetry: readJsonOutput(context.files, pathJoin(outDir, "telemetry.json")),
      spec: readJsonOutput(context.files, pathJoin(outDir, "spec.json")),
      },
    });
  }

  if (action === "solve") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/solve`;

    const planPath = await seedJsonInput(context, {
      path: payload?.planPath,
      json: payload?.planJson,
      fallbackPath: pathJoin(inputBase, "plan.json"),
    });
    const intentPath = await seedJsonInput(context, {
      path: payload?.intentPath,
      json: payload?.intentJson,
      fallbackPath: pathJoin(inputBase, "intent.json"),
    });
    const optionsPath = await seedJsonInput(context, {
      path: payload?.optionsPath,
      json: payload?.optionsJson,
      fallbackPath: pathJoin(inputBase, "options.json"),
    });
    const solverFixturePath = await seedJsonInput(context, {
      path: payload?.solverFixturePath,
      json: payload?.solverFixtureJson,
      fallbackPath: pathJoin(inputBase, "solver-fixture.json"),
    });

    let scenarioFilePath = payload?.scenarioPath
      ? resolveResourcePath(payload.scenarioPath)
      : payload?.scenarioFilePath
        ? resolveResourcePath(payload.scenarioFilePath)
        : null;
    if (!scenarioFilePath && payload?.scenarioText !== undefined) {
      scenarioFilePath = pathJoin(inputBase, "scenario.txt");
      context.files.set(scenarioFilePath, String(payload.scenarioText));
    }

    const result = await kernel.solve({
      scenario: payload?.scenario,
      "scenario-file": scenarioFilePath || undefined,
      plan: planPath || undefined,
      intent: intentPath || undefined,
      options: optionsPath || undefined,
      "solver-fixture": solverFixturePath || undefined,
      "out-dir": requestedOutDir || undefined,
      "run-id": payload?.runId || undefined,
    });
    const outDir = result?.outDir || requestedOutDir || context.host.defaultRunCommandOutDir("solve", runId);

    return buildCommandResult({
      context,
      outDir,
      extra: {
        solverRequest: readJsonOutput(context.files, pathJoin(outDir, "solver-request.json")),
        solverResult: readJsonOutput(context.files, pathJoin(outDir, "solver-result.json")),
      },
    });
  }

  if (action === "configurator") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/configurator`;

    const levelGenPath = await seedJsonInput(context, {
      path: payload?.levelGenPath,
      json: payload?.levelGenJson,
      fallbackPath: pathJoin(inputBase, "level-gen.json"),
    });
    const actorsPath = await seedJsonInput(context, {
      path: payload?.actorsPath,
      json: payload?.actorsJson,
      fallbackPath: pathJoin(inputBase, "actors.json"),
    });
    const planPath = await seedJsonInput(context, {
      path: payload?.planPath,
      json: payload?.planJson,
      fallbackPath: pathJoin(inputBase, "plan.json"),
    });
    const budgetReceiptPath = await seedJsonInput(context, {
      path: payload?.budgetReceiptPath,
      json: payload?.budgetReceiptJson,
      fallbackPath: pathJoin(inputBase, "budget-receipt.json"),
    });
    const budgetPath = await seedJsonInput(context, {
      path: payload?.budgetPath,
      json: payload?.budgetJson,
      fallbackPath: pathJoin(inputBase, "budget.json"),
    });
    const priceListPath = await seedJsonInput(context, {
      path: payload?.priceListPath,
      json: payload?.priceListJson,
      fallbackPath: pathJoin(inputBase, "price-list.json"),
    });
    const affinityPresetsPath = await seedJsonInput(context, {
      path: payload?.affinityPresetsPath,
      json: payload?.affinityPresetsJson,
      fallbackPath: pathJoin(inputBase, "affinity-presets.json"),
    });
    const affinityLoadoutsPath = await seedJsonInput(context, {
      path: payload?.affinityLoadoutsPath,
      json: payload?.affinityLoadoutsJson,
      fallbackPath: pathJoin(inputBase, "affinity-loadouts.json"),
    });
    const affinityRulesPath = await seedJsonInput(context, {
      path: payload?.affinityRulesPath,
      json: payload?.affinityRulesJson,
      fallbackPath: pathJoin(inputBase, "affinity-rules.json"),
    });
    const motivationRulesPath = await seedJsonInput(context, {
      path: payload?.motivationRulesPath,
      json: payload?.motivationRulesJson,
      fallbackPath: pathJoin(inputBase, "motivation-rules.json"),
    });
    const receiptOutPath = payload?.receiptOut ? resolveResourcePath(payload.receiptOut) : null;

    const result = await kernel.configurator({
      "level-gen": levelGenPath,
      actors: actorsPath,
      plan: planPath || undefined,
      "budget-receipt": budgetReceiptPath || undefined,
      budget: budgetPath || undefined,
      "price-list": priceListPath || undefined,
      "receipt-out": receiptOutPath || undefined,
      "affinity-presets": affinityPresetsPath || undefined,
      "affinity-loadouts": affinityLoadoutsPath || undefined,
      "affinity-rules": affinityRulesPath || undefined,
      "motivation-rules": motivationRulesPath || undefined,
      "emit-visual-assets": payload?.emitVisualAssets ? true : undefined,
      "out-dir": requestedOutDir || undefined,
      "run-id": payload?.runId || undefined,
    });
    const outDir = result?.outDir || requestedOutDir || context.host.defaultRunCommandOutDir("configurator", runId);

    return buildCommandResult({
      context,
      outDir,
      extra: {
        simConfig: readJsonOutput(context.files, pathJoin(outDir, "sim-config.json")),
        initialState: readJsonOutput(context.files, pathJoin(outDir, "initial-state.json")),
        budgetReceipt: readJsonOutput(context.files, pathJoin(outDir, "budget-receipt.json")),
      },
    });
  }

  if (action === "budget") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/budget`;

    const budgetPath = await seedJsonInput(context, {
      path: payload?.budgetPath,
      json: payload?.budgetJson,
      fallbackPath: pathJoin(inputBase, "budget.json"),
    });
    const priceListPath = await seedJsonInput(context, {
      path: payload?.priceListPath,
      json: payload?.priceListJson,
      fallbackPath: pathJoin(inputBase, "price-list.json"),
    });
    const receiptPath = await seedJsonInput(context, {
      path: payload?.receiptPath,
      json: payload?.receiptJson,
      fallbackPath: pathJoin(inputBase, "budget-receipt.json"),
    });
    const receiptOutPath = payload?.receiptOut ? resolveResourcePath(payload.receiptOut) : null;
    const outPath = payload?.outPath ? resolveResourcePath(payload.outPath) : null;

    const result = await kernel.budget({
      budget: budgetPath || undefined,
      "price-list": priceListPath || undefined,
      receipt: receiptPath || undefined,
      "receipt-out": receiptOutPath || undefined,
      "out-dir": requestedOutDir || undefined,
      out: outPath || undefined,
    });

    return {
      ...buildCommandResult({
        context,
        outDir: result?.outDir || requestedOutDir || "",
        extra: {
          outPath: result?.outPath || outPath || "",
          output: cloneJson(result?.output || {}),
          budget: result?.output?.budget || readJsonOutput(context.files, pathJoin(requestedOutDir || "", "budget.json")),
          priceList: result?.output?.priceList || readJsonOutput(context.files, pathJoin(requestedOutDir || "", "price-list.json")),
          receipt: result?.output?.receipt || readJsonOutput(context.files, pathJoin(requestedOutDir || "", "budget-receipt.json")),
        },
      }),
      outputFile: outPath ? readJsonOutput(context.files, outPath) : null,
    };
  }

  if (action === "ipfs") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("ipfs", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, payload?.json ? "ipfs.json" : "ipfs.txt");

    const fixturePath = await seedJsonInput(context, {
      path: payload?.fixturePath,
      json: payload?.fixtureJson,
      fallbackPath: `/inputs/${runId}/ipfs-fixture.json`,
    });
    if (!payload?.fixtureJson && payload?.fixtureText !== undefined) {
      const textPath = payload?.fixturePath
        ? resolveResourcePath(payload.fixturePath)
        : `/inputs/${runId}/ipfs-fixture.txt`;
      context.files.set(textPath, String(payload.fixtureText));
      const result = await kernel.ipfs({
        cid: payload?.cid,
        path: payload?.path,
        gateway: payload?.gatewayUrl || payload?.gateway,
        fixture: textPath,
        json: payload?.json,
      });
      if (payload?.json) {
        await context.host.writeJson(outPath, result.output);
      } else {
        context.files.set(outPath, String(result.output ?? ""));
      }
      return {
        ...buildCommandResult({ context, outDir }),
        outPath,
        output: result.output,
      };
    }

    const result = await kernel.ipfs({
      cid: payload?.cid,
      path: payload?.path,
      gateway: payload?.gatewayUrl || payload?.gateway,
      fixture: fixturePath || undefined,
      json: payload?.json,
    });
    if (payload?.json) {
      await context.host.writeJson(outPath, result.output);
    } else {
      context.files.set(outPath, String(result.output ?? ""));
    }
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output: result.output,
    };
  }

  if (action === "ipfs_publish") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("ipfs-publish", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, "ipfs-publish.json");
    const artifactMap = payload?.artifactMap && typeof payload.artifactMap === "object"
      ? payload.artifactMap
      : {};
    const coreArtifactMap = payload?.coreArtifactMap && typeof payload.coreArtifactMap === "object"
      ? payload.coreArtifactMap
      : null;
    const sessionArtifactMap = payload?.sessionArtifactMap && typeof payload.sessionArtifactMap === "object"
      ? payload.sessionArtifactMap
      : null;

    const result = await kernel.ipfsPublish({
      scope: payload?.scope,
      path: payload?.path,
      gateway: payload?.gatewayUrl || payload?.gateway,
      "fixture-cid": payload?.fixtureCid,
      "artifact-map": artifactMap,
      "core-artifact-map": coreArtifactMap,
      "core-dir": payload?.coreDir,
      "session-artifact-map": sessionArtifactMap,
      "session-dir": payload?.sessionDir,
      "session-id": payload?.sessionId,
      "checkpoint-id": payload?.checkpointId,
      "session-status": payload?.sessionStatus,
      "previous-package-cid": payload?.previousPackageCid,
      "package-id": payload?.packageId,
    });
    const output = {
      cid: result.cid,
      rootPath: result.rootPath || "",
      publishedFiles: result.publishedFiles || [],
      mode: result.mode || "live",
      scope: result.scope || payload?.scope || "core",
      package: result.package || null,
      sessionManifest: result.sessionManifest || null,
    };
    await context.host.writeJson(outPath, output);
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output,
      published: result.published || {},
      package: result.package || null,
      sessionManifest: result.sessionManifest || null,
    };
  }

  if (action === "ipfs_load") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("ipfs-load", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, "ipfs-load.json");

    const result = await kernel.ipfsLoad({
      cid: payload?.cid,
      "load-mode": payload?.loadMode,
      "session-id": payload?.sessionId,
      "checkpoint-id": payload?.checkpointId,
      path: payload?.path,
      gateway: payload?.gatewayUrl || payload?.gateway,
      "fixture-map": payload?.fixtureMap,
    });
    const fetched = result?.fetched || {};
    for (const [fileName, artifact] of Object.entries(fetched)) {
      await context.host.writeJson(pathJoin(outDir, fileName), artifact);
    }
    await context.host.writeJson(outPath, {
      cid: result.cid,
      rootPath: result.rootPath || "",
      loadMode: result.loadMode || payload?.loadMode || "core",
      fetchedFiles: Object.keys(fetched),
      missing: result.missing || [],
      package: result.package || null,
      sessionManifest: result.sessionManifest || null,
    });
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output: {
        cid: result.cid,
        rootPath: result.rootPath || "",
        loadMode: result.loadMode || payload?.loadMode || "core",
        fetchedFiles: Object.keys(fetched),
        missing: result.missing || [],
        package: result.package || null,
        sessionManifest: result.sessionManifest || null,
      },
      fetched,
      bundle: fetched["bundle.json"] || null,
      manifest: fetched["manifest.json"] || null,
      checkpoint: fetched["checkpoint-state.json"] || null,
      actionLog: fetched["action-log.json"] || null,
      package: result.package || null,
      sessionManifest: result.sessionManifest || null,
    };
  }

  if (action === "blockchain") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("blockchain", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, "blockchain.json");

    const chainFixturePath = await seedJsonInput(context, {
      path: payload?.fixtureChainIdPath,
      json: payload?.fixtureChainIdJson,
      fallbackPath: `/inputs/${runId}/blockchain-chain-id.json`,
    });
    const balanceFixturePath = await seedJsonInput(context, {
      path: payload?.fixtureBalancePath,
      json: payload?.fixtureBalanceJson,
      fallbackPath: `/inputs/${runId}/blockchain-balance.json`,
    });

    const result = await kernel.blockchain({
      "rpc-url": payload?.rpcUrl,
      address: payload?.address,
      "fixture-chain-id": chainFixturePath || undefined,
      "fixture-balance": balanceFixturePath || undefined,
    });
    await context.host.writeJson(outPath, result.output);
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output: result.output,
    };
  }

  if (action === "blockchain_mint") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("blockchain-mint", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, "blockchain-mint.json");

    const cardPath = await seedJsonInput(context, {
      path: payload?.cardPath,
      json: payload?.cardJson,
      fallbackPath: `/inputs/${runId}/blockchain-card.json`,
    });
    const chainFixturePath = await seedJsonInput(context, {
      path: payload?.fixtureChainIdPath,
      json: payload?.fixtureChainIdJson,
      fallbackPath: `/inputs/${runId}/blockchain-chain-id.json`,
    });
    const mintFixturePath = await seedJsonInput(context, {
      path: payload?.fixtureMintPath,
      json: payload?.fixtureMintJson,
      fallbackPath: `/inputs/${runId}/blockchain-mint.json`,
    });

    const result = await kernel.blockchainMint({
      "rpc-url": payload?.rpcUrl,
      card: cardPath || undefined,
      owner: payload?.owner,
      contract: payload?.contract,
      "token-id": payload?.tokenId,
      "fixture-chain-id": chainFixturePath || undefined,
      "fixture-mint": mintFixturePath || undefined,
    });
    await context.host.writeJson(outPath, result.output);
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output: result.output,
    };
  }

  if (action === "blockchain_load") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("blockchain-load", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, "blockchain-load.json");

    const chainFixturePath = await seedJsonInput(context, {
      path: payload?.fixtureChainIdPath,
      json: payload?.fixtureChainIdJson,
      fallbackPath: `/inputs/${runId}/blockchain-chain-id.json`,
    });
    const loadFixturePath = await seedJsonInput(context, {
      path: payload?.fixtureLoadPath,
      json: payload?.fixtureLoadJson,
      fallbackPath: `/inputs/${runId}/blockchain-load.json`,
    });

    const result = await kernel.blockchainLoad({
      "rpc-url": payload?.rpcUrl,
      "token-id": payload?.tokenId,
      owner: payload?.owner,
      contract: payload?.contract,
      "fixture-chain-id": chainFixturePath || undefined,
      "fixture-load": loadFixturePath || undefined,
    });
    await context.host.writeJson(outPath, result.output);
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output: result.output,
    };
  }

  if (action === "llm") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const outDir = requestedOutDir || context.host.defaultRunCommandOutDir("llm", runId);
    const outPath = payload?.outPath
      ? resolveResourcePath(payload.outPath)
      : pathJoin(outDir, "llm.json");

    const fixturePath = await seedJsonInput(context, {
      path: payload?.fixturePath,
      json: payload?.fixtureJson,
      fallbackPath: `/inputs/${runId}/llm-fixture.json`,
    });
    const result = await kernel.llm({
      model: payload?.model,
      prompt: payload?.prompt,
      "base-url": payload?.baseUrl,
      fixture: fixturePath || undefined,
    });
    await context.host.writeJson(outPath, result.output);
    return {
      ...buildCommandResult({ context, outDir }),
      outPath,
      output: result.output,
    };
  }

  if (action === "llm_plan") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/llm-plan`;

    const scenarioPath = await seedJsonInput(context, {
      path: payload?.scenarioPath,
      json: payload?.scenarioJson,
      fallbackPath: pathJoin(inputBase, "scenario.json"),
    });
    const catalogPath = await seedJsonInput(context, {
      path: payload?.catalogPath,
      json: payload?.catalogJson,
      fallbackPath: pathJoin(inputBase, "catalog.json"),
    });
    const fixturePath = await seedJsonInput(context, {
      path: payload?.fixturePath,
      json: payload?.fixtureJson,
      fallbackPath: pathJoin(inputBase, "fixture.json"),
    });

    const result = await kernel.llmPlan({
      scenario: scenarioPath || undefined,
      prompt: payload?.prompt,
      catalog: catalogPath || undefined,
      goal: payload?.goal,
      "budget-tokens": payload?.budgetTokens,
      model: payload?.model,
      "base-url": payload?.baseUrl,
      fixture: fixturePath || undefined,
      "budget-loop": payload?.budgetLoop ? true : undefined,
      "budget-pool": payload?.budgetPool,
      "budget-reserve": payload?.budgetReserve,
      "emit-visual-assets": payload?.emitVisualAssets ? true : undefined,
      "out-dir": requestedOutDir || undefined,
      "run-id": payload?.runId || undefined,
      "created-at": payload?.createdAt,
    });
    const outDir = result?.outDir || requestedOutDir || context.host.defaultLlmPlanOutDir(runId);

    return buildCommandResult({
      context,
      outDir,
      extra: {
        manifest: readJsonOutput(context.files, pathJoin(outDir, "manifest.json")),
        bundle: readJsonOutput(context.files, pathJoin(outDir, "bundle.json")),
        telemetry: readJsonOutput(context.files, pathJoin(outDir, "telemetry.json")),
        spec: readJsonOutput(context.files, pathJoin(outDir, "spec.json")),
      },
    });
  }

  if (action === "run") {
    const runId = payload?.runId || context.host.makeId("run");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/run`;

    const simConfigPath = await seedJsonInput(context, {
      path: payload?.simConfigPath,
      json: payload?.simConfigJson,
      fallbackPath: pathJoin(inputBase, "sim-config.json"),
    });
    const initialStatePath = await seedJsonInput(context, {
      path: payload?.initialStatePath,
      json: payload?.initialStateJson,
      fallbackPath: pathJoin(inputBase, "initial-state.json"),
    });
    const executionPolicyPath = await seedJsonInput(context, {
      path: payload?.executionPolicyPath,
      json: payload?.executionPolicyJson,
      fallbackPath: pathJoin(inputBase, "execution-policy.json"),
    });
    const actionsPath = await seedJsonInput(context, {
      path: payload?.actionsPath,
      json: payload?.actionsJson,
      fallbackPath: pathJoin(inputBase, "actions.json"),
    });
    const affinityPresetsPath = await seedJsonInput(context, {
      path: payload?.affinityPresetsPath,
      json: payload?.affinityPresetsJson,
      fallbackPath: pathJoin(inputBase, "affinity-presets.json"),
    });
    const affinityLoadoutsPath = await seedJsonInput(context, {
      path: payload?.affinityLoadoutsPath,
      json: payload?.affinityLoadoutsJson,
      fallbackPath: pathJoin(inputBase, "affinity-loadouts.json"),
    });
    const affinityRulesPath = await seedJsonInput(context, {
      path: payload?.affinityRulesPath,
      json: payload?.affinityRulesJson,
      fallbackPath: pathJoin(inputBase, "affinity-rules.json"),
    });
    const motivationRulesPath = await seedJsonInput(context, {
      path: payload?.motivationRulesPath,
      json: payload?.motivationRulesJson,
      fallbackPath: pathJoin(inputBase, "motivation-rules.json"),
    });
    const affinitySummaryArg = payload?.affinitySummaryPath
      ? resolveResourcePath(payload.affinitySummaryPath)
      : payload?.affinitySummary
        ? true
        : undefined;

    const result = await kernel.run({
      "sim-config": simConfigPath,
      "initial-state": initialStatePath,
      "execution-policy": executionPolicyPath || undefined,
      actions: actionsPath || undefined,
      "affinity-presets": affinityPresetsPath || undefined,
      "affinity-loadouts": affinityLoadoutsPath || undefined,
      "affinity-rules": affinityRulesPath || undefined,
      "motivation-rules": motivationRulesPath || undefined,
      "affinity-summary": affinitySummaryArg,
      wasm: payload?.wasmPath ? resolveResourcePath(payload.wasmPath) : undefined,
      ticks: payload?.ticks,
      seed: payload?.seed,
      "out-dir": requestedOutDir || undefined,
      "run-id": payload?.runId || undefined,
      "session-id": payload?.sessionId || undefined,
      "checkpoint-id": payload?.checkpointId || undefined,
      actor: payload?.actor,
      vital: payload?.vital,
      "vital-default": payload?.vitalDefault,
      "tile-wall": payload?.tileWall,
      "tile-barrier": payload?.tileBarrier,
      "tile-floor": payload?.tileFloor,
    });
    const outDir = result?.outDir || requestedOutDir || context.host.defaultRunCommandOutDir("run", runId);
    const affinitySummaryPath = typeof affinitySummaryArg === "string"
      ? affinitySummaryArg
      : affinitySummaryArg
        ? pathJoin(outDir, "affinity-summary.json")
        : null;

    return buildCommandResult({
      context,
      outDir,
      extra: {
        tickFrames: readJsonOutput(context.files, pathJoin(outDir, "tick-frames.json")),
        effectsLog: readJsonOutput(context.files, pathJoin(outDir, "effects-log.json")),
        runtimeDecisionCaptures: readJsonOutput(context.files, pathJoin(outDir, "runtime-decision-captures.json")),
        runSummary: readJsonOutput(context.files, pathJoin(outDir, "run-summary.json")),
        actionLog: readJsonOutput(context.files, pathJoin(outDir, "action-log.json")),
        checkpointState: readJsonOutput(context.files, pathJoin(outDir, "checkpoint-state.json")),
        resolvedSimConfig: readJsonOutput(context.files, pathJoin(outDir, "resolved-sim-config.json")),
        resolvedInitialState: readJsonOutput(context.files, pathJoin(outDir, "resolved-initial-state.json")),
        affinitySummary: affinitySummaryPath ? readJsonOutput(context.files, affinitySummaryPath) : null,
      },
    });
  }

  if (action === "replay") {
    const runId = payload?.runId || context.host.makeId("replay");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/replay`;

    const simConfigPath = await seedJsonInput(context, {
      path: payload?.simConfigPath,
      json: payload?.simConfigJson,
      fallbackPath: pathJoin(inputBase, "sim-config.json"),
    });
    const initialStatePath = await seedJsonInput(context, {
      path: payload?.initialStatePath,
      json: payload?.initialStateJson,
      fallbackPath: pathJoin(inputBase, "initial-state.json"),
    });
    const executionPolicyPath = await seedJsonInput(context, {
      path: payload?.executionPolicyPath,
      json: payload?.executionPolicyJson,
      fallbackPath: pathJoin(inputBase, "execution-policy.json"),
    });
    const tickFramesPath = await seedJsonInput(context, {
      path: payload?.tickFramesPath,
      json: payload?.tickFramesJson,
      fallbackPath: pathJoin(inputBase, "tick-frames.json"),
    });

    const result = await kernel.replay({
      "sim-config": simConfigPath,
      "initial-state": initialStatePath,
      "execution-policy": executionPolicyPath || undefined,
      "tick-frames": tickFramesPath,
      wasm: payload?.wasmPath ? resolveResourcePath(payload.wasmPath) : undefined,
      ticks: payload?.ticks,
      seed: payload?.seed,
      "out-dir": requestedOutDir || undefined,
    });
    const outDir = result?.outDir || requestedOutDir || context.host.defaultRunCommandOutDir("replay", runId);

    return buildCommandResult({
      context,
      outDir,
      extra: {
        replaySummary: readJsonOutput(context.files, pathJoin(outDir, "replay-summary.json")),
        replayTickFrames: readJsonOutput(context.files, pathJoin(outDir, "replay-tick-frames.json")),
      },
    });
  }

  if (action === "inspect") {
    const runId = payload?.runId || context.host.makeId("inspect");
    const requestedOutDir = payload?.outDir ? resolveResourcePath(payload.outDir) : null;
    const inputBase = `/inputs/${runId}/inspect`;

    const tickFramesPath = await seedJsonInput(context, {
      path: payload?.tickFramesPath,
      json: payload?.tickFramesJson,
      fallbackPath: pathJoin(inputBase, "tick-frames.json"),
    });
    const effectsLogPath = await seedJsonInput(context, {
      path: payload?.effectsLogPath,
      json: payload?.effectsLogJson,
      fallbackPath: pathJoin(inputBase, "effects-log.json"),
    });

    const result = await kernel.inspect({
      "tick-frames": tickFramesPath || undefined,
      "effects-log": effectsLogPath || undefined,
      "out-dir": requestedOutDir || undefined,
    });
    const outDir = result?.outDir || requestedOutDir || context.host.defaultRunCommandOutDir("inspect", runId);

    return buildCommandResult({
      context,
      outDir,
      extra: {
        inspectSummary: readJsonOutput(context.files, pathJoin(outDir, "inspect-summary.json")),
      },
    });
  }

  if (action === "build_spec_from_summary") {
    return buildSpecFromSummaryFlow(payload);
  }

  if (action === "pool_flow") {
    return runPoolFlow(payload);
  }

  if (action === "normalize_build_spec") {
    return normalizeBuildSpecForUi(payload?.spec);
  }

  throw new Error(`Unsupported browser command: ${action || "unknown"}`);
}
