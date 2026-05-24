import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createHandlerTool,
  integerSchema,
  pathSchema,
  stringArraySchema,
  stringSchema,
} from "./shared.mjs";
import { RECIPE_CATALOG, SCAFFOLDABLE_RECIPES } from "../../../../../scripts/testing/recipe-catalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../../../../../");
const INVENTORY_PATH = resolve(ROOT, "local-codex/test-inventory.json");
const CLASSIFICATION_PATH = resolve(ROOT, "local-codex/test-classification.md");

function runNodeScript(relativeScriptPath, args = []) {
  const result = spawnSync(process.execPath, [resolve(ROOT, relativeScriptPath), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  let parsed;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {}
  }
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout,
    stderr,
    parsed,
  };
}

function ensureInventory() {
  if (!existsSync(INVENTORY_PATH)) {
    const result = runNodeScript("scripts/testing/inventory-tests.mjs", [INVENTORY_PATH]);
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Failed to generate inventory.");
    }
  }
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
}

function ensureClassification() {
  if (!existsSync(CLASSIFICATION_PATH)) {
    const result = runNodeScript("scripts/testing/classify-tests.mjs", [CLASSIFICATION_PATH]);
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Failed to generate classification.");
    }
  }
  return readFileSync(CLASSIFICATION_PATH, "utf8");
}

function readCodemodExceptions() {
  const result = runNodeScript("scripts/testing/report-codemod-exceptions.mjs");
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "Failed to read codemod exceptions.");
  }
  return result.parsed ?? { ok: false, exceptions: [] };
}

function toLiteralList(items = []) {
  return items.map((item) => JSON.stringify(item)).join(", ");
}

function listRecipeMetadata() {
  return Object.entries(RECIPE_CATALOG)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, ...value }));
}

function scaffoldCliSuccess(args) {
  const expectedArtifacts = args.expectedArtifacts ?? [];
  const forbiddenArtifacts = args.forbiddenArtifacts ?? [];
  return `const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

test(${JSON.stringify(args.title)}, () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-cli-"));
  const result = spawnSync(process.execPath, [CLI, ${toLiteralList(args.commandArgs ?? [])}, "--out-dir", outDir], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
${expectedArtifacts.map((artifact) => `  assert.equal(existsSync(join(outDir, ${JSON.stringify(artifact)})), true);`).join("\n")}
${forbiddenArtifacts.map((artifact) => `  assert.equal(existsSync(join(outDir, ${JSON.stringify(artifact)})), false);`).join("\n")}
});
`;
}

function scaffoldServeUiRedirect(args) {
  const title = args.title ?? "serve-ui falls back and stays healthy";
  return `import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { listenWithPortFallback } from "../../scripts/serve-ui.mjs";

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test(${JSON.stringify(title)}, async ({ page, request }) => {
  const blocker = createServer((_req, res) => {
    res.statusCode = 200;
    res.end("blocked");
  });
  await listen(blocker, ${Number(args.startPort ?? 8010)});

  const { port, server } = await listenWithPortFallback({
    startPort: ${Number(args.startPort ?? 8010)},
    maxAttempts: 3,
    hostname: "127.0.0.1",
  });

  try {
    expect(port).toBe(${Number(args.startPort ?? 8010) + 1});
    const health = await request.get(\`http://127.0.0.1:\${port}/health\`);
    expect(health.ok()).toBeTruthy();
    await page.goto(\`http://127.0.0.1:\${port}/\`);
    await expect(page).toHaveURL(new RegExp("/packages/ui-web/index.html$"));
  } finally {
    await closeServer(server);
    await closeServer(blocker);
  }
});
`;
}

