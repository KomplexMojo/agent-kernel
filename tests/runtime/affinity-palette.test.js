const { test, runNodeTest } = require("../helpers/node-test-runner");

test("affinity-palette suite", () => {
  runNodeTest("tests/runtime/affinity-palette.test.mjs");
});
