export function createBlockchainTestAdapter({ balances = {}, responses = {} } = {}) {
  const balanceStore = { ...balances };
  const responseStore = { ...responses };

  async function call(method, params = []) {
    const key = `${method}:${JSON.stringify(params)}`;
    if (key in responseStore) {
      return responseStore[key];
    }
    throw new Error(`Missing RPC fixture for ${key}`);
  }

  async function getBalance(address) {
    if (!(address in balanceStore)) {
      throw new Error(`Missing balance fixture for ${address}`);
    }
    return balanceStore[address];
  }

  function setBalance(address, value) {
    balanceStore[address] = value;
  }

  function setResponse(method, params, value) {
    const key = `${method}:${JSON.stringify(params)}`;
    responseStore[key] = value;
  }

  return {
    call,
    getBalance,
    setBalance,
    setResponse,
  };
}
