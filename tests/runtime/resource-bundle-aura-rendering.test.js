const { test, runNodeTest } = require("../helpers/node-test-runner");

test("resource-bundle aura rendering suite", () => {
  runNodeTest("tests/runtime/resource-bundle-aura-rendering.test.mjs");
});
