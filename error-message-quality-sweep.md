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
| entity-spec parsers | `ak-impl.mjs` (`parseRoomSpec` @717 through `parseWardenSpecs` @1514, plus `parseOptimizationGoalEntry`/`List`, `parseActorVitals`, `parseActorAffinities`) | 99 |
| authoring command body | `ak-impl.mjs` `agentAuthoringCommand` (@4779) / `createCommand` (@5244) | 4 |
| build/level-gen orchestration | `orchestrate-build.js` | 24 |
| Configurator persona | `personas/configurator/*.js` (6 files) | 11 |
| Allocator persona | `personas/allocator/*.js` (2 files) | 3 |
| **total in scope** | | **141** |

This is where M3/M4's bugs lived, and it is the only layer whose messages a model (or a future
re-prompt loop) would ever see. **Do not expand scope to the other ~326 sites without new evidence
that a model can reach them through `ak_create`.**

---

## Milestones

### SM0 — Mechanically list the 141 sites and flag zero-interpolation ones (S)

**Do:** extend the survey script used to scope this plan (currently a scratch file, not committed)
into a small, committed tool under `tools/` that walks the five file/function ranges above, extracts
each `throw new Error(...)` site (file:line, message literal), and flags which have zero `${...}`
interpolation. Output a structured worklist (JSON), not prose.

**Acceptance:** every one of the 141 sites appears exactly once in the worklist, tagged
`has-interpolation` or `no-interpolation`. No silent exclusions — if a throw site's message can't be
statically extracted (multi-line construction, computed via helper), it goes in the worklist as
`needs-manual-read`, not dropped.

### SM1 — Triage: for each no-interpolation / needs-manual-read site, is there dropped detail? (M)

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

### SM2 — Fix the `detail-dropped` bucket, batched by area, one perturbation-tested commit per batch (S–M per batch)

**Do:** for each `detail-dropped` site, thread the existing local data into the message (matching the
M3/M4 pattern exactly — no new computation, just stop discarding what's already there). Batch by the
table's five areas so each commit stays reviewable. Every fix gets a test asserting the new detail
appears, proven by `git stash`-perturbation the same way M3/M4/M5 did.

**Trap:** do not describe a field by contrasting it with another field's shape or type in an ERROR
MESSAGE either, for the same reason the schema-description trap exists — a message that says "unlike
X, this wants Y" primes the next attempt toward the same confusion it's naming.

**Acceptance:** `pnpm run test` and `pnpm run typecheck` green after each batch. No behavior change
— these are diagnostic-only, like M4's placement/floor-tile fixes, so no A/B measurement is required.

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