function scaffoldBrowserBundleLoadFlow(args) {
  const bundlePath = args.bundlePath ?? "tests/fixtures/ui/build-spec-bundle/bundle.json";
  const title = args.title ?? "browser bundle load flow stays healthy";
  return `import { test, expect } from "@playwright/test";
import { resolveFixturePath, startServeUi, stopProcess } from "./helpers/serve-ui.mjs";

const bundlePath = resolveFixturePath(...${JSON.stringify(bundlePath.split("/"))});

test(${JSON.stringify(title)}, async ({ page }) => {
  const served = await startServeUi();

  try {
    await page.goto(served.url);
    await page.locator('[data-tab="diagnostics"]').click();
    await expect(page.locator('[data-tab-panel="diagnostics"]').first()).toBeVisible();

    await page.setInputFiles("#bundle-file", bundlePath);
    await expect(page.locator("#bundle-status")).toContainText("Bundle loaded");

    await page.locator('[data-tab="simulation"]').click();
    await expect(page.locator('[data-tab-panel="simulation"]').first()).toBeVisible();
  } finally {
    await stopProcess(served.proc);
  }
});
`;
}

function scaffoldAdapterPortContract(args) {
  const paths = args.targetPaths ?? [];
  return `const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "..", "..");

test(${JSON.stringify(args.title)}, () => {
${paths.map((entry) => `  assert.equal(existsSync(resolve(ROOT, ${JSON.stringify(entry)})), true, ${JSON.stringify(`Missing ${entry}`)});`).join("\n")}
});
`;
}

function scaffoldBudgetPolicyInvariant(args) {
  const expectedChecks = args.expectedChecks ?? [];
  return `const assert = require("node:assert/strict");

function getValueAtPath(root, path) {
  return path.split(".").reduce((value, segment) => {
    if (segment === "") return value;
    const index = Number(segment);
    if (Number.isInteger(index) && String(index) === segment) {
      return value?.[index];
    }
    return value?.[segment];
  }, root);
}

test(${JSON.stringify(args.title)}, async () => {
  const { ${args.exportName} } = await import(${JSON.stringify(`../../${args.modulePath}`)});
  const result = ${args.exportName}(${args.inputJson ?? "{}"});

${expectedChecks.map((entry) => {
    const [path, rawExpected = "null"] = entry.split("=", 2);
    return `  assert.deepEqual(getValueAtPath(result, ${JSON.stringify(path)}), ${rawExpected});`;
  }).join("\n")}
});
`;
}

function scaffoldRuntimeModuleContract(args) {
  const expectedChecks = args.expectedChecks ?? [];
  return `const assert = require("node:assert/strict");

function getValueAtPath(root, path) {
  return path.split(".").reduce((value, segment) => {
    if (segment === "") return value;
    const index = Number(segment);
    if (Number.isInteger(index) && String(index) === segment) {
      return value?.[index];
    }
    return value?.[segment];
  }, root);
}

test(${JSON.stringify(args.title)}, async () => {
  const mod = await import(${JSON.stringify(`../../${args.modulePath}`)});
  const fn = mod[${JSON.stringify(args.exportName)}];
  assert.equal(typeof fn, "function", ${JSON.stringify(`Missing export ${args.exportName}`)});
  const result = await fn(${args.inputJson ?? "{}"});

${expectedChecks.map((entry) => {
    const [path, rawExpected = "null"] = entry.split("=", 2);
    return `  assert.deepEqual(getValueAtPath(result, ${JSON.stringify(path)}), ${rawExpected});`;
  }).join("\n")}
});
`;
}

