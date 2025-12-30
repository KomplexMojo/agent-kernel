const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const inspectModule = moduleUrl("packages/runtime/src/personas/_shared/tick-inspect.js");
const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-inspect-basic.json"), "utf8"));

const script = `
import assert from "node:assert/strict";
import { summarizeTickHistory } from ${JSON.stringify(inspectModule)};

const fixture = ${JSON.stringify(fixture)};
const summary = summarizeTickHistory(fixture.history);
assert.deepEqual(summary, fixture.expect);
`;

test("summarizeTickHistory produces expected summary", () => {
  runEsm(script);
});
