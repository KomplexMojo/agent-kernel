const DEFAULT_WASM_URL = new URL("../../../build/core-as.wasm", import.meta.url);

export async function loadCore({ wasmUrl = DEFAULT_WASM_URL } = {}) {
  const imports = {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(`WASM abort at ${line}:${column}`);
      },
    },
  };

  const wasmUrlObj = wasmUrl instanceof URL ? wasmUrl : new URL(String(wasmUrl));

  async function instantiateFromBuffer(buffer) {
    const { instance } = await WebAssembly.instantiate(buffer, imports);
    return instance;
  }

  async function instantiateWithFetch(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }
    if (WebAssembly.instantiateStreaming) {
      try {
        const { instance } = await WebAssembly.instantiateStreaming(response, imports);
        return instance;
      } catch (_err) {
        // Fallback to buffer path below.
      }
    }
    const buffer = await response.arrayBuffer();
    return instantiateFromBuffer(buffer);
  }

  let instance;
  if (wasmUrlObj.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(wasmUrlObj);
    instance = await instantiateFromBuffer(buffer);
  } else {
    instance = await instantiateWithFetch(wasmUrlObj);
  }

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
    setTileAt: exports.setTileAt,
    spawnActorAt: exports.spawnActorAt,
    setSpawnPosition: exports.setSpawnPosition,
    clearActorPlacements: exports.clearActorPlacements,
    addActorPlacement: exports.addActorPlacement,
    getActorPlacementCount: exports.getActorPlacementCount,
    validateActorPlacement: exports.validateActorPlacement,
    applyActorPlacements: exports.applyActorPlacements,
    getMapWidth: exports.getMapWidth,
    getMapHeight: exports.getMapHeight,
    getActorX: exports.getActorX,
    getActorY: exports.getActorY,
    getActorHp: exports.getActorHp,
    getActorMaxHp: exports.getActorMaxHp,
    getActorId: exports.getActorId,
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
    getActorMovementCost: exports.getActorMovementCost,
    getActorActionCostMana: exports.getActorActionCostMana,
    getActorActionCostStamina: exports.getActorActionCostStamina,
    setActorVital: exports.setActorVital,
    setActorMovementCost: exports.setActorMovementCost,
    setActorActionCostMana: exports.setActorActionCostMana,
    setActorActionCostStamina: exports.setActorActionCostStamina,
    validateActorVitals: exports.validateActorVitals,
    validateActorCapabilities: exports.validateActorCapabilities,
    setMotivatedActorVital: exports.setMotivatedActorVital,
    setMotivatedActorMovementCost: exports.setMotivatedActorMovementCost,
    setMotivatedActorActionCostMana: exports.setMotivatedActorActionCostMana,
    setMotivatedActorActionCostStamina: exports.setMotivatedActorActionCostStamina,
    getMotivatedActorCount: exports.getMotivatedActorCount,
    getMotivatedActorIdByIndex: exports.getMotivatedActorIdByIndex,
    getMotivatedActorXByIndex: exports.getMotivatedActorXByIndex,
    getMotivatedActorYByIndex: exports.getMotivatedActorYByIndex,
    getMotivatedActorVitalCurrentByIndex: exports.getMotivatedActorVitalCurrentByIndex,
    getMotivatedActorVitalMaxByIndex: exports.getMotivatedActorVitalMaxByIndex,
    getMotivatedActorVitalRegenByIndex: exports.getMotivatedActorVitalRegenByIndex,
    getMotivatedActorMovementCostByIndex: exports.getMotivatedActorMovementCostByIndex,
    getMotivatedActorActionCostManaByIndex: exports.getMotivatedActorActionCostManaByIndex,
    getMotivatedActorActionCostStaminaByIndex: exports.getMotivatedActorActionCostStaminaByIndex,
    getCurrentTick: exports.getCurrentTick,
    advanceTick: exports.advanceTick,
    renderCellChar: exports.renderCellChar,
    renderBaseCellChar: exports.renderBaseCellChar,
    memory: exports.memory,
  };
}
