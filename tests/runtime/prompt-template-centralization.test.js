const assert = require("node:assert/strict");
const { readdir, readFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const test = require("node:test");

const ROOT = resolve(__dirname, "../..");
const TARGET_FILE = resolve(ROOT, "packages/runtime/src/contracts/domain-constants.js");
const SEARCH_DIRS = [
  resolve(ROOT, "packages/runtime/src"),
  resolve(ROOT, "packages/ui-web/src"),
  resolve(ROOT, "packages/adapters-cli/src"),
];

const MARKERS = [
  "You are a dungeon level planner.",
  "You are a dungeon defender strategist.",
  "Your previous response failed validation. Fix it and return corrected JSON only.",
  "You are an agent that returns a single JSON object that conforms to the BuildSpec contract.",
];

async function collectJsFiles(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && (fullPath.endsWith(".js") || fullPath.endsWith(".mjs"))) {
      out.push(fullPath);
    }
  }
  return out;
}

test("canonical prompt template markers are centralized in domain-constants", async () => {
  const files = [];
  for (const dir of SEARCH_DIRS) {
    await collectJsFiles(dir, files);
  }

  const fileContents = await Promise.all(files.map(async (path) => ({
    path,
    text: await readFile(path, "utf8"),
  })));

  for (const marker of MARKERS) {
    const matches = fileContents.filter((entry) => entry.text.includes(marker)).map((entry) => entry.path);
    assert.equal(matches.length, 1, `expected exactly one definition for marker: ${marker}`);
    assert.equal(matches[0], TARGET_FILE, `marker should be defined only in ${TARGET_FILE}`);
  }
});
