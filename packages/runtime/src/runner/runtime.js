import { createFsmRuntime } from "./runtime-fsm.mjs";

export function createRuntime(options = {}) {
  return createFsmRuntime(options);
}