function scaffoldRuntimePersonaTransition(args) {
  const retainedField = args.retainedField ?? "";
  const retainEvent = args.retainEvent ?? "";
  const retainedAssertions = retainedField && retainEvent
    ? `    if (entry.event === ${JSON.stringify(retainEvent)}) {
      assert.equal(result.context.${retainedField}, before.context.${retainedField});
    }`
    : "";
  const counterAssertions = (args.counterChecks ?? []).map((entry) => {
    const [fixtureField, contextField] = entry.split(":", 2);
    return `    if (entry.${fixtureField} !== undefined) {
      assert.equal(result.context.${contextField}, entry.${fixtureField});
    }`;
  }).join("\n");

  return `const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const happyFixture = JSON.parse(readFileSync(resolve(__dirname, ${JSON.stringify(args.happyFixturePath)}), "utf8"));
const guardFixture = JSON.parse(readFileSync(resolve(__dirname, ${JSON.stringify(args.guardFixturePath)}), "utf8"));

test(${JSON.stringify(args.title)} + " happy path", async () => {
  const { ${args.factoryName}, ${args.statesEnum} } = await import(${JSON.stringify(`../../${args.personaModulePath}`)});
  const fixture = happyFixture;
  const machine = ${args.factoryName}({ initialState: fixture.initialState, clock: () => "fixed" });

  fixture.cases.forEach((entry) => {
    const before = machine.view();
    const result = machine.advance(entry.event, entry.payload);
    assert.equal(result.state, ${args.statesEnum}[entry.expectState.toUpperCase()]);
    assert.equal(result.context.lastEvent, entry.event);
    assert.equal(result.context.updatedAt, "fixed");
${counterAssertions}
${retainedAssertions}
  });
});

test(${JSON.stringify(args.title)} + " guards", async () => {
  const { ${args.factoryName} } = await import(${JSON.stringify(`../../${args.personaModulePath}`)});
  const fixture = guardFixture;
  const machine = ${args.factoryName}({ initialState: fixture.initialState, clock: () => "fixed" });

  fixture.cases.forEach((entry) => {
    let threw = false;
    try {
      machine.advance(entry.event, entry.payload);
    } catch (err) {
      threw = true;
      assert.match(err.message, new RegExp(entry.expectError));
    }
    assert.equal(threw, true);
  });
});
`;
}

function scaffoldUiCliEquivalence(args) {
  return `const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const os = require("node:os");

const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const CLI_WORKER_URL = pathToFileURL(
  resolve(ROOT, "packages/adapters-web/src/adapters/cli-worker/index.js"),
).href;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fixtureResponse(body, contentType = "application/json; charset=utf-8") {
  const buffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const textBody = Buffer.isBuffer(body)
    ? buffer.toString("utf8")
    : typeof body === "string"
      ? body
      : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async text() {
      return textBody;
    },
    async json() {
      return JSON.parse(textBody);
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

function createFixtureFetch(rootDir) {
  return async (resource) => {
    const value = String(resource);
    const normalized = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value).pathname
      : value;
    const filePath = resolve(rootDir, normalized.replace(/^\\/+/, ""));
    if (filePath.endsWith(".wasm")) {
      return fixtureResponse(readFileSync(filePath), "application/wasm");
    }
    return fixtureResponse(readFileSync(filePath, "utf8"));
  };
}

function collectJsonArtifacts(outDir) {
  const artifacts = {};

  function walk(currentDir, relativeDir = "") {
    const entries = readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    entries.forEach((entry) => {
      const absolutePath = join(currentDir, entry.name);
      const relativePath = relativeDir ? \`\${relativeDir}/\${entry.name}\` : entry.name;
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        artifacts[relativePath] = readJson(absolutePath);
      }
    });
  }

  walk(outDir);
  return artifacts;
}

function collectArtifactIds(value, idMap, nextIdRef) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectArtifactIds(entry, idMap, nextIdRef));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (typeof value.schema === "string" && typeof value.meta?.id === "string" && !idMap.has(value.meta.id)) {
    idMap.set(value.meta.id, \`artifact_\${nextIdRef.current}\`);
    nextIdRef.current += 1;
  }
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => collectArtifactIds(value[key], idMap, nextIdRef));
}

function normalizeArtifactValue(value, idMap, refIdMap, nextRefRef, parentKey = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeArtifactValue(entry, idMap, refIdMap, nextRefRef));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (idMap.has(value)) {
        return idMap.get(value);
      }
      if (["createdAt", "startedAt", "endedAt", "updatedAt"].includes(parentKey)) {
        return \`<\${parentKey}>\`;
      }
    }
    return value;
  }

  const isRefObject = typeof value.id === "string"
    && typeof value.schema === "string"
    && Number.isFinite(value.schemaVersion)
    && !value.meta;
  if (isRefObject) {
    const normalizedRef = {};
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .forEach((key) => {
        if (key === "id" && !idMap.has(value.id)) {
          if (!refIdMap.has(value.id)) {
            refIdMap.set(value.id, \`ref_\${nextRefRef.current}\`);
            nextRefRef.current += 1;
          }
          normalizedRef.id = refIdMap.get(value.id);
          return;
        }
        normalizedRef[key] = normalizeArtifactValue(value[key], idMap, refIdMap, nextRefRef, key);
      });
    return normalizedRef;
  }

  const normalized = {};
  Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      normalized[key] = normalizeArtifactValue(value[key], idMap, refIdMap, nextRefRef, key);
    });
  return normalized;
}

function normalizeArtifacts(artifacts) {
  const idMap = new Map();
  const nextIdRef = { current: 1 };
  const refIdMap = new Map();
  const nextRefRef = { current: 1 };
  Object.entries(artifacts)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, value]) => collectArtifactIds(value, idMap, nextIdRef));

  return Object.fromEntries(
    Object.entries(artifacts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, value]) => [path, normalizeArtifactValue(value, idMap, refIdMap, nextRefRef)]),
  );
}

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\\n");
    throw new Error(\`CLI failed (\${result.status}): \${output}\`);
  }
}

async function createBrowserAdapter() {
  const { createCliWorkerAdapter } = await import(CLI_WORKER_URL);
  return createCliWorkerAdapter({
    forceInProcess: true,
    fetchFn: createFixtureFetch(ROOT),
    env: { AK_LLM_LIVE: "1" },
    nowIso: () => "2026-03-11T00:00:00.000Z",
  });
}

test(${JSON.stringify(args.title)}, async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-equivalence-"));
  const cliArgs = ${args.equivalenceCliArgs ?? "[]"}.slice();
  if (!cliArgs.includes("--out-dir")) {
    cliArgs.push("--out-dir", outDir);
  }
  runCli(cliArgs, ${args.equivalenceEnvJson ?? "{}"});

  const cliArtifacts = collectJsonArtifacts(outDir);
  const adapter = await createBrowserAdapter();
  const browserResult = await adapter[${JSON.stringify(args.adapterMethod)}](${args.adapterCallJson ?? "{}"});

  assert.deepEqual(
    normalizeArtifacts(browserResult.artifacts),
    normalizeArtifacts(cliArtifacts),
  );
});
`;
}

