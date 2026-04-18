import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ROOT = resolve(__dirname, "../..");
export const TEST_ROOT = resolve(ROOT, "tests");
export const LOCAL_CODEX_DIR = resolve(ROOT, "local-codex");

function walkFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function normalizePath(filePath) {
  return relative(ROOT, filePath).split(sep).join("/");
}

function currentDefaultIncluded(relativePath) {
  return relativePath.startsWith("tests/") && relativePath.endsWith(".test.js");
}

function detectBrowserDependency(relativePath, content) {
  return relativePath.startsWith("tests/ui-web/")
    || relativePath === "tests/scripts/serve-ui.test.js"
    || relativePath.startsWith("tests/playwright/")
    || content.includes("playwright-cli")
    || content.includes("from \"@playwright/test\"")
    || content.includes("from '@playwright/test'");
}

function detectRunner(relativePath, content) {
  if (detectBrowserDependency(relativePath, content)) {
    return "playwright";
  }
  return "vitest";
}

function detectRecipe(relativePath, content) {
  if (relativePath.includes("ui-cli-equivalence")) {
    return "ui_cli_equivalence";
  }
  if (
    relativePath.startsWith("tests/ui-web/")
    || relativePath.startsWith("tests/playwright/")
    || relativePath.startsWith("tests/integration/ui-")
    || relativePath === "tests/ui-startup-readiness.test.js"
  ) {
    return "browser_bundle_load_flow";
  }
  if (relativePath.includes("serve-ui")) {
    return "serve_ui_redirect_health";
  }
  if (relativePath.startsWith("tests/core-as/") || content.includes("loadCoreFromWasmPath")) {
    return "wasm_effect_contract";
  }
  if (relativePath.startsWith("tests/bindings/") || relativePath === "tests/wasm-presence.test.js") {
    return "wasm_effect_contract";
  }
  if (relativePath.startsWith("tests/personas/")) {
    return "runtime_persona_transition";
  }
  if (relativePath.startsWith("tests/adapters-test/") || relativePath.startsWith("tests/adapters-web/")) {
    return "adapter_port_contract";
  }
  if (relativePath.startsWith("tests/allocator/") || relativePath.startsWith("tests/financial-model/")) {
    return "budget_policy_invariant";
  }
  if (relativePath.startsWith("tests/perf/")) {
    return "perf_harness_smoke";
  }
  if (content.includes("manifest.json") && content.includes("bundle.json")) {
    return "manifest_bundle_consistency";
  }
  if (relativePath.startsWith("tests/contracts/") || content.includes("schemaVersion")) {
    return "artifact_schema_roundtrip";
  }
  if (relativePath.startsWith("tests/adapters-cli/")) {
    if (content.includes("assert.notEqual(result.status, 0)") || content.includes("assert.match(result.stderr")) {
      return "cli_failure_message";
    }
    return "cli_success_artifacts";
  }
  if (
    relativePath.startsWith("tests/runtime/")
    || relativePath.startsWith("tests/fixtures/")
    || relativePath.startsWith("tests/integration/")
    || relativePath.startsWith("tests/scripts/")
  ) {
    return "runtime_module_contract";
  }
  return "general";
}

function suiteFromPath(relativePath) {
  const parts = relativePath.split("/");
  return parts.length >= 3 ? parts[1] : "root";
}

function detectModuleSystem(relativePath, content) {
  if (relativePath.endsWith(".mjs") || content.includes("import ")) {
    return "esm";
  }
  return "cjs";
}

export function collectTestInventory() {
  const files = walkFiles(TEST_ROOT)
    .map((absolutePath) => {
      const relativePath = normalizePath(absolutePath);
      const content = readFileSync(absolutePath, "utf8");
      const browserDependent = detectBrowserDependency(relativePath, content);
      const runner = detectRunner(relativePath, content);
      return {
        path: relativePath,
        suite: suiteFromPath(relativePath),
        extension: relativePath.split(".").pop() ?? "",
        moduleSystem: detectModuleSystem(relativePath, content),
        sizeBytes: statSync(absolutePath).size,
        browserDependent,
        runner,
        recipe: detectRecipe(relativePath, content),
        currentDefaultIncluded: currentDefaultIncluded(relativePath),
      };
    })
    .filter((entry) => entry.path.includes(".test.") || entry.path.includes(".spec."));

  const summary = {
    total: files.length,
    currentDefaultIncluded: files.filter((entry) => entry.currentDefaultIncluded).length,
    currentDefaultMissed: files.filter((entry) => !entry.currentDefaultIncluded).length,
    byRunner: Object.fromEntries(["vitest", "playwright"].map((runner) => [
      runner,
      files.filter((entry) => entry.runner === runner).length,
    ])),
    bySuite: Object.fromEntries(
      [...new Set(files.map((entry) => entry.suite))]
        .sort((left, right) => left.localeCompare(right))
        .map((suite) => [suite, files.filter((entry) => entry.suite === suite).length]),
    ),
    byRecipe: Object.fromEntries(
      [...new Set(files.map((entry) => entry.recipe))]
        .sort((left, right) => left.localeCompare(right))
        .map((recipe) => [recipe, files.filter((entry) => entry.recipe === recipe).length]),
    ),
  };

  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    summary,
    files,
  };
}

export function writeJson(outputPath, value) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(outputPath, value) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, value, "utf8");
}

export function runProcess(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
}

export function assertProcessOk(result, label) {
  if (result.status === 0) {
    return;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${output ? `:\n${output}` : ""}`);
}
