# Error message quality sweep

**Status:** plan, not yet started. **Audience:** an agent with no memory of the session that
produced it.
**Source of evidence:** `coding-issues-affecting-benchmarking.md` (M3/M4, merged as
[PR #131](https://github.com/KomplexMojo/agent-kernel/pull/131) /
[PR #132](https://github.com/KomplexMojo/agent-kernel/pull/132)) and a follow-up 17-scenario local
benchmark run (`tools/remote-ollama-control/results/2026-08-31T16-03-25-552Z-content-gen/`).

**Where this sits (maintainer, 2026-08-31):** two phases, in this order — **first deterministic
accuracy, then resilience.** The benchmark stays one-shot, deliberately: a single try per scenario is
what makes a harness bug obvious (the same request fails the same way every time until the code is
fixed), and a retry-until-success loop would let a model paper over a real gap by trial and error
instead of surfacing it. This plan is entirely phase one — it makes the error each one-shot failure
produces comprehensive enough to keep feeding the existing loop (benchmark discovers → M0-style
fixture harvest → deterministic test → fix the harness). Phase two — a **resilience** layer that,
only once a failure is *confirmed* pure model weakness (not fixable in the harness), retries the same
request against a different model using the failure detail this plan captures — is out of scope here
and not designed yet; see `## Explicitly out of scope`.

---

## The governing principle: structured detail, not string collapse

M3 and M4 fixed three unrelated-looking bugs that turned out to be the **same bug**:

1. `resource[N].vital` rejected `[object Object]` — the model's payload got coerced to a string
   before the parser could say what it actually received.
2. `floor_tile_budget_insufficient` — `level-layout.js` computed a rich detail object
   (`{target, required, roomCount, minPerRoom}`) and the caller in `orchestrate-build.js` discarded
   all of it, keeping only `field:code`.
3. `insufficient unoccupied walkable tiles` — `candidates.length`/`objects.length`/`index` were all
   live in scope at the throw site and none of them reached the message.

**Every one of these is the same shape: a structured value existed, and something between where it
was computed and where it was displayed collapsed it to a string too early, dropping the parts that
would have made the failure diagnosable — either by a human, or by a model trying to correct itself
on a retry.** Finding these by accident three times in one plan is a signal there are more.

**This is not "read 142 messages and make them nicer."** The mechanical signal to hunt is narrower
and cheaper to check per-site: *does this throw site have other local variables or a computed detail
object that isn't in the message?* A message with no interpolation at all (88 of 253 sweep-wide, per
the scoping survey) is the entry point for that question, not the answer to it — most of those are
argument-presence checks (`"room-plan requires at least one --room entry."`) with nothing to add.

**Do not build a shared error-formatting abstraction speculatively.** The instinct from this
principle is "introduce a `RichError`/`buildError({code, field, detail})` helper everything throws
through, and have telemetry capture the structured form instead of `.message`." That is a legitimate
direction — but it is an architecture change touching every throw site in scope, not a message
sweep, and it should be proposed with a concrete design after the sweep has data on how many sites
actually need it, not designed up front on three examples.

---

## Scope: the `ak create` model-facing surface, not the whole codebase

The codebase has 468 `throw new Error(` sites across `core-ts`/`runtime`/`adapters-cli`. Almost all
of them are unreachable from a single `ak_create` call (simulation-tick internals, other CLI
subcommands like `room-plan`/`llm-plan`/`narrate` the benchmark never exercises). Scoping to what a
model authoring through `ak_create` can actually trigger:

| area | file(s) | throw sites |
|---|---|---|
| entity-spec parsers + authoring command body | `ak-impl.mjs` (named-function scan: the singular `parseXSpec` family actually called from `agentAuthoringCommand`/`createCommand`, plus `parseOptimizationGoalEntry`/`List`, `parseActorVitals`, `parseActorAffinities`) | 92 |
| build/level-gen orchestration | `orchestrate-build.js` | 24 |
| Configurator persona | `personas/configurator/*.js` (6 files) | 12 |
| Allocator persona | `personas/allocator/*.js` (2 files) | 3 |
| **total in scope** | | **131** |

(Corrected twice now — see SM0 and the SM2 correction below for what each fix was.)

This is where M3/M4's bugs lived, and it is the only layer whose messages a model (or a future
re-prompt loop) would ever see. **Do not expand scope to the other ~337 sites without new evidence
that a model can reach them through `ak_create`.**

---

## Milestones

### SM0 — Mechanically list the sites and flag zero-interpolation ones (S — complete, 2026-08-31)

**Done:** `tools/benchmark/survey-ak-create-error-messages.mjs`. Scope is defined by function NAME,
not line range (a lesson from this repo's own history of drift-prone second homes for a value) —
each named function's body is bounded by a brace-depth scan from its declaration, string/template/
comment-aware, so the tool stays correct as the file grows. Whole-file scan for
`orchestrate-build.js` and the Configurator/Allocator persona files, where every throw is already on
the `ak_create` path.

**Bug found and fixed while building it:** the first version located a function's body by finding
the first `{` after its name — which breaks for `parseDelverSpec`/`parseWardenSpec`, whose parameter
lists have their OWN `{` from a destructured default (`{ defaultAffinity = ... } = {}`). That
mistook the parameter list's brace for the body's, truncating the scan and silently undercounting
(111 sites instead of the real 136). Fixed by matching the parameter list's parens first, then
looking for the body's opening brace only after that closes.

**Result at SM0 time:** 136 sites, all classified, none dropped — `error-message-quality-sweep-worklist.json`.
105 `has-interpolation`, 20 `no-interpolation`, 11 `needs-manual-read` (multi-line or
helper-constructed messages the static scan can't safely classify — SM1 reads these directly, they
are not excluded).

**One finding already visible from the worklist, ahead of SM1's full triage** (a second candidate
finding here turned out to be a scoping mistake — corrected below rather than silently dropped):
- **A whole untouched parallel family:** `orchestrate-build.js` has ~11 `"configurator inputs could
  not place actors: ..."` messages (`no walkable tiles`, `spawn not walkable`, `insufficient
  entry-room tiles`, `insufficient room tiles for wardens`, `unresolved strategic placement`, …) in
  what looks like a SEPARATE actor-placement algorithm (`normalizeActorPositions`) from the
  hazard/resource placement M4 already fixed (`assignPositionedLayoutObjects`). None of these were
  touched by M4 — the fix landed for hazards/resources and never propagated to actors. This is the
  single strongest piece of evidence yet that the sweep finds real, unfixed instances of the same bug
  class, not just re-confirming the three already known.

### SM1 — Triage: for each no-interpolation / needs-manual-read site, is there dropped detail? (M — complete, 2026-08-31)

**Do:** read the function body around each flagged site (not just the throw line). Classify:
- **fine-as-is** — no other computed data exists in scope; the message is already everything there
  is to say (most argument-presence checks land here).
- **detail-dropped** — local variables or a computed object exist that aren't in the message (the
  M3/M4 bug shape). This is the fix list.
