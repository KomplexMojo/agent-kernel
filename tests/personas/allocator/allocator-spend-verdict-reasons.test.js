/**
 * CR.9 M4 — the refusal vocabulary is published, produced, and reachable.
 *
 * M4's finding is not a behavior bug. It is that CR.9's protocol shipped with its
 * vocabulary in three places and its reject reasons in none:
 *
 *   - the four authoring-validation outcomes were declared THREE times — in
 *     `contracts/build-spec.js` (the enforcing copy), in `contracts/artifacts.ts` (the
 *     type mirror), and privately inside `personas/allocator/budget-fulfillment.js`,
 *     which is not the persona that owns them. Nothing checked the three agreed.
 *   - the two SpendVerdict reject reasons existed only as bare string literals at two
 *     `return` sites inside a loop that discards its verdicts, so "which refusals can
 *     this system issue?" was unanswerable and untestable.
 *   - `SpendVerdictRejectReason` in artifacts.ts declared FOUR members, two of which
 *     nothing has ever produced. A closed set with an unreachable member is the same
 *     defect one level down, and it is how the Allocator's private copy stayed dead
 *     and unnoticed across three milestones.
 *
 * ═══ WHAT HAS TEETH HERE, AND WHAT DOES NOT ════════════════════════════════════
 *
 * A test that asserts `judgeCandidate` returns `"over_cap"` proves almost nothing on
 * its own — the pre-M4 code did that with an inline literal. The gate is the pair of
 * CLOSURE properties, which an inline literal cannot satisfy:
 *
 *   1. EVERY published reason is produced (no dead members). Asserted by collecting the
 *      reasons observed across the cases below and comparing the SET to the published
 *      vocabulary — so adding a member without a producer fails here, which is exactly
 *      the state M4 found.
 *   2. NO unpublished reason can be produced. `rejectSpend` throws on an unknown
 *      reason, so a future `return { approved: false, reason: "whatever" }` cannot be
 *      written through the builder.
 *
 * Re-declaration — the same values restated somewhere else — is not checkable from
 * here at all; that guard is in `tests/architecture/single-origin.test.js`, and it
 * matches the string VALUES rather than the constant names, because "someone declares
 * `const REASONS = ['over_cap']`" is the defect and a name-shaped pattern would miss
 * it. (Carrying forward the 2026-08-04 guard-spelling lesson: forbid the capability,
 * not one syntax.)
 *
 * PERTURBATION RESULTS 2026-08-05 — four restorations, and the fourth is the one to read:
 *   a published reason with no producer (the pre-M4 state) → DETECTED (closure + mirror)
 *   the artifacts.ts union drifting from the runtime set    → DETECTED (mirror)
 *   build-spec restating the outcomes, one member short     → DETECTED (validator test)
 *   `judgeCandidate` bypassing `rejectSpend` and returning a
 *     hand-built verdict with the CORRECT literal           → NOT DETECTED HERE.
 *       Every test in this file passes: the observable verdict is identical. Only the
 *       single-origin VALUE guard fails it. That is the M2/M3 lesson arriving from the
 *       other direction — an output-shaped check cannot see a façade that produces the
 *       right answer by the wrong route, so the two gates are complementary and neither
 *       subsumes the other. Do not "strengthen" this file to cover it; the guard that
 *       reads source is the right instrument for a source-shaped defect.
 *
 * ═══ TWO VOCABULARIES, NOT ONE ═════════════════════════════════════════════════
 *
 * The M4 plan row said "promote AUTHORING_VALIDATION_OUTCOMES into the published
 * SpendVerdict reason codes", which assumed they merge. They do not, and the tests are
 * split accordingly: a CANDIDATE is judged `over_cap` / `not_priceable`; a REQUEST is
 * judged `insufficient_budget` / `conflicting_requirements`. A candidate is never short
 * of budget — the budget is the thing it is being judged against. Full reasoning in
 * `contracts/spend-protocol.js`.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const { configuratorCapabilities } = require("../../helpers/configurator-capabilities.js");

const ROOT = resolve(__dirname, "../../..");
const P = "../../../packages/runtime/src/";
const CLOCK = () => "2026-08-04T00:00:00.000Z";

const ZERO_VITALS = Object.freeze({
  health: { max: 0, current: 0, regen: 0 },
  mana: { max: 0, current: 0, regen: 0 },
  stamina: { max: 0, current: 0, regen: 0 },
  durability: { max: 0, current: 0, regen: 0 },
});

const PRICED_VITALS = Object.freeze({
  health: { max: 10, current: 10, regen: 0 },
  mana: { max: 4, current: 4, regen: 2 },
  stamina: { max: 5, current: 5, regen: 1 },
  durability: { max: 0, current: 0, regen: 0 },
});

const DELVER = Object.freeze({
  type: "delver",
  vitals: PRICED_VITALS,
  motivations: ["exploring"],
  affinities: [],
});

async function load() {
  const [protocol, fulfillment, priceList, validateSpend, allocatorPersona] = await Promise.all([
    import(`${P}contracts/spend-protocol.js`),
    import(`${P}personas/allocator/budget-fulfillment.js`),
    import(`${P}personas/allocator/default-price-list.js`),
    import(`${P}personas/allocator/validate-spend.js`),
    import(`${P}personas/allocator/persona.js`),
  ]);
  return {
    protocol,
    judgeCandidate: fulfillment.judgeCandidate,
    createAllocatorPersona: allocatorPersona.createAllocatorPersona,
    priceListArtifact: priceList.buildDefaultPriceList(),
    priceMap: validateSpend.normalizePriceItems(priceList.buildDefaultPriceList()),
    capabilities: await configuratorCapabilities(),
  };
}

/** A candidate in the published shape, with the priceable projection we want judged. */
function candidateWith(vitals, candidateId = "delver[1]#test") {
  return {
    schema: "agent-kernel/ConfigurationCandidate",
    schemaVersion: 1,
    candidateId,
    card: { ...DELVER, vitals },
    priceable: { normalizedMotivations: [], affinities: [], vitals },
    preference: [vitals.mana.max, vitals.mana.regen],
  };
}

