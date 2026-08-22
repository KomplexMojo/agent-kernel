/**
 * G1 allocator/receipts (A2) — THE NINE, paperwork six, 2026-08-18.
 *
 * `allocator/spend-authority`'s registry entry already proves the DENIED half: when the
 * Allocator refuses a receipt, `orchestrateBuild` throws and the build does not happen
 * (`ak-hazard-resource-plan.test.js`, through the real CLI). What it does not prove — the
 * roster's `KNOWN_UNREGISTERED` note names this exact gap — is the APPROVED half, which is
 * the audit-trail claim: is the Allocator the ONLY thing that can mark a receipt
 * `approved`? A denial that only the Allocator can issue is not the same guarantee as an
 * approval that only the Allocator can issue — glue could in principle construct its own
 * "everything's fine" receipt and nothing downstream would notice, because the build
 * proceeds either way.
 *
 * Traced the real shape rather than grepping the bare string "approved": that literal
 * appears twice more in the tree, in `personas/director/pool-mapper.js` and
 * `personas/director/summary-selections.js` — both `{status, reason, count}` pool-pick
 * receipts, a different concern that happens to share a field name. A BudgetReceipt is
 * distinguished by carrying `lineItems` alongside `status`; scoping to that shape is what
 * keeps this guard from either false-alarming on the Director or missing a real second
 * source that avoided the word "approved" some other way — checked below by tracing
 * `budgetReceipt`'s actual data flow through orchestrate-build.js, not just grepping.
 */
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["packages"].map((dir) => join(ROOT, dir));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts", ".cjs"]);
const SKIPPED = new Set(["node_modules", "dist", "build"]);
const VALIDATE_SPEND_FILE = "packages/runtime/src/personas/allocator/validate-spend.js";
const ORCHESTRATE_BUILD_FILE = "packages/runtime/src/build/orchestrate-build.js";

function sourceFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      found.push(full);
    }
  }
  return found;
}

function allSourceFiles() {
  return SCANNED_ROOTS.filter((dir) => require("node:fs").existsSync(dir)).flatMap((dir) => sourceFiles(dir));
}

test("only validate-spend.js assigns status:\"approved\" inside an object that also carries lineItems", () => {
  const offenders = [];
  for (const file of allSourceFiles()) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("tests/") || rel.includes("test.")) continue;
    // .ts contract files declare the TYPE union (status: "approved" | "denied") — a shape
    // declaration, not a runtime assignment. Scanning only executable extensions is what
    // keeps this a check on CODE, not on the interface every implementation is checked
    // against.
    if (rel.endsWith(".ts")) continue;
    const source = readFileSync(file, "utf8");
    // A receipt-shaped literal: "lineItems" and status: "approved" both present in the
    // file. Deliberately file-grained, not line-grained — the two fields are built up
    // across several statements in validate-spend.js, not one object literal.
    const hasLineItems = /\blineItems\b/.test(source);
    const assignsApproved = /status:\s*"approved"|\.status\s*=\s*"approved"/.test(source);
    if (hasLineItems && assignsApproved && rel !== VALIDATE_SPEND_FILE) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "a file other than validate-spend.js both handles lineItems and assigns "
      + 'status: "approved" — it may be a second receipt-approval authority',
  );
});

test("orchestrate-build.js only READS budgetReceipt.status, never assigns it", () => {
  const source = readFileSync(join(ROOT, ORCHESTRATE_BUILD_FILE), "utf8");
  assert.doesNotMatch(
    source,
    /budgetReceipt\.status\s*=(?!=)/,
    "orchestrate-build.js assigns budgetReceipt.status directly — it must only read the "
      + "value the Allocator's service returned",
  );
  assert.match(
    source,
    /budgetReceipt\s*=\s*spendResult\.receipt/,
    "orchestrate-build.js must take the receipt wholesale from the Allocator's spend result, "
      + "not construct or merge one of its own",
  );
});

test("the spend evaluator orchestrate-build.js calls is imported from the Allocator's barrel", () => {
  const source = readFileSync(join(ROOT, ORCHESTRATE_BUILD_FILE), "utf8");
  assert.match(
    source,
    /import\s*\{[^}]*\bevaluateConfiguratorSpend\b[^}]*\}\s*from\s*["'][^"']*personas\/allocator\/persona\.js["']/,
    "orchestrate-build.js must import evaluateConfiguratorSpend from the Allocator's public "
      + "barrel, not a raw internal file",
  );
});
