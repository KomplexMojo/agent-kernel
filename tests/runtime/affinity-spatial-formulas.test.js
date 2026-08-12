const { test, runNodeTest } = require("../helpers/node-test-runner");

test("affinity-spatial-formulas suite", () => {
  runNodeTest("tests/runtime/affinity-spatial-formulas.test.mjs");
});
