/**
 * M9 (U2 — adjudicated contract, pinned as a FAILING unit test until fixed):
 *
 * OBSERVED DEFECT (live browser session, 2026-07-09): after pushing a
 * GameplayBundle for benchmark scenario 1 (single fire delver, budget 2000,
 * budget-receipt records 82 spent with approved line items) into index_c.html
 * via the sandbox bridge, the right-hand INVENTORY panel showed
 * "ROOM 0-[0]=0t", "DELVER 2000-[0]=2000t", footer "Budget: 2000t | Spent: 0t"
 * — i.e. zero itemization/spend, even though the pushed bundle's card set
 * carries a fully-configured delver (vitals + one affinity stack) that prices
 * to a nonzero token cost. Later pushes of scenarios with room+actor cards
 * into the SAME page session itemized the ROOM bucket correctly (e.g.
 * "ROOM 1250-[192]=1058t · R-298JHM x2 192t").
 *
 * ROOT CAUSE (confirmed by direct reproduction — see repro notes below):
 *
 *   packages/ui-web/src/main.js:209-222 (`globalThis.__ak_loadGameplayBundle`):
 *
 *     await phaserFrame.ingest(bundle.spec);
 *     const surface = phaserFrame.getCardBuilderSurface?.();
 *     const ctrl = surface?.getController?.();
 *     const cards = ctrl?.getCards?.() || [];
 *     const firstActor = cards.find((c) => c.type === "delver" || c.type === "warden");
 *     if (firstActor) {
 *       ctrl.pullCardToEditor(firstActor.id);   // <-- defect trigger
 *       await surface.render?.();
 *     }
 *
 *   packages/ui-web/src/design-guidance.js:820-847 (`pullCardToEditor`):
 *
 *     const [card] = state.cards.splice(index, 1);   // line 839
 *     if (willAutoStash) {
 *       state.cards.push(createDesignCard({ ...active, flipped: false }));
 *     }
 *     ...
 *     recompute();
 *
 *   `pullCardToEditor` SPLICES the pulled card out of `state.cards` (the
 *   shelf's card list) and only puts a card back if `willAutoStash` is true —
 *   which requires a PREVIOUSLY configured active-editor card to swap out.
 *   On a fresh push (or any push where the editor is still blank/unconfigured),
 *   `willAutoStash` is false, so the pulled card is simply removed from the
 *   shelf with nothing put back.
 *
 *   `__ak_loadGameplayBundle` always calls `pullCardToEditor(firstActor.id)`
 *   on the first delver/warden card found, in order to auto-focus the editor.
 *   For a DELVER-ONLY bundle (no room cards), this empties `state.cards`
 *   completely: `getCards()` goes from `[delverCard]` to `[]`. The shelf's
 *   `resolveAllocationLedger` (packages/ui-web/src/design-guidance.js:495,
 *   consumed via card-builder-phaser-renderer.js `drawShelf`/`drawStatusBar`)
 *   sums `usedTokens` from `state.cards`, so with an empty card list every
 *   type's `usedTokens` reports 0 — this is exactly "DELVER 2000-[0]=2000t"
 *   (allocatedTokens is still 100% of budget because the split-percent comes
 *   from `deriveContentAwareSplit`, computed once at ingest time before the
 *   pull, and is NOT reduced by the pull).
 *
 *   For a ROOM+ACTOR bundle, the pulled actor card is still removed from the
 *   shelf the same way — its own bucket (delver or warden, whichever was
 *   `firstActor`) silently zeroes out — but the ROOM bucket (never eligible
 *   for the auto-pull) stays populated, which is why room itemization looked
 *   correct in the live session while the actor's own itemization was zeroed
 *   too (just not exercised in the quoted example, which only cited the ROOM
 *   line). This is NOT a first-push race condition and NOT content-dependent
 *   in the "delver-only has no room" sense per se — it reproduces for ANY
 *   bundle whenever the auto-pulled `firstActor` card is the only card of its
 *   type (which a delver-only scenario always is, since there is exactly one
 *   delver and zero wardens).
 *
 * ELIMINATED HYPOTHESES:
 *   (a) first-push initialization order — REJECTED. The defect is
 *       deterministic and reproduces identically on every push, not just the
 *       first, and does not depend on `state.priceList`/`state.tileCosts`
 *       being warmed up (calculateCardValue has non-priceList-dependent
 *       design-default pricing for both room tiles (DEFAULT_TILE_COSTS in
 *       layout-spend.js) and actor vitals/affinities
 *       (VITAL_MAX_COST_MULTIPLIER / COST_DEFAULTS in spend-proposal.js), so
 *       an un-warmed priceList prices cards correctly, not to zero).
 *   (c) receipt artifact missing/unread from that particular bundle —
 *       REJECTED. The shelf ledger (`getAllocationLedger`) is derived
 *       entirely from `state.cards` via `resolveAllocationLedger`
 *       (card-builder-phaser-renderer.js:1549, design-guidance.js:495-516);
 *       it never reads BudgetReceiptArtifact at all. The "budget-receipt
 *       records 82 spent" mentioned in the live session is a completely
 *       separate legacy DOM debug panel (packages/ui-web/src/budget-panels.js)
 *       that is NOT the Phaser "INVENTORY" shelf under test here.
 *   (b) bundle-content dependent (delver-only has no rooms/traps) — PARTIALLY
 *       CONFIRMED but the true discriminator is narrower than "no rooms":
 *       the defect is "the auto-pulled firstActor card was the only card in
 *       its own type bucket", which a delver-only scenario always satisfies.
 *       See the mixed room+delver+warden reproduction below, which shows the
 *       delver bucket ALSO zeroes out even though rooms are present.
 *
 * Reproduction commands used to confirm this root cause (outside the test
 * harness, for investigation only):
 *   node -e "import('./packages/ui-web/src/card-builder-controller.js')..."
 *   — loadBuildSpec(spec) then compare getAllocationLedger() before/after
 *   calling pullCardToEditor(firstActor.id), exactly mirroring main.js.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createCardBuilderController } from "../../packages/ui-web/src/card-builder-controller.js";

function delverCardEntry(overrides = {}) {
  return {
    id: "card_delver_1",
    type: "delver",
    source: "actor",
    count: 1,
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    expressions: ["push"],
    motivations: ["random", "user_controlled"],
    setupMode: "auto",
    vitals: {
      health: { current: 1, max: 1, regen: 0 },
      mana: { current: 0, max: 0, regen: 0 },
      stamina: { current: 0, max: 0, regen: 0 },
      durability: { current: 1, max: 1, regen: 0 },
    },
    flipped: false,
    ...overrides,
  };
}

function roomCardEntry(overrides = {}) {
  return {
    id: "card_room_1",
    type: "room",
    source: "room",
    count: 2,
    affinity: "dark",
    affinities: [],
    expressions: [],
    motivations: [],
    setupMode: "auto",
    roomSize: "medium",
    flipped: false,
    ...overrides,
  };
}

function wardenCardEntry(overrides = {}) {
  return {
    id: "card_warden_1",
    type: "warden",
    source: "actor",
    count: 2,
    affinity: "fire",
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    expressions: ["push"],
    motivations: ["random"],
    setupMode: "auto",
    vitals: {
      health: { current: 1, max: 1, regen: 0 },
      mana: { current: 0, max: 0, regen: 0 },
      stamina: { current: 0, max: 0, regen: 0 },
      durability: { current: 1, max: 1, regen: 0 },
    },
    flipped: false,
    ...overrides,
  };
}

function buildSpecFromCards(cardSet, { runId, budgetTokens = 2000, poolWeights } = {}) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { runId },
    intent: { hints: { levelAffinity: "fire", poolWeights, budgetTokens } },
    plan: { hints: { cardSet } },
    configurator: { inputs: { cardSet } },
    authoring: {},
  };
}

// Mirrors packages/ui-web/src/main.js globalThis.__ak_loadGameplayBundle's
// post-ingest auto-focus behavior exactly (the part relevant to this defect):
// find the first delver/warden card and pull it into the editor.
function simulateLoadGameplayBundlePostIngest(ctrl) {
  const cards = ctrl.getCards() || [];
  const firstActor = cards.find((c) => c.type === "delver" || c.type === "warden");
  if (firstActor) {
    ctrl.pullCardToEditor(firstActor.id);
  }
  return firstActor;
}

test("PINNED DEFECT: delver-only bundle itemizes zero used tokens after the auto-pull-to-editor step", async () => {
  const ctrl = createCardBuilderController({ llmConfig: {} });
  const spec = buildSpecFromCards([delverCardEntry()], {
    runId: "pinned_delver_only",
    poolWeights: [{ id: "delver", weight: 0.2 }],
  });

  const loaded = await ctrl.loadBuildSpec(spec);
  assert.equal(loaded.ok, true, `loadBuildSpec must succeed: ${JSON.stringify(loaded)}`);

  // Sanity: immediately after ingest (before the auto-pull), the delver
  // itemizes correctly — pricing itself is not the problem.
  const ledgerBeforePull = ctrl.getAllocationLedger();
  assert.ok(
    ledgerBeforePull.byType.delver.usedTokens > 0,
    `sanity check failed: delver should price to a nonzero token cost before the auto-pull, got ${JSON.stringify(ledgerBeforePull.byType.delver)}`,
  );

  // Exercise the exact main.js post-ingest behavior.
  const firstActor = simulateLoadGameplayBundlePostIngest(ctrl);
  assert.equal(firstActor?.type, "delver", "expected the sole delver card to be auto-pulled");

  // Contract: the INVENTORY shelf must still itemize the delver's spend even
  // after main.js auto-focuses it into the editor — a card being open for
  // editing must not vanish from the budget ledger it belongs to.
  //
  // Today this fails: pullCardToEditor splices the card out of state.cards
  // with nothing put back (no prior configured active card to auto-restash),
  // so the shelf's card list is empty and usedTokens reports 0 for every type.
  const ledgerAfterPull = ctrl.getAllocationLedger();
  assert.ok(
    ledgerAfterPull.byType.delver.usedTokens > 0,
    "PINNED DEFECT (U2): DELVER usedTokens must remain nonzero after the bundle's " +
      "sole actor card is auto-pulled into the editor, matching the live-observed " +
      `"DELVER 2000-[0]=2000t" zero-itemization bug; got byType.delver=${JSON.stringify(ledgerAfterPull.byType.delver)}`,
  );

  assert.ok(
    ctrl.getCards().length > 0,
    "PINNED DEFECT (U2): the shelf's card list must not become empty merely because " +
      `its only card was pulled into the editor; got getCards()=${JSON.stringify(ctrl.getCards())}`,
  );
});

test("PINNED DEFECT: room+delver+warden bundle still zeroes the auto-pulled actor's own bucket", async () => {
  const ctrl = createCardBuilderController({ llmConfig: {} });
  const spec = buildSpecFromCards(
    [roomCardEntry(), delverCardEntry({ affinity: "water", affinities: [{ kind: "water", expression: "push", stacks: 1 }] }), wardenCardEntry()],
    {
      runId: "pinned_room_actors",
      poolWeights: [{ id: "rooms", weight: 0.44 }, { id: "wardens", weight: 0.16 }, { id: "delver", weight: 0.2 }],
    },
  );

  const loaded = await ctrl.loadBuildSpec(spec);
  assert.equal(loaded.ok, true, `loadBuildSpec must succeed: ${JSON.stringify(loaded)}`);

  const ledgerBeforePull = ctrl.getAllocationLedger();
  assert.ok(ledgerBeforePull.byType.room.usedTokens > 0, "sanity: room prices nonzero before pull");
  assert.ok(ledgerBeforePull.byType.delver.usedTokens > 0, "sanity: delver prices nonzero before pull");
  assert.ok(ledgerBeforePull.byType.warden.usedTokens > 0, "sanity: warden prices nonzero before pull");

  const firstActor = simulateLoadGameplayBundlePostIngest(ctrl);
  assert.equal(firstActor?.type, "delver", "expected the delver card (first actor in cardSet order) to be auto-pulled");

  const ledgerAfterPull = ctrl.getAllocationLedger();

  // ROOM is never eligible for the auto-pull, so it must stay itemized —
  // this matches the live session's "ROOM 1250-[192]=1058t" observation that
  // looked like correct behavior.
  assert.ok(
    ledgerAfterPull.byType.room.usedTokens > 0,
    `expected ROOM itemization to remain correct (not the auto-pulled type); got ${JSON.stringify(ledgerAfterPull.byType.room)}`,
  );
  // WARDEN was not the auto-pulled card either, so it must also stay itemized.
  assert.ok(
    ledgerAfterPull.byType.warden.usedTokens > 0,
    `expected WARDEN itemization to remain correct (not the auto-pulled type); got ${JSON.stringify(ledgerAfterPull.byType.warden)}`,
  );

  // PINNED DEFECT: DELVER was the auto-pulled type — its bucket zeroes out
  // even though a room is present in the same bundle. This demonstrates the
  // defect is NOT specific to "delver-only, no rooms" content; it reproduces
  // for the auto-pulled type in ANY bundle.
  assert.ok(
    ledgerAfterPull.byType.delver.usedTokens > 0,
    "PINNED DEFECT (U2): DELVER usedTokens must remain nonzero after being " +
      `auto-pulled into the editor even when room/warden cards are also present; got ${JSON.stringify(ledgerAfterPull.byType.delver)}`,
  );
});

test("sanity: warden-only bundle (firstActor = warden) reproduces the same zero-itemization defect", async () => {
  const ctrl = createCardBuilderController({ llmConfig: {} });
  const spec = buildSpecFromCards([wardenCardEntry()], {
    runId: "pinned_warden_only",
    poolWeights: [{ id: "wardens", weight: 0.2 }],
  });

  const loaded = await ctrl.loadBuildSpec(spec);
  assert.equal(loaded.ok, true, `loadBuildSpec must succeed: ${JSON.stringify(loaded)}`);

  simulateLoadGameplayBundlePostIngest(ctrl);

  const ledgerAfterPull = ctrl.getAllocationLedger();
  assert.ok(
    ledgerAfterPull.byType.warden.usedTokens > 0,
    "PINNED DEFECT (U2): WARDEN usedTokens must remain nonzero after the bundle's " +
      `sole actor card is auto-pulled into the editor; got byType.warden=${JSON.stringify(ledgerAfterPull.byType.warden)}`,
  );
});

// ## TODO: Test Permutations
test.skip("delver-only bundle: status-bar footer 'Spent:' total also reports zero after auto-pull (drawStatusBar consumer)", () => {});
test.skip("two-delver bundle: auto-pulling the first delver leaves the second delver's spend correctly itemized (only the pulled card's bucket is affected)", () => {});
test.skip("re-pushing a second bundle into the same controller instance after the first auto-pull still reproduces the defect (not a one-time-only glitch)", () => {});
test.skip("hazard-only and resource-only bundles are unaffected (auto-pull only targets delver/warden types)", () => {});
test.skip("calling controller.pullCardToEditor directly (outside the bundle-load flow) on the sole shelved card reproduces the same empty-shelf state", () => {});
