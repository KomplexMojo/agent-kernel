const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/tick-inspect-basic.json"), "utf8"));

test("summarizeTickHistory produces expected summary", async () => {
  const { summarizeTickHistory } = await import(
    "../../packages/runtime/src/personas/_shared/tick-inspect.mts"
  );

  const summary = summarizeTickHistory(fixture.history);
  assert.deepEqual(summary, fixture.expect);
});