function envelopeOf(capTokens, count = 1) {
  return {
    schema: "agent-kernel/BudgetEnvelope",
    schemaVersion: 1,
    capTokens,
    perUnitCapTokens: Math.floor(capTokens / count),
    count,
  };
}

/** Union members of a `export type X = | "a" | "b";` declaration in artifacts.ts. */
function declaredUnionMembers(typeName) {
  const source = readFileSync(resolve(ROOT, "packages/runtime/src/contracts/artifacts.ts"), "utf8");
  const declaration = new RegExp(String.raw`export type ${typeName}\s*=([^;]*);`).exec(source);
  assert.ok(declaration, `artifacts.ts declares ${typeName}`);
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
}

// ── PER-REASON: what judging ONE CANDIDATE can conclude ────────────────────────

test("a candidate priced above the per-unit cap is rejected as over_cap", async () => {
  const { protocol, judgeCandidate, priceMap } = await load();

  const verdict = judgeCandidate(candidateWith(PRICED_VITALS), {
    priceMap,
    envelope: envelopeOf(1),
  });

  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, protocol.SPEND_VERDICT_REJECT_REASONS.overCap);
  assert.equal(verdict.schema, protocol.SPEND_VERDICT_SCHEMA);
  assert.equal(verdict.schemaVersion, protocol.SPEND_PROTOCOL_SCHEMA_VERSION);
  assert.equal(verdict.candidateId, "delver[1]#test", "a refusal names the candidate it refused");
  assert.equal(verdict.costTokens, undefined, "a rejected candidate carries no price");
});

test("a candidate that prices to nothing is rejected as not_priceable", async () => {
  const { protocol, judgeCandidate, priceMap } = await load();

  // All-zero vitals, no affinities, no motivations: every line item is skipped, so the
  // unit cost is 0. A zero-cost card is not free, it is unpriceable — approving it
  // would let the maximizer "spend" a budget on nothing and report success.
  const verdict = judgeCandidate(candidateWith(ZERO_VITALS), {
    priceMap,
    envelope: envelopeOf(1000),
  });

  assert.equal(verdict.approved, false);
  assert.equal(verdict.reason, protocol.SPEND_VERDICT_REJECT_REASONS.notPriceable);
});

