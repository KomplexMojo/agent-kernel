import { readFile } from "node:fs/promises";

async function loadWasmInstance(wasmPath, imports = {}) {
  const buffer = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(buffer, imports);
  return instance;
}

export async function createWasmSolverAdapter({ wasmPath, imports = {}, createSolver } = {}) {
  const instance = wasmPath ? await loadWasmInstance(wasmPath, imports) : null;
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
