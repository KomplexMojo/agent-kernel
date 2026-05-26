const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const HTML_PATH = resolve(__dirname, "../packages/ui-web/index.html");

test("index.html loads main.js as a static module script (not dynamically)", () => {
  const html = readFileSync(HTML_PATH, "utf8");

  // main.js must be loaded as a static <script type="module"> tag so that it
  // executes before the browser fires the `load` event.  Dynamic loading via a
  // fetch-and-createElement approach introduces a race condition: `page.goto()`
  // returns on `load`, but the dynamic fetch is still pending, so globals like
  // `window.__ak_setActiveTab` are not yet defined when Playwright tests run.
  assert.ok(
    html.includes('<script type="module" src="./src/main.js">'),
    "index.html must use a static <script type=\"module\" src=\"./src/main.js\"> tag",
  );

  // Must NOT fall back to the old health-check dynamic-loading pattern.
  assert.ok(
    !html.includes("document.createElement('script')"),
    "index.html must not dynamically create a script element for main.js",
  );

  assert.ok(
    !html.includes("retryLoad"),
    "index.html must not contain the old retryLoad health-check loop",
  );
});
