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
    persona: "orchestrator",
    behavior: "Owns every external interaction seam: LLM sessions run as persona rounds",
    criteria: ["A5"],
    productionEntryPoint: "packages/runtime/src/personas/orchestrator/llm-session.js",
    invocation: "none",
    status: {
      blockedBy: "CR.4",
      why:
        "runLlmSession awaits adapter.generate() directly at three sites and stamps "
        + "producedBy:\"orchestrator\" with no FSM round. Eight production call sites across "
        + "four importers bypass any controller.",
    },
  },

  // ── Director ───────────────────────────────────────────────────────────────
  {
    id: "director/plan-artifact",
    persona: "director",
    behavior: "Translates intent into structure: the persisted PlanArtifact is the plan that drove the spec",
    criteria: ["A2", "A5"],
    productionEntryPoint: "packages/runtime/src/build/authoring-build.js",
    invocation: "service",
    status: { owned: true, since: "CR.3" },
  },

  // ── Configurator ───────────────────────────────────────────────────────────
  {
    id: "configurator/validate-lock@build",
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
    persona: "configurator",
    behavior: "Assembles, validates and locks configurations — TICK plane",
    criteria: ["A3"],
    productionEntryPoint: "packages/runtime/src/runner/runtime-fsm.mjs",
    invocation: "cli",
    // Owned in the sense A3 asks for: the tick plane can no longer reach a state
    // claiming validation/locking, because it no longer sends those events at all.
    // Configuration is build-plane work; the tick plane consumes an already-built
    // SimConfig. Asserted in tests/personas/dual-surface-shadowing.test.js.
    status: { owned: true, since: "PX.5 (Option A)" },
  },

  {
    id: "configurator/locked-config-is-the-input",
    persona: "configurator",
    behavior: "The config a build consumes is the one the Configurator locked, unedited afterwards",
    criteria: ["A5"],
    productionEntryPoint: "packages/runtime/src/build/orchestrate-build.js",
    invocation: "service",
    status: {
      blockedBy: "PX.6",
      why:
        "orchestrateBuild writes affinityRules, motivationRules and actors back into "
        + "spec.configurator.inputs after the Configurator's round closes, so the artifact "
        + "recorded as the causal input is partly a product of the build.",
    },
  },

  // ── Allocator ──────────────────────────────────────────────────────────────
  {
    id: "allocator/pricing-single-origin",
    persona: "allocator",
    behavior: "The economy: every token cost has one author inside the Allocator",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/allocator/base-costs.json",
    invocation: "cli",
    status: {
      blockedBy: "CR.1",
      why:
        "Three independent origins of economic values: director/budget-allocation.js, "
        + "commands/card-authoring.js, and core-ts/state/budget.ts's silent DEFAULT_ACTION_COST.",
    },
  },
  {
    id: "allocator/judges-not-authors",
    persona: "allocator",
    behavior: "The Allocator prices a config it did not author, by reading the artifact's published fields",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/allocator/budget-fulfillment.js",
    invocation: "service",
    status: {
      blockedBy: "CR.9",
      why:
        "budget-fulfillment.js builds cards, fills vitals and encodes configuration validity "
        + "rules — the Configurator's chartered role — so it imports Configurator internals to "
        + "do it.",
    },
  },

  // ── Actor ──────────────────────────────────────────────────────────────────
  {
    id: "actor/serializable-decision",
    persona: "actor",
    behavior: "Proposes actions deterministically: the decision is a pure function of serialized state",
    criteria: ["A4"],
    productionEntryPoint: "packages/runtime/src/personas/actor/controller.js",
    invocation: "cli",
    status: {
      blockedBy: "CR.6",
      why:
        "createActorPersona closes over five values view() does not expose, so two Actors with "
        + "identical serialized state can produce different next actions.",
    },
  },
  {
    id: "actor/no-budget-policy",
    persona: "actor",
    behavior: "The Actor emits candidate proposals; budget admissibility is not its call",
    criteria: ["A1"],
    productionEntryPoint: "packages/runtime/src/personas/actor/controller.js",
    invocation: "cli",
    status: {
      blockedBy: "CR.6",
      why: "filterBudgetedProposals runs inline in the Actor — Allocator policy executing inside the Actor.",
    },
  },

  // ── Moderator ──────────────────────────────────────────────────────────────
  {
    id: "moderator/tick-ordering",
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

  // ── Annotator ──────────────────────────────────────────────────────────────
  {
    id: "annotator/run-summary-provenance",
    persona: "annotator",
    behavior: "The end-of-run RunSummary is produced by the instance that observed the run",
    criteria: ["A2", "A5"],
    productionEntryPoint: "packages/runtime/src/commands/kernel.js",
    invocation: "none",
    status: {
      blockedBy: "CR.8",
      why:
        "kernel.run() creates a fresh idle Annotator purely to call summarizeRun and stamp "
        + "producedBy:\"annotator\". The instance that recorded the frames is discarded.",
    },
  },

  // ── Cross-persona infrastructure ───────────────────────────────────────────
  {
    id: "all/port-contract-single-origin",
    persona: "moderator",
    behavior: "One effect codebook: the port contract belongs to the domain and is not redeclared",
    criteria: ["A1"],
    productionEntryPoint: "packages/core-ts/src/ports/effects.ts",
    invocation: "none",
    status: {
      blockedBy: "PX.1",
      why:
        "runtime/src/ports/effects.js redeclares EffectKind with 10 of core's 14 kinds, so "
        + "ActorMoved/ActorBlocked cross the port as anonymous \"custom\" blobs.",
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
      blockedBy: "PX.3",
      why:
        "28 sites default to `() => new Date().toISOString()`, including all seven controllers, "
        + "so a caller that forgets to inject silently gets wall-clock time.",
    },
  },
  {
    id: "all/restorable-from-view",
    persona: "moderator",
    behavior: "A persona can be rebuilt from its own serialized view()",
    criteria: ["A4"],
    productionEntryPoint: "packages/runtime/src/personas/configurator/state-machine.js",
    invocation: "none",
    status: {
      blockedBy: "PX.4",
      why:
        "Every factory takes a state LABEL, not a context, so serialized output cannot be fed "
        + "back in. A4 is unverifiable until restore(view) exists.",
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
      blockedBy: "CR.7",
      why:
        "The allowlist records the crossings that bypass controllers. Shrinking (74 -> 65); the "
        + "guard becomes a hard error at zero.",
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
