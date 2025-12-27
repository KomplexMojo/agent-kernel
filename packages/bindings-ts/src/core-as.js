const DEFAULT_WASM_URL = new URL("../../../build/core-as.wasm", import.meta.url);

export async function loadCore({ wasmUrl = DEFAULT_WASM_URL } = {}) {
  const imports = {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(`WASM abort at ${line}:${column}`);
      },
    },
  };

  let instance;
  if (WebAssembly.instantiateStreaming) {
    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
      }
      ({ instance } = await WebAssembly.instantiateStreaming(response, imports));
    } catch (error) {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      ({ instance } = await WebAssembly.instantiate(buffer, imports));
    }
  } else {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(buffer, imports));
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
  };
}
