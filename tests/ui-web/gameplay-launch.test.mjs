import assert from "node:assert/strict";
import { test } from "vitest";
import { shouldReuseActiveRun } from "../../packages/ui-web/src/gameplay-launch.js";

// Regression: editing the design (e.g. room size) then returning to the Gameplay
// tab must rebuild, not show the stale run. The old guard skipped launchGameplayRun
// whenever a run was active, so design edits never reached gameplay.

test("rebuilds (no reuse) when the published spec differs from the active run", () => {
  assert.equal(
    shouldReuseActiveRun({
      specText: "SPEC-large",
      lastGameplaySpecText: "SPEC-small",
      isRunActive: true,
    }),
    false,
  );
});

test("reuses the active run when the spec is unchanged", () => {
  assert.equal(
    shouldReuseActiveRun({
      specText: "SPEC-same",
      lastGameplaySpecText: "SPEC-same",
      isRunActive: true,
    }),
    true,
  );
});

test("never reuses when no run is active yet", () => {
  assert.equal(
    shouldReuseActiveRun({
      specText: "SPEC-same",
      lastGameplaySpecText: "SPEC-same",
      isRunActive: false,
    }),
    false,
  );
});

test("never reuses when there is no published spec text", () => {
  for (const specText of ["", null, undefined]) {
    assert.equal(
      shouldReuseActiveRun({ specText, lastGameplaySpecText: "", isRunActive: true }),
      false,
      `specText=${JSON.stringify(specText)} must not reuse`,
    );
  }
});

test("first launch with empty prior spec rebuilds", () => {
  assert.equal(
    shouldReuseActiveRun({
      specText: "SPEC-first",
      lastGameplaySpecText: "",
      isRunActive: false,
    }),
    false,
  );
});
