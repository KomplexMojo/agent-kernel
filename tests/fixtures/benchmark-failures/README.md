# Benchmark failure corpus

These fixtures are **recorded model output, not hand-written**. Each one is a deduplicated,
non-success attempt from a single reference content-gen benchmark run, harvested so the 173
failures that run produced become a sub-second, deterministic regression corpus instead of a
14-hour, non-deterministic one to re-discover on every run. See
`coding-issues-affecting-benchmarking.md` -> M0 for the full rationale, and
`tests/tools/benchmark-failure-corpus-replay.test.js` for the test that replays them.

**Source run:** `2026-08-28T17-48-28-063Z-94b75c0d2094-60bd8e52` (800 attempts, 627 success, 173
failures) — `scenarioSetHash d839c42a9932ce0c82d43d58c6cceca4b2191ba965d3f01773ce7d2feca3a001`,
`matrixHash 3def36d7d6cd0fca73a357bf1080887c3e191505814167fc60fbe211b05efc4e`. The raw
`runs.jsonl` this was harvested from lives only on the benchmark box and is never published or
committed — see the plan's "Where the evidence lives" section to fetch it again.

## How these were generated

`tools/benchmark/extract-benchmark-failure-fixtures.mjs --input <path-to-runs.jsonl>`

The script groups the 173 non-success attempts by `(observedOutcome, expectedOutcome,
normalized-error-shape)` — numbers and embedded JSON blobs collapsed so records that differ only
in the model's chosen values (an affinity, a vital max, a denied pool's remainder) land in the
same group — and keeps the first occurrence of each group as the fixture, plus an `occurrences`
count. 173 raw attempts collapse to 43 fixtures this way; `index.json` records the total so a
future re-harvest can be checked against it.

**Do not hand-write a new fixture here.** A hand-written sample passes against a defective schema
too, which makes it a mirror of the defect rather than a guard on it — this corpus exists
specifically to avoid that trap. To add to it, harvest a new reference run through the same script.

## `disposition`

Every fixture carries a `disposition`, decided once per deduplicated shape (not per raw attempt)
by reading its error and `toolArgs`:

- **`harness-defect`** — the `toolArgs` is a reasonable request the harness should have accepted.
  The replay test asserts `success` and is **intentionally red** until the milestone named in
  `dispositionNote` (M3, M4, or M5) fixes it. A harness-defect fixture turning green is the
  perturbation proof that milestone is done.
- **`model-error`** — the harness is correct to deny this `toolArgs` (malformed, incomplete, or
  genuinely infeasible). The replay test asserts the original denial reproduces and is green today,
  serving as a regression guard: if it ever starts passing, either the harness intentionally got
  looser, or a real fix landed and this fixture's disposition is stale and belongs in
  `harness-defect` instead.
- **`not-replayable`** — `toolArgs` is `null`. The model never produced a usable tool call (a raw
  Ollama transport/parser failure, or the model simply didn't call the tool), so there is nothing
  to run through `normalizeToolArgs -> buildArgv -> ak.mjs create`. These are still recorded for
  completeness (no attempt is silently dropped) but are excluded from the replay assertions.

Only the four symptom families M3's "Observed, from the run" table calls "unambiguously a harness
bug" (schema<->CLI conformance drift) are marked `harness-defect` here. Buckets M2 and M4 are still
investigating their own fixtures (`conflicting_requirements`, floor-tile budget, spatial
placement) — those default to `model-error` with a `dispositionNote` saying so. Promoting one to
`harness-defect` once a milestone concludes it is fixable is a one-line change to the
`DISPOSITIONS` table in the extraction script, followed by re-running it.