- **needs-new-computation** — the message SHOULD say more, but nothing useful is computed yet (e.g.,
  it would need a new capacity calculation, not just surfacing an existing one). Record separately;
  do not fix speculatively — matches M4's restraint on `floorTile.count`'s description.

**Acceptance:** every flagged site has a disposition and, for `detail-dropped`, a one-line note of
what's being dropped. No bucket labelled `other`.

**Done:** every flagged site read and classified (`error-message-quality-sweep-worklist.json`'s
`sm1Disposition`/`sm1Note` fields; a hard check refuses to write the file unless every flagged site
got one). At first pass: 19 `detail-dropped`, 12 `fine-as-is`, 0 `needs-new-computation` across 31
sites. **Corrected during SM2** (see below) to **14 `detail-dropped`, 12 `fine-as-is`** across 26
sites, after 5 of the 19 turned out to be a scope mistake, not a real finding. Every remaining
dropped-detail case had the missing value already sitting in local scope; none needed a new
calculation.

**The `fine-as-is` sites cluster into two honest reasons**, worth naming so SM2 doesn't second-guess
them later: (a) several are module-load-time assertions on hardcoded constants
(`affinity-rules.js:710`, `motivation-rules.js:419`) or internal API-contract guards between
Configurator/Allocator modules (`budget-maximizer.js:113/119`) — genuinely unreachable from a
model's `ak_create` call, not merely "unlikely"; (b) the rest already interpolate the one thing
worth saying (`requireUnitCost`, `assertUniqueActorIds`, `formatBudgetReceiptDenial`,
`assignPositionedLayoutObjects` — M4's own fix).

**Correction found at the start of SM2, before any fix landed:** the five sites originally called a
"naming leak" (`parseRoomSpecs`/`parseHazardSpecs`/`parseResourceSpecs`/`parseDelverSpecs`/
`parseWardenSpecs`, each hardcoding a standalone `X-plan` command's name) turned out to be **not
reachable from `ak create` at all**. Tracing actual call sites: `agentAuthoringCommand` parses each
entity inline via `normalizeList(args.room).map(parseRoomSpec)` etc. — the SINGULAR form, never the
PLURAL "at least one entry" wrapper. Every plural wrapper's only caller is its own standalone
command (`parseRoomSpecs` → only `roomPlanCommand`, confirmed by grep, one call site each). Two of
the plural wrappers (`parseFloorTileSpecs`, `parsePlacedHazardSpecs`) have *zero* call sites anywhere
— dead code, a different concern entirely. SM0's scope list had assumed "plural wrapper" implied
"also used by create" from naming symmetry with the singular forms, without verifying the call
graph — exactly the kind of assumption this plan itself warns against. Corrected: removed the 7
plural functions from the survey tool's scope, re-ran it (131 sites, not 136), redid SM1's
disposition count (14 `detail-dropped`, not 19). Not fixing these 5 sites — they're out of scope by
the plan's own rule, not merely deprioritized.

**The remaining `detail-dropped` bucket has two shapes, giving SM2 its real batches:**

1. **Actor placement, the M4 pattern never propagated here (11 sites, `orchestrate-build.js`)** —
   both `normalizeActorPositions` (current) and `normalizeActorPositionsLegacy` have their own
   near-duplicate "could not place actors: ..." family, none of them reporting the
   candidates/requested/index-style detail M4 already added to the hazard/resource placement path
   (`assignPositionedLayoutObjects`). The largest batch, and the strongest confirmation the sweep
   finds real gaps, not just re-describing the three already known.
2. **Misc build-guard detail (3 sites, `orchestrate-build.js`)** — `hasActors`/`actorsInput.actors`
   type guards that could report what shape was actually received, and an XOR check
   (`affinityPresets`/`affinityLoadouts`) that already knows which one is missing but says "requires
   both" either way.

**Bonus finding, not a per-site fix:** `formatBudgetReceiptDenial()` (the helper both budget-denial
throw sites call, `orchestrate-build.js:1680`/`:1684`) is already excellent — except
`deniedLines.slice(0, 5)` silently caps the list with no "+N more" when there are more than 5. That's
CLAUDE.md's own "no silent caps" rule, on a message this session read closely three separate times
(M0–M2) without anyone noticing the cap. One-line fix, worth bundling into SM2's placement batch
since it's the same file and the same spirit of fix.

### SM2 — Fix the `detail-dropped` bucket, batched by area, one perturbation-tested commit per batch (S–M per batch — complete, 2026-08-31)

**Do:** for each `detail-dropped` site, thread the existing local data into the message (matching the
M3/M4 pattern exactly — no new computation, just stop discarding what's already there). Batch by the
table's five areas so each commit stays reviewable. Every fix gets a test asserting the new detail
appears, proven by `git stash`-perturbation the same way M3/M4/M5 did.

**Trap:** do not describe a field by contrasting it with another field's shape or type in an ERROR
MESSAGE either, for the same reason the schema-description trap exists — a message that says "unlike
X, this wants Y" primes the next attempt toward the same confusion it's naming.

**Acceptance:** `pnpm run test` and `pnpm run typecheck` green after each batch. No behavior change
— these are diagnostic-only, like M4's placement/floor-tile fixes, so no A/B measurement is required.

**All of it landed in one batch (2026-08-31) — `orchestrate-build.js`, all 14 `detail-dropped` sites
plus the bonus `formatBudgetReceiptDenial` cap fix.** After the naming-leak correction removed the
only `ak-impl.mjs` findings, and Configurator/Allocator had zero `detail-dropped` sites from SM1,
`orchestrate-build.js` turned out to be the entire fix list — there was no second batch to do.
Threaded existing local data into every message, matching the M4 pattern exactly:
- 11 actor-placement sites (both `normalizeActorPositions` and `normalizeActorPositionsLegacy`) now
  report the same candidates/requested/index-style detail M4 already gave hazard/resource placement.
- 3 misc build guards now report the actual value received or which of two required fields is
  missing.
- Bonus: `formatBudgetReceiptDenial()`'s `deniedLines.slice(0, 5)` now says `(+N more)` when it caps.

**Only 5 of the 15 fixes got a genuine, non-contrived reproduction — and that's an honest number,
not a shortfall to paper over.** Two actor-placement cases (too many delvers for the entry room, too
many wardens for the room) and the denied-lines cap all reproduce through a real `ak create` call,
perturbation-verified (`git stash` the fix, watch all 5 tests fail, restore). Two of the three misc
guards are tested directly against `orchestrateBuild` with a hand-built spec, since `ak create`'s own
parsing can never produce the malformed state they guard against (`hasActors` is always true;
`agentAuthoringCommand` always constructs an array). **The third misc guard and the remaining 9
actor-placement sites are not independently tested at all**, for two different reasons worth keeping
distinct:
- The `actorsInput.actors` guard turned out to be doubly defensive: attempting to trigger it revealed
  `mapBuildSpecToArtifacts`'s own schema validation already rejects a non-array
  `configurator.inputs.actors` before this guard's check ever runs, for any spec built through normal
  validation. Confirmed by trying — got `"BuildSpec validation failed: configurator.inputs.actors:
  expected array"` instead of this fix's message.
- The other 9 (`no walkable tiles` / `spawn not walkable` / `exit not walkable` /
  `unresolved strategic placement`, in both the current and Legacy placement functions) are
  defensive backstops behind the carving algorithm's own guarantee (a minimum walkable interior per
  room, spawn/exit chosen from the walkable set) — the same shape as
  `assertJudgementBudget`'s "must never fire" comment found during SM1. No `ak create` input reaches
  them without that upstream guarantee already having broken.

All 15 fixes are kept regardless — they're low-risk (pure message formatting, no control-flow
change) and verified by the full suite staying green (446 files / 3471 passed, +5 tests from
baseline, unaffected otherwise). But "kept and verified-safe" is a weaker claim than "tested", and
this plan says so rather than blurring the two.

### SM3 — Verify against the benchmark corpus and a fresh local run

**Do:** replay `tests/fixtures/benchmark-failures/` — dispositions shouldn't change (these are
diagnostic fixes, not behavior fixes), but every replayed error should now carry more detail. Run a
small local `--local` benchmark subset (matching the 17-scenario series already run) and spot-check
that failing scenarios' error text is now richer.

