const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");

function moduleUrl(relativePath) {
  return pathToFileURL(resolve(ROOT, relativePath)).href;
}

function runEsm(script) {
  const env = {
    ...process.env,
  };
  if (!("TS_NODE_TRANSPILE_ONLY" in env)) {
    env.TS_NODE_TRANSPILE_ONLY = "1";
  }
  const loaderScript = `import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));`;
  const result = spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(loaderScript)}`, "--input-type=module", "--eval", script],
    {
      cwd: ROOT,
      encoding: "utf8",
      env,
    },
  );
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`ESM script failed (${result.status}): ${output}`);
  }
  return result;
}

module.exports = {
  ROOT,
  moduleUrl,
  runEsm,
};
