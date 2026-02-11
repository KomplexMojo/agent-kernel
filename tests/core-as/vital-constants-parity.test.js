const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const WORLD_TS = resolve(ROOT, "packages/core-as/assembly/state/world.ts");

function parseVitalKindEnum(sourceText) {
  const blockMatch = sourceText.match(/export const enum VitalKind\s*\{([\s\S]*?)\n\}/);
  if (!blockMatch) return null;
  const lines = blockMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

  const members = [];
  lines.forEach((line) => {
    const cleaned = line.endsWith(",") ? line.slice(0, -1) : line;
    const match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9]+)$/);
    if (!match) return;
    members.push({ name: match[1], value: Number(match[2]) });
  });
  return members;
}

test("shared runtime vital constants match core-as VitalKind enum order", async () => {
  const { VITAL_KEYS, VITAL_KIND } = await import("../../packages/runtime/src/contracts/domain-constants.js");
  const source = readFileSync(WORLD_TS, "utf8");
  const members = parseVitalKindEnum(source);
  assert.ok(members && members.length > 0, "Failed to parse VitalKind enum from core-as.");

  const coreKeys = members.map((entry) => entry.name.toLowerCase());
  assert.deepEqual(coreKeys, Array.from(VITAL_KEYS));

  members.forEach((entry, index) => {
    const key = entry.name.toLowerCase();
    assert.equal(VITAL_KIND[key], index);
    assert.equal(entry.value, index);
  });
});

