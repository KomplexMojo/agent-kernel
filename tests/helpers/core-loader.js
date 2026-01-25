const { existsSync } = require("node:fs");
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
    setMoveAction: exports.setMoveAction,
    getCounter: exports.getCounter,
    setBudget: exports.setBudget,
    getBudget: exports.getBudget,
    getBudgetUsage: exports.getBudgetUsage,
    getEffectCount: exports.getEffectCount,
    getEffectKind: exports.getEffectKind,
    getEffectValue: exports.getEffectValue,
    getEffectActorId: exports.getEffectActorId,
    getEffectX: exports.getEffectX,
    getEffectY: exports.getEffectY,
    getEffectReason: exports.getEffectReason,
    getEffectDelta: exports.getEffectDelta,
    clearEffects: exports.clearEffects,
    version: exports.version,
    loadMvpScenario: exports.loadMvpScenario,
    loadMvpBarrierScenario: exports.loadMvpBarrierScenario,
    configureGrid: exports.configureGrid,
    prepareTileBuffer: exports.prepareTileBuffer,
    loadTilesFromBuffer: exports.loadTilesFromBuffer,
    memory: exports.memory,
    setTileAt: exports.setTileAt,
    spawnActorAt: exports.spawnActorAt,
    setSpawnPosition: exports.setSpawnPosition,
    clearActorPlacements: exports.clearActorPlacements,
    addActorPlacement: exports.addActorPlacement,
    getActorPlacementCount: exports.getActorPlacementCount,
    validateActorPlacement: exports.validateActorPlacement,
    applyActorPlacements: exports.applyActorPlacements,
    setMotivatedActorVital: exports.setMotivatedActorVital,
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
    getMotivatedActorCount: exports.getMotivatedActorCount,
    getMotivatedActorIdByIndex: exports.getMotivatedActorIdByIndex,
    getMotivatedActorXByIndex: exports.getMotivatedActorXByIndex,
    getMotivatedActorYByIndex: exports.getMotivatedActorYByIndex,
    getMotivatedActorVitalCurrentByIndex: exports.getMotivatedActorVitalCurrentByIndex,
    getMotivatedActorVitalMaxByIndex: exports.getMotivatedActorVitalMaxByIndex,
    getMotivatedActorVitalRegenByIndex: exports.getMotivatedActorVitalRegenByIndex,
    getCurrentTick: exports.getCurrentTick,
    renderCellChar: exports.renderCellChar,
    renderBaseCellChar: exports.renderBaseCellChar,
  };
}

function resolveWasmPath(relativePath = "build/core-as.wasm") {
  return resolve(process.cwd(), relativePath);
}

function resolveWasmPathOrThrow(relativePath = "build/core-as.wasm") {
  const wasmPath = resolveWasmPath(relativePath);
  if (!existsSync(wasmPath)) {
    throw new Error(`WASM not found at ${wasmPath}`);
  }
  return wasmPath;
}

module.exports = {
  loadCoreFromWasmPath,
  resolveWasmPath,
  resolveWasmPathOrThrow,
};
