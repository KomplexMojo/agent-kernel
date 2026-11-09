// #505 — the shared controls are data every interface reads: the runtime bindings cover every
// intent, and ui-ascii defines no bindings of its own (it only decodes terminal bytes).
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  INTENT, INTENT_BINDINGS, MOVE_BINDINGS, MOVE_DIRECTIONS, WATCH_INTENT, WATCH_BINDINGS,
  intentForLogicalKey, watchIntentForLogicalKey,
} from "../../packages/runtime/src/controls/intents.js";

describe("shared controls", () => {
  test("every intent has a binding (move by direction, select by digit)", () => {
    const bound = new Set(Object.keys(INTENT_BINDINGS));
    for (const type of Object.values(INTENT)) {
      if (type === INTENT.MOVE || type === INTENT.SELECT) continue;
      expect(bound.has(type), `${type} is unbound`).toBe(true);
    }
    expect(Object.keys(MOVE_BINDINGS).sort()).toEqual([...MOVE_DIRECTIONS].sort());
    for (let digit = 1; digit <= 9; digit += 1) expect(intentForLogicalKey(String(digit))).toEqual({ type: INTENT.SELECT, index: digit - 1 });
  });

  test("every bound key resolves to its own intent, and no key is bound twice", () => {
    const seen = new Map();
    for (const [target, keys] of [...Object.entries(INTENT_BINDINGS), ...Object.entries(MOVE_BINDINGS)]) {
      for (const key of keys) {
        expect(seen.has(key), `${key} is bound to ${seen.get(key)} and ${target}`).toBe(false);
        seen.set(key, target);
        const intent = intentForLogicalKey(key);
        expect(intent?.type === INTENT.MOVE ? intent.direction : intent?.type).toBe(target);
      }
    }
  });

  test("shift with a move key sprints, and a shifted arrow too", () => {
    expect(intentForLogicalKey("Shift+ArrowUp")).toEqual({ type: INTENT.MOVE, direction: "north", sprint: true });
    expect(intentForLogicalKey("W")).toEqual({ type: INTENT.MOVE, direction: "north", sprint: true });
    expect(intentForLogicalKey("w")).toEqual({ type: INTENT.MOVE, direction: "north" });
    expect(intentForLogicalKey("Control+c")).toEqual({ type: INTENT.QUIT });
    expect(intentForLogicalKey("nonsense")).toBeNull();
  });

  test("every watch intent has a binding", () => {
    for (const type of Object.values(WATCH_INTENT)) {
      if (type === WATCH_INTENT.HELP || type === WATCH_INTENT.QUIT || WATCH_BINDINGS[type]) continue;
      throw new Error(`${type} is unbound`);
    }
    expect(watchIntentForLogicalKey("ArrowRight")).toEqual({ type: WATCH_INTENT.NEXT });
  });

  test("ui-ascii's keymap defines no bindings of its own", () => {
    const source = readFileSync(new URL("../../packages/ui-ascii/src/keymap.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/INTENT\.[A-Z_]+\s*[,}]/);
    expect(source).toContain("runtime/src/controls/intents.js");
  });
});

// ## TODO: Test Permutations
