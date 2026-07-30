/**
 * G1 — persona authority tests, driven by persona-authority-registry.js.
 *
 * Three jobs:
 *   1. Keep the registry HONEST — every persona covered, every open finding
 *      represented, every cited path real. A registry that has rotted is worse than
 *      none, because it reads like coverage.
 *   2. Publish the BACKLOG as a count instead of a judgement: one skipped test per
 *      unowned behavior, each naming the finding that blocks it (DECISION D-k).
 *   3. Run the live differentials for behaviors claimed as owned.
 *
 * The differential mechanism, for the one behavior that has it: production and the
 * persona standalone are given the same input, and their VERDICTS must agree. That
 * is the gate no output test can satisfy vacuously — a façade passes goldens by
 * construction, but it cannot agree with a persona it is not consulting.
 */
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  CHARTER_PERSONAS,
  REGISTRY,
  fixtureFor,
  isOwned,
  blockingFinding,
} = require("./persona-authority-registry.js");

const ROOT = resolve(__dirname, "../..");

// Findings still open in local-codex/Plan.md. Kept here so the registry cannot
// silently stop tracking one: if a finding is open but no entry names it, the
// coverage test below fails.
const OPEN_FINDINGS = Object.freeze([
  "CR.1", "CR.3", "CR.4", "CR.5", "CR.6", "CR.7", "CR.8", "CR.9",
  "PX.1", "PX.3", "PX.4", "PX.5",
]);

// ---------------------------------------------------------------------------
// The registry stays honest
// ---------------------------------------------------------------------------

test("every charter persona has at least one registered behavior", () => {
  const covered = new Set(REGISTRY.map((entry) => entry.persona));
  for (const persona of CHARTER_PERSONAS) {
    assert.ok(covered.has(persona), `${persona} has no G1 registry entry — its behaviors are unmeasured`);
  }
});

test("every open finding is represented by at least one registry entry", () => {
  const blocking = new Set(REGISTRY.map(blockingFinding).filter(Boolean));
  const unrepresented = OPEN_FINDINGS.filter((finding) => !blocking.has(finding));
  assert.deepEqual(
    unrepresented,
    [],
    `open findings with no G1 entry (the backlog would under-report): ${unrepresented.join(", ")}`,
  );
});

test("registry entries are well-formed and cite paths that exist", () => {
  const ids = new Set();
  for (const entry of REGISTRY) {
    assert.ok(entry.id && !ids.has(entry.id), `duplicate or missing registry id: ${entry.id}`);
    ids.add(entry.id);

    assert.ok(CHARTER_PERSONAS.includes(entry.persona), `${entry.id}: unknown persona ${entry.persona}`);
    assert.ok(entry.behavior?.length > 0, `${entry.id}: needs a behavior description`);
    assert.ok(Array.isArray(entry.criteria) && entry.criteria.length > 0, `${entry.id}: needs A1-A5 criteria`);
    for (const criterion of entry.criteria) {
      assert.match(criterion, /^A[1-5]$/, `${entry.id}: "${criterion}" is not an A1-A5 criterion`);
    }
    assert.ok(["cli", "service", "none"].includes(entry.invocation), `${entry.id}: bad invocation kind`);

    // A cited production entry point that no longer exists means the registry has
    // rotted — the exact failure mode that made the boundary allowlist untrustworthy.
    assert.ok(
      existsSync(resolve(ROOT, entry.productionEntryPoint)),
      `${entry.id}: production entry point does not exist: ${entry.productionEntryPoint}`,
    );

    // Exactly one of owned / blockedBy.
    const owned = isOwned(entry);
    const blocked = Boolean(blockingFinding(entry));
    assert.ok(owned !== blocked, `${entry.id}: status must be either owned:true or blockedBy:<finding>`);
    if (blocked) {
      assert.ok(entry.status.why?.length > 0, `${entry.id}: a blocked entry must say why`);
    }
  }
});

test("every cli-invocable entry has a standalone fixture", () => {
  for (const entry of REGISTRY.filter((candidate) => candidate.invocation === "cli")) {
    const fixture = fixtureFor(entry.persona);
    assert.ok(
      existsSync(resolve(ROOT, fixture)),
      `${entry.id}: no standalone fixture at ${fixture}`,
    );
  }
});

test("the backlog is measured: report owned vs blocked", () => {
  const owned = REGISTRY.filter(isOwned);
  const blocked = REGISTRY.filter((entry) => blockingFinding(entry));
  assert.equal(owned.length + blocked.length, REGISTRY.length);
  // Not an aspiration — a tripwire. When a finding closes, its entry flips to
  // owned:true and this number moves. If it never moves, nothing is being proven.
  assert.ok(owned.length >= 1, "at least one behavior must be provably owned");
  assert.ok(
    blocked.length >= 1,
    "if nothing is blocked, either the program is finished or the registry stopped tracking",
  );
});

