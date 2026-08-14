/**
 * CR.9 M3 — the Allocator prices a config it did not author.
 *
 * This is the G1 gate for registry entry `allocator/judges-not-authors`. Before M3
 * the entry was false in the plainest way: `budget-fulfillment.js` enumerated
 * `(manaRegen, manaMax)` pairs, assembled candidate cards, filled their vitals and
 * encoded configuration-validity rules, then priced its own output. It imported
 * `configurator/cost-model.js` and `configurator/motivation-loadouts.js` precisely
 * because it was doing the Configurator's job.
 *
 * ═══ WHY THE ABLATION IS FIRST, AND WHY IT IS THE GATE ═════════════════════════
 *
 * The obvious test is a differential: give production and a standalone Allocator the
 * same card and budget, assert they agree. M2 PROVED that alone has no teeth. Its
 * pre-M2 defect was restored exactly — a fallback delegating to the very function the
 * Configurator publishes — and the differential and the monotonicity test both stayed
 * green, because a façade that computes the right answer for the wrong reason produces
 * byte-identical output. Only the REFUSAL detected it.
 *
 * So the gate here is: does the Allocator's answer track the AUTHOR, or does it have
 * an answer of its own? Two ablations settle it, and neither can be passed by a façade:
 *
 *   1. Give it an author that proposes ONE small card. If the Allocator returns that
 *      card under a budget large enough to buy far more, its output is a function of
 *      the candidate stream. If it returns something bigger, it enumerated its own.
 *   2. Give it an author whose only candidate is unaffordable. It must refuse — return
 *      the card untouched. A self-authoring maximizer would grow it anyway.
 *
 * The differentials below them are preconditions, kept because they catch the two
 * implementations DRIFTING once they exist separately. Do not mistake them for the
 * guard. (Same lesson as the M2 TEETH note and the 2026-08-04 guard-spelling fix: an
 * output-shaped check cannot catch a façade.)
 *
 * ═══ PERTURBATION RESULTS (2026-08-04) — read before trusting any test here ═════
 *
 * Five perturbations, each restoring a specific pre-M3 defect:
 *
 *   P1  fallback author when none is injected  DETECTED  refusals ×2, persona-boundary
 *       NOT detected by the ablations — they INJECT an author, so the fallback never
 *       fires. The refusals are the only thing standing between here and P1.
 *   P1b when no candidate wins, re-ask the INJECTED author  NOT DETECTED — and this
 *       is correct. The card is still one the Configurator proposed; that is a
 *       redundant loop, not an authoring violation. Recorded so nobody "fixes" the
 *       gate to catch it and makes it fire on legitimate behavior.
 *   P1c when no candidate wins, COMPOSE a card inline    DETECTED  ablation 2
 *       This is the true defect, and the ablation is what catches it.
 *   P2  restore the motivation-loadouts import + quiet fallback normalizer
 *                                              DETECTED  vocabulary refusal,
 *                                                        persona-boundary
 *   P3  restore the silent motivation coercion (discard ok/errors)
 *                                              DETECTED  the decision (c) test
 *
 * ⇒ The refusals and the ablations catch DIFFERENT defects and neither subsumes the
 * other: refusals catch "no author supplied", ablations catch "an author was supplied
 * and ignored". Unlike M2, where the differential proved toothless, the ablation here
 * genuinely earns its place — but only against P1c, not P1.
 */
const assert = require("node:assert/strict");
const { configuratorCapabilities } = require("../../helpers/configurator-capabilities.js");

const P = "../../../packages/runtime/src/personas/";
const CLOCK = () => "2026-08-04T00:00:00.000Z";

const DELVER = Object.freeze({
  type: "delver",
  vitals: {
    health: { max: 10, current: 10, regen: 0 },
    mana: { max: 0, current: 0, regen: 0 },
    stamina: { max: 5, current: 5, regen: 1 },
    durability: { max: 0, current: 0, regen: 0 },
  },
  motivations: ["exploring"],
  affinities: [],
});

const BUDGET = 1000;

async function load() {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  return {
    createAllocatorPersona,
    priceListArtifact: buildDefaultPriceList(),
    capabilities: await configuratorCapabilities(),
  };
}

function maximizeWith(createAllocatorPersona, capabilities, priceListArtifact) {
  return createAllocatorPersona({ clock: CLOCK, ...capabilities }).maximizeFulfillment({
    rooms: [],
    delvers: [{ value: DELVER, optimizationGoals: [], vitalsFlexible: true }],
    priceListArtifact,
    budgetTokens: BUDGET,
  });
}

