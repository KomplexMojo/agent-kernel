function normalizeCid(value) {
  if (!value) {
    throw new Error("IPFS CID is required.");
  }
  if (value.startsWith("ipfs://")) {
    return value.slice("ipfs://".length);
  }
  return value;
}

function joinPath(base, path) {
  if (!path) {
    return base;
  }
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base}/${trimmed}`;
}

export function createIpfsAdapter({ gatewayUrl = "https://ipfs.io/ipfs", fetchFn = globalThis.fetch } = {}) {
  if (!fetchFn) {
    throw new Error("IPFS adapter requires a fetch implementation.");
  }

  function buildUrl(cid, path = "") {
    const normalizedCid = normalizeCid(cid);
    const base = gatewayUrl.endsWith("/") ? gatewayUrl.slice(0, -1) : gatewayUrl;
    return joinPath(`${base}/${normalizedCid}`, path);
  }

  async function fetchText(cid, path = "") {
    const url = buildUrl(cid, path);
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async function fetchJson(cid, path = "") {
    const text = await fetchText(cid, path);
    return JSON.parse(text);
  }

  return {
    buildUrl,
    fetchText,
    fetchJson,
  };
}
