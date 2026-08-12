const { test, runNodeTest } = require("../helpers/node-test-runner");

test("affinity-tile-mask suite", () => {
  runNodeTest("tests/runtime/affinity-tile-mask.test.mjs");
});
