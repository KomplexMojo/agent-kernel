const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");

function moduleUrl(relativePath) {
  return pathToFileURL(resolve(ROOT, relativePath)).href;
}

function runEsm(script) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--experimental-default-type=module", "--eval", script],
    {
      cwd: ROOT,
      encoding: "utf8",
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
