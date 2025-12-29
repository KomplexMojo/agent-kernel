const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const coreModule = moduleUrl("packages/bindings-ts/src/core-as.js");

const missingScript = `
import assert from "node:assert/strict";
import { loadCore } from ${JSON.stringify(coreModule)};

await assert.rejects(
  loadCore({ wasmUrl: new URL("file:///missing-core-as.wasm") }),
);
`;

const invalidScript = `
import assert from "node:assert/strict";
import { loadCore } from ${JSON.stringify(coreModule)};

await assert.rejects(
  loadCore({ wasmUrl: new URL("data:application/wasm;base64,AA==") }),
);
`;

test("loadCore rejects missing wasm", () => {
  runEsm(missingScript);
});

test("loadCore rejects invalid wasm", () => {
  runEsm(invalidScript);
});
