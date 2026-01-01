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
    getMapWidth: exports.getMapWidth,
    getMapHeight: exports.getMapHeight,
    getActorX: exports.getActorX,
    getActorY: exports.getActorY,
    getActorHp: exports.getActorHp,
    getActorMaxHp: exports.getActorMaxHp,
    getActorId: exports.getActorId,
    getCurrentTick: exports.getCurrentTick,
    renderCellChar: exports.renderCellChar,
    renderBaseCellChar: exports.renderBaseCellChar,
  };
}
