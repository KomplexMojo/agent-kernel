import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadScenarioCatalog } = require("../remote-ollama-control/scripts/lib/ak-scenarios.js");

const OUTPUT = resolve(
  fileURLToPath(new URL("../remote-ollama-control/benchmarks/abstract-plan/parallel.json", import.meta.url)),
);
const ARRAY_FIELDS = ["room", "floorTile", "hazard", "resource", "delver", "warden"];

function capacityOf(spec) {
  if (spec && typeof spec === "object" && Number.isInteger(spec.count) && spec.count > 0) return spec.count;
  const match = String(spec || "").match(/(?:^|;)count=(\d+)(?:;|$)/);
  return match ? Number.parseInt(match[1], 10) : 1;
}

export function buildParallelScenario(source) {
  const components = [];
  const selections = [];
  const mappings = {};
  const categoryQuantities = {};
  const minimumCapacityByCategory = {};
  const requiredSignalsByCategory = {};
  let ordinal = 0;
  let minimumCost = 0;

  ARRAY_FIELDS.forEach((target, fieldIndex) => {
    const specs = source.payload[target] || [];
    if (specs.length === 0) return;
    const category = `g${String(fieldIndex + 1).padStart(2, "0")}`;
    categoryQuantities[category] = specs.length;
    minimumCapacityByCategory[category] = 0;
    requiredSignalsByCategory[category] = [];
    for (const spec of specs) {
      ordinal += 1;
      const suffix = String(ordinal).padStart(3, "0");
      const componentId = `C-${suffix}`;
      const distractorId = `X-${suffix}`;
      const signal = `s${suffix}`;
      const unitCost = 10 + ordinal;
      const capacity = capacityOf(spec);
      const common = { category, capacity, signals: [signal], maxQuantity: 1 };
      components.push({ id: componentId, unitCost, ...common });
      components.push({ id: distractorId, unitCost: unitCost + 50, ...common });
      selections.push({ componentId, quantity: 1 });
      mappings[componentId] = { target, spec };
      mappings[distractorId] = { target, spec };
      minimumCost += unitCost;
      minimumCapacityByCategory[category] += capacity;
      requiredSignalsByCategory[category].push(signal);
    }
  });

  if (components.length === 0) throw new Error(`content scenario ${source.index} has no mapped components`);
  const fixedArgs = {};
  if (source.budgetMode === "constrained") fixedArgs.budgetTokens = source.budget;
  if (source.payload.dungeonAffinity) fixedArgs.dungeonAffinity = source.payload.dungeonAffinity;
  return {
    index: source.index,
    id: `ap-parallel-${String(source.index).padStart(3, "0")}`,
    title: `Parallel abstract scenario ${String(source.index).padStart(3, "0")}`,
    expectedOutcome: source.expectedOutcome,
    sourceScenario: { index: source.index, tier: source.tier },
    problem: {
      schemaVersion: "abstract-component-selection/v1",
      objective: "minimize_total_cost",
      constraints: {
        categoryQuantities,
        minimumCapacityByCategory,
        requiredSignalsByCategory,
        maximumTotalCost: minimumCost + 50,
      },
      components,
    },
    reference: { selections, minimumCost },
    mapping: {
      text: source.prompt,
      fixedArgs,
      components: mappings,
    },
  };
}

export function buildParallelCatalog() {
  const source = loadScenarioCatalog();
  return {
    schemaVersion: "agent-kernel-abstract-plan-catalog/v1",
    sourceScenarioSet: { count: source.count, sha256: source.sha256 },
    scenarios: source.scenarios.map(buildParallelScenario),
  };
}

export function generateParallelCatalog() {
  const rendered = `${JSON.stringify(buildParallelCatalog(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(OUTPUT, "utf8") !== rendered) throw new Error("parallel abstract catalog is stale");
    return { output: OUTPUT, changed: false };
  }
  writeFileSync(OUTPUT, rendered, "utf8");
  return { output: OUTPUT, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(generateParallelCatalog())}\n`);
}
