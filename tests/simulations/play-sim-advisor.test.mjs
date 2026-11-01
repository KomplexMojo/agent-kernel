// Play-sim M5 (#616): the advisor prompt carries evidence refs and is size-capped; advice must match the schema.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { report } from "../../scripts/testing/play-sim-report.mjs";
import { buildAdvisorPrompt, loadEvidence, validateAdvice } from "../../scripts/testing/play-sim-advisor.mjs";

const FIXTURES = join(import.meta.dirname, "../fixtures/play-sim");

function evidence() {
  const dir = mkdtempSync(join(tmpdir(), "play-sim-advisor-"));
  cpSync(FIXTURES, dir, { recursive: true });
  report(dir);
  return { dir, ...loadEvidence(dir) };
}

test("the prompt names each card by evidence ref and carries the cohort and the schema", () => {
  const { dir, cards, cohort } = evidence();
  try {
    const prompt = buildAdvisorPrompt({ cards, cohort });
    expect(prompt).toContain("[cards/traits-s1-treatment.json] traits s1 treatment: defeated");
    expect(prompt).toContain("tick_one_defeat");
    expect(prompt).toContain('"recommendedChanges"');
    expect(prompt).toContain("outcome_changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the size cap leaves cards out and says how many", () => {
  const { dir, cards, cohort } = evidence();
  try {
    const head = buildAdvisorPrompt({ cards: [], cohort }, { maxChars: 100000 }).length;
    const capped = buildAdvisorPrompt({ cards, cohort }, { maxChars: head + 5 });
    expect(capped).toMatch(/\(2 more card\(s\) left out/);
    expect(capped).not.toContain("[cards/traits");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sample answer validates; missing evidence, a bad area or an unknown ref does not", () => {
  const good = { findings: ["90% loses a duel"], recommendedChanges: [{ area: "scenarios", change: "add a recovery beat", evidenceRefs: ["cards/traits-s1-treatment.json"] }],
    evidenceRefs: ["cards/traits-s1-treatment.json"], confidence: "low" };
  expect(validateAdvice(good, { knownRefs: ["cards/traits-s1-treatment.json"] })).toEqual([]);
  expect(validateAdvice({ ...good, confidence: "sure" })).toHaveLength(1);
  expect(validateAdvice({ ...good, recommendedChanges: [{ area: "prices", change: "x", evidenceRefs: [] }] }).length).toBe(2);
  expect(validateAdvice(good, { knownRefs: [] })[0]).toMatch(/unknown evidence ref/);
  expect(validateAdvice("nope")).toEqual(["the answer is not an object"]);
});

// ## TODO: Test Permutations
// - a run dir with no cards or cohort; the CLI with PLAY_SIM_ADVISOR_MODEL set against a fixture server
