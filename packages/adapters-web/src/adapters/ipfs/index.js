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

export function createIpfsAdapter({ gatewayUrl = "https://ipfs.io/ipfs", fetchFn = fetch } = {}) {
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

  function defaultAddUrl() {
    const trimmed = gatewayUrl.endsWith("/") ? gatewayUrl.slice(0, -1) : gatewayUrl;
    if (trimmed.endsWith("/ipfs")) {
      return `${trimmed.slice(0, -5)}/api/v0/add`;
    }
    return `${trimmed}/api/v0/add`;
  }

  async function publishJsonMap(artifactMap = {}, { pathPrefix = "", addUrl } = {}) {
    if (!artifactMap || typeof artifactMap !== "object" || Array.isArray(artifactMap)) {
      throw new Error("IPFS publish requires an artifact map object.");
    }
    const entries = Object.entries(artifactMap)
      .filter(([name, value]) => typeof name === "string" && name.trim() && value !== undefined);
    if (entries.length === 0) {
      throw new Error("IPFS publish requires at least one artifact.");
    }

    const formData = new FormData();
    const cleanPrefix = String(pathPrefix || "").replace(/^\/+|\/+$/g, "");
    entries.forEach(([fileName, value]) => {
      const normalizedFile = fileName.replace(/^\/+/, "");
      const fullName = cleanPrefix ? `${cleanPrefix}/${normalizedFile}` : normalizedFile;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      formData.append("file", new Blob([text], { type: "application/json" }), fullName);
    });

    const response = await fetchFn(addUrl || defaultAddUrl(), {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`IPFS publish failed: ${response.status} ${response.statusText}`);
    }
    const bodyText = await response.text();
    const lines = bodyText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return null;
        }
      })
      .filter((entry) => entry && typeof entry === "object");
    const last = parsed[parsed.length - 1];
    const cid = last?.Hash;
    if (!cid) {
      throw new Error("IPFS publish response did not include a CID hash.");
    }
    return {
      cid,
      entries: parsed,
      rootName: last?.Name || "",
    };
  }

  return {
    buildUrl,
    fetchText,
    fetchJson,
    publishJsonMap,
  };
}
