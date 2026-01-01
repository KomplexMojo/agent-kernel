const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");

async function loadCoreFromWasmPath(wasmPath) {
  const buffer = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(buffer, {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(`WASM abort at ${line}:${column}`);
      },
    },
  });
  const exports = instance.exports;
  return {
    init: exports.init,
    step: exports.step,
    applyAction: exports.applyAction,
    getCounter: exports.getCounter,
    setBudget: exports.setBudget,
    getBudget: exports.getBudget,
    getBudgetUsage: exports.getBudgetUsage,
    getEffectCount: exports.getEffectCount,
    getEffectKind: exports.getEffectKind,
    getEffectValue: exports.getEffectValue,
    clearEffects: exports.clearEffects,
    version: exports.version,
    loadMvpScenario: exports.loadMvpScenario,
    loadMvpBarrierScenario: exports.loadMvpBarrierScenario,
    setSpawnPosition: exports.setSpawnPosition,
    clearActorPlacements: exports.clearActorPlacements,
    addActorPlacement: exports.addActorPlacement,
    getActorPlacementCount: exports.getActorPlacementCount,
    validateActorPlacement: exports.validateActorPlacement,
    getMapWidth: exports.getMapWidth,
    getMapHeight: exports.getMapHeight,
    getActorId: exports.getActorId,
    getActorX: exports.getActorX,
    getActorY: exports.getActorY,
    getActorKind: exports.getActorKind,
    getTileActorKind: exports.getTileActorKind,
    getTileActorId: exports.getTileActorId,
    getTileActorCount: exports.getTileActorCount,
    getTileActorIndex: exports.getTileActorIndex,
    getTileActorXByIndex: exports.getTileActorXByIndex,
    getTileActorYByIndex: exports.getTileActorYByIndex,
    getTileActorKindByIndex: exports.getTileActorKindByIndex,
    getTileActorIdByIndex: exports.getTileActorIdByIndex,
    getTileActorDurabilityByIndex: exports.getTileActorDurabilityByIndex,
    getTileActorDurability: exports.getTileActorDurability,
    getActorVitalCurrent: exports.getActorVitalCurrent,
    getActorVitalMax: exports.getActorVitalMax,
    getActorVitalRegen: exports.getActorVitalRegen,
    setActorVital: exports.setActorVital,
    validateActorVitals: exports.validateActorVitals,
    getCurrentTick: exports.getCurrentTick,
    renderCellChar: exports.renderCellChar,
    renderBaseCellChar: exports.renderBaseCellChar,
  };
}

function resolveWasmPath(relativePath) {
  return resolve(process.cwd(), relativePath);
}

module.exports = {
  loadCoreFromWasmPath,
  resolveWasmPath,
};