/**
 * An author that proposes exactly one card, of our choosing, and never revises it.
 * Everything else delegates to the real Configurator, so only the enumeration is
 * ablated — the test is about where candidates COME FROM, not about breaking validity.
 */
function singleCandidateAuthor(realAuthoring, vitals) {
  return {
    ...realAuthoring,
    proposeDelverCandidates: () => ([{
      schema: "agent-kernel/ConfigurationCandidate",
      schemaVersion: 1,
      candidateId: "ablation#only",
      card: { ...DELVER, vitals },
      priceable: { normalizedMotivations: [], affinities: [], vitals },
      preference: [vitals.mana.max, vitals.mana.regen],
    }]),
    reviseDelverCandidate: ({ candidate }) => candidate,
  };
}

// ── ABLATION 1: the output is a function of the candidate stream ────────────────

test("ABLATION: given one small candidate under a large budget, the Allocator returns THAT card", async () => {
  const { createAllocatorPersona, priceListArtifact, capabilities } = await load();

  const pinned = {
    health: { max: 10, current: 10, regen: 0 },
    mana: { max: 7, current: 7, regen: 2 },
    stamina: { max: 5, current: 5, regen: 1 },
    durability: { max: 0, current: 0, regen: 0 },
  };

  const ablated = maximizeWith(
    createAllocatorPersona,
    { ...capabilities, authorCandidates: singleCandidateAuthor(capabilities.authorCandidates, pinned) },
    priceListArtifact,
  );

  assert.deepEqual(
    ablated.delvers[0].value.vitals,
    pinned,
    "the Allocator returned a card the Configurator never proposed — it is still authoring",
  );

  // NOT VACUOUS: the real author, given the same budget, proposes something far
  // larger. So passing the assertion above genuinely required the Allocator to defer
  // to the stream rather than run a search of its own.
  const real = maximizeWith(createAllocatorPersona, capabilities, priceListArtifact);
  assert.ok(
    real.delvers[0].value.vitals.mana.max > pinned.mana.max,
    "precondition: a real author must propose a bigger card here, or the ablation proves nothing",
  );
});

// ── ABLATION 2: an unaffordable stream is refused, not replaced ─────────────────

test("ABLATION: when every candidate is over cap, the Allocator returns the card untouched", async () => {
  const { createAllocatorPersona, priceListArtifact, capabilities } = await load();

  const unaffordable = {
    health: { max: 100000, current: 100000, regen: 0 },
    mana: { max: 100000, current: 100000, regen: 0 },
    stamina: { max: 5, current: 5, regen: 1 },
    durability: { max: 0, current: 0, regen: 0 },
  };

  const result = maximizeWith(
    createAllocatorPersona,
    { ...capabilities, authorCandidates: singleCandidateAuthor(capabilities.authorCandidates, unaffordable) },
    priceListArtifact,
  );

  assert.deepEqual(
    result.delvers[0].value.vitals,
    DELVER.vitals,
    "with nothing affordable to approve, the Allocator must hand the card back unchanged — "
      + "growing it anyway would mean it authored a fallback of its own",
  );
});

// ── REFUSALS: absence is loud, at the module AND the persona surface ────────────

test("an Allocator with no candidate authoring refuses to maximize", async () => {
  const { createAllocatorPersona, priceListArtifact } = await load();

  assert.throws(
    () => createAllocatorPersona({ clock: CLOCK }).maximizeFulfillment({
      rooms: [],
      delvers: [{ value: DELVER, optimizationGoals: [], vitalsFlexible: true }],
      priceListArtifact,
      budgetTokens: BUDGET,
    }),
    (error) => error.code === "allocator_candidate_authoring_required",
    "maximizing without the injected author must refuse, not fall back to the Allocator "
      + "assembling its own cards",
  );
});

test("an Allocator with no candidate authoring refuses to assess feasibility", async () => {
  const { createAllocatorPersona, priceListArtifact } = await load();

  assert.throws(
    () => createAllocatorPersona({ clock: CLOCK }).assessFeasibility({
      commandName: "create",
      budgetTokens: 5,
      delvers: [{ value: DELVER, optimizationGoals: [] }],
      priceListArtifact,
    }),
    (error) => error.code === "allocator_candidate_authoring_required",
    "deciding whether a configuration is structurally valid is Configurator work; the "
      + "assessor must refuse rather than encode the rules itself",
  );
});

