/**
 * Update reload: unregister every SW, clear caches, navigate with a cache-bust.
 * Mocks only — no browser. The phone page wires this through applyUpdate.
 */
const assert = require("node:assert/strict");
const { reloadForUpdate } = require("../../packages/ui-ascii/src/update-reload.js");

test("reloadForUpdate unregisters workers, clears caches, and replace()s a full cache-busted href", async () => {
  const unregistered = [];
  let cleared = false;
  let replaced = null;
  await reloadForUpdate({
    getRegistrations: async () => [
      { unregister: async () => { unregistered.push("a"); return true; } },
      { unregister: async () => { unregistered.push("b"); return true; } },
    ],
    deleteCaches: async () => { cleared = true; },
    replace: (href) => { replaced = href; },
    href: "https://komplexmojo.github.io/agent-kernel/?x=1",
    now: () => 1700000000000,
  });
  assert.deepEqual(unregistered, ["a", "b"]);
  assert.equal(cleared, true);
  assert.equal(replaced, "https://komplexmojo.github.io/agent-kernel/?x=1&_=1700000000000");
});

test("reloadForUpdate still navigates when cleanup hangs past the timeout", async () => {
  let replaced = null;
  const started = Date.now();
  await reloadForUpdate({
    getRegistrations: () => new Promise(() => {}),
    deleteCaches: async () => {},
    replace: (href) => { replaced = href; },
    href: "https://example.test/agent-kernel/",
    now: () => 42,
    timeoutMs: 50,
  });
  assert.ok(Date.now() - started < 500, "must not wait on a hung getRegistrations");
  assert.equal(replaced, "https://example.test/agent-kernel/?_=42");
});

test("the phone app wires Update through reloadForUpdate and never calls registration.update", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const browser = readFileSync(join(__dirname, "../../packages/ui-ascii/src/browser.js"), "utf8");
  assert.match(browser, /reloadForUpdate\(/);
  assert.match(browser, /\.onclick = applyUpdate/);
  assert.doesNotMatch(browser, /\.update\(\)/);
  assert.match(browser, /location\.replace\(href\)/);
});
