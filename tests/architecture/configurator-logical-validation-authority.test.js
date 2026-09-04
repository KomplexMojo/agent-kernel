"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const CONFIGURATOR = resolve(ROOT, "packages/runtime/src/personas/configurator");
const LOGICAL_SOURCES = Object.freeze([
  "logical-validation.js",
  "config-validation.js",
  "affinity-loadouts.js",
  "motivation-loadouts.js",
  "candidate-authoring.js",
]);
const CONSOLIDATED_CALLERS = Object.freeze([
  "config-validation.js",
  "affinity-loadouts.js",
  "motivation-loadouts.js",
  "candidate-authoring.js",
]);

test("Configurator logical validation has one solver-free persona-owned route", () => {
  const forbiddenImport = /from\s+["'][^"']*(?:constraint-problem|ports\/solver|adapters)[^"']*["']/;
  for (const file of LOGICAL_SOURCES) {
    const source = readFileSync(resolve(CONFIGURATOR, file), "utf8");
    assert.equal(forbiddenImport.test(source), false, `${file} imported solver machinery`);
    assert.equal(source.includes("buildConstraintProblem("), false, `${file} built a solver problem`);
    assert.equal(
      source.includes("MAX_AFFINITY_GRANTS_PER_ACTOR"),
      false,
      `${file} conflated authored affinity slots with core live resource grants`,
    );
  }

  for (const file of CONSOLIDATED_CALLERS) {
    const source = readFileSync(resolve(CONFIGURATOR, file), "utf8");
    assert.equal(
      source.includes('from "./logical-validation.js"'),
      true,
      `${file} bypassed the consolidated logical-validation module`,
    );
  }

  const coreAffinity = readFileSync(
    resolve(ROOT, "packages/core-ts/src/state/affinity.ts"),
    "utf8",
  );
  assert.equal(coreAffinity.includes("MAX_AFFINITY_GRANTS_PER_ACTOR = 10"), true);
});
