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

  test("all API keys are implemented (no stubs remain)", () => {
    const core = createCore();
    const nonFunctionKeys = new Set(["memory"]);

    for (const key of CORE_API_KEYS) {
      if (nonFunctionKeys.has(key)) continue;
      const fn = core[key];
      expect(typeof fn).toBe("function");
      // Verify it does NOT throw "not implemented"
      try {
        (fn as (...args: unknown[]) => unknown)();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).not.toContain("not implemented");
      }
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