// ---------------------------------------------------------------------------
// The backlog, as one skipped test per unowned behavior (D-k)
// ---------------------------------------------------------------------------

for (const entry of REGISTRY.filter((candidate) => blockingFinding(candidate))) {
  test.skip(
    `G1 [${blockingFinding(entry)}] ${entry.persona}: ${entry.behavior} (${entry.criteria.join("+")})`,
    () => {
      // Intentionally unimplemented. Writing the differential is part of closing
      // ${blockingFinding(entry)}; this skip exists so the behavior is visible as
      // unowned rather than absent. See entry ${entry.id}.
    },
  );
}

// ---------------------------------------------------------------------------
// Live differential: configurator/validate-lock@build (owned since CR.2)
// ---------------------------------------------------------------------------

test("G1 configurator/validate-lock@build: production and the standalone persona agree on every verdict", async () => {
  const { runAuthoringBuild } = await import("../../packages/runtime/src/build/authoring-build.js");
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/persona.js"
  );

  // Resources are the honest vehicle: mapResources carries authored fields through
  // without synthesizing missing ones, so a bad entry survives to validate().
  // (levelGen cannot be — prepareLevelGen regenerates it before validation sees it.)
  const cases = [
    { name: "valid resource", resources: [{ id: "resource_1", tier: "common", stat: "health", delta: 1, dropRate: 1 }] },
    { name: "id-less resource", resources: [{ tier: "common", stat: "health", delta: 1, dropRate: 1 }] },
    { name: "blank id", resources: [{ id: "   ", tier: "common", stat: "health", delta: 1, dropRate: 1 }] },
    { name: "no resources at all", resources: [] },
  ];

  for (const testCase of cases) {
    // The persona's own verdict, reached standalone through its service surface.
    const standalone = createConfiguratorPersona({ clock: () => "2026-07-29T00:00:00.000Z" });
    standalone.provideConfig({});
    if (testCase.resources.length > 0) standalone.mapResources(testCase.resources);
    let personaAccepts = true;
    try {
      standalone.validate();
    } catch (error) {
      assert.equal(error.code, "configurator_invalid", `${testCase.name}: unexpected refusal kind`);
      personaAccepts = false;
    }

    // Production's verdict on the same input.
    let productionAccepts = true;
    let productionError = null;
    try {
      await runAuthoringBuild({
        summary: { commandName: "create" },
        commandName: "create",
        runId: `run_g1_${testCase.name.replace(/\W+/g, "_")}`,
        createdAt: "2026-07-29T00:00:00.000Z",
        resources: testCase.resources,
      });
    } catch (error) {
      productionAccepts = false;
      productionError = error;
    }

    assert.equal(
      productionAccepts,
      personaAccepts,
      `${testCase.name}: production ${productionAccepts ? "accepted" : "refused"} a config the `
        + `Configurator ${personaAccepts ? "accepted" : "refused"} — glue reached a different verdict `
        + "than the owning persona, which is a second implementation of a chartered decision",
    );
    if (!personaAccepts) {
      assert.equal(
        productionError.code,
        "configurator_invalid",
        `${testCase.name}: production must fail with the PERSONA's error, not its own`,
      );
    }
  }
});

test("G1 configurator/validate-lock@build: neutering the persona's verdict breaks production (ablation)", async () => {
  // The backstop for A2. If validate() could not refuse, production would build
  // anything — which is precisely the state CR.2 found and fixed. Asserted here
  // against the real module so the dependency is structural, not documentary.
  const { runAuthoringBuild } = await import("../../packages/runtime/src/build/authoring-build.js");
  const source = require("node:fs").readFileSync(
    resolve(ROOT, "packages/runtime/src/build/authoring-build.js"),
    "utf8",
  );
  assert.match(
    source,
    /configurator\.validate\(\);\s*\n\s*configurator\.lock\(\);/,
    "runAuthoringBuild must call validate() then lock() — removing either is what CR.2 fixed",
  );

  // And the refusal genuinely stops the build rather than being logged.
  await assert.rejects(
    () => runAuthoringBuild({
      summary: { commandName: "create" },
      commandName: "create",
      runId: "run_g1_ablation",
      createdAt: "2026-07-29T00:00:00.000Z",
      resources: [{ tier: "common", stat: "health", delta: 1, dropRate: 1 }],
    }),
    (error) => error.code === "configurator_invalid",
  );
});

// ## TODO: Test Permutations
