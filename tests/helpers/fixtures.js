const { readFileSync, readdirSync } = require("node:fs");
const { resolve, join } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const FIXTURE_ROOT = resolve(ROOT, "tests/fixtures/artifacts");

function fixturePath(name) {
  return resolve(FIXTURE_ROOT, name);
}

function readFixture(name) {
  const filePath = fixturePath(name);
  const content = readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function listFixtures(subdir = "") {
  const dirPath = subdir ? join(FIXTURE_ROOT, subdir) : FIXTURE_ROOT;
  return readdirSync(dirPath);
}

module.exports = {
  FIXTURE_ROOT,
  fixturePath,
  readFixture,
  listFixtures,
};
