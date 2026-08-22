import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  canonicalJson,
  loadScenarioCatalog,
} = require("../remote-ollama-control/scripts/lib/ak-scenarios.js");
const {
  evaluateAbstractPlan,
  mapAbstractPlanToCreateArgs,
} = require("../remote-ollama-control/scripts/lib/abstract-plan.js");

const OUTPUT = resolve(
  fileURLToPath(new URL("../remote-ollama-control/benchmarks/abstract-plan/parallel.json", import.meta.url)),
);
const ARRAY_FIELDS = ["room", "floorTile", "hazard", "resource", "delver", "warden"];

function capacityOf(spec) {
  if (spec && typeof spec === "object" && Number.isInteger(spec.count) && spec.count > 0) return spec.count;
  const match = String(spec || "").match(/(?:^|;)count=(\d+)(?:;|$)/);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function digest(...parts) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function opaqueComponentId(sourceSetHash, source, ordinal, role) {
  return `p-${digest(sourceSetHash, source.runId, ordinal, role).slice(0, 12)}`;
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateParallelScenarioProjection(generated, source) {
  if (generated.expectedOutcome !== source.expectedOutcome) {
    throw new Error(`scenario ${source.index} expected outcome must match validated source scenario`);
  }
  if (generated.sourceScenario.index !== source.index || generated.sourceScenario.tier !== source.tier) {
    throw new Error(`scenario ${source.index} source identity must match validated source scenario`);
  }
  const evaluation = evaluateAbstractPlan(generated, generated.reference.selections);
  if (evaluation.score !== 100 || evaluation.totalCost !== generated.reference.minimumCost) {
    throw new Error(`scenario ${source.index} reference is not the unique mapped optimum`);
  }
  const selectedIds = new Set(generated.reference.selections.map((entry) => entry.componentId));
  for (const selected of generated.problem.components.filter((entry) => selectedIds.has(entry.id))) {
    const selectedMapping = generated.mapping.components[selected.id];
    const alternatives = generated.problem.components.filter((candidate) => (
      candidate.id !== selected.id
      && candidate.category === selected.category
      && candidate.capacity === selected.capacity
      && sameValue(candidate.signals, selected.signals)
      && sameValue(generated.mapping.components[candidate.id], selectedMapping)
    ));
    if (alternatives.length !== 1 || alternatives[0].unitCost <= selected.unitCost) {
      throw new Error(`scenario ${source.index} reference is not the unique mapped optimum`);
    }
  }
  const mapped = mapAbstractPlanToCreateArgs(generated, generated.reference.selections, {
    outDir: "/tmp/abstract-projection-validation",
    runId: `abstract-projection-${source.index}`,
  });
  if (mapped.text !== source.prompt
    || mapped.budgetTokens !== (source.budgetMode === "constrained" ? source.budget : undefined)
    || mapped.dungeonAffinity !== source.payload.dungeonAffinity) {
    throw new Error(`scenario ${source.index} fixed mapping must match validated source scenario`);
  }
  for (const field of ARRAY_FIELDS) {
    if (!sameValue(mapped[field], source.payload[field] || [])) {
      throw new Error(`scenario ${source.index} ${field} mapping must match validated source scenario`);
    }
  }
  return generated;
}

export function buildParallelScenario(source, sourceSetHash) {
  if (!/^[a-f0-9]{64}$/.test(sourceSetHash || "")) {
    throw new Error("parallel scenario generation requires the validated source-set hash");
  }
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
      const componentId = opaqueComponentId(sourceSetHash, source, ordinal, "optimal");
      const distractorId = opaqueComponentId(sourceSetHash, source, ordinal, "distractor");
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
  components.sort((left, right) => (
    digest(sourceSetHash, source.runId, "order", left.id)
      .localeCompare(digest(sourceSetHash, source.runId, "order", right.id))
  ));
  selections.sort((left, right) => (
    components.findIndex((entry) => entry.id === left.componentId)
      - components.findIndex((entry) => entry.id === right.componentId)
  ));
  const fixedArgs = {};
  if (source.budgetMode === "constrained") fixedArgs.budgetTokens = source.budget;
  if (source.payload.dungeonAffinity) fixedArgs.dungeonAffinity = source.payload.dungeonAffinity;
  return validateParallelScenarioProjection({
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
  }, source);
}

export function buildParallelCatalog() {
  const source = loadScenarioCatalog();
  return {
    schemaVersion: "agent-kernel-abstract-plan-catalog/v1",
    sourceScenarioSet: { count: source.count, sha256: source.sha256 },
    scenarios: source.scenarios.map((scenario) => buildParallelScenario(scenario, source.sha256)),
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
