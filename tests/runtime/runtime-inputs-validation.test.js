const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const runtimeModule = moduleUrl("packages/runtime/src/runner/runtime.js");

const script = `
import assert from "node:assert/strict";
import { createRuntime } from ${JSON.stringify(runtimeModule)};

function buildCore() {
  return {
    init() {},
    applyAction() {},
    getCounter() { return 0; },
    getEffectCount() { return 0; },
    getEffectKind() { return 0; },
    getEffectValue() { return 0; },
    clearEffects() {},
  };
}

async function makeRuntime() {
  const runtime = createRuntime({ core: buildCore(), adapters: {} });
  await runtime.init({ seed: 0 });
  return runtime;
}

let runtime = await makeRuntime();
await assert.rejects(() => runtime.step({ personaEvents: "nope" }), /personaEvents/);

runtime = await makeRuntime();
await assert.rejects(() => runtime.step({ personaEvents: { actor: 123 } }), /personaEvents\.actor/);

runtime = await makeRuntime();
await assert.rejects(() => runtime.step({ personaPayloads: "nope" }), /personaPayloads/);
`;

test("runtime validates personaEvents/personaPayloads shapes", () => {
  runEsm(script);
});
