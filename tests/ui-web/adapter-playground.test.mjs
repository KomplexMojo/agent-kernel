import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  runIpfsDemo,
  runBlockchainDemo,
  runLlmDemo,
  runSolverDemo,
} from "../../packages/ui-web/src/adapter-playground.js";
import { wireAdapterPanel } from "../../packages/ui-web/src/adapter-panel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const fixtures = {
  ipfsText: readFileSync(path.join(root, "tests/fixtures/adapters/ipfs-price-list.json"), "utf8"),
  chain: JSON.parse(readFileSync(path.join(root, "tests/fixtures/adapters/blockchain-chain-id.json"), "utf8")),
  balance: JSON.parse(readFileSync(path.join(root, "tests/fixtures/adapters/blockchain-balance.json"), "utf8")),
  llm: JSON.parse(readFileSync(path.join(root, "tests/fixtures/adapters/ollama-generate.json"), "utf8")),
  solver: JSON.parse(readFileSync(path.join(root, "tests/fixtures/artifacts/solver-result-v1-basic.json"), "utf8")),
};

test("adapter helpers return fixture-backed data", async () => {
  const ipfs = await runIpfsDemo({ fixtureText: fixtures.ipfsText });
  assert.equal(ipfs.schema, "agent-kernel/PriceList");
  assert.equal(ipfs.items[0].key, "move");

  const chain = await runBlockchainDemo({
    fixtureChain: fixtures.chain,
    fixtureBalance: fixtures.balance,
  });
  assert.equal(chain.chainId, fixtures.chain.result);
  assert.equal(chain.balance, fixtures.balance.result);

  const llm = await runLlmDemo({ fixtureResponse: fixtures.llm });
  assert.equal(llm.response, "ok");

  const solver = await runSolverDemo({ fixtureResult: fixtures.solver });
  assert.equal(solver.schema, "agent-kernel/SolverResult");
  assert.equal(solver.requestRef.schema, "agent-kernel/SolverRequest");
});

test("adapter helpers support live mode with custom fetch", async () => {
  const ipfs = await runIpfsDemo({
    mode: "live",
    fetchFn: async () => ({ ok: true, text: async () => fixtures.ipfsText }),
  });
  assert.equal(ipfs.schema, "agent-kernel/PriceList");

  const chain = await runBlockchainDemo({
    mode: "live",
    fetchFn: async (_url, options) => {
      const body = JSON.parse(options?.body || "{}");
      if (body.method === "eth_chainId") {
        return { ok: true, json: async () => fixtures.chain };
      }
      if (body.method === "eth_getBalance") {
        return { ok: true, json: async () => fixtures.balance };
      }
      return { ok: false, status: 500, statusText: "Missing fixture" };
    },
  });
  assert.equal(chain.chainId, fixtures.chain.result);
});

function makeButton() {
  const handlers = {};
  return {
    disabled: false,
    addEventListener(event, fn) {
      handlers[event] = fn;
    },
    click() {
      return handlers.click?.();
    },
  };
}

function makeInput(value = "") {
  return { value };
}

test("wireAdapterPanel updates status/output and calls helpers", async () => {
  const output = { textContent: "" };
  const status = { textContent: "" };
  const buttons = {
    ipfs: makeButton(),
    blockchain: makeButton(),
    llm: makeButton(),
    solver: makeButton(),
    clear: makeButton(),
  };

  const calls = [];
  const helpers = {
    runIpfsDemo: async (opts) => {
      calls.push({ kind: "ipfs", opts });
      return { cid: opts.cid || "fixture" };
    },
    runBlockchainDemo: async () => {
      calls.push({ kind: "blockchain" });
      return { chainId: "0x1" };
    },
    runLlmDemo: async () => {
      calls.push({ kind: "llm" });
      return { response: "ok" };
    },
    runSolverDemo: async () => {
      calls.push({ kind: "solver" });
      return { status: "fulfilled" };
    },
  };

  wireAdapterPanel({
    elements: {
      modeSelect: { value: "fixture" },
      gatewayInput: makeInput("https://ipfs.io/ipfs"),
      rpcInput: makeInput("http://fixture"),
      llmInput: makeInput("http://localhost:11434"),
      addressInput: makeInput("0xabc"),
      cidInput: makeInput("fixture"),
      ipfsPathInput: makeInput(""),
      promptInput: makeInput("hello"),
      outputEl: output,
      statusEl: status,
      clearButton: buttons.clear,
      ipfsButton: buttons.ipfs,
      blockchainButton: buttons.blockchain,
      llmButton: buttons.llm,
      solverButton: buttons.solver,
    },
    helpers,
  });

  await buttons.ipfs.click();
  assert.equal(calls[0].kind, "ipfs");
  assert.ok(output.textContent.includes("fixture"));
  assert.match(status.textContent, /complete/);

  await buttons.clear.click();
  assert.equal(output.textContent, "");
  assert.equal(status.textContent, "Cleared");
});
