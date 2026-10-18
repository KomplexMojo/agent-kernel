// #279: a play session reports a level the Allocator never priced. Every level `ak create`
// makes carries a budget receipt (#274, #276); a hand-written or older level without one is
// played as written (Darren's rule for hand-written levels) and the session says it is unpriced.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");

const LEVELS = resolve(__dirname, "../../packages/ui-ascii/levels");
const level = (name) => ({
  simConfig: JSON.parse(readFileSync(resolve(LEVELS, `${name}.sim-config.json`), "utf8")),
  initialState: JSON.parse(readFileSync(resolve(LEVELS, `${name}.initial-state.json`), "utf8")),
});

test("a level priced by the Allocator reports nothing", async () => {
  const session = await createPlaySession(level("first-steps"));
  assert.deepEqual(session.pricingReport, []);
});

test("a level with no Allocator receipt is played and reported as unpriced", async () => {
  const { simConfig, initialState } = level("first-steps");
  delete simConfig.budgetReceiptRef;
  const session = await createPlaySession({ simConfig, initialState });
  assert.equal(session.pricingReport.length, 1);
  assert.equal(session.pricingReport[0].code, "level_unpriced");
  assert.match(session.pricingReport[0].message, /ak create/);
  assert.ok(session.view(), "the level still plays");
});

test("the ASCII game shows the unpriced-level warning", async () => {
  const { createGame } = await import("../../packages/ui-ascii/src/game.js");
  const { simConfig, initialState } = level("first-steps");
  delete simConfig.budgetReceiptRef;
  const game = await createGame({ levels: [{ name: "first-steps", simConfig, initialState }] });
  const { warnings } = game.state();
  assert.ok(warnings.some((warning) => /not priced by the Allocator/.test(warning)), JSON.stringify(warnings));
});

// ## TODO: Test Permutations
// - play-session start (CLI) on an unpriced level prints the warning in its JSON payload.
// - ak_play_start (MCP) on an unpriced level returns the warning.
// - a level whose receipt ref names a denied receipt.
