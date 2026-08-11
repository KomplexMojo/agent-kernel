import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { authoringSpec } from "../../packages/adapters-cli/src/mcp/tools/authoring.mjs";
import { buildArgv } from "../../packages/adapters-cli/src/mcp/tools/shared.mjs";

const require = createRequire(import.meta.url);
const {
  CATALOG_DIR,
  loadScenarioCatalog,
} = require("../remote-ollama-control/scripts/lib/ak-scenarios.js");

const ROOT = resolve(process.env.AGENT_KERNEL_ROOT || process.cwd());
const CLI = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const OUTPUT_DIR = resolve(
  process.env.AK_BENCHMARK_OUTPUT_DIR || join(ROOT, "tools/benchmark/out"),
);
const ARTIFACT_ROOT = join(OUTPUT_DIR, "Reference Artifacts");
const UNCONSTRAINED_BUDGET = 1_000_000;
const VAULT_PREFIX = process.env.AK_BENCHMARK_VAULT_PREFIX
  || "/Users/darren/Documents/Obsidian/agent-kernel-vault";
const ALLOW_VAULT_WRITE = process.env.AK_BENCHMARK_ALLOW_VAULT_WRITE === "1";
const UPDATE_CATALOG = process.env.AK_BENCHMARK_UPDATE_CATALOG === "1";
const PAYLOAD_ARRAY_FIELDS = ["room", "floorTile", "hazard", "resource", "delver", "warden"];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseJsonLine(stdout) {
  const lines = String(stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }
  return null;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readJsonIfPresent(file) {
  return existsSync(file) ? readJson(file) : null;
}

function markdownTable(headers, rows) {
  const escape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => join(dir, entry));
}

function costTotals(lineItems = []) {
  const totals = new Map();
  for (const item of lineItems) {
    const key = `${item.kind}:${item.status}`;
    const current = totals.get(key) || { kind: item.kind, status: item.status, total: 0 };
    current.total += Number(item.totalCost || 0);
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.status.localeCompare(right.status));
}

export function scenarioPayloadForOutput(scenario, outDir, budgetTokens = scenario.payload.budgetTokens) {
  return {
    ...scenario.payload,
    budgetTokens,
    outDir,
  };
}

