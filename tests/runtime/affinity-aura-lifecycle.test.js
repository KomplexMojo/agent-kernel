import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readObservation, renderBaseTiles } from "../../packages/bindings-ts/src/index.js";
import { computeAuraMap, serializeAuraMap } from "../../packages/runtime/src/render/affinity-aura.js";
import { SPATIAL_WEIGHTS, INTERACTION_MATRIX } from "../../packages/runtime/src/contracts/affinity-spatial-rules.js";
import { AFFINITY_OPPOSITES } from "../../packages/runtime/src/contracts/domain-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

describe("affinity aura lifecycle integration", () => {
  it("attaches aura data to observation after readObservation call", async (t) => {
    if (!existsSync(WASM_PATH)) {
      t.skip(`Missing WASM at ${WASM_PATH}`);
      return;
    }

    const buffer = await readFile(WASM_PATH);
    const { instance } = await WebAssembly.instantiate(buffer, {
      env: {
        abort(_msg, _file, line, column) {
          throw new Error(`WASM abort at ${line}:${column}`);
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

    // Initialize with MVP scenario
    core.init(0);
    core.loadMvpScenario();

    // Read base tiles and observation (simulating what runtime-fsm does)
    const baseTiles = renderBaseTiles(core);
    const observation = readObservation(core, { actorIdLabel: "actor" });

    assert.ok(observation, "observation should be returned");
    assert.ok(Array.isArray(observation.actors), "observation should have actors array");
    assert.ok(Array.isArray(baseTiles), "baseTiles should be an array");

    // Compute and serialize aura map (this is what runtime-fsm.mjs does at lines 208-212)
    const auraMap = computeAuraMap(observation.actors, baseTiles, {
      affinityOpposites: AFFINITY_OPPOSITES,
      weights: SPATIAL_WEIGHTS,
    });
    const serializedAuras = serializeAuraMap(auraMap, INTERACTION_MATRIX, SPATIAL_WEIGHTS);

    // Attach to observation (as done in runtime-fsm.mjs line 212)
    observation.auras = serializedAuras;

    // Verify observation.auras exists and has correct structure
    assert.ok(observation.auras !== undefined, "observation should have auras field");
    assert.ok(Array.isArray(observation.auras), "observation.auras should be an array");

    // Verify aura data structure
    if (observation.auras.length > 0) {
      const aura = observation.auras[0];
      assert.ok(typeof aura.x === "number", "aura should have numeric x coordinate");
      assert.ok(typeof aura.y === "number", "aura should have numeric y coordinate");
      assert.ok(Array.isArray(aura.layers), "aura should have layers array");
      assert.ok(typeof aura.visualState === "string", "aura should have visualState string");
      assert.ok(Array.isArray(aura.sourceEffects), "aura should have sourceEffects array");
      assert.ok(Array.isArray(aura.targetEffects), "aura should have targetEffects array");

      // Verify layer structure if layers exist
      if (aura.layers.length > 0) {
        const layer = aura.layers[0];
        assert.ok(typeof layer.actorId === "string", "layer should have actorId");
        assert.ok(typeof layer.expression === "string", "layer should have expression");
        assert.ok(typeof layer.kind === "string", "layer should have kind");
        assert.ok(typeof layer.stacks === "number", "layer should have stacks");
        assert.ok(typeof layer.intensity === "number", "layer should have intensity");
      }
    }
  });
});