test("an affordable candidate is approved with its price and the room left under the cap", async () => {
  const { protocol, judgeCandidate, priceMap } = await load();

  const verdict = judgeCandidate(candidateWith(PRICED_VITALS), {
    priceMap,
    envelope: envelopeOf(2000, 2),
  });

  assert.equal(verdict.approved, true);
  assert.equal(verdict.reason, undefined, "an approval carries no refusal reason");
  assert.ok(Number.isInteger(verdict.unitCostTokens) && verdict.unitCostTokens > 0);
  assert.equal(verdict.costTokens, verdict.unitCostTokens * 2, "the total covers every copy");
  assert.equal(
    verdict.remainingTokens,
    1000 - verdict.unitCostTokens,
    "remainingTokens is what makes revision a round trip: the author cannot compute the "
      + "fill without pricing, so the Allocator publishes the room it left",
  );
});

// ── CLOSURE: no dead members, and no unpublished ones ──────────────────────────

test("every published reject reason has a producer", async () => {
  const { protocol, judgeCandidate, priceMap } = await load();

  const observed = new Set([
    judgeCandidate(candidateWith(PRICED_VITALS), { priceMap, envelope: envelopeOf(1) }).reason,
    judgeCandidate(candidateWith(ZERO_VITALS), { priceMap, envelope: envelopeOf(1000) }).reason,
  ]);

  assert.deepEqual(
    [...observed].sort(),
    [...protocol.SPEND_VERDICT_REJECT_REASON_IDS].sort(),
    "a published reason no code path produces is dead vocabulary — the exact state M4 "
      + "found, where artifacts.ts declared four reasons and two were unreachable",
  );
});

test("a reason outside the published set cannot be issued", async () => {
  const { protocol } = await load();

  assert.throws(
    () => protocol.rejectSpend({ candidateId: "delver[1]#1", reason: "insufficient_budget" }),
    /closed set/,
    "insufficient_budget is a REQUEST-level outcome; letting it onto a candidate verdict "
      + "is how the two vocabularies blur back together",
  );
  assert.throws(
    () => protocol.rejectSpend({ candidateId: "delver[1]#1", reason: "too_expensive" }),
    /closed set/,
    "a free-form reason is a refusal nothing downstream can branch on",
  );
});

// ── PER-OUTCOME: what assessing a WHOLE REQUEST can conclude ───────────────────

test("a request whose minimum spend exceeds the budget is refused as insufficient_budget", async () => {
  const { protocol, createAllocatorPersona, priceListArtifact, capabilities } = await load();

  assert.throws(
    () => createAllocatorPersona({ clock: CLOCK, ...capabilities }).assessFeasibility({
      commandName: "create",
      budgetTokens: 1,
      delvers: [{ value: DELVER, optimizationGoals: [] }],
      priceListArtifact,
    }),
    (error) => {
      assert.equal(error.validation.outcome, protocol.AUTHORING_VALIDATION_OUTCOMES.insufficientBudget);
      assert.ok(error.validation.issues.length > 0, "a non-valid outcome must carry blocking issues");
      assert.ok(
        error.validation.issues.every((issue) => issue.code && issue.message),
        "every issue is addressable: a code to branch on and a message to read",
      );
      return true;
    },
  );
});

test("a request whose card contradicts itself is refused as conflicting_requirements", async () => {
  const { protocol, createAllocatorPersona, priceListArtifact, capabilities } = await load();

  // A moving delver with no stamina regen: the configuration cannot function, and no
  // budget makes it work. That is a different refusal from "cannot afford it", which is
  // why the two outcomes are distinct rather than one "infeasible".
  const stalled = {
    ...DELVER,
    vitals: { ...PRICED_VITALS, stamina: { max: 5, current: 5, regen: 0 } },
  };

  assert.throws(
    () => createAllocatorPersona({ clock: CLOCK, ...capabilities }).assessFeasibility({
      commandName: "create",
      budgetTokens: 10000,
      delvers: [{ value: stalled, optimizationGoals: [] }],
      priceListArtifact,
    }),
    (error) => {
      assert.equal(
        error.validation.outcome,
        protocol.AUTHORING_VALIDATION_OUTCOMES.conflictingRequirements,
      );
      assert.ok(
        error.validation.issues.some((issue) => issue.code === "movement_requires_stamina_regen"),
        "the issue names the structural rule the Configurator applied, not a price",
      );
      return true;
    },
  );
});

