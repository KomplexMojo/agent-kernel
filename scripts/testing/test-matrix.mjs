import { resolve } from "node:path";
import { LOCAL_CODEX_DIR, assertProcessOk, runProcess } from "./shared.mjs";

const mode = process.argv[2] ?? "inventory";
const extraArgs = process.argv.slice(3);

function runNodeScript(scriptName, args = []) {
  const result = runProcess(process.execPath, [resolve("scripts/testing", scriptName), ...args]);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result;
}

switch (mode) {
  case "inventory":
    process.exit(runNodeScript("inventory-tests.mjs", extraArgs).status ?? 1);
    break;
  case "classify":
    process.exit(runNodeScript("classify-tests.mjs", extraArgs).status ?? 1);
    break;
  case "coverage":
    process.exit(runNodeScript("check-runner-coverage.mjs", extraArgs).status ?? 1);
    break;
  case "recipe-adoption":
    process.exit(runNodeScript("check-test-recipe-adoption.mjs", extraArgs).status ?? 1);
    break;
  case "parity":
    process.exit(runNodeScript("compare-old-vs-new-results.mjs", extraArgs).status ?? 1);
    break;
  case "legacy": {
    const legacy = runProcess("pnpm", ["run", "test:legacy", ...extraArgs]);
    if (legacy.stdout) process.stdout.write(legacy.stdout);
    if (legacy.stderr) process.stderr.write(legacy.stderr);
    process.exit(legacy.status ?? 1);
    break;
  }
  case "vitest": {
    const vitest = runNodeScript("run-vitest.mjs", extraArgs);
    process.exit(vitest.status ?? 1);
    break;
  }
  case "playwright": {
    const playwright = runNodeScript("run-playwright.mjs", extraArgs);
    process.exit(playwright.status ?? 1);
    break;
  }
  case "all": {
    assertProcessOk(runNodeScript("inventory-tests.mjs", [resolve(LOCAL_CODEX_DIR, "test-inventory.json")]), "inventory");
    assertProcessOk(runNodeScript("classify-tests.mjs", [resolve(LOCAL_CODEX_DIR, "test-classification.md")]), "classify");
    assertProcessOk(runNodeScript("check-runner-coverage.mjs"), "coverage");
    assertProcessOk(runNodeScript("check-test-recipe-adoption.mjs"), "recipe-adoption");
    assertProcessOk(runNodeScript("run-vitest.mjs", extraArgs), "vitest");
    assertProcessOk(runNodeScript("run-playwright.mjs", extraArgs), "playwright");
    break;
  }
  default:
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
}
