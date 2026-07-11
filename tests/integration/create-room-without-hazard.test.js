/**
 * Hazard-free rooms are first-class (developer adjudication, 2026-07-11):
 * rooms are generic containers — affinity belongs to hazards/traps, NOT to
 * rooms (legacy "room affinity" idea retired). A room with no hazard must be
 * fully authorable, including with resources.
 *
 * GROUND TRUTH (direct invocation, 2026-07-11):
 *   - room alone: ok
 *   - room + delver (no hazard): ok
 *   - room + non-blocking trap (no hazard): ok
 *   - room + resource (NO hazard): DENIED —
 *     "Budget receipt denied: status=denied; deniedLines=resource:resource_level:resources;
 *      deniedPools=resources:N/0"
 *     The budget splitter allocates a ZERO resources pool unless a hazard is
 *     present in the request; adding a hazard to the identical request makes
 *     the same resource lines approve. Every canonical benchmark resource
 *     scenario happens to carry a hazard, so this was never exercised.
 *   Suspect area: pool weight profiles in
 *   packages/runtime/src/personas/director/budget-allocation.js (profile
 *   selection / weight table keyed on hazard presence).
 *
 * Seam driven (same seam the MCP server uses):
 *   packages/adapters-cli/src/mcp/tools/authoring.mjs ak_create buildArgs
 *   -> packages/adapters-cli/src/cli/ak-impl.mjs executeCommand("create", argv)
 */
"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

let ak_impl;
let authoringToolsModule;

async function loadModules() {
  ak_impl ??= await import("../../packages/adapters-cli/src/cli/ak-impl.mjs");
  authoringToolsModule ??= await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  return { ak_impl, authoringToolsModule };
}

function findTool(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `expected MCP tool definition for ${name}`);
  return tool;
}

async function runCliCommand(executeCommand, command, argv) {
  const stdoutChunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  console.log = (...parts) => {
    stdoutChunks.push(`${parts.map(String).join(" ")}\n`);
  };
  let thrown = null;
  try {
    await executeCommand(command, argv);
  } catch (err) {
    thrown = err;
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  if (thrown) return { ok: false, error: thrown.message };
  const text = stdoutChunks.join("").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep scanning backwards for the JSON payload
    }
  }
  return { ok: false, error: `no JSON payload in stdout: ${text.slice(0, 200)}` };
}

async function createShape(outDir, name, args) {
  const { ak_impl, authoringToolsModule } = await loadModules();
  const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");
  return runCliCommand(
    ak_impl.executeCommand,
    createTool.command,
    createTool.buildArgs({ ...args, runId: `no_hazard_${name}`, outDir: join(outDir, name) }),
  );
}

const RESOURCE_SPECS = [
  "tier=level;stat=vitalRegen;delta=1;dropRate=20",
  "tier=permanent;stat=vitalMax;delta=6;dropRate=5",
];

describe("hazard-free rooms are first-class (rooms carry no affinity)", () => {
  let outDir;

  beforeAll(() => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-no-hazard-"));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("an empty room creates successfully (contract pin — passes today)", async () => {
    const result = await createShape(outDir, "empty", {
      room: ["size=medium;count=1"],
      budgetTokens: 2500,
    });
    assert.equal(result.ok, true, `empty room must create: ${result.error}`);
  });

  test("a room with actors and no hazard creates successfully (contract pin — passes today)", async () => {
    const result = await createShape(outDir, "actors", {
      room: ["size=medium;count=1"],
      delver: ["count=1;affinity=fire;motivation=exploring"],
      warden: ["count=1;affinity=water;motivation=defending"],
      budgetTokens: 2500,
    });
    assert.equal(result.ok, true, `room + actors without hazard must create: ${result.error}`);
  });

  test("a room with a trap and no hazard creates successfully (contract pin — passes today)", async () => {
    const result = await createShape(outDir, "trap", {
      room: ["size=medium;count=1"],
      trap: ["x=2;y=2;affinity=fire;expression=emit;stacks=1;blocking=false"],
      budgetTokens: 2500,
    });
    assert.equal(result.ok, true, `room + trap without hazard must create: ${result.error}`);
  });

  test("a room with resources and NO hazard creates with approved resource lines (FAILS today)", async () => {
    const result = await createShape(outDir, "resources", {
      room: ["size=medium;count=1"],
      resource: RESOURCE_SPECS,
      budgetTokens: 2500,
    });
    assert.equal(
      result.ok,
      true,
      `room + resources without hazard must create — got error: ${result.error} ` +
        "(the budget splitter allocates a zero resources pool unless a hazard is present; " +
        "rooms are generic containers with no affinity of their own, so hazard presence must " +
        "not gate resource authorability)",
    );

    const receipt = JSON.parse(readFileSync(join(outDir, "resources", "budget-receipt.json"), "utf8"));
    assert.equal(receipt.status, "approved", `budget receipt must be approved, got ${receipt.status}`);
    const resourceLines = (receipt.lineItems ?? []).filter((line) => line.kind === "resource");
    assert.ok(resourceLines.length >= RESOURCE_SPECS.length, "receipt must itemize the requested resources");
    for (const line of resourceLines) {
      assert.equal(
        line.status,
        "approved",
        `resource line ${line.item ?? "?"} must be approved, got ${line.status}`,
      );
    }
  });

  test("resources with and without a hazard cost the same (no hazard surcharge/discount coupling)", async () => {
    const withHazard = await createShape(outDir, "resources-hazard", {
      room: ["size=medium;count=1"],
      hazard: ["id=h1;affinity=life;expression=emit;proximityRadius=2;mana=regen:3:3:1"],
      resource: RESOURCE_SPECS,
      budgetTokens: 2500,
    });
    assert.equal(withHazard.ok, true, `room + hazard + resources must create: ${withHazard.error}`);

    const withReceipt = JSON.parse(
      readFileSync(join(outDir, "resources-hazard", "budget-receipt.json"), "utf8"),
    );
    const withoutReceipt = JSON.parse(readFileSync(join(outDir, "resources", "budget-receipt.json"), "utf8"));
    const sumResources = (receipt) =>
      (receipt.lineItems ?? [])
        .filter((line) => line.kind === "resource" && line.status === "approved")
        .reduce((total, line) => total + (line.totalCost ?? 0), 0);
    assert.equal(
      sumResources(withoutReceipt),
      sumResources(withHazard.ok ? withReceipt : {}),
      "approved resource spend must be identical with and without a hazard in the request",
    );
  });
});

// ## TODO: Test Permutations
test.skip("hazard-free multi-room dungeon with resources in each room creates approved", () => {});
test.skip("hazard-free room with resources + traps + actors approves all pools", () => {});
test.skip("resource-only request without a room uses the default layout and approves", () => {});
test.skip("benchmark scenario 26 shape minus its hazard still approves all resource lines", () => {});
