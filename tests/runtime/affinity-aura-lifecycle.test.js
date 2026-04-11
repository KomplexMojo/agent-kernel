const test = require("node:test");
const { moduleUrl, runEsm, ROOT } = require("../helpers/esm-runner");

const bindingsModule = moduleUrl("packages/bindings-ts/src/index.js");
const affinityAuraModule = moduleUrl("packages/runtime/src/render/affinity-aura.js");
const spatialRulesModule = moduleUrl("packages/runtime/src/contracts/affinity-spatial-rules.js");
const domainConstantsModule = moduleUrl("packages/runtime/src/contracts/domain-constants.js");

test("attaches aura data to observation after readObservation call", () => {
  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readObservation, renderBaseTiles } from ${JSON.stringify(bindingsModule)};
import { computeAuraMap, serializeAuraMap } from ${JSON.stringify(affinityAuraModule)};
import { SPATIAL_WEIGHTS, INTERACTION_MATRIX } from ${JSON.stringify(spatialRulesModule)};
import { AFFINITY_OPPOSITES } from ${JSON.stringify(domainConstantsModule)};

const WASM_PATH = resolve(${JSON.stringify(ROOT)}, "build/core-as.wasm");
if (!existsSync(WASM_PATH)) {
  process.exit(0);
}

const buffer = await readFile(WASM_PATH);
const { instance } = await WebAssembly.instantiate(buffer, {
  env: {
    abort(_msg, _file, line, column) {
      throw new Error(\`WASM abort at \${line}:\${column}\`);
    },
  },
});

const exports = instance.exports;
const core = {
  init: exports.init,
  loadMvpScenario: exports.loadMvpScenario,
  getMapWidth: exports.getMapWidth,
  getMapHeight: exports.getMapHeight,
  getActorX: exports.getActorX,
  getActorY: exports.getActorY,
  getActorKind: exports.getActorKind,
  getActorVitalCurrent: exports.getActorVitalCurrent,
  getActorVitalMax: exports.getActorVitalMax,
  getActorVitalRegen: exports.getActorVitalRegen,
  getTileActorKind: exports.getTileActorKind,
  renderBaseCellChar: exports.renderBaseCellChar,
  getCurrentTick: exports.getCurrentTick,
};

core.init(0);
core.loadMvpScenario();

const baseTiles = renderBaseTiles(core);
const observation = readObservation(core, { actorIdLabel: "actor" });

assert.ok(observation, "observation should be returned");
assert.ok(Array.isArray(observation.actors), "observation should have actors array");
assert.ok(Array.isArray(baseTiles), "baseTiles should be an array");

const auraMap = computeAuraMap(observation.actors, baseTiles, {
  affinityOpposites: AFFINITY_OPPOSITES,
  weights: SPATIAL_WEIGHTS,
});
const serializedAuras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);
observation.auras = serializedAuras;

assert.ok(observation.auras !== undefined, "observation should have auras field");
assert.ok(Array.isArray(observation.auras), "observation.auras should be an array");

if (observation.auras.length > 0) {
  const aura = observation.auras[0];
  assert.ok(typeof aura.x === "number", "aura should have numeric x coordinate");
  assert.ok(typeof aura.y === "number", "aura should have numeric y coordinate");
  assert.ok(Array.isArray(aura.layers), "aura should have layers array");
  assert.ok(typeof aura.visualState === "string", "aura should have visualState string");
  assert.ok(Array.isArray(aura.sourceEffects), "aura should have sourceEffects array");
  assert.ok(Array.isArray(aura.targetEffects), "aura should have targetEffects array");

  if (aura.layers.length > 0) {
    const layer = aura.layers[0];
    assert.ok(typeof layer.actorId === "string", "layer should have actorId");
    assert.ok(typeof layer.expression === "string", "layer should have expression");
    assert.ok(typeof layer.kind === "string", "layer should have kind");
    assert.ok(typeof layer.stacks === "number", "layer should have stacks");
    assert.ok(typeof layer.intensity === "number", "layer should have intensity");
  }
}
`;

  runEsm(script);
});

test("computes auras from traps with affinities", () => {
  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderBaseTiles } from ${JSON.stringify(bindingsModule)};
import { computeAuraMap, serializeAuraMap } from ${JSON.stringify(affinityAuraModule)};
import { SPATIAL_WEIGHTS, INTERACTION_MATRIX } from ${JSON.stringify(spatialRulesModule)};
import { AFFINITY_OPPOSITES } from ${JSON.stringify(domainConstantsModule)};

const WASM_PATH = resolve(${JSON.stringify(ROOT)}, "build/core-as.wasm");
if (!existsSync(WASM_PATH)) {
  process.exit(0);
}

const buffer = await readFile(WASM_PATH);
const { instance } = await WebAssembly.instantiate(buffer, {
  env: {
    abort(_msg, _file, line, column) {
      throw new Error(\`WASM abort at \${line}:\${column}\`);
    },
  },
});

const exports = instance.exports;
const core = {
  init: exports.init,
  loadMvpScenario: exports.loadMvpScenario,
  getMapWidth: exports.getMapWidth,
  getMapHeight: exports.getMapHeight,
  renderBaseCellChar: exports.renderBaseCellChar,
  getCurrentTick: exports.getCurrentTick,
};

core.init(0);
core.loadMvpScenario();

const baseTiles = renderBaseTiles(core);
const observation = {
  tick: 0,
  actors: [],
  traps: [
    {
      position: { x: 5, y: 5 },
      affinities: [
        {
          kind: "dark",
          expression: "emit",
          stacks: 1,
        },
      ],
    },
  ],
};

const actors = Array.isArray(observation.actors) ? observation.actors : [];
const traps = Array.isArray(observation.traps) ? observation.traps : [];
const trapActors = traps.map((trap, index) => ({
  id: \`trap_\${index}\`,
  x: trap.position?.x ?? 0,
  y: trap.position?.y ?? 0,
  affinities: trap.affinities || [],
}));

const allActors = [...actors, ...trapActors];
const auraMap = computeAuraMap(allActors, baseTiles, {
  affinityOpposites: AFFINITY_OPPOSITES,
  weights: SPATIAL_WEIGHTS,
});
const serializedAuras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);

assert.ok(Array.isArray(serializedAuras), "serialized auras should be an array");

if (serializedAuras.length > 0) {
  const firstAura = serializedAuras[0];
  assert.ok(firstAura.layers.length > 0, "aura should have at least one layer");
  const layer = firstAura.layers.find((entry) => entry.kind === "dark" && entry.expression === "emit");
  assert.ok(layer, "should have a dark emit aura layer from the trap");
}
`;

  runEsm(script);
});
