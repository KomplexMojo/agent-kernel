# Coding issues affecting benchmarking

**Status:** plan, not yet started. **Audience:** an agent with no memory of the session that produced it.
**Source of evidence:** benchmark run `2026-08-28T17-48-28-063Z-94b75c0d2094-60bd8e52`, 800 attempts,
six configurations, published to the `benchmark-results` branch as `latest.json`.

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
- Each landed fix has a perturbation-verified test.
- `pnpm run test` and `pnpm run typecheck` green (baseline: 441 files / 3411 passed / 0 errors).
- If any identity hash moved, §6 was followed.
- A `## Findings` section in this file records what was measured, including anything that turned out
  NOT to be a defect. Negative results are the point of M1 and M2.

## 5. Verifying a change actually helps

Do not trust reasoning about model behaviour; measure it. On the developer Mac:
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
