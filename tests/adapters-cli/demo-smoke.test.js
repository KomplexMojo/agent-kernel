const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/demo-cli.sh");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("demo script produces fixture-backed artifacts", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-demo-"));
  const result = spawnSync("bash", [SCRIPT, outDir], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`demo-cli.sh failed (${result.status}): ${output}`);
  }

  const expected = [
    join(outDir, "solve/solver-request.json"),
    join(outDir, "solve/solver-result.json"),
    join(outDir, "run/tick-frames.json"),
    join(outDir, "run/effects-log.json"),
    join(outDir, "replay/replay-summary.json"),
    join(outDir, "inspect/inspect-summary.json"),
    join(outDir, "ipfs/ipfs.json"),
    join(outDir, "blockchain/blockchain.json"),
    join(outDir, "ollama/ollama.json"),
  ];

  for (const filePath of expected) {
    assert.ok(existsSync(filePath), `Missing ${filePath}`);
  }

  const solverRequest = readJson(expected[0]);
  const solverResult = readJson(expected[1]);
  assert.equal(solverRequest.schema, "agent-kernel/SolverRequest");
  assert.equal(solverResult.schema, "agent-kernel/SolverResult");
  assert.equal(solverResult.requestRef?.schema, "agent-kernel/SolverRequest");

  const ipfsPayload = readJson(expected[6]);
  assert.ok(ipfsPayload.items || ipfsPayload.data || ipfsPayload.rows, "ipfs payload should be JSON");
});
