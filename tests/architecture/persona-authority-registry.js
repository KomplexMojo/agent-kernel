/**
 * G1 — the persona authority registry (criterion A2).
 *
 * For every chartered behavior: which persona owns it, which A1–A5 criteria it must
 * satisfy, the PRODUCTION entry point that must be unable to produce it without the
 * persona, and how to invoke the persona standalone to diff against.
 *
 * **A behavior with no G1 test is not owned.** This file is what makes that
 * checkable: the backlog stops being a judgement and becomes a count.
 *
 * WHY A REGISTRY AND NOT JUST TESTS. Every gate this project had was an OUTPUT gate
 * — goldens, schemas, integration results — and a façade produces byte-identical
 * output by construction, which is how eight violations survived a fully green
 * suite. The registry inverts the default: a chartered behavior is assumed NOT
 * owned until an entry here says otherwise and a test backs it.
 *
 * ── STATUS VALUES ──────────────────────────────────────────────────────────────
 *   { owned: true }             a live test asserts production cannot bypass the persona
 *   { blockedBy: "CR.3", … }    not owned; the G1 test lands SKIPPED with the finding id
 *
 * Blocked entries are skipped rather than omitted, per DECISION D-k: an absent
 * entry lets a green suite imply a behavior is guarded when nothing guards it. The
 * skip list IS the remaining work.
 *
 * ── BEHAVIORS ARE SPLIT BY PLANE ───────────────────────────────────────────────
 * "Build plane ≠ tick plane" is charter law (P3.4), and PX.5 showed why it matters
 * here: the Configurator's validate/lock is genuinely owned on the build plane and
 * label-only on the tick plane, because `advance()` reaches its FSM without the
 * service surface. One charter sentence, two ownership answers. A registry keyed
 * only by persona could not express that.
 *
 * ── INVOCATION KINDS ───────────────────────────────────────────────────────────
 *   "cli"      reachable through ak-persona / runPersonaInvocation (an advance() round)
 *   "service"  reachable only in-process, by calling the persona's service methods
 *   "none"     no standalone invocation exists yet — the behavior has no seam
 *
 * ⚠️ The persona CLI covers the `advance()` surface ONLY. The build/CONFIG-plane
 * service surfaces (provideConfig/validate/lock, registerBudget/validateSpend,
 * beginBuild/assembleBuildSpec) are NOT CLI-reachable, and four of the nine findings
 * live on the build plane. Extending the envelope to name a service method is the
 * obvious next step for G1 coverage there; D-j's envelope maps onto advance() alone.
 */

/** Charter persona table (docs/architecture-charter.md) — the authoritative roster. */
const CHARTER_PERSONAS = Object.freeze([
  "orchestrator",
  "director",
  "configurator",
  "allocator",
  "actor",
  "moderator",
  "annotator",
]);

