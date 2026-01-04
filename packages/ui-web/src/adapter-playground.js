import { createIpfsAdapter } from "../../adapters-web/src/adapters/ipfs/index.js";
import { createBlockchainAdapter } from "../../adapters-web/src/adapters/blockchain/index.js";
import { createLlmAdapter } from "../../adapters-web/src/adapters/llm/index.js";
import { createWebSolverAdapter } from "../../adapters-web/src/adapters/solver/index.js";

export const DEFAULT_FIXTURES = Object.freeze({
  ipfs: "/tests/fixtures/adapters/ipfs-price-list.json",
  blockchainChainId: "/tests/fixtures/adapters/blockchain-chain-id.json",
  blockchainBalance: "/tests/fixtures/adapters/blockchain-balance.json",
  llm: "/tests/fixtures/adapters/llm-generate.json",
  solverResult: "/tests/fixtures/artifacts/solver-result-v1-basic.json",
});

async function loadFixtureText(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load fixture ${path}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function loadFixtureJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load fixture ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function runIpfsDemo({
  cid = "fixture",
  path = "",
  gatewayUrl = "https://ipfs.io/ipfs",
  mode = "fixture",
  fixturePath = DEFAULT_FIXTURES.ipfs,
  fixtureText,
  fetchFn,
} = {}) {
  let effectiveFetch = fetchFn;
  if (mode !== "live" && !effectiveFetch) {
    const text = fixtureText || (await loadFixtureText(fixturePath));
    effectiveFetch = async () => ({ ok: true, text: async () => text });
  }
  const adapter = createIpfsAdapter({ gatewayUrl, fetchFn: effectiveFetch });
  return adapter.fetchJson(cid, path);
}

export async function runBlockchainDemo({
  rpcUrl = "http://fixture",
  address = "0xabc",
  mode = "fixture",
  fixtureChainPath = DEFAULT_FIXTURES.blockchainChainId,
  fixtureBalancePath = DEFAULT_FIXTURES.blockchainBalance,
  fixtureChain,
  fixtureBalance,
  fetchFn,
} = {}) {
  let effectiveFetch = fetchFn;
  if (mode !== "live" && !effectiveFetch) {
    const chainPayload = fixtureChain || (await loadFixtureJson(fixtureChainPath));
    const balancePayload = fixtureBalance || (await loadFixtureJson(fixtureBalancePath));
    effectiveFetch = async (_url, options) => {
      const body = JSON.parse(options?.body || "{}");
      if (body.method === "eth_chainId") {
        return { ok: true, json: async () => chainPayload };
      }
      if (body.method === "eth_getBalance") {
        return { ok: true, json: async () => balancePayload };
      }
      return { ok: false, status: 500, statusText: "Missing fixture" };
    };
  }
  const adapter = createBlockchainAdapter({ rpcUrl, fetchFn: effectiveFetch });
  const chainId = await adapter.getChainId();
  const result = { rpcUrl, chainId };
  if (address) {
    result.address = address;
    result.balance = await adapter.getBalance(address);
  }
  return result;
}

export async function runLlmDemo({
  model = "fixture",
  prompt = "hello",
  baseUrl = "http://localhost:11434",
  options = undefined,
  mode = "fixture",
  fixturePath = DEFAULT_FIXTURES.llm,
  fixtureResponse,
  fetchFn,
} = {}) {
  let effectiveFetch = fetchFn;
  if (mode !== "live" && !effectiveFetch) {
    const payload = fixtureResponse || (await loadFixtureJson(fixturePath));
    effectiveFetch = async () => ({ ok: true, json: async () => payload });
  }
  const adapter = createLlmAdapter({ baseUrl, fetchFn: effectiveFetch });
  return adapter.generate({ model, prompt, options, stream: false });
}

export async function runSolverDemo({
  request = { schema: "agent-kernel/SolverRequest", schemaVersion: 1 },
  mode = "fixture",
  fixturePath = DEFAULT_FIXTURES.solverResult,
  fixtureResult,
} = {}) {
  const fixture = mode !== "live" ? (fixtureResult || (await loadFixtureJson(fixturePath))) : undefined;
  const adapter = createWebSolverAdapter({ fixture });
  return adapter.solve(request);
}
