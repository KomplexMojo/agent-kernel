export function createBlockchainAdapter({ rpcUrl, fetchFn = globalThis.fetch } = {}) {
  if (!rpcUrl) {
    throw new Error("Blockchain adapter requires an rpcUrl.");
  }
  if (!fetchFn) {
    throw new Error("Blockchain adapter requires a fetch implementation.");
  }

  async function call(method, params = []) {
    const response = await fetchFn(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "RPC error");
    }
    return data.result;
  }

  async function getBalance(address, blockTag = "latest") {
    return call("eth_getBalance", [address, blockTag]);
  }

  async function getChainId() {
    return call("eth_chainId");
  }

  return {
    call,
    getBalance,
    getChainId,
  };
}
