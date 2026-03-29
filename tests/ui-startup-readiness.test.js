const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const HTML_PATH = resolve(__dirname, "../packages/ui-web/index.html");

test("index.html includes server readiness check before loading main.js", () => {
  const html = readFileSync(HTML_PATH, "utf8");

  // Should not have direct script tag for main.js
  assert.ok(
    !html.includes('<script type="module" src="./src/main.js"></script>'),
    "Should not have direct script tag for main.js (should be dynamically loaded)"
  );

  // Should include health check logic
  assert.ok(
    html.includes("fetch('/health')"),
    "Should include health endpoint check"
  );

  // Should include retry logic
  assert.ok(
    html.includes("retryLoad"),
    "Should include retry mechanism"
  );

  // Should dynamically create script element
  assert.ok(
    html.includes("document.createElement('script')"),
    "Should dynamically create script element"
  );

  // Should set main.js as source
  assert.ok(
    html.includes("script.src = './src/main.js'"),
    "Should load main.js dynamically"
  );

  // Should check for ready status
  assert.ok(
    html.includes("data.status === 'ready'"),
    "Should check for ready status from health endpoint"
  );
});