test("issues are ordered by path then code, so a refusal is byte-stable", async () => {
  const { protocol } = await load();

  const validation = protocol.createAuthoringValidation({
    outcome: protocol.AUTHORING_VALIDATION_OUTCOMES.conflictingRequirements,
    summary: "two cards conflict.",
    issues: [
      { code: "z_rule", path: "delver[2]", message: "second card" },
      { code: "b_rule", path: "delver[1]", message: "first card" },
      { code: "a_rule", path: "delver[1]", message: "first card, earlier code" },
    ],
  });

  assert.deepEqual(
    validation.issues.map((issue) => `${issue.path}:${issue.code}`),
    ["delver[1]:a_rule", "delver[1]:b_rule", "delver[2]:z_rule"],
    "these strings reach goldens and CLI stderr, so the order the checks happened to "
      + "fire must not be observable",
  );
});

test("an issue with no path omits the field rather than emitting an empty one", async () => {
  const { protocol } = await load();

  const issue = protocol.createAuthoringValidationIssue({ code: "c", message: "m" });

  assert.equal("path" in issue, false, "build-spec validates path as an OPTIONAL string; "
    + "an empty string would fail that check");
});

// ── THE VOCABULARIES HAVE ONE ORIGIN AND EVERY MIRROR AGREES ───────────────────

test("artifacts.ts mirrors the runtime reject-reason vocabulary exactly", async () => {
  const { protocol } = await load();

  assert.deepEqual(
    declaredUnionMembers("SpendVerdictRejectReason"),
    [...protocol.SPEND_VERDICT_REJECT_REASON_IDS].sort(),
    "the type union and the runtime constant are the same vocabulary in two languages; "
      + "no runtime .js module can import artifacts.ts, so nothing but this checks them",
  );
});

test("artifacts.ts mirrors the runtime authoring-validation vocabulary exactly", async () => {
  const { protocol } = await load();

  assert.deepEqual(
    declaredUnionMembers("AgentCommandValidationOutcome"),
    [...protocol.AUTHORING_VALIDATION_OUTCOME_IDS].sort(),
  );
});

test("the build-spec validator accepts exactly the published outcomes", async () => {
  const { protocol } = await load();
  const { validateAgentCommandRequest } = await import(`${P}contracts/build-spec.js`);

  // `validation` sits at the TOP LEVEL of an AgentCommandRequest, not under `authoring`.
  // The first draft of this fixture nested it, and every acceptance assertion below
  // passed — `validateAuthoringValidation` returns early on `undefined`, so a request
  // carrying no validation at all produces no `validation.outcome` errors. Only the
  // negative case at the end failed, which is the entire reason it is here: a check that
  // can only pass is not a check. Same lesson as the M2/M3 perturbation results, met from
  // the other side.
  const requestWith = (outcome) => ({
    schema: "agent-kernel/AgentCommandRequestArtifact",
    schemaVersion: 1,
    meta: {
      id: "req-1",
      runId: "run-1",
      createdAt: "2026-08-04T00:00:00.000Z",
      producedBy: "orchestrator",
    },
    command: { action: "author", text: "create a delver", source: "cli", taxonomyVersion: 1 },
    objects: [{ kind: "delver", prompt: "a delver" }],
    compilation: {
      rules: [{ kind: "delver", compileTo: [{ target: "build_spec_configurator" }] }],
    },
    validation: {
      outcome,
      summary: "a summary.",
      issues: [{ code: "some_rule", message: "a blocking constraint." }],
    },
  });

  // The fixture must be otherwise well-formed, or "no outcome error" would again mean
  // "the validator never reached the outcome" rather than "the validator accepted it".
  assert.deepEqual(
    validateAgentCommandRequest(requestWith(protocol.AUTHORING_VALIDATION_OUTCOMES.insufficientBudget)).errors,
    [],
    "the fixture itself is valid apart from the outcome under test",
  );

  for (const outcome of protocol.AUTHORING_VALIDATION_OUTCOME_IDS) {
    const errors = validateAgentCommandRequest(requestWith(outcome)).errors
      .filter((entry) => entry.includes("validation.outcome"));
    assert.deepEqual(errors, [], `the validator accepts the published outcome "${outcome}"`);
  }

  const rejected = validateAgentCommandRequest(requestWith("mostly_fine")).errors
    .filter((entry) => entry.includes("validation.outcome"));
  assert.equal(rejected.length, 1, "an unpublished outcome is refused by the validator");
});

// ## TODO: Test Permutations
