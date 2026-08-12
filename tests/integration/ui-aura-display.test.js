const { test, runNodeTest } = require("../helpers/node-test-runner");

test("UI aura display integration suite", () => {
  runNodeTest("tests/integration/ui-aura-display.test.mjs");
});
