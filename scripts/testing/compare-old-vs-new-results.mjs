import { collectTestInventory, runProcess } from "./shared.mjs";

function parseArgs(argv) {
  const files = [];
  let sample = 10;
  for (const arg of argv) {
    if (arg.startsWith("--sample=")) {
      sample = Number(arg.slice("--sample=".length)) || sample;
      continue;
    }
    files.push(arg);
  }
  return { files, sample };
}

function normalizeOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

const { files: explicitFiles, sample } = parseArgs(process.argv.slice(2));
const inventory = collectTestInventory();
const files = explicitFiles.length > 0
  ? explicitFiles
  : inventory.files
    .filter((entry) => entry.runner === "vitest" && entry.currentDefaultIncluded)
    .map((entry) => entry.path)
    .slice(0, sample);

if (files.length === 0) {
  console.log(JSON.stringify({
    ok: true,
    compared: 0,
    files: [],
  }, null, 2));
  process.exit(0);
}

const legacy = runProcess(process.execPath, ["--test", ...files]);
const vitest = runProcess("pnpm", ["exec", "vitest", "run", ...files]);

const parity = legacy.status === vitest.status;

console.log(JSON.stringify({
  ok: parity,
  compared: files.length,
  files,
  legacy: {
    status: legacy.status ?? 1,
    output: normalizeOutput(legacy),
  },
  vitest: {
    status: vitest.status ?? 1,
    output: normalizeOutput(vitest),
  },
}, null, 2));

process.exit(parity ? 0 : 1);
