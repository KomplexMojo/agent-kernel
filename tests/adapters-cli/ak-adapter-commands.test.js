const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const ipfsFixture = readFileSync(resolve(ROOT, "tests/fixtures/adapters/ipfs-price-list.json"), "utf8");
const chainFixture = readFileSync(resolve(ROOT, "tests/fixtures/adapters/blockchain-chain-id.json"), "utf8");
const balanceFixture = readFileSync(resolve(ROOT, "tests/fixtures/adapters/blockchain-balance.json"), "utf8");

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

test("cli ipfs command writes fetched JSON", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-ipfs-"));
  runCli([
    "ipfs",
    "--cid",
    "bafy",
    "--gateway",
    "http://local",
    "--json",
    "--fixture",
    "tests/fixtures/adapters/ipfs-price-list.json",
    "--out-dir",
    outDir,
  ]);
  const payload = JSON.parse(readFileSync(join(outDir, "ipfs.json"), "utf8"));
  assert.equal(payload.schema, "agent-kernel/PriceList");
});

test("cli blockchain command writes chainId and balance", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-blockchain-"));
  runCli([
    "blockchain",
    "--rpc-url",
    "http://local",
    "--address",
    "0xabc",
    "--fixture-chain-id",
    "tests/fixtures/adapters/blockchain-chain-id.json",
    "--fixture-balance",
    "tests/fixtures/adapters/blockchain-balance.json",
    "--out-dir",
    outDir,
  ]);
  const payload = JSON.parse(readFileSync(join(outDir, "blockchain.json"), "utf8"));
  assert.equal(payload.chainId, JSON.parse(chainFixture).result);
  assert.equal(payload.balance, JSON.parse(balanceFixture).result);
});

test("cli llm command writes response JSON", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-"));
  runCli([
    "llm",
    "--model",
    "fixture",
    "--prompt",
    "hello",
    "--base-url",
    "http://local",
    "--fixture",
    "tests/fixtures/adapters/llm-generate.json",
    "--out-dir",
    outDir,
  ]);
  const payload = JSON.parse(readFileSync(join(outDir, "llm.json"), "utf8"));
  assert.equal(payload.response, "ok");
});
