import { expect, test } from "vitest";
import { createDirectorPersona } from "../../../packages/runtime/src/personas/director/persona.js";

// #312 — a hazard card's authored durability grant survives the Director's card translation.
// It used to be kept for rooms only, so card-authored hazards lost it on the way to the build
// and the Allocator's design ledger priced a different hazard than the card builder showed.
const director = () => createDirectorPersona({ clock: () => "2026-10-17T00:00:00.000Z" });

test("a hazard card keeps its durability grant through normalization and summary resolution", () => {
  const d = director();
  const card = {
    id: "hazard_a", type: "hazard", affinity: "water", expressions: ["emit"],
    mana: { kind: "regen", current: 2, max: 7, regen: 3 }, durability: { kind: "one-time", amount: 4 },
  };
  expect(d.normalizeCard(card, { index: 0 }).durability).toEqual({ kind: "one-time", amount: 4 });
  const resolved = d.resolveSummary({ budgetTokens: 1000, cardSet: [card] });
  expect(resolved.cardSet.find((entry) => entry.id === "hazard_a").durability).toEqual({ kind: "one-time", amount: 4 });
});

test("a hazard card with no durability grant gets none invented", () => {
  const card = { id: "hazard_b", type: "hazard", affinity: "earth", expressions: ["push"] };
  expect(director().normalizeCard(card, { index: 0 }).durability).toBeUndefined();
});

// ## TODO: Test Permutations
// - a regen-kind durability grant (current/max/regen) is kept with all three fields.
// - cardSetFromSummary renders a summary hazard's durability back onto its card.
