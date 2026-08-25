const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = resolve(__dirname, "../../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");

// The minimum the Allocator REPORTS must be one it can actually honour.
//
// It was not, for wardens. `assessBudgetedDelverRequirement` priced a card raised to its minimum
// viable form; `assessBudgetedWardenRequirement` priced the RAW authored card. Same pricing
// function, different input, so a warden's reported minimum sat a flat 47 tokens below what
// building one actually cost under the actor viability floor — the Allocator promising a budget it
// would then refuse. Nothing in the suite caught it, because every test asserted prices rather than
// asking whether the reported number was true.

function create(flag, spec, budgetTokens) {
  const outDir = mkdtempSync(join(tmpdir(), "ak-min-honesty-"));
  try {
    const r = spawnSync(process.execPath, [
      CLI, "create", "--text", "minimum honesty probe", flag, spec,
      "--budget-tokens", String(budgetTokens),
      "--run-id", "run_minimum_honesty", "--created-at", "2026-08-25T00:00:00.000Z",
      "--out-dir", outDir,
    ], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return { ok: r.status === 0, detail: `${r.stdout || ""}${r.stderr || ""}` };
  } finally { rmSync(outDir, { recursive: true, force: true }); }
}

function reportedMinimum(flag, spec) {
  const { detail } = create(flag, spec, 1);
  const match = detail.match(/minimum required spend is (\d+)/);
  assert.ok(match, `no minimum reported for ${flag} ${spec}: ${detail.slice(0, 200)}`);
  return Number(match[1]);
}

for (const [archetype, flag, motivation] of [
  ["delver", "--delver", "attacking"],
  ["warden", "--warden", "defending"],
]) {
  const spec = `count=1;affinity=fire;motivation=${motivation}`;

  // CHARACTERISATION, not endorsement. "minimum required spend is N" is the ACTOR's cost, but a
  // build must also fit that actor inside its pool share (delver 25% of budget, warden 23%), so the
  // budget a caller must actually supply is roughly twice N -- 93 against a reported 52 for a
  // delver, 86 against 35 for a warden. Someone who reads the refusal and supplies N is refused
  // again, and that includes the authoring model, which sees these messages.
  //
  // Pinned rather than fixed here: correcting it means deciding whether the message reports the
  // actor cost, the budget needed, or both, and that is a contract change rather than a bug fix.
  test(`the reported ${archetype} minimum is an actor cost, not a budget that builds`, () => {
    const minimum = reportedMinimum(flag, spec);
    assert.equal(create(flag, spec, minimum).ok, false,
      `building at the reported minimum now SUCCEEDS for a ${archetype}. If the message was changed `
      + "to report the supplyable budget, delete this characterisation and assert the honest property.");
  });

  test(`a ${archetype} minimum covers the viability floor`, () => {
    // health 10 + mana 10 + durability 10 at 1 token per point, plus 1 per vital of regen = 33.
    // Anything below that is a reported minimum that cannot produce a survivable actor.
    assert.ok(reportedMinimum(flag, spec) >= 33,
      `a ${archetype} minimum below 33 cannot cover health/mana/durability 10 with regen 1`);
  });
}
