With Moderator sequencing, effect fulfillment categories, and deferred side effects now nailed down, the design is in good shape. The remaining gaps are mostly “make the implicit contracts explicit so they don’t drift.”

1) core-as must defensively validate inputs (without becoming “Configurator”)
Status: complete

Your core-as README says it doesn’t “validate or interpret” configuration. That’s directionally correct, but in practice core-as must still deterministically reject malformed inputs (or you get undefined behavior and non-replayable crashes).

What to add/standardize:
	•	A deterministic input validation layer in core-as for:
	•	config shape invariants (required fields present, ranges sane)
	•	initial state invariants (positions valid, ids unique)
	•	action invariants (params types/ranges)
	•	A canonical emission path when invalid:
	•	EventV1.kind = "action_rejected" (for action-level)
	•	and consider a config_invalid / init_invalid event or effect (for startup failure)

This is “referee sanity checks,” not “scenario coherence.”

2) Effect results are not explicitly recorded
Status: complete

You now categorize effects (fulfillment: deterministic|deferred). Good. The next gap is: what is the observable outcome of deterministic fulfillment?

Without this, replay can still drift if:
	•	deterministic provider behavior changes (bugfix), or
	•	an effect is fulfilled differently (e.g., random value sequence).

Minimal, robust solution:
	•	Add a small event emitted by Moderator (runtime event, not core-as) or a new record type:
	•	effect_fulfilled with the value(s) returned
	•	effect_deferred with reason/target
	•	Or embed “fulfillment results” into TickFrameV1:
	•	fulfilledEffects?: Array<{ effect: EffectV1; result: Record<string, unknown> }>
This keeps replay literally “feed frames back.”

3) Phase model is defined, but not yet used consistently
Status: complete
Completed: TickFrames now include phaseDetail and runtime emits phase-boundary frames; Moderator docs updated.

You added Phase and TickFrameV1.phase. Great. The gap is ensuring every subsystem treats phase boundaries the same.

To close:
	•	Ensure Moderator (and any runner module) explicitly documents:
	•	when phase changes
	•	whether execute includes observation production, action collection, or only application
	•	Ensure TickFrame is recorded for all phases that matter (at least execute; optionally phase transitions)

This prevents “did this happen before or after apply?” ambiguity.

4) “Runner vs Moderator” naming needs one canonical statement
Status: complete
Completed: Orchestrator/Moderator docs clarify ownership; runner module marked as Moderator-owned.

You’ve got a persona (Moderator) and you also reference “runtime runner” in Orchestrator. If both exist as concepts, you’ll eventually implement two overlapping orchestrators.

Close the loop with one rule in docs:
	•	runtime/runner is an implementation module owned by Moderator (or Moderator is the runner).
	•	Orchestrator triggers “Moderator execution,” not “runner execution.”

This is small, but it prevents duplicate control planes.

5) Budget enforcement attachment point should be explicitly canonical
Status: complete
Completed: Caps/ledger documented; core-as budget ledger + limit effects implemented; allocator docs updated.

You’ve said:
	•	Allocator issues receipts/caps
	•	Configurator embeds constraints
	•	core-as enforces caps

The remaining gap is to define exactly where caps live and how core-as reports spend/violations.

Minimal closure:
	•	In SimConfigArtifactV1.constraints, define the canonical expectation:
	•	categoryCaps + optional limits
	•	Decide whether core-as tracks “spend” and emits spend events:
	•	EventV1.kind = "limit_reached" | "limit_violated" (already exists)
	•	Decide whether “spend counters” are:
	•	internal to core-as state, but exposed only through events/snapshots

Without this, you’ll end up with duplicated “budget tracking” in runtime.

6) Observation/Action/Event schemas are still intentionally loose—good, but you need stability rules
Status: complete
Completed: Stability guardrails added to Action/Observation/Event/Effect/Snapshot schemas.

Right now params/view/data are Record<string, unknown>. That’s fine early, but you need a discipline rule so these don’t become dumping grounds.

Recommended “stability guardrails”:
	•	Any addition to these payloads must be:
	•	backward compatible, and
	•	documented as optional
	•	Breaking changes require:
	•	bumping schemaVersion
	•	Avoid leaking internal memory layouts (especially in SnapshotV1)

