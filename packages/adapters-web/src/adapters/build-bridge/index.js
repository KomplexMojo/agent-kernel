export function createBuildBridgeAdapter({ baseUrl = "/bridge/build", fetchFn = fetch } = {}) {
  if (!fetchFn) {
    throw new Error("Build bridge adapter requires a fetch implementation.");
  }

  async function build({ specPath, specJson, outDir } = {}) {
    if (!specPath && !specJson) {
      throw new Error("Build bridge requires specPath or specJson.");
    }
    if (specPath && specJson) {
      throw new Error("Build bridge accepts specPath or specJson, not both.");
    }

    const payload = {};
    if (specPath) payload.specPath = specPath;
    if (specJson) payload.specJson = specJson;
    if (outDir) payload.outDir = outDir;

    const response = await fetchFn(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch (err) {
        detail = "";
      }
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`Build bridge request failed: ${response.status} ${response.statusText}${suffix}`);
    }

    return response.json();
  }

  return { build };
}