const REGISTRY = Object.freeze([
  // ── Orchestrator ───────────────────────────────────────────────────────────
  {
    id: "orchestrator/llm-session",
    chartered: "orchestrator/llm-sessions",
    persona: "orchestrator",
    behavior: "Owns every external interaction seam: LLM sessions run as persona rounds",
    criteria: ["A5"],
    productionEntryPoint: "packages/runtime/src/personas/orchestrator/llm-session.js",
    invocation: "none",
    // FLIPPED 2026-08-12, and it had been stale since CR.4 closed on 2026-08-10
    // (2be417d6, M1-M7). The entry still read "eight production call sites bypass any
    // controller" while a live guard asserted there were none — the registry
    // UNDER-reporting this time, which reads as backlog rather than as coverage but is
    // the same rot e7501e9a had to correct. Re-derived at HEAD before flipping.
    status: {
      owned: true,
      since: "CR.4 M1-M7 (2be417d6)",
      provenBy: "tests/architecture/cr4-llm-call-site-inventory.test.js",
      why:
        "A5 is the criterion, and two things now hold at once. (1) NO production caller "
        + "reaches runLlmSession: the inventory guard scans packages/, scripts/ and tools/ "
        + "and asserts zero direct call sites, so a reintroduced inline await fails a gate "
        + "rather than a review. (2) Every capture artifact stamped producedBy:\"orchestrator\" "
        + "is built inside llm-round.js's settle(), which cannot run before a terminal state "
        + "— pinned by \"CR.4: the round's capture is stamped by a round that actually "
        + "reached a terminal state\" in tests/personas/orchestrator/orchestrator-llm-round.test.js. "
        + "The producedBy that kernel.js and ak-impl.mjs pass is an OPTION into a "
        + "round-hosted call, not glue stamping an artifact of its own; every one of the "
        + "six sites was checked, not sampled. runLlmSession itself survives only as the "
        + "differential's reference implementation, which is why its call sites are tests.",
      residue:
        "runLlmBudgetLoop is still a free function rather than an FSM round. It performs "
        + "no IO (stage 1 injected the runner) and produces no artifact of its own — every "
        + "capture it returns came from a settled round — so it does not violate A5. "
        + "Whether the loop itself becomes a round is WP-4's question, not this entry's.",
    },
  },

  {
    id: "orchestrator/deferred-side-effects",
    chartered: "orchestrator/workflow-coordination",
    persona: "orchestrator",
    behavior: "Effects deferred during execution are coordinated by the Orchestrator after the run",
    criteria: ["A2", "A5"],
    productionEntryPoint: "packages/runtime/src/personas/orchestrator/post-run-round.js",
    invocation: "cli",
    status: {
      owned: true,
      since: "P5.5",
      provenBy: "tests/personas/orchestrator/orchestrator-coordinates-deferred-effects.test.js",
      why:
        "BUILT in P5.5 — it was registered blocked because it did not exist. The round "
        + "returns effects and STOPS, exactly like llm-round.js: the host dispatches, the "
        + "adapter does the IO, and results come back through fulfill(). A5 is the gate that "
        + "matters: `coordinateDeferredEffects` refuses unless the Orchestrator in THIS run's "
        + "registry can host the round, so glue cannot mint a fresh persona to sign the "
        + "captures — the CR.8 façade, one artifact over. Reaches production through "
        + "`ak run`, which writes `deferred-coordination.json`. "
        + "⚠️ The A2 ablation is deliberately not the headline: production used to do NOTHING "
        + "here, so 'nothing happens without the Orchestrator' was true before the feature "
        + "and proves nothing. The load-bearing test is that deferrals are coordinated at all.",
      residue:
        "There is no external-fact ADAPTER in the tree yet, so a real run reports its "
        + "deferrals as `outstanding` with reason `missing_external_fact_adapter`. That is the "
        + "honest outcome and it is visible, which is the whole change: before this the "
        + "records went nowhere and a run that dropped every deferral looked identical to one "
        + "that had none. Wiring an adapter is adapter-layer work, not this entry's. "
        + "⚠️ `dispatchEffect` gained an explicit `need_external_fact` case for the same reason "
        + "CR.4 M2 gave the LLM one: the `default:` branch warns and then reports `fulfilled`, "
        + "so a fact that was never fetched would have been captured as provenance.",
    },
  },

  // ── Director ───────────────────────────────────────────────────────────────
  {
    id: "director/plan-artifact",
    chartered: "director/intent-to-plan",
    persona: "director",
    behavior: "Translates intent into structure: the persisted PlanArtifact is the plan that drove the spec",
    criteria: ["A2", "A5"],
    productionEntryPoint: "packages/runtime/src/build/authoring-build.js",
    invocation: "service",
    status: { owned: true, since: "CR.3" },
  },

  // Registered 2026-08-12 (P5.4). The Director's other three translations had no entry, so
  // by this registry's own premise they were unowned — while a required-capability census in
  // `orchestrator-llm-budget-loop.test.js` had been proving the A2 half of each all along.
  // ⇒ *The proof existed and the entry did not, which reads as backlog exactly like a real
  // gap.* This is the reverse of the CR.4 rot fixed earlier the same day and the same root:
  // nothing walks from a test back to the registry.
  {
    id: "director/pool-mapping",
    chartered: "director/plan-to-buildspec",
    persona: "director",
    behavior: "Mapping an LLM summary onto catalog pools is the Director's decision, inside an open round",
    criteria: ["A2", "A3"],
    productionEntryPoint: "packages/runtime/src/personas/orchestrator/llm-budget-loop.js",
    invocation: "service",
    status: {
      owned: true,
      since: "CR.4 M5b.2a′",
      provenBy: "tests/personas/orchestrator/orchestrator-llm-budget-loop.test.js",
      why:
        "A2 by refusal: `mapPool` is REQUIRED with no default, so the loop cannot map a "
        + "summary at all without the Director — \"the loop REFUSES to run without a Director "
        + "pool mapper\". A3 on top of it: the method is gated on PLANNED_STATES, and "
        + "director-build-round.test.js pins that translation refuses before a build begins. "
        + "Before M5b.2a′ the loop mapped summaries with no Director in existence.",
    },
  },
  {
    id: "director/card-set-translation",
    chartered: "director/plan-to-buildspec",
    persona: "director",
    behavior: "Summary → cardSet is the Director's translation; the gated and ungated surfaces share one origin",
    criteria: ["A3"],
    productionEntryPoint: "packages/runtime/src/personas/director/director-services.js",
    invocation: "service",
    status: {
      owned: true,
      since: "CR.4 M5b.2e / CR.7 (2026-08-12)",
      provenBy: "tests/personas/director/director-card-translation.test.js",
      why:
        "A3 is the criterion and the pair is the point: `buildCardSet` is gated behind an open "
        + "round because its output reaches a PERSISTED BuildSpec, while `cardSetFromSummary` "
        + "is deliberately ungated for authoring and preview, where no round exists or should. "
        + "The test pins both halves — gating the second would be an outage, not a boundary "
        + "(D8.3's rule), and the gate on the first was a LABEL until a perturbation forced it "
        + "to be real.",
    },
  },
  {
    id: "director/pricing-relay",
    chartered: "director/plan-to-buildspec",
    persona: "director",
    behavior: "The Director relays the Allocator's pricing answers; neither it nor the loop computes them",
    criteria: ["A1", "A2"],
    productionEntryPoint: "packages/runtime/src/personas/orchestrator/llm-budget-loop.js",
    invocation: "service",
    status: {
      owned: true,
      since: "CR.4 M5b.2b–2d",
      provenBy: "tests/personas/orchestrator/orchestrator-llm-budget-loop.test.js",
      why:
        "Four separate refusals, one per relayed answer: the loop will not run without an "
        + "Allocator tile-cost resolver, budget allocator, selection-spend evaluator or layout "
        + "fitter. A1 because the loop used to compute all four inline out of the Allocator's "
        + "internals — the second author is gone, not merely re-routed — and A2 because a "
        + "missing capability is a refusal rather than a fallback. A required capability is a "
        + "census you cannot opt out of: it enumerates its callers by breaking them.",
    },
  },

  // ── Configurator ───────────────────────────────────────────────────────────
  {
    id: "configurator/feasibility-verdict",
    chartered: "configurator/feasibility",
    persona: "configurator",
    behavior: "Layout feasibility is the Configurator's verdict; the Director derives the geometry it judges",
    criteria: ["A1", "A2"],
    productionEntryPoint: "packages/runtime/src/personas/orchestrator/llm-budget-loop.js",
    invocation: "service",
    status: {
      owned: true,
      since: "CR.4 M5b.2f",
      provenBy: "tests/personas/orchestrator/orchestrator-llm-budget-loop.test.js",
      why:
        "\"The loop REFUSES to run without a Configurator feasibility assessor\" — A2 by "
        + "refusal. A1 because the loop carried its own approximation of the verdict before "
        + "M5b.2f, and the threshold moved home with it. The split is deliberate and is what "
        + "makes the pair checkable: deriving a levelGen from intent is Director translation, "
        + "judging whether it fits is Configurator law, and `director-build-round.test.js` "
        + "pins the derivation half refusing an input it cannot derive from.",
    },
  },
  {
    id: "configurator/input-preparation",
    chartered: "configurator/levels",
    persona: "configurator",
    behavior: "Grid sizing, hazard placement and resource mapping run behind the persona's CONFIG-plane surface",
    criteria: ["A3"],
    productionEntryPoint: "packages/runtime/src/build/authoring-build.js",
    invocation: "service",
    status: {
      owned: true,
      since: "P2.2 / P2.3.1",
      provenBy: "tests/personas/configurator/configurator-input-prep.test.js",
      why:
        "⚠️ **A3 ONLY, deliberately.** The cited test proves the state GATES the behavior — "
        + "`prepareLevelGen` and `mapResources` refuse before `provideConfig` opens the round, "
        + "and `provideConfig` rejects an invalid config and stays uninitialized. That is "
        + "exactly criterion A3 and nothing more: it does not ablate the persona out of "
        + "`authoring-build.js` to show production cannot size a grid without it. Claiming A2 "
        + "here would be the overclaim this registry exists to prevent — the sibling "
        + "validate-lock@build entry carries A2 because it has a real differential.",
    },
  },
  {
    id: "configurator/validate-lock@build",
    chartered: "configurator/validate-and-lock",
    persona: "configurator",
    behavior: "Assembles, validates and locks configurations — BUILD plane",
    criteria: ["A2", "A3"],
    productionEntryPoint: "packages/runtime/src/build/authoring-build.js",
    invocation: "service",
    // The one genuinely owned behavior in this registry today, and the proof that the
    // G1 mechanism works rather than merely being described.
    status: { owned: true, since: "CR.2 (14127e45)" },
  },
  {
    id: "configurator/validate-lock@tick",
    chartered: "configurator/validate-and-lock",
    persona: "configurator",
    behavior: "Assembles, validates and locks configurations — TICK plane",
    criteria: ["A3"],
    productionEntryPoint: "packages/runtime/src/runner/runtime-fsm.mjs",
    invocation: "cli",
    // Owned in the sense A3 asks for: the tick plane can no longer reach a state
    // claiming validation/locking, because it no longer sends those events at all.
    // Configuration is build-plane work; the tick plane consumes an already-built
    // SimConfig. Asserted in tests/personas/dual-surface-shadowing.test.js.
    status: {
      owned: true,
      since: "PX.5 (Option A)",
      provenBy: "tests/personas/dual-surface-shadowing.test.js",
    },
  },

  {
    id: "configurator/locked-config-is-the-input",
    chartered: "configurator/validate-and-lock",
    persona: "configurator",
    behavior: "The config a build consumes is the one the Configurator locked, unedited afterwards",
    criteria: ["A5"],
    productionEntryPoint: "packages/runtime/src/build/orchestrate-build.js",
    invocation: "service",
    status: {
      owned: true,
      since: "PX.6 (2026-08-06)",
      provenBy: "tests/runtime/build-locked-input-immutability.test.js",
      why:
        "The four write-backs into spec.configurator.inputs are gone. What the build resolves "
        + "— expanded affinity/motivation rules, and the actor list after budget maximization "
        + "and position normalization — is published as OUTPUT under configurator.resolved, so "
        + "`inputs` stays the record of what the Configurator locked. The golden diff is the "
        + "finding made visible: inputs.actors[].x/y revert to 0,0, the coordinates the "
        + "Configurator actually supplied, where the recorded input used to carry positions "
        + "the build had computed.",
    },
  },

  // ── Allocator ──────────────────────────────────────────────────────────────
  {
    id: "allocator/pricing-single-origin",
    chartered: "allocator/pricing-formulas",
    persona: "allocator",
    behavior: "The economy: every token cost has one author inside the Allocator",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/allocator/base-costs.json",
    invocation: "cli",
    status: {
      owned: true,
      why:
        "CR.1 closed at CR.9 M5. The finding named three origins; the guard-as-census found "
        + "FIVE files and 15 constants, two files the hand inventory had missed. Fourteen "
        + "relocated into the Allocator (89e213e, fb46132); the last, contracts' "
        + "DEFAULT_LAYOUT_TILE_COSTS, was deleted rather than moved — its hallway price had "
        + "already diverged from base-costs.json, so aligning the numbers would have left the "
        + "second table standing. The third named origin, core-ts's DEFAULT_ACTION_COST, was "
        + "investigated and is NOT a defect: it is a unit count that the Allocator's injected "
        + "action costs overwrite before core reads it.",
      provenBy: "tests/architecture/single-origin.test.js",
      // The proof is the price/budget-split guard running UN-SKIPPED — it was written as a
      // census and skipped from birth, which reads identically to passing in the runner.
      // Perturbation-verified: restoring the tile-cost table in contracts fails it.
    },
  },
  {
    id: "allocator/judges-not-authors",
    chartered: "allocator/price-lists",
    persona: "allocator",
    behavior: "The Allocator prices a config it did not author, by reading the artifact's published fields",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/allocator/budget-fulfillment.js",
    invocation: "service",
    status: {
      owned: true,
      why:
        "CR.9 M3 split the fused propose/judge loop across the persona line. Card assembly, "
        + "structural validity and candidate enumeration moved to "
        + "configurator/candidate-authoring.js; the Allocator receives them injected "
        + "(authorCandidates, normalizeMotivations) and refuses without them — "
        + "allocator_candidate_authoring_required / allocator_motivation_vocabulary_required. "
        + "Both Allocator->Configurator import crossings are gone (allowlist 57 -> 55).",
      provenBy: "tests/personas/allocator/allocator-judges-not-authors.test.js",
      // The proof is the ABLATION, not the differential: feed the Allocator a stream
      // whose only candidate is unaffordable and assert it hands the card back rather
      // than composing one. Perturbation-verified against five restored defects; the
      // results table lives in the test file's header and includes one perturbation
      // (P1b) that is deliberately NOT detected because it is not the defect.
    },
  },

  {
    id: "allocator/spend-authority",
    chartered: "allocator/spend-validation",
    persona: "allocator",
    behavior: "A build the Allocator will not fund does not happen: the receipt gates production",
    criteria: ["A2"],
    productionEntryPoint: "packages/runtime/src/build/orchestrate-build.js",
    invocation: "service",
    status: {
      owned: true,
      since: "P1 / CR.1",
      provenBy: "tests/adapters-cli/ak-hazard-resource-plan.test.js",
      why:
        "A2 through the real CLI: when the Allocator denies the receipt, `orchestrateBuild` "
        + "throws `Budget receipt denied: …` and the command exits non-zero. "
        + "⚠️ **THE CITATION IS THE FINDING.** This entry first cited "
        + "`ak-warden-plan.test.js`, the obvious candidate — it names the denial string and "
        + "asserts a non-zero exit. Perturbing the refusal away leaves it GREEN, because its "
        + "regex accepts three different messages "
        + "(`/budget|minimum_cost_exceeds_budget|Budget receipt denied/i`) and that scenario "
        + "actually fails at an EARLIER gate. A test that mentions a behavior is not a test "
        + "that pins it. "
        + "⚠️ And the first perturbation was itself wrong: `orchestrate-build.js` throws on a "
        + "denied receipt at TWO sites, one a superset of the other, so neutralizing one left "
        + "the whole suite green and briefly read as \"nothing guards this\". Both had to go "
        + "before the real guard showed itself. "
        + "⚠️ SCOPE: this proves the verdict is load-bearing, not that the persona cannot be "
        + "bypassed by a caller that never asks for a receipt at all.",
    },
  },
  {
    id: "allocator/budget-maximization",
    chartered: "allocator/budget-maximization",
    persona: "allocator",
    behavior: "Maximizing a config against a budget spends the Allocator's prices, never an assumed one",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/configurator/budget-maximizer.js",
    invocation: "service",
    status: {
      owned: true,
      since: "CR.7 / WP-5 D10",
      provenBy: "tests/personas/configurator/configurator-maximizer-prices-from-allocator.test.js",
      why:
        "A1 with real teeth, and the teeth are the story: the maximizer used to carry a "
        + "private fallback price of `1`, and every vital in the Allocator's default list "
        + "costs exactly 1 — so the private price and the real price were numerically "
        + "identical and NO output test could distinguish them. The TEETH case quadruples the "
        + "Allocator's price and requires the result to move; unpriced vitals and regen ticks "
        + "are refusals that name the missing key. ⚠️ A1 only: this is about who authors the "
        + "prices, not about whether production could maximize without the Allocator.",
    },
  },
  {
    id: "allocator/reconciliation",
    chartered: "allocator/reconciliation",
    persona: "allocator",
    behavior: "Reconciling actual spend against the issued budget, and adjusting",
    criteria: ["A1", "A2"],
    productionEntryPoint: "packages/runtime/src/personas/allocator/reconciliation.js",
    invocation: "service",
    status: {
      owned: true,
      since: "P5.5",
      provenBy: "tests/personas/allocator/allocator-reconciles-or-nothing-does.test.js",
      why:
        "BUILT in P5.5 — it was registered blocked because it did not exist, not because it "
        + "was unproven. A2 by ablation: an Allocator that walks the same states and emits "
        + "the same payload-driven actions but never reconciles leaves production with NO "
        + "verdict anywhere, and the twin is exact (it delegates to a real persona, so the "
        + "spend core charges is identical — a stub emitting nothing would have removed the "
        + "signals that trigger the reconciliation and proved nothing). A1 because the "
        + "disposition boundaries and the adjustment vocabulary are authored here: the test "
        + "asserts the overspend arithmetic, not merely that a verdict appeared. "
        + "⚠️ What made this possible at all was that the ACTUAL half existed and was never "
        + "read: `core.getBudgetUsage` had no runtime consumer, so caps went in and nothing "
        + "ever compared them against spend.",
      residue:
        "REBALANCING was a label-only state before this — a charter defect (Enforcement → "
        + "Personas) that no guard reported, because a state gating nothing is indistinguishable "
        + "from a state gating something in every output test. It gates the reconciliation now, "
        + "and its FSM guard requires the ledger rather than the old signal COUNTS. "
        + "⚠️ Separately: `core.applyAction` returns for ActionKind.Move BEFORE charging, so a "
        + "`movement` cap is inert against moves and reconciles as spend 0. That is a core "
        + "defect this entry does not cover and did not introduce; the G1 test caps `effects` "
        + "and says so in place.",
    },
  },

  // ── Actor ──────────────────────────────────────────────────────────────────
  {
    id: "actor/serializable-decision",
    chartered: "actor/action-proposal",
    persona: "actor",
    behavior: "Proposes actions deterministically: the decision is a pure function of serialized state",
    criteria: ["A4"],
    productionEntryPoint: "packages/runtime/src/personas/actor/controller.js",
    invocation: "cli",
    // The five closure values are gone: the Actor holds no state outside its FSM,
    // so the decision is a function of (view(), event, payload). Note this is A4 as
    // CR.6 states it — "identical view() ⇒ identical decision". The *restore* half
    // of A4 (feeding a serialized view back in) is PX.4/HANDOFF-4 and still open,
    // which is why all/restorable-from-view below stays blocked.
    status: { owned: true, since: "CR.6" },
  },
  {
    id: "actor/no-budget-policy",
    chartered: "actor/action-proposal",
    persona: "actor",
    behavior: "The Actor emits candidate proposals; budget admissibility is not its call",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/actor/controller.js",
    invocation: "cli",
    // The policy moved to personas/allocator/proposal-admissibility.js and reaches
    // the Actor only as the Allocator's own injected judge (wired in
    // buildDefaultPersonas). The Actor cannot reach a verdict the Allocator would
    // not, and refuses to guess if a budget arrives with no judge attached.
    status: { owned: true, since: "CR.6" },
  },

  {
    id: "actor/motivation-to-proposal",
    chartered: "actor/action-proposal",
    persona: "actor",
    behavior: "Turning motivations and an observation into proposed actions is the Actor's decision",
    criteria: ["A2"],
    productionEntryPoint: "packages/runtime/src/personas/actor/controller.js",
    invocation: "cli",
    status: {
      owned: true,
      since: "P5.4 (2026-08-12)",
      provenBy: "tests/personas/actor/actor-proposes-or-nothing-does.test.js",
      why:
        "The ablation the entry asked for, built: two runs of the same fixture through the same "
        + "registry, differing only in whether the Actor proposes. The control emits 3 real "
        + "`move` actions across 3 ticks; the neutered run emits NONE, so nothing else in the "
        + "tick makes up the difference. Both runs use the same registry SHAPE deliberately — a "
        + "caller-supplied registry replaces the defaults, so building one from defaults and one "
        + "by hand would vary two things. Perturbation: a stub that does propose fails the "
        + "assertion, which proves it reads production rather than a constant.",
    },
  },

  // ── Moderator ──────────────────────────────────────────────────────────────
  {
    id: "moderator/tick-ordering",
    chartered: "moderator/tick-ordering",
    persona: "moderator",
    behavior: "Controls the tick: ordering strategy and effect fulfilment are the Moderator's decision",
    criteria: ["A1", "A2"],
    productionEntryPoint: "packages/runtime/src/runner/runtime-fsm.mjs",
    invocation: "cli",
    // Both halves moved: the canonical order lives only in moderator/tick-ordering.js
    // and dispositions only in moderator/effect-fulfillment.js. The runner asks and
    // executes; it kept no fallback copy of either, so a Moderator that will not
    // answer is a hard error rather than a silent reversion to glue policy.
    // Dispatch itself stays behind ports/effects.js — the persona decides, glue does IO.
    status: { owned: true, since: "CR.5" },
  },

  {
    id: "moderator/pausing-gates-advancement",
    chartered: "moderator/pausing",
    persona: "moderator",
    behavior: "`pausing` is a real gate: a paused Moderator refuses to advance step()",
    criteria: ["A3"],
    productionEntryPoint: "packages/runtime/src/runner/runtime-fsm.mjs",
    invocation: "cli",
    status: {
      owned: true,
      since: "P3.1",
      provenBy: "tests/personas/moderator/moderator-pause-gates-tick.test.js",
      why:
        "The charter names this one explicitly — \"pausing is a real gate that refuses to "
        + "advance step(), not a label\" — because the test that used to cover it asserted only "
        + "that the state label changed. A3 is exactly that distinction, and the replacement "
        + "test asserts the tick does not advance while paused, plus that the labels still move "
        + "correctly across pause/resume/stop so the gate is not just a permanent stop.",
    },
  },
  {
    id: "moderator/affinity-target-resolution",
    chartered: "moderator/affinity-resolution",
    persona: "moderator",
    behavior: "Resolving which actors an affinity targets, and the effects that follow, is Moderator policy",
    criteria: ["A1", "A2"],
    productionEntryPoint: "packages/runtime/src/personas/moderator/affinity-target-effects.js",
    invocation: "cli",
    status: {
      owned: true,
      since: "P5.4 (2026-08-12)",
      provenBy: "tests/personas/moderator/moderator-affinity-resolution.test.js",
      why:
        "Ablation plus differential. A Moderator that plans no affinity actions leaves the core "
        + "untouched (control: the real one sets one tile and arms one hazard), and what "
        + "production applies equals what a FRESH standalone Moderator plans from the payload "
        + "production actually sent — captured through a proxy, because asserting against a "
        + "hand-written payload would test the fixture and not the seam. "
        + "⚠️ Perturbation-verified WITH A RECORDED LIMIT: making the runner call "
        + "`planModeratorAffinityActions` itself fails the ABLATION and passes the DIFFERENTIAL, "
        + "since a runner duplicating the persona's own function agrees with it by construction. "
        + "Only the ablation answers A2 — the same split as CR.8's provenance pair.",
    },
  },

  // ── Annotator ──────────────────────────────────────────────────────────────
  {
    id: "annotator/per-tick-telemetry",
    chartered: "annotator/per-tick-telemetry",
    persona: "annotator",
    behavior: "Per-tick TelemetryRecords are captured by the Annotator, not assembled by the runner",
    criteria: ["A2", "A5"],
    productionEntryPoint: "packages/runtime/src/runner/runtime-fsm.mjs",
    invocation: "cli",
    status: {
      owned: true,
      since: "P5.4 (2026-08-12)",
      provenBy: "tests/personas/annotator/annotator-per-tick-telemetry.test.js",
      why:
        "Ablation: a silent Annotator means the tick frames carry NO records, so the runner "
        + "keeps no fallback that assembles them from the observations it already holds — which "
        + "it could trivially do. Plus provenance per record (`meta.producedBy`, `meta.runId`) "
        + "from an instance the run demonstrably moved out of `idle`. "
        + "⚠️ SCOPE, stated in the test: this does not force the record to come from THE SAME "
        + "instance the way CR.8's refusal does for the summary, because the tick loop drives "
        + "the Annotator itself and there is no glue-side call to intercept. An out-of-band "
        + "emit for a run someone else ticked would need CR.8's refusal, not this test.",
    },
  },
  {
    id: "annotator/run-summary-provenance",
    chartered: "annotator/run-summary",
    persona: "annotator",
    behavior: "The end-of-run RunSummary is produced by the instance that observed the run",
    criteria: ["A2", "A5"],
    productionEntryPoint: "packages/runtime/src/commands/kernel.js",
    invocation: "none",
    // The runtime delegates to the Annotator it actually ran (`runtime.summarizeRun`),
    // and that method REFUSES to summarize a run that ticked if the instance is still
    // `idle` — which is exactly what a freshly constructed stand-in looks like. The
    // persona registry stays private; glue gained one narrow method, not persona access.
    status: { owned: true, since: "CR.8" },
  },

  // ── Cross-persona infrastructure ───────────────────────────────────────────
  {
    id: "all/port-contract-single-origin",
    persona: "moderator",
    behavior: "One effect codebook: the port contract belongs to the domain and is not redeclared",
    criteria: ["A1"],
    productionEntryPoint: "packages/core-ts/src/ports/effects.ts",
    invocation: "none",
    // runtime/src/ports/effects.js now IMPORTS and re-exports core's EffectKind
    // rather than redeclaring a 10-kind subset, so ActorMoved/ActorBlocked cross the
    // port as themselves. Proven by the LIVE `EffectKind` guard in
    // single-origin.test.js, scoped to all of `packages/`: a second declaration
    // anywhere fails it. That guard is the G1 test for this entry.
    status: {
      owned: true,
      since: "PX.1 / HANDOFF-8 (cf4dcdbd)",
      provenBy: "tests/architecture/single-origin.test.js",
    },
  },
  {
    id: "all/injected-clock",
    persona: "moderator",
    behavior: "No persona reads a clock: time is injected, never defaulted",
    criteria: ["A4"],
    productionEntryPoint: "packages/runtime/src/personas/_shared/tick-state-machine.mts",
    invocation: "cli",
    status: {
      owned: true,
      since: "PX.3 M6 (2026-08-06)",
      provenBy: "tests/architecture/single-origin.test.js",
      why:
        "Closed in three passes. `5dbb4964` made the clock required at the 14 persona "
        + "FACTORIES; 2026-08-04 widened the guard's PATTERN from one spelling to forbidding "
        + "`new Date(` outright, which immediately caught two live violations inside its own "
        + "scope; M6 widened its SCOPE from those 14 files to every persona file, closing the "
        + "11 non-factory modules that were actually minting artifact timestamps. Requiring "
        + "the clock surfaced four production callers that had never passed one. The residue "
        + "is 7 NON-persona sites (ports, contracts, runner, adaptive-workflow, render), "
        + "deliberately out of scope: an adapter reading the wall clock is correct — the rule "
        + "is that a persona does not.",
    },
  },
  {
    id: "all/restorable-from-view",
    persona: "moderator",
    behavior: "A persona can be rebuilt from its own serialized view()",
    criteria: ["A4"],
    productionEntryPoint: "packages/runtime/src/personas/configurator/state-machine.js",
    invocation: "none",
    // Every factory now accepts `{ from: view }` alongside the state label, so
    // serialized output CAN be fed back in. Proven by G4
    // (persona-serialization-equivalence.test.js), 7/7: for each persona, a JSON
    // round-trip of view() rebuilds a persona whose view() matches AND whose next
    // advance() is result-identical to the original's. That is the A4 property.
    status: {
      owned: true,
      since: "PX.4 / HANDOFF-4 (cf4dcdbd)",
      provenBy: "tests/architecture/persona-serialization-equivalence.test.js",
    },
  },
  {
    id: "all/controller-only-boundary",
    persona: "moderator",
    behavior: "External code imports persona controllers only",
    criteria: ["A1", "A2"],
    productionEntryPoint: "tests/architecture/persona-boundary-allowlist.json",
    invocation: "none",
    status: {
      owned: true,
      since: "CR.7 / P5.1 flip (2026-08-12)",
      provenBy: "tests/architecture/persona-boundary.test.js",
      why:
        "The allowlist is EMPTY and the guard is a hard error. It ran 74 -> 62 -> 55 -> 53 "
        + "-> 35 -> 3 -> 1 -> 0; the last row was configurator/cost-model.js reading the "
        + "Allocator's base-costs.json, and P1.4 closed it by DELETING the import with the "
        + "dead price model behind it rather than re-pointing it — re-pointing would have "
        + "satisfied the guard and left a second price author standing. The file remains, "
        + "empty, and a separate test now refuses a non-empty allowlist: a guard that reads "
        + "an empty list can be re-opened with a one-line JSON edit, and one that has no "
        + "list cannot. Perturbation-verified both ways — a new crossing fails, and so does "
        + "re-adding an entry for a crossing that genuinely exists.",
    },
  },
]);

/** Fixtures the `cli` invocation kind can use, one per persona. */
const CLI_FIXTURE_DIR = "tests/fixtures/persona-cli";

function fixtureFor(persona) {
  return `${CLI_FIXTURE_DIR}/${persona}-basic.json`;
}

function isOwned(entry) {
  return entry.status.owned === true;
}

function blockingFinding(entry) {
  return entry.status.blockedBy ?? null;
}

module.exports = {
  CHARTER_PERSONAS,
  REGISTRY,
  CLI_FIXTURE_DIR,
  fixtureFor,
  isOwned,
  blockingFinding,
};
