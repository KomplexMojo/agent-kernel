// Play-sim M3 (#614): the model proposes, the character sheet disposes. Fixture adapter only: no live model.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createCharacterSheet } from "../../packages/runtime/src/runner/character-sheet.js";
import { parseProposal, proposeCharacterSpec, specFromProposal } from "../../scripts/testing/play-sim-llm-build.mjs";
import { runPlaySim } from "../../scripts/testing/play-sim.mjs";

const BASE = "count=1;id=hero;affinity=fire;affinities=fire:emit:2:1,fire:push:3:1;equip=fire:emit;motivation=user_controlled;vitals=health:20:1,mana:30:3,stamina:10:2,durability:10:1";
const vitals = { health: { max: 20, regen: 1 }, mana: { max: 30, regen: 3 }, stamina: { max: 10, regen: 2 }, durability: { max: 10, regen: 1 } };
const SMALL = { slots: [{ kind: "fire", expression: "push", range: 3, intensity: 1 }], vitals };
const HUGE = { slots: [{ kind: "fire", expression: "push", range: 40, intensity: 9 }], vitals: { ...vitals, health: { max: 900, regen: 30 } } };

/** A fixture adapter answering with each canned proposal in turn (the last repeats). */
function fixture(...answers) {
  const prompts = [];
  return { prompts, generate: async ({ prompt }) => { prompts.push(prompt); return { response: JSON.stringify(answers[Math.min(prompts.length - 1, answers.length - 1)]) }; } };
}

test("a proposal the sheet accepts within the allowance is returned as a delver spec", async () => {
  const llm = fixture(SMALL);
  const result = await proposeCharacterSpec({ llm, model: "fixture", allowance: 1176, baseSpec: BASE });
  expect(result).toMatchObject({ ok: true, attempts: 1, model: "fixture" });
  expect(result.promptHash).toMatch(/^[0-9a-f]{16}$/);
  expect(result.total).toBeLessThanOrEqual(1176);
  expect(createCharacterSheet({ spec: result.spec, budgetTokens: 1176 }).view().ok).toBe(true);
});

test("an over-budget proposal is refused and retried with the sheet's reasons; a good one then passes", async () => {
  const llm = fixture(HUGE, SMALL);
  const result = await proposeCharacterSpec({ llm, model: "fixture", allowance: 1176, baseSpec: BASE });
  expect(result).toMatchObject({ ok: true, attempts: 2 });
  expect(llm.prompts[1]).toMatch(/Your last answer was refused/);
  expect(llm.prompts[1]).toMatch(/over the allowance/);
});

test("a model that never fits is refused after the attempt cap; over-budget builds are never accepted", async () => {
  const result = await proposeCharacterSpec({ llm: fixture(HUGE), model: "fixture", allowance: 1176, baseSpec: BASE, maxAttempts: 2 });
  expect(result.ok).toBe(false);
  expect(result.attempts).toBe(2);
  expect(result.problems.join(" ")).toMatch(/over the allowance/);
});

test("malformed answers are rejected with a reason", () => {
  expect(() => parseProposal("not json")).toThrow(/not JSON/);
  expect(() => parseProposal('{"slots":[{"kind":"zzz","expression":"push","range":1,"intensity":1}],"vitals":{}}')).toThrow(/unknown affinity/);
  expect(() => parseProposal('{"slots":[],"vitals":{}}')).not.toThrow();
  expect(specFromProposal(SMALL)).toMatch(/affinities=fire:push:3;equip=fire:push;motivation=user_controlled;vitals=health:20:1/);
});

test("play-sim --build-source llm records the model, prompt hash and the proposed character", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "play-sim-llm-"));
  try {
    const { runs } = await runPlaySim({ scenarios: ["first-look"], seeds: [0], outDir, llm: { model: "fixture", adapter: fixture(SMALL) } });
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      const record = JSON.parse(readFileSync(join(outDir, run.file), "utf8"));
      expect(record.llm).toMatchObject({ model: "fixture", attempts: 1 });
      expect(record.llm.promptHash).toMatch(/^[0-9a-f]{16}$/);
      expect(record.llm.spec).toBe(specFromProposal(SMALL));
      expect(record.outcome).not.toBe("build_refused");
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 120000);

// ## TODO: Test Permutations
// - fenced JSON answers; a model error (generate throws); the CLI flags --build-source/--model; a scenario whose arm allowance is below the viability floor
