import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// @ts-expect-error The existing JS binding does not ship TypeScript declarations.
import { loadCore } from "../../packages/bindings-ts/src/core-as.js";
import { CORE_API_KEYS, createCore } from "../../packages/core-ts/src/index.ts";

describe("core-ts API surface", () => {
  test("createCore returns an object", () => {
    expect(typeof createCore()).toBe("object");
  });

  test("createCore is synchronous", () => {
    const result = createCore();

    expect(result).not.toBeInstanceOf(Promise);
  });

  test("API surface has all expected keys", () => {
    expect(Object.keys(createCore()).sort()).toEqual(CORE_API_KEYS);
  });

  test("version returns 1", () => {
    const core = createCore();
    const version = core.version;

    if (typeof version !== "function") {
      throw new Error("version is not callable");
    }
    expect(version()).toBe(1);
  });

  test("stub functions throw 'not implemented'", () => {
    const core = createCore();
    const implementedKeys = new Set([
      "affinityExpressionAllowsEnvironmentMutation",
      "affinityExpressionAllowsTrapArming",
      "affinityExpressionIsPersistentField",
      "clearEffects",
      "computeAffinityIntensity",
      "computeAffinityManaCost",
      "computeAffinityPotency",
      "computeAffinityRadius",
      "getAffinityEffectCount",
      "getAffinityExpressionCount",
      "getAffinityInteractionCellCount",
      "getAffinityKindCount",
      "getAffinityMatrixSourceEffect",
      "getAffinityMatrixTargetEffect",
      "getAffinityMatrixUsesStackCancellation",
      "getAffinityMatrixVisualState",
      "getAffinityTargetTypeCount",
      "getAffinityTargetVital",
      "getAffinityVisualStateCount",
      "getBudget",
      "getBudgetUsage",
      "getCounter",
      "getDefaultAffinityTargetType",
      "getEffectActorId",
      "getEffectCount",
      "getEffectDelta",
      "getEffectKind",
      "getEffectReason",
      "getEffectValue",
      "getEffectX",
      "getEffectY",
      "getLastAffinityCanceledStacks",
      "getLastAffinityNetSourceStacks",
      "getLastAffinityNetTargetStacks",
      "getLastInteractionCanceledStacks",
      "getLastInteractionNetSourceStacks",
      "getLastInteractionNetTargetStacks",
      "getLastInteractionRelationship",
      "getLastInteractionSourceEffect",
      "getLastInteractionTargetEffect",
      "getLastInteractionVisualState",
      "getMotivatedActorAffinityExpressionByIndex",
      "getMotivatedActorAffinityKindByIndex",
      "getMotivatedActorAffinityStacksByIndex",
      "getMotivatedActorCount",
      "getOppositeAffinityKind",
      "resolveAffinityInteraction",
      "resolveAffinityMergedStacks",
      "resolveAffinityRelationshipCode",
      "resolveAffinityStackCancellation",
      "resolveMotivatedActorAffinityInteraction",
      "setBudget",
      "setMotivatedActorAffinity",
      "setMoveAction",
      // M5: motivation
      "addMotivationCostEntry",
      "addMotivationEvaluationEntry",
      "evaluateMotivations",
      "getDefaultMotivationPattern",
      "getLastMotivationCognitionTier",
      "getLastMotivationCombatTier",
      "getLastMotivationFlags",
      "getLastMotivationMobilityTier",
      "getLastMotivationReasoningClass",
      "getMotivationCostLineCount",
      "getMotivationCostLineFamily",
      "getMotivationCostLineKind",
      "getMotivationCostLineQuantity",
      "getMotivationCostLineSpend",
      "getMotivationCostLineUnitCost",
      "getMotivationCostTotal",
      "getMotivationDefaultDesignCost",
      "getMotivationDefaultFlagMask",
      "getMotivationDefaultUnitCost",
      "getMotivationExclusiveGroup",
      "getMotivationFamily",
      "getMotivationFlagCount",
      "getMotivationKindCount",
      "getMotivationPatternCodeAt",
      "getMotivationPatternCount",
      "getMotivationProfileCost",
      "getMotivationTier",
      "motivationKindsConflict",
      "normalizeMotivationIntensity",
      "resetMotivationCostAccumulator",
      "resetMotivationEvaluation",
    ]);
    const stubKeys = seededSample(
      CORE_API_KEYS.filter(
        (key) =>
          key !== "memory" && key !== "version" && !implementedKeys.has(key),
      ),
      3,
    );

    for (const key of stubKeys) {
      expect(() => {
        const fn = core[key];
        if (typeof fn !== "function") {
          throw new Error(`${key} is not callable`);
        }
        fn();
      }).toThrow(`not implemented: ${key}`);
    }
  });

  test("no IO imports in core-ts source", () => {
    const sourceDir = new URL("../../packages/core-ts/src/", import.meta.url);
    const forbidden = [
      /from\s+["'](?:node:)?fs(?:\/promises)?["']/,
      /from\s+["'](?:node:)?http["']/,
      /from\s+["'](?:node:)?child_process["']/,
      /from\s+["']node:/,
      /\bfetch\s*\(/,
    ];

    const srcRoot = fileURLToPath(sourceDir);
    function scanDir(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const source = readFileSync(full, "utf8");
          for (const pattern of forbidden) {
            expect(source).not.toMatch(pattern);
          }
        }
      }
    }
    scanDir(srcRoot);
  });

  test("WASM API parity can run when WASM is built", async (context) => {
    const wasmUrl = new URL("../../build/core-as.wasm", import.meta.url);
    if (!existsSync(wasmUrl)) {
      context.skip();
    }

    const wasmCore = await loadCore({ wasmUrl });

    expect(Object.keys(wasmCore).sort()).toEqual(CORE_API_KEYS);
  });
});

function seededSample<T>(values: readonly T[], count: number): T[] {
  let state = 178;

  return [...values]
    .sort(() => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000 - 0.5;
    })
    .slice(0, count);
}

// ## TODO: Test Permutations
// - WASM parity: compare createCore() keys against loadCore() keys when WASM is available
// - All 178 stubs throw with correct name in error message
// - createCore() returns a fresh instance each call (no shared state)
// - memory property is an ArrayBuffer
