// Shared helpers for driving the agent-kernel CLI (`ak.mjs`) from tests.
// Keeps the per-element matrix and complexity-ladder suites DRY.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

/**
 * Run `ak <subcmd> <args>` and parse the trailing JSON line from stdout.
 * Successful commands and most validation failures emit one JSON object line.
 */
export function runAk(subcmd, args, { cwd = ROOT } = {}) {
  const result = spawnSync(process.execPath, [CLI, subcmd, ...args], { cwd, encoding: "utf8" });
  const stdout = (result.stdout || "").trim();
  let json;
  try {
    json = JSON.parse(stdout.split("\n").filter(Boolean).pop() || "{}");
  } catch {
    json = { ok: false, parseError: true, stdout, stderr: result.stderr };
  }
  return { status: result.status, json, stdout, stderr: result.stderr };
}

/** Make a throwaway temp output directory under the OS tmp dir. */
export function makeOutDir(prefix) {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

/** Read a JSON file, or null if it does not exist. */
export function readJsonIfExists(filePath) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : null;
}
