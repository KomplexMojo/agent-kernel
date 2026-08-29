# Coding issues affecting benchmarking

**Status:** plan, not yet started. **Audience:** an agent with no memory of the session that produced it.
**Source of evidence:** benchmark run `2026-08-28T17-48-28-063Z-94b75c0d2094-60bd8e52`, 800 attempts,
six configurations, published to the `benchmark-results` branch as `latest.json`.

---

## The governing principle: the benchmark discovers, unit tests enforce

**Do not use the benchmark to catch anything a deterministic test can catch.**

A benchmark run costs ~14 hours across six GPU configurations and gives a non-deterministic answer.
Of the 173 failures in the reference run, only two classes required a model at all: whether the
model CHOOSES a valid shape, and whether it can budget under pressure. Everything else was schema
and parser conformance, arithmetic, geometry or retry policy — properties that hold or fail
whichever model is driving, and that must fail in seconds, locally, with no GPU and no LLM.

The rule and its evidence table live in `AGENTS.md → Benchmark strategy`. **Read it there; it is
deliberately not restated here** — a second copy of a rule is how this repo has repeatedly ended up
with two versions that disagree.

**The 173 recorded failures are free fixtures.** Each is a real `toolArgs` that broke something.
Replayed through `normalizeToolArgs -> buildArgv -> ak create` with no model involved, they become a
deterministic regression corpus. The repo already has the convention for negative cases
(`tests/fixtures/artifacts/invalid/`). Harvesting them is M0 and it comes before every other
milestone.

**Consequence for M3–M5:** a fix is proven by a unit test, not by a benchmark run. Re-run the
benchmark only to answer "did model BEHAVIOUR change", never "is the code correct now".

---

## 0. What you need to know before touching anything

### The system
`tools/remote-ollama-control/` drives a benchmark that asks local LLMs to author dungeon content
through the `ak_create` tool, runs the result through `packages/adapters-cli/src/cli/ak.mjs`, and
scores it. 100 scenarios across four tiers (simple, affinity, complex, constrained), six
model/hardware configurations, up to 3 passes each.

### The two run kinds — read `AGENTS.md → Benchmark strategy` in full
- **Local debug runs** (`run-content-gen --local`) are IN the development loop. You may run these,
  on a subset. They record `matrix: "local-unversioned"` so they can never be quoted as a baseline.
- **Full remote matrix runs** are OUTSIDE it. Do not start one, do not schedule work around one.

Before any local run: `scripts/benchmark-preflight.sh`. Every way this setup breaks is silent — an
unset `OLLAMA_MODELS` makes `ollama list` return EMPTY rather than erroring.

### Rules that are not negotiable in this repo
1. **No second homes for a value.** This repo has been bitten repeatedly: the budget split lived in
   four places, the price brief was built at two call sites and could disagree with its own identity
   record, the mobility list disagreed with core's `PROFILE_MOBILITY`. If you need a number that
   exists elsewhere, import it or derive it. Never restate it.
2. **A passing guard proves nothing until you break the thing it guards.** Every fix in this plan
   must be accompanied by a perturbation: reintroduce the defect, watch the new test fail, restore.
   Record the result in the commit message.
3. **Identity hashes gate comparability and never error when wrong.** `scenarioSetHash`,
   `matrixHash`, `executionSuiteHash` are pinned on the runner. Changing the scenario catalog or the
   matrix moves a hash and silently makes runs incomparable. If your change moves one, say so
   loudly and repin (see §6).
4. **No silent caps.** If you exclude, skip, or truncate anything, report what was dropped.
5. Follow `CLAUDE.md → Enforcement Checklist` and the persona boundaries. Domain logic lives in
   personas; `core-ts` has no IO.

### Where the evidence lives
- Published, compact, per-scenario: `git show origin/benchmark-results:latest.json`
  (`configurations[].perScenario` — added recently; older runs do NOT have it).
- Raw, per-attempt, with error text: on the benchmark box only, never published:
  `~/.local/state/agent-kernel-benchmark/runs/*/authoring/*-content-gen/runs.jsonl`
  Reach it with `ssh llm-wan`. If ssh fails with `Permission denied`, the agent has no key —
  `ssh-add --apple-use-keychain ~/.ssh/ubuntu_llm_ed25519` first. A timeout on `llm-lan` off-LAN is
  expected; use `llm-wan`.

---

## 1. The measured failure profile

800 attempts, 627 success, 173 failures. Classified by cause, split by whether the scenario
EXPECTED to fail (six scenarios expect `budget_denied`; a correct denial is a pass):