function runCli(payload) {
  mkdirSync(payload.outDir, { recursive: true });
  const args = buildArgv(payload, authoringSpec);
  const result = spawnSync(process.execPath, [CLI, "create", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: parseJsonLine(result.stdout),
    receipt: readJsonIfPresent(join(payload.outDir, "budget-receipt.json")),
  };
}

export function classifyOutcome(result) {
  if (result.exitCode === 0 && result.json?.ok === true) return "success";
  const detail = [result.json?.error, result.stderr, result.stdout].filter(Boolean).join("\n");
  if (/Budget (?:receipt )?(?:denied|insufficient)/i.test(detail)) return "budget_denied";
  return "unexpected_failure";
}

function deniedRemaining(result) {
  const detail = [result.json?.error, result.stderr, result.stdout].filter(Boolean).join("\n");
  const match = detail.match(/\bremaining=(-?\d+)\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function deriveReference(spec, receipt) {
  const cardSet = spec?.plan?.hints?.cardSet;
  if (!Array.isArray(cardSet)) throw new Error("reference spec has no plan.hints.cardSet");
  if (!Number.isFinite(receipt?.totalCost) || receipt.totalCost < 0) {
    throw new Error("reference receipt has no non-negative totalCost");
  }
  const entityCounts = {};
  const affinitySets = {};
  for (const card of cardSet) {
    const type = card?.type || "unknown";
    entityCounts[type] = (entityCounts[type] || 0) + (card?.count || 1);
    if (!affinitySets[type]) affinitySets[type] = new Set();
    if (card?.affinity) affinitySets[type].add(card.affinity);
  }
  const affinitiesByType = Object.fromEntries(
    Object.entries(affinitySets).map(([type, values]) => [type, [...values].sort()]),
  );
  return {
    entityCounts,
    affinitiesByType,
    totalSpend: receipt.totalCost,
  };
}

function describeFailure(scenario, result) {
  return [
    `Scenario ${scenario.index} ${scenario.title} failed unexpectedly (exit ${result.exitCode})`,
    result.json?.error,
    result.stderr,
    result.stdout,
  ].filter(Boolean).join("\n");
}

function generateScenario(scenario) {
  const number = String(scenario.index).padStart(2, "0");
  const slug = slugify(scenario.title);
  const artifactDir = join(ARTIFACT_ROOT, `${number}-${slug}`);
  const outDir = join(artifactDir, "create");
  rmSync(artifactDir, { recursive: true, force: true });

  const canonicalPayload = scenarioPayloadForOutput(scenario, outDir);
  const canonicalResult = runCli(canonicalPayload);
  const actualOutcome = classifyOutcome(canonicalResult);
  if (actualOutcome !== scenario.expectedOutcome) {
    throw new Error([
      `Scenario ${scenario.index} expected ${scenario.expectedOutcome}, received ${actualOutcome}.`,
      describeFailure(scenario, canonicalResult),
    ].join("\n"));
  }

  let referenceResult = canonicalResult;
  if (actualOutcome === "budget_denied") {
    rmSync(outDir, { recursive: true, force: true });
    referenceResult = runCli(scenarioPayloadForOutput(scenario, outDir, UNCONSTRAINED_BUDGET));
    if (classifyOutcome(referenceResult) !== "success") {
      throw new Error(`Scenario ${scenario.index} could not produce an unconstrained reference.\n${describeFailure(scenario, referenceResult)}`);
    }
  }

  const spec = readJson(join(outDir, "spec.json"));
  const referenceReceipt = referenceResult.receipt || readJson(join(outDir, "budget-receipt.json"));
  const canonicalReceipt = canonicalResult.receipt;
  scenario.reference = deriveReference(spec, referenceReceipt);
  scenario.referenceSpend = scenario.reference.totalSpend;
  scenario.remaining = actualOutcome === "budget_denied"
    ? (deniedRemaining(canonicalResult) ?? 0)
    : (canonicalReceipt?.remaining ?? referenceReceipt.remaining);
  scenario.status = actualOutcome === "budget_denied"
    ? "denied"
    : (canonicalReceipt?.status || referenceReceipt.status || actualOutcome);
  scenario.legacyReferencePath = `Reference Artifacts/${number}-${slug}/create`;

  const notePath = join(OUTPUT_DIR, `${number} ${scenario.title}.md`);
  writeFileSync(notePath, renderNote({
    scenario,
    outDir,
    actualOutcome,
    canonicalReceipt,
    referenceReceipt,
  }));

  return {
    number,
    title: scenario.title,
    notePath,
    runId: scenario.runId,
    expectedOutcome: scenario.expectedOutcome,
    referenceSpend: scenario.referenceSpend,
    remaining: scenario.remaining,
    status: scenario.status,
    outDir,
  };
}

function objectRows(payload) {
  const labels = {
    room: "Room",
    floorTile: "Floor tile",
    hazard: "Hazard",
    resource: "Resource",
    delver: "Delver",
    warden: "Warden",
  };
  const rows = [];
  for (const field of PAYLOAD_ARRAY_FIELDS) {
    for (const spec of payload[field] || []) rows.push([labels[field], spec]);
  }
  return rows.length > 0 ? rows : [["None", "No authored object specs"]];
}

function renderNote({ scenario, outDir, actualOutcome, canonicalReceipt, referenceReceipt }) {
  const lineItems = Array.isArray(referenceReceipt.lineItems) ? referenceReceipt.lineItems : [];
  const artifactRows = listJsonFiles(outDir).map((file) => [basename(file), file]);
  const totalRows = costTotals(lineItems).map((entry) => [entry.kind, entry.status, entry.total]);
  const costRows = lineItems.map((item) => [
    item.id,
    item.kind,
    item.quantity,
    item.unitCost,
    item.totalCost,
    item.status,
  ]);
  const copyablePayload = scenarioPayloadForOutput(scenario, outDir);
  return `# ${String(scenario.index).padStart(2, "0")} ${scenario.title}

Prompt: ${scenario.prompt}

## Reference Result

- MCP tool to call: \`ak_create\`
- Reference generation path: \`ak.mjs create\` through the shared MCP argument mapping
- Expected canonical outcome: \`${scenario.expectedOutcome}\`
- Observed canonical outcome: \`${actualOutcome}\`
- Run id: \`${scenario.runId}\`
- Output directory: \`${outDir}\`
- Canonical budget cap: \`${scenario.payload.budgetTokens}\`
- Canonical receipt status: \`${canonicalReceipt?.status || actualOutcome}\`
- Reference total spend: \`${referenceReceipt.totalCost}\`
- Canonical remaining: \`${scenario.remaining}\`

## Resulting Artifact File Locations

${markdownTable(["Artifact", "Path"], artifactRows)}

## Items Created

${markdownTable(["Kind", "Requested configuration"], objectRows(scenario.payload))}

## Cost By Kind

${markdownTable(["Kind", "Status", "Total cost"], totalRows)}

## Configuration Cost Details

${markdownTable(["Item", "Kind", "Quantity", "Unit cost", "Total cost", "Status"], costRows)}

## MCP Payload

\`\`\`json
${JSON.stringify(copyablePayload, null, 2)}
\`\`\`
`;
}

function writeCatalog(scenarios) {
  const byId = new Map(scenarios.map((scenario) => [scenario.index, scenario]));
  for (const tier of ["simple", "affinity", "complex", "constrained"]) {
    const file = join(CATALOG_DIR, `${tier}.json`);
    const document = readJson(file);
    document.scenarios = document.scenarios.map((scenario) => byId.get(scenario.index));
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  }
}

function renderIndex(rows, scenarioSet) {
  return `# Agent Kernel MCP Prompt Baselines

Generated: ${new Date().toISOString()}

These ${rows.length} prompts are loaded from the repository-owned content-generation catalog.
Scenario set: \`${scenarioSet.sha256}\` (${Object.entries(scenarioSet.tierCounts).map(([tier, count]) => `${tier}=${count}`).join(", ")}).

${markdownTable(
    ["#", "Prompt", "Note path", "Run id", "Expected", "Reference spend", "Remaining", "Status", "Artifact dir"],
    rows.map((row) => [
      row.number,
      row.title,
      row.notePath,
      row.runId,
      row.expectedOutcome,
      row.referenceSpend,
      row.remaining,
      row.status,
      row.outDir,
    ]),
  )}
`;
}

export function generateBaselines() {
  if (!ALLOW_VAULT_WRITE && VAULT_PREFIX && OUTPUT_DIR.startsWith(VAULT_PREFIX)) {
    throw new Error(
      `Refusing to write benchmark output under the read-only vault path: ${OUTPUT_DIR}\n`
      + "Set AK_BENCHMARK_ALLOW_VAULT_WRITE=1 to override.",
    );
  }
  const catalog = loadScenarioCatalog();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const rows = catalog.scenarios.map(generateScenario);
  if (UPDATE_CATALOG) writeCatalog(catalog.scenarios);
  const finalCatalog = UPDATE_CATALOG ? loadScenarioCatalog() : catalog;
  writeFileSync(join(OUTPUT_DIR, "Index.md"), renderIndex(rows, finalCatalog));
  return {
    ok: true,
    count: rows.length,
    scenarioSetHash: finalCatalog.sha256,
    tierCounts: finalCatalog.tierCounts,
    outputDir: OUTPUT_DIR,
    artifactRoot: ARTIFACT_ROOT,
    catalogUpdated: UPDATE_CATALOG,
  };
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    console.log(JSON.stringify(generateBaselines(), null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
