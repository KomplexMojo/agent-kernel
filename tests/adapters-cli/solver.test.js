const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");
const { resolve } = require("node:path");

const cliPath = moduleUrl("packages/adapters-cli/src/cli/ak.mjs");
const fixturePath = resolve(__dirname, "../fixtures/artifacts/solver-result-v1-basic.json");

const script = `
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve as res } from "node:path";

const cli = ${JSON.stringify(cliPath)};
const ROOT = dirname(fileURLToPath(cli));
const nodePath = process.execPath;
const outDir = res(ROOT, "../../artifacts/solve_cli_test");

const result = spawnSync(nodePath, [cli.replace("file://", ""), "solve", "--scenario", "test", "--solver-fixture", ${JSON.stringify(fixturePath)}, "--out-dir", outDir], { encoding: "utf8" });
if (result.status !== 0) {
  throw new Error(result.stderr || "solve command failed");
}
`;

test("cli solve supports solver fixture", () => {
  runEsm(script);
});