function scaffoldCliFailure(args) {
  return `const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "..", "..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

test(${JSON.stringify(args.title)}, () => {
  const result = spawnSync(process.execPath, [CLI, ${toLiteralList(args.commandArgs ?? [])}], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, "Expected CLI to fail");
  assert.match(result.stderr, new RegExp(${JSON.stringify(args.expectedErrorPattern ?? "requires")}));
});
`;
}

function scaffoldArtifactSchemaRoundtrip(args) {
  const expectedOk = String(args.expectedOk ?? "true").toLowerCase() !== "false";
  return `const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "..", "..");

test(${JSON.stringify(args.title)}, async () => {
  const fixture = JSON.parse(readFileSync(resolve(ROOT, ${JSON.stringify(args.fixturePath)}), "utf8"));
  const { ${args.validatorExport ?? "validateArtifact"}: validate } = await import(${JSON.stringify(`../../${args.validatorModule}`)});
  const result = validate(fixture);
  assert.equal(result.ok, ${expectedOk ? "true" : "false"}, result.errors?.join("; "));
});
`;
}

function scaffoldManifestBundleConsistency(args) {
  return `const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..", "..");
const BUNDLE_DIR = resolve(ROOT, ${JSON.stringify(args.bundleDir)});

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test(${JSON.stringify(args.title)}, () => {
  const manifest = readJson(join(BUNDLE_DIR, "manifest.json"));
  const bundle = readJson(join(BUNDLE_DIR, "bundle.json"));
  const spec = readJson(join(BUNDLE_DIR, manifest.specPath));

  assert.deepEqual(bundle.spec, spec);
  assert.deepEqual(bundle.schemas, manifest.schemas);
  assert.equal(bundle.artifacts.length, manifest.artifacts.length);
});
`;
}

