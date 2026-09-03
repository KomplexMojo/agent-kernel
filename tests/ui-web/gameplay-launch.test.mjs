import assert from "node:assert/strict";
import { test } from "vitest";
import { designIdentity, shouldReuseActiveRun } from "../../packages/ui-web/src/gameplay-launch.js";

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

// ---------------------------------------------------------------------------
// Real spec text, not opaque tokens.
//
// The tests above compare strings like "SPEC-same", which the design never
// produces. Every publish stamps a fresh runId/id/createdAt and the call site's
// source label, so two publishes of an UNCHANGED design were never byte-equal
// and reuse could not fire even once: entering the Gameplay tab always rebuilt,
// discarding whatever run was loaded. The shape below (root meta, plus a nested
// envelope under budget.budget.meta) is what the card builder actually emits.
// ---------------------------------------------------------------------------

function publishedSpec({ stamp, source, roomSize = "medium", rooms = 5, budgetTokens = 2500 } = {}) {
  return JSON.stringify({
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: `card_builder_${stamp}`, runId: `card_builder_${stamp}`, createdAt: `2026-09-03T00:00:0${stamp}.000Z`, source },
    plan: { rooms: [{ id: "R-1", roomSize, count: rooms }] },
    budget: {
      budget: {
        meta: { id: `budget_card_builder_${stamp}`, runId: `card_builder_${stamp}`, createdAt: `2026-09-03T00:00:0${stamp}.000Z`, producedBy: source },
        budgetTokens,
      },
    },
  });
}

test("an unchanged design reuses the run across two publishes", () => {
  // The whole defect: identical design, different stamps and call sites.
  assert.equal(
    shouldReuseActiveRun({
      specText: publishedSpec({ stamp: 2, source: "design-preview" }),
      lastGameplaySpecText: publishedSpec({ stamp: 1, source: "bundle-load" }),
      isRunActive: true,
    }),
    true,
  );
});

test.each([
  ["room size", { roomSize: "large" }],
  ["room count", { rooms: 6 }],
  ["a nested budget value", { budgetTokens: 3000 }],
])("a real design change still rebuilds: %s", (_label, change) => {
  // Stripping provenance must not blind the comparison to actual design edits —
  // including ones nested beside the metadata being stripped.
  assert.equal(
    shouldReuseActiveRun({
      specText: publishedSpec({ stamp: 2, source: "design-preview", ...change }),
      lastGameplaySpecText: publishedSpec({ stamp: 1, source: "bundle-load" }),
      isRunActive: true,
    }),
    false,
  );
});

test("key order is not a design change", () => {
  const a = JSON.stringify({ meta: { id: "x" }, plan: 1, budget: 2 });
  const b = JSON.stringify({ budget: 2, plan: 1, meta: { id: "y" } });
  assert.equal(designIdentity(a), designIdentity(b));
});

test("identity falls back to the raw text for non-JSON input", () => {
  assert.equal(designIdentity("SPEC-same"), "SPEC-same");
  assert.equal(designIdentity(""), "");
  assert.equal(designIdentity(null), "");
});
