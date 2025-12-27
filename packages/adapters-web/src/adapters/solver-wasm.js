async function loadWasmInstance(wasmUrl, imports = {}) {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch solver WASM: ${response.status} ${response.statusText}`);
  }
  if (WebAssembly.instantiateStreaming) {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(response, imports);
      return instance;
    } catch (error) {
      const buffer = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(buffer, imports);
      return instance;
    }
  }
  const buffer = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(buffer, imports);
  return instance;
}

export async function createWasmSolverAdapter({ wasmUrl, imports = {}, createSolver } = {}) {
  const instance = wasmUrl ? await loadWasmInstance(wasmUrl, imports) : null;
  const solve = createSolver ? createSolver({ instance }) : null;

  return {
    async solve(request) {
      if (!solve) {
        throw new Error("No solver implementation provided. Supply createSolver.");
      }
      return solve(request);
    },
  };
}