function explainFailureText(text) {
  if (!text) {
    return {
      kind: "unknown",
      summary: "No output provided.",
    };
  }
  if (text.includes("No test suite found in file")) {
    return {
      kind: "runner_migration_gap",
      summary: "Runner discovered a file but no tests registered under the current framework.",
      suggestion: "Check whether the file still depends on legacy node:test patterns or is a wrapper file that should be excluded.",
    };
  }
  if (text.includes("is not a function")) {
    return {
      kind: "missing_runtime_api",
      summary: "The test expects an API that is not exposed by the current implementation.",
      suggestion: "Verify whether this is a pre-existing product/runtime gap rather than a harness migration issue.",
    };
  }
  if (text.includes("ERR_MODULE_NOT_FOUND")) {
    return {
      kind: "module_resolution",
      summary: "A required module could not be resolved at runtime.",
      suggestion: "Check dependency installation, runner loader configuration, and path assumptions.",
    };
  }
  if (text.includes("EPERM") && text.includes("listen")) {
    return {
      kind: "sandbox_or_port_binding",
      summary: "The test tried to bind a local port and failed.",
      suggestion: "Run this under the browser-native or local-server path, or adjust the environment assumptions.",
    };
  }
  if (text.includes("AssertionError") || text.includes("assert.")) {
    return {
      kind: "assertion_failure",
      summary: "A test assertion failed.",
      suggestion: "Inspect expected vs actual values in the reported assertion context.",
    };
  }
  return {
    kind: "unknown",
    summary: "Failure did not match a built-in classifier.",
  };
}