Otherwise you’ll break replay tooling every month.

7) Snapshot ceiling needs an explicit “no full dumps” rule
Status: complete
Completed: DebugDump schema added; snapshot ceiling documented in core-as README.

You’ve stated it conceptually; codify it:
	•	Snapshot is a stable inspector view only.
	•	Full state dumps must be an explicit, separate debug artifact with its own versioning and explicit “not for determinism guarantees” warning.

This keeps Annotator and UI from coupling to core internals.

8) “need_external_fact” needs a concrete policy
Status: complete
Completed: sourceRef added to effects and deterministic/deferred policy documented in Moderator/Orchestrator.

You now have deterministic vs deferred effects, but the design still needs a rule for need_external_fact:
	•	If it is deterministic, it must be satisfiable from pre-captured artifacts (IntentEnvelope context / config references).
	•	Otherwise it must be deferred and handled post-run, producing an artifact that can be used in a future run.

Codify this in a short section (Moderator or Orchestrator README) to prevent accidental live fetching.

⸻

Highest leverage next steps

If you cover only three things next, do these:
	1.	Record effect fulfillment outcomes (in TickFrame or as runtime events).
	2.	Add deterministic input validation semantics to core-as (and startup failure events).
	3.	Declare Moderator owns runner (one sentence in Orchestrator + Moderator docs).

Those close the biggest remaining drift vectors while keeping the architecture clean and deterministic.

----------------


Proposed step-by-step changes (code + contracts + docs)

1) Make core-as validation explicit and deterministic
- Code: add a validation module in core-as (e.g., packages/core-as/assembly/validate/) that checks config/action invariants and returns structured error codes.
- Code: emit a startup failure event/effect when init/config is invalid and action_rejected for malformed actions.
- Contracts: define EventV1 kinds for init_invalid / config_invalid (or similar) with stable payload fields.
- Docs: update packages/core-as/assembly/README.md to spell out validation scope and new events.

2) Record effect fulfillment outcomes in runtime
- Code: extend runtime tick recording (or add a minimal event log) to capture effect_fulfilled and effect_deferred with returned values or reasons.
- Contracts: add a fulfillment record to TickFrameV1 (or a new runtime event schema) and document required fields.
- Docs: update runtime persona docs (Moderator/Annotator) to clarify where fulfillment is recorded for replay.

3) Normalize phase model usage
- Code: ensure runner/Moderator emits TickFrame for each phase boundary it owns.
- Contracts: document Phase transitions and which operations occur in each phase (observe/collect/apply).
- Docs: update packages/runtime/src/personas/moderator/README.md with a clear phase timeline.

4) Set a single source of truth for "runner" vs "Moderator"
- Docs: add one sentence in packages/runtime/src/personas/orchestrator/README.md and packages/runtime/src/personas/moderator/README.md stating Moderator owns the runner module.
- Code: if needed, rename runtime/runner exports to make ownership explicit (or add a comment in packages/runtime/src/runner/runtime.js).

5) Formalize budget enforcement attachment point
- Contracts: define where caps live in SimConfigArtifactV1.constraints and how spend is represented.
- Code: ensure core-as state tracks spend and emits limit_reached/limit_violated events.
- Docs: update core-as README and Allocator README to reference the same cap fields and event semantics.

6) Add schema stability guardrails
- Contracts: add versioning rules and backward-compatible payload policy for Action/Observation/Event schemas.
- Docs: update contracts docs (runtime) and core-as README to state "no breaking changes without schemaVersion bump."

7) Codify snapshot ceiling
- Docs: define SnapshotV1 as a stable inspector view only, and prohibit full dumps.
- Code: if full dumps are needed, define a separate debug artifact schema with explicit non-determinism warnings.

8) Define policy for need_external_fact
- Docs: specify deterministic vs deferred handling rules in Orchestrator or Moderator README.
- Contracts: add a field that indicates fulfillment class and artifact reference for replay.

---

Potential next steps (post-major milestones)

- Decide whether TickFrame should include phase transitions beyond execute (observe/collect/apply).
- Add explicit acceptedActions/preCoreRejections population in TickFrame once action collection is wired.
- Standardize TickFrame emission cadence (per tick vs per phase boundary) and document it in Moderator README.
