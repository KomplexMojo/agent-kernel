// #277: the sandbox's budget receipts are the Allocator's. sandbox-create --budget used to write a
// budgetReceiptRef naming a receipt that did not exist, the receipt check ran in glue (and differed
// between the CLI and MCP), and sandbox-place stamped a planRef no Director made.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";

import { executeSandboxCreate, executeSandboxPlace } from "../../packages/adapters-cli/src/mcp/tools/sandbox.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const BUDGET = resolve(ROOT, "tests/fixtures/artifacts/budget-artifact-v1-basic.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test("MCP sandbox-create with a budget writes the Allocator's receipt and refs it", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "sandbox-receipt-"));
  try {
    const result = await executeSandboxCreate({ budget: BUDGET, runId: "sbx", createdAt: "2026-10-17T00:00:00.000Z", outDir });
    assert.equal(result.ok, true, result.error);
    const receiptPath = join(outDir, "budget-receipt.json");
    assert.ok(existsSync(receiptPath), "a real receipt is written");
    const receipt = readJson(receiptPath);
    assert.equal(receipt.status, "approved");
    assert.ok(receipt.totalCost > 0, "the room's floor is priced");
    const session = readJson(join(outDir, "sandbox-session.json"));
    assert.equal(session.artifacts.budgetReceiptRef.id, receipt.meta.id);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("CLI sandbox-create with a budget writes the Allocator's receipt too", () => {
  const outDir = mkdtempSync(join(tmpdir(), "sandbox-receipt-cli-"));
  try {
    const run = spawnSync(process.execPath, [CLI, "sandbox-create", "--budget", BUDGET, "--run-id", "sbx",
      "--created-at", "2026-10-17T00:00:00.000Z", "--out-dir", outDir], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const receipt = readJson(join(outDir, "budget-receipt.json"));
    assert.equal(readJson(join(outDir, "sandbox-session.json")).artifacts.budgetReceiptRef.id, receipt.meta.id);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("a sandbox room too big for its budget is refused by the Allocator", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "sandbox-receipt-big-"));
  try {
    const result = await executeSandboxCreate({ budget: BUDGET, width: 200, height: 200, runId: "sbx", outDir });
    assert.equal(result.ok, false);
    assert.equal(result.budgetInsufficient, true);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("the CLI and MCP refuse the same receipts: a partial receipt is not approved", () => {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-receipt-partial-"));
  try {
    const partial = { ...readJson(resolve(ROOT, "tests/fixtures/artifacts/budget-receipt-artifact-v1-basic.json")), status: "partial" };
    const path = join(dir, "partial.json");
    writeFileSync(path, JSON.stringify(partial));
    const run = spawnSync(process.execPath, [CLI, "sandbox-create", "--budget-receipt", path, "--out-dir", join(dir, "out")],
      { cwd: ROOT, encoding: "utf8" });
    const payload = JSON.parse(run.stdout.trim().split("\n").at(-1));
    assert.equal(payload.ok, false);
    assert.equal(payload.budgetInsufficient, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox-place does not stamp a planRef no Director made", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "sandbox-receipt-place-"));
  try {
    await executeSandboxCreate({ budget: BUDGET, runId: "sbx", createdAt: "2026-10-17T00:00:00.000Z", outDir });
    const placed = await executeSandboxPlace({ session: join(outDir, "sandbox-session.json"), entityType: "delver", spec: "x=2;y=2" });
    assert.equal(placed.ok, true, placed.error);
    const simConfig = readJson(join(outDir, "sim-config.json"));
    assert.equal(simConfig.planRef, undefined);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - sandbox-create with an approved receipt keeps refing that receipt and writes no new one.
// - sandbox-create with a denied receipt: CLI and MCP give the same error.
// - sandbox-place over the session budget (once placed actors are priced, follow-up).