| cause | total | expected | **unexpected** |
|---|---|---|---|
| budget | 76 | 36 | **40** |
| other (see §2) | 28 | 0 | **28** |
| schema / spec | 22 | 0 | **22** |
| conflicting requirements | 19 | 0 | **19** |
| floor-tile budget | 15 | 0 | **15** |
| spatial placement | 10 | 0 | **10** |
| authored nothing | 3 | 0 | **3** |

**137 unexpected failures.** Only the budget row has a legitimate expected component.

Per-configuration verdict rates from the same run:

| configuration | n | verdict | avgScore |
|---|---|---|---|
| qwen3.5:9b primary | 100 | 0.55 | 61.2 |
| qwen3:14b primary | 100 | 0.73 | 67.3 |
| qwen3.8:27b primary | 200 | 0.885 | 73.3 |
| qwen3.5:27b dual | 100 | 0.86 | 73.4 |
| qwen3.8:27b dual | 200 | **0.925** | **74.6** |
| qwen3-coder:30b dual | 100 | 0.87 | 71.7 |

Gates: `toolCallRate >= 0.99`, `scenarioVerdictRate >= 0.96`, `averageScore >= 75`.
Nothing has qualified in 17 runs. **All three gates fail on every configuration** —
`authoring`, `runtime_execution`, `generated_execution`. The verdict threshold is NOT the only
binding constraint, and the other two gates have never been investigated.

---

## 2. Milestones

Each milestone is independently landable. Do them in order; M1 and M2 are analysis that may change
the shape of M3–M5.

### M0 — Harvest the failures into a deterministic corpus  *(do this first)*

**Why:** every subsequent milestone is verified against this corpus rather than against a benchmark
run. It turns a 14-hour non-deterministic signal into a sub-second deterministic one, and it is the
difference between fixing these defects once and rediscovering them every run.

**Do:**
1. From the reference run's `runs.jsonl`, extract every non-success attempt as a fixture:
   `{ scenarioIndex, expectedOutcome, toolArgs, observedOutcome, observedError }`.
   Deduplicate on the *shape* of the failure, not the exact text — normalise embedded numbers.
2. Store under `tests/fixtures/benchmark-failures/` with a README stating the run id they came from
   and that they are recorded model output, not hand-written.
3. Add a replay test that runs each fixture through the REAL path —
   `normalizeToolArgs` -> `buildArgv` (`packages/adapters-cli/src/mcp/tools/shared.mjs`) ->
   `ak.mjs create` — and asserts the observed outcome. No LLM, no network, no GPU.
4. The test starts RED for every harness defect and GREEN for every genuine model error. That split
   is the deliverable: it mechanically separates "our bug" from "model got it wrong", which is what
   M1 does by hand.

**Acceptance:** the corpus exists, the replay test runs in the normal suite, and every fixture is
labelled `harness-defect` or `model-error` by whether the replay reproduces a failure the code
should have accepted. Fixture count and split reported in the commit message.

**Traps:**
- Do not hand-write these. A hand-written sample passes against a defective schema too, which makes
  it a mirror of the defect rather than a guard on it. Use the recorded output.
- Do not assert on exact error strings; assert on outcome class. Error text is not a contract and
  pinning it makes the corpus brittle.
- Record the `scenarioSetHash` the fixtures came from. Budgets moved once already this month.

---

### M1 — Classify what is model weakness and what is a code defect

**Why:** 137 unexpected failures are currently attributed to "the model got it wrong". Some are the
harness rejecting valid intent. Only the second kind is fixable here.

**Do:**
1. Pull `runs.jsonl` for the run named at the top of this file from the box.
2. For every non-success attempt, record: `configurationId`, `scenarioIndex`, `executionOutcome`,
   the first line of `execStderr`/`llmError`, and the `toolArgs` that produced it.
3. Bucket by cause. Start from the table in §1; do not assume it is complete.
4. For each bucket, decide and record **model weakness** vs **harness defect**, with a one-line
   justification and one example `toolArgs`.

**Acceptance:** a table in this file, every one of the 173 failures accounted for, no bucket labelled
"other" larger than 5. Write it into a new `## Findings` section, do not replace §1.

**Trap:** "absorbed by another finding" is not a disposition. This repo has been burned by a
disposition table that used it. Each failure gets a real category or stays open.

---

### M2 — Determine which failures the viability floor CREATED