test("the pricing surface refuses raw motivations with no Configurator vocabulary", async () => {
  const { calculateActorConfigurationUnitCost } = await import(`${P}allocator/spend-proposal.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { normalizePriceItems } = await import(`${P}allocator/validate-spend.js`);

  assert.throws(
    () => calculateActorConfigurationUnitCost({
      entry: { motivations: ["exploring"], affinities: [], vitals: DELVER.vitals },
      priceMap: normalizePriceItems(buildDefaultPriceList()),
    }),
    (error) => error.code === "allocator_motivation_vocabulary_required",
    "motivation kinds and exclusive groups are Configurator rules — a default here "
      + "would be a second, silently-diverging author of them",
  );
});

// ── PRECONDITIONS: the Allocator's answer is drawn from the author's stream ─────

test("the winning card is one the Configurator actually proposed", async () => {
  const { createAllocatorPersona, priceListArtifact, capabilities } = await load();

  // A smaller cap than the tests above, deliberately: reproducing the author's stream
  // means enumerating every candidate × every possible remainder, which is quadratic
  // in the cap. The property under test does not depend on the cap being large — only
  // on there being a real choice to make, asserted below.
  const capTokens = 200;
  const won = createAllocatorPersona({ clock: CLOCK, ...capabilities }).maximizeFulfillment({
    rooms: [],
    delvers: [{ value: DELVER, optimizationGoals: [], vitalsFlexible: true }],
    priceListArtifact,
    budgetTokens: capTokens,
  }).delvers[0].value;

  // Reproduce the author's stream standalone: every candidate, and every revision of
  // one, at the same envelope. The winner must be somewhere in it. A maximizer that
  // invented any part of its answer would land outside this set.
  const authoring = capabilities.authorCandidates;
  const envelope = authoring.buildBudgetEnvelope({ capTokens, count: 1 });
  const proposed = authoring.proposeDelverCandidates({ card: DELVER, envelope, optimizationGoals: [] });

  const authored = new Set();
  proposed.forEach((candidate) => {
    authored.add(JSON.stringify(candidate.card.vitals));
    for (let remaining = 0; remaining <= envelope.perUnitCapTokens; remaining += 1) {
      const revised = authoring.reviseDelverCandidate({ candidate, remainingTokens: remaining, optimizationGoals: [] });
      authored.add(JSON.stringify(revised.card.vitals));
    }
  });

  assert.ok(
    authored.has(JSON.stringify(won.vitals)),
    "the Allocator returned vitals that appear nowhere in the Configurator's candidate "
      + "stream — it composed part of the answer itself",
  );
  assert.ok(proposed.length > 1, "precondition: there must be a real choice to make");
});

test("motivations reach the price through the candidate's published field, not a re-derivation", async () => {
  const { capabilities } = await load();
  const authoring = capabilities.authorCandidates;
  const envelope = authoring.buildBudgetEnvelope({ capTokens: BUDGET, count: 1 });

  const [candidate] = authoring.proposeDelverCandidates({
    card: { ...DELVER, motivations: ["exploring"] },
    envelope,
    optimizationGoals: [],
  });

  assert.ok(Array.isArray(candidate.priceable.normalizedMotivations), "candidates publish normalized motivations");
  assert.deepEqual(
    candidate.priceable.normalizedMotivations.map((entry) => entry.kind),
    ["exploring"],
    "the raw string is normalized by the AUTHOR, so the Allocator prices a published field",
  );
  assert.deepEqual(
    candidate.card.motivations,
    ["exploring"],
    "the card handed downstream keeps the authored form — normalization is for pricing only",
  );
});

// ── DECISION (c): the author refuses contradictory motivations ──────────────────

test("a card with contradictory motivations is never proposed, so it is never priced", async () => {
  const { capabilities } = await load();
  const authoring = capabilities.authorCandidates;
  const envelope = authoring.buildBudgetEnvelope({ capTokens: BUDGET, count: 1 });

  // `stealthy` and `friendly` are the same exclusive posture group. Before M3 the
  // pricing path called normalizeMotivations, threw away its `ok`/`errors`, and
  // silently priced the coerced survivor — then the maximizer grew that coerced card.
  const conflicted = authoring.proposeDelverCandidates({
    card: { ...DELVER, motivations: ["stealthy", "friendly"] },
    envelope,
    optimizationGoals: [],
  });

  assert.equal(
    conflicted.length,
    0,
    "contradictory motivations must yield NO candidate — silently coercing them and "
      + "pricing the survivor is the behavior decision (c) removed",
  );

  // Not vacuous: the same card with a single posture proposes normally.
  const clean = authoring.proposeDelverCandidates({
    card: { ...DELVER, motivations: ["stealthy"] },
    envelope,
    optimizationGoals: [],
  });
  assert.ok(clean.length > 0, "precondition: a non-contradictory card must still propose");
});

// ## TODO: Test Permutations
