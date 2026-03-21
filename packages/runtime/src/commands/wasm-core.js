function createImports() {
  return {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(`WASM abort at ${line}:${column}`);
      },
    },
  };
}

export function mapCommandRuntimeCore(exports = {}) {
  return {
    init: exports.init,
    step: exports.step,
    applyAction: exports.applyAction,
    getCounter: exports.getCounter,
    configureGrid: exports.configureGrid,
    setTileAt: exports.setTileAt,
    spawnActorAt: exports.spawnActorAt,
    setActorVital: exports.setActorVital,
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

export async function instantiateCommandRuntimeCoreFromBuffer(buffer) {
  const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { instance } = await WebAssembly.instantiate(source, createImports());
  return mapCommandRuntimeCore(instance.exports);
}
