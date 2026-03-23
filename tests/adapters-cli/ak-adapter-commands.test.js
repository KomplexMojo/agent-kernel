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
const blockchainMintFixture = readFileSync(resolve(ROOT, "tests/fixtures/adapters/blockchain-mint.json"), "utf8");
const blockchainLoadFixture = readFileSync(resolve(ROOT, "tests/fixtures/adapters/blockchain-load.json"), "utf8");

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

test("cli ipfs-load command writes canonical artifact files from fixture map", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-ipfs-load-"));
  runCli([
    "ipfs-load",
    "--cid",
    "bafyfixture",
    "--fixture-map",
    "tests/fixtures/adapters/ipfs-package-map.json",
    "--out-dir",
    outDir,
  ]);
  const summary = JSON.parse(readFileSync(join(outDir, "ipfs-load.json"), "utf8"));
  assert.equal(summary.cid, "bafyfixture");
  assert.equal(summary.loadMode, "core");
  assert.ok(summary.fetchedFiles.includes("bundle.json"));
  assert.ok(summary.fetchedFiles.includes("manifest.json"));
  assert.ok(summary.fetchedFiles.includes("ipfs-package.json"));

  const bundle = JSON.parse(readFileSync(join(outDir, "bundle.json"), "utf8"));
  assert.equal(bundle.spec.schema, "agent-kernel/BuildSpec");
  const simConfig = JSON.parse(readFileSync(join(outDir, "sim-config.json"), "utf8"));
  assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
});

test("cli ipfs-load resume writes checkpoint payloads from package fixture", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-ipfs-load-resume-"));
  runCli([
    "ipfs-load",
    "--cid",
    "bafyfixture",
    "--load-mode",
    "resume",
    "--fixture-map",
    "tests/fixtures/adapters/ipfs-package-map.json",
    "--out-dir",
    outDir,
  ]);
  const summary = JSON.parse(readFileSync(join(outDir, "ipfs-load.json"), "utf8"));
  assert.equal(summary.loadMode, "resume");
  assert.ok(summary.fetchedFiles.includes("checkpoint-state.json"));
  assert.ok(summary.fetchedFiles.includes("action-log.json"));
  assert.ok(summary.fetchedFiles.includes("run-summary.json"));

  const checkpoint = JSON.parse(readFileSync(join(outDir, "checkpoint-state.json"), "utf8"));
  assert.equal(checkpoint.schema, "agent-kernel/RuntimeCheckpointArtifact");
});

test("cli ipfs-publish command writes publish summary from canonical artifact map", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-ipfs-publish-"));
  runCli([
    "ipfs-publish",
    "--artifact-map",
    "tests/fixtures/adapters/ipfs-artifacts-map.json",
    "--fixture-cid",
    "bafypublishfixture",
    "--out-dir",
    outDir,
  ]);
  const summary = JSON.parse(readFileSync(join(outDir, "ipfs-publish.json"), "utf8"));
  assert.equal(summary.cid, "bafypublishfixture");
  assert.equal(summary.mode, "fixture");
  assert.equal(summary.scope, "core");
  assert.ok(summary.publishedFiles.includes("ipfs-package.json"));
  assert.ok(summary.publishedFiles.includes("core/bundle.json"));
  assert.ok(summary.publishedFiles.includes("core/manifest.json"));
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

test("cli blockchain-mint command writes minted token metadata", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-blockchain-mint-"));
  runCli([
    "blockchain-mint",
    "--rpc-url",
    "http://local",
    "--card",
    "tests/fixtures/adapters/card-config-delver.json",
    "--owner",
    "0xabc",
    "--fixture-chain-id",
    "tests/fixtures/adapters/blockchain-chain-id.json",
    "--fixture-mint",
    "tests/fixtures/adapters/blockchain-mint.json",
    "--out-dir",
    outDir,
  ]);
  const payload = JSON.parse(readFileSync(join(outDir, "blockchain-mint.json"), "utf8"));
  assert.equal(payload.chainId, JSON.parse(chainFixture).result);
  assert.equal(payload.tokenId, JSON.parse(blockchainMintFixture).result.tokenId);
  assert.equal(payload.txHash, JSON.parse(blockchainMintFixture).result.txHash);
});

test("cli blockchain-mint includes affinity and motivation rules anchoring metadata", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-blockchain-mint-rules-"));
  runCli([
    "blockchain-mint",
    "--rpc-url",
    "http://local",
    "--card",
    "tests/fixtures/adapters/card-config-delver.json",
    "--affinity-rules",
    "tests/fixtures/artifacts/affinity-rules-artifact-v1-basic.json",
    "--motivation-rules",
    "tests/fixtures/artifacts/motivation-rules-artifact-v1-basic.json",
    "--fixture-chain-id",
    "tests/fixtures/adapters/blockchain-chain-id.json",
    "--fixture-mint",
    "tests/fixtures/adapters/blockchain-mint.json",
    "--out-dir",
    outDir,
  ]);
  const payload = JSON.parse(readFileSync(join(outDir, "blockchain-mint.json"), "utf8"));
  assert.equal(payload.affinityRulesRef.schema, "agent-kernel/AffinityRulesArtifact");
  assert.equal(payload.affinityRulesVersion, "2026.03.22");
  assert.equal(payload.affinityRulesHash, "sha256:affinity-rules-basic");
  assert.equal(payload.motivationRulesRef.schema, "agent-kernel/MotivationRulesArtifact");
  assert.equal(payload.motivationRulesVersion, "2026.03.22");
  assert.equal(payload.motivationRulesHash, "sha256:motivation-rules-basic");
});

test("cli blockchain-load command writes minted card payload", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-blockchain-load-"));
  runCli([
    "blockchain-load",
    "--rpc-url",
    "http://local",
    "--token-id",
    "token_fixture_1",
    "--fixture-chain-id",
    "tests/fixtures/adapters/blockchain-chain-id.json",
    "--fixture-load",
    "tests/fixtures/adapters/blockchain-load.json",
    "--out-dir",
    outDir,
  ]);
  const payload = JSON.parse(readFileSync(join(outDir, "blockchain-load.json"), "utf8"));
  assert.equal(payload.chainId, JSON.parse(chainFixture).result);
  assert.equal(payload.tokenId, "token_fixture_1");
  assert.equal(payload.card.id, JSON.parse(blockchainLoadFixture).result.card.id);
  assert.equal(payload.card.type, "delver");
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

test("cli llm command defaults model to phi4 when omitted", async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-llm-default-model-"));
  runCli([
    "llm",
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
