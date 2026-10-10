#!/usr/bin/env node
/**
 * First-class structured Vitest failure report (fast-pass shape).
 *
 * Runs the suite with the JSON reporter, extracts failures, assigns a category,
 * and prints only:
 *   { total, passed, failed, failures: [{ test, file, category, message }] }
 *
 * Human-readable default remains `pnpm run test`. This script is the machine
 * triage surface: `pnpm run test:structured`.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, runProcess } from "./shared.mjs";

/** Category rules — order is first-match-wins; keep in sync with fast-pass.md. */
export const CATEGORY_RULES = Object.freeze([
  {
    category: "Dependency Inversion",
    signals: [
      /forbidden/i,
      /upward import/i,
      /core-ts importing/i,
      /runtime importing adapters/i,
      /runtime importing ui-web/i,
    ],
  },
  {
    category: "Effect Routing",
    signals: [
      /ports\/effects/i,
      /effect executed inline/i,
      /adapter boundary/i,
      /\bIO in (runtime|core-ts)\b/i,
    ],
  },
  {
    category: "Persona FSM Violation",
    signals: [
      /\badvance\(/i,
      /\bview\(\)/i,
      /state handler/i,
      /label-only/i,
      /injected clock/i,
      /tests\/personas\//i,
      /clock read in persona/i,
    ],
  },
  {
    category: "Schema Mismatch",
    signals: [
      /schemaVersion/i,
      /\bschema\b/i,
      /contracts\/artifacts/i,
      /tests\/contracts\//i,
      /validation/i,
    ],
  },
  {
    category: "Serialization",
    signals: [
      /not serializable/i,
      /class instance/i,
      /circular/i,
      /\bMap\b/,
      /\bSet\b/,
    ],
  },
  {
    category: "Determinism",
    signals: [
      /Date\.now/i,
      /Math\.random/i,
      /injected clock/i,
      /run-to-run/i,
      /replay mismatch/i,
    ],
  },
  {
    category: "Fixture Corruption",
    signals: [
      /fixture/i,
      /tests\/fixtures\//i,
      /parse error/i,
      /invalid negative/i,
    ],
  },
]);

/**
 * @param {string} haystack file path + failure message
 * @returns {string}
 */
export function categorizeFailure(haystack) {
  const text = String(haystack ?? "");
  for (const rule of CATEGORY_RULES) {
    if (rule.signals.some((re) => re.test(text))) {
      return rule.category;
    }
  }
  return "Uncategorized";
}

/**
 * @param {object} vitestJson Vitest JSON reporter output
 * @param {string} [cwd] process.cwd() used to relativize file paths
 * @returns {{ total: number, passed: number, failed: number, failures: Array<{test: string, file: string, category: string, message: string}> }}
 */
export function extractStructuredReport(vitestJson, cwd = process.cwd()) {
  const root = String(cwd || "").replace(/\/$/, "");
  const stripRoot = (name) => {
    const raw = String(name ?? "");
    if (root && raw.startsWith(root + "/")) {
      return raw.slice(root.length + 1);
    }
    return raw;
  };

  const failures = [];
  for (const fileResult of vitestJson?.testResults ?? []) {
    const file = stripRoot(fileResult.name);
    for (const assertion of fileResult.assertionResults ?? []) {
      if (assertion.status !== "failed") continue;
      const message = (assertion.failureMessages || [])
        .join("\n")
        .split("\n")
        .slice(0, 6)
        .join("\n");
      const test = assertion.fullName || assertion.title || "(unnamed)";
      failures.push({
        test,
        file,
        category: categorizeFailure(`${file}\n${message}`),
        message,
      });
    }
  }

  return {
    total: Number(vitestJson?.numTotalTests ?? 0),
    passed: Number(vitestJson?.numPassedTests ?? 0),
    failed: Number(vitestJson?.numFailedTests ?? failures.length),
    failures,
  };
}

function runStructuredReport(passthroughArgs = []) {
  const outDir = mkdtempSync(join(tmpdir(), "ak-structured-test-"));
  const outputFile = join(outDir, "vitest.json");
  try {
    const args = [
      "exec",
      "vitest",
      "--config",
      "vitest.config.mjs",
      "run",
      "--reporter=json",
      `--outputFile=${outputFile}`,
      ...passthroughArgs,
    ];
    // Non-zero exit means failures exist — still parse the JSON.
    runProcess("pnpm", args, { cwd: ROOT });

    let vitestJson;
    try {
      vitestJson = JSON.parse(readFileSync(outputFile, "utf8"));
    } catch (err) {
      const report = {
        total: 0,
        passed: 0,
        failed: 1,
        failures: [
          {
            test: "structured-test-report",
            file: "scripts/testing/structured-test-report.mjs",
            category: "Uncategorized",
            message: `failed to read Vitest JSON at ${outputFile}: ${err.message}`,
          },
        ],
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 1;
    }

    const report = extractStructuredReport(vitestJson, ROOT);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.failed > 0 ? 1 : 0;
  } finally {
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const passthroughArgs = process.argv.slice(2).filter((arg) => arg !== "--");
  process.exit(runStructuredReport(passthroughArgs));
}
