import { describe, expect, it } from "vitest";
import { createCommandKernel } from "../../packages/runtime/src/commands/kernel.js";
import { runAuthoringBuild, runPlanBuild } from "../../packages/runtime/src/build/authoring-build.js";
import { createConfiguratorPersona } from "../../packages/runtime/src/personas/configurator/controller.js";
import { createHybridConstraintSolverAdapter } from "../../packages/adapters-cli/src/adapters/z3/index.js";

// #296: `ak create` and the *-plan commands build through runAuthoringBuild/runPlanBuild,
// which called orchestrateBuild with no `placeObjects` host. The Configurator's object
// placement then never reached the solver and always took the reading-order fallback,
// while `ak build` and `ak llm-plan` hosted it -- the same persona question answered two
// ways depending on the command.

const CREATED_AT = "2026-10-17T00:00:00.000Z";

function authoringInput(runId) {
  return {
    summary: { commandName: "create" },
    commandName: "create",
    runId,
    createdAt: CREATED_AT,
    movementStamina: {},
    resources: [{ id: "resource_1", vitals: { durability: { current: 1, max: 1, regen: 0 } }, holdings: [] }],
  };
}

function spyPlacer() {
  const calls = [];
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  const placeObjects = async (args) => {
    calls.push(args);
    return configurator.completeObjectPlacement(args);
  };
  return { calls, placeObjects };
}

function recordingSolverAdapter() {
  const real = createHybridConstraintSolverAdapter();
  const domains = [];
  return {
    domains,
    adapter: {
      ...real,
      solve: async (request) => {
        domains.push(request?.problem?.domain ?? request?.domain ?? null);
        return real.solve(request);
      },
    },
  };
}

function kernelHost(createSolverAdapter) {
  const unused = () => { throw new Error("not used by this test"); };
  return {
    readJson: unused, readText: unused, writeJson: unused, resolvePath: (p) => p,
    join: (...parts) => parts.join("/"), dirname: (p) => p, exists: () => false,
    makeId: (prefix) => `${prefix}_1`, createMeta: unused, toRef: unused,
    defaultBuildOutDir: unused, defaultRunCommandOutDir: unused, defaultLlmPlanOutDir: unused,
    allowNetworkRequests: () => false, isLlmLiveEnabled: () => false,
    isLlmStrictEnabled: () => false, isLlmBudgetLoopEnabled: () => false,
    isLocalBaseUrl: () => true, createSolverAdapter, createLlmAdapter: unused,
    nowIso: () => CREATED_AT,
  };
}

describe("authoring builds host object placement", () => {
  it("runAuthoringBuild hands its placeObjects host to the build", async () => {
    const { calls, placeObjects } = spyPlacer();
    const result = await runAuthoringBuild({ ...authoringInput("run_296_authoring"), placeObjects });
    expect(result.buildResult).toBeTruthy();
    expect(calls.length).toBe(1);
  });

  it("runPlanBuild hands its placeObjects host to the build", async () => {
    const { calls, placeObjects } = spyPlacer();
    const result = await runPlanBuild({
      summary: { commandName: "resource-plan" },
      commandName: "resource-plan",
      runId: "run_296_plan",
      createdAt: CREATED_AT,
      placeObjects,
    });
    expect(result.buildResult).toBeTruthy();
    expect(calls.length).toBe(1);
  });

  it("the command kernel's authoringBuild poses placement to the host's solver adapter", async () => {
    const { adapter, domains } = recordingSolverAdapter();
    let created = 0;
    const kernel = createCommandKernel(kernelHost(async () => { created += 1; return adapter; }));
    await kernel.authoringBuild(authoringInput("run_296_kernel"));
    expect(created).toBeGreaterThan(0);
    expect(domains).toContain("configurator_satisfiability");
  });
});
