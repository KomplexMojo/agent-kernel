import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectTestInventory, ROOT } from "./shared.mjs";

const exceptions = [];
for (const entry of collectTestInventory().files) {
  const source = readFileSync(resolve(ROOT, entry.path), "utf8");
  if (!source.includes("node:test")) {
    continue;
  }
  if (source.includes("before(") || source.includes("after(") || source.includes("beforeEach(") || source.includes("afterEach(")) {
    exceptions.push({
      path: entry.path,
      reason: "lifecycle_hook_review",
    });
    continue;
  }
  if (source.includes("t.mock")) {
    exceptions.push({
      path: entry.path,
      reason: "node_test_mocking_review",
    });
    continue;
  }
}

console.log(JSON.stringify({
  ok: true,
  count: exceptions.length,
  exceptions,
}, null, 2));