export const testingTools = [
  createHandlerTool({
    name: "ak_test_list_suites",
    description: "List discovered test suites and current runner ownership from the inventory report.",
    inputSchema: {
      properties: {},
    },
    handler: async () => {
      const inventory = ensureInventory();
      ensureClassification();
      return {
        ok: true,
        inventoryPath: relative(ROOT, INVENTORY_PATH),
        classificationPath: relative(ROOT, CLASSIFICATION_PATH),
        summary: inventory.summary,
        recipes: listRecipeMetadata(),
        scaffoldableRecipes: SCAFFOLDABLE_RECIPES,
      };
    },
  }),
  createHandlerTool({
    name: "ak_test_discover_patterns",
    description: "Discover repo test recipes and matching files, optionally filtered by runner or suite.",
    inputSchema: {
      properties: {
        runner: stringSchema("Optional runner filter."),
        suite: stringSchema("Optional suite filter."),
        recipe: stringSchema("Optional recipe filter."),
      },
    },
    handler: async (args) => {
      const inventory = ensureInventory();
      const files = inventory.files.filter((entry) => {
        if (args.runner && entry.runner !== args.runner) return false;
        if (args.suite && entry.suite !== args.suite) return false;
        if (args.recipe && entry.recipe !== args.recipe) return false;
        return true;
      });
      return {
        ok: true,
        count: files.length,
        files,
        recipes: listRecipeMetadata(),
      };
    },
  }),
  createHandlerTool({
    name: "ak_test_plan_from_change",
    description: "Recommend runner scopes from changed paths.",
    inputSchema: {
      required: ["paths"],
      properties: {
        paths: stringArraySchema("Changed repository-relative paths."),
      },
    },
    handler: async (args) => {
      const paths = args.paths ?? [];
      const runners = new Set();
      const suites = new Set();
      for (const path of paths) {
        if (path.startsWith("packages/ui-web/") || path.startsWith("tests/ui-web/") || path.includes("serve-ui")) {
          runners.add("playwright");
          suites.add("ui-web");
          continue;
        }
        runners.add("vitest");
        if (path.startsWith("packages/adapters-cli/")) suites.add("adapters-cli");
        if (path.startsWith("packages/runtime/")) suites.add("runtime");
        if (path.startsWith("packages/core-ts/")) suites.add("core-ts");
        if (path.startsWith("tests/")) suites.add(path.split("/")[1] || "tests");
      }
      return {
        ok: true,
        runners: [...runners],
        suites: [...suites].sort((left, right) => left.localeCompare(right)),
      };
    },
  }),
  createHandlerTool({
    name: "ak_test_run",
    description: "Run the test harness inventory, Vitest, Playwright, legacy, or combined matrix scripts.",
    inputSchema: {
      required: ["mode"],
      properties: {
        mode: stringSchema("One of inventory, classify, coverage, recipe-adoption, parity, vitest, playwright, legacy, all."),
        args: stringArraySchema("Additional args passed to the selected runner script."),
      },
    },
    handler: async (args) => {
      const result = runNodeScript("scripts/testing/test-matrix.mjs", [args.mode, ...(args.args ?? [])]);
      return {
        ok: result.ok,
        mode: args.mode,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  }),
  createHandlerTool({
    name: "ak_test_scaffold_case",
    description: "Scaffold a new test file from a limited structured recipe set.",
    inputSchema: {
      required: ["recipe", "targetFile", "title"],
      properties: {
        recipe: stringSchema(`Recipe family. Supported scaffold recipes: ${SCAFFOLDABLE_RECIPES.join(", ")}.`),
        targetFile: pathSchema("Repository-relative output path."),
        title: stringSchema("Test title."),
        commandArgs: stringArraySchema("CLI command args for cli_success_artifacts."),
        expectedArtifacts: stringArraySchema("Artifacts expected to exist."),
        forbiddenArtifacts: stringArraySchema("Artifacts expected not to exist."),
        expectedErrorPattern: stringSchema("Regex source expected in stderr for cli_failure_message."),
        fixturePath: pathSchema("Repository-relative fixture JSON path for artifact_schema_roundtrip."),
        validatorModule: stringSchema("Repository-relative ESM module path for artifact_schema_roundtrip."),
        validatorExport: stringSchema("Named export for the validator function."),
        bundleDir: pathSchema("Repository-relative bundle fixture directory for manifest_bundle_consistency."),
        bundlePath: pathSchema("Repository-relative bundle fixture file for browser_bundle_load_flow."),
        targetPaths: stringArraySchema("Repository-relative adapter entrypoint paths for adapter_port_contract."),
        modulePath: pathSchema("Repository-relative ESM module path for budget_policy_invariant."),
        exportName: stringSchema("Named export to invoke for budget_policy_invariant."),
        inputJson: stringSchema("Serialized JS object literal argument for budget_policy_invariant."),
        expectedChecks: stringArraySchema("Expected result checks for budget_policy_invariant as path=<json>."),
        runtimeModulePath: pathSchema("Repository-relative ESM module path for runtime_module_contract."),
        runtimeExportName: stringSchema("Named export to invoke for runtime_module_contract."),
        runtimeInputJson: stringSchema("Serialized JS object literal argument for runtime_module_contract."),
        runtimeExpectedChecks: stringArraySchema("Expected result checks for runtime_module_contract as path=<json>."),
        personaModulePath: pathSchema("Repository-relative ESM state-machine module path for runtime_persona_transition."),
        factoryName: stringSchema("Factory export name for runtime_persona_transition."),
        statesEnum: stringSchema("States enum export name for runtime_persona_transition."),
        happyFixturePath: pathSchema("Relative fixture path from test file to happy transition fixture."),
        guardFixturePath: pathSchema("Relative fixture path from test file to guard transition fixture."),
        counterChecks: stringArraySchema("Counter checks as fixtureField:contextField for runtime_persona_transition."),
        retainedField: stringSchema("Context field that should remain unchanged on retainEvent."),
        retainEvent: stringSchema("Event name that should preserve retainedField."),
        equivalenceCliArgs: stringSchema("Serialized JS array literal of CLI args for ui_cli_equivalence."),
        adapterMethod: stringSchema("Adapter method name for ui_cli_equivalence."),
        adapterCallJson: stringSchema("Serialized JS object literal adapter call payload for ui_cli_equivalence."),
        equivalenceEnvJson: stringSchema("Serialized JS object literal env overrides for ui_cli_equivalence."),
        expectedOk: stringSchema("Optional boolean-like flag for artifact_schema_roundtrip."),
        startPort: integerSchema("Start port override for serve_ui_redirect_health.", { minimum: 1 }),
      },
    },
    handler: async (args) => {
      const targetPath = resolve(ROOT, args.targetFile);
      mkdirSync(dirname(targetPath), { recursive: true });
      let content;
      switch (args.recipe) {
        case "cli_success_artifacts":
          content = scaffoldCliSuccess(args);
          break;
        case "cli_failure_message":
          content = scaffoldCliFailure(args);
          break;
        case "artifact_schema_roundtrip":
          content = scaffoldArtifactSchemaRoundtrip(args);
          break;
        case "manifest_bundle_consistency":
          content = scaffoldManifestBundleConsistency(args);
          break;
        case "browser_bundle_load_flow":
          content = scaffoldBrowserBundleLoadFlow(args);
          break;
        case "adapter_port_contract":
          content = scaffoldAdapterPortContract(args);
          break;
        case "budget_policy_invariant":
          content = scaffoldBudgetPolicyInvariant(args);
          break;
        case "runtime_module_contract":
          content = scaffoldRuntimeModuleContract({
            title: args.title,
            modulePath: args.runtimeModulePath ?? args.modulePath,
            exportName: args.runtimeExportName ?? args.exportName,
            inputJson: args.runtimeInputJson ?? args.inputJson,
            expectedChecks: args.runtimeExpectedChecks ?? args.expectedChecks,
          });
          break;
        case "runtime_persona_transition":
          content = scaffoldRuntimePersonaTransition(args);
          break;
        case "ui_cli_equivalence":
          content = scaffoldUiCliEquivalence(args);
          break;
        case "serve_ui_redirect_health":
          content = scaffoldServeUiRedirect(args);
          break;
        default:
          throw new Error(`Unsupported scaffold recipe: ${args.recipe}`);
      }
      writeFileSync(targetPath, content, "utf8");
      return {
        ok: true,
        targetFile: args.targetFile,
        recipe: args.recipe,
      };
    },
  }),
  createHandlerTool({
    name: "ak_test_insert_case",
    description: "Append a scaffolded case to an existing test file.",
    inputSchema: {
      required: ["recipe", "targetFile", "title"],
      properties: {
        recipe: stringSchema(`Recipe family. Supported scaffold recipes: ${SCAFFOLDABLE_RECIPES.join(", ")}.`),
        targetFile: pathSchema("Repository-relative output path."),
        title: stringSchema("Test title."),
        commandArgs: stringArraySchema("CLI command args for cli_success_artifacts."),
        expectedArtifacts: stringArraySchema("Artifacts expected to exist."),
        forbiddenArtifacts: stringArraySchema("Artifacts expected not to exist."),
        expectedErrorPattern: stringSchema("Regex source expected in stderr for cli_failure_message."),
        fixturePath: pathSchema("Repository-relative fixture JSON path for artifact_schema_roundtrip."),
        validatorModule: stringSchema("Repository-relative ESM module path for artifact_schema_roundtrip."),
        validatorExport: stringSchema("Named export for the validator function."),
        bundleDir: pathSchema("Repository-relative bundle fixture directory for manifest_bundle_consistency."),
        bundlePath: pathSchema("Repository-relative bundle fixture file for browser_bundle_load_flow."),
        targetPaths: stringArraySchema("Repository-relative adapter entrypoint paths for adapter_port_contract."),
        modulePath: pathSchema("Repository-relative ESM module path for budget_policy_invariant."),
        exportName: stringSchema("Named export to invoke for budget_policy_invariant."),
        inputJson: stringSchema("Serialized JS object literal argument for budget_policy_invariant."),
        expectedChecks: stringArraySchema("Expected result checks for budget_policy_invariant as path=<json>."),
        runtimeModulePath: pathSchema("Repository-relative ESM module path for runtime_module_contract."),
        runtimeExportName: stringSchema("Named export to invoke for runtime_module_contract."),
        runtimeInputJson: stringSchema("Serialized JS object literal argument for runtime_module_contract."),
        runtimeExpectedChecks: stringArraySchema("Expected result checks for runtime_module_contract as path=<json>."),
        personaModulePath: pathSchema("Repository-relative ESM state-machine module path for runtime_persona_transition."),
        factoryName: stringSchema("Factory export name for runtime_persona_transition."),
        statesEnum: stringSchema("States enum export name for runtime_persona_transition."),
        happyFixturePath: pathSchema("Relative fixture path from test file to happy transition fixture."),
        guardFixturePath: pathSchema("Relative fixture path from test file to guard transition fixture."),
        counterChecks: stringArraySchema("Counter checks as fixtureField:contextField for runtime_persona_transition."),
        retainedField: stringSchema("Context field that should remain unchanged on retainEvent."),
        retainEvent: stringSchema("Event name that should preserve retainedField."),
        equivalenceCliArgs: stringSchema("Serialized JS array literal of CLI args for ui_cli_equivalence."),
        adapterMethod: stringSchema("Adapter method name for ui_cli_equivalence."),
        adapterCallJson: stringSchema("Serialized JS object literal adapter call payload for ui_cli_equivalence."),
        equivalenceEnvJson: stringSchema("Serialized JS object literal env overrides for ui_cli_equivalence."),
        expectedOk: stringSchema("Optional boolean-like flag for artifact_schema_roundtrip."),
        startPort: integerSchema("Start port override for serve_ui_redirect_health.", { minimum: 1 }),
      },
    },
    handler: async (args) => {
      const targetPath = resolve(ROOT, args.targetFile);
      const previous = existsSync(targetPath) ? readFileSync(targetPath, "utf8").trimEnd() : "";
      let fragment;
      switch (args.recipe) {
        case "cli_success_artifacts":
          fragment = scaffoldCliSuccess(args).trim();
          break;
        case "cli_failure_message":
          fragment = scaffoldCliFailure(args).trim();
          break;
        case "artifact_schema_roundtrip":
          fragment = scaffoldArtifactSchemaRoundtrip(args).trim();
          break;
        case "manifest_bundle_consistency":
          fragment = scaffoldManifestBundleConsistency(args).trim();
          break;
        case "browser_bundle_load_flow":
          fragment = scaffoldBrowserBundleLoadFlow(args).trim();
          break;
        case "adapter_port_contract":
          fragment = scaffoldAdapterPortContract(args).trim();
          break;
        case "budget_policy_invariant":
          fragment = scaffoldBudgetPolicyInvariant(args).trim();
          break;
        case "runtime_module_contract":
          fragment = scaffoldRuntimeModuleContract({
            title: args.title,
            modulePath: args.runtimeModulePath ?? args.modulePath,
            exportName: args.runtimeExportName ?? args.exportName,
            inputJson: args.runtimeInputJson ?? args.inputJson,
            expectedChecks: args.runtimeExpectedChecks ?? args.expectedChecks,
          }).trim();
          break;
        case "runtime_persona_transition":
          fragment = scaffoldRuntimePersonaTransition(args).trim();
          break;
        case "ui_cli_equivalence":
          fragment = scaffoldUiCliEquivalence(args).trim();
          break;
        case "serve_ui_redirect_health":
          fragment = scaffoldServeUiRedirect(args).trim();
          break;
        default:
          throw new Error(`Unsupported insert recipe: ${args.recipe}`);
      }
      const next = previous ? `${previous}\n\n${fragment}\n` : `${fragment}\n`;
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, next, "utf8");
      return {
        ok: true,
        targetFile: args.targetFile,
        recipe: args.recipe,
      };
    },
  }),
  createHandlerTool({
    name: "ak_test_explain_failure",
    description: "Classify a test failure from runner output into a small set of migration-focused categories.",
    inputSchema: {
      required: ["text"],
      properties: {
        text: stringSchema("Runner output or failure excerpt."),
      },
    },
    handler: async (args) => ({
      ok: true,
      explanation: explainFailureText(args.text),
    }),
  }),
  createHandlerTool({
    name: "ak_test_lint_structure",
    description: "Report structural migration gaps: uncategorized recipes, codemod exceptions, and browser candidates.",
    inputSchema: {
      properties: {},
    },
    handler: async () => {
      const inventory = ensureInventory();
      const codemod = readCodemodExceptions();
      const browserCandidates = inventory.files.filter((entry) => entry.runner === "playwright");
      const uncategorized = inventory.files.filter((entry) => entry.recipe === "general");
      const adoption = runNodeScript("scripts/testing/check-test-recipe-adoption.mjs");
      return {
        ok: true,
        uncategorizedCount: uncategorized.length,
        uncategorized: uncategorized.map((entry) => entry.path),
        codemodExceptionCount: codemod.count ?? 0,
        codemodExceptions: codemod.exceptions ?? [],
        browserCandidateCount: browserCandidates.length,
        browserCandidates: browserCandidates.map((entry) => entry.path),
        recipeAdoption: adoption.parsed ?? null,
        scaffoldableRecipes: SCAFFOLDABLE_RECIPES,
      };
    },
  }),
];
