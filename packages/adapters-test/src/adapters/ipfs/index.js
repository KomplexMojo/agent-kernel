function makeKey(cid, path) {
  const normalized = cid.startsWith("ipfs://") ? cid.slice("ipfs://".length) : cid;
  return path ? `${normalized}:${path}` : normalized;
}

export function createIpfsTestAdapter({ fixtures = {} } = {}) {
  const store = { ...fixtures };

  async function fetchText(cid, path = "") {
    const key = makeKey(cid, path);
    if (!(key in store)) {
      throw new Error(`Missing IPFS fixture for ${key}`);
    }
    return store[key];
  }

  async function fetchJson(cid, path = "") {
    const text = await fetchText(cid, path);
    return JSON.parse(text);
  }

  function setFixture(cid, value, path = "") {
    const key = makeKey(cid, path);
    store[key] = value;
  }

  return {
    fetchText,
    fetchJson,
    setFixture,
  };
}