**Why:** the actor viability floor (merged as "an actor floor that leaves it able to survive being
hit") made every actor ~2.5x more expensive — a delver minimum went 21 -> 52 tokens, a warden
4 -> 38. Two buckets are plausibly *caused* by it rather than found by it:
- `conflicting requirements` (19) — `explicit hard requirements conflict with the minimum support
  needed`. A model asking for vitals below the floor now gets refused.
- `floor-tile budget` (15) — `floorTile.count:floor_tile_budget_insufficient`. The floor forced a
  retune of `levelBudgetSplitPercent` (room 41->29, delver 20->25, warden 16->23); the room share
  may now be too tight for tile-heavy scenarios.

**Do:**
1. Find the previous run's `runs.jsonl` on the box (`ls -1dt ~/.local/state/agent-kernel-benchmark/
   runs/*/authoring/*-content-gen`). Identify which runs are pre-floor by the `sourceCommit` in the
   run directory name and `git log` on the floor commit.
2. Compare the per-cause counts for the same scenario indices across pre- and post-floor runs.
3. If either bucket grew materially, it is a regression this repo introduced, not model weakness.

**Acceptance:** a documented before/after count for both buckets, and a verdict: regression or
pre-existing. If regression, M4 becomes mandatory rather than optional.

**Trap:** pre- and post-floor runs have DIFFERENT `scenarioSetHash` (`fa63f68c…` -> `d839c42a…`)
because eleven boundary scenario budgets were recalibrated. Comparing aggregate rates across that
boundary is invalid. Compare per-scenario, on scenarios whose budget did not change, and say so.

---

### M3 — Fix schema↔CLI conformance drift  *(highest confidence defect)*

**Why:** the "other" bucket is mostly the tool schema advertising shapes the CLI cannot parse. This
is the same family as previously-fixed resource-spec defects, and it is unambiguously a harness bug:
the model is steered into an invalid call by the schema it was given.

Observed, from the run:
| symptom | n |
|---|---|
| `delver[N] segment "[{"count": N, "affinity": …}]"` — a JSON array reaching a field that expects a segment | ~9 |
| `create --dungeon-affinity must be one of: fire, water, …` | 2 |
| `hazard[N] mana must be a plain amount, one-time:<amount>, or regen:<c>:<max>:<regen>; got "-N"` / `"one-time:N:N:"` | 2 |
| `resource[N] vital must be one of: health, mana, stamina; got "[object Object]"` | 1 |

**Do:**
1. Reproduce each from the recorded `toolArgs` by running the real path:
   `normalizeToolArgs` -> `buildArgv` (from `packages/adapters-cli/src/mcp/tools/shared.mjs`) ->
   `ak.mjs create`. A standalone script is fine; do not reimplement the translation.
2. For each: decide whether the SCHEMA should forbid the shape, or the CLI should accept it.
   Default to constraining the schema — it is guidance the model actually follows, and the CLI's
   contract is deliberate.
3. `dungeonAffinity` almost certainly just needs the same `enum` the other affinity fields carry.
4. Extend `tests/tools/ak-tool-schema-cli-conformance.test.js`. That test DERIVES cases from the
   schema rather than hand-writing them, on purpose: a hand-written sample passes against a
   defective schema too, which makes it a mirror rather than a guard. Keep that property.

**Acceptance:** every symptom above either impossible to express in the schema, or accepted by the
CLI. Conformance test extended and perturbation-verified. Suite and typecheck green.

**Trap:** a schema `description` is a PROMPT. Adding "note this is a STRING, unlike X" previously
TRIPLED malformed values for that field. Do not describe a field by contrast with another.
`tests/tools/ak-tool-schema-cli-conformance.test.js` has a test pinning this; read it first.

---

### M4 — Spatial placement and floor-tile capacity

**Why:** 10 failures are `configurator inputs could not place hazard: insufficient unoccupied
walkable tiles`, and 15 are `floor_tile_budget_insufficient`. In both the model authored a
structurally valid spec and the harness could not realise it. The model has no way to reason about
capacity — it is never told how many tiles a room has, or how many are free.

This is the same shape as the pricing problem, and note the outcome there before designing a fix:
five variants of telling the model the prices ALL performed worse than telling it nothing, because a
list of facts in the prompt reads as a menu and the model orders from it. Do not assume "tell the
model the capacity" is the answer. Measure it.

**Do:**
1. Establish whether these are model errors or harness limits: for a failing `toolArgs`, is there a
   placement that would have worked? If yes, the Configurator's placement is too weak. If no, the
   model over-asked.
2. If harness-side: fix placement or report capacity in the refusal so the failure is actionable.
3. If model-side: propose, do not build. Any prompt change must be A/B measured on the local Mac
   against a control arm, on the constrained tier, before it lands.

**Acceptance:** a verdict per bucket with evidence. Code changes only where the harness is at fault.

---

### M5 — Infrastructure error should not void a run

**Why:** one attempt in 800 failed with:
```
HTTP 500 from …/v1/chat/completions: {"message":"XML syntax error on line 42:
element <parameter> closed by </function>"}
```
That is Ollama's tool-call parser failing on the model's output. `failureClass: 'infrastructure'`
causes `executeContentGenMatrix` to **throw and abort the entire run** (see
`tools/remote-ollama-control/scripts/lib/ak-matrix.js`). A 14-hour run can be destroyed by one
malformed generation.

**Do:**
1. Distinguish *transport/parser* 500s from genuine infrastructure loss (endpoint down, model
   missing). The former is a bad sample; the latter is a broken rig.
2. Retry a parser-level failure a bounded number of times (start at 1) before classifying it as
   infrastructure. Count and REPORT retries in the result — a silent retry hides a degrading model.
3. Leave the abort behaviour intact for genuine infrastructure loss. The collapse breaker exists
   because a broken rig must stop, not continue producing meaningless numbers.

**Acceptance:** a parser-level 500 no longer aborts a run; a genuine endpoint failure still does.
Both paths tested. Retry counts appear in the published record.

---

## 3. Explicitly out of scope

- **Re-tuning the 0.96 verdict gate or the 75 score gate.** All three gates fail everywhere; tuning
  one without understanding `runtime_execution` and `generated_execution` would be guesswork. That
  investigation is its own plan.
- **Quarantining scenarios that never pass.** It needs consecutive-failure evidence at a stable
  identity. The floor and the denial-scoring change reset every prior judgement, so there is
  currently no valid history to justify a single exclusion.
- **Any change to prompt content** without an A/B on the constrained tier. See M4.

## 4. Definition of done

- Every one of the 173 failures in the reference run has a documented disposition.
- Every harness defect fixed is guarded by a DETERMINISTIC test in `pnpm run test`, and would now be
  caught in seconds rather than by a benchmark run.
- Each landed fix has a perturbation-verified test.
- `pnpm run test` and `pnpm run typecheck` green (baseline: 441 files / 3411 passed / 0 errors).
- If any identity hash moved, §6 was followed.
- A `## Findings` section in this file records what was measured, including anything that turned out
  NOT to be a defect. Negative results are the point of M1 and M2.

## 5. Verifying a change

**Correctness is proven by the corpus from M0, not by a benchmark run.** A fix that does not flip a
fixture from red to green has not been demonstrated. Run `pnpm run test`; it takes seconds.

Use a benchmark run ONLY to answer a question about model behaviour — did the model start choosing
better shapes, did the budget failures fall. That is a different question from "is the code correct",
and conflating them is how a 14-hour job ends up doing a unit test's work. On the developer Mac:
```
scripts/benchmark-preflight.sh
node tools/remote-ollama-control/scripts/remote-ollama-mac.js run-content-gen \
  --local --model qwen3.5:9b --scenario-ids <the failing indices> --runs 1
```
`qwen3.5:9b` is the cheap control and fails most, so it has the most headroom to show an effect.
Full-matrix confirmation is the maintainer's to run, not yours.

## 6. If you move an identity hash

Changing the scenario catalog moves `scenarioSetHash`; changing `models.json` profiles or contexts
moves `matrixHash`. Both are pinned on the runner in
`~/.config/agent-kernel-benchmark/benchmark-agent.env` and **nothing errors when they are stale** —
the run simply compares incomparable evidence.

1. Say so prominently in the PR.
2. `scripts/benchmark-preflight.sh --remote` reports the drift.
3. Repinning requires a reinstall on the box (it runs an installed FILE COPY; merging never reaches
   it). Coordinate with the maintainer — do not deploy or start a remote run yourself.

---

## Findings

### M1 — every failure classified (2026-08-29)

Built from the same `runs.jsonl` M0 already pulled from the box (no second fetch needed) — the 43
deduplicated fixtures in `tests/fixtures/benchmark-failures/` collapse to the 16 causes below when
grouped by root cause instead of by exact error shape. All 173 raw attempts are accounted for; no
bucket is "other".

Two of §1's rows turned out to be more than one cause: "budget" (76) is two distinct code paths, not
one, and "other" (28) resolves into six named causes.

| cause | n | disposition | justification | example |
|---|---|---|---|---|
| budget: allocator pool cap | 68 | model weakness | The Allocator denies pool spend beyond the request's remaining budget — the model asked for more entities/affinities than the budget covers. Correct denial, spread across every model (heaviest: qwen3.8:27b 35/68, the best-scoring configuration — it authors the most, so it also hits the cap most). | `bf-001` |
| resource V3: incomplete spec | 20 | model weakness | `resource[N]` payload missing a companion field its own chosen fields require (`delta`/`regen`, or `permanenceMode` when `vital`/`regen` is set). Not in M3's symptom table — the V3 cross-field requirement is correct. Concentrated in the two smallest models (qwen3.5:9b 13/20, qwen3:14b 6/20): a capability gap, not a schema gap. | `bf-006` — `resource[1] delta is required unless regen is given.` |
| conflicting requirements (viability floor) | 19 | **open — see M2 below** | `create infeasible (conflicting_requirements)`: explicit vitals fall below the actor viability floor. Left undispositioned here; M2's verdict below does not resolve it either. | `bf-004` |
| schema/CLI: JSON array as segment | 16 | **harness defect (M3)** | The model emits a JSON array for `delver`/`warden` where the CLI's `key=value` segment parser expects flat pairs. Corrects M3's original "~9" estimate to 16 across all three shape variants. Concentrated in the *best*-scoring model (qwen3.8:27b 13/16) — a stronger model reaching for well-formed nested JSON, not a weaker one guessing syntax, is itself evidence this is a schema gap rather than a capability gap. | `bf-003` |
| floor-tile budget | 15 | **open — see M2 below** | `floorTile.count:floor_tile_budget_insufficient`. Left undispositioned here; M2's verdict below finds no floor regression. | `bf-002` |
| spatial placement | 10 | **open — pending M4** | `configurator inputs could not place hazard/resource: insufficient unoccupied walkable tiles`. M4 has not yet determined model-over-asked vs. placement-too-weak. Left undispositioned here. | `bf-007` |
| budget: CLI pre-allocator minimum-spend check | 8 | model weakness | `create infeasible (insufficient_budget)`: the CLI's own minimum-spend floor rejects the request before budget scoring runs — a distinct code path from the allocator row above. Collapsing the two would have hidden this path entirely. | `bf-012` |
| model: authored nothing | 3 | model weakness | Tool call with no `--room`/`--floor-tile`/`--hazard`/`--resource`/`--delver`/`--warden` at all. All three from qwen3:14b. | `bf-015` |
| model: no tool call produced | 3 | model weakness, no code path | `toolArgs` is `null` — `ak_create` was never called. Not replayable through `normalizeToolArgs -> buildArgv -> create`; nothing in the harness to fix. | `bf-013` |
| schema: unsupported field | 2 | model weakness | Model invents a field the schema never offered (`hazard.manaRegen`, `room.description`). Correctly rejected. | `bf-024` |
| schema/CLI: dungeonAffinity enum | 2 | **harness defect (M3)** | `--dungeon-affinity` rejects a value outside its enum; M3 already names this, expecting the fix is the same enum the other affinity fields carry. Both from qwen3:14b. | `bf-020` |
| schema/CLI: hazard mana format | 2 | **harness defect (M3)** | Hazard `mana` parser rejects a negative amount and a malformed `one-time:c:m:r` triple. | `bf-025`, `bf-026` |
| model: invalid enum value | 2 | model weakness | Affinity/kind value outside the supported enum (`warden.affinity[].kind: "pull"` — a hazard-expression verb, not an affinity kind; an out-of-enum Delver `affinity`). | `bf-030` |
| resource V3: legacy field | 1 | model weakness | Pre-V3 `count` field blended into a V3 resource payload; correctly rejected. | `bf-038` |
| schema/CLI: resource vital enum | 1 | **harness defect (M3)** | `resource[N].vital` rejects a non-string (`[object Object]`) payload. | `bf-023` |
| infrastructure: parser-level 500 | 1 | infrastructure, no code path | Ollama's tool-call XML parser failed before `toolArgs` existed. M5's target, via a different code path (`executeContentGenMatrix`) — not this replay corpus. | `bf-031` |

**Totals:** 173 = **21 harness defect** (M3; all seven fixtures already landed red in M0) + **104
model weakness** (correct denials/rejections; nothing to fix) + **44 open, pending M2/M4** + **4 not
replayable** (3 no-tool-call + 1 infrastructure). No failure was dropped or marked "absorbed by
another finding" — the 44 open ones stay open rather than being forced into a disposition M2/M4
haven't earned yet.