**Acceptance:** replay corpus stays green at the same 2 harness-defect / 39 model-error / 2
not-replayable split. No regressions.

---

## Explicitly out of scope

- **The 326 throw sites outside the `ak_create` surface** (§Scope) — no evidence a model reaches
  them; revisit only if new evidence says otherwise.
- **A shared structured-error/`buildError()` helper** — the governing principle's own caution: design
  it after SM1's data exists, not before, and treat it as its own plan with its own maintainer
  sign-off (it's an architecture change, not a message fix).
- **Piping structured errors through the Annotator persona for telemetry** — a real, separate
  direction raised alongside this plan (capture the structured `{code, field, detail}` shape, not
  the stringified message, so this bug class can't recur by construction). Worth its own design
  discussion once SM0/SM1 show how many sites would actually feed it.
- **A cross-model resilience/fallback layer** (maintainer, 2026-08-31) — for a failure already
  confirmed pure model weakness (harness-fix avenue exhausted, disposition `model-error` with no
  further fix possible), retry the same request against a *different* model, feeding it the failure
  detail this plan captures. Explicitly phase two: does not start until phase one (this plan) is
  done and the harness-fixable failures in a given batch are actually fixed, not merely identified.
  The one-shot benchmark methodology itself does not change — this is a production/deployment-facing
  recovery path, not a benchmark retry loop, and it is not designed here beyond this pointer.
